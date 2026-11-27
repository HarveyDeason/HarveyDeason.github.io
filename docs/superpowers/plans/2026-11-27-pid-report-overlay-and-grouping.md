# P&ID report: overlay and grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each flagged shape against the symbol it was matched to (overlay), and number shapes by group (same symbol, same verdict and fault) so the list is short, in the PDF report and on screen.

**Architecture:** The judge records an `overlay` (placed legend outline, unmatched drawn pieces, expected size) on each not-standard shape result. A new pure module groups shapes and numbers the groups. The report model, the PDF writer and the on-screen view all read those groups.

**Tech Stack:** Vanilla ES modules, `node --test`, pdf-lib (vendored). Windows, PowerShell 5.1.

**Spec:** `docs/superpowers/specs/2026-11-27-pid-report-overlay-and-grouping-design.md`

## Global Constraints

- No verdict, symbol, box, percentage or count may change: before and after must be identical on A, B, C, M, P1, P2, H1-H6 and the six binder pages once `overlay` is ignored in the compare. Anything else that moves is reported plainly, with numbers.
- Tests first; invented data only. `assets/js/` is public: nothing from real sheets in the repo. Real sheets stay in `..\pid-symbol-spike\` and Downloads; report counts only, never drawing numbers or tags.
- Size faults within 2 points of the group's first member are one group (75% and 76%).
- Group numbers: amber (not-standard) groups first, then standard; each largest first, ties by first member in reading order (top to bottom, then left to right). Not-identified shapes get no number.
- Results saved before this change have no `overlay`: groups still work, the tile falls back to today's picture and caption.
- Result size stays small: at most 200 segments per overlay list.
- Do not commit or push unless the owner asks. The tool page (`tools-src/pid-tag-register.html`, gitignored) is patched with anchored edits; the owner runs `node scripts/lock-tools.mjs`.

## Review Focus

1. An old result with no `overlay` anywhere (report and view still draw, group, and number).
2. A sheet with no matched shapes, or only grey ones: no groups, no crash, no empty list heading.
3. A shape matched to two symbols (body plus attachment, or "A + B"): its group name is the body, same as today's caption.
4. Sizes 75, 76, 77, 78 in a row: grouping against the first member must not chain them into one group.
5. A legend symbol with thousands of segments or a shape with hundreds of unmatched pieces: overlay lists are thinned to 200, never dropped silently, never huge.

---

## File Structure

- Modify `assets/js/pid-symbol-check.js`: judgeShapes records `overlay`.
- Create `assets/js/pid-symbol-groups.js`: pure grouping and numbering.
- Modify `assets/js/pid-symbol-report.js`: model carries groups; rows carry group numbers.
- Modify `assets/js/pid-symbol-report-pdf.js`: numbers on boxes, group list, overlay tiles.
- Modify `assets/js/pid-symbol-check-view.js` and `tools-src/pid-tag-register.html`: same groups on screen.
- Modify `scripts/time-pid-pipeline.mjs`: compare ignores `overlay`.
- Tests: `tests/pid-symbol-judge.test.js`, new `tests/pid-symbol-groups.test.js`, `tests/pid-symbol-report.test.js`, `tests/pid-symbol-report-pdf.test.js`, `tests/pid-symbol-check-view.test.js`.

### Task 1: The judge records the overlay

**Files:**
- Modify: `assets/js/pid-symbol-check.js` (judgeShapes, at the final `out.push({ ...base, standard: ..., parts })`)
- Modify: `scripts/time-pid-pipeline.mjs` (`canonical`/`stripTimes`: also drop the key `overlay`)
- Test: `tests/pid-symbol-judge.test.js`

**Interfaces:**
- Produces: each shape result with `verdict === 'not-standard'` and a body or closest symbol gets `overlay: { name: string, symbol: number[][] , unmatched: number[][], placedBox: [x0,y0,x1,y1], expected: [w, h] | null }`. Segments are `[x0,y0,x1,y1]` in page points (the frame of `box`). `symbol` is the matched legend symbol's segments placed as the verdict placed them (the body hit when one was kept, else the closest hit). `unmatched` is the pieces of the shape (after the pipe and lead cuts) with less than half of their length on the placed symbol's template. `expected` is the symbol's own width and height times the sheet's size scale, turned to the placement's orientation; `null` when the symbol is a stretched fit with no single scale. Both lists are thinned evenly to at most 200. Shapes with no hit have no `overlay` field. `memo` copies keep it.

- [ ] **Step 1: Write the failing test** in `tests/pid-symbol-judge.test.js`: `an off-size WIDGET records its overlay`: use the existing `checkSheet` WIDGET sheet helpers with a WIDGET drawn at 0.75 of the sheet's size and assert `shape.overlay.name === 'WIDGET'`, `overlay.symbol.length > 0`, `overlay.placedBox` inside `box` grown by 1, `overlay.expected` is two positive numbers, and every list has at most 200 entries. Second test `a standard shape has no overlay` asserts the field is absent. Third, `an overlay list is thinned to 200`: a symbol of 500 segments gives `symbol.length === 200`.
- [ ] **Step 2: Run** `node --test tests/pid-symbol-judge.test.js`. Expected: the three new tests FAIL (`overlay` undefined).
- [ ] **Step 3: Implement** `overlayOf(f, hit, fr)` in `pid-symbol-check.js` beside `templateIn`: place `hit.p.segs` with `placePoint(hit.placement, x, y)`; use `pieceOn(g, templateIn(fr, hit, cfg))` per remaining piece for `unmatched` (below 0.5); thin with an even stride. Call it at the final push, for `v.verdict === 'not-standard'`, with the first kept non-operator hit, else `closest.h`.
- [ ] **Step 4: Make the compare ignore it.** In `scripts/time-pid-pipeline.mjs`, make `canonical` drop the key `overlay` (a test in `tests/` is not possible for this script; verify by comparing a result with and without the field and expecting `same: true`).
- [ ] **Step 5: Run** `node --test tests/pid-symbol-judge.test.js` then `npm test`. Expected: PASS, 0 fail.

### Task 2: The grouping module

**Files:**
- Create: `assets/js/pid-symbol-groups.js`
- Test: `tests/pid-symbol-groups.test.js`

**Interfaces:**
- Consumes: shape results as `checkSheet` returns them (`verdict`, `reason: { kind, name, pct }`, `parts`, `closest`, `box`, `overlay`).
- Produces: `groupShapes(shapes: object[]) -> { groups: Group[], noOf: (shape) => number | null }` where `Group = { no: number, name: string, verdict: 'standard'|'not-standard', kind: 'size'|'extra'|'differs'|'tag'|null, pct: number|null, count: number, members: object[], example: object|null }`. `example` is the first member in reading order for a not-standard group, `null` for a standard one. `noOf` returns `null` for not-identified, not-judged and line-mark shapes. `GROUP_PCT_TOL = 2` exported. A group's name: `partsName(parts)` body name, else `reason.name`, else `closest.name`.

- [ ] **Step 1: Write the failing tests** in `tests/pid-symbol-groups.test.js` (invented shapes as plain objects): `four standard BALLs are one group of 4 with no example`; `75 and 76 percent size faults share a group; 75 and 78 do not` (75, 76, 77, 78 gives two groups: [75, 76, 77] and [78] when measured from the first member); `different faults of one symbol are different groups`; `amber groups are numbered before standard, largest first, ties in reading order`; `not-identified and not-judged shapes have no number`; `an empty list gives no groups`; `a shape missing every field does not throw`.
- [ ] **Step 2: Run** `node --test tests/pid-symbol-groups.test.js`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `groupShapes` and `GROUP_PCT_TOL`; one pass to key (`verdict|kind|name`, size faults then joined by percentage to the group's first member), then sort and number. Never throws (wrap and return `{ groups: [], noOf: () => null }`).
- [ ] **Step 4: Run** the file. Expected: PASS.

### Task 3: The report model uses groups

**Files:**
- Modify: `assets/js/pid-symbol-report.js` (`symbolParts`, `numbered`, `buildReportModel`)
- Test: `tests/pid-symbol-report.test.js`

**Interfaces:**
- Consumes: `groupShapes` from Task 2.
- Produces: on each sheet in the model: `groups: Group[]` (as Task 2, members reduced to `{ userRect }` and the example to `{ userRect, overlay }`); every row in `shapeRows` and `standardRows` carries `no` (its group number) instead of a running count; `redRows` carry no `no`. `shapeLine` and the counts are unchanged.

- [ ] **Step 1: Write the failing tests**: `two BALLs at 75% and one standard BALL give groups 1 (amber, 2) and 2 (standard, 1)`; `every box row carries its group number`; `a result with no overlay still groups, example.overlay is undefined`; `a sheet with no matched shapes has groups: []`.
- [ ] **Step 2: Run** `node --test tests/pid-symbol-report.test.js`. Expected: new tests FAIL; the old numbering tests are updated in this task to the group numbers.
- [ ] **Step 3: Implement** by calling `groupShapes` in `symbolParts` and attaching numbers; remove the per-flag `numbered` counting for the symbols layout (keep it for the tags layout).
- [ ] **Step 4: Run** the file, then `npm test`. Expected: PASS.

### Task 4: The PDF draws groups and overlay tiles

**Files:**
- Modify: `assets/js/pid-symbol-report-pdf.js` (`drawBoxes`, `drawStandardBoxes`, `drawPictures`, `render`)
- Test: `tests/pid-symbol-report-pdf.test.js`

**Interfaces:**
- Consumes: the model's `groups`, row `no`, example `overlay` (Task 3).
- Produces: PDF pages where each box shows its group number; one list line per group ("#3 BALL ×4, standard"; "#4 BALL ×6, drawn at about 75% of sheet size"); one tile per amber group, smaller than today's (at least 6 tiles a page at A4), with the overlay drawn in black (drawn ink), blue dashed (`symbol`), red (`unmatched`), a second small picture of `expected` size for size faults, and the caption `#no NAME, fault, ×count`. No overlay: today's picture and caption.

- [ ] **Step 1: Write the failing tests** (the file already builds PDFs from invented models and reads them back): `a group list line is written per group`; `a group of 6 gives one tile, not 6`; `a model with no overlay still draws its tile`; `a page holds at least 6 tiles`; `an overlay with 200 segments draws without throwing`.
- [ ] **Step 2: Run** `node --test tests/pid-symbol-report-pdf.test.js`. Expected: new tests FAIL.
- [ ] **Step 3: Implement**: replace the per-row tile loop in `drawPictures` with a loop over amber groups' examples; add `drawOverlay(page, PDFLib, rect, overlay, transform)` drawing the three layers as thin lines; write group numbers where `drawBoxes`/`drawStandardBoxes` write row numbers today; list lines from `groups`.
- [ ] **Step 4: Run** the file, then `npm test`. Expected: PASS.

### Task 5: The on-screen view and tool page

**Files:**
- Modify: `assets/js/pid-symbol-check-view.js` (`resultsHtml`, `boxRects`), `tools-src/pid-tag-register.html` (anchored edits only)
- Test: `tests/pid-symbol-check-view.test.js`

**Interfaces:**
- Consumes: `groupShapes` (Task 2).
- Produces: `boxRects(result, scale)` returns each box with its group `no`; `resultsHtml(result)` lists one entry per group with its count and, for amber groups, an overlay drawn as inline SVG (black, blue dashed, red) from the example's `overlay` (escaped; no HTML from data).

- [ ] **Step 1: Write the failing tests**: `resultsHtml lists one entry per group`; `a box carries its group number`; `an overlay renders as SVG with three layers`; `a result with no overlay renders as before`; `names and reasons are escaped`.
- [ ] **Step 2: Run** `node --test tests/pid-symbol-check-view.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** in the view module; in the tool page, add only the small anchored edits (a back-up first, as the earlier tool patches did) so the page calls the module; run the escaping-audit test (`tests/escaping-audit.test.js`) and syntax-check the page.
- [ ] **Step 4: Run** `npm test`. Expected: 0 fail.

### Task 6: Verify on the real sheets and report

**Files:** none in the repo (real data stays outside it).

- [ ] **Step 1:** Baseline verdicts: `node scripts/time-pid-pipeline.mjs --manifest ..\pid-symbol-spike\perf\sheets.json --verdicts ..\pid-symbol-spike\shape\v-pre-overlay` from a clean checkout of the base commit; same for `..\pid-symbol-spike\shape\binder-sheets.json`.
- [ ] **Step 2:** With the new code, `--compare` both. Expected: all 12 sheets and 6 binder pages IDENTICAL. Report any difference plainly, with numbers.
- [ ] **Step 3:** Result size: report the largest result's size before and after (counts only).
- [ ] **Step 4:** Build a report PDF for binder test 3 with the repo's report builder, outside the repo; report page counts before and after, and the number of groups against the number of flagged shapes (counts only).
- [ ] **Step 5:** Tell the owner what to click through in the tool (open a sheet, Check symbols, Export report), and that `node scripts/lock-tools.mjs` is theirs to run.

## Self-review

- **Spec coverage:** overlay (Task 1), size-fault expected picture (Tasks 1 and 4), grouping and numbering (Task 2), smaller tiles (Task 4), PDF and screen (Tasks 4 and 5), verdicts unchanged and old results (Global Constraints, Tasks 1, 3, 6). The grey group is one count line, as in the spec, handled in Task 3 (`redRows` keep no number).
- **Open choice left to the builder:** exact tile dimensions and colours (existing PDF palette).
