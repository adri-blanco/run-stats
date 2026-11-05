// Local acceptance test: data/ is git-ignored, so only the Chart.js check runs on a clean clone.
import { Decoder, Stream } from "@garmin/fitsdk";
import { parse } from "csv-parse/sync";
import { XMLParser } from "fast-xml-parser";
import { gunzipSync, unzipSync } from "fflate";
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ZIP = "data/strava-export/export_108516943.zip";
const SPANISH_MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];

function stravaStart(cell: string): number {
  const m = cell.match(/^(\d+) (\p{L}+)\.?,? (\d{4}), (\d+):(\d+):(\d+)$/u);
  if (!m) throw new Error(`unreadable date: ${cell}`);
  const month = SPANISH_MONTHS.indexOf(m[2]!);
  if (month < 0) throw new Error(`unknown month: ${m[2]}`);
  return Date.UTC(+m[3]!, month, +m[1]!, +m[4]!, +m[5]!, +m[6]!);
}

function asArray<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

const hasExport = existsSync(ZIP);

describe.skipIf(!hasExport)("toolchain against the real Bulk export", () => {
  const zip = hasExport ? unzipSync(readFileSync(ZIP)) : {};
  const rows: string[][] = hasExport
    ? parse(Buffer.from(zip["activities.csv"]!), { bom: true, from_line: 2 })
    : [];
  const fileOf = (row: string[]) => zip[row[12]!]!;
  const withExt = (ext: string) => rows.filter((r) => r[12]?.endsWith(ext));

  test("csv-parse reads every activity by column index", () => {
    expect(rows).toHaveLength(289);
    expect(rows.filter((r) => r[3] === "Carrera")).toHaveLength(200);
    expect(rows.filter((r) => r[103]?.split("|").includes("race"))).toHaveLength(17);
    for (const row of rows) {
      expect(row[0]).toMatch(/^\d+$/);
      expect(stravaStart(row[1]!)).toBeGreaterThan(0);
      for (const column of [15, 16, 17]) expect(row[column]).toMatch(/^[\d.,]+$/);
    }
  });

  test("fast-xml-parser reads every .gpx", () => {
    const xml = new XMLParser({ ignoreAttributes: false });
    const files = withExt(".gpx");
    expect(files.length).toBeGreaterThan(0);
    for (const row of files) {
      const doc = xml.parse(Buffer.from(fileOf(row)).toString("utf8"));
      const points = asArray<any>(doc.gpx.trk)
        .flatMap((t) => asArray<any>(t.trkseg))
        .flatMap((s) => asArray<any>(s.trkpt));
      expect(points.length).toBeGreaterThan(0);
      expect(points[0]["@_lat"]).toBeDefined();
      expect(points[0].time).toBeDefined();
    }
  });

  test("fflate gunzips and fast-xml-parser reads every .tcx.gz", () => {
    const xml = new XMLParser({ ignoreAttributes: false });
    const files = withExt(".tcx.gz");
    expect(files.length).toBeGreaterThan(0);
    for (const row of files) {
      const doc = xml.parse(Buffer.from(gunzipSync(fileOf(row))).toString("utf8"));
      const activity = asArray<any>(doc.TrainingCenterDatabase.Activities.Activity)[0];
      expect(activity.Id).toBeDefined();
      const points = asArray<any>(activity.Lap)
        .flatMap((lap) => asArray<any>(lap.Track))
        .flatMap((track) => asArray<any>(track.Trackpoint));
      expect(points.length).toBeGreaterThan(0);
      expect(points[0].Time).toBeDefined();
      if (row[3] === "Carrera") expect(points.some((p) => p.DistanceMeters !== undefined)).toBe(true);
    }
  });

  test("@garmin/fitsdk reads every .fit.gz and FIT starts sit within 60 s of Strava", () => {
    const files = withExt(".fit.gz");
    expect(files.length).toBeGreaterThan(0);
    const gaps = files.map((row) => {
      const stream = Stream.fromByteArray(Array.from(gunzipSync(fileOf(row))));
      const decoder = new Decoder(stream);
      expect(decoder.checkIntegrity()).toBe(true);
      const { messages, errors } = decoder.read();
      expect(errors).toEqual([]);
      const start = (messages.sessionMesgs?.[0] as { startTime: Date }).startTime;
      expect(messages.recordMesgs?.length).toBeGreaterThan(0);
      if (row[3] === "Carrera") expect(messages.recordMesgs!.some((r) => r.distance !== undefined)).toBe(true);
      return (start.getTime() - stravaStart(row[1]!)) / 1000;
    });
    for (const gap of gaps) expect(Math.abs(gap)).toBeLessThanOrEqual(60);
  });
});

test("Chart.js bundles with Bun.build into one offline page", async () => {
  const built = await Bun.build({
    entrypoints: ["test/fixtures/chart-entry.ts"],
    target: "browser",
    minify: true,
  });
  expect(built.success).toBe(true);
  const js = (await built.outputs[0]!.text()).replaceAll("</script", "<\\/script");
  mkdirSync("dist", { recursive: true });
  const page = `<!doctype html><title>Chart.js offline check</title><canvas width="600" height="300"></canvas><script type="module">${js}</script>`;
  await Bun.write(join("dist", "toolchain-chart.html"), page);
  expect(page).not.toMatch(/<(script|link)[^>]+(src|href)=/);
});
