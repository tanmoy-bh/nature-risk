"""
Nature Risk Desk - model lab.

Runs the credit model numerically (NumPy/SciPy), the way you would in MATLAB:

  A. Traditional view (financials only) vs view with nature data, per loan
  B. Monte Carlo check of the closed-form PD (every site)
  C. Parameter uncertainty: distribution of the price change (every site)
  D. Tornado: which assumption moves the price most (every site)
  E. Response surface: price change over forest loss x rainfall deficit (every site)
  F. Portfolio loss distribution (one-factor Vasicek Monte Carlo), with and without nature data
  G. Portfolio scenarios: expected loss, capital, provisions (incl. an engagement scenario)
  H. Risk map of the book: chance of default x loan size, with and without nature data

Two-sided by design. A bank's traditional pricing already carries the average nature risk of its
farm book (its default history includes droughts and lost buyers). So nature data is measured
against the book average: a site better than average gets cheaper, a worse one dearer.
Upside channels: clean, traceable supply earns a price premium; steadier cash flow where water and
rain are reliable; land with no clearing or protected-area conflict is better collateral.

Input:  analysis/sites.json (real nature indicators per site; regenerate with node scripts/export-sites.mjs)
Output: analysis/results.json (everything the Model lab page draws; the build copies it to dist/lab-results.json)
Needs:  pip install numpy scipy

Real: forest loss, rainfall deficit, NDVI change, water stress, distance to protected areas.
Sample: loan sizes, borrower financials, traceability, crop sensitivities, bank pricing inputs.
"""
import json, os, re
import numpy as np
from scipy.stats import norm

HERE = os.path.dirname(os.path.abspath(__file__))
SEED = 20261110
rng = np.random.default_rng(SEED)
SITES = json.load(open(os.path.join(HERE, "sites.json")))
TRIGGER = {"base": 2.0, "drought": 2.0, "defor": 0.5, "engage": 2.0}
SCEN_NAME = {"base": "Baseline", "drought": "Repeat of driest year", "defor": "Stricter deforestation rule",
             "engage": "Flagged loans adopt a verified plan"}

COMM = [
    (r"palm", dict(name="Palm oil", s=.30, beta=.40, vegw=1)),
    (r"pulpwood|forestry", dict(name="Timber and pulp", s=.25, beta=.20, vegw=1)),
    (r"coffee", dict(name="Coffee", s=.40, beta=.50, vegw=1)),
    (r"cocoa", dict(name="Cocoa", s=.45, beta=.45, vegw=1)),
    (r"rubber", dict(name="Rubber", s=.30, beta=.30, vegw=1)),
    (r"rice", dict(name="Rice", s=.02, beta=.50, vegw=.25)),
    (r"cattle", dict(name="Beef", s=.20, beta=.35, vegw=.5)),
    (r"sugar", dict(name="Sugarcane", s=.05, beta=.30, vegw=.25)),
    (r"tea|vegetable", dict(name="Tea and vegetables", s=.10, beta=.45, vegw=.5)),
    (r"shrimp|aquaculture", dict(name="Aquaculture", s=.15, beta=.15, vegw=0)),
    (r"vertical", dict(name="Indoor farming", s=0, beta=0, vegw=0)),
]
def commodity(what):
    for pat, c in COMM:
        if re.search(pat, what, re.I):
            return c
    return dict(name="Agriculture", s=.2, beta=.35, vegw=.5)

TRACE_W = {"plot": 1.0, "mill": 0.5, "district": 0.2}  # how well a buyer can verify the supply (sample)
BANK = dict(dscr=1.8, sigma=0.28, lev=1.5, lgd=0.45, M=2.5, tenor=4, hurdle=0.10, opex=0.0030,
            disc=0.08, prem=0.03, pDrought=0.05, hPA=0.05, hClear=0.05, veg=0.15)

# Sample borrower financials: each borrower gets its own expected coverage, drawn once and fixed.
_fin = np.random.default_rng(7)
DSCR0 = {s["id"]: round(float(_fin.triangular(1.5, 1.8, 2.3)), 2) for s in sorted(SITES, key=lambda x: x["id"])}

def basel_K(pd, lgd, M):
    """Basel IRB corporate capital requirement per unit of exposure (vectorised)."""
    pd = np.clip(pd, 0.0005, 0.999)
    e = (1 - np.exp(-50 * pd)) / (1 - np.exp(-50))
    R = 0.12 * e + 0.24 * (1 - e)
    b = (0.11852 - 0.05478 * np.log(pd)) ** 2
    stressed = norm.cdf((norm.ppf(pd) + np.sqrt(R) * norm.ppf(0.999)) / np.sqrt(1 - R))
    K = (lgd * stressed - pd * lgd) * (1 + (M - 2.5) * b) / (1 - 1.5 * b)
    return np.maximum(K, 0), R

def channels(nat, bank, scen="base", plan=False):
    """The nature channels for one site: revenue impact r, extra variance v, collateral cut h."""
    T = TRIGGER[scen]
    pEx = 1 / (1 + np.exp(-(nat["loss"] - T) / (T / 4)))
    if plan:
        pEx = pEx * 0.3
    r1 = pEx * bank["s"] * bank["disc"]                                   # buyers walk away
    clean = TRACE_W[nat["trace"]] * np.clip(1 - nat["loss"] / (T / 2), 0, 1)  # clean, verifiable supply
    prem = clean * bank["s"] * bank["prem"]                               # premium it earns
    y = np.minimum(0.6, bank["beta"] * nat["deficit"] / 100 * (1 + nat["stress"] / 5))
    drought = scen == "drought"
    pD = max(bank["pDrought"], 1 / bank["tenor"]) if drought else bank["pDrought"]
    r2 = y / bank["tenor"] if drought else 0 * y                          # drought scenario: the bad year happens
    rel = 0 if nat["ndvi"] is None else np.clip(nat["ndvi"] / 100, -0.10, 0.10)
    r3 = -rel * bank["veg"] * bank["vegw"]                                # vegetation trend (either sign)
    r = r1 - prem + r2 + r3
    v = (bank["lev"] * y) ** 2 * pD * (1 - pD)                            # drought widens the spread
    hPA = np.where(nat["pa"] < 5, bank["hPA"] * (1 - nat["pa"] / 5), 0)
    hCl = bank["hClear"] * np.minimum(1, nat["loss"] / T) * (0.3 if plan else 1)
    h = hPA + hCl
    breach = (nat["loss"] >= T) & (not plan) & (bank["s"] > 0.05)
    return dict(T=T, pEx=pEx, r1=r1, clean=clean, prem=prem, y=y, pD=pD, r2=r2, r3=r3, r=r, v=v, h=h, breach=breach)

def nat_of(s):
    return dict(loss=s["loss"], deficit=s["deficit"], ndvi=s["ndvi"], stress=s["stress"], pa=s["pa"], trace=s["trace"])
def bank_of(s, **over):
    c = commodity(s["what"])
    return {**BANK, "dscr": DSCR0[s["id"]], "s": c["s"], "beta": c["beta"], "vegw": c["vegw"], **over}

def book_average(mods=None):
    """Average nature channels across the book in the baseline: the nature risk a bank already prices in."""
    mods = mods or {}
    sums = {"r": 0.0, "v": 0.0, "h": 0.0}
    for s in SITES:
        b = bank_of(s)
        b = {**b, **{k: v(b) if callable(v) else v for k, v in mods.items()}}
        c = channels(nat_of(s), b, "base")
        for k in sums:
            sums[k] = sums[k] + np.asarray(c[k], dtype=float)
    return {k: v / len(SITES) for k, v in sums.items()}

def credit(nat, bank, avg, scen="base", plan=False):
    """Traditional view (financials only, average nature risk priced in) and the view with nature data."""
    c = channels(nat, bank, scen, plan)
    e = np.clip(bank["lev"] * (c["r"] - avg["r"]), -0.5, 0.9)             # profit change vs the average borrower
    d0, dN = bank["dscr"], bank["dscr"] * (1 - e)
    s0 = bank["sigma"]
    sN = np.sqrt(np.maximum(s0 ** 2 - avg["v"] + c["v"], (0.5 * s0) ** 2))
    pd0, pdN = norm.cdf(-np.log(d0) / s0), norm.cdf(-np.log(dN) / sN)
    lgd0 = bank["lgd"]
    lgdN = np.clip(1 - (1 - lgd0) * (1 - (c["h"] - avg["h"])), 0.05, 0.95)
    K0, R0 = basel_K(pd0, lgd0, bank["M"])
    KN, RN = basel_K(pdN, lgdN, bank["M"])
    sp0 = pd0 * lgd0 + K0 * bank["hurdle"] + bank["opex"]
    spN = pdN * lgdN + KN * bank["hurdle"] + bank["opex"]
    life0 = 1 - (1 - pd0) ** bank["tenor"]
    lifeN = 1 - (1 - pdN) ** bank["tenor"]
    sicr = (lifeN / life0 >= 2) | c["breach"]
    prov0 = pd0 * lgd0
    provN = np.where(sicr, lifeN, pdN) * lgdN
    return dict(**c, e=e, d0=d0, dN=dN, s0=s0, sN=sN, pd0=pd0, pdN=pdN, lgd0=lgd0, lgdN=lgdN,
                K0=K0, KN=KN, R0=R0, RN=RN, sp0=sp0, spN=spN, dbps=(spN - sp0) * 1e4, sicr=sicr, prov0=prov0, provN=provN)

f = lambda x: float(np.asarray(x))
AVG = book_average()
out = {"meta": {"bank": BANK, "seed": SEED, "trace_w": TRACE_W,
                "avg": {k: f(v) for k, v in AVG.items()}, "scen": SCEN_NAME}}

def scen_args(s, sc):
    """The engagement scenario: loans that breach the trigger adopt a verified plan; everyone else as baseline."""
    if sc == "engage":
        return "engage", bool(s["loss"] >= TRIGGER["base"])
    return sc, False

# ---------- A and H: every loan, every scenario ----------
rows = []
for s in SITES:
    nat, bank = nat_of(s), bank_of(s)
    rec = {"id": s["id"], "name": s["where"].split(",")[0], "what": s["what"], "cc": s["cc"], "exp": s["exp"],
           "score": s["score"], "label": s["label"], "commodity": commodity(s["what"])["name"],
           "dscr0": bank["dscr"], "trace": s["trace"]}
    for sc in TRIGGER:
        scn, plan = scen_args(s, sc)
        m = credit(nat, bank, AVG, scn, plan)
        rec[sc] = dict(model=f(m["dbps"]), sp0=f(m["sp0"]) * 1e4, spN=f(m["spN"]) * 1e4, pd0=f(m["pd0"]), pdN=f(m["pdN"]),
                       lgd0=f(m["lgd0"]), lgdN=f(m["lgdN"]), K0=f(m["K0"]), KN=f(m["KN"]),
                       el0=f(m["pd0"]) * f(m["lgd0"]) * s["exp"], elN=f(m["pdN"]) * f(m["lgdN"]) * s["exp"],
                       stage=2 if bool(m["sicr"]) else 1, prov0=f(m["prov0"]) * s["exp"], provN=f(m["provN"]) * s["exp"],
                       plan=plan)
    rec["planbps"] = f(credit(nat, bank, AVG, "base", plan=True)["dbps"])
    rows.append(rec)
out["sites"] = rows

# ---------- B to E: per-site experiments ----------
LABELS = {"s": "Sales to deforestation-free buyers", "disc": "Price lost when those buyers walk away",
          "prem": "Premium for clean, traceable supply", "lev": "Operating leverage", "sigma": "Cash flow volatility",
          "dscr": "Expected debt service coverage", "lgd": "Loss given default before nature",
          "hPA": "Land value cut near a protected area", "hClear": "Land value cut for recent clearing",
          "beta": "Yield response to rainfall deficit", "hurdle": "Return required on capital"}
SECTOR_U = {  # assumptions that apply to every borrower: (low, central, high)
    "disc": (.03, .08, .15), "prem": (0, .03, .06), "lev": (1.2, 1.5, 2.2), "sigma": (.20, .28, .36),
    "lgd": (.35, .45, .55), "hPA": (0, .05, .10), "hClear": (0, .05, .10), "hurdle": (.08, .10, .13)}
MULT_U = {"s": (0.5, 1.0, 1.67), "beta": (0.6, 1.0, 1.5)}   # crop-specific: a multiplier on each crop's value

def ranges_for(s):
    b = bank_of(s)
    return {"dscr": (round(b["dscr"] - 0.3, 2), b["dscr"], round(b["dscr"] + 0.4, 2)),
            "s": (MULT_U["s"][0] * b["s"], b["s"], min(0.8, MULT_U["s"][2] * b["s"])),
            "beta": (MULT_U["beta"][0] * b["beta"], b["beta"], MULT_U["beta"][2] * b["beta"]), **SECTOR_U}

def tri(lo, mode, hi, n):
    return np.full(n, float(mode)) if hi - lo < 1e-12 else rng.triangular(lo, mode, hi, n)

def sector_mods(vals):
    """Turn sector-wide values (and crop multipliers) into modifiers for book_average."""
    mods = {k: v for k, v in vals.items() if k in SECTOR_U}
    if "ms" in vals: mods["s"] = (lambda m: (lambda b: np.minimum(0.8, b["s"] * m)))(vals["ms"])
    if "mb" in vals: mods["beta"] = (lambda m: (lambda b: b["beta"] * m))(vals["mb"])
    return mods

N_MC, N_U = 200_000, 20_000
GRID_L, GRID_D = np.linspace(0, 20, 31), np.linspace(0, 70, 29)
Lg, Dg = np.meshgrid(GRID_L, GRID_D)
MC_EDGES = np.linspace(0.2, 4.0, 77)

# C: one shared set of sector draws, so every loan faces the same sector, as in reality
SD = {k: tri(*v, N_U) for k, v in SECTOR_U.items()}
SD["ms"], SD["mb"] = tri(*MULT_U["s"], N_U), tri(*MULT_U["beta"], N_U)
AVG_U = book_average(sector_mods(SD))
DSCR_MULT = tri(-0.3, 0, 0.4, N_U)  # each borrower's own coverage uncertainty, added to its central value

per = {}
for s in SITES:
    nat, bank = nat_of(s), bank_of(s)
    m = credit(nat, bank, AVG)
    # B. Monte Carlo: buyer rejection and the drought drawn as yes/no events in each scenario of next year
    z = rng.standard_normal(N_MC)
    X = rng.random(N_MC) < f(m["pEx"])
    Y = rng.random(N_MC) < m["pD"]
    hit = X * bank["s"] * bank["disc"] - f(m["prem"]) + (Y - m["pD"]) * f(m["y"]) + f(m["r2"]) + f(m["r3"]) - AVG["r"]
    s_base = np.sqrt(max(bank["sigma"] ** 2 - AVG["v"], (0.5 * bank["sigma"]) ** 2))
    dscr0 = bank["dscr"] * np.exp(bank["sigma"] * z)
    dscrN = bank["dscr"] * np.exp(s_base * z) * (1 - np.clip(bank["lev"] * hit, -0.5, 0.9))
    pd_mc0, pd_mcN = float((dscr0 < 1).mean()), float((dscrN < 1).mean())
    se = lambda p: float(np.sqrt(p * (1 - p) / N_MC))
    mc = dict(h0=np.round(np.histogram(dscr0, MC_EDGES, density=True)[0], 4).tolist(),
              hN=np.round(np.histogram(dscrN, MC_EDGES, density=True)[0], 4).tolist(),
              pd_mc0=pd_mc0, pd_mcN=pd_mcN, se0=se(pd_mc0), seN=se(pd_mcN),
              pd_an0=f(m["pd0"]), pd_anN=f(m["pdN"]), pEx=f(m["pEx"]), pD=float(m["pD"]), y=f(m["y"]),
              prem=f(m["prem"]), clean=f(m["clean"]), r=f(m["r"]), r3=f(m["r3"]), e=f(m["e"]),
              d0=f(m["d0"]), dN=f(m["dN"]), sN=f(m["sN"]), sBase=float(s_base), h=f(m["h"]))
    # C. Parameter uncertainty: sector draws shared across loans, plus this borrower's own coverage
    U = ranges_for(s)
    bU = {**bank, **{k: SD[k] for k in SECTOR_U}, "s": np.minimum(0.8, bank["s"] * SD["ms"]), "beta": bank["beta"] * SD["mb"],
          "dscr": bank["dscr"] + DSCR_MULT}
    dist = np.asarray(credit(nat, bU, AVG_U)["dbps"])
    lo_e, hi_e = np.floor(dist.min() / 5) * 5, np.ceil(dist.max() / 5) * 5 + 5
    edges = np.linspace(lo_e, hi_e, 61)
    unc = dict(edges=np.round(edges, 3).tolist(), counts=np.histogram(dist, edges)[0].tolist(),
               p5=float(np.percentile(dist, 5)), p50=float(np.percentile(dist, 50)), p95=float(np.percentile(dist, 95)),
               mean=float(dist.mean()), min=float(dist.min()), max=float(dist.max()),
               share_pos=float((dist > 0).mean()), point=f(m["dbps"]),
               ranges={k: [round(float(x), 4) for x in v] for k, v in U.items()})
    # D. Tornado: one assumption at a time; sector assumptions also move the book average
    torn = []
    for k, (lo, mode, hi) in U.items():
        res = []
        for val in (lo, hi):
            if k in SECTOR_U:
                bk, av = {**bank, k: val}, book_average({k: val})
            elif k in ("s", "beta"):
                mult = val / mode if mode else 1.0
                bk = {**bank, k: val}
                av = book_average(sector_mods({"ms" if k == "s" else "mb": mult}))
            else:
                bk, av = {**bank, k: val}, AVG
            res.append(f(credit(nat, bk, av)["dbps"]))
        torn.append(dict(k=k, label=LABELS[k], lo=float(lo), hi=float(hi), at_lo=res[0], at_hi=res[1], swing=abs(res[1] - res[0])))
    torn.sort(key=lambda r: r["swing"], reverse=True)
    # E. Response surface: forest loss x rainfall deficit, everything else at this site's values
    surf = {sc: np.round(np.asarray(credit({**nat, "loss": Lg, "deficit": Dg}, bank, AVG, sc)["dbps"]), 1).tolist() for sc in ("base", "drought")}
    per[s["id"]] = dict(mc=mc, unc=unc, tornado=dict(base=f(m["dbps"]), rows=torn), surface=surf,
                        here=[nat["loss"], nat["deficit"]],
                        inputs=dict(nat=nat, s=bank["s"], beta=bank["beta"], vegw=bank["vegw"], dscr=bank["dscr"]))
out["per"] = per
out["grids"] = dict(mc_edges=MC_EDGES.tolist(), N_MC=N_MC, N_U=N_U, loss=GRID_L.tolist(), deficit=GRID_D.tolist(),
                    sector_u=SECTOR_U, mult_u=MULT_U)

# ---------- F and G: the whole book ----------
EAD = np.array([s["exp"] for s in SITES], float)
NP = 200_000
def book(sc):
    return [credit(nat_of(s), bank_of(s), AVG, *scen_args(s, sc)) for s in SITES]
def portfolio_mc(ms):
    res = {}
    Zs = rng.standard_normal((NP, 1)); eps = rng.standard_normal((NP, len(SITES)))  # same draws for both views
    for tag, pdk, lgdk, Rk in (("without", "pd0", "lgd0", "R0"), ("with", "pdN", "lgdN", "RN")):
        pd = np.array([f(x[pdk]) for x in ms]); lgd = np.array([f(x[lgdk]) for x in ms]); R = np.array([f(x[Rk]) for x in ms])
        default = np.sqrt(R) * Zs + np.sqrt(1 - R) * eps < norm.ppf(pd)
        loss = (default * (lgd * EAD)).sum(1)
        q = np.percentile(loss, [50, 99, 99.9])
        res[tag] = dict(loss=loss, EL=float(loss.mean()), q99=float(q[1]), q999=float(q[2]),
                        EL_an=float((pd * lgd * EAD).sum()),
                        regK=float(sum(f(basel_K(p, l, BANK["M"])[0]) * e for p, l, e in zip(pd, lgd, EAD))))
    return res
port = {}
for sc in TRIGGER:
    ms = book(sc)
    res = portfolio_mc(ms) if sc == "base" else None
    pd0 = np.array([f(x["pd0"]) for x in ms]); pdN = np.array([f(x["pdN"]) for x in ms])
    l0 = np.array([f(x["lgd0"]) for x in ms]); lN = np.array([f(x["lgdN"]) for x in ms])
    K0 = np.array([f(x["K0"]) for x in ms]); KN = np.array([f(x["KN"]) for x in ms])
    d = np.array([f(x["dbps"]) for x in ms])
    port[sc] = {"without": {"EL": float((pd0 * l0 * EAD).sum()), "regK": float((K0 * EAD).sum())},
                "with": {"EL": float((pdN * lN * EAD).sum()), "regK": float((KN * EAD).sum())},
                "prov0": float(sum(f(x["prov0"]) * e for x, e in zip(ms, EAD))),
                "provN": float(sum(f(x["provN"]) * e for x, e in zip(ms, EAD))),
                "stage2": int(sum(bool(x["sicr"]) for x in ms)),
                "wbps": float((d * EAD).sum() / EAD.sum()),
                "cheaper": int((d < -5).sum()), "dearer": int((d > 5).sum()),
                "exp_cheaper": float(EAD[d < -5].sum()), "exp_dearer": float(EAD[d > 5].sum())}
    if res:
        for tag in ("without", "with"):
            port[sc][tag].update({k: v for k, v in res[tag].items() if k != "loss"})
        grid = np.linspace(0, max(res["with"]["loss"].max(), res["without"]["loss"].max()), 160)
        exc = lambda L: [float((L > x).mean()) for x in grid]
        port["exceed"] = dict(x=grid.tolist(), without=exc(res["without"]["loss"]), with_=exc(res["with"]["loss"]))
        port["hist"] = dict(N=NP)
port["total"] = float(EAD.sum())
out["portfolio"] = port

json.dump(out, open(os.path.join(HERE, "results.json"), "w"), separators=(",", ":"))

# ---------- console summary ----------
print("Book average nature channels:", {k: round(f(v), 4) for k, v in AVG.items()})
for sc in TRIGGER:
    q = port[sc]
    print(f"{sc:8s} EL {q['without']['EL']:.2f}->{q['with']['EL']:.2f}  regK {q['without']['regK']:.1f}->{q['with']['regK']:.1f}"
          f"  prov {q['prov0']:.2f}->{q['provN']:.2f}  stage2 {q['stage2']:2d}  wbps {q['wbps']:+.1f}"
          f"  cheaper {q['cheaper']} (${q['exp_cheaper']:.0f}m)  dearer {q['dearer']} (${q['exp_dearer']:.0f}m)")
b = port["base"]
print(f"Tail 99.9%: {b['without']['q999']:.1f} -> {b['with']['q999']:.1f}")
for r in sorted(rows, key=lambda r: r["base"]["model"]):
    print(f"  {r['id']} {r['name'][:22]:22s} {r['commodity'][:12]:12s} dscr {r['dscr0']:.2f} trace {r['trace']:8s}"
          f" PD {r['base']['pd0']*100:5.2f}->{r['base']['pdN']*100:5.2f}  {r['base']['model']:+7.1f} bps  plan {r['planbps']:+6.1f}  stage {r['base']['stage']}")
k = per["A19"]
print(f"A19 MC PD {k['mc']['pd_mc0']:.4f}->{k['mc']['pd_mcN']:.4f} vs closed form {k['mc']['pd_an0']:.4f}->{k['mc']['pd_anN']:.4f}; "
      f"unc P5 {k['unc']['p5']:.0f} P50 {k['unc']['p50']:.0f} P95 {k['unc']['p95']:.0f} share>0 {k['unc']['share_pos']:.2f}")
print("A19 tornado:", [(r["k"], round(r["at_lo"]), round(r["at_hi"])) for r in k["tornado"]["rows"][:4]])
