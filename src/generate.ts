import { join } from "node:path";
import type { DashboardData } from "./metrics";

const PAGE_DIR = join(import.meta.dir, "page");

export async function writeDashboard(data: DashboardData, outPath: string): Promise<void> {
  const built = await Bun.build({ entrypoints: [join(PAGE_DIR, "main.ts")], target: "browser", minify: true });
  if (!built.success) throw new Error(`Page build failed: ${built.logs.join("\n")}`);
  const js = (await built.outputs[0]!.text()).replaceAll("</script", "<\\/script");
  const css = await Bun.file(join(PAGE_DIR, "style.css")).text();
  // Escaping < keeps a title from closing the data block.
  const json = JSON.stringify(data).replaceAll("<", "\\u003c");
  await Bun.write(
    outPath,
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Adri's running</title>
<style>${css}</style>
</head>
<body>
<div id="app"></div>
<script type="application/json" id="data">${json}</script>
<script type="module">${js}</script>
</body>
</html>
`,
  );
}
