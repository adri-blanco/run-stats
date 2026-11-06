import { generate, importExport, type Deps } from "./commands";

const deps: Deps = {
  dbPath: "run-stats.sqlite",
  outPath: "dist/dashboard.html",
  settingsPath: "settings.json",
  now: () => new Date(),
  log: console.log,
};

const [command, zipPath, ...rest] = Bun.argv.slice(2);

function run() {
  if (command === "import" && zipPath && !rest.length) return importExport(zipPath, deps);
  if (command === "generate" && !zipPath) return generate(deps);
  console.error("Usage: bun src/cli.ts import <zip> | generate");
  process.exit(1);
}

const status = await run();
if (!status.ok) {
  console.error(status.error);
  process.exit(1);
}
console.log(`Wrote ${deps.outPath}`);
