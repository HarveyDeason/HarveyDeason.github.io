# Phase 3 — Instrument Restyle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle all five gated tools to the site's design system (spec: `docs/superpowers/specs/2026-07-19-phase3-instrument-restyle.md`), importing Harvey's updated Schedule Sync first.

**Architecture:** Shared committed skin (`assets/css/tool.css`) + chrome module (`assets/js/tool-chrome.js`) + self-hosted SheetJS; per-tool restyle edits happen in git-ignored `tools-src/` masters; ciphertext regenerated once at the end by the controller with the real workshop code (ask Harvey — it is in no file).

**Tech Stack:** Plain HTML/CSS/JS, site tokens, SheetJS 0.18.5, existing vault pipeline (`scripts/lock-tools.mjs`).

## Global Constraints

- JS LOGIC of every tool functionally identical — element IDs referenced by scripts unchanged; calculations/parsing/export/event behaviour untouched; logic bugs reported, never fixed.
- Tokens/vars from `assets/css/site.css` only; no hardcoded colours anywhere new; Geist for UI, `ui-monospace/Consolas` for data, Georgia italic for decorative only.
- Both modes via `localStorage['hd-mode']` + `dataset.mode` + anti-flash snippet (verbatim in spec); lamp in back-bar.
- No external requests from any tool (xlsx self-hosted; no CDN/fonts/analytics).
- `tools-src/` plaintext never committed; reviewer sees scratch diffs. Workshop code never in any file/log/commit; controller ASKS HARVEY in chat at regeneration.
- Suite `node --test tests/` green before every commit; trailer `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Preview server: launch.json name "site", port 5050, serves repo root (so `http://localhost:5050/tools-src/<slug>.html` works for local testing). Browser caches modules aggressively — hard-reload/cache-bust before concluding a change "didn't work".

## Model policy (Harvey)

Fable = controller AND reviewer (reviews diffs directly; no reviewer subagents). Implementers: Sonnet 5 for R0, R1, R2, R6; Opus 4.8 for R3, R4, R5 (larger/denser tools). Escalate only on BLOCKED.

---

### Task R0: Shared foundation (sonnet)

**Files:**
- Create: `assets/vendor/xlsx.full.min.js`, `assets/css/tool.css`, `assets/js/tool-chrome.js`
- Modify: `tools-src/schedule-sync.html` (byte-identical replace), `README.md` (one line: tool skin lives in tool.css; xlsx vendored)

**Interfaces (produces — later tasks rely on these exactly):**
- `tool.css` classes: `.toolbar-bar` (fixed-height back-bar), `.tool-shell` (page wrapper), `.tool-panel` (card section w/ header), `.tool-panel-head`, `.field` (label+control), `.drop-zone` (+ `.over .loaded`), `.data-table`, `.stat-tile` (+ `.good .warn .bad`), `.note` (+ `.info .warn .bad .good`), `.scroll-region`, `.btn-row`. All styled from site tokens, light+dark.
- `tool-chrome.js`: on DOMContentLoaded injects into `document.body` start: back-bar with (a) wordmark link "Harvey Deason" → `/tools/`, (b) `<span class="tool-title">` from `document.body.dataset.toolName` falling back to `document.title` before " — ", (c) lamp button toggling `hd-mode` in localStorage + `documentElement.dataset.mode` (aria-pressed reflects dark). No other behaviour. Must be idempotent (guard against double-injection).

- [ ] Step 1: Replace `tools-src/schedule-sync.html` with `C:\Users\deaso\Downloads\Schedule_Sync.html` byte-identical (`git hash-object` both, record hashes in report). This is Harvey's NEW version (Manual Tag Overrides) — restyle happens in R1, not here.
- [ ] Step 2: Vendor SheetJS: download `https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js` to `assets/vendor/xlsx.full.min.js`; record SHA-256 in report; sanity: file starts with `/*! xlsx.js` and defines `XLSX`.
- [ ] Step 3: Write `assets/js/tool-chrome.js` per interface above (~40 lines, vanilla, no imports). Lamp behaviour mirrors `assets/js/mode.js` semantics — read that file first.
- [ ] Step 4: Write `assets/css/tool.css` implementing every class in the interface, tokens only, both modes (`:root[data-mode="dark"]` overrides), focus-visible rings, `prefers-reduced-motion` respected, no horizontal scroll at 375px.
- [ ] Step 5: Build a throwaway local harness page (in scratchpad, NOT the repo) that links site.css+tool.css+tool-chrome.js and exercises every class; verify both modes in browser; delete harness.
- [ ] Step 6: Suite green; commit `feat: shared tool skin, chrome module, vendored SheetJS`.

### Tasks R1–R5: Per-tool restyle (one task each, in this order)

| Task | Tool (tools-src/) | Model | Functional smoke checklist (must all pass in browser, light AND dark) |
|------|------------------|-------|--------------------------------------------------------------------|
| R1 | schedule-sync.html | sonnet | Load a source + target .xlsx (create tiny fixtures with Node `xlsx` from vendored lib in scratchpad); sheet+header selects populate; column mapping table works; add a Manual Tag Override row incl. autocomplete datalists; build preview (stats, tag checkboxes, change table); export downloads `_updated.xlsx`; re-open exported file to confirm values changed |
| R2 | naming-validator.html | sonnet | Paste/enter example filenames; validation verdicts render; any copy/export functions work |
| R3 | hydrosizer.html | opus | Pipe sizing: enter flowrate+diameter → velocity result + formula panel updates; tank sizing tab: submergence/overflow/freeboard/working-volume calcs; export button produces output. NOTE: currently hardcoded dark — full re-skin to site modes |
| R4 | pid-tag-register.html | opus | Load a sample PDF (implementer makes a tiny one); tag scan runs; register table renders; clash/next-available functions respond; export works |
| R5 | steelwork-checker.html | opus | Each configuration (point load / UDL / flooring / stairs) accepts inputs and returns BS-checked results; mode switching between configurations; any print/export path |

**Per-task procedure (identical for R1–R5):**

- [ ] Step 1: Read the tool file fully. Inventory: element IDs used by scripts (these must not change), old CSS classes, inline styles, external refs. Write the inventory to your report file FIRST.
- [ ] Step 2: Restyle in place in `tools-src/<slug>.html`: `<head>` gets anti-flash snippet (verbatim from spec) + `<link rel="stylesheet" href="/assets/css/site.css">` + `<link rel="stylesheet" href="/assets/css/tool.css">`; `<body data-tool-name="…">` + `<script src="/assets/js/tool-chrome.js" defer>` (and for R1: xlsx `<script>` src → `/assets/vendor/xlsx.full.min.js`). Delete the old `<style>` block; rebuild markup classes onto the R0 skin classes; keep a SMALL inline `<style>` only for genuinely tool-specific layout, tokens only. JS logic untouched except: (a) class names in template strings/classList calls may be remapped 1:1 — record every remap in the report; (b) nothing else.
- [ ] Step 3: Serve repo root; open `http://localhost:5050/tools-src/<slug>.html`; run the FULL smoke checklist above in light mode, dark mode, and at 375px (no horizontal scroll). Back-bar renders, lamp syncs with a site page open in the same tab-session. Console clean; network tab shows zero external requests.
- [ ] Step 4: Produce reviewer artifacts (no commit — tools-src is git-ignored): `git diff --no-index old new` won't exist since edit is in place, so BEFORE editing copy the original to the scratchpad, and after Step 3 write `diff -u <scratch-copy> tools-src/<slug>.html > <scratchpad>/r<N>-diff.patch`; report lists: ID inventory unchanged (prove with grep), class remap table, smoke results per item.
- [ ] Step 5: If Step 2 touched shared `tool.css` (gap found in the skin), that change IS committed: separate commit `feat: tool.css additions for <slug>`, suite green first.

**Controller gate after each of R0–R5:** Fable reviews the scratch diff + report directly (spec compliance: logic untouched, IDs stable, tokens only, checklist complete). Findings → same implementer fixes → re-review. Record verdict + minors in ledger.

### Task R6: Recapture previews (sonnet)

- [ ] Step 1: Recapture all five screenshots from restyled `tools-src/` in LIGHT mode, 1280×800, headless Chrome (`"C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --screenshot --window-size=1280,800 --hide-scrollbars --virtual-time-budget=5000 file:///…`); visually verify each PNG shows the restyled UI (Read the file).
- [ ] Step 2: Convert to `assets/img/previews/<slug>.webp` (≤120KB, width 1280, quality ~80); visually verify each webp.
- [ ] Step 3: Suite green; commit `feat: refresh tool previews for restyled instruments`.

### Controller endgame (Fable, after R6)

- [ ] Review sweep of the whole round (shared assets diff + all five scratch diffs against spec).
- [ ] **Ask Harvey in chat for the workshop code** (never in a file). Regenerate: spawn-harness stdin at t=1s/3s (300ms is flaky — see ledger), `node scripts/lock-tools.mjs`.
- [ ] Verify: manifest checkKey true; all five payloads decrypt byte-identical to tools-src (script pattern in ledger Phase-2 endgame); browser: unlock one tool with the code, confirm restyled UI + function + cached-key silent unlock on a second tool.
- [ ] Commit regenerated `tools/` (`chore: regenerate loaders — restyled instruments`), suite green, push.
- [ ] Live verify: pages 200, live payload decrypts, `tools-src/` 404s, preview images updated (remember GitHub Pages ~10-min browser cache when eyeballing).
- [ ] Update ledger + memory; remind Harvey of the code-caching quirk if previews look stale.

### Self-review notes (writing-plans checklist)

- Spec coverage: decisions 1-4 → R0 (2), R1-R5 (1,3,4), acceptance → per-task Step 3 + endgame. ✓
- The one deliberate deviation from plan-writing norms: R1-R5 cannot embed complete restyled code — the masters are local-only plaintext (149KB max) that the plan must not reproduce, and their content is unknown to this doc. The per-task procedure + interface contract + smoke checklists are the binding substitute. Reviewers gate on the scratch diffs.
