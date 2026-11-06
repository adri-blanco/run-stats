import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { gzipSync, zipSync } from "fflate";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate, importExport } from "../src/commands";

const COLUMNS = 104;
const VALID_SETTINGS = {
  timeZone: "Europe/Madrid",
  hrZones: [100, 120, 140, 160, 180],
  firstBarrierSeconds: { "1K": [300, 270, 240], "5K": [1800, 1650, 1500], "10K": [3600, 3300, 3000] },
};

type Row = { id?: string; date?: string; title?: string; type?: string; file?: string; moving?: string; distance?: string; tags?: string };

function csvRow(row: Row): string {
  const cells = Array<string>(COLUMNS).fill("");
  cells[0] = row.id ?? "1";
  cells[1] = row.date ?? "4 nov 2026, 18:11:23";
  cells[2] = row.title ?? "Morning run";
  cells[3] = row.type ?? "Carrera";
  cells[12] = row.file ?? "";
  cells[15] = "2577.0";
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

describe("importExport", () => {
  test("stores an activity from a Bulk export and returns it in the DashboardData", async () => {
    const data = await imported([{ title: "Correr por correr" }]);
    expect(data.activities).toEqual([
      {
        date: "2026-11-04",
        title: "Correr por correr",
        type: "run",
        distanceM: 6062.6,
        movingS: 2515,
        race: false,
        longRun: false,
        sessionType: null,
        sessionDetail: null,
      },
    ]);
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
    expect(data.activities[0]!.type).toBe(type);
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
    ["firstBarrierSeconds", { firstBarrierSeconds: { "5K": [] } }],
    ["firstBarrierSeconds", { firstBarrierSeconds: { "5K": [1800, -1] } }],
  ])("a bad %s stops the build and names the setting: %j", async (name, change) => {
    withSettings(change);
    const status = await generate(deps());
    expect(status).toEqual({ ok: false, error: expect.stringContaining(name) });
    expect(await Bun.file(deps().outPath).exists()).toBe(false);
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
      newestActivity: "2026-11-05",
    });
  });

  test("works on an empty database", async () => {
    const status = await generate(deps());
    expect(status.ok && status.data.activities).toEqual([]);
    expect(status.ok && status.data.meta.newestActivity).toBeNull();
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
  });

  test("has no external script or stylesheet URLs, even when a title tries to add one", async () => {
    const hostile = `</script><script src="https://example.com/x.js"></script><link rel="stylesheet" href="//example.com/y.css">`;
    const data = await imported([{ title: hostile }]);
    const html = await Bun.file(deps().outPath).text();
    expect(html).not.toMatch(/<(script|link)[^>]+(src|href)=/);
    expect(embeddedData(html)).toEqual(data);
  });
});
