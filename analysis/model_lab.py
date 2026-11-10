"""
Nature Risk Desk - model lab.

Runs the credit model from the Credit model page numerically (NumPy/SciPy),
the way you would in MATLAB:

  A. Old rule vs model, per site
  B. Monte Carlo check of the analytic PD (every site)
  C. Parameter uncertainty: distribution of the price change (every site)
  D. Tornado: which assumption moves the price most (every site)
  E. Response surface: price change over forest loss x rainfall deficit (every site)
  F. Portfolio loss distribution (one-factor Vasicek Monte Carlo), with and without nature data
  G. Portfolio scenarios: expected loss, capital, provisions

Input:  analysis/sites.json (real nature indicators per site; regenerate with node scripts/export-sites.mjs)
Output: analysis/results.json (everything the Model lab page draws; the build copies it to dist/lab-results.json)
Needs:  pip install numpy scipy

Real: forest loss, rainfall deficit, NDVI change, water stress, distance to protected areas.
Sample: loan sizes, borrower financials, commodity sensitivities, bank pricing inputs.
"""
import json, re
import numpy as np
from scipy.stats import norm

import os
HERE = os.path.dirname(os.path.abspath(__file__))
rng = np.random.default_rng(20261110)
SITES = json.load(open(os.path.join(HERE, "sites.json")))
TRIGGER = {"base": 2.0, "drought": 2.0, "defor": 0.5}
SCEN_NAME = {"base": "Baseline", "drought": "Repeat of driest year", "defor": "Stricter deforestation rule"}

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

BANK = dict(dscr=1.8, sigma=0.28, lev=1.5, lgd=0.45, M=2.5, tenor=4, hurdle=0.10, opex=0.0030,
            disc=0.08, pDrought=0.05, hPA=0.05, hClear=0.05, veg=0.15)

def basel_K(pd, lgd, M):
    """Basel IRB corporate capital requirement per unit of exposure (vectorised)."""
    pd = np.clip(pd, 0.0005, 0.999)
    e = (1 - np.exp(-50 * pd)) / (1 - np.exp(-50))
    R = 0.12 * e + 0.24 * (1 - e)
    b = (0.11852 - 0.05478 * np.log(pd)) ** 2
    stressed = norm.cdf((norm.ppf(pd) + np.sqrt(R) * norm.ppf(0.999)) / np.sqrt(1 - R))
    K = (lgd * stressed - pd * lgd) * (1 + (M - 2.5) * b) / (1 - 1.5 * b)
    return np.maximum(K, 0), R

def run(nat, bank, scen="base", plan=False):
    """Same model as the Credit model page. Works on scalars or NumPy arrays."""
    T = TRIGGER[scen]
    pEx = 1 / (1 + np.exp(-(nat["loss"] - T) / (T / 4)))
    if plan:
        pEx = pEx * 0.3
    r1 = pEx * bank["s"] * bank["disc"]
    y = np.minimum(0.6, bank["beta"] * nat["deficit"] / 100 * (1 + nat["stress"] / 5))
    drought = scen == "drought"
    pD = max(bank["pDrought"], 1 / bank["tenor"]) if drought else bank["pDrought"]
    r2 = y / bank["tenor"] if drought else 0 * y
    rel = 0 if nat["ndvi"] is None else np.clip(nat["ndvi"] / 100, -0.10, 0.10)
    r3 = -rel * bank["veg"] * bank["vegw"]
    rev = r1 + r2 + r3
    ebitda = np.clip(bank["lev"] * rev, -0.5, 0.9)
    d0, dN = bank["dscr"], bank["dscr"] * (1 - ebitda)
    s0 = bank["sigma"]
    sN = np.sqrt(s0 ** 2 + (bank["lev"] * y) ** 2 * pD * (1 - pD))
    pd0, pdN = norm.cdf(-np.log(d0) / s0), norm.cdf(-np.log(dN) / sN)
    hPA = np.where(nat["pa"] < 5, bank["hPA"] * (1 - nat["pa"] / 5), 0)
    hCl = bank["hClear"] * np.minimum(1, nat["loss"] / T)
    h = hPA + hCl
    lgd0, lgdN = bank["lgd"], 1 - (1 - bank["lgd"]) * (1 - h)
    K0, R0 = basel_K(pd0, lgd0, bank["M"])
    KN, RN = basel_K(pdN, lgdN, bank["M"])
    sp0 = pd0 * lgd0 + K0 * bank["hurdle"] + bank["opex"]
    spN = pdN * lgdN + KN * bank["hurdle"] + bank["opex"]
    life0 = 1 - (1 - pd0) ** bank["tenor"]
    lifeN = 1 - (1 - pdN) ** bank["tenor"]
    breach = (nat["loss"] >= T) & (not plan) & (bank["s"] > 0.05)
    sicr = (lifeN / life0 >= 2) | breach
    prov0 = pd0 * lgd0
    provN = np.where(sicr, lifeN, pdN) * lgdN
    return dict(pEx=pEx, r1=r1, y=y, pD=pD, r2=r2, r3=r3, ebitda=ebitda, d0=d0, dN=dN, s0=s0, sN=sN,
                pd0=pd0, pdN=pdN, lgd0=lgd0, lgdN=lgdN, K0=K0, KN=KN, R0=R0, RN=RN,
                sp0=sp0, spN=spN, dbps=(spN - sp0) * 1e4, sicr=sicr, prov0=prov0, provN=provN)

def nat_of(s):
    return dict(loss=s["loss"], deficit=s["deficit"], ndvi=s["ndvi"], stress=s["stress"], pa=s["pa"])
def bank_of(s, **over):
    c = commodity(s["what"])
    return {**BANK, "s": c["s"], "beta": c["beta"], "vegw": c["vegw"], **over}
f = lambda x: float(np.asarray(x))
out = {"meta": {"bank": BANK, "seed": 20261110}}

# ---------- A. Old rule vs model, per site ----------
rows = []
for s in SITES:
    rec = {"id": s["id"], "name": s["where"].split(",")[0], "what": s["what"], "cc": s["cc"], "exp": s["exp"],
           "score": s["score"], "label": s["label"], "commodity": commodity(s["what"])["name"]}
    for sc in TRIGGER:
        m = run(nat_of(s), bank_of(s), sc)
        rec[sc] = dict(rule=s["ruleBps"][sc], model=f(m["dbps"]), pd0=f(m["pd0"]), pdN=f(m["pdN"]),
                       lgdN=f(m["lgdN"]), K0=f(m["K0"]), KN=f(m["KN"]), stage=2 if bool(m["sicr"]) else 1,
                       prov0=f(m["prov0"]) * s["exp"], provN=f(m["provN"]) * s["exp"])
    rec["plan"] = f(run(nat_of(s), bank_of(s), "base", plan=True)["dbps"])
    rows.append(rec)
out["sites"] = rows

# ---------- B to E: per-site experiments ----------
LABELS = {"s": "Sales to deforestation-free buyers", "disc": "Price lost when those buyers walk away",
          "lev": "Operating leverage", "sigma": "Cash flow volatility", "dscr": "Expected debt service coverage",
          "lgd": "Loss given default before nature", "hPA": "Land value cut near a protected area",
          "hClear": "Land value cut for recent clearing", "beta": "Yield response to rainfall deficit",
          "hurdle": "Return required on capital"}
FIXED_U = {  # (low, mode, high): triangular ranges for the assumptions that do not depend on the crop
    "disc": (.03, .08, .15), "lev": (1.2, 1.5, 2.2), "sigma": (.20, .28, .36), "dscr": (1.5, 1.8, 2.2),
    "lgd": (.35, .45, .55), "hPA": (0, .05, .10), "hClear": (0, .05, .10), "hurdle": (.08, .10, .13)}
def ranges_for(bank):
    """Crop-specific ranges scale around that crop's central value."""
    s, beta = bank["s"], bank["beta"]
    return {"s": (0.5 * s, s, min(0.8, 1.67 * s)), "beta": (0.6 * beta, beta, 1.5 * beta), **FIXED_U}
def tri(lo, mode, hi, n):
    return np.full(n, mode) if hi - lo < 1e-12 else rng.triangular(lo, mode, hi, n)

N_MC, N_U = 200_000, 20_000
GRID_L, GRID_D = np.linspace(0, 20, 31), np.linspace(0, 70, 29)
L, D = np.meshgrid(GRID_L, GRID_D)
MC_EDGES = np.linspace(0.2, 4.0, 77)
per = {}
for s in SITES:
    nat, bank = nat_of(s), bank_of(s)
    m = run(nat, bank)
    # B. Monte Carlo: buyer rejection and drought drawn as yes/no events each simulated year
    z = rng.standard_normal(N_MC)
    excluded = rng.random(N_MC) < f(m["pEx"])
    dry = rng.random(N_MC) < m["pD"]
    rev_hit = excluded * bank["s"] * bank["disc"] + dry * f(m["y"]) + f(m["r3"])
    dscr0 = bank["dscr"] * np.exp(bank["sigma"] * z)
    dscrN = dscr0 * (1 - np.clip(bank["lev"] * rev_hit, -0.5, 0.9))
    pd_mc0, pd_mcN = float((dscr0 < 1).mean()), float((dscrN < 1).mean())
    se = lambda p: float(np.sqrt(p * (1 - p) / N_MC))
    mc = dict(h0=np.round(np.histogram(dscr0, MC_EDGES, density=True)[0], 4).tolist(),
              hN=np.round(np.histogram(dscrN, MC_EDGES, density=True)[0], 4).tolist(),
              pd_mc0=pd_mc0, pd_mcN=pd_mcN, se0=se(pd_mc0), seN=se(pd_mcN),
              pd_an0=f(m["pd0"]), pd_anN=f(m["pdN"]), pEx=f(m["pEx"]), pD=float(m["pD"]), y=f(m["y"]),
              r3=f(m["r3"]), dN=f(m["dN"]), sN=f(m["sN"]))
    # C. Parameter uncertainty
    U = ranges_for(bank)
    draws = {k: tri(*v, N_U) for k, v in U.items()}
    dist = np.asarray(run(nat, {**bank, **draws})["dbps"])
    lo_e, hi_e = np.floor(dist.min() / 5) * 5, np.ceil(dist.max() / 5) * 5 + 5
    edges = np.linspace(lo_e, hi_e, 61)
    unc = dict(edges=np.round(edges, 3).tolist(), counts=np.histogram(dist, edges)[0].tolist(),
               p5=float(np.percentile(dist, 5)), p50=float(np.percentile(dist, 50)), p95=float(np.percentile(dist, 95)),
               mean=float(dist.mean()), min=float(dist.min()), max=float(dist.max()),
               share_pos=float((dist > 0).mean()), point=f(m["dbps"]),
               ranges={k: [round(x, 4) for x in v] for k, v in U.items()})
    # D. Tornado: one assumption at a time, low and high end
    torn = []
    for k, (lo, mode, hi) in U.items():
        a_, b_ = f(run(nat, {**bank, k: lo})["dbps"]), f(run(nat, {**bank, k: hi})["dbps"])
        torn.append(dict(k=k, label=LABELS[k], lo=lo, hi=hi, at_lo=a_, at_hi=b_, swing=abs(b_ - a_)))
    torn.sort(key=lambda r: r["swing"], reverse=True)
    # E. Response surface over forest loss x rainfall deficit, other inputs at this site's real values
    surf = {sc: np.round(np.asarray(run({**nat, "loss": L, "deficit": D}, bank, sc)["dbps"]), 1).tolist() for sc in ("base", "drought")}
    per[s["id"]] = dict(mc=mc, unc=unc, tornado=dict(base=f(m["dbps"]), rows=torn), surface=surf,
                        here=[nat["loss"], nat["deficit"]], inputs=dict(nat=nat, s=bank["s"], beta=bank["beta"], vegw=bank["vegw"]))
out["per"] = per
out["grids"] = dict(mc_edges=MC_EDGES.tolist(), N_MC=N_MC, N_U=N_U, loss=GRID_L.tolist(), deficit=GRID_D.tolist(), fixed_u=FIXED_U)

# ---------- F. Portfolio loss distribution (one-factor Vasicek) ----------
EAD = np.array([s["exp"] for s in SITES], float)
NP = 200_000
def portfolio(scen):
    ms = [run(nat_of(s), bank_of(s), scen) for s in SITES]
    res = {}
    for tag, pdk, lgdk, Rk in (("without", "pd0", "lgd0", "R0"), ("with", "pdN", "lgdN", "RN")):
        pd = np.array([f(x[pdk]) for x in ms]); lgd = np.array([f(x[lgdk]) for x in ms]); R = np.array([f(x[Rk]) for x in ms])
        Zs = rng.standard_normal((NP, 1)); eps = rng.standard_normal((NP, len(SITES)))
        default = np.sqrt(R) * Zs + np.sqrt(1 - R) * eps < norm.ppf(pd)
        loss = (default * (lgd * EAD)).sum(1)
        q = np.percentile(loss, [50, 99, 99.9])
        res[tag] = dict(loss=loss, EL=float(loss.mean()), q99=float(q[1]), q999=float(q[2]),
                        EL_an=float((pd * lgd * EAD).sum()),
                        regK=float(sum(f(basel_K(p, l, BANK["M"])[0]) * e for p, l, e in zip(pd, lgd, EAD))))
    return ms, res
port = {}
for sc in TRIGGER:
    ms, res = portfolio(sc)
    port[sc] = {tag: {k: v for k, v in r.items() if k != "loss"} for tag, r in res.items()}
    port[sc]["prov0"] = float(sum(f(x["prov0"]) * e for x, e in zip(ms, EAD)))
    port[sc]["provN"] = float(sum(f(x["provN"]) * e for x, e in zip(ms, EAD)))
    port[sc]["stage2"] = int(sum(bool(x["sicr"]) for x in ms))
    port[sc]["wbps"] = float(sum(f(x["dbps"]) * e for x, e in zip(ms, EAD)) / EAD.sum())
    if sc == "base":
        bins = np.linspace(0, max(res["with"]["q999"], res["without"]["q999"]) * 1.15, 61)
        port["hist"] = dict(edges=bins.tolist(),
                            without=np.histogram(res["without"]["loss"], bins)[0].tolist(),
                            with_=np.histogram(res["with"]["loss"], bins)[0].tolist(), N=NP)
        # loss exceedance curve: share of simulated years with a loss above x
        grid = np.linspace(0, max(res["with"]["loss"].max(), res["without"]["loss"].max()), 160)
        exc = lambda L: [float((L > x).mean()) for x in grid]
        port["exceed"] = dict(x=grid.tolist(), without=exc(res["without"]["loss"]), with_=exc(res["with"]["loss"]))
port["total"] = float(EAD.sum())
out["portfolio"] = port

json.dump(out, open(os.path.join(HERE, "results.json"), "w"), separators=(",", ":"))
k = out["per"]["A19"]["mc"]; u = out["per"]["A19"]["unc"]; torn = out["per"]["A19"]["tornado"]["rows"]
print(f"A19 analytic PD {k['pd_an0']:.4f}->{k['pd_anN']:.4f}  Monte Carlo {k['pd_mc0']:.4f}->{k['pd_mcN']:.4f} (se {k['seN']:.4f})")
print(f"A19 price change {u['point']:.1f} bps; uncertainty P5 {u['p5']:.1f}, P50 {u['p50']:.1f}, P95 {u['p95']:.1f}")
print("Tornado top 3:", [(r['label'], round(r['at_lo'], 1), round(r['at_hi'], 1)) for r in torn[:3]])
for sc in TRIGGER:
    q = port[sc]
    print(f"{sc:8s} EL {q['without']['EL']:.2f}->{q['with']['EL']:.2f}  99.9% {q['without']['q999']:.1f}->{q['with']['q999']:.1f}"
          f"  regK {q['without']['regK']:.1f}->{q['with']['regK']:.1f}  prov {q['prov0']:.2f}->{q['provN']:.2f}  stage2 {q['stage2']}  wbps {q['wbps']:.1f}")
