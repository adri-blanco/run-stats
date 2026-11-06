import { deriveStale } from "./derive";
import { writeDashboard } from "./generate";
import { readBulkExport } from "./import";
import { buildDashboardData, type DashboardData } from "./metrics";
import { loadSettings, type Settings } from "./settings";
import { withStore, type Store } from "./store";

export type Deps = {
  dbPath: string;
  outPath: string;
  settingsPath: string;
  now: () => Date;
  log: (line: string) => void;
};

export type Status = { ok: true; data: DashboardData } | { ok: false; error: string };

async function statusOf(run: () => Promise<DashboardData>): Promise<Status> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function publish(store: Store, settings: Settings, deps: Deps): Promise<DashboardData> {
  deriveStale(store, deps.log);
  const data = buildDashboardData(store.activities(), settings, deps.now());
  await writeDashboard(data, deps.outPath);
  return data;
}

export function importExport(zipPath: string, deps: Deps): Promise<Status> {
  return statusOf(async () => {
    const settings = loadSettings(deps.settingsPath);
    const activities = readBulkExport(zipPath, deps.log);
    return withStore(deps.dbPath, (store) => {
      // shortcut: a repeat import aborts on the strava_id UNIQUE rule and rolls back, until #17 adds overwriting.
      store.insertAll(activities);
      deps.log(`Imported ${activities.length} activities and ${activities.filter((a) => a.file).length} files`);
      return publish(store, settings, deps);
    });
  });
}

export function generate(deps: Deps): Promise<Status> {
  return statusOf(async () => {
    const settings = loadSettings(deps.settingsPath);
    return withStore(deps.dbPath, (store) => publish(store, settings, deps));
  });
}
