// Committee note: the facts a language model may use, the output shape, the number check and a fixed template.
// Shared by the Pages Function (functions/api/note.js) and the tests. Runs on the server only, so the
// prompt is never built from anything the browser sends except a loan id and a scenario name.

export const SCENARIOS = { base: "Baseline", drought: "Repeat of driest year", defor: "Stricter deforestation rule", engage: "Engagement" };
const COUNTRY = { MY: "Malaysia", SG: "Singapore", ID: "Indonesia", VN: "Vietnam", TH: "Thailand", PH: "Philippines", LK: "Sri Lanka", AU: "Australia" };

export const fmt = (v, d = 0) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d);
export const pct = (v, d = 1) => { const s = (v * 100).toFixed(d); return (+s === 0 ? (0).toFixed(d) : s) + "%"; };
export const $k = (v) => "$" + Math.round(v * 1000).toLocaleString("en") + "k";
export const $m = (v) => "$" + v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2) + "m";
const dirWord = (v) => (v < -5 ? "cheaper" : v > 5 ? "dearer" : "about the same");

export const NOTE_SYSTEM =
  "You write short notes for a bank's credit committee about one farm loan. Use only the facts you are given. " +
  "Never calculate, estimate or invent a number: copy numbers exactly as they are written in the facts, with their units. " +
  "Write plain English for credit officers. Each field is one sentence of at most 30 words.";

export const NOTE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "driver", "action", "caveat"],
  properties: {
    headline: { type: "string", description: "The loan name and how its required price changes with nature data, with both prices in bps" },
    driver: { type: "string", description: "The nature readings behind the change (forest loss against the trigger, rainfall deficit) and the change in chance of default" },
    action: { type: "string", description: "The IFRS 9 stage and provisions, and what a verified no-deforestation plan would do to the price" },
    caveat: { type: "string", description: "The 90% range if given, and the biggest uncertainties" },
  },
};
export const NOTE_KEYS = ["headline", "driver", "action", "caveat"];

// The facts for one loan in one scenario, from the precomputed model results.
export function noteFacts(results, id, sc) {
  const s = results.sites.find((x) => x.id === id), p = results.per[id];
  if (!s || !p || !SCENARIOS[sc] || !s[sc]) return null;
  const v = s[sc], n = p.inputs.nat, T = sc === "defor" ? 0.5 : 2;
  const f = {
    "Loan": `${s.name}, ${s.what}, ${COUNTRY[s.cc] || s.cc}`,
    "Scenario": SCENARIOS[sc],
    "Loan size": `$${s.exp}m`,
    "Chance of default in a year": `${pct(v.pd0, 2)} without nature data, ${pct(v.pdN, 2)} with nature data`,
    "Required price above funding cost": `${Math.round(v.sp0)} bps without nature data, ${Math.round(v.spN)} bps with nature data`,
    "Price change from nature data": `${fmt(v.model, 1)} bps, ${dirWord(v.model)}`,
    "Expected loss a year": `${$k(v.el0)} without nature data, ${$k(v.elN)} with nature data`,
    "IFRS 9 stage": `Stage ${v.stage}${v.stage === 2 ? " (forest loss breaches the trigger with no verified plan, or lifetime default risk doubles)" : ""}`,
    "Provisions": `${$k(v.prov0)} without nature data, ${$k(v.provN)} with nature data`,
    "Forest loss at the site": `${n.loss.toFixed(1)}% against a trigger of ${T}%`,
    "Rainfall deficit in the driest year": `${n.deficit.toFixed(1)}%`,
    "Price change with a verified no-deforestation plan": `${fmt(s.planbps, 1)} bps`,
    "Biggest uncertainties": p.tornado.rows.slice(0, 2).map((r) => r.label.toLowerCase()).join("; "),
  };
  if (sc === "base") f["90% range of the price change"] = `${fmt(p.unc.p5)} to ${fmt(p.unc.p95)} bps`;
  return { id, sc, name: s.name, what: s.what, f, text: Object.entries(f).map(([k, x]) => `- ${k}: ${x}`).join("\n") };
}

// Numbers the note may use: any number in the facts, written with the same or fewer decimals.
const numTokens = (s) => String(s).replace(/(\d),(?=\d{3})/g, "$1").match(/\d+(?:\.\d+)?/g) || [];
export function badNumbers(text, factsText) {
  const allowed = numTokens(factsText).map(Number);
  return numTokens(text).filter((tok) => {
    const x = +tok, d = (tok.split(".")[1] || "").length;
    return !allowed.some((a) => a === x || +a.toFixed(d) === x);
  });
}

// Accept a model reply only if it has all four fields and every number in it is in the facts.
export function checkNote(reply, facts) {
  if (!reply || typeof reply !== "object") return { ok: false, bad: [] };
  const missing = NOTE_KEYS.filter((k) => typeof reply[k] !== "string" || !reply[k].trim());
  const bad = badNumbers(NOTE_KEYS.map((k) => reply[k] || "").join(" "), facts.text);
  return { ok: !missing.length && !bad.length, bad, missing };
}

const pair = (s) => s.replace(" without nature data,", " to").replace(" with nature data", "");
export function templateNote({ f }) {
  return {
    headline: `${f["Loan"]}: nature data moves the required price from ${pair(f["Required price above funding cost"])} (${f["Price change from nature data"]}).`,
    driver: `Forest loss of ${f["Forest loss at the site"]} and a rainfall deficit of ${f["Rainfall deficit in the driest year"]} move the chance of default from ${pair(f["Chance of default in a year"])}.`,
    action: `The loan is in IFRS 9 ${f["IFRS 9 stage"].split(" (")[0]}, with provisions moving from ${pair(f["Provisions"])}; with a verified no-deforestation plan the price change would be ${f["Price change with a verified no-deforestation plan"]}.`,
    caveat: `${f["90% range of the price change"] ? `The 90% range is ${f["90% range of the price change"]}; the` : "The"} biggest uncertainties are ${f["Biggest uncertainties"].replace("; ", " and ")}.`,
  };
}
