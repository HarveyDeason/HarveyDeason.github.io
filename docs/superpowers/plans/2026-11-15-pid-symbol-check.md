# P&ID Symbol Check (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A **Check symbols** button on a sheet in the Sheets tab that says, for each tagged item on a palette-drawn sheet, whether a standard symbol of the right family sits beside the tag.

**Architecture:** One new pure module, `assets/js/pid-symbol-check.js`, holds the whole method: where each tag is on the page, a rasteriser, placement proposals by pairing a symbol's longest lines with drawing lines, the two-way ink score with filled loops, and the sheet's verdicts. A local-only script runs it on test drawing A in Node for Gate 3. **Tasks 1 to 6 build and test that and nothing else. Tasks 7 to 9 (worker, button, boxes, list) start only if Gate 3 passes.**

**Tech Stack:** Vanilla ES modules, `node --test` on Node 20, pdf.js 3.11.174 (vendored, loaded in Node through `scripts/pdfjs-node.mjs`), a module Web Worker, the preview server (`.claude/launch.json` config `site`, port 5050).

**Spec:** `docs/superpowers/specs/2026-11-13-pid-symbol-library-and-check-design.md`. Phase 3 and Gate 3 only. Phases 1 and 2 are built and live.

## If Gate 3 fails

Work stops at the end of Task 6. Tasks 7 to 9 are not started. The numbers the script printed are written into this plan's Outcome section exactly as they came out, with what failed stated first. Nothing is tuned to make the drawing pass beyond the two adjustments Task 6 allows. The module, its tests and the script stay uncommitted until the owner decides what to do with them. Phases 1 and 2 stand on their own.

## Global Constraints

- **The repository is public.** No Wessex Water data in `assets/js/`, `scripts/`, `docs/`, tests or fixtures: no legend geometry, symbol lists, table headings, drawing numbers, site, contractor, supplier or person names, no real tags. Tests use the invented symbols and invented sheet of Task 1.
- **The private files stay outside the repository:** `../pid-symbol-spike/legend-sheets.pdf` and `test-drawing-A.pdf`, `-B.pdf`, `-C.pdf`. Never copied in, never served from it. The Gate 3 script builds the library in memory and writes nothing. Its output stays in the terminal and the task report. The private values this plan refers to (function codes, a table heading) are in `phase3-plan-handover.md` in the shared notes folder for this work, outside the repository.
- **Nothing writes `register.json` or anything about symbols into the register.** Check results are shown, not saved. The new tool code calls none of `saveToFolder`, `scheduleSave`, `mergeState`, `buildRegisterState`, `snapshotRev`, `createWritable`, `saveLibraryFile`. Task 8 measures this before and after.
- **The check never runs by itself.** Not at import, not when a sheet opens. Only the button starts it.
- **Pure functions do not throw.** Every export of the new modules returns degraded output on any input, as `pid-core.js` does.
- **Zero build, no new dependencies.**
- **`tools-src/` is gitignored.** Tool edits are made by an anchored patch, after a backup, in the workspace `.superpowers/sdd/2026-11-15-pid-symbol-check/` (also gitignored). Never run `scripts/lock-tools.mjs`; the owner does that.
- **Do not commit.** Each task ends with a checkpoint naming its files and a message to use if the owner has asked.
- **Shell heredocs on this machine can strip backslashes.** Write any file that contains a backslash with the file tools, not a heredoc.
- **Baseline before starting:** `npm test` gives 771 tests, 769 passing, 0 failing, 2 skipped.

## Settled before this plan was written

Measured on 2026-11-15 with a throwaway prototype of the whole method, kept outside the repository (`phase3-measurements/measure.mjs` in the shared notes folder). It is reference for the method only: do not copy it in, write the module test-first. **The tests and the invented fixture in this plan have not been run.**

**Test drawing A, through the vendored pdf.js in Node 20 on the owner's laptop.**

| | Measured |
|---|---|
| Linework | 7,072 paths, 30,698 segments, 3,294 filled paths; read in 0.4 to 0.5 s |
| Tags located on the page | **71 of 71**. 22 are held in two text items (code on one line, number on the next). 5 are written in more than one place. |
| Proposals by line pairing | 131,850 for the sheet, 1,857 per tag on average. 3,240 pass the quick look and get the full score. |
| Time for the sheet | **6.5 to 8.4 s** over four runs, against a limit of 30 s |
| Tags with the valve code `V` | **45, not the 46 the design counts.** 45 of 45 OK. Lowest score 0.949. Sizes 99.4% to 100.3%. |
| Normally closed valves | 6 of the 45 are matched through filled loops. With filling switched off: 39 OK and **6 Wrong family**, the wrong answer the design warned of. |
| Flowmeters (4 tags) | Recognised at 0.98, 44 pt from the tag. **The legend table that holds them has no tag identifier, so a fresh library gives their function code no family and they come out Not checked.** With the tag identifier set on that table's symbols: 4 of 4 OK. |
| 4 tags of one other code | Their library family is recognised nowhere within 60 pt: Needs a look. See the private note. |
| 18 instrument tags | No library family: Not checked. |
| Relabel test | Ten OK tags given another family's code, six runs: 10/10, 10/10, 10/10, 10/10, 8/8 and 9/9 Wrong family. No verdict changed on any other tag. |

- **Placement by line pairing works through pdf.js geometry**, the thing the design called unproven. Every valve and flowmeter got a proposal that scored 0.949 or more.
- **Tag positions cannot be taken from `applySheetHighlight` as it stands.** Its pattern never allows for a tag split over two text items (see *What this plan leaves for later*), so it finds 49 of 71. The same idea done correctly finds 71 of 71.
- **A library is needed on this laptop and is built in memory.** `importLegend` from `scripts/check-symbol-import.mjs` reads the legend PDF in about 5 s: 390 symbols, 315 with linework between 3 and 120 pt. No file is written. The owner's real library, with his edits, is on his work computer.
- **A fresh library has no `flags.simple` set**, so shapes too plain to judge are also excluded by rule: fewer than 4 segments or under 25 pt of line. 7 symbols on the real legend.
- **Test drawing B** (printed, off size), with stand-in places on an 80 pt grid and no hint where the symbols are: 12 ball valves at 122% scoring 0.96 to 1.00 and both flowmeters at 88% scoring 0.91.
- **The tool today:** 4,099 lines, LF endings, names `register.json` 19 times. The ten anchors Task 8 uses each occur exactly once. The locked tool is written into the page by `document.write`, so it shares the site's origin and a worker at `/assets/js/…` is same-origin. That a module worker starts in the live locked tool is **not verified**.

## Open questions for the owner

1. **Do the Gate 3 numbers in the design stand as the bar for "usable"?** Unanswered since 2026-11-13. This plan uses them as written.
2. **Is the ten-sheet check from phase 2 done** (each ends "Tags read now match the register")? This plan does not depend on it, but phase 3 should not go live on top of an unchecked phase 2.

## Decisions made in this plan

For the owner to overrule at review.

1. **New files instead of growing `pid-symbols.js`.** The design put the raster and matcher there; it is already 779 lines. They go in `pid-symbol-check.js`.
2. **"Filled twin" is done per loop, not per symbol.** A closed loop of a symbol is filled in the template when its inside is solid ink on the drawing. One rule covers a filled valve body, and an actuated valve whose body is filled while its actuator circle is not. The result says "filled".
3. **One symbol answers one tag.** Recognised symbols are shared out across the whole sheet, nearest tag first, so a neighbouring valve cannot make a missing or wrong symbol read OK.
4. **Expected family comes only from the library's tag identifiers.** Where the legend gives a table none (the flowmeters), the owner sets it on those symbols in the Symbols tab. Nothing is hard-coded.
5. **A family is Not checked** when `library.families[code].mode` is `'skip'`, or when none of its symbols can be checked (all flagged drawn to suit or simple, or without linework). This phase adds no editor for `families`; the flags are set in the Symbols tab as today.
6. **Wrong family** needs a recognised symbol that carries a tag identifier, unclaimed, within 60 pt. A recognised symbol with no tag identifier (a fitting, an actuator) never makes a verdict.
7. **Approved exception** is given when nothing is recognised and an approved exception's name shares a word with a table heading of the expected family. The row names the exceptions and says the tool cannot tell whether this item is one of them. Pending exceptions do not count.
8. **"One of"** lists every symbol of the expected family scoring within 0.03 of the best at that spot. That covers mirror-image pairs without a special rule.
9. **Letters** are not part of the score. For a matched symbol that carries a letter, the row says "letter read" when the text layer has it inside the symbol's box and "letter not judged" otherwise.
10. **A tag written in several places** is checked at each; it gets one verdict.
11. **Only confirmed tags are checked**, on the page shown. A PDF of several pages is checked a page at a time.
12. **Gate 3's drawing B test uses stand-in places on a grid**, not positions typed by hand. It is stricter: the checker is not told where the symbols are.
13. **No second proposal rule for symbols made only of curves.** Every checkable symbol on the real legend has a straight line of 4 pt or more once curves are flattened. If Gate 3 shows a miss from this, report it.
14. **If the worker cannot start, the check does not run** and says so. No fallback on the main thread.

## File structure

| File | Responsibility |
|---|---|
| `tests/fixtures/symbol-check-sheet.js` (create) | Invented symbols, an invented sheet as arrays, and the same sheet as a PDF. |
| `assets/js/pid-symbol-check.js` (create) | Tag places, raster, proposals, score, families, verdicts. Pure. |
| `scripts/check-symbol-check.mjs` (create) | Local-only Gate 3 check. Not in `npm test`. |
| `assets/js/pid-symbol-check-view.js` (create) | Button reasons, progress, results list, box rectangles. Strings and numbers, all escaped. |
| `assets/js/pid-symbol-check-worker.js` (create) | Twelve lines: receive, call the module, post back. |
| `tests/pid-symbol-check.test.js`, `tests/check-symbol-check.test.js`, `tests/pid-symbol-check-view.test.js` (create) | Tests. |
| `tools-src/pid-tag-register.html` (modify, gitignored) | A button, a results line, a box layer, styles, one glue section, four one-line calls. |
| `.superpowers/sdd/2026-11-15-pid-symbol-check/` (gitignored workspace) | Backup of the tool, `tool-facts.mjs`, `patch.mjs`, `edits.mjs`, task reports. |

## Review Focus

Inputs the design implies but does not spell out. Each has a test in the task named.

1. **A tag split over two text items.** 22 of 71 on drawing A. Expected: located. Task 1.
2. **A tag written twice on a sheet**, once by its symbol and once in a note or table. Expected: both places looked at, one verdict. Tasks 1, 5.
3. **Two tags close together with one symbol between them.** Expected: the symbol answers the nearer tag only. Task 5.
4. **A library from the shared folder holding rubbish**: a symbol with non-numeric geometry, a name carrying markup. Expected: no throw, the symbol is skipped, names shown as text. Tasks 3, 5, 7.
5. **The user opens another sheet, or closes the library, while a check runs.** Expected: the run is ended, its result is not drawn on the wrong sheet. Task 9 Step 5.

---

### Task 1: Invented symbols, an invented sheet, and where each tag is

**Files:**
- Create: `tests/fixtures/symbol-check-sheet.js`, `assets/js/pid-symbol-check.js`
- Test: `tests/pid-symbol-check.test.js`

**Interfaces:**
- Consumes: nothing. (`textWords` in `pid-symbols.js` drops blank items and so loses the item order this needs; the box of an item is worked out here with the same arithmetic.)
- Produces: from the fixture, `LIBRARY`, `LOOKUPS`, `SHEET = { paths, textItems, tags, viewportTransform }`, `place(symbol, at)`, `label(tag, x, y, opts)`, `octagon(x, y)`, `sheetPdfBytes()`. From the module, `tagPlaces(textItems, tags, viewportTransform) -> [{ tag, fc, places: [{ box: [x0, y0, x1, y1], items: number }] }]`, in the order of `tags`, boxes in page points with a top-left origin.

- [ ] **Step 1: Write the fixture.** Given in full: it is data. If a value here contradicts a rule stated in a later task, fix the fixture, not the rule, and say so in the task report.

```js
// tests/fixtures/symbol-check-sheet.js
// An invented symbol library and an invented sheet for the symbol check.
// Nothing here comes from a real legend or drawing.
const line = segs => ({ segs, width: 0.7, stroked: true, filled: false, grey: 0 });
const loop = pts => line(pts.flatMap((p, i) => [...p, ...pts[(i + 1) % pts.length]]));
const sym = (id, name, group, tagId, w, h, paths, flags = {}) => ({ id, name, legendName: name, group, tagId, sheet: '1', w, h, paths,
  letters: [], flags: { simple: false, stretch: false, manual: false, unmatched: false, ...flags }, aliases: [], notes: [] });

const bowtie = () => [loop([[0, 0], [0, 12], [12, 6]]), loop([[24, 0], [24, 12], [12, 6]])];
export const LIBRARY = { version: 1, legend: [{ sheet: '1', rev: 'A', page: 1 }], importedAt: '2026-01-01T00:00:00.000Z', families: {},
  symbols: [
    sym('s1', 'WIDGET', 'WIDGETS', 'W', 24, 12, bowtie()),
    // Same box as WIDGET with two bars inside it, so each is clearly not the other (about 0.8 either way).
    sym('s2', 'WIDGET, BARRED', 'WIDGETS', 'W', 24, 12, [...bowtie(), line([12, 0, 12, 12]), line([4, 6, 20, 6])]),
    sym('s3', 'GADGET', 'GADGETS', 'G', 20, 20, [loop([[0, 0], [20, 0], [20, 20], [0, 20]]), line([0, 0, 20, 20])]),
    sym('s4', 'PENNANT, LEFT', 'PENNANTS', 'P', 10, 20, [line([0, 0, 0, 20]), loop([[0, 0], [10, 5], [0, 10]])]),
    sym('s5', 'PENNANT, RIGHT', 'PENNANTS', 'P', 10, 20, [line([10, 0, 10, 20]), loop([[10, 0], [0, 5], [10, 10]])]),
    sym('s6', 'DASH', 'DASHES', 'D', 12, 0, [line([0, 0, 12, 0])]),
    sym('s7', 'VAT', 'VATS', 'T', 40, 30, [loop([[0, 0], [40, 0], [40, 30], [0, 30]])], { stretch: true }),
    sym('s8', 'BROKEN', 'WIDGETS', 'W', 10, 10, [{ segs: [0, 0, 'x', NaN], width: 1, stroked: true, filled: false, grey: 0 }]),
    sym('s9', '<img src=x onerror=alert(1)>', 'GADGETS', 'G', 0, 0, [], { manual: true }),
  ],
  exceptions: [{ name: 'Folding widget', status: 'approved', note: '', ref: 'RFI 1' }, { name: 'Sliding gadget', status: 'pending', note: '', ref: '' }] };
export const LOOKUPS = { fc: { ZI: 'instrument' } };
const byName = n => LIBRARY.symbols.find(s => s.name === n);

// o: 0-3 turn the symbol by 0, 90, 180, 270 degrees; 4-7 the same after a mirror. k: size. fill: closed loops solid.
// (x, y) is the top-left of the placed symbol's box.
export function place(symbol, { x, y, o = 0, k = 1, fill = false }) {
  const [c, s] = [[1, 0], [0, 1], [-1, 0], [0, -1]][o % 4], m = o >= 4 ? -1 : 1;
  const tf = (px, py) => [k * (c * m * px - s * py), k * (s * m * px + c * py)];
  const corners = [tf(0, 0), tf(symbol.w, 0), tf(0, symbol.h), tf(symbol.w, symbol.h)];
  const ox = x - Math.min(...corners.map(p => p[0])), oy = y - Math.min(...corners.map(p => p[1]));
  return symbol.paths.map(p => {
    const segs = []; for (let i = 0; i < p.segs.length; i += 2) { const q = tf(p.segs[i], p.segs[i + 1]); segs.push(q[0] + ox, q[1] + oy); }
    const closed = segs.length >= 12 && segs[0] === segs[segs.length - 2] && segs[1] === segs[segs.length - 1];
    return { ...p, segs, filled: fill && closed };
  });
}
// A tag as pdf.js text items. split: the code on one line, the number on the next, a blank item between.
export function label(tag, x, y, { split = false } = {}) {
  const item = (str, ix, iy) => ({ str, transform: [8, 0, 0, 8, ix, iy], width: str.length * 4.4, height: 8 });
  if (!split) return [item(tag, x, y)];
  const cut = tag.lastIndexOf('-');
  return [item(tag.slice(0, cut), x, y), item('', x, y), item(tag.slice(cut + 1), x, y + 10)];
}
export const octagon = (x, y) => [loop([0, 1, 2, 3, 4, 5, 6, 7].map(i => [x + 8 + 8 * Math.cos(i * Math.PI / 4), y + 8 + 8 * Math.sin(i * Math.PI / 4)]))];
const pipe = (x, y, w) => [line([x - 30, y, x, y]), line([x + w, y, x + w + 30, y])];

// Each tag sits 20 pt above its item. Items are 100 pt apart, further than the 60 pt search.
const ROWS = [
  ['21-W-1001', 100, 80, {}, place(byName('WIDGET'), { x: 100, y: 100 }), pipe(100, 106, 24)],
  ['21-W-1002', 200, 76, { split: true }, place(byName('WIDGET'), { x: 200, y: 100, o: 1, fill: true }), []],
  ['21-W-1003', 300, 80, {}, place(byName('WIDGET'), { x: 300, y: 100, k: 1.2 }), pipe(300, 107.2, 28.8)],
  ['21-P-6001', 400, 80, {}, place(byName('PENNANT, LEFT'), { x: 400, y: 100 }), []],
  ['21-G-2001', 100, 180, {}, place(byName('WIDGET, BARRED'), { x: 100, y: 200 }), pipe(100, 206, 24)],
  ['21-W-1004', 200, 180, {}, octagon(200, 200), []],
  ['21-G-2002', 300, 180, {}, octagon(300, 200), []],
  ['21-X-7001', 400, 180, {}, [], []],
  ['21-D-3001', 100, 280, {}, place(byName('DASH'), { x: 100, y: 300 }), []],
  ['21-T-4001', 200, 280, {}, place(byName('VAT'), { x: 200, y: 300, k: 1.5 }), []],
  ['21-ZI-5001', 300, 280, {}, [], []],
];
export const SHEET = {
  viewportTransform: [1, 0, 0, 1, 0, 0],   // the arrays below are already top-left points
  paths: ROWS.flatMap(r => [...r[4], ...r[5]]),
  textItems: [{ str: 'INVENTED SHEET', transform: [8, 0, 0, 8, 20, 20], width: 70, height: 8 }, ...ROWS.flatMap(r => label(r[0], r[1], r[2], r[3]))],
  tags: ROWS.map(r => ({ tag: r[0], fc: r[0].split('-')[1] })),
};

// The same sheet as a one-page 500 x 400 pt PDF, for the Gate 3 script's tests and the browser.
export function sheetPdfBytes() {
  const H = 400, n = v => String(Math.round(v * 100) / 100);
  let c = '';
  for (const p of SHEET.paths) {
    c += `${n(p.width)} w\n`;
    for (let i = 0; i + 3 < p.segs.length; i += 4) c += `${n(p.segs[i])} ${n(H - p.segs[i + 1])} m ${n(p.segs[i + 2])} ${n(H - p.segs[i + 3])} l\n`;
    c += p.filled ? 'B\n' : 'S\n';
  }
  for (const t of SHEET.textItems) if (t.str) c += `BT /F1 8 Tf ${n(t.transform[4])} ${n(H - t.transform[5] - 8)} Td (${t.str}) Tj ET\n`;
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 400] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${c.length} >>\nstream\n${c}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n'; const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, ch => ch.charCodeAt(0));
}
```

- [ ] **Step 2: Write the failing tests** in `tests/pid-symbol-check.test.js`.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../assets/js/pid-symbol-check.js';
import { LIBRARY, LOOKUPS, SHEET, place, label, octagon } from './fixtures/symbol-check-sheet.js';

const VT = SHEET.viewportTransform;
const near = (a, b, tol) => Math.abs(a - b) <= tol;

test('tagPlaces: a tag in one text item, as a box in page points', () => {
  const [r] = C.tagPlaces(SHEET.textItems, [{ tag: '21-W-1001', fc: 'W' }], VT);
  assert.equal(r.tag, '21-W-1001'); assert.equal(r.places.length, 1); assert.equal(r.places[0].items, 1);
  const b = r.places[0].box;
  assert.ok(near(b[0], 100, 0.5) && near(b[1], 80, 0.5) && near(b[2], 100 + 9 * 4.4, 0.5) && near(b[3], 88, 0.5), JSON.stringify(b));
});
test('tagPlaces: a tag split over two text items with a blank one between', () => {
  const [r] = C.tagPlaces(SHEET.textItems, [{ tag: '21-W-1002', fc: 'W' }], VT);
  assert.equal(r.places.length, 1); assert.equal(r.places[0].items, 2);
  assert.ok(near(r.places[0].box[1], 76, 0.5) && near(r.places[0].box[3], 94, 0.5));
});
test('tagPlaces: every tag on the invented sheet is found once, in the order given', () => {
  const r = C.tagPlaces(SHEET.textItems, SHEET.tags, VT);
  assert.deepEqual(r.map(x => x.tag), SHEET.tags.map(t => t.tag));
  assert.deepEqual(r.map(x => x.places.length), SHEET.tags.map(() => 1));
});
test('tagPlaces: written twice gives two places; absent gives none; a longer tag is not a match', () => {
  const items = [...label('21-W-1001', 10, 10), ...label('21-W-1001', 300, 300), ...label('21-W-10019', 50, 50), ...label('21–W–2000', 90, 90)];
  const r = C.tagPlaces(items, [{ tag: '21-W-1001', fc: 'W' }, { tag: '21-W-9999', fc: 'W' }, { tag: '21-W-2000', fc: 'W' }], VT);
  assert.deepEqual(r.map(x => x.places.length), [2, 0, 1]);   // the last was written with en dashes
});
test('tagPlaces: rubbish in gives empty out, never a throw', () => {
  for (const bad of [null, 5, 'x', {}, [null, 5, { str: 7 }, { str: '21-W-1001' }]]) {
    assert.deepEqual(C.tagPlaces(bad, [{ tag: '21-W-1001', fc: 'W' }], VT).map(x => x.places), [[]]);
  }
  assert.deepEqual(C.tagPlaces(SHEET.textItems, null, VT), []);
  assert.deepEqual(C.tagPlaces(SHEET.textItems, [null, {}, { tag: 5 }], null), []);
});
```

- [ ] **Step 3: Run to see them fail.** Run: `node --test tests/pid-symbol-check.test.js`. Expected: FAIL, module not found.

- [ ] **Step 4: Implement `tagPlaces`** in `assets/js/pid-symbol-check.js`. Head the file with the same warning the other modules carry: pure, no DOM, no pdf.js import, and no legend or drawing data ever. The method, which the tests do not fully determine:
  1. Join the items as the sheet viewer does: each item's `str` with en and em dashes turned to hyphens and upper-cased, one space after each, remembering each item's span in the joined string.
  2. For each tag build a pattern from its parts split on `-`, each part regex-escaped, joined by `[\s\-]{0,3}`, guarded by `(?<![A-Z0-9])` before and `(?![A-Z0-9])` after.
  3. Each match gives one place: the union of the boxes of the non-blank items its span overlaps. An item's box is worked out through `viewportTransform` and the item's own transform, as `textWords` in `pid-symbols.js` does it.
  4. A tag entry that is not `{ tag: string, fc: string }` is left out of the result. A text item with no usable `transform`, `width` or `height` has no box and cannot make a place.

- [ ] **Step 5: Run to see them pass.** Expected: 5 pass.

- [ ] **Step 6: Checkpoint.** `npm test`: 776 tests, 774 passing, 0 failing, 2 skipped. Files: the fixture, the module, the test file. Message: `feat(pid): where each tag sits on a sheet`.

---

### Task 2: The rasteriser

**Files:** Modify `assets/js/pid-symbol-check.js`. Test: `tests/pid-symbol-check.test.js` (append).

**Interfaces:**
- Produces: `CHECK_DEFAULTS` (frozen object, values below); `rasterise(paths, frame, options) -> Bitmap`; `dilate(bitmap, r) -> Bitmap`. `frame = { x0, y0, w, h }` in points. `Bitmap = { x0, y0, w, h, pxPerPt, data: Uint8Array }` with `w`, `h` in pixels and `data[y * w + x]` 0 or 1. `options = { pxPerPt = 4, transform = null, scale = 1, fillLoops = null }`: `transform(x, y) -> [x, y]` is applied to every point, `scale` multiplies stroke widths, `fillLoops` is a `Set` of path objects to fill although they are not `filled`.

```js
export const CHECK_DEFAULTS = Object.freeze({
  pxPerPt: 4, inkTol: 0.5,            // ink within 0.5 pt counts as a hit
  radius: 60,                         // points from a tag's centre to a symbol's centre
  recognise: 0.90, oneOf: 0.03, sameSpot: 3,
  minScale: 0.75, maxScale: 1.35, sizeBand: 0.05,
  keyLines: 2, minKeyLine: 4, angleTol: 0.035, quickLook: 0.85, fillInside: 0.85,
  inkGrey: 175, whiteGrey: 250,       // darker than 175 is ink; a fill of 250 or lighter hides what is under it
  simpleSegs: 4, simpleLength: 25, minSize: 3, maxSize: 120,
});
```

- [ ] **Step 1: Write the failing tests** (append).

```js
const px = (b, x, y) => b.data[y * b.w + x];
const ink = b => b.data.reduce((n, v) => n + v, 0);
const FRAME = { x0: 0, y0: 0, w: 8, h: 8 };
const P = (segs, extra = {}) => ({ segs, width: 0.25, stroked: true, filled: false, grey: 0, ...extra });
const SQUARE = [2, 2, 6, 2, 6, 2, 6, 6, 6, 6, 2, 6, 2, 6, 2, 2];

test('rasterise: a hairline is one pixel thick; a 1 pt line is several', () => {
  const thin = C.rasterise([P([2, 2, 6, 2])], FRAME);
  assert.deepEqual([thin.w, thin.h, thin.pxPerPt], [32, 32, 4]);
  assert.deepEqual([px(thin, 16, 8), px(thin, 16, 6), px(thin, 16, 10), px(thin, 4, 8)], [1, 0, 0, 0]);
  const thick = C.rasterise([P([2, 2, 6, 2], { width: 1 })], FRAME);
  assert.deepEqual([px(thick, 16, 7), px(thick, 16, 9), px(thick, 16, 12)], [1, 1, 0]);
  assert.ok(ink(thick) > 2 * ink(thin));
});
test('rasterise: a fill is solid, and even-odd leaves a hole', () => {
  assert.equal(px(C.rasterise([P(SQUARE, { filled: true })], FRAME), 16, 16), 1);
  assert.equal(px(C.rasterise([P(SQUARE)], FRAME), 16, 16), 0);
  const holed = C.rasterise([P([...SQUARE, 3, 3, 5, 3, 5, 3, 5, 5, 5, 5, 3, 5, 3, 5, 3, 3], { filled: true })], FRAME);
  assert.deepEqual([px(holed, 16, 16), px(holed, 10, 16)], [0, 1]);
});
test('rasterise: a white fill hides what is under it; pale grey is not ink', () => {
  const hidden = C.rasterise([P([0, 4, 8, 4]), P(SQUARE, { filled: true, stroked: false, grey: 255 })], FRAME);
  assert.deepEqual([px(hidden, 16, 16), px(hidden, 2, 16)], [0, 1]);
  assert.equal(ink(C.rasterise([P([0, 4, 8, 4], { grey: 200 })], FRAME)), 0);
});
test('rasterise: transform, scale and fillLoops are applied', () => {
  const sq = P(SQUARE);
  assert.equal(px(C.rasterise([sq], FRAME, { fillLoops: new Set([sq]) }), 16, 16), 1);
  const moved = C.rasterise([P([0, 0, 2, 0])], FRAME, { transform: (x, y) => [x + 2, y + 4] });
  assert.deepEqual([px(moved, 12, 16), px(moved, 4, 0)], [1, 0]);
});
test('dilate: one pixel becomes a square of side 2r + 1', () => {
  const b = C.rasterise([], FRAME); b.data[16 * 32 + 16] = 1;
  const d = C.dilate(b, 2);
  assert.equal(ink(d), 25); assert.equal(ink(b), 1);
  assert.deepEqual([px(d, 14, 14), px(d, 18, 18), px(d, 13, 16)], [1, 1, 0]);
});
test('rasterise and dilate: rubbish in gives an empty bitmap, never a throw', () => {
  for (const bad of [null, 5, [null, {}, { segs: 'x' }, { segs: [0, 0, NaN, 1], stroked: true, grey: 0 }]]) assert.equal(ink(C.rasterise(bad, FRAME)), 0);
  for (const frame of [null, {}, { x0: 0, y0: 0, w: -1, h: 5 }, { x0: 0, y0: 0, w: 1e9, h: 1e9 }]) assert.equal(C.rasterise([P(SQUARE)], frame).data.length, 0);
  assert.equal(C.dilate(null, 2).data.length, 0);
});
```

- [ ] **Step 2: Run to see them fail.** Expected: 6 new failures (`C.rasterise is not a function`).

- [ ] **Step 3: Implement.** Paths are drawn in order. A path darker than `inkGrey` is ink. A `filled` path at `whiteGrey` or lighter clears the pixels it covers; anything between is ignored. Fill is even-odd by scanline through pixel centres. A stroke is stamped along each segment at half-pixel steps with a square of half-side `max(0, round(widthPx / 2 - 0.5))`, where `widthPx = max(1, width * scale * pxPerPt)`. A frame larger than 4,096 px on a side gives an empty bitmap.

- [ ] **Step 4: Run to see them pass.** Expected: 11 pass in the file.

- [ ] **Step 5: Checkpoint.** `npm test`: 782 tests, 780 passing. Message: `feat(pid): rasteriser for the symbol check`.

---

### Task 3: Placement proposals by pairing lines

**Files:** Modify `assets/js/pid-symbol-check.js`. Test: append.

**Interfaces:**
- Produces:
  - `ORIENTATIONS`: eight `[a, b, c, d]` so that `x' = a·x + c·y`, `y' = b·x + d·y`. Index 0 to 3 turn by 0°, 90°, 180°, 270°; 4 to 7 the same after mirroring x. The fixture's `place` uses the same numbering.
  - `prepareSymbols(library, options) -> Prepared[]`, one per library symbol: `{ symbol, checkable: boolean, why: '' | 'manual' | 'no-linework' | 'stretch' | 'simple' | 'size', segs: [[x0, y0, x1, y1, length]], keys: [same shape], loops: Path[], points: number[] }`.
  - `drawingSegments(paths, options) -> [[x0, y0, x1, y1, length]]`: ink segments at least `0.75 × minKeyLine` long.
  - `proposePlacements(prepared, segments, centre, options) -> [{ o, k, tx, ty, cx, cy }]`. A placement maps a symbol point `p` to `k · ORIENTATIONS[o] · p + (tx, ty)`; `(cx, cy)` is where the middle of the symbol's box lands.
  - `placePoint(placement, x, y) -> [x, y]`.

- [ ] **Step 1: Write the failing tests** (append).

```js
const byName = n => LIBRARY.symbols.find(s => s.name === n);
const prep = n => C.prepareSymbols(LIBRARY).find(p => p.symbol.name === n);
const boxOf = (pl, s) => { const a = C.placePoint(pl, 0, 0), b = C.placePoint(pl, s.w, s.h); return [Math.min(a[0], b[0]), Math.min(a[1], b[1])]; };

test('prepareSymbols: which symbols can be checked, and why not', () => {
  const all = C.prepareSymbols(LIBRARY);
  assert.equal(all.length, LIBRARY.symbols.length);
  assert.deepEqual(all.map(p => p.why), ['', '', '', '', '', 'simple', 'stretch', 'no-linework', 'manual']);
  const w = prep('WIDGET');
  assert.equal(w.checkable, true); assert.equal(w.keys.length, 2); assert.equal(w.loops.length, 2);
  assert.ok(near(w.keys[0][4], Math.hypot(12, 6), 0.01));
  assert.equal(byName('WIDGET').flags.simple, false);   // the library is not written to
  assert.deepEqual(C.prepareSymbols({ ...LIBRARY, symbols: [{ ...byName('WIDGET'), flags: { simple: true } }] })[0].why, 'simple');
});
test('proposePlacements: the true place is among the proposals, at full size', () => {
  const segs = C.drawingSegments(place(byName('WIDGET'), { x: 100, y: 100 }));
  const ps = C.proposePlacements(prep('WIDGET'), segs, [110, 90]);
  assert.ok(ps.length > 0 && ps.length < 200, String(ps.length));
  assert.ok(ps.some(p => near(p.k, 1, 0.01) && near(boxOf(p, byName('WIDGET'))[0], 100, 0.3) && near(boxOf(p, byName('WIDGET'))[1], 100, 0.3)));
});
test('proposePlacements: turned and drawn at 120%', () => {
  const segs = C.drawingSegments(place(byName('WIDGET, BARRED'), { x: 200, y: 200, o: 5, k: 1.2 }));
  const ps = C.proposePlacements(prep('WIDGET, BARRED'), segs, [210, 210]);
  assert.ok(ps.some(p => near(p.k, 1.2, 0.01) && near(p.cx, 200 + 1.2 * 12 / 2, 0.5) && near(p.cy, 200 + 1.2 * 24 / 2, 0.5)));   // turned: 12 wide, 24 tall
});
test('proposePlacements: nothing outside 75% to 135%, nothing beyond the radius', () => {
  const w = byName('WIDGET');
  assert.deepEqual(C.proposePlacements(prep('WIDGET'), C.drawingSegments(place(w, { x: 100, y: 100, k: 1.6 })), [110, 100]), []);
  assert.deepEqual(C.proposePlacements(prep('WIDGET'), C.drawingSegments(place(w, { x: 100, y: 100, k: 0.6 })), [110, 100]), []);
  assert.deepEqual(C.proposePlacements(prep('WIDGET'), C.drawingSegments(place(w, { x: 100, y: 100 })), [300, 300]), []);
  assert.ok(C.proposePlacements(prep('WIDGET'), C.drawingSegments(place(w, { x: 100, y: 100 })), [300, 300], { radius: 400 }).length > 0);
});
test('proposals: rubbish in gives nothing, never a throw', () => {
  assert.deepEqual(C.prepareSymbols(null), []);
  assert.deepEqual(C.drawingSegments([null, { segs: 'x' }, { segs: [0, 0, NaN, 9], grey: 0 }]), []);
  assert.deepEqual(C.proposePlacements(null, null, null), []);
  assert.deepEqual(C.proposePlacements(prep('BROKEN'), [[0, 0, 10, 0, 10]], [0, 0]), []);
});
```

- [ ] **Step 2: Run to see them fail.** Expected: 5 new failures.

- [ ] **Step 3: Implement.**
  - `prepareSymbols`: `why` is the first that applies, in this order: `manual` (`flags.manual`); `no-linework` (no segment made of four finite numbers); `stretch` (`flags.stretch`); `simple` (`flags.simple`, or fewer than `simpleSegs` segments, or under `simpleLength` points of line in total); `size` (`max(w, h) > maxSize`, or `min(w, h) < minSize`). `keys` are the `keyLines` longest segments that are at least `minKeyLine` long; a symbol with none is `simple`. `loops` are the unfilled paths of three or more segments whose last point is their first. `points` are points along the segments about 1 pt apart, flat `[x, y, …]`.
  - `proposePlacements`: for each key line `s`, each drawing segment `d` whose midpoint is within `radius + 40` of the centre, and each orientation `o`: skip unless `k = length(d) / length(s)` is within `minScale` to `maxScale`, and unless `o(s)` is parallel to `d` (`|cross| ≤ angleTol × length(s) × length(d)`). The placement puts the midpoint of `s` on the midpoint of `d`. Keep it when the symbol's box centre lands within `radius` of the centre. Drop repeats: same `o`, `tx` and `ty` to a quarter point, `k` to 0.02. Nothing is proposed for a symbol that is not `checkable`.

- [ ] **Step 4: Run to see them pass.** Expected: 16 pass in the file.

- [ ] **Step 5: Checkpoint.** `npm test`: 787 tests, 785 passing. Message: `feat(pid): placement proposals by pairing lines`.

---

### Task 4: The two-way ink score, and filled loops

**Files:** Modify `assets/js/pid-symbol-check.js`. Test: append.

**Interfaces:**
- Produces: `drawingWindow(paths, centre, options) -> Window` (`{ ink: Bitmap, near: Bitmap }`: the drawing around a centre, `radius + 70` points each way, and the same dilated by `inkTol`); `scorePlacement(prepared, placement, window, options) -> { score, forward, backward, filled, box: [x0, y0, x1, y1] } | null`. `options.twin === false` switches loop filling off (the gate uses it to show what the twin is worth).

- [ ] **Step 1: Write the failing tests** (append).

```js
const scoreAt = (name, drawn, at, opts) => {
  const p = prep(name), win = C.drawingWindow(drawn, at, opts);
  return C.proposePlacements(p, C.drawingSegments(drawn), at, opts).map(pl => C.scorePlacement(p, pl, win, opts)).filter(Boolean).sort((a, b) => b.score - a.score)[0] || null;
};

test('scorePlacement: the right symbol in the right place scores 0.95 or more', () => {
  const best = scoreAt('WIDGET', place(byName('WIDGET'), { x: 100, y: 100 }), [110, 100]);
  assert.ok(best.score >= 0.95, String(best.score));
  assert.equal(best.filled, false);
  assert.ok(near(best.box[0], 100, 0.5) && near(best.box[1], 100, 0.5) && near(best.box[2], 124, 0.5) && near(best.box[3], 112, 0.5));
});
test('scorePlacement: 3 pt out of place scores under 0.6', () => {
  const drawn = place(byName('WIDGET'), { x: 100, y: 100 }), p = prep('WIDGET');
  const pl = C.proposePlacements(p, C.drawingSegments(drawn), [110, 100]).find(q => near(q.k, 1, 0.01) && near(boxOf(q, p.symbol)[0], 100, 0.3) && near(boxOf(q, p.symbol)[1], 100, 0.3));
  const s = C.scorePlacement(p, { ...pl, tx: pl.tx + 3, ty: pl.ty + 3 }, C.drawingWindow(drawn, [110, 100]));
  assert.ok(s === null || s.score < 0.6);
});
test('scorePlacement: ink the symbol does not explain lowers the score, and so does ink it lacks', () => {
  const barred = place(byName('WIDGET, BARRED'), { x: 100, y: 100 });
  const plainOnBarred = scoreAt('WIDGET', barred, [110, 110]);
  assert.ok(plainOnBarred.forward >= 0.95 && plainOnBarred.score < 0.9, JSON.stringify(plainOnBarred));
  const barredOnPlain = scoreAt('WIDGET, BARRED', place(byName('WIDGET'), { x: 100, y: 100 }), [110, 100]);
  assert.ok(barredOnPlain === null || barredOnPlain.score < 0.9);
});
test('scorePlacement: a filled-in symbol matches through its filled loops, and not without them', () => {
  const drawn = place(byName('WIDGET'), { x: 100, y: 100, fill: true });
  const withTwin = scoreAt('WIDGET', drawn, [110, 100]);
  assert.ok(withTwin.score >= 0.9 && withTwin.filled === true, JSON.stringify(withTwin));
  const without = scoreAt('WIDGET', drawn, [110, 100], { twin: false });
  assert.ok(without.score < 0.9 && without.filled === false, JSON.stringify(without));
});
test('scorePlacement: rubbish in gives null, never a throw', () => {
  assert.equal(C.scorePlacement(null, null, null), null);
  assert.equal(C.scorePlacement(prep('WIDGET'), { o: 99, k: NaN, tx: 0, ty: 0 }, C.drawingWindow([], [0, 0])), null);
  assert.equal(C.drawingWindow(null, null).ink.data.length, 0);
});
```

- [ ] **Step 2: Run to see them fail.** Expected: 5 new failures.

- [ ] **Step 3: Implement `drawingWindow` and `scorePlacement`.** The method:
  1. **Quick look.** Map about 30 of the symbol's `points` through the placement. Fewer than `quickLook` of them on `window.near` returns `null`.
  2. **Frame.** The placed symbol's box plus 1 pt each side, snapped to the window's pixels. A frame not wholly inside the window returns `null`.
  3. **Filled loops** (skipped when `options.twin === false`). Rasterise the symbol unfilled. For each of its `loops`: take the pixels inside the placed loop that the unfilled symbol does not itself cover. If there are more than 20 and at least `fillInside` of them are ink on the drawing, that loop is filled.
  4. **Template.** `rasterise` the symbol's paths with the placement as `transform`, `scale: k`, and the chosen loops as `fillLoops`. Dilate a copy by `inkTol`.
  5. **Score.** `forward` = template pixels that fall on `window.near` ÷ template pixels. `backward` = drawing ink pixels in the frame that fall on the dilated template ÷ drawing ink pixels in the frame. `score = min(forward, backward)`. `filled` is true when any loop was filled. `box` is the placed symbol's box in points.

- [ ] **Step 4: Run to see them pass.** Expected: 21 pass in the file.

- [ ] **Step 5: Checkpoint.** `npm test`: 792 tests, 790 passing. Message: `feat(pid): two-way ink score with filled loops`.

---

### Task 5: Families and the sheet's verdicts

**Files:** Modify `assets/js/pid-symbol-check.js`. Test: append.

**Interfaces:**
- Consumes: everything from Tasks 1 to 4; `textWords` from `pid-symbols.js` (for letters).
- Produces:
  - `VERDICTS = ['ok', 'off-size', 'wrong-family', 'exception', 'look', 'not-checked']`.
  - `expectedFamily(fc, library, lookups, prepared) -> { mode: 'check' | 'skip', why: string, symbols: Prepared[] }`.
  - `checkSheet({ paths, textItems, viewportTransform, tags, library, lookups, options, onProgress }) -> { ok: true, verdicts: Verdict[], counts, checked, recognised, proposals, ms } | { ok: false, why: 'no-library' | 'no-tags' | 'failed' }`.
  - `Verdict = { tag, fc, verdict, why, symbol, oneOf: string[], tagId, exceptions: string[], sizePct: number | null, score: number | null, filled: boolean, letters: '' | 'read' | 'not judged', tagBox: number[] | null, box: number[] | null }`. Plain data only, so it can be posted from a worker. `verdicts` is in the order of `tags`. `counts` has one number per entry of `VERDICTS`. `checked` is the number of tags whose family is checked; `recognised` is `ok` plus `off-size`.
  - `onProgress(done, total)` is called once per tag.

- [ ] **Step 1: Write the failing tests** (append).

```js
const run = (over = {}) => C.checkSheet({ ...SHEET, library: LIBRARY, lookups: LOOKUPS, ...over });
const verdictOf = (r, tag) => r.verdicts.find(v => v.tag === tag);

test('expectedFamily: checked, or why not', () => {
  const prepared = C.prepareSymbols(LIBRARY);
  const f = fc => C.expectedFamily(fc, LIBRARY, LOOKUPS, prepared);
  assert.deepEqual([f('W').mode, f('W').symbols.map(p => p.symbol.name)], ['check', ['WIDGET', 'WIDGET, BARRED']]);
  assert.deepEqual([f('ZI').mode, f('ZI').why], ['skip', 'Instrument bubbles are not checked yet.']);
  assert.deepEqual([f('X').mode, f('X').why], ['skip', 'No symbol in the library carries the tag identifier X.']);
  assert.deepEqual([f('D').mode, f('D').why], ['skip', 'Every symbol in this family is drawn to suit, too simple to judge, or has no linework.']);
  assert.equal(f('T').mode, 'skip');
  const skipG = C.expectedFamily('G', { ...LIBRARY, families: { G: { mode: 'skip', why: 'drawn to suit' } } }, LOOKUPS, prepared);
  assert.deepEqual([skipG.mode, skipG.why], ['skip', 'Family marked as not checked: drawn to suit.']);
  assert.equal(C.expectedFamily('constructor', LIBRARY, LOOKUPS, prepared).mode, 'skip');
  assert.equal(C.expectedFamily(null, null, null, null).mode, 'skip');
});
test('checkSheet: every verdict, on the invented sheet', () => {
  const r = run();
  assert.equal(r.ok, true);
  assert.deepEqual(r.verdicts.map(v => [v.tag, v.verdict]), [
    ['21-W-1001', 'ok'], ['21-W-1002', 'ok'], ['21-W-1003', 'off-size'], ['21-P-6001', 'ok'],
    ['21-G-2001', 'wrong-family'], ['21-W-1004', 'exception'], ['21-G-2002', 'look'], ['21-X-7001', 'not-checked'],
    ['21-D-3001', 'not-checked'], ['21-T-4001', 'not-checked'], ['21-ZI-5001', 'not-checked']]);
  assert.deepEqual(r.counts, { ok: 3, 'off-size': 1, 'wrong-family': 1, exception: 1, look: 1, 'not-checked': 4 });
  assert.deepEqual([r.checked, r.recognised], [7, 4]);
  assert.equal(verdictOf(r, '21-W-1001').symbol, 'WIDGET');
  assert.equal(verdictOf(r, '21-W-1002').filled, true);
  assert.ok(near(verdictOf(r, '21-W-1003').sizePct, 120, 2));
  const wrong = verdictOf(r, '21-G-2001');
  assert.deepEqual([wrong.symbol, wrong.tagId], ['WIDGET, BARRED', 'W']);
  assert.deepEqual(verdictOf(r, '21-W-1004').exceptions, ['Folding widget']);
  assert.deepEqual(verdictOf(r, '21-G-2002').exceptions, []);     // a pending exception does not count
  assert.ok(near(verdictOf(r, '21-W-1001').box[0], 100, 0.5) && verdictOf(r, '21-X-7001').box === null);
  assert.doesNotThrow(() => structuredClone(r));
});
test('checkSheet: symbols that differ only by mirroring are reported as one of', () => {
  assert.deepEqual(verdictOf(run(), '21-P-6001').oneOf.slice().sort(), ['PENNANT, LEFT', 'PENNANT, RIGHT']);
  assert.deepEqual(verdictOf(run(), '21-W-1001').oneOf, []);
});
test('checkSheet: relabelled, a right symbol becomes the wrong family', () => {
  const tags = SHEET.tags.map(t => (t.tag === '21-W-1001' ? { tag: t.tag, fc: 'G' } : t));
  const r = run({ tags });
  assert.deepEqual([verdictOf(r, '21-W-1001').verdict, verdictOf(r, '21-W-1001').tagId], ['wrong-family', 'W']);
  assert.equal(verdictOf(r, '21-W-1003').verdict, 'off-size');   // nothing else moved
});
test('checkSheet: one symbol answers one tag, the nearer', () => {
  const sheet = { viewportTransform: VT, paths: place(byName('WIDGET'), { x: 100, y: 100 }),
    textItems: [...label('21-W-0001', 100, 86), ...label('21-W-0002', 100, 130)], tags: [{ tag: '21-W-0002', fc: 'W' }, { tag: '21-W-0001', fc: 'W' }] };
  const r = C.checkSheet({ ...sheet, library: LIBRARY, lookups: LOOKUPS });
  assert.deepEqual(r.verdicts.map(v => v.verdict), ['exception', 'ok']);
});
test('checkSheet: a tag written twice is checked at both places and gets one verdict', () => {
  const sheet = { viewportTransform: VT, paths: place(byName('WIDGET'), { x: 300, y: 300 }),
    textItems: [...label('21-W-0001', 20, 20), ...label('21-W-0001', 300, 286)], tags: [{ tag: '21-W-0001', fc: 'W' }] };
  const r = C.checkSheet({ ...sheet, library: LIBRARY, lookups: LOOKUPS });
  assert.deepEqual([r.verdicts.length, r.verdicts[0].verdict], [1, 'ok']);
  assert.ok(near(r.verdicts[0].tagBox[0], 300, 0.5));   // the place the symbol was found beside
});
test('checkSheet: a tag that is not on the page is Not checked, and says so', () => {
  const r = run({ tags: [{ tag: '21-W-9999', fc: 'W' }] });
  assert.deepEqual([r.verdicts[0].verdict, r.verdicts[0].why, r.verdicts[0].tagBox], ['not-checked', 'Tag position not found on this page.', null]);
});
test('checkSheet: progress is reported once per tag', () => {
  const seen = [];
  run({ onProgress: (done, total) => seen.push([done, total]) });
  assert.equal(seen.length, SHEET.tags.length);
  assert.deepEqual(seen[seen.length - 1], [SHEET.tags.length, SHEET.tags.length]);
  assert.equal(run({ onProgress: () => { throw new Error('boom'); } }).ok, true);
});
test('checkSheet: no library, no tags, or rubbish gives ok false, never a throw', () => {
  assert.deepEqual(run({ library: null }), { ok: false, why: 'no-library' });
  assert.deepEqual(run({ library: { version: 1, symbols: [] } }), { ok: false, why: 'no-library' });
  assert.deepEqual(run({ tags: [] }), { ok: false, why: 'no-tags' });
  assert.equal(C.checkSheet(null).ok, false);
  assert.equal(run({ paths: 'x', textItems: 7 }).ok, true);   // every tag then reads Not checked
});
test('checkSheet: a letter inside the symbol is read from the text layer or not judged', () => {
  const lettered = { ...LIBRARY, symbols: LIBRARY.symbols.map(s => (s.name === 'GADGET' ? { ...s, letters: [{ text: 'Q', x: 8, y: 6, size: 6 }] } : s)) };
  const base = { viewportTransform: VT, paths: place(byName('GADGET'), { x: 100, y: 100 }), tags: [{ tag: '21-G-0001', fc: 'G' }], library: lettered, lookups: LOOKUPS };
  const tagItems = label('21-G-0001', 100, 80);
  assert.equal(C.checkSheet({ ...base, textItems: tagItems }).verdicts[0].letters, 'not judged');
  const q = { str: 'Q', transform: [6, 0, 0, 6, 108, 106], width: 4, height: 6 };
  assert.equal(C.checkSheet({ ...base, textItems: [...tagItems, q] }).verdicts[0].letters, 'read');
  assert.equal(verdictOf(run(), '21-W-1001').letters, '');
});
```

- [ ] **Step 2: Run to see them fail.** Expected: 10 new failures.

- [ ] **Step 3: Implement `expectedFamily`.** A symbol carries a code when the code is one of its `tagId`'s parts, split on spaces, commas, slashes and semicolons, upper-cased. In order:
  1. No symbol carries `fc`: `skip`. The reason is the instrument sentence when `lookups.fc` has `fc` as an own property equal to `'instrument'`, otherwise the "No symbol in the library…" sentence.
  2. `library.families` has `fc` as an own property with `mode === 'skip'`: `skip`, `'Family marked as not checked: ' + (why || 'no reason given') + '.'`.
  3. None of the symbols carrying it is `checkable`: `skip`, the "Every symbol in this family…" sentence.
  4. Otherwise `check`, with the checkable ones.

- [ ] **Step 4: Implement `checkSheet`.** The method, as prototyped:
  1. `prepareSymbols` once; `tagPlaces`; `drawingSegments` once. A library with no symbols gives `no-library`; no usable tag entries gives `no-tags`.
  2. For every place of every tag whose family is `check`: build the window, propose for **every checkable symbol in the library** (not only the expected family), score, and keep what scores `recognise` or more.
  3. **Spots.** Kept placements whose box centres are within `sameSpot` points are the same physical symbol, whichever tag's window found them. A spot holds the best score per symbol.
  4. A spot **fits** a code when a symbol carrying that code scores within `oneOf` of the spot's best. Those symbols, best first, are the match and its `oneOf` list (empty when there is only one).
  5. **Pass 1.** Take every (tag place, spot) pair in order of distance from the place's centre to the spot. A pair is taken when the tag has no verdict yet, the spot is unclaimed and fits the tag's code. Verdict `ok`, or `off-size` when the size is outside `1 ± sizeBand`. `sizePct` is the size as a rounded percentage. The spot is claimed.
  6. **Pass 2.** For each tag still without a verdict, the nearest unclaimed spot within `radius` whose best-scoring symbols (within `oneOf` of its best) include one with a tag identifier: `wrong-family`, naming the best such symbol and its tag identifier. The spot is not claimed.
  7. **Otherwise:** `exception` when an exception with `status === 'approved'` shares a word with a `group` of any symbol carrying the tag's code (words lower-cased, a trailing `s` ignored); `exceptions` lists their names. Else `look`.
  8. A tag whose family is `skip`, or which has no place on the page: `not-checked` with the reason in `why`.
  9. `letters`: for an `ok` or `off-size` match whose symbol has `letters`, `'read'` when every letter appears as a text word whose centre is inside `box`, else `'not judged'`.
  10. Everything inside one `try`; a failure gives `{ ok: false, why: 'failed' }`. A throwing `onProgress` is ignored.

- [ ] **Step 5: Run to see them pass.** Expected: 31 pass in the file. If a fixture expectation fails for a reason that is the fixture's (a neighbour inside the radius, say), fix the fixture and record it.

- [ ] **Step 6: Checkpoint.** `npm test`: 802 tests, 800 passing. Message: `feat(pid): symbol check verdicts for a sheet`.

---

### Task 6: Gate 3 script, and the go/no-go

Done before any interface work.

**Files:** Create `scripts/check-symbol-check.mjs`. Test: `tests/check-symbol-check.test.js`.

**Interfaces:**
- Consumes: `openPdf`, `loadVendoredPdfjs`; `importLegend` from `scripts/check-symbol-import.mjs`; `pagePaths`, `parseLibrary`, `updateSymbol` from `pid-symbols.js`; `extractTags`; `checkSheet`, `VERDICTS`.
- Produces (exported for tests): `readSheet(data) -> Promise<{ ok, paths, textItems, viewportTransform, tags } | { ok: false }>` (page 1; `tags` are the confirmed tags as `{ tag, fc }`); `setTagIds(library, pairs) -> { library, changed: number }` (`pairs` are `'<table heading>=<code>'` strings; every symbol whose `group` equals the heading gets the code); `relabel(tags, verdicts, count, toCode) -> { tags, changed: string[] }` (the `count` OK tags not already of `toCode`, spread evenly through the list, given `toCode`); `tally(verdicts) -> { [fc]: { [verdict]: number } }`.

- [ ] **Step 1: Write the failing tests.** Three tests, in the shape of `tests/check-sheet-prechecks.test.js`:
  1. `setTagIds`, `relabel` and `tally` on plain data: `setTagIds(LIBRARY, ['WIDGETS=Q'])` changes 3 symbols and leaves `LIBRARY` untouched; a pair with no `=` or an unknown heading changes 0; `relabel` of 2 among four OK tags returns exactly 2 changed tags, none of them already of the target code; `tally` counts by code then verdict.
  2. `readSheet(sheetPdfBytes())` gives `ok: true`, 11 tags in the fixture's order, and more than 40 paths; bytes that are not a PDF give `{ ok: false }`.
  3. The command line, with the invented PDF and `JSON.stringify(LIBRARY)` written to `os.tmpdir()` (never into the repository): `<pdf> --library <json> --expect W=2` exits 1, because the invented sheet has a Wrong family verdict, and prints `Wrong family: 1`; adding `--allow-wrong 1` exits 0 and prints `W: 2 OK of 4` (OK means the verdict `ok` alone; off size is counted apart); `--expect W=3` with `--allow-wrong 1` exits 1 and prints `W: expected at least 3 OK, got 2`; `--relabel 2:G --allow-wrong 1` prints `Relabel: 2 of 2 reported Wrong family`; no arguments prints the usage and exits 1; a missing file prints `Could not read <path>.` with no stack trace.

- [ ] **Step 2: Run to see them fail.** Expected: FAIL, module not found.

- [ ] **Step 3: Write the script**, in the shape of `scripts/check-sheet-prechecks.mjs`: a header saying it is not part of `npm test` and why, exported helpers, `main()` behind the same `isMain` test. It writes no file.

```
node scripts/check-symbol-check.mjs "<drawing pdf>" (--legend "<legend pdf>" | --library "<symbol-library.json>")
     [--set-tag-id "<table heading>=<code>"]... [--expect <code>=<least OK>]... [--allow-wrong <n>]
     [--relabel <count>:<code>] [--max-seconds <n>] [--no-twin] [--grid <pitch>:<code>] [--verbose]
```

  - Prints: tags found and how many were located; the tally by function code, one line per code as `<code>: <n> OK of <total>` followed by the other verdicts that occurred; `Wrong family: <n>`; `Recognised: <n> of <checked> checked (<pct>%)`; proposals per tag; `Time: <s> s` for `checkSheet` alone. `--verbose` adds one line per tag that is not OK. **Tags and symbol names appear only with `--verbose`.**
  - Fails (exit 1) when: any `--expect` is not met; Wrong family exceeds `--allow-wrong` (default 0); the time exceeds `--max-seconds`; with `--relabel`, fewer than 90% of the relabelled tags come out Wrong family, or any other tag's verdict changed.
  - `--relabel` runs the check a second time with the changed codes and prints `Relabel: <n> of <count> reported Wrong family` and `Other verdicts changed: <n>`.
  - `--no-twin` passes `options.twin = false`.
  - `--grid <pitch>:<code>` ignores the text layer and uses stand-in places every `pitch` points, all of `code`. It prints the distinct symbols recognised as `<n> at <size>%`, one line per size, and skips the Wrong family failure (stand-ins have no real tags).

- [ ] **Step 4: Run to see the tests pass.** Expected: 3 pass. `npm test`: 805 tests, 803 passing.

- [ ] **Step 5: Run Gate 3 on test drawing A.** The two private values (the flowmeters' function code and the heading of the legend table that holds them) are in `phase3-plan-handover.md` in the shared notes folder. Reads files outside the repository; writes nothing.

Run: `node scripts/check-symbol-check.mjs "../pid-symbol-spike/test-drawing-A.pdf" --legend "../pid-symbol-spike/legend-sheets.pdf" --set-tag-id "<heading>=<flow code>" --expect V=44 --expect <flow code>=4 --relabel 10:<flow code> --max-seconds 30`

Expected, from the planning measurement: 71 tags, 71 located; `V: 45 OK of 45`; the flow code `4 OK of 4`; `Wrong family: 0`; one other code with 4 Needs a look; 18 Not checked; `Recognised: 49 of 53 checked (92%)`; `Relabel: 10 of 10 reported Wrong family`, `Other verdicts changed: 0`; time 6.5 to 8.4 s; exit code 0. Then run it once more with `--no-twin` and without `--expect`: expected `V: 39 OK of 45` and `Wrong family: 6`, exit 1. That run is evidence for the filled loops, not part of the gate.

- [ ] **Step 6: Run the drawing B part.** Run the script twice on `../pid-symbol-spike/test-drawing-B.pdf` with `--legend`, the same `--set-tag-id`, and `--grid 80:V`, then `--grid 80:<flow code>`. Expected: at least 8 symbols of the valve family at about 122%, and 2 of the flow family at about 88%; none at 95% to 105%. (Planning measurement: 12 and 2.)

- [ ] **Step 7: Go or stop.** Record every number printed in the task report, whether or not it matches.

  **Go**, all of: at least 44 valve-code tags OK, including the six that need filled loops; 4 of 4 flowmeters OK; `Wrong family: 0`; relabel at least 9 of 10; under 30 s; drawing B as Step 6; recognised at least 90% of the checked tags.

  **Stop** on any miss. Two adjustments are allowed first, each reported with the numbers before and after: `recognise` may be lowered, but not below 0.88; and a symbol that causes a false match may be shown to be a shape the `simple` rule should catch. Nothing else is tuned. If it still misses, follow *If Gate 3 fails* at the top of this plan. Tasks 7 to 9 do not start.

- [ ] **Step 8: Checkpoint.** Files: `scripts/check-symbol-check.mjs`, `tests/check-symbol-check.test.js`. Message: `feat(pid): local-only Gate 3 check for the symbol check`. **Tell the owner the gate's result before going on.**

---

### Task 7: What the user sees, and the worker

Only after a Go.

**Files:** Create `assets/js/pid-symbol-check-view.js`, `assets/js/pid-symbol-check-worker.js`. Test: `tests/pid-symbol-check-view.test.js`.

**Interfaces:**
- Consumes: `esc` from `pid-symbols-view.js`; the `Verdict` shape from Task 5.
- Produces: `FAMILY_NOTE`, `VERDICT_LABELS`, `blockerText({ sheetOpen, status, hasLibrary, running }) -> string` (`''` when the check may run), `progressHtml(done, total) -> string`, `resultsHtml(result) -> string`, `boxRects(result, scale) -> [{ i, kind, left, top, width, height, title }]`.

Exact copy:

```js
export const FAMILY_NOTE = 'This check confirms that a standard symbol of the right family sits beside each tag. '
  + 'It cannot tell whether the right member of that family was chosen: a ball valve drawn where a butterfly valve was intended passes.';
export const VERDICT_LABELS = { ok: 'OK', 'off-size': 'OK, off size', 'wrong-family': 'Wrong family',
  exception: 'Approved exception', look: 'Needs a look', 'not-checked': 'Not checked' };
```

`blockerText`, first that applies: not `sheetOpen`: `Open a sheet first.` `running`: `A check is running.` not `hasLibrary`: `Load the symbol library first, on the Symbols tab.` `status` empty: `This sheet has not been pre-checked yet.` `status` not `'readable'`: `Only a sheet that is Readable can be checked: its tags need positions on the page.`

- [ ] **Step 1: Write the failing tests.** Six tests:
  1. `blockerText`: each of the five sentences, and `''` for `{ sheetOpen: true, status: 'readable', hasLibrary: true, running: false }`; `blockerText(null)` is `Open a sheet first.`
  2. `resultsHtml` of the invented sheet's result (`checkSheet` from Task 5): contains `FAMILY_NOTE` escaped; contains `3 OK`, `1 OK, off size`, `1 Wrong family`, `1 Approved exception`, `1 Needs a look`, `4 Not checked`; contains `Results are shown here and are not saved.`; has 11 elements matching `data-act="sym-jump"`; the first row is the Wrong family one and reads `Recognised as WIDGET, BARRED (tag identifier W), which does not fit G.`; the off-size row reads `drawn at 120% of legend size`; the filled row contains `filled in (normally closed)`; the pennant row contains `One of: PENNANT, LEFT, PENNANT, RIGHT`; the exception row contains `Approved exceptions for this family: Folding widget. The tool cannot tell whether this item is one of them.`; the look row contains `Nothing recognised within 60 pt. Could be non-standard, modified, or a gap in the library.`
  3. Escaping: a result whose `tag`, `symbol`, `why`, `tagId`, a `oneOf` entry and an `exceptions` entry are all `<img src=x onerror=alert(1)>` gives HTML with no `<img` in it; an unknown `verdict` such as `'constructor'` is shown as Not checked.
  4. `resultsHtml(null)`, `resultsHtml({ ok: false })` and `resultsHtml('x')` give `The symbol check could not run on this sheet.` and still contain no markup from the input.
  5. `boxRects` at scale 2: one rectangle per verdict that has a `box` or, failing that, a `tagBox`, with `left`, `top`, `width`, `height` equal to the box times 2 with 3 px of margin each side, `kind` the verdict key, `i` its index in `verdicts`, and `title` plain text; a non-finite scale or a result that is not one gives `[]`.
  6. `progressHtml(3, 71)` contains `Checking symbols: 3 of 71 tags` and a `data-act="sym-cancel"` button; non-numbers show as 0.

- [ ] **Step 2: Run to see them fail.** Expected: FAIL, module not found.

- [ ] **Step 3: Write the view module.** Rows are `<li><button type="button" class="sc-row sc-<verdict>" data-act="sym-jump" data-i="<index>">`, ordered Wrong family, Needs a look, Approved exception, OK off size, Not checked, OK, and by tag within each. Each row: the tag, the label, then the sentence for its verdict (Not checked uses `why`; OK names the symbol or the `One of:` list, then `filled in (normally closed)` and `letter read` or `letter not judged` when they apply). Above the list: `FAMILY_NOTE`, the counts, `Checked in <s> s.` and `Results are shown here and are not saved.` Every value from the result goes through `esc`.

- [ ] **Step 4: Write the worker**, given in full: it has no test.

```js
// assets/js/pid-symbol-check-worker.js
// Runs the symbol check off the page's thread, so the tool stays usable.
// Receives one message with a page's operator list, text items, tags and the
// library; posts progress, then one result. It holds nothing between runs.
import { pagePaths } from './pid-symbols.js';
import { checkSheet } from './pid-symbol-check.js';

self.onmessage = ev => {
  try {
    const d = ev.data || {};
    const paths = pagePaths(d.fnArray, d.argsArray, d.OPS, d.viewportTransform);
    const result = checkSheet({ paths, textItems: d.textItems, viewportTransform: d.viewportTransform, tags: d.tags,
      library: d.library, lookups: d.lookups, onProgress: (done, total) => self.postMessage({ type: 'progress', done, total }) });
    self.postMessage({ type: 'result', result });
  } catch (e) {
    self.postMessage({ type: 'result', result: { ok: false, why: 'failed' } });
  }
};
```

- [ ] **Step 5: Run to see them pass.** Expected: 6 pass. `npm test`: 811 tests, 809 passing, 0 failing, 2 skipped.

- [ ] **Step 6: Checkpoint.** Message: `feat(pid): symbol check results view and worker`.

---

### Task 8: Wire the button into the tool

**Files:** Modify `tools-src/pid-tag-register.html` (gitignored), by anchored patch only. Create in the workspace `.superpowers/sdd/2026-11-15-pid-symbol-check/`: `pid-tag-register.before-symbol-check.html`, `tool-facts.mjs`, `patch.mjs`, `edits.mjs`.

**Interfaces:**
- Consumes: `window.PidSymCheckView` (Task 7); from the tool, `viewer`, `sheetChecks`, `pdfKey`, `symLib`, `pdfjsLib`, `FC_LOOKUP`.
- Produces, as globals in the tool's classic script: `symCheck`, `symCheckWorker`, `symbolCheckBlocker()`, `updateSymbolCheckButton()`, `clearSymbolCheck()`, `drawSymbolBoxes()`, `runSymbolCheck()`.

- [ ] **Step 1: Back up and record the before-state.** Copy the tool to `pid-tag-register.before-symbol-check.html` in the workspace. Copy `tool-facts.mjs` and `patch.mjs` from `.superpowers/sdd/2026-11-14-pid-sheet-prechecks/` (their text is also in the phase 2 plan, Task 7), change the workspace path in their comments, and add to `tool-facts.mjs` a last block that cuts from `// SYMBOL CHECK` to `// (end of symbol check)` and prints `save-path names inside the symbol check section <n>`, counting the same names as the pre-check block plus `saveLibraryFile`. Run it and save the output as `facts-before.txt`. Expected, as measured on 2026-11-15:

```
lines 4099
register.json mentions 19
extractTextFromPDF b584963c9ad8e30c
save path e551e57fee77ca78
read and connect path 284cb06b07a5f2f0
calls: scheduleSave 6 saveToFolder 4 snapshotRev 2 createWritable 4
save-path names inside the pre-check section 0
```

If any value differs, the tool has changed since this plan was written: stop and report before patching.

- [ ] **Step 2: Write the edit list**, `edits.mjs`, with the file tools. Given in full: it is glue with no tests to determine it. LF line endings.

```js
const r = String.raw;

const GLUE = r`// (end of sheet pre-checks)

// ─────────────────────────────────────────────────────────────────────────────
// SYMBOL CHECK
// Does a standard symbol of the right family sit beside each tag on this page?
// assets/js/pid-symbol-check.js decides, in a worker. The code here starts it
// when the user clicks Check symbols, and never otherwise, and puts the answer
// on screen. Results are held in memory for the sheet on screen: shown, never
// saved, and nothing here writes to the folder.
// ─────────────────────────────────────────────────────────────────────────────
let symCheck = null;         // { key, page, result } for the sheet on screen
let symCheckWorker = null;   // the run in progress, if any
let symCheckRun = 0;         // goes up whenever a run starts or is cleared; an older run that wakes up sees it and stops

function symbolCheckBlocker() {
  const V = window.PidSymCheckView;
  if (!V) return 'The symbol check did not load. Reload the page.';
  const c = viewer.drawing ? sheetChecks[pdfKey(viewer.drawing, viewer.rev)] : null;
  return V.blockerText({ sheetOpen: !!viewer.pdf, status: c ? c.status : '', hasLibrary: !!symLib, running: !!symCheckWorker });
}

function updateSymbolCheckButton() {
  const b = document.getElementById('sheet-symcheck-btn');
  if (!b) return;
  const why = symbolCheckBlocker();
  b.disabled = !!why;
  b.title = why || 'Check the symbols beside the tags on this page. Nothing is saved.';
}

function stopSymbolCheckRun() {
  if (symCheckWorker) { symCheckWorker.terminate(); symCheckWorker = null; }
}

function clearSymbolCheck() {
  symCheckRun++;
  stopSymbolCheckRun();
  symCheck = null;
  const el = document.getElementById('sheet-symcheck');
  if (el) el.innerHTML = '';
  drawSymbolBoxes();
  updateSymbolCheckButton();
}

function drawSymbolBoxes() {
  const layer = document.getElementById('sheet-symboxes'), V = window.PidSymCheckView;
  if (!layer) return;
  layer.innerHTML = '';
  if (!V || !symCheck || symCheck.page !== viewer.page || !viewer.scale) return;
  V.boxRects(symCheck.result, viewer.scale).forEach(function(b) {
    const d = document.createElement('div');
    d.className = 'sc-box sc-' + b.kind;
    d.title = b.title;
    d.dataset.i = String(b.i);
    d.style.cssText = 'left:' + b.left + 'px;top:' + b.top + 'px;width:' + b.width + 'px;height:' + b.height + 'px';
    layer.appendChild(d);
  });
}

async function runSymbolCheck() {
  const el = document.getElementById('sheet-symcheck'), V = window.PidSymCheckView;
  const why = symbolCheckBlocker();
  updateSymbolCheckButton();
  if (!el) return;
  if (why) { el.textContent = why; return; }
  const drawing = viewer.drawing, rev = viewer.rev, pageNo = viewer.page, key = pdfKey(drawing, rev);
  const run = ++symCheckRun;
  const fail = function() { if (run !== symCheckRun) return; stopSymbolCheckRun(); symCheck = null; el.innerHTML = V.resultsHtml(null); drawSymbolBoxes(); updateSymbolCheckButton(); };
  try {
    const page = await viewer.pdf.getPage(pageNo);
    const ol = await page.getOperatorList();
    const content = await page.getTextContent();
    if (run !== symCheckRun) return;                          // another sheet was opened, or the button was clicked again
    const tags = sheetChecks[key].result.confirmed.map(function(t) { return { tag: t.tag, fc: t.fc }; });
    const w = new Worker('/assets/js/pid-symbol-check-worker.js', { type: 'module' });
    symCheckWorker = w;
    updateSymbolCheckButton();
    el.innerHTML = V.progressHtml(0, tags.length);
    w.onmessage = function(ev) {
      if (w !== symCheckWorker || run !== symCheckRun) return;   // a run that was stopped
      const m = ev.data || {};
      if (m.type === 'progress') { el.innerHTML = V.progressHtml(m.done, m.total); return; }
      stopSymbolCheckRun();
      if (viewer.drawing !== drawing || viewer.rev !== rev) return;   // the user has moved to another sheet
      symCheck = (m.result && m.result.ok) ? { key: key, page: pageNo, result: m.result } : null;
      el.innerHTML = V.resultsHtml(m.result);
      drawSymbolBoxes();
      updateSymbolCheckButton();
    };
    w.onerror = function(e) { console.error('symbol check worker failed', e); if (w === symCheckWorker) fail(); };
    w.postMessage({ fnArray: ol.fnArray, argsArray: ol.argsArray, OPS: pdfjsLib.OPS,
      viewportTransform: page.getViewport({ scale: 1 }).transform, textItems: content.items,
      tags: tags, library: symLib, lookups: { fc: FC_LOOKUP } });
  } catch (e) {
    console.error('symbol check could not start', e);
    fail();
  }
}

document.addEventListener('click', function(ev) {
  const t = ev.target && ev.target.closest ? ev.target.closest('#sheet-symcheck [data-act]') : null;
  if (!t) return;
  if (t.dataset.act === 'sym-cancel') { clearSymbolCheck(); return; }
  if (t.dataset.act !== 'sym-jump') return;
  const box = document.querySelector('#sheet-symboxes .sc-box[data-i="' + String(Number(t.dataset.i)) + '"]');
  if (!box) return;
  const scroll = document.getElementById('sheet-scroll');
  scroll.scrollLeft = Math.max(0, box.offsetLeft - scroll.clientWidth / 2);
  scroll.scrollTop = Math.max(0, box.offsetTop - scroll.clientHeight / 2);
  document.querySelectorAll('#sheet-symboxes .sc-here').forEach(function(x) { x.classList.remove('sc-here'); });
  box.classList.add('sc-here');
});
// (end of symbol check)
`;

export const EDITS = [
  { name: 'button',
    find: r`            <span id="sheet-matches"></span>
`,
    replace: r`            <span id="sheet-matches"></span>
            <button class="sheet-btn" id="sheet-symcheck-btn" onclick="runSymbolCheck()" disabled title="Open a sheet first.">Check symbols</button>
` },
  { name: 'results line',
    find: r`          <div id="sheet-check" role="status"></div>
`,
    replace: r`          <div id="sheet-check" role="status"></div>
          <div id="sheet-symcheck" role="status"></div>
` },
  { name: 'box layer',
    find: r`<div id="sheet-overlay" style="position:absolute;inset:0;pointer-events:none"></div>`,
    replace: r`<div id="sheet-overlay" style="position:absolute;inset:0;pointer-events:none"></div><div id="sheet-symboxes" style="position:absolute;inset:0;pointer-events:none"></div>` },
  { name: 'clear when another sheet is opened',
    find: r`  clearSheetCheck();
  const scroll = document.getElementById('sheet-scroll');
`,
    replace: r`  clearSheetCheck();
  clearSymbolCheck();
  const scroll = document.getElementById('sheet-scroll');
` },
  { name: 'redraw the boxes when the page is drawn',
    find: r`  if (viewer.highlight) await applySheetHighlight();
  else document.getElementById('sheet-matches').textContent = '';
`,
    replace: r`  if (viewer.highlight) await applySheetHighlight();
  else document.getElementById('sheet-matches').textContent = '';
  drawSymbolBoxes();
  updateSymbolCheckButton();
` },
  { name: 'button follows the pre-check status',
    find: r`    el.innerHTML = P.checkHtml(check, compare);
`,
    replace: r`    el.innerHTML = P.checkHtml(check, compare);
    updateSymbolCheckButton();
` },
  { name: 'button follows the library',
    find: r`function renderSymbols() {
`,
    replace: r`function renderSymbols() {
  updateSymbolCheckButton();
` },
  { name: 'styles',
    find: r`  #sheet-msg { flex: 1;`,
    replace: r`  /* Symbol check: assets/js/pid-symbol-check-view.js builds the markup */
  #sheet-symcheck:not(:empty) { padding: 8px 16px; border-bottom: 1px solid var(--border); font-size: 0.85rem; color: var(--tmut); max-height: 30vh; overflow: auto; }
  .sc-note { font-weight: 600; margin-bottom: 4px; }
  .sc-list { list-style: none; margin: 6px 0 0; padding: 0; }
  .sc-row { display: block; width: 100%; text-align: left; background: none; border: 0; border-left: 4px solid var(--tmut); padding: 3px 8px; margin: 2px 0; font: inherit; color: inherit; cursor: pointer; }
  .sc-box { position: absolute; box-sizing: border-box; border: 2px solid var(--tmut); border-radius: 3px; }
  .sc-row.sc-ok, .sc-box.sc-ok { border-color: var(--green); }
  .sc-row.sc-off-size, .sc-box.sc-off-size, .sc-row.sc-exception, .sc-box.sc-exception, .sc-row.sc-look, .sc-box.sc-look { border-color: var(--amber); }
  .sc-row.sc-wrong-family, .sc-box.sc-wrong-family { border-color: var(--red); }
  .sc-box.sc-not-checked { border-style: dashed; }
  .sc-box.sc-here { outline: 3px solid var(--accent-gold); }
  #sheet-msg { flex: 1;` },
  { name: 'view module',
    find: r`  import('/assets/js/pid-precheck.js')
`,
    replace: r`  // Symbol check: only the strings are loaded here; the check itself runs in
  // a worker. Loaded on its own and allowed to fail, like the pre-checks.
  import('/assets/js/pid-symbol-check-view.js')
    .then(function(m) { window.PidSymCheckView = m; })
    .catch(function(e) { console.error('The symbol check is unavailable.', e); });
  import('/assets/js/pid-precheck.js')
` },
  { name: 'glue section',
    find: '// (end of sheet pre-checks)\n',
    replace: GLUE },
];
```

`updateSymbolCheckButton` is a function declaration in the classic script, so the call added to `renderSymbols` is safe wherever the two sit in the file. If `renderSymbols` can run before the Sheets markup exists, the function returns at its first line.

- [ ] **Step 3: Apply it.** Run: `node .superpowers/sdd/2026-11-15-pid-symbol-check/patch.mjs .superpowers/sdd/2026-11-15-pid-symbol-check/edits.mjs`. Expected: `Applied 10 edits.` If it prints "Nothing written", the tool is untouched: report which anchor failed and stop.

- [ ] **Step 4: Check it parses, and prove what was not touched.** Run `node --check` on the largest classic `<script>` body as the phase 2 plan's Task 7 Step 5 does; expected `SYNTAX OK`. Run `tool-facts.mjs` again as `facts-after.txt`: the three hashes, `register.json mentions 19` and the four call counts identical to Step 1; `save-path names inside the pre-check section 0`; `save-path names inside the symbol check section 0`. `diff` the backup against the tool and confirm every hunk is one of the ten edits. Confirm `grep -c "runSymbolCheck()" tools-src/pid-tag-register.html` is 2: the button and the definition. Nothing else may call it.

- [ ] **Step 5: Run the suite.** `npm test`: 811 tests, 809 passing, 0 failing, 2 skipped. `tests/escaping-audit.test.js` reads the tool and must still pass.

- [ ] **Step 6: Checkpoint.** Nothing tracked changed. Message if asked: `git commit --allow-empty -m "feat(pid): Check symbols button on a sheet (source in gitignored tools-src/)"`.

---

### Task 9: Verify in the browser, and hand over

**Files:** none changed. Only the invented sheet is used by the agent. No session tool can set a file input, and the private drawings must not be served from the repository.

- [ ] **Step 1: Open the tool.** `preview_start` with name `site`, then `http://localhost:5050/tools-src/pid-tag-register.html`. If port 5050 is held by another session, serve the repository root from a throwaway static server on another port and say so. No folder connected. No console errors; `typeof window.PidSymCheckView.resultsHtml` is `'function'`; the button reads **Check symbols**, is disabled, and its title is `Open a sheet first.`

- [ ] **Step 2: Import the invented sheet. The check must not run.** In the console:

```js
const F = await import('/tests/fixtures/symbol-check-sheet.js');
await handlePIDFiles([new File([F.sheetPdfBytes()], 'INV-SYMBOLS.pdf', { type: 'application/pdf' })]);
document.querySelectorAll('.rev-input:not(.rev-date-input)').forEach(i => i.value = 'C01');
await confirmRevModal();
switchTab('sheets'); viewSheet('INV-SYMBOLS', 'C01', '');      // not awaited: this pane may never finish drawing the page
await new Promise(r => setTimeout(r, 1500));
[symCheck, symCheckWorker, document.getElementById('sheet-symcheck').textContent, document.getElementById('sheet-symcheck-btn').title];
```

Expected: `[null, null, '', 'Load the symbol library first, on the Symbols tab.']`. Importing and opening ran no check.

- [ ] **Step 3: Load the invented library and run the check.** `symLib = F.LIBRARY; updateSymbolCheckButton();` The button is enabled. Then `document.getElementById('sheet-symcheck-btn').click()`, wait two seconds, and read `document.getElementById('sheet-symcheck').textContent`. Expected: it starts with the family sentence (`This check confirms that a standard symbol of the right family…`), contains `3 OK`, `1 OK, off size`, `1 Wrong family`, `1 Approved exception`, `1 Needs a look`, `4 Not checked` and `Results are shown here and are not saved.` `symCheck.result.verdicts.map(v => v.verdict)` equals the list in Task 5's second test. `symCheckWorker` is `null`. If the worker reports a failure instead, read the console: a `DataCloneError` means the operator list could not be posted; report it and stop, since the remedy (walking the operator list on the page's thread and posting the paths) is a change to this plan.

- [ ] **Step 4: Boxes and jumping.** `viewer.scale = viewer.scale || 1; drawSymbolBoxes();` then `document.querySelectorAll('#sheet-symboxes .sc-box').length` is `11`, with class counts `sc-ok` 3, `sc-off-size` 1, `sc-wrong-family` 1, `sc-exception` 1, `sc-look` 1, `sc-not-checked` 4. Click the first row (`document.querySelector('#sheet-symcheck [data-act="sym-jump"]').click()`): exactly one box has `sc-here`, and it is the `sc-wrong-family` one. `document.querySelectorAll('#sheet-symcheck img, #sheet-symboxes img').length` is `0`. If a real browser tab is available, take a screenshot of the drawn sheet with its boxes; in the built-in pane the page may never draw, so say which you had.

- [ ] **Step 5: Leaving a sheet ends the run (Review Focus 5).** Start a run and move away at once: `document.getElementById('sheet-symcheck-btn').click(); viewSheet('INV-SYMBOLS', 'C01', '');` wait two seconds. Expected: `symCheck` is `null`, `symCheckWorker` is `null`, the results line is empty, no boxes. Then run again, and while results show, `symLib = null; updateSymbolCheckButton();`: the button is disabled with the library reason, and the results already on screen stay.

- [ ] **Step 6: Nothing is saved.** Reload. Connect the browser's private file system as the phase 2 plan's Task 9 Step 8 does (`registerDir = await navigator.storage.getDirectory(); dirHandle = registerDir; connectMode = 'legacy';`), import the invented sheet, wait three seconds for the save, read `register.json` and note `savedAt` and the file's length. Load the library, open the sheet, run the check, click two rows, wait five seconds, and read the file again. Expected: `savedAt` and the length are unchanged, `/symCheck|sc-|verdict/.test(text)` is `false`, and the folder holds no new file (`for await (const [n] of registerDir.entries()) …` lists what it listed before). Clean up as that step does, then reload.

- [ ] **Step 7: A sheet that is not Readable cannot be checked.** Import `SHEETS.printed` from `/tests/fixtures/sheet-pdf.js` as `INV-PRINTED`, open it, wait: the button is disabled and its title is `Only a sheet that is Readable can be checked: its tags need positions on the page.`

- [ ] **Step 8: Final suite and status.** `npm test`: 811 tests, 809 passing, 0 failing, 2 skipped. `git status --short` lists only: the three new modules under `assets/js/`, `scripts/check-symbol-check.mjs`, three test files, `tests/fixtures/symbol-check-sheet.js` and this plan. Search those files for anything from a real drawing or the legend; expected: none.

- [ ] **Step 9: Write the hand-over and this plan's Outcome section.** Every line of Steps 2 to 7 that did not behave as written, with what happened instead. Then plainly: the Gate 3 numbers as you got them; that the check has run in a browser only on the invented sheet; that the time in a browser is unmeasured; that a module worker in the live locked tool is unverified.

- [ ] **Step 10: The owner's part.** Give these to him as written.

  **A. Test drawing A through the tool, on the laptop.** Nothing is saved: no folder is connected.
  1. With the preview running, open `http://localhost:5050/tools-src/pid-tag-register.html` in your browser. Do not click **Connect folder**.
  2. Click **Symbols**, then **Import legend**, and choose `legend-sheets.pdf` from `pid-symbol-spike`. Click **Use this library**.
  3. In the search box type `flowmeter`. On each flowmeter symbol click **Edit**, type the flowmeters' function code in **Tag identifier**, and click **Apply**.
  4. Click **Register**, drag `test-drawing-A.pdf` onto **Drop PDFs here**, and click **↓ Import all**.
  5. Click **Sheets**, then the drawing. Wait for the line that starts "Readable".
  6. Click **Check symbols**. Note how many seconds it takes.
  7. It should say 45 OK for the valves and 4 OK for the flowmeters, with no Wrong family. Tell me the counts and the time.
  8. Click three rows in the list and say whether the box it jumps to is around the right symbol.

  **B. Going live.** When you are content with A:
  1. In a terminal in `harveydeason-site`, run `node scripts/lock-tools.mjs` and type your workshop code when asked.
  2. Tell me to commit and push. The commit must carry `tools/` and the new files listed in Step 8, or the live tool will not find the worker.

  **C. On your work computer, after it is live.**
  1. Open the P&ID Tag Register and click **Connect folder**.
  2. Click **Symbols**. If the flowmeter symbols there have no tag identifier, set it as in A step 3 and click **Save**.
  3. Click **Sheets**, open a palette-drawn sheet **by a different author from test drawing A**, and click **Check symbols**.
  4. Tell me the counts, the time, and for each Wrong family or Needs a look row whether the tool is right.

  Phase 3 is done when A reads as written, C runs, and you have judged C's rows. One good drawing is thin evidence; C is the second.

---

## What this plan leaves for later

- **The four tags on test drawing A that read Needs a look.** Whether their code and the nearby symbol's tag identifier disagree on the drawing, in the legend, or only in the library is the owner's call. Details in the private note.
- **`applySheetHighlight` cannot highlight a tag held in two text items.** It splits its pattern on a backslash-hyphen that is never there; splitting on `'-'` fixes it. On test drawing A that is 22 of 71 tags. Not touched here.
- **An editor for `library.families`**, if marking a whole family "not checked" by flagging each symbol proves tedious.
- **Instrument bubbles**, until their legend table extracts cleanly.
- **A second proposal rule for symbols made only of curves**, if a real sheet shows a miss.
- **Checking every page of a multi-page PDF in one run.**
- **Publishing.** The owner re-locks the tool. `pid-symbol-check.js`, `pid-symbol-check-view.js` and `pid-symbol-check-worker.js` must be pushed with it.

## Outcome (2026-11-15)

Executed in one session, with one independent review at the end. The owner confirmed the Gate 3 numbers as the bar and that phase 2 is fully checked before work began. Nothing is committed and the tool has not been re-locked.

- **Gate 3: Go.** Test drawing A, by the Task 6 script: 71 tags, 71 located. Valve code 45 OK of 45. Flowmeters 4 OK of 4, with their tag identifier set. Wrong family 0. Four tags of one other code Needs a look. 18 instrument tags Not checked. Recognised 49 of 53 checked (92%). Relabel 10 of 10 Wrong family, no other verdict changed. 8.6 to 8.8 s for the sheet in Node, 1,729 proposals per tag. The same numbers after the review's fixes.
- **Without filled loops:** 39 OK of 45 and 6 Needs a look. (The planning prototype had those six as Wrong family; not chased.)
- **Test drawing B, stand-in places on an 80 pt grid:** valve family 12 at 122% (scores 0.962 to 1.00, four of them filled), 4 at 91% and 3 at 97%; flow family 2 at 88% (0.906 and 0.91) and 3 at 78%. The design's bar (both flowmeters and at least 8 ball valves, each off size) is met. This plan's own line "none at 95% to 105%" was a guess and was wrong: three valve-family matches came out at 97%, two of them scoring 1.00. The three flow-family matches at 78% are one plain round meter symbol, most likely laid on some other round shape: a false match to watch for on real sheets.
- **Tests:** 815 (baseline 771), 813 passing, 0 failing, 2 skipped. Four more than planned, all from the review.
- **Tasks 1 to 5** passed at the first run, 31 of 31, with the fixture as written.
- **Tool:** 10 planned edits, then 1 after the review. 4,234 lines (was 4,099). The text read, the save path and the read-and-connect path hash the same as before; `register.json` is still named 19 times; the four call counts are unchanged; the symbol check section names no save function. The backup of the tool as it was is in the workspace, `.superpowers/sdd/2026-11-15-pid-symbol-check/pid-tag-register.before-symbol-check.html`.
- **Browser, Task 9 Steps 1 to 8, on the real patched tool with the invented sheet:** every value as written. The check ran in a worker through the real pdf.js operator list in 0.5 to 0.7 s. The page drew this time and the boxes were seen on it. `register.json` was byte-for-byte the same length with the same `savedAt` after a check and two jumps, and the folder held the same two entries.
- **Review:** one critical and three important findings, all fixed with a test that failed first:
  1. A library symbol with an absurd coordinate (a segment a thousand million points long) crashed the process outright, beyond any `try`. Such a symbol, and one of more than 4,000 segments, is now set aside before any work in proportion to its size.
  2. A Wrong family verdict did not claim its symbol, so one symbol could give two tags that verdict. It now answers one tag there too.
  3. Nothing bounded a check's total time. It now stops at 120 s, says so, and marks the tags it did not reach.
  4. Turning to another page left the first page's results on screen. Turning the page now clears them. Checked in the browser.
- **Deferred:** a tag of nothing but hyphens makes a slow pattern; a symbol near the 120 pt limit drawn 60 pt from its tag falls outside the window and is missed without a word; the button stays enabled for the moment between a click and the worker starting, so a double click does the reading twice (the older run is discarded); one view test assertion cannot fail; no `checkSheet` test uses a checkable symbol with markup in its name (the view's escaping is tested with hand-built verdicts); the stamp and fill routines have no cap of their own and rely on the time limit.
- **After going live (2026-11-15), a second sheet from the owner:** 11 tags, 11 located, 1 of 6 checked tags recognised (17%). Two items of one family are drawn to proportions that are not the legend's at any single size (best score 0.59 to 0.65): a true flag. One pump scores 0.86, just under the bar. One symbol is drawn at an angle, and turning the local linework upright by its 45° still recognised nothing of its family, so matching at any angle would not have helped here. One tank reads Needs a look because a fresh library flags no symbol "drawn to suit". **Added in answer:** a row with nothing recognised now names the closest symbol of its own family and its score ("Closest in its family: … at 86%"). Two more tests (817, 815 passing); Gate 3 unchanged at 10.0 s.
- **Not yet checked:** the three private drawings through the tool, the time in a real browser on a real sheet, a module worker in the live locked tool, and a second palette-drawn sheet by a different author. All are the owner's (Task 9 Step 10).
