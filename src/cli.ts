import { generate, importExport, refresh, type RefreshDeps } from "./commands";

const deps: RefreshDeps = {
  dbPath: "run-stats.sqlite",
  outPath: "dist/dashboard.html",
  settingsPath: "settings.json",
  now: () => new Date(),
  log: console.log,
  fetch,
  polarToken: process.env.POLAR_ACCESS_TOKEN,
};

const [command, zipPath, ...rest] = Bun.argv.slice(2);

function run() {
  if (command === "import" && zipPath && !rest.length) return importExport(zipPath, deps);
  if (command === "refresh" && !zipPath) return refresh(deps);
  if (command === "generate" && !zipPath) return generate(deps);
  console.error("Usage: bun src/cli.ts import <zip> | refresh | generate");
  process.exit(1);
}

const status = await run();
if (!status.ok) {
  console.error(status.error);
  process.exit(1);
}
console.log(`Wrote ${deps.outPath}`);
