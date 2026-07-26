# Product Families Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make P&ID-register drawing families first-class targets in the Comments Hub and Product Brain — family products, family-grouped pickers, two-way roll-up views, and one consolidated Excel workbook per family with a sheet per member drawing.

**Architecture:** Family logic (pattern expansion replicating the P&ID tool verbatim, membership maps, filter expansion, family workbook model, Excel sheet-name rules) lands in tested `assets/js/hub-core.js`. The Comments Hub UI gains family products in sync, grouped pickers, dashboard roll-up, and family-workbook generation; the Product Brain gains a read-only `register.json` read at connect plus grouped pickers and roll-up in search/products views. Families are defined ONLY in the P&ID tool and read live — never stored beyond the derived family products.

**Tech Stack:** Vanilla JS ES modules, `node --test`, existing ExcelJS applier, File System Access API.

**Spec:** `docs/superpowers/specs/2026-07-26-product-families-design.md` — read before any task.

## Global Constraints

- Families are defined only in the P&ID tool; `register.json` is READ-ONLY to both tools. Pattern expansion must replicate the P&ID tool's `expandPatterns` semantics exactly (verbatim copy in Task 1).
- Family products use deterministic id `fam-<familyId>`; membership refresh bumps `updatedAt` only when membership actually changed.
- Roll-up is always visibly marked ("via <family name>") — never silent.
- Family member drawings get NO individual workbook; the family workbook replaces them. Excel sheet names: strip `[]:*?/\`, ≤31 chars, dedupe with numeric suffixes, full drawing number in cell A1 of its sheet.
- Files are never deleted; stale per-drawing workbooks surface in a one-time notice.
- `tools-src/` gitignored — UI tasks produce no commits (artifacts to session scratchpad).
- `npm test` from repo root; suite currently 80/80 (81 after Task 12 of the prior round — verify count at start) and must stay green.
- No hardcoded UI colours; zero external requests.

---

### Task 1: hub-core — family expansion, membership, filter roll-up

**Files:**
- Modify: `assets/js/hub-core.js`
- Test: `tests/hub-core.test.js`

**Interfaces:**
- Produces (exact exports):
  - `expandFamilyPatterns(patterns, drawingNames) -> Set<string>` — verbatim P&ID-tool semantics: per pattern (trimmed, uppercased; empty skipped): range form `^([A-Z]+)(\d+)-(?:[A-Z]+)?(\d+)$` matches drawings whose uppercase name starts with the prefix followed by a number in [from, to]; otherwise any drawing whose uppercase name starts with OR includes the pattern.
  - `familiesFromRegister(registerJson) -> [{ id, name, drawings: string[] }]` — from `registerJson.families` (missing → `[]`), drawings expanded against `Object.keys(registerJson.revHistory || {})`, sorted by name.
  - `familyProductId(famId) -> 'fam-' + famId`
  - `familyMembership(products, families) -> { members: Map<famProductId, productId[]>, familyOf: Map<productId, famProductId> }` — a member is any non-family product (no `familyId` field) with at least one `pidDrawings` entry in the family's drawings.
  - `expandProductFilter(productId, membership) -> Set<productId>` — family product → itself + its members; member product → itself + its family product id; other → itself.
- Consumes: nothing new.

- [ ] **Step 1: Write failing tests**

```js
// append to tests/hub-core.test.js
import { expandFamilyPatterns, familiesFromRegister, familyProductId, familyMembership,
  expandProductFilter } from '../assets/js/hub-core.js';

const DRAWINGS = ['SP51', 'SP52-01', 'SP68', 'SP69', 'WW-KIOSK-01'];

test('expandFamilyPatterns: numeric range with prefix', () => {
  const m = expandFamilyPatterns(['SP51-68'], DRAWINGS);
  assert.deepEqual([...m].sort(), ['SP51', 'SP52-01', 'SP68']);
});

test('expandFamilyPatterns: plain pattern matches prefix or substring, case-insensitive', () => {
  assert.deepEqual([...expandFamilyPatterns(['kiosk'], DRAWINGS)], ['WW-KIOSK-01']);
  assert.equal(expandFamilyPatterns(['', '  '], DRAWINGS).size, 0);
});

test('familiesFromRegister expands against revHistory keys, sorted by name', () => {
  const reg = { revHistory: Object.fromEntries(DRAWINGS.map(d => [d, {}])),
    families: [{ id: 'f2', name: 'Zeta', patterns: ['SP69'] }, { id: 'f1', name: 'SP51-68', patterns: ['SP51-68'] }] };
  const fams = familiesFromRegister(reg);
  assert.deepEqual(fams.map(f => f.name), ['SP51-68', 'Zeta']);
  assert.deepEqual(fams[0].drawings.sort(), ['SP51', 'SP52-01', 'SP68']);
  assert.deepEqual(familiesFromRegister({}), []);
});

test('familyMembership and expandProductFilter roll up both directions', () => {
  const products = [
    { id: 'fam-f1', name: 'SP51-68', familyId: 'f1', pidDrawings: ['SP51', 'SP52-01', 'SP68'] },
    { id: 'reg-SP51', name: 'SP51', pidDrawings: ['SP51'] },
    { id: 'reg-SP69', name: 'SP69', pidDrawings: ['SP69'] },
    { id: 'manual1', name: 'Kiosk', pidDrawings: [] },
  ];
  const fams = [{ id: 'f1', name: 'SP51-68', drawings: ['SP51', 'SP52-01', 'SP68'] }];
  const mem = familyMembership(products, fams);
  assert.deepEqual(mem.members.get('fam-f1'), ['reg-SP51']);
  assert.equal(mem.familyOf.get('reg-SP51'), 'fam-f1');
  assert.equal(mem.familyOf.get('reg-SP69'), undefined);
  assert.deepEqual([...expandProductFilter('fam-f1', mem)].sort(), ['fam-f1', 'reg-SP51']);
  assert.deepEqual([...expandProductFilter('reg-SP51', mem)].sort(), ['fam-f1', 'reg-SP51']);
  assert.deepEqual([...expandProductFilter('manual1', mem)], ['manual1']);
});
```

- [ ] **Step 2: Run `npm test`** → FAIL (exports missing).

- [ ] **Step 3: Implement** (append to `assets/js/hub-core.js`)

```js
// ── Product families (defined in the P&ID tool; read-only here) ──
export function expandFamilyPatterns(patterns, drawingNames) {
  const matched = new Set();
  (patterns || []).forEach(raw => {
    const pat = String(raw).trim().toUpperCase();
    if (!pat) return;
    const rangeMatch = pat.match(/^([A-Z]+)(\d+)-(?:[A-Z]+)?(\d+)$/);
    if (rangeMatch) {
      const prefix = rangeMatch[1];
      const from = parseInt(rangeMatch[2], 10);
      const to = parseInt(rangeMatch[3], 10);
      drawingNames.forEach(d => {
        const dm = d.toUpperCase().match(new RegExp('^' + prefix + '(\\d+)'));
        if (dm) {
          const n = parseInt(dm[1], 10);
          if (n >= from && n <= to) matched.add(d);
        }
      });
      return;
    }
    drawingNames.forEach(d => {
      if (d.toUpperCase().startsWith(pat) || d.toUpperCase().includes(pat)) matched.add(d);
    });
  });
  return matched;
}

export function familiesFromRegister(registerJson) {
  const drawings = Object.keys((registerJson && registerJson.revHistory) || {});
  return ((registerJson && registerJson.families) || [])
    .map(f => ({ id: f.id, name: f.name, drawings: [...expandFamilyPatterns(f.patterns, drawings)] }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function familyProductId(famId) { return 'fam-' + famId; }

export function familyMembership(products, families) {
  const members = new Map();
  const familyOf = new Map();
  for (const fam of families || []) {
    const fpid = familyProductId(fam.id);
    const drawingSet = new Set(fam.drawings);
    const ids = (products || [])
      .filter(p => !p.familyId && (p.pidDrawings || []).some(d => drawingSet.has(d)))
      .map(p => p.id);
    members.set(fpid, ids);
    for (const id of ids) familyOf.set(id, fpid);
  }
  return { members, familyOf };
}

export function expandProductFilter(productId, membership) {
  const out = new Set([productId]);
  const m = membership || { members: new Map(), familyOf: new Map() };
  if (m.members.has(productId)) for (const id of m.members.get(productId)) out.add(id);
  if (m.familyOf.has(productId)) out.add(m.familyOf.get(productId));
  return out;
}
```

- [ ] **Step 4: Run `npm test`** → PASS (all suites green).
- [ ] **Step 5: Commit** — `git add -u assets/js tests && git commit -m "feat: hub-core family expansion, membership, filter roll-up"`

---

### Task 2: hub-core — family workbook model + sheet naming

**Files:**
- Modify: `assets/js/hub-core.js`
- Test: `tests/hub-core.test.js`

**Interfaces:**
- Consumes: `familyMembership` map shape, `commentCounts`, `COMMENT_COLUMNS`, `sanitizeFilename`, `commentRow` (private — reuse internally).
- Produces:
  - `excelSheetName(name, takenNames) -> string` — strip `[]:*?/\` (replace with `-`), truncate to 31 chars, dedupe against `takenNames` by truncating to 28 and appending ` (2)`, ` (3)`… (result still ≤31).
  - `buildFamilyWorkbookModel(state, familyPid, membership, revisions, nowIso) -> model` — filename `<sanitized family name> Comments.xlsx`; sheets: (1) Summary (kind 'summary'): family name/type, member drawings with revs, counts: family-level (comments on the family product) and rolled-up total (family + members), generated-on; (2) 'Family Comments' (kind 'log', COMMENT_COLUMNS): comments whose productIds include the family product id; (3) one sheet per member product in `membership.members.get(familyPid)` order (kind 'log', name via `excelSheetName(memberProduct.name, taken)`, `heading: <full member product name>`): comments on that member (family-level NOT duplicated).
  - Log-sheet models MAY now carry optional `heading: string` — the ExcelJS applier (Task 3) renders it as a bold full-width first row above the header band.
  - `staleFamilyMemberFiles(state, membership) -> string[]` — predicted old filenames `<sanitized member name> Comments.xlsx` for every member product of every family (the files regeneration no longer writes).

- [ ] **Step 1: Write failing tests**

```js
// append to tests/hub-core.test.js
import { excelSheetName, buildFamilyWorkbookModel, staleFamilyMemberFiles } from '../assets/js/hub-core.js';

test('excelSheetName strips banned chars, truncates to 31, dedupes', () => {
  assert.equal(excelSheetName('SP52-01: [Rev]/A', []), 'SP52-01- -Rev--A');
  const long = 'X'.repeat(40);
  assert.equal(excelSheetName(long, []).length, 31);
  const first = excelSheetName(long, []);
  const second = excelSheetName(long, [first]);
  assert.notEqual(second, first);
  assert.ok(second.length <= 31 && second.endsWith(' (2)'));
});

function famState() {
  const s = emptyState('t');
  s.products = [
    { id: 'fam-f1', name: 'SP51-68', type: 'OSB item', familyId: 'f1', pidDrawings: ['SP51', 'SP68'], modelRef: '', sheetRefs: '', updatedAt: 't' },
    { id: 'reg-SP51', name: 'SP51', type: 'OSB item', pidDrawings: ['SP51'], modelRef: '', sheetRefs: '', updatedAt: 't' },
    { id: 'reg-SP68', name: 'SP68', type: 'OSB item', pidDrawings: ['SP68'], modelRef: '', sheetRefs: '', updatedAt: 't' },
  ];
  s.comments = [
    C('c1', 't', { ref: 'HUB-0001', productIds: ['fam-f1'], description: 'range-wide change' }),
    C('c2', 't', { ref: 'HUB-0002', productIds: ['reg-SP51'], description: 'SP51 only' }),
  ];
  return s;
}

test('family workbook: summary + family sheet + one sheet per member, no duplication', () => {
  const s = famState();
  const membership = { members: new Map([['fam-f1', ['reg-SP51', 'reg-SP68']]]),
    familyOf: new Map([['reg-SP51', 'fam-f1'], ['reg-SP68', 'fam-f1']]) };
  const m = buildFamilyWorkbookModel(s, 'fam-f1', membership, new Map([['SP51', 'C']]), '2026-07-26');
  assert.equal(m.filename, 'SP51-68 Comments.xlsx');
  assert.deepEqual(m.sheets.map(x => x.name), ['Summary', 'Family Comments', 'SP51', 'SP68']);
  assert.equal(m.sheets[1].rows.length, 1);
  assert.equal(m.sheets[1].rows[0].cells.ref, 'HUB-0001');
  assert.equal(m.sheets[2].heading, 'SP51');
  assert.equal(m.sheets[2].rows.length, 1);
  assert.equal(m.sheets[2].rows[0].cells.ref, 'HUB-0002');
  assert.equal(m.sheets[3].rows.length, 0);
  assert.ok(m.sheets[0].rows.some(([l, v]) => l.includes('Member') && v.includes('SP51 (Rev C)')));
});

test('staleFamilyMemberFiles predicts old per-member filenames', () => {
  const s = famState();
  const membership = { members: new Map([['fam-f1', ['reg-SP51', 'reg-SP68']]]), familyOf: new Map() };
  assert.deepEqual(staleFamilyMemberFiles(s, membership).sort(), ['SP51 Comments.xlsx', 'SP68 Comments.xlsx']);
});
```

- [ ] **Step 2: Run `npm test`** → FAIL.

- [ ] **Step 3: Implement** (append to `assets/js/hub-core.js`)

```js
export function excelSheetName(name, takenNames) {
  const cleaned = String(name).replace(/[[\]:*?/\\]/g, '-').slice(0, 31);
  const taken = new Set(takenNames || []);
  if (!taken.has(cleaned)) return cleaned;
  for (let n = 2; ; n++) {
    const suffix = ' (' + n + ')';
    const candidate = cleaned.slice(0, 31 - suffix.length) + suffix;
    if (!taken.has(candidate)) return candidate;
  }
}

export function buildFamilyWorkbookModel(state, familyPid, membership, revisions, nowIso) {
  const fam = state.products.find(p => p.id === familyPid);
  const memberIds = (membership.members.get(familyPid)) || [];
  const familyComments = sortForLog(state.comments.filter(c => (c.productIds || []).includes(familyPid)));
  const allIds = [familyPid, ...memberIds];
  const rolled = commentCounts(state.comments.filter(c => (c.productIds || []).some(id => allIds.includes(id))));
  const memberList = (fam.pidDrawings || [])
    .map(d => revisions.has(d) ? `${d} (Rev ${revisions.get(d)})` : d).join(', ');
  const sheets = [
    { name: 'Summary', kind: 'summary', meta: { title: fam.name, generatedOn: nowIso }, rows: [
      ['Family', fam.name], ['Type', fam.type],
      ['Member drawings', memberList || '—'],
      ['Family-level comments', String(familyComments.length)],
      ['Open (family + drawings)', String(rolled.open)],
      ['In progress', String(rolled.inProgress)], ['Closed', String(rolled.closed)],
      ['Generated on', nowIso],
    ] },
    { name: 'Family Comments', kind: 'log', columns: COMMENT_COLUMNS,
      rows: familyComments.map(c => commentRow(c, state)) },
  ];
  const taken = sheets.map(s => s.name);
  for (const mid of memberIds) {
    const mp = state.products.find(p => p.id === mid);
    if (!mp) continue;
    const name = excelSheetName(mp.name, taken);
    taken.push(name);
    sheets.push({ name, kind: 'log', heading: mp.name, columns: COMMENT_COLUMNS,
      rows: sortForLog(state.comments.filter(c => (c.productIds || []).includes(mid)))
        .map(c => commentRow(c, state)) });
  }
  return { filename: `${sanitizeFilename(fam.name)} Comments.xlsx`, sheets };
}

export function staleFamilyMemberFiles(state, membership) {
  const out = [];
  for (const ids of membership.members.values()) {
    for (const id of ids) {
      const p = state.products.find(x => x.id === id);
      if (p) out.push(`${sanitizeFilename(p.name)} Comments.xlsx`);
    }
  }
  return out;
}
```
(`sortForLog` and `commentRow` are existing private functions in this file — the new code sits in the same module scope and calls them directly.)

- [ ] **Step 4: Run `npm test`** → PASS.
- [ ] **Step 5: Commit** — `git add -u && git commit -m "feat: hub-core family workbook model and Excel sheet naming"`

---

### Task 3: Comments Hub — family sync, grouped picker, dashboard roll-up, family Excel

**Files:**
- Modify: `tools-src/comments-hub.html` (gitignored — NO commits; diff + report artifacts to scratchpad)

**Interfaces:**
- Consumes: everything from Tasks 1-2 via the page's `HubCore` import; existing `registerJson`, `syncProductsFromRegister`, `productMultiSelect`, `dashboardComments`/`dashFilters`, `regenerateExcels`, `writeWorkbook`, `applyModel`, `queueSave`.
- Produces: family-aware Comments Hub. Page-level helpers `currentFamilies()` (`HubCore.familiesFromRegister(registerJson)`, cached per render cycle) and `currentMembership()` (`HubCore.familyMembership(state.products, currentFamilies())`).

- [ ] **Step 1: Sync** — extend `syncProductsFromRegister()`: after the existing per-drawing pass, for each `familiesFromRegister(registerJson)` entry: id = `HubCore.familyProductId(f.id)`; skip if tombstoned; if absent → create `{ id, name: f.name, type: 'OSB item', familyId: f.id, pidDrawings: f.drawings, modelRef: '', sheetRefs: '', updatedAt: nowIso() }`; if present and `pidDrawings` differs from `f.drawings` (order-insensitive compare) or name differs → update those fields with bumped `updatedAt`; otherwise leave untouched (no updatedAt churn). Single `queueSave([])` when anything changed (fold into the existing additions flow).

- [ ] **Step 2: Picker** — rework `productMultiSelect` rendering: family products render as header rows (name + "whole family" sub-label + checkbox) with their member products indented beneath (via `currentMembership()`); non-member, non-family products listed after. Search filter still matches across all rows. Selection semantics unchanged (each row toggles its own product id — a family header selects the family product).

- [ ] **Step 3: Dashboard roll-up** — where `dashFilters.productId` is applied (in `dashboardComments()` it currently calls `HubCore.filterComments` with `productId`): replace with expansion — compute `ids = HubCore.expandProductFilter(dashFilters.productId, currentMembership())` and filter comments whose productIds intersect `ids`; keep all other filters via `filterComments` (pass the rest of the filters without productId, then intersect). Rows whose match is only via the family/member expansion (i.e. the comment's own productIds don't include the selected id) show a muted "via <name of the linking product>" chip next to the product cell.

- [ ] **Step 4: Excel routing** — in `regenerateExcels`: build `membership = currentMembership()` once. Targets resolve as: family product id → family workbook; member product id → its family's workbook (via `membership.familyOf`); other → individual workbook as now. De-dupe family targets. Family workbooks: `buildFamilyWorkbookModel(state, famPid, membership, revs, nowIso())` written to `Products/<sanitized family name>/` via the existing `writeWorkbook`. Member products get NO individual workbook (skip them in the all-products path too). `applyModel`: support optional log-sheet `heading` — when present, add a first row spanning the columns (bold, font colour `HubCore.EXCEL_COLORS.headerFill`), then the header band (autofilter/freeze offsets shift down one row: `ySplit: 2`, autoFilter from row 2). Stale-files notice: after a regeneration that wrote family workbooks, compute `HubCore.staleFamilyMemberFiles(state, membership)`, check which exist in their old `Products/<member name>/` folders, and if any and not previously dismissed (localStorage flag `hub-stale-notice-dismissed`), show a dismissible banner listing them with "these are no longer updated — safe to delete by hand".

- [ ] **Step 5: Verify in browser** — serve ({name:"site"}), fake handles + seeded `registerJson` containing `families: [{id:'f1',name:'SP51-68',patterns:['SP51-68']}]` and revHistory drawings SP51/SP52/SP68/SP69: sync creates `fam-f1` + drawing products; picker shows grouped family with indented members; comment on family + comment on SP51; dashboard filtered to SP51 shows both (family one marked "via SP51-68"), filtered to family shows both (SP51 one marked "via SP51"); fake-dir writes show ONE `SP51-68 Comments.xlsx` (with sheets Summary/Family Comments/SP51/SP52/SP68 — inspect via applyModel round-trip `wb.xlsx.load`) and NO `SP51 Comments.xlsx`; SP69 still gets its own workbook; stale notice appears when a fake old member file exists. Membership edit propagation: change fake registerJson families to add SP69, re-run sync → family product pidDrawings updated, SP69 workbook stops being generated. Zero new console errors, light+dark. Artifacts: diff vs pre-task snapshot + report to scratchpad.

---

### Task 4: Product Brain — register read, grouped picker, roll-up views

**Files:**
- Modify: `tools-src/product-brain.html` (gitignored — NO commits; artifacts to scratchpad)

**Interfaces:**
- Consumes: `HubCore` exports from Tasks 1-2 — the brain imports brain-core only today; add `import * as HubCore from '/assets/js/hub-core.js';` (it's already a transitive dependency, no new file). Existing: `hubState`, `connectFolder`, product pickers (Decisions/Documents forms), Search scope filter, `renderProductsTab`, `buildSearchDocs` flow.
- Produces: family-aware Product Brain.

- [ ] **Step 1: Register read at connect** — add `registerJson` module state (+ window mirror with setter) and a `findRegisterJson(root)` copy of the hub's (scan subdirectories, skip 'Products'/'Documents', read `register.json`, READ-ONLY, null on none); call it in `connectFolder` before the ledger read. Helpers `currentFamilies()` / `currentMembership()` mirroring Task 3's (membership over `products()` — the hub-state products).

- [ ] **Step 2: Pickers** — apply the same family-grouped rendering to the brain's product multi-select(s) used by Decisions and Documents forms.

- [ ] **Step 3: Roll-up** — Search scope: when `searchState.product` is set, filter hits by `HubCore.expandProductFilter(searchState.product, currentMembership())` intersection instead of single-id includes; hits matched only via expansion get a muted "via <linking product name>" note in the hit meta line. Products tab: selecting a family product shows its own decisions/documents/comments PLUS members' (each marked "via <member name>"); selecting a member shows its own plus family-level items marked "via <family name>". Open-comments section keeps excluding closed.

- [ ] **Step 4: Verify in browser** — seed hubState products (incl. `fam-f1` with familyId + members, as the hub now creates) + registerJson via mirrors, decisions/documents split across family and member: picker grouped; search scoped to family finds member-doc hits (marked); scoped to member finds family decision (marked); Products tab rolls up both directions with marks. Zero new console errors, light+dark. Artifacts: diff + report to scratchpad.

---

### Task 5: Lock + deploy + live verify

**Files:**
- Regenerated: `tools/*.html`, `tools/vault-manifest.json`

- [ ] **Step 1:** `npm test` → full suite green. Confirm no committed-file changes are pending besides Tasks 1-2 commits.
- [ ] **Step 2:** Controller: lock all 7 tools (workshop code from Harvey in chat if not already held this session; delayed-stdin harness), verify checkKey + 7/7 payloads byte-identical, commit `tools/`, merge branch → main, push.
- [ ] **Step 3:** Live verify: both tool loaders 200 with vault-payload, `hub-core.js` serving the new exports (size grew), tools-src 404.
- [ ] **Step 4:** Harvey click-through: real register with a family → family product appears in both tools, family workbook generates with per-drawing sheets, roll-up marks visible.
