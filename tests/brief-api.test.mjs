import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { onRequestPost } from "../functions/api/brief.js";

const results = await readFile(new URL("../analysis/results.json", import.meta.url), "utf8");
const now = () => new Date().toUTCString();
const RSS = (src) => `<rss><channel>
<item><title>${src}: Indonesia's fires test sustainable palm oil</title><link>https://${src.toLowerCase()}.example/fires</link><pubDate>${now()}</pubDate><description>Fires burned 1,200 hectares of peat in Riau.</description></item>
<item><title>${src}: Drought hits Sabah palm estates</title><link>https://${src.toLowerCase()}.example/drought</link><pubDate>${now()}</pubDate><description>Rainfall fell 40% below normal in Sabah.</description></item>
</channel></rss>`;

let store, calls, model, feedsDown, clock;
// The number of the first article in the prompt whose line contains `words`.
const num = (prompt, words) => +prompt.split("\n").find((l) => l.includes(words)).match(/^\[(\d+)\]/)[1];
beforeEach(() => {
  store = new Map(); calls = { feed: 0, model: 0 }; feedsDown = false; clock = 0;
  model = (prompt) => ({ summary: "Fire and drought lead today's nature news.", stories: [
    { n: num(prompt, "fires"), channel: "Fire and haze", direction: "raises risk", regions: ["Indonesia"], commodities: ["Palm oil"], why: "1,200 hectares of peat burned in Riau." },
    { n: num(prompt, "Drought hits Sabah"), channel: "Drought and water", direction: "raises risk", regions: ["Malaysia"], commodities: ["Palm oil"], why: "Rainfall in Sabah was 40% below normal." } ] });
  globalThis.caches = { default: {
    match: async (k) => (store.has(k.url) ? new Response(store.get(k.url)) : undefined),
    put: async (k, r) => { store.set(k.url, await r.text()); },
  } };
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes("openrouter.ai")) {
      calls.model++;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(model(JSON.parse(opts.body).messages[1].content)) }, finish_reason: "stop" }] }));
    }
    calls.feed++;
    if (feedsDown) return new Response("down", { status: 503 });
    const name = String(url).includes("mongabay") ? "Mongabay" : String(url).includes("eco-business") ? "EcoBusiness" : String(url).includes("dialogue") ? "Dialogue" : "CarbonBrief";
    return new Response(RSS(name));
  };
});
const env = (key = "k") => ({ OPENROUTER_API_KEY: key, ASSETS: { fetch: async () => new Response(results) }, BRIEF_NOW: () => Date.now() + clock });
async function post(body = {}, e = env()) {
  const r = await onRequestPost({ request: new Request("https://x.pages.dev/api/brief", { method: "POST", body: JSON.stringify(body) }), env: e });
  return [r.status, await r.json()];
}

test("builds a debrief with links from the feeds and loans from the book", async () => {
  const [s, o] = await post();
  assert.equal(s, 200);
  assert.equal(o.source, "model");
  assert.equal(o.stories.length, 2);
  assert.match(o.stories[0].link, /^https:\/\/.*\.example\//);
  assert.ok(o.stories[1].loans.some((l) => l.id === "A19"), "Sabah drought touches Kinabatangan");
  assert.ok(o.generatedAt);
  assert.equal(calls.feed, 4);
  assert.equal(calls.model, 1);
});

test("serves the same debrief for 24 hours without fetching again", async () => {
  await post();
  clock = 23 * 3600000;
  const [, o] = await post();
  assert.equal(o.cached, true);
  assert.equal(calls.feed, 4);
  assert.equal(calls.model, 1);
  clock = 25 * 3600000;
  const [, o2] = await post();
  assert.equal(o2.cached, undefined);
  assert.equal(calls.model, 2);
});

test("refresh gets fresh news, but not more than once every 10 minutes", async () => {
  await post();
  clock = 5 * 60000;
  const [, o] = await post({ again: true });
  assert.equal(o.throttled, true);
  assert.equal(calls.model, 1);
  clock = 11 * 60000;
  const [, o2] = await post({ again: true });
  assert.equal(o2.source, "model");
  assert.equal(calls.model, 2);
});

test("without a key it shows ranked headlines, not an error", async () => {
  const [s, o] = await post({}, env(""));
  assert.equal(s, 200);
  assert.equal(o.source, "headlines");
  assert.ok(o.stories.length >= 1);
  assert.equal(calls.model, 0);
});

test("a draft with an invented number falls back to headlines", async () => {
  model = () => ({ summary: "S.", stories: [{ n: 1, channel: "Fire and haze", direction: "raises risk", regions: ["Indonesia"], commodities: [], why: "9,999 hectares burned." }] });
  const [, o] = await post();
  assert.equal(o.source, "headlines");
  assert.equal(calls.model, 2);
  assert.match(o.reason, /9999|9,999/);
});

test("when every feed is down it says so", async () => {
  feedsDown = true;
  const [s, o] = await post();
  assert.equal(s, 502);
  assert.match(o.error, /news/i);
  assert.equal(calls.model, 0);
});

test("a failed refresh keeps the good debrief", async () => {
  await post();
  clock = 11 * 60000;
  model = () => ({ summary: "S.", stories: [{ n: 1, channel: "Fire and haze", direction: "raises risk", regions: [], commodities: [], why: "9,999 hectares." }] });
  const [s, o] = await post({ again: true });
  assert.equal(s, 200);
  assert.equal(o.source, "model");
  assert.equal(o.refreshFailed, true);
  const [, again] = await post();
  assert.equal(again.source, "model", "the cache still holds the good debrief");
});

test("feeds down on refresh keeps the good debrief", async () => {
  await post();
  clock = 11 * 60000; feedsDown = true;
  const [s, o] = await post({ again: true });
  assert.equal(s, 200);
  assert.equal(o.refreshFailed, true);
  assert.equal(o.stories.length, 2);
});

test("a malformed story does not crash the function", async () => {
  model = () => ({ summary: "S.", stories: [null] });
  const [s, o] = await post();
  assert.equal(s, 200);
  assert.equal(o.source, "headlines");
});
