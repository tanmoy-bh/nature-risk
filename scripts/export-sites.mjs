// Exports each farm loan's real nature indicators from src/app.html to analysis/sites.json,
// the input of analysis/model_lab.py. Run: node scripts/export-sites.mjs
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = await readFile(join(root, "src/app.html"), "utf8");
const start = app.indexOf("const ASSETS = [");
const end = app.indexOf("// ---------- state ----------");
if (start < 0 || end < start) throw new Error("Could not find the data block in src/app.html");

const ctx = {};
vm.runInNewContext(app.slice(start, end) + "\nthis.ASSETS = ASSETS; this.evaluate = evaluate;", ctx);
const sites = ctx.ASSETS.filter((a) => a.kind === "agri").map((a) => ({
  id: a.id, what: a.what, where: a.where, cc: a.cc, exp: a.exp,
  loss: a.raw.loss, deficit: a.raw.deficit || 0,
  ndvi: a.real && a.real.n19 != null && a.real.n25 != null ? ((a.real.n25 - a.real.n19) / a.real.n19) * 100 : null,
  stress: a.raw.stress || 0, pa: a.raw.dist,
  score: ctx.evaluate(a, "base").score, label: ctx.evaluate(a, "base").label,
  ruleBps: { base: ctx.evaluate(a, "base").bps, drought: ctx.evaluate(a, "drought").bps, defor: ctx.evaluate(a, "defor").bps },
}));
await writeFile(join(root, "analysis/sites.json"), JSON.stringify(sites, null, 1) + "\n");
console.log(`Wrote analysis/sites.json (${sites.length} farm loans)`);
