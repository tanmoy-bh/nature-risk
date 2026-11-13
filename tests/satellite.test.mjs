import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../src/app.html", import.meta.url), "utf8");
const grab = (re) => { const m = app.match(re); assert.ok(m, "missing " + re); return m[0]; };
const satFrame = new Function(grab(/const SAT_Z=[^\n]*\n/) + grab(/function satFrame\([\s\S]*?\n\}\n/) + "return satFrame;")();

test("the satellite frame is a 3×3 tile grid centred on the place", () => {
  for (const [lat, lon] of [[5.53, 118.2], [1.35, 103.82], [3.2, 101.6], [6.1, 116.0]]) {
    const f = satFrame(lat, lon);
    assert.equal(f.tiles.length, 9);
    // the place sits in the middle tile
    const mid = f.tiles[4], n = 2 ** f.z;
    const fx = ((lon + 180) / 360) * n, fy = ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
    assert.equal(mid.x, Math.floor(fx));
    assert.equal(mid.y, Math.floor(fy));
    // the grid is shifted so the place lands at the centre of the frame
    assert.ok(f.left <= 0 && f.left >= -50, `left ${f.left}`);
    assert.ok(f.top <= 0 && f.top >= -50, `top ${f.top}`);
    assert.equal(f.width, 150);
    // a 1 km bar is a sensible share of the frame at this zoom
    assert.ok(f.kmPct > 10 && f.kmPct < 40, `km ${f.kmPct}`);
  }
});

test("the satellite strip shows five years with attribution, below the map", () => {
  assert.match(app, /SAT_YEARS=\[2021,2022,2023,2024,2025\]/);
  assert.match(app, /tiles\.maps\.eox\.at\/wmts\/1\.0\.0\/s2cloudless-\$\{y\}_3857/);
  assert.match(app, /Sentinel-2 cloudless/);
  assert.match(app, /EOX IT Services GmbH/);
  const map = app.indexOf('class="panel mapshell"'), sat = app.indexOf('id="nsat"'), trends = app.indexOf('id="ntrends"');
  assert.ok(map > 0 && sat > map && sat < trends, "strip sits between the map and the trends");
});

test("the Lender desk has a daily nature debrief kept for 24 hours", () => {
  const desk = app.indexOf('id="screen-desk"'), brief = app.indexOf('id="brief"'), stats = app.indexOf('class="panel stats"');
  assert.ok(desk > 0 && brief > desk && brief < stats, "debrief sits above the desk stats");
  assert.match(app, />Load daily debrief</);
  assert.match(app, /fetch\("api\/brief"/);
  assert.match(app, /86400000/);
  assert.match(app, /createObjectStore\("brief"\)/);
  assert.match(app, /rel="noopener"/);
  assert.doesNotMatch(app, /sk-or-|OPENROUTER_API_KEY|openrouter\.ai\/api/i, "no key or direct model call in the page");
});

test("debrief and satellite viewer polish from review", () => {
  assert.match(app, /function openLoan[^\n]*state\.region="all"/, "a loan chip shows the loan even under a region filter");
  assert.match(app, /REFRESH_GAP=600000/, "the page also limits Refresh to once every 10 minutes");
  assert.match(app, /const \{throttled,cached,refreshFailed,\.\.\.keep\}=/, "notices are not saved with the debrief");
  assert.match(app, /r\.status===401/, "an expired session gets a plain message");
  assert.match(app, /if\(state\.screen!=="map"\) closeSat\(\)/, "the satellite viewer closes when leaving the map");
  assert.match(app, /CC BY-NC-SA 4\.0/);
  assert.doesNotMatch(grab(/function satImg\([\s\S]*?\n\}\n/), /<div/, "satImg builds spans, so it is valid inside a button");
});
