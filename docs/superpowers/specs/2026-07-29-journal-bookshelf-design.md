# The Journal as a Bookshelf — Design

**Date:** 2026-07-29
**Status:** Approved (design), pending implementation plan
**Scope:** `/writing/` index page only. Individual post pages (`/writing/post.html`) are unchanged.

## Goal

Replace the editorial row list on the Journal index with a bookcase: each post is a
physical-looking book standing spine-out. Browsing the journal should feel like
reading the spines on a shelf.

## References and why we are not copying them

Two references informed this:

- **The Quiet Shelf** — books stood side-on as spines; hovering pulls one out to
  reveal its blurb. This is the interaction model we adopt.
- **The Complete Shelf** (play.mint.gg) — a three.js / React-Three-Fiber WebGL
  canvas inside a Next.js app. Confirmed by inspecting the live page: the frame
  exposes `__THREE__` and a full-viewport `<canvas>`, behind ~20 JS chunks. It
  spends several seconds on "Loading The Complete Shelf…" before first paint.
  This is the look we want and the implementation we are explicitly rejecting.

This site is zero-build static HTML with vanilla ES modules on GitHub Pages.
three.js would become the largest asset on the site by a wide margin, for a
result we can approximate with CSS 3D transforms at 60fps. **No libraries, no
canvas, no WebGL.**

## Decisions

| Decision | Choice |
|---|---|
| Interaction model | Spines on a shelf; hover/focus pulls a book out |
| Page scope | Shelf replaces the editorial rows entirely |
| Spine treatment | Series livery — shared cloth for the *Weekly Waffle* run, own cloth per standalone essay |
| Layout | Bookcase: posts wrap onto stacked shelves with uprights and rails |
| Order | Newest first, top-left |
| Mobile | Same shelf; tap to pull out, tap again to open |

The series livery is not decoration: 16 of 18 current posts are *Weekly Waffle
#2–#19*. The shelf shows "one long run plus a couple of singles", which is what
the journal actually is.

## Architecture

Two new files:

- `assets/js/shelf.js` — the module
- `assets/css/shelf.css` — bookcase and spine styling

`writing/index.html` swaps `mountPosts` for `mountShelf`. Layout, command
palette and motion wiring on that page are untouched.

`wordpress.js` keeps `fetchPosts` and `renderPostCard` unchanged.
`renderPostCard` is **not** dead code — it becomes the reduced-motion and error
fallback. The Ctrl+K palette continues to consume the same `postsPromise`.
The shelf is therefore additive: if it fails, the page degrades to today's
behaviour.

`shelf.js` separates pure logic from DOM work, matching the existing test style
(`node --test`, pure functions imported directly):

| Export | Kind | Responsibility |
|---|---|---|
| `toVolume(post)` | pure | post → book data |
| `packShelves(volumes, width)` | pure | books → rows |
| `renderBookcase(rows)` | pure | rows → HTML string |
| `mountShelf(elId, posts)` | DOM | render into the page |
| `initShelf(el)` | DOM | wire pointer, keyboard, touch, resize |

## Post → book mapping

`toVolume` is deterministic from the slug. A book must never change colour or
size between visits.

- **Series detection** — title matching `/^weekly\s*waffle/i` sets `series: true`
  and extracts the volume number from `#\s*(\d+)`. Renders as green cloth
  (`#1d3a2b` light, `#22412f` dark) with gilt text and the volume number stamped
  at the foot.
- **Standalone** — one of four heritage cloths (oxblood `#7a2e2a`, navy
  `#2f4858`, tan `#6b4423`, plum `#3d3a5c`) selected by `hash(slug) % 4`.
- **Dimensions** — width, height and depth derived from the same hash, within
  the approved ranges (width 30–46px, height 196–274px, depth 46–67px).
- **Short title** — the series prefix is stripped so the spine reads
  "Silence is Golden", not "Weekly Waffle #12 — Silence is Golden". A series post
  with no subtitle falls back to "Weekly Waffle".

`cover` stays on the post object. It is unused by the shelf but already fetched,
and is the obvious material if the pull-out panel later shows a thumbnail.

## Bookcase layout

`packShelves` measures the container and greedily packs spines into rows.
`renderBookcase` wraps those rows in uprights and rails. A debounced
`ResizeObserver` repacks on resize; packing is pure and deterministic, so the
same width always yields the same rows.

Below 640px, spines take a wider minimum so titles stay legible, and the case
scrolls rather than compressing further.

## Interaction

- **Fine pointer** (`@media (pointer:fine)`) — hover dims the row and slides one
  book forward; a blurb panel fades in with date and excerpt. Click opens the post.
- **Keyboard** — roving `tabindex`; arrow keys move along and between shelves,
  Enter opens. Focus drives the same pull-out as hover, so the blurb is not
  mouse-only.
- **Touch** — first tap pulls the book out and shows the blurb; second tap opens
  the post.

## Failure and degradation

Three fallbacks, all landing on the existing editorial rows:

1. `prefers-reduced-motion: reduce` — no shelf is built at all; `renderPostCard`
   rows render instead.
2. Fetch failure — the existing "read on WordPress" message, unchanged.
3. No JavaScript — a `<noscript>` link to the WordPress journal.

## Bug fixed as part of this work

`decode()` in `assets/js/wordpress.js` maps a fixed table of nine HTML entities.
Anything outside that table survives as literal junk — this is the cause of the
mangled titles currently served, e.g. "Weekly Waffle � #8". Live API responses
confirm the entities are present in `title.rendered`.

The fix replaces the table lookup with a numeric-entity decoder handling decimal
(`&#128512;`) and hex (`&#x1F600;`) forms, falling back to the named-entity table
for `&amp;`, `&nbsp;` and friends. No DOM APIs, so the existing `node --test`
suite continues to run unchanged.

This is in scope because a spine renders the title at full size, where the
mangling is unmissable.

## Testing

**Node (`npm test`):**
- `toVolume` — series vs standalone classification, volume extraction, short-title
  stripping, determinism across repeated calls
- `packShelves` — wrapping at a given width, stability when re-run at the same
  width, single-book and empty inputs
- `decode` — decimal entities, hex entities, named entities, malformed input left
  intact

**Browser:** run the `site` dev server, verify the shelf in light and dark, confirm
no console errors, exercise keyboard traversal, and screenshot both modes.

## Out of scope

- Changes to individual post pages
- Featured images on spines or in the blurb panel
- Filtering, search or tag facets on the shelf (Ctrl+K already covers search)
- Any change to the tools section or its vendored libraries
