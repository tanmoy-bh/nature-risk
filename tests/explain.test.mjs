import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { EXPERIMENTS, explainFacts, checkExplain, fallbackExplain } from "../lib/explain.mjs";

const results = JSON.parse(await readFile(new URL("../analysis/results.json", import.meta.url), "utf8"));
const DEFAULTS = { "exp-a": { am: "price", a: "base" }, "exp-e": { e: "base", ev: "3d" }, "exp-h": { hv: "move", hs: "base" } };

// Every combination of allowed state values for one experiment.
function states(exp) {
  let out = [{}];
  for (const [k, vals] of Object.entries(EXPERIMENTS[exp].state)) out = out.flatMap((s) => vals.map((v) => ({ ...s, [k]: v })));
  return out;
}

test("explainFacts returns facts for every experiment at its default state", () => {
  for (const exp of ["exp-a", "exp-b", "exp-c", "exp-d", "exp-e", "exp-f", "exp-g", "exp-h"]) {
    const f = explainFacts(results, exp, "A19", DEFAULTS[exp] || {});
    assert.ok(f, exp);
    assert.ok(f.text.trim().length > 20, `${exp} text`);
    assert.ok(f.guide.trim().length > 20, `${exp} guide`);
  }
});

test("explainFacts rejects unknown input", () => {
  assert.equal(explainFacts(results, "exp-z", "A19", {}), null);
  assert.equal(explainFacts(results, "exp-b", "A99", {}), null);
  assert.equal(explainFacts(results, "exp-a", "A19", { am: "foo", a: "base" }), null);
  assert.equal(explainFacts(results, "exp-b", "A19", { x: "1" }), null);
});

test("book-wide experiments share one cache key", () => {
  assert.equal(explainFacts(results, "exp-f", "A19", {}).key, explainFacts(results, "exp-f", "A03", {}).key);
  assert.equal(explainFacts(results, "exp-g", "A19", {}).key, explainFacts(results, "exp-g", "A03", {}).key);
  assert.notEqual(explainFacts(results, "exp-b", "A19", {}).key, explainFacts(results, "exp-b", "A03", {}).key);
});

test("the fallback passes the number check for every experiment, place and state", () => {
  for (const exp of Object.keys(EXPERIMENTS)) for (const s of results.sites) for (const st of states(exp)) {
    const f = explainFacts(results, exp, s.id, st);
    const chk = checkExplain(fallbackExplain(f), f);
    assert.ok(chk.ok, `${exp} ${s.id} ${JSON.stringify(st)} bad=${chk.bad}`);
  }
});

test("the number check rejects invented numbers", () => {
  const f = explainFacts(results, "exp-c", "A19", {});
  const chk = checkExplain({ look: "A histogram.", shows: "The price rises 999 bps.", matters: "It matters." }, f);
  assert.equal(chk.ok, false);
  assert.ok(chk.bad.includes("999"));
});

test("fallback text reads cleanly for every experiment", () => {
  const d = fallbackExplain(explainFacts(results, "exp-d", "A19", {}));
  assert.doesNotMatch(d.shows, /:[^.]*:/, "no double colon in D");
  const g = fallbackExplain(explainFacts(results, "exp-g", "A19", {}));
  assert.match(g.shows, /without nature data/);
});

test("the risk map's facts count loans that change zone", () => {
  const h = explainFacts(results, "exp-h", "A19", { hv: "move", hs: "base" });
  assert.match(h.text, /Loans that change zone: \d+/);
  assert.doesNotMatch(h.text, /safer ground|riskier ground/);
});
