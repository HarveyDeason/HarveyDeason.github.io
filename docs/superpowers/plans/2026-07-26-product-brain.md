# Product Brain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Product Brain — a gated sibling tool to the Comments Hub: structured decision records, a document repository with full-text extraction (PDF/DOCX/XLSX), and one MiniSearch-powered search across decisions, documents, and hub comments — plus extract the two tools' shared sync logic into a tested `hub-sync.js` module.

**Architecture:** Shared generic merge + single-flight save-queue engine in `assets/js/hub-sync.js` (node-tested with fake handles); the existing Comments Hub is refactored onto it with zero behaviour change (58-test regression gate). Brain-specific pure logic (state, merge, gzip text storage, extraction assembly, search-doc builders, snippets, supersession) lives in `assets/js/brain-core.js`. The UI is a single gitignored file `tools-src/product-brain.html` deployed encrypted via lock-tools. `brain-data.json` is the brain's source of truth in the same shared parent folder; `hub-data.json` is strictly read-only to it.

**Tech Stack:** Vanilla JS ES modules, `node --test`, File System Access API, vendored MiniSearch + mammoth.js + existing pdf.js/SheetJS, site.css/tool.css tokens.

**Spec:** `docs/superpowers/specs/2026-07-26-product-brain-design.md` — read before starting any task.

## Global Constraints

- Zero external network requests from tools; all libraries vendored in `assets/vendor/`.
- No hardcoded UI colours — alias site.css tokens exactly as `tools-src/comments-hub.html` does.
- `hub-data.json`, the `P&ID Register/`, and the hub's `Products/` outputs are READ-ONLY to the brain. The brain never creates products.
- `brain-data.json` is the brain's single source of truth; save cycle: read → merge → backup (`brain-data.backup.json`) → write, via the shared single-flight queue with error chip + retry-on-next-change.
- Deleting a document entry tombstones the index record but NEVER deletes the file from `Documents/`.
- `tools-src/` is gitignored — never commit tool HTML. UI tasks produce no commits; artifacts go to the session scratchpad.
- Tests: `npm test` from repo root; existing suite is 58/58 and MUST stay green through every task (the hub refactor task especially).
- All dates ISO strings; timestamps full ISO.
- Comments Hub behaviour must not change in any user-visible way from the refactor.

---

### Task 1: Vendor MiniSearch and mammoth

**Files:**
- Create: `assets/vendor/minisearch.min.js`
- Create: `assets/vendor/mammoth.browser.min.js`

**Interfaces:**
- Produces: browser globals `MiniSearch` (UMD: `new MiniSearch({fields, storeFields, searchOptions})`, `.addAll(docs)`, `.search(q)`) and `mammoth` (`mammoth.extractRawText({arrayBuffer}) -> Promise<{value}>`).

> **Requires user approval before downloading.** State filenames, sources, and sizes when asking.

- [ ] **Step 1: Download pinned UMD builds** (after approval)

```powershell
Invoke-WebRequest -Uri "https://cdn.jsdelivr.net/npm/minisearch@7.1.0/dist/umd/index.min.js" -OutFile "assets/vendor/minisearch.min.js"
Invoke-WebRequest -Uri "https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js" -OutFile "assets/vendor/mammoth.browser.min.js"
```
Expected: minisearch ~35 KB, mammoth ~700 KB.

- [ ] **Step 2: Sanity-check** — first bytes of each mention the library name; sizes in the expected range.

- [ ] **Step 3: Commit**

```bash
git add assets/vendor/minisearch.min.js assets/vendor/mammoth.browser.min.js
git commit -m "chore: vendor MiniSearch 7.1.0 and mammoth 1.8.0 for Product Brain"
```

---

### Task 2: hub-sync — generic merge helpers + hub-core delegation

**Files:**
- Create: `assets/js/hub-sync.js`
- Modify: `assets/js/hub-core.js` (delegate its private `mergeById`/`mergeList` to hub-sync; public behaviour unchanged)
- Test: `tests/hub-sync.test.js`

**Interfaces:**
- Produces (exact exports):
  - `mergeById(a, b, tombstones) -> record[]` — union by `id`, later `updatedAt` wins, tombstoned (ts >= updatedAt) dropped. (Same semantics the Comments Hub already has.)
  - `mergeList(a, b) -> string[]` — case-insensitive dedupe, a-order first.
  - `mergeTombstones(a, b) -> object` — per-id max timestamp union.
- `hub-core.js` keeps exporting `mergeState` with identical behaviour, now importing these from `./hub-sync.js` instead of its own private copies.

- [ ] **Step 1: Write failing tests**

```js
// tests/hub-sync.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeById, mergeList, mergeTombstones } from '../assets/js/hub-sync.js';

const R = (id, updatedAt, v) => ({ id, updatedAt, v });

test('mergeById: later updatedAt wins, symmetric', () => {
  const a = [R('x', '2026-07-26T10:00:00Z', 1)];
  const b = [R('x', '2026-07-26T11:00:00Z', 2)];
  assert.equal(mergeById(a, b, {})[0].v, 2);
  assert.equal(mergeById(b, a, {})[0].v, 2);
});

test('mergeById: tombstone at/after updatedAt removes; later edit survives', () => {
  const a = [R('x', '2026-07-26T10:00:00Z', 1)];
  assert.equal(mergeById(a, [], { x: '2026-07-26T10:00:00Z' }).length, 0);
  assert.equal(mergeById(a, [], { x: '2026-07-26T09:00:00Z' }).length, 1);
});

test('mergeList dedupes case-insensitively keeping first spelling', () => {
  assert.deepEqual(mergeList(['HAZOP', 'Minutes'], ['hazop', 'Datasheet']), ['HAZOP', 'Minutes', 'Datasheet']);
});

test('mergeTombstones takes max per id', () => {
  assert.deepEqual(
    mergeTombstones({ a: '2026-01-01T00:00:00Z' }, { a: '2026-02-01T00:00:00Z', b: '2026-01-05T00:00:00Z' }),
    { a: '2026-02-01T00:00:00Z', b: '2026-01-05T00:00:00Z' });
});
```

- [ ] **Step 2: Run `npm test`** → FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// assets/js/hub-sync.js
// Shared sync logic for the Comments Hub and Product Brain: generic ledger
// merging here, and (Task 3) the single-flight save engine. Pure and
// node-testable; no DOM.

export function mergeById(a, b, tombstones) {
  const out = new Map();
  for (const rec of [...(a || []), ...(b || [])]) {
    if (!rec || !rec.id) continue;
    const prev = out.get(rec.id);
    if (!prev || (rec.updatedAt || '') > (prev.updatedAt || '')) out.set(rec.id, rec);
  }
  const t = tombstones || {};
  return [...out.values()].filter(r => !(t[r.id] && t[r.id] >= (r.updatedAt || '')));
}

export function mergeList(a, b) {
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

export function mergeTombstones(a, b) {
  const out = { ...(a || {}) };
  for (const [id, ts] of Object.entries(b || {})) {
    if (!out[id] || ts > out[id]) out[id] = ts;
  }
  return out;
}
```

In `assets/js/hub-core.js`: add `import { mergeById, mergeList, mergeTombstones } from './hub-sync.js';` at the top, DELETE its private `mergeById` and `mergeList` function definitions, and replace the inline tombstone-union loop inside `mergeState` with `const tombstones = mergeTombstones(l.tombstones, d.tombstones);`. No exported signature changes.

- [ ] **Step 4: Run `npm test`** → PASS, including all 58 pre-existing tests (the hub-core delegation must not change any result).

- [ ] **Step 5: Commit** — `git add -u assets/js tests && git commit -m "feat: hub-sync shared merge helpers; hub-core delegates"`

---

### Task 3: hub-sync — createSyncEngine (single-flight save queue)

**Files:**
- Modify: `assets/js/hub-sync.js`
- Test: `tests/hub-sync.test.js`

**Interfaces:**
- Produces: `createSyncEngine(cfg) -> engine` where
  - `cfg = { fileName, backupName, getDir: () => dirHandle|null, getState: () => state, setState: (s) => void, merge: (local, disk) => state, onStatus: (status, message?) => void  /* 'saving'|'synced'|'error' */, afterSave: async (touched) => void }`
  - `engine.queueSave(touched)` — `touched` is an array of ids or `null` (= all); coalesces while a save runs; never rejects; on failure calls `onStatus('error', msg)`, keeps the failed scope queued.
  - `engine.readLedger() -> Promise<{ status: 'missing'|'corrupt'|'ok', data? }>`
  - `engine.writeFile(dirHandle, name, contents) -> Promise<void>` (contents string or ArrayBuffer)
  - `engine.saveNow(touched) -> Promise<boolean>` — one immediate cycle (used by connect flows); throws on write failure (caller handles); returns false without throwing when ledger is corrupt (after onStatus('error')).
  - Save cycle (exact): if `!getDir()` return true; `onStatus('saving')`; read ledger; corrupt → `onStatus('error', ...)`, return false; if data → write backup with previous disk content, `setState(merge(getState(), data))`; stamp `getState().savedAt = new Date().toISOString()`; write `fileName` with `JSON.stringify(getState(), null, 2)`; `await afterSave(touched)`; `onStatus('synced')`; return true.

- [ ] **Step 1: Write failing tests** (fake in-memory directory handle)

```js
// append to tests/hub-sync.test.js
import { createSyncEngine } from '../assets/js/hub-sync.js';

function fakeDir(files = {}, opts = {}) {
  const stats = { writes: [], openWriters: 0, maxConcurrent: 0 };
  const dir = {
    stats, files,
    getFileHandle: async (name, o) => {
      if (!o?.create && !(name in files)) { const e = new Error('missing'); e.name = 'NotFoundError'; throw e; }
      return {
        getFile: async () => ({ text: async () => files[name] }),
        createWritable: async () => {
          if (opts.failWrites) { const e = new Error('locked'); e.name = 'NoModificationAllowedError'; throw e; }
          stats.openWriters++; stats.maxConcurrent = Math.max(stats.maxConcurrent, stats.openWriters);
          let buf = '';
          return { write: async c => { await new Promise(r => setTimeout(r, opts.delay || 0)); buf = c; },
                   close: async () => { stats.openWriters--; files[name] = buf; stats.writes.push(name); } };
        },
      };
    },
  };
  return dir;
}

function makeEngine(dir, extra = {}) {
  let state = { savedAt: '', items: [], tombstones: {} };
  const events = [];
  const engine = createSyncEngine({
    fileName: 'x.json', backupName: 'x.backup.json',
    getDir: () => dir, getState: () => state, setState: s => { state = s; },
    merge: (l, d) => ({ ...l, items: [...new Map([...d.items, ...l.items].map(i => [i.id, i])).values()] }),
    onStatus: (s, m) => events.push([s, m]),
    afterSave: async () => { events.push(['afterSave']); },
    ...extra,
  });
  return { engine, events, getState: () => state };
}

test('engine: readLedger distinguishes missing / corrupt / ok', async () => {
  const { engine: e1 } = makeEngine(fakeDir({}));
  assert.equal((await e1.readLedger()).status, 'missing');
  const { engine: e2 } = makeEngine(fakeDir({ 'x.json': '{oops' }));
  assert.equal((await e2.readLedger()).status, 'corrupt');
  const { engine: e3 } = makeEngine(fakeDir({ 'x.json': '{"items":[]}' }));
  assert.equal((await e3.readLedger()).status, 'ok');
});

test('engine: saveNow writes backup of previous disk content, then ledger', async () => {
  const dir = fakeDir({ 'x.json': '{"savedAt":"","items":[{"id":"old"}],"tombstones":{}}' });
  const { engine } = makeEngine(dir);
  assert.equal(await engine.saveNow([]), true);
  assert.ok(dir.files['x.backup.json'].includes('old'));
  assert.ok(dir.files['x.json'].includes('savedAt'));
});

test('engine: corrupt ledger blocks save with error status, saveNow returns false', async () => {
  const dir = fakeDir({ 'x.json': 'not json' });
  const { engine, events } = makeEngine(dir);
  assert.equal(await engine.saveNow([]), false);
  assert.ok(events.some(([s]) => s === 'error'));
  assert.equal(dir.files['x.json'], 'not json'); // never overwritten
});

test('engine: queueSave single-flight, coalesces, never more than one writer', async () => {
  const dir = fakeDir({}, { delay: 30 });
  const { engine } = makeEngine(dir);
  engine.queueSave(['a']); engine.queueSave(['b']); engine.queueSave(null);
  await new Promise(r => setTimeout(r, 400));
  assert.equal(dir.stats.maxConcurrent, 1);
  assert.ok(dir.stats.writes.filter(w => w === 'x.json').length <= 2); // initial + one coalesced follow-up
});

test('engine: failed queueSave reports error and does not throw', async () => {
  const dir = fakeDir({}, { failWrites: true });
  const { engine, events } = makeEngine(dir);
  engine.queueSave([]);
  await new Promise(r => setTimeout(r, 100));
  assert.ok(events.some(([s]) => s === 'error'));
});
```

- [ ] **Step 2: Run `npm test`** → FAIL (`createSyncEngine` not exported).

- [ ] **Step 3: Implement** (append to `assets/js/hub-sync.js`)

```js
export function createSyncEngine(cfg) {
  let running = false, pending = false, pendingAll = false;
  let pendingIds = new Set();

  async function writeFile(dir, name, contents) {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(contents);
    await w.close();
  }

  async function readLedger() {
    const dir = cfg.getDir();
    if (!dir) return { status: 'missing' };
    let txt;
    try {
      const fh = await dir.getFileHandle(cfg.fileName, { create: false });
      txt = await (await fh.getFile()).text();
    } catch (e) { return { status: 'missing' }; }
    try { return { status: 'ok', data: JSON.parse(txt), raw: txt }; }
    catch (e) { return { status: 'corrupt' }; }
  }

  async function saveNow(touched) {
    const dir = cfg.getDir();
    if (!dir) return true;
    cfg.onStatus('saving');
    const disk = await readLedger();
    if (disk.status === 'corrupt') {
      cfg.onStatus('error', cfg.fileName + ' is unreadable — not overwriting. Fix or remove it, then reconnect.');
      return false;
    }
    if (disk.status === 'ok') {
      await writeFile(dir, cfg.backupName, disk.raw);
      cfg.setState(cfg.merge(cfg.getState(), disk.data));
    }
    const st = cfg.getState();
    st.savedAt = new Date().toISOString();
    await writeFile(dir, cfg.fileName, JSON.stringify(st, null, 2));
    await cfg.afterSave(touched);
    cfg.onStatus('synced');
    return true;
  }

  function queueSave(touched) {
    if (touched === null) pendingAll = true;
    else for (const id of touched || []) pendingIds.add(id);
    pending = true;
    void loop();
  }

  async function loop() {
    if (running) return;
    running = true;
    try {
      while (pending) {
        pending = false;
        const touched = pendingAll ? null : [...pendingIds];
        pendingAll = false; pendingIds = new Set();
        try { await saveNow(touched); }
        catch (e) {
          console.error('save failed', e);
          cfg.onStatus('error', 'Save failed (' + ((e && e.name) || 'error') + '). Your change is kept on screen and will retry on the next change.');
          if (touched === null) pendingAll = true;
          else for (const id of touched) pendingIds.add(id);
        }
      }
    } finally { running = false; }
  }

  return { queueSave, saveNow, readLedger, writeFile };
}
```

- [ ] **Step 4: Run `npm test`** → PASS (all suites).
- [ ] **Step 5: Commit** — `git add -u && git commit -m "feat: hub-sync createSyncEngine single-flight save queue"`

---

### Task 4: Refactor Comments Hub onto the engine (no behaviour change)

**Files:**
- Modify: `tools-src/comments-hub.html` (gitignored — NO commit; diff + report artifacts to session scratchpad)

**Interfaces:**
- Consumes: `createSyncEngine` from `/assets/js/hub-sync.js` (import it in the tool's module script alongside HubCore).
- Produces: identical user-visible behaviour, now via the engine.

- [ ] **Step 1: Swap the internals**

In the module script: create `const engine = HubSync.createSyncEngine({ fileName: 'hub-data.json', backupName: 'hub-data.backup.json', getDir: () => dirHandle, getState: () => state, setState: s => { state = s; }, merge: HubCore.mergeState, onStatus: updateFolderChip, afterSave: regenerateExcels })`. Replace the bodies of the page's `queueSave` (keep its `renderAll()` first line, then `engine.queueSave(touched)`), delete the page's `runSaveLoop`, replace `readHubJson` uses in `connectFolder` with `engine.readLedger()` (mapping: `missing→null`, `corrupt→undefined` to keep the existing branches), replace `saveState` internals with `await engine.saveNow(touched)` (keep the exported name `saveState` working for the console/window contract), and keep `writeFile` as `engine.writeFile` bound for `writeWorkbook`. `saveState`'s terminal `renderAll()` moves to the caller side of `engine.saveNow` inside the page's `saveState` wrapper. Delete now-dead local copies.

- [ ] **Step 2: Verify — regression + browser**

`npm test` → 58+ tests green (hub-core untouched behaviourally). Serve via preview ({name:"site"}), open `/tools-src/comments-hub.html`, and re-run the fake-handle console checks from the hotfix round: (1) seeded comment + 400ms fake dir → status change repaints instantly; (2) rapid triple mutation → max 1 concurrent writer, coalesced cycles; (3) forced `NoModificationAllowedError` → ERROR chip → next change recovers to SYNCED; (4) corrupt `hub-data.json` on connect → blocked with error chip. Zero console errors, light + dark.

- [ ] **Step 3: Artifacts** — write diff (`git diff --no-index` against a pre-task copy) and report to the session scratchpad for controller review. No commit.

---

### Task 5: brain-core — state, merge, gzip text storage

**Files:**
- Create: `assets/js/brain-core.js`
- Test: `tests/brain-core.test.js`

**Interfaces:**
- Produces:
  - `BRAIN_VERSION = 1`
  - `DEFAULT_DOC_TYPES = ['HAZOP', 'Meeting minutes', 'Datasheet', 'Report', 'Drawing', 'Other']`
  - `emptyBrainState(nowIso) -> { version: 1, savedAt, decisions: [], documents: [], lists: { tags: [], projects: [], docTypes: DEFAULT_DOC_TYPES }, tombstones: {} }`
  - `mergeBrainState(local, disk) -> state` — built on hub-sync `mergeById`/`mergeList`/`mergeTombstones`; lists merged per key.
  - `gzipText(text) -> Promise<base64 string>` / `gunzipText(b64) -> Promise<string>` — `CompressionStream('gzip')` + Blob/Response (global in Node 20 and browsers).
- Records: decision `{ id, title, decision, reasoning, madeBy, recordedBy, date, productIds[], projectTag, tags[], status: 'active'|'superseded', supersededBy, supersedes, links: { documents: [], comments: [], urls: [] }, updatedAt }`; document `{ id, title, docType, date, productIds[], projectTag, tags[], filePath, accUrl, extraction: { method: 'pdf'|'docx'|'sheet'|'none', pages, textGz }, updatedAt }`.

- [ ] **Step 1: Write failing tests**

```js
// tests/brain-core.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyBrainState, mergeBrainState, gzipText, gunzipText, DEFAULT_DOC_TYPES } from '../assets/js/brain-core.js';

const D = (id, updatedAt, extra = {}) => ({
  id, title: 'ARV omitted', decision: 'No ARV on OSB-04 discharge', reasoning: 'Surge analysis showed…',
  madeBy: 'HAZOP chair', recordedBy: 'HD', date: '2026-07-01', productIds: ['p1'], projectTag: '',
  tags: ['air valve'], status: 'active', supersededBy: '', supersedes: '',
  links: { documents: [], comments: [], urls: [] }, updatedAt, ...extra,
});

test('emptyBrainState seeds doc types', () => {
  const s = emptyBrainState('t');
  assert.deepEqual(s.lists.docTypes, DEFAULT_DOC_TYPES);
  assert.equal(s.version, 1);
});

test('mergeBrainState: later updatedAt wins; tombstones respected; lists deduped', () => {
  const a = { ...emptyBrainState('t'), decisions: [D('d1', '2026-07-26T10:00:00Z', { title: 'old' })] };
  const b = { ...emptyBrainState('t'), decisions: [D('d1', '2026-07-26T11:00:00Z', { title: 'new' })] };
  b.lists.tags = ['Air Valve', 'surge'];
  a.lists.tags = ['air valve'];
  const m = mergeBrainState(a, b);
  assert.equal(m.decisions[0].title, 'new');
  assert.equal(m.lists.tags.filter(t => t.toLowerCase() === 'air valve').length, 1);
  const c = mergeBrainState(a, { ...emptyBrainState('t'), tombstones: { d1: '2026-07-26T12:00:00Z' } });
  assert.equal(c.decisions.length, 0);
});

test('gzip round-trips text incl. unicode and page markers', async () => {
  const text = '[[p1]] Air relief valve — HAZOP said ≥ DN80\n[[p2]] more';
  assert.equal(await gunzipText(await gzipText(text)), text);
});
```

- [ ] **Step 2: Run `npm test`** → FAIL.

- [ ] **Step 3: Implement**

```js
// assets/js/brain-core.js
// Pure logic for the Product Brain: state, merge, compressed text storage,
// extraction assembly, search documents, snippets, supersession. Node-testable.
import { mergeById, mergeList, mergeTombstones } from './hub-sync.js';

export const BRAIN_VERSION = 1;
export const DEFAULT_DOC_TYPES = ['HAZOP', 'Meeting minutes', 'Datasheet', 'Report', 'Drawing', 'Other'];

export function emptyBrainState(nowIso) {
  return {
    version: BRAIN_VERSION,
    savedAt: nowIso || '',
    decisions: [],
    documents: [],
    lists: { tags: [], projects: [], docTypes: DEFAULT_DOC_TYPES.slice() },
    tombstones: {},
  };
}

export function mergeBrainState(local, disk) {
  const l = local || emptyBrainState('');
  const d = disk || emptyBrainState('');
  const tombstones = mergeTombstones(l.tombstones, d.tombstones);
  return {
    version: BRAIN_VERSION,
    savedAt: (l.savedAt || '') > (d.savedAt || '') ? l.savedAt : d.savedAt,
    decisions: mergeById(l.decisions, d.decisions, tombstones),
    documents: mergeById(l.documents, d.documents, tombstones),
    lists: {
      tags: mergeList(l.lists?.tags, d.lists?.tags),
      projects: mergeList(l.lists?.projects, d.lists?.projects),
      docTypes: mergeList(l.lists?.docTypes, d.lists?.docTypes),
    },
    tombstones,
  };
}

async function streamToB64(stream) {
  const buf = await new Response(stream).arrayBuffer();
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function gzipText(text) {
  const cs = new CompressionStream('gzip');
  return streamToB64(new Blob([text]).stream().pipeThrough(cs));
}

export async function gunzipText(b64) {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  const ds = new DecompressionStream('gzip');
  return new Response(new Blob([bytes]).stream().pipeThrough(ds)).text();
}
```

- [ ] **Step 4: Run `npm test`** → PASS.
- [ ] **Step 5: Commit** — `git add assets/js/brain-core.js tests/brain-core.test.js && git commit -m "feat: brain-core state, merge, gzip text storage"`

---

### Task 6: brain-core — extraction assembly + filing helpers

**Files:**
- Modify: `assets/js/brain-core.js`
- Test: `tests/brain-core.test.js`

**Interfaces:**
- Produces:
  - `pdfPagesToText(pages) -> string` — `pages` is `string[][]` (text items per page); output joins pages with `\n` prefixing each with `[[p<N>]] `.
  - `sheetTextFromRows(sheets) -> string` — `sheets` is `[{ name, rows: string[][] }]`; output per sheet: `[[sheet:<name>]] ` + rows joined (cells space-joined, rows newline-joined). (The UI converts a SheetJS workbook to this shape; keeping brain-core free of the XLSX dependency.)
  - `normalizeExtractedText(s) -> string` — collapse runs of whitespace (keeping `\n`), trim.
  - `extractionMethodFor(filename) -> 'pdf'|'docx'|'sheet'|'none'` — by extension (pdf; docx; xlsx/xls/csv; else none — note plain `.doc` maps to 'none').
  - `dedupeFilename(existingNames, name) -> string` — returns `name` if free, else `base (2).ext`, `base (3).ext`…
  - `docFolderPath(product, docType) -> string[]` — `['Documents', sanitizeFilename(productName or '_General'), sanitizeFilename(docType)]`; product may be null → `_General` level only (no docType subfolder for general: `['Documents', '_General']`).
  - Re-export `sanitizeFilename` from hub-core (import it; do not duplicate).

- [ ] **Step 1: Write failing tests**

```js
// append to tests/brain-core.test.js
import { pdfPagesToText, sheetTextFromRows, normalizeExtractedText, extractionMethodFor,
  dedupeFilename, docFolderPath } from '../assets/js/brain-core.js';

test('pdfPagesToText marks pages', () => {
  assert.equal(pdfPagesToText([['Air', 'valve'], ['DN80']]), '[[p1]] Air valve\n[[p2]] DN80');
});

test('sheetTextFromRows marks sheets and joins cells', () => {
  assert.equal(sheetTextFromRows([{ name: 'Actions', rows: [['1', 'Fit ARV'], ['2', 'Review']] }]),
    '[[sheet:Actions]] 1 Fit ARV\n2 Review');
});

test('normalizeExtractedText collapses runs but keeps line breaks', () => {
  assert.equal(normalizeExtractedText('a   b\n\n\nc\t d '), 'a b\nc d');
});

test('extractionMethodFor maps extensions, .doc is none', () => {
  assert.equal(extractionMethodFor('minutes.PDF'), 'pdf');
  assert.equal(extractionMethodFor('minutes.docx'), 'docx');
  assert.equal(extractionMethodFor('reg.xlsx'), 'sheet');
  assert.equal(extractionMethodFor('old.doc'), 'none');
  assert.equal(extractionMethodFor('photo.png'), 'none');
});

test('dedupeFilename suffixes (2), (3)…', () => {
  assert.equal(dedupeFilename(['a.pdf'], 'b.pdf'), 'b.pdf');
  assert.equal(dedupeFilename(['a.pdf'], 'a.pdf'), 'a (2).pdf');
  assert.equal(dedupeFilename(['a.pdf', 'a (2).pdf'], 'a.pdf'), 'a (3).pdf');
});

test('docFolderPath files under product/type, _General without type', () => {
  assert.deepEqual(docFolderPath('OSB-01 Chemical Dosing', 'HAZOP'), ['Documents', 'OSB-01 Chemical Dosing', 'HAZOP']);
  assert.deepEqual(docFolderPath(null, 'HAZOP'), ['Documents', '_General']);
});
```

- [ ] **Step 2: Run `npm test`** → FAIL.

- [ ] **Step 3: Implement** (append to `assets/js/brain-core.js`; add `import { sanitizeFilename } from './hub-core.js';` and `export { sanitizeFilename };`)

```js
export function pdfPagesToText(pages) {
  return (pages || []).map((items, i) => '[[p' + (i + 1) + ']] ' + items.join(' ')).join('\n');
}

export function sheetTextFromRows(sheets) {
  return (sheets || []).map(s =>
    '[[sheet:' + s.name + ']] ' + s.rows.map(r => r.join(' ')).join('\n')).join('\n');
}

export function normalizeExtractedText(s) {
  return String(s || '').split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

export function extractionMethodFor(filename) {
  const ext = (/\.([a-z0-9]+)$/i.exec(filename || '') || [])[1]?.toLowerCase() || '';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'docx') return 'docx';
  if (['xlsx', 'xls', 'csv'].includes(ext)) return 'sheet';
  return 'none';
}

export function dedupeFilename(existingNames, name) {
  const taken = new Set(existingNames);
  if (!taken.has(name)) return name;
  const m = /^(.*?)(\.[^.]*)?$/.exec(name);
  const base = m[1], ext = m[2] || '';
  for (let n = 2; ; n++) {
    const candidate = base + ' (' + n + ')' + ext;
    if (!taken.has(candidate)) return candidate;
  }
}

export function docFolderPath(productName, docType) {
  if (!productName) return ['Documents', '_General'];
  return ['Documents', sanitizeFilename(productName), sanitizeFilename(docType || 'Other')];
}
```

- [ ] **Step 4: Run `npm test`** → PASS.
- [ ] **Step 5: Commit** — `git add -u && git commit -m "feat: brain-core extraction assembly and filing helpers"`

---

### Task 7: brain-core — search docs, snippets, supersession, from-comment

**Files:**
- Modify: `assets/js/brain-core.js`
- Test: `tests/brain-core.test.js`

**Interfaces:**
- Produces:
  - `buildSearchDocs(brain, hubComments, decompressedTextById) -> doc[]` — MiniSearch-ready docs `{ id: 'd:<id>'|'f:<id>'|'c:<id>', kind: 'decision'|'document'|'comment', title, text, tags, productIds, projectTag, date, who, status }`. Decisions: title, `decision + '\n' + reasoning` as text, who = madeBy. Documents: title, text = decompressed extracted text (from the supplied map; empty when absent), who = ''. Comments (from hub-data, read-only): title = ref + ' ' + category, text = description + actionTaken, who = raisedBy.
  - `snippetFor(text, terms, radius = 60) -> { snippet, marker }` — finds the first case-insensitive occurrence of any term; returns `radius` chars context each side with `…` ellipses; `marker` = nearest preceding `[[p<N>]]` → `'p.N'` or `[[sheet:X]]` → `'sheet X'`, else `''`. Markers are stripped from the snippet text.
  - `supersedeDecision(state, oldId, newDecision, nowIso) -> state` — new decision appended with `supersedes: oldId`; old decision gets `status:'superseded'`, `supersededBy: newDecision.id`, bumped `updatedAt`. Throws if oldId missing.
  - `decisionFromComment(comment, nowIso) -> partial decision` — `{ title: '', decision: '', reasoning: comment.description, productIds: [...comment.productIds], tags: [], links: { documents: [], comments: [comment.id], urls: [] }, date: nowIso-date, recordedBy: '', madeBy: '' }`.

- [ ] **Step 1: Write failing tests**

```js
// append to tests/brain-core.test.js
import { buildSearchDocs, snippetFor, supersedeDecision, decisionFromComment } from '../assets/js/brain-core.js';

test('buildSearchDocs covers all three kinds with prefixed ids', () => {
  const brain = { ...emptyBrainState('t'),
    decisions: [D('d1', 't')],
    documents: [{ id: 'f1', title: 'HAZOP 12 minutes', docType: 'HAZOP', date: '', productIds: ['p1'],
      projectTag: '', tags: [], filePath: 'x', accUrl: '', extraction: { method: 'pdf', pages: 2, textGz: 'zz' }, updatedAt: 't' }] };
  const comments = [{ id: 'c1', ref: 'HUB-0003', category: 'Instrument change', description: 'PT range', actionTaken: '', raisedBy: 'X', productIds: ['p2'] }];
  const docs = buildSearchDocs(brain, comments, new Map([['f1', '[[p1]] air valve text']]));
  assert.deepEqual(docs.map(d => d.id).sort(), ['c:c1', 'd:d1', 'f:f1']);
  assert.equal(docs.find(d => d.id === 'f:f1').text.includes('air valve'), true);
  assert.equal(docs.find(d => d.id === 'c:c1').who, 'X');
});

test('snippetFor returns context and page marker, strips markers from snippet', () => {
  const text = '[[p1]] irrelevant preamble here\n[[p2]] the air relief valve was rejected due to surge';
  const { snippet, marker } = snippetFor(text, ['relief'], 20);
  assert.equal(marker, 'p.2');
  assert.ok(snippet.includes('air relief valve'));
  assert.ok(!snippet.includes('[[p2]]'));
});

test('supersedeDecision links both directions and preserves history', () => {
  const s0 = { ...emptyBrainState('t'), decisions: [D('d1', 't')] };
  const s1 = supersedeDecision(s0, 'd1', D('d2', 't2', { supersedes: '', title: 'ARV now required' }), '2026-07-26T12:00:00Z');
  const oldD = s1.decisions.find(d => d.id === 'd1');
  const newD = s1.decisions.find(d => d.id === 'd2');
  assert.equal(oldD.status, 'superseded');
  assert.equal(oldD.supersededBy, 'd2');
  assert.equal(newD.supersedes, 'd1');
  assert.throws(() => supersedeDecision(s1, 'nope', D('d3', 't3'), 'now'));
});

test('decisionFromComment prefills reasoning, products, and back-link', () => {
  const p = decisionFromComment({ id: 'c9', description: 'why we changed it', productIds: ['p1', 'p2'] }, '2026-07-26T09:00:00Z');
  assert.equal(p.reasoning, 'why we changed it');
  assert.deepEqual(p.links.comments, ['c9']);
  assert.deepEqual(p.productIds, ['p1', 'p2']);
  assert.equal(p.date, '2026-07-26');
});
```

- [ ] **Step 2: Run `npm test`** → FAIL.

- [ ] **Step 3: Implement** (append to `assets/js/brain-core.js`)

```js
export function buildSearchDocs(brain, hubComments, textById) {
  const docs = [];
  for (const d of brain.decisions) {
    docs.push({ id: 'd:' + d.id, kind: 'decision', title: d.title,
      text: (d.decision || '') + '\n' + (d.reasoning || ''), tags: (d.tags || []).join(' '),
      productIds: d.productIds || [], projectTag: d.projectTag || '', date: d.date || '',
      who: d.madeBy || '', status: d.status || 'active' });
  }
  for (const f of brain.documents) {
    docs.push({ id: 'f:' + f.id, kind: 'document', title: f.title,
      text: (textById && textById.get(f.id)) || '', tags: (f.tags || []).join(' '),
      productIds: f.productIds || [], projectTag: f.projectTag || '', date: f.date || '',
      who: '', status: 'active' });
  }
  for (const c of hubComments || []) {
    docs.push({ id: 'c:' + c.id, kind: 'comment', title: (c.ref || '') + ' ' + (c.category || ''),
      text: (c.description || '') + '\n' + (c.actionTaken || ''), tags: '',
      productIds: c.productIds || [], projectTag: '', date: c.dateRaised || '',
      who: c.raisedBy || '', status: 'active' });
  }
  return docs;
}

const MARKER_RE = /\[\[(p(\d+)|sheet:([^\]]+))\]\]\s?/g;

export function snippetFor(text, terms, radius = 60) {
  const t = String(text || '');
  const lower = t.toLowerCase();
  let hit = -1;
  for (const term of terms || []) {
    const i = lower.indexOf(String(term).toLowerCase());
    if (i !== -1 && (hit === -1 || i < hit)) hit = i;
  }
  if (hit === -1) return { snippet: t.replace(MARKER_RE, '').slice(0, radius * 2), marker: '' };
  let marker = '';
  for (const m of t.slice(0, hit).matchAll(MARKER_RE)) {
    marker = m[2] ? 'p.' + m[2] : 'sheet ' + m[3];
  }
  const start = Math.max(0, hit - radius);
  const end = Math.min(t.length, hit + radius);
  const snippet = (start > 0 ? '…' : '') + t.slice(start, end).replace(MARKER_RE, '') + (end < t.length ? '…' : '');
  return { snippet, marker };
}

export function supersedeDecision(state, oldId, newDecision, nowIso) {
  const oldD = state.decisions.find(d => d.id === oldId);
  if (!oldD) throw new Error('supersedeDecision: unknown decision ' + oldId);
  const decisions = state.decisions
    .map(d => d.id === oldId ? { ...d, status: 'superseded', supersededBy: newDecision.id, updatedAt: nowIso } : d)
    .concat([{ ...newDecision, supersedes: oldId, updatedAt: nowIso }]);
  return { ...state, decisions };
}

export function decisionFromComment(comment, nowIso) {
  return {
    title: '', decision: '', reasoning: comment.description || '',
    madeBy: '', recordedBy: '', date: (nowIso || '').slice(0, 10),
    productIds: [...(comment.productIds || [])], projectTag: '', tags: [],
    status: 'active', supersededBy: '', supersedes: '',
    links: { documents: [], comments: [comment.id], urls: [] },
  };
}
```

- [ ] **Step 4: Run `npm test`** → PASS.
- [ ] **Step 5: Commit** — `git add -u && git commit -m "feat: brain-core search docs, snippets, supersession, from-comment"`

---

### Task 8: Product Brain shell — chrome, connect, read-only hub access

**Files:**
- Create: `tools-src/product-brain.html` (gitignored — NO commits, this task and all UI tasks)
- Reference: `tools-src/comments-hub.html` (post-Task-4) — copy its head/anti-flash/token-alias CSS/sidebar/folder-chip patterns exactly; brand "Product Brain" / "Standard Product Memory"; favicon letter "B"; title "Product Brain — Wessex Water".

**Interfaces:**
- Consumes: `/assets/js/brain-core.js` (as `BrainCore`), `/assets/js/hub-sync.js` (as `HubSync`), `/assets/js/hub-core.js` only via brain-core re-exports; vendored scripts: `minisearch.min.js`, `mammoth.browser.min.js`, `pdf.min.js` (+ worker path set as in the P&ID tool), `xlsx.full.min.js`.
- Produces globals for Tasks 9-11: `state` (brain), `hubState` (parsed hub-data.json or null), `dirHandle`, `documentsDirHandle`, `engine` (sync engine on brain-data.json), `queueSave(touched)` (renderAll-first wrapper), `textCache` (Map id→decompressed text, filled lazily via `BrainCore.gunzipText`), `products()` (from hubState, sorted), `todayIso/nowIso/genId/escHtml/escAttr/el/toast`, `switchTab`, `renderAll` with per-tab stubs.
- Tabs: Search (landing), Decisions, Documents, Products, Settings.

- [ ] **Step 1: Build shell + engine wiring** — engine config mirrors Task 4's but `fileName: 'brain-data.json'`, `backupName: 'brain-data.backup.json'`, `merge: BrainCore.mergeBrainState`, `afterSave: async () => rebuildSearchIndex()` (stub until Task 11). `connectFolder`: picker with AbortError-silent/other-errors-toasted (same as hub), then in try/catch: read `hub-data.json` READ-ONLY (plain read, never write; absent → `hubState = null` and a dismissible notice "No Comments Hub data found — open the Comments Hub once in this folder to seed products"), `documentsDirHandle = await dirHandle.getDirectoryHandle('Documents', { create: true })`, `engine.readLedger()` (corrupt → error chip + reset; ok → `state = mergeBrainState(state, data)`; missing → keep empty), `await engine.saveNow([])`, `renderAll()`.

- [ ] **Step 2: Verify in browser** — serve ({name:"site"}), open `/tools-src/product-brain.html`: renders light+dark zero console errors, tabs switch, sidebar collapses, window mirrors (state/hubState/dirHandle setters like the hub's Object.defineProperties block) present for testing. Fake-handle console check: corrupt brain-data.json blocks with error chip; missing hub-data.json shows the seed notice.

---

### Task 9: Documents tab — import pipeline

**Files:**
- Modify: `tools-src/product-brain.html`

**Interfaces:**
- Consumes: `BrainCore.extractionMethodFor/pdfPagesToText/sheetTextFromRows/normalizeExtractedText/gzipText/dedupeFilename/docFolderPath`, `engine.writeFile`, `documentsDirHandle`, `queueSave`.
- Produces: working drag-and-drop + file-picker import; `importFiles(fileList)`; documents table with type badges, edit/re-tag, delete (tombstone index entry only — file stays, with a toast saying so); "Link ACC document" form (accUrl entry, no file).

- [ ] **Step 1: Import pipeline** — per dropped file: metadata form (title from filename sans extension, docType select from `state.lists.docTypes`, date default today, product multi-select from `products()`, tags with datalist from `state.lists.tags`, optional project + ACC URL). On confirm: resolve target dir via `docFolderPath(firstProductName, docType)` chain of `getDirectoryHandle(..., { create: true })`; `dedupeFilename` against existing entries in that dir (list via `for await (entry of dir.values())`); copy file (`engine.writeFile(dir, name, await file.arrayBuffer())`); extract text by method — pdf: pdf.js `getDocument` → per page `getTextContent()` items' `str` → `pdfPagesToText` (progress bar per page; try/catch → 'none' + "no searchable text found" toast for image-only PDFs); docx: `mammoth.extractRawText({ arrayBuffer })`; sheet: `XLSX.read(arrayBuffer)` → `sheetTextFromRows(wb.SheetNames.map(n => ({ name: n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' }) })))`; none: skip. Then `normalizeExtractedText` → `gzipText` → document record (`filePath` = joined relative path) → `state = { ...state, documents: [...state.documents, rec] }` → `queueSave([])`. A "Skip extraction" checkbox on the form for huge files.

- [ ] **Step 2: Verify in browser** — real sample files (create in scratchpad: a text PDF, a DOCX, an XLSX; plus any scanned PDF if available). With fake handles this can't copy real files — so this task verifies with a REAL scratch folder via manual picker if the environment allows, otherwise: drive extraction functions directly (pdf.js/mammoth/XLSX are all loaded — run each on a sample ArrayBuffer in console and assert extracted text lands in a document record via the form path with a fake dir). Confirm: dedupe suffix on second import of same name, delete keeps file (fake dir shows no removal call — there is no remove API used anywhere), zero console errors.

---

### Task 10: Decisions tab

**Files:**
- Modify: `tools-src/product-brain.html`

**Interfaces:**
- Consumes: `BrainCore.supersedeDecision/decisionFromComment`, `hubState` (comments list for the picker), `queueSave`, `genId`.
- Produces: decisions table (filter: product/tag/status; superseded rows struck-through with "superseded by →" link), New decision form (all record fields; madeBy + recordedBy separate inputs, never pre-filled; tags/projects with "+ add" inline feeding `state.lists`), edit in place, Supersede action (opens the form pre-linked; on submit calls `supersedeDecision(state, oldId, { ...formRecord, id: genId() }, nowIso())` then `queueSave([])`), "From comment…" (searchable picker over `hubState.comments`; selection → form prefilled via `decisionFromComment`; saved record keeps `links.comments`; viewing a decision with comment links shows the source comment read-only with "manage it in the Comments Hub" note), Delete (confirm → tombstone).

- [ ] **Step 1: Build it** per above — reuse the hub's form/table/chip CSS patterns already copied into this file.

- [ ] **Step 2: Verify in browser** — seed products + comments via window mirrors; create decision, edit, supersede (old struck-through, links both ways in `state`), from-comment prefill carries reasoning/products/back-link, delete stays deleted after simulated remerge (`state = BrainCore.mergeBrainState(state, stale-copy)`), zero console errors, light + dark.

---

### Task 11: Search + Products + Settings tabs, index wiring

**Files:**
- Modify: `tools-src/product-brain.html`

**Interfaces:**
- Consumes: `MiniSearch` global, `BrainCore.buildSearchDocs/snippetFor/gunzipText`, `textCache`, `hubState`.
- Produces: `rebuildSearchIndex()` (real; replaces Task 8 stub) — decompress all document texts into `textCache` (lazy-safe: on first rebuild, `await gunzipText` each; subsequent rebuilds reuse cache for unchanged ids), `buildSearchDocs(state, hubState?.comments || [], textCache)`, `new MiniSearch({ fields: ['title', 'tags', 'text'], storeFields: ['kind', 'title', 'productIds', 'projectTag', 'date', 'who', 'status'], searchOptions: { boost: { title: 3, tags: 2 }, fuzzy: 0.2, prefix: true } })` + `addAll`. Search tab: box + scope row (product select, kind chips, docType select, project select) — scope filters applied to MiniSearch results post-query (filter on storeFields); results grouped Decisions/Documents/Comments; each hit: title, product names, date, who, `snippetFor(fullText, queryTerms)` snippet with `<mark>` on matched terms (escape first, then mark) and page/sheet marker; superseded struck-through + pointer; click-through: decisions open in Decisions tab expanded; documents open the file (`documentsDirHandle` → subdir walk from filePath → `getFileHandle` → `URL.createObjectURL(await fh.getFile())` in new tab) or `accUrl`; comments open a read-only detail overlay. Products tab: product picker → active decisions, superseded (collapsed `<details>`), documents grouped by type, open comments (live from hubState), all click-through. Settings tab: editable tags/projects/docTypes lists (add/rename/remove — removals never touch existing records), "Rebuild search index" button (calls `rebuildSearchIndex()`), "Re-extract document" (pick a document with `filePath` → re-run the Task 9 extraction on the stored file → replace `extraction` → `queueSave([])`).

- [ ] **Step 1: Build it** per above.

- [ ] **Step 2: Verify in browser** — seed decisions/documents (with gzipped text via console `await BrainCore.gzipText(...)`) + comments; search "air releif" (typo) finds the ARV decision; "ARV" prefix-matches; document hit shows `p.2` marker; comment hits appear; scoping to a product excludes others; Products tab lists everything and cross-clicks work; zero console errors.

---

### Task 12: Register on the site, preview, deploy

**Files:**
- Modify: `data/tools.json`, `tests/tools.test.js` (tool count 6 → 7, slug appended)
- Create: `assets/img/previews/product-brain.webp`
- Regenerated at lock step: `tools/*.html`, `tools/vault-manifest.json`

- [ ] **Step 1: tools.json entry + test**

```json
{ "slug":"product-brain","name":"Product Brain","blurb":"The searchable memory for standard products — decision records with the who and why, HAZOPs and minutes indexed to the word, one search across everything.","href":"/tools/product-brain.html","tags":["Knowledge","Search"],"locked":true }
```
Update `tests/tools.test.js` expected slugs/count (6→7). `npm test` → green.

- [ ] **Step 2: Preview webp** — headless-Edge seeded screenshot of the Search tab with results visible (same technique as the Comments Hub preview: seeded copy in tools-src, capture 1280×800 light, convert via `npx -y sharp-cli`, delete the seeded copy), save `assets/img/previews/product-brain.webp`.

- [ ] **Step 3: Commit** — `git add data/tools.json tests/tools.test.js assets/img/previews/product-brain.webp && git commit -m "feat: register Product Brain tool card and preview"`

- [ ] **Step 4: USER/controller — lock + deploy.** Ask Harvey for the workshop code in chat (never stored on disk); run lock-tools via the delayed-stdin harness; verify checkKey + all 7 payloads byte-identical vs tools-src; commit `tools/`, merge/push; live-verify loader + assets 200, tools-src 404.

- [ ] **Step 5: Post-deploy** — Harvey click-through: connect the real hub folder in the brain, confirm `brain-data.json` + `Documents/` appear, hub files untouched, import one real HAZOP PDF and find it by search.
