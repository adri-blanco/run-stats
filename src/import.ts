import { parse } from "csv-parse/sync";
import { gzipSync, unzipSync, type Unzipped } from "fflate";
import { readFileSync } from "node:fs";
import { errorMessage } from "./errors";
import type { ActivityType, NewActivity, Store, StoredActivity } from "./store";

const COLUMN = { id: 0, start: 1, title: 2, type: 3, file: 12, elapsed: 15, moving: 16, distance: 17, tags: 103 };
const SAME_ACTIVITY_MS = 60_000;
const POLAR_EXERCISES = "https://www.polaraccesslink.com/v3/exercises";
const SPANISH_MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
const ACTIVITY_TYPES: Record<string, ActivityType> = {
  Carrera: "run",
  "Entrenamiento con pesas": "strength",
  Entrenamiento: "workout",
  Senderismo: "hike",
  Natación: "swim",
  Kayak: "kayak",
  Fútbol: "football",
};

// Assumed names, which #29 checks live. A wrong guess stays visible, as other and printed.
const POLAR_SPORTS: Record<string, ActivityType> = {
  RUNNING: "run",
  ROAD_RUNNING: "run",
  TRAIL_RUNNING: "run",
  TREADMILL_RUNNING: "run",
  HIKING: "hike",
  STRENGTH_TRAINING: "strength",
  SWIMMING: "swim",
  WATERSPORTS_KAYAKING: "kayak",
  FOOTBALL: "football",
};

const sameActivity = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) <= SAME_ACTIVITY_MS;

function startUtc(cell: string): string {
  const m = cell.match(/^(\d+) (\p{L}+)\.?,? (\d{4}), (\d+):(\d+):(\d+)$/u);
  const month = SPANISH_MONTHS.indexOf(m?.[2] ?? "");
  if (!m || month < 0) throw new Error(`Unreadable date in activities.csv: "${cell}"`);
  return new Date(Date.UTC(+m[3]!, month, +m[1]!, +m[4]!, +m[5]!, +m[6]!)).toISOString();
}

// Number("") is 0, which is what the spec wants for an empty cell.
function number(cell: string): number {
  const value = Number(cell.includes(",") ? cell.replaceAll(".", "").replace(",", ".") : cell);
  if (Number.isNaN(value)) throw new Error(`Unreadable number in activities.csv: "${cell}"`);
  return value;
}

function originalFile(zip: Unzipped, id: string, name: string, log: (line: string) => void): NewActivity["file"] {
  const bytes = zip[name];
  const format = name.match(/\.(gpx|tcx|fit)(\.gz)?$/);
  if (!bytes || !format) {
    log(`Warning: no file for activity ${id}: ${name ? `${name} not found in the zip or not a known format` : "none listed in activities.csv"}`);
    return null;
  }
  return { format: format[1]!, gz: format[2] ? bytes : gzipSync(bytes) };
}

function readZip(zipPath: string): Unzipped {
  try {
    return unzipSync(readFileSync(zipPath));
  } catch (error) {
    throw new Error(`Unreadable zip ${zipPath}: ${errorMessage(error)}`);
  }
}

export function readBulkExport(zipPath: string, log: (line: string) => void): NewActivity[] {
  const zip = readZip(zipPath);
  const csv = zip["activities.csv"];
  if (!csv) throw new Error("No activities.csv in the zip");
  // Read by index: the header row repeats names, so it carries no information.
  const rows: string[][] = parse(Buffer.from(csv), { bom: true, from_line: 2 });
  return rows.map((row) => {
    const stravaType = row[COLUMN.type]!;
    const type = ACTIVITY_TYPES[stravaType];
    if (!type) log(`Unknown Activity type "${stravaType}" on activity ${row[COLUMN.id]}, stored as other`);
    return {
      stravaId: row[COLUMN.id]!,
      source: "strava",
      startUtc: startUtc(row[COLUMN.start]!),
      type: type ?? "other",
      title: row[COLUMN.title]!,
      tags: row[COLUMN.tags]!,
      elapsedS: number(row[COLUMN.elapsed]!),
      movingS: number(row[COLUMN.moving]!),
      distanceM: number(row[COLUMN.distance]!),
      file: originalFile(zip, row[COLUMN.id]!, row[COLUMN.file]!, log),
    };
  });
}

export type Polar = { fetch: (url: string, init?: RequestInit) => Promise<Response>; token: string };

type PolarExercise = {
  id: string;
  start_time: string;
  start_time_utc_offset: number;
  duration: string;
  distance?: number;
  sport: string;
  detailed_sport_info?: string;
};

async function polarGet(polar: Polar, url: string, accept: string): Promise<Response> {
  const response = await polar.fetch(url, { headers: { Authorization: `Bearer ${polar.token}`, Accept: accept } });
  if (response.status === 401 || response.status === 403) {
    throw new Error(`Polar refused POLAR_ACCESS_TOKEN (${response.status})`);
  }
  if (!response.ok) throw new Error(`Polar answered ${response.status} to ${url}`);
  return response;
}

// start_time is the watch's local time, with its offset from UTC in minutes.
function polarStartUtc({ id, start_time, start_time_utc_offset }: PolarExercise): string {
  const ms = Date.parse(`${start_time}Z`) - start_time_utc_offset * 60_000;
  if (Number.isNaN(ms)) throw new Error(`Unreadable start time on Polar exercise ${id}: "${start_time}", ${start_time_utc_offset}`);
  return new Date(ms).toISOString();
}

function polarSeconds({ id, duration }: PolarExercise): number {
  const m = String(duration).match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/);
  if (!m) throw new Error(`Unreadable duration on Polar exercise ${id}: "${duration}"`);
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

export async function readPolarExercises(polar: Polar, stored: StoredActivity[], log: (line: string) => void): Promise<NewActivity[]> {
  const exercises: PolarExercise[] = await (await polarGet(polar, POLAR_EXERCISES, "application/json")).json();
  const activities: NewActivity[] = [];
  for (const exercise of exercises) {
    const start = polarStartUtc(exercise);
    if (stored.some((row) => sameActivity(row.startUtc, start))) continue;
    const sport = exercise.detailed_sport_info ?? exercise.sport;
    const type = POLAR_SPORTS[sport];
    if (!type) log(`Unknown Polar sport "${sport}" on exercise ${exercise.id}, stored as other`);
    const seconds = polarSeconds(exercise);
    const fit = await polarGet(polar, `${POLAR_EXERCISES}/${exercise.id}/fit`, "*/*");
    activities.push({
      stravaId: null,
      source: "polar",
      startUtc: start,
      type: type ?? "other",
      title: null,
      tags: "",
      elapsedS: seconds,
      movingS: seconds,
      distanceM: exercise.distance ?? 0,
      file: { format: "fit", gz: gzipSync(new Uint8Array(await fit.arrayBuffer())) },
    });
  }
  return activities;
}

export function storeExport(store: Store, activities: NewActivity[]): { missing: StoredActivity[]; kept: StoredActivity[] } {
  const stored = store.activities();
  const newest = (rows: { startUtc: string }[]) => rows.map((row) => row.startUtc).sort().at(-1) ?? "";
  const newestStored = newest(stored.filter((row) => row.source === "strava"));
  // An empty export counts as older too, or it would delete everything.
  if (newest(activities) < newestStored) {
    throw new Error(`Refused: the zip's newest activity (${newest(activities) || "none"}) is older than the newest stored one (${newestStored})`);
  }

  // strava_id first, so a start-time match can't take a row that another export row owns.
  const stravaIds = new Set(activities.map((a) => a.stravaId));
  const byStravaId = new Map(stored.map((row) => [row.stravaId, row]));
  const unmatched = stored.filter((row) => !stravaIds.has(row.stravaId!));
  const toStore = activities.map((a) => {
    let row = byStravaId.get(a.stravaId);
    if (!row) {
      const match = unmatched.findIndex((candidate) => sameActivity(candidate.startUtc, a.startUtc));
      if (match >= 0) row = unmatched.splice(match, 1)[0];
    }
    // Re-inserted, so derive restores its values. An adopted Provisional row loses its Polar file instead.
    return !a.file && row?.source === "strava" ? { ...a, file: store.file(row.id) } : a;
  });
  const missing = unmatched.filter((row) => row.source === "strava");

  // Removing cascades to files and derived rows, so an overwrite can't keep stale ones.
  store.remove(stored.filter((row) => !unmatched.includes(row)).concat(missing).map((row) => row.id));
  store.insertAll(toStore);
  return { missing, kept: unmatched.filter((row) => row.source === "polar") };
}
