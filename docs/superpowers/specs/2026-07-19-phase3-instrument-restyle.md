# Phase 3 — Instrument Restyle — Spec

**Goal:** Every gated tool looks and feels like the site: same tokens, same Geist/Georgia typography, same racing-green/gilt light-dark behaviour, one product. Also imports Harvey's updated Schedule Sync (new version with Manual Tag Overrides, in `C:\Users\deaso\Downloads\Schedule_Sync.html`).

## Decisions (Harvey, 2026-07-19 — binding)

1. **Restyling tool HTML is now allowed.** This SUPERSEDES the Phase-2 rule "tool inner HTML is Harvey's work, never edit." New rule: **markup and CSS may be freely reworked; JavaScript LOGIC must remain functionally identical.** Element IDs referenced by scripts stay; calculations, parsing, export behaviour, event flows are untouchable. Any logic bug found is reported, never fixed silently.
2. **xlsx library self-hosted** at `assets/vendor/xlsx.full.min.js` (SheetJS 0.18.5, the exact version Schedule Sync's CDN tag pins). No external requests from any tool.
3. **Slim back-bar chrome** on every tool: a top bar in site style — wordmark linking back to `/tools/`, tool name, lamp (mode) toggle. Tools remain standalone full-page apps below the bar; no full site navbar.
4. **Shared light/dark mode:** tools read/write the same `localStorage['hd-mode']` the site uses, apply `document.documentElement.dataset.mode`, and include the anti-flash snippet. HydroSizer's hardcoded dark theme is replaced by site-mode-aware styling like every other tool.

## Design system reference

- Tokens: `assets/css/site.css` `:root` blocks — `--background --card --foreground --muted --muted-fg --border --input --primary --primary-hover --primary-fg --accent-gold --destructive --ring --radius --shadow-*`. Light = stone + racing green `#1d3a2b`; dark = stone-950 + gilt `#cdae6b` primary.
- Type: Geist (self-hosted `/assets/fonts/GeistVF.woff2`, weights 100-900) for UI; Georgia italic (`.flourish`) only for decorative accents; `ui-monospace/Consolas` stack for data/tags (matches title-block cells).
- Existing components worth echoing: `.btn .btn-primary .btn-outline`, `.chip`, card surfaces (`--card` + `--border` + 12px radius + `--shadow-sm`), the `.vault-*` unlock screen, About's `.rev-table` (good model for data tables), stat tiles on home.
- Anti-flash mode snippet (copy verbatim from any page `<head>`):
  `(function(){try{var s=localStorage.getItem('hd-mode');var d=s==='dark'||s==='light'?s:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.mode=d;}catch(e){}})();`

## Architecture

- **Shared, committed assets** (public repo — contain no tool logic):
  - `assets/css/tool.css` — the tool app skin: back-bar, page shell, panels/steps, form controls, buttons, data tables, stat tiles, notes/alerts, drop zones, scroll regions — all from site tokens, light+dark.
  - `assets/js/tool-chrome.js` — injects the back-bar (wordmark → `/tools/`, tool name from `document.title` or `data-tool-name`, lamp button), wires the lamp to `hd-mode`, no other behaviour.
  - `assets/vendor/xlsx.full.min.js` — SheetJS 0.18.5.
- **Plaintext masters stay in git-ignored `tools-src/`** — restyled sources exist locally + as committed ciphertext only. Implementers hand reviewers scratch diffs of tools-src (never commit plaintext).
- Tools link `/assets/css/site.css` + `/assets/css/tool.css`, load `/assets/js/tool-chrome.js`, keep any tool-specific CSS as a small inline block using tokens only. Schedule Sync's CDN `<script src>` becomes `/assets/vendor/xlsx.full.min.js`.
- After all restyles: previews recaptured (uniform look), loaders regenerated with the real workshop code, deployed.

## Security & process invariants (unchanged from Phase 2)

- Workshop code NEVER in any file/commit/log. The controller does not know it at session start: **ask Harvey in chat** when regeneration time comes (or hand him the run). Regeneration procedure and stdin-harness timing notes: see ledger `.superpowers/sdd/progress.md` (Phase 2 endgame + post-launch round).
- Suite `node --test tests/` green before every commit. Sanitizer untouched. Trailer `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Nothing sensitive in console/network; tools must work offline once unlocked.

## Acceptance (per tool)

Site-consistent in both modes at 1280 and 375 (no horizontal scroll); back-bar present and lamp syncs with site; all functions work exactly as before (per-tool smoke checklist in the plan); no external requests; no console errors.
