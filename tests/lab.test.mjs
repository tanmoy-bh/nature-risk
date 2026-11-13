import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL("../" + p, import.meta.url), "utf8");

test("model lab results cover every farm loan in sites.json", async () => {
  const sites = JSON.parse(await read("analysis/sites.json"));
  const res = JSON.parse(await read("analysis/results.json"));
  assert.deepEqual(res.sites.map((s) => s.id), sites.map((s) => s.id));
  for (const s of sites) {
    const p = res.per[s.id];
    assert.ok(p, `missing per-site results for ${s.id}`);
    assert.equal(p.surface.base.length, res.grids.deficit.length);
    assert.equal(p.surface.base[0].length, res.grids.loss.length);
  }
});

test("the lab page has its placeholders and the desk links to it", async () => {
  const lab = await read("src/lab.html");
  assert.match(lab, /\/\*__RESULTS_VERSION__\*\//);
  assert.match(lab, /lab-results\.json/);
  const app = await read("src/app.html");
  assert.match(app, /href="lab"/);
  assert.match(app, /lab#\$\{a\.id\.toLowerCase\(\)\}/);
});

test("every Model lab chart can be explained", async () => {
  const lab = await read("src/lab.html");
  assert.match(lab, /aria-label="Explain this chart"/);
  assert.match(lab, /Explain this</);
  assert.match(lab, /fetch\("api\/explain"/);
  assert.match(lab, /Reading this chart/);
  assert.match(lab, /prefers-reduced-motion/);
  assert.match(lab, /createObjectStore\("explain"\)/);
  assert.doesNotMatch(lab, /openrouter/i);
});

test("the explain panel behaves well on touch and keyboard, and IndexedDB never blocks", async () => {
  const lab = await read("src/lab.html");
  assert.match(lab, /@media \(hover: ?hover\)\{[^}]*\.aibtn:hover \.tl/);
  assert.match(lab, /key==="Escape"[^\n]*closeExplain/);
  assert.match(lab, /aria-controls="\$\{k\}-explain"/);
  assert.match(lab, /onblocked=/);
  assert.match(lab, /onversionchange=/);
});

test("drafting shows an AI shimmer around the note and the chart reading", async () => {
  const lab = await read("src/lab.html");
  assert.match(lab, /\.busy::before/);
  assert.match(lab, /@property --ai-a/);
  assert.match(lab, /box\.classList\.add\("busy"\)/);
  assert.match(lab, /card\.classList\.add\("busy"\)/);
});
