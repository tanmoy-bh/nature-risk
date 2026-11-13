# Explain This Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A sparkle button on every Model lab chart that opens a three-part, number-checked AI explanation of the chart as currently set.

**Architecture:** The browser sends `{experiment, id, state}` to a new Pages Function `/api/explain`. The function builds facts for that experiment from `lab-results.json` (`lib/explain.mjs`), asks Gemini through OpenRouter (shared helper `lib/openrouter.mjs`, also used by `/api/note`), checks every number with `badNumbers` from `lib/note.mjs`, caches 24 h, and falls back to a plain explanation. The page caches answers in IndexedDB for 24 h.

**Tech Stack:** Cloudflare Pages Functions (ESM), OpenRouter chat completions with `response_format: json_schema`, vanilla JS/CSS in `src/lab.html`, `node --test`, Playwright for the visual check.

**Spec:** `docs/superpowers/specs/2026-11-13-explain-chart-design.md`

## Global Constraints
- Model: `env.OPENROUTER_MODEL || "google/gemini-3.8-flash"`; key only in `env.OPENROUTER_API_KEY`; never in `src/` or tests.
- Explanation fields, in order, with these labels: `look` "What you're looking at", `shows` "What it shows here", `matters` "Why it matters to a bank".
- Trigger: sparkle icon at the top-right of each chart, shimmer animation, tooltip text exactly "Explain this", `aria-label="Explain this chart"`; shimmer off under `prefers-reduced-motion: reduce`.
- Panel opens under the chart, never over it; header "Reading this chart"; badge "✓ Numbers checked" only when the model's draft passed.
- Cache: server Cloudflare cache 24 h (`max-age=86400`); browser IndexedDB 24 h; key = results version + model + experiment + id + state.
- Never show the old pricing rule; copy is plain English; works in light and dark themes and at 360 px wide.
- Commit author `tanmoy-git <tanmoy.the.champ@gmail.com>` with the session's attribution lines.

## Review Focus
- A state value the server doesn't know (e.g. `am:"foo"`) → 400, never a prompt built from it. Test in Task 2.
- Experiments B–E are per place; F and G are book-wide → the cache key ignores `id` for F and G so one explanation serves every place. Test in Task 1.
- The user changes place or a control while a request is in flight → the late answer must not overwrite the newer one. Test in Task 3 (request token check).
- No API key or the model times out → a fallback explanation, not an error, and no "✓ Numbers checked" badge. Test in Task 2.
- Chart re-renders (theme toggle, Reset view) must not remove the trigger or close an open panel. Check in Task 3's visual step.

---

### Task 1: Facts and fallback for every experiment

**Files:**
- Create: `lib/explain.mjs`
- Test: `tests/explain.test.mjs`

**Interfaces:**
- Consumes: `badNumbers(text, factsText)` and `NOTE_KEYS`-style checks from `lib/note.mjs`.
- Produces:
  - `EXPERIMENTS: Record<"exp-a".."exp-h", {state: Record<string,string[]>, perPlace: boolean}>` — allowed state keys/values: `exp-a {am:[price,pd,el], a:[base,drought,defor,engage]}`, `exp-e {e:[base,drought], ev:["3d","map"]}`, `exp-h {hv:[move,without,with], hs:[base,drought,defor,engage]}`, others `{}`; `perPlace` false for `exp-f`, `exp-g`.
  - `explainFacts(results, exp, id, state) -> {exp, id, key, guide, text} | null` — `null` for an unknown experiment, place, state key or value. `key` is `exp|id|state` with `id` replaced by `book` when not `perPlace`. `guide` is fixed text describing the chart's axes, colours and markers for that experiment and view; `text` is `- label: value` lines of the numbers the chart shows (same formatting helpers as `lib/note.mjs`: `fmt`, `pct`, `$k`, `$m`).
  - `EXPLAIN_SCHEMA` (JSON schema, fields `look`, `shows`, `matters`, all required strings, no extra properties), `EXPLAIN_KEYS = ["look","shows","matters"]`, `EXPLAIN_SYSTEM` (same rules as `NOTE_SYSTEM`: only these facts, copy numbers exactly, plain English, each field at most 2 sentences / 45 words).
  - `checkExplain(reply, facts) -> {ok, bad, missing}`; `fallbackExplain(facts) -> {look, shows, matters}` built only from `guide` and `text`.
- Facts per experiment (from `results`): A — for the chosen measure and scenario: the place's traditional and nature values, count cheaper/dearer and $ of each from `portfolio[sc]`; B — `mc.pd_mc0`, `mc.pd_mcN`, `mc.pd_anN`, gap %, `grids.N_MC`; C — `unc.point`, `p5`, `p95`, `share_pos`, `grids.N_U`; D — top 3 `tornado.rows` with `lo`, `hi`, `at_lo`, `at_hi`, `base`; E — place `here` (loss, deficit), price change at the nearest grid cell of `surface[e]`, max−min across the loss axis and the deficit axis; F — `portfolio.base.without/with` `EL` and `q999`, difference; G — `EL`, `regK` for `without/with` and `prov0/provN` for base, drought, defor, engage; H — zone totals green/amber/red ($m) without and with (EL per loan = PD × LGD × exposure; zones < $0.1m, < $0.25m, else red), for the chosen scenario.

- [ ] **Step 1: Write the failing tests** in `tests/explain.test.mjs`:
  - `explainFacts returns facts for every experiment at its default state` — loop over `exp-a`…`exp-h` with A19 and default states (`am:"price",a:"base"`, `e:"base",ev:"3d"`, `hv:"move",hs:"base"`); assert non-null, `text` non-empty, `guide` non-empty.
  - `explainFacts rejects unknown input` — `null` for `exp-z`, id `A99`, `{am:"foo"}`, and an extra key `{x:"1"}` on `exp-b`.
  - `book-wide experiments share one cache key` — `explainFacts(r,"exp-f","A19",{}).key === explainFacts(r,"exp-f","A03",{}).key`; `exp-b` keys differ between A19 and A03.
  - `the fallback passes the number check for every experiment, place and state` — for all 27 ids × every allowed state combination, `checkExplain(fallbackExplain(f), f).ok === true`.
  - `the number check rejects invented numbers` — a reply whose `shows` contains `999` fails with `bad` including `"999"`.
- [ ] **Step 2: Run** `node --test tests/explain.test.mjs` — expect FAIL (module not found).
- [ ] **Step 3: Implement `lib/explain.mjs`** with the interfaces above.
- [ ] **Step 4: Run** `node --test` — expect all tests PASS.
- [ ] **Step 5: Commit** `lib/explain.mjs tests/explain.test.mjs` — "Add chart facts and fallback explanations for the Model lab".

### Task 2: OpenRouter helper and `/api/explain`

**Files:**
- Create: `lib/openrouter.mjs`, `functions/api/explain.js`
- Modify: `functions/api/note.js` (use the helper; behaviour unchanged)
- Test: `tests/explain-api.test.mjs`

**Interfaces:**
- Consumes: Task 1 exports; `lib/note.mjs`.
- Produces:
  - `askJSON(env, {system, user, schema, name}) -> {reply} | {error}` — POST `https://openrouter.ai/api/v1/chat/completions` with `model: env.OPENROUTER_MODEL || "google/gemini-3.8-flash"`, `temperature: 0.2`, `max_tokens: 400`, `response_format: {type:"json_schema", json_schema:{name, strict:true, schema}}`, 25 s timeout; `error` strings `"model HTTP <status>"`, `"model timed out"`, `"model reply unreadable"`.
  - `POST /api/explain` body `{experiment, id, state, again?}` → 200 `{explain:{look,shows,matters}, source:"model"|"fallback", model?, written: ISO time, cached?: true, reason?}`; 400 `{error}` for invalid JSON or `explainFacts` null; other methods 405. Cache key `https://explain-cache.invalid/<results sha>/<model>/<facts.key>`, `Cache-Control: max-age=86400`; `again:true` skips the read. Only model drafts are cached. Two tries (second adds "Use only numbers that appear in the facts, copied exactly."), then fallback.
- [ ] **Step 1: Write failing tests** in `tests/explain-api.test.mjs`, calling `onRequestPost` with a mocked `env.ASSETS.fetch` (returns `analysis/results.json`), a `globalThis.caches.default` backed by a `Map`, and a mocked `globalThis.fetch`:
  - `returns a checked model explanation and caches it` — first call `source:"model"`, one fetch; second identical call `cached:true`, still one fetch.
  - `falls back when the draft invents a number` — mock returns `shows` with `999` both times → `source:"fallback"`, two fetches, `reason` mentions `999`.
  - `falls back without a key` — `env.OPENROUTER_API_KEY` unset → `source:"fallback"`, zero fetches.
  - `rejects unknown experiments and state` — `{experiment:"exp-a", id:"A19", state:{am:"foo"}}` → 400; zero fetches.
  - `again skips the cache` — after a cached call, `again:true` → one more fetch.
  - Existing `tests/note.test.mjs` still passes (note.js now uses `askJSON`).
- [ ] **Step 2: Run** `node --test tests/explain-api.test.mjs` — expect FAIL.
- [ ] **Step 3: Implement** `lib/openrouter.mjs`, `functions/api/explain.js`; switch `functions/api/note.js` to `askJSON`.
- [ ] **Step 4: Run** `node --test` — all PASS.
- [ ] **Step 5: Commit** — "Add /api/explain and share the OpenRouter call with the committee note".

### Task 3: Sparkle trigger and explanation panel in the Model lab

**Files:**
- Modify: `src/lab.html` (CSS, `expView`, `drawView`, `init`)
- Test: `tests/lab.test.mjs` (add assertions); Playwright check script in the scratch folder (not committed)

**Interfaces:**
- Consumes: `POST api/explain` from Task 2.
- Produces (in `src/lab.html`): `explainState(view) -> object` (A `{am:st.am,a:st.a}`, E `{e:st.e,ev:st.ev}`, H `{hv:st.hv,hs:st.hs}`, else `{}`); `openExplain(view, {again})`; IndexedDB store `explain` in database `nature-risk-lab` (bump version to 2, keep `results`), entries `{value, at}` read only when `Date.now()-at < 86400000`.
- Behaviour:
  - Each experiment's chart area is wrapped in `.chartwrap` with a `button.aibtn` (sparkle SVG, `aria-label="Explain this chart"`, tooltip "Explain this" on hover and focus) absolutely positioned at the top-right **outside the Plotly plot area** so it never covers data; for G (three panels) one button for the group.
  - Clicking toggles `.explain` panel directly after the chart wrap: header (sparkle, "Reading this chart", badge, "Written <time>", Refresh, close ✕), body with the three labelled parts. Loading state: three shimmer bars. Height animates open; respects reduced motion.
  - While open, control clicks and place changes call `openExplain` again (cache first). A request token (incrementing integer) discards stale responses.
  - Refresh sends `again:true` and replaces the IndexedDB entry.
- [ ] **Step 1: Add failing assertions** to `tests/lab.test.mjs`: `src/lab.html` contains `aria-label="Explain this chart"`, `Explain this`, `fetch("api/explain"`, `Reading this chart`, `prefers-reduced-motion`, and no `openrouter`.
- [ ] **Step 2: Run** `node --test tests/lab.test.mjs` — expect FAIL.
- [ ] **Step 3: Implement** the trigger, panel, caching and state hooks in `src/lab.html`.
- [ ] **Step 4: Run** `node --test` and `node scripts/build.mjs` — PASS, build succeeds.
- [ ] **Step 5: Visual check** with Playwright against `dist/` and a stubbed `/api/explain` (200 ms delay): screenshots at 1280 px light, 1280 px dark, and 390 px for A, E (3D and map) and G; hover screenshot showing "Explain this"; confirm the panel never overlaps the chart, the theme toggle and Reset view keep the button and an open panel, switching place while loading shows only the newest answer, and there are no console errors.
- [ ] **Step 6: Commit** — "Explain any Model lab chart with a checked AI reading".

### Task 4: Docs

**Files:** Modify `README.md`.
- [ ] **Step 1:** Add an "Explain this chart" section under "Committee note (cloud model)": what it sends, the number check, 24 h caching, same key and model settings.
- [ ] **Step 2:** `node --test` passes; commit — "Document Explain this chart".
