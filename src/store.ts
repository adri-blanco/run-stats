import { Database } from "bun:sqlite";

export type NewActivity = {
  stravaId: string;
  source: "strava";
  startUtc: string;
  type: string;
  title: string;
  tags: string;
  elapsedS: number;
  movingS: number;
  distanceM: number;
  file: { format: string; gz: Uint8Array } | null;
};

// Seconds at each bpm. JSON object keys are strings, so a bpm is a string key here.
export type TimeAtBpm = Record<string, number>;

export type StoredActivity = Pick<NewActivity, "startUtc" | "type" | "title" | "distanceM" | "movingS"> & {
  timeAtBpm: TimeAtBpm | null;
};

export type StaleFile = { id: number; startUtc: string; format: string; gz: Uint8Array };

export type Store = {
  insertAll(activities: NewActivity[]): void;
  activities(): StoredActivity[];
  staleFiles(version: number): StaleFile[];
  saveDerived(id: number, timeAtBpm: TimeAtBpm | null, version: number): void;
};

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY,
    strava_id TEXT UNIQUE,
    source TEXT NOT NULL,
    start_utc TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT,
    tags TEXT NOT NULL,
    elapsed_s REAL NOT NULL,
    moving_s REAL NOT NULL,
    distance_m REAL NOT NULL,
    time_at_bpm TEXT,
    derive_version INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS activity_file (
    activity_id INTEGER NOT NULL REFERENCES activity(id) ON DELETE CASCADE,
    format TEXT NOT NULL,
    file_gz BLOB NOT NULL
  );
`;

export async function withStore<T>(path: string, use: (store: Store) => Promise<T>): Promise<T> {
  const db = new Database(path);
  try {
    db.run("PRAGMA foreign_keys = ON");
    db.run(SCHEMA);
    const insertActivity = db.query(
      `INSERT INTO activity (strava_id, source, start_utc, type, title, tags, elapsed_s, moving_s, distance_m)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    );
    const insertFile = db.query("INSERT INTO activity_file (activity_id, format, file_gz) VALUES (?, ?, ?)");
    const saveDerived = db.query("UPDATE activity SET time_at_bpm = ?, derive_version = ? WHERE id = ?");
    return await use({
      insertAll: db.transaction((activities: NewActivity[]) => {
        for (const a of activities) {
          const { id } = insertActivity.get(
            a.stravaId, a.source, a.startUtc, a.type, a.title, a.tags, a.elapsedS, a.movingS, a.distanceM,
          ) as { id: number };
          if (a.file) insertFile.run(id, a.file.format, a.file.gz);
        }
      }),
      activities: () =>
        (
          db
            .query(
              `SELECT start_utc AS startUtc, type, title, distance_m AS distanceM, moving_s AS movingS,
                      time_at_bpm AS timeAtBpm
               FROM activity ORDER BY start_utc DESC`,
            )
            .all() as (Omit<StoredActivity, "timeAtBpm"> & { timeAtBpm: string | null })[]
        ).map((a) => ({ ...a, timeAtBpm: a.timeAtBpm === null ? null : JSON.parse(a.timeAtBpm) })),
      staleFiles: (version) =>
        db
          .query(
            `SELECT activity.id, start_utc AS startUtc, format, file_gz AS gz
             FROM activity JOIN activity_file ON activity_id = activity.id
             WHERE derive_version < ?`,
          )
          .all(version) as StaleFile[],
      saveDerived: (id, timeAtBpm, version) => {
        saveDerived.run(timeAtBpm && JSON.stringify(timeAtBpm), version, id);
      },
    });
  } finally {
    db.close();
  }
}
