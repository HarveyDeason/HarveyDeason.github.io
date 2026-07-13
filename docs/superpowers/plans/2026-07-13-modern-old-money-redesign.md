# Modern Old Money Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin harveydeason-site to the approved "modern old money on a v0/shadcn foundation" design (spec: `docs/superpowers/specs/2026-07-13-modern-old-money-redesign.md`), keeping the static vanilla-JS architecture and the gear-train mechanism.

**Architecture:** Static multi-page site, ES modules, no build step. All visual change flows from a rewritten token-based `site.css` plus targeted JS module updates. The committed mockup `docs/superpowers/specs/2026-07-13-mockup-reference.html` is the **pixel source of truth** — its CSS blocks are copied/adapted verbatim, not reinvented.

**Tech Stack:** HTML/CSS/vanilla ES modules, Node built-in test runner (`node --test tests/`), GitHub Pages.

## Global Constraints

- No frameworks, no Tailwind, no build step. Hand CSS with custom-property tokens only.
- Components style through tokens only; token values exactly as in spec §2 (copied into mockup reference `:root` / `[data-mode="dark"]`).
- Mode attribute lives on `<html>` as `data-mode="light"|"dark"`; persisted to `localStorage` key `hd-mode`; stored choice beats `prefers-color-scheme`; inline head script prevents theme flash.
- Typography: sans-first (`'Geist','Segoe UI',system-ui,sans-serif`); serif = Georgia stack, only for hero flourish + `.post-body`; mono = `ui-monospace,'Cascadia Code','Consolas',monospace` with `tabular-nums`. No italic headings, no letterspaced small-caps labels.
- `prefers-reduced-motion: reduce` disables: gear idle spin, shimmer, reveals, count-up, spotlight.
- Focus-visible: `outline:2px solid var(--ring); outline-offset:2px` site-wide.
- WordPress sanitizer logic in `assets/js/wordpress.js` must NOT change (tests must stay green).
- Every page must render without console errors and without horizontal scroll at 375px width.
- Run full suite `node --test tests/` before every commit; all tests green.
- Commit after every task with `Co-Authored-By: Claude <noreply@anthropic.com>` trailer.

**Files overview:**
- Rewrite: `assets/css/site.css`, `assets/js/layout.js`, `assets/js/motion.js`, all 7 page HTML files
- Modify: `assets/js/gear-train.js` (colours only + dpr/teardown fixes), `assets/js/tools.js`, `assets/js/wordpress.js` (mount markup only), `assets/js/tool-frame.js`
- Create: `assets/js/mode.js`, `assets/js/palette.js` (command palette), `assets/fonts/` (Geist), `tests/mode.test.js`, `tests/palette.test.js`
- Tests to update: `tests/layout.test.js`, `tests/tools.test.js`, `tests/wordpress.test.js` (mount markup assertions only)

---

### Task 1: Design tokens + base stylesheet + mode module

**Files:**
- Create: `assets/js/mode.js`, `tests/mode.test.js`
- Rewrite: `assets/css/site.css`

**Interfaces:**
- Produces: CSS classes `.container .nav .nav-row .logo .nav-links .btn .btn-primary .btn-outline .btn-ghost .lamp .badge .section .section-head .link-btn .bento .cell .chip .post .foot .fig .gearbox .skeleton` (names/styles per mockup reference lines 1–260); `mode.js` exports `resolveMode(stored, systemDark)` and `applyMode(mode)` and `toggleMode()`.
- Consumes: nothing.

- [ ] **Step 1: Write failing tests for mode resolution**

`tests/mode.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMode } from '../assets/js/mode.js';

test('stored choice wins over system', () => {
  assert.equal(resolveMode('dark', false), 'dark');
  assert.equal(resolveMode('light', true), 'light');
});
test('no stored choice follows system', () => {
  assert.equal(resolveMode(null, true), 'dark');
  assert.equal(resolveMode(null, false), 'light');
  assert.equal(resolveMode(undefined, false), 'light');
});
test('garbage stored value falls back to system', () => {
  assert.equal(resolveMode('banana', true), 'dark');
});
```

- [ ] **Step 2: Run to verify failure** — `node --test tests/mode.test.js` → FAIL (module not found).

- [ ] **Step 3: Implement `assets/js/mode.js`**

```js
const KEY = 'hd-mode';

export function resolveMode(stored, systemDark) {
  if (stored === 'dark' || stored === 'light') return stored;
  return systemDark ? 'dark' : 'light';
}

export function applyMode(mode) {
  document.documentElement.dataset.mode = mode;
}

export function currentMode() {
  return document.documentElement.dataset.mode === 'dark' ? 'dark' : 'light';
}

export function toggleMode() {
  const next = currentMode() === 'dark' ? 'light' : 'dark';
  applyMode(next);
  try { localStorage.setItem(KEY, next); } catch {}
  return next;
}

export function initMode() {
  let stored = null;
  try { stored = localStorage.getItem(KEY); } catch {}
  applyMode(resolveMode(stored, matchMedia('(prefers-color-scheme: dark)').matches));
}
```

- [ ] **Step 4: Verify pass** — `node --test tests/mode.test.js` → PASS.

- [ ] **Step 5: Rewrite `assets/css/site.css`**

Copy the entire `<style>` content of `docs/superpowers/specs/2026-07-13-mockup-reference.html` as the new base, then adapt:
- Change mode selectors from `[data-mode=…]` on body to `:root[data-mode="light"]` / `:root[data-mode="dark"]`, and add a `@media (prefers-color-scheme: dark)` block redefining the dark tokens for the no-JS case (`:root:not([data-mode])`).
- Delete the `.notes` proposal block styles (mockup-only).
- Add skeleton styles:
```css
.skeleton{background:var(--muted); border-radius:8px; position:relative; overflow:hidden;}
.skeleton::after{content:""; position:absolute; inset:0;
  background:linear-gradient(90deg,transparent,rgb(255 255 255 / .35),transparent);
  animation:shimmer 1.4s infinite;}
[data-mode="dark"] .skeleton::after{background:linear-gradient(90deg,transparent,rgb(255 255 255 / .06),transparent);}
@keyframes shimmer{from{transform:translateX(-100%);}to{transform:translateX(100%);}}
```
- Keep the existing `@media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important;}}` rule.
- Keep `:focus-visible{outline:2px solid var(--ring); outline-offset:2px;}` and `img{max-width:100%;}`.
- Font stacks per Global Constraints (Geist first; the font files land in Task 2 — stack works without them).

- [ ] **Step 6: Full suite** — `node --test tests/` → existing tests still pass (CSS not covered; mode tests green).

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat: shadcn stone token system, base stylesheet, mode module"`

---

### Task 2: Self-host Geist Sans

**Files:**
- Create: `assets/fonts/GeistVF.woff2`, modify `assets/css/site.css` (top)

- [ ] **Step 1: Download Geist variable font**

```bash
curl -L -o assets/fonts/GeistVF.woff2 https://raw.githubusercontent.com/vercel/geist-font/main/packages/next/dist/fonts/geist-sans/Geist-Variable.woff2
```
If that path 404s, locate the variable woff2 in the repo listing (`gh api repos/vercel/geist-font/contents/...`) — any official Geist Sans variable woff2 is acceptable. Verify: file exists and is >50KB, `file assets/fonts/GeistVF.woff2` reports woff2/data.

- [ ] **Step 2: Add `@font-face` at top of site.css**

```css
@font-face{
  font-family:'Geist';
  src:url('/assets/fonts/GeistVF.woff2') format('woff2');
  font-weight:100 900; font-display:swap;
}
```

- [ ] **Step 3: Visual check** — serve (`npx serve` or preview server), confirm navbar/headings render in Geist (compare against Segoe: Geist has single-storey 'g' in headings? — simplest check: DevTools → computed font). No layout breakage.

- [ ] **Step 4: Commit** — `git commit -m "feat: self-host Geist Sans variable font"`

---

### Task 3: Navbar + footer rewrite (`layout.js`)

**Files:**
- Rewrite: `assets/js/layout.js`
- Modify: `tests/layout.test.js`

**Interfaces:**
- Produces: `renderHeader(active)`, `renderFooter()`, `mountLayout(active)` (same signatures as today). Header markup = mockup reference navbar block: logo with `.dot`, links Instruments/Journal/About, search icon-button `#palette-btn` (aria-label "Search — Ctrl+K"), lamp `#lamp` (`aria-pressed`), CTA `.btn.btn-primary` "Get in touch" → `/contact/`. `mountLayout` also calls `initMode()` from `mode.js` and wires lamp click → `toggleMode()` + icon swap (sun/moon SVG paths exactly as in mockup reference script).
- Consumes: `mode.js` (Task 1).

- [ ] **Step 1: Update `tests/layout.test.js`** — adjust assertions: header contains `class="logo"`, all four nav labels (Instruments, Journal, About, Get in touch), `id="lamp"`, `aria-current="page"` logic unchanged; footer contains "Built by hand" and "United Kingdom" and no `titleblock`. Run → FAIL.
- [ ] **Step 2: Rewrite `layout.js`** per mockup reference markup (navbar + footer blocks verbatim, with `aria-current` on active link, lamp icon swap logic moved into `mountLayout`).
- [ ] **Step 3: `node --test tests/` → PASS.**
- [ ] **Step 4: Browser check** — every page still mounts header/footer, lamp toggles and persists across reload, no flash (see Task 4 head script; before Task 4, verify on home only after it lands).
- [ ] **Step 5: Commit** — `"feat: glass navbar and minimal footer with lamp"`

---

### Task 4: Home page rebuild

**Files:**
- Rewrite: `index.html`
- Modify: `assets/js/gear-train.js` (palette + dpr/teardown), `assets/js/tools.js` + `assets/js/wordpress.js` (mount markup, see Interfaces), `tests/tools.test.js`, `tests/wordpress.test.js`

**Interfaces:**
- Produces: `initGearTrain(canvas, opts)` gains `opts.palette: () => ({edge:[r,g,b], n0:[r,g,b], n1:[r,g,b], glow:string})` (defaults to reading `document.documentElement.dataset.mode`; light `{edge:[28,25,23], n0:[120,113,108], n1:[29,58,43], glow:'rgba(29,58,43,0.07)'}`, dark `{edge:[250,250,249], n0:[128,122,118], n1:[205,174,107], glow:'rgba(205,174,107,0.08)'}`), returns a `destroy()` teardown; `mountTools(id, tools, limit)` renders `.bento` with `.cell` markup (wide pattern index 0 and 3 per row-group of 4) incl. icon tile, chips from `tool.tags` (add `tags: []` to `data/tools.json` entries: HydroSizer `["Hydraulics","BS EN 805"]`, Pipe Hydraulics `["Hydraulics"]`, PCF Matrix `["Drawing office"]`, Platform Access `["Safety","EN ISO 14122"]`, P&ID Tag Register `["QA"]`, Column Merge `["Data"]`), mono `№` from array index; `mountPosts(id, posts)` renders `.post` editorial rows (mono date `DD MMM YY`, title, excerpt, arrow). Both render `.skeleton` placeholders via new exported `renderSkeletonCells(n)` / `renderSkeletonRows(n)` used before fetch resolves.
- Consumes: Tasks 1–3 modules.

- [ ] **Step 1: Head anti-flash script** — in `index.html` `<head>` before the stylesheet link (and replicate on every page in later tasks):
```html
<script>(function(){try{var s=localStorage.getItem('hd-mode');var d=s==='dark'||s==='light'?s:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.mode=d;}catch(e){}})();</script>
```
- [ ] **Step 2: Update mount tests** — `tests/tools.test.js`: `mountTools` output contains `class="cell` , `class="chip"`, `№`; `tests/wordpress.test.js`: `mountPosts` output contains `class="post"` and mono date; sanitizer tests untouched. Run → FAIL.
- [ ] **Step 3: Rebuild `index.html` body** from mockup reference hero/sections markup verbatim (badge, H1 with flourish, sub, CTA pair — no dimension line; Rev C retired it), stats row with `data-count="6"` and `data-count="14"` + static "BS 8888", gearbox canvas + FIG caption, featured instruments bento (`renderSkeletonCells(3)` initial), journal rows (`renderSkeletonRows(3)` initial). Keep module script wiring as today but add `initMode` via `mountLayout`.
- [ ] **Step 4: Gear-train palette + fixes** — add palette param as specified; recompute `dpr` inside `size()`; return `destroy()` removing window resize listener and cancelling RAF. Geometry/mesh/drag code untouched. `tests/gear-train.test.js` must still pass unmodified.
- [ ] **Step 5: Update `tools.js` / `wordpress.js` mount functions** to produce the new markup (escape logic and fetch/sanitizer code untouched).
- [ ] **Step 6: `node --test tests/` → PASS.**
- [ ] **Step 7: Browser check** — home renders per mockup in both modes; gears drag + recolour on lamp; skeletons visible on throttled network; live posts load; no console errors; 375px no horizontal scroll.
- [ ] **Step 8: Commit** — `"feat: rebuild home page — hero, bento, journal rows, token gears"`

---

### Task 5: Tools index + tool back-bar

**Files:**
- Rewrite: `tools/index.html` (body markup; keep module wiring)
- Modify: `assets/js/tool-frame.js`

**Interfaces:**
- Consumes: `mountTools` full-list mode (no limit) from Task 4; layout/mode modules.
- Produces: back-bar markup `.nav`-tokened glass bar with `.btn.btn-ghost` "← Instruments" + lamp button (calls `toggleMode()`).

- [ ] **Step 1: Rebuild `tools/index.html`** — head script + section-head ("The instruments" + muted sub) + full bento grid with skeletons.
- [ ] **Step 2: Restyle back-bar in `tool-frame.js`** to glass bar tokens; include head anti-flash script injection is NOT possible (tool pages are standalone HTML) — instead add the inline script to each `tools/*.html` head (6 files) and the shared stylesheet link if missing.
- [ ] **Step 3: `node --test tests/` → PASS; browser check tools index + one tool page (hydrosizer) in both modes.**
- [ ] **Step 4: Commit** — `"feat: tools cabinet bento + tokened tool back-bar"`

---

### Task 6: Writing index + post reader

**Files:**
- Rewrite: `writing/index.html`, `writing/post.html` (bodies)
- Modify: `assets/css/site.css` (post-body block), `assets/js/wordpress.js` (post page mount markup only)

**Interfaces:**
- Consumes: `mountPosts`, skeleton renderers, layout/mode.
- Produces: `.reading` column (`max-width:68ch`), sans `.post-title` (600, −1px tracking), mono date line, serif `.post-body` (18px/1.75, Georgia) with green hairline blockquote; drop cap rule deleted.

- [ ] **Step 1: Rebuild both pages** with head script, editorial list (index) and reader (post). Sanitizer call-sites unchanged.
- [ ] **Step 2: `node --test tests/` → PASS (sanitizer tests prove no regression).**
- [ ] **Step 3: Browser check with live WordPress data, both modes, 375px.**
- [ ] **Step 4: Commit** — `"feat: editorial journal list and reader"`

---

### Task 7: About + Contact

**Files:**
- Rewrite: `about/index.html`, `contact/index.html` (bodies)

**Interfaces:** Consumes layout/mode/buttons. Contact copy-email:

- [ ] **Step 1: Rebuild About** — badge + H1 (one flourish allowed) + prose in `.reading`; keep existing placeholder copy verbatim (flagged for Harvey separately).
- [ ] **Step 2: Rebuild Contact** — H1, muted sub, button row: `mailto:` primary + copy button:
```html
<button class="btn btn-outline" id="copy-email" data-email="deason.harvey11@gmail.com">Copy email</button>
<script type="module">
  const b = document.getElementById('copy-email');
  b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.dataset.email); } catch { return; }
    const t = b.textContent; b.textContent = 'Copied ✓';
    setTimeout(() => { b.textContent = t; }, 1500);
  });
</script>
```
- [ ] **Step 3: Suite + browser check both modes; commit** — `"feat: about and contact pages on token system"`

---

### Task 8: Command palette (Ctrl+K)

**Files:**
- Create: `assets/js/palette.js`, `tests/palette.test.js`
- Modify: `assets/js/layout.js` (wire `#palette-btn`), all page module scripts (init call), `assets/css/site.css` (palette styles)

**Interfaces:**
- Produces: `searchIndex(items, query)` pure function — case-insensitive substring match on `title` + `keywords`, returns grouped `{instruments:[], journal:[], pages:[]}` capped 5/group; `initPalette({tools, postsPromise})` binds Ctrl+K/⌘K + `#palette-btn`, renders dialog.
- Consumes: `loadTools()` data, `fetchPosts` cache.

- [ ] **Step 1: Failing tests** for `searchIndex`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchIndex } from '../assets/js/palette.js';
const items = [
  { group:'instruments', title:'HydroSizer', keywords:'pipe sizing hydraulics', href:'/tools/hydrosizer.html' },
  { group:'journal', title:'On the well-considered life', keywords:'', href:'#' },
  { group:'pages', title:'Contact', keywords:'email', href:'/contact/' },
];
test('matches title case-insensitively', () => {
  assert.equal(searchIndex(items,'hydro').instruments.length, 1);
});
test('matches keywords', () => {
  assert.equal(searchIndex(items,'email').pages.length, 1);
});
test('empty query returns everything grouped', () => {
  const r = searchIndex(items,'');
  assert.equal(r.instruments.length + r.journal.length + r.pages.length, 3);
});
test('caps groups at five', () => {
  const many = Array.from({length:9},(_,i)=>({group:'journal',title:'post '+i,keywords:'',href:'#'}));
  assert.equal(searchIndex(many,'post').journal.length, 5);
});
```
Run → FAIL.
- [ ] **Step 2: Implement `palette.js`** — pure `searchIndex` + dialog: fixed overlay (`rgb(0 0 0 / .4)` backdrop), centered card (min(560px, 92vw), 12px radius, shadow-lg), input at top (borderless, 16px), grouped results with muted group labels, active row `--muted` bg, keyboard: ↑↓ move, Enter navigates (`location.href`), Esc/backdrop closes, focus trapped in dialog, `role="dialog" aria-modal="true" aria-label="Site search"`. Pages group is static: Instruments `/tools/`, Journal `/writing/`, About `/about/`, Contact `/contact/`.
- [ ] **Step 3: Tests PASS; wire on all 5 main pages + browser check (Ctrl+K, click search icon, arrows, Enter, Esc).**
- [ ] **Step 4: Commit** — `"feat: command palette (Ctrl+K concierge)"`

---

### Task 9: Motion polish — reveals, count-up, spotlight

**Files:**
- Rewrite: `assets/js/motion.js`
- Modify: `assets/css/site.css` (spotlight custom props on `.cell`)

**Interfaces:**
- Produces: `initMotion()` — (a) staggered reveals: `[data-anim="reveal"]` sections rise 12px/0.5s; direct children of `.bento`/revealed grids get 60ms incremental `transition-delay`; (b) count-up: existing `[data-count]` behaviour, 1200ms, skipped under reduced motion (set final value immediately); (c) spotlight: on `.cell` pointermove set `--mx/--my` custom props; CSS: `.cell::after{content:"";position:absolute;inset:0;border-radius:inherit;opacity:0;transition:opacity .3s;background:radial-gradient(250px circle at var(--mx) var(--my), color-mix(in srgb, var(--primary) 5%, transparent), transparent 70%);pointer-events:none;} .cell:hover::after{opacity:1;}` gated by `@media (pointer:fine)`. Tilt code deleted.

- [ ] **Step 1: Rewrite motion.js** per above (reveal/count-up adapted from current file; delete tilt block).
- [ ] **Step 2: Browser check** — reveals stagger on scroll, stats count up once, spotlight follows cursor on bento cells, nothing animates with reduced motion emulated.
- [ ] **Step 3: Suite green; commit** — `"feat: staggered reveals, count-up stats, card spotlight; retire tilt"`

---

### Task 10: Final sweep

- [ ] **Step 1: Kill remaining heritage** — grep for retired classes (`frame`, `rule`, `eyebrow`, `wordmark`, `titleblock`, `gilt-link`, `dim `, `rc `, `seal`) in HTML/JS; remove dead CSS/markup/references (seal.svg may remain as favicon).
- [ ] **Step 2: Colophon** — footer gets `Set in Geist & Georgia · Built by hand · No trackers · United Kingdom`.
- [ ] **Step 3: A11y/contrast pass** — verify `--muted-fg` contrast both modes (stone-500 #78716c on #fafaf9 = 4.6:1 ✓; stone-400 #a8a29e on #0c0a09 ≈ 8:1 ✓); tab through every page; palette focus trap; `aria-pressed` on lamp correct.
- [ ] **Step 4: 375px pass on all pages; throttled-network skeleton check.**
- [ ] **Step 5: Full suite green; commit** — `"chore: heritage cleanup, colophon, accessibility sweep"`
