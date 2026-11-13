import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { FEEDS, parseFeed, rankItems, briefSchema, checkBrief, matchLoans, briefFromModel, fallbackBrief } from "../lib/brief.mjs";

const results = JSON.parse(await readFile(new URL("../analysis/results.json", import.meta.url), "utf8"));
const NOW = Date.parse("2026-11-13T08:00:00Z");
const day = (d) => new Date(NOW - d * 86400000).toUTCString();

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>
<item><title><![CDATA[Indonesia's fires test the credibility of sustainable palm oil]]></title><link>https://example.org/a</link>
<pubDate>${day(0.2)}</pubDate><description><![CDATA[<p>Fires burned 1,200 hectares of peat in Riau &amp; Jambi.</p>]]></description></item>
<item><title>Jaguars in the Pantanal</title><link>https://example.org/b</link><pubDate>${day(0.5)}</pubDate><description>Big cats.</description></item>
<item><title>EU delays EUDR deforestation rules for smallholders</title><link>https://example.org/c</link><pubDate>${day(1)}</pubDate><description>Palm oil and cocoa exporters get 12 more months.</description></item>
<item><title>Old drought story in Sabah</title><link>https://example.org/d</link><pubDate>${day(5)}</pubDate><description>El Niño.</description></item>
</channel></rss>`;

test("uses the four verified feeds", () => {
  assert.deepEqual(FEEDS.map((f) => f.name), ["Mongabay", "Eco-Business", "Dialogue Earth", "Carbon Brief"]);
  for (const f of FEEDS) assert.match(f.url, /^https:\/\//);
});

test("parseFeed reads titles, links, dates and plain-text summaries", () => {
  const items = parseFeed(RSS, "Eco-Business");
  assert.equal(items.length, 4);
  assert.equal(items[0].title, "Indonesia's fires test the credibility of sustainable palm oil");
  assert.equal(items[0].link, "https://example.org/a");
  assert.equal(items[0].source, "Eco-Business");
  assert.equal(items[0].summary, "Fires burned 1,200 hectares of peat in Riau & Jambi.");
  assert.ok(!Number.isNaN(Date.parse(items[0].date)));
});

test("rankItems keeps the last 3 days, puts relevant stories first and drops duplicates", () => {
  const items = [...parseFeed(RSS, "A"), ...parseFeed(RSS, "B")];
  const ranked = rankItems(items, NOW);
  const titles = ranked.map((i) => i.title);
  assert.ok(!titles.includes("Old drought story in Sabah"), "older than 3 days");
  assert.equal(new Set(titles).size, titles.length, "no duplicates");
  assert.ok(titles.indexOf("Jaguars in the Pantanal") > titles.indexOf("EU delays EUDR deforestation rules for smallholders"));
  assert.ok(ranked.length <= 30);
});

test("checkBrief accepts a grounded reply and rejects invented numbers, bad numbers and bad labels", () => {
  const cands = rankItems(parseFeed(RSS, "Eco-Business"), NOW);
  const fires = cands.findIndex((c) => c.title.startsWith("Indonesia's fires")) + 1;
  const good = { summary: "Fires and a rule delay lead today.", stories: [
    { n: fires, channel: "Fire and haze", direction: "raises risk", regions: ["Indonesia"], commodities: ["Palm oil"], why: "1,200 hectares of peat burned in Riau and Jambi, where the book lends to palm estates." } ] };
  assert.equal(checkBrief(good, cands, results).ok, true);
  assert.equal(checkBrief({ ...good, stories: [{ ...good.stories[0], why: "5,000 hectares burned." }] }, cands, results).ok, false);
  assert.equal(checkBrief({ ...good, stories: [{ ...good.stories[0], n: 99 }] }, cands, results).ok, false);
  assert.equal(checkBrief({ ...good, stories: [{ ...good.stories[0], channel: "Gossip" }] }, cands, results).ok, false);
  assert.equal(checkBrief({ ...good, stories: [good.stories[0], good.stories[0]] }, cands, results).ok, false, "same story twice");
});

test("briefSchema limits labels to the book's countries and commodities", () => {
  const s = briefSchema(results).properties.stories.items.properties;
  assert.ok(s.regions.items.enum.includes("Malaysia"));
  assert.ok(s.commodities.items.enum.includes("Palm oil"));
  assert.ok(!s.regions.items.enum.includes("Brazil"));
});

test("matchLoans finds loans by country and commodity", () => {
  const ids = matchLoans({ regions: ["Malaysia"], commodities: ["Palm oil"] }, results).map((l) => l.id);
  assert.ok(ids.includes("A19") && ids.includes("A03"));
  assert.ok(matchLoans({ regions: ["Vietnam"], commodities: ["Coffee"] }, results).every((l) => l.commodity === "Coffee"));
  assert.ok(matchLoans({ regions: ["Malaysia"], commodities: [] }, results).length > ids.length - 1);
});

test("links and headlines always come from the feed, never from the model", () => {
  const cands = rankItems(parseFeed(RSS, "Eco-Business"), NOW);
  const b = briefFromModel({ summary: "S.", stories: [{ n: 1, channel: "Deforestation rules", direction: "lowers risk", regions: ["Indonesia"], commodities: ["Palm oil"], why: "W.", link: "https://evil.example", title: "Fake" }] }, cands, results);
  assert.equal(b.stories[0].link, cands[0].link);
  assert.equal(b.stories[0].title, cands[0].title);
  assert.ok(Array.isArray(b.stories[0].loans));
});

test("the fallback lists the top headlines without analysis", () => {
  const cands = rankItems(parseFeed(RSS, "Eco-Business"), NOW);
  const f = fallbackBrief(cands);
  assert.ok(f.stories.length >= 1 && f.stories.length <= 5);
  assert.equal(f.stories[0].why, undefined);
});
