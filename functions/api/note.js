// POST /api/note  {id: "A19", scenario: "base", again?: true}
//
// Drafts a credit committee note for one loan with a cloud model through OpenRouter.
// The API key lives only in the Pages secret OPENROUTER_API_KEY (set from the GitHub secret of the
// same name by the deploy workflow) and never reaches the browser. The passphrase middleware guards
// this route like every other one.
//
// Guardrails: the browser sends only a loan id and a scenario; the prompt is built here from the
// precomputed model results. The model only words those numbers: any number not in the facts rejects
// the draft, and after two rejected drafts a fixed template is returned instead. Output length is
// capped, and notes are cached per loan, scenario and results version so repeat clicks cost nothing.

import { NOTE_SYSTEM, NOTE_SCHEMA, NOTE_KEYS, SCENARIOS, noteFacts, checkNote, templateNote } from "../../lib/note.mjs";
import { askJSON, modelOf, shortHash, jsonResponse as json } from "../../lib/openrouter.mjs";

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Send JSON: {id, scenario}." }, 400); }
  const id = String(body?.id || "").toUpperCase(), sc = String(body?.scenario || "base");
  if (!/^A\d{2}$/.test(id) || !SCENARIOS[sc]) return json({ error: "Unknown loan or scenario." }, 400);

  const asset = await env.ASSETS.fetch(new URL("/lab-results.json", request.url));
  if (!asset.ok) return json({ error: "Model results are missing." }, 500);
  const text = await asset.text();
  const facts = noteFacts(JSON.parse(text), id, sc);
  if (!facts) return json({ error: "Unknown loan or scenario." }, 400);

  const model = modelOf(env);
  const cacheKey = new Request(`https://note-cache.invalid/${await shortHash(text)}/${encodeURIComponent(model)}/${id}/${sc}`);
  if (!body.again) { const hit = await caches.default.match(cacheKey); if (hit) return json({ ...(await hit.json()), cached: true }); }

  let note = null, reason = "";
  if (!env.OPENROUTER_API_KEY) reason = "The cloud model is not configured yet.";
  else {
    for (let i = 0; i < 2 && !note; i++) {
      const user = `Facts:\n${facts.text}\n\nWrite the committee note.${i ? " Use only numbers that appear in the facts, copied exactly." : ""}`;
      const { reply, error } = await askJSON(env, { system: NOTE_SYSTEM, user, schema: NOTE_SCHEMA, name: "committee_note" });
      if (error) { reason = error; continue; }
      const chk = checkNote(reply, facts);
      if (chk.ok) note = Object.fromEntries(NOTE_KEYS.map((k) => [k, String(reply[k]).slice(0, 400)]));
      else reason = chk.bad.length ? `numbers not in the model: ${chk.bad.join(", ")}` : "incomplete draft";
    }
  }
  const out = note
    ? { note, source: "model", model, loan: `${facts.name}, ${facts.what}`, scenario: SCENARIOS[sc] }
    : { note: templateNote(facts), source: "template", reason, loan: `${facts.name}, ${facts.what}`, scenario: SCENARIOS[sc] };
  if (note) await caches.default.put(cacheKey, new Response(JSON.stringify(out), { headers: { "Cache-Control": "max-age=604800" } }));
  return json(out);
}

export const onRequestGet = () => json({ error: "Use POST." }, 405);
