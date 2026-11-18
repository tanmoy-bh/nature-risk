// Per-loan repricing from the credit model (analysis/model_lab.py), injected into the lender desk at build time.
// bps is the change in the price the bank needs against pricing on financials alone: the difference of the two
// rounded prices, so it always agrees with the prices the Model lab and the committee note quote (152 to 177 = +25).
export const DESK_SCENARIOS = ["base", "drought", "defor"];
export function creditTable(results) {
  const out = {};
  for (const s of results.sites) {
    out[s.id] = {};
    for (const k of DESK_SCENARIOS) if (s[k]) out[s.id][k] = { bps: Math.round(s[k].spN) - Math.round(s[k].sp0), stage: s[k].stage };
  }
  return out;
}
