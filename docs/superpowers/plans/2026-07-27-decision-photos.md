# Photos on Decisions + Decisions Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attach photos to Product Brain decisions the way comments already work, and add an on-demand Excel export of the decisions currently on screen.

**Architecture:** Decision photos hang off the decision record as `decision.photos[]`, reusing the photo record shape and `HubCore.photoFileName` from the comments feature. Files go flat into `Photos/decisions/` because decisions have no ref to name a folder with. The Hub's workbook renderer moves to a shared module so the Brain can build its export without a second copy.

**Tech Stack:** Vanilla ES modules, node:test, File System Access API, canvas/`createImageBitmap`, ExcelJS (vendored at `assets/vendor/exceljs.min.js`).

## Global Constraints

- `tools-src/*.html` is **gitignored**. Tasks that only touch it produce **no commit** — the deliverable is the file on disk plus a diff and a report. Only `assets/`, `tests/` and `docs/` changes get committed.
- Never write to `tools/` by hand. Locked loaders are regenerated only by `scripts/lock-tools.mjs` at the endgame, with the workshop code supplied by Harvey. The code is **not on disk**.
- No external network requests — everything vendored under `assets/`.
- No hardcoded colours in tool CSS; use the file's existing custom properties. The one approved exception is the existing `.pv-bar` white text on the dimmed photo backdrop.
- All user-supplied text reaching the DOM goes through `escHtml` / `escAttr`.
- Never prefill a person's name (`addedBy` stays `''`), matching `madeBy` / `recordedBy`.
- Stored images are always re-encoded to JPEG: main copy longest edge ≤ 2000px at quality 0.82, thumbnail longest edge ≤ 320px at quality 0.7.
- Removing a photo unlinks it only — files are never deleted from disk.
- The Product Brain **never writes `hub-data.json`**. It owns `brain-data.json`, `Documents/`, and its own decision photos.
- The decisions export is **downloaded**, never written into the shared folder, and nothing about it runs on save.
- Run the whole suite with `npm test` (116 tests green before this plan starts).

---

### Task 1: decision photo state + names in brain-core

**Files:**
- Modify: `assets/js/brain-core.js`
- Test: `tests/brain-core.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces, used by Tasks 3–5:
  - `addPhotoToDecision(state, decisionId, photo, nowIso) -> state`
  - `removePhotoFromDecision(state, decisionId, photoId, nowIso) -> state`
  - `decisionPhotoNames(state) -> string[]` — every filename already used by any decision, for cross-decision collision checks.
  - A photo record is `{ id, file, thumb, caption, addedAt, addedBy }`, identical to comments.

- [ ] **Step 1: Write the failing tests**

Add to the end of `tests/brain-core.test.js`, importing the three new names from `../assets/js/brain-core.js` alongside the existing imports. Use the file's existing decision factory if it has one; otherwise this local one:

```js
const D = (id, updatedAt, extra = {}) => ({
  id, title: 'A decision', decision: 'We did X', reasoning: 'because', productIds: ['p1'],
  tags: [], projectTag: '', date: '2026-07-27', madeBy: 'A N Other', recordedBy: '',
  status: 'active', supersededBy: '', supersedes: '', links: {}, updatedAt, ...extra,
});
const PH = (id, file, caption = '') =>
  ({ id, file, thumb: file, caption, addedAt: '2026-07-27T09:00:00Z', addedBy: '' });

test('addPhotoToDecision appends and bumps updatedAt', () => {
  const s0 = { ...emptyBrainState('t'), decisions: [D('d1', '2026-07-27T08:00:00Z')] };
  const s1 = addPhotoToDecision(s0, 'd1', PH('p1', 'access.jpg', 'access'), '2026-07-27T09:00:00Z');
  assert.equal(s1.decisions[0].photos.length, 1);
  assert.equal(s1.decisions[0].photos[0].file, 'access.jpg');
  assert.equal(s1.decisions[0].updatedAt, '2026-07-27T09:00:00Z');
  assert.equal(s0.decisions[0].photos, undefined);          // input untouched
});

test('addPhotoToDecision on an unknown id is a no-op', () => {
  const s0 = { ...emptyBrainState('t'), decisions: [D('d1', '2026-07-27T08:00:00Z')] };
  assert.deepEqual(addPhotoToDecision(s0, 'nope', PH('p1', 'a.jpg'), 'x'), s0);
});

test('removePhotoFromDecision drops one entry and bumps updatedAt', () => {
  const s0 = { ...emptyBrainState('t'), decisions: [
    D('d1', '2026-07-27T08:00:00Z', { photos: [PH('p1', 'a.jpg'), PH('p2', 'b.jpg')] })] };
  const s1 = removePhotoFromDecision(s0, 'd1', 'p1', '2026-07-27T10:00:00Z');
  assert.deepEqual(s1.decisions[0].photos.map(p => p.id), ['p2']);
  assert.equal(s1.decisions[0].updatedAt, '2026-07-27T10:00:00Z');
});

test('removePhotoFromDecision on an unknown photo id is a no-op', () => {
  const s0 = { ...emptyBrainState('t'), decisions: [
    D('d1', '2026-07-27T08:00:00Z', { photos: [PH('p1', 'a.jpg')] })] };
  assert.deepEqual(removePhotoFromDecision(s0, 'd1', 'nope', 'x'), s0);
});

test('decisionPhotoNames collects every filename across decisions', () => {
  const s = { ...emptyBrainState('t'), decisions: [
    D('d1', 't', { photos: [PH('p1', 'access.jpg'), PH('p2', 'valve.jpg')] }),
    D('d2', 't', { photos: [PH('p3', 'access (2).jpg')] }),
    D('d3', 't'),
  ] };
  assert.deepEqual(decisionPhotoNames(s).sort(), ['access (2).jpg', 'access.jpg', 'valve.jpg']);
});

test('decisionPhotoNames is empty when nothing has photos', () => {
  assert.deepEqual(decisionPhotoNames({ ...emptyBrainState('t'), decisions: [D('d1', 't')] }), []);
});
```

If `emptyBrainState` is not the name the test file already uses for a blank state, use whatever it uses — do not add a new helper.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL — the new names are not exported.

- [ ] **Step 3: Write the implementation**

Append to `assets/js/brain-core.js`:

```js
// Photos hang off the decision record so they ride the existing merge and save
// queue. Removing one unlinks it; the files stay in the folder.
export function addPhotoToDecision(state, decisionId, photo, nowIso) {
  if (!state.decisions.some(d => d.id === decisionId)) return state;
  return { ...state, decisions: state.decisions.map(d => d.id === decisionId
    ? { ...d, photos: [...(d.photos || []), photo], updatedAt: nowIso } : d) };
}

export function removePhotoFromDecision(state, decisionId, photoId, nowIso) {
  const d = state.decisions.find(x => x.id === decisionId);
  if (!d || !(d.photos || []).some(p => p.id === photoId)) return state;
  return { ...state, decisions: state.decisions.map(x => x.id === decisionId
    ? { ...x, photos: x.photos.filter(p => p.id !== photoId), updatedAt: nowIso } : x) };
}

// Decision photos share one flat folder (decisions have no ref to name a folder
// with), so collision checks span every decision, not just the current one.
export function decisionPhotoNames(state) {
  const out = [];
  for (const d of (state && state.decisions) || []) {
    for (const p of d.photos || []) out.push(p.file);
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test 2>&1 | tail -12`
Expected: PASS — `# pass 122`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add assets/js/brain-core.js tests/brain-core.test.js
git commit -m "feat: carry decision photos through brain state"
```

---

### Task 2: decisions workbook model in brain-core

**Files:**
- Modify: `assets/js/brain-core.js`
- Test: `tests/brain-core.test.js`

**Interfaces:**
- Consumes: `decisionPhotoNames` is not needed here; the photos cell is computed from each decision's own array.
- Produces, used by Task 6:
  - `DECISION_COLUMNS` — array of `{ key, header, width }`.
  - `buildDecisionsWorkbookModel(state, decisions, nowIso) -> model` — the same model shape the Hub's renderer consumes: `{ filename, sheets: [{ name, kind, columns, rows: [{ cells, statusKey }] }] }`.

- [ ] **Step 1: Write the failing tests**

```js
test('DECISION_COLUMNS covers the record and ends with Photos', () => {
  assert.deepEqual(DECISION_COLUMNS.map(c => c.key), [
    'date', 'title', 'decision', 'reasoning', 'products', 'projectTag', 'tags',
    'madeBy', 'recordedBy', 'status', 'supersedes', 'photos',
  ]);
  assert.deepEqual(DECISION_COLUMNS[DECISION_COLUMNS.length - 1], { key: 'photos', header: 'Photos', width: 30 });
});

test('buildDecisionsWorkbookModel renders one row per decision, newest first', () => {
  const state = { ...emptyBrainState('t'), decisions: [
    D('d1', 't', { date: '2026-07-01', title: 'Older' }),
    D('d2', 't', { date: '2026-07-20', title: 'Newer' }),
  ] };
  const m = buildDecisionsWorkbookModel(state, state.decisions, '2026-07-27');
  assert.equal(m.filename, 'Decisions Export 2026-07-27.xlsx');
  assert.equal(m.sheets.length, 1);
  assert.equal(m.sheets[0].kind, 'log');
  assert.deepEqual(m.sheets[0].rows.map(r => r.cells.title), ['Newer', 'Older']);
});

test('buildDecisionsWorkbookModel fills the cells from the record', () => {
  const state = { ...emptyBrainState('t'),
    decisions: [D('d1', 't', { tags: ['hazop', 'access'], projectTag: 'AMP8',
      photos: [PH('p1', 'access.jpg'), PH('p2', 'valve.jpg')] })] };
  const cells = buildDecisionsWorkbookModel(state, state.decisions, '2026-07-27').sheets[0].rows[0].cells;
  assert.equal(cells.title, 'A decision');
  assert.equal(cells.decision, 'We did X');
  assert.equal(cells.tags, 'hazop, access');
  assert.equal(cells.projectTag, 'AMP8');
  assert.equal(cells.madeBy, 'A N Other');
  assert.equal(cells.status, 'Active');
  assert.equal(cells.photos, '2 photos: access.jpg, valve.jpg');
});

test('buildDecisionsWorkbookModel keeps superseded decisions and names the successor', () => {
  const state = { ...emptyBrainState('t'), decisions: [
    D('old', 't', { title: 'Old way', status: 'superseded', supersededBy: 'new', date: '2026-07-01' }),
    D('new', 't', { title: 'New way', supersedes: 'old', date: '2026-07-02' }),
  ] };
  const rows = buildDecisionsWorkbookModel(state, state.decisions, '2026-07-27').sheets[0].rows;
  assert.equal(rows.length, 2);
  const oldRow = rows.find(r => r.cells.title === 'Old way');
  assert.equal(oldRow.cells.status, 'Superseded');
  assert.equal(oldRow.statusKey, 'superseded');
  assert.equal(rows.find(r => r.cells.title === 'New way').cells.supersedes, 'Old way');
});

test('buildDecisionsWorkbookModel names products, falling back to the id', () => {
  const state = { ...emptyBrainState('t'), decisions: [D('d1', 't', { productIds: ['p1', 'ghost'] })] };
  const cells = buildDecisionsWorkbookModel(state, state.decisions,
    '2026-07-27', new Map([['p1', 'Sampler Kiosk']])).sheets[0].rows[0].cells;
  assert.equal(cells.products, 'Sampler Kiosk, ghost');
});

test('buildDecisionsWorkbookModel with no decisions still produces a sheet', () => {
  const m = buildDecisionsWorkbookModel(emptyBrainState('t'), [], '2026-07-27');
  assert.deepEqual(m.sheets[0].rows, []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL — `DECISION_COLUMNS` / `buildDecisionsWorkbookModel` are not exported.

- [ ] **Step 3: Write the implementation**

Append to `assets/js/brain-core.js`:

```js
export const DECISION_COLUMNS = [
  { key: 'date', header: 'Date', width: 12 },
  { key: 'title', header: 'Decision', width: 34 },
  { key: 'decision', header: 'What was decided', width: 60 },
  { key: 'reasoning', header: 'Why', width: 60 },
  { key: 'products', header: 'Product(s)', width: 28 },
  { key: 'projectTag', header: 'Project', width: 16 },
  { key: 'tags', header: 'Tags', width: 22 },
  { key: 'madeBy', header: 'Made by', width: 16 },
  { key: 'recordedBy', header: 'Recorded by', width: 16 },
  { key: 'status', header: 'Status', width: 12 },
  { key: 'supersedes', header: 'Supersedes', width: 28 },
  { key: 'photos', header: 'Photos', width: 30 },
];

// Products live in the Comments Hub's data, which brain-core does not read, so
// the caller passes the id→name map it already has. Unknown ids fall back to
// the id rather than vanishing from the export.
export function buildDecisionsWorkbookModel(state, decisions, nowIso, productNames) {
  const names = productNames || new Map();
  const titleOf = id => {
    const d = (state.decisions || []).find(x => x.id === id);
    return d ? (d.title || id) : id;
  };
  const rows = [...(decisions || [])]
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))
      || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .map(d => ({
      cells: {
        date: d.date || '',
        title: d.title || '',
        decision: d.decision || '',
        reasoning: d.reasoning || '',
        products: (d.productIds || []).map(id => names.get(id) || id).join(', '),
        projectTag: d.projectTag || '',
        tags: (d.tags || []).join(', '),
        madeBy: d.madeBy || '',
        recordedBy: d.recordedBy || '',
        status: (d.status === 'superseded') ? 'Superseded' : 'Active',
        supersedes: d.supersedes ? titleOf(d.supersedes) : '',
        photos: photosCell(d),      // same wording as the Comments Hub column
      },
      statusKey: d.status || 'active',
    }));
  return {
    filename: `Decisions Export ${nowIso}.xlsx`,
    sheets: [{ name: 'Decisions', kind: 'log', columns: DECISION_COLUMNS, rows }],
  };
}
```

`photosCell` already exists in `hub-core.js` and works on any record with a
`photos` array — do **not** write a second copy. `brain-core.js` already imports
from `hub-core.js` at the top of the file; extend that existing import:

```js
import { sanitizeFilename, photosCell } from './hub-core.js';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test 2>&1 | tail -12`
Expected: PASS — `# pass 128`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add assets/js/brain-core.js tests/brain-core.test.js
git commit -m "feat: build a decisions workbook model"
```

---

### Task 3: shared workbook renderer

**Files:**
- Create: `assets/js/xlsx-render.js`
- Modify: `tools-src/comments-hub.html` (replace the inline `applyModel`, ~line 1899) — **gitignored, no commit for that half**

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces, used by Task 6 and by the Hub: `renderWorkbook(model, ExcelJS, colors) -> Promise<ArrayBuffer>` — takes the workbook model, the ExcelJS global, and the colour map (`{ headerFill, headerText, zebra, open, inProgress, closed, high }`), returns the xlsx buffer.

The move must be behaviour-preserving. `applyModel` currently lives inside the Hub tool file and closes over the `ExcelJS` global and `HubCore.EXCEL_COLORS`; the extracted version takes both as arguments and is otherwise character-for-character the same logic: summary sheets get two columns and a bold title; log sheets get an optional merged heading row, a filled header band, frozen pane, autofilter, zebra striping on odd rows, and status/priority fills driven by `row.statusKey` / `row.high`.

- [ ] **Step 1: Create the module**

Create `assets/js/xlsx-render.js` containing exactly the body of the Hub's current `applyModel`, with `ExcelJS` and `colors` as parameters instead of globals:

```js
// assets/js/xlsx-render.js
// Turns a workbook model ({filename, sheets:[{name, kind, columns, rows}]})
// into an xlsx buffer. Shared by the Comments Hub (comment logs) and the
// Product Brain (decisions export) so the two never drift apart.
// ExcelJS is passed in rather than imported: both tools load the vendored
// browser bundle as a global script.

export async function renderWorkbook(model, ExcelJS, colors) {
  const wb = new ExcelJS.Workbook();
  for (const sheet of model.sheets) {
    const ws = wb.addWorksheet(sheet.name);
    if (sheet.kind === 'summary') {
      ws.columns = [{ width: 24 }, { width: 70 }];
      const t = ws.addRow([sheet.meta.title]);
      t.font = { bold: true, size: 14, color: { argb: colors.headerFill } };
      ws.addRow([]);
      for (const [label, value] of sheet.rows) {
        const r = ws.addRow([label, value]);
        r.getCell(1).font = { bold: true };
        r.alignment = { vertical: 'top', wrapText: true };
      }
    } else {
      ws.columns = sheet.columns.map(c => ({ key: c.key, width: c.width }));
      // Optional per-sheet heading: a bold title row spanning the columns,
      // above the header band. Freeze/autofilter then shift down one row.
      let headerRow = 1;
      if (sheet.heading) {
        const hr = ws.addRow([sheet.heading]);
        ws.mergeCells(1, 1, 1, sheet.columns.length);
        hr.getCell(1).font = { bold: true, size: 13, color: { argb: colors.headerFill } };
        hr.getCell(1).alignment = { vertical: 'middle' };
        headerRow = 2;
      }
      const head = ws.addRow(sheet.columns.map(c => c.header));
      head.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.headerFill } };
        cell.font = { bold: true, color: { argb: colors.headerText } };
      });
      ws.views = [{ state: 'frozen', ySplit: headerRow }];
      ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: sheet.columns.length } };
      sheet.rows.forEach((row, i) => {
        const r = ws.addRow(sheet.columns.map(c => row.cells[c.key] ?? ''));
        r.alignment = { vertical: 'top', wrapText: true };
        if (i % 2 === 1) r.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.zebra } };
        });
        const statusCol = sheet.columns.findIndex(c => c.key === 'status') + 1;
        const statusColor = { open: colors.open, in_progress: colors.inProgress, closed: colors.closed }[row.statusKey];
        if (statusCol && statusColor) r.getCell(statusCol).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: statusColor } };
        const prioCol = sheet.columns.findIndex(c => c.key === 'priority') + 1;
        if (prioCol && row.high) r.getCell(prioCol).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.high } };
      });
    }
  }
  return wb.xlsx.writeBuffer();
}
```

- [ ] **Step 2: Point the Hub at it**

In `tools-src/comments-hub.html`, add to the existing import block at the top of the module script:

```js
  import { renderWorkbook } from '/assets/js/xlsx-render.js';
```

Delete the whole inline `async function applyModel(model) { … }` and replace it with:

```js
  // Kept as a named wrapper: window.applyModel is part of this file's contract
  // with the browser verification harness.
  const applyModel = model => renderWorkbook(model, ExcelJS, HubCore.EXCEL_COLORS);
```

- [ ] **Step 3: Verify the Hub still writes an identical workbook**

Start the preview server (`preview_start` with the `site` config, port 5050) and open `http://localhost:5050/tools-src/comments-hub.html` **by navigating** — not by `document.write`, which leaves the previous module instance alive and painting ghost rows into the new page.

Install a fake-handle harness (an object with `getFileHandle(name, {create})`, `getDirectoryHandle(name, {create})`, `values()` async iterator and `createWritable()` backed by a plain `{path: contents}` object) as `window.dirHandle`, with `window.showDirectoryPicker` returning it. Seed `hub-data.json` with two products and four comments, one carrying a `photos` array. Connect, then re-parse the written workbook:

```js
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(window.__fs['Master Log.xlsx']);      // Uint8Array from the harness
const ws = wb.getWorksheet('Comment Log');
```

Expected, reported with actual values: the header row contains `Photos`; `ws.views[0].state === 'frozen'`; `ws.autoFilter` is set; the header cells carry the green fill (`ws.getRow(1).getCell(1).fill.fgColor.argb`); a comment with photos shows `1 photo: …` in the Photos column. Zero console errors.

- [ ] **Step 4: Commit the module only**

```bash
git add assets/js/xlsx-render.js
git commit -m "refactor: share the workbook renderer between both tools"
```

The Hub tool file is gitignored — record its change in the report instead, and write the diff with:

```
diff -u "$SNAPSHOT" tools-src/comments-hub.html > .superpowers/sdd/dphotos-task-3.diff
```

---

### Task 4: photo pipeline for decisions in the Brain

**Files:**
- Modify: `tools-src/product-brain.html` (**gitignored, no commit**; diff + report to `.superpowers/sdd/`)

**Interfaces:**
- Consumes: `HubCore.photoFileName(caption, originalName, existingNames)` — the Brain already imports `HubCore`; `BrainCore.decisionPhotoNames(state)` (Task 1); `engine.writeFile(dir, name, contents)` from `hub-sync.js`, which always aborts a failed writable and stamps `e.hubFile`.
- Produces, used by Tasks 5–6:
  - `encodePhoto(file, maxEdge, quality) -> Promise<Blob>`
  - `saveDecisionPhoto(file, caption) -> Promise<photoRecord>` — writes both files under `Photos/decisions/`, names them from the caption, dedupes against every existing decision photo.
  - `decisionPhotoThumbUrl(photo)` / `decisionPhotoFullUrl(photo)` — object URLs read back from disk.
  - `clearDecisionPhotoUrlCache()`

- [ ] **Step 1: Add the pipeline**

Insert next to the Brain's other folder helpers (after `findRegisterJson`, before `disconnectFolder`):

```js
  // ── Decision photos ───────────────────────────────────────────────────────
  // Same pipeline as the Comments Hub: phone photos are 5–12MB and a shared
  // OneDrive folder should not carry that, so everything is re-encoded to JPEG.
  // Decisions have no ref to name a folder with, so they share one flat folder
  // and dedupe across every decision.
  const PHOTO_MAX_EDGE = 2000, PHOTO_QUALITY = 0.82;
  const THUMB_MAX_EDGE = 320,  THUMB_QUALITY = 0.7;

  // createImageBitmap applies EXIF orientation, so portrait phone photos are not
  // stored sideways. Throws for anything that is not a decodable image.
  async function encodePhoto(file, maxEdge, quality) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
    if (!blob) throw new Error('Could not encode the image.');
    return blob;
  }

  // <root>/Photos/decisions/ and its thumbs/. Created on demand.
  async function decisionPhotoDirs() {
    const photosRoot = await dirHandle.getDirectoryHandle('Photos', { create: true });
    const decDir = await photosRoot.getDirectoryHandle('decisions', { create: true });
    const thumbDir = await decDir.getDirectoryHandle('thumbs', { create: true });
    return { decDir, thumbDir };
  }

  async function saveDecisionPhoto(file, caption) {
    const name = HubCore.photoFileName(caption, file.name, BrainCore.decisionPhotoNames(state));
    const [full, thumb] = await Promise.all([
      encodePhoto(file, PHOTO_MAX_EDGE, PHOTO_QUALITY),
      encodePhoto(file, THUMB_MAX_EDGE, THUMB_QUALITY),
    ]);
    const { decDir, thumbDir } = await decisionPhotoDirs();
    await engine.writeFile(decDir, name, full);
    await engine.writeFile(thumbDir, name, thumb);
    return { id: genId(), file: name, thumb: name, caption: String(caption || '').trim(),
      addedAt: nowIso(), addedBy: '' };
  }

  // Object URLs are cached per filename so a repaint does not re-read the disk.
  const decPhotoUrlCache = new Map();
  function clearDecisionPhotoUrlCache() {
    for (const url of decPhotoUrlCache.values()) URL.revokeObjectURL(url);
    decPhotoUrlCache.clear();
  }
  async function decisionPhotoUrl(name, thumbs) {
    const key = (thumbs ? 't:' : 'f:') + name;
    if (decPhotoUrlCache.has(key)) return decPhotoUrlCache.get(key);
    const { decDir, thumbDir } = await decisionPhotoDirs();
    const fh = await (thumbs ? thumbDir : decDir).getFileHandle(name, { create: false });
    const url = URL.createObjectURL(await fh.getFile());
    decPhotoUrlCache.set(key, url);
    return url;
  }
  const decisionPhotoThumbUrl = photo => decisionPhotoUrl(photo.thumb, true);
  const decisionPhotoFullUrl  = photo => decisionPhotoUrl(photo.file, false);
```

- [ ] **Step 2: Export on `window`**

Add to the existing `Object.assign(window, { … })` block, after the `connectFolder, setupConnectedFolder, …` line:

```js
    encodePhoto, saveDecisionPhoto, decisionPhotoThumbUrl, decisionPhotoFullUrl, clearDecisionPhotoUrlCache,
```

- [ ] **Step 3: Verify in the browser**

Navigate (do not `document.write`) to `http://localhost:5050/tools-src/product-brain.html`, install the fake-handle harness as in Task 3, seed `hub-data.json` and `brain-data.json`, and connect. Then:

```js
const c = document.createElement('canvas'); c.width = 1200; c.height = 800;
const cx = c.getContext('2d'); cx.fillStyle = '#c00'; cx.fillRect(0, 0, 1200, 800);
const blob = await new Promise(r => c.toBlob(r, 'image/png'));
const rec = await window.saveDecisionPhoto(new File([blob], 'IMG_9.PNG', { type: 'image/png' }), 'sample point access');
```

Expected, reported with actual values: `rec.file === 'sample point access.jpg'`; the harness holds `Photos/decisions/sample point access.jpg` and `Photos/decisions/thumbs/sample point access.jpg`; the thumbnail is smaller than the full copy; `rec.addedBy === ''`. Then put that record on a decision via `BrainCore.addPhotoToDecision`, and confirm a second `saveDecisionPhoto` with the same caption returns `sample point access (2).jpg` — proving dedupe reads across decisions. Finally confirm `encodePhoto` rejects for a `.txt` File.

- [ ] **Step 4: Diff and report**

```
diff -u "$SNAPSHOT" tools-src/product-brain.html > .superpowers/sdd/dphotos-task-4.diff
```

Write `.superpowers/sdd/dphotos-task-4-report.md` with the observed values. No commit.

---

### Task 5: photo UI on the decision form and view

**Files:**
- Modify: `tools-src/product-brain.html` — CSS block, `decisionFormCard()`, `decisionViewCard()` (~line 1484), `saveDecisionForm()` (~line 1267) (**gitignored, no commit**)

**Interfaces:**
- Consumes: `saveDecisionPhoto`, `encodePhoto`, `decisionPhotoThumbUrl`, `clearDecisionPhotoUrlCache` (Task 4); `BrainCore.addPhotoToDecision` / `removePhotoFromDecision` (Task 1); the existing `queueSave`, `toast`, `escHtml`, `escAttr`, `renderDecisions`, `viewingDecisionId`, `decisionForm`.
- Produces: `openDecisionPhotoViewer(decisionId, index)`, used by both the form queue and the view strip.

- [ ] **Step 1: Add the CSS**

Insert after the existing `.hub-notice` rules. These class names are new to this file (the Brain has no photo CSS yet); every token is already defined in its `:root`:

```css
  /* ── Decision photos ── */
  .photo-dropzone { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 18px; border: 1px dashed var(--border2); border-radius: var(--radius-md); background: var(--bg2); color: var(--muted2); font-size: 0.85rem; text-align: center; }
  .photo-dropzone.dragover { border-color: var(--accent); background: var(--bg3); color: var(--text); }
  .photo-dropzone .pz-icon { font-size: 1.5rem; }
  .photo-dropzone .pz-title { font-size: 0.95rem; font-weight: 600; color: var(--text); }
  .pz-link { color: var(--accent); cursor: pointer; text-decoration: underline; }
  .photo-queue { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 12px; }
  .photo-card { width: 160px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg2); overflow: hidden; }
  .photo-card img { display: block; width: 100%; height: 110px; object-fit: cover; background: var(--bg3); }
  .photo-card .pc-body { padding: 8px; display: flex; flex-direction: column; gap: 6px; }
  .photo-card .pc-caption { width: 100%; font-size: 0.8rem; padding: 5px 7px; border: 1px solid var(--border2); border-radius: var(--radius-md); background: var(--bg); color: var(--text); }
  .photo-card .pc-x { align-self: flex-end; cursor: pointer; color: var(--muted2); font-size: 0.85rem; }
  .photo-card .pc-x:hover { color: var(--red); }
  .photo-strip { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; }
  .photo-thumb { position: relative; width: 96px; }
  .photo-thumb img { display: block; width: 96px; height: 72px; object-fit: cover; border: 1px solid var(--border); border-radius: var(--radius-md); cursor: pointer; background: var(--bg3); }
  .photo-thumb .pt-cap { display: block; font-size: 0.7rem; color: var(--muted2); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .photo-thumb .pt-x { position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; line-height: 17px; text-align: center; border-radius: 50%; background: var(--bg2); border: 1px solid var(--border2); color: var(--muted2); font-size: 0.7rem; cursor: pointer; }
  .photo-thumb .pt-x:hover { color: var(--red); }
  .pv-backdrop { position: fixed; inset: 0; background: color-mix(in srgb, #000 55%, transparent); display: flex; align-items: center; justify-content: center; z-index: 800; padding: 24px; }
  .pv-panel { position: relative; max-width: 92vw; max-height: 88vh; display: flex; flex-direction: column; gap: 10px; }
  .pv-panel img { max-width: 92vw; max-height: 78vh; object-fit: contain; border-radius: var(--radius-md); background: var(--bg2); }
  .pv-bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; font-size: 0.85rem; }
  .pv-cap { color: #fff; }
  .pv-btn { cursor: pointer; color: #fff; background: none; border: 1px solid rgba(255,255,255,0.5); border-radius: var(--radius-md); padding: 4px 10px; font-size: 0.85rem; }
```

`#fff` and the white border are the approved exception: that bar sits on a dimmed photo, not the page background.

- [ ] **Step 2: Queue photos on the decision form**

Add the queue state and handlers next to the other decision-form functions:

```js
  // Photos chosen on the decision form are held in memory until the decision is
  // saved — a new decision has no id to attach them to yet.
  let decPhotoQueue = [];

  function onDecPhotoDragOver(ev) { ev.preventDefault(); el('dec-photo-drop').classList.add('dragover'); }
  function onDecPhotoDragLeave() { el('dec-photo-drop').classList.remove('dragover'); }
  function onDecPhotoDrop(ev) {
    ev.preventDefault();
    el('dec-photo-drop').classList.remove('dragover');
    queueDecPhotos(ev.dataTransfer && ev.dataTransfer.files);
  }
  function onDecPhotoPick(input) { queueDecPhotos(input.files); input.value = ''; }

  async function queueDecPhotos(fileList) {
    for (const file of Array.from(fileList || [])) {
      try {
        const preview = await encodePhoto(file, THUMB_MAX_EDGE, THUMB_QUALITY);
        decPhotoQueue = [...decPhotoQueue, { uid: genId(), file, caption: '',
          previewUrl: URL.createObjectURL(preview) }];
      } catch (e) {
        toast('“' + file.name + '” is not an image the browser can read.');
      }
    }
    renderDecPhotoQueue();
  }

  function onDecPhotoCaption(uid, value) {
    const item = decPhotoQueue.find(i => i.uid === uid);
    if (item) item.caption = value;               // no repaint: it would steal focus
  }

  function removeDecPhotoFromQueue(uid) {
    const item = decPhotoQueue.find(i => i.uid === uid);
    if (item) URL.revokeObjectURL(item.previewUrl);
    decPhotoQueue = decPhotoQueue.filter(i => i.uid !== uid);
    renderDecPhotoQueue();
  }

  function clearDecPhotoQueue() {
    for (const i of decPhotoQueue) URL.revokeObjectURL(i.previewUrl);
    decPhotoQueue = [];
  }

  function renderDecPhotoQueue() {
    const wrap = el('dec-photo-queue');
    if (!wrap) return;
    wrap.innerHTML = decPhotoQueue.map(i =>
      '<div class="photo-card">' +
        '<img src="' + escAttr(i.previewUrl) + '" alt="' + escAttr(i.file.name) + '"/>' +
        '<div class="pc-body">' +
          '<input type="text" class="pc-caption" placeholder="What is this a photo of?" ' +
            'value="' + escAttr(i.caption) + '" oninput="onDecPhotoCaption(\'' + i.uid + '\', this.value)"/>' +
          '<span class="pc-x" title="Remove" onclick="removeDecPhotoFromQueue(\'' + i.uid + '\')">✕ remove</span>' +
        '</div>' +
      '</div>').join('');
  }

  // Writes the form queue once the decision exists.
  async function writeQueuedDecisionPhotos(decisionId, pending) {
    for (const item of pending) {
      try {
        const rec = await saveDecisionPhoto(item.file, item.caption);
        state = BrainCore.addPhotoToDecision(state, decisionId, rec, nowIso());
        queueSave([]);
      } catch (e) {
        console.error('saveDecisionPhoto failed', e);
        toast('Could not save “' + (item.file.name || 'photo') + '” (' + ((e && e.name) || 'error') + ').');
      } finally {
        URL.revokeObjectURL(item.previewUrl);
      }
    }
    renderDecisions();
  }
```

In `decisionFormCard()`, add this block immediately after the Products/Tags `form-row` (the one containing `.dec-products` and `.dec-tags`):

```js
        '<div class="form-group">' +
          '<label class="form-label">Photos</label>' +
          '<div id="dec-photo-drop" class="photo-dropzone"' +
               ' ondragover="onDecPhotoDragOver(event)" ondragleave="onDecPhotoDragLeave(event)" ondrop="onDecPhotoDrop(event)">' +
            '<span class="pz-icon">🖼</span>' +
            '<span class="pz-title">Drop photos here</span>' +
            '<span>or <label class="pz-link">choose files<input type="file" accept="image/*" multiple hidden onchange="onDecPhotoPick(this)"/></label> — saved when you save the decision</span>' +
          '</div>' +
          '<div id="dec-photo-queue" class="photo-queue"></div>' +
        '</div>' +
```

At the end of `renderDecisions()`, after `renderDecTable();`, repaint the queue so it survives the form's re-render:

```js
    if (decisionForm) renderDecPhotoQueue();
```

- [ ] **Step 3: Drain the queue in `saveDecisionForm`**

`saveDecisionForm` has three exits — `edit`, `supersede`, and the new/from-comment tail — each setting `decisionForm = null`, calling `queueSave([])` and toasting. In each of the three, capture the queue and hand it off after the record exists. For the `edit` branch, immediately before `toast('Decision updated.');`:

```js
      const pendingEdit = decPhotoQueue; decPhotoQueue = [];
      if (pendingEdit.length) writeQueuedDecisionPhotos(id, pendingEdit);
```

For the `supersede` branch, immediately before `toast('Decision superseded.');` (photos attach to the **new** record):

```js
      const pendingSup = decPhotoQueue; decPhotoQueue = [];
      if (pendingSup.length) writeQueuedDecisionPhotos(rec.id, pendingSup);
```

For the new / from-comment tail, immediately before `toast('Decision recorded.');`:

```js
    const pendingNew = decPhotoQueue; decPhotoQueue = [];
    if (pendingNew.length) writeQueuedDecisionPhotos(rec.id, pendingNew);
```

And in `cancelDecisionForm`, call `clearDecPhotoQueue();` before it clears the form, so cancelled photos release their preview URLs.

- [ ] **Step 4: Strip and viewer on the decision view**

In `decisionViewCard()`, insert before the closing `'</div>' + '<div class="form-actions">'`:

```js
          '<div class="dv-field"><div class="dv-label">Photos</div>' +
            '<div class="photo-strip" id="dstrip-' + escAttr(d.id) + '"></div>' +
            '<label class="pz-link">＋ Add photos' +
              '<input type="file" accept="image/*" multiple hidden onchange="onDecisionViewPhotoPick(this, \'' + escAttr(d.id) + '\')"/>' +
            '</label>' +
          '</div>' +
```

Add the handlers, and call `renderDecisionPhotoStrip(viewingDecisionId)` at the end of `renderDecisions()` when a decision is being viewed:

```js
  // Filled after the card paints: thumbnails are read from disk.
  async function renderDecisionPhotoStrip(decisionId) {
    const d = state.decisions.find(x => x.id === decisionId);
    const wrap = el('dstrip-' + decisionId);
    if (!d || !wrap) return;
    const photos = d.photos || [];
    if (!photos.length) { wrap.innerHTML = '<span class="dv-value">—</span>'; return; }
    const parts = [];
    for (let i = 0; i < photos.length; i += 1) {
      const p = photos[i];
      let url = '';
      try { url = await decisionPhotoThumbUrl(p); }
      catch (e) { console.warn('thumbnail missing', p.thumb, e); }
      parts.push(
        '<span class="photo-thumb">' +
          (url
            ? '<img src="' + escAttr(url) + '" alt="' + escAttr(p.caption || p.file) + '" ' +
              'title="' + escAttr(p.caption || p.file) + '" onclick="openDecisionPhotoViewer(\'' + escAttr(d.id) + '\', ' + i + ')"/>'
            : '<img alt="missing" title="' + escAttr(p.file) + ' is not in the folder"/>') +
          '<span class="pt-x" title="Remove from this decision" ' +
            'onclick="removeDecisionPhoto(\'' + escAttr(d.id) + '\', \'' + escAttr(p.id) + '\')">✕</span>' +
          '<span class="pt-cap">' + escHtml(p.caption || p.file) + '</span>' +
        '</span>');
    }
    if (viewingDecisionId !== decisionId) return;      // card closed while reading
    wrap.innerHTML = parts.join('');
  }

  async function onDecisionViewPhotoPick(input, decisionId) {
    const files = Array.from(input.files || []);
    input.value = '';
    for (const file of files) {
      try {
        const rec = await saveDecisionPhoto(file, '');
        state = BrainCore.addPhotoToDecision(state, decisionId, rec, nowIso());
        queueSave([]);
      } catch (e) {
        console.error('saveDecisionPhoto failed', e);
        toast('Could not save “' + (file.name || 'photo') + '” (' + ((e && e.name) || 'error') + ').');
      }
    }
    renderDecisions();
  }

  // Unlinks only — the files stay in Photos/decisions/.
  function removeDecisionPhoto(decisionId, photoId) {
    state = BrainCore.removePhotoFromDecision(state, decisionId, photoId, nowIso());
    clearDecisionPhotoUrlCache();
    queueSave([]);
    renderDecisions();
  }

  // Full-size viewer. The node is REMOVED on close, never just hidden:
  // .pv-backdrop declares display:flex, which beats [hidden] — the bug that made
  // this tool's document reader impossible to close.
  let decPhotoViewer = null;      // { decisionId, index }

  async function openDecisionPhotoViewer(decisionId, index) {
    const d = state.decisions.find(x => x.id === decisionId);
    if (!d || !(d.photos || []).length) return;
    decPhotoViewer = { decisionId, index };
    closeDecisionPhotoViewer(true);
    const wrap = document.createElement('div');
    wrap.className = 'pv-backdrop';
    wrap.id = 'dec-photo-viewer';
    wrap.onclick = ev => { if (ev.target === wrap) closeDecisionPhotoViewer(); };
    document.body.appendChild(wrap);
    await paintDecisionPhotoViewer();
  }

  async function paintDecisionPhotoViewer() {
    const wrap = el('dec-photo-viewer');
    if (!wrap || !decPhotoViewer) return;
    const d = state.decisions.find(x => x.id === decPhotoViewer.decisionId);
    const photos = (d && d.photos) || [];
    const p = photos[decPhotoViewer.index];
    if (!p) { closeDecisionPhotoViewer(); return; }
    let url = '';
    try { url = await decisionPhotoFullUrl(p); }
    catch (e) { toast('“' + p.file + '” is not in the Photos folder.'); closeDecisionPhotoViewer(); return; }
    wrap.innerHTML =
      '<div class="pv-panel">' +
        '<img src="' + escAttr(url) + '" alt="' + escAttr(p.caption || p.file) + '"/>' +
        '<div class="pv-bar">' +
          '<span class="pv-cap">' + escHtml(p.caption || p.file) +
            ' · ' + (decPhotoViewer.index + 1) + ' of ' + photos.length + '</span>' +
          '<span>' +
            (photos.length > 1
              ? '<button type="button" class="pv-btn" onclick="decisionPhotoViewerStep(-1)">‹ Prev</button> ' +
                '<button type="button" class="pv-btn" onclick="decisionPhotoViewerStep(1)">Next ›</button> '
              : '') +
            '<button type="button" class="pv-btn" onclick="closeDecisionPhotoViewer()">✕ Close</button>' +
          '</span>' +
        '</div>' +
      '</div>';
  }

  function decisionPhotoViewerStep(delta) {
    if (!decPhotoViewer) return;
    const d = state.decisions.find(x => x.id === decPhotoViewer.decisionId);
    const n = ((d && d.photos) || []).length;
    if (!n) { closeDecisionPhotoViewer(); return; }
    decPhotoViewer.index = (decPhotoViewer.index + delta + n) % n;
    paintDecisionPhotoViewer();
  }

  function closeDecisionPhotoViewer(keepState) {
    const wrap = el('dec-photo-viewer');
    if (wrap) wrap.remove();
    if (!keepState) decPhotoViewer = null;
  }
```

This file already has a global `keydown` listener for its document reader. Extend that existing listener — do not add a second one — so that when `decPhotoViewer` is set, Escape closes the viewer and Left/Right step it, and neither fires while an `INPUT`, `TEXTAREA` or contenteditable has focus.

- [ ] **Step 5: Export the handlers**

Add to `Object.assign(window, { … })`:

```js
    onDecPhotoPick, onDecPhotoDrop, onDecPhotoDragOver, onDecPhotoDragLeave,
    onDecPhotoCaption, removeDecPhotoFromQueue, renderDecPhotoQueue,
    renderDecisionPhotoStrip, onDecisionViewPhotoPick, removeDecisionPhoto,
    openDecisionPhotoViewer, decisionPhotoViewerStep, closeDecisionPhotoViewer,
```

- [ ] **Step 6: Verify in the browser**

Navigate (not `document.write`) to the Brain with the fake-handle harness connected, then check, reporting actual values:

1. New decision with two queued photos and captions → after save, `Photos/decisions/<caption>.jpg` and `thumbs/<caption>.jpg` exist for both, and `state.decisions[…].photos` holds two records with `addedBy: ''`.
2. Open that decision → both thumbnails render with their captions.
3. Add one from the view → third thumbnail appears, file on disk named from the original filename.
4. A caption matching one used by a *different* decision produces ` (2)` — cross-decision dedupe.
5. Viewer: click a thumbnail → `#dec-photo-viewer` exists with `getBoundingClientRect().height > 0` and `getComputedStyle(...).display === 'flex'`; Next/Prev wrap; Escape **removes the node** (`document.getElementById('dec-photo-viewer') === null`); backdrop click closes; clicking the image does not. Assert the effect, never the `hidden` flag, and never `offsetParent` (it is null for `position: fixed`).
6. Remove a photo → gone from the strip and the record, both files still on the fake disk.
7. Cancel a form with queued photos → queue cleared, nothing written.
8. Zero console errors.

- [ ] **Step 7: Diff and report**

```
diff -u "$SNAPSHOT" tools-src/product-brain.html > .superpowers/sdd/dphotos-task-5.diff
```

Write `.superpowers/sdd/dphotos-task-5-report.md`. No commit.

---

### Task 6: the decisions export button

**Files:**
- Modify: `tools-src/product-brain.html` — tab head (~line 530), new handler (**gitignored, no commit**)

**Interfaces:**
- Consumes: `BrainCore.buildDecisionsWorkbookModel(state, decisions, nowIso, productNames)` (Task 2); `renderWorkbook(model, ExcelJS, colors)` (Task 3); the existing `filteredDecisions()`, `products()`, `toast`, `todayIso`.
- Produces: `exportDecisions()`.

- [ ] **Step 1: Load ExcelJS and the renderer**

The Brain does not currently load ExcelJS. Add the vendored bundle next to its other vendor scripts in `<head>`:

```html
<script src="/assets/vendor/exceljs.min.js"></script>
```

and add to the module's import block:

```js
  import { renderWorkbook } from '/assets/js/xlsx-render.js';
```

- [ ] **Step 2: Add the button**

In the Decisions tab head, before the "From comment…" button:

```html
            <button class="btn help-btn" id="dec-export-btn" onclick="exportDecisions()" title="Export the decisions currently shown to Excel">⤓ Export decisions</button>
```

- [ ] **Step 3: Add the handler**

Place it next to the other decision handlers:

```js
  // Exports exactly what the filters are currently showing, as a download. The
  // shared folder is never touched: an auto-generated workbook would put a file
  // write back on every save, which is what made connecting slow.
  async function exportDecisions() {
    const rows = filteredDecisions();
    if (!rows.length) { toast('No decisions to export in the current filter.'); return; }
    try {
      const names = new Map(products().map(p => [p.id, p.name]));
      const model = BrainCore.buildDecisionsWorkbookModel(state, rows, todayIso(), names);
      const buffer = await renderWorkbook(model, ExcelJS, HubCore.EXCEL_COLORS);
      const url = URL.createObjectURL(new Blob([buffer],
        { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a');
      a.href = url; a.download = model.filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast(rows.length + (rows.length === 1 ? ' decision exported.' : ' decisions exported.'));
    } catch (e) {
      console.error('exportDecisions failed', e);
      toast('Could not build the export (' + ((e && e.name) || 'error') + ').');
    }
  }
```

Add `exportDecisions` to the `Object.assign(window, { … })` block.

- [ ] **Step 4: Verify in the browser**

With the harness connected and several decisions seeded (at least one superseded, at least one with photos), intercept the download rather than writing to disk — replace `HTMLAnchorElement.prototype.click` temporarily, or capture the object URL — then re-parse the buffer with ExcelJS and report actual values:

1. Header row equals the twelve `DECISION_COLUMNS` headers, ending with `Photos`.
2. A decision with two photos shows `2 photos: a.jpg, b.jpg`.
3. A superseded decision is present with `Superseded` in the Status column.
4. Filtering the Decisions tab to one product then exporting produces only that product's rows.
5. Exporting with a filter that matches nothing toasts and downloads nothing.
6. The shared folder is unchanged — no new `.xlsx` in the fake disk.
7. Zero console errors.

- [ ] **Step 5: Diff and report**

```
diff -u "$SNAPSHOT" tools-src/product-brain.html > .superpowers/sdd/dphotos-task-6.diff
```

Write `.superpowers/sdd/dphotos-task-6-report.md`. No commit.

---

### Task 7: endgame — sweep, lock, deploy

**Files:**
- Modify: `.superpowers/sdd/progress.md` (gitignored)
- Regenerate: `tools/*.html`, `tools/vault-manifest.json` via `scripts/lock-tools.mjs`

- [ ] **Step 1: Review sweep**

Read the whole decision-photo and export path in `tools-src/product-brain.html`. Confirm: every user string goes through `escHtml`/`escAttr`; no external requests; no hardcoded colours beyond the approved `.pv-bar` white; object URLs revoked on remove, cancel and export; the Brain writes nothing to `hub-data.json`; no `removeEntry` anywhere near photos.

- [ ] **Step 2: Full-suite gate**

Run: `npm test 2>&1 | tail -12`
Expected: `# fail 0` with 128 tests.

- [ ] **Step 3: Hub regression check**

The renderer moved out of the Hub in Task 3. Connect the Hub with the fake-handle harness, change a comment's status, and re-parse the regenerated `Master Log.xlsx`: header band filled, frozen pane, autofilter, Photos column present. Zero console errors.

- [ ] **Step 4: Lock**

Ask Harvey for the workshop code in chat — it is **not on disk**. Feed it to `scripts/lock-tools.mjs` through the delayed-stdin harness (code in an env var, fed at 1s and 3s; the zero-delay pipe path flakes). Verify `checkKey` true with the real code, false with a wrong one, and all 7 payloads decrypting byte-identical to their `tools-src/` sources.

- [ ] **Step 5: Deploy and live-verify**

```bash
git add tools/
git commit -m "feat: photos on decisions and an on-demand decisions export"
git push origin main
```

Then confirm live: `tools/product-brain.html` and `assets/js/xlsx-render.js` return 200, `tools-src/` returns 404, and the live loader's md5 matches the local build.

- [ ] **Step 6: Update the ledger**

Append to `.superpowers/sdd/progress.md`: what shipped, the verification evidence, minors deferred, and what is left for Harvey (a real-folder click-through: attach a site photo to a real decision, export the register, confirm both land correctly once OneDrive syncs).

---

## Notes for the implementer

- Decision photos share one flat folder, so `saveDecisionPhoto` must always pass `BrainCore.decisionPhotoNames(state)` as the existing-names list. Passing only the current decision's names would let two decisions overwrite each other.
- The form queue holds `File` objects. Closing the tab before saving the decision simply never writes them — intended.
- `saveDecisionPhoto` writes the full copy before the thumbnail; a failure between the two leaves a full copy with no thumbnail, and the strip shows the missing-file placeholder rather than throwing. Accepted, matching the comments feature.
- Do not add a second global `keydown` listener; extend the existing one.
