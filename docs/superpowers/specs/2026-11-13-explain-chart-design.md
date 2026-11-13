# Explain this chart: design

Date: 2026-11-13 · Status: awaiting approval

## Intent
Every chart in the Model lab gets an AI explanation, so a non-technical viewer (a board member, a CEO, a credit officer) can read any chart in seconds. This is for Tanmoy's final-round demos, where presentation matters a lot: the feature must feel premium, never clumsy or confusing.

## Goals
- One way to ask for an explanation on every experiment chart (A–H), reading the chart as it is set right now (place, scenario, measure, view).
- Three short parts: **What you're looking at** (axes, colours, markers), **What it shows here** (the reading for this place and settings), **Why it matters to a bank** (one line).
- Every number in an explanation comes from the model results; drafts with any other number are rejected.

## Non-goals
- No chat or follow-up questions.
- Not on the Lender desk or Nature map (Model lab charts only).
- The model never calculates or changes a result.

## Anti-goals (a failure even if it works)
- An explanation that states a number the chart doesn't show.
- A panel that covers the chart, jumps the page around, or looks like a generic chatbot box.
- Slow or repeated spending on the same explanation.

## Approaches considered
- **A. Written live by Gemini, cached (chosen).** Changes with place and settings; cached 24 h on the server and in the browser's IndexedDB. About 2–3 s on first view. Needs a fact builder per experiment.
- **B. Pre-written at build time.** Instant and free during a demo, but hundreds of combinations to generate on every rebuild and it doesn't feel live. Rejected.

## Design
**Trigger (Tanmoy's call).** A small AI icon (a sparkle) at the top-right of each chart, with a gentle shimmer passing over it. On hover or keyboard focus it shows a tooltip, "Explain this". It is a real button with an accessible label. The shimmer stops for people who set reduced motion.

**Panel.** Opens directly under the chart, never over it, and pushes the content below down smoothly. Header: sparkle mark, "Reading this chart", a "✓ Numbers checked" badge, and a close button. While loading: a soft shimmer skeleton of the three parts, not a spinner. If a setting or the place changes while it's open, the panel refreshes (from cache when possible). Fails quietly with a one-line message and a retry.

**Server.** A new Pages Function `POST /api/explain` with `{experiment, id, state}`. It validates every field against an allowlist, builds the facts for that experiment from `lab-results.json` (shared code in `lib/explain.mjs`, reusing the number check from `lib/note.mjs`), calls `google/gemini-3.8-flash` (or `OPENROUTER_MODEL`) through OpenRouter with a JSON schema, retries once, and otherwise returns a plain fallback built from the chart's own result sentence. Key stays server-side, as for the note.

**Caching.** Server: Cloudflare cache keyed by results version, model, experiment, place and state, 24 h. Browser: IndexedDB keyed the same way, 24 h. The panel shows when it was written.

## Left to the builder
The exact facts per experiment, icon and shimmer styling within the app's existing look (light and dark), and tests for the fact builders and the number check.
