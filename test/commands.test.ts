import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Encoder, Profile } from "@garmin/fitsdk";
import { gunzipSync, gzipSync, zipSync } from "fflate";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate, importExport, refresh } from "../src/commands";

const COLUMNS = 104;
const VALID_SETTINGS = {
  timeZone: "Europe/Madrid",
  hrZones: [100, 120, 140, 160, 180],
  firstBarrierSeconds: { "1K": [300, 270, 240], "5K": [1800, 1650, 1500], "10K": [3600, 3300, 3000] },
};

type Row = { id?: string; date?: string; title?: string; type?: string; file?: string; elapsed?: string; moving?: string; distance?: string; tags?: string };

function csvRow(row: Row): string {
  const cells = Array<string>(COLUMNS).fill("");
  cells[0] = row.id ?? "1";
  cells[1] = row.date ?? "4 nov 2026, 18:11:23";
  cells[2] = row.title ?? "Morning run";
  cells[3] = row.type ?? "Carrera";
  cells[12] = row.file ?? "";
  cells[15] = row.elapsed ?? "2577.0";
  cells[16] = row.moving ?? "2515.0";
  cells[17] = row.distance ?? "6062.6";
  cells[103] = row.tags ?? "running";
  return cells.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",");
}

function exportZip(rows: Row[], files: Record<string, Uint8Array> = {}): Uint8Array {
  // Bulk export headers repeat, so the header row must not be needed to find a column.
  const header = Array(COLUMNS).fill("Distancia").join(",");
  const csv = [header, ...rows.map(csvRow)].join("\n");
  return zipSync({ "activities.csv": new TextEncoder().encode(csv), ...files });
}

// m is the distance covered so far: the watch's own figure in TCX and FIT, coordinates in GPX.
type Point = { at: number; bpm?: number; m?: number };

const START = Date.UTC(2026, 10, 4, 18);
const isoAt = (seconds: number) => new Date(START + seconds * 1000).toISOString();
const hrTag = (bpm?: number) => (bpm === undefined ? "" : `<HeartRateBpm><Value>${bpm}</Value></HeartRateBpm>`);
const distanceTag = (m?: number) => (m === undefined ? "" : `<DistanceMeters>${m}</DistanceMeters>`);
const METRES_PER_DEGREE = 111_194.93;

function tcx(points: Point[]): Uint8Array {
  const trackpoints = points.map((p) => `<Trackpoint><Time>${isoAt(p.at)}</Time>${distanceTag(p.m)}${hrTag(p.bpm)}</Trackpoint>`);
  return gzipSync(
    new TextEncoder().encode(
      `<?xml version="1.0"?><TrainingCenterDatabase><Activities><Activity Sport="Running"><Lap><Track>${trackpoints.join("")}</Track></Lap></Activity></Activities></TrainingCenterDatabase>`,
    ),
  );
}

function gpx(points: Point[]): Uint8Array {
  const hr = (bpm?: number) =>
    bpm === undefined
      ? ""
      : `<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${bpm}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>`;
  const trackpoints = points.map((p) => `<trkpt lat="${42.9 + (p.m ?? 0) / METRES_PER_DEGREE}" lon="-8.3"><time>${isoAt(p.at)}</time>${hr(p.bpm)}</trkpt>`);
  return new TextEncoder().encode(
    `<?xml version="1.0"?><gpx xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"><trk><trkseg>${trackpoints.join("")}</trkseg></trk></gpx>`,
  );
}

function fit(points: Point[]): Uint8Array {
  const encoder = new Encoder();
  encoder.writeMesg({ mesgNum: Profile.MesgNum.FILE_ID!, type: "activity", manufacturer: "garmin", product: 1, timeCreated: new Date(START) } as any);
  for (const p of points) {
    encoder.writeMesg({ mesgNum: Profile.MesgNum.RECORD!, timestamp: new Date(START + p.at * 1000), heartRate: p.bpm, distance: p.m } as any);
  }
  return gzipSync(encoder.close());
}

let dir: string;
let lines: string[];

function deps() {
  return {
    dbPath: join(dir, "test.sqlite"),
    outPath: join(dir, "out", "dashboard.html"),
    settingsPath: join(dir, "settings.json"),
    now: () => new Date("2026-11-06T10:00:00Z"),
    log: (line: string) => void lines.push(line),
  };
}

function writeZip(zip: Uint8Array): string {
  const path = join(dir, `export-${crypto.randomUUID()}.zip`);
  writeFileSync(path, zip);
  return path;
}

async function imported(rows: Row[], files?: Record<string, Uint8Array>) {
  const status = await importExport(writeZip(exportZip(rows, files)), deps());
  if (!status.ok) throw new Error(status.error);
  return status.data;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "run-stats-"));
  lines = [];
  writeFileSync(join(dir, "settings.json"), JSON.stringify(VALID_SETTINGS));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

// The assumed AccessLink v3 shape, in this one place. #29 checks it against the real API.
function polarExercise(fields: Record<string, unknown> = {}) {
  return {
    id: "2AC312F",
    start_time: "2026-11-05T09:00:00",
    start_time_utc_offset: 60,
    duration: "PT1H2M3S",
    distance: 12000.5,
    sport: "RUNNING",
    detailed_sport_info: "RUNNING",
    ...fields,
  };
}

const POLAR_POINTS = [{ at: 0, bpm: 100, m: 0 }, { at: 5, bpm: 120, m: 600 }, { at: 10, bpm: 140, m: 1200 }];
const POLAR_API = "https://www.polaraccesslink.com/v3/exercises";

type PolarOptions = { fitBody?: string; respond?: (url: string) => Response | undefined; requests?: string[] };

function polarDeps(exercises: unknown[], { fitBody, respond, requests }: PolarOptions = {}) {
  return {
    ...deps(),
    polarToken: "fake-token",
    fetch: async (url: string, init?: RequestInit) => {
      if (new Headers(init?.headers).get("Authorization") !== "Bearer fake-token") return new Response(null, { status: 401 });
      requests?.push(url);
      const response = respond?.(url);
      if (response) return response;
      if (url === POLAR_API) return Response.json(exercises);
      return new Response(fitBody ?? Buffer.from(gunzipSync(fit(POLAR_POINTS))));
    },
  };
}

async function refreshed(exercises: unknown[], options?: PolarOptions) {
  const status = await refresh(polarDeps(exercises, options));
  if (!status.ok) throw new Error(status.error);
  return status.data;
}

describe("refresh", () => {
  test("stores a new exercise as a Provisional activity, with heart rate and best efforts from its FIT file", async () => {
    const requests: string[] = [];
    const data = await refreshed([polarExercise()], { requests });

    expect(data.activities).toEqual([
      {
        stravaId: null,
        date: "2026-11-05",
        title: null,
        type: "run",
        distanceM: 12000.5,
        movingS: 3723,
        stoppedS: 0,
        paceSPerKm: 3723 / 12.0005,
        avgHr: 110,
        maxHr: 120,
        race: false,
        longRun: true,
        sessionType: null,
        sessionDetail: null,
      },
    ]);
    expect(data.allTime.best1k).toBe(10);
    expect(data.meta.awaitingStrava).toBe(1);
    expect(requests).toEqual([POLAR_API, `${POLAR_API}/2AC312F/fit`]);
  });

  test("uses the UTC offset only to find the start, and groups by the settings time zone", async () => {
    const data = await refreshed([polarExercise({ start_time: "2026-11-05T22:00:00", start_time_utc_offset: -300 })]);
    expect(data.activities[0]!.date).toBe("2026-11-06");
  });

  test("skips an exercise within 60 s of a stored activity, and adds one just outside", async () => {
    await imported([{ date: "5 nov 2026, 8:00:30", title: "On Strava" }]);
    const data = await refreshed([
      polarExercise({ id: "near", start_time: "2026-11-05T08:59:30" }),
      polarExercise({ id: "far", start_time: "2026-11-05T08:59:29" }),
    ]);
    expect(data.activities.map((a) => a.title)).toEqual(["On Strava", null]);
    expect(lines).toContain("Added 1 Provisional activities");
  });

  test("a second refresh adds nothing, and the page is still regenerated", async () => {
    await refreshed([polarExercise()]);
    rmSync(deps().outPath);
    const data = await refreshed([polarExercise()]);
    expect(data.activities).toHaveLength(1);
    expect(await Bun.file(deps().outPath).exists()).toBe(true);
  });

  test("Long run comes from distance, and Provisional runs have no Race mark or Session type", async () => {
    const data = await refreshed([
      polarExercise({ id: "short", distance: 9000 }),
      polarExercise({ id: "hike", start_time: "2026-11-04T09:00:00", detailed_sport_info: "HIKING" }),
    ]);
    expect(data.activities.map((a) => [a.type, a.longRun, a.race, a.sessionType])).toEqual([
      ["run", false, false, null],
      ["hike", false, false, null],
    ]);
    expect(data.meta.awaitingStrava).toBe(2);
  });

  test("an unknown Polar sport becomes other and is printed", async () => {
    const data = await refreshed([polarExercise({ sport: "OTHER", detailed_sport_info: "WATERSPORTS_WATERSKI" })]);
    expect(data.activities[0]!.type).toBe("other");
    expect(lines).toContain(`Unknown Polar sport "WATERSPORTS_WATERSKI" on exercise 2AC312F, stored as other`);
  });

  test("an exercise with no distance is stored with 0", async () => {
    const { distance, ...gym } = polarExercise({ detailed_sport_info: "STRENGTH_TRAINING" });
    const data = await refreshed([gym]);
    expect(data.activities[0]).toMatchObject({ type: "strength", distanceM: 0 });
  });

  test("warns when the newest stored activity is over 30 days old", async () => {
    await imported([{ date: "7 oct 2026, 9:59:59" }]);
    await refreshed([]);
    expect(lines.join("\n")).toContain("Warning: the newest stored activity is over 30 days old");
  });

  test("doesn't warn at exactly 30 days, or on an empty store", async () => {
    await refreshed([]);
    await imported([{ date: "7 oct 2026, 10:00:00" }]);
    await refreshed([]);
    expect(lines.join("\n")).not.toContain("30 days");
  });

  test("a missing POLAR_ACCESS_TOKEN aborts with a clear message and calls nothing", async () => {
    const requests: string[] = [];
    const status = await refresh({ ...polarDeps([], { requests }), polarToken: undefined });
    expect(status).toEqual({ ok: false, error: expect.stringContaining("POLAR_ACCESS_TOKEN") });
    expect(requests).toEqual([]);
  });

  test("an auth failure partway through aborts and stores nothing", async () => {
    await imported([{ title: "Kept" }]);
    const status = await refresh(
      polarDeps(
        [polarExercise({ id: "first" }), polarExercise({ id: "second", start_time: "2026-11-04T09:00:00" })],
        { respond: (url) => (url.includes("second") ? new Response(null, { status: 403 }) : undefined) },
      ),
    );
    expect(status).toEqual({ ok: false, error: expect.stringContaining("403") });
    const after = await generate(deps());
    expect(after.ok && after.data.activities.map((a) => a.title)).toEqual(["Kept"]);
  });

  test("any other failed Polar request aborts too", async () => {
    const status = await refresh(polarDeps([], { respond: () => new Response(null, { status: 500 }) }));
    expect(status).toEqual({ ok: false, error: expect.stringContaining("500") });
  });

  test("rolls back when the page can't be written", async () => {
    mkdirSync(deps().outPath, { recursive: true });
    const status = await refresh(polarDeps([polarExercise()]));
    expect(status.ok).toBe(false);
    rmSync(deps().outPath, { recursive: true });
    const after = await generate(deps());
    expect(after.ok && after.data.activities).toEqual([]);
  });

  test("an exercise that doesn't have the assumed shape aborts rather than storing wrong values", async () => {
    const badStart = await refresh(polarDeps([polarExercise({ start_time: "2026-11-05T09:00:00Z" })]));
    expect(badStart).toEqual({ ok: false, error: expect.stringContaining("start time") });
    const badDuration = await refresh(polarDeps([polarExercise({ duration: 3723 })]));
    expect(badDuration).toEqual({ ok: false, error: expect.stringContaining("duration") });
  });

  test("a corrupt FIT file keeps the summary, warns, and stays retryable", async () => {
    const data = await refreshed([polarExercise()], { fitBody: "not a fit file" });
    expect(data.activities[0]).toMatchObject({ distanceM: 12000.5, avgHr: null });
    expect(lines.join("\n")).toContain("Warning");

    lines.length = 0;
    await generate(deps());
    expect(lines.join("\n")).toContain("Warning");
  });

  test("a later Bulk export replaces a Provisional activity once", async () => {
    await refreshed([polarExercise()]);
    const data = await imported([{ date: "5 nov 2026, 8:00:30", title: "From Strava" }]);
    expect(data.activities.map((a) => a.title)).toEqual(["From Strava"]);
    expect(data.meta.awaitingStrava).toBe(0);
  });
});

describe("importExport", () => {
  test("stores an activity from a Bulk export and returns it in the DashboardData", async () => {
    const data = await imported([{ title: "Correr por correr" }]);
    expect(data.activities).toEqual([
      {
        stravaId: "1",
        date: "2026-11-04",
        title: "Correr por correr",
        type: "run",
        distanceM: 6062.6,
        movingS: 2515,
        stoppedS: 62,
        paceSPerKm: 414.838518127536, // 6:55 /km
        avgHr: null,
        maxHr: null,
        race: false,
        longRun: false,
        sessionType: null,
        sessionDetail: null,
      },
    ]);
  });

  test("gives a pace from moving time to runs with a distance only", async () => {
    const data = await imported([
      { id: "1", date: "3 nov 2026, 18:00:00", moving: "1500", distance: "5000" },
      { id: "2", date: "2 nov 2026, 18:00:00", distance: "0" },
      { id: "3", date: "1 nov 2026, 18:00:00", type: "Senderismo", moving: "3600", distance: "5000" },
    ]);
    expect(data.activities.map((a) => a.paceSPerKm)).toEqual([300, null, null]);
  });

  test.each([
    ["Carrera", "run"],
    ["Entrenamiento con pesas", "strength"],
    ["Entrenamiento", "workout"],
    ["Senderismo", "hike"],
    ["Natación", "swim"],
    ["Kayak", "kayak"],
    ["Fútbol", "football"],
  ])("maps the Activity type %s to %s", async (strava, type) => {
    const data = await imported([{ type: strava }]);
    expect<string>(data.activities[0]!.type).toBe(type);
    expect(lines.join("\n")).not.toContain(strava);
  });

  test("stores an unknown Activity type as other and prints it", async () => {
    const data = await imported([{ type: "Yoga" }]);
    expect(data.activities[0]!.type).toBe("other");
    expect(lines.join("\n")).toContain("Yoga");
  });

  test("reads Spanish month names, including sept", async () => {
    const data = await imported([{ date: "2 sept 2025, 09:00:00" }]);
    expect(data.activities[0]!.date).toBe("2025-09-02");
  });

  test("reads CSV dates as UTC and shows them on the local date of the settings time zone", async () => {
    const data = await imported([{ date: "31 dic 2025, 23:30:00" }]);
    expect(data.activities[0]!.date).toBe("2026-01-01");
  });

  test("keeps a quoted newline inside a title", async () => {
    const data = await imported([{ title: "Line one\nLine two" }, { id: "2", title: "Next" }]);
    expect(data.activities.map((a) => a.title).sort()).toEqual(["Line one\nLine two", "Next"]);
  });

  test("reads comma decimals, with or without thousands dots", async () => {
    const data = await imported([{ distance: "6.062,6", moving: "2515,5" }]);
    expect(data.activities[0]).toMatchObject({ distanceM: 6062.6, movingS: 2515.5 });
  });

  test("turns empty numeric cells into 0", async () => {
    const data = await imported([{ distance: "", moving: "" }]);
    expect(data.activities[0]).toMatchObject({ distanceM: 0, movingS: 0 });
  });

  test("lists activities newest first", async () => {
    const data = await imported([
      { id: "1", date: "1 ene 2025, 10:00:00", title: "Old" },
      { id: "2", date: "1 feb 2025, 10:00:00", title: "New" },
    ]);
    expect(data.activities.map((a) => a.title)).toEqual(["New", "Old"]);
    expect(data.meta.newestActivity).toBe("2025-02-01");
  });

  test("keeps the original file of each format and reports the count", async () => {
    await imported(
      [
        { id: "1", file: "activities/1.gpx" },
        { id: "2", file: "activities/2.tcx.gz" },
        { id: "3", file: "activities/3.fit.gz" },
        { id: "4", file: "" },
      ],
      {
        "activities/1.gpx": new TextEncoder().encode("<gpx/>"),
        "activities/2.tcx.gz": gzipSync(new TextEncoder().encode("<tcx/>")),
        "activities/3.fit.gz": gzipSync(new Uint8Array([1, 2, 3])),
      },
    );
    expect(lines).toContain("Imported 4 activities and 3 files");
  });

  test("keeps the summary and warns when a listed file is not in the zip", async () => {
    const data = await imported([{ file: "activities/9.gpx" }]);
    expect(data.activities).toHaveLength(1);
    expect(lines.join("\n")).toContain("activities/9.gpx");
  });

  test.each([
    ["an unreadable zip", () => new TextEncoder().encode("not a zip")],
    ["a zip with no activities.csv", () => zipSync({ "other.csv": new Uint8Array(1) })],
    ["an unreadable date", () => exportZip([{ id: "2", date: "soon" }])],
    ["an unreadable number", () => exportZip([{ id: "2", distance: "far" }])],
    ["a row that fails part-way through storing", () => exportZip([{ id: "2" }, { id: "3" }, { id: "2" }])],
  ])("aborts on %s and leaves the database and page unchanged", async (_, zip) => {
    await imported([{ id: "1", title: "Kept" }]);
    const page = await Bun.file(deps().outPath).text();

    const status = await importExport(writeZip(zip()), deps());

    expect(status.ok).toBe(false);
    expect(await Bun.file(deps().outPath).text()).toBe(page);
    const after = await generate(deps());
    expect(after.ok && after.data.activities.map((a) => a.title)).toEqual(["Kept"]);
  });
});

describe("heart rate from activity files", () => {
  const importedFile = async (name: string, bytes: Uint8Array) =>
    (await imported([{ file: name }], { [name]: bytes })).activities[0]!;

  test("each sample counts until the next, capped at 10 s, and average and max come from that", async () => {
    const points = [{ at: 0, bpm: 100 }, { at: 4, bpm: 120 }, { at: 34, bpm: 140 }, { at: 35, bpm: 140 }];
    // 100 for 4 s, 120 for a capped 10 s, 140 for 1 s; the last sample has no next.
    expect(await importedFile("activities/1.tcx.gz", tcx(points))).toMatchObject({ avgHr: 116, maxHr: 140 });
  });

  test.each([
    ["GPX", "activities/1.gpx", gpx],
    ["FIT", "activities/1.fit.gz", fit],
  ])("reads heart rate from a %s file", async (_, name, encode) => {
    const points = [{ at: 0, bpm: 100 }, { at: 4, bpm: 120 }, { at: 34, bpm: 140 }, { at: 35, bpm: 140 }];
    expect(await importedFile(name, encode(points))).toMatchObject({ avgHr: 116, maxHr: 140 });
    expect(lines.join("\n")).not.toContain("Warning");
  });

  test("samples with no heart rate or a zero reading count for nothing", async () => {
    const points = [{ at: 0, bpm: 100 }, { at: 1 }, { at: 2, bpm: 0 }, { at: 3, bpm: 130 }, { at: 5, bpm: 130 }];
    expect(await importedFile("activities/1.tcx.gz", tcx(points))).toMatchObject({ avgHr: 112, maxHr: 130 });
  });

  test("a file with no heart rate leaves average and max empty, with no warning", async () => {
    const activity = await importedFile("activities/1.tcx.gz", tcx([{ at: 0 }, { at: 1 }]));
    expect(activity).toMatchObject({ avgHr: null, maxHr: null });
    expect(lines.join("\n")).not.toContain("Warning");
  });
});

describe("best efforts", () => {
  const run = (points: Point[], name = "activities/1.tcx.gz", file = tcx(points), row: Row = {}) =>
    imported([{ file: name, ...row }], { [name]: file });

  test("each distance takes the shortest time between two samples at least that far apart", async () => {
    const data = await run([{ at: 0, m: 0 }, { at: 300, m: 1000 }, { at: 500, m: 2000 }, { at: 1000, m: 3000 }, { at: 1800, m: 7000 }, { at: 3000, m: 12000 }]);
    expect(data.allTime).toMatchObject({ best1k: 200, best5k: 1200, best10k: 2500 });
  });

  test("a stop inside the stretch counts", async () => {
    const data = await run([{ at: 0, m: 0 }, { at: 150, m: 500 }, { at: 750, m: 500 }, { at: 900, m: 1000 }]);
    expect(data.allTime.best1k).toBe(900);
  });

  test("uses the next sample past the target, with no interpolation", async () => {
    const data = await run([{ at: 0, m: 0 }, { at: 100, m: 900 }, { at: 200, m: 1100 }]);
    expect(data.allTime.best1k).toBe(200);
  });

  test.each([
    ["the only sample", [{ at: 0, bpm: 120, m: 500 }]],
    ["one of several", [{ at: 0, bpm: 120 }, { at: 60, bpm: 130, m: 500 }, { at: 120, bpm: 140 }]],
  ])("a run with one distance sample, %s, imports without best efforts", async (_, points) => {
    const data = await run(points);
    expect(data.activities).toHaveLength(1);
    expect(data.allTime.best1k).toBeNull();
    expect(lines.join("\n")).not.toContain("Warning");
  });

  test.each([
    ["TCX, from the watch's distance", "activities/1.tcx.gz", tcx],
    ["FIT, from the watch's distance", "activities/1.fit.gz", fit],
    ["GPX, from coordinates", "activities/1.gpx", gpx],
  ])("%s", async (_, name, encode) => {
    const points = [{ at: 0, m: 0 }, { at: 300, m: 500 }, { at: 700, m: 1510 }, { at: 850, m: 1600 }];
    const data = await run(points, name, encode(points));
    expect(data.allTime.best1k).toBe(400);
  });

  test("GPX measures the coordinates, not the activity's summary distance", async () => {
    const points = [{ at: 0, m: 0 }, { at: 300, m: 900 }];
    const data = await run(points, "activities/1.gpx", gpx(points), { distance: "5000" });
    expect(data.allTime.best1k).toBeNull();
  });

  test("a run shorter than the target has no effort at that distance", async () => {
    const data = await run([{ at: 0, m: 0 }, { at: 300, m: 1000 }, { at: 1400, m: 4999 }]);
    expect(data.allTime).toMatchObject({ best1k: 300, best5k: null, best10k: null });
  });

  test("a run with no distance in its file has no effort, and no warning", async () => {
    const data = await run([{ at: 0, bpm: 100 }, { at: 400, bpm: 100 }]);
    expect(data.allTime.best1k).toBeNull();
    expect(lines.join("\n")).not.toContain("Warning");
  });

  test("samples missing a distance are skipped", async () => {
    const data = await run([{ at: 0, m: 0 }, { at: 100 }, { at: 400, m: 1000 }]);
    expect(data.allTime.best1k).toBe(400);
  });

  test("only runs have best efforts", async () => {
    const data = await run([{ at: 0, m: 0 }, { at: 300, m: 1000 }], undefined, undefined, { type: "Senderismo" });
    expect(data.allTime.best1k).toBeNull();
  });

  test("the all-time value is the best across runs, races included", async () => {
    const points = (at: number) => [{ at: 0, m: 0 }, { at, m: 1000 }];
    const data = await imported(
      [
        { id: "1", date: "1 nov 2026, 10:00:00", file: "activities/1.tcx.gz" },
        { id: "2", date: "2 nov 2026, 10:00:00", file: "activities/2.tcx.gz", tags: "race" },
        { id: "3", date: "3 nov 2026, 10:00:00", file: "activities/3.tcx.gz" },
      ],
      { "activities/1.tcx.gz": tcx(points(320)), "activities/2.tcx.gz": tcx(points(290)), "activities/3.tcx.gz": tcx(points(310)) },
    );
    expect(data.allTime.best1k).toBe(290);
  });
});

describe("periods", () => {
  const run = (id: string, date: string, distance: string, row: Row = {}): Row => ({ id, date: `${date}, 10:00:00`, distance, ...row });

  test.each([
    ["3w", "15 oct 2026", "14 oct 2026"],
    ["8w", "10 sept 2026", "9 sept 2026"],
    ["3m", "5 ago 2026", "4 ago 2026"],
    ["1y", "5 nov 2025", "4 nov 2025"],
  ] as const)("%s runs from %s, leaving out %s", async (period, inside, outside) => {
    const data = await imported([run("1", "4 nov 2026", "5000"), run("2", inside, "12000"), run("3", outside, "15000")]);
    expect(data.currentLevel[period]).toMatchObject({ longestRun: { distanceM: 12000 }, longRuns: 1 });
  });

  test("all starts at the first activity", async () => {
    const data = await imported([run("1", "4 nov 2026", "5000"), run("2", "15 ene 2022", "15000")]);
    expect(data.currentLevel.all).toMatchObject({ longestRun: { distanceM: 15000 }, longRuns: 1 });
  });

  test("a period ends on the newest activity of any type, not the newest run", async () => {
    const data = await imported([run("1", "4 nov 2026", "0", { type: "Senderismo" }), run("2", "14 oct 2026", "12000")]);
    expect(data.currentLevel["3w"]).toMatchObject({ longestRun: null, longRuns: 0 });
  });

  test("a period ends on the local date of the newest activity, using timeZone", async () => {
    const data = await imported([
      { id: "1", date: "31 oct 2026, 23:30:00", distance: "5000" }, // already 1 November in Madrid
      { id: "2", date: "11 oct 2026, 20:00:00", distance: "12000" },
    ]);
    expect(data.currentLevel["3w"].longestRun?.distanceM).toBe(5000);
  });

  test.each([
    ["3m", "31 may 2026", "1 mar 2026", "28 feb 2026"],
    ["1y", "29 feb 2024", "1 mar 2023", "28 feb 2023"],
  ] as const)("%s counts back calendar months from %s, on a date the start month lacks", async (period, end, inside, outside) => {
    const data = await imported([run("1", end, "5000"), run("2", inside, "12000"), run("3", outside, "15000")]);
    expect(data.currentLevel[period]).toMatchObject({ longestRun: { distanceM: 12000 }, longRuns: 1 });
  });

  test("best efforts follow the period, with the all-time value alongside", async () => {
    const effort = (at: number) => tcx([{ at: 0, m: 0 }, { at, m: 1000 }]);
    const data = await imported(
      [
        { id: "1", date: "4 nov 2026, 10:00:00", file: "activities/1.tcx.gz" },
        { id: "2", date: "4 ene 2026, 10:00:00", file: "activities/2.tcx.gz" },
      ],
      { "activities/1.tcx.gz": effort(300), "activities/2.tcx.gz": effort(250) },
    );
    expect(data.currentLevel["8w"].best1k).toBe(300);
    expect(data.allTime.best1k).toBe(250);
  });

  test("the period and all-time longest run and Long runs count runs only", async () => {
    const data = await imported([run("1", "4 nov 2026", "5000"), run("2", "3 nov 2026", "30000", { type: "Senderismo" })]);
    expect(data.currentLevel["8w"]).toMatchObject({ longestRun: { distanceM: 5000 }, longRuns: 0 });
    expect(data.allTime.longestRun?.distanceM).toBe(5000);
  });

  test("weeks with a Long run count 7-day blocks back from the end, not calendar weeks", async () => {
    const data = await imported([
      run("1", "4 nov 2026", "10000"),
      run("2", "29 oct 2026", "10000"), // same block as the 4th, and the same Monday-to-Sunday week as the 28th
      run("3", "28 oct 2026", "10000"),
      run("4", "21 oct 2026", "9999"),
    ]);
    expect(data.currentLevel["8w"]).toMatchObject({ longRuns: 3, weeksWithLongRun: 2 });
  });

  test("a period is as many weeks as its 7-day blocks, counting a part block", async () => {
    const data = await imported([run("1", "4 nov 2026", "5000"), run("2", "4 nov 2025", "5000")]);
    expect(data.currentLevel["3w"].weeks).toBe(3);
    expect(data.currentLevel["8w"].weeks).toBe(8);
    expect(data.currentLevel["3m"].weeks).toBe(14); // 92 days
    expect(data.currentLevel["1y"].weeks).toBe(53); // 365 days
    expect(data.currentLevel.all.weeks).toBe(53); // 366 days
  });

  test("a period with no runs is empty", async () => {
    const data = await imported([run("1", "4 nov 2026", "0", { type: "Senderismo" })]);
    expect(data.currentLevel["8w"]).toMatchObject({
      best1k: null,
      best5k: null,
      best10k: null,
      longestRun: null,
      longRuns: 0,
      weeks: 8,
      weeksWithLongRun: 0,
      weeklyDistanceM: 0,
      weeklyDistanceChangePct: null,
      totalDistanceM: 0,
      timeRunningS: 0,
      runs: 0,
      runsPerWeek: 0,
      crossTrainingPerWeek: 0.125,
    });
  });

  test("the Longest run follows the period and carries its details", async () => {
    const data = await imported([
      run("1", "4 nov 2026", "8000", { title: "Recent long", elapsed: "2500", moving: "2400" }),
      run("2", "4 nov 2024", "15000", { title: "Old long" }),
    ]);
    expect(data.currentLevel["8w"].longestRun).toMatchObject({ stravaId: "1", title: "Recent long", date: "2026-11-04", movingS: 2400, paceSPerKm: 300, stoppedS: 100 });
    expect(data.currentLevel.all.longestRun?.title).toBe("Old long");
  });

  test("the Longest run is the newest of equal runs", async () => {
    const data = await imported([run("1", "4 nov 2026", "8000", { title: "Newest" }), run("2", "3 nov 2026", "8000")]);
    expect(data.currentLevel["8w"].longestRun?.title).toBe("Newest");
  });

  test("Recent activities are the newest 8 of any type, newest first", async () => {
    const days = ["4", "3", "2", "1"].flatMap((day) => [`${day} nov 2026`, `${day} oct 2026`, `${day} sept 2026`]);
    const rows = days.map((date, i) => run(String(i + 1), date, "5000", { type: i % 2 ? "Senderismo" : "Carrera" }));
    const { currentLevel, activities } = await imported(rows);
    expect(currentLevel["1y"].recent).toEqual(activities.slice(0, 8));
    expect(new Set(currentLevel["1y"].recent.map((a) => a.type))).toEqual(new Set(["run", "hike"]));
  });

  test("Recent activities stay inside the period", async () => {
    const data = await imported([run("1", "4 nov 2026", "5000"), run("2", "14 oct 2026", "5000", { type: "Senderismo" })]);
    expect(data.currentLevel["3w"].recent.map((a) => a.stravaId)).toEqual(["1"]);
    expect(data.currentLevel["8w"].recent.map((a) => a.stravaId)).toEqual(["1", "2"]);
  });

  test("a longer activity that isn't a run is not the Longest run", async () => {
    const data = await imported([run("1", "4 nov 2026", "8000"), run("2", "3 nov 2026", "20000", { type: "Senderismo" })]);
    expect(data.currentLevel["8w"].longestRun?.distanceM).toBe(8000);
  });
});

describe("race cards", () => {
  const race = (id: string, distance: string, row: Row = {}): Row => ({
    id,
    title: `Race ${id}`,
    date: `${Number(id)} oct 2026, 10:00:00`,
    tags: "race",
    distance,
    moving: "1500",
    ...row,
  });

  test.each([
    ["fastest5kRace", "4900"],
    ["fastest5kRace", "5600"],
    ["fastest7kRace", "6400"],
    ["fastest7kRace", "7700"],
    ["fastest10kRace", "9900"],
    ["fastest10kRace", "10500"],
  ] as const)("%s takes a race of %s m", async (card, distance) => {
    const data = await imported([race("1", distance)]);
    expect(data.allTime[card]?.title).toBe("Race 1");
  });

  test.each([
    ["4899"],
    ["5601"],
    ["6399"],
    ["7701"],
    ["9899"],
    ["10501"],
  ])("a race of %s m is outside every Race distance", async (distance) => {
    const data = await imported([race("1", distance)]);
    expect(data.allTime).toMatchObject({ fastest5kRace: null, fastest7kRace: null, fastest10kRace: null });
  });

  test("ranks by moving pace, not time, within a Race distance", async () => {
    const data = await imported([
      race("1", "4900", { title: "Quicker time", moving: "1470" }), // 5:00 /km
      race("2", "5600", { title: "Quicker pace", moving: "1540" }), // 4:35 /km
    ]);
    expect(data.allTime.fastest5kRace?.title).toBe("Quicker pace");
  });

  test("a faster race in another Race distance doesn't count", async () => {
    const data = await imported([
      race("1", "5000", { title: "5K", moving: "1000" }),
      race("2", "10000", { title: "10K", moving: "3000" }),
    ]);
    expect(data.allTime.fastest5kRace?.title).toBe("5K");
    expect(data.allTime.fastest10kRace?.title).toBe("10K");
  });

  test("a faster run that isn't a race doesn't count", async () => {
    const data = await imported([race("1", "5000"), race("2", "5000", { tags: "running", moving: "1000" })]);
    expect(data.allTime.fastest5kRace?.title).toBe("Race 1");
  });

  test("are all-time, ignoring the selected period", async () => {
    const data = await imported([{ id: "9", date: "4 nov 2026, 10:00:00" }, race("1", "5000", { date: "4 nov 2020, 10:00:00" })]);
    expect(data.allTime.fastest5kRace?.date).toBe("2020-11-04");
  });

  test("carry the date, distance, time, pace and time stopped", async () => {
    const data = await imported([race("7", "5000", { elapsed: "1590", moving: "1500" })]);
    expect(data.allTime.fastest5kRace).toMatchObject({
      stravaId: "7",
      title: "Race 7",
      date: "2026-10-07",
      distanceM: 5000,
      movingS: 1500,
      paceSPerKm: 300,
      stoppedS: 90,
    });
  });
});

describe("Volume", () => {
  const run = (id: string, date: string, distance: string, row: Row = {}): Row => ({ id, date: `${date}, 10:00:00`, distance, ...row });

  test.each([
    ["3w", 700, 2100, 1000], // 21 days
    ["8w", 262.5, 2100, 1000], // 56 days
    ["3m", 159.78261, 2100, 1000], // 92 days
    ["1y", 40.27397, 2100, 1000], // 365 days
    ["all", 154.91803, 8100, 7000], // 366 days
  ] as const)("%s divides by its length in days ÷ 7, with moving time", async (period, weekly, total, moving) => {
    const data = await imported([
      run("1", "4 nov 2026", "2100", { moving: "1000" }),
      run("2", "4 nov 2025", "6000", { moving: "6000" }),
    ]);
    expect(data.currentLevel[period].weeklyDistanceM).toBeCloseTo(weekly, 3);
    expect(data.currentLevel[period].totalDistanceM).toBe(total);
    expect(data.currentLevel[period].timeRunningS).toBe(moving);
  });

  test("counts runs and cross-training per week, cross-training being any non-run activity", async () => {
    const data = await imported([
      run("1", "4 nov 2026", "5000"),
      run("2", "3 nov 2026", "5000"),
      run("3", "2 nov 2026", "5000"),
      run("4", "1 nov 2026", "0", { type: "Entrenamiento con pesas" }),
      run("5", "31 oct 2026", "9000", { type: "Senderismo" }),
      run("6", "30 oct 2026", "0", { type: "Yoga" }),
      run("7", "14 oct 2026", "5000"), // the day before the 3-week period starts
      run("8", "13 oct 2026", "0", { type: "Natación" }),
    ]);
    expect(data.currentLevel["3w"]).toMatchObject({ runs: 3, runsPerWeek: 1, crossTrainingPerWeek: 1, totalDistanceM: 15_000 });
    expect(data.currentLevel["8w"]).toMatchObject({ runs: 4, runsPerWeek: 0.5, crossTrainingPerWeek: 0.5 });
  });
});

describe("previous-period change", () => {
  const run = (id: string, date: string, distance: string, row: Row = {}): Row => ({ id, date: `${date}, 10:00:00`, distance, ...row });

  test.each([
    ["3w", "4 nov 2026", "15 oct 2026", "14 oct 2026", "24 sept 2026", "23 sept 2026"],
    ["8w", "4 nov 2026", "10 sept 2026", "9 sept 2026", "16 jul 2026", "15 jul 2026"],
    ["3m", "31 may 2026", "1 mar 2026", "28 feb 2026", "29 nov 2025", "28 nov 2025"], // 92 days back, not to 1 December
    ["1y", "4 nov 2026", "5 nov 2025", "4 nov 2025", "5 nov 2024", "4 nov 2024"],
  ] as const)("%s compares with the same length just before it", async (period, end, first, lastBefore, firstBefore, tooEarly) => {
    const data = await imported([
      run("1", end, "6000"),
      run("2", first, "6000"),
      run("3", lastBefore, "4000"),
      run("4", firstBefore, "4000"),
      run("5", tooEarly, "50000"),
    ]);
    expect(data.currentLevel[period].weeklyDistanceChangePct).toBe(50);
  });

  test("can be a fall, and counts run distance only", async () => {
    const data = await imported([
      run("1", "4 nov 2026", "3000"),
      run("2", "3 nov 2026", "90000", { type: "Senderismo" }),
      run("3", "10 oct 2026", "4000"),
      run("4", "9 oct 2026", "90000", { type: "Senderismo" }),
    ]);
    expect(data.currentLevel["3w"].weeklyDistanceChangePct).toBe(-25);
  });

  test("is null on all", async () => {
    const data = await imported([run("1", "4 nov 2026", "5000"), run("2", "4 nov 2020", "5000")]);
    expect(data.currentLevel.all.weeklyDistanceChangePct).toBeNull();
  });

  test("is null when the period before has no run distance to compare with", async () => {
    const data = await imported([run("1", "4 nov 2026", "5000"), run("2", "10 oct 2026", "9000", { type: "Senderismo" })]);
    expect(data.currentLevel["3w"].weeklyDistanceChangePct).toBeNull();
  });
});

describe("streaks", () => {
  const run = (id: string, date: string, row: Row = {}): Row => ({ id, date: `${date}, 10:00:00`, ...row });
  const hike = (id: string, date: string): Row => run(id, date, { type: "Senderismo" });

  test("counts consecutive weeks, ending the current one at the newest activity's week", async () => {
    const data = await imported([
      run("1", "4 nov 2026"),
      run("2", "27 oct 2026"),
      run("3", "6 oct 2026"), // a week with no activity comes after this one
      run("4", "29 sept 2026"),
      run("5", "22 sept 2026"),
    ]);
    expect(data.streaks.runs).toEqual({ current: 2, longest: 3 });
  });

  test("weeks run Monday to Sunday", async () => {
    const sameWeek = await imported([run("1", "1 nov 2026"), run("2", "26 oct 2026")]);
    expect(sameWeek.streaks.runs).toEqual({ current: 1, longest: 1 });
    const nextWeek = await imported([run("1", "2 nov 2026"), run("2", "1 nov 2026")]);
    expect(nextWeek.streaks.runs).toEqual({ current: 2, longest: 2 });
  });

  test("weeks use timeZone, not UTC", async () => {
    const data = await imported([
      { id: "1", date: "1 nov 2026, 23:30:00" }, // Sunday in UTC, already Monday in Madrid
      { id: "2", date: "26 oct 2026, 10:00:00" },
    ]);
    expect(data.streaks.runs).toEqual({ current: 2, longest: 2 });
  });

  test("the any-activity basis counts every Activity type, the runs basis only runs", async () => {
    const data = await imported([run("1", "4 nov 2026"), hike("2", "27 oct 2026"), run("3", "20 oct 2026")]);
    expect(data.streaks.all).toEqual({ current: 3, longest: 3 });
    expect(data.streaks.runs).toEqual({ current: 1, longest: 1 });
  });

  test("the runs basis ends at the newest activity of any type, so a week with only a hike breaks it", async () => {
    const data = await imported([hike("1", "4 nov 2026"), run("2", "27 oct 2026"), run("3", "20 oct 2026")]);
    expect(data.streaks.runs).toEqual({ current: 0, longest: 2 });
    expect(data.streaks.all).toEqual({ current: 3, longest: 3 });
  });

  test("the output doesn't depend on the day it is generated", async () => {
    const data = await imported([run("1", "4 ene 2024"), run("2", "28 dic 2023")]); // deps' clock is November 2026
    expect(data.streaks.runs).toEqual({ current: 2, longest: 2 });
  });

  test("a streak carries over a year end", async () => {
    const data = await imported([run("1", "3 ene 2021"), run("2", "28 dic 2020"), run("3", "27 dic 2020")]);
    expect(data.streaks.runs).toEqual({ current: 2, longest: 2 });
  });

  test("are zero with no activities", async () => {
    const status = await generate(deps());
    expect(status.ok && status.data.streaks).toEqual({ runs: { current: 0, longest: 0 }, all: { current: 0, longest: 0 } });
  });
});

describe("trends", () => {
  const run = (id: string, date: string, distance: string, row: Row = {}): Row => ({ id, date: `${date}, 10:00:00`, distance, ...row });

  test("a month holds its total run distance and longest run, and non-runs add nothing", async () => {
    const data = await imported([
      run("1", "20 oct 2026", "8000"),
      run("2", "3 oct 2026", "5000"),
      run("3", "4 oct 2026", "30000", { type: "Senderismo" }),
    ]);
    expect(data.trends.month).toMatchObject([{ key: "2026-10", runDistanceM: 13000, longestRunM: 8000 }]);
  });

  test("the axis has no holes: an empty month or week between activities still has a bucket", async () => {
    const data = await imported([run("1", "4 nov 2026", "5000"), run("2", "15 sept 2026", "6000")]);
    expect(data.trends.month.map((b) => b.key)).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(data.trends.month[1]).toMatchObject({ runDistanceM: 0, longestRunM: null, best5k: null, best10k: null });
    expect(data.trends.week).toHaveLength(8);
  });

  test("the axis covers every activity, not only runs, so all charts share it", async () => {
    const data = await imported([run("1", "4 nov 2026", "5000"), run("2", "15 sept 2026", "0", { type: "Natación" })]);
    expect(data.trends.month[0]).toMatchObject({ key: "2026-09", runDistanceM: 0 });
  });

  test("a week is keyed by its Monday, and Sunday belongs to the week before", async () => {
    const data = await imported([run("1", "2 nov 2026", "5000"), run("2", "1 nov 2026", "6000")]);
    expect(data.trends.week).toMatchObject([
      { key: "2026-10-26", runDistanceM: 6000 },
      { key: "2026-11-02", runDistanceM: 5000 },
    ]);
  });

  test("weeks and months group on the settings time zone, not UTC", async () => {
    // Sunday 31 Jan 23:30 UTC is Monday 1 Feb 00:30 in Madrid.
    const data = await imported([{ date: "31 ene 2027, 23:30:00", distance: "5000" }]);
    expect(data.trends.month[0]?.key).toBe("2027-02");
    expect(data.trends.week[0]?.key).toBe("2027-02-01");
  });

  test("a bucket keeps its fastest effort at each distance, flagged if it came from a race", async () => {
    const effort = (id: string, day: string, seconds: number, row: Row = {}) => {
      const file = `activities/${id}.tcx.gz`;
      return [{ id, date: `${day} nov 2026, 10:00:00`, file, ...row }, { [file]: tcx([{ at: 0, m: 0 }, { at: seconds, m: 5000 }]) }] as const;
    };
    const [slow, slowFile] = effort("1", "2", 1700);
    const [race, raceFile] = effort("2", "3", 1500, { tags: "race" });
    const [training, trainingFile] = effort("3", "9", 1600);
    const data = await imported([training, race, slow], { ...slowFile, ...raceFile, ...trainingFile });
    expect(data.trends.month[0]).toMatchObject({ best5k: { seconds: 1500, race: true }, best10k: null });
    expect(data.trends.week.map((b) => b.best5k)).toEqual([
      { seconds: 1500, race: true },
      { seconds: 1600, race: false },
    ]);
  });
});

describe("achievements", () => {
  type Effort = Record<string, number>;
  const on = (id: string, date: string, km: number, row: Row = {}): Row => ({ id, date: `${date}, 10:00:00`, distance: String(km * 1000), ...row });
  // One stretch per distance, far enough apart that only the shorter stretch sets the 1K.
  const withEfforts = (rows: [Row, Effort][]) =>
    imported(
      rows.map(([row]) => ({ ...row, file: `activities/${row.id}.tcx.gz` })),
      Object.fromEntries(
        rows.map(([row, efforts]) => {
          let at = 0;
          let m = 0;
          const points: Point[] = [{ at: 0, m: 0 }];
          for (const [distance, seconds] of Object.entries(efforts)) {
            at += seconds;
            m += Number(distance);
            points.push({ at, m });
            at += 100_000;
            points.push({ at, m });
          }
          return [`activities/${row.id}.tcx.gz`, tcx(points)];
        }),
      ),
    );
  const of = (data: Awaited<ReturnType<typeof imported>>, kind: string, label?: string) =>
    data.achievements.filter((a) => a.kind === kind && (label === undefined || a.label === label));
  const values = (data: Awaited<ReturnType<typeof imported>>, kind: string) =>
    of(data, kind).map(({ date, label, value, previous }) => ({ date, label, value, previous }));

  describe("records", () => {
    test("best efforts at 1K, 5K and 10K are records when beaten, and a slower run isn't", async () => {
      const data = await withEfforts([
        [on("3", "3 oct 2026", 12), { 1000: 280, 5000: 1500, 10000: 3200 }],
        [on("2", "2 oct 2026", 12), { 1000: 320, 5000: 1700, 10000: 3700 }],
        [on("1", "1 oct 2026", 12), { 1000: 300, 5000: 1600, 10000: 3500 }],
      ]);
      expect(of(data, "record", "Best 1K")).toMatchObject([{ date: "2026-10-03", value: 280, previous: 300, unit: "time", activity: { stravaId: "3" } }]);
      expect(of(data, "record", "Best 5K")).toMatchObject([{ date: "2026-10-03", value: 1500, previous: 1600 }]);
      expect(of(data, "record", "Best 10K")).toMatchObject([{ date: "2026-10-03", value: 3200, previous: 3500 }]);
    });

    test("record weeks are by run distance, dated by their Monday, with no activity", async () => {
      const data = await imported([
        on("5", "21 oct 2026", 12), // beats the record, in the week of the 19th
        on("4", "15 oct 2026", 4),
        on("3", "13 oct 2026", 4), // two runs add up to 8 km, under the 9 km baseline
        on("2", "6 oct 2026", 9),
        on("1", "30 sept 2026", 1, { type: "Senderismo" }), // an empty first week is no baseline
      ]);
      expect(of(data, "record", "Record week")).toEqual([
        { kind: "record", date: "2026-10-19", label: "Record week", value: 12000, previous: 9000, unit: "distance", activity: null },
      ]);
    });

    test("record months are by run distance, dated by the month's last run, with no activity", async () => {
      const data = await imported([
        on("5", "5 nov 2026", 7),
        on("4", "30 oct 2026", 1, { type: "Senderismo" }), // later than the last run, but no run
        on("3", "20 oct 2026", 4),
        on("2", "3 oct 2026", 4),
        on("1", "20 sept 2026", 6),
      ]);
      expect(of(data, "record", "Record month")).toEqual([
        { kind: "record", date: "2026-10-20", label: "Record month", value: 8000, previous: 6000, unit: "distance", activity: null },
      ]);
    });

    test("a record in the newest month isn't dated after the newest activity", async () => {
      const data = await imported([on("2", "2 nov 2026", 8), on("1", "20 oct 2026", 6)]);
      expect(of(data, "record", "Record month").map((a) => a.date)).toEqual(["2026-11-02"]);
    });

    test("a record month's date holds for a last run after the 28th", async () => {
      const data = await imported([on("2", "31 oct 2026", 8), on("1", "20 sept 2026", 6)]);
      expect(of(data, "record", "Record month").map((a) => a.date)).toEqual(["2026-10-31"]);
    });

    test("the longest run gets an entry only when beaten, with its new and old value", async () => {
      const data = await imported([
        on("4", "4 oct 2026", 8),
        on("3", "3 oct 2026", 7),
        on("2", "2 oct 2026", 6), // a tie doesn't beat the baseline
        on("1", "1 oct 2026", 6),
      ]);
      expect(of(data, "record", "Longest run")).toMatchObject([
        { date: "2026-10-04", value: 8000, previous: 7000, unit: "distance", activity: { stravaId: "4" } },
        { date: "2026-10-03", value: 7000, previous: 6000, unit: "distance", activity: { stravaId: "3" } },
      ]);
    });

    test("the first value of each record produces no entry", async () => {
      const data = await imported([on("1", "1 oct 2026", 6)]);
      expect(of(data, "record")).toEqual([]);
    });
  });

  describe("streaks", () => {
    test("one row per record-breaking streak, dated by its last week, and no row for the first streak", async () => {
      const data = await imported([
        on("7", "2 nov 2026", 5), // 3 weeks, so it breaks the record of 2
        on("6", "26 oct 2026", 5),
        on("5", "19 oct 2026", 5),
        on("4", "28 sept 2026", 5), // 2 weeks, tying the record is not breaking it
        on("3", "21 sept 2026", 5),
        on("2", "7 sept 2026", 5), // 2 weeks, the first streak
        on("1", "31 ago 2026", 5),
      ]);
      expect(of(data, "streak")).toEqual([
        { kind: "streak", date: "2026-11-02", label: "Longest streak", value: 3, previous: 2, unit: "weeks", activity: null, streakBasis: "runs" },
        { kind: "streak", date: "2026-11-02", label: "Longest streak", value: 3, previous: 2, unit: "weeks", activity: null, streakBasis: "all" },
      ]);
    });

    test("rows carry their basis, as the bases break records apart", async () => {
      const data = await imported([
        on("4", "19 oct 2026", 1, { type: "Senderismo" }),
        on("3", "12 oct 2026", 5),
        on("2", "5 oct 2026", 1, { type: "Senderismo" }),
        on("1", "21 sept 2026", 5), // one week for both bases
      ]);
      expect(of(data, "streak")).toMatchObject([{ date: "2026-10-19", value: 3, previous: 1, streakBasis: "all" }]);
    });
  });

  describe("races", () => {
    test("every race is listed, a slower one too, with its time stopped", async () => {
      const data = await imported([
        on("3", "3 oct 2026", 5, { title: "Slower race", tags: "race", moving: "1800", elapsed: "1860" }),
        on("2", "2 oct 2026", 5),
        on("1", "1 oct 2026", 5, { title: "San Silvestre", tags: "race", moving: "1500", elapsed: "1500" }),
      ]);
      expect(of(data, "race")).toMatchObject([
        { date: "2026-10-03", label: "Slower race", value: null, activity: { stravaId: "3", stoppedS: 60 } },
        { date: "2026-10-01", label: "San Silvestre", value: null, activity: { stravaId: "1", stoppedS: 0 } },
      ]);
    });
  });

  describe("firsts", () => {
    test("first run, first race and first Long run happen once each", async () => {
      const data = await imported([
        on("4", "4 oct 2026", 10, { tags: "race" }),
        on("3", "3 oct 2026", 10),
        on("2", "2 oct 2026", 5, { tags: "race" }),
        on("1", "1 oct 2026", 5),
        on("0", "30 sept 2026", 30, { type: "Senderismo" }),
      ]);
      expect(values(data, "first")).toEqual([
        { date: "2026-10-03", label: "First long run", value: 10000, previous: null },
        { date: "2026-10-02", label: "First race", value: 5000, previous: null },
        { date: "2026-10-01", label: "First run", value: 5000, previous: null },
      ]);
      expect(of(data, "first", "First race")).toMatchObject([{ unit: "distance", activity: { stravaId: "2" } }]);
    });

    test("each new whole km from 11 km up gets one entry, even when a run skips some", async () => {
      const data = await imported([
        on("5", "5 oct 2026", 13.2),
        on("4", "4 oct 2026", 11.5),
        on("3", "3 oct 2026", 11.1),
        on("2", "2 oct 2026", 10.99),
        on("1", "1 oct 2026", 10.5),
      ]);
      expect(values(data, "first").map(({ date, label }) => [date, label]).filter(([, label]) => /\d km/.test(label!))).toEqual([
        ["2026-10-05", "First 12 km"],
        ["2026-10-05", "First 13 km"],
        ["2026-10-03", "First 11 km"],
      ]);
    });

    test("the first best effort strictly under each barrier gets an entry, once", async () => {
      const data = await withEfforts([
        [on("4", "4 oct 2026", 6), { 5000: 1620 }], // under 27:30 again
        [on("3", "3 oct 2026", 6), { 5000: 1640 }], // under 27:30 for the first time
        [on("2", "2 oct 2026", 6), { 5000: 1650 }], // exactly 27:30 is not under it
        [on("1", "1 oct 2026", 6), { 5000: 1700 }], // under 30:00 at the very first go
      ]);
      expect(of(data, "first").filter((a) => a.label.includes("under"))).toMatchObject([
        { date: "2026-10-03", label: "5K under 27:30", value: 1640, unit: "time", activity: { stravaId: "3" } },
        { date: "2026-10-01", label: "5K under 30:00", value: 1700, unit: "time", activity: { stravaId: "1" } },
      ]);
    });

    test("barriers come from Settings, and one effort can pass several", async () => {
      writeFileSync(join(dir, "settings.json"), JSON.stringify({ ...VALID_SETTINGS, firstBarrierSeconds: { ...VALID_SETTINGS.firstBarrierSeconds, "1K": [290, 280], "5K": [1], "10K": [1] } }));
      const data = await withEfforts([[on("1", "1 oct 2026", 6), { 1000: 270 }]]);
      expect(of(data, "first").filter((a) => a.label.includes("under")).map((a) => a.label)).toEqual(["1K under 4:50", "1K under 4:40"]);
    });
  });

  test("come newest first, and runs alone count", async () => {
    const data = await imported([
      on("3", "3 oct 2026", 20),
      on("2", "2 oct 2026", 8, { type: "Senderismo", tags: "race" }),
      on("1", "1 oct 2026", 6),
    ]);
    const dates = data.achievements.map((a) => a.date);
    expect(dates).toEqual(dates.toSorted().toReversed());
    expect(of(data, "race")).toEqual([]);
  });

  test("activity-based entries link to their Strava activity", async () => {
    const data = await imported([on("2", "2 oct 2026", 12, { tags: "race" }), on("1", "1 oct 2026", 6)]);
    const noActivity = data.achievements.filter((a) => /^(Record|Longest streak)/.test(a.label));
    expect(noActivity.every((a) => a.activity === null)).toBe(true);
    const rest = data.achievements.filter((a) => !noActivity.includes(a));
    expect(rest.map((a) => a.activity?.stravaId).sort()).toEqual(["1", "2", "2", "2", "2", "2", "2"]);
  });
});

describe("heart-rate trends", () => {
  // Each stint is [bpm, seconds], in steps of 10 s so no sample hits the cap.
  function hrFile(stints: [number, number][]): Uint8Array {
    const points: Point[] = [];
    let at = 0;
    for (const [bpm, seconds] of stints) {
      for (let i = 0; i < seconds; i += 10, at += 10) points.push({ at, bpm });
    }
    return tcx([...points, { at, bpm: stints.at(-1)![0] }]);
  }

  const hrRun = (id: string, day: string, stints: [number, number][], row: Row = {}) => {
    const file = `activities/${id}.tcx.gz`;
    return { row: { id, date: `${day} 2026, 10:00:00`, file, ...row }, files: { [file]: hrFile(stints) } };
  };

  const importedHr = (...activities: { row: Row; files: Record<string, Uint8Array> }[]) =>
    imported(activities.map((a) => a.row), Object.assign({}, ...activities.map((a) => a.files)));

  test("time in zones covers every activity with HR, and time below Zone 1 is in no zone", async () => {
    const data = await importedHr(
      hrRun("1", "4 nov", [[90, 20], [100, 30], [139, 40], [180, 50]]),
      hrRun("2", "5 nov", [[120, 100]], { type: "Senderismo" }),
    );
    expect(data.trends.month[0]?.zoneSeconds).toEqual([30, 140, 0, 0, 50]);
  });

  test("a zone change in settings is applied by generate with no import", async () => {
    await importedHr(hrRun("1", "4 nov", [[130, 100]]));
    writeFileSync(deps().settingsPath, JSON.stringify({ ...VALID_SETTINGS, hrZones: [100, 110, 120, 125, 180] }));

    const status = await generate(deps());

    expect(status.ok && status.data.trends.month[0]?.zoneSeconds).toEqual([0, 0, 0, 100, 0]);
  });

  test("efficiency is the mean of each run's moving metres per minute ÷ average HR", async () => {
    const data = await importedHr(
      hrRun("1", "2 nov", [[150, 100]], { distance: "6000", moving: "2400" }), // 150 m/min at 150 bpm: 1 m/beat
      hrRun("2", "3 nov", [[100, 100]], { distance: "6000", moving: "1800" }), // 200 m/min at 100 bpm: 2 m/beat
      hrRun("3", "4 nov", [[120, 100]], { type: "Senderismo", distance: "6000", moving: "6000" }),
      { row: { id: "4", date: "5 nov 2026, 10:00:00", distance: "6000", moving: "6000" }, files: {} },
    );
    expect(data.trends.month[0]?.efficiency).toBe(1.5);
  });

  test("a run with HR but no distance gives no efficiency", async () => {
    const data = await importedHr(hrRun("1", "2 nov", [[150, 100]], { distance: "0" }));
    expect(data.trends.month[0]).toMatchObject({ efficiency: null, avgHr: 150 });
  });

  test("Zone 2 pace is the mean moving pace of runs over half their HR time in Zone 2", async () => {
    const data = await importedHr(
      hrRun("1", "2 nov", [[130, 60], [150, 40]], { distance: "1000", moving: "300" }),
      hrRun("2", "3 nov", [[130, 100]], { distance: "1000", moving: "360" }),
      hrRun("3", "4 nov", [[130, 50], [150, 50]], { distance: "1000", moving: "600" }), // exactly half
      hrRun("4", "5 nov", [[130, 40], [90, 30], [150, 30]], { distance: "1000", moving: "600" }), // 40% of HR time, 57% of zoned time
      hrRun("5", "6 nov", [[150, 100]], { title: "[Zone 2] easy", distance: "1000", moving: "600" }),
      hrRun("6", "1 nov", [[130, 100]], { type: "Senderismo", distance: "1000", moving: "600" }),
    );
    expect(data.trends.month[0]?.zone2PaceSPerKm).toBe(330);
  });

  test("average HR is the mean of the averages of runs with HR, and non-runs add nothing", async () => {
    const data = await importedHr(
      hrRun("1", "2 nov", [[120, 100]]),
      hrRun("2", "3 nov", [[160, 300]]),
      hrRun("3", "4 nov", [[100, 100]], { type: "Senderismo" }),
    );
    expect(data.trends.month[0]?.avgHr).toBe(140);
  });

  test("HR values are null for a bucket with no data, not zero", async () => {
    const data = await importedHr(
      hrRun("1", "4 nov", [[150, 100]]),
      { row: { id: "2", date: "4 sept 2026, 10:00:00" }, files: {} },
    );
    const noData = { zoneSeconds: null, efficiency: null, zone2PaceSPerKm: null, avgHr: null };
    expect(data.trends.month[0]).toMatchObject(noData); // a run without HR
    expect(data.trends.month[1]).toMatchObject(noData); // an empty month
    expect(data.trends.month[2]).toMatchObject({ zone2PaceSPerKm: null }); // HR, but no Zone 2 run
    expect(data.trends.month[2]?.avgHr).toBe(150);
  });

  test("the metadata says when the watch era starts", async () => {
    expect((await imported([{}])).meta.watchEraStart).toBe("2024-08-23");
  });
});

describe("a corrupt activity file", () => {
  const good = tcx([{ at: 0, bpm: 100 }, { at: 2, bpm: 100 }]);

  test.each([
    ["TCX cut short", "activities/1.tcx.gz", gzipSync(gunzipSync(good).slice(0, 100))],
    ["bytes that aren't gzip", "activities/1.tcx.gz", new Uint8Array([1, 2, 3])],
    ["the wrong kind of XML", "activities/1.tcx.gz", gzipSync(new TextEncoder().encode("<gpx/>"))],
    ["GPX that isn't XML", "activities/1.gpx", new TextEncoder().encode("<gpx><trk>")],
    ["FIT that isn't FIT", "activities/1.fit.gz", gzipSync(new Uint8Array([1, 2, 3]))],
  ])("%s keeps the summary and file, warns, and has empty derived values", async (_, name, bytes) => {
    const data = await imported([{ file: name, title: "Kept" }, { id: "2", file: "activities/2.tcx.gz", title: "Fine" }], {
      [name]: bytes,
      "activities/2.tcx.gz": good,
    });

    expect(data.activities.find((a) => a.title === "Kept")).toMatchObject({ avgHr: null, maxHr: null, distanceM: 6062.6 });
    expect(data.activities.find((a) => a.title === "Fine")).toMatchObject({ avgHr: 100 });
    expect(lines).toContain("Imported 2 activities and 2 files");
    expect(lines.filter((line) => line.startsWith("Warning"))).toEqual([expect.stringContaining("2026-11-04T18:11:23")]);
  });

  test("stays stale, so every generate retries it and warns again", async () => {
    await imported([{ file: "activities/1.tcx.gz" }], { "activities/1.tcx.gz": new Uint8Array([1, 2, 3]) });
    lines = [];
    await generate(deps());
    expect(lines.filter((line) => line.startsWith("Warning"))).toHaveLength(1);
  });
});

describe("importing a later Bulk export", () => {
  test("overwrites an activity with the same strava_id, so a title edited on Strava flows in", async () => {
    await imported([{ id: "1", title: "Morning run" }]);
    const data = await imported([{ id: "1", title: "Edited on Strava" }]);
    expect(data.activities.map((a) => a.title)).toEqual(["Edited on Strava"]);
  });

  test("overwrites an activity with a new strava_id that starts within 60 s", async () => {
    await imported([{ id: "1", date: "1 ene 2025, 10:00:00", title: "Before" }]);
    const data = await imported([{ id: "2", date: "1 ene 2025, 10:01:00", title: "Re-uploaded" }]);
    expect(data.activities.map((a) => a.title)).toEqual(["Re-uploaded"]);
    expect(lines.join("\n")).not.toContain("Before");
  });

  test("matches on strava_id before start time, so a new activity can't take a neighbour's place", async () => {
    await imported([{ id: "1", date: "1 ene 2025, 10:00:00", title: "Old title" }]);
    const data = await imported([
      { id: "2", date: "1 ene 2025, 10:00:30", title: "New neighbour" },
      { id: "1", date: "1 ene 2025, 10:00:00", title: "New title" },
    ]);
    expect(data.activities.map((a) => a.title)).toEqual(["New neighbour", "New title"]);
  });

  test.each([
    ["listed but not in the zip", { id: "1", file: "activities/1.tcx.gz" }],
    ["blank in the CSV", { id: "1", file: "" }],
    ["re-uploaded with a new strava_id", { id: "2", date: "4 nov 2026, 18:11:53" }],
  ])("an overwrite whose file is %s keeps the stored file and derived values, and warns", async (_, row) => {
    const name = "activities/1.tcx.gz";
    await imported([{ id: "1", file: name, title: "Before" }], { [name]: tcx([{ at: 0, bpm: 100, m: 0 }, { at: 300, bpm: 100, m: 1000 }]) });
    lines = [];

    const data = await imported([{ ...row, title: "After" }]);

    expect(data.activities[0]).toMatchObject({ title: "After", avgHr: 100, maxHr: 100 });
    expect(data.allTime.best1k).toBe(300);
    expect(lines.filter((line) => line.startsWith("Warning"))).toEqual([expect.stringContaining(`activity ${row.id}`)]);
    expect(lines).toContain("Imported 1 activities and 0 files");

    // Still stored, not just left in place once: a second file-less overwrite finds it too.
    const again = await imported([{ ...row, title: "After" }]);
    expect(again.activities[0]).toMatchObject({ avgHr: 100 });
  });

  test("a file in the new zip replaces the stored one", async () => {
    const name = "activities/1.tcx.gz";
    await imported([{ id: "1", file: name }], { [name]: tcx([{ at: 0, bpm: 100 }, { at: 2, bpm: 100 }]) });
    const data = await imported([{ id: "1", file: name }], { [name]: tcx([{ at: 0, bpm: 150 }, { at: 2, bpm: 150 }]) });
    expect(data.activities[0]).toMatchObject({ avgHr: 150 });
  });

  test("warns about an activity with a blank file cell", async () => {
    await imported([{ id: "7", file: "" }]);
    expect(lines.filter((line) => line.startsWith("Warning"))).toEqual([expect.stringContaining("activity 7")]);
  });

  test("deletes and prints a Strava activity missing from the export", async () => {
    await imported([
      { id: "1", date: "1 ene 2025, 10:00:00", title: "Removed on Strava" },
      { id: "2", date: "1 feb 2025, 10:00:00", title: "Still there" },
    ]);
    const data = await imported([{ id: "2", date: "1 feb 2025, 10:00:00", title: "Still there" }]);
    expect(data.activities.map((a) => a.title)).toEqual(["Still there"]);
    expect(lines).toContainEqual(expect.stringContaining("Removed on Strava"));
    expect(lines).toContainEqual(expect.stringContaining("2025-01-01"));
  });

  test("does not match an activity that starts more than 60 s away", async () => {
    await imported([{ id: "1", date: "1 ene 2025, 10:00:00", title: "Before" }]);
    await imported([{ id: "2", date: "1 ene 2025, 10:01:01", title: "Different session" }]);
    expect(lines).toContainEqual(expect.stringContaining("Before"));
  });

  test("imports the same export twice without changing or printing anything", async () => {
    const rows = [
      { id: "1", date: "1 ene 2025, 10:00:00", title: "One", file: "activities/1.tcx.gz" },
      { id: "2", date: "1 ene 2025, 10:00:30", title: "Two", file: "activities/2.tcx.gz" },
    ];
    const file = tcx([{ at: 0, bpm: 100 }, { at: 2, bpm: 100 }]);
    const files = { "activities/1.tcx.gz": file, "activities/2.tcx.gz": file };
    const first = await imported(rows, files);
    lines = [];
    const second = await imported(rows, files);
    expect(second.activities).toEqual(first.activities);
    expect(lines).toEqual(["Imported 2 activities and 2 files"]);
  });

  test.each([
    ["older", exportZip([{ id: "1", date: "1 ene 2025, 09:59:59" }])],
    ["empty", exportZip([])],
  ])("refuses an %s export and changes nothing", async (_, zip) => {
    await imported([{ id: "1", date: "1 ene 2025, 10:00:00", title: "Kept" }]);
    const page = await Bun.file(deps().outPath).text();

    const status = await importExport(writeZip(zip), deps());

    expect(status).toEqual({ ok: false, error: expect.stringContaining("Refused") });
    expect(await Bun.file(deps().outPath).text()).toBe(page);
    const after = await generate(deps());
    expect(after.ok && after.data.activities.map((a) => a.title)).toEqual(["Kept"]);
  });

  test("rolls back overwrites and deletions when a later row fails", async () => {
    const older = { id: "1", date: "1 ene 2025, 10:00:00", title: "Old" };
    const newer = { id: "2", date: "1 feb 2025, 10:00:00", title: "New" };
    await imported([older, newer]);

    const zip = exportZip([{ ...newer, title: "Edited" }, { ...newer, title: "Twice" }]);
    const status = await importExport(writeZip(zip), deps());

    expect(status.ok).toBe(false);
    const after = await generate(deps());
    expect(after.ok && after.data.activities.map((a) => a.title)).toEqual(["New", "Old"]);
  });

  test("rolls everything back when the page can't be written", async () => {
    const row = { id: "1", title: "Stored" };
    await imported([row]);
    writeFileSync(join(dir, "blocked"), "");

    const zip = writeZip(exportZip([{ ...row, title: "Edited" }]));
    const status = await importExport(zip, { ...deps(), outPath: join(dir, "blocked", "dashboard.html") });

    expect(status.ok).toBe(false);
    const after = await generate(deps());
    expect(after.ok && after.data.activities.map((a) => a.title)).toEqual(["Stored"]);
  });
});

describe("adopting Provisional activities", () => {
  const stravaRow = { id: "9", date: "5 nov 2026, 8:00:30", title: "[Zone 2] From Strava", tags: "running|race", moving: "3500.0", elapsed: "3600.0", distance: "12.100,0" };

  test("a start-time match becomes a Strava activity, with its Polar values and file gone", async () => {
    await refreshed([polarExercise()]);

    const data = await imported([stravaRow]);

    expect(data.activities).toHaveLength(1);
    expect(data.activities[0]).toMatchObject({
      stravaId: "9",
      title: "[Zone 2] From Strava",
      sessionType: "Zone 2",
      race: true,
      longRun: true,
      movingS: 3500,
      stoppedS: 100,
      distanceM: 12100,
      avgHr: null,
    });
    expect(data.allTime.best1k).toBeNull();
    expect(data.meta.awaitingStrava).toBe(0);
    expect(lines.join("\n")).not.toContain("Kept");
  });

  test("the export's own file replaces the Polar one", async () => {
    await refreshed([polarExercise()]);
    const name = "activities/9.tcx.gz";
    const data = await imported([{ ...stravaRow, file: name }], { [name]: tcx([{ at: 0, bpm: 150 }, { at: 5, bpm: 150 }, { at: 10, bpm: 151 }]) });
    expect(data.activities[0]).toMatchObject({ avgHr: 150, maxHr: 150 });
  });

  test("unmatched ones stay as they are and are printed, even with nothing newer on Strava", async () => {
    const strava = { id: "1", date: "4 nov 2026, 18:11:23", title: "Stored" };
    await imported([strava]);
    await refreshed([
      polarExercise({ id: "newer", start_time: "2026-11-05T09:00:00" }),
      polarExercise({ id: "older", start_time: "2026-11-03T09:00:00", detailed_sport_info: "HIKING" }),
    ]);
    lines = [];

    const data = await imported([strava]);

    expect(data.activities.map((a) => [a.date, a.title, a.type])).toEqual([
      ["2026-11-05", null, "run"],
      ["2026-11-04", "Stored", "run"],
      ["2026-11-03", null, "hike"],
    ]);
    expect(data.activities[0]!.avgHr).not.toBeNull();
    expect(data.meta.awaitingStrava).toBe(2);
    expect(lines).toContain("Kept 2026-11-05 run, Provisional and not in the export");
    expect(lines).toContain("Kept 2026-11-03 hike, Provisional and not in the export");
  });

  test("rolls back when the page can't be written, and prints no kept rows", async () => {
    await refreshed([polarExercise(), polarExercise({ id: "older", start_time: "2026-11-03T09:00:00" })]);
    writeFileSync(join(dir, "blocked"), "");
    lines = [];

    const zip = writeZip(exportZip([stravaRow]));
    const status = await importExport(zip, { ...deps(), outPath: join(dir, "blocked", "dashboard.html") });

    expect(status.ok).toBe(false);
    expect(lines.join("\n")).not.toContain("Kept");
    const after = await generate(deps());
    if (!after.ok) throw new Error(after.error);
    expect(after.data.activities.map((a) => [a.title, a.avgHr !== null])).toEqual([[null, true], [null, true]]);
    expect(after.data.meta.awaitingStrava).toBe(2);
  });
});

describe("marks", () => {
  test.each([
    ["race", true],
    ["running|race", true],
    ["running|workout", false],
    ["running|race-pace", false],
    ["", false],
  ])("a run tagged %j has race %j", async (tags, race) => {
    const data = await imported([{ tags, title: "Morning run" }]);
    expect(data.activities[0]!.race).toBe(race);
  });

  test.each([
    [10000, true],
    [9999.9, false],
  ])("a run of %d m has longRun %j", async (metres, longRun) => {
    const data = await imported([{ distance: String(metres) }]);
    expect(data.activities[0]!.longRun).toBe(longRun);
  });

  test("a race of 10 km or more is also a Long run", async () => {
    const data = await imported([{ tags: "race", distance: "10.100,0" }]);
    expect(data.activities[0]).toMatchObject({ race: true, longRun: true });
  });

  test("a shorter run labelled Long Run is not a Long run", async () => {
    const data = await imported([{ title: "[Long Run] Easy", distance: "8000" }]);
    expect(data.activities[0]!.longRun).toBe(false);
  });

  test.each([
    ["6x1km", "Intervals"],
    ["6x1Km", "Intervals"],
    ["2x3km", "Intervals"],
    ["10x200", "Intervals"],
    ["4x600m", "Intervals"],
    ["Fartlek", "Fartlek"],
    ["Fartlek 2x3-2-1", "Fartlek"],
    ["Fartlek 3x(3-2-1)", "Fartlek"],
    ["3x3-2-1", "Fartlek"],
    ["3x(3-2-1)", "Fartlek"],
    ["Hillsx8", "Hills"],
    ["5xHills", "Hills"],
    ["7xHills", "Hills"],
    ["Zone 2", "Zone 2"],
    ["Zona 2", "Zone 2"],
    ["~Zone 2", "Zone 2"],
    ["Hiit", "HIIT"],
    ["Running test", "Running test"],
    ["RT", "Running test"],
    ["Long Run", "Long run"],
  ])("the label [%s] gives the Session type %s and keeps its text as detail", async (label, sessionType) => {
    const data = await imported([{ title: `[${label}] Riverside` }]);
    expect(data.activities[0]).toMatchObject({ sessionType, sessionDetail: label });
  });

  test.each(["[Ro]", "[Coruña Corre]", "[5K]", "[Zone 1-3]", "[V]", "[GPS]", "[]", "Coruña 21 [6x1km]", " [Zone 2]", "Zone 2"])(
    "the title %j gives no Session type",
    async (title) => {
      const data = await imported([{ title }]);
      expect(data.activities[0]).toMatchObject({ sessionType: null, sessionDetail: null });
    },
  );

  test("a non-run activity gets no marks, whatever its tags, title and distance", async () => {
    const data = await imported([{ type: "Senderismo", tags: "race", title: "[Zone 2] Hills", distance: "12000" }]);
    expect(data.activities[0]).toMatchObject({ race: false, longRun: false, sessionType: null, sessionDetail: null });
  });

  test("a title can't make a run a race", async () => {
    const data = await imported([{ title: "Race day [race]" }]);
    expect(data.activities[0]!.race).toBe(false);
  });
});

describe("Settings", () => {
  const withSettings = (change: object) =>
    writeFileSync(deps().settingsPath, JSON.stringify({ ...VALID_SETTINGS, ...change }));

  test.each([
    ["timeZone", { timeZone: "Mars/Olympus" }],
    ["timeZone", { timeZone: 2 }],
    ["hrZones", { hrZones: [100, 120, 140, 160] }],
    ["hrZones", { hrZones: [100, 120, 180, 160, 170] }],
    ["hrZones", { hrZones: [100, 120, 140, 160, "180"] }],
    ["hrZones", { hrZones: [0, 120, 140, 160, 180] }],
    ["firstBarrierSeconds", { firstBarrierSeconds: undefined }],
    ["firstBarrierSeconds", { firstBarrierSeconds: {} }],
    ["firstBarrierSeconds", { firstBarrierSeconds: { "5K": [1800], "10K": [3600] } }],
    ["firstBarrierSeconds", { firstBarrierSeconds: { "5K": [1800], "1K": [300] } }],
    ["firstBarrierSeconds", { firstBarrierSeconds: { "10K": [3600], "1K": [300] } }],
    ["firstBarrierSeconds", { firstBarrierSeconds: { ...VALID_SETTINGS.firstBarrierSeconds, "1K": ["300"] } }],
    ["firstBarrierSeconds", { firstBarrierSeconds: { "5K": [] } }],
    ["firstBarrierSeconds", { firstBarrierSeconds: { "5K": [1800, -1] } }],
  ])("a bad %s stops the build and names the setting: %j", async (name, change) => {
    withSettings(change);
    const status = await generate(deps());
    expect(status).toEqual({ ok: false, error: expect.stringContaining(name) });
    expect(await Bun.file(deps().outPath).exists()).toBe(false);
  });

  test("a distance can list as many barriers as the athlete wants", async () => {
    withSettings({ firstBarrierSeconds: { ...VALID_SETTINGS.firstBarrierSeconds, "5K": [1800, 1700, 1600, 1500] } });
    expect((await generate(deps())).ok).toBe(true);
  });

  test("a settings file that isn't JSON stops the build", async () => {
    writeFileSync(deps().settingsPath, "{ nope");
    const status = await generate(deps());
    expect(status).toEqual({ ok: false, error: expect.stringContaining("settings") });
  });

  test("a bad setting stops an import before anything is stored", async () => {
    withSettings({ hrZones: [] });
    const status = await importExport(writeZip(exportZip([{}])), deps());
    expect(status.ok).toBe(false);
    withSettings({});
    const after = await generate(deps());
    expect(after.ok && after.data.activities).toEqual([]);
  });
});

describe("generate", () => {
  test("rebuilds from stored data with no zip, applying changed Settings", async () => {
    await imported([{ date: "4 nov 2026, 20:00:00" }]);
    writeFileSync(deps().settingsPath, JSON.stringify({ ...VALID_SETTINGS, timeZone: "Asia/Tokyo" }));

    const status = await generate(deps());

    expect(status.ok && status.data.activities[0]!.date).toBe("2026-11-05");
    expect(status.ok && status.data.meta).toEqual({
      generatedAt: "2026-11-06T10:00:00.000Z",
      timeZone: "Asia/Tokyo",
      watchEraStart: "2024-08-23",
      newestActivity: "2026-11-05",
      awaitingStrava: 0,
      runs: 1,
      otherActivities: 0,
    });
  });

  // Tests can't change DERIVE_VERSION, so the row is put back as older code would have left it.
  const ageRows = (change: string) => {
    const db = new Database(deps().dbPath);
    db.run(`UPDATE activity SET derive_version = 0, time_at_bpm = '{"60":1}'`);
    if (change) db.run(change);
    db.close();
  };

  test("re-derives a row with an older derive_version from its stored file", async () => {
    const file = tcx([{ at: 0, bpm: 100 }, { at: 2, bpm: 100 }]);
    await imported([{ file: "activities/1.tcx.gz" }], { "activities/1.tcx.gz": file });
    ageRows("");

    const status = await generate(deps());

    expect(status.ok && status.data.activities[0]).toMatchObject({ avgHr: 100, maxHr: 100 });
  });

  test("re-derives best efforts too", async () => {
    const file = tcx([{ at: 0, m: 0 }, { at: 300, m: 1000 }]);
    await imported([{ file: "activities/1.tcx.gz" }], { "activities/1.tcx.gz": file });
    ageRows("DELETE FROM best_effort");

    const status = await generate(deps());

    expect(status.ok && status.data.allTime.best1k).toBe(300);
  });

  test("a re-derive replaces old best efforts instead of adding to them", async () => {
    const file = tcx([{ at: 0, m: 0 }, { at: 300, m: 1000 }]);
    await imported([{ file: "activities/1.tcx.gz" }], { "activities/1.tcx.gz": file });
    ageRows("UPDATE best_effort SET seconds = 100");

    const status = await generate(deps());

    expect(status.ok && status.data.allTime.best1k).toBe(300);
  });

  test("leaves a current row alone", async () => {
    await imported([{ file: "activities/1.tcx.gz" }], { "activities/1.tcx.gz": tcx([{ at: 0, bpm: 100 }, { at: 2, bpm: 100 }]) });
    const db = new Database(deps().dbPath);
    db.run(`UPDATE activity SET time_at_bpm = '{"60":1}'`);
    db.close();

    const status = await generate(deps());

    expect(status.ok && status.data.activities[0]).toMatchObject({ avgHr: 60 });
  });

  test("clears old derived values when a re-derive can't read the file", async () => {
    const file = tcx([{ at: 0, bpm: 100, m: 0 }, { at: 300, bpm: 100, m: 1000 }]);
    await imported([{ file: "activities/1.tcx.gz" }], { "activities/1.tcx.gz": file });
    ageRows("UPDATE activity_file SET file_gz = x'010203'");

    const status = await generate(deps());

    expect(status.ok && status.data.activities[0]).toMatchObject({ avgHr: null, maxHr: null });
    expect(status.ok && status.data.allTime.best1k).toBeNull();
    expect(lines.join("\n")).toContain("Warning");
  });

  test("works on an empty database", async () => {
    const status = await generate(deps());
    expect(status.ok && status.data.activities).toEqual([]);
    expect(status.ok && status.data.meta.newestActivity).toBeNull();
    expect(status.ok && status.data.currentLevel["8w"].longRuns).toBe(0);
  });
});

describe("the generated Dashboard", () => {
  const embeddedData = (html: string) =>
    JSON.parse(html.match(/<script type="application\/json" id="data">(.*?)<\/script>/s)![1]!);

  test("import always regenerates it, and it holds the returned data", async () => {
    const data = await imported([{ title: "Tom & Jerry's <10K>" }]);
    const html = await Bun.file(deps().outPath).text();
    expect(embeddedData(html)).toEqual(data);
  });

  test("shows the Banner and the Night run style", async () => {
    await imported([{}]);
    const html = await Bun.file(deps().outPath).text();
    expect(html).toContain("Adri's running");
    expect(html).toContain("#1b1464");
    expect(html).toContain("other activities");
  });

  test("the metadata counts runs and other activities for the Banner", async () => {
    const data = await imported([{ id: "1" }, { id: "2", date: "3 nov 2026, 9:00:00" }, { id: "3", date: "2 nov 2026, 9:00:00", type: "Senderismo" }]);
    expect(data.meta).toMatchObject({ runs: 2, otherActivities: 1 });
  });

  test("has no external script or stylesheet URLs, even when a title tries to add one", async () => {
    const hostile = `</script><script src="https://example.com/x.js"></script><link rel="stylesheet" href="//example.com/y.css">`;
    const data = await imported([{ title: hostile }]);
    const html = await Bun.file(deps().outPath).text();
    expect(html).not.toMatch(/<(script|link)[^>]+(src|href)=/);
    expect(embeddedData(html)).toEqual(data);
  });
});
