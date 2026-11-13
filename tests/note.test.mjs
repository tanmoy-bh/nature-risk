import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { noteFacts, badNumbers, checkNote, templateNote } from "../lib/note.mjs";

const read = (p) => readFile(new URL("../" + p, import.meta.url), "utf8");

test("note facts come from the model results for a known loan and scenario only", async () => {
  const res = JSON.parse(await read("analysis/results.json"));
  const f = noteFacts(res, "A19", "base");
  assert.match(f.text, /Required price above funding cost: \d+ bps without nature data, \d+ bps with nature data/);
  assert.match(f.text, /90% range of the price change/);
  assert.equal(noteFacts(res, "A99", "base"), null);
  assert.equal(noteFacts(res, "A19", "made-up"), null);
});

test("the number check rejects numbers the model did not produce", () => {
  const facts = { text: "- Price: 152 bps without nature data, 177 bps with\n- Chance of default: 1.04% without, 1.31% with\n- Expected loss: $131k\n- IFRS 9 stage: Stage 2\n- 90% range: +6 to +71 bps" };
  assert.deepEqual(badNumbers("Price rises from 152 to 177 bps; default chance 1.3%; Stage 2; range +6 to +71.", facts.text), []);
  assert.deepEqual(badNumbers("Price rises by 40 bps and expected loss is $250k.", facts.text), ["40", "250"]);
  const good = { headline: "Price goes from 152 to 177 bps.", driver: "Default chance 1.04% to 1.31%.", action: "Stage 2.", caveat: "Range +6 to +71 bps." };
  assert.equal(checkNote(good, facts).ok, true);
  assert.equal(checkNote({ ...good, caveat: "" }, facts).ok, false);
  assert.equal(checkNote({ ...good, headline: "Up 40 bps." }, facts).ok, false);
});

test("the template note passes its own number check for every loan", async () => {
  const res = JSON.parse(await read("analysis/results.json"));
  for (const s of res.sites) for (const sc of ["base", "drought", "defor", "engage"]) {
    const f = noteFacts(res, s.id, sc);
    assert.equal(checkNote(templateNote(f), f).ok, true, `${s.id} ${sc}`);
  }
});

test("the API key stays on the server", async () => {
  const lab = await read("src/lab.html");
  assert.doesNotMatch(lab, /openrouter|OPENROUTER|sk-or-/i);
  assert.match(lab, /fetch\("api\/note"/);
  const fn = await read("functions/api/note.js");
  assert.match(fn, /env\.OPENROUTER_API_KEY/);
  assert.doesNotMatch(fn, /sk-or-/);
});
