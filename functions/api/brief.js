// POST /api/brief  {again?: true}
//
// The daily nature debrief for the Lender desk. Reads four nature-news feeds, ranks the last three days'
// stories for a farm-and-commodities book, and asks the model to pick the 3-5 that matter, by number only.
// Headlines and links always come from the feeds; numbers in the model's text must appear in the article.
// A debrief is served for 24 hours; Refresh rebuilds it, at most once every 10 minutes. Without a key or a
// usable draft, the ranked headlines are shown instead (kept for 15 minutes).

import { FEEDS, BRIEF_SYSTEM, briefSchema, promptFor, parseFeed, rankItems, checkBrief, briefFromModel, fallbackBrief } from "../../lib/brief.mjs";
import { askJSON, modelOf, shortHash, jsonResponse as json } from "../../lib/openrouter.mjs";

const DAY = 86400000, HEADLINES_TTL = 15 * 60000, REFRESH_GAP = 10 * 60000;

async function readFeed(f) {
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 6000);
  try {
    const r = await fetch(f.url, { signal: ac.signal, headers: { "User-Agent": "NatureRiskDesk/1.0 (+https://projects.tanmoybh.com/nature-risk)", Accept: "application/rss+xml, application/xml, text/xml" } });
    return r.ok ? parseFeed(await r.text(), f.name) : [];
  } catch { return []; } finally { clearTimeout(timer); }
}

export async function onRequestPost({ request, env }) {
  let body = {};
  try { body = await request.json(); } catch {}
  const now = env.BRIEF_NOW ? env.BRIEF_NOW() : Date.now();

  const asset = await env.ASSETS.fetch(new URL("/lab-results.json", request.url));
  if (!asset.ok) return json({ error: "Model results are missing." }, 500);
  const text = await asset.text(), results = JSON.parse(text), model = modelOf(env);

  const cacheKey = new Request(`https://brief-cache.invalid/${await shortHash(text)}/${encodeURIComponent(model)}`);
  const hit = await caches.default.match(cacheKey);
  if (hit) {
    const prev = await hit.json(), age = now - prev.generatedAtMs, ttl = prev.source === "model" ? DAY : HEADLINES_TTL;
    if (!body.again && age < ttl) return json({ ...prev, cached: true });
    if (body.again && age < REFRESH_GAP) return json({ ...prev, cached: true, throttled: true });
  }

  const items = (await Promise.all(FEEDS.map(readFeed))).flat();
  if (!items.length) return json({ error: "Couldn't reach the news sources right now. Try again in a few minutes." }, 502);
  const cands = rankItems(items, now);

  let brief = null, reason = "";
  if (!env.OPENROUTER_API_KEY) reason = "The cloud model is not configured yet.";
  else if (cands.length) {
    const schema = briefSchema(results);
    for (let i = 0; i < 2 && !brief; i++) {
      const user = promptFor(cands) + (i ? " Use only numbers that appear in the article you cite, copied exactly." : "");
      const { reply, error } = await askJSON(env, { system: BRIEF_SYSTEM, user, schema, name: "nature_debrief", timeoutMs: 20000 });
      if (error) { reason = error; break; }
      const chk = checkBrief(reply, cands, results);
      if (chk.ok) brief = briefFromModel(reply, cands, results); else reason = chk.why;
    }
  }

  const base = { generatedAt: new Date(now).toISOString(), generatedAtMs: now, read: cands.length, sources: FEEDS.map((f) => f.name) };
  const out = brief ? { ...brief, ...base, source: "model", model } : { ...fallbackBrief(cands), ...base, source: "headlines", reason };
  await caches.default.put(cacheKey, new Response(JSON.stringify(out), { headers: { "Cache-Control": `max-age=${brief ? 86400 : 900}` } }));
  return json(out);
}

export const onRequestGet = () => json({ error: "Use POST." }, 405);
