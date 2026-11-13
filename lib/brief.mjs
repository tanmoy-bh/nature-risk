// Daily nature debrief: read a few nature-news feeds, rank what matters to a farm-and-commodities loan book,
// and check the model's picks. The model only returns story numbers and labels: headlines, links, sources and
// dates always come from the feeds, and any number it writes must appear in the article it refers to.

import { badNumbers } from "./note.mjs";

export const FEEDS = [
  { name: "Mongabay", url: "https://news.mongabay.com/feed/" },
  { name: "Eco-Business", url: "https://www.eco-business.com/feeds/news/" },
  { name: "Dialogue Earth", url: "https://dialogue.earth/feed/" },
  { name: "Carbon Brief", url: "https://www.carbonbrief.org/feed/" },
];

export const CHANNELS = ["Deforestation rules", "Drought and water", "Buyer demand", "Fire and haze", "Protected areas and biodiversity", "Land and collateral", "Carbon and finance policy"];
export const DIRECTIONS = ["raises risk", "lowers risk", "mixed"];
const COUNTRY = { MY: "Malaysia", SG: "Singapore", ID: "Indonesia", VN: "Vietnam", TH: "Thailand", PH: "Philippines", LK: "Sri Lanka", AU: "Australia" };
const WINDOW_MS = 3 * 86400000, MAX_CANDIDATES = 30;

// ---------- feeds ----------
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()] ?? m);
const unwrap = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
const plain = (s) => decode(unwrap(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
function tag(block, names) {
  for (const n of names) {
    const m = block.match(new RegExp(`<${n}\\b[^>]*>([\\s\\S]*?)</${n}>`, "i"));
    if (m && m[1].trim()) return m[1];
  }
  return "";
}
function clip(s, n) { if (s.length <= n) return s; const cut = s.slice(0, n); return cut.slice(0, cut.lastIndexOf(" ")) + "…"; }

export function parseFeed(xml, source) {
  const blocks = String(xml).match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  return blocks.map((b) => {
    const href = b.match(/<link\b[^>]*href="([^"]+)"/i);
    const link = plain(tag(b, ["link"])) || (href ? decode(href[1]) : "");
    const when = Date.parse(plain(tag(b, ["pubDate", "published", "updated", "dc:date"])));
    return {
      title: plain(tag(b, ["title"])),
      link,
      date: Number.isNaN(when) ? null : new Date(when).toISOString(),
      source,
      summary: clip(plain(tag(b, ["description", "summary"])), 400),
    };
  }).filter((i) => i.title && /^https?:\/\//.test(i.link) && i.date);
}

// ---------- ranking ----------
const TOPIC = /deforest|eudr|palm oil|peat|haze|wildfire|fires?\b|drought|el ni[nñ]o|la ni[nñ]a|rainfall|flood|plantation|mangrove|rubber|cocoa|coffee|\brice\b|smallholder|forest|biodiversity|protected area|commodit|supply chain|traceab|sustainable finance|nature-related|tnfd|\bbank|lender|credit|moratorium|land use|agricultur|crop|harvest/gi;
const PLACE = /malaysia|indonesia|sabah|sarawak|borneo|kalimantan|sumatra|riau|jambi|aceh|singapore|vietnam|thailand|philippines|sri lanka|australia|asean|southeast asia|mekong/gi;
const hits = (re, s) => (s.match(re) || []).length;
function score(i) { const t = i.title, d = i.summary; return 2 * hits(TOPIC, t) + hits(TOPIC, d) + 3 * Math.min(1, hits(PLACE, t) + hits(PLACE, d)) + (hits(PLACE, t) ? 1 : 0); }
const norm = (t) => t.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

export function rankItems(items, now = Date.now()) {
  const seen = new Set(), out = [];
  for (const i of items) {
    const age = now - Date.parse(i.date);
    if (age < -3600000 || age > WINDOW_MS) continue;
    const k = norm(i.title); if (seen.has(k)) continue; seen.add(k);
    out.push({ ...i, score: score(i) });
  }
  return out.sort((a, b) => b.score - a.score || Date.parse(b.date) - Date.parse(a.date)).slice(0, MAX_CANDIDATES);
}

// ---------- the model's output ----------
const regionsOf = (results) => [...new Set(results.sites.map((s) => COUNTRY[s.cc]).filter(Boolean))].sort();
const commoditiesOf = (results) => [...new Set(results.sites.map((s) => s.commodity))].sort();

export const BRIEF_SYSTEM =
  "You are the morning nature-risk analyst for a bank that lends to farms and commodity producers in Southeast Asia and Australia. " +
  "From the numbered articles, pick the 3 to 5 that could most change how this book's loans are priced: deforestation rules and buyer demand, " +
  "drought, fire and water, protected areas, land values, and nature-related finance policy. Skip stories with no link to this book. " +
  "For each pick give its number, labels, and one plain-English sentence on why it matters to the lender. Use only facts in the articles; " +
  "never invent or calculate a number. The summary is one sentence on the day's theme.";

export function briefSchema(results) {
  return {
    type: "object", additionalProperties: false, required: ["summary", "stories"],
    properties: {
      summary: { type: "string", description: "One sentence on what today's nature news means for the book" },
      stories: { type: "array", minItems: 1, maxItems: 5, items: {
        type: "object", additionalProperties: false, required: ["n", "channel", "direction", "regions", "commodities", "why"],
        properties: {
          n: { type: "integer", description: "The article's number in the list" },
          channel: { type: "string", enum: CHANNELS },
          direction: { type: "string", enum: DIRECTIONS, description: "What it does to the risk of lending in the places it covers" },
          regions: { type: "array", items: { type: "string", enum: regionsOf(results) } },
          commodities: { type: "array", items: { type: "string", enum: commoditiesOf(results) }, description: "Empty when the story affects all crops" },
          why: { type: "string", description: "One sentence, at most 35 words, on why it matters to the lender" },
        } } },
    },
  };
}

export function promptFor(cands) {
  return "Articles:\n" + cands.map((c, i) => `[${i + 1}] ${c.source} · ${c.date.slice(0, 10)} · ${c.title} — ${c.summary}`).join("\n") + "\n\nWrite today's debrief.";
}

const text = (c) => `${c.title}\n${c.summary}`;
export function checkBrief(reply, cands, results) {
  const fail = (why) => ({ ok: false, why });
  if (!reply || typeof reply.summary !== "string" || !Array.isArray(reply.stories)) return fail("wrong shape");
  if (reply.stories.length < 1 || reply.stories.length > 5) return fail("story count");
  const R = new Set(regionsOf(results)), C = new Set(commoditiesOf(results)), used = new Set();
  for (const s of reply.stories) {
    if (!Number.isInteger(s.n) || s.n < 1 || s.n > cands.length || used.has(s.n)) return fail(`bad story number ${s.n}`);
    used.add(s.n);
    if (!CHANNELS.includes(s.channel) || !DIRECTIONS.includes(s.direction)) return fail("bad label");
    if (!Array.isArray(s.regions) || !s.regions.every((r) => R.has(r))) return fail("bad region");
    if (!Array.isArray(s.commodities) || !s.commodities.every((r) => C.has(r))) return fail("bad commodity");
    if (typeof s.why !== "string" || !s.why.trim()) return fail("missing why");
    const bad = badNumbers(s.why, text(cands[s.n - 1]));
    if (bad.length) return fail(`numbers not in article ${s.n}: ${bad.join(", ")}`);
  }
  const bad = badNumbers(reply.summary, cands.map(text).join("\n"));
  if (bad.length) return fail(`numbers not in the articles: ${bad.join(", ")}`);
  return { ok: true };
}

export function matchLoans(story, results) {
  const want = new Set(story.regions), crops = new Set(story.commodities || []);
  return results.sites
    .filter((s) => want.has(COUNTRY[s.cc]) && (!crops.size || crops.has(s.commodity)))
    .sort((a, b) => b.exp - a.exp)
    .map((s) => ({ id: s.id, name: s.name, commodity: s.commodity }));
}

const pick = (c) => ({ title: c.title, link: c.link, source: c.source, date: c.date });
export function briefFromModel(reply, cands, results) {
  return {
    summary: String(reply.summary).slice(0, 400),
    stories: reply.stories.map((s) => ({
      ...pick(cands[s.n - 1]), channel: s.channel, direction: s.direction, regions: s.regions, commodities: s.commodities,
      why: String(s.why).slice(0, 400), loans: matchLoans(s, results),
    })),
  };
}

export function fallbackBrief(cands) {
  return { summary: "", stories: cands.slice(0, 5).map(pick) };
}
