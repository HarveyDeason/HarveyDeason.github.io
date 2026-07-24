# Comments Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Comments Hub — a gated single-page tool that logs comments/updates against OSB items and Standard products, syncs a JSON ledger through a shared parent folder (which contains the existing P&ID folder), and generates formatted per-product + master Excel logs.

**Architecture:** Pure logic (state model, merge, ref sequencing, filtering, Excel workbook models) lives in `assets/js/hub-core.js` (committed, unit-tested with `node --test`). The UI is a single plaintext file `tools-src/comments-hub.html` (gitignored, deployed encrypted via `scripts/lock-tools.mjs`), which imports hub-core as an ES module and uses the File System Access API for shared-folder sync, mirroring the P&ID Tag Register tool. Excel files are generated with vendored ExcelJS and are outputs only — never read back.

**Tech Stack:** Vanilla JS ES modules, `node --test` + `node:assert/strict`, File System Access API (Chrome/Edge desktop), ExcelJS (vendored browser bundle), site.css/tool.css design tokens.

**Spec:** `docs/superpowers/specs/2026-07-24-comments-hub-design.md` — read it before starting any task.

## Global Constraints

- No hardcoded colours in the tool UI — alias site.css tokens exactly as `tools-src/pid-tag-register.html` does (`--bg: var(--background)` etc.). Excel styling uses the print-safe hex constants defined in Task 5 only.
- The P&ID tool and its folder are untouched: `register.json` is read-only; never write inside the `P&ID Register/` subfolder.
- `hub-data.json` is the single source of truth. Excel files are regenerated outputs, never parsed.
- Every save: read → merge → write backup → write → regenerate touched Excels.
- `tools-src/` is gitignored — never `git add` the tool HTML. Commit hub-core, tests, tools.json, vendor file, preview image, and (after the user runs lock-tools) the regenerated `tools/` loaders + manifest.
- "Raised by" is never pre-filled.
- Tests run with `npm test` (`node --test`) from the repo root `harveydeason-site/`.
- All dates stored as ISO strings (`YYYY-MM-DD` for user dates, full ISO for timestamps).

---

### Task 1: Vendor ExcelJS

**Files:**
- Create: `assets/vendor/exceljs.min.js`

**Interfaces:**
- Produces: browser global `ExcelJS` with `new ExcelJS.Workbook()`, `workbook.addWorksheet(name)`, `worksheet.columns`, `.addRow()`, `.getRow()`, cell `fill/font/border/alignment`, `workbook.xlsx.writeBuffer()`.

> **Requires user approval before downloading.** State filename, source, and size when asking.

- [ ] **Step 1: Download the pinned browser bundle**

Run (after approval):
```powershell
Invoke-WebRequest -Uri "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js" -OutFile "assets/vendor/exceljs.min.js"
```
Expected: file ~940 KB.

- [ ] **Step 2: Sanity-check the file**

Run: `Get-Item assets/vendor/exceljs.min.js | Select-Object Length` and confirm the first line of the file mentions `exceljs`. Expected: length > 800000.

- [ ] **Step 3: Commit**

```bash
git add assets/vendor/exceljs.min.js
git commit -m "chore: vendor ExcelJS 4.4.0 for Comments Hub styled exports"
```

---

### Task 2: hub-core — state model and merge

**Files:**
- Create: `assets/js/hub-core.js`
- Test: `tests/hub-core.test.js`

**Interfaces:**
- Produces (exact exports later tasks rely on):
  - `emptyState(nowIso) -> state` where `state = { version: 1, savedAt: '', products: [], comments: [], lists: { categories: string[], sources: string[] }, tombstones: {}, refCounter: 0 }`
  - `DEFAULT_CATEGORIES: string[]` = `['Pipework change','New valve','Valve change','Instrument change','Equipment change','Layout change','Annotation / drafting','Other']`
  - `DEFAULT_SOURCES: string[]` = `['Site feedback','Design review','Client comment','HAZOP action','Internal QA','Other']`
  - `mergeState(local, disk) -> state` — pure, never mutates inputs.
- Records: product `{ id, name, type, pidDrawings: string[], modelRef, sheetRefs, updatedAt }`; comment `{ id, ref, productIds: string[], affectedTypes: string[], category, source, dateRaised, raisedBy, description, priority, status, hold, pidRevision, dateClosed, actionTaken, closedBy, updatedAt }`. `status ∈ 'open'|'in_progress'|'closed'`, `priority ∈ 'low'|'medium'|'high'`.

Merge rules (from spec): per-record by `id`, later `updatedAt` wins; `tombstones` is `{ [id]: isoTimestamp }`, union taking the max timestamp; a record is dropped when `tombstones[id] >= record.updatedAt`; lists are case-insensitively deduped, local order first then disk extras appended; `refCounter` = max of both sides; `savedAt`/`version` from whichever input is newer.

- [ ] **Step 1: Write failing tests**

```js
// tests/hub-core.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, mergeState, DEFAULT_CATEGORIES } from '../assets/js/hub-core.js';

const P = (id, updatedAt, name = 'OSB-01') =>
  ({ id, name, type: 'OSB item', pidDrawings: [], modelRef: '', sheetRefs: '', updatedAt });
const C = (id, updatedAt, extra = {}) => ({
  id, ref: 'HUB-0001', productIds: ['p1'], affectedTypes: ['P&ID'], category: 'Pipework change',
  source: 'Site feedback', dateRaised: '2026-07-24', raisedBy: 'A N Other', description: 'x',
  priority: 'medium', status: 'open', hold: false, pidRevision: '', dateClosed: '', actionTaken: '',
  closedBy: '', updatedAt, ...extra,
});

test('emptyState seeds defaults', () => {
  const s = emptyState('2026-07-24T00:00:00Z');
  assert.equal(s.version, 1);
  assert.deepEqual(s.lists.categories, DEFAULT_CATEGORIES);
  assert.equal(s.refCounter, 0);
});

test('mergeState: later updatedAt wins per comment id', () => {
  const local = { ...emptyState('t'), comments: [C('c1', '2026-07-24T10:00:00Z', { description: 'old' })] };
  const disk  = { ...emptyState('t'), comments: [C('c1', '2026-07-24T11:00:00Z', { description: 'new' })] };
  assert.equal(mergeState(local, disk).comments[0].description, 'new');
  assert.equal(mergeState(disk, local).comments[0].description, 'new'); // symmetric
});

test('mergeState: union of distinct records from both sides', () => {
  const local = { ...emptyState('t'), products: [P('p1', '2026-07-24T10:00:00Z')] };
  const disk  = { ...emptyState('t'), products: [P('p2', '2026-07-24T10:00:00Z', 'OSB-02')] };
  assert.equal(mergeState(local, disk).products.length, 2);
});

test('mergeState: tombstone at/after updatedAt removes record; max tombstone kept', () => {
  const local = { ...emptyState('t'), comments: [C('c1', '2026-07-24T10:00:00Z')] };
  const disk  = { ...emptyState('t'), tombstones: { c1: '2026-07-24T10:00:00Z' } };
  const m = mergeState(local, disk);
  assert.equal(m.comments.length, 0);
  assert.equal(m.tombstones.c1, '2026-07-24T10:00:00Z');
});

test('mergeState: record edited after tombstone survives (reinstated)', () => {
  const local = { ...emptyState('t'), comments: [C('c1', '2026-07-24T12:00:00Z')] };
  const disk  = { ...emptyState('t'), tombstones: { c1: '2026-07-24T10:00:00Z' } };
  assert.equal(mergeState(local, disk).comments.length, 1);
});

test('mergeState: lists deduped case-insensitively, local order first', () => {
  const local = { ...emptyState('t') };
  const disk  = { ...emptyState('t') };
  disk.lists = { categories: ['pipework change', 'Cable change'], sources: [] };
  const m = mergeState(local, disk);
  assert.equal(m.lists.categories.filter(c => c.toLowerCase() === 'pipework change').length, 1);
  assert.ok(m.lists.categories.includes('Cable change'));
});

test('mergeState: refCounter takes the max, does not mutate inputs', () => {
  const local = { ...emptyState('t'), refCounter: 7 };
  const disk  = { ...emptyState('t'), refCounter: 12 };
  const snapshot = JSON.stringify(local);
  assert.equal(mergeState(local, disk).refCounter, 12);
  assert.equal(JSON.stringify(local), snapshot);
});
```

- [ ] **Step 2: Run to verify failure** — `npm test` → FAIL (`Cannot find module .../hub-core.js`).

- [ ] **Step 3: Implement**

```js
// assets/js/hub-core.js
// Pure logic for the Comments Hub tool: state shape, shared-folder merge,
// ref sequencing, dashboard filtering, and Excel workbook models.
// No DOM, no File System Access API — everything here is node-testable.

export const HUB_VERSION = 1;

export const DEFAULT_CATEGORIES = ['Pipework change', 'New valve', 'Valve change',
  'Instrument change', 'Equipment change', 'Layout change', 'Annotation / drafting', 'Other'];
export const DEFAULT_SOURCES = ['Site feedback', 'Design review', 'Client comment',
  'HAZOP action', 'Internal QA', 'Other'];

export function emptyState(nowIso) {
  return {
    version: HUB_VERSION,
    savedAt: nowIso || '',
    products: [],
    comments: [],
    lists: { categories: DEFAULT_CATEGORIES.slice(), sources: DEFAULT_SOURCES.slice() },
    tombstones: {},
    refCounter: 0,
  };
}

function mergeById(a, b, tombstones) {
  const out = new Map();
  for (const rec of [...a, ...b]) {
    if (!rec || !rec.id) continue;
    const prev = out.get(rec.id);
    if (!prev || (rec.updatedAt || '') > (prev.updatedAt || '')) out.set(rec.id, rec);
  }
  return [...out.values()].filter(r => !(tombstones[r.id] && tombstones[r.id] >= (r.updatedAt || '')));
}

function mergeList(a, b) {
  const seen = new Set();
  const out = [];
  for (const v of [...(a || []), ...(b || [])]) {
    const k = String(v).trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(String(v).trim());
  }
  return out;
}

export function mergeState(local, disk) {
  const l = local || emptyState('');
  const d = disk || emptyState('');
  const tombstones = { ...l.tombstones };
  for (const [id, ts] of Object.entries(d.tombstones || {})) {
    if (!tombstones[id] || ts > tombstones[id]) tombstones[id] = ts;
  }
  const merged = {
    version: HUB_VERSION,
    savedAt: (l.savedAt || '') > (d.savedAt || '') ? l.savedAt : d.savedAt,
    products: mergeById(l.products || [], d.products || [], tombstones),
    comments: mergeById(l.comments || [], d.comments || [], tombstones),
    lists: {
      categories: mergeList(l.lists && l.lists.categories, d.lists && d.lists.categories),
      sources: mergeList(l.lists && l.lists.sources, d.lists && d.lists.sources),
    },
    tombstones,
    refCounter: Math.max(l.refCounter || 0, d.refCounter || 0),
  };
  return merged;
}
```

- [ ] **Step 4: Run to verify pass** — `npm test` → all hub-core tests PASS (existing suites still pass).

- [ ] **Step 5: Commit**

```bash
git add assets/js/hub-core.js tests/hub-core.test.js
git commit -m "feat: hub-core state model and shared-folder merge"
```

---

### Task 3: hub-core — ref sequencing and collision repair

**Files:**
- Modify: `assets/js/hub-core.js`
- Test: `tests/hub-core.test.js`

**Interfaces:**
- Consumes: `mergeState`, comment records from Task 2.
- Produces:
  - `formatRef(n) -> 'HUB-0007'` (4-digit zero pad, grows past 9999 naturally)
  - `nextRef(state) -> { ref, refCounter }` — does not mutate; caller stores both.
  - `resequenceRefs(state) -> state` — deterministic duplicate repair after merge: sort comments by `(dateRaised, id)`; first holder of a ref keeps it; later duplicates (or blank refs) get fresh refs continuing from the highest of `refCounter` and any numeric ref seen; result `refCounter` = highest ref issued. `mergeState` calls `resequenceRefs` on its result before returning.

- [ ] **Step 1: Write failing tests**

```js
// append to tests/hub-core.test.js
import { formatRef, nextRef, resequenceRefs } from '../assets/js/hub-core.js';

test('formatRef pads to 4 digits and grows beyond', () => {
  assert.equal(formatRef(7), 'HUB-0007');
  assert.equal(formatRef(12345), 'HUB-12345');
});

test('nextRef issues the next ref without mutating state', () => {
  const s = { ...emptyState('t'), refCounter: 41 };
  const { ref, refCounter } = nextRef(s);
  assert.equal(ref, 'HUB-0042');
  assert.equal(refCounter, 42);
  assert.equal(s.refCounter, 41);
});

test('merge of two sides that both issued HUB-0002 re-sequences deterministically', () => {
  const base = { ...emptyState('t'), refCounter: 1 };
  const a = { ...base, refCounter: 2, comments: [C('ca', '2026-07-24T10:00:00Z', { ref: 'HUB-0002', dateRaised: '2026-07-20' })] };
  const b = { ...base, refCounter: 2, comments: [C('cb', '2026-07-24T10:30:00Z', { ref: 'HUB-0002', dateRaised: '2026-07-22' })] };
  const m1 = mergeState(a, b);
  const m2 = mergeState(b, a);
  const refs1 = m1.comments.map(c => [c.id, c.ref]).sort();
  assert.deepEqual(refs1, m2.comments.map(c => [c.id, c.ref]).sort()); // symmetric
  const earlier = m1.comments.find(c => c.id === 'ca');
  const later = m1.comments.find(c => c.id === 'cb');
  assert.equal(earlier.ref, 'HUB-0002'); // earlier dateRaised keeps the ref
  assert.equal(later.ref, 'HUB-0003');
  assert.equal(m1.refCounter, 3);
});
```

- [ ] **Step 2: Run to verify failure** — `npm test` → FAIL (`formatRef` not exported).

- [ ] **Step 3: Implement**

```js
// append to assets/js/hub-core.js
export function formatRef(n) {
  return 'HUB-' + String(n).padStart(4, '0');
}

export function nextRef(state) {
  const refCounter = (state.refCounter || 0) + 1;
  return { ref: formatRef(refCounter), refCounter };
}

function refNumber(ref) {
  const m = /^HUB-(\d+)$/.exec(ref || '');
  return m ? parseInt(m[1], 10) : 0;
}

export function resequenceRefs(state) {
  const ordered = [...state.comments].sort((x, y) =>
    (x.dateRaised || '').localeCompare(y.dateRaised || '') || String(x.id).localeCompare(String(y.id)));
  let high = state.refCounter || 0;
  for (const c of ordered) high = Math.max(high, refNumber(c.ref));
  const seen = new Set();
  const comments = ordered.map(c => {
    if (c.ref && !seen.has(c.ref)) { seen.add(c.ref); return c; }
    high += 1;
    const ref = formatRef(high);
    seen.add(ref);
    return { ...c, ref };
  });
  return { ...state, comments, refCounter: high };
}
```

And in `mergeState`, change the final line to run repair:

```js
  return resequenceRefs(merged);
```
(Declare `resequenceRefs` above `mergeState` or rely on function hoisting — `export function` declarations hoist, so order is fine.)

- [ ] **Step 4: Run to verify pass** — `npm test` → PASS.
- [ ] **Step 5: Commit** — `git add -u && git commit -m "feat: hub-core ref sequencing with deterministic collision repair"`

---

### Task 4: hub-core — filtering, counts, days-open, register reading

**Files:**
- Modify: `assets/js/hub-core.js`
- Test: `tests/hub-core.test.js`

**Interfaces:**
- Consumes: state shape from Task 2.
- Produces:
  - `filterComments(comments, filters) -> comment[]` — `filters = { productId?, status?, affectedType?, category?, source?, priority?, hold? ('held'|'not_held'), search? }`; all optional, ANDed; `search` is case-insensitive over `ref`, `description`, `raisedBy`, `actionTaken`.
  - `commentCounts(comments) -> { open, inProgress, closed, highOpen }`
  - `productCounts(comments) -> Map<productId, { open, inProgress, closed }>`
  - `daysOpen(comment, todayIso) -> number` — whole days from `dateRaised` to `todayIso` (open/in-progress) or to `dateClosed` (closed).
  - `latestRevisions(registerJson) -> Map<drawing, revision>` — from the P&ID `register.json` `revHistory` shape `{ [drawing]: { [rev]: { importedAt } } }`; latest = highest `importedAt`.

- [ ] **Step 1: Write failing tests**

```js
// append to tests/hub-core.test.js
import { filterComments, commentCounts, productCounts, daysOpen, latestRevisions } from '../assets/js/hub-core.js';

test('filterComments ANDs filters and searches text case-insensitively', () => {
  const cs = [
    C('c1', 't', { productIds: ['p1'], status: 'open', description: 'Replace GATE valve' }),
    C('c2', 't', { productIds: ['p2'], status: 'closed', description: 'Re-route pipework' }),
  ];
  assert.deepEqual(filterComments(cs, { productId: 'p1' }).map(c => c.id), ['c1']);
  assert.deepEqual(filterComments(cs, { search: 'gate' }).map(c => c.id), ['c1']);
  assert.deepEqual(filterComments(cs, { productId: 'p1', status: 'closed' }), []);
});

test('hold filter distinguishes held vs not-held open comments', () => {
  const cs = [C('c1', 't', { hold: true }), C('c2', 't', { hold: false })];
  assert.deepEqual(filterComments(cs, { hold: 'held' }).map(c => c.id), ['c1']);
  assert.deepEqual(filterComments(cs, { hold: 'not_held' }).map(c => c.id), ['c2']);
});

test('commentCounts and productCounts', () => {
  const cs = [
    C('c1', 't', { status: 'open', priority: 'high' }),
    C('c2', 't', { status: 'in_progress' }),
    C('c3', 't', { status: 'closed', productIds: ['p2'] }),
  ];
  assert.deepEqual(commentCounts(cs), { open: 1, inProgress: 1, closed: 1, highOpen: 1 });
  assert.deepEqual(productCounts(cs).get('p1'), { open: 1, inProgress: 1, closed: 0 });
});

test('daysOpen measures to today for open, to dateClosed for closed', () => {
  assert.equal(daysOpen(C('c', 't', { dateRaised: '2026-07-01' }), '2026-07-24'), 23);
  assert.equal(daysOpen(C('c', 't', { dateRaised: '2026-07-01', status: 'closed', dateClosed: '2026-07-10' }), '2026-07-24'), 9);
});

test('latestRevisions picks the revision with the newest importedAt', () => {
  const reg = { revHistory: { 'DRG-001': {
    A: { importedAt: '2026-01-01T00:00:00Z' },
    B: { importedAt: '2026-06-01T00:00:00Z' },
  } } };
  assert.equal(latestRevisions(reg).get('DRG-001'), 'B');
});
```

- [ ] **Step 2: Run to verify failure** — `npm test` → FAIL.

- [ ] **Step 3: Implement**

```js
// append to assets/js/hub-core.js
export function filterComments(comments, filters) {
  const f = filters || {};
  const q = (f.search || '').trim().toLowerCase();
  return comments.filter(c =>
    (!f.productId || (c.productIds || []).includes(f.productId)) &&
    (!f.status || c.status === f.status) &&
    (!f.affectedType || (c.affectedTypes || []).includes(f.affectedType)) &&
    (!f.category || c.category === f.category) &&
    (!f.source || c.source === f.source) &&
    (!f.priority || c.priority === f.priority) &&
    (!f.hold || (f.hold === 'held') === !!c.hold) &&
    (!q || [c.ref, c.description, c.raisedBy, c.actionTaken].join(' ').toLowerCase().includes(q)));
}

export function commentCounts(comments) {
  const out = { open: 0, inProgress: 0, closed: 0, highOpen: 0 };
  for (const c of comments) {
    if (c.status === 'open') out.open += 1;
    else if (c.status === 'in_progress') out.inProgress += 1;
    else if (c.status === 'closed') out.closed += 1;
    if (c.priority === 'high' && c.status !== 'closed') out.highOpen += 1;
  }
  return out;
}

export function productCounts(comments) {
  const map = new Map();
  for (const c of comments) {
    for (const pid of c.productIds || []) {
      if (!map.has(pid)) map.set(pid, { open: 0, inProgress: 0, closed: 0 });
      const b = map.get(pid);
      if (c.status === 'open') b.open += 1;
      else if (c.status === 'in_progress') b.inProgress += 1;
      else if (c.status === 'closed') b.closed += 1;
    }
  }
  return map;
}

export function daysOpen(comment, todayIso) {
  const end = comment.status === 'closed' && comment.dateClosed ? comment.dateClosed : todayIso;
  const ms = new Date(end + 'T00:00:00Z') - new Date(comment.dateRaised + 'T00:00:00Z');
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 86400000)) : 0;
}

export function latestRevisions(registerJson) {
  const out = new Map();
  const hist = (registerJson && registerJson.revHistory) || {};
  for (const [drawing, revs] of Object.entries(hist)) {
    let best = '';
    let bestAt = '';
    for (const [rev, info] of Object.entries(revs || {})) {
      if ((info && info.importedAt || '') >= bestAt) { bestAt = (info && info.importedAt) || ''; best = rev; }
    }
    if (best) out.set(drawing, best);
  }
  return out;
}
```

- [ ] **Step 4: Run to verify pass** — `npm test` → PASS.
- [ ] **Step 5: Commit** — `git add -u && git commit -m "feat: hub-core filtering, counts, days-open, register revision lookup"`

---

### Task 5: hub-core — Excel workbook models

**Files:**
- Modify: `assets/js/hub-core.js`
- Test: `tests/hub-core.test.js`

**Interfaces:**
- Consumes: state, `productCounts`, `commentCounts`, `latestRevisions` map.
- Produces a **workbook model**: plain data consumed by the ExcelJS applier in the UI (Task 9), so all layout is unit-testable without ExcelJS:
  - `EXCEL_COLORS` = `{ headerFill: 'FF1F4D38', headerText: 'FFFFFFFF', zebra: 'FFF2F5F0', open: 'FFF6E3B4', inProgress: 'FFDCE8F5', closed: 'FFDDEBD9', high: 'FFF5D6D0' }` (print-safe translation of the site's racing-green palette; ARGB).
  - `COMMENT_COLUMNS` = ordered `[{ key, header, width }]` for: ref, dateRaised, raisedBy, source, affectedTypes, category, priority, description (width 60), pidRevision, status, dateClosed, actionTaken (width 40), closedBy.
  - `buildProductWorkbookModel(state, productId, revisions, nowIso) -> model`
  - `buildMasterWorkbookModel(state, revisions, nowIso) -> model`
  - `buildFilteredWorkbookModel(state, comments, nowIso) -> model` (dashboard export; master-log layout, only given comments)
  - Model shape: `{ filename, sheets: [{ name, kind: 'summary'|'log', columns?, rows, meta? }] }`. Log rows: `{ cells: { [key]: string }, statusKey: 'open'|'in_progress'|'closed', high: boolean }`. Summary sheets: `rows` of `[label, value]` pairs, `meta = { title, generatedOn }`. Master/filtered logs prepend a `product` column.
  - `statusLabel(s)` -> `'Open' | 'In progress' | 'Closed'`.
  - Multi-product comments appear once per product file, and once per row in master logs with product names joined by `', '`.
  - `sanitizeFilename(name)` (same char-strip as the P&ID tool: `[\/\\:*?"<>|]` → `-`). Per-product filename: `<sanitized name> Comments.xlsx`; master: `Master Log.xlsx`.

- [ ] **Step 1: Write failing tests**

```js
// append to tests/hub-core.test.js
import { buildProductWorkbookModel, buildMasterWorkbookModel, buildFilteredWorkbookModel,
  COMMENT_COLUMNS, statusLabel, sanitizeFilename } from '../assets/js/hub-core.js';

function demoState() {
  const s = emptyState('2026-07-24T09:00:00Z');
  s.products = [
    { id: 'p1', name: 'OSB-01 Chemical Dosing', type: 'OSB item', pidDrawings: ['DRG-001'], modelRef: 'M-01', sheetRefs: 'SH-01', updatedAt: 't' },
    { id: 'p2', name: 'OSB-02 Kiosk', type: 'Standard product', pidDrawings: [], modelRef: '', sheetRefs: '', updatedAt: 't' },
  ];
  s.comments = [
    C('c1', 't', { ref: 'HUB-0001', productIds: ['p1', 'p2'], status: 'open', priority: 'high' }),
    C('c2', 't', { ref: 'HUB-0002', productIds: ['p2'], status: 'closed', dateClosed: '2026-07-20', actionTaken: 'Done', closedBy: 'HD' }),
  ];
  return s;
}

test('product workbook: summary + log, only that product’s comments, revision from register', () => {
  const m = buildProductWorkbookModel(demoState(), 'p1', new Map([['DRG-001', 'C']]), '2026-07-24');
  assert.equal(m.filename, 'OSB-01 Chemical Dosing Comments.xlsx');
  assert.equal(m.sheets.length, 2);
  assert.equal(m.sheets[0].kind, 'summary');
  assert.ok(m.sheets[0].rows.some(([label, value]) => label.includes('P&ID') && value.includes('DRG-001 (Rev C)')));
  const log = m.sheets[1];
  assert.equal(log.rows.length, 1);
  assert.equal(log.rows[0].cells.ref, 'HUB-0001');
  assert.equal(log.rows[0].statusKey, 'open');
  assert.equal(log.rows[0].high, true);
});

test('master workbook: overview counts + product column on every row', () => {
  const m = buildMasterWorkbookModel(demoState(), new Map(), '2026-07-24');
  assert.equal(m.filename, 'Master Log.xlsx');
  assert.equal(m.sheets[0].kind, 'summary');
  assert.ok(m.sheets[0].rows.some(([label]) => label === 'OSB-01 Chemical Dosing'));
  const log = m.sheets[1];
  assert.equal(log.columns[0].key, 'product');
  assert.equal(log.rows.length, 2);
  assert.equal(log.rows[0].cells.product, 'OSB-01 Chemical Dosing, OSB-02 Kiosk');
});

test('filtered workbook uses only supplied comments', () => {
  const s = demoState();
  const m = buildFilteredWorkbookModel(s, s.comments.filter(c => c.status === 'closed'), '2026-07-24');
  assert.equal(m.sheets.length, 1);
  assert.equal(m.sheets[0].rows.length, 1);
  assert.equal(m.sheets[0].rows[0].cells.ref, 'HUB-0002');
});

test('statusLabel and sanitizeFilename', () => {
  assert.equal(statusLabel('in_progress'), 'In progress');
  assert.equal(sanitizeFilename('A/B:C'), 'A-B-C');
  assert.ok(COMMENT_COLUMNS.some(c => c.key === 'description' && c.width >= 50));
});
```

- [ ] **Step 2: Run to verify failure** — `npm test` → FAIL.

- [ ] **Step 3: Implement**

```js
// append to assets/js/hub-core.js
export const EXCEL_COLORS = {
  headerFill: 'FF1F4D38', headerText: 'FFFFFFFF', zebra: 'FFF2F5F0',
  open: 'FFF6E3B4', inProgress: 'FFDCE8F5', closed: 'FFDDEBD9', high: 'FFF5D6D0',
};

export const COMMENT_COLUMNS = [
  { key: 'ref', header: 'Ref', width: 10 },
  { key: 'dateRaised', header: 'Date raised', width: 12 },
  { key: 'raisedBy', header: 'Raised by', width: 16 },
  { key: 'source', header: 'Source', width: 16 },
  { key: 'affectedTypes', header: 'Affects', width: 18 },
  { key: 'category', header: 'Category', width: 18 },
  { key: 'priority', header: 'Priority', width: 10 },
  { key: 'description', header: 'Description', width: 60 },
  { key: 'pidRevision', header: 'Rev raised against', width: 14 },
  { key: 'status', header: 'Status', width: 12 },
  { key: 'dateClosed', header: 'Date closed', width: 12 },
  { key: 'actionTaken', header: 'Action taken', width: 40 },
  { key: 'closedBy', header: 'Closed by', width: 14 },
];

export function statusLabel(s) {
  return s === 'in_progress' ? 'In progress' : s === 'closed' ? 'Closed' : 'Open';
}

export function sanitizeFilename(x) {
  return String(x).replace(/[\/\\:*?"<>|]/g, '-');
}

function titleCase(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function commentRow(c, state) {
  const names = (c.productIds || [])
    .map(pid => { const p = state.products.find(x => x.id === pid); return p ? p.name : pid; });
  return {
    cells: {
      product: names.join(', '),
      ref: c.ref, dateRaised: c.dateRaised, raisedBy: c.raisedBy, source: c.source,
      affectedTypes: (c.affectedTypes || []).join(', '), category: c.category,
      priority: titleCase(c.priority || ''), description: c.description,
      pidRevision: c.pidRevision || '', status: statusLabel(c.status),
      dateClosed: c.dateClosed || '', actionTaken: c.actionTaken || '', closedBy: c.closedBy || '',
    },
    statusKey: c.status, high: c.priority === 'high' && c.status !== 'closed',
  };
}

function sortForLog(comments) {
  return [...comments].sort((a, b) => (a.ref || '').localeCompare(b.ref || '', undefined, { numeric: true }));
}

export function buildProductWorkbookModel(state, productId, revisions, nowIso) {
  const p = state.products.find(x => x.id === productId);
  const comments = sortForLog(state.comments.filter(c => (c.productIds || []).includes(productId)));
  const counts = commentCounts(comments);
  const pids = (p.pidDrawings || [])
    .map(d => revisions.has(d) ? `${d} (Rev ${revisions.get(d)})` : d).join(', ');
  return {
    filename: `${sanitizeFilename(p.name)} Comments.xlsx`,
    sheets: [
      { name: 'Summary', kind: 'summary', meta: { title: p.name, generatedOn: nowIso }, rows: [
        ['Product', p.name], ['Type', p.type],
        ['P&ID drawings', pids || '—'],
        ['Model reference', p.modelRef || '—'], ['Sheet references', p.sheetRefs || '—'],
        ['Open comments', String(counts.open)], ['In progress', String(counts.inProgress)],
        ['Closed', String(counts.closed)], ['Generated on', nowIso],
      ] },
      { name: 'Comment Log', kind: 'log', columns: COMMENT_COLUMNS,
        rows: comments.map(c => commentRow(c, state)) },
    ],
  };
}

const MASTER_COLUMNS = [{ key: 'product', header: 'Product', width: 28 }, ...COMMENT_COLUMNS];

export function buildMasterWorkbookModel(state, revisions, nowIso) {
  const perProduct = productCounts(state.comments);
  const overview = state.products.map(p => {
    const b = perProduct.get(p.id) || { open: 0, inProgress: 0, closed: 0 };
    return [p.name, `Open ${b.open} · In progress ${b.inProgress} · Closed ${b.closed}`];
  });
  return {
    filename: 'Master Log.xlsx',
    sheets: [
      { name: 'Overview', kind: 'summary', meta: { title: 'Comments Hub — Master Log', generatedOn: nowIso },
        rows: [['Generated on', nowIso], ...overview] },
      { name: 'Comment Log', kind: 'log', columns: MASTER_COLUMNS,
        rows: sortForLog(state.comments).map(c => commentRow(c, state)) },
    ],
  };
}

export function buildFilteredWorkbookModel(state, comments, nowIso) {
  return {
    filename: `Comments Export ${nowIso}.xlsx`,
    sheets: [{ name: 'Comments', kind: 'log', columns: MASTER_COLUMNS,
      rows: sortForLog(comments).map(c => commentRow(c, state)) }],
  };
}
```

- [ ] **Step 4: Run to verify pass** — `npm test` → PASS.
- [ ] **Step 5: Commit** — `git add -u && git commit -m "feat: hub-core Excel workbook models for product, master, and filtered exports"`

---

### Task 6: Tool shell — chrome, tabs, folder connect, sync cycle

**Files:**
- Create: `tools-src/comments-hub.html` (gitignored — do NOT commit)
- Reference (read first, follow its patterns): `tools-src/pid-tag-register.html` — head block (lines 1–12), token aliasing `:root` block, `#app` grid + collapsible sidebar, `.brand-header`, `#tabs` vertical tabs, folder chip.

**Interfaces:**
- Consumes: everything exported from `/assets/js/hub-core.js` via `<script type="module">import * as HubCore from '/assets/js/hub-core.js'; window.HubCore = HubCore; ...</script>`; `/assets/css/site.css`, `/assets/css/tool.css`, `/assets/js/tool-chrome.js` (defer), `/assets/vendor/exceljs.min.js`.
- Produces (used by Tasks 7–10): globals `state` (hub state), `dirHandle`, `productsDirHandle`, `registerJson` (parsed or null), `async saveState(touchedProductIds)` (full save cycle incl. Excel regen hook `regenerateExcels(touchedProductIds)` — stub until Task 9), `switchTab(name)`, `renderAll()` (calls per-tab renderers, stubs for now), `todayIso()`, `nowIso()`, `genId()` (`crypto.randomUUID()`).

- [ ] **Step 1: Build the shell**

Copy the head/meta/anti-flash-script/stylesheet pattern from `tools-src/pid-tag-register.html` verbatim (change title to `Comments Hub — Wessex Water`, favicon letter to `C`). Recreate the `:root` token-aliasing block exactly (it maps site.css tokens; no hardcoded colours). Layout: `#app` grid `280px 1fr`, collapsible sidebar with brand header ("Comments Hub" / "OSB & Standard Products"), vertical tabs: Dashboard, New Comment, Products, Settings, and the folder connect chip (states: disconnected / saving / synced, same as P&ID tool). Main area: one `<section>` per tab, `hidden` attribute toggled by `switchTab`.

- [ ] **Step 2: Implement connect + sync cycle**

```js
async function connectFolder() {
  if (!window.showDirectoryPicker) {
    alert('This browser does not support connecting a folder.\n\nUse Google Chrome or Microsoft Edge (desktop) for shared-folder sync.');
    return;
  }
  try { dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' }); } catch (e) { return; }
  updateFolderChip('saving');
  registerJson = await findRegisterJson(dirHandle);          // scan subfolders, read-only
  productsDirHandle = await dirHandle.getDirectoryHandle('Products', { create: true });
  const disk = await readHubJson();                           // null if missing
  if (disk === undefined) {                                   // unreadable ≠ missing
    updateFolderChip('error', 'hub-data.json is unreadable — not overwriting. Fix or remove it, then reconnect.');
    dirHandle = null; return;
  }
  state = HubCore.mergeState(state, disk || HubCore.emptyState(nowIso()));
  await saveState([]);                                        // write-back merged
  syncProductsFromRegister();                                 // Task 8 helper; stub here
  renderAll();
}

async function readHubJson() {
  try {
    const fh = await dirHandle.getFileHandle('hub-data.json', { create: false });
    const txt = await (await fh.getFile()).text();
    try { return JSON.parse(txt); } catch (e) { return undefined; }   // corrupt: refuse to clobber
  } catch (e) { return null; }                                        // missing: fine
}

async function saveState(touchedProductIds) {
  if (!dirHandle) { renderAll(); return; }
  updateFolderChip('saving');
  const disk = await readHubJson();
  if (disk === undefined) { updateFolderChip('error', 'hub-data.json unreadable — save blocked.'); return; }
  if (disk) {
    await writeFile(dirHandle, 'hub-data.backup.json', JSON.stringify(disk));   // one-deep undo
    state = HubCore.mergeState(state, disk);
  }
  state.savedAt = nowIso();
  await writeFile(dirHandle, 'hub-data.json', JSON.stringify(state, null, 2));
  await regenerateExcels(touchedProductIds);                  // stub until Task 9
  updateFolderChip('synced');
  renderAll();
}

async function writeFile(dir, name, contents) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(contents);
  await w.close();
}

async function findRegisterJson(root) {
  for await (const entry of root.values()) {
    if (entry.kind !== 'directory' || entry.name === 'Products') continue;
    try {
      const fh = await entry.getFileHandle('register.json', { create: false });
      return JSON.parse(await (await fh.getFile()).text());
    } catch (e) { /* keep scanning */ }
  }
  return null;
}
```

`state` initialises to `HubCore.emptyState(nowIso())` on load. `regenerateExcels` and `syncProductsFromRegister` are defined as no-op functions in this task with a `// implemented in Task 8/9` note.

- [ ] **Step 3: Verify in browser**

Start the site preview (static server per `.claude/launch.json` if present, else `npx serve` equivalent via the preview tool), open `/tools-src/comments-hub.html` route equivalent (serve the file at a path where `/assets/...` resolves — simplest: temporarily copy to repo root as `hub-dev.html`, delete after; do not commit). Create a scratch hub folder in the session scratchpad containing a copy of a real or minimal `P&ID Register/register.json`. Verify: chrome renders in both light/dark, tabs switch, folder connects, `hub-data.json` + `Products/` appear in the scratch folder, chip shows synced, reconnect merges cleanly, corrupt `hub-data.json` (hand-edit to `{oops`) blocks saving with the error chip.

- [ ] **Step 4: No commit** (tools-src is gitignored; nothing committable this task).

---

### Task 7: New Comment tab

**Files:**
- Modify: `tools-src/comments-hub.html`

**Interfaces:**
- Consumes: `state`, `saveState`, `HubCore.nextRef`, `HubCore.latestRevisions`, `genId`, `todayIso`.
- Produces: working entry form; helper `productMultiSelect(containerEl, selectedIds)` reused by the Products tab filters.

- [ ] **Step 1: Build the form** — top to bottom: product multi-select (checkbox list with search box; products sorted by name), affected-type toggle chips (P&ID / Model / Drawing sheets, multi), category `<select>` + inline "+ add new" (prompt-style inline input appending to `state.lists.categories`), source `<select>` + same, date raised (`<input type="date">` default today), raised by (`<input type="text">`, **always blank**), priority segmented control (low/medium/high, default medium), "Hold for annual update" checkbox, big `<textarea>` (min 8 rows), Submit button.

- [ ] **Step 2: Submit handler**

```js
function submitComment() {
  const productIds = selectedProductIds();
  const description = el('nc-desc').value.trim();
  if (!productIds.length || !description) { toast('Pick at least one product and write the change.'); return; }
  const { ref, refCounter } = HubCore.nextRef(state);
  const revs = registerJson ? HubCore.latestRevisions(registerJson) : new Map();
  const pidRevision = productIds
    .flatMap(pid => (state.products.find(p => p.id === pid) || {}).pidDrawings || [])
    .map(d => revs.has(d) ? `${d}: ${revs.get(d)}` : '')
    .filter(Boolean).join(', ');
  state = { ...state, refCounter, comments: [...state.comments, {
    id: crypto.randomUUID(), ref, productIds,
    affectedTypes: selectedTypes(), category: el('nc-cat').value, source: el('nc-src').value,
    dateRaised: el('nc-date').value || todayIso(), raisedBy: el('nc-by').value.trim(),
    description, priority: selectedPriority(), status: 'open', hold: el('nc-hold').checked,
    pidRevision, dateClosed: '', actionTaken: '', closedBy: '', updatedAt: nowIso(),
  }]};
  saveState(productIds);
  clearNewCommentForm();
  toast(`Comment ${ref} logged`);
}
```

- [ ] **Step 3: Verify in browser** — log comments against single and multiple products; confirm ref sequence increments, revision auto-stamp appears when the product links to a register drawing, form clears, raised-by stays blank, new categories appear for both dropdown and `hub-data.json` lists.

---

### Task 8: Dashboard + Products + Settings tabs

**Files:**
- Modify: `tools-src/comments-hub.html`

**Interfaces:**
- Consumes: `HubCore.filterComments/commentCounts/productCounts/daysOpen/statusLabel`, `saveState`, `productMultiSelect`.
- Produces: `syncProductsFromRegister()` (real implementation replacing Task 6 stub): for each drawing in `registerJson.revHistory` not already covered by any product's `pidDrawings`, create a product `{ name: drawing, type: 'OSB item', pidDrawings: [drawing] }` once (skip if tombstoned or already linked).

- [ ] **Step 1: Dashboard** — stat cards (Open / In progress / Closed / High-priority open) clickable to set the status/priority filter; filter bar (product, status, affected type, category, source, priority, hold state incl. "Open & not held", search box, Clear); table columns: ref, product(s), category, priority chip, status chip, days open (sortable), date raised, description snippet (80 chars). Row click expands an inline detail panel: full record, status buttons (Open / In progress / Closed), priority control, hold toggle, close-out panel (date closed default today, action taken textarea, closed by input — saving sets `status:'closed'`), Reopen button (back to open, close-out fields retained), Delete (tombstones after `confirm()`). Every mutation sets `updatedAt: nowIso()` and calls `saveState(comment.productIds)`. Export button calls `exportFiltered()` (stub until Task 9, wired here).

- [ ] **Step 2: Products tab** — table: name, type, linked P&IDs (with live rev), model ref, sheet refs, open-count badge, actions. Add/edit form (name, type select, P&ID picker listing register drawings, modelRef, sheetRefs). "Link to P&ID" for manual products. Merge duplicates: pick survivor + loser → re-point every comment's `productIds` from loser to survivor (`updatedAt` bumped), tombstone loser, `saveState([survivorId])`. Call `syncProductsFromRegister()` after connect and render.

- [ ] **Step 3: Settings tab** — editable category/source lists (add, rename, remove — removals don't touch existing comments), "Regenerate all Excels" button calling `regenerateExcels(null)` (null = all; stub until Task 9).

- [ ] **Step 4: Verify in browser** — filters AND together; stat cards filter; close-out then reopen retains history; merge moves comments and kills the duplicate; register drawings appear as products automatically; deleting stays deleted after reconnect (tombstone survives).

---

### Task 9: Excel generation (ExcelJS applier + regeneration wiring)

**Files:**
- Modify: `tools-src/comments-hub.html`

**Interfaces:**
- Consumes: `HubCore.buildProductWorkbookModel/buildMasterWorkbookModel/buildFilteredWorkbookModel`, `EXCEL_COLORS`, `writeFile` (extend for ArrayBuffer), `productsDirHandle`.
- Produces: `async applyModel(model) -> ArrayBuffer`, real `regenerateExcels(touchedProductIds)` (null = all), `exportFiltered()`.

- [ ] **Step 1: Implement the applier**

```js
async function applyModel(model) {
  const wb = new ExcelJS.Workbook();
  for (const sheet of model.sheets) {
    const ws = wb.addWorksheet(sheet.name);
    if (sheet.kind === 'summary') {
      ws.columns = [{ width: 24 }, { width: 70 }];
      const t = ws.addRow([sheet.meta.title]);
      t.font = { bold: true, size: 14, color: { argb: HubCore.EXCEL_COLORS.headerFill } };
      ws.addRow([]);
      for (const [label, value] of sheet.rows) {
        const r = ws.addRow([label, value]);
        r.getCell(1).font = { bold: true };
        r.alignment = { vertical: 'top', wrapText: true };
      }
    } else {
      ws.columns = sheet.columns.map(c => ({ key: c.key, width: c.width }));
      const head = ws.addRow(sheet.columns.map(c => c.header));
      head.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HubCore.EXCEL_COLORS.headerFill } };
        cell.font = { bold: true, color: { argb: HubCore.EXCEL_COLORS.headerText } };
      });
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };
      sheet.rows.forEach((row, i) => {
        const r = ws.addRow(sheet.columns.map(c => row.cells[c.key] ?? ''));
        r.alignment = { vertical: 'top', wrapText: true };
        if (i % 2 === 1) r.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HubCore.EXCEL_COLORS.zebra } };
        });
        const statusCol = sheet.columns.findIndex(c => c.key === 'status') + 1;
        const statusColor = { open: HubCore.EXCEL_COLORS.open, in_progress: HubCore.EXCEL_COLORS.inProgress, closed: HubCore.EXCEL_COLORS.closed }[row.statusKey];
        if (statusCol && statusColor) r.getCell(statusCol).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: statusColor } };
        const prioCol = sheet.columns.findIndex(c => c.key === 'priority') + 1;
        if (prioCol && row.high) r.getCell(prioCol).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HubCore.EXCEL_COLORS.high } };
      });
    }
  }
  return wb.xlsx.writeBuffer();
}
```

- [ ] **Step 2: Wire regeneration**

`regenerateExcels(touchedProductIds)`: resolve `revs = registerJson ? HubCore.latestRevisions(registerJson) : new Map()`; targets = all products if `touchedProductIds === null`, else those ids; for each: build model, ensure `Products/<sanitized name>/` dir, write `model.filename` there; then always rebuild `Master Log.xlsx` at root. Wrap each file write in try/once-retry/catch — on final failure, non-blocking toast "`<file>` is locked (open in Excel?) — it will catch up on the next save." `writeFile` already accepts ArrayBuffer (createWritable().write handles it). `exportFiltered()`: build filtered model from current dashboard rows, `applyModel`, trigger a download via `Blob` + `<a download>` (not written to the shared folder).

- [ ] **Step 3: Verify in browser** — after logging comments: per-product files + master appear; open one in Excel/LibreOffice: header band green with white bold text, frozen header, autofilter, zebra rows, colour-coded status cells, wrapped description at width 60, summary sheet shows live P&ID revisions and correct counts. Hold a file open in Excel, save a comment → toast appears, next save catches up. "Regenerate all Excels" rebuilds everything. Dashboard export downloads exactly the filtered rows.

---

### Task 10: Register on the site, preview image, deploy

**Files:**
- Modify: `data/tools.json`
- Create: `assets/img/previews/comments-hub.webp`
- Regenerated by the user: `tools/*.html`, `tools/vault-manifest.json`

**Interfaces:**
- Consumes: finished `tools-src/comments-hub.html`.

- [ ] **Step 1: Add the tools.json entry**

```json
{ "slug":"comments-hub","name":"Comments Hub","blurb":"One place to log comments and updates against OSB items and Standard products — tagged, tracked to close-out, and distributed as formatted Excel logs.","href":"/tools/comments-hub.html","tags":["QA","Tracking"],"locked":true }
```
Append to the array in `data/tools.json`. Run `npm test` (tools.test.js exercises card rendering) → PASS.

- [ ] **Step 2: Preview image** — screenshot the Dashboard tab (light mode, populated with demo data) at 1280×800, save as `assets/img/previews/comments-hub.webp` (convert PNG→webp; `cwebp` if available, otherwise any converter — match the format of existing files in that folder).

- [ ] **Step 3: Commit site changes**

```bash
git add data/tools.json assets/img/previews/comments-hub.webp
git commit -m "feat: register Comments Hub tool card and preview"
```

- [ ] **Step 4: USER ACTION — lock and deploy.** Ask the user to run:

```bash
node scripts/lock-tools.mjs
```
(prompts for the workshop code twice; re-encrypts ALL tools-src files and rewrites `tools/` + `vault-manifest.json` — the existing tools keep working because they're re-encrypted from the same sources with the same code). Then:

```bash
git add tools/ && git commit -m "chore: lock tools including Comments Hub" && git push
```
Push deploys to harveydeason.github.io.

- [ ] **Step 5: Post-deploy check** — open `https://harveydeason.github.io/tools/comments-hub.html`, unlock with the workshop code, connect a scratch folder, confirm the tool loads its assets and syncs.
