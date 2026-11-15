# P&ID Symbol Check Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tick sheets in the Sheets tab, run the symbol check on all of them in one go, and download the results as a PDF for a review pack (with each original drawing page carrying numbered, coloured boxes) and as an Excel workbook.

**Architecture:** Three new modules under `assets/js/`, each node-tested: the run over many sheets with its on-screen strings (`pid-symbol-report-run.js`, every outside effect injected), the report model and Excel workbook (`pid-symbol-report.js`), and the PDF (`pid-symbol-report-pdf.js`, pdf-lib passed in). pdf-lib 1.17.1 is vendored. The tool gets tick boxes, an **Export report** button, a panel, and one glue section that supplies the injected effects from what the tool already has (`getPdfData`, the pre-check functions, the symbol check worker).

**Tech Stack:** Vanilla ES modules, `node --test` on Node 20, pdf.js 3.11.174 (vendored; in Node through `scripts/pdfjs-node.mjs`), pdf-lib 1.17.1 (new, vendored), ExcelJS (vendored, `assets/vendor/exceljs.min.js`), the module worker `assets/js/pid-symbol-check-worker.js`, the preview server (`.claude/launch.json` config `site`, port 5050).

**Spec:** `docs/superpowers/specs/2026-11-15-pid-symbol-check-report-design.md` (approved 2026-11-15). Read it with this plan.

## Global Constraints

- **The repository is public.** No client data (drawing numbers, real tags, legend geometry, names) in `assets/js/`, `scripts/`, `docs/`, tests or fixtures. Tests use the invented sheet and library in `tests/fixtures/symbol-check-sheet.js` and made-up names such as `INV-0001`.
- **Nothing writes `register.json` or the register folder.** The new glue calls none of `saveToFolder`, `scheduleSave`, `mergeState`, `buildRegisterState`, `snapshotRev`, `createWritable`, `saveLibraryFile`, and assigns none of `allTags`, `drawings[...]`, `revHistory[...]`. Writing to `sheetChecks[...]` (memory only, as `showSheetCheck` does) is allowed. Task 4 Step 4 and Task 5 Step 6 measure this.
- **The report must keep saying the check confirms the right FAMILY, not the right member:** `FAMILY_NOTE` in full on the front page and in the About sheet; `It checks the family of symbol, not which member of it.` on every sheet's heading page.
- **Every ticked sheet appears in the report**, checked or with its reason. A stopped run says `Stopped by user after N of M sheets.` on its front page.
- **Pure functions do not throw.** Every export of the new modules returns degraded output on any input, as `pid-core.js` does. Values from a PDF or the library are untrusted: HTML through `esc` (from `pid-symbols-view.js`), PDF text through `pdfSafe`.
- **pdf-lib needs the owner's OK before it is downloaded.** Task 3 Step 1 asks; nothing else downloads anything.
- **`tools-src/` is gitignored.** Tool edits are anchored patches after a backup, in the workspace `.superpowers/sdd/2026-11-15-pid-symbol-check-report/` (gitignored). Never run `scripts/lock-tools.mjs`; the owner does that.
- **Do not commit** unless the owner asks. Each task ends with a checkpoint naming its files and a message to use if he has.
- **Shell heredocs on this machine can strip backslashes.** Write files containing a backslash with the file tools.
- **Baseline:** `npm test` gives 820 tests, 818 passing, 0 failing, 2 skipped. The tool is 4,292 lines; `tool-facts.mjs` from the phase 3 workspace prints, as measured on 2026-11-15:

```
lines 4292
register.json mentions 19
extractTextFromPDF b584963c9ad8e30c
save path e551e57fee77ca78
read and connect path 284cb06b07a5f2f0
calls: scheduleSave 6 saveToFolder 4 snapshotRev 2 createWritable 4
save-path names inside the symbol check section 0
save-path names inside the pre-check section 0
```

## Decisions made in this plan

For the owner to overrule at review.

1. **PDF colours are a print palette, not the screen's.** The site's green is near-black on paper and would vanish among the drawing's linework. OK `#2E7D32`, OK off size / Approved exception / Needs a look `#E08E00`, Wrong family `#C62828`, Not checked `#757575` dashed. Box line 1.5 pt.
2. **pdf-lib loads only when Download PDF is pressed, ExcelJS only when Download Excel is.** The tool's start-up is unchanged.
3. **A ticked drawing that no longer exists** when Run is pressed (deleted, or renamed by a re-import) is dropped, and the panel says how many: `1 ticked sheet is no longer in the register and was left out.`
4. **The run is a module with its effects injected**, so stopping, failures and reasons are node-tested; the tool supplies four small functions.
5. **"Has a PDF" before the run** means: bytes in memory for that drawing and current revision, or, when the folder is connected, a name in `archive/` or the folder root that `PidCore.pickArchiveFile` accepts. Listing the folder reads names only, never file bodies.
6. **Checked by** is remembered under the localStorage key `pidReportCheckedBy`, every access in try/catch.

## File structure

| File | Responsibility |
|---|---|
| `assets/js/pid-symbol-check-view.js` (modify) | Export `kindOf`, `ROW_ORDER`, `SUMMARY_ORDER`, `verdictSentence(v)`. No behaviour change. |
| `assets/js/pid-symbol-report-run.js` (create) | `runReport` over ticked sheets with injected effects; the panel's strings. |
| `assets/js/pid-symbol-report.js` (create) | Report model, box conversion to PDF user space, Excel workbook, file names. |
| `assets/js/pid-symbol-report-pdf.js` (create) | `pdfSafe`, `buildReportPdf(model, sources, PDFLib)`. |
| `assets/vendor/pdf-lib.min.js` (create) | pdf-lib 1.17.1 UMD, MIT. |
| `scripts/pdfjs-node.mjs` (modify) | Export `loadVendoredUmd(fileName)` for tests. |
| `tests/fixtures/symbol-check-sheet.js` (modify) | `sheetPdfBytes({ rotate, origin })` options. |
| `tests/pid-symbol-report-run.test.js`, `tests/pid-symbol-report.test.js`, `tests/pid-symbol-report-pdf.test.js` (create); `tests/pid-symbol-check-view.test.js` (modify) | Tests. |
| `tools-src/pid-tag-register.html` (modify, gitignored) | Ticks, bar, panel, styles, module import, glue section `// SYMBOL REPORT` … `// (end of symbol report)`. |

## Review Focus

Inputs the spec implies but does not spell out. Each has a test in the task named.

1. **A drawing name or tag with characters a file name or the PDF's font cannot hold** (`/`, `:`, `€`, an emoji, a control character, markup). Expected: the file name has `-` in their place, the PDF has `?`, nothing throws, HTML shows them as text. Tasks 1, 2, 3.
2. **A drawing pdf-lib cannot load** (damaged, encrypted) **or whose bytes are gone by download time.** Expected: that section keeps its heading and table, the drawing page is replaced by the fallback line, the rest of the report is whole. Task 3.
3. **Stop before the first sheet finishes, or during the last.** Expected: `Stopped by user after 0 of 3 sheets.` / `after 2 of 3`, the rest listed as not checked, a report with whatever was done (front page only when nothing was). Tasks 1, 2, 3.
4. **A drawing page that is rotated, or whose MediaBox does not start at 0,0.** Expected: each box lands on the same spot of the drawing as on screen. Tasks 2, 3.
5. **A ticked drawing removed from the register before Run.** Expected: dropped with the sentence in Decision 3, never a crash or an empty section. Task 4 (glue) and Task 5 Step 5.

---

### Task 1: The run, and what the user sees of it

**Files:** Create `assets/js/pid-symbol-report-run.js`. Modify `assets/js/pid-symbol-check-view.js`. Test: create `tests/pid-symbol-report-run.test.js`; add to `tests/pid-symbol-check-view.test.js`.

**Interfaces:**
- Consumes: `STATUS_LABELS` from `pid-precheck.js`; `esc` from `pid-symbols-view.js`.
- Produces from `pid-symbol-check-view.js`: `kindOf(v) -> verdict key`, `ROW_ORDER`, `SUMMARY_ORDER`, `verdictSentence(v) -> string` (plain text, the sentence the screen shows for that verdict).
- Produces from `pid-symbol-report-run.js`:
  - `REASONS = { noPdf, precheckFailed, noTags, failed, stopped }` (exact copy below) and `notReadable(status) -> string`.
  - `runReport({ sheets, deps, signal, onProgress }) -> Promise<{ outcomes: Outcome[], stopped: boolean, ms: number }>` where `sheets = [{ drawing, rev, family }]`, `signal = { stopped: boolean }` (set by the caller), `onProgress({ sheet, of, drawing, done, total })` (`done`/`total` are `null` while the drawing is read), and `deps`:
    - `loadPdf(drawing, rev) -> Promise<ArrayBuffer|Uint8Array|null>`
    - `precheck(drawing, rev, bytes) -> Promise<{ status, tags: [{ tag, fc }] } | null>`
    - `check(bytes, tags, onTags(done, total)) -> Promise<{ result, viewportTransform, pages, pageSize } | { stopped: true }>`
    - `now() -> number` (ms; optional, default `Date.now`)
  - `Outcome = { drawing, rev, family, status: 'checked'|'not-checked', reason: string ('' when checked), precheck: 'readable'|'comments'|'none'|'', pages: number, pageSize: [w,h]|null, viewportTransform: number[6]|null, result: CheckResult|null, ms: number }`.
  - Strings: `exportBlocker({ ticked, hasLibrary, running }) -> string`, `tickCountText(n) -> string`, `reachHtml({ names, missing, connected, checkedBy, dropped }) -> string`, `progressHtml({ sheet, of, drawing, done, total }) -> string`, `finishedHtml({ checked, notChecked, seconds, stopped, of }) -> string`.

Exact copy:

```js
export const REASONS = {
  noPdf: 'PDF not available in this session: connect the folder or re-import it.',
  precheckFailed: 'This sheet could not be pre-checked.',
  noTags: 'No confirmed tags to check.',
  failed: 'The symbol check could not run on this sheet.',
  stopped: 'Stopped before this sheet was checked.',
};
// notReadable('none') -> 'Pre-check status is No readable text: only a Readable sheet can be checked.'
```

Strings, exact:
- `exportBlocker`, first that applies: `running` → `A report is running.`; `ticked` < 1 → `Tick one or more sheets first.`; not `hasLibrary` → `Load the symbol library first, on the Symbols tab.`; else `''`.
- `tickCountText`: 0 → `''`; 1 → `1 sheet ticked`; n → `<n> sheets ticked`.
- `reachHtml`: first line `<n - k> of <n> ticked sheets can be checked.` then, when `k = missing.length` > 0, ` <k> ha<s|ve> no PDF in this session: connect the folder or re-import them.` (connected: ` <k> ha<s|ve> no PDF in this session or in the folder: re-import them.`); when `dropped` > 0, the Decision 3 sentence (`1 ticked sheet is` / `<n> ticked sheets are` `no longer in the register and was/were left out.`). Then the ticked names as a list, each missing one followed by ` (no PDF)`. Then a text input `id="sr-by"` labelled `Checked by (optional)` with `value` = `checkedBy`, and buttons `data-act="sr-run"` **Run** and `data-act="sr-cancel"` **Cancel**. Ends with `Nothing is saved to the folder.`
- `progressHtml`: `Checking sheet <sheet> of <of>: <drawing>, tag <done> of <total>…` or, with `done` null, `Checking sheet <sheet> of <of>: <drawing>, reading the drawing…`; then a `data-act="sr-stop"` **Stop** button.
- `finishedHtml`: `stopped` is `false`, or the number of sheets reached before the stop, which gives the prefix `Stopped by user after <stopped> of <of> sheets. `; then `<checked> checked, <notChecked> not checked, <time>.` where time is `42 s` under a minute and `4 min 12 s` otherwise; then `Nothing has been saved to the folder.`; then buttons `data-act="sr-pdf"` **Download PDF**, `data-act="sr-xlsx"` **Download Excel**, `data-act="sr-close"` **Close**.

- [ ] **Step 1: Write the failing tests.**
  In `tests/pid-symbol-check-view.test.js`, one test: `verdictSentence` of each verdict in the invented sheet's result equals the `sc-detail` text `resultsHtml` shows for that row (decode `&amp;`-style entities first); `kindOf({ verdict: 'constructor' })` is `'not-checked'`; `ROW_ORDER[0]` is `'wrong-family'`.
  In `tests/pid-symbol-report-run.test.js`, seven tests, with fake `deps` (no PDF, no worker):
  1. **Three good sheets:** outcomes in the order given, all `checked`, `reason ''`, `precheck 'readable'`, carrying the fake's `result`, `viewportTransform`, `pages` and `pageSize`; `stopped` false; `onProgress` saw `{ sheet: 1, of: 3, done: null }` before `{ sheet: 1, of: 3, done: 2, total: 5 }` (the fake calls `onTags(2, 5)`); `ms` from a fake `now`.
  2. **Each reason:** `loadPdf` → `null` gives `REASONS.noPdf`; `loadPdf` throws → `noPdf`; `precheck` → `null` or throws → `precheckFailed`; status `'none'` → `notReadable('none')` and `precheck: 'none'`; status `'comments'` → `Pre-check status is Readable from comments: only a Readable sheet can be checked.`; `check` → `{ result: { ok: false, why: 'no-tags' } }` → `noTags`; `{ result: { ok: false, why: 'failed' } }`, `{ result: null }` or a throw → `failed`. Each run still reaches the next sheet.
  3. **Timed out stays checked:** a result with `ok: true, timedOut: true` is `checked`.
  4. **Stop during sheet 2 of 3:** the fake `check` sets `signal.stopped = true` on its second call and returns `{ stopped: true }`: outcome 1 `checked`, 2 and 3 `not-checked` with `REASONS.stopped`; `stopped` true; `check` was called twice.
  5. **Stop before the first:** `signal.stopped` true from the start: three `REASONS.stopped`, no dep called.
  6. **Hostile input:** `runReport(null)`, `runReport({ sheets: 'x' })` resolve to `{ outcomes: [], stopped: false }` with a numeric `ms`; a `deps` missing `check` gives `failed` for each readable sheet.
  7. **Strings:** each `exportBlocker` sentence and `''`; `tickCountText(0|1|12)`; `reachHtml({ names: ['INV-1', '<img src=x>', 'INV-3'], missing: ['INV-3'], connected: false, checkedBy: '"><b>', dropped: 1 })` contains `2 of 3 ticked sheets can be checked.`, `1 has no PDF in this session: connect the folder or re-import them.`, `1 ticked sheet is no longer in the register and was left out.`, `INV-3 (no PDF)`, `data-act="sr-run"`, and no `<img` or `<b>`; `progressHtml` both forms and `data-act="sr-stop"`; `finishedHtml({ checked: 2, notChecked: 1, seconds: 252, stopped: 2, of: 3 })` starts `Stopped by user after 2 of 3 sheets. 2 checked, 1 not checked, 4 min 12 s.`; with `seconds: 42, stopped: false` it contains `42 s.` and not `Stopped`; all three download/close buttons present.

- [ ] **Step 2: Run them to see them fail.** `node --test tests/pid-symbol-report-run.test.js tests/pid-symbol-check-view.test.js`. Expected: FAIL, module not found / `verdictSentence` not exported.

- [ ] **Step 3: Export the four names from `pid-symbol-check-view.js`** (`verdictSentence(v)` is `sentence(v, kindOf(v))`), then **write `pid-symbol-report-run.js`.** `runReport` goes sheet by sheet: check `signal.stopped` before each sheet and after each `await`; a sheet in progress when the stop lands, and every later sheet, gets `REASONS.stopped`. Each outcome's `ms` covers that sheet.

- [ ] **Step 4: Run them to see them pass.** Expected: 8 new pass. `npm test`: 828 tests, 826 passing, 0 failing, 2 skipped.

- [ ] **Step 5: Checkpoint.** Files: the two modules and two test files. Message: `feat(pid): run the symbol check over ticked sheets, for a report`.

---

### Task 2: The report model and the Excel workbook

**Files:** Create `assets/js/pid-symbol-report.js`. Test: create `tests/pid-symbol-report.test.js`.

**Interfaces:**
- Consumes: `FAMILY_NOTE`, `VERDICT_LABELS`, `kindOf`, `ROW_ORDER`, `SUMMARY_ORDER`, `verdictSentence` (Task 1); `STATUS_LABELS` from `pid-precheck.js`; the `runReport` return value and `Outcome` (Task 1).
- Produces:
  - `SHORT_NOTE = 'It checks the family of symbol, not which member of it.'`, `TIMED_OUT = 'The check stopped at its time limit. Tags it did not reach are marked Not checked.'`, `FALLBACK = 'The drawing could not be copied into this report. Results are listed below; open the sheet in the tool to see the boxes.'`, `PRINT_COLOURS = { ok: '#2E7D32', 'off-size': '#E08E00', exception: '#E08E00', look: '#E08E00', 'wrong-family': '#C62828', 'not-checked': '#757575' }`.
  - `toUserRect(box, viewportTransform, margin) -> [x0, y0, x1, y1] | null`: grow `box` (viewport space, top-left origin) by `margin` each side, map its four corners through the inverse of `viewportTransform`, return min/max. `null` for a bad box or a transform with zero or non-finite determinant.
  - `buildReportModel({ run, startedAt, checkedBy, library }) -> Model`:

```
Model = {
  title: 'P&ID symbol check', startedAt: Date, when: 'YYYY-MM-DD HH:MM' (local time), checkedBy: string,
  familyNote: FAMILY_NOTE, shortNote: SHORT_NOTE,
  library: { legend: string, importedAt: string },          // 'Legend sheet 1 rev A; Legend sheet 2 rev B' or 'Legend sheets not recorded in the library.'
  run: { ticked, checked, notChecked, seconds, stoppedLine },  // stoppedLine '' or 'Stopped by user after N of M sheets.' (N = outcomes whose reason is not REASONS.stopped)
  sheets: [{ drawing, rev, family, precheckLabel, status, reason, resultText,   // resultText 'Checked' or 'Not checked: <reason>'
             counts: { ok, 'off-size', 'wrong-family', exception, look, 'not-checked' }, seconds,
             pageNote,      // '' or 'Page 1 of N only.'
             timedOutLine,  // '' or TIMED_OUT
             pageSize, key: 'drawing||rev',
             rows: [{ no, tag, fc, kind, label, detail, symbol, tagId, sizePct, score, filled, letters, closestSymbol, closestScore, userRect }] }]
}
```

    Rows only for checked sheets, ordered as the screen orders them (`ROW_ORDER`, then tag), numbered from 1. `detail` is `verdictSentence`. `symbol` is `One of: a, b` when `oneOf` has more than one name. `userRect` from `box` if valid, else `tagBox`, through `toUserRect(…, viewportTransform, 3)`, or `null`. Counts from `kindOf` over the verdicts, so they agree with the rows.
  - `fileBase(model) -> string`: one ticked sheet → `<drawing>_<rev>_SymbolCheck_<YYYY-MM-DD>`; otherwise `SymbolCheck_<N>-sheets_<YYYY-MM-DD_HHMM>`. `/ \ : * ? " < > |` and control characters become `-` (the tool's `sanitizeFilename` rule plus control characters).
  - `workbookRows(model) -> { tags: { columns, rows }, sheets: { columns, rows }, about: [[label, value]] }` with columns, exact:
    - Tags: `Drawing, Revision, No., Tag, Function code, Verdict, Symbol, Tag identifier, Size %, Score %, Filled, Letters, Closest in family, Closest score %, Detail`
    - Sheets: `Drawing, Revision, Family, Pre-check, Result, Reason, OK, OK, off size, Wrong family, Approved exception, Needs a look, Not checked, Time (s), Timed out, Pages`
    - About: `Report`, `Run`, `Checked by`, `What it checks` (FAMILY_NOTE), `Library`, `Library imported`, `Sheets ticked`, `Checked`, `Not checked`, `Stopped` (stoppedLine or `No`), `Saved` (`Nothing from this check is saved in the register.`).
  - `writeWorkbook(model, ExcelJS) -> Promise<ArrayBuffer>`: sheets `Tags`, `Sheets`, `About` in that order; header rows bold and frozen (`ySplit: 1`) with an autofilter on Tags and Sheets. Rejects nothing: on failure resolves `null`.

- [ ] **Step 1: Write the failing tests.** Seven tests. Build `run` by hand from the invented sheet: open `sheetPdfBytes()` with `readSheet` from `scripts/check-symbol-check.mjs`, run `checkSheet` with `LIBRARY` and `LOOKUPS`, and make outcomes `[checked INV-0001 C01 (that result, its viewportTransform, pages 1, pageSize [500, 400]), not-checked INV-0002 (REASONS.noPdf), not-checked INV-0003 (notReadable('none'), precheck 'none')]`, `startedAt = new Date(2026, 0, 2, 3, 4)`.
  1. **Model:** `when` `2026-01-02 03:04`; `run` `{ ticked: 3, checked: 1, notChecked: 2, stoppedLine: '' }`; `familyNote === FAMILY_NOTE`; sheet 1 counts `{ ok: 3, 'off-size': 1, 'wrong-family': 1, exception: 1, look: 1, 'not-checked': 4 }`, 11 rows numbered 1 to 11, row 1 `kind 'wrong-family'` with `detail` `Recognised as WIDGET, BARRED (tag identifier W), which does not fit G.`; sheets 2 and 3 have `rows: []` and `resultText` `Not checked: ` + their reason; `library.legend` `Legend sheet 1 rev A`.
  2. **Stopped line:** outcomes 1 checked and 2, 3 with `REASONS.stopped`, `stopped: true` → `Stopped by user after 1 of 3 sheets.`; all three stopped → `after 0 of 3`.
  3. **`toUserRect`:** `([100,100,124,112], [1,0,0,-1,0,400], 3)` → `[97,285,127,303]`; rotated `([10,20,30,40], [0,1,1,0,0,0], 0)` → `[20,10,40,30]`; offset MediaBox `([0,0,10,10], [1,0,0,-1,-100,450], 0)` → `[100,440,110,450]`; `[0,0,0,0,0,0]` transform, a 3-number box, `NaN` → `null`. Each row's `userRect` in test 1 equals `toUserRect` of its box with margin 3.
  4. **Page note and time limit:** an outcome with `pages: 3` gives `Page 1 of 3 only.`; a result with `timedOut: true` gives `TIMED_OUT`.
  5. **File names:** one ticked sheet named `INV/01:ü` rev `C01` → `INV-01-ü_C01_SymbolCheck_2026-01-02`; three sheets → `SymbolCheck_3-sheets_2026-01-02_0304`; a control character becomes `-`.
  6. **Rows and workbook:** `workbookRows` gives the exact columns above, 11 Tags rows all with Drawing `INV-0001`, 3 Sheets rows, About `What it checks` = `FAMILY_NOTE`; `writeWorkbook(model, ExcelJS)` (ExcelJS loaded as `tests/xlsx-images.test.js` loads it) gives a buffer that ExcelJS reads back with worksheet names `['Tags', 'Sheets', 'About']`, Tags `views[0]` `{ state: 'frozen', ySplit: 1 }` and an `autoFilter`.
  7. **Hostile input:** `buildReportModel(null)` and a run whose outcomes hold `null`, strings and a verdict `'constructor'` give a model without throwing (unknown verdicts counted Not checked); a tag `<b>x</b>` is kept as plain text in the model (escaping is the renderer's job); `writeWorkbook(null, ExcelJS)` resolves `null`.

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL, module not found.

- [ ] **Step 3: Write `pid-symbol-report.js`** to the interface above.

- [ ] **Step 4: Run them to see them pass.** Expected: 7 new pass. `npm test`: 835 tests, 833 passing, 0 failing, 2 skipped.

- [ ] **Step 5: Checkpoint.** Files: the module and its test. Message: `feat(pid): symbol check report model and Excel workbook`.

---

### Task 3: pdf-lib, and the PDF

**Files:** Create `assets/vendor/pdf-lib.min.js`, `assets/js/pid-symbol-report-pdf.js`, `tests/pid-symbol-report-pdf.test.js`. Modify `scripts/pdfjs-node.mjs`, `tests/fixtures/symbol-check-sheet.js`.

**Interfaces:**
- Consumes: `Model`, `PRINT_COLOURS`, `FALLBACK`, `TIMED_OUT`, `SHORT_NOTE`, `VERDICT_LABELS` (Task 2).
- Produces:
  - `loadVendoredUmd(fileName) -> module.exports` in `scripts/pdfjs-node.mjs` (the existing `loadUmd`, exported, taking a file name inside `assets/vendor/`).
  - `sheetPdfBytes({ rotate = 0, origin = [0, 0] } = {})` in the fixture: same sheet; MediaBox `[ox oy ox+500 oy+400]`, content starts `1 0 0 1 ox oy cm`, `/Rotate rotate` when not 0. Called with no argument it returns exactly the bytes it returns today.
  - `pdfSafe(s) -> string`: keeps U+0020–U+007E and U+00A0–U+00FF; tab, CR and LF become a space; every other code point becomes one `?`; non-strings become `''`.
  - `buildReportPdf(model, sources, PDFLib) -> Promise<Uint8Array|null>`: `sources` is a `Map` from a sheet's `key` (`drawing||rev`) to its PDF bytes. Never rejects; `null` only if pdf-lib itself is unusable.

Layout, decided here: A4 portrait (595.28 × 841.89 pt) for every page except drawing pages; Helvetica and Helvetica-Bold from `StandardFonts` (no font embedding); every string through `pdfSafe`.
1. **Front page(s):** title, `when`, `Checked by` if set, `familyNote` in full, library lines, run lines (with `stoppedLine` when set and any `pageNote` per sheet), then the sheet table (Drawing, Revision, Pre-check, Result, and the six counts), continued on further A4 pages as needed, then a key of the six verdicts in `PRINT_COLOURS`.
2. **Per checked sheet:** a heading page (drawing, revision, pre-check, counts, seconds, `timedOutLine`, `pageNote`, `shortNote`); then the drawing page: page 1 of the source copied with `copyPages` and added, a 1.5 pt rectangle at each row's `userRect` in its colour (`not-checked` dashed), and a small filled label carrying the row number at the rectangle's top-left corner, turned with the page's `/Rotate` so it reads upright; then the table (No., Tag, Verdict, Detail; long details wrap) on A4 pages.
3. **If the source is missing, will not load, or copying throws:** no drawing page; the heading page carries `FALLBACK`.
4. **Not-checked sheets** appear on the front page only.

If drawing on the copied page lands boxes in the wrong place because the source's content leaves the graphics state changed, wrap the copied page's existing content in save/restore (`q` … `Q`) before drawing. Test 3 below catches it.

- [ ] **Step 1: Ask the owner, and wait for a yes.** "May I download pdf-lib 1.17.1 (`pdf-lib.min.js`, about 0.5 MB, MIT licence) from `https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js` into `assets/vendor/`?" On yes, download it, print its size and SHA-256, and keep both for the Outcome section and the commit message. On no, stop and report.

- [ ] **Step 2: Write the failing tests.** Six tests, pdf-lib through `loadVendoredUmd('pdf-lib.min.js')`, reading back with `openPdf` and `pagePaths` (as `readSheet` does), text compared after joining a page's text items with spaces and collapsing whitespace.
  1. **pdf-lib loads in Node:** `typeof PDFLib.PDFDocument.create === 'function'`. `sheetPdfBytes()` with no argument is byte-for-byte what it was (compare against a copy of today's function output taken before the change).
  2. **The whole report:** the Task 2 model (one checked, two not checked) with `sources` holding INV-0001's bytes. Expected page count: front pages + 1 heading + 1 drawing + table pages (assert front 1, table 1 for 11 rows). Page 1 text contains `FAMILY_NOTE`, `INV-0002`, `PDF not available in this session` and `INV-0003`. The heading page contains `It checks the family of symbol, not which member of it.` The drawing page is 500 × 400 and its text contains `1` to `11` and the sheet's own `21-W-1001`.
  3. **Boxes land where the screen puts them:** on the report's drawing page, read through its own viewport transform, for every row with a `userRect` there is a stroked closed path whose bounding box equals that row's on-screen box (`box`, else `tagBox`) grown by 3 pt, within 0.5 pt. Repeat with sources built from `sheetPdfBytes({ rotate: 90 })` and `sheetPdfBytes({ origin: [100, 50] })` (results from `readSheet` + `checkSheet` on those bytes, so the boxes are in their own viewport space): same assertion.
  4. **Fallback:** `sources` empty, then `sources` holding `Uint8Array.from('not a pdf', c => c.charCodeAt(0))`: resolves, no drawing page (page count one less than test 2), the heading page contains `FALLBACK`, the table is still there.
  5. **Stopped before anything:** a model from three `REASONS.stopped` outcomes gives a PDF whose pages are all front pages, containing `Stopped by user after 0 of 3 sheets.`
  6. **Text the font cannot hold:** `pdfSafe('a😀b\tc€ü')` → `a?b c?ü`; `pdfSafe(null)` → `''`; a model whose tag is `21-W-€😀`, symbol `\u0001<b>` and drawing `INV/€` builds without throwing.

- [ ] **Step 3: Run them to see them fail.** Expected: FAIL, module not found / `loadVendoredUmd` not exported.

- [ ] **Step 4: Export `loadVendoredUmd`, add the fixture options, write `pid-symbol-report-pdf.js`.**

- [ ] **Step 5: Run them to see them pass.** Expected: 6 new pass. `npm test`: 841 tests, 839 passing, 0 failing, 2 skipped.

- [ ] **Step 6: Checkpoint.** Files: the vendored file, the module, the test, the fixture, the loader. Message: `feat(pid): symbol check report as a PDF with the drawings in it (vendors pdf-lib 1.17.1, sha256 <hash>)`.

---

### Task 4: Wire it into the tool

**Files:** Modify `tools-src/pid-tag-register.html` (gitignored) by anchored patch only. Create in the workspace `.superpowers/sdd/2026-11-15-pid-symbol-check-report/`: `pid-tag-register.before-report.html`, `tool-facts.mjs`, `patch.mjs`, `edits.mjs`.

**Interfaces:**
- Consumes: everything above, as `window.PidSymReport = Object.assign({}, run, report, pdf)`; from the tool: `drawings`, `families`, `expandPatterns`, `collapsedFamilies`, `renderSheetsList`, `getPdfData`, `pdfBin`, `pdfKey`, `registerDir`, `window.PidCore.pickArchiveFile`, `sanitizeFilename`, `sheetChecks`, `extractTextFromPDF`, `sheetFactsFor`, `sheetCheckFrom`, `symLib`, `FC_LOOKUP`, `pdfjsLib`, `escHtml`, `jsEsc`.
- Produces, as globals in the tool's classic script: `sheetTicks` (a `Set` of drawing names), `toggleSheetTick(name, on)`, `toggleGroupTicks(groupKey, on)`, `clearSheetTicks()`, `sheetsInListOrder() -> [{ drawing, family }]`, `updateReportBar()`, `openReportPanel()`, `startReport()`, `stopReport()`, `downloadReport(kind)` (`'pdf'|'xlsx'`), `closeReportPanel()`, `loadVendorScript(src, globalName) -> Promise<object>`.

- [ ] **Step 1: Back up and record the before-state.** Copy the tool to `pid-tag-register.before-report.html` in the workspace. Copy `patch.mjs` and `tool-facts.mjs` from `.superpowers/sdd/2026-11-15-pid-symbol-check/`, and add to `tool-facts.mjs` a block that cuts from `// SYMBOL REPORT` to `// (end of symbol report)` and prints `save-path names inside the symbol report section <n>` with the same pattern as the symbol check block. Run it as `facts-before.txt`. Expected: the baseline block in Global Constraints (no report line yet). If any value differs, stop and report.

- [ ] **Step 2: Write `edits.mjs`** (file tools, LF endings, `String.raw` as in phase 3). Anchors, each found exactly once today:

| Edit | Anchor | Change |
|---|---|---|
| bar and panel | `<div id="sheet-list"></div>` | insert before it `<div id="sheet-report-bar"></div><div id="sheet-report" role="status"></div>` |
| tick on a card | `'<div class="sheet-card-name">' + escHtml(name) + '</div>' +` | the name line starts with `<input type="checkbox" class="sheet-tick" …>` checked when `sheetTicks.has(name)`, `onclick="event.stopPropagation();toggleSheetTick('<jsEsc name>', this.checked)"`, `title="Tick for the report"` |
| tick on a family header | `'<span style="display:flex;align-items:center;gap:6px;">⊞ ' + escHtml(fam.name)` | a checkbox before `⊞`, checked when every member is ticked, `onclick="event.stopPropagation();toggleGroupTicks('fam-<jsEsc fam.id>', this.checked)"`, title `Tick all <members.length>` |
| tick on Ungrouped | `'<span style="display:flex;align-items:center;gap:6px;">Ungrouped <span` | the same with group key `ungrouped` |
| styles | `  #sheet-msg { flex: 1;` | styles for `.sheet-tick`, `#sheet-report-bar`, `#sheet-report` before it |
| module import | `  import('/assets/js/pid-symbol-check-view.js')` | before it, load the three report modules with `Promise.all`, set `window.PidSymReport`, then `updateReportBar()`; on failure `console.error('The symbol check report is unavailable.', e)` |
| glue section | `// (end of symbol check)\n` | append, after it, the section below |

  The glue section, between `// SYMBOL REPORT` and `// (end of symbol report)` (never write the words `SYMBOL CHECK` in capitals inside it; `tool-facts.mjs` cuts on them). Behaviour, using `runSymbolCheck` as the model for the worker:
  - `sheetsInListOrder()`: the order `renderSheetsList` shows, ignoring the search box: each family's members (first family to claim a drawing keeps it), then the rest as `family: ''`.
  - `toggleGroupTicks(key, on)`: ticks or unticks every member of that family (or of Ungrouped) from `sheetsInListOrder()`, whatever the search box or folded families hide; does not fold or unfold; then `renderSheetsList()` and `updateReportBar()`.
  - `updateReportBar()`: renders `tickCountText`, a **Clear ticks** link when any are ticked, and the **Export report** button, disabled with `exportBlocker({ ticked, hasLibrary: !!symLib, running })` as its title. Called by the tick handlers, the module import, the run's start and end, and `renderSymbols` (so it follows the library). That last call is the eighth edit: anchor `function renderSymbols() {\n  updateSymbolCheckButton();\n`, add `  updateReportBar();\n` after it.
  - `openReportPanel()`: drop ticks whose drawing is no longer in `drawings` (count them as `dropped`); order the rest by `sheetsInListOrder()`, each with `rev: drawings[name].revision` (the current revision); work out which have a PDF (Decision 5; reading folder names only); read `Checked by` from localStorage; show `reachHtml`.
  - `startReport()`: save `Checked by`; `signal = { stopped: false }`; call `runReport` with deps: `loadPdf` → `getPdfData(d, r)`; `precheck` → `sheetChecks[pdfKey(d, r)]` if present, else `sheetCheckFrom(await extractTextFromPDF(bytes.slice(0)), await sheetFactsFor(bytes.slice(0)), d, r)` stored into `sheetChecks`, returning `{ status, tags: result.confirmed.map(({ tag, fc }) => ({ tag, fc })) }`; `check` → open `bytes.slice(0)` with pdf.js, page 1, operator list, text content, `getViewport({ scale: 1 })`, start a fresh worker exactly as `runSymbolCheck` posts to it, resolve `{ result, viewportTransform, pages: numPages, pageSize: [width, height] }`, resolve `{ stopped: true }` if `stopReport` terminated it, and destroy the pdf.js document in a `finally`. Show `progressHtml` on each progress call. On finish, build the model with `buildReportModel({ run, startedAt, checkedBy, library: symLib })`, keep it, show `finishedHtml`, `updateReportBar()`.
  - `stopReport()`: set `signal.stopped`, terminate the report's worker (its own variable, never `symCheckWorker`).
  - `downloadReport('pdf')`: `loadVendorScript('/assets/vendor/pdf-lib.min.js', 'PDFLib')`, collect `sources` by `getPdfData` for each checked sheet, `buildReportPdf`, download as `<fileBase>.pdf` the way `exportCSV` downloads. `'xlsx'`: `loadVendorScript('/assets/vendor/exceljs.min.js', 'ExcelJS')`, `writeWorkbook`, download `<fileBase>.xlsx`. A `null` result shows `The report file could not be made.` in the panel.
  - `closeReportPanel()`: forgets the model and empties the panel (refused while running).
  - One delegated click handler for `#sheet-report [data-act]` and `#sheet-report-bar [data-act]`, as the symbol check does.
  - The on-screen **Check symbols** and opening sheets are untouched by a running report, and vice versa.

- [ ] **Step 3: Apply it.** `node .superpowers/sdd/2026-11-15-pid-symbol-check-report/patch.mjs .superpowers/sdd/2026-11-15-pid-symbol-check-report/edits.mjs`. Expected: `Applied 8 edits.` On "Nothing written", report the failing anchor and stop.

- [ ] **Step 4: Check it parses and prove what was not touched.** `node --check` on the largest classic `<script>` body (as phase 3 Task 8 Step 4); expected `SYNTAX OK`. `tool-facts.mjs` as `facts-after.txt`: the three hashes, `register.json mentions 19` and the four call counts identical to Step 1; the symbol check and pre-check lines still `0`; `save-path names inside the symbol report section 0`. `diff` the backup against the tool: every hunk is one of the eight edits. `grep -c "startReport()"` is 2 (the definition and its one caller in the click handler).

- [ ] **Step 5: Run the suite.** `npm test`: 841 tests, 839 passing, 0 failing, 2 skipped. `tests/escaping-audit.test.js` reads the tool and must still pass.

- [ ] **Step 6: Checkpoint.** Nothing tracked changed. Message if asked: `git commit --allow-empty -m "feat(pid): Export report on the Sheets tab (source in gitignored tools-src/)"`.

---

### Task 5: Verify in the browser, and hand over

**Files:** none changed. Only invented data. No session tool can set a file input; drive the tool from the console as phase 3 Task 9 did.

- [ ] **Step 1: Open the tool.** `preview_start` name `site`, then `http://localhost:5050/tools-src/pid-tag-register.html` (if 5050 is held, a throwaway static server on another port, and say so). No console errors; `typeof window.PidSymReport.runReport === 'function'`.

- [ ] **Step 2: Three invented sheets, ticks and the bar.** Import `sheetPdfBytes()` as `INV-0001.pdf`, `sheetPdfBytes({ rotate: 90 })` as `INV-0002.pdf`, and `SHEETS.printed` from `/tests/fixtures/sheet-pdf.js` as `INV-0003.pdf`, each at `C01` (as phase 3 Task 9 Step 2). Add a family with pattern `INV-0001` and `INV-0002`. Switch to Sheets. Expected: a tick box on each card and on the family and Ungrouped headers; the bar reads nothing ticked and **Export report** is disabled with `Tick one or more sheets first.` Tick the family header: `2 sheets ticked`, both cards ticked, the family still unfolded. Type `0003` in the search box and tick that card: `3 sheets ticked`. Clear the search. Title now `Load the symbol library first, on the Symbols tab.`; set `symLib = F.LIBRARY; updateReportBar();` → enabled.

- [ ] **Step 3: Run, stop, run.** Click **Export report**: the panel says `3 of 3 ticked sheets can be checked.` and lists the three names. Click **Run**, then **Stop** at once: the panel starts `Stopped by user after`. Click **Close**, **Export report**, type `A Tester` in Checked by, **Run**, and wait. Expected: `2 checked, 1 not checked`. Opening a sheet during the run did not change the result (open INV-0001 while it runs).

- [ ] **Step 4: The files.** Intercept the downloads (wrap `URL.createObjectURL` to keep the blobs), click **Download PDF** and **Download Excel**. Expected names `SymbolCheck_3-sheets_<date>_<time>.pdf` and `.xlsx`. Open the PDF blob with `pdfjsLib`: its first page text contains the family note, `A Tester`, and `INV-0003` with `Pre-check status is No readable text`; it has a 500 × 400 drawing page for INV-0001 and a 400 × 500 one for INV-0002 (rotated). If a real browser tab is available, open the PDF and take a screenshot of each drawing page showing the numbered boxes on the symbols; in the built-in pane say what you could and could not see. Read the workbook with `ExcelJS`: sheets `Tags` (22 rows), `Sheets` (3 rows), `About`.

- [ ] **Step 5: A ticked sheet that has gone (Review Focus 5).** Tick INV-0001, then remove it from the register through the tool's own delete for a drawing, then **Export report**: the panel says `1 ticked sheet is no longer in the register and was left out.` and the run covers the rest.

- [ ] **Step 6: Nothing is saved.** As phase 3 Task 9 Step 6: connect the browser's private file system, import the invented sheet, wait for the save, note `register.json`'s `savedAt` and length and the folder's entries; load the library, tick, run, download both; wait five seconds; expected `savedAt`, length and entries unchanged, `/report|SymbolCheck|verdict/.test(text)` false. Clean up and reload.

- [ ] **Step 7: Final suite and status.** `npm test`: 841 tests, 839 passing, 0 failing, 2 skipped. `git status --short` lists only the files in the File structure table and this plan. Search them for anything from a real drawing or the legend; expected none.

- [ ] **Step 8: Write this plan's Outcome section**: every step that did not behave as written and what happened instead; pdf-lib's size and SHA-256; that the report has been made only from invented sheets; that time and file size on a real pack are unmeasured.

- [ ] **Step 9: The owner's part.** Give him these as written.

  **A. A real pack, on the laptop, nothing saved.**
  1. With the preview running, open `http://localhost:5050/tools-src/pid-tag-register.html`. Do not click **Connect folder**.
  2. Click **Symbols**, **Import legend**, choose `legend-sheets.pdf` from `pid-symbol-spike`, click **Use this library**.
  3. Click **Register** and drop in three to five real P&ID PDFs (for example the two in Downloads). Click **↓ Import all**.
  4. Click **Sheets**, tick the sheets, click **Export report**, then **Run**. Note how long it takes.
  5. Click **Download PDF** and **Download Excel**. Open the PDF.
  6. Tell me: the time, the PDF's size, whether every drawing page is there, and, zoomed in on three numbered boxes per sheet, whether each box sits on its symbol and its number matches the table.

  **B. Going live.** When A is right:
  1. In a terminal in `harveydeason-site`, run `node scripts/lock-tools.mjs` and type your workshop code.
  2. Tell me to commit and push. The commit must carry `tools/`, the three new `assets/js/` files, the changed `pid-symbol-check-view.js` and `assets/vendor/pdf-lib.min.js`, or the live tool will not find them.

  **C. On your work computer, after it is live.**
  1. Open the P&ID Tag Register and click **Connect folder**.
  2. On **Sheets**, tick a whole family with its header box, click **Export report**, then **Run**.
  3. Tell me how many sheets, the time, and whether any were listed as not checked and why.

---

## Outcome

Executed 2026-11-15 in one session (native execution), then one review of the whole change by a Sonnet reviewer, then one fix pass. Nothing committed: the owner has not asked. The full record is in the gitignored ledger `.superpowers/sdd/2026-11-15-pid-symbol-check-report/progress.md`.

**Tests.** `npm test`: 841 tests, 839 passing, 0 failing, 2 skipped, as planned after every task (828, 835, 841, 841, 841). The review fixes added assertions to existing tests, not new tests, so the count stayed 841.

**pdf-lib.** 1.17.1, downloaded with the owner's OK from `https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js`: 525,099 bytes, SHA-256 `0f9a5cad07941f0826586c94e089d89b918c46e5c17cf2d5a3c6f666e3bc694f`.

**What did not behave as written.**
1. Task 3 Step 5: all six PDF tests passed the first time they ran against the new module. To prove the box test can fail, the boxes were shifted by 2 pt: test 3 failed. The shift was then undone.
2. Task 3, the `cm` line: the fixture writes `1 0 0 1 ox oy cm` only when the origin is not `[0, 0]`. The plan asked for that line, and also for byte-identical output with no options; the second requirement won. The output with no options is 2,525 bytes with the same SHA-256 as before (`564f10e4…`).
3. Task 3, save/restore: no explicit wrap was needed. pdf-lib 1.17.1 already wraps a copied page's content in save/restore. The offset-origin test, whose content leaves the position shifted, passes.
4. Task 4: the tick boxes are made by two small glue functions (`sheetTickBox`, `groupTickBox`) called from the anchored lines. They are not written inline. Their click handlers use `escAttr(jsEsc(...))`. A family header's box and its "Tick all n" title count the whole family, including sheets hidden by the search box.
5. Task 5 Step 1: `preview_start` with `site` failed because port 5050 was already held. The server already running on 5050 was serving this repository with the new files, so the tool was opened there.
6. Task 5 Step 6: the first save of `register.json` took longer than the 3 s the step allows (about 7 s). After a run, both downloads and 5 s more, `register.json` was byte-identical: `savedAt` unchanged, 4,440 bytes. The folder held the same three entries, and `/report|SymbolCheck|verdict/` was false. The run read the PDF from `archive/`.
7. Review fixes (each test failed first, then passed):
   - **Stop could miss a click.** Every progress message rebuilt the Stop button. Now only the words change: a new `progressText` in the module, and a one-edit patch to the tool. In the browser, one Stop element lasted through 17 progress updates.
   - **An empty report.** If every ticked sheet had left the register, the panel still offered Run, which made an empty report. Now it says `No ticked sheets are left to check.` and offers only Cancel. This replaces the plan's `0 of 0 ticked sheets can be checked.` for that case.
   - **Headers broken mid-word.** The front-page count headers broke inside words ("Approv ed excepti on"). The count columns were widened.

**Browser, Task 5 Steps 2 to 7, on invented sheets only**, every expected value as written:
- The run checked two sheets and left one not checked, in 0.7 s.
- The PDF has 7 pages: a 500 × 400 drawing page, and a 400 × 500 one with `/Rotate 90`.
- The workbook has Tags 22, Sheets 3, and About.
- Both drawing pages were drawn with pdf.js and seen. The boxes sit on the symbols. The numbers read upright at each box's top-left corner on the rotated page.
- A ticked sheet deleted before Export is dropped with the Decision 3 sentence.

**Not measured.**
- The report has been made only from invented sheets.
- Time, PDF size and memory on a real pack are unmeasured, as is whether pdf-lib copies real drawings.
- Rotations of 180° and 270° are not in the box test.

**Deferred (minor, from the review).**
- A large pack's PDF is built on the page's thread, with each drawing held twice while it is built.
- The row sort is written in two places, so the row numbers match the screen only while both stay equal.
- Workbook cells keep U+FFFE and U+FFFF. A PDF carrying one could give an `.xlsx` that Excel will not open (unverified).
- The tool's `extractTextFromPDF` never closes its pdf.js document. This is unchanged and locked by its hash, so a run that pre-checks many sheets afresh keeps them open until reload, as opening sheets already does.
