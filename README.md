# Nature Risk Desk

A proof of concept that turns open nature data into a financial signal for lenders, built as a conversation starter for [Nature Signal](https://www.naturesignal.com).

Live at **https://projects.tanmoybh.com/nature-risk/** (passphrase protected).

| Page | What it shows |
| --- | --- |
| Lender desk | An APAC agri and commodities loan book. Each loan gets a Nature Risk, Stable or Gain label, a score, an evidence trail, a suggested credit action and a pricing signal, with a drought and a deforestation-rule stress test. |
| Nature map | Malaysia and Singapore sites with nature data only: score, sub-scores, evidence trail, last-5-year trends and the data sources. Click a place to zoom in. |
| Architecture | How the full platform would be built in Nature Signal's three layers, and a 90-day plan. |
| Model lab (`/lab`) | Eight numerical experiments on the credit model: Monte Carlo, parameter uncertainty, sensitivity, a response surface, a portfolio loss distribution, scenarios and a risk map of the book. Nature data is measured against the book's average nature risk, so loans can come out cheaper or dearer. Each experiment shows its goal, data, equations, result and weaknesses. Every farm loan on the Lender desk links to it. |

## What is real and what is sample

Every value on the page carries a **Real** or **Sample** pill.

**Real**, pulled from public open data on 28 Oct 2026, measured in a 2–4 km box around each site point:

| Indicator | Source |
| --- | --- |
| Forest loss, 2001–2024 and per year | Hansen/UMD Global Forest Change v1.12 (30 m) |
| Vegetation (NDVI), 2019–2025 | Sentinel-2 L2A via Microsoft Planetary Computer, cloud-masked |
| Water stress | WRI Aqueduct baseline water stress via Resource Watch |
| Protected areas | World Database on Protected Areas (UNEP-WCMC) |
| Threatened species | GBIF records with IUCN CR, EN or VU status, 10 km radius |
| Mangroves | ESA WorldCover 2021 |
| Rainfall and drought scenario | ERA5 reanalysis via Open-Meteo, 2001–2025 |
| Boundaries | Natural Earth |

**Sample**: borrowers, exposures, pricing, livelihood dependence and supply-chain traceability. Site points are at real locations, but the estates are fictional. The scoring rules are a v0.1 sketch, not Nature Signal's methodology.

The fetched values are in `data/` and embedded in `src/app.html`.

## Layout

```
src/app.html          the app (HTML, CSS, JS and the data)
src/geo.json          simplified map boundaries (Natural Earth)
src/arch.svg          architecture diagram
scripts/build.mjs     assembles dist/ (no dependencies)
functions/_middleware.js  passphrase gate (Cloudflare Pages Function)
tests/                tests for the gate
data/                 the real values used, as fetched
src/lab.html          the Model lab page
analysis/model_lab.py the credit model and the seven experiments (NumPy/SciPy)
analysis/sites.json   input: real nature indicators per farm loan
analysis/results.json output: everything the Model lab draws
scripts/export-sites.mjs  regenerates analysis/sites.json from src/app.html
```

## Model lab

The experiments run offline in Python; the page only draws their results.

```bash
node scripts/export-sites.mjs        # only if the site data in src/app.html changed
pip install numpy scipy
python3 analysis/model_lab.py        # writes analysis/results.json (seed 20261110, about 4 seconds)
npm run build                        # writes dist/lab.html and dist/lab-results.json
```

The build stamps the results with a version hash. The page caches them in the browser's IndexedDB under that version, so reloads read them locally, and a new build replaces them. Charts draw as they scroll into view.

## Passphrase

The site is gated on the server by `functions/_middleware.js`. The passphrase is never in the code or the page:

- GitHub repository secret `NATURE_RISK_PASSPHRASE` holds it.
- The deploy workflow copies it into the Pages secret `ACCESS_PASSPHRASE`.
- A correct passphrase sets an HttpOnly cookie for 14 days. Changing the passphrase signs everyone out.
- **Lock this page** in the footer signs you out.

## Run locally

```bash
printf 'ACCESS_PASSPHRASE=your-passphrase\n' > .dev.vars   # git-ignored
npm run dev     # builds, then serves on http://localhost:8788
npm test        # tests for the passphrase gate
```

## Deploy

Pushing to `main` runs `.github/workflows/deploy-cloudflare.yml`, which tests, builds and deploys `dist/` and `functions/` to the Cloudflare Pages project `tanmoybh-nature-risk`. It uses:

- `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from the `tanmoy-bh` organization secrets
- `NATURE_RISK_PASSPHRASE`, a repository secret you add once

The [projects hub](https://github.com/tanmoy-bh/projects) serves it at `/nature-risk/` by proxying to `https://tanmoybh-nature-risk.pages.dev`.

## Committee note (cloud model)

The Model lab's **Draft committee note** button calls the site's own `/api/note` function (`functions/api/note.js`). The browser sends only a loan id and scenario; the function builds the prompt from `lab-results.json`, calls a model through OpenRouter, rejects any draft containing a number the credit model didn't produce, and falls back to a fixed template after two rejected drafts. Notes are cached per loan, scenario and results version.

- The key lives only in the GitHub secret `OPENROUTER_API_KEY`, which the deploy workflow copies into the Pages secret of the same name. Without it, the note uses the template.
- The model defaults to `google/gemini-3.8-flash`; set the Pages variable `OPENROUTER_MODEL` to change it.
- Set a spending limit on the OpenRouter key itself.

## Explain this chart

Every chart in the Model lab has a sparkle button at its top-right. It posts the experiment, the place and the chart's current settings to `/api/explain` (`functions/api/explain.js`), which builds the facts for that chart from `lab-results.json` (`lib/explain.mjs`) and asks the same model through `lib/openrouter.mjs`. The reading has three parts: what you're looking at, what it shows here, and why it matters to a bank.

- Every number in a reading must appear in the chart's facts; otherwise the draft is rejected, and after two tries a plain summary from the model results is shown instead.
- Readings are cached for 24 hours on the server (per results version, model, chart, place and settings) and in the browser's IndexedDB. Refresh asks for a fresh one.
- It uses the same `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` settings as the committee note.

## Satellite view (Nature map)

Right below the map, the selected site is shown from above in five yearly cloud-free Sentinel-2 images (2021–2025), all at the same scale (about 5 km across, zoom 14) with a 1 km bar. Click any year to open it large and step through the years with the arrow keys.

- Tiles load in the viewer's browser straight from EOX's public [Sentinel-2 cloudless](https://s2maps.eu) service; no key is needed. The tile maths is `satFrame()` in `src/app.html`, tested in `tests/satellite.test.mjs`.
- Licence: EOX licenses these mosaics for non-commercial use, with attribution (shown under the strip). A commercial product would need an EOX licence or another source.
