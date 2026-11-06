// Local acceptance test: data/ is git-ignored, so it skips on a clean clone.
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importExport } from "../src/commands";

const ZIP = "data/strava-export/export_108516943.zip";
const dir = mkdtempSync(join(tmpdir(), "run-stats-acceptance-"));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

test.skipIf(!existsSync(ZIP))("imports the real Bulk export", async () => {
  const lines: string[] = [];
  const deps = {
    dbPath: join(dir, "real.sqlite"),
    outPath: join(dir, "dashboard.html"),
    settingsPath: "settings.json",
    now: () => new Date(),
    log: (line: string) => void lines.push(line),
  };
  await importExport(ZIP, deps);
  // The second run overwrites every row, so it proves a repeat import of the same export is safe.
  const status = await importExport(ZIP, deps);

  if (!status.ok) throw new Error(status.error);
  expect(status.data.activities).toHaveLength(289);
  expect(status.data.activities.filter((a) => a.type === "run")).toHaveLength(200);
  expect(status.data.activities.filter((a) => a.race)).toHaveLength(17);
  expect(lines).toEqual(Array(2).fill("Imported 289 activities and 289 files"));
});
