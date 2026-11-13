import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL("../" + p, import.meta.url), "utf8");

test("every architecture tab has a panel, including the 3D view", async () => {
  const html = await read("src/app.html");
  const tabs = [...html.matchAll(/<button class="chip"[^>]*data-view="([^"]+)"/g)].map((m) => m[1]);
  const panels = [...html.matchAll(/<div class="panel archview" data-view="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(tabs.includes("3d"));
  assert.deepEqual([...tabs].sort(), [...panels].sort());
});

test("each board view embeds a published Archboard 3D board, loaded only when its tab opens", async () => {
  const html = await read("src/app.html");
  const frames = [...html.matchAll(/<iframe id="([^"]+)"([^>]*)>/g)];
  assert.deepEqual(frames.map((m) => m[1]).sort(), ["frame3d", "frameBank"]);
  const ids = new Set();
  for (const [, id, attrs] of frames) {
    const src = attrs.match(/data-src="([^"]+)"/)?.[1];
    assert.match(src, /^https:\/\/projects\.tanmoybh\.com\/archboard-3d\/v\/[a-z0-9]{8,32}$/, id);
    assert.doesNotMatch(attrs, /\ssrc=/, `${id}: no src until the tab opens`);
    ids.add(src);
  }
  assert.equal(ids.size, 2, "the two views show different boards");
  assert.match(html, /archboard:theme/); // follows the page's light and dark theme
});

for (const [file, min, zones] of [["src/arch-3d.archboard.json", 20, 6], ["src/arch-bank.archboard.json", 30, 6]]) {
  test(`the board behind ${file} is kept in the repo and is consistent`, async () => {
    const doc = JSON.parse(await read(file));
    assert.equal(doc.version, 1);
    const ids = new Set(doc.nodes.map((n) => n.id));
    assert.equal(ids.size, doc.nodes.length);
    assert.ok(doc.nodes.length >= min && doc.zones.length === zones);
    for (const e of doc.edges) assert.ok(ids.has(e.from) && ids.has(e.to), `${e.id} points at a missing component`);
    for (const e of doc.edges) if (e.step) assert.ok(e.step <= doc.steps.length);
  });
}
