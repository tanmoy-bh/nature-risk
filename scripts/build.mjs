// Assembles the single-page app into dist/ for Cloudflare Pages.
// No dependencies: run with `node scripts/build.mjs`.
import { readFile, writeFile, mkdir, cp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

const [app, geo, arch, archDefs, archSystem, archSequence, archRefresh] = await Promise.all([
  readFile(join(root, "src/app.html"), "utf8"),
  readFile(join(root, "src/geo.json"), "utf8"),
  readFile(join(root, "src/arch.svg"), "utf8"),
  readFile(join(root, "src/arch-defs.svg"), "utf8"),
  readFile(join(root, "src/arch-system.svg"), "utf8"),
  readFile(join(root, "src/arch-sequence.svg"), "utf8"),
  readFile(join(root, "src/arch-refresh.svg"), "utf8"),
]);

const placeholders = ["/*__PATHS__*/[]", "/*__ARCH__*/", "/*__ARCH_DEFS__*/", "/*__ARCH_SYSTEM__*/", "/*__ARCH_SEQUENCE__*/", "/*__ARCH_REFRESH__*/"];
const missing = placeholders.filter((p) => !app.includes(p));
if (missing.length) throw new Error(`src/app.html is missing placeholders: ${missing.join(", ")}`);
JSON.parse(geo); // fail the build on broken map data

const body = app
  .replace("/*__PATHS__*/[]", geo.trim())
  .replace("/*__ARCH__*/", arch.trim())
  .replace("/*__ARCH_DEFS__*/", archDefs.trim())
  .replace("/*__ARCH_SYSTEM__*/", archSystem.trim())
  .replace("/*__ARCH_SEQUENCE__*/", archSequence.trim())
  .replace("/*__ARCH_REFRESH__*/", archRefresh.trim());

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Nature Risk Desk</title>
<meta name="description" content="Proof of concept: nature data turned into a financial signal for lenders, on real open data.">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
<style>html{-webkit-text-size-adjust:100%}*,*::before,*::after{box-sizing:border-box}body{margin:0}img{max-width:100%}</style>
</head>
<body>
${body}
</body>
</html>
`;

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(join(root, "public"), dist, { recursive: true });
await writeFile(join(dist, "index.html"), html);
console.log(`Built dist/index.html (${(html.length / 1024).toFixed(0)} KB)`);
