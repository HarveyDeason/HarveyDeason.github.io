# Journal Bookshelf Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the editorial row list on `/writing/` with a CSS-3D bookcase where each post is a book standing spine-out.

**Architecture:** One new ES module `assets/js/shelf.js` splitting pure logic (post → book, packing, HTML generation) from DOM wiring, plus `assets/css/shelf.css` for the bookcase visuals. `writing/index.html` swaps `mountPosts` for `mountShelf`. `wordpress.js` keeps `renderPostCard` as the reduced-motion and error fallback, so the shelf is purely additive.

**Tech Stack:** Vanilla ES modules, CSS 3D transforms, `node --test` for unit tests. No build step.

## Global Constraints

- **No libraries. No three.js, no canvas, no WebGL, no npm runtime dependencies.** The site is zero-build static HTML on GitHub Pages. This constraint is the whole reason the design exists — see `docs/superpowers/specs/2026-07-29-journal-bookshelf-design.md`.
- All colours come from CSS, never from JavaScript. `shelf.js` emits semantic cloth **names**; `shelf.css` maps names to colours per light/dark mode. This keeps `shelf.js` pure and mode-agnostic.
- Tests run under `node --test` with no DOM. Pure functions must not touch `document`, `window`, or `matchMedia`.
- Existing files `assets/js/layout.js`, `assets/js/palette.js`, `assets/js/motion.js`, `writing/post.html` must not be modified.
- Work happens on branch `feature/journal-bookshelf`, which already exists and contains the design spec.
- Indentation and formatting follow the surrounding file. Existing modules use 2-space indent and compact single-line helpers.
- **Newest post first, top-left.** The WordPress REST API already returns posts newest-first and `fetchPosts` preserves that order, so no sorting is required — but do not reorder, and do not "fix" it to chronological.

---

### Task 1: Fix the HTML entity decoder

`decode()` maps a fixed table of nine entities and lets everything else through as literal junk. This is why live titles render as `Weekly Waffle � #8`. A book spine shows the title at full size, so this must be fixed first.

**Files:**
- Modify: `assets/js/wordpress.js:4-17`
- Test: `tests/wordpress.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `decode` behaviour used indirectly by `normalizePost(o)` → `{id, slug, dateISO, title, excerpt, cover, html}`. Task 2 consumes this object shape.

- [ ] **Step 1: Write the failing tests**

Append to `tests/wordpress.test.js`:

```js
test('normalizePost decodes decimal numeric entities beyond the named table', () => {
  const p = normalizePost({ ...api, title: { rendered: 'Weekly Waffle &#128512; &#8211; #8' } });
  assert.equal(p.title, 'Weekly Waffle 😀 – #8');
});

test('normalizePost decodes hex numeric entities', () => {
  const p = normalizePost({ ...api, title: { rendered: 'Dash &#x2014; here' } });
  assert.equal(p.title, 'Dash — here');
});

test('normalizePost still decodes named entities', () => {
  const p = normalizePost({ ...api, title: { rendered: 'Tools &amp; Toys&hellip;' } });
  assert.equal(p.title, 'Tools & Toys…');
});

test('normalizePost leaves unknown entities intact rather than mangling them', () => {
  const p = normalizePost({ ...api, title: { rendered: 'A &notanentity; B' } });
  assert.equal(p.title, 'A &notanentity; B');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — the emoji test reports the raw `&#128512;` still present in the actual value.

- [ ] **Step 3: Replace the decoder**

In `assets/js/wordpress.js`, replace the `ENTITIES` constant and `decode` function (lines 4–17) with:

```js
// Named entities only — numeric forms are handled generically by decode().
const ENTITIES = {
  '&amp;':'&',
  '&lt;':'<',
  '&gt;':'>',
  '&quot;':'"',
  '&apos;':"'",
  '&ndash;':'–',
  '&mdash;':'—',
  '&lsquo;':'‘',
  '&rsquo;':'’',
  '&ldquo;':'“',
  '&rdquo;':'”',
  '&hellip;':'…',
  '&nbsp;':' '
};

// Decodes named entities via the table above and any numeric entity (decimal
// or hex) generically, so characters outside the table — emoji especially —
// survive instead of arriving as literal junk. No DOM, so this runs in node.
function decode(s){
  return String(s||'').replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
    if(body[0] === '#'){
      const cp = (body[1] === 'x' || body[1] === 'X')
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      if(!Number.isFinite(cp) || cp < 1 || cp > 0x10FFFF) return m;
      return String.fromCodePoint(cp);
    }
    return ENTITIES[m] ?? m;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all tests in `tests/wordpress.test.js`, including the pre-existing `normalizePost extracts and decodes fields` test which asserts `&#8211;` → `–`.

- [ ] **Step 5: Commit**

```bash
git add assets/js/wordpress.js tests/wordpress.test.js
git commit -m "fix: decode numeric HTML entities in post titles"
```

---

### Task 2: `toVolume` — post to book data

**Files:**
- Create: `assets/js/shelf.js`
- Test: `tests/shelf.test.js`

**Interfaces:**
- Consumes: post objects from `normalizePost` (Task 1) — `{slug, title, excerpt, dateISO}`
- Produces:
  - `hashSlug(slug) → number` (non-negative integer)
  - `toVolume(post) → { slug, title, shortTitle, dateISO, excerpt, series: boolean, volume: string, cloth: 'series'|'oxblood'|'navy'|'tan'|'plum', width: number, height: number, depth: number }`

  `cloth` is a **name**, not a colour. `width`/`height`/`depth` are pixel numbers. Tasks 3 and 4 rely on these exact property names.

- [ ] **Step 1: Write the failing tests**

Create `tests/shelf.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashSlug, toVolume } from '../assets/js/shelf.js';

const post = (over = {}) => ({
  slug: 'weekly-waffle-12', dateISO: '2024-10-06T09:00:00',
  title: 'Weekly Waffle #12 — Silence is Golden',
  excerpt: 'On saying less.', ...over
});

test('hashSlug is deterministic and non-negative', () => {
  assert.equal(hashSlug('weekly-waffle-12'), hashSlug('weekly-waffle-12'));
  assert.ok(hashSlug('the-unlived-life') >= 0);
  assert.notEqual(hashSlug('a'), hashSlug('b'));
});

test('toVolume marks Weekly Waffle posts as series and extracts the volume', () => {
  const v = toVolume(post());
  assert.equal(v.series, true);
  assert.equal(v.volume, '12');
  assert.equal(v.cloth, 'series');
});

test('toVolume pads single-digit volume numbers', () => {
  const v = toVolume(post({ title: 'Weekly Waffle #9', slug: 'weekly-waffle-9' }));
  assert.equal(v.volume, '09');
});

test('toVolume strips the series prefix for the spine label', () => {
  assert.equal(toVolume(post()).shortTitle, 'Silence is Golden');
});

test('toVolume falls back to the series name when there is no subtitle', () => {
  const v = toVolume(post({ title: 'Weekly Waffle #4', slug: 'weekly-waffle-4' }));
  assert.equal(v.shortTitle, 'Weekly Waffle');
});

test('toVolume treats standalone essays as non-series with their own cloth', () => {
  const v = toVolume(post({ title: 'The Unlived Life', slug: 'the-unlived-life' }));
  assert.equal(v.series, false);
  assert.equal(v.volume, '');
  assert.equal(v.shortTitle, 'The Unlived Life');
  assert.ok(['oxblood','navy','tan','plum'].includes(v.cloth));
});

test('toVolume dimensions are deterministic and within the approved ranges', () => {
  const a = toVolume(post()), b = toVolume(post());
  assert.deepEqual([a.width, a.height, a.depth], [b.width, b.height, b.depth]);
  assert.ok(a.width  >= 30 && a.width  <= 46);
  assert.ok(a.height >= 196 && a.height <= 274);
  assert.ok(a.depth  >= 46 && a.depth  <= 67);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../assets/js/shelf.js'`.

- [ ] **Step 3: Write the implementation**

Create `assets/js/shelf.js`:

```js
// The Journal bookshelf: posts rendered as books standing spine-out.
// Pure functions here are DOM-free so they run under `node --test`; colours are
// deliberately absent — this module emits cloth *names* and shelf.css maps them
// to values per light/dark mode.

const SERIES_RE = /^\s*weekly\s*waffle\b/i;
const VOLUME_RE = /#\s*(\d+)/;
const SERIES_PREFIX_RE = /^\s*weekly\s*waffle\s*#?\s*\d*\s*[—–:-]?\s*/i;
const SINGLE_CLOTHS = ['oxblood','navy','tan','plum'];

// FNV-style rolling hash. Stable across sessions so a book never changes
// colour or size between visits.
export function hashSlug(slug){
  let h = 0;
  const s = String(slug || '');
  for(let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function toVolume(post){
  const title  = String(post.title || '');
  const series = SERIES_RE.test(title);
  const h      = hashSlug(post.slug);

  const volMatch = series ? title.match(VOLUME_RE) : null;
  const volume   = volMatch ? volMatch[1].padStart(2, '0') : '';

  let shortTitle = series ? title.replace(SERIES_PREFIX_RE, '').trim() : title.trim();
  if(!shortTitle) shortTitle = 'Weekly Waffle';

  return {
    slug: post.slug,
    title,
    shortTitle,
    dateISO: post.dateISO,
    excerpt: post.excerpt || '',
    series,
    volume,
    cloth: series ? 'series' : SINGLE_CLOTHS[h % SINGLE_CLOTHS.length],
    width:  30 + (h % 5) * 4,
    height: 196 + (h % 7) * 13,
    depth:  46 + (h % 4) * 7
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 7 new tests in `tests/shelf.test.js`.

- [ ] **Step 5: Commit**

```bash
git add assets/js/shelf.js tests/shelf.test.js
git commit -m "feat: map journal posts to book volumes"
```

---

### Task 3: `packShelves` — wrap books onto stacked shelves

**Files:**
- Modify: `assets/js/shelf.js`
- Test: `tests/shelf.test.js`

**Interfaces:**
- Consumes: `toVolume` output (Task 2), specifically `width`
- Produces: `packShelves(volumes, containerWidth, gap = 2) → Array<Array<volume>>`

  Never returns empty inner arrays. A single book wider than the container still gets its own row rather than being dropped. Task 4 consumes this shape.

- [ ] **Step 1: Write the failing tests**

Append to `tests/shelf.test.js` (and extend the import on line 3 to `import { hashSlug, toVolume, packShelves } from '../assets/js/shelf.js';`):

```js
const vol = w => ({ slug: 's' + w, width: w });

test('packShelves wraps books onto rows that fit the container', () => {
  const rows = packShelves([vol(40), vol(40), vol(40)], 100, 2);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].length, 2);   // 40 + 2 + 40 = 82 fits; adding a third = 124 does not
  assert.equal(rows[1].length, 1);
});

test('packShelves is stable — same input and width gives the same rows', () => {
  const books = [vol(40), vol(30), vol(46), vol(35)];
  assert.deepEqual(packShelves(books, 120, 2), packShelves(books, 120, 2));
});

test('packShelves keeps a single over-wide book on its own row', () => {
  const rows = packShelves([vol(500)], 100, 2);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].length, 1);
});

test('packShelves returns no rows for an empty journal', () => {
  assert.deepEqual(packShelves([], 800, 2), []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `packShelves is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `assets/js/shelf.js`:

```js
// Greedy left-to-right packing. Deterministic: the same volumes at the same
// width always produce the same rows, so a resize back to a previous width
// restores the previous layout exactly.
export function packShelves(volumes, containerWidth, gap = 2){
  const rows = [];
  let row = [], used = 0;

  for(const v of volumes){
    const cost = row.length ? gap + v.width : v.width;
    if(row.length && used + cost > containerWidth){
      rows.push(row);
      row = [v]; used = v.width;
    } else {
      row.push(v); used += cost;
    }
  }
  if(row.length) rows.push(row);
  return rows;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 11 tests in `tests/shelf.test.js`.

- [ ] **Step 5: Commit**

```bash
git add assets/js/shelf.js tests/shelf.test.js
git commit -m "feat: pack journal volumes onto stacked shelves"
```

---

### Task 4: `renderSpine` and `renderBookcase` — HTML generation

**Files:**
- Modify: `assets/js/shelf.js`
- Test: `tests/shelf.test.js`

**Interfaces:**
- Consumes: `packShelves` output (Task 3)
- Produces:
  - `renderSpine(v) → string`
  - `renderBookcase(rows) → string`
  - `renderSkeletonShelf(n = 12) → string`

  Emitted DOM contract, relied on by Task 5 (CSS) and Task 6 (interaction):
  - `.bookcase` > `.shelf` > `a.book[data-slug][data-cloth][style="--w/--h/--d"]`
  - each `.book` contains `.book-top`, `.spine` > (`.hub`×2, `.rule`×2, `.panel` > `.ttl`, optional `.vol`)
  - each `.shelf` is followed by `.shelf-board`
  - roving tabindex: exactly one `.book` carries `tabindex="0"`, the rest `tabindex="-1"`

- [ ] **Step 1: Write the failing tests**

Append to `tests/shelf.test.js` (extend the import to include `renderSpine, renderBookcase, renderSkeletonShelf`):

```js
const full = toVolume(post());
const single = toVolume(post({ title: 'The Unlived Life', slug: 'the-unlived-life' }));

test('renderSpine links to the in-site post reader', () => {
  assert.ok(renderSpine(full).includes('href="/writing/post.html?slug=weekly-waffle-12"'));
});

test('renderSpine carries cloth and dimensions for CSS to consume', () => {
  const html = renderSpine(full);
  assert.ok(html.includes('data-cloth="series"'));
  assert.ok(html.includes('--w:' + full.width + 'px'));
  assert.ok(html.includes('--h:' + full.height + 'px'));
  assert.ok(html.includes('--d:' + full.depth + 'px'));
});

test('renderSpine stamps a volume number on series books only', () => {
  assert.ok(renderSpine(full).includes('class="vol"'));
  assert.ok(!renderSpine(single).includes('class="vol"'));
});

test('renderSpine escapes titles so quotes cannot break out of attributes', () => {
  const v = toVolume(post({ title: 'A "quoted" <tag> & more', slug: 'x' }));
  const html = renderSpine(v);
  assert.ok(!html.includes('<tag>'));
  assert.ok(html.includes('&lt;tag&gt;'));
  assert.ok(html.includes('&quot;quoted&quot;'));
  assert.ok(html.includes('&amp; more'));
});

test('renderBookcase emits one shelf and board per packed row', () => {
  const html = renderBookcase([[full, single], [full]]);
  assert.equal((html.match(/class="shelf"/g) || []).length, 2);
  assert.equal((html.match(/class="shelf-board"/g) || []).length, 2);
});

test('renderBookcase gives exactly one book a roving tabindex of 0', () => {
  const html = renderBookcase([[full, single], [full]]);
  assert.equal((html.match(/tabindex="0"/g) || []).length, 1);
  assert.equal((html.match(/tabindex="-1"/g) || []).length, 2);
});

test('renderBookcase renders an empty-journal message rather than an empty case', () => {
  assert.ok(renderBookcase([]).includes('No posts yet'));
});

test('renderSkeletonShelf produces aria-hidden placeholder spines', () => {
  const html = renderSkeletonShelf(4);
  assert.equal((html.match(/class="book skeleton-book"/g) || []).length, 4);
  assert.ok(html.includes('aria-hidden="true"'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `renderSpine is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `assets/js/shelf.js`:

```js
function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function fmtDate(iso){
  try { return new Date(iso).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}); }
  catch { return ''; }
}

// A single book. Hubs and rules are decorative; the panel carries the title.
// Positions are proportional to height so tall and short books stay in family.
export function renderSpine(v, tabindex = -1){
  const h = v.height;
  return `<a class="book" href="/writing/post.html?slug=${encodeURIComponent(v.slug)}"` +
    ` data-slug="${esc(v.slug)}" data-cloth="${esc(v.cloth)}" tabindex="${tabindex}"` +
    ` aria-label="${esc(v.title)}"` +
    ` style="--w:${v.width}px;--h:${v.height}px;--d:${v.depth}px">` +
      `<span class="book-top"></span>` +
      `<span class="spine">` +
        `<span class="hub" style="top:${Math.round(h * 0.14)}px"></span>` +
        `<span class="hub" style="bottom:${Math.round(h * 0.20)}px"></span>` +
        `<span class="rule" style="top:7px"></span>` +
        `<span class="rule" style="bottom:7px"></span>` +
        `<span class="panel" style="top:${Math.round(h * 0.205)}px;bottom:${Math.round(h * 0.275)}px">` +
          `<span class="ttl">${esc(v.shortTitle)}</span>` +
        `</span>` +
        (v.volume ? `<span class="vol" style="bottom:${Math.round(h * 0.10)}px">${esc(v.volume)}</span>` : '') +
      `</span>` +
      `<span class="blurb" role="note">` +
        `<span class="blurb-date">${esc(fmtDate(v.dateISO))}</span>` +
        `<span class="blurb-title">${esc(v.title)}</span>` +
        `<span class="blurb-excerpt">${esc(v.excerpt)}</span>` +
      `</span>` +
    `</a>`;
}

export function renderBookcase(rows){
  if(!rows.length) return '<p class="sub">No posts yet.</p>';
  let seen = 0;
  const shelves = rows.map(row => {
    const books = row.map(v => renderSpine(v, seen++ === 0 ? 0 : -1)).join('');
    return `<div class="shelf">${books}</div><div class="shelf-board"></div>`;
  }).join('');
  return `<div class="bookcase">${shelves}</div>`;
}

// Placeholder spines shown while the feed loads, so the case does not pop in.
export function renderSkeletonShelf(n = 12){
  let out = '';
  for(let i = 0; i < n; i++){
    const w = 30 + (i % 5) * 4, h = 196 + (i % 7) * 13;
    out += `<span class="book skeleton-book" aria-hidden="true" style="--w:${w}px;--h:${h}px"></span>`;
  }
  return `<div class="bookcase"><div class="shelf">${out}</div><div class="shelf-board"></div></div>`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 19 tests in `tests/shelf.test.js`.

- [ ] **Step 5: Commit**

```bash
git add assets/js/shelf.js tests/shelf.test.js
git commit -m "feat: render the bookcase markup"
```

---

### Task 5: The bookcase stylesheet and page wiring

Deliverable: a visible, static bookcase on `/writing/`. No interaction yet beyond the browser's own link behaviour.

**Files:**
- Create: `assets/css/shelf.css`
- Modify: `assets/js/shelf.js` (add `mountShelf`)
- Modify: `writing/index.html:7` (add stylesheet), `writing/index.html:29-46` (script block)

**Interfaces:**
- Consumes: `renderBookcase`, `renderSkeletonShelf`, `packShelves`, `toVolume` (Tasks 2–4)
- Produces: `mountShelf(elId, posts, width) → void`. `width` is optional; defaults to the element's `clientWidth`. Task 6 calls it on resize.

- [ ] **Step 1: Write the stylesheet**

Create `assets/css/shelf.css`:

```css
/* ——— The Journal bookcase ———
   Books are real 3D boxes: a spine face plus a top face hinged at the head and
   laid back into the case. Cloth colours live here, not in shelf.js, so light
   and dark are handled by tokens like everything else on the site. */

.bookcase{
  --cloth-series:#1d3a2b;  --cloth-oxblood:#7a2e2a; --cloth-navy:#2f4858;
  --cloth-tan:#6b4423;     --cloth-plum:#3d3a5c;
  --gilt:var(--accent-gold);
  --board:linear-gradient(180deg,#cfc7ba 0%,#b7ac9c 42%,#9c907e 100%);
  --book-top:linear-gradient(180deg,#efe7d6,#cfc3ab);
  padding:48px 0 0;
}
:root[data-mode="dark"] .bookcase{
  --cloth-series:#22412f;  --cloth-oxblood:#8a3833; --cloth-navy:#365468;
  --cloth-tan:#7a5029;     --cloth-plum:#474168;
  --board:linear-gradient(180deg,#3a332c 0%,#2a241e 42%,#191512 100%);
  --book-top:linear-gradient(180deg,#3a352c,#241f19);
}

.shelf{
  display:flex; align-items:flex-end; gap:2px;
  perspective:1600px; perspective-origin:50% -14%;
  padding-left:6px; min-height:200px;
}
.shelf-board{
  position:relative; height:16px; background:var(--board);
  border-radius:0 0 3px 3px; margin-bottom:34px;
  box-shadow:0 -14px 24px -14px rgb(0 0 0 / .5);
}
.shelf-board::before{
  content:""; position:absolute; inset:0 0 auto; height:2px; background:rgb(255 255 255 / .35);
}

.book{
  position:relative; flex:0 0 auto; width:var(--w); height:var(--h);
  transform-style:preserve-3d; transform-origin:bottom center;
  text-decoration:none; cursor:pointer;
  transition:transform .5s cubic-bezier(.2,.85,.25,1), filter .5s;
}
.book[data-cloth="series"] { --cloth:var(--cloth-series);  --ink:var(--gilt); }
.book[data-cloth="oxblood"]{ --cloth:var(--cloth-oxblood); --ink:#f2ede5; }
.book[data-cloth="navy"]   { --cloth:var(--cloth-navy);    --ink:#f2ede5; }
.book[data-cloth="tan"]    { --cloth:var(--cloth-tan);     --ink:#f2ede5; }
.book[data-cloth="plum"]   { --cloth:var(--cloth-plum);    --ink:#f2ede5; }

.book-top{
  position:absolute; top:0; left:0; right:0; height:var(--d);
  transform-origin:center top; transform:rotateX(90deg);
  background:var(--book-top); border-radius:1px;
}

.spine{
  position:absolute; inset:0; border-radius:2px 1px 1px 2px; overflow:hidden;
  background:linear-gradient(90deg,
    rgb(0 0 0 / .55) 0%, rgb(0 0 0 / .18) 8%, rgb(255 255 255 / .16) 26%,
    var(--cloth) 48%, var(--cloth) 70%, rgb(0 0 0 / .28) 92%, rgb(0 0 0 / .6) 100%), var(--cloth);
  box-shadow:inset 7px 0 12px -8px rgb(255 255 255 / .30),
             inset -9px 0 14px -8px rgb(0 0 0 / .62),
             inset 0 8px 12px -10px rgb(255 255 255 / .22),
             inset 0 -10px 14px -10px rgb(0 0 0 / .5);
}
/* fine woven cloth — kept subtle to avoid moiré at spine widths */
.spine::after{
  content:""; position:absolute; inset:0; opacity:.055; pointer-events:none;
  background:
    repeating-linear-gradient(0deg,  rgb(255 255 255 / .6) 0 .5px, transparent .5px 2px),
    repeating-linear-gradient(90deg, rgb(0 0 0 / .6)       0 .5px, transparent .5px 2px);
}

.hub{
  position:absolute; left:0; right:0; height:6px;
  background:linear-gradient(180deg, rgb(0 0 0 / .30), rgb(255 255 255 / .16) 45%, rgb(0 0 0 / .30));
}
.rule{ position:absolute; left:4px; right:4px; height:1px; background:var(--gilt); opacity:.75; }
.panel{
  position:absolute; left:3px; right:3px; border-radius:1px;
  display:flex; align-items:center; justify-content:center;
  background:rgb(0 0 0 / .18); box-shadow:inset 0 0 0 1px rgb(169 134 63 / .33);
}
.ttl{
  writing-mode:vertical-rl; text-orientation:mixed; transform:rotate(180deg);
  font:600 10.5px/1 'Geist','Segoe UI',system-ui,sans-serif; letter-spacing:.07em;
  color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-height:94%;
}
.vol{
  position:absolute; left:0; right:0; text-align:center;
  font:700 10px/1 'Geist','Segoe UI',system-ui,sans-serif;
  letter-spacing:.04em; font-variant-numeric:tabular-nums; color:var(--gilt);
}

/* ——— pull-out ——— */
.shelf:hover .book,
.shelf:focus-within .book{ filter:brightness(.7) saturate(.85); }
/* Specificity matters here: `.shelf:hover .book` scores 3, so a bare
   `.book.is-open` (2) would lose and the open book would stay dimmed.
   The two descendant forms below outscore it. */
.book.is-open,
.shelf:hover .book.is-open,
.shelf:focus-within .book.is-open{
  transform:translateZ(80px) translateY(-14px) rotateY(-7deg);
  filter:brightness(1.06); z-index:9;
}
.book:focus-visible{ outline:2px solid var(--ring); outline-offset:4px; }

.blurb{
  position:absolute; top:calc(100% + 18px); left:50%; width:240px;
  transform:translateX(-50%) translateY(6px);
  display:flex; flex-direction:column; gap:5px;
  padding:14px 16px; border-radius:10px;
  background:var(--card); border:1px solid var(--border); box-shadow:var(--shadow-lg);
  opacity:0; pointer-events:none; transition:opacity .3s, transform .3s; z-index:12;
}
.book.is-open .blurb{ opacity:1; transform:translateX(-50%) translateY(0); }
.blurb-date{ font:500 11px ui-monospace,'Consolas',monospace; color:var(--muted-fg); }
.blurb-title{ font-size:14px; font-weight:600; color:var(--foreground); }
.blurb-excerpt{ font-size:12.5px; line-height:1.5; color:var(--muted-fg); }

/* ——— loading ——— */
.skeleton-book{
  width:var(--w); height:var(--h); border-radius:2px;
  background:var(--muted); opacity:.6;
}

/* ——— mobile: wider spines so titles stay legible ——— */
@media(max-width:640px){
  .shelf{ overflow-x:auto; scrollbar-width:none; }
  .shelf::-webkit-scrollbar{ display:none; }
  .book{ min-width:42px; }
  .blurb{ width:200px; }
}

/* ——— reduced motion: the shelf is never built, but belt and braces ——— */
@media(prefers-reduced-motion:reduce){
  .book{ transition:none; }
  .blurb{ transition:none; }
}
```

- [ ] **Step 2: Add `mountShelf`**

Append to `assets/js/shelf.js`:

```js
// Renders the case into `elId`. Width is injectable so callers (and resize
// handlers) control packing without this module reading layout twice.
export function mountShelf(elId, posts, width){
  const el = document.getElementById(elId);
  if(!el) return;
  const w = width || el.clientWidth || 900;
  const volumes = posts.map(toVolume);
  el.innerHTML = renderBookcase(packShelves(volumes, w));
}
```

- [ ] **Step 3: Wire up the page**

In `writing/index.html`, add after line 7 (`site.css` link):

```html
  <link rel="stylesheet" href="/assets/css/shelf.css">
```

Replace the script block (lines 29–46) with:

```html
  <script type="module">
    import { mountLayout } from '/assets/js/layout.js';
    import { fetchPosts, mountPosts, renderSkeletonRows } from '/assets/js/wordpress.js';
    import { mountShelf, renderSkeletonShelf } from '/assets/js/shelf.js';
    import { initMotion } from '/assets/js/motion.js';
    import { initPalette } from '/assets/js/palette.js';

    mountLayout('writing');

    // Reduced motion gets the editorial rows: a shelf is a motion device, and
    // there is no still version of it worth showing.
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

    const journal = document.getElementById('journal');
    journal.innerHTML = reduce ? renderSkeletonRows(6) : renderSkeletonShelf(12);

    const postsPromise = fetchPosts({ perPage: 20 });
    postsPromise
      .then(p => reduce ? mountPosts('journal', p) : mountShelf('journal', p))
      .catch(() => { journal.innerHTML =
        '<p class="sub">The journal is momentarily unavailable. <a class="link-btn" href="https://harveydeason.wordpress.com/">Read on WordPress →</a></p>'; });

    initPalette({ postsPromise });
    initMotion();
  </script>
  <noscript>
    <p class="sub">The journal needs JavaScript. <a class="link-btn" href="https://harveydeason.wordpress.com/">Read on WordPress →</a></p>
  </noscript>
```

- [ ] **Step 4: Verify in the browser**

Start the dev server with preview_start `{name: "site"}`, navigate to `http://localhost:5050/writing/`.

Expected: a bookcase of green spines with gilt volume numbers, two or three shelves with boards, plus a couple of coloured standalone spines. Check `read_console_messages` — expected: no errors. Toggle the lamp to dark and confirm the cloth and board darken.

- [ ] **Step 5: Commit**

```bash
git add assets/css/shelf.css assets/js/shelf.js writing/index.html
git commit -m "feat: render the Journal as a bookcase"
```

---

### Task 6: Pull-out interaction — pointer, keyboard, touch

**Files:**
- Modify: `assets/js/shelf.js` (add `initShelf`)
- Modify: `writing/index.html` (call `initShelf` after mount)

**Interfaces:**
- Consumes: the DOM contract from Task 4 (`.bookcase`, `.shelf`, `.book[data-slug]`, `.blurb`), `.is-open` from Task 5
- Produces: `initShelf(el) → void`. Idempotent — safe to call again after a re-render.

- [ ] **Step 1: Write `initShelf`**

Append to `assets/js/shelf.js`:

```js
// Interaction. One book is "open" (pulled out) at a time.
//
// Pointer: hover opens, leaving the case closes.
// Keyboard: roving tabindex, arrows traverse, focus opens, Enter follows the link.
// Touch: first tap opens without navigating, second tap on the same book follows.
export function initShelf(el){
  if(!el || el.dataset.shelfWired === '1') return;
  el.dataset.shelfWired = '1';

  const books = () => Array.from(el.querySelectorAll('.book:not(.skeleton-book)'));
  let openBook = null;

  function open(book){
    if(openBook === book) return;
    if(openBook) openBook.classList.remove('is-open');
    openBook = book;
    if(book) book.classList.add('is-open');
  }

  function focusBook(book){
    if(!book) return;
    books().forEach(b => b.tabIndex = -1);
    book.tabIndex = 0;
    book.focus();
  }

  // ——— pointer ———
  el.addEventListener('pointerover', e => {
    if(e.pointerType === 'touch') return;
    const book = e.target.closest('.book');
    if(book && !book.classList.contains('skeleton-book')) open(book);
  });
  el.addEventListener('pointerleave', e => {
    if(e.pointerType === 'touch') return;
    open(null);
  });

  // ——— keyboard ———
  el.addEventListener('focusin', e => {
    const book = e.target.closest('.book');
    if(book) open(book);
  });
  el.addEventListener('keydown', e => {
    const book = e.target.closest('.book');
    if(!book) return;
    const all = books();
    const i = all.indexOf(book);

    if(e.key === 'ArrowRight' || e.key === 'ArrowLeft'){
      e.preventDefault();
      focusBook(all[e.key === 'ArrowRight' ? Math.min(i + 1, all.length - 1) : Math.max(i - 1, 0)]);
      return;
    }
    if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      e.preventDefault();
      const shelves = Array.from(el.querySelectorAll('.shelf'));
      const here = book.closest('.shelf');
      const next = shelves[shelves.indexOf(here) + (e.key === 'ArrowDown' ? 1 : -1)];
      if(!next) return;
      const row = Array.from(next.querySelectorAll('.book'));
      const within = Array.from(here.querySelectorAll('.book')).indexOf(book);
      focusBook(row[Math.min(within, row.length - 1)]);
      return;
    }
    if(e.key === 'Escape'){ open(null); book.blur(); }
  });

  // ——— touch: first tap opens, second follows ———
  el.addEventListener('click', e => {
    const book = e.target.closest('.book');
    if(!book) return;
    if(matchMedia('(pointer:fine)').matches) return;   // mouse users navigate on first click
    if(openBook !== book){ e.preventDefault(); open(book); }
  });
}
```

- [ ] **Step 2: Call it from the page**

In `writing/index.html`, change the `.then` handler to:

```js
      .then(p => {
        if(reduce){ mountPosts('journal', p); return; }
        mountShelf('journal', p);
        initShelf(journal);
      })
```

and extend the shelf import to:

```js
    import { mountShelf, initShelf, renderSkeletonShelf } from '/assets/js/shelf.js';
```

- [ ] **Step 3: Verify in the browser**

Reload `http://localhost:5050/writing/`.

Expected:
- hovering a spine dims its neighbours, pulls that book forward, and fades in a blurb with date, full title and excerpt
- pressing Tab focuses the first book and opens it; Right/Left move along the shelf; Down/Up move between shelves; Escape closes
- `read_console_messages` shows no errors

Resize the window to 375px wide (`resize_window {preset: "mobile"}`) and confirm the shelf scrolls sideways rather than overflowing the page.

- [ ] **Step 4: Commit**

```bash
git add assets/js/shelf.js writing/index.html
git commit -m "feat: pull-out interaction for pointer, keyboard and touch"
```

---

### Task 7: Repack on resize, then final verification

**Files:**
- Modify: `assets/js/shelf.js` (add `observeShelf`)
- Modify: `writing/index.html`

**Interfaces:**
- Consumes: `mountShelf`, `initShelf`
- Produces: `observeShelf(elId, posts) → void` — mounts, wires, and repacks on width change.

- [ ] **Step 1: Add the observer**

Append to `assets/js/shelf.js`:

```js
// Repacks when the container width changes. Packing is deterministic, so we
// skip re-rendering unless the width actually moved — this keeps the open book
// from being torn out from under the pointer during vertical scroll on mobile,
// where toolbars change the viewport height but not the width.
export function observeShelf(elId, posts){
  const el = document.getElementById(elId);
  if(!el) return;

  let lastWidth = 0, timer = null;
  const render = () => {
    const w = el.clientWidth;
    if(w === lastWidth) return;
    lastWidth = w;
    mountShelf(elId, posts, w);
    delete el.dataset.shelfWired;
    initShelf(el);
  };

  render();
  new ResizeObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(render, 120);
  }).observe(el);
}
```

- [ ] **Step 2: Use it from the page**

In `writing/index.html`, change the shelf import to:

```js
    import { observeShelf, renderSkeletonShelf } from '/assets/js/shelf.js';
```

and the `.then` handler to:

```js
      .then(p => reduce ? mountPosts('journal', p) : observeShelf('journal', p))
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS — all tests across `tests/wordpress.test.js`, `tests/shelf.test.js`, and the pre-existing suites (`gear-train`, `layout`, `mode`, `palette`, `vault`, `tools`, `hub-core`, `hub-sync`, `brain-core`).

- [ ] **Step 4: Full browser verification**

With the `site` server running:

1. `http://localhost:5050/writing/` — bookcase renders, no console errors
2. Drag the window from wide to narrow — shelves repack, books do not disappear or duplicate
3. `resize_window {preset: "mobile"}` — spines stay legible, tap opens the blurb, second tap navigates
4. Toggle the lamp — dark cloth, dark board, gilt still legible
5. Click a spine — lands on `/writing/post.html?slug=…` with the post rendered
6. Ctrl+K — the command palette still lists posts (it consumes the same `postsPromise`)
7. Screenshot light and dark for the record

- [ ] **Step 5: Commit**

```bash
git add assets/js/shelf.js writing/index.html
git commit -m "feat: repack the bookcase on resize"
```

---

## Notes for the implementer

- **If a spine's title is unreadable at 30px wide**, do not widen every book — raise the minimum width in `toVolume` and let `packShelves` absorb it. Colours and dimensions are the only tuning knobs that must stay deterministic from the slug.
- **Do not add a library to solve the 3D.** If the transforms fight you, simplify the effect. The constraint is the point.
- **`renderPostCard` and `renderSkeletonRows` must keep working** — they are the reduced-motion path, not dead code. Do not delete them.
