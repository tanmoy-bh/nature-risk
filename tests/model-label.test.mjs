import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL("../" + p, import.meta.url), "utf8");
const fnFrom = (src) => new Function(src.match(/function modelName\([^]*?\n\}/)[0] + "\nreturn modelName;")();

test("both pages turn a model id into a readable name", async () => {
  for (const f of ["src/lab.html", "src/app.html"]) {
    const modelName = fnFrom(await read(f));
    assert.equal(modelName("google/gemini-3.8-flash"), "Gemini 3.8 Flash", f);
    assert.equal(modelName("anthropic/claude-sonnet-5-5"), "Claude Sonnet 5.5", f);
    assert.equal(modelName(undefined), "AI", f);
  }
});

test("the committee note, chart readings and debrief name the model that wrote them", async () => {
  const lab = await read("src/lab.html"), app = await read("src/app.html");
  assert.match(lab, /Drafted by \$\{modelName\(out\.model\)\}/);
  assert.match(lab, /Written by \$\{modelName\(out\.model\)\}/);
  assert.match(app, /picked by \$\{modelName\(b\.model\)\}/);
});
