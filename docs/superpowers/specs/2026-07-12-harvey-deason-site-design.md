# Harvey Deason — Personal Site — Design Spec

**Date:** 2026-07-12
**Status:** Approved direction, pending spec review
**Owner:** Harvey Deason

---

## 1. Overview

A single personal-brand website for **Harvey Deason — Engineer & Essayist** that brings together, in one place:

- **Engineering tools** — 6 self-contained HTML utilities Harvey has built.
- **Writing** — the blog currently published on WordPress (`harveydeason.wordpress.com`).
- **About / Contact** — who he is and how to reach him.

The site is a **static website** hosted free on **GitHub Pages**. It has a distinctive "old-money heritage engineering" aesthetic, with an interactive 3D **gear-train** as its signature centrepiece.

### Goals
- One memorable home for everything Harvey makes and writes.
- Keep the WordPress writing workflow unchanged; posts appear on the site automatically.
- Keep the 6 tools working exactly as they do today, just housed and presented well.
- Make adding a *future* tool trivial (drop a file, add one manifest line).
- Fast, low-maintenance, accessible, mobile-friendly.

### Non-goals (YAGNI)
- No CMS, database, or server/backend. Fully static.
- No user accounts, comments, or e-commerce.
- No "explorable game-world" navigation (considered and rejected — it fights the site's utility).
- No literal full General-Arrangement-drawing homepage (considered and rejected — too dense; the drawing language survives only as *accents*).
- **Projects** section (IPR platform, Drawing Checker) is **out of v1** — kept private for now, addable later.
- **Green Library** dark theme is **out of v1** — planned as a fast follow.

---

## 2. Aesthetic direction

"Old money × engineering" — the study of a gentleman-engineer. Warm, quiet, expensive; engineering as substance, heritage as styling.

### Palette (cream theme — v1)
| Token | Value | Use |
|---|---|---|
| `--paper` | `#eee6d0` | Background (warm laid cream) |
| `--ink` | `#2a2620` | Primary text / linework |
| `--green` | `#1c3a2a` | Bottle-green accent / headings emphasis |
| `--gilt` | `#a9863f` | Brass hairlines, rules, node highlights |
| `--gilt-lt` | `#cdae6b` | Lighter brass |
| `--oxblood` | `#6d2a29` | Sparing accent (eyebrows, small marks) |
| `--soft` | `#5b5343` | Secondary text |

Subtle engraved paper texture (fine horizontal line pattern). Gilt double-rule frames. Fleuron/diamond ornaments used sparingly.

### Typography
- **Display / headings:** an old-style serif. Default to system stack `Georgia, 'Palatino Linotype', 'Iowan Old Style', 'Times New Roman', serif`. **Optional enhancement:** self-host one refined serif (e.g. EB Garamond or Cormorant) under `/assets/fonts/` for extra polish — no external CDN (keeps the site self-contained and fast).
- **Labels / mono:** letter-spaced small-caps serif for section labels; `ui-monospace` for drawing-style annotations (drawing numbers, dimensions).
- Generous leading and margins; restraint over ornament.

### Drawing accents (used lightly, not literally)
Registration corner marks, faint grid, dimension lines under headings, a monogram **HD** seal, and a title-block motif for the footer/contact. These signal the engineering identity without cluttering.

---

## 3. Signature centrepiece — the Gear Train

An interactive 3D **three-gear train** rendered as a webbed **node cloud** (brass nodes on cream), matching the heritage palette.

- Three meshing gears (default **14 : 10 : 16** teeth), positioned so pitch circles are tangent.
- **Interaction:** drag left/right to drive the train; gears turn at correct ratios and alternating directions; light inertia + a slow idle drift. Cursor position gently tilts the 3D viewing angle.
- Rendered on `<canvas>` with hand-rolled 3D (rotation → perspective projection → painter's-order depth shading). No 3D library.
- **Reduced motion / mobile:** respects `prefers-reduced-motion` (renders a still, elegant frame); on small/low-power devices, node count is reduced and idle auto-spin is slowed or paused.
- Prototype already built and approved during brainstorming (`.superpowers/brainstorm/…/gear-train.html`); production version is a cleaned-up, parameterised module.

---

## 4. Information architecture

```
Home (/)              Hero gear train + name + tagline;
                      below: latest writing, featured tools, all in heritage styling.
Tools (/tools/)       "Instrument cabinet" — cards for the 6 tools.
  └ tool pages        Each tool as its own page, functionally unchanged.
Writing (/writing/)   Blog index, posts pulled live from WordPress.
  └ post (/writing/post?slug=…)  Full single post rendered in-site.
About (/about/)       Bio; engineer & essayist; gear/engineering motif.
Contact (/contact/)   Email & links, styled as a drawing title block.
```

Global heritage header (monogram + serif small-caps nav: Instruments · Journal · About · Contact) and a title-block-style footer on every page.

---

## 5. Tools integration

The 6 tools are self-contained HTML files currently scattered across Harvey's machine:

| Ref | Tool | Current source |
|---|---|---|
| T-01 | HydroSizer (tank sizing) | `VS Code/Tank_Sizing/hydrosizer_redesign.html` |
| T-02 | Pipe Hydraulics Calculator | `VS Code/PCF/pipe-hydraulics-calculator.html` |
| T-03 | PCF Selection Matrix | `VS Code/PCF/pcf-selection-matrix.html` |
| T-04 | Platform Access Checker | `VS Code/PCF/platform-access-checker.html` |
| T-05 | P&ID Tag Register | `Downloads/pid-tag-register*.html` (latest revision) |
| T-06 | Column Merge | `Downloads/gemini-code-*.html` (latest revision) — spreadsheet merge: match on a key column, then transfer selected columns of data between documents (VLOOKUP-style) |

### Approach
- Each tool lives at `/tools/<slug>.html`, kept **functionally as-is** (their internal logic/markup untouched, so they keep working).
- A **slim shared heritage header** is added to each tool page (monogram + "← Back to the Cabinet" + section nav) so tools feel part of the site without altering their guts. Where a tool's own styles would clash, the header is scoped/namespaced to avoid collisions.
- `/tools/index.html` is the **cabinet**: heritage cards (title, one-line description, subtle 3D-tilt on hover, "Open ▸"). Cards are generated from a manifest.
- **Manifest:** `/data/tools.json` — array of `{ ref, slug, name, blurb, discipline, type, status }`. Adding a future tool = drop `<slug>.html` in `/tools/` + append one manifest entry. The cabinet and any "featured tools" on Home read from this file.

---

## 6. Writing integration (WordPress)

Harvey keeps writing on WordPress; the site displays posts automatically.

- **Source:** WordPress.com public REST API (CORS-enabled, no auth needed for public posts):
  `https://public-api.wordpress.com/wp/v2/sites/harveydeason.wordpress.com/posts?_embed&per_page=…`
- **Writing index** (`/writing/`): fetches recent posts, renders heritage cards (title, date, excerpt, featured image if present) — the "bound journal" list.
- **Single post** (`/writing/post?slug=<slug>`): fetches that post and renders its **full content in-site** in the heritage reading style (serif body, drop-cap, comfortable measure). Images and formatting come through from WordPress's rendered HTML (sanitised before injection).
- **Home** shows the latest 2–3 posts.
- **Caching:** responses cached in `localStorage` with a short TTL to keep navigation instant and reduce calls.
- **Error handling:** if the API is unreachable, show a graceful heritage-styled notice ("The journal is momentarily unavailable") with a direct link out to `harveydeason.wordpress.com`, rather than a broken page.
- **Security:** post HTML is sanitised (allowlist of tags/attributes) before insertion to prevent injection.

---

## 7. Motion & interactions

Tasteful set (Harvey's earlier picks, restyled to heritage). Calm, considered, never flashy:

- **Gear-train hero** (Section 3).
- **Scroll-triggered reveals** — content fades/slides in on scroll (IntersectionObserver).
- **Self-drawing engraved schematics** — small line illustrations draw themselves in (SVG stroke-dashoffset) as section accents.
- **3D-tilt tool cards** — subtle tilt toward the cursor on the cabinet cards.
- **Animated counters** — e.g. tools count / essays count, roll up when in view.
- **Gilt-underline links & magnetic buttons** — refined hover treatments.

All motion gated behind `prefers-reduced-motion`.

---

## 8. Responsive & accessibility

- **Layout:** desktop multi-column; mobile stacks to a clean single column. Global nav collapses to a simple menu.
- **Gear train on mobile:** lighter (fewer nodes) and calmer, or a still frame; never a scroll/performance hazard.
- **Accessibility:** semantic HTML, real headings, keyboard-navigable nav and controls, sufficient contrast (cream/ink/green meet AA for text), `alt` text, canvas has a text alternative. Content is readable without JS for the static pages; Writing degrades to an "open on WordPress" link if JS/API fails.
- **SEO:** real HTML pages per section, meta tags, sensible titles — important for the blog's discoverability.

---

## 9. Tech stack & structure

**Stack:** Plain HTML + CSS + vanilla JS. No framework, no build step (or an optional trivial one). Chosen for zero-maintenance hosting on GitHub Pages and effortless future edits.

```
harveydeason-site/
├── index.html                 # Home
├── tools/
│   ├── index.html             # Cabinet
│   └── <tool>.html            # 6 tool pages (functionally unchanged)
├── writing/
│   ├── index.html             # Journal list
│   └── post.html              # Single-post renderer (reads ?slug=)
├── about/index.html
├── contact/index.html
├── data/
│   └── tools.json             # Tools manifest
├── assets/
│   ├── css/site.css           # Heritage design system (tokens, type, components)
│   ├── js/site.js             # Nav, reveals, tilt, counters, shared UI
│   ├── js/gear-train.js       # Interactive gear-train module
│   ├── js/wordpress.js        # WordPress fetch/render/cache/sanitise
│   ├── fonts/                 # (optional) self-hosted serif
│   └── img/                   # Seal, textures, favicons
├── docs/superpowers/specs/    # This spec
└── README.md
```

### Module boundaries (each independently understandable/testable)
- **`gear-train.js`** — input: config (teeth, palette, canvas); behaviour: renders + handles drag/tilt; depends on nothing else.
- **`wordpress.js`** — input: site + query; output: normalised post objects + sanitised HTML; handles caching + errors; no DOM styling assumptions.
- **`site.js`** — cross-page UI behaviours (nav, reveals, tilt, counters), each a small self-contained function.
- **`tools.json`** — single source of truth for tool cards; consumed by Home + Cabinet.
- **`site.css`** — design tokens + reusable components (frame, seal, cards, title block, rules).

---

## 10. Deployment

- **GitHub Pages** from a dedicated repo (`harveydeason-site` → `harveydeason.github.io` or a project page). First plan step sets up the git repo + GitHub remote + Pages.
- Custom domain (e.g. `harveydeason.com`) attachable later via a `CNAME` file.
- No secrets; entirely public/static.

---

## 11. Testing & verification

- **Visual/behavioural:** run locally via the preview server; verify each page renders, the gear train drives/meshes, tool pages open and function, Writing pulls and renders live posts, reduced-motion and mobile layouts behave.
- **WordPress module:** unit-test the fetch → normalise → sanitise pipeline against the real API response shape; test the offline/error fallback.
- **Tools manifest:** verify cabinet + Home render correctly from `tools.json`, including an added dummy entry.
- **Accessibility pass:** keyboard nav, contrast, headings, alt text.
- **Cross-device:** desktop + mobile widths, light/(later)dark.

---

## 12. Open items / future

- **Optional serif webfont:** decide whether to self-host EB Garamond/Cormorant vs. system serif.
- **Fast follows (post-v1):** Green Library dark theme + toggle; Projects section (IPR platform, Drawing Checker); custom domain.

---

## 13. Build order (high level)

1. Repo + GitHub Pages skeleton + heritage design system (`site.css`).
2. Home shell + **gear-train** production module.
3. **Tools** cabinet + manifest + import/house the 6 tool files (+ shared header).
4. **Writing** — WordPress module + index + single-post rendering.
5. **About** + **Contact**.
6. Motion polish, responsive, accessibility, reduced-motion.
7. Verify end-to-end; deploy.

(Detailed implementation plan to follow via the writing-plans step.)
