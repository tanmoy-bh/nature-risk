# Daily nature debrief: design

Date: 2026-11-13 · Status: approved in conversation ("yes", then "now you build the daily debrief")

## Intent
A once-a-day briefing at the top of the Lender desk: today's nature news that could change how the bank's loans are priced, tied to the loans it touches. For Tanmoy's final-round demos ("signal → credit decision", live); presentation matters a lot.

## Decided with Tanmoy
- A **"Load daily debrief"** button on the landing page (Lender desk). A loaded debrief stays valid for **24 hours** and reopens instantly from the browser's IndexedDB; a **Refresh** gets fresh information.
- News comes from a fixed list of feeds; Gemini (google/gemini-3.8-flash via OpenRouter, key server-side) picks what matters.

## Approaches considered
- **A. Fixed RSS feeds + model ranks by index (chosen).** Mongabay, Eco-Business, Dialogue Earth, Carbon Brief (all verified live, Nov 2026). The model returns only story numbers and labels; headline, link, source and date always come from the feed, so links can't be invented.
- B. Web search by the model (OpenRouter web plugin): broader, but paid per call, links and dates harder to trust. Rejected.
- C. News indexes (Google News RSS, GDELT): Google News disallows robots; GDELT failed when tested. Rejected.

## Design
- `POST /api/brief {again?}`: fetch the feeds (6 s each, in parallel), keep items from the last 3 days, rank by nature/agri-finance keywords and drop duplicates, send the top 30 numbered to the model. Model returns a one-sentence summary and 3–5 stories: `{n, channel, direction, regions[], commodities[], why}` with enum-checked labels; numbers in `why` must appear in that article's text, numbers in `summary` in some article's text. Loans touched = loans whose country is in `regions` and whose commodity is in `commodities` (or any commodity when none given), from `lab-results.json`.
- Caching: server cache 24 h; Refresh within 10 min of the last fresh debrief returns the cached one (cost guard). Fallback when no key / model fails: the top 5 ranked headlines, clearly labelled "Headlines, not yet analysed", cached 15 min.
- Page: a "Daily nature debrief" panel above the desk stats. Idle: one line + sparkle "Load daily debrief" button. Loading: AI shimmer border + skeleton. Loaded: summary, story cards (channel chip, risk-direction pill, headline link to source in a new tab, source · time ago, why, "In your book" loan chips that select the loan on the desk), "Updated …" + Refresh. Kept in IndexedDB for 24 h; on later visits the panel opens loaded.

## Anti-goals
Invented links or numbers; a slow or janky panel; spending on every page load.
