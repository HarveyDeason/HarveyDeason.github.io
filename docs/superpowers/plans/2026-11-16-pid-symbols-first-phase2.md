# P&ID symbol check, symbols first: phase 2 (printed sheets) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A printed sheet (letters drawn as shapes, no text, no comments) is swept for standard symbols like any other sheet, with its letters spotted and kept out of the linework. Very plain shapes (a box, an arrow) are listed only when the drawing round them says they stand alone. The pre-check tells a printed sheet from a scanned image.

**Architecture:** The pre-check counts a textless page's paths and image cover, and splits "No readable text" into `printed` and `scanned`. A new reader in `pid-sheet-read.js` spots letter-like clusters (filled glyphs, or clusters of short strokes) lying in rows and removes their paths. No letter is read. The worker uses it for `words: 'printed'`. In `pid-symbol-check.js` the sweep holds hits of plain library symbols to a stricter backward score and drops them when one of their edges runs on past a corner. The tag-led check is untouched, so no tag verdict on a Readable sheet can change. View, report runner, report and tool glue let printed sheets through. Their tags read "not read yet".

**Tech Stack:** Vanilla ES modules, no build; `node --test`; pdf.js 3.11.174 (vendored); ExcelJS and pdf-lib already vendored. Gate tooling only: the PyMuPDF already on this machine (not a repo dependency).

**Spec:** `docs/superpowers/specs/2026-11-16-pid-every-pdf-format-design.md` (approved 2026-11-16). Read *The sweep* step 5, *Readers*, *The format test bench*, the *Roadmap* row for phase 2 and *Phase 2: printed sheets* before starting. Phase 1's plan and **Outcome** (`2026-11-16-pid-symbols-first-phase1.md`) say what is already built.

## Global Constraints

- **Nothing writes `register.json` or the register folder.** No new code or glue calls `saveToFolder`, `scheduleSave`, `mergeState`, `buildRegisterState`, `snapshotRev`, `createWritable` or `saveLibraryFile`. The letter library (`letter-library.json`) is phase 5, not this phase. Nothing writes it.
- **The repository is public.** No client data (drawing numbers, real tags, legend names or geometry, firm names, letter shapes from a real sheet) in `assets/js/`, `scripts/`, `docs/`, `tests/` or fixtures. Tests use invented symbols, invented letter shapes (plain polygons and strokes) and tags like `21-W-1001`.
- **Real sheets stay out of git:** `C:\Users\deaso\Downloads\` and `../pid-symbol-spike/`. Gate output, printed copies and symbol lists go only in `../pid-symbol-spike/every-format-gate/`. The sheets are named only in that folder's `README.txt` (letters A, B, C, M, supplier) and the new names P1, P2, A-printed, B-printed, C-printed and scan.
- **No new dependency. No OCR library. No font file.** No letter is read in this phase.
- **`tools-src/` is gitignored.** Tool edits are anchored patches after a backup in `.superpowers/sdd/2026-11-16-pid-symbols-first-phase2/` (gitignored). Never run `scripts/lock-tools.mjs`; the owner does.
- **Do not commit unless the owner asks.** Each task's last step is a checkpoint: run the tests, and stage nothing.
- **The check still confirms the family, not the member.** `FAMILY_NOTE` and `SHORT_NOTE` are unchanged.
- **The tag-led check is unchanged.** Letter spotting runs only for `words: 'printed'`. Plain-shape care applies to sweep hits only. On every existing fixture, `checkSheet` verdicts with and without the sweep stay deep-equal.
- **Every new function degrades on hostile input** (never throws), as `pid-symbol-check.js` and `pid-sheet-read.js` do today.
- **Values pinned by the spec or phase 1:** recognise `0.90`; `oneOf` `0.03`; `radius` `60`; `sweepStep` `80`; `shareInk` `0.5`; `LETTER_MAX` `15` pt; time limit `120000` ms; gate time under `60` s a sheet; scanned = images cover at least `90%` of the page. **Starting values, tuned only at the gate (Task 7) and recorded in the Outcome:** `plainBack: 0.97` (the spec's example); glyph height at least `1.5` pt; at least `3` glyphs to a row; glyph heights within `25%`; baseline within `20%` of the height; gap at most `1.5` heights; strokes joined into one glyph within `0.5` pt; printed = at least `200` paths with no text; continuation probes at `1.5`, `2.5`, `3.5` pt past a corner.

## Review Focus

1. **Symbol ink taken for letters.** A filled valve (two filled triangles meeting at a point), a row of junction dots, or a dashed line must not be removed as letters when doing so would take a symbol's own linework. Expected: a filled WIDGET survives spotting and is still found by the sweep; two glyph-like shapes never make a row. Tests in Task 3.
2. **A plain symbol where it truly belongs.** A plain box with a pipe meeting the middle of a side, or a T-shaped plain symbol at a pipe's end with the pipe running on from its stem, is kept. Only an edge running on past a *corner* drops a hit. Tests in Task 4.
3. **Facts without the new counts.** A pre-check made without `OPS` (an older caller, or the operator list failed) has no ink facts. Expected: status `none` as today, never a guessed `printed`. A page with text is never read for ink. Tests in Task 2.
4. **A Readable or comment sheet.** Expected: no letter spotting, and every tag verdict as in phase 1. Tests in Tasks 4 and 5, and the gate in Task 7 against phase 1's after files.
5. **A big printed sheet.** 17,000 paths (P2) must spot in well under the time limit, and a hostile page size must not build a huge grid. Expected: 20,000 invented strokes spotted in under 2 s in node; `pageSize: [1e7, 1e7]` returns at once. Tests in Tasks 3 and 4.

---

## File map

| File | Change |
|---|---|
| `scripts/check-symbol-check.mjs` | `--symbols-out`, `--compare`, `matchSymbolLists`, format line (Task 1); `--words printed`, spotting counts (Task 7). |
| `scripts/check-sheet-prechecks.mjs` | passes `OPS` to `readSheetFacts`, prints path count and image cover. |
| `assets/js/pid-sheet-read.js` | `pageInkFacts`; letter spotting: `glyphsOf`, `letterRows`, `spotLetters`, `removeSpottedLetters`. |
| `assets/js/pid-precheck.js` | `printed` and `scanned` statuses, `readSheetFacts(doc, { OPS })`, findings, `importSummary`. |
| `assets/js/pid-symbol-check.js` | `plainShape`, `runsOnPastCorner`, plain care in `sweep`; `SymbolOut.plain`; grid edge and grid cap. |
| `assets/js/pid-symbol-check-worker.js` | `words: 'printed'`; `result.words`, `result.letters`. |
| `assets/js/pid-symbol-check-view.js` | `blockerText`, printed tag line, letters line, plain-shape cue; dead `no-tags` branch gone. |
| `assets/js/pid-symbol-report-run.js` | `printed` runs; `scanned` and `none` reasons; dead `noTags` gone. |
| `assets/js/pid-symbol-report.js`, `assets/js/pid-symbol-report-pdf.js` | printed tag line; Symbols sheet `Note` column; PDF "No tags read." |
| `tests/fixtures/sheet-pdf.js` | page `strokes` and `image` options. |
| `tests/fixtures/symbol-check-sheet.js` | `glyphRow`, `strokeGlyphRow`, `PLATE`, `STUB`, `PLAIN_LIBRARY`, `PRINTED_SHEET`. |
| `tests/*.test.js` | new tests per task. |
| `tools-src/pid-tag-register.html` | glue only, anchored patch (gitignored). |

---

### Task 1: Gate tooling, the baseline, and the printed copies

**Files:**
- Modify: `scripts/check-symbol-check.mjs`
- Test: `tests/check-symbol-check.test.js`
- Private: `../pid-symbol-spike/every-format-gate/` (README, baseline files, printed copies)

**Interfaces:**
- Produces:
  - `matchSymbolLists(truth, found, { tol = 3, search = 20 } = {}) -> { matched, missing: Sym[], extra: Sym[], offset: [dx, dy] }`. `Sym = { name, oneOf: string[], box }`. Two symbols are **the same** when the name of one is the other's name or in its `oneOf`, and their centres lie within `tol` pt once `offset` is taken off. `offset` is the median `dx` and the median `dy` of each truth symbol's nearest same-named found symbol within `search` pt, or `[0, 0]` with fewer than 3 such pairs. Pairing is greedy, nearest first, and each symbol is used once. Rubbish in gives `{ matched: 0, missing: [], extra: [], offset: [0, 0] }`.
  - `--symbols-out <file>` writes `{ sheet: '<basename>', symbols: Sym[] }` as JSON. It refuses (fails, writes nothing) when the resolved path lies inside the repository. The file holds legend names, so it may only go in the private folder.
  - `--compare <file>` reads such a file and prints `  compared with <basename>: matched N of T, missing K, extra E, offset dx, dy`. With `--verbose` only, it also prints each missing and extra symbol's name and box.
  - A format line, always: `  format: text items X, comments Y, paths Z`.

- [ ] **Step 1: Write the failing tests** for `matchSymbolLists`, invented names only:
  - identical lists → `matched` = length, nothing missing or extra;
  - the found list shifted by (2.5, -1.5) pt → all matched, `offset` ≈ `[2.5, -1.5]` (within 0.01);
  - a found symbol named only in a truth symbol's `oneOf` → matched;
  - same name but 6 pt off with no shift → one missing, one extra;
  - two truth symbols near one found symbol → one matched, one missing;
  - `null`, `[{}]`, NaN boxes → the empty result, no throw.
  - `--symbols-out` with a path under the repo root → exit code 1 and no file written (run `main` through the existing test harness the file already uses, or test the guard function `insideRepo(path)` directly).
- [ ] **Step 2: Run to see them fail.** `node --test tests/check-symbol-check.test.js` → FAIL, `matchSymbolLists` not exported.
- [ ] **Step 3: Implement** `matchSymbolLists`, `insideRepo`, the two flags and the format line. Count `paths` from `sheet.paths.length` before any letter removal, so `readSheet` returns `pathCount` as well.
- [ ] **Step 4: Run to see them pass.** `npm test` → green.
- [ ] **Step 5: The phase 1 baseline, before any module change.** Add to `../pid-symbol-spike/every-format-gate/README.txt`: P1 and P2 (the two printed contractor sheets in `Downloads`, named in the survey notes), and "scan" (the scanned document in the survey). Then, for A, B, C, M (with `--words comments --instrument "PE,PIT"`) and the supplier sheet (`--words comments`), run the script with today's arguments plus `--verbose --symbols-out ../pid-symbol-spike/every-format-gate/<letter>-p1.json`. Save the terminal output as `<letter>-p2-before.txt`. Expected: the counts equal phase 1's Outcome (C: 102 symbols, 67 with tags; A 12; B 18; M 45; supplier 3).
- [ ] **Step 6: The printed copies (stand-ins, owner's choice 2026-11-17).** For A, B and C, make an outline copy `A-printed.pdf`, `B-printed.pdf`, `C-printed.pdf` with a private Python script in the folder, `outline-copy.py`, run with `python -I`. It does `page.get_svg_image(text_as_path=True)` then `fitz.open("svg", …).convert_to_pdf()`. A probe on 2026-11-16 found this keeps the A1 size, leaves 0 text characters, and gives about 2,800 more paths on sheet C. Run the gate script on each copy with `--words text` and read the format line. **A copy is usable only if it shows `text items 0, comments 0` and a page size equal to the original's.** Write in the README, and later in the Outcome, that these are stand-ins for a Microsoft Print to PDF copy, not the printer's own output.
- [ ] **Step 7: Checkpoint.** `npm test` green. Nothing staged.

---

### Task 2: Printed and scanned statuses (`pageInkFacts`, `sheetStatus`)

**Files:**
- Modify: `assets/js/pid-sheet-read.js`, `assets/js/pid-precheck.js`, `scripts/check-sheet-prechecks.mjs`, `tests/fixtures/sheet-pdf.js`
- Test: `tests/pid-sheet-read.test.js`, `tests/pid-precheck.test.js`, `tests/check-sheet-prechecks.test.js`

**Interfaces:**
- Produces:
  - `pid-sheet-read.js`: `pageInkFacts(fnArray, argsArray, OPS, viewportTransform, pageSize) -> { pathCount, imageCover }`. `pathCount` is the number of `OPS.constructPath` operators. `imageCover` is the sum, capped at 1, of each image's area over the page area. Image operators are `paintImageXObject`, `paintInlineImageXObject`, `paintImageMaskXObject`, `paintImageXObjectRepeat`, `paintInlineImageXObjectGroup` and `paintImageMaskXObjectGroup`, whichever `OPS` defines. An image's area is the unit square through the current transform (`save`, `restore`, `transform`, `paintFormXObjectBegin` and `End` tracked as `pagePaths` does), clipped to the page. Bad input → `{ pathCount: 0, imageCover: 0 }`.
  - `pid-precheck.js`:
    - `STATUS_LABELS` gains `printed: 'Printed: letters drawn as shapes'` and `scanned: 'Scanned image'`. `none` stays, label unchanged, for a textless page that is neither.
    - `export const PRINTED_MIN_PATHS = 200, SCAN_COVER = 0.9;`
    - `sheetStatus(counts)`: as today while there is text or a comment. Otherwise, with `counts.pathCount` and `counts.imageCover` numbers: `imageCover >= SCAN_COVER && pathCount < PRINTED_MIN_PATHS` → `'scanned'`; `pathCount >= PRINTED_MIN_PATHS` → `'printed'`; else `'none'`. Missing counts → `'none'`.
    - `readSheetFacts(doc, options)`: with `options.OPS`, a page with no text items and no comments also gets `ink: pageInkFacts(...)` from `page.getOperatorList()`. If that fails, `ink` is left out. Pages with text or comments never fetch the operator list. Without `OPS`, the output is exactly today's.
    - `assessSheet` sums `ink.pathCount` over pages and takes the smallest `ink.imageCover` (every page must be covered for `scanned`), and passes both to `sheetStatus`. Without ink on any page: `'none'`.
    - `sheetFindings`: `printed` → `'Printed: letters are drawn as shapes, so tags cannot be read yet. Symbols can still be checked.'`; `scanned` → `'Scanned image: tags and symbols cannot be read yet.'`; `none` as today.
    - `importSummary`: `printed`, `scanned` and `none` all count as "no readable text", wording unchanged.
  - Fixture: `sheetPdf` page spec gains `strokes: n` (n short 3 pt lines, laid out on a grid, each its own `m l S`) and `image: true` (a 1 × 1 grey image XObject drawn over the whole page with `W 0 0 H 0 0 cm /Im1 Do`).
  - `check-sheet-prechecks.mjs` passes `{ OPS }` from the vendored pdf.js and prints `paths N, image cover P%` on lines for textless sheets.

- [ ] **Step 1: Write the failing tests.**
  - `pageInkFacts` on `opList` steps (the existing `tests/fixtures/symbol-ops.js`): 3 `constructPath` → `pathCount 3`. One image under a transform scaling the unit square to the whole page → `imageCover 1`. Two quarter-page images → `0.5`. An image under `save`/`transform`/`restore` followed by one with no transform → only the first counts as large. Hostile input → zeros.
  - `sheetStatus`: `{ textItemCount: 0, commentCount: 0, pathCount: 13000, imageCover: 0 }` → `printed`; `{ pathCount: 0, imageCover: 1 }` → `scanned`; `{ pathCount: 5, imageCover: 0.2 }` → `none`; `{}` → `none`; text or comments present → today's answers whatever the ink counts.
  - `readSheetFacts(doc, { OPS })` on `sheetPdf({ pages: [{ size: [600, 400], strokes: 250 }] })` → page `ink.pathCount >= 250`. With `image: true` → `ink.imageCover >= 0.99`. On `SHEETS.plotted` the output deep-equals today's (no `ink` on text pages). Without `OPS` → today's output for the printed page.
  - `assessSheet` → `status 'printed'` and `'scanned'` from those facts. Its chip reads `Printed: letters drawn as shapes` with class `pc-printed`. Its findings hold the new sentence. `importSummary` counts it as no readable text.
- [ ] **Step 2: Run to see them fail.** `node --test tests/pid-sheet-read.test.js tests/pid-precheck.test.js` → FAIL.
- [ ] **Step 3: Implement** the above. `pid-precheck.js` imports `pageInkFacts` from `./pid-sheet-read.js` (both pure).
- [ ] **Step 4: Run to see them pass;** `npm test` green, including every existing pre-check test unchanged.
- [ ] **Step 5: Run the pre-check script on the survey sheets** (private output, counts only): P1 and P2 → `Printed: letters drawn as shapes`; scan → `Scanned image`; A, B, C → `Readable`; M and supplier → `Readable from comments`.
- [ ] **Step 6: Checkpoint.**

---

### Task 3: Letter spotting (`pid-sheet-read.js`)

**Files:**
- Modify: `assets/js/pid-sheet-read.js`, `tests/fixtures/symbol-check-sheet.js`
- Test: `tests/pid-sheet-read.test.js`

**Interfaces:**
- Produces (all in page points, top-left origin, as `pagePaths` gives):
  - `export const GLYPH_MIN = 1.5, ROW_MIN = 3, STROKE_JOIN = 0.5;`
  - `glyphsOf(paths) -> Glyph[]`, `Glyph = { box, members: number[], kind: 'filled' | 'stroked' }`. **Filled:** each path with `filled === true` whose box has a longer side at most `LETTER_MAX` and at least `GLYPH_MIN`. **Stroked:** unfilled paths whose longer side is at most `LETTER_MAX` are joined, through a grid hash, wherever their boxes come within `STROKE_JOIN` of each other. A joined cluster whose box fits the same size rule is a glyph. `members` are indices into `paths`.
  - `letterRows(glyphs) -> Row[]`, `Row = { box, members: number[] (glyph indices), vertical: boolean }`. Glyphs of one kind join a horizontal row when their heights agree within 25%, their bottoms within 20% of the height, and the gap to the next glyph is between `-0.1` and `1.5` heights. A vertical row is the same with x and y swapped. A row needs `ROW_MIN` glyphs. A glyph belongs to at most one row; horizontal rows are tried first.
  - `spotLetters(paths) -> { members: number[] (path indices, ascending), glyphs, rows }`.
  - `removeSpottedLetters(paths) -> { paths, removed, rows }`. Kept paths stay in their order.
- Fixture additions (invented shapes, not a font): `glyphRow(x, y, n, { h = 7, gap = 1.5, vertical = false, filled = true })`. Each glyph is an invented filled polygon 0.6·h wide, a notched rectangle, so no two glyphs are boxes. `strokeGlyphRow(...)` does the same with each glyph as 2 or 3 short open strokes that touch each other.

- [ ] **Step 1: Write the failing tests.**
  - A filled row of 5 at 7 pt → `rows 1`, all 5 paths in `members`. The same row vertical → `rows 1`, `vertical: true`.
  - A stroked row of 4 (each glyph 3 strokes) → 12 paths removed, `rows 1`.
  - Two filled glyphs alone → nothing spotted (`ROW_MIN`).
  - **Symbol ink kept:** `place(WIDGET, { fill: true })` (two filled triangles meeting at a point) beside a row of 5 glyphs → the WIDGET's paths are not in `members`, and `sweepSymbols` on the result still finds the WIDGET. A row of 6 filled 1.5 pt junction dots 40 pt apart → nothing spotted. A horizontal dashed line (3 pt dashes, 0 height) → nothing.
  - Mixed heights: a 7 pt row with a 12 pt glyph in it → the 12 pt glyph is not in the row.
  - A 16 pt stroke inside a row's box → kept.
  - **Speed:** 20,000 invented short strokes in 2,000 rows → finishes in under 2 s (`performance.now()` around the call).
  - Hostile: `null`, paths with NaN segs, `segs` of odd length → `{ members: [], glyphs: 0, rows: 0 }` and `removeSpottedLetters` returns the input paths unchanged, never a throw.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** Grid-hash the boxes (cell = `LETTER_MAX`) for both the stroke join and the row neighbours, so the cost grows with the number of paths, not its square. Header comment: no letter is read here; a row is "letter-like", nothing more.
- [ ] **Step 4: Run to see them pass;** `npm test` green.
- [ ] **Step 5: Checkpoint.**

---

### Task 4: Plain shapes, and the sweep's edges (`pid-symbol-check.js`)

**Files:**
- Modify: `assets/js/pid-symbol-check.js`, `tests/fixtures/symbol-check-sheet.js`
- Test: `tests/pid-symbol-check.test.js`

**Interfaces:**
- Consumes: `prepareSymbols`, `windowFrom`, `scorePlacement` (its `backward`), `placePoint`, `sweep` (phase 1).
- Produces:
  - `CHECK_DEFAULTS` gains `plainBack: 0.97`.
  - `plainShape(prepared) -> boolean`: checkable, not a bubble, and either every segment is axis-aligned in the symbol's own frame (the shorter of `|dx|`, `|dy|` at most 2% of its length), or the symbol has at most 3 straight pieces once consecutive collinear segments are joined. Today's `simple` exclusion is unchanged and comes first: plain care adds to it and never replaces it.
  - `runsOnPastCorner(hit, ink, options) -> boolean`. A **corner** is a placed segment end shared (within 0.5 pt) with another of the symbol's segments at more than 30° to it. For each corner and each segment ending there, test the points `1.5`, `2.5` and `3.5` pt past the end along that segment's direction on the window's undilated `ink`. True when 2 of the 3 are ink, at any corner.
  - In `sweep`: a hit whose symbol is `plainShape` is kept only if `scorePlacement`'s `backward >= plainBack` and `!runsOnPastCorner(hit, win.ink, cfg)`. The tag-led passes and the bubble pass are untouched.
  - `SymbolOut` gains `plain: boolean` (the winner's symbol is `plainShape`).
  - **Grid edge** (phase 1 deferred minor): when the last grid centre is more than `sweepStep / 2` from the far edge, one more centre is added at `W - sweepStep / 2` (and the same for `H`).
  - **Grid cap** (phase 1 deferred minor): `const MAX_SWEEP_SIDE = 14400` (the largest PDF page, in points). A larger side means no sweep: `{ spots: [], skipped: null, timedOut: false, rows: 0 }`.
  - Fixture: `PLATE = sym('s11', 'PLATE', 'PLATES', 'L', 30, 15, [loop of its box, line([0, 7.5, 30, 7.5])])` (axis-aligned, 5 segments: plain). `STUB = sym('s12', 'STUB', 'STUBS', 'U', 10, 12, [line([0, 0, 0, 12]), line([0, 6, 10, 6])])` (a T: a bar, and a stem out to its right). `PLAIN_LIBRARY = { ...SWEEP_LIBRARY, symbols: [...SWEEP_LIBRARY.symbols, PLATE, STUB] }`.

- [ ] **Step 1: Write the failing tests.**
  - `plainShape`: PLATE, STUB → true; WIDGET, GADGET, SIGNAL → false; a bubble → false; a `simple`-excluded symbol → false (not checkable).
  - Sweep on invented sheets with `PLAIN_LIBRARY`:
    - a lone PLATE → found once, `plain: true`;
    - a PLATE with a pipe meeting the middle of its left side → found;
    - two PLATE outlines stacked, sharing their long edge, with their sides running on → neither found;
    - a PLATE whose top edge runs on 20 pt past its right corner → not found;
    - a STUB at a pipe's end, the pipe running on from its stem's free end → found;
    - a PLATE with a stray 6 pt stroke inside its box (backward about 0.95, under 0.97) → not found;
    - a WIDGET with pipes on both sides → found (not plain, untouched).
  - **Goal 5 holds:** a tag-led PLATE tag whose PLATE stands in a panel reads exactly as with `options: { sweep: false }` (verdicts deep-equal). The existing deep-equal tests on `SHEET` and `BUBBLE_SHEET` still pass.
  - Grid edge: on a 620 × 400 sheet, a WIDGET with its centre 12 pt from the right edge (no title-block line) is found. Before the change it is not.
  - Grid cap: `sweepSymbols({ pageSize: [1e7, 1e7], ... })` returns `rows: 0` in under 50 ms.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** Keep `scorePlacement`'s return unchanged; read `backward` from it. Work out `plainShape` once per prepared symbol (store it as `p.plain` in `prepareOne`).
- [ ] **Step 4: Run to see them pass;** `npm test` green, every earlier check test unchanged.
- [ ] **Step 5: Checkpoint.**

---

### Task 5: Worker and screen

**Files:**
- Modify: `assets/js/pid-symbol-check-worker.js`, `assets/js/pid-symbol-check-view.js`
- Test: `tests/pid-symbol-check-view.test.js`

**Interfaces:**
- Consumes: `removeSpottedLetters` (Task 3); `SymbolOut.plain` (Task 4).
- Produces:
  - Worker: `words: 'printed'` → `const s = removeSpottedLetters(paths); paths = s.paths; textItems = [];`. The posted result gains `words: d.words === 'printed' || d.words === 'comments' ? d.words : 'text'` and, for printed, `letters: { removed: s.removed, rows: s.rows }`. `'comments'` and `'text'` behave exactly as now.
  - `blockerText`: `printed` may be checked. `scanned` → `This is a scanned image: scanned sheets cannot be checked yet.` `none` → `This sheet has no readable text and no linework to check.` The unknown-status sentence becomes `Only a Readable, Readable from comments or Printed sheet can be checked.`
  - `resultsHtml`: when `result.words === 'printed'`, the summary reads `Tags not read yet: on a printed sheet the letters are drawn as shapes.` in place of `No tags read.`, and a line `N letters spotted in R rows and left out of the linework.` follows from `result.letters`. An untagged row whose symbol has `plain: true` adds ` <span class="sc-detail">(plain shape: check by eye)</span>`. Its box title adds ` Plain shape: check by eye.`
  - Dead code removed (phase 1 deferred minor): the `why === 'no-tags'` branch in `resultsHtml`.
- [ ] **Step 1: Write the failing tests:** the three `blockerText` sentences, with `printed` allowed. A printed result with `letters: { removed: 120, rows: 9 }` and no verdicts contains both new lines and not `No tags read.`. A text result still contains `No tags read.`. A plain untagged symbol's row carries the cue and an untagged non-plain one does not. The cue's symbol name `<img src=x onerror=alert(1)>` is escaped. `boxRects` titles carry the plain note. The worker has no node test; Task 8 covers it in the browser.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to see them pass;** `npm test` green.
- [ ] **Step 5: Checkpoint.**

---

### Task 6: Report runner, Excel and PDF

**Files:**
- Modify: `assets/js/pid-symbol-report-run.js`, `assets/js/pid-symbol-report.js`, `assets/js/pid-symbol-report-pdf.js`
- Test: `tests/pid-symbol-report-run.test.js`, `tests/pid-symbol-report.test.js`, `tests/pid-symbol-report-pdf.test.js`

**Interfaces:**
- Produces:
  - `runReport`: `printed` runs like `readable`, with `status` passed to `deps.check` as now. `scanned` is not checked, reason `Scanned image: not checked yet.`; `none` gives `notReadable('none')`. `notReadable(status)` reads `'Pre-check status is ' + label + ': this sheet cannot be checked.'`. `REASONS.noTags` and its use go (deferred minor).
  - Report model `sheetFor`: `tagsLine` is `'Tags not read yet: letters drawn as shapes.'` when `precheck === 'printed'`, `'No tags read.'` when a checked sheet has no verdicts, else `''`. `allSymbols` entries gain `plain`.
  - `workbookRows.symbols.columns` gains `'Note'` at the end; its value is `'Plain shape: check by eye'` or `''`.
  - PDF: the heading page prints `tagsLine` where it printed `No tags.` (deferred minor: the screen and the PDF now agree).
- [ ] **Step 1: Write the failing tests:** a `printed` sheet reaches `deps.check` with `status === 'printed'` and is Checked with no verdicts. `scanned` gives `Scanned image: not checked yet.` and `none` the new sentence. The model's `tagsLine` covers all three cases. The workbook's Symbols columns end with `Note` and a plain row says so. The PDF heading page of a printed sheet contains `Tags not read yet` and no page contains `No tags.`.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to see them pass;** `npm test` green.
- [ ] **Step 5: Checkpoint.**

---

### Task 7: The phase 2 gate

**Files:**
- Modify: `scripts/check-symbol-check.mjs`

**Interfaces:**
- Consumes: `removeSpottedLetters` (Task 3), Task 1's flags.
- Produces: `--words printed` reads as the worker does (spotted letters removed, no words, no tags) and prints `  letters spotted: N paths in R rows`. With `--verbose` only, each untagged symbol line gains `plain` when `plain` is true.

- [ ] **Step 1: Implement** `--words printed` and the two outputs. `npm test` green.
- [ ] **Step 2: Run the gate.** Save every output as `<name>-p2-after.txt` and every symbol list as `<name>-p2.json` in the private folder.
  - **Printed copies:** `A-printed`, `B-printed`, `C-printed` with `--words printed --compare <letter>-p1.json --verbose`.
  - **P1, P2:** `--words printed --verbose --symbols-out …`.
  - **A, B, C** (as in Task 1), **M** (`--words comments --instrument "PE,PIT"`), **supplier** (`--words comments`), each with `--compare <letter>-p1.json`.
  - **Relabel:** C with `--relabel 10:P`.
  - **M as a single-line-letter sheet:** M with `--words printed --compare M-p1.json`. The printed reader ignores comments and text, so this is the spec's "sheet M with comments deleted". It is not a gate line; record its numbers.
- [ ] **Step 3: Make contact sheets** (PyMuPDF, private folder, as phase 1 did) of every symbol listed on P1 and P2, every *extra* symbol on the printed copies, and every *missing* symbol on A, B, C, M and the supplier sheet.
- [ ] **Step 4: Judge against the spec's phase 2 gate**, and write the numbers (counts only: no tags, no names, no drawing numbers) into the **Outcome** section below:
  - **Printed copies (the spec's gate):** for each of A, B, C, at least 95% of the original's phase 1 symbols matched. False hits (extras judged false by eye; an extra that is a real symbol the original missed is not false) at most 1 per 20 found. Under 60 s each.
  - **P1 and P2 (the spec's gate), by eye:** no printed word and no note box listed as a symbol. Also record each sheet's total listed, real, false, and the false ones by kind (reference flags, non-standard bubbles, dashed lines). Compare with the survey: P1 had 4 false in 23, P2 7 false in 59.
  - **No harm to phase 1:** A, B, C and M: no tag verdict worse than `<letter>-p2-before.txt` (per-tag comparison), and at least 95% of each sheet's phase 1 symbols still listed. Each missing one is judged by eye and named here only by kind.
  - **Relabel:** at least 9 of 10 Wrong family; no other verdict changed.
  - **Supplier:** record how many of its 3 false plain shapes remain (not a gate line; phase 1 saw 3 of 3 false).
  - **Statuses:** Task 2 Step 5's six lines as expected.
  - **Tuning.** The starting values in *Global Constraints* may be tuned on these sheets, and every change goes in the Outcome with the before and after numbers. Changing a pinned value is not allowed. If the plain-shape rule or the spotting rule needs a different *kind* of rule (not a value), stop and report.
  - **If any gate line fails after tuning, stop and report the numbers to the owner as they are.** Do not go on to Task 8.
- [ ] **Step 5: Checkpoint.** `npm test` green.

---

### Task 8: Wire it into the tool, and check it in the browser

**Files:** Modify `tools-src/pid-tag-register.html` (gitignored) by anchored patch only. Backup first to `.superpowers/sdd/2026-11-16-pid-symbols-first-phase2/pid-tag-register.before.html`.

**Edits (each anchored on today's text; every anchor must match exactly once):**
1. `sheetFactsFor`: `P.readSheetFacts(pdf)` → `P.readSheetFacts(pdf, { OPS: pdfjsLib.OPS })`.
2. `runSymbolCheck`: `words: status === 'comments' ? 'comments' : 'text'` → `words: status === 'comments' || status === 'printed' ? status : 'text'`.
3. `reportCheckSheet`: the same change to its `words`.
4. Styles: `.pc-printed` as `.pc-comments` (amber); `.pc-scanned` as `.pc-none` (red).

- [ ] **Step 1: Back up and record facts.** Copy the tool to the backup path. Record its SHA-256 and the counts of `register.json`, `saveToFolder(`, `scheduleSave(` and `createWritable(`.
- [ ] **Step 2: Apply the four edits** with a small patch script in the workspace folder that refuses to write if any anchor matches other than once.
- [ ] **Step 3: Check it parses and nothing else moved.** `node --check` on the largest classic `<script>` body → `SYNTAX OK`. The four counts unchanged. `diff` against the backup: every hunk is one of the four edits.
- [ ] **Step 4: Browser, invented data only.** Add `PRINTED_SHEET` to the fixture: `SWEEP_SHEET`'s symbols plus three `glyphRow`s (one beside a WIDGET, one inside the RING bubble, one vertical), with no text. Open the tool as phase 1's Task 9 did (`preview_start` name `site`; if port 5050 is held by a server already serving this repository, use it and say so). Import `sheetPdfBytes({ sheet: PRINTED_SHEET, text: false })` as `INV-0002.pdf`. Expected: its chip reads `Printed: letters drawn as shapes`. Set `symLib = F.PLAIN_LIBRARY`, open it, and press **Check symbols**. Expected: progress `Looking for symbols: row …`; results `Tags not read yet…`, the letters line, every fixture symbol listed once, no glyph row listed as a symbol, and a jump from a row to its box. Then **Export report**, **Run**: `checked`, the Symbols sheet has a `Note` column, and the PDF heading page reads `Tags not read yet`. Also import an invented scanned PDF (`sheetPdf` with `image: true`): chip `Scanned image`, **Check symbols** disabled with the scanned sentence. No console errors.
- [ ] **Step 5: Nothing is saved.** As phase 1's Task 9 Step 5: in the browser's private folder, `register.json`'s `savedAt` and length and the folder's entries are the same after a check, a report run, both downloads, and 5 s. The import itself registers the invented sheets, as any import does; compare only from after the import.
- [ ] **Step 6: Hand over to the owner** with the steps in *Owner steps after phase 2*. Do not commit unless asked.

---

## Decisions taken with the owner (2026-11-17)

- **Gate copies:** stand-in outline copies made with PyMuPDF (Task 1 Step 6), not prints through Microsoft Print to PDF. The P1 and P2 by-eye lines still use real printed sheets.
- **Plain shapes:** besides the spec's stricter backward score, a plain-shape hit is dropped when one of its edges runs on past a corner (Task 4). The spec's threshold alone cannot do it: the supplier sheet's false panel boxes scored 0.995 backward in phase 1. Plain hits that pass are still marked "plain shape: check by eye".
- **Execution:** subagent-driven (Sonnet implementers and reviewers).

## Owner steps after phase 2

1. In PowerShell, inside `harveydeason-site`, run `node scripts/lock-tools.mjs`.
2. Open the tool, connect the folder, and open P1 on the **Sheets** tab. If it is not in the register yet, it has to be imported first; the import registers it with no tags, as today.
3. Check its chip reads **Printed: letters drawn as shapes**. Press **Check symbols**. Look over the symbols found, and the ones marked "plain shape: check by eye".
4. Do the same on P2, then on one Plant 3D sheet and on sheet M, to see nothing has got worse.
5. Tick P1 and P2, press **Export report**, then **Run**, then **Download PDF** and **Download Excel**, and look at the Symbols sheet's **Note** column.

---

---

### Task 9 (follow-up, owner-approved 2026-11-17): two quick fixes after the owner's trial

The owner's ruling: hatched pipe is lagged, or trace-heated and lagged, pipework, drawn on purpose; it is linework, not a symbol. He approved both fixes, including reversing phase 1's "a bubble is found whether or not a tag sits inside".

**Files:** `assets/js/pid-symbol-check.js`, `assets/js/pid-symbol-check-worker.js`, `scripts/check-symbol-check.mjs`; tests in `tests/pid-symbol-check.test.js` (fixtures in `tests/fixtures/symbol-check-sheet.js`).

**Interfaces:**
- `checkSheet(input)` gains `input.writing: Box[]` (page points, top-left): boxes of letter-like ink the caller found (printed sheets). Writing on a sheet = the boxes of its text items through `textWords(textItems, viewportTransform)`, plus `input.writing`.
- The worker, for `words: 'printed'`, passes `writing` = the boxes of `glyphsOf(original paths)` (every glyph-sized candidate, spotted in a row or not), taken before letters are removed. The gate script does the same.
- **Fix 1, written symbols need writing.** A sweep hit whose library symbol is a tag bubble (`flags.bubble`) or holds letters (`symbol.letters` not empty) is kept only when some writing box has its centre inside the hit's box (for a bubble, inside its ring box). Otherwise it is rejected.
- **Fix 2, every line of a symbol must be on the drawing (per-line rule).** A sweep hit (not a bubble) is kept only if every line of its symbol whose placed length is at least 3 pt has at least `LINE_MIN` (85%) of its sample points (about two per point along the line) on the window's dilated ink. This replaced a first, run-on rule (shifted copies of the symbol along a hatched run), which missed short runs cut by a valve. Exported `weakestLine(hit, window, options)` returns the lowest share (0 on hostile input).
- Rejected hits from both fixes join the plain-shape rejects: never listed untagged, never merged with real spots, usable only by the leftover-tag pass (spec goal 5). Tag-led passes untouched.
- Constants: `LINE_MIN = 0.85` (exported), lines under 3 pt not held to it, two sample points per point of line.

**Tests (invented):** an empty RING outline is not listed; the same RING with a text item inside is listed; a RING with letter-like `writing` boxes inside is listed; a lettered invented symbol (`letters: [{ text: 'M' }]`) with nothing inside is rejected and with a word inside is listed; a strip symbol (invented: a row of 6 crossed squares) with one cross-line missing, or all of them, is not listed and the same strip drawn whole is listed; a WIDGET with one line drawn 40% short is not listed; a tag-led symbol with a short line is still answered; `LINE_MIN` is 0.85; `weakestLine` on rubbish gives 0; two WIDGETs back to back are both listed; goal-5 deep-equal tests on `SHEET` and `BUBBLE_SHEET` still pass; hostile `writing` (null, NaN boxes) never throws.

**Gate (local, as Task 7):** P1 and P2 with `--words printed`; A, B, C, M, supplier and the three printed copies with `--compare` against their `-p1.json`. Expected: P1 13 listed (2 pump circles false, known, phase 3), P2 21 listed (1 dashed-line arrow false, known); the lagged-pipe drive hits gone; A, B, C, M symbol lists and tag verdicts as after Task 8. Context pictures of every listed symbol on P1 and P2 (`context.py`, private) for the owner to judge. Numbers only in this Outcome.

## Outcome

(Task 8 adds its part. Numbers only, no tags, names or drawing numbers.)

### Task 7: the phase 2 gate (2026-11-17), second run

First run: NOT MET on the printed copies (A 11 of 12, B 11 of 18, C 94 of 102). Cause: the stand-in copies cut filled valves into thin stacked slices, and spotting read each stack as a vertical row of letters. The owner chose "new rule only": the slice rule (below) and `plainBack` 0.96, then a re-run on the stand-in copies only (no real prints), with B allowed to pass if its only misses are the switch box and the lettered hexagon.

Changes: `--words printed` in the gate script (spotted letters out, no words, no tags; `letters spotted: N paths in R rows`; `plain` on untagged lines with `--verbose`). Slice rule in `pid-sheet-read.js`: filled pieces whose boxes abut (gap within 0.1 pt along one axis, overlap of at least 80% of the shorter side across the shared edge) are joined into one shape before glyph sizing; kerned or spaced letters are not joined. `plainBack` 0.97 to 0.96 (a tunable starting value; the one test that pinned 0.97 now pins 0.96). Tests: 990, 988 pass, 0 fail, 2 skipped (three new slice-rule tests; the first two fail with the rule switched off).

**Printed copies. PyMuPDF outline-copy stand-ins, not Microsoft Print to PDF output.** Gate: at least 95% of phase 1's symbols matched, false hits at most 1 per 20 found, under 60 s.

| Copy | First run | Second run | Needed | Extras | Time | Line |
|---|---|---|---|---|---|---|
| A | 11 of 12 | 11 of 12 by the script; 12 of 12 by eye | 12 | 1 | 5.0 s | MET |
| B | 11 of 18 | 15 of 18 by name, 16 of 16 by place | 16 under the owner's exception | 1 (same family) | 6.0 s | MET (owner's exception) |
| C | 94 of 102 | 100 of 102 (98.0%) | 97 | 0 | 14.8 s | MET |

- A: the one script miss and the one extra are the same symbol, found with a box 10 pt from phase 1's (outside the 3 pt match tolerance). By eye it is 12 of 12 symbols and no false hit.
- B: 3 missing. Two are the known limits the owner named, which stay until letters are read (phase 5): the switch box and the hexagon holding a row of identical placeholder letters. The third is one valve found under another member of its family: a valve listed under a different member of the same family at the same box (the one extra). The legend gives both the same tag identifier (family code), and the check confirms the family, not the member, so it counts as found. B is 16 of 16 by place, and its only misses are the switch box and the lettered hexagon: MET under the owner's exception (15 of 18 by the script's count of names, 83.3%).
- C: the 2 missing are a pair of touching bubbles, also missed without spotting.
- False hits: 2 extras in total, neither false by eye (both are real symbols with a different box or name); the limit of 1 per 20 found holds.

**P1 and P2 (real sheets). Gate: no printed word and no note box listed.** MET on both.
- P1: 14 listed (first run 13). 0 printed words, 0 note boxes. 0 false by eye, 1 listed twice (one valve under two names at nearby boxes), 1 unsure; survey before: 4 false in 23. 6.5 s.
- P2: 32 listed (first run 25). 0 printed words, 0 note boxes. 5 false by eye (4 non-standard bubbles, 1 dashed line), 7 filled valves new since the first run (real; some may be the same valve listed under two names, unsure), 0 other unsure; survey before: 7 false in 59. 14.4 s.
- Filled valves listed twice under two names at nearby boxes (within 25 pt; unsure, not counted false): P1 1, P2 5.
- The slice rule brought back filled valves the first run lost on both sheets (P1 +2, P2 +8, each 1 name change); each sheet lost 1 listing that the new ones replace.
- Letters spotted: P1 7,572 paths in 258 rows; P2 10,353 paths in 351 rows. Wrong family 0.

**No harm to phase 1.** MET. Per-tag verdicts unchanged on A, B, C and M against the before files. Symbols still listed against phase 1: A 12 of 12, B 18 of 18, C 102 of 102, M 45 of 45 (plainBack 0.96 restores the 2 that 0.97 dropped on M). Times 6.4, 8.1, 19.6, 11.9 s.

**Relabel (C, 10 relabelled).** MET: 9 of 10 Wrong family, 0 other verdicts changed, 20.0 s.

**Supplier.** 0 of its 3 false plain shapes remain (phase 1: 3 of 3). 3.9 s.

**M with comments ignored (printed reading; not a gate line).** 45 found, 35 of 45 matched, 10 extra; 5,870 letter paths in 267 rows; 9.1 s.

**Statuses.** The six Task 2 lines are as expected (8 of 8).

**Open:** none on the gate. B's two known limits (switch box, lettered hexagon) stay until letters are read (phase 5).

### Task 8

The tool glue, in the browser (2026-11-17, invented sheets only). Backup SHA-256 before `6ba3a5d1…ac33`, after `9d07d3cc…b0dd`. Four edits, 4 anchors each matched once; the largest classic script passes `node --check`; `register.json` 19, `saveToFolder(` 4, `scheduleSave(` 6, `createWritable(` 4 before and after. `diff`: 4 hunks, all from the four edits. Port 5050 was already held by a server serving this repository, so the tool was opened there. Invented printed sheet (229 paths, no text): chip `Printed: letters drawn as shapes`; **Check symbols** progress `Looking for symbols: row 1..5 of 5`; `Tags not read yet…`, `212 letters spotted in 7 rows and left out of the linework`, 4 symbols (GADGET, SIGNAL, 2 WIDGET), no glyph row listed, a row jumped to its box, 0.4 s. Report: `1 checked, 1 not checked`; Symbols sheet has a `Note` column; PDF heading page reads `Tags not read yet: letters drawn as shapes.` Invented scanned sheet: chip `Scanned image`, button disabled with the scanned sentence. No errors. Nothing saved: `register.json` byte-identical (582 bytes, same `savedAt`) after the check, report run, both downloads and 5 s; same folder entries; the private folder was emptied. `npm test`: 992 tests, 990 pass, 0 fail, 2 skipped. Concern: the untagged RING bubble is not listed in the browser even for the plain SWEEP_SHEET (node's sweep finds it); not from phase 2.

### Correction after the owner's trial (2026-11-17)

The owner tried P1 and P2 in the tool and saw pumps read as other symbols and valves boxed on only part of their shape. Looking again at every listed symbol with its surroundings, the gate's by-eye count was too kind:

- P1: 14 listed, 3 false (2 pump circles read as an actuator, 1 hatched pipe read as a drive symbol), not 0. 
- P2: 32 listed, 10 false (4 pump circles read as tag bubbles, 5 hatched pipe runs read as a drive symbol, 1 dashed line read as an arrow), not 5.
- On both, valves drawn with a handwheel or lever are boxed on the body only: the legend's manual operator is too simple to check, so the operator is left unexplained. Filled valves beside hatched pipe read as another member of the valve family at 122%.

Causes: a closed circle with nothing written in it is accepted as a tag bubble; a hatched pipe repeats the legend's drive symbol exactly; and the check scores a symbol on its own box without asking whether the drawn shape carries on beyond it. The gate's line (no printed word or note box) still holds; the false-hit picture above is what the owner should judge by.

### Task 9

Owner's ruling (2026-11-17): hatched double-line pipe is lagged, or trace-heated and lagged, pipework, drawn on purpose; it is linework, not a symbol. Two fixes, both through the existing rejected path: (1) a tag bubble or lettered symbol needs writing in its box (text words, or letter-like ink boxes on a printed sheet); (2) every line of a symbol at least 3 pt long must have 85% of its sample points on the drawing. Tests 1005 pass, 0 fail, 2 skipped. Gate (`--words printed` for P1 and P2), numbers only:

- Sheet with filled letters (P1): 14 listed before Task 9, 13 now. Fix 1 renamed 2 pump circles from a lettered actuator to its unlettered sibling on the same boxes (still listed: 2 false, pumps drawn without their base triangle read as an actuator, left for phase 3). Fix 2 removed 1 hatched-pipe hit read as a drive symbol. Of the 13: 11 real (10 valves, 1 flowmeter, 1 control panel), 2 false.
- Sheet with stroked letters (P2): 32 before Task 9, 21 now. Fix 1 removed 4 pump circles read as tag bubbles; fix 2 removed 5 hatched-pipe hits read as a drive symbol and 2 flowmeters (each has one line drawn short, measured 0.80; accepted, phase 3 will mark them as modified). Of the 21: 20 real (18 valves, 2 control panels), 1 false (small arrow on a dashed line, left for phase 3).
- A, B, C, M, supplier and the three printed copies: symbol lists and every tag verdict unchanged (A 12, B 18, C 102, M 45, supplier 0); the M printed copy's extra count fell from 10 to 6, matched 35 of 45 as before. Wrong family 0 everywhere.

**Times (Task 9, node, this machine while busy with other programs).** The same sheet's time swings with the machine's load: sheet C took 50.4 and 58.8 s back to back, and P2 between 15.2 and 47.4 s. Run alternately against the code before Task 9, P2 took 45.3 s (before) and 46.9 s (after), then 30.9 s and 15.2 s: the two fixes add no measurable time. The 60 s gate holds on a quiet machine (Task 7: C 19.6 s, P2 14.4 s) and only just on a busy one; past 120 s the check stops and says its list is incomplete.
