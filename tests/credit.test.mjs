import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { creditTable } from "../lib/credit.mjs";

const read = (p) => readFile(new URL("../" + p, import.meta.url), "utf8");

test("Kinabatangan reads +25 bps, matching its 152 to 177 bps price", async () => {
  const res = JSON.parse(await read("analysis/results.json"));
  const k = res.sites.find((s) => /Kinabatangan/.test(s.name));
  assert.equal(creditTable(res)[k.id].base.bps, 25);
});

test("the desk's pricing comes from the credit model for every farm loan and scenario", async () => {
  const res = JSON.parse(await read("analysis/results.json"));
  const t = creditTable(res);
  assert.equal(Object.keys(t).length, 27);
  for (const s of res.sites) for (const k of ["base", "drought", "defor"]) {
    assert.equal(t[s.id][k].bps, Math.round(s[k].spN) - Math.round(s[k].sp0), `${s.id} ${k}`);
    assert.equal(t[s.id][k].stage, s[k].stage);
  }
});

test("the desk's exposure-weighted signal matches the Model lab's book figure", async () => {
  const res = JSON.parse(await read("analysis/results.json"));
  const t = creditTable(res);
  const tot = res.sites.reduce((a, s) => a + s.exp, 0);
  const w = res.sites.reduce((a, s) => a + t[s.id].base.bps * s.exp, 0) / tot;
  assert.ok(Math.abs(w - res.portfolio.base.wbps) < 0.5, `${w} vs ${res.portfolio.base.wbps}`);
});

test("the lender desk uses the injected credit table, not the old label rule", async () => {
  const app = await read("src/app.html");
  assert.match(app, /const CREDIT = \/\*__CREDIT__\*\/\{\};/);
  assert.doesNotMatch(app, /25 \+ Math\.round\(Math\.max\(0,60-score\)\*0\.8\)/);
  assert.doesNotMatch(app, /sustainability-linked step-down while the Gain label holds/);
  const build = await read("scripts/build.mjs");
  assert.match(build, /creditTable/);
});
