// POST /api/explain  {experiment: "exp-a", id: "A19", state: {am: "price", a: "base"}, again?: true}
//
// Explains one Model lab chart as it is set, in three short parts. The browser sends only the
// experiment, the place and the chart's settings, each checked against an allowlist; the facts come
// from the precomputed model results. Drafts with any number not in the facts are rejected, and after
// two rejected drafts (or with no key, or on a model error) a plain fallback is returned. Model drafts
// are cached for 24 hours per results version, model, experiment, place and settings.

import { EXPLAIN_SYSTEM, EXPLAIN_SCHEMA, EXPLAIN_KEYS, explainFacts, checkExplain, fallbackExplain } from "../../lib/explain.mjs";
import { askJSON, modelOf, shortHash, jsonResponse as json } from "../../lib/openrouter.mjs";

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Send JSON: {experiment, id, state}." }, 400); }

  const asset = await env.ASSETS.fetch(new URL("/lab-results.json", request.url));
  if (!asset.ok) return json({ error: "Model results are missing." }, 500);
  const text = await asset.text();
  const facts = explainFacts(JSON.parse(text), String(body?.experiment || ""), String(body?.id || "").toUpperCase(), body?.state || {});
  if (!facts) return json({ error: "Unknown chart, place or setting." }, 400);

  const model = modelOf(env);
  const cacheKey = new Request(`https://explain-cache.invalid/${await shortHash(text)}/${encodeURIComponent(model)}/${encodeURIComponent(facts.key)}`);
  if (!body.again) {
    const hit = await caches.default.match(cacheKey);
    if (hit) return json({ ...(await hit.json()), cached: true });
  }

  let explain = null, reason = "";
  if (!env.OPENROUTER_API_KEY) reason = "The cloud model is not configured yet.";
  else {
    for (let i = 0; i < 2 && !explain; i++) {
      const user = `Chart guide:\n${facts.guide}\n\nFacts:\n${facts.text}\n\nExplain this chart.${i ? " Use only numbers that appear in the guide or the facts, copied exactly." : ""}`;
      const { reply, error } = await askJSON(env, { system: EXPLAIN_SYSTEM, user, schema: EXPLAIN_SCHEMA, name: "chart_explanation" });
      if (error) { reason = error; continue; }
      const chk = checkExplain(reply, facts);
      if (chk.ok) explain = Object.fromEntries(EXPLAIN_KEYS.map((k) => [k, String(reply[k]).slice(0, 500)]));
      else reason = chk.bad.length ? `numbers not in the model: ${chk.bad.join(", ")}` : "incomplete draft";
    }
  }
  const written = new Date().toISOString();
  if (!explain) return json({ explain: fallbackExplain(facts), source: "fallback", reason, written });
  const out = { explain, source: "model", model, written };
  await caches.default.put(cacheKey, new Response(JSON.stringify(out), { headers: { "Cache-Control": "max-age=86400" } }));
  return json(out);
}

export const onRequestGet = () => json({ error: "Use POST." }, 405);
