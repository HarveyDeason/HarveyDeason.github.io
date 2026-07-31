# Comment Intake (Excel) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let site teams who cannot reach the company drive contribute comments, by generating a pre-scoped Excel intake sheet they fill in offline and emailing it back, then importing it through a review table.

**Architecture:** A new pure module `assets/js/hub-intake.js` holds template-model building, workbook parsing, validation, product resolution and duplicate detection — all node-testable with no DOM and no File System Access. `assets/js/xlsx-render.js` gains a `template` sheet kind for dropdowns and a hidden lists sheet. The UI in `tools-src/comments-hub.html` adds a Generate button in Settings and an Import + review table on the Dashboard.

**Tech Stack:** Vanilla ES modules, vendored ExcelJS (browser bundle), File System Access API, `node --test`.

**Spec:** `docs/superpowers/specs/2026-07-30-comment-intake-design.md`

## Verified platform facts (do not re-litigate)

Confirmed by running the **actual vendored bundle** at `assets/vendor/exceljs.min.js` (0.90 MB):

- `workbook.xlsx.load(buffer)` **exists** — the bundle reads, not just writes.
- `cell.dataValidation = { type:'list', allowBlank:true, formulae:['Lists!$A$1:$A$2'] }` works.
- A `veryHidden` worksheet survives a write→read round-trip and is still readable by name.
- Header text, row values, and the dropdown validation all survive the round-trip intact.

So the mechanism is proven. If something fails during implementation it is a bug in our code, not a missing capability.

## Global Constraints

- `npm test` runs `node --test`. Tests live in `tests/*.test.js` using `node:test` + `node:assert/strict`.
- `assets/js/hub-intake.js` must be **pure and node-testable**: no DOM, no File System Access, and ExcelJS **passed in as a parameter** (never imported) — this is the existing convention in `xlsx-render.js`, because the tools load ExcelJS as a global script.
- **`assets/js/xlsx-render.js` is shared with the Decision Register.** Adding a sheet kind must not change how `summary` or `log` sheets render.
- **The "Excel is never read back" principle still holds.** The importer parses only the *intake* file the hub itself authored. Generated logs (`Master Log.xlsx`, per-product files) are still never parsed. Do not add any code path that reads them.
- Generated filenames stay **stable and dateless** — Autodesk Construction Cloud versions by filename, and a changing name destroys version history. This applies to the template too.
- Person-field rule: `raisedBy` comes from the sheet and is never inferred; `closedBy` is untouched; `enteredBy` is stamped with the local user via `HubSync.stampEnteredBy`.
- `tools-src/` is **gitignored** — UI edits will not appear in `git status`. Commit UI tasks with `git commit --allow-empty`. Never run `node scripts/lock-tools.mjs`; publishing is the owner's step.
- No hardcoded colours in UI — `site.css`/`tool.css` tokens only, automatic dark/light mode.

## File Structure

| File | Responsibility |
|---|---|
| `assets/js/hub-intake.js` (new) | Template model, parsing, validation, product resolution, duplicate detection |
| `assets/js/xlsx-render.js` (modify) | New `template` sheet kind: dropdowns + hidden lists sheet |
| `tools-src/comments-hub.html` (modify) | Generate button, Import flow, review table, commit |
| `tests/hub-intake.test.js` (new) | Unit tests for all of `hub-intake.js` |

---

### Task 1: Template model (pure)

**Files:**
- Create: `assets/js/hub-intake.js`
- Test: `tests/hub-intake.test.js`

**Interfaces:**
- Produces:
  - `INTAKE_TEMPLATE_VERSION = 1`
  - `INTAKE_COLUMNS` — ordered array of `{ key, header, width }` for: Product, Affects P&ID, Affects Model, Affects Drawing Sheets, Category, Source, Date Raised, Raised By, Priority, Description.
  - `buildIntakeTemplateModel(state, productIds, nowIso) -> workbookModel`

`affectedTypes[]` is multi-valued and a single dropdown cannot express it, so it is **three separate Yes/No columns** recombined on import.

The model shape matches the existing `{ filename, sheets:[...] }` contract consumed by `renderWorkbook`. The template sheet uses the new `kind: 'template'` (Task 2) and carries a `validations` array plus a `lists` sheet holding the dropdown source ranges **and the product IDs**.

Matching on stable product IDs means fuzzy matching disappears entirely for a sheet returned unmodified.

- [ ] **Step 1: Write the failing test**

Create `tests/hub-intake.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INTAKE_TEMPLATE_VERSION, INTAKE_COLUMNS, buildIntakeTemplateModel,
} from '../assets/js/hub-intake.js';

const STATE = {
  products: [
    { id: 'p1', name: 'Pump House', type: 'OSB item', pidDrawings: ['D-100'] },
    { id: 'p2', name: 'Inlet Works', type: 'Standard product', pidDrawings: [] },
  ],
  lists: { categories: ['New valve', 'Pipework change'], sources: ['Site feedback'] },
  comments: [],
};

test('template columns split affectedTypes into three Yes/No columns', () => {
  const keys = INTAKE_COLUMNS.map(c => c.key);
  assert.deepEqual(keys, ['product', 'affPid', 'affModel', 'affSheets', 'category',
    'source', 'dateRaised', 'raisedBy', 'priority', 'description']);
});

test('filename is stable and dateless (ACC versions by filename)', () => {
  const m = buildIntakeTemplateModel(STATE, ['p1'], '2026-07-31T09:00:00.000Z');
  assert.equal(m.filename, 'Comment Intake Template.xlsx');
});

test('single product is pre-filled and its drawings are listed', () => {
  const m = buildIntakeTemplateModel(STATE, ['p1'], '2026-07-31T09:00:00.000Z');
  const sheet = m.sheets.find(s => s.name === 'Comments');
  assert.equal(sheet.prefill.product, 'Pump House');
  const lists = m.sheets.find(s => s.name === 'Lists');
  assert.ok(lists.rows.some(r => r.includes('D-100')), 'linked drawings shown to the site team');
});

test('several products restrict the dropdown to just those', () => {
  const m = buildIntakeTemplateModel(STATE, ['p1', 'p2'], '2026-07-31T09:00:00.000Z');
  const sheet = m.sheets.find(s => s.name === 'Comments');
  assert.equal(sheet.prefill.product, undefined);
  const productList = m.sheets.find(s => s.name === 'Lists').lists.products;
  assert.deepEqual(productList.map(p => p.name), ['Pump House', 'Inlet Works']);
});

test('lists sheet carries stable product IDs, not just names', () => {
  const m = buildIntakeTemplateModel(STATE, ['p1'], '2026-07-31T09:00:00.000Z');
  const products = m.sheets.find(s => s.name === 'Lists').lists.products;
  assert.deepEqual(products, [{ id: 'p1', name: 'Pump House' }]);
});

test('lists sheet stamps the template version so drift is detectable', () => {
  const m = buildIntakeTemplateModel(STATE, ['p1'], '2026-07-31T09:00:00.000Z');
  const lists = m.sheets.find(s => s.name === 'Lists');
  assert.equal(lists.meta.templateVersion, INTAKE_TEMPLATE_VERSION);
});

test('category and source dropdowns come from the hub lists', () => {
  const m = buildIntakeTemplateModel(STATE, ['p1'], '2026-07-31T09:00:00.000Z');
  const lists = m.sheets.find(s => s.name === 'Lists').lists;
  assert.deepEqual(lists.categories, ['New valve', 'Pipework change']);
  assert.deepEqual(lists.sources, ['Site feedback']);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `../assets/js/hub-intake.js`.

- [ ] **Step 3: Implement**

Create `assets/js/hub-intake.js` with a header comment explaining the module's purpose and the "separate intake file, never a generated log" principle. Export `INTAKE_TEMPLATE_VERSION`, `INTAKE_COLUMNS`, and `buildIntakeTemplateModel`.

`buildIntakeTemplateModel` returns:

```js
{
  filename: 'Comment Intake Template.xlsx',
  sheets: [
    { name: 'Comments', kind: 'template', columns: INTAKE_COLUMNS,
      prefill: { product: <name> } | {},        // only when exactly one product
      rowCount: 100,                            // pre-validated blank rows
      validations: [ /* {columnKey, listRef} */ ] },
    { name: 'Lists', kind: 'lists', hidden: true,
      meta: { templateVersion, generatedOn },
      lists: { products: [{id, name}], categories: [...], sources: [...],
               priorities: ['low','medium','high'], yesNo: ['Yes','No'] },
      rows: [ /* human-readable drawing reference lines */ ] },
  ],
}
```

- [ ] **Step 4: Run to verify pass** — `npm test`, expect PASS.

- [ ] **Step 5: Commit**

```bash
git add assets/js/hub-intake.js tests/hub-intake.test.js
git commit -m "feat(hub-intake): pre-scoped Excel intake template model"
```

---

### Task 2: `template` sheet kind in the shared renderer

**Files:**
- Modify: `assets/js/xlsx-render.js`
- Test: `tests/hub-intake.test.js`

**Interfaces:**
- Consumes: the model from Task 1.
- Produces: `renderWorkbook` handles `kind: 'template'` and `kind: 'lists'`.

`xlsx-render.js` is shared with the Decision Register — `summary` and `log` rendering must be untouched.

- [ ] **Step 1: Write the failing test**

A round-trip test, which the platform check proved is possible:

```js
import { renderWorkbook } from '../assets/js/xlsx-render.js';

async function loadExcelJS() {
  globalThis.window = globalThis; globalThis.self = globalThis;
  const m = await import('../assets/vendor/exceljs.min.js');
  return m.default || m.ExcelJS || globalThis.ExcelJS || m;
}

test('template sheet round-trips with dropdowns and a hidden lists sheet', async () => {
  const ExcelJS = await loadExcelJS();
  const model = buildIntakeTemplateModel(STATE, ['p1'], '2026-07-31T09:00:00.000Z');
  const buf = await renderWorkbook(model, ExcelJS, {});

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);

  const ws = wb.getWorksheet('Comments');
  const header = ws.getRow(1).values.slice(1);
  assert.deepEqual(header, INTAKE_COLUMNS.map(c => c.header));

  const lists = wb.getWorksheet('Lists');
  assert.ok(lists, 'lists sheet is present');
  assert.notEqual(lists.state, 'visible', 'lists sheet is hidden from the site team');

  // the category cell on the first data row carries a list validation
  const catIndex = INTAKE_COLUMNS.findIndex(c => c.key === 'category') + 1;
  const dv = ws.getCell(2, catIndex).dataValidation;
  assert.equal(dv && dv.type, 'list');
});

test('single-product template pre-fills the product column', async () => {
  const ExcelJS = await loadExcelJS();
  const model = buildIntakeTemplateModel(STATE, ['p1'], '2026-07-31T09:00:00.000Z');
  const buf = await renderWorkbook(model, ExcelJS, {});
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('Comments');
  assert.equal(ws.getCell(2, 1).value, 'Pump House');
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test`, expect FAIL (unknown sheet kind produces no `Comments` sheet or no validation).

- [ ] **Step 3: Implement**

Add `template` and `lists` branches to `renderWorkbook`. The `lists` sheet writes each list into its own column, sets `ws.state = 'veryHidden'`, and the `template` sheet points `dataValidation.formulae` at those ranges (`['Lists!$A$1:$A$N']`). Apply validation down `rowCount` rows so the site team can add rows without losing dropdowns.

Leave the `summary` and `log` branches byte-identical.

- [ ] **Step 4: Run to verify pass** — `npm test`.

- [ ] **Step 5: Commit**

```bash
git add assets/js/xlsx-render.js tests/hub-intake.test.js
git commit -m "feat(xlsx-render): template sheet kind with dropdowns and hidden lists"
```

---

### Task 3: Workbook parsing (pure)

**Files:**
- Modify: `assets/js/hub-intake.js`
- Test: `tests/hub-intake.test.js`

**Interfaces:**
- Produces:
  - `parseIntakeWorkbook(workbook) -> { templateVersion, products, rows }` where `workbook` is a **loaded ExcelJS workbook** (the caller does the file I/O).
  - Columns are matched by **header name, not position**, so a reordered or old template still imports.

- [ ] **Step 1: Write the failing test**

```js
test('parses rows by header NAME, tolerating reordered columns', async () => {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Comments');
  ws.addRow(['Description', 'Product', 'Category']);      // deliberately reordered, subset
  ws.addRow(['Valve leaking on line 3', 'Pump House', 'New valve']);
  const parsed = parseIntakeWorkbook(wb);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].description, 'Valve leaking on line 3');
  assert.equal(parsed.rows[0].product, 'Pump House');
});

test('skips entirely blank rows without comment', async () => {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Comments');
  ws.addRow(INTAKE_COLUMNS.map(c => c.header));
  ws.addRow([]);
  ws.addRow(['Pump House', 'Yes', 'No', 'No', 'New valve', 'Site feedback',
             '2026-07-20', 'Site foreman', 'high', 'Valve leaking']);
  ws.addRow([]);
  assert.equal(parseIntakeWorkbook(wb).rows.length, 1);
});

test('recombines the three Yes/No columns into affectedTypes', async () => {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Comments');
  ws.addRow(INTAKE_COLUMNS.map(c => c.header));
  ws.addRow(['Pump House', 'Yes', 'No', 'yes', 'New valve', 'Site feedback',
             '2026-07-20', 'Site foreman', 'high', 'Valve leaking']);
  assert.deepEqual(parseIntakeWorkbook(wb).rows[0].affectedTypes, ['P&ID', 'Drawing sheets']);
});

test('all three affected columns blank yields an empty array, not a failure', async () => {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Comments');
  ws.addRow(INTAKE_COLUMNS.map(c => c.header));
  ws.addRow(['Pump House', '', '', '', 'New valve', 'Site feedback',
             '2026-07-20', 'Site foreman', 'high', 'Valve leaking']);
  assert.deepEqual(parseIntakeWorkbook(wb).rows[0].affectedTypes, []);
});

test('reads the embedded product IDs and template version from the lists sheet', async () => {
  const ExcelJS = await loadExcelJS();
  const model = buildIntakeTemplateModel(STATE, ['p1'], '2026-07-31T09:00:00.000Z');
  const buf = await renderWorkbook(model, ExcelJS, {});
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const parsed = parseIntakeWorkbook(wb);
  assert.equal(parsed.templateVersion, INTAKE_TEMPLATE_VERSION);
  assert.deepEqual(parsed.products, [{ id: 'p1', name: 'Pump House' }]);
});

test('a sheet with no recognisable header row throws a clear error', async () => {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Comments').addRow(['random', 'nonsense']);
  assert.throws(() => parseIntakeWorkbook(wb), /header/i);
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test`.

- [ ] **Step 3: Implement**

Locate the data sheet by name (`Comments`), falling back to the first visible sheet. Find the header row by scanning the first few rows for a row matching two or more known headers (a site team may add a title row above). Map header text → column index case-insensitively and trimmed. Recombine `affPid`/`affModel`/`affSheets` (accept `Yes`/`Y`/`TRUE`/`x`, case-insensitive) into `affectedTypes`. Read the lists sheet if present for `templateVersion` and `products`.

- [ ] **Step 4: Run to verify pass** — `npm test`.

- [ ] **Step 5: Commit**

```bash
git add assets/js/hub-intake.js tests/hub-intake.test.js
git commit -m "feat(hub-intake): parse intake workbooks by header name"
```

---

### Task 4: Validation, product resolution, duplicate detection (pure)

**Files:**
- Modify: `assets/js/hub-intake.js`
- Test: `tests/hub-intake.test.js`

**Interfaces:**
- Produces: `reviewRows(parsed, state, todayIso) -> row[]` where each row is
  `{ raw, values, productId, status: 'ok'|'warn'|'error', issues: [{field, level, message, fix?}], duplicateOf: ref|null }`.

Rules: missing description is a **hard error** (cannot be accepted); missing date defaults to today; missing priority defaults to `medium`; unknown category/source is a warning offering "add to list"; product resolved by embedded ID first, then exact name, then fuzzy.

- [ ] **Step 1: Write the failing test**

```js
const parsedRow = (over = {}) => ({
  product: 'Pump House', affectedTypes: ['P&ID'], category: 'New valve',
  source: 'Site feedback', dateRaised: '2026-07-20', raisedBy: 'Site foreman',
  priority: 'high', description: 'Valve leaking on line 3', ...over,
});

test('resolves the product by embedded ID without any name matching', () => {
  const parsed = { products: [{ id: 'p1', name: 'Renamed Since' }], rows: [parsedRow({ product: 'Renamed Since' })] };
  const rows = reviewRows(parsed, STATE, '2026-07-31');
  assert.equal(rows[0].productId, 'p1');
  assert.equal(rows[0].status, 'ok');
});

test('missing description is a hard error that cannot be accepted', () => {
  const parsed = { products: [], rows: [parsedRow({ description: '   ' })] };
  const rows = reviewRows(parsed, STATE, '2026-07-31');
  assert.equal(rows[0].status, 'error');
  assert.ok(rows[0].issues.some(i => i.field === 'description' && i.level === 'error'));
});

test('missing date defaults to today and missing priority to medium', () => {
  const parsed = { products: [], rows: [parsedRow({ dateRaised: '', priority: '' })] };
  const rows = reviewRows(parsed, STATE, '2026-07-31');
  assert.equal(rows[0].values.dateRaised, '2026-07-31');
  assert.equal(rows[0].values.priority, 'medium');
});

test('an unknown category warns and offers to add it, never blocks', () => {
  const parsed = { products: [], rows: [parsedRow({ category: 'Coating defect' })] };
  const rows = reviewRows(parsed, STATE, '2026-07-31');
  const issue = rows[0].issues.find(i => i.field === 'category');
  assert.equal(issue.level, 'warn');
  assert.equal(issue.fix, 'add-to-list');
  assert.notEqual(rows[0].status, 'error');
});

test('an unresolvable product warns rather than erroring', () => {
  const parsed = { products: [], rows: [parsedRow({ product: 'Nowhere Works' })] };
  const rows = reviewRows(parsed, STATE, '2026-07-31');
  assert.equal(rows[0].productId, null);
  assert.equal(rows[0].status, 'warn');
});

// Advisory only: "Replace valve V-101" and "Replace valve V-102" are one
// character apart and completely different comments.
test('a near-identical open comment on the same product is flagged, not blocked', () => {
  const state = { ...STATE, comments: [
    { id: 'c1', ref: 'HUB-0007', productIds: ['p1'], status: 'open',
      description: 'Valve leaking on line 3.' }] };
  const parsed = { products: [{ id: 'p1', name: 'Pump House' }], rows: [parsedRow()] };
  const rows = reviewRows(parsed, state, '2026-07-31');
  assert.equal(rows[0].duplicateOf, 'HUB-0007');
  assert.notEqual(rows[0].status, 'error', 'duplicates are advisory');
});

test('a similar CLOSED comment is not flagged as a duplicate', () => {
  const state = { ...STATE, comments: [
    { id: 'c1', ref: 'HUB-0007', productIds: ['p1'], status: 'closed',
      description: 'Valve leaking on line 3.' }] };
  const parsed = { products: [{ id: 'p1', name: 'Pump House' }], rows: [parsedRow()] };
  assert.equal(reviewRows(parsed, state, '2026-07-31')[0].duplicateOf, null);
});

test('similar text on a DIFFERENT product is not a duplicate', () => {
  const state = { ...STATE, comments: [
    { id: 'c1', ref: 'HUB-0007', productIds: ['p2'], status: 'open',
      description: 'Valve leaking on line 3.' }] };
  const parsed = { products: [{ id: 'p1', name: 'Pump House' }], rows: [parsedRow()] };
  assert.equal(reviewRows(parsed, state, '2026-07-31')[0].duplicateOf, null);
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test`.

- [ ] **Step 3: Implement**

Add `normaliseText(s)` (case-folded, punctuation-stripped, whitespace-collapsed) and a similarity measure over it; flag above a fixed threshold held in a named constant. Precision is not critical — it only drives a non-blocking warning — but record that reasoning in a comment so nobody later "improves" it into a blocker.

- [ ] **Step 4: Run to verify pass** — `npm test`.

- [ ] **Step 5: Commit**

```bash
git add assets/js/hub-intake.js tests/hub-intake.test.js
git commit -m "feat(hub-intake): row validation, product resolution, duplicate warnings"
```

---

### Task 5: UI — generate the template

**Files:**
- Modify: `tools-src/comments-hub.html`

- [ ] **Step 1: Add a Settings control**

Add a "Comment intake" panel to `<section id="tab-settings">` with a product multi-select (reuse the New Comment tab's product picker pattern) and a **Generate intake template** button.

- [ ] **Step 2: Wire generation**

On click: `HubIntake.buildIntakeTemplateModel(state, selectedIds, nowIso())` → `renderWorkbook(model, ExcelJS, HubCore.EXCEL_COLORS)` → write into the hub folder root via the existing `writeFile` binding, then toast the filename. Import the module as `import * as HubIntake from '/assets/js/hub-intake.js';`.

Disable the button with an explanatory hint when no products are selected — generating an unscoped template defeats the point.

- [ ] **Step 3: Verify and commit**

Generate a template, open it in Excel, confirm the dropdowns work and the Lists sheet is hidden.

```bash
git commit --allow-empty -m "feat(hub-ui): generate pre-scoped Excel intake template"
```

---

### Task 6: UI — import and review table

**Files:**
- Modify: `tools-src/comments-hub.html`

- [ ] **Step 1: Add the Import control**

An **Import comments** button on the Dashboard opens a file picker (`showOpenFilePicker`, `.xlsx`, `multiple: true`). No inbox, no watched folder — this is deliberate.

- [ ] **Step 2: Parse and show the review table**

For each file: read as ArrayBuffer → `new ExcelJS.Workbook()` → `wb.xlsx.load(buf)` → `HubIntake.parseIntakeWorkbook(wb)` → `HubIntake.reviewRows(parsed, state, todayIso())`.

Render a table with every field inline-editable, an Accept/Reject toggle per row, Accept all / Reject all, and per-row issue chips. Rows with a hard error cannot be accepted — make that visibly obvious rather than silently ignoring the toggle. Show a duplicate warning as a chip linking to the existing ref.

An unparseable file shows a clear error naming that file and **does not** prevent the other selected files importing.

Show a non-blocking notice if `templateVersion` differs from `INTAKE_TEMPLATE_VERSION`.

- [ ] **Step 3: Verify and commit**

```bash
git commit --allow-empty -m "feat(hub-ui): intake import with per-row review table"
```

---

### Task 7: UI — commit accepted rows

**Files:**
- Modify: `tools-src/comments-hub.html`

- [ ] **Step 1: Wire the commit**

Accepted rows go through the **normal comment creation path** — no side door. For each: `HubCore.nextRef(state)` for the ref, `HubSync.stampEnteredBy(comment, getUserName())`, plus `importedFrom: { file, at }` for traceability. `raisedBy` comes from the sheet and is never inferred.

Apply any "add to list" fixes the user accepted to `state.lists` first, so the imported comments reference real list values.

Then one `queueSave(touchedProductIds)` for the whole batch — not one per row, which would trigger a save cycle and full Excel regeneration per comment.

**Import is atomic per commit:** either every accepted row lands or none does. If nothing is accepted, no write occurs at all.

- [ ] **Step 2: Confirm ref sequencing**

`resequenceRefs` sorts by `dateRaised` then `id`, so a bulk import of older-dated site comments interleaves into the ref sequence rather than appending at the end. Verify this is what happens with a mixed-date import and note it in the report — it is correct behaviour, not a bug, but it surprises people.

- [ ] **Step 3: Verify and commit**

```bash
git commit --allow-empty -m "feat(hub-ui): commit accepted intake rows through the normal path"
```

---

### Task 8: Full verification

- [ ] **Step 1: Run the suite** — `npm test`, all green.

- [ ] **Step 2: Round-trip by hand**

Generate a single-product template → fill it in as a site team would, including one row with no description, one with an unknown category, and one duplicating an existing open comment → import it → confirm the review table flags exactly those three → fix them inline → accept → confirm the comments appear with correct refs, `enteredBy` set, `raisedBy` as typed, and the per-product Excel regenerated once.

- [ ] **Step 3: Regression checks**

- The Decision Register still exports decisions correctly (shared `xlsx-render.js`).
- `Master Log.xlsx` and per-product logs are unchanged in layout and **filename**.
- No code path reads a generated log.

- [ ] **Step 4: Publish** *(owner runs this — it prompts for the workshop code)*

```bash
node scripts/lock-tools.mjs
git add tools/ && git commit -m "build: republish tools with Excel comment intake"
git push
```
