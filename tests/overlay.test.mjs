import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../src/app.html", import.meta.url), "utf8");
const grab = (re) => { const m = app.match(re); assert.ok(m, "missing " + re); return m[0]; };
const lib = new Function(grab(/\/\/ ---------- map layers: pure helpers ----------[\s\S]*?\/\/ ---------- map layers: end helpers ----------/) + "\nreturn {OVL, ovlParseColormap, ovlDates, ovlPaint};")();

const XML = `<ColorMaps><ColorMap title="Classifications"><Entries><ColorMapEntry rgb="191,191,191" transparent="true" value="[-INF,0.1)"/></Entries></ColorMap><ColorMap title="No Data"><Entries><ColorMapEntry rgb="64,64,64" transparent="true" value="[0,1)" nodata="true"/></Entries></ColorMap>
<ColorMap title="Land Surface Temperature" units="K"><Entries>
<ColorMapEntry rgb="201,0,255" transparent="false" value="[0.02,200.00)"/>
<ColorMapEntry rgb="98,255,26" transparent="false" value="[274.40,275.00)"/>
<ColorMapEntry rgb="255,4,0" transparent="false" value="[349.40,350.00)"/>
<ColorMapEntry rgb="255,1,0" transparent="false" value="[350.02,652.00)"/></Entries></ColorMap>
<ColorMap title="Snow Rate"><Entries><ColorMapEntry rgb="1,2,3" transparent="false" value="[0.1,0.2)"/></Entries></ColorMap></ColorMaps>`;

test("reads NASA's colour table into colour → value, skipping no-data and later maps", () => {
  const m = lib.ovlParseColormap(XML);
  assert.equal(m.get("98,255,26"), 274.7);
  assert.equal(m.get("255,4,0"), 349.7);
  assert.equal(m.get("201,0,255"), 200, "open-ended ranges use their inner edge");
  assert.equal(m.get("255,1,0"), 350.02);
  assert.equal(m.has("64,64,64"), false);
  assert.equal(m.has("1,2,3"), false, "the snow map is not mixed into rain");
});

test("three layers, each with a source, a unit and a local colour scale", () => {
  assert.deepEqual(Object.keys(lib.OVL), ["veg", "temp", "rain"]);
  assert.equal(lib.OVL.veg.layer, "MODIS_Terra_L3_NDVI_Monthly");
  assert.equal(lib.OVL.temp.layer, "MODIS_Terra_L3_Land_Surface_Temp_Monthly_Day");
  assert.equal(lib.OVL.rain.layer, "IMERG_Precipitation_Rate");
  // temperature is shown in °C on a local 20–36 °C scale (Oct 2026 readings here are about 22–28 °C); rain in mm a day on a log scale
  const [cold, hot] = [lib.ovlPaint("temp", 20 + 273.15), lib.ovlPaint("temp", 36 + 273.15)];
  assert.notDeepEqual(lib.ovlPaint("temp", 22 + 273.15), lib.ovlPaint("temp", 28 + 273.15), "contrast where readings sit");
  assert.notDeepEqual(cold, hot);
  assert.deepEqual(lib.ovlPaint("temp", 5 + 273.15), cold, "clamped below the range");
  assert.notDeepEqual(lib.ovlPaint("rain", 0.2), lib.ovlPaint("rain", 2));
  assert.equal(lib.ovlPaint("rain", 0.05), null, "no rain is transparent");
});

test("tries the latest month (or day) first, then steps back", () => {
  const now = new Date("2026-11-13T09:00:00Z");
  assert.deepEqual(lib.ovlDates("monthly", now), ["2026-11-01", "2026-10-01", "2026-09-01", "2026-08-01"]);
  assert.deepEqual(lib.ovlDates("daily", now).slice(0, 3), ["2026-11-12", "2026-11-11", "2026-11-10"]);
  assert.deepEqual(lib.ovlDates("monthly", new Date("2026-01-05T00:00:00Z"))[1], "2025-12-01");
});

test("the map has a layer switcher with a legend, clipped to land", () => {
  assert.match(app, /role="group" aria-label="Map layer"/);
  for (const l of ["Off", "Vegetation", "Temperature", "Rainfall"]) assert.match(app, new RegExp(`>${l}<`));
  assert.match(app, /<clipPath id="landclip">/);
  assert.match(app, /id="ovl"/);
  assert.match(app, /id="ovlkey"/);
  assert.match(app, /gibs\.earthdata\.nasa\.gov\/wms\/epsg4326\/best\/wms\.cgi/);
});
