# Modern Old Money Redesign — Design Spec

**Date:** 2026-07-13
**Status:** Approved by Harvey (via Proposal HD—002 Rev C.1 mockup)
**Reference mockup:** claude.ai artifact `d0358f6c` (Rev C.1) — the visual source of truth. This spec translates it into build requirements.

## 1. Goal

Reskin harveydeason-site from the heritage/engraved aesthetic to **"modern old money on a v0/shadcn foundation"**: shadcn stone design tokens, v0 component recipes (badge, button pair, bento grid, glass navbar, skeletons, command palette), sans-first typography — with racing green and a whisper of gilt as the old-money accent, and the interactive gear train kept as the hero figure.

**Not changing:** architecture. Still a static vanilla-JS ES-module site for GitHub Pages. No frameworks, no Tailwind, no build step. Hand-written CSS using custom-property tokens. Existing Node test suite stays and is updated, not deleted.

## 2. Design tokens (`site.css` `:root`)

Two modes on `<html data-mode="light|dark">`. Components style **only through tokens**.

| Token | Light | Dark |
|---|---|---|
| `--background` | `#fafaf9` (stone-50) | `#0c0a09` (stone-950) |
| `--card` | `#ffffff` | `#1c1917` |
| `--foreground` | `#1c1917` | `#fafaf9` |
| `--muted` | `#f5f5f4` | `#292524` |
| `--muted-fg` | `#78716c` | `#a8a29e` |
| `--border` | `#e7e5e4` | `#292524` |
| `--input` | `#d6d3d1` | `#44403c` |
| `--primary` | `#1d3a2b` (racing green) | `#cdae6b` (gilt) |
| `--primary-hover` | `#254735` | `#dcc084` |
| `--primary-fg` | `#fafaf9` | `#1c1917` |
| `--accent-gold` | `#a9863f` | `#cdae6b` |
| `--ring` | = primary | = primary |
| `--glass` | `rgb(250 250 249 / .8)` | `rgb(12 10 9 / .8)` |
| `--grid-dot` | `rgb(28 25 23 / .07)` | `rgb(250 250 249 / .06)` |

Radius: `--radius: 0.5rem` (cards 12px, buttons/inputs 6px, chips 999px). Shadows: shadcn `shadow-sm/md/lg` recipes (see mockup CSS).

**Mode logic:** default follows `prefers-color-scheme`; the lamp button toggles and persists to `localStorage('hd-mode')`; stored choice wins over system. No flash-of-wrong-theme: inline script in `<head>` sets `data-mode` before CSS paints.

## 3. Typography

- **Sans (primary):** self-hosted **Geist Sans** variable woff2 (open source, Vercel) at `/assets/fonts/`; stack `'Geist','Segoe UI',system-ui,sans-serif`. All UI: nav, headings, body, cards, buttons.
- **Serif (flourish + long-form):** Georgia stack. Used for (a) the single italic flourish phrase in the hero H1, (b) journal post reading body (`.post-body`), which stays serif at 18px/1.75 — modern editorial, FT-style. Post *titles* move to tight-tracked sans.
- **Mono:** `ui-monospace,'Cascadia Code','Consolas',monospace`, `font-variant-numeric: tabular-nums`. Dates, figure captions, instrument numbers, stats.
- Headline style: weight 600, letter-spacing −2.5px at display size (see mockup H1). No italic headings, no small-caps letterspaced labels anywhere.

## 4. Layout & components (per mockup)

- **Navbar:** sticky, `--glass` + `backdrop-filter: blur(12px)`, hairline bottom border. Logo = gilt diamond mark + "Harvey Deason" (600). Links as quiet ghost buttons. Right side: lamp icon-button (sun/moon SVG swap) + primary CTA "Get in touch" → `/contact/`.
- **Buttons:** `.btn-primary` (green/gilt, shadow-sm, −1px lift on hover), `.btn-outline` (card bg, input border), `.btn-ghost`. 6px radius, 13.5px/500.
- **Hero (home):** two-column grid (1.05fr/.95fr, stacks <820px). Left: badge pill with gilt status dot ("Design engineer · Waterworks & utilities · UK"), display H1 with one serif-italic green flourish, muted sub, button pair, stats row (mono count-up: instruments count, essays count, "BS 8888"). Right: **gear train canvas** + mono caption `FIG. 01 — GEAR TRAIN · DRAG TO DRIVE` between hairlines. Dot-grid background (`radial-gradient` dots, 22px, radial mask fading down).
- **Gear train:** keep `gear-train.js` mechanism untouched (geometry, mesh phasing, drag, idle spin, reduced-motion pause). Change only rendering colours to a palette param read per-frame from `data-mode`: edges = foreground low-alpha; node colour lerps stone-neutral → primary with depth (green in light, gilt in dark); glow = primary at ~7% alpha. Fix the two known minors while in there: recompute `dpr` on resize, add listener teardown.
- **Bento grid (instruments):** 3-col grid, `wide` cells span 2 (pattern: wide, 1, 1, wide, …). Cell = card token bg, 12px radius, icon tile (36px, muted bg, thin-stroke SVG in primary), title 600, muted description, metadata chips (standards: "BS EN 805" etc.), mono `№` top-right. Hover: shadow-lg, −2px lift, border→gilt, subtle cursor spotlight (see §5).
- **Journal rows:** editorial list — mono date, sans title 600, muted excerpt, arrow that slides 3px on hover, full-row `--muted` hover bg, hairline separators. Used on home (3) and `/writing/` (all).
- **Skeleton loading:** while tools.json/WordPress fetch, render skeleton rows/cells (muted bg, shimmer via subtle gradient sweep; static under reduced motion). Replaces "Loading…" text everywhere.
- **Post reader:** serif body preserved (incl. existing sanitizer!), sans H1 title, mono date, hairline rules. Drop cap retired. Blockquote: green left hairline, serif italic.
- **Tool pages (`/tools/*.html`) back-bar:** restyle to navbar tokens (glass bar, ghost "← Instruments" button, lamp available). Tool inner UI untouched this phase.
- **About / Contact:** same system. Contact gets a **copy-email button** (outline button; click → copies, icon swaps to check, "Copied" for 1.5s).
- **Footer:** hairline top, logo left, colophon right: `Built by hand · No trackers · United Kingdom` with gilt separators (+ "Set in Geist & Georgia" once fonts land).

## 5. Interactive elements (v0 signatures, kept classy)

1. **Command palette — Ctrl+K / ⌘K** ("the concierge"): centered dialog on `--card`, 12px radius, shadow-lg, backdrop dim. Fuzzy-ish substring search over instruments (tools.json) + journal posts (cached fetch). Arrow keys + Enter, Esc closes, focus trapped, `role="dialog"` + `aria-modal`. Trigger also via a search icon-button in navbar. Group results: "Instruments" / "Journal" / "Pages".
2. **Card spotlight:** faint radial highlight (primary at ~4-5% alpha, ~250px) following cursor on bento cells. Desktop pointer-fine only; none under reduced motion.
3. **Staggered reveals:** existing IntersectionObserver reveal, refined: 12px rise, 0.5s, 60ms stagger between siblings. Tilt effect **retired** (reads gimmicky).
4. **Count-up stats:** existing `[data-count]` logic restyled into hero stats row.
5. **Lamp everywhere:** all pages, persisted, gears + all tokens respond.

Rejected as not-classy: marquees, magnetic buttons, 3D card tilt, confetti, typewriter effects.

## 6. Accessibility & quality bars

- `prefers-reduced-motion`: no idle gear spin, no shimmer sweep, no reveals/count-up animation (content appears immediately).
- Focus-visible: 2px `--ring` outline, 2px offset, everywhere including palette and lamp.
- Contrast: `--muted-fg` on `--background` ≥ 4.5:1 in both modes (stone-500 on stone-50 passes; verify dark).
- Keyboard: palette fully operable; lamp is a `<button aria-pressed>`; gear canvas keeps aria-label.
- No console errors; no horizontal scroll at 375px.

## 7. Testing

- Update existing Node tests (`layout.test.js`, `tools.test.js`, `wordpress.test.js`, `gear-train.test.js`) for new markup/classes; gear geometry tests unchanged (mechanism untouched).
- New tests: mode persistence helper (pure function: stored choice vs system pref → mode), palette search/filter function (pure), skeleton→content swap function.
- Keep sanitizer tests green — sanitizer logic must not change.

## 8. Out of scope

Deploy (existing Task 13), tool inner-UI redesign, pcf-matrix slimming, About copy rewrite, WordPress content.
