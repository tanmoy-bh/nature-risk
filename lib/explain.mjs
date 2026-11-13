// Explain this chart: the facts a language model may use to explain one Model lab chart as it is set,
// the output shape, the number check and a plain fallback. Shared by functions/api/explain.js and the tests.
// Facts come only from the precomputed model results; the browser sends an experiment, a place and the
// chart's settings, each checked against the allowlist below.

import { badNumbers, fmt, pct, $k, $m } from "./note.mjs";

const SCN = { base: "Baseline", drought: "Repeat of driest year", defor: "Stricter deforestation rule", engage: "Engagement" };
const SCNS = Object.keys(SCN);

export const EXPERIMENTS = {
  "exp-a": { state: { am: ["price", "pd", "el"], a: SCNS }, perPlace: true },
  "exp-b": { state: {}, perPlace: true },
  "exp-c": { state: {}, perPlace: true },
  "exp-d": { state: {}, perPlace: true },
  "exp-e": { state: { e: ["base", "drought"], ev: ["3d", "map"] }, perPlace: true },
  "exp-f": { state: {}, perPlace: false },
  "exp-g": { state: {}, perPlace: false },
  "exp-h": { state: { hv: ["move", "without", "with"], hs: SCNS }, perPlace: true },
};

export const EXPLAIN_KEYS = ["look", "shows", "matters"];
export const EXPLAIN_SYSTEM =
  "You explain one chart from a bank's nature-risk model to a non-technical reader, such as a board member. " +
  "Use only the chart guide and the facts you are given. Never calculate, estimate or invent a number: copy numbers exactly " +
  "as they are written, with their units. Plain English, no jargon. Each field is at most 2 sentences and 45 words.";
export const EXPLAIN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: EXPLAIN_KEYS,
  properties: {
    look: { type: "string", description: "What you're looking at: what the axes, marks and colours mean" },
    shows: { type: "string", description: "What it shows here: the reading for this place and these settings, with the key numbers" },
    matters: { type: "string", description: "Why it matters to a bank, in one sentence" },
  },
};

const MEASURE = {
  price: { name: "required price above funding cost", f0: (v) => `${Math.round(v.sp0)} bps`, fN: (v) => `${Math.round(v.spN)} bps` },
  pd: { name: "chance of default in a year", f0: (v) => pct(v.pd0, 2), fN: (v) => pct(v.pdN, 2) },
  el: { name: "expected loss a year", f0: (v) => $k(v.el0), fN: (v) => $k(v.elN) },
};

const GUIDE = {
  "exp-a": (st) => `Each row is one loan in the book. The grey dot is the ${MEASURE[st.am].name} in the traditional view and the coloured dot is the same measure with nature data, joined by a line. Green means nature data makes the loan cheaper or safer, red means dearer or riskier; the selected place is circled.`,
  "exp-b": () => "Two curves show how often each level of debt service coverage comes up across simulated versions of next year: one without nature data and one with it. The shaded band on the left is coverage below 1, where the borrower cannot pay.",
  "exp-c": () => "A histogram of the price change across many re-pricings, each with the uncertain assumptions drawn differently. The solid line is the central estimate and the dotted lines are the 5th and 95th percentiles.",
  "exp-d": () => "Each bar is one assumption, moved from the low to the high end of its range while everything else stays central. The vertical line is the central price change; longer bars matter more, and the two colours show the low and the high end.",
  "exp-e": (st) => st.ev === "3d"
    ? "A 3D surface of the price change for every mix of forest loss and rainfall deficit. Height and colour show the change in bps, from cheaper to dearer, and the dark dot marks this place."
    : "A contour map, seen from above, of the price change for every mix of forest loss (across) and rainfall deficit (up). Colour and the labelled lines show the change in bps, and the dark dot marks this place.",
  "exp-f": () => "Two curves show the chance that the whole book loses more than a given amount in a year: one without nature data and one with it. Further right means bigger losses; the far right is rare, severe years.",
  "exp-g": () => "Three bar charts: expected loss a year, regulatory capital and IFRS 9 provisions. Each shows four scenarios, with a bar without nature data next to a bar with it.",
  "exp-h": (st) => `A map of the book: each bubble is a loan, placed by its chance of default (left to right, log scale) and its size (bottom to top). The background shows expected loss a year: green small, amber middle, red large. ${st.hv === "move" ? "Arrows show how each loan moves once nature data is added." : st.hv === "without" ? "Bubbles show the traditional view only." : "Bubbles show the view with nature data only."} The bar below totals the lending in each zone.`,
};

const MATTERS = {
  "exp-a": "It shows which loans the bank is overcharging and which it is undercharging today, so pricing can be corrected in both directions.",
  "exp-b": "It tests whether the quick formula a bank would use in production is accurate enough for this loan.",
  "exp-c": "It shows how confident the bank can be in the price change before acting on it.",
  "exp-d": "It tells the bank which data to improve first to make the price more reliable.",
  "exp-e": "It shows how sensitive this loan's price is to more clearing or a worse drought.",
  "exp-f": "It shows whether nature data adds risk to the whole book or moves it between loans.",
  "exp-g": "It shows the effect on the bank's accounts and capital in each scenario, including the benefit when borrowers engage.",
  "exp-h": "It shows where the bank's money sits by risk, and which loans change zone once nature data is added.",
};

const zoneOf = (el) => (el < 0.1 ? "green" : el < 0.25 ? "amber" : "red");
function zoneTotals(results, sc) {
  const t = { without: { green: 0, amber: 0, red: 0 }, with: { green: 0, amber: 0, red: 0 } };
  for (const r of results.sites) { const v = r[sc]; t.without[zoneOf(v.pd0 * v.lgd0 * r.exp)] += r.exp; t.with[zoneOf(v.pdN * v.lgdN * r.exp)] += r.exp; }
  return t;
}

// Facts per experiment, most important first: the fallback uses the first two.
const FACTS = {
  "exp-a": (R, s, st) => {
    const q = R.portfolio[st.a], v = s[st.a], M = MEASURE[st.am];
    return {
      [`${s.name}, ${M.name}`]: `${M.f0(v)} in the traditional view, ${M.fN(v)} with nature data`,
      "Loans priced lower with nature data": `${q.cheaper}, with ${$m(q.exp_cheaper)} of lending`,
      "Loans priced higher with nature data": `${q.dearer}, with ${$m(q.exp_dearer)} of lending`,
      "Average price change across the book": `${fmt(q.wbps, 1)} bps`,
      "Scenario": SCN[st.a], "Loans in the book": `${R.sites.length}`,
    };
  },
  "exp-b": (R, s, st, p) => {
    const m = p.mc, gap = (m.pd_mcN / m.pd_anN - 1) * 100;
    return {
      "Chance of default with nature data": `${pct(m.pd_mcN, 2)} by simulation, ${pct(m.pd_anN, 2)} by the formula`,
      "Gap between simulation and formula": `${Math.abs(gap).toFixed(0)}% ${gap >= 0 ? "higher" : "lower"} by simulation`,
      "Chance of default without nature data": `${pct(m.pd_mc0, 2)} by simulation, ${pct(m.pd_an0, 2)} by the formula`,
      "Simulated versions of next year": `${R.grids.N_MC.toLocaleString("en")}`, "Place": s.name,
    };
  },
  "exp-c": (R, s, st, p) => {
    const u = p.unc;
    return {
      "90% range of the price change": `${fmt(u.p5)} bps (5th percentile) to ${fmt(u.p95)} bps (95th percentile)`,
      "Central estimate": `${fmt(u.point)} bps`, "Median": `${fmt(u.p50)} bps`,
      "Share of re-pricings above zero": pct(u.share_pos, 0),
      "Re-pricings": `${R.grids.N_U.toLocaleString("en")}`, "Place": s.name,
    };
  },
  "exp-d": (R, s, st, p) => {
    const rank = (r, i) => [`${["Most important", "Second", "Third"][i]} assumption (${r.label.toLowerCase()})`, `${fmt(r.at_lo)} bps at the low end of its range, ${fmt(r.at_hi)} bps at the high end`];
    const [first, ...rest] = p.tornado.rows.slice(0, 3).map(rank);
    return Object.fromEntries([first, ["Central price change", `${fmt(p.tornado.base)} bps`], ...rest, ["Place", s.name]]);
  },
  "exp-e": (R, s, st, p) => {
    const z = p.surface[st.e], X = R.grids.loss, Y = R.grids.deficit;
    const ix = Math.max(0, X.findIndex((v) => v >= Math.min(20, p.here[0]))), iy = Math.max(0, Y.findIndex((v) => v >= Math.min(70, p.here[1])));
    const row = z[iy], col = z.map((r) => r[ix]), lo = Math.min(...z.flat());
    const f = {
      [`${s.name} sits at`]: `about ${fmt(z[iy][ix])} bps, with forest loss ${p.here[0].toFixed(1)}% and rainfall deficit ${p.here[1].toFixed(1)}%`,
      "Most that forest loss moves the price": `${Math.round(Math.max(...row) - Math.min(...row))} bps`,
      "Most that rainfall deficit moves the price": `${Math.round(Math.max(...col) - Math.min(...col))} bps`,
      "Scenario": st.e === "base" ? "Baseline" : "Repeat of driest year",
    };
    if (lo < -1) f["Cheapest point on the chart"] = `${Math.round(-lo)} bps cheaper than today, with no clearing and mild droughts`;
    return f;
  },
  "exp-f": (R) => {
    const b = R.portfolio.base;
    return {
      "Average yearly loss": `${$m(b.without.EL)} without nature data, ${$m(b.with.EL)} with it`,
      "Worst 1-in-1,000-year loss": `${$m(b.without.q999)} without nature data, ${$m(b.with.q999)} with it`,
      "Worst 1-in-100-year loss": `${$m(b.without.q99)} without nature data, ${$m(b.with.q99)} with it`,
    };
  },
  "exp-g": (R) => {
    const P = R.portfolio, f = {};
    const pair = (a, b) => `${$m(a)} without nature data, ${$m(b)} with it`;
    f["Baseline"] = `expected loss ${pair(P.base.without.EL, P.base.with.EL)}; provisions ${pair(P.base.prov0, P.base.provN)}, because ${P.base.stage2} loans breach the trigger`;
    for (const sc of ["drought", "defor", "engage"]) f[SCN[sc]] = `expected loss ${pair(P[sc].without.EL, P[sc].with.EL)}; capital ${pair(P[sc].without.regK, P[sc].with.regK)}; provisions ${pair(P[sc].prov0, P[sc].provN)}`;
    f["Baseline capital"] = pair(P.base.without.regK, P.base.with.regK);
    return f;
  },
  "exp-h": (R, s, st) => {
    const z = zoneTotals(R, st.hs), q = R.portfolio[st.hs];
    const moved = R.sites.filter((r) => { const v = r[st.hs]; return zoneOf(v.pd0 * v.lgd0 * r.exp) !== zoneOf(v.pdN * v.lgdN * r.exp); }).length;
    return {
      "Lending in the red zone": `${$m(z.without.red)} without nature data, ${$m(z.with.red)} with it`,
      "Loans that change zone": `${moved} once nature data is added`,
      "Loans priced differently": `${q.cheaper} lower and ${q.dearer} higher with nature data`,
      "Lending in the green zone": `${$m(z.without.green)} without nature data, ${$m(z.with.green)} with it`,
      "Lending in the amber zone": `${$m(z.without.amber)} without nature data, ${$m(z.with.amber)} with it`,
      "Scenario": SCN[st.hs], "Place highlighted": s.name,
    };
  },
};

// Facts for one chart as set, or null if anything is unknown.
export function explainFacts(results, exp, id, state = {}) {
  const E = EXPERIMENTS[exp];
  if (!E || !state || typeof state !== "object") return null;
  const s = results.sites.find((x) => x.id === id), p = results.per[id];
  if (!s || !p) return null;
  const keys = Object.keys(state);
  if (keys.some((k) => !E.state[k])) return null;
  for (const [k, vals] of Object.entries(E.state)) if (!vals.includes(state[k])) return null;
  const st = Object.fromEntries(Object.keys(E.state).map((k) => [k, state[k]]));
  const f = FACTS[exp](results, s, st, p);
  const stateKey = Object.keys(st).sort().map((k) => `${k}=${st[k]}`).join("&");
  return {
    exp, id,
    key: `${exp}|${E.perPlace ? id : "book"}|${stateKey}`,
    guide: GUIDE[exp](st),
    facts: f,
    text: Object.entries(f).map(([k, v]) => `- ${k}: ${v}`).join("\n"),
  };
}

// Accept a reply only if all three fields are there and every number is in the guide or the facts.
export function checkExplain(reply, facts) {
  if (!reply || typeof reply !== "object") return { ok: false, bad: [], missing: EXPLAIN_KEYS };
  const missing = EXPLAIN_KEYS.filter((k) => typeof reply[k] !== "string" || !reply[k].trim());
  const bad = badNumbers(EXPLAIN_KEYS.map((k) => reply[k] || "").join(" "), facts.guide + "\n" + facts.text);
  return { ok: !missing.length && !bad.length, bad, missing };
}

export function fallbackExplain(facts) {
  const top = Object.entries(facts.facts).slice(0, 2).map(([k, v]) => `${k}: ${v}.`).join(" ");
  return { look: facts.guide, shows: top, matters: MATTERS[facts.exp] };
}
