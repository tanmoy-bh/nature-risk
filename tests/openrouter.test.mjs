import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { askJSON } from "../lib/openrouter.mjs";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const env = { OPENROUTER_API_KEY: "k" };
const ask = () => askJSON(env, { system: "s", user: "u", schema: { type: "object" }, name: "n" });
function reply(choice) {
  let sent;
  globalThis.fetch = async (url, opts) => { sent = JSON.parse(opts.body); return new Response(JSON.stringify({ choices: [choice] })); };
  return () => sent;
}

test("asks for minimal thinking and leaves room for the answer", async () => {
  const sent = reply({ message: { content: '{"a":1}' }, finish_reason: "stop" });
  await ask();
  assert.deepEqual(sent().reasoning, { effort: "minimal" });
  assert.ok(sent().max_tokens >= 1200);
});

test("reads JSON wrapped in a code fence or surrounded by text", async () => {
  reply({ message: { content: '```json\n{"a":1}\n```' }, finish_reason: "stop" });
  assert.deepEqual((await ask()).reply, { a: 1 });
  reply({ message: { content: 'Here it is: {"a":2} hope that helps' }, finish_reason: "stop" });
  assert.deepEqual((await ask()).reply, { a: 2 });
});

test("says why a reply was unreadable", async () => {
  reply({ message: { content: '{"a":' }, finish_reason: "length" });
  const r = await ask();
  assert.match(r.error, /unreadable/);
  assert.match(r.error, /length/);
  reply({ message: { content: null }, finish_reason: "stop" });
  assert.match((await ask()).error, /empty/);
});
