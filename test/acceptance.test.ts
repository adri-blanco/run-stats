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
  const status = await importExport(ZIP, {
    dbPath: join(dir, "real.sqlite"),
    outPath: join(dir, "dashboard.html"),
    settingsPath: "settings.json",
    now: () => new Date(),
    log: (line) => void lines.push(line),
  });

  if (!status.ok) throw new Error(status.error);
  expect(status.data.activities).toHaveLength(289);
  expect(status.data.activities.filter((a) => a.type === "run")).toHaveLength(200);
  expect(status.data.activities.filter((a) => a.race)).toHaveLength(17);
  expect(lines).toEqual(["Imported 289 activities and 289 files"]);
});
