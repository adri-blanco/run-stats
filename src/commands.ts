import { deriveStale } from "./derive";
import { errorMessage } from "./errors";
import { writeDashboard } from "./generate";
import { readBulkExport, readPolarExercises, storeExport, type Polar } from "./import";
import { buildDashboardData, type DashboardData } from "./metrics";
import { loadSettings, type Settings } from "./settings";
import { withStore, type Store } from "./store";

const POLAR_WINDOW_MS = 30 * 86_400_000;

export type Deps = {
  dbPath: string;
  outPath: string;
  settingsPath: string;
  now: () => Date;
  log: (line: string) => void;
};

export type RefreshDeps = Deps & { fetch: Polar["fetch"]; polarToken: string | undefined };

export type Status = { ok: true; data: DashboardData } | { ok: false; error: string };

async function statusOf(run: () => Promise<DashboardData>): Promise<Status> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
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
    return withStore(deps.dbPath, (store) =>
      store.transaction(async () => {
        const { missing, kept } = storeExport(store, activities);
        const data = await publish(store, settings, deps);
        for (const row of missing) deps.log(`Deleted ${row.startUtc.slice(0, 10)} "${row.title}", missing from the export`);
        for (const row of kept) deps.log(`Kept ${row.startUtc.slice(0, 10)} ${row.type}, Provisional and not in the export`);
        deps.log(`Imported ${activities.length} activities and ${activities.filter((a) => a.file).length} files`);
        return data;
      }),
    );
  });
}

export function refresh(deps: RefreshDeps): Promise<Status> {
  return statusOf(async () => {
    const settings = loadSettings(deps.settingsPath);
    const token = deps.polarToken;
    if (!token) throw new Error("POLAR_ACCESS_TOKEN is missing: set it in .env to run refresh");
    return withStore(deps.dbPath, async (store) => {
      const stored = store.activities();
      if (stored[0] && deps.now().getTime() - Date.parse(stored[0].startUtc) > POLAR_WINDOW_MS) {
        deps.log("Warning: the newest stored activity is over 30 days old. Polar only lists the last 30 days, so a full export is needed to fill the gap");
      }
      const added = await readPolarExercises({ fetch: deps.fetch, token }, stored, deps.log);
      return store.transaction(async () => {
        store.insertAll(added);
        const data = await publish(store, settings, deps);
        deps.log(`Added ${added.length} Provisional activities`);
        return data;
      });
    });
  });
}

export function generate(deps: Deps): Promise<Status> {
  return statusOf(async () => {
    const settings = loadSettings(deps.settingsPath);
    return withStore(deps.dbPath, (store) => publish(store, settings, deps));
  });
}
