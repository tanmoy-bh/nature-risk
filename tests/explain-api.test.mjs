import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { onRequestPost } from "../functions/api/explain.js";
import { onRequestPost as notePost } from "../functions/api/note.js";

const results = await readFile(new URL("../analysis/results.json", import.meta.url), "utf8");
let store, calls, reply;

beforeEach(() => {
  store = new Map();
  calls = 0;
  reply = (body) => {
    // A correct draft: copies the first fact line's value.
    const line = body.messages[1].content.split("\n").find((l) => l.startsWith("- "));
    return { look: "A chart.", shows: line.slice(2), matters: "It matters to the bank." };
  };
  globalThis.caches = { default: {
    match: async (k) => (store.has(k.url) ? new Response(store.get(k.url)) : undefined),
    put: async (k, r) => { store.set(k.url, await r.text()); },
  } };
  globalThis.fetch = async (url, opts) => {
    calls++;
    const content = JSON.stringify(reply(JSON.parse(opts.body)));
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
  };
});

const env = (key = "test-key") => ({ OPENROUTER_API_KEY: key, ASSETS: { fetch: async () => new Response(results) } });
async function post(handler, body, e = env()) {
  const r = await handler({ request: new Request("https://x.pages.dev/api/x", { method: "POST", body: JSON.stringify(body) }), env: e });
  return [r.status, await r.json()];
}
const A = { experiment: "exp-a", id: "A19", state: { am: "price", a: "base" } };

test("returns a checked model explanation and caches it", async () => {
  const [s1, o1] = await post(onRequestPost, A);
  assert.equal(s1, 200);
  assert.equal(o1.source, "model");
  assert.deepEqual(Object.keys(o1.explain), ["look", "shows", "matters"]);
  assert.ok(o1.written);
  assert.equal(calls, 1);
  const [, o2] = await post(onRequestPost, A);
  assert.equal(o2.cached, true);
  assert.equal(calls, 1);
});

test("falls back when the draft invents a number", async () => {
  reply = () => ({ look: "A chart.", shows: "The price rises 999 bps.", matters: "It matters." });
  const [s, o] = await post(onRequestPost, A);
  assert.equal(s, 200);
  assert.equal(o.source, "fallback");
  assert.equal(calls, 2);
  assert.match(o.reason, /999/);
});

test("falls back without a key", async () => {
  const [s, o] = await post(onRequestPost, A, env(""));
  assert.equal(s, 200);
  assert.equal(o.source, "fallback");
  assert.equal(calls, 0);
});

test("rejects unknown experiments and state", async () => {
  const [s1] = await post(onRequestPost, { ...A, state: { am: "foo", a: "base" } });
  const [s2] = await post(onRequestPost, { ...A, experiment: "exp-z" });
  assert.equal(s1, 400);
  assert.equal(s2, 400);
  assert.equal(calls, 0);
});

test("again skips the cache", async () => {
  await post(onRequestPost, A);
  const [, o] = await post(onRequestPost, { ...A, again: true });
  assert.equal(o.source, "model");
  assert.equal(o.cached, undefined);
  assert.equal(calls, 2);
});

test("the committee note still works through the shared helper", async () => {
  reply = (body) => {
    const m = body.messages[1].content.match(/Required price above funding cost: (\d+) bps without nature data, (\d+)/);
    return { headline: `From ${m[1]} to ${m[2]} bps.`, driver: "Forest loss.", action: "Stage 2.", caveat: "Coverage." };
  };
  const [s, o] = await post(notePost, { id: "A19", scenario: "base" });
  assert.equal(s, 200);
  assert.equal(o.source, "model");
  assert.equal(calls, 1);
});
