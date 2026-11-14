# P&ID Symbol Search (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Symbols tab to the P&ID Tag Register that builds a symbol library from the legend PDF, lets anyone connected fix it up and annotate it, and searches it.

**Architecture:** Three small tracked modules carry the behaviour: `pid-symbols.js` (pure: geometry walker, table cells, library, search, carry-over), `pid-symbols-view.js` (pure HTML and SVG strings, all escaping), and `pid-symbol-store.js` (reads and writes `symbol-library.json` through a directory handle passed in). The gitignored tool only fetches operator lists and text from pdf.js, holds state, and wires clicks to module calls. A local-only script runs the same module code over the real legend in Node for Gate 1.

**Tech Stack:** Vanilla ES modules, `node --test` on Node 20, pdf.js 3.11.174 (vendored, also loadable in Node), File System Access API, the preview server (`.claude/launch.json` config `site`, port 5050).

**Spec:** `docs/superpowers/specs/2026-11-13-pid-symbol-library-and-check-design.md`. Phase 1 only. Phases 2 and 3 are context, not scope.

## Global Constraints

- **The repository is public.** No Wessex Water data in `assets/js/`, `scripts/`, `docs/`, tests or fixtures: no legend geometry, no legend symbol lists, no drawing numbers, site, contractor or supplier names. Tests use invented symbols and invented tables only. The legend, the drawings and the test's outputs live in `../pid-symbol-spike/` beside the repository and are never copied in.
- **Nothing in this work writes `register.json`.** The only files written are `symbol-library.json` and `backups/symbol-library-<stamp>.json`, both in the register folder. The Symbols glue never calls `saveToFolder()` or `scheduleSave()`.
- **A failed read never leads to a write.** Library reads are three-state (`ok` / `missing` / `unreadable`). Writes go through `writeFileAtomic` from `assets/js/hub-sync.js`. A save is refused when the file on disk is not byte-identical to what this session loaded.
- **Pure modules do not throw.** Every exported function in `pid-symbols.js` and `pid-symbols-view.js` returns degraded output on any input, as `pid-core.js` does. `pid-symbol-store.js` does I/O and may reject on a failed write; it never rejects on a failed read.
- **Zero build, no new dependencies.** pdf.js 3.11.174 at `assets/vendor/pdf.min.js` and `pdf.worker.min.js` is the only PDF reader. Operators are addressed by `OPS` name, never by number.
- **Units.** All geometry is in PDF points with a top-left origin, as produced by `page.getViewport({ scale: 1 }).transform`.
- **`tools-src/` is gitignored.** Tool edits are invisible in git, so the tool side stays thin glue. Never run `scripts/lock-tools.mjs`; the owner does that.
- **Do not commit.** The owner commits when he asks. Each task ends with a checkpoint that lists its files and a message to use if he has asked.
- **Not built in this phase:** `rasterise`, `matchAt`, `checkTag`, `sheetVerdicts`, `page.getAnnotations()`, any change to import of P&IDs, any editing of `families`.
- **Baseline before starting:** `npm test` gives 661 tests, 659 passing, 0 failing, 2 skipped.

## Settled before this plan was written

Measured on 2026-11-13 with throwaway scripts (kept in the shared notes folder, not in the repository). These are the numbers the gates below expect.

- **The vendored pdf.js loads in Node 20.** `package.json` has `"type": "module"`, so `require()` refuses the UMD files; evaluating each file inside a CommonJS-shaped `vm` wrapper works, with `globalThis.pdfjsWorker` set to the worker's exports. All six legend pages gave operator lists, text and viewports. Gate 1 therefore has a Node script.
- **`constructPath` args are `[ops, coords, minMax]`** in this build, with a separate paint operator after each path. Greys arrive as `setStrokeRGBColor` with 0 to 255 values. `paintFormXObjectBegin` args are `[matrix, bbox]`.
- **The legend uses paint operators the brief did not list:** `closeFillStroke` (most paths on the sheets) and `endPath` after `clip`. The walker handles every paint operator.
- **pdf.js reproduces the test's extraction and betters it.** A prototype cell finder over pdf.js geometry gave **389** symbol rows (sheet 1: 37, sheet 2: 139, sheet 3: 78, sheet 4: 83, sheet 5: 33, sheet 6: 19) against the test's 376. 374 of the test's 376 names are present; the other 2 are the test's own junk entries (the line-type and tie-in boxes it merged into one "symbol" each). The 15 extra are final rows the test missed. No row inside a headed table failed to split. 371 of the 374 shared names agree on size within 2 pt; **2 rows on sheet 4 differ by up to 11 pt and that is unexplained.**
- **Every headed table read its heading; tag identifiers read wherever the table has one.**
- **The instrument-bubble table has no column divider and no heading row.** It comes out as 13 rows of an "other ruled area", not as symbols. The design already treats bubbles as manual entries in this phase.
- **Title blocks:** a `SHEET <n>` word and a `REV.` label with the revision directly below it were found on all six pages.
- **The library file will be about 0.5 MB:** 389 symbols hold about 75,000 coordinate numbers.

## Decisions made in this plan

Marked for the owner to overrule at review. None changes the design's intent.

1. **`letters` hold positions**, `{ text, x, y, size }`, not bare strings. 34 legend symbols carry a letter (an actuator's M, for example) and would otherwise draw as identical empty shapes.
2. **Each symbol keeps `legendName`**, the label as extracted, beside the editable `name`. Re-importing a legend then still matches a symbol the owner renamed.
3. **`flags.unmatched`.** On re-import, an old symbol that holds notes or aliases and finds no match is kept and flagged, so "listed, not dropped" survives the save.
4. **Paths gain `stroked`** beside the design's `segs, width, filled, grey`, so a hairline and a fill-only shape can be told apart.
5. **Every changed save backs up the previous file** to `backups/`, 20 deep, as the register does.
6. **Saving is an explicit button**, with an "Unsaved changes" marker. No autosave timer.
7. **The Symbols button sits outside the hidden tab list**, so the tab works with an empty register and no folder.
8. **The tab's HTML is built in a tested module**, because library text comes from a shared folder and must be escaped.
9. **The header words `SYMBOL`, `FUNCTIONAL TAG IDENTIFIER`, `SHEET` and `REV.` are defaults in the public module**, overridable by option. They are column and title-block labels, not reference data.
10. **Exceptions carry over unconditionally** on re-import. They name items with no symbol, so there is nothing to match them to. Any whose name now equals a symbol is listed for the owner.
11. **The import control also accepts a library `.json`.** This is the design's fallback path, built in from the start.
12. **Rows of ruled areas that are not symbol tables** are listed under "Other ruled areas", each with "Add as manual entry". The bubble table is entered this way.

## File structure

| File | Responsibility |
|---|---|
| `scripts/pdfjs-node.mjs` (create) | Load the vendored pdf.js in Node; open a PDF. |
| `assets/js/pid-symbols.js` (create) | Pure. Operator list to paths, text items to words, ruled tables to rows, title block, library build, parse, edit, carry-over, search. |
| `assets/js/pid-symbols-view.js` (create) | Pure strings. `esc`, inline SVG for a symbol, the tab's HTML regions, message copy. |
| `assets/js/pid-symbol-store.js` (create) | Read, decide and save `symbol-library.json` through a directory handle. |
| `scripts/check-symbol-import.mjs` (create) | Local-only Gate 1 check. Not in `npm test`. |
| `tests/fixtures/tiny-pdf.js`, `symbol-ops.js`, `symbol-table.js`, `invented-symbol-library.json` (create) | Invented test material. |
| `tests/pdfjs-node.test.js`, `pid-symbols.test.js`, `pid-symbols-view.test.js`, `pid-symbol-store.test.js`, `check-symbol-import.test.js` (create) | Tests. |
| `tools-src/pid-tag-register.html` (modify, gitignored) | Symbols button, tab skeleton, state, glue, module imports. |

## Review Focus

The inputs most likely to bite a user that the design implies but does not spell out. Each has a test in the task named.

1. **A second person saves the library while it is open here, or a library is imported while disconnected and the folder already holds one.** Expected: the save is refused and nothing is overwritten. Task 8.
2. **Re-importing the legend after symbols were renamed, annotated or added by hand.** Expected: renames, notes, aliases, flags and manual entries survive; anything unmatched is kept and flagged. Task 7.
3. **A library file edited by hand or damaged in sync: markup in a name, wrong types, a newer version number.** Expected: text is shown escaped; a structurally bad or newer file is `unreadable`, which blocks saving. Tasks 4, 8, 9.
4. **Two symbols with the same name in one table** (the legend has two such pairs). Expected: both kept, distinct ids, carry-over pairs them in order. Tasks 4, 7.
5. **A PDF that is not a legend, or a legend whose text or page is rotated.** Expected: zero symbols is reported as such and the library in use is untouched; rotated text still lands in the right cell. Tasks 2, 6, 10.

---

### Task 1: Load the vendored pdf.js in Node and pin its operator-list shape

**Files:**
- Create: `scripts/pdfjs-node.mjs`
- Create: `tests/fixtures/tiny-pdf.js`
- Test: `tests/pdfjs-node.test.js`

**Interfaces:**
- Produces: `loadVendoredPdfjs() -> pdfjsLib` (cached), `openPdf(data: Uint8Array) -> Promise<PDFDocumentProxy>`, `tinyPdf(content: string, formContent?: string) -> Uint8Array`, `TINY_CONTENT`, `TINY_FORM`.

- [ ] **Step 1: Write the fixture.** `tests/fixtures/tiny-pdf.js` builds a one-page, 200 by 100 pt PDF from a content stream. The drawing is invented.

```js
// tests/fixtures/tiny-pdf.js
// A hand-built PDF with invented linework, so the walker can be tested against
// what the vendored pdf.js really emits without any client drawing.
export function tinyPdf(content, formContent = '') {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> /XObject << /X1 6 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Type /XObject /Subtype /Form /BBox [0 0 50 50] /Matrix [1 0 0 1 100 0] /Length ${formContent.length} >>\nstream\n${formContent}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, c => c.charCodeAt(0)); // ASCII only; no Buffer, so it also runs in a browser
}

export const TINY_CONTENT = [
  '2 w 10 10 m 60 10 l S',                         // 2 pt black line
  '0.5 G 1 w 10 20 30 15 re S',                    // grey rectangle outline
  'q 0.5 0 0 0.5 0 0 cm 4 w 20 80 m 120 80 l S Q', // drawn at half scale
  '0 g 70 60 m 80 60 l 75 70 l h f',               // filled triangle
  '0 G 1 w 10 50 m 20 70 40 70 50 50 c S',         // one Bezier
  '/X1 Do',                                        // form XObject, moved 100 pt right
  'BT /F1 10 Tf 12 85 Td (HELLO) Tj ET',
].join('\n');
export const TINY_FORM = '1 w 0 0 m 10 0 l S';
```

- [ ] **Step 2: Write the failing tests** in `tests/pdfjs-node.test.js`.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadVendoredPdfjs, openPdf } from '../scripts/pdfjs-node.mjs';
import { tinyPdf, TINY_CONTENT, TINY_FORM } from './fixtures/tiny-pdf.js';

async function tinyPage() {
  const pdfjsLib = loadVendoredPdfjs();
  const page = await (await openPdf(tinyPdf(TINY_CONTENT, TINY_FORM))).getPage(1);
  return { pdfjsLib, OPS: pdfjsLib.OPS, page, ol: await page.getOperatorList() };
}

test('the vendored pdf.js loads in Node', () => {
  const pdfjsLib = loadVendoredPdfjs();
  assert.equal(pdfjsLib.version, '3.11.174');
  assert.equal(typeof pdfjsLib.OPS.constructPath, 'number');
  assert.equal(loadVendoredPdfjs(), pdfjsLib); // cached
});

test('constructPath args are [ops, coords, minMax], painted by a separate operator', async () => {
  const { OPS, ol } = await tinyPage();
  const i = ol.fnArray.indexOf(OPS.constructPath);
  const args = ol.argsArray[i];
  assert.equal(args.length, 3);
  assert.deepEqual(Array.from(args[0]), [OPS.moveTo, OPS.lineTo]);
  assert.deepEqual(Array.from(args[1]), [10, 10, 60, 10]);
  assert.equal(ol.fnArray[i + 1], OPS.stroke);
});

test('greys arrive as 0-255 RGB and a form carries its matrix first', async () => {
  const { OPS, ol } = await tinyPage();
  assert.deepEqual(Array.from(ol.argsArray[ol.fnArray.indexOf(OPS.setStrokeRGBColor)]), [128, 128, 128]);
  assert.deepEqual(Array.from(ol.argsArray[ol.fnArray.indexOf(OPS.paintFormXObjectBegin)][0]), [1, 0, 0, 1, 100, 0]);
});

test('the scale-1 viewport transform flips to a top-left origin', async () => {
  const { page } = await tinyPage();
  assert.deepEqual(page.getViewport({ scale: 1 }).transform, [1, 0, 0, -1, 0, 100]);
});

test('text items carry str, transform, width and height', async () => {
  const { page } = await tinyPage();
  const item = (await page.getTextContent()).items.find(i => i.str === 'HELLO');
  assert.deepEqual(item.transform, [10, 0, 0, 10, 12, 85]);
  assert.equal(item.height, 10);
  assert.ok(item.width > 20 && item.width < 45);
});
```

- [ ] **Step 3: Run to see them fail.** Run: `node --test tests/pdfjs-node.test.js`. Expected: FAIL, cannot find `scripts/pdfjs-node.mjs`.

- [ ] **Step 4: Write `scripts/pdfjs-node.mjs`.** The loader is the one thing here the tests do not determine, so it is given.

```js
// scripts/pdfjs-node.mjs
// Loads the SAME pdf.js the tools ship (assets/vendor/) inside Node, so local
// checks and tests read a PDF exactly as the browser does.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const VENDOR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'vendor');
const require = createRequire(import.meta.url);
let cached = null;

// package.json says "type": "module", so Node refuses to require() these UMD
// builds. Evaluate each inside a CommonJS-shaped wrapper instead.
function loadUmd(file) {
  const module = { exports: {} };
  const wrapper = vm.runInThisContext(
    '(function (module, exports, require) {' + fs.readFileSync(file, 'utf8') + '\n})', { filename: file });
  wrapper.call(module.exports, module, module.exports, require);
  return module.exports;
}

export function loadVendoredPdfjs() {
  if (cached) return cached;
  // With no real Worker available, pdf.js runs its worker code in-process when
  // it finds it on globalThis.pdfjsWorker.
  globalThis.pdfjsWorker = loadUmd(path.join(VENDOR, 'pdf.worker.min.js'));
  cached = loadUmd(path.join(VENDOR, 'pdf.min.js'));
  return cached;
}

export async function openPdf(data) {
  return loadVendoredPdfjs().getDocument({ data, disableFontFace: true, isEvalSupported: false, verbosity: 0 }).promise;
}
```

- [ ] **Step 5: Run to see them pass.** Run: `node --test tests/pdfjs-node.test.js`. Expected: 5 pass. If the `constructPath` test fails, stop: the walker in Task 2 depends on that shape.

- [ ] **Step 6: Checkpoint.** Files: the three above. Message if the owner has asked for commits: `test: load vendored pdf.js in Node and pin its operator-list shape`.

---

### Task 2: Geometry walker and text boxes

**Files:**
- Create: `assets/js/pid-symbols.js`
- Create: `tests/fixtures/symbol-ops.js`
- Test: `tests/pid-symbols.test.js`

**Interfaces:**
- Consumes: `loadVendoredPdfjs`, `openPdf`, `tinyPdf`, `TINY_CONTENT`, `TINY_FORM` from Task 1.
- Produces:
  - `Path = { segs: number[], width: number, stroked: boolean, filled: boolean, grey: number }`. `segs` is flat, four numbers per straight segment (`x0, y0, x1, y1`). A new subpath begins wherever a segment does not start where the previous one ended. `width` is the stroke width in points, 0 when not stroked. `grey` is 0 (black) to 255 (white): the stroke colour when stroked, else the fill colour, as `Math.round(0.299 r + 0.587 g + 0.114 b)`.
  - `Word = { str: string, x: number, y: number, w: number, h: number }`, a top-left box.
  - `CURVE_STEPS = 8`
  - `pagePaths(fnArray, argsArray, OPS, viewportTransform) -> Path[]`
  - `textWords(items, viewportTransform) -> Word[]`

- [ ] **Step 1: Write the operator fixture.** The numbers are deliberately not pdf.js's, so a walker that hard-codes operator numbers fails.

```js
// tests/fixtures/symbol-ops.js
const NAMES = ['save', 'restore', 'transform', 'constructPath', 'stroke', 'closeStroke', 'fill', 'eoFill',
  'fillStroke', 'eoFillStroke', 'closeFillStroke', 'closeEOFillStroke', 'endPath', 'clip', 'setLineWidth',
  'setStrokeRGBColor', 'setFillRGBColor', 'paintFormXObjectBegin', 'paintFormXObjectEnd',
  'moveTo', 'lineTo', 'curveTo', 'curveTo2', 'curveTo3', 'closePath', 'rectangle', 'showText'];
export const FAKE_OPS = Object.fromEntries(NAMES.map((n, i) => [n, 901 + i]));
const LETTER = { M: 'moveTo', L: 'lineTo', C: 'curveTo', V: 'curveTo2', Y: 'curveTo3', Z: 'closePath', R: 'rectangle' };

// steps: ['save'], ['setLineWidth', 2], ['path', ['M', 10, 10, 'L', 60, 10]], ['stroke'] ...
// A 'path' step becomes constructPath with args [ops, coords, null], as pdf.js 3.11 emits.
export function opList(steps) {
  const fnArray = [], argsArray = [];
  for (const [name, ...args] of steps) {
    if (name === 'path') {
      const ops = [], coords = [];
      for (const t of args[0]) (typeof t === 'string' ? ops.push(FAKE_OPS[LETTER[t]]) : coords.push(t));
      fnArray.push(FAKE_OPS.constructPath); argsArray.push([ops, coords, null]);
    } else {
      fnArray.push(FAKE_OPS[name]); argsArray.push(args.length ? args : null);
    }
  }
  return { fnArray, argsArray };
}
```

- [ ] **Step 2: Write the failing tests** at the top of a new `tests/pid-symbols.test.js`.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pagePaths, textWords, CURVE_STEPS } from '../assets/js/pid-symbols.js';
import { FAKE_OPS as O, opList } from './fixtures/symbol-ops.js';
import { loadVendoredPdfjs, openPdf } from '../scripts/pdfjs-node.mjs';
import { tinyPdf, TINY_CONTENT, TINY_FORM } from './fixtures/tiny-pdf.js';

const FLIP = [1, 0, 0, -1, 0, 100]; // a 100 pt tall page at scale 1
const walk = (steps, vt = FLIP) => { const l = opList(steps); return pagePaths(l.fnArray, l.argsArray, O, vt); };
const line = ['path', ['M', 0, 0, 'L', 10, 0]];

test('pagePaths: a stroked line, in top-left points', () => {
  assert.deepEqual(walk([['setLineWidth', 2], ['path', ['M', 10, 10, 'L', 60, 10]], ['stroke']]),
    [{ segs: [10, 90, 60, 90], width: 2, stroked: true, filled: false, grey: 0 }]);
});

test('pagePaths: a transform scales coordinates and width; restore undoes both', () => {
  const p = walk([['save'], ['transform', 0.5, 0, 0, 0.5, 0, 0], ['setLineWidth', 4],
    ['path', ['M', 20, 80, 'L', 120, 80]], ['stroke'], ['restore'], line, ['stroke']]);
  assert.deepEqual(p[0].segs, [10, 60, 60, 60]);
  assert.equal(p[0].width, 2);
  assert.deepEqual(p[1].segs, [0, 100, 10, 100]);
  assert.equal(p[1].width, 1); // the PDF default line width
});

test('pagePaths: a rectangle is four segments back to its start', () => {
  assert.deepEqual(walk([['path', ['R', 10, 20, 30, 15]], ['stroke']])[0].segs,
    [10, 80, 40, 80, 40, 80, 40, 65, 40, 65, 10, 65, 10, 65, 10, 80]);
});

test('pagePaths: each curve form flattens to CURVE_STEPS segments ending on its end point', () => {
  for (const curve of [['C', 20, 70, 40, 70, 50, 50], ['V', 40, 70, 50, 50], ['Y', 20, 70, 50, 50]]) {
    const s = walk([['path', ['M', 10, 50, ...curve]], ['stroke']])[0].segs;
    assert.equal(s.length, CURVE_STEPS * 4);
    assert.deepEqual(s.slice(0, 2), [10, 50]);
    assert.ok(Math.abs(s[s.length - 2] - 50) < 1e-9 && Math.abs(s[s.length - 1] - 50) < 1e-9);
  }
});

test('pagePaths: fill, fill-and-stroke and the closing variants', () => {
  const tri = ['path', ['M', 70, 60, 'L', 80, 60, 'L', 75, 70]];
  const f = walk([['setFillRGBColor', 255, 0, 0], tri, ['fill']])[0];
  assert.deepEqual([f.stroked, f.filled, f.width, f.grey, f.segs.length], [false, true, 0, 76, 8]);
  const b = walk([['setStrokeRGBColor', 128, 128, 128], tri, ['closeFillStroke']])[0];
  assert.deepEqual([b.stroked, b.filled, b.grey, b.segs.length], [true, true, 128, 12]);
  assert.deepEqual(b.segs.slice(8), [75, 30, 70, 40]); // the closing segment
  assert.equal(walk([tri, ['closeStroke']])[0].segs.length, 12);
  for (const op of ['eoFill', 'fillStroke', 'eoFillStroke', 'closeEOFillStroke']) assert.equal(walk([tri, [op]]).length, 1);
});

test('pagePaths: a clip path ended with endPath draws nothing', () => {
  assert.deepEqual(walk([line, ['clip'], ['endPath'], line, ['stroke']]).length, 1);
});

test('pagePaths: a form XObject applies its matrix and restores after', () => {
  const p = walk([['paintFormXObjectBegin', [1, 0, 0, 1, 100, 0], [0, 0, 50, 50]], line, ['stroke'],
    ['paintFormXObjectEnd'], line, ['stroke']]);
  assert.deepEqual(p.map(x => x.segs), [[100, 100, 110, 100], [0, 100, 10, 100]]);
});

test('pagePaths: a stroke gives one path per subpath, a fill keeps its subpaths together; colour follows save and restore', () => {
  const pair = ['path', ['M', 0, 0, 'L', 10, 0, 'M', 20, 0, 'L', 30, 0]];
  assert.deepEqual(walk([pair, ['stroke']]).map(x => x.segs), [[0, 100, 10, 100], [20, 100, 30, 100]]);
  assert.deepEqual(walk([pair, ['fill']]).map(x => x.segs), [[0, 100, 10, 100, 20, 100, 30, 100]]);
  assert.deepEqual(walk([pair, ['fillStroke']]).length, 1);
  const c = walk([['save'], ['setStrokeRGBColor', 255, 255, 255], line, ['stroke'], ['restore'], line, ['stroke']]);
  assert.deepEqual(c.map(x => x.grey), [255, 0]);
});

test('pagePaths: hostile input degrades and never throws', () => {
  for (const bad of [undefined, null, 5, 'x', {}]) assert.deepEqual(pagePaths(bad, bad, bad, bad), []);
  assert.doesNotThrow(() => pagePaths([O.constructPath, O.stroke, O.restore, 77777], [null, null], O, FLIP));
  assert.doesNotThrow(() => pagePaths([O.constructPath, O.stroke], [[[O.moveTo, O.lineTo, O.curveTo], [1, 2, NaN], null], null], O, FLIP));
  assert.deepEqual(walk([['path', ['M', 0, 0, 'L', Infinity, 0]], ['stroke']]), []);
});

test('pagePaths: matches what the vendored pdf.js emits for an invented page', async () => {
  const pdfjsLib = loadVendoredPdfjs();
  const page = await (await openPdf(tinyPdf(TINY_CONTENT, TINY_FORM))).getPage(1);
  const ol = await page.getOperatorList();
  const p = pagePaths(ol.fnArray, ol.argsArray, pdfjsLib.OPS, page.getViewport({ scale: 1 }).transform);
  assert.equal(p.length, 6);
  assert.deepEqual(p[0], { segs: [10, 90, 60, 90], width: 2, stroked: true, filled: false, grey: 0 });
  assert.deepEqual([p[1].segs.length, p[1].width, p[1].grey], [16, 1, 128]);
  assert.deepEqual([p[2].segs, p[2].width], [[10, 60, 60, 60], 2]);
  assert.deepEqual([p[3].filled, p[3].stroked, p[3].segs.length], [true, false, 12]);
  assert.equal(p[4].segs.length, CURVE_STEPS * 4);
  assert.deepEqual(p[5].segs, [100, 100, 110, 100]);
});

test('textWords: an upright item becomes a top-left box', () => {
  assert.deepEqual(textWords([{ str: ' HELLO ', transform: [10, 0, 0, 10, 12, 85], width: 32, height: 10 }], FLIP),
    [{ str: 'HELLO', x: 12, y: 5, w: 32, h: 10 }]);
});

test('textWords: text running up the page gets a tall box, not a wide one', () => {
  assert.deepEqual(textWords([{ str: 'UP', transform: [0, 10, -10, 0, 50, 20], width: 30, height: 10 }], FLIP),
    [{ str: 'UP', x: 40, y: 50, w: 10, h: 30 }]);
});

test('textWords: blanks dropped, hostile input degrades', () => {
  assert.deepEqual(textWords([{ str: '   ', transform: [1, 0, 0, 1, 0, 0], width: 1, height: 1 }, null, 7, { str: 'X' }], FLIP), []);
  for (const bad of [undefined, null, 5, {}]) assert.deepEqual(textWords(bad, bad), []);
});
```

- [ ] **Step 3: Run to see them fail.** Run: `node --test tests/pid-symbols.test.js`. Expected: FAIL, module not found.

- [ ] **Step 4: Implement `pagePaths` and `textWords`** in `assets/js/pid-symbols.js`. Open the file with a header comment in the style of `pid-core.js` saying the module is pure and that the symbol library is client data that must never be placed in it. Rules the tests do not fully determine:
  - State is `{ ctm, lineWidth: 1, stroke: [0,0,0], fill: [0,0,0] }`, starting with `ctm = viewportTransform`. `save` and `paintFormXObjectBegin` push a copy; `restore` and `paintFormXObjectEnd` pop (a pop on an empty stack is ignored). `transform` and a form's matrix post-multiply the CTM.
  - `constructPath` appends transformed segments to a pending list using the CTM at that moment. Every paint operator empties the pending list. **A paint that only strokes gives one `Path` per subpath; a paint that fills gives one `Path` holding all its subpaths**, so a shape with a hole keeps its hole. This split matters: plotted drawings batch unrelated lines into one stroke, and the cell finder in Task 3 keeps a path only when all of it lies in one cell. It is the grouping the planning measurement used. `endPath` clears the list without output. The closing paint operators (`closeStroke`, `closeFillStroke`, `closeEOFillStroke`) add a segment back to each open subpath's start, as `closePath` does.
  - Inside `constructPath`, `args[0]` is a list of `OPS` numbers and `args[1]` the coordinates they consume: `moveTo` 2, `lineTo` 2, `curveTo` 6 (two control points, end point), `curveTo2` 4 (the first control point is the current point; then second control point, end point), `curveTo3` 4 (first control point, end point; the second control point is the end point), `closePath` 0, `rectangle` 4 (`x, y, w, h`, drawn as four segments back to its start). Each curve becomes `CURVE_STEPS` straight segments at equal parameter steps.
  - `width` = line width times `Math.sqrt(Math.abs(a*d - b*c))` of the CTM at paint time.
  - A path with any non-finite coordinate is dropped whole. Operators not named above are ignored.
  - `textWords`: compose `m = viewportTransform x item.transform`. The origin is `(m[4], m[5])`, the baseline direction is `(m[0], m[1])` normalised, the up direction is `(m[2], m[3])` normalised. The box is the bounds of the four corners `origin`, `origin + dir*width`, `origin + up*height`, and their sum. Items whose trimmed `str` is empty, or with non-finite numbers, are skipped.

- [ ] **Step 5: Run to see them pass.** Run: `node --test tests/pid-symbols.test.js`. Expected: 13 pass.

- [ ] **Step 6: Checkpoint.** Files: `assets/js/pid-symbols.js`, `tests/fixtures/symbol-ops.js`, `tests/pid-symbols.test.js`. Message: `feat(pid): walk a pdf.js operator list into page-point paths`.

---

### Task 3: Ruled tables to symbol rows

**Files:**
- Modify: `assets/js/pid-symbols.js`
- Create: `tests/fixtures/symbol-table.js`
- Test: `tests/pid-symbols.test.js` (append)

**Interfaces:**
- Consumes: `Path`, `Word`, `pagePaths`, `textWords` from Task 2.
- Produces:
  - `legendCells(paths, words, options?) -> { tables, rows, unsplit, other, emptyRows }`
    - `options`: `{ symbolWord = 'SYMBOL', tagIdLabel = 'FUNCTIONAL TAG IDENTIFIER', minRule = 150 }`
    - `tables: [{ header, tagId, symbolSide: 'left' | 'right', box: [x0, y0, x1, y1], rowCount }]`
    - `rows: [{ table, label, header, tagId, symbolPaths: Path[], lettersInside: [{ text, x, y, size }], box }]`. `table` indexes `tables`. `box` bounds `symbolPaths`, in page points.
    - `unsplit: [{ table, header, reason, text, pathCount, box }]`, `reason` one of `'no divider' | 'several dividers' | 'no label' | 'no linework'`.
    - `other: [{ box, rows: [{ text, pathCount, box }] }]`, ruled areas with no heading row. `text` is cut to 120 characters.
    - `emptyRows: number`
  - `titleBlock(words) -> { sheet: string, rev: string }`
  - `readLegendPage({ fnArray, argsArray, OPS, viewportTransform, textItems, page }) -> { page, sheet, rev, tables, rows, unsplit, other, emptyRows }`

- [ ] **Step 1: Write the table fixture.** Invented geometry, with helpers to turn it back into operator lists for `readLegendPage`.

```js
// tests/fixtures/symbol-table.js
// Invented ruled tables. Nothing here comes from a real legend.
import { FAKE_OPS } from './symbol-ops.js';

export const rule = (x0, y0, x1, y1) => ({ segs: [x0, y0, x1, y1], width: 0.7, stroked: true, filled: false, grey: 0 });
export const box = (x, y, w, h) => ({
  segs: [x, y, x + w, y, x + w, y, x + w, y + h, x + w, y + h, x, y + h, x, y + h, x, y],
  width: 0.7, stroked: true, filled: false, grey: 0 });
export const word = (str, x, y, w = str.length * 5, h = 8) => ({ str, x, y, w, h });

// ys: every horizontal rule, top border to bottom border. The divider runs from
// the top down to ys[dividerTo].
export function ruledTable({ x0, x1, divider, ys, dividerTo = ys.length - 1 }) {
  const paths = ys.map(y => rule(x0, y, x1, y));
  paths.push(rule(x0, ys[0], x0, ys[ys.length - 1]), rule(x1, ys[0], x1, ys[ys.length - 1]));
  if (divider != null) paths.push(rule(divider, ys[0], divider, ys[dividerTo]));
  return paths;
}

export const WIDGET_YS = [50, 80, 110, 150, 190, 230];
export function widgetTable() {
  return {
    paths: [...ruledTable({ x0: 100, x1: 400, divider: 250, ys: WIDGET_YS }),
      box(300, 120, 40, 20), box(290, 160, 60, 20), box(310, 200, 20, 20)],
    words: [word('FUNCTIONAL TAG', 105, 55), word('IDENTIFIER', 105, 66), word('Q', 320, 60),
      word('WIDGETS', 105, 90), word('SYMBOL', 300, 90),
      word('ROUND WIDGET', 105, 125),
      word('WIDGET (LARGE)', 105, 170), word('SQUARE', 105, 158), word('M', 315, 165),
      word('LAST WIDGET', 105, 205)],
  };
}

// Back to pdf.js shapes under an identity viewport, for readLegendPage.
export function toOps(paths) {
  const fnArray = [], argsArray = [];
  for (const p of paths) {
    const ops = [], coords = [];
    for (let i = 0; i < p.segs.length; i += 4) {
      ops.push(FAKE_OPS.moveTo, FAKE_OPS.lineTo); coords.push(p.segs[i], p.segs[i + 1], p.segs[i + 2], p.segs[i + 3]);
    }
    fnArray.push(FAKE_OPS.setLineWidth, FAKE_OPS.constructPath, FAKE_OPS.stroke);
    argsArray.push([p.width], [ops, coords, null], null);
  }
  return { fnArray, argsArray };
}
export const toTextItems = words => words.map(w => ({ str: w.str, transform: [w.h, 0, 0, w.h, w.x, w.y], width: w.w, height: w.h }));
```

- [ ] **Step 2: Write the failing tests** (append to `tests/pid-symbols.test.js`; add `legendCells, titleBlock, readLegendPage` to the import).

```js
import { rule, box, word, ruledTable, widgetTable, toOps, toTextItems } from './fixtures/symbol-table.js';

test('legendCells: reads heading, tag identifier and every row, including the last', () => {
  const { paths, words } = widgetTable();
  const r = legendCells(paths, words);
  assert.deepEqual(r.tables, [{ header: 'WIDGETS', tagId: 'Q', symbolSide: 'right', box: [100, 50, 400, 230], rowCount: 3 }]);
  assert.deepEqual(r.rows.map(x => x.label), ['ROUND WIDGET', 'SQUARE WIDGET (LARGE)', 'LAST WIDGET']);
  assert.deepEqual(r.rows.map(x => [x.header, x.tagId, x.table]), [['WIDGETS', 'Q', 0], ['WIDGETS', 'Q', 0], ['WIDGETS', 'Q', 0]]);
  assert.deepEqual(r.rows[1].box, [290, 160, 350, 180]);
  assert.deepEqual(r.rows[1].lettersInside, [{ text: 'M', x: 315, y: 165, size: 8 }]);
  assert.equal(r.rows[0].symbolPaths.length, 1); // the rules themselves are never symbol linework
  assert.deepEqual([r.unsplit, r.other, r.emptyRows], [[], [], 0]);
});

test('legendCells: a row with no divider is listed, not dropped', () => {
  const t = widgetTable();
  const paths = [...ruledTable({ x0: 100, x1: 400, divider: 250, ys: [50, 80, 110, 150, 190, 230], dividerTo: 4 }), ...t.paths.slice(-3)];
  const r = legendCells(paths, t.words);
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.unsplit.map(u => [u.reason, u.text, u.header, u.pathCount]), [['no divider', 'LAST WIDGET', 'WIDGETS', 1]]);
});

test('legendCells: a label with no linework, and linework with no label, are both listed', () => {
  const t = widgetTable();
  const noLine = legendCells(t.paths.filter(p => p !== t.paths[t.paths.length - 1]), t.words);
  assert.deepEqual(noLine.unsplit.map(u => [u.reason, u.text]), [['no linework', 'LAST WIDGET']]);
  const noLabel = legendCells(t.paths, t.words.filter(w => w.str !== 'ROUND WIDGET'));
  assert.deepEqual(noLabel.unsplit.map(u => [u.reason, u.pathCount]), [['no label', 1]]);
  assert.equal(noLabel.rows.length, 2);
});

test('legendCells: a row with nothing in it is counted', () => {
  const t = widgetTable();
  const r = legendCells(t.paths.slice(0, -1), t.words.filter(w => w.str !== 'LAST WIDGET'));
  assert.deepEqual([r.rows.length, r.unsplit.length, r.emptyRows], [2, 0, 1]);
});

test('legendCells: two tables stacked in one column stay separate, and the gap is not a row', () => {
  const t = widgetTable();
  const paths = [...t.paths, ...ruledTable({ x0: 100, x1: 400, divider: 250, ys: [260, 290, 330] }), box(300, 300, 30, 20)];
  const words = [...t.words, word('GADGETS', 105, 270), word('SYMBOL', 300, 270), word('TALL GADGET', 105, 305)];
  const r = legendCells(paths, words);
  assert.deepEqual(r.tables.map(x => [x.header, x.tagId, x.rowCount]), [['WIDGETS', 'Q', 3], ['GADGETS', '', 1]]);
  assert.deepEqual([r.rows.length, r.emptyRows, r.rows[3].table], [4, 0, 1]);
});

test('legendCells: the symbol column follows the heading, left or right', () => {
  const paths = [...ruledTable({ x0: 100, x1: 400, divider: 250, ys: [50, 80, 120] }), box(120, 90, 30, 20)];
  const r = legendCells(paths, [word('SYMBOL', 150, 60), word('GADGETS', 260, 60), word('LEFT GADGET', 260, 95)]);
  assert.equal(r.tables[0].symbolSide, 'left');
  assert.deepEqual(r.rows.map(x => [x.label, x.box]), [['LEFT GADGET', [120, 90, 150, 110]]]);
});

test('legendCells: a ruled area with no heading is listed under other, and an enclosing frame is not', () => {
  const t = widgetTable();
  const frame = ruledTable({ x0: 20, x1: 800, ys: [20, 500] });
  const notes = ruledTable({ x0: 450, x1: 750, divider: 600, ys: [50, 80, 110] });
  const r = legendCells([...frame, ...t.paths, ...notes], [...t.words, word('NOTE ONE', 455, 60), word('NOTE TWO', 455, 90)]);
  assert.equal(r.rows.length, 3);
  assert.deepEqual(r.other.map(o => [o.box, o.rows.map(x => x.text)]), [[[450, 50, 750, 110], ['NOTE ONE', 'NOTE TWO']]]);
});

test('legendCells: rules drawn slightly out of line still make one table', () => {
  const t = widgetTable();
  const paths = t.paths.map((p, i) => i === 2 ? rule(100.8, 110.4, 399.3, 110.4) : p).concat(rule(100, 150.5, 400, 150.5));
  assert.equal(legendCells(paths, t.words).rows.length, 3);
});

test('legendCells: header words are options, and hostile input degrades', () => {
  const t = widgetTable();
  const words = t.words.map(w => w.str === 'SYMBOL' ? word('GLYPH', 300, 90) : w);
  assert.equal(legendCells(t.paths, words).rows.length, 0);
  assert.equal(legendCells(t.paths, words, { symbolWord: 'glyph' }).rows.length, 3);
  const empty = { tables: [], rows: [], unsplit: [], other: [], emptyRows: 0 };
  for (const bad of [undefined, null, 5, 'x', {}]) assert.deepEqual(legendCells(bad, bad, bad), empty);
  assert.doesNotThrow(() => legendCells([null, { segs: 'x' }, { segs: [NaN, 0, 1, 1], stroked: true }], [null, { str: 5 }]));
});

test('titleBlock: sheet number, and the revision is the nearest word below its label', () => {
  const words = [word('SHEET 7', 500, 200), word('REV.', 520, 300), word('B03', 518, 314), word('NTS', 470, 312), word('A1', 520, 280)];
  assert.deepEqual(titleBlock(words), { sheet: '7', rev: 'B03' });
  assert.deepEqual(titleBlock([word('NOTHING', 0, 0)]), { sheet: '', rev: '' });
  for (const bad of [undefined, null, 5, [null, {}]]) assert.deepEqual(titleBlock(bad), { sheet: '', rev: '' });
});

test('readLegendPage: operator list and text items in, rows and title block out', () => {
  const t = widgetTable();
  const { fnArray, argsArray } = toOps(t.paths);
  const textItems = toTextItems([...t.words, word('SHEET 7', 600, 400), word('REV.', 600, 420), word('B03', 600, 434)]);
  const r = readLegendPage({ fnArray, argsArray, OPS: O, viewportTransform: [1, 0, 0, 1, 0, 0], textItems, page: 3 });
  assert.deepEqual([r.page, r.sheet, r.rev], [3, '7', 'B03']);
  assert.deepEqual(r.rows.map(x => x.label), ['ROUND WIDGET', 'SQUARE WIDGET (LARGE)', 'LAST WIDGET']);
  assert.deepEqual(readLegendPage(null), { page: 0, sheet: '', rev: '', tables: [], rows: [], unsplit: [], other: [], emptyRows: 0 });
});
```

- [ ] **Step 3: Run to see them fail.** Run: `node --test tests/pid-symbols.test.js`. Expected: the new tests FAIL, `legendCells` is not exported.

- [ ] **Step 4: Implement `legendCells`, `titleBlock`, `readLegendPage`.** The algorithm, which the tests do not fully determine. `TOL` is 1.5 pt throughout.
  1. **Rules.** From stroked paths only. A segment is horizontal when its ends differ by at most 0.3 in y and it is at least `minRule` long; vertical when its ends differ by at most 0.3 in x and it is at least 10 long.
  2. **Bands.** Horizontals whose left ends agree within `TOL` and whose right ends agree within `TOL` form one band. Sort the band's y values and merge any within `TOL`.
  3. **Areas.** A consecutive pair of y values is a row only if a vertical within `TOL` of the band's left edge and another within `TOL` of its right edge each span the pair (with `TOL` slack). A run of consecutive rows is one ruled area; a pair that fails ends the area. This is what keeps stacked tables apart and makes the last row an ordinary row.
  4. **Dividers.** For a row, the verticals lying more than 20 pt inside both edges that span it, merged within `TOL`.
  5. **Cell contents.** A word belongs to the cell that contains the centre of its box. Cell text is the words sorted by line (two words share a line when their tops differ by less than half the taller one's height) then by x, joined with single spaces and whitespace-collapsed. A path belongs to a cell when its whole bounding box lies inside the cell shrunk by `TOL` on every side.
  6. **Heading rows.** In a row with exactly one divider: if one cell's text equals `symbolWord` ignoring case, the row is the heading row, `header` is the other cell's text, and `symbolSide` is the side holding `symbolWord`. If one cell's text starts with `tagIdLabel` ignoring case, `tagId` is the other cell's text. The first heading row and the first tag row in an area apply to the whole area. An area with a heading row is a symbol table; any other area goes to `other`.
  7. **Data rows of a symbol table.** With no divider or several: if the row holds text or paths it goes to `unsplit` (`'no divider'` or `'several dividers'`, `text` being the whole row's text), otherwise `emptyRows` is incremented. With one divider: both cells empty increments `emptyRows`; no label gives `'no label'`; no linework gives `'no linework'`; otherwise it is a row. A second heading row is treated as a data row, so it is listed and not lost.
  8. **Other areas.** List each row that holds text or paths, `text` being the whole row's text whatever its dividers. Omit an area with no such row. Omit an area whose box contains another area's box (a sheet border).
  9. **Order.** Areas are taken by left edge, then top; rows top to bottom. `tables`, `rows`, `unsplit` and `other` all follow that order. `rowCount` is the number of entries the table put in `rows`.
  10. **`titleBlock`.** `sheet` is the first capture of `/^SHEET\s+(\d+)\b/i` over the words. `rev` is found from a word matching `/^REV\.?$/i`: among words whose top is below the label's top by at most 30 pt and whose centre is within 30 pt of the label's centre in x, the one closest below.
  11. **`readLegendPage`** composes `pagePaths`, `textWords`, `legendCells` and `titleBlock`. `page` is `Number(input.page) || 0`.

- [ ] **Step 5: Run to see them pass.** Run: `node --test tests/pid-symbols.test.js`. Expected: 24 pass.

- [ ] **Step 6: Checkpoint.** Files: `assets/js/pid-symbols.js`, `tests/fixtures/symbol-table.js`, `tests/pid-symbols.test.js`. Message: `feat(pid): read ruled legend tables into symbol rows`.

---

### Task 4: Build, parse and serialise the library

**Files:**
- Modify: `assets/js/pid-symbols.js`
- Create: `tests/fixtures/invented-symbol-library.json`
- Test: `tests/pid-symbols.test.js` (append)

**Interfaces:**
- Consumes: `legendCells` rows from Task 3.
- Produces:
  - `Symbol = { id, name, legendName, group, tagId, sheet, w, h, paths: Path[], letters: [{ text, x, y, size }], flags: { simple, stretch, manual, unmatched }, aliases: string[], notes: [{ text, ref, date }] }`. `paths` and `letters` are relative to the symbol's own top-left; numbers are rounded to 2 decimal places.
  - `Library = { version: 1, legend: [{ sheet, rev, page }], importedAt, families: {}, symbols: Symbol[], exceptions: [{ name, status: 'approved' | 'pending', note, ref }] }`
  - `normName(s) -> string` (upper case, whitespace collapsed, trimmed; `''` for a non-string)
  - `buildLibrary(pages, importedAt) -> Library`, `pages` being `readLegendPage` results
  - `parseLibrary(text) -> { ok: true, library } | { ok: false, error }`, `error` one of `'not-json' | 'not-a-library' | 'newer-version' | 'bad-symbol'`
  - `serialiseLibrary(library) -> string` (compact JSON)
  - `libraryCounts(library) -> { symbols, notes, aliases, exceptions, manual }`

- [ ] **Step 1: Write the invented library fixture** `tests/fixtures/invented-symbol-library.json`. It is also the file dropped into the tool for browser checks, so it carries a hostile name.

```json
{"version":1,"legend":[{"sheet":"7","rev":"B03","page":1}],"importedAt":"2026-11-13T10:00:00.000Z","families":{},
"symbols":[
{"id":"p1-001","name":"ROUND WIDGET","legendName":"ROUND WIDGET","group":"WIDGETS","tagId":"Q","sheet":"7","w":40,"h":20,"paths":[{"segs":[0,0,40,0,40,0,40,20,40,20,0,20,0,20,0,0],"width":0.7,"stroked":true,"filled":false,"grey":0}],"letters":[],"flags":{"simple":false,"stretch":false,"manual":false,"unmatched":false},"aliases":[],"notes":[]},
{"id":"p1-002","name":"VIEWING PORT","legendName":"VIEWING PORT","group":"WIDGETS","tagId":"Q","sheet":"7","w":30,"h":30,"paths":[{"segs":[0,0,30,30,30,0,0,30],"width":0.7,"stroked":true,"filled":false,"grey":0}],"letters":[{"text":"M","x":11,"y":10,"size":8}],"flags":{"simple":true,"stretch":false,"manual":false,"unmatched":false},"aliases":["peep hole"],"notes":[{"text":"Use for the rare tilting kind too.","ref":"RFI 12","date":"2026-11-01"}]},
{"id":"p1-003","name":"<img src=x onerror=alert(1)>","legendName":"HOSTILE","group":"<b>GADGETS</b>","tagId":"ZZ","sheet":"7","w":10,"h":10,"paths":[],"letters":[{"text":"</text><script>alert(2)</script>","x":0,"y":0,"size":8}],"flags":{"simple":false,"stretch":false,"manual":false,"unmatched":false},"aliases":["\"><script>alert(3)</script>"],"notes":[{"text":"<i>note</i>","ref":"","date":""}]},
{"id":"m-1","name":"GAUGE BUBBLE","legendName":"GAUGE BUBBLE","group":"BUBBLES","tagId":"","sheet":"1","w":0,"h":0,"paths":[],"letters":[],"flags":{"simple":false,"stretch":false,"manual":true,"unmatched":false},"aliases":[],"notes":[]}
],
"exceptions":[{"name":"GIZMO","status":"pending","note":"No palette symbol yet.","ref":"RFI 20"},{"name":"DOOHICKEY","status":"approved","note":"","ref":""}]}
```

- [ ] **Step 2: Write the failing tests** (append; add the new names to the import, and `readFileSync` from `node:fs`).

```js
const INVENTED = readFileSync(new URL('./fixtures/invented-symbol-library.json', import.meta.url), 'utf8');
const widgetPage = () => { const t = widgetTable(); return { page: 3, sheet: '7', rev: 'B03', ...legendCells(t.paths, t.words) }; };

test('buildLibrary: one symbol per row, drawn from its own top-left corner', () => {
  const lib = buildLibrary([widgetPage()], '2026-11-13T10:00:00.000Z');
  assert.deepEqual([lib.version, lib.legend, lib.importedAt, lib.families, lib.exceptions],
    [1, [{ sheet: '7', rev: 'B03', page: 3 }], '2026-11-13T10:00:00.000Z', {}, []]);
  assert.deepEqual(lib.symbols[0], {
    id: 'p3-001', name: 'ROUND WIDGET', legendName: 'ROUND WIDGET', group: 'WIDGETS', tagId: 'Q', sheet: '7', w: 40, h: 20,
    paths: [{ segs: [0, 0, 40, 0, 40, 0, 40, 20, 40, 20, 0, 20, 0, 20, 0, 0], width: 0.7, stroked: true, filled: false, grey: 0 }],
    letters: [], flags: { simple: false, stretch: false, manual: false, unmatched: false }, aliases: [], notes: [] });
  assert.deepEqual(lib.symbols.map(s => s.id), ['p3-001', 'p3-002', 'p3-003']);
  assert.deepEqual(lib.symbols[1].letters, [{ text: 'M', x: 25, y: 5, size: 8 }]);
});

test('buildLibrary: rounds to 2 places, keeps same-named rows apart, falls back to the page number for sheet', () => {
  const p = widgetPage();
  p.sheet = '';
  p.rows[2].label = 'ROUND WIDGET';
  p.rows[0].symbolPaths = [{ segs: [300.123456, 120, 340.987654, 140.5049], width: 0.72001, stroked: true, filled: false, grey: 0 }];
  const lib = buildLibrary([p], 'now');
  assert.deepEqual(lib.symbols[0].paths[0], { segs: [0, 0, 40.86, 20.5], width: 0.72, stroked: true, filled: false, grey: 0 });
  assert.deepEqual(lib.symbols.filter(s => s.name === 'ROUND WIDGET').map(s => s.id), ['p3-001', 'p3-003']);
  assert.equal(lib.symbols[0].sheet, '3');
});

test('buildLibrary: hostile input gives an empty library', () => {
  for (const bad of [undefined, null, 5, 'x', [null, 7, { rows: 'x' }]]) {
    const lib = buildLibrary(bad, bad);
    assert.deepEqual([lib.version, lib.symbols, lib.exceptions], [1, [], []]);
  }
});

test('parseLibrary: round trip, and the invented fixture is valid', () => {
  const lib = buildLibrary([widgetPage()], 'now');
  assert.deepEqual(parseLibrary(serialiseLibrary(lib)), { ok: true, library: lib });
  const inv = parseLibrary(INVENTED);
  assert.equal(inv.ok, true);
  assert.deepEqual(libraryCounts(inv.library), { symbols: 4, notes: 2, aliases: 2, exceptions: 2, manual: 1 });
});

test('parseLibrary: a structurally bad or newer file is refused, never half-read', () => {
  assert.deepEqual(parseLibrary('{oops'), { ok: false, error: 'not-json' });
  for (const t of ['[]', 'null', '5', '{}', '{"version":1}', '{"version":1,"symbols":{}}']) assert.deepEqual(parseLibrary(t), { ok: false, error: 'not-a-library' });
  assert.deepEqual(parseLibrary('{"version":2,"symbols":[]}'), { ok: false, error: 'newer-version' });
  for (const s of ['null', '5', '{}', '{"name":""}', '{"name":7}']) assert.deepEqual(parseLibrary('{"version":1,"symbols":[' + s + ']}'), { ok: false, error: 'bad-symbol' });
  for (const bad of [undefined, null, 5, {}]) assert.equal(parseLibrary(bad).ok, false);
});

test('parseLibrary: fills defaults, repairs ids, cleans linework and keeps fields it does not know', () => {
  const r = parseLibrary(JSON.stringify({ version: 1, future: { a: 1 }, symbols: [
    { name: 'A', phase3: [1], paths: [{ segs: [0, 0, 1, 1, 5, null, 6, 7, 9], width: 'x' }, 7], aliases: 'no', notes: [null, { text: 5 }] },
    { name: 'B', id: 'dup' }, { name: 'C', id: 'dup' }] }));
  assert.equal(r.ok, true);
  const [a, b, c] = r.library.symbols;
  assert.deepEqual(r.library.future, { a: 1 });
  assert.deepEqual(a.phase3, [1]);
  assert.deepEqual(a.paths, [{ segs: [0, 0, 1, 1], width: 0, stroked: false, filled: false, grey: 0 }]);
  assert.deepEqual([a.aliases, a.notes, a.legendName, a.tagId, a.flags.manual], [[], [{ text: '5', ref: '', date: '' }], 'A', '', false]);
  assert.equal(new Set([a.id, b.id, c.id]).size, 3);
  assert.equal(b.id, 'dup');
  assert.deepEqual([r.library.legend, r.library.exceptions, r.library.families], [[], [], {}]);
});

test('libraryCounts and normName degrade', () => {
  assert.deepEqual(libraryCounts(null), { symbols: 0, notes: 0, aliases: 0, exceptions: 0, manual: 0 });
  assert.equal(normName('  round \n widget '), 'ROUND WIDGET');
  assert.equal(normName(null), '');
});
```

- [ ] **Step 3: Run to see them fail.** Run: `node --test tests/pid-symbols.test.js`. Expected: the new tests FAIL.

- [ ] **Step 4: Implement.** Points the tests leave open:
  - Ids from `buildLibrary` are `'p' + page + '-' + three-digit running number within that page`.
  - `buildLibrary` works out each symbol's bounding box from its `symbolPaths` (segment end points; stroke width ignored), not from the row's `box`. `w` and `h` are that box's size; paths and letters are moved so the box's top-left is `0, 0`. Rounding is to 2 decimal places and never yields `-0`.
  - `parseLibrary` checks in this order: not a string or not JSON is `'not-json'`; not a plain object, or `version` not a number, is `'not-a-library'`; `version` above 1 is `'newer-version'`; any other `version` but 1, or `symbols` not an array, is `'not-a-library'`.
  - `parseLibrary` refuses on structure and never drops a symbol: every entry of `symbols` must be an object with a non-empty string `name`, or the whole file is `'bad-symbol'`. Known fields are coerced to their types with the defaults shown in `Symbol`; unknown fields at the top level and on a symbol are passed through untouched. A missing or repeated `id` is replaced by `'r-' + n` for the lowest `n` not in use; the first holder of an id keeps it. A path keeps only complete quadruples of finite numbers and is dropped when none remain. An exception needs a non-empty string `name`; `status` is `'approved'` only when it is exactly that, otherwise `'pending'`.

- [ ] **Step 5: Run to see them pass.** Run: `node --test tests/pid-symbols.test.js`. Expected: 31 pass.

- [ ] **Step 6: Checkpoint.** Files: `assets/js/pid-symbols.js`, the fixture, the test file. Message: `feat(pid): build, parse and serialise the symbol library`.

---

### Task 5: Search

**Files:**
- Modify: `assets/js/pid-symbols.js`
- Test: `tests/pid-symbols.test.js` (append)

**Interfaces:**
- Consumes: `Library`, `parseLibrary` from Task 4.
- Produces: `searchSymbols(library, query) -> Result[]`, where `Result = { kind: 'symbol', symbol, score } | { kind: 'exception', exception, score }`.

- [ ] **Step 1: Write the failing tests** (append).

```js
const SEARCH_LIB = parseLibrary(JSON.stringify({ version: 1, symbols: [
  { id: 'a', name: 'ROUND WIDGET', group: 'WIDGETS', tagId: 'Q' },
  { id: 'b', name: 'SQUARE WIDGET (LARGE)', group: 'WIDGETS', tagId: 'Q' },
  { id: 'c', name: 'VIEWING PORT', group: 'FITTINGS', tagId: '', aliases: ['peep hole'], notes: [{ text: 'Stands in for the tilting kind.' }] },
  { id: 'd', name: 'Q-TYPE GADGET', group: 'GADGETS', tagId: 'K/KX' },
  { id: 'e', name: 'WIDGET', group: 'WIDGETS', tagId: 'Q' },
  { id: 'f', name: 'MOTOR DRIVE', group: 'DRIVES', tagId: '', letters: [{ text: 'M', x: 0, y: 0, size: 8 }] }],
  exceptions: [{ name: 'GIZMO', status: 'pending', note: 'Awaiting the next palette.' }] })).library;
const ids = q => searchSymbols(SEARCH_LIB, q).map(r => r.kind === 'symbol' ? r.symbol.id : 'x:' + r.exception.name);

test('searchSymbols: an exact name comes first, then closer names', () => {
  assert.deepEqual(ids('widget'), ['e', 'a', 'b']);
  assert.equal(ids('round widget')[0], 'a');
  assert.equal(ids('  Square   WIDGET ')[0], 'b');
});

test('searchSymbols: every word must match somewhere', () => {
  assert.deepEqual(ids('round gadget'), []);
  assert.deepEqual(ids('large widget'), ['b']);
});

test('searchSymbols: aliases, notes, headings and letters are searched', () => {
  assert.equal(ids('peep hole')[0], 'c');
  assert.deepEqual(ids('tilting'), ['c']);
  assert.deepEqual(ids('fittings'), ['c']);
  assert.ok(ids('m').includes('f'));
});

test('searchSymbols: a tag code lists its family first, in library order', () => {
  assert.deepEqual(ids('q'), ['a', 'b', 'e', 'd']);
  assert.deepEqual(ids('kx'), ['d']);
});

test('searchSymbols: plurals and partial words', () => {
  assert.deepEqual(ids('widgets'), ['a', 'b', 'e']);
  assert.equal(ids('view')[0], 'c');
});

test('searchSymbols: an exception answers instead of nothing', () => {
  assert.deepEqual(ids('gizmo'), ['x:GIZMO']);
  assert.deepEqual(ids('palette'), ['x:GIZMO']);
});

test('searchSymbols: an empty query lists everything in library order; hostile input degrades', () => {
  assert.deepEqual(ids(''), ['a', 'b', 'c', 'd', 'e', 'f', 'x:GIZMO']);
  for (const bad of [undefined, null, 5, {}, []]) { assert.deepEqual(searchSymbols(bad, 'x'), []); assert.doesNotThrow(() => searchSymbols(SEARCH_LIB, bad)); }
  assert.deepEqual(searchSymbols({ symbols: [null, 5, { name: 7 }], exceptions: 'x' }, 'a'), []);
});
```

- [ ] **Step 2: Run to see them fail.** Run: `node --test tests/pid-symbols.test.js`. Expected: FAIL, `searchSymbols` not exported.

- [ ] **Step 3: Implement `searchSymbols`.** The scoring, which the tests constrain but do not fully fix:
  - Words: lower-case the text, turn every character that is not a letter or digit into a space, split. The query's words are the terms. No terms returns every symbol then every exception, in library order, score 0.
  - For each term, a symbol scores the best of: a tag code equal to the term **12** (tag codes are `tagId` split on spaces, commas, slashes and semicolons); a name or alias word equal to the term **10**; a name or alias word starting with the term **7**; a heading word equal to or starting with the term **4**; the term found anywhere in the name or an alias **3**; a letter equal to the term **3**; the term found in a note's text or ref **2**. A term longer than 3 characters ending in `s` is also tried without the `s`, and the better result is used.
  - A symbol matches only when every term scores above 0. Its score is the sum, plus **30** when the query's words joined by single spaces equal the name's (or an alias's) words joined the same way, plus **10** when that joined name or alias starts with the joined query, plus **50** when the query is a single term equal to one of its tag codes. The bonuses use the query as typed, not the form with the `s` removed.
  - Exceptions score the same way over their name (10, 7, 3) and note and ref (2), with the same 30 and 10 bonuses on the name.
  - Order: score descending, then library order, symbols before exceptions. Library order is what makes a tag code list its family as the legend does.

- [ ] **Step 4: Run to see them pass.** Run: `node --test tests/pid-symbols.test.js`. Expected: 38 pass.

- [ ] **Step 5: Checkpoint.** Files: `assets/js/pid-symbols.js`, `tests/pid-symbols.test.js`. Message: `feat(pid): search the symbol library`.

---

### Task 6: Gate 1 script, and the extraction go/no-go

Done before any interface work, so a pdf.js extraction problem shows now.

**Files:**
- Create: `scripts/check-symbol-import.mjs`
- Test: `tests/check-symbol-import.test.js`

**Interfaces:**
- Consumes: `loadVendoredPdfjs`, `openPdf` (Task 1); `readLegendPage`, `buildLibrary`, `parseLibrary`, `serialiseLibrary`, `searchSymbols`, `normName` (Tasks 3 to 5).
- Produces (exported for tests): `compareNames(mine: string[], theirs: string[]) -> { missing: string[], extra: string[] }`, `searchRanks(library, cases: [{ q, expect }]) -> [{ q, expect, rank }]`, `insideRepo(filePath: string) -> boolean`, `importLegend(data: Uint8Array) -> Promise<{ pages, library }>`.

- [ ] **Step 1: Write the failing tests** in `tests/check-symbol-import.test.js`.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { compareNames, searchRanks, insideRepo, importLegend } from '../scripts/check-symbol-import.mjs';
import { parseLibrary } from '../assets/js/pid-symbols.js';
import { tinyPdf, TINY_CONTENT, TINY_FORM } from './fixtures/tiny-pdf.js';

test('compareNames: a multiset comparison that ignores case and spacing', () => {
  assert.deepEqual(compareNames(['Round  Widget', 'LAST WIDGET', 'LAST WIDGET'], ['ROUND WIDGET', 'LAST WIDGET', 'LOST WIDGET']),
    { missing: ['LOST WIDGET'], extra: ['LAST WIDGET'] });
  assert.deepEqual(compareNames(null, undefined), { missing: [], extra: [] });
});

test('searchRanks: the 1-based place of the expected symbol, 0 when absent', () => {
  const lib = parseLibrary(JSON.stringify({ version: 1, symbols: [{ name: 'ROUND WIDGET' }, { name: 'WIDGET' }] })).library;
  assert.deepEqual(searchRanks(lib, [{ q: 'widget', expect: 'round widget' }, { q: 'widget', expect: 'NOPE' }, null]),
    [{ q: 'widget', expect: 'round widget', rank: 2 }, { q: 'widget', expect: 'NOPE', rank: 0 }]);
});

test('insideRepo: true for any path under the repository', () => {
  assert.equal(insideRepo(fileURLToPath(new URL('../assets/js/out.json', import.meta.url))), true);
  assert.equal(insideRepo(fileURLToPath(new URL('../../elsewhere/out.json', import.meta.url))), false);
});

test('importLegend: a PDF with no ruled tables gives pages and an empty library, without throwing', async () => {
  const r = await importLegend(tinyPdf(TINY_CONTENT, TINY_FORM));
  assert.equal(r.pages.length, 1);
  assert.deepEqual(r.library.symbols, []);
});
```

- [ ] **Step 2: Run to see them fail.** Run: `node --test tests/check-symbol-import.test.js`. Expected: FAIL, module not found.

- [ ] **Step 3: Write `scripts/check-symbol-import.mjs`** in the shape of `scripts/check-ds310.mjs`: a header comment saying it is not part of `npm test` and why, exported helpers, a `main()` guarded by the same `isMain` test. Behaviour:

```
node scripts/check-symbol-import.mjs "<legend pdf>" [--compare <names.json>] [--out <library.json>]
node scripts/check-symbol-import.mjs --library <symbol-library.json> --searches <searches.json>
```

  - `compareNames` compares by `normName`, counts repeats, and returns names in that normalised form. `searchRanks` skips cases that are not objects; `rank` is the 1-based place of the first symbol result whose `normName(name)` equals `normName(expect)`.
  - No arguments prints both usage lines and exits 1. A file that cannot be read prints one sentence naming it and exits 1. No stack traces.
  - **Import mode.** For each page: `getOperatorList()`, `getTextContent()`, `getViewport({ scale: 1 })`, then `readLegendPage`. Print, per page: page number, sheet, revision, then each table as `heading | tag identifier | rows`, then each unsplit row as `reason: text`, then the count of other ruled areas and empty rows. Then totals: symbols, unsplit rows, other ruled areas. **If the total is 0, print "No symbol rows found. Either this is not a legend, or its table headings have changed." and exit 1**, so an empty read is never mistaken for a pass.
  - `--compare` takes a JSON array of objects with a `name`; print the count and the list of names it has that the import lacks, and the count of names the import has beyond it.
  - `--out` writes `serialiseLibrary(library)`. **It refuses, with exit 1, any path for which `insideRepo` is true:** the library is client data.
  - **Search mode.** `--library` is read with `parseLibrary` (exit 1 with a sentence if not ok). `--searches` is a JSON array of `{ q, expect }`. Print each as `rank  q  ->  expect`, then `n of N in the top three`. Exit 1 if any rank is 0 or above 3. If there are fewer than 20 cases, say "Gate 1 asks for twenty searches; this file has N."

- [ ] **Step 4: Run to see the tests pass.** Run: `node --test tests/check-symbol-import.test.js`. Expected: 4 pass.

- [ ] **Step 5: Run the extraction gate on the real legend.** This reads files outside the repository and writes nothing inside it.

Run: `node scripts/check-symbol-import.mjs "../pid-symbol-spike/legend-sheets.pdf" --compare "../pid-symbol-spike/spike-symbols.json"`

Expected, from the planning measurement: 389 symbols in total, split 37 / 139 / 78 / 83 / 33 / 19 across sheets 1 to 6, so 352 on sheets 2 to 6; 0 unsplit rows; sheet numbers 1 to 6 and a revision read on every page; 2 names from the comparison file missing, both of them long run-together strings (the test's merged boxes), none a real symbol name.

**Go:** the totals match, or differ in a way you can account for row by row. Record the numbers you got in the task report whether or not they match.

**No-go:** fewer symbols than the test's 376, or real symbol names missing. Stop and report the numbers. Do not tune the tolerances to hit 389. The design's fallback then applies: see *Fallback* at the end of this plan.

- [ ] **Step 6: Run the whole suite.** Run: `npm test`. Expected: 0 failing; the count has risen by the tests added so far (Tasks 1 to 6 add 47).

- [ ] **Step 7: Checkpoint.** Files: `scripts/check-symbol-import.mjs`, `tests/check-symbol-import.test.js`. Message: `feat(pid): local-only Gate 1 check for the symbol import`.

---

### Task 7: Editing the library and carrying hand-entered work across a re-import

**Files:**
- Modify: `assets/js/pid-symbols.js`
- Test: `tests/pid-symbols.test.js` (append)

**Interfaces:**
- Consumes: `Library`, `Symbol`, `normName`, `parseLibrary` from Task 4.
- Produces (every function returns a new library and leaves its argument untouched; an unknown id returns the library unchanged):
  - `updateSymbol(library, id, patch) -> Library`. `patch` keys honoured: `name`, `group`, `tagId`, `sheet`, `aliases` (array of strings), `simple`, `stretch`.
  - `deleteSymbol(library, id) -> Library`
  - `addManualSymbol(library, { name, group, tagId, sheet }) -> { library, id }`. `id` is `''` when `name` is blank.
  - `addNote(library, id, { text, ref, date }) -> Library`, `removeNote(library, id, index) -> Library`
  - `setException(library, { name, status, note, ref }) -> Library` (replaces the one with the same `normName`, else appends), `removeException(library, name) -> Library`
  - `carryOver(oldLibrary, newLibrary) -> { library, summary: { matched, notes, aliases, renames, manual, exceptions, dropped }, unmatched: [{ name, group, notes, aliases }], exceptionsNowInLibrary: string[] }`

- [ ] **Step 1: Write the failing tests** (append).

```js
const lib4 = () => parseLibrary(INVENTED).library;
const sym = (lib, id) => lib.symbols.find(s => s.id === id);

test('updateSymbol: only the editable fields change, and the original is untouched', () => {
  const before = lib4();
  const after = updateSymbol(before, 'p1-001', { name: '  DISC WIDGET ', tagId: 'k', aliases: [' disc ', '', 7], simple: true, id: 'x', paths: [], legendName: 'x' });
  assert.deepEqual([sym(after, 'p1-001').name, sym(after, 'p1-001').tagId, sym(after, 'p1-001').aliases, sym(after, 'p1-001').flags.simple],
    ['DISC WIDGET', 'K', ['disc'], true]);
  assert.deepEqual([sym(after, 'p1-001').legendName, sym(after, 'p1-001').paths.length], ['ROUND WIDGET', 1]);
  assert.equal(sym(before, 'p1-001').name, 'ROUND WIDGET');
  assert.equal(sym(updateSymbol(before, 'p1-001', { name: '   ' }), 'p1-001').name, 'ROUND WIDGET');
  assert.deepEqual(updateSymbol(before, 'nope', { name: 'X' }), before);
});

test('deleteSymbol, addManualSymbol, notes and exceptions', () => {
  assert.equal(deleteSymbol(lib4(), 'p1-002').symbols.length, 3);
  const m = addManualSymbol(lib4(), { name: ' LEVEL BUBBLE ', group: 'BUBBLES', tagId: 'l' });
  assert.equal(m.id, 'm-2');
  assert.deepEqual(sym(m.library, 'm-2'), { id: 'm-2', name: 'LEVEL BUBBLE', legendName: 'LEVEL BUBBLE', group: 'BUBBLES', tagId: 'L', sheet: '',
    w: 0, h: 0, paths: [], letters: [], flags: { simple: false, stretch: false, manual: true, unmatched: false }, aliases: [], notes: [] });
  assert.equal(addManualSymbol(lib4(), { name: ' ' }).id, '');
  const n = addNote(lib4(), 'p1-001', { text: ' Ruling. ', ref: 'RFI 3', date: '2026-11-13' });
  assert.deepEqual(sym(n, 'p1-001').notes, [{ text: 'Ruling.', ref: 'RFI 3', date: '2026-11-13' }]);
  assert.deepEqual(addNote(lib4(), 'p1-001', { text: '  ' }), lib4());
  assert.deepEqual(sym(removeNote(lib4(), 'p1-002', 0), 'p1-002').notes, []);
  const e = setException(setException(lib4(), { name: 'gizmo', status: 'approved' }), { name: 'THINGY', status: 'nonsense' });
  assert.deepEqual(e.exceptions.map(x => [x.name, x.status]), [['gizmo', 'approved'], ['DOOHICKEY', 'approved'], ['THINGY', 'pending']]);
  assert.deepEqual(removeException(lib4(), ' Gizmo ').exceptions.map(x => x.name), ['DOOHICKEY']);
});

test('the edit functions degrade on hostile input', () => {
  for (const bad of [undefined, null, 5, 'x', []]) {
    for (const fn of [updateSymbol, deleteSymbol, addNote, removeNote, setException, removeException]) assert.doesNotThrow(() => fn(bad, bad, bad));
    assert.doesNotThrow(() => addManualSymbol(bad, bad));
    assert.doesNotThrow(() => carryOver(bad, bad));
  }
});

const fresh = names => parseLibrary(JSON.stringify({ version: 1, legend: [{ sheet: '8', rev: 'B04', page: 1 }], importedAt: 'later',
  symbols: names.map((n, i) => ({ id: 'p1-00' + (i + 1), name: n, group: 'WIDGETS', tagId: 'Q' })) })).library;

test('carryOver: notes, aliases and flags follow a symbol by its legend name, even after a hand rename', () => {
  const old = updateSymbol(lib4(), 'p1-002', { name: 'SPY HOLE' });
  const r = carryOver(old, fresh(['VIEWING PORT', 'ROUND WIDGET', 'NEW WIDGET']));
  const port = r.library.symbols.find(s => s.legendName === 'VIEWING PORT');
  assert.deepEqual([port.name, port.aliases, port.notes.length, port.flags.simple, port.id], ['SPY HOLE', ['peep hole'], 1, true, 'p1-001']);
  assert.deepEqual([r.library.importedAt, r.library.legend[0].rev], ['later', 'B04']);
  assert.deepEqual([r.summary.matched, r.summary.notes, r.summary.aliases, r.summary.renames], [2, 1, 1, 1]);
});

test('carryOver: nothing hand-entered is lost when a symbol has gone from the legend', () => {
  const r = carryOver(lib4(), fresh(['ROUND WIDGET']));
  const kept = r.library.symbols.find(s => s.legendName === 'VIEWING PORT');
  assert.deepEqual([kept.flags.unmatched, kept.notes.length, kept.aliases], [true, 1, ['peep hole']]);
  assert.ok(r.unmatched.some(u => u.name === 'VIEWING PORT' && u.notes === 1 && u.aliases === 1));
  assert.equal(new Set(r.library.symbols.map(s => s.id)).size, r.library.symbols.length);
});

test('carryOver: manual entries and exceptions come across; a plain unmatched symbol does not', () => {
  const old = deleteSymbol(lib4(), 'p1-003');
  const r = carryOver(old, fresh(['VIEWING PORT', 'GIZMO']));
  assert.ok(r.library.symbols.some(s => s.name === 'GAUGE BUBBLE' && s.flags.manual));
  assert.ok(!r.library.symbols.some(s => s.legendName === 'ROUND WIDGET'));
  assert.deepEqual([r.summary.manual, r.summary.exceptions, r.summary.dropped], [1, 2, 1]);
  assert.deepEqual(r.library.exceptions.map(e => e.name), ['GIZMO', 'DOOHICKEY']);
  assert.deepEqual(r.exceptionsNowInLibrary, ['GIZMO']);
});

test('carryOver: same-named symbols pair up in order, and a hand-set tag identifier fills a blank one', () => {
  const old = parseLibrary(JSON.stringify({ version: 1, symbols: [
    { id: 'a', name: 'TWIN', group: 'G', tagId: 'K', aliases: ['first'] }, { id: 'b', name: 'TWIN', group: 'G', aliases: ['second'] }] })).library;
  const next = parseLibrary(JSON.stringify({ version: 1, symbols: [
    { id: 'p1-001', name: 'TWIN', group: 'G' }, { id: 'p1-002', name: 'TWIN', group: 'G', tagId: 'Z' }] })).library;
  const r = carryOver(old, next);
  assert.deepEqual(r.library.symbols.map(s => [s.id, s.aliases, s.tagId]), [['p1-001', ['first'], 'K'], ['p1-002', ['second'], 'Z']]);
});
```

- [ ] **Step 2: Run to see them fail.** Run: `node --test tests/pid-symbols.test.js`. Expected: the new tests FAIL.

- [ ] **Step 3: Implement.** Rules the tests leave open:
  - `updateSymbol` trims strings, upper-cases `tagId`, ignores a blank `name`, and keeps only non-empty trimmed strings in `aliases`. It never changes `id`, `legendName`, `paths`, `letters`, `w`, `h`, `flags.manual` or `flags.unmatched`.
  - `addManualSymbol` gives the id `'m-' + n`, `n` being one more than the highest existing `m-` number.
  - `carryOver`, in order:
    1. Give every symbol on both sides the key `normName(legendName) | normName(group) | occurrence`, `occurrence` counting earlier symbols with the same first two parts.
    2. Each old symbol that is not manual looks for the new symbol with the same key; failing that, for the only not-yet-claimed new symbol with the same `normName(legendName)`.
    3. A matched new symbol takes from the old one: `notes`; `aliases` (old first, then any of its own not already there); `flags.simple` and `flags.stretch`; `name`, when the old `name` differs from the old `legendName`; `tagId`, when its own is blank.
    4. An old manual symbol is carried in whole, unless a new symbol has the same `normName(name)`, in which case its notes and aliases are merged onto that symbol.
    5. An old non-manual symbol with no match is kept with `flags.unmatched = true` when it holds any note or alias, and listed in `unmatched`; otherwise it is left out and counted in `summary.dropped`.
    6. Every carried-in symbol (steps 4 and 5) gets a fresh `'m-' + n` id, so ids stay unique.
    7. All old exceptions and the old `families` come across. `exceptionsNowInLibrary` lists exceptions whose `normName(name)` equals a new symbol's name or alias.
    8. `legend` and `importedAt` are the new library's. `summary.notes` and `summary.aliases` count what was carried onto matched symbols; `summary.manual` and `summary.exceptions` count those carried.

- [ ] **Step 4: Run to see them pass.** Run: `node --test tests/pid-symbols.test.js`. Expected: 45 pass.

- [ ] **Step 5: Checkpoint.** Files: `assets/js/pid-symbols.js`, `tests/pid-symbols.test.js`. Message: `feat(pid): edit the symbol library and carry notes across a re-import`.

---

### Task 8: Reading and saving the library file safely

**Files:**
- Create: `assets/js/pid-symbol-store.js`
- Test: `tests/pid-symbol-store.test.js`

**Interfaces:**
- Consumes: `parseLibrary`, `serialiseLibrary` (Task 4); `writeFileAtomic(dir, name, contents, sessionId)`, `backupFileName(baseName, nowIso)`, `prunableBackups(names, keep, baseName)` from `assets/js/hub-sync.js`.
- Produces:
  - `LIBRARY_FILE = 'symbol-library.json'`
  - `readLibraryFile(dir) -> Promise<{ status: 'ok', raw, library } | { status: 'missing' } | { status: 'unreadable', error }>`. Never rejects.
  - `decideSave(loadedRaw, disk) -> { write: boolean, reason }`, `reason` one of `'first-save' | 'unchanged' | 'unreadable' | 'changed' | 'exists' | 'gone'`
  - `saveLibraryFile({ dir, library, loadedRaw, sessionId, deps }) -> Promise<{ status: 'saved', raw } | { status: 'refused', reason, disk }>`, `deps = { writeFileAtomic, backupFileName, prunableBackups, now: () => isoString }`

- [ ] **Step 1: Write the failing tests** in `tests/pid-symbol-store.test.js`.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LIBRARY_FILE, readLibraryFile, decideSave, saveLibraryFile } from '../assets/js/pid-symbol-store.js';
import { parseLibrary, serialiseLibrary, updateSymbol } from '../assets/js/pid-symbols.js';
import { writeFileAtomic, backupFileName, prunableBackups } from '../assets/js/hub-sync.js';

const INVENTED = readFileSync(new URL('./fixtures/invented-symbol-library.json', import.meta.url), 'utf8');
const RAW = serialiseLibrary(parseLibrary(INVENTED).library);
const deps = { writeFileAtomic, backupFileName, prunableBackups, now: () => '2026-11-13T10:00:00.000Z' };

// A directory handle faithful enough for writeFileAtomic: move() overwrites,
// removeEntry() removes, values() lists, and a subdirectory can be created.
function fakeDir(files = {}, opts = {}) {
  const subs = {};
  const dir = {
    files, subs, writes: [],
    getFileHandle: async (name, o) => {
      if (opts.readError && !o?.create) { const e = new Error('lapsed'); e.name = opts.readError; throw e; }
      if (!o?.create && !(name in files)) { const e = new Error('missing'); e.name = 'NotFoundError'; throw e; }
      if (o?.create && !(name in files)) files[name] = '';
      return {
        getFile: async () => ({ text: async () => files[name], lastModified: 0 }),
        createWritable: async () => { let buf = ''; return { write: async c => { buf = c; }, close: async () => { files[name] = buf; dir.writes.push(name); } }; },
        move: async to => { files[to] = files[name]; delete files[name]; dir.writes.push(to); },
      };
    },
    getDirectoryHandle: async (name, o) => {
      if (!subs[name]) { if (!o?.create) { const e = new Error('missing'); e.name = 'NotFoundError'; throw e; } subs[name] = fakeDir({}); }
      return subs[name];
    },
    removeEntry: async name => { delete files[name]; },
    values: async function* () { for (const n of Object.keys(files)) yield { kind: 'file', name: n }; },
  };
  return dir;
}
const edited = () => updateSymbol(parseLibrary(RAW).library, 'p1-001', { name: 'DISC WIDGET' });

test('readLibraryFile: ok, missing and unreadable are three different answers', async () => {
  const ok = await readLibraryFile(fakeDir({ [LIBRARY_FILE]: RAW }));
  assert.deepEqual([ok.status, ok.raw, ok.library.symbols.length], ['ok', RAW, 4]);
  assert.deepEqual(await readLibraryFile(fakeDir({})), { status: 'missing' });
  assert.equal((await readLibraryFile(fakeDir({ [LIBRARY_FILE]: '{oops' }))).status, 'unreadable');
  assert.equal((await readLibraryFile(fakeDir({ [LIBRARY_FILE]: '{"version":2,"symbols":[]}' }))).status, 'unreadable');
  assert.equal((await readLibraryFile(fakeDir({ [LIBRARY_FILE]: RAW }, { readError: 'NotAllowedError' }))).status, 'unreadable');
  for (const bad of [undefined, null, 5, {}]) assert.equal((await readLibraryFile(bad)).status, bad == null ? 'missing' : 'unreadable');
});

test('decideSave: writes only on a first save or an unchanged file', () => {
  const ok = raw => ({ status: 'ok', raw });
  assert.deepEqual(decideSave(null, { status: 'missing' }), { write: true, reason: 'first-save' });
  assert.deepEqual(decideSave(RAW, ok(RAW)), { write: true, reason: 'unchanged' });
  assert.deepEqual(decideSave(RAW, { status: 'unreadable' }), { write: false, reason: 'unreadable' });
  assert.deepEqual(decideSave(null, { status: 'unreadable' }), { write: false, reason: 'unreadable' });
  assert.deepEqual(decideSave(RAW, ok(RAW + ' ')), { write: false, reason: 'changed' });
  assert.deepEqual(decideSave(null, ok(RAW)), { write: false, reason: 'exists' });
  assert.deepEqual(decideSave(RAW, { status: 'missing' }), { write: false, reason: 'gone' });
  for (const bad of [undefined, null, 5, {}]) assert.equal(decideSave(bad, bad).write, false);
});

test('saveLibraryFile: a first save writes the library and nothing else', async () => {
  const dir = fakeDir({ 'register.json': '{"untouched":true}' });
  const r = await saveLibraryFile({ dir, library: edited(), loadedRaw: null, sessionId: 's1', deps });
  assert.equal(r.status, 'saved');
  assert.equal(dir.files[LIBRARY_FILE], r.raw);
  assert.equal(parseLibrary(r.raw).library.symbols[0].name, 'DISC WIDGET');
  assert.deepEqual(Object.keys(dir.files).sort(), ['register.json', LIBRARY_FILE]);
  assert.equal(dir.files['register.json'], '{"untouched":true}');
  assert.ok(dir.writes.every(n => n.startsWith('symbol-library.')));
});

test('saveLibraryFile: an unchanged file is replaced, with the old one backed up first', async () => {
  const dir = fakeDir({ [LIBRARY_FILE]: RAW });
  const r = await saveLibraryFile({ dir, library: edited(), loadedRaw: RAW, sessionId: 's1', deps });
  assert.equal(r.status, 'saved');
  assert.deepEqual(dir.subs.backups.files, { 'symbol-library-2026-11-13T10-00-00.json': RAW });
});

test('saveLibraryFile: every refusal leaves the folder exactly as it was', async () => {
  const cases = [
    ['changed', { [LIBRARY_FILE]: RAW + ' ' }, RAW, {}],
    ['exists', { [LIBRARY_FILE]: RAW }, null, {}],
    ['gone', {}, RAW, {}],
    ['unreadable', { [LIBRARY_FILE]: '{oops' }, RAW, {}],
    ['unreadable', { [LIBRARY_FILE]: RAW }, RAW, { readError: 'NotAllowedError' }],
  ];
  for (const [reason, files, loadedRaw, opts] of cases) {
    const dir = fakeDir({ ...files }, opts);
    const r = await saveLibraryFile({ dir, library: edited(), loadedRaw, sessionId: 's1', deps });
    assert.deepEqual([r.status, r.reason], ['refused', reason]);
    assert.deepEqual(dir.files, files);
    assert.deepEqual([dir.writes, dir.subs], [[], {}]);
  }
});

test('saveLibraryFile: a failed backup does not stop the save, and identical content is not rewritten', async () => {
  const dir = fakeDir({ [LIBRARY_FILE]: RAW });
  dir.getDirectoryHandle = async () => { throw new Error('read-only'); };
  assert.equal((await saveLibraryFile({ dir, library: edited(), loadedRaw: RAW, sessionId: 's1', deps })).status, 'saved');
  const same = fakeDir({ [LIBRARY_FILE]: RAW });
  const r = await saveLibraryFile({ dir: same, library: parseLibrary(RAW).library, loadedRaw: RAW, sessionId: 's1', deps });
  assert.deepEqual([r.status, same.writes, same.subs], ['saved', [], {}]);
});
```

- [ ] **Step 2: Run to see them fail.** Run: `node --test tests/pid-symbol-store.test.js`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `assets/js/pid-symbol-store.js`.** Open with a comment stating that this module names exactly one file, `symbol-library.json`, plus its backups, and must never be given another. Rules:
  - `readLibraryFile`: a null or undefined `dir` is `missing`. `getFileHandle(LIBRARY_FILE, { create: false })` throwing `NotFoundError` is `missing`; any other throw, or `parseLibrary` not ok, is `unreadable` with the error text. It mirrors `readRegisterJSON` in the tool.
  - `decideSave` implements the table the test spells out. Anything it cannot evaluate is `{ write: false, reason: 'unreadable' }`.
  - `saveLibraryFile`: read the file again; `decideSave`; on refusal return `{ status: 'refused', reason, disk }` having written nothing. Otherwise serialise. If the new text equals what is on disk, return `saved` without writing. Otherwise, when the disk held a file, copy its raw text to `backups/<backupFileName(LIBRARY_FILE, now())>` and remove whatever `prunableBackups(names, 20, LIBRARY_FILE)` returns, the whole backup step inside one `try/catch` that only warns; then `writeFileAtomic(dir, LIBRARY_FILE, text, sessionId)`. A rejection from `writeFileAtomic` propagates.

- [ ] **Step 4: Run to see them pass.** Run: `node --test tests/pid-symbol-store.test.js`. Expected: 6 pass.

- [ ] **Step 5: Checkpoint.** Files: `assets/js/pid-symbol-store.js`, `tests/pid-symbol-store.test.js`. Message: `feat(pid): read and save symbol-library.json without overwriting anyone`.

---

### Task 9: The tab's HTML and SVG, with all escaping

**Files:**
- Create: `assets/js/pid-symbols-view.js`
- Test: `tests/pid-symbols-view.test.js`

**Interfaces:**
- Consumes: `Symbol`, `Library`, `Result`, `libraryCounts`, `searchSymbols`, `carryOver` output, `readLegendPage` output (Tasks 3 to 7).
- Produces (all return strings; none throws):
  - `esc(x) -> string` (escapes `& < > " '`; `''` for null or undefined)
  - `symbolSvg(symbol) -> string`
  - `renderStatus({ library, pending, dirty, connected, fileStatus }) -> html`. `fileStatus` is `'none' | 'loaded' | 'unreadable'`.
  - `renderReport(pending) -> html`. `pending` is `{ library, pages } | null`; `pages` is empty for a JSON import.
  - `renderResults(results, { hasTags, editId, limit = 120 }) -> html`
  - `renderExceptions(library) -> html`
  - `replaceConfirmText(counts, carry) -> string` (plain text for `confirm()`)
  - `refusalMessage(reason) -> string` (plain text)
- Buttons carry `data-act` and, where relevant, `data-id`, `data-code`, `data-index`, `data-name`, `data-text`, `data-page`. Inputs inside an edit card carry `data-field`. The acts are: `edit`, `apply`, `cancel`, `delete`, `next-tag`, `add-note`, `remove-note`, `manual-from-row`, `use-pending`, `discard-pending`, `add-exception`, `remove-exception`.

- [ ] **Step 1: Write the failing tests** in `tests/pid-symbols-view.test.js`.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { esc, symbolSvg, renderStatus, renderReport, renderResults, renderExceptions, replaceConfirmText, refusalMessage } from '../assets/js/pid-symbols-view.js';
import { parseLibrary, searchSymbols, legendCells, buildLibrary, libraryCounts, carryOver } from '../assets/js/pid-symbols.js';
import { widgetTable, ruledTable, word } from './fixtures/symbol-table.js';

const LIB = parseLibrary(readFileSync(new URL('./fixtures/invented-symbol-library.json', import.meta.url), 'utf8')).library;
const all = searchSymbols(LIB, '');
// No markup from library text may survive: every "<" in the output must open a tag this module wrote.
const RAW_MARKUP = /<(?!\/?(?:div|span|button|input|select|option|label|details|summary|ul|li|p|h3|h4|small|br|strong|em|svg|path|rect|text)\b)/;

test('esc', () => {
  assert.equal(esc(`<a href="x" onclick='y'>&`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;');
  assert.deepEqual([esc(null), esc(undefined), esc(5)], ['', '', '5']);
});

test('symbolSvg: stored linework becomes one scalable inline SVG', () => {
  const svg = symbolSvg(LIB.symbols[0]);
  assert.match(svg, /^<svg class="sym-svg" viewBox="-2 -2 44 24"/);
  assert.match(svg, /<path d="M0 0L40 0L40 20L0 20L0 0" fill="none" stroke="currentColor" stroke-width="0.7"/);
  assert.match(symbolSvg(LIB.symbols[1]), /<path d="M0 0L30 30M30 0L0 30"/); // a break starts a new subpath
  assert.match(symbolSvg(LIB.symbols[1]), /<text x="11" y="18" font-size="8"[^>]*>M<\/text>/);
});

test('symbolSvg: fills, white masks, hairlines, and a placeholder when there is no linework', () => {
  const s = paths => symbolSvg({ w: 10, h: 10, paths });
  assert.match(s([{ segs: [0, 0, 10, 0, 10, 0, 5, 10, 5, 10, 0, 0], width: 0, stroked: false, filled: true, grey: 0 }]), /fill="currentColor" fill-rule="evenodd" stroke="none"/);
  assert.match(s([{ segs: [0, 0, 10, 0], width: 1, stroked: true, filled: true, grey: 255 }]), /fill="var\(--bg, #fff\)"/);
  assert.match(s([{ segs: [0, 0, 10, 0], width: 0, stroked: true, filled: false, grey: 0 }]), /stroke-width="0.35"/);
  assert.match(s([{ segs: [0, 0, 10, 0], width: 1, stroked: true, filled: false, grey: 128 }]), /opacity="0.5"/);
  assert.match(symbolSvg(LIB.symbols[3]), /class="sym-svg sym-svg-none"/);
});

test('symbolSvg: hostile symbols cannot inject markup or break the SVG', () => {
  const svg = symbolSvg({ w: 10, h: 10, paths: [{ segs: [0, 0, 10, 0], width: 1, stroked: true }], letters: LIB.symbols[2].letters });
  assert.ok(!/<script/i.test(svg) && svg.includes('&lt;/text&gt;'));
  assert.match(symbolSvg(LIB.symbols[2]), /sym-svg-none/); // letters alone are not linework
  const junk = symbolSvg({ w: 'x', h: NaN, paths: [{ segs: [0, 0, '"><script>', 1], width: '1" onload="x' }, null, 5], letters: [{ text: 'A', x: '"', y: {}, size: 'big' }] });
  assert.ok(!junk.includes('script') && !junk.includes('onload'));
  for (const bad of [undefined, null, 5, 'x', []]) assert.match(symbolSvg(bad), /^<svg /);
});

test('renderResults: shows the symbol, name, tag identifier, sheet, notes and aliases, all escaped', () => {
  const html = renderResults(all, { hasTags: true, editId: null });
  assert.ok(!RAW_MARKUP.test(html), 'unescaped markup from the library reached the page');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;') && html.includes('&lt;b&gt;GADGETS&lt;/b&gt;'));
  assert.ok(html.includes('ROUND WIDGET') && html.includes('Sheet 7') && html.includes('peep hole') && html.includes('Use for the rare tilting kind too.') && html.includes('RFI 12'));
  assert.match(html, /<button[^>]*data-act="next-tag"[^>]*data-code="Q"[^>]*>Next available tag: Q<\/button>/);
  assert.match(html, /data-act="edit" data-id="p1-001"/);
  assert.ok(html.includes('Manual entry') && html.includes('Simple shape'));
});

test('renderResults: the next-tag link is off without drawings, split per code, absent without a tag identifier', () => {
  const off = renderResults(all, { hasTags: false });
  assert.match(off, /data-act="next-tag"[^>]*disabled[^>]*title="Load drawings first"/);
  const two = renderResults(searchSymbols(parseLibrary('{"version":1,"symbols":[{"name":"A","tagId":"K/KX"},{"name":"B"}]}').library, ''), { hasTags: true });
  assert.deepEqual([...two.matchAll(/data-code="([^"]*)"/g)].map(m => m[1]), ['K', 'KX']);
});

test('renderResults: exceptions answer in words, an empty result says so, a long list is capped', () => {
  const html = renderResults(searchSymbols(LIB, 'gizmo'), { hasTags: true });
  assert.ok(html.includes('GIZMO') && html.includes('No palette symbol. Pending the next palette release.') && html.includes('RFI 20'));
  assert.ok(renderResults(searchSymbols(LIB, 'doohickey'), {}).includes('No palette symbol. Approved to use as a CAD block.'));
  assert.ok(renderResults([], {}).includes('No symbol matches.'));
  const many = Array.from({ length: 130 }, (_, i) => ({ kind: 'symbol', score: 0, symbol: { ...LIB.symbols[0], id: 'k' + i } }));
  const capped = renderResults(many, {});
  assert.equal((capped.match(/class="sym-card/g) || []).length, 120);
  assert.ok(capped.includes('10 more. Keep typing to narrow the list.'));
  for (const bad of [undefined, null, 5, [null, 7, {}]]) assert.doesNotThrow(() => renderResults(bad, bad));
});

test('renderResults: the card being edited shows its fields', () => {
  const html = renderResults(all, { hasTags: true, editId: 'p1-002' });
  for (const f of ['name', 'group', 'tagId', 'aliases', 'simple', 'stretch', 'note-text', 'note-ref']) assert.ok(html.includes('data-field="' + f + '"'), f);
  assert.match(html, /data-field="aliases"[^>]*value="peep hole"/);
  assert.match(html, /data-field="simple"[^>]*checked/);
  for (const a of ['apply', 'cancel', 'delete', 'add-note', 'remove-note']) assert.ok(html.includes('data-act="' + a + '"'), a);
  assert.equal((html.match(/data-field="name"/g) || []).length, 1);
});

test('renderStatus: says what is loaded, where it came from and whether it is saved', () => {
  const s = renderStatus({ library: LIB, pending: null, dirty: true, connected: true, fileStatus: 'loaded' });
  assert.ok(s.includes('4 symbols') && s.includes('Sheet 7 rev B03') && s.includes('Unsaved changes'));
  assert.ok(renderStatus({ library: null, connected: false, fileStatus: 'none' }).includes('No symbol library yet.'));
  assert.ok(renderStatus({ library: LIB, dirty: true, connected: false, fileStatus: 'none' }).includes('Connect the folder to save.'));
  assert.ok(renderStatus({ library: null, connected: true, fileStatus: 'unreadable' }).includes('could not be read'));
  for (const bad of [undefined, null, 5]) assert.doesNotThrow(() => renderStatus(bad));
});

test('renderReport: a preview states its totals and lists every row it could not read', () => {
  const t = widgetTable();
  const paths = [...ruledTable({ x0: 100, x1: 400, divider: 250, ys: [50, 80, 110, 150, 190, 230], dividerTo: 4 }), ...t.paths.slice(-3),
    ...ruledTable({ x0: 450, x1: 750, divider: 600, ys: [50, 80] })];
  const page = { page: 2, sheet: '7', rev: 'B03', ...legendCells(paths, [...t.words, word('<b>NOTE</b>', 455, 60)]) };
  const html = renderReport({ library: buildLibrary([page], 'now'), pages: [page] });
  assert.ok(html.includes('Preview. Nothing is saved yet.') && html.includes('2 symbols from 1 page'));
  assert.ok(html.includes('1 row could not be split') && html.includes('LAST WIDGET') && html.includes('no divider'));
  assert.match(html, /<details[^>]*>\s*<summary>Other ruled areas \(1\)/);
  assert.ok(html.includes('&lt;b&gt;NOTE&lt;/b&gt;') && !RAW_MARKUP.test(html));
  assert.match(html, /data-act="manual-from-row"[^>]*data-text="LAST WIDGET"[^>]*data-page="2"/);
  assert.ok(html.includes('data-act="use-pending"') && html.includes('data-act="discard-pending"'));
  assert.equal(renderReport(null), '');
  assert.ok(renderReport({ library: LIB, pages: [] }).includes('4 symbols from a library file'));
});

test('renderExceptions: lists each with its status and offers the add form', () => {
  const html = renderExceptions(LIB);
  assert.ok(html.includes('GIZMO') && html.includes('Pending the next palette release') && html.includes('DOOHICKEY') && html.includes('Approved to use as a CAD block'));
  assert.match(html, /data-act="remove-exception" data-name="GIZMO"/);
  for (const f of ['ex-name', 'ex-status', 'ex-note', 'ex-ref']) assert.ok(html.includes('data-field="' + f + '"'));
  assert.doesNotThrow(() => renderExceptions(null));
});

test('replaceConfirmText and refusalMessage', () => {
  const carry = carryOver(LIB, buildLibrary([], 'now'));
  const text = replaceConfirmText(libraryCounts(LIB), carry);
  assert.ok(text.startsWith('The library in use holds 4 symbols, 2 notes, 2 aliases and 2 exceptions.'));
  assert.ok(text.includes('could not be matched') && text.includes('VIEWING PORT'));
  assert.equal(refusalMessage('changed'), 'Someone else has saved the symbol library since you loaded it. Nothing was overwritten. Reload from the folder, then make your change again.');
  assert.equal(refusalMessage('unreadable'), 'symbol-library.json could not be read just now, so nothing was saved and nothing was overwritten. Try again in a moment.');
  assert.equal(refusalMessage('gone'), 'The symbol library file has gone from the folder since you loaded it. Nothing was saved. Reload from the folder to check, then save again.');
  assert.equal(refusalMessage('exists'), 'This folder already holds a symbol library that this session has not loaded. Nothing was overwritten.');
  assert.equal(typeof refusalMessage(null), 'string');
});
```

- [ ] **Step 2: Run to see them fail.** Run: `node --test tests/pid-symbols-view.test.js`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `assets/js/pid-symbols-view.js`.** Open with a comment that library text comes from a shared folder and is hostile, so every string goes through `esc` and every number through a finite-number check. Decisions the tests leave open:
  - **Tags and attribute order.** The only tags written are those in the test's `RAW_MARKUP` list. Attributes are written in a fixed order the tests rely on: on `<svg>`, `class` then `viewBox`; on `<path>`, `d`, `fill`, `fill-rule` (filled paths only), `stroke`, `stroke-width` (stroked paths only), `opacity`; on `<text>`, `x`, `y`, `font-size`; on buttons, `data-act` first, then `data-id`, `data-code`, `data-index`, `data-name`, `data-text`, `data-page`, then `disabled`, then `title`; on inputs, `data-field` before `value` or `checked`. No element other than a `next-tag` button carries `data-code`.
  - **`symbolSvg`.** `viewBox` is `-2 -2 (w+4) (h+4)` with `preserveAspectRatio="xMidYMid meet"`. One `<path>` per stored path; `d` is `M x y` for the first point and after any break, `L x y` otherwise, with no separator between commands (`M0 0L40 0`), numbers printed with at most 2 decimals and no trailing zeros. A path that is not stroked has `stroke="none"`. Stroke width is the stored width, at least 0.35. A stroked path has `stroke="currentColor"`; a filled one `fill="currentColor" fill-rule="evenodd"`, or `fill="var(--bg, #fff)"` when `grey >= 250`; otherwise `none`. `opacity` is `1 - grey/255` rounded to 2 places, clamped to 0.3 at least, written only when below 1 and the path is not a white mask. Letters are `<text>` at `x`, `y + size` with `font-size` `size`. A symbol with no usable path returns a 40 by 24 dashed box with class `sym-svg sym-svg-none`.
  - **Result card.** Root `<div class="sym-card" data-id="...">`. It shows the SVG, the name, then `group · tag identifier · Sheet <sheet>`, the aliases as `Also: a, b`, each note as text with its ref and date, and badges `Manual entry`, `Simple shape`, `Drawn to suit` (stretch) and `Not in the imported legend` (unmatched). One `next-tag` button per tag code, labelled `Next available tag: <code>`; with `hasTags` false it is `disabled` with `title="Load drawings first"`. An `Edit` button. In the card whose id is `editId`, the read-only block is replaced by inputs for `name`, `group`, `tagId`, `aliases` (comma separated), checkboxes `simple` and `stretch`, each note with a `remove-note` button, a `note-text` and `note-ref` pair with `add-note`, and `apply`, `cancel`, `delete` buttons.
  - **Exception result.** `<div class="sym-card sym-exception">` with the name, then `No palette symbol. Approved to use as a CAD block.` or `No palette symbol. Pending the next palette release.`, then the note and ref.
  - **`renderReport`.** For a PDF import: `Preview. Nothing is saved yet. N symbols from P pages.` then `K rows could not be split` with each as `Page p · heading · reason · text` and a `manual-from-row` button; then `<details>` titled `Other ruled areas (A)`, `A` being the number of rows across those areas, listing each row with the same button; then, when above 0, `E empty rows.` Singulars are spelt correctly (`1 symbol`, `1 page`, `1 row`). For a JSON import: `Preview. Nothing is saved yet. N symbols from a library file.` Both end with `Use this library` (`use-pending`) and `Discard` (`discard-pending`).
  - **`renderStatus`.** `N symbols · Sheet a rev x, Sheet b rev y · imported <date part of importedAt>`, then `Unsaved changes` when `dirty`, then `Connect the folder to save.` when `dirty` and not `connected`. No library: `No symbol library yet. Import the legend PDF to build one.` `fileStatus === 'unreadable'`: `symbol-library.json in this folder could not be read. It has not been loaded and saving is blocked until it can be read.`
  - **`replaceConfirmText`.** `The library in use holds N symbols, M notes, A aliases and E exceptions.` Then what carries over, from `carry.summary`. Then, when `carry.unmatched` is not empty, `K could not be matched to the new legend and will be kept, marked "Not in the imported legend":` and their names (first 15, then `and N more`). Then, when present, the `exceptionsNowInLibrary` names under `These exceptions now have a symbol:`. Last line: `Replace the library?`

- [ ] **Step 4: Run to see them pass.** Run: `node --test tests/pid-symbols-view.test.js`. Expected: 12 pass.

- [ ] **Step 5: Run the whole suite.** Run: `npm test`. Expected: 733 tests (661 plus 72), 731 passing, 0 failing, 2 skipped.

- [ ] **Step 6: Checkpoint.** Files: `assets/js/pid-symbols-view.js`, `tests/pid-symbols-view.test.js`. Message: `feat(pid): render the Symbols tab as escaped HTML and inline SVG`.

---

### Task 10: Wire the Symbols tab into the tool

**Files:**
- Modify: `tools-src/pid-tag-register.html` (gitignored). Line numbers are approximate; find each anchor by its text.

**Interfaces:**
- Consumes: everything exported by `pid-symbols.js`, `pid-symbols-view.js` and `pid-symbol-store.js`, reached as `window.PidSymbols`; from the tool, `registerDir`, `ensureRegisterDir()`, `sessionId`, `allTags`, `switchTab`, `showUI`, `connectFolder`, `disconnectFolder`, `pdfjsLib`, `window.PidComments.writeFileAtomic / backupFileName / prunableBackups`.
- Produces: nothing other tasks rely on.

- [ ] **Step 1: Record the before-state.** Run: `grep -c "register\.json" tools-src/pid-tag-register.html`. Expected: `19`. Keep the number; Step 9 checks it has not changed.

- [ ] **Step 2: Import the modules.** In the `<script type="module">` block at the end of the file, after the `window.PidCore = PidCore;` line:

```js
  // Symbol library: behaviour lives in three tested modules. The library
  // itself is client data and lives only in the register folder.
  import * as PidSymbolsCore from '/assets/js/pid-symbols.js';
  import * as PidSymbolsView from '/assets/js/pid-symbols-view.js';
  import * as PidSymbolStore from '/assets/js/pid-symbol-store.js';
  window.PidSymbols = Object.assign({}, PidSymbolsCore, PidSymbolsView, PidSymbolStore);
```

- [ ] **Step 3: Add the button and the tab skeleton.**
  - Directly after the closing `</div>` of `<div id="tabs" ...>` (about line 576), outside it so it shows with an empty register:

```html
    <div id="symbols-nav">
      <div class="nav-group-label">Reference</div>
      <button class="tab tab-green" data-tab="symbols" onclick="switchTab('symbols')" title="Find the standard symbol for an item">
        <div style="display:flex;align-items:center;"><span class="tab-icon">◇</span> <span class="tab-label">Symbols</span></div>
      </button>
    </div>
```

  - Directly after the `suggester-wrap` block (about line 743):

```html
      <!-- ── Symbols ── -->
      <div id="symbols-wrap">
        <p class="sug-intro">Find the standard symbol for an item, with its name, tag identifier and legend sheet. The library is built from the legend PDF and kept in the connected folder.</p>
        <div class="sym-bar">
          <label class="btn">Import legend… <input type="file" id="sym-file" accept=".pdf,.json" hidden></label>
          <button class="btn btn-accent" id="sym-save">Save to folder</button>
          <button class="btn" id="sym-reload">Reload from folder</button>
          <span id="sym-status"></span>
        </div>
        <div id="sym-message" role="status"></div>
        <div id="sym-report"></div>
        <div class="sym-bar">
          <input class="sug-input wide" id="sym-search" type="search" placeholder="butterfly valve, or a tag code such as V" style="text-transform:none;width:360px">
          <input class="sug-input wide" id="sym-manual-name" type="text" placeholder="Name of a symbol not on the legend" style="text-transform:none;width:300px">
          <button class="btn" id="sym-add-manual">Add manual entry</button>
        </div>
        <div id="sym-results"></div>
        <div id="sym-exceptions"></div>
      </div>
```

  - In the `<style>` block: add `#symbols-wrap` to the selector list that begins `#families-wrap, #suggester-wrap, #pac-wrap, #revcompare-wrap` (about line 381), and add after the `.sug-*` rules:

```css
  .sym-bar { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; }
  #sym-status { font-size: 0.9rem; color: var(--tmut); }
  #sym-message:not(:empty), #sym-report:not(:empty) { background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px 20px; margin-bottom: 16px; max-width: 900px; }
  #sym-results { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
  .sym-card { background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px; display: flex; flex-direction: column; gap: 8px; color: var(--text); }
  .sym-card.sym-exception { border-style: dashed; }
  .sym-svg { width: 100%; height: 96px; color: var(--text); }
  .sym-svg-none { color: var(--tmut); }
  .sym-card input[type=text] { width: 100%; }
```

- [ ] **Step 4: Teach `switchTab` and `showUI` about the tab.**
  - In `switchTab` (about line 1462): add `const isSymbols = tab === 'symbols';`, add `&& !isSymbols` to the `isTable` expression, add `document.getElementById('symbols-wrap').style.display = isSymbols ? 'block' : 'none';`, and at the end `if (isSymbols) { document.getElementById('empty').style.display = 'none'; renderSymbols(); }`.
  - In `showUI` (about line 1441), in the `if (!show)` block, replace `currentTab = 'all';` with:

```js
    // The Symbols tab works with an empty register, so an empty register must
    // not close it or put the "get started" card over it.
    if (currentTab === 'symbols') document.getElementById('empty').style.display = 'none';
    else currentTab = 'all';
```

- [ ] **Step 5: Add the state and glue.** A new section headed `// SYMBOLS` in the classic `<script>`, just before its closing `</script>` (about line 3628). It contains exactly these, and **nothing in it may call `saveToFolder`, `scheduleSave`, `mergeState` or name `register.json`:**

```js
let symLib = null;        // the library in use, in memory
let symLibRaw = null;     // exact text of symbol-library.json as loaded or last saved; null if never
let symPending = null;    // { library, pages } while an import is being previewed
let symDirty = false;
let symFileStatus = 'none'; // 'none' | 'loaded' | 'unreadable'
let symEditId = null;
let symMessage = '';
```

  - `symShown()` returns `symPending ? symPending.library : symLib`.
  - `renderSymbols()`: if `window.PidSymbols` is missing, put "The symbol module failed to load." in `#sym-message` and return. Otherwise set `#sym-status`, `#sym-report`, `#sym-results` and `#sym-exceptions` from `renderStatus`, `renderReport(symPending)`, `renderResults(searchSymbols(symShown(), <#sym-search value>), { hasTags: allTags.length > 0, editId: symEditId })` and `renderExceptions(symShown())`; set `#sym-message` with `textContent = symMessage`. With no library shown, `#sym-results` and `#sym-exceptions` are emptied. `#sym-save` is disabled unless `registerDir || pendingRegisterSubfolder`, `symLib`, `symDirty`, no `symPending`, and `symFileStatus !== 'unreadable'`; its `title` gives the reason when disabled. `#sym-reload` is disabled when not connected.
  - `importLegendFile(file)`: a name ending `.json` is read as text and passed to `parseLibrary`; not ok sets `symMessage` to "That file is not a symbol library." and stops; ok sets `symPending = { library, pages: [] }`. Anything else is treated as a PDF: `pdfjsLib.getDocument({ data })`, then for each page `getOperatorList()`, `getTextContent()`, `getViewport({ scale: 1 })`, and `PidSymbols.readLegendPage({ fnArray, argsArray, OPS: pdfjsLib.OPS, viewportTransform: viewport.transform, textItems: content.items, page: n })`, updating `symMessage` to `Reading page n of N…`. Then `library = PidSymbols.buildLibrary(pages, new Date().toISOString())`. **If it has no symbols, set `symMessage` to "No symbol rows were found in that PDF. The library in use has not been changed." and do not set `symPending`.** Any thrown error sets `symMessage` to "That PDF could not be read." Always clear the file input's value and re-render.
  - `usePendingLibrary()`: with no `symLib`, the pending library becomes `symLib`. With one, compute `carry = PidSymbols.carryOver(symLib, symPending.library)` and ask `confirm(PidSymbols.replaceConfirmText(PidSymbols.libraryCounts(symLib), carry))`; on yes `symLib = carry.library`; on no, leave the preview open. On acceptance: `symPending = null; symDirty = true; symEditId = null`.
  - `loadSymbolLibraryFromFolder(force)`: `const disk = await PidSymbols.readLibraryFile(registerDir)`. `unreadable`: `symFileStatus = 'unreadable'`, keep memory as it is. `missing`: `symFileStatus = 'none'; symLibRaw = null`. `ok`: if `force`, or there is no `symLib`, or `!symDirty`, then `symLib = disk.library; symLibRaw = disk.raw; symDirty = false; symFileStatus = 'loaded'`; otherwise (an unsaved library is in memory) leave memory alone and `symLibRaw = null`, so the next save is refused as `exists` and handled below. Re-render if `currentTab === 'symbols'`. The whole body is in a `try/catch` that logs and never throws.
  - `saveSymbolLibrary()`: `const dir = await ensureRegisterDir(); if (!dir) return;` then `PidSymbols.saveLibraryFile({ dir, library: symLib, loadedRaw: symLibRaw, sessionId, deps: { writeFileAtomic: window.PidComments.writeFileAtomic, backupFileName: window.PidComments.backupFileName, prunableBackups: window.PidComments.prunableBackups, now: () => new Date().toISOString() } })`. `saved`: `symLibRaw = r.raw; symDirty = false; symFileStatus = 'loaded'; symMessage = 'Saved.'`. `refused` with `exists`: compute `carry = carryOver(r.disk.library, symLib)` and `confirm(replaceConfirmText(libraryCounts(r.disk.library), carry))`; on yes `symLib = carry.library; symLibRaw = r.disk.raw;` and call `saveSymbolLibrary()` once more; on no, `symMessage = refusalMessage('exists') + ' Use Reload from folder to load it instead.'`. Any other refusal: `symMessage = PidSymbols.refusalMessage(r.reason)`. A thrown error: `symMessage = 'The save failed. Nothing was overwritten.'`. If `window.PidComments.writeFileAtomic` is missing, refuse with that same message; there is **no direct-write fallback** here.
  - `openSuggesterFor(code)`: only when `allTags.length`. Set `#sug-fc` to `code`, clear `#sug-search`, `switchTab('suggester')`, focus `#sug-pac`.
  - One delegated `click` listener on `#symbols-wrap`, reading `e.target.closest('[data-act]')`, mapping:

| `data-act` | Call |
|---|---|
| `edit` / `cancel` | `symEditId = id` / `null` |
| `apply` | read the card's `[data-field]` inputs into `{ name, group, tagId, aliases: value.split(','), simple, stretch }`; `updateSymbol` |
| `delete` | `confirm('Delete this symbol from the library?')`, then `deleteSymbol` |
| `add-note` | `addNote(lib, id, { text: note-text, ref: note-ref, date: today as YYYY-MM-DD })` |
| `remove-note` | `removeNote(lib, id, Number(data-index))` |
| `next-tag` | `openSuggesterFor(data-code)` |
| `manual-from-row` | `addManualSymbol(lib, { name: data-text, sheet })`, `sheet` being the `sheet` of the pending page whose `page` equals `data-page`, else `data-page`; then `symEditId` = the new id |
| `add-exception` | `setException(lib, { name: ex-name, status: ex-status, note: ex-note, ref: ex-ref })` |
| `remove-exception` | `removeException(lib, data-name)` |
| `use-pending` / `discard-pending` | `usePendingLibrary()` / `symPending = null` |

    Every edit applies to `symShown()`: assign the result back to `symPending.library` when previewing, else to `symLib` with `symDirty = true`. Then `renderSymbols()`.
  - Plain listeners: `#sym-file` `change` calls `importLegendFile`; `#sym-search` `input` re-renders only `#sym-results`; `#sym-add-manual` adds from `#sym-manual-name` and opens the new card for editing; `#sym-save` calls `saveSymbolLibrary`; `#sym-reload` asks `confirm('Discard unsaved changes and load the library from the folder?')` when `symDirty`, then `loadSymbolLibraryFromFolder(true)`.
  - `window.addEventListener('beforeunload', e => { if (symDirty) { e.preventDefault(); e.returnValue = ''; } });`

- [ ] **Step 6: Hook connect and disconnect.**
  - At the very end of `connectFolder()` (after its final `if/else` that may call `saveToFolder()`), add `await loadSymbolLibraryFromFolder(false);`. The early `return` in the unreadable-register branch already skips it.
  - In `disconnectFolder()`, before `updateFolderChip('disconnected')`, add `symLibRaw = null; symFileStatus = 'none'; if (currentTab === 'symbols') renderSymbols();`. The library in memory stays usable.

- [ ] **Step 7: Check the tool still parses.**

```bash
node -e "
const fs=require('fs');
const s=fs.readFileSync('tools-src/pid-tag-register.html','utf8');
const m=[...s.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]).sort((a,b)=>b.length-a.length)[0];
fs.writeFileSync(process.env.TEMP+'/pid-check.cjs', m);
" && node --check "$TEMP/pid-check.cjs" && echo "SYNTAX OK"
```

Expected: `SYNTAX OK`.

- [ ] **Step 8: Run the suite.** Run: `npm test`. Expected: 733 tests, 731 passing, 0 failing, 2 skipped. `tests/escaping-audit.test.js` reads this file; it must still pass.

- [ ] **Step 9: Prove no register path was added.**

Run: `grep -c "register\.json" tools-src/pid-tag-register.html`. Expected: `19`, as in Step 1.
Run: `sed -n '/^\/\/ SYMBOLS/,$p' tools-src/pid-tag-register.html | grep -c "saveToFolder\|scheduleSave\|mergeState\|register\.json"`. Expected: `0`.

- [ ] **Step 10: Verify in the browser.** Start the preview server (`preview_start` with name `site`) and open `http://localhost:5050/tools-src/pid-tag-register.html`. Use only the invented fixture. Check each line and record the result:
  1. Fresh page, no folder, no drawings: the Symbols button is visible; clicking it shows the tab and hides the "Get started" card; the console has no errors.
  2. Import the invented library. From the console, which needs no file dialog: `await importLegendFile(new File([await (await fetch('/tests/fixtures/invented-symbol-library.json')).text()], 'invented-symbol-library.json'))`. The preview banner reads "4 symbols from a library file"; nothing is saved.
  3. The hostile symbol's name shows as literal text. Evaluate `document.querySelectorAll('#symbols-wrap script, #symbols-wrap img').length`: expected `0`. No alert appears.
  4. "Use this library", then search `peep hole`: VIEWING PORT is first, drawn as a cross with an M. Search `q`: the Q family lists first. Search `gizmo`: the exception answers "No palette symbol. Pending the next palette release."
  5. Edit ROUND WIDGET: rename it, add an alias and a note, tick "simple", Apply. The card updates and the status shows "Unsaved changes". Save is disabled with the reason "connect the folder".
  6. The "Next available tag" button is disabled with no drawings loaded.
  7. Save flows, using the browser's private file system so no dialog is needed. In the console:
     `registerDir = await navigator.storage.getDirectory(); dirHandle = registerDir; connectMode = 'legacy'; renderSymbols();` then click Save. Expected: "Saved.", and `await (await (await registerDir.getFileHandle('symbol-library.json')).getFile()).text()` parses and holds the rename.
     Then make one more edit and Save again. Expected: "Saved.", and `backups` now holds one `symbol-library-<stamp>.json`.
  8. Refusal: in the console overwrite the file with different valid content (`const w = await (await registerDir.getFileHandle('symbol-library.json')).createWritable(); await w.write(JSON.stringify({version:1,symbols:[{name:'OTHER'}]})); await w.close();`), make an edit, click Save. Expected: the "Someone else has saved…" message, and the file still holds `OTHER`.
  9. Reload from folder, confirm: the library shown is the one with `OTHER`.
  10. Check that the private file system holds no `register.json` written by these steps: list `registerDir` entries. Expected: `symbol-library.json` and `backups` only.
  11. A PDF that is not a legend: `const m = await import('/tests/fixtures/tiny-pdf.js'); await importLegendFile(new File([m.tinyPdf(m.TINY_CONTENT, m.TINY_FORM)], 'not-a-legend.pdf'))`. Expected: "No symbol rows were found in that PDF. The library in use has not been changed.", no preview, and the library shown is unchanged.
  12. Clean up: `await registerDir.removeEntry('symbol-library.json'); await registerDir.removeEntry('backups', { recursive: true });` then reload the page.

Report every line that did not behave as written, with what happened instead.

- [ ] **Step 11: Checkpoint.** Nothing tracked changed. Message, if the owner has asked for commits: `git commit --allow-empty -m "feat(pid): Symbols tab in the tag register (source in gitignored tools-src/)"`.

---

### Task 11: Gate 1 through the tool, and hand-over

**Files:** none changed. The legend stays outside the repository.

- [ ] **Step 1: Import the real legend through the tool.** In the preview, on the Symbols tab, import `../pid-symbol-spike/legend-sheets.pdf` through the file input. This needs a tool that can set a file input. **If you have none, do not copy the legend into the repository and do not serve its folder: leave Steps 1 to 3 to the owner and say so in the hand-over.** The script in Task 6 has already run the same module code through the same pdf.js build. Record the preview's totals. Expected: the same totals the script printed in Task 6 Step 5 (389 symbols from 6 pages in the planning measurement; 0 rows that could not be split). A difference between the browser and the script is a finding: report both numbers.

- [ ] **Step 2: Look at what was drawn.** Scroll the results with an empty search. Report, with counts: symbols that draw as an empty or obviously broken shape, and symbols whose letter is missing or misplaced. Compare a sample of twenty against `../pid-symbol-spike/lib_contact.png`. Do not copy any image into the repository.

- [ ] **Step 3: Time it.** Report how long the import took and how the tab responds while typing in the search box.

- [ ] **Step 4: Write the hand-over for the owner.** State plainly:
  - the totals per sheet, and that sheets 2 to 6 gave N rows;
  - every unsplit row and the count of other ruled areas, including that the instrument-bubble table needs entering by hand (13 rows in the planning measurement);
  - the two sheet 4 symbols whose size differed from the test's, if still so;
  - anything in Task 10 Step 10 that failed.

- [ ] **Step 5: The owner's part of Gate 1.** These cannot be done by an agent; ask for them:
  1. Check the imported rows against legend sheets 2 to 6 and say which, if any, are missing or wrong.
  2. Connect the real shared folder, save the library, and confirm `symbol-library.json` appears there and `register.json` is unchanged. (The save has been exercised only against the browser's private file system.)
  3. Add the aliases and exceptions wanted, then write twenty searches as `[{ "q": "...", "expect": "<symbol name>" }]` in a file outside the repository, and run:
     `node scripts/check-symbol-import.mjs --library "<register folder>/symbol-library.json" --searches "<that file>"`
     Gate 1 passes when all twenty are in the top three.

- [ ] **Step 6: Final suite run.** Run: `npm test`. Expected: 733 tests, 731 passing, 0 failing, 2 skipped. Confirm `git status --short` lists only the new files named in this plan, and that none of them contains legend data.

---

## Fallback: if pdf.js cannot reproduce the extraction

Not expected: the planning measurement had pdf.js find more than the test did. It applies only if Task 6 Step 5 is a no-go.

1. Stop after Task 6 and report the numbers. Tasks 7 to 10 do not depend on how the library was built and still go ahead.
2. The test's own library (`lib.pkl`) holds bitmaps, not linework, so it cannot be imported as it is. Write a one-off exporter **in `../pid-symbol-spike/`**, not in this repository, that uses the test's `table_cells` and the PDF library's vector drawings to write a file in the `Library` shape of Task 4.
3. Import that file through the tab's file input, which already accepts a library `.json` (Task 10), fix it up by hand, and save.
4. Tell the owner that phase 3 is then in doubt, as the design says, and must be re-examined before it is planned.

## What this plan leaves for later

- `families` in the library file is created empty and preserved; nothing edits it until phase 3.
- Hidden comments (`getAnnotations`), the raster and the matcher belong to phases 2 and 3.
- Publishing: the owner re-locks the tool with `scripts/lock-tools.mjs`, and the three new files under `assets/js/` must be pushed with it, or the live tool will not find them.

## Outcome (2026-11-14)

Executed in one session, with one independent review at the end.

- **Tests:** 736 (baseline 661), 734 passing, 0 failing, 2 skipped. Two more than planned: one for typed-array operator arguments, which the real-pdf.js test exposed, and one for a minimum drawing size.
- **Extraction on the real legend, by the Task 6 script:** 390 symbols, 37 / 139 / 78 / 84 / 33 / 19 by sheet, so 353 on sheets 2 to 6, with no row left unsplit. This supersedes the 389 and 352 quoted above. The extra row is a real final row on sheet 4 that the planning prototype missed, because it did not draw closing segments and the finished walker does.
- **Library file:** about 0.8 MB, not the 0.5 MB estimated.
- **Review:** nothing critical. Three important findings, all fixed: a renamed or flagged symbol with no notes was dropped on re-import; a library loaded from one folder could not be saved into another that had none; and an unreadable file left Save disabled until a reload that discarded edits.
- **Deferred:** word order of labels that read up the page; Save not disabled while a save is running; no explanation when a file fails to read because of a byte-order mark; a library file with zero symbols still previews; importing again discards an edited preview without warning.
- **Checked by the owner:** importing the legend through the tool and searching it.
- **Not yet checked:** saving to the real shared folder, which needs the published tool on the machine that has the folder.
