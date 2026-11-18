# P&ID shape check redesign (green / amber / red) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every judged shape inside the drawing area gets one of three marks: green standard (named), amber not to standard (numbered, with a reason that names a standard symbol), red not identified (no name, a count in the report). Nothing outside the drawing area is judged.

**Architecture:** Four new pure pieces feed the existing judge (`judgeShapes`) and `checkSheetAt`: a drawing-area finder beside `titleBlockBox`, a "line pieces" reader of the PDF's paths (judge only), a pipe cut applied to a found symbol's shape, and a verdict step (sheet size scale from the found symbols' median, size rule, the four amber reasons, tag promotion). `checkSheetAt` crops to the drawing area, judges by path, and re-judges from line pieces when fewer than half the judged shapes come out green, keeping the reading with more green. The sweep, its symbol lists and the tag pairing are not touched, so the no-harm gate holds by construction. The screen and the report show the three marks; red is boxes on the drawing and a count, never pictures or rows.

**Tech Stack:** vanilla ES modules, `node --test`, pdf.js (already in use), pdf-lib (already in use). No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-18-pid-shape-check-redesign-design.md` (approved 2026-11-18, "approved build it").

## Global Constraints

- Nothing writes `register.json`. Save-call counts in the tool do not change.
- No client data in the repo. Real sheets, outputs and answers stay in `../pid-symbol-spike/`; tests use invented data only.
- `tools-src/` only by anchored patch after a backup; the owner runs `node scripts/lock-tools.mjs`.
- No new dependency and no OCR. The build works from the PDF's line pieces, not pixels of the page.
- Sonnet for subagents. The owner's terminal is PowerShell 5.1. Commit and push only when the owner asks (work stays uncommitted on main; task BASE = HEAD 7aae000).
- The sweep's symbol lists, the tag verdicts and the tag table, the operator heading and `register.json` do not change.
- Named settings start at the measured values: amber "alike" closest score ≥ **0.80** and explained ≥ **0.50**; size tolerance **15%**; judge search band **0.6-1.6** times the sheet scale; method switch when fewer than **half** the judged shapes are green; frame lines ≥ **60%** of the page width/height in the outer **15%**; title strip in the right **30%** of the frame covering ≥ **half** its height with ≥ **2** horizontal lines to the frame's right edge; touching the frame within **4 pt** is outside; ≥ **5** found symbols before a size scale is read; "Printed at N% of full size" shown when N is outside **95-105%**. They change only on the tuning sheets (P1, P2, C, M), never on H1-H6.
- Copy fixed by the spec (exact): "drawn differently from X (N% alike)"; "X drawn at N% of standard size"; "X with extra linework"; "tag T has no standard symbol"; "Read from: drawn paths" / "Read from: line pieces"; "Printed at N% of full size"; "Drawing area: frame not found, page edge used"; key: "Not to standard: the reason names the standard symbol it departs from"; "Not identified: looked at, not matched to any standard symbol; check by eye". The trial note stays.
- Every new rule is test-first on invented data (RED then GREEN), and is a general property of P&IDs or PDFs, not of one sheet.

## Review Focus

1. **A sheet with no frame at all** (a clean CAD export with no border, or a frame drawn as a filled band): the check falls back to today's behaviour exactly (20 pt strip + `titleBlockBox`), says "Drawing area: frame not found, page edge used", and crops nothing more. Test in Task 1 and Task 5.
2. **A turned sheet** (page `/Rotate 90`): paths arrive in viewport points, so the frame is found in shown coordinates and the title strip is on the shown right. Test in Task 1 (frame given in rotated coordinates, as the viewport transform hands it over) and Task 5 (`checkSheet` with a rotated viewport transform: no box outside the area).
3. **A symbol drawn at the wrong size among many at the right size**: the median must not absorb it (no per-symbol scale), and a sheet with fewer than 5 found symbols keeps scale 1. Test in Task 4.
4. **The line-pieces re-read on a huge sheet** (H6: 167k paths): `readByLinePieces` must stay near-linear. Test in Task 2 (20,000 strokes under 1.5 s CPU) and measured in Task 8 (no sheet over 60 s).
5. **A pipe that runs into a tee next to a valve**: the cut stops at the junction; the branch is not cut and stays as extra linework. Test in Task 3.

---

## File Structure

- `assets/js/pid-symbol-check.js` — modify. `drawingArea`, `insideArea` beside `titleBlockBox` (Task 1); `pipeLines`, `cutPipe` in the whole-shapes section (Task 3); `sizeScaleOf`, verdicts inside `judgeShapes` (Task 4); crop, method choice, tag promotion, result fields in `checkSheetAt`/`checkSheet` (Task 5).
- `assets/js/pid-sheet-read.js` — modify. `readByLinePieces` beside `sheetShapes` (Task 2).
- `assets/js/pid-symbol-check-view.js` — modify (Task 6): `reasonText`, `markLine`, three marks in `resultsHtml` / `boxRects`.
- `assets/js/pid-symbol-report.js`, `assets/js/pid-symbol-report-pdf.js` — modify (Task 7).
- `scripts/check-symbol-check.mjs` — modify (Task 5): one `marks:` line.
- `tools-src/pid-tag-register.html` — anchored CSS patch after backup (Task 6).
- Tests (new): `tests/pid-drawing-area.test.js`, `tests/pid-line-pieces.test.js`, `tests/pid-shape-verdicts.test.js`. Existing view/report tests updated only where they pin fields this plan replaces.
- Private, outside the repo (controller, Task 8-9): `../pid-symbol-spike/phase4-build/` (`noharm.sh`, `noharm_diff.py`, `probe4.mjs`, `score4.py`, `area-pictures.py`, tile makers' copies).

## Data contract (all tasks)

`ShapeOut` (from `judgeShapes`, in `result.shapes`) keeps every field it has today and gains:

- `verdict`: `'standard' | 'not-standard' | 'not-identified' | 'not-judged'` (not-judged = the time limit, today's `why: 'time'`).
- `reason`: `null` unless `verdict === 'not-standard'`, then one of
  `{ kind: 'differs', name, pct }` (pct = round(closest.score × 100)),
  `{ kind: 'size', name, pct }` (pct = round(size against sheet scale × 100)),
  `{ kind: 'extra', name }`,
  `{ kind: 'tag', tag }`.
- `standard` stays: `true` iff `verdict === 'standard'`, `false` for not-standard and not-identified, `null` for not-judged.
- `closest` stays in the data; screen and report show it only on amber.

Result (from `checkSheet`) gains: `drawingArea: { box: [x0,y0,x1,y1], cuts: [[x0,y0,x1,y1], ...], found: boolean }` (page points as shown, scaled back like every other box), `readFrom: 'paths' | 'line-pieces'`, `sizeScale` (median found size, checked frame, 1 when fewer than 5), `printScale` (= `sheetScale × sizeScale`, rounded to 3 places). Results without `shapes` (shapes off) carry none of these.

---

### Task 1: The drawing area

**Files:**
- Modify: `assets/js/pid-symbol-check.js` (beside `titleBlockBox`, ~line 805)
- Test: `tests/pid-drawing-area.test.js`

**Interfaces:**
- Consumes: `axisRuns(paths, vertical, cfg)` (existing, joins collinear pieces within `RUN_GAP`).
- Produces: `export function drawingArea(paths, pageSize) -> { box, cuts, found }`; `export function insideArea(area, box) -> boolean`. Exported constants `FRAME_LONG = 0.6`, `FRAME_ZONE = 0.15`, `STRIP_ZONE = 0.3`, `STRIP_COVER = 0.5`, `STRIP_ROWS = 2`, `FRAME_TOUCH = 4`, `CUT_TOUCH = 2`.

Rules (the measured ones from `pid-symbol-spike/foreign/frame.py`, `frame3.py`):
- Frame: among axis runs at least `FRAME_LONG` of the page width (horizontal) or height (vertical), the innermost one on each side lying in the outer `FRAME_ZONE` of the page. All four sides needed, else `found: false`.
- Title strip: the leftmost vertical run x in the right `STRIP_ZONE` of the frame (x > frame.x0 + 0.7 × frame width, x < frame.x1 − 5) whose union of collinear pieces (within 0.8 pt of x, gaps up to 0.5 pt) covers at least `STRIP_COVER` of the frame height, with at least `STRIP_ROWS` horizontal runs starting within 2 pt of x and ending within 3 pt of the frame's right edge. Cut = `[x, frame.y0, frame.x1, frame.y1]`.
- Bottom-right block (only when no strip): the same test turned: a horizontal run y in the bottom `STRIP_ZONE` of the frame from some x_left to within 3 pt of the frame's right edge, and a vertical run at x_left (within 2 pt) reaching within 3 pt of the frame's bottom; covering at least half the block's height. Cut = `[x_left, y, frame.x1, frame.y1]`. The lowest-leftmost such corner wins.
- `insideArea`: true when `found` is false (fallback: today's behaviour, nothing more cropped); else the box lies inside the frame by more than `FRAME_TOUCH` on every side, and overlaps no cut grown by `CUT_TOUCH`.
- Never throws; hostile input gives `{ box: [0,0,W,H] or null, cuts: [], found: false }`.

- [ ] **Step 1: Write the failing tests** (invented sheets: a 1000 × 700 page; frame lines at 20 pt from each edge drawn as one path each; strip divider at x = 800 drawn in 3 pieces covering 64% of the height; rows at y = 300 and 500 from x = 800 to 980)

```js
test('a frame and a full-height title strip: the area is the frame left of the strip', () => {
  const a = C.drawingArea(STRIP_PAGE.paths, [1000, 700]);
  assert.equal(a.found, true);
  assert.deepEqual(a.box.map(Math.round), [20, 20, 980, 680]);
  assert.deepEqual(a.cuts.map(c => c.map(Math.round)), [[800, 20, 980, 680]]);
});
test('a divider drawn in pieces covering under half the height is no strip', () => { /* cover 40%: cuts [] */ });
test('a divider with only one row line to the frame edge is no strip', () => { /* cuts [] */ });
test('a bottom-right title block not full height is cut from its top and left lines', () => {
  // block top y = 520 from x = 700 to 980, left side x = 700 from 520 to 680
  assert.deepEqual(a.cuts.map(c => c.map(Math.round)), [[700, 520, 980, 680]]);
});
test('the frame is the innermost long line on each side (a double border)', () => { /* lines at 10 and 20: box starts at 20 */ });
test('a long pipe across the middle of the sheet is not the frame', () => { /* a 0.9-width line at y = 350 is ignored */ });
test('a turned sheet: frame and strip found in shown coordinates', () => { /* the same page as 700 × 1000 shown, strip on the shown right */ });
test('no frame: found false, and insideArea keeps every box', () => {
  const a = C.drawingArea([], [1000, 700]);
  assert.equal(a.found, false);
  assert.equal(C.insideArea(a, [0, 0, 5, 5]), true);
});
test('insideArea: touching the frame within 4 pt, or the strip within 2 pt, is outside', () => {
  assert.equal(C.insideArea(a, [23, 100, 40, 120]), false);   // 3 pt from the frame
  assert.equal(C.insideArea(a, [25, 100, 40, 120]), true);
  assert.equal(C.insideArea(a, [760, 100, 799, 120]), false); // 1 pt from the strip
});
test('drawingArea with hostile input never throws', () => { /* null, NaN segs, pageSize 'x' */ });
```

- [ ] **Step 2: Run to see them fail** — `node --test tests/pid-drawing-area.test.js` → FAIL, `C.drawingArea is not a function`.
- [ ] **Step 3: Implement `drawingArea` and `insideArea`** in `pid-symbol-check.js` beside `titleBlockBox`, from `axisRuns` (both directions). Coverage of the divider is the union of its runs within 0.8 pt of x over [frame.y0, frame.y1].
- [ ] **Step 4: Run** `node --test tests/pid-drawing-area.test.js` → PASS; then `npm test` → no new failures.

---

### Task 2: Reading by line pieces

**Files:**
- Modify: `assets/js/pid-sheet-read.js` (beside `sheetShapes`)
- Test: `tests/pid-line-pieces.test.js`

**Interfaces:**
- Produces: `export function readByLinePieces(paths) -> Path[]` (same path shape as today: `{ segs, width, stroked, filled, grey }`, segs flat quadruples) and `export const RING_FIT = 0.04, RING_COVER = 0.75, JOIN_GAP = 1`.

Rules:
1. Path boundaries are ignored: every segment of every ink path (grey < 175) becomes a loose piece carrying its path's width; white fills and paths at grey ≥ 175 pass through unchanged, in their place in the order.
2. Collinear pieces (directions within `COL_SIN` 0.02, each end within 0.3 pt of the other's line) that overlap or are within `JOIN_GAP` pt end to end are joined into one piece.
3. Filled ink paths of one grey whose edges touch (a shared edge within 0.3 pt) are merged into one filled path; edges they share (drawn by both, either direction) are dropped from it, so the splitter sees one outline. (Even-odd fill of the remaining edges gives the union.)
4. A circle: pieces from curved runs (consecutive segments of one path turning the same way) whose points lie on one circle (radius within `RING_FIT` of it, centre within `RING_FIT × r`), together covering at least `RING_COVER` of the circumference, whatever paths they came from, become one closed path: a 32-sided polygon on the fitted circle, stroked, at the pieces' largest width. Radius 2 to 200 pt.
5. Near-linear: a grid on piece ends, no all-pairs loop.
6. Never throws; hostile input gives `[]`.

- [ ] **Step 1: Write the failing tests**

```js
test('a ring drawn as four separate arcs is one closed path', () => {
  const out = R.readByLinePieces(arcs(100, 100, 12, 4));   // four quarter arcs, four paths
  const rings = out.filter(p => isClosedPath(p));
  assert.equal(rings.length, 1);
  const b = boxOf(rings[0]); assert.ok(Math.abs(b[2] - b[0] - 24) < 0.6 && Math.abs(b[3] - b[1] - 24) < 0.6);
});
test('three quarters of a ring drawn is still a ring; half is not', () => { /* RING_COVER */ });
test('a ring drawn as pieces of a printed line with small breaks is a ring', () => { /* 24 chords with 0.4 pt gaps */ });
test('a filled disc cut into eight slices is one filled outline with no spokes', () => {
  const out = R.readByLinePieces(slices(50, 50, 10, 8));
  const fills = out.filter(p => p.filled);
  assert.equal(fills.length, 1);
  assert.equal(spokes(fills[0], 50, 50), 0);   // no edge runs through the centre
});
test('a straight line drawn in five pieces with 0.8 pt gaps is one piece', () => {});
test('two parallel lines 1 pt apart stay two pieces', () => {});
test('a 2 pt gap is not joined', () => {});
test('a white fill and a pale path pass through in their place', () => {});
test('20,000 strokes are read in under 1.5 s of CPU time', () => { /* process.cpuUsage, as tests/pid-sheet-shapes.test.js does */ });
test('readByLinePieces with hostile input gives [] and never throws', () => {});
```

- [ ] **Step 2: Run** `node --test tests/pid-line-pieces.test.js` → FAIL (`R.readByLinePieces is not a function`).
- [ ] **Step 3: Implement `readByLinePieces(paths)`** in `pid-sheet-read.js` (rules 1-6). Circle fit: algebraic (Kåsa) least squares on each curved run's points, then group runs whose fits agree.
- [ ] **Step 4: Run** the file → PASS; `npm test` → no new failures.

---

### Task 3: Cut the pipe off a found symbol

**Files:**
- Modify: `assets/js/pid-symbol-check.js` (whole-shapes section, used inside `judgeShapes`)
- Test: `tests/pid-shape-verdicts.test.js` (new; this file grows in Tasks 4-5)

**Interfaces:**
- Consumes: `placePoint(placement, x, y)`, `placedBox(hit)`, the split's `segments` `[x0,y0,x1,y1,len,pathIndex]`.
- Produces: `export function pipeLines(prepared) -> { axis: 'h'|'v', at: number[] } | null` (in the symbol's own frame: `at` holds the y (for 'h') or x (for 'v') of each pipe line); `export function cutPipe(S, pieces, hit) -> number[]` (the pieces to remove). `judgeShapes` removes them from a shape holding a sweep-found (or tag-paired) body hit before it is judged, and recomputes the shape's box.

Rules:
- Connection points: ends of the legend symbol's segments on its box edge (within 0.5 pt), on a segment not lying along that edge (sin > 0.2), not within 0.5 pt of a corner. Points on left and right edges only → `'h'` at their y's; top and bottom only → `'v'` at their x's.
- Otherwise the long axis: w ≥ 1.2 h → `'h'` at h/2; h ≥ 1.2 w → `'v'` at w/2; else null. Bubbles and operators: null (no cut).
- The cut, per pipe line placed on the drawing (through `placePoint`, so turned placements turn the axis): seed with pieces of the shape parallel to the line (sin < 0.02), within 1 pt of it, lying outside the placed box, with an end within 1 pt of the box edge. Grow outward through a seed's far end to the next collinear piece touching it (within 1 pt), unless that end is a junction: any other piece of the shape, not collinear with the line, within 0.5 pt of it. A junction stops the cut there; the branch stays.

- [ ] **Step 1: Write the failing tests** (invented: `WIDGET` (bowtie, 24 × 12) from the fixtures)

```js
test('pipeLines: a bowtie has no ends on its box edge off the corners, so its long axis', () => {
  assert.deepEqual(C.pipeLines(prep('WIDGET')), { axis: 'h', at: [6] });
});
test('pipeLines: a symbol with stubs on its top and bottom edges is cut vertically', () => { /* invented STEMMED: stubs at x = 5 */ });
test('pipeLines: a ring (bubble) and a square symbol with no stubs give null', () => {});
test('a WIDGET with 8 pt pipe stubs either side, shorter than the long run: standard after the cut', () => {
  const s = at(run(sheetWith(widgetWithStubs(100, 100, 8))), 112, 106);
  assert.equal(s.standard, true, JSON.stringify(s));
  assert.ok(s.box[2] - s.box[0] <= 25, 'the box shrinks to the symbol');
});
test('the same WIDGET turned 90 degrees: the vertical stubs are cut', () => {});
test('a stub that turns a corner: the straight part is cut, the bend stays as extra linework', () => {
  const s = at(r, 112, 106);
  assert.equal(s.verdict, 'not-standard'); assert.deepEqual(s.reason, { kind: 'extra', name: 'WIDGET' });
});
test('a tee 6 pt from the WIDGET: the cut stops at the junction, the branch stays', () => {});
test('a stroke off the pipe axis is not cut (extra linework)', () => {});
test('cutPipe with hostile input gives [] and never throws', () => {});
```

(The `verdict`/`reason` assertions in the corner case are filled by Task 4; until then assert `standard === false` and `why === 'left-over'`, and Task 4 tightens them.)

- [ ] **Step 2: Run** `node --test tests/pid-shape-verdicts.test.js` → FAIL.
- [ ] **Step 3: Implement `pipeLines` and `cutPipe`**; call `cutPipe` in `judgeShapes` per shape, after step 2 (operator merge), for each kept hit from `f.spots` that is not an operator or bubble, before the shape's frame is built.
- [ ] **Step 4: Run** the file → PASS; `npm test` → no new failures. Existing judge tests whose invented "extra stroke" turns out collinear with a pipe line: record a ruling, do not edit the old test to pass.

---

### Task 4: Sheet scale, size rule and the three verdicts in the judge

**Files:**
- Modify: `assets/js/pid-symbol-check.js` (`judgeShapes`, `boxFit`)
- Test: `tests/pid-shape-verdicts.test.js`

**Interfaces:**
- Consumes: Task 3's cut.
- Produces: `export function sizeScaleOf(hits) -> number` (median of `hit.k` over the hits; 1 when fewer than `SCALE_SYMBOLS_MIN = 5`); `export function hitSize(hit) -> number` (longer side of `placedBox(hit)` over the longer side of the legend symbol it was prepared from; for a `boxFit` hit the fitted scale, recorded by `boxFit` as `placement.fitK`); exported `AMBER_ALIKE = 0.8`, `AMBER_EXPLAINED = 0.5`, `SIZE_TOL = 0.15`, `JUDGE_BAND = [0.6, 1.6]`. `judgeShapes(ctx)` reads `ctx.sizeScale` (default 1) and gives every ShapeOut `verdict` and `reason` (Data contract).

Rules:
- Judge search band: every `proposePlacements` call inside `judgeShapes` (plains, operators, the loose search) uses `minScale = JUDGE_BAND[0] × sizeScale`, `maxScale = JUDGE_BAND[1] × sizeScale`. `quickFit`/`boxFit` limits and the sweep are unchanged.
- Verdict of a judged shape (kept = today's `kept`; bodies = kept that are not operators):
  1. time limit → `not-judged`.
  2. bodies, all ink explained (`explained ≥ shapeExplained`): the body with the worst size off by more than `SIZE_TOL` (|hitSize / sizeScale − 1| > 0.15) → `not-standard`, `{ kind: 'size', name, pct }`; else `standard`.
  3. bodies, not all explained, `explained ≥ AMBER_EXPLAINED` (after the cut) → size reason as in 2 if a body is off size, else `{ kind: 'extra', name: first body }`.
  4. otherwise (no body, only operators, or a body explaining under half): `closest.score ≥ AMBER_ALIKE` and `closest.explained ≥ AMBER_EXPLAINED` → `{ kind: 'differs', name: closest.name, pct }` (this takes in today's "line drawn short"); else `not-identified`.
- `why`, `share`, `closest`, `explained` keep today's values; `standard` follows `verdict`.
- A legend symbol drawn as one straight line (all its segments collinear: `longestJoined(segs)` within 1 pt of its longer side, or a single segment) is never the `closest` behind an amber `differs` reason, and never a standalone fit (plain, box fit) for a shape on its own: one line matches any line (owner, 2026-11-18: 30 of the 128 measured amber read "DIRECT COUPLED DRIVE (100% alike)"). Found by the sweep and listed as today; the sweep is unchanged. Test: an invented one-line symbol in the library and a stray line on the sheet: the line's shape is red, never amber "drawn differently from <line symbol>".
- Bubble on a printed sheet: when the judge matches a bubble to a closed outline with writing in it (`matchBubble` in `judgeShapes`), the window's ink leaves out every path lying wholly inside a writing box grown by 1 pt (letters drawn as ink are the tag, not the bubble). Judge only; the sweep's bubble pass is unchanged. Test: an invented ring with letter strokes inside and writing boxes over them is green as the bubble; the same ring with an extra bar across it outside the writing boxes is not.

- [ ] **Step 1: Write the failing tests**

```js
test('the pinned settings', () => {
  assert.equal(C.AMBER_ALIKE, 0.8); assert.equal(C.AMBER_EXPLAINED, 0.5); assert.equal(C.SIZE_TOL, 0.15); assert.deepEqual(C.JUDGE_BAND, [0.6, 1.6]);
});
test('sizeScaleOf: the median of five or more; 1 for four', () => {
  assert.equal(C.sizeScaleOf([1, 1, 1, 0.75, 0.75].map(k => ({ k }))), 1);
  assert.equal(C.sizeScaleOf([0.4, 0.41, 0.42, 0.4, 0.43].map(k => ({ k }))), 0.41);
  assert.equal(C.sizeScaleOf([0.5, 0.5, 0.5, 0.5].map(k => ({ k }))), 1);
});
test('a WIDGET drawn alone at 70% among WIDGETs at full size: amber, drawn at 70% of standard size', () => {
  const s = at(r, x, y);
  assert.equal(s.verdict, 'not-standard'); assert.deepEqual(s.reason, { kind: 'size', name: 'WIDGET', pct: 70 });
});
test('a WIDGET at 110%: green (inside 15%)', () => {});
test('a WIDGET at 120% on a sheet whose symbols are all at 120%: green (judged against the sheet scale)', () => { /* ctx.sizeScale 1.2 */ });
test('a stretched fit is judged on its larger side', () => { /* a VAT-like box at 1.3 × 1.0: size 130% → amber */ });
test('a WIDGET with an extra stroke off its pipe: amber, WIDGET with extra linework', () => {});
test('a body that explains under half its shape: red, no reason', () => {});
test('no body, closest 0.86 explaining 0.6: amber, drawn differently from GADGET (86% alike)', () => {});
test('no body, closest 0.86 explaining 0.3: red', () => {});
test('no body, closest 0.7: red', () => {});
test('the GADGET with its diagonal drawn 60% long: amber (alike) or red, never "line drawn short" as a verdict', () => {});
test('past the time limit: not-judged, standard null', () => {});
test('every ShapeOut has verdict and reason, and standard is true only for green', () => {});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `sizeScaleOf`, `hitSize` (with `placement.fitK` from `boxFit`), the band and the verdict step in `judgeShapes`.
- [ ] **Step 4: Run** the file → PASS; `npm test` → existing judge tests pinning `standard`/`why` still pass; tighten Task 3's corner-case test to the `extra` reason.

---

### Task 5: The sheet: crop, sheet scale, reading method, tag promotion, result fields

**Files:**
- Modify: `assets/js/pid-symbol-check.js` (`checkSheetAt`, `checkSheet`), `scripts/check-symbol-check.mjs` (one line)
- Test: `tests/pid-shape-verdicts.test.js`

**Interfaces:**
- Consumes: `drawingArea`, `insideArea` (Task 1), `readByLinePieces` (Task 2), `sizeScaleOf`, verdicts (Task 4).
- Produces: result fields `drawingArea`, `readFrom`, `sizeScale`, `printScale` (Data contract); exported `GREEN_SWITCH = 0.5`.

Rules (inside `checkSheetAt`, the shapes block):
1. `area = drawingArea(inp.paths, inp.pageSize)` (checked frame). Split shapes whose centre is outside the area are dropped before judging; judged shapes not `insideArea` are dropped after. Ids are renumbered 0..n−1 after the drop and the symbols' `shape`/`standard` mapped from the kept shapes (a listed symbol outside the area keeps `shape: null`).
2. `sizeScale = sizeScaleOf(listed hits)`; passed to `judgeShapes`.
3. Judge by path. If fewer than `GREEN_SWITCH` of the kept shapes are `standard`, split and judge again from `lp = readByLinePieces(inp.paths)` (with `boxed = boxesOf(lp)`, the same spots, near misses, rejected hits, writing and deadline), crop the same way, and keep the reading with more `standard` shapes (a tie keeps paths). `readFrom` says which. A symbol the judge recognises from line pieces is never added to `symbols`. Time: a line-pieces shape drawn exactly like a path shape (same box to 0.01 pt, same pieces as a multiset of segment coordinates to 0.01 pt) takes that shape's judgement without being judged again; `judgeShapes` gains `ctx.memo` (a Map the caller passes, empty on the first reading): it stores each judged shape's key → ShapeOut, and on a later reading a shape whose key is in it is copied (with its new id) instead of judged. Its return stays an array.
4. Tag promotion, after the tag verdicts are final ("The rest" pass): a red shape holding a listed symbol with a tag → `{ kind: 'extra', name: that symbol }`; then each tag whose verdict is `look` or `exception` and has a `tagBox` promotes the nearest red shape whose centre is within `cfg.radius` of the tag's centre (one shape per tag, nearest tag first) → `{ kind: 'tag', tag }`. Tag verdicts never change.
5. `checkSheet` scales `drawingArea.box` and `cuts` back like the other boxes; `printScale = round3(sheetScale × sizeScale)`.
6. `check-symbol-check.mjs` prints, after `shapes:`, one line: `  marks: G standard · A not to standard · R not identified · Read from: drawn paths|line pieces · Printed at N% of full size (when outside 95-105%) · Drawing area: frame found|frame not found, page edge used`.

- [ ] **Step 1: Write the failing tests** (invented sheets with a frame and a title strip drawn in, built from the Task 1 page and the fixtures' symbols)

```js
test('a WIDGET in the title strip and one on the frame line are not judged; one in the area is', () => {
  const r = run(FRAMED);
  assert.equal(r.drawingArea.found, true);
  assert.equal(r.shapes.filter(s => !C.insideArea(r.drawingArea, s.box)).length, 0);
  assert.equal(r.symbols.length, 3, 'the symbol list is unchanged');
});
test('shape ids run 0..n-1 after the crop and every symbol points at its shape or null', () => {});
test('a sheet with no frame: found false, the same shapes as with the crop switched off', () => {});
test('a turned framed sheet: no judged box outside the area', () => { /* viewportTransform [0, 1, 1, 0, 0, 0] */ });
test('a sheet of rings drawn as arcs: read from line pieces, rings green; the tag verdicts and symbols unchanged', () => {
  assert.equal(r.readFrom, 'line-pieces');
  assert.deepEqual(r.verdicts, byPath.verdicts); assert.deepEqual(r.symbols.map(s => s.name), byPath.symbols.map(s => s.name));
});
test('a clean sheet stays read from drawn paths', () => {});
test('a sheet printed at 0.45: sizeScale ~1, printScale ~0.45, boxes and drawing area on the page as drawn', () => {});
test('a tag with no symbol beside a red shape: amber, tag T has no standard symbol; the tag verdict is unchanged', () => {});
test('a tag 80 pt from a red shape promotes nothing', () => {});
test('goal 5: verdicts deep-equal and symbol names and boxes equal with shapes on and off', () => { /* SHAPE_SHEET, SHEET, BUBBLE_SHEET, SWEEP_SHEET */ });
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** rules 1-6.
- [ ] **Step 4: Run** the file → PASS; `npm test` → all pass.

---

### Task 6: The screen

**Files:**
- Modify: `assets/js/pid-symbol-check-view.js`; `tools-src/pid-tag-register.html` (anchored CSS patch after a backup in `.superpowers/sdd/2026-11-18-pid-shape-check-redesign/`)
- Test: `tests/pid-symbol-check-view.test.js`

**Interfaces:**
- Consumes: Data contract.
- Produces: `export function reasonText(shape) -> string` (the four fixed copies); `export function markLine(result) -> string` ("23 standard · 12 not to standard · 140 not identified · Read from: line pieces · Printed at 41% of full size", plus " · Drawing area: frame not found, page edge used" when `drawingArea.found === false`; "" when the result has no shapes); exported `NOT_IDENTIFIED_COLOUR = '#C62828'`, `KEY_NOT_STANDARD`, `KEY_NOT_IDENTIFIED` (spec copy).

Rules:
- `boxRects`: green `standard` as today; amber `not-standard` numbered 1.. in list order; red `not-identified`, unnumbered; `not-judged` as today; one `area` rect for the drawing area (and none when not found). Titles: amber "Not to standard: <reasonText>."; red "Not identified: check by eye.".
- `resultsHtml`: trial note stays; `markLine` under it; the "Not to standard" list holds amber only, each row `reasonText`, jump to box as today; red is one line "N not identified (boxed in red on the drawing)", no rows. Standard list as today. `symbolSummary`'s shape sentence becomes the three counts.
- CSS (tools-src, anchored after the `.sc-box.sc-standard` line): `.sc-box.sc-not-identified { border: 1px solid #C62828; }` and `.sc-box.sc-area { border: 1px solid rgba(0,0,0,.18); pointer-events: none; }`. The owner runs `node scripts/lock-tools.mjs`.

- [ ] **Step 1: Write the failing tests**: `reasonText` for each kind (exact copy); `markLine` with and without printScale outside 95-105 and with frame not found; `boxRects` gives red rects without numbers, amber numbered 1..n, one area rect; `resultsHtml` lists amber rows only and one red count line, and escapes a hostile name in a reason.
- [ ] **Step 2: Run** `node --test tests/pid-symbol-check-view.test.js` → FAIL.
- [ ] **Step 3: Implement**; patch the tool CSS (backup + sha first, anchored replace, count of matches = 1).
- [ ] **Step 4: Run** → PASS; `npm test` → all pass.

---

### Task 7: The report

**Files:**
- Modify: `assets/js/pid-symbol-report.js`, `assets/js/pid-symbol-report-pdf.js`
- Test: `tests/pid-symbol-report.test.js`, `tests/pid-symbol-report-pdf.test.js`

**Interfaces:**
- Consumes: `reasonText`, `markLine`, `NOT_IDENTIFIED_COLOUR`, keys (Task 6).
- Produces: per sheet in the model: `shapeLine = markLine(result)`, `shapeRows` (amber only, numbered from 1, detail = `reasonText`), `redRows: [{ userRect }]` (no label, no number), `areaRect` (user space, or null), `notIdentifiedCount`; `PRINT_COLOURS['not-identified']`.

Rules:
- Drawing page: green named as today; amber dashed and numbered as today; red a solid thin line (0.5 pt), unnumbered; the drawing area drawn faintly (0.3 pt, light grey).
- Pictures page and the not-to-standard table: amber only. Red never gets a picture or a row.
- Front page per-sheet table gains a "Not identified" column; the key: green standard; amber `KEY_NOT_STANDARD`; red `KEY_NOT_IDENTIFIED`; trial note stays.
- Workbook: the Sheets sheet gains "Not identified" after "Not to standard"; the Symbols sheet drops rows for red shapes that hold no listed symbol.
- Results with no shapes keep the old layout (unchanged tests).

- [ ] **Step 1: Write the failing tests**: model rows amber-only and numbered; red rects present with no label; `shapeLine` equals `markLine`; PDF draws red boxes with border width 0.5 and no number text, no picture for red; front table column; workbook column.
- [ ] **Step 2: Run** both files → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `npm test` → all pass.

---

### Task 8: The gate (controller, private measurement)

**Files:** private only, `../pid-symbol-spike/phase4-build/`; this plan's Outcome.

- [ ] **Step 1: No harm.** `bash noharm.sh after` then `python -I noharm_diff.py baseline after` (baseline taken from HEAD 7aae000 before Task 1). Expected: `NO HARM`; wrong family 0 on every sheet.
- [ ] **Step 2: Judge the ten sheets** with `probe4.mjs` (same inputs as `foreign/run-foreign.sh` and `held-out/probe-p3-why.mjs`), writing `<sheet>-p4-shapes.json` (ShapeOut + `drawingArea`, `readFrom`, `printScale`, `ms`). Two at a time at most.
- [ ] **Step 3: Score** with `score4.py` (imports `phase4-measure/labels.py`, maps answers onto the new shapes as `score.py` does, cropped = answered place with no judged shape inside the area). Expected: amber on ≤ 4 of the "not a symbol"; amber on ≤ 13 of the "standard" and green on ≥ 20; all right flags amber or red. Report green, and the denominators.
- [ ] **Step 4: Border.** `area-pictures.py` draws each sheet with its drawing area and every box; look at all ten. Expected: no box outside the area.
- [ ] **Step 5: Time.** Expected: no sheet over 60 s (`ms`, and wall time from the probe).
- [ ] **Step 6: Tune only on P1, P2, C, M** if a gate fails, each change test-first; re-run Steps 1-5. Never tune on H1-H6.
- [ ] **Step 7: Browser.** The tool on an invented framed sheet (private folder, removed after): three marks, red solid, area faint, amber list + red count, jump to an amber box, report pages, `register.json` unchanged, no console errors.
- [ ] **Step 8: Outcome** below: counts only.

### Task 9: The owner's eye (held out)

- [ ] **Step 1:** Numbered picture PDF of every amber shape on H2-H6 (tile maker adapted from `held-out/flags-sheet-h2.py`, caption = `reasonText`), plus one red overview page per sheet (the sheet drawn with its red boxes and the drawing area). Private, in `../pid-symbol-spike/phase4-build/`.
- [ ] **Step 2:** Send it to the owner with plain questions ("for each number: right flag, standard, or not a symbol"; "anything in red that should be amber?"). Wait for his answers. Target: at least 3 in 4 amber called right.

## Gate (from the spec)

1. **No harm.** Tag verdicts and symbol lists identical to the post-7aae000 baseline on A, B, C, M, P1, P2 and the supplier sheet. Wrong family stays 0.
2. **Against his answers.** Private scorer re-run on the new shapes, no worse than the measured design: amber on at most 4 of the 36 "not a symbol"; amber on at most 13 of the 77 "standard", green on at least 20; all 9 right flags boxed, amber or red. Report the green count too.
3. **Border.** No box outside the drawing area on any of the ten sheets, checked on a picture of each.
4. **His eye, held out.** Numbered picture PDF of every amber shape on H2-H6, answered in plain words; target at least 3 in 4 amber called right. A red-box overview page per sheet goes to him too.
5. **Time.** No sheet over 60 s on his machine.
6. `npm test` green, each new rule test-first on invented data.

## Outcome

Measured 2026-11-18 on the owner's machine, Tasks 1-7 uncommitted on HEAD 7aae000. Counts only; sheets and scripts private in `pid-symbol-spike/phase4-build/`.

1. **No harm: PASS.** A, B, C, M, P1, P2, supplier: symbol lists identical to the post-7aae000 baseline (12, 18, 102, 45, 11, 21, 0), tag-verdict lines 0 different, wrong family 0 on every sheet.
2. **Against his answers: PASS** (after his rulings of 2026-11-18 that H1 live#32/#33 and P2's four reducers are right as amber; H6 is not a P&ID and holds no answers).
   - Not a symbol: 17 still judged, amber 1 (limit 4); the rest cropped or no longer a shape.
   - Right flags: 15 of 15 boxed (8 amber, 7 red), none green (live trial on the same labels: 4 green).
   - Standard: 71; green 30 (needs 20; live trial 16), amber 12 (limit 13), red 29. The 12: C's 9 ball valves with a flow arrow and signal tick the library lacks, P1 #3 (body drawn at 126%), P1 #12, M #170.
   - All ten sheets: green 336, amber 161, red 547.
3. **Border: PASS.** 0 boxes outside the drawing area on all ten sheets; frame found on all ten (pictures checked).
4. **His eye, held out: FAIL.** 80 amber tiles on H2-H5 answered 2026-11-18: 33 right flags (H3's two half-filled valves ruled right: not in the legend), 38 standard, 9 not a symbol: 41% called right against the target of 75%. By reason: size 16 of 24 right; drawn differently 13 of 24; with extra linework 3 of 31 (28 standard valves with standard attachments: flanges, actuators, T-handles, flow arrows); tag 1 of 1. 7 of the 9 not-a-symbol amber are line corners and crossings read as sheet 4's FLOW DIRECTION ARROW. Red overviews: standard symbols the library lacks or cannot combine (LINE TYPES arrows and hatches, demarcation, rim marks, touching bubbles, multi-attachment valves), and some vendor symbols that should be amber. H2-H5 are now answered sheets, no longer held out.
5. **Time: PASS.** On mains, wall seconds HEAD → new: P1 10 → 11, P2 17 → 27, C 29 → 28, M 15 → 16, H1 20 → 20, H2 34 → 44, H3 15 → 19, H4 19 → 20, H5 8 → 12, H6 26 → 32. Slowest 44 s.
6. **Tests: PASS.** `npm test` 1213 tests, 1211 pass, 0 fail, 2 skipped (after the final review's fix wave).

Also measured: no sheet chose the line-pieces reading; the printed-bubble rule took H1's green from 23 to 40. Sheet scales read: H1 41%, H2 43%, H3 80%, P2 122%, H6 128%, the rest 97-100%.
