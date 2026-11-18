# P&ID symbol check, phase 3: whole shapes. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every symbol-sized drawn shape on a sheet with linework is judged
**standard** or **not to standard**. A shape is standard when standard
symbols explain all of its ink: one symbol, or a body plus a legend operator
on its stem. A flagged shape says why, and names the closest standard symbol
and its score. Every change is measured against the owner's marked answer
key.

**Architecture:**
- A new pure splitter in `pid-sheet-read.js` (`sheetShapes`) cuts the
  sheet's ink into shapes. Long straight runs, dashed runs, lagged-pipe
  hatching and connectors are taken out as **lines**.
- In `pid-symbol-check.js`, `checkSheet` runs a new `judgeShapes` after the
  sweep and the tag pairing:
  - it keeps the sweep's near-misses instead of dropping them;
  - it places owner-marked operators on leftover ink beside a body;
  - it tries plain symbols as whole-shape matches;
  - it measures how much of each shape's ink is explained.
- The sweep's own ink, its hits and every tag verdict are unchanged.
- The gate script writes shapes for private pre-filled answer-key PDFs. A
  new script-side module reads the owner's marked PDFs back and scores the
  check against them.

**Tech Stack:**
- Vanilla ES modules, no build; `node --test`.
- pdf.js 3.11.174, ExcelJS and pdf-lib, already vendored.
- Gate tooling only: the PyMuPDF already on this machine (not a repo
  dependency).

**Spec:** `docs/superpowers/specs/2026-11-17-pid-whole-shape-check-design.md`
(approved 2026-11-17). Read all of it before starting. The governing spec
`2026-11-16-pid-every-pdf-format-design.md` and the phase 2 plan's
**Outcome** (`2026-11-16-pid-symbols-first-phase2.md`) say what is already
built.

## Global Constraints

**Writing and data**
- **Nothing writes `register.json` or the register folder.** No new code or
  glue calls `saveToFolder`, `scheduleSave`, `mergeState`,
  `buildRegisterState`, `snapshotRev` or `createWritable`. The `operator` tick
  is saved through the existing library save path (`symApply`), as the
  `simple` tick is today.
- **The repository is public.** No client data (drawing numbers, real tags,
  legend names or geometry, firm names) in `assets/js/`, `scripts/`, `docs/`,
  `tests/` or fixtures. Tests use invented symbols and tags like `21-W-1001`.
  **Operator names never appear in code:** they come from the owner's
  library at run time.
- **Real sheets, answer keys and gate output stay out of git**, in
  `../pid-symbol-spike/every-format-gate/` and
  `../pid-symbol-spike/answer-key/`. Sheets are named only in those
  folders' `README.txt`.
- **No new dependency. No OCR library.**

**Tool and process**
- **`tools-src/` is gitignored.** Tool edits are anchored patches after a
  backup in `.superpowers/sdd/2026-11-17-pid-whole-shape-check/`
  (gitignored). Never run `scripts/lock-tools.mjs`; the owner does.
- **Do not commit unless the owner asks.** Each task's last step is a
  checkpoint: run `npm test`, and stage nothing.

**Behaviour that must not change**
- **The sweep's ink, hits and listed symbols are unchanged.** Line rules
  serve only the splitter and the judge.
- **Tag verdicts are unchanged.** On every existing fixture, `checkSheet`
  verdicts with and without phase 3 stay deep-equal.
- **The check still confirms the family, not the member.** `FAMILY_NOTE`
  and `SHORT_NOTE` are unchanged.
- **Every new function degrades on hostile input** (never throws), as
  `pid-symbol-check.js` and `pid-sheet-read.js` do today.

**Values**
- **Pinned, unchanged:**
  - recognise `0.90`; `oneOf` `0.03`; `inkTol` `0.5`; `minScale` `0.75`;
    `maxScale` `1.35`;
  - `plainBack` `0.96`; `LINE_MIN` `0.85`; near-miss floor `0.3`
    (`NEAR_MISS_FLOOR`); `RUN_GAP` `2` pt; `STROKE_JOIN` `0.5` pt;
  - time limit `120000` ms; gate time under `60` s a sheet.
- **Starting values, tuned only at the gate (Task 8) on the tuning set, and
  recorded in the Outcome:**
  - `SHAPE_EXPLAINED` `0.97`;
  - a long run is longer than the longest segment of any checkable library
    symbol × `maxScale`;
  - dashed run: at least `3` collinear dashes, each gap within `30%` of the
    run's median gap;
  - hatch row: at least `4` identical short diagonals between two parallel
    runs;
  - key box overlap: at least `0.5` of the smaller box.

## Review Focus

1. **A standard symbol beside a pipe tee or a crossing.** A valve near a
   junction must not become one shape with the branch pipe's stub. Expected:
   the valve's shape holds only the valve; the stub is line. Test in Task 1.
2. **A pipe drawn straight through a symbol** (a flowmeter body over a
   continuous line). Expected: the part the found symbol explains goes with
   the shape, the rest stays line, and the shape reads standard. Tests in
   Tasks 1 and 4.
3. **Operators not ticked yet** (an older library). Expected: a body with an
   operator reads `left-over`, and the summary says operators are not marked
   in the library. It is never silent. Tests in Tasks 4 and 6.
4. **A huge or empty sheet.** 20,000 invented strokes are split in under 2 s
   in node. A page with no ink gives `shapes: []`. Hostile page sizes return
   at once. Tests in Tasks 1 and 4.
5. **A marked PDF the reader cannot fully use**, such as a comment whose
   first word is neither STANDARD nor NOT STANDARD, a name not in the
   library, a rotated page, or a non-rectangle mark-up. Expected: each is
   counted and listed, and none is guessed or thrown on. Tests in Task 3.

---

## File map

| File | Change |
|---|---|
| `assets/js/pid-sheet-read.js` | `sheetShapes`, line classes (Task 1). |
| `assets/js/pid-symbol-check.js` | near-misses kept in `sweep`; `judgeShapes`; `checkSheet` returns `shapes`; `SymbolOut` gains `shape`, `standard` (Task 4). |
| `assets/js/pid-symbols.js` | `operator` flag in `updateSymbol`, `carryOver`; `markGroupOperators` (Task 5). |
| `assets/js/pid-symbols-view.js` | Operator tick and group button on the edit card; badge (Task 5). |
| `assets/js/pid-symbol-check-worker.js` | passes `shapes` through (Task 6). |
| `assets/js/pid-symbol-check-view.js` | summary, Not to standard list first, amber boxes, operators-not-marked note (Task 6). |
| `assets/js/pid-symbol-report.js`, `pid-symbol-report-pdf.js`, `pid-symbol-report-run.js` | Symbols sheet columns; amber boxes; summary count (Task 7). |
| `scripts/check-symbol-check.mjs` | `--shapes-out`, `--operators`, shape counts line (Task 2); `--key` (Task 3). |
| `scripts/answer-key.mjs` (new) | `readAnswerKey`, `scoreAgainstKey` (Task 3). |
| `tests/fixtures/symbol-check-sheet.js` | `HANDLE` operator, `BODY_SHEET`-style helpers (Tasks 1, 4). |
| `tests/*.test.js` | new tests per task; `tests/answer-key.test.js` new. |
| `tools-src/pid-tag-register.html` | glue only, anchored patch (Tasks 5, 9). |
| Private | `../pid-symbol-spike/answer-key/make-key-copy.py`, README, marked PDFs. |

---

### Task 1: The shape splitter (`sheetShapes`)

**Files:**
- Modify: `assets/js/pid-sheet-read.js`, `tests/fixtures/symbol-check-sheet.js`
- Test: `tests/pid-sheet-read.test.js`

**Interfaces:**
- Consumes: page paths as `pagePaths` gives them (page points, top-left);
  `STROKE_JOIN`; `glyphsOf` / row logic (for the hatch row).
- Produces:
  - `sheetShapes(paths, options) -> { shapes: Shape[], lines: Line[], segments }`.
    - `options = { minSide, maxSide, longRun, skip }`: the symbol-size band
      in points, the long-run length, and an optional box not split (the
      title block).
    - `Shape = { id: number, box: [x0, y0, x1, y1], pieces: number[], closed: boolean }`.
      `pieces` are indexes into the flattened segment list `segments`,
      returned alongside as `{ shapes, lines, segments }`.
      `segments = [x0, y0, x1, y1, len, pathIndex][]`.
      `closed` = the shape is one closed outline (a bubble candidate).
    - `Line = { kind: 'run' | 'dashed' | 'hatch' | 'connector', pieces: number[] }`.
  - `export const SHAPE_JOIN = 0.5, DASH_MIN = 3, HATCH_MIN = 4;`
  - Rules, in order:
    1. Flatten paths to segments.
    2. Collinear pieces within `RUN_GAP` join into runs; a run longer than
       `longRun` is a `run` line.
    3. `DASH_MIN` or more short collinear pieces with even gaps are a
       `dashed` line.
    4. Two parallel `run` lines with `HATCH_MIN` or more identical short
       diagonals between them: the diagonals are a `hatch` line.
    5. Where a line passes through another piece's end or crossing, the line
       is cut there. Line pieces never join shapes.
    6. The remaining pieces group, through a grid hash, wherever ends or
       crossings lie within `SHAPE_JOIN`.
    7. A straight piece joining two groups whose boxes are each at least
       `minSide`, and which is not inside either box, is a `connector`.
    8. A closed outline is its own shape, even when touched.
    9. Shapes with a longer side under `minSide` or over `maxSide` are
       dropped.
  - Through-lines (spec *Shapes*) are settled in Task 4, which hands the
    pieces a found symbol explains back to its shape. `sheetShapes` itself
    leaves them as line.
- Fixture: `HANDLE = sym('s15', 'HANDLE', 'HANDLES', '', 10, 8, [line([5, 8, 5, 0]), line([0, 0, 10, 0])], { simple: true })`
  (a T: stem and bar, too plain to sweep). Tasks 4 and 5 make it an operator.
  `bodyWithHandle(x, y)` places a WIDGET with a HANDLE on its top centre.

- [ ] **Step 1: Write the failing tests** (invented sheets, `place` and `line`):
  - a WIDGET on a horizontal pipe running 200 pt each side → 1 shape (the
    WIDGET's box ± 1 pt); the pipe pieces are in a `run` line;
  - `bodyWithHandle` on a pipe → 1 shape holding both;
  - a WIDGET 15 pt from a pipe tee, the branch pipe running off → 1 shape,
    holding no branch-pipe piece;
  - a ring outline (closed) with a 30 pt leader to a WIDGET → 2 shapes and 1
    `connector`;
  - a dashed line (3 pt dashes, 2 pt gaps, 120 pt) with nothing else → no
    shape, 1 `dashed` line;
  - two parallel 200 pt runs 4 pt apart with 20 short diagonals → no shape,
    `hatch` and `run` lines;
  - a 1 pt tick and a 400 × 300 tank outline → no shape (size band);
  - a shape inside `skip` → not split;
  - 20,000 invented short strokes → under 2 s;
  - hostile (`null`, NaN segs, odd-length segs, `options` missing) → `{ shapes: [], lines: [], segments: [] }`.
- [ ] **Step 2: Run to see them fail.** `node --test tests/pid-sheet-read.test.js` → FAIL, `sheetShapes` not exported.
- [ ] **Step 3: Implement `sheetShapes`.** Grid-hash ends (cell =
  `longRun / 4`, at least 5 pt), so the cost grows with the number of
  pieces. Header comment: it splits linework, it recognises nothing.
- [ ] **Step 4: Run to see them pass;** `npm test` green.
- [ ] **Step 5: Checkpoint.**

---

### Task 2: Shapes out of the gate script, and the answer-key copies

**Files:**
- Modify: `scripts/check-symbol-check.mjs`, `tests/check-symbol-check.test.js`
- Private: `../pid-symbol-spike/answer-key/make-key-copy.py`, `README.txt`

**Interfaces:**
- Consumes: `sheetShapes` (Task 1); the script's existing `readSheet`,
  `insideRepo`, `--words`, `--symbols-out`.
- Produces:
  - `--shapes-out <file>`: JSON
    `{ sheet, page: { w, h, rotate }, shapes: [{ id, box, name: string|null, score: number|null }] }`.
    - `name` is the listed symbol whose box centre lies in the shape (the
      highest score if several), else `null`.
    - Boxes are in page points, top-left, unrotated page frame.
    - It is refused inside the repository (as `--symbols-out`), because the
      names are legend data.
  - `--operators "<table heading>"` (repeatable): marks every symbol under
    that heading as an operator for this run, as `--set-tag-id` sets tag
    ids. It is used from Task 4 on.
  - A counts line, always: `  shapes: N (lines: run R, dashed D, hatch H, connector C)`.
  - `make-key-copy.py <sheet.pdf> <shapes.json> <out.pdf>` (private, run
    `python -I`):
    - writes a copy with one rectangle (Square) annotation per shape;
    - contents are `STANDARD: <name>` where `name` is set, else
      `NOT STANDARD`;
    - author `answer-key`;
    - boxes go through `page.derotation_matrix` for rotated pages.

- [ ] **Step 1: Write the failing tests.**
  - `--shapes-out` under the repo root → exit 1, no file.
  - The shapes JSON of an invented sheet (`sheetPdfBytes` with a WIDGET on a
    pipe) → 1 shape, `name: 'WIDGET'`.
  - The counts line is printed.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement** the two flags and the counts line. The band is
  the smallest and largest checkable symbol × `minScale` / `maxScale`. The
  long run is as in Global Constraints. `skip` is `titleBlockBox`.
- [ ] **Step 4: Run to see them pass;** `npm test` green.
- [ ] **Step 5: Make the tuning-set copies** (P1, P2, C and M, with each
  sheet's `--words` as in the phase 2 gate) into
  `../pid-symbol-spike/answer-key/<letter>-key.pdf`. Open one with PyMuPDF
  and check that the annotation count equals the shape count. Record the
  sheets in the README.
- [ ] **Step 6: Owner pause: hand the copies to the owner** with these
  steps, in plain words:
  1. Open each `-key.pdf` in Bluebeam or Acrobat and look at every box.
  2. Where the comment is wrong, change its first word (`STANDARD` or
     `NOT STANDARD`) or the name after the colon.
  3. Delete any box that is not a symbol.
  4. Draw a rectangle round any symbol with no box, and type
     `STANDARD: <name>` or `NOT STANDARD`. Do not box tanks, vessels or
     other large equipment.
  5. Save, and say which sheets are done.

  Also ask for the 2 to 4 held-out contractor sheets. Their copies are made
  the same way, but **not** run through the judge until Task 8 step 6.
  Tasks 3 to 7 continue while the owner marks.
- [ ] **Step 7: Checkpoint.**

---

### Task 3: Reading and scoring the answer key (`scripts/answer-key.mjs`, `--key`)

**Files:**
- Create: `scripts/answer-key.mjs`
- Modify: `scripts/check-symbol-check.mjs`
- Test: `tests/answer-key.test.js`

**Interfaces:**
- Consumes: pdf.js annotations (`subtype`, `rect`, `contentsObj.str`), the
  page's `viewport.transform`, `normName` and `searchSymbols` from
  `pid-symbols.js`, `checkSheet`'s `shapes` and `symbols` (Task 4; until
  then, the shapes JSON of Task 2).
- Produces:
  - `readAnswerKey(annotations, viewportTransform, library) -> { boxes: KeyBox[], unread: { reason, text }[] }`.
    - `KeyBox = { box, standard: boolean, name: string|null, family: string|null }`.
    - Only `Square` (and `Polygon` with 4 points) annotations count.
    - First word, case-insensitive: `STANDARD` or `NOT STANDARD` (also
      `NOT-STANDARD`, `NON STANDARD`); anything else goes to `unread`
      (`'first word'`).
    - The name after `:` is matched with `normName`, then the top
      `searchSymbols` hit. No match goes to `unread` (`'name'`) and keeps
      `name: null`.
    - `family` is the matched symbol's `tagId`.
  - `scoreAgainstKey(key, shapes, symbols, { overlap = 0.5 } = {}) -> Score`:
    - Matching is one to one, greatest overlap first. Overlap is the
      intersection over the smaller box.
    - `Score = { keyStandard, keyNot, caught, falseFlags, missed, notASymbolFlagged, namedRight, toolShapes, unread }`
      (counts), plus `lists` of each (boxes and names) for `--verbose` only.
  - `--key "<marked pdf>"` prints, counts only:
    `  key: standard S, not standard N; caught C of N; false flags F of S; missed M; flagged not-a-symbol X; named right R of S; unread U`.

- [ ] **Step 1: Write the failing tests** (invented annotation objects and
  invented library):
  - `STANDARD: widget` → standard, name `WIDGET`, family `W`;
  - `not standard` → standard false, name null;
  - `NOT STANDARD: closest GADGET` → name `GADGET`;
  - `maybe` → unread `'first word'`;
  - `STANDARD: BANANA` → unread `'name'`;
  - a `Circle` annotation → ignored;
  - a rotated viewport transform → box in page points, matching an
    unrotated twin;
  - scoring:
    - one key box over two tool shapes → 1 matched, 1 tool shape unboxed;
    - two key boxes over one tool shape → 1 missed;
    - a flagged tool shape the owner deleted → `notASymbolFlagged 1`;
  - hostile (`null`, NaN rects, missing contents) → empty, no throw.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement** `answer-key.mjs` (pure, no pdf.js import), then
  wire `--key` into the script. The script loads the marked PDF's
  annotations with the vendored pdf.js, as `--words comments` does.
- [ ] **Step 4: Run to see them pass;** `npm test` green.
- [ ] **Step 5: Checkpoint.**

---

### Task 4: Judging shapes (`pid-symbol-check.js`)

**Files:**
- Modify: `assets/js/pid-symbol-check.js`, `tests/fixtures/symbol-check-sheet.js`
- Test: `tests/pid-symbol-check.test.js`

**Interfaces:**
- Consumes: `sheetShapes` (Task 1); `sweep`, `mergeHits`, `scorePlacement`,
  `proposePlacements`, `weakestLine`, `runsOnPastCorner`, `matchBubble`,
  `windowFrom`, `rasterise`, `dilate`, `plainShape`.
- Produces:
  - `sweep` with `raw: true` also returns `near: Hit[]`: per grid window,
    each placement scoring at least `NEAR_MISS_FLOOR` but rejected (under
    `recognise`, `LINE_MIN`, plain care, unwritten). Each carries `score`,
    `forward`, `backward`, `weak` (its `weakestLine`). No other output
    changes.
  - `CHECK_DEFAULTS` gains `shapeExplained: 0.97`.
  - `prepareOne` sets `out.operator = flags.operator === true`. An operator
    is never swept (it stays out of `checkable` sweeping) but is prepared
    with points even when `simple`.
  - `judgeShapes(ctx) -> ShapeOut[]`, with
    `ctx = { cfg, prepared, boxed, split (the whole sheetShapes result: shapes, lines, segments), spots (merged sweep and tag-led spots), near, writing, deadline }`:
    1. A spot belongs to the shape holding most of its template ink. A spot
       sharing ink with two shapes joins them. Line pieces lying within
       `inkTol` of a spot's template join that spot's shape (the
       through-line rule).
    2. Operators: in a shape holding a non-operator spot, each `operator`
       symbol is proposed on the shape's unexplained ink within one
       operator's size of the body. It is kept at score ≥ `recognise` with
       every line ≥ `LINE_MIN`. Its stem pieces count as explained.
    3. Plain symbols (`simple`, not operator, not stretch or manual) are
       tried on shapes with no spot. They are kept when the whole shape's
       ink is explained both ways at ≥ `plainBack` and
       `!runsOnPastCorner`.
    4. Bubbles: a `closed` shape with writing inside, matched by
       `matchBubble` on its box.
    5. `explained` = the shape's ink pixels within `inkTol` of the union of
       its kept templates, over its ink pixels.
    6. Verdict:
       - standard when `explained ≥ shapeExplained`, every kept hit ≥
         `recognise` and every line ≥ `LINE_MIN`;
       - else `why`: `'left-over'` (a kept hit, ink left);
         `'short-line'` (best candidate failed `LINE_MIN`; `share` given);
         `'no-fit'` (none);
       - an operator spot alone in a shape → `'left-over'`.
    7. `closest`: among kept hits and `near` on the shape, the one whose own
       template explains the largest share of the shape (ties: higher
       score), if its score ≥ `NEAR_MISS_FLOOR`.
    8. Past `deadline`: the remaining shapes get `standard: null`,
       `why: 'time'`.
  - `ShapeOut = { id, box, standard: true|false|null, why: 'left-over'|'short-line'|'no-fit'|'time'|null, explained, share: number|null, symbols: number[], operator: { name, score }|null, closest: { name, tagId, score, explained }|null }`.
  - `checkSheet` (when the sweep runs and `options.shapes !== false`):
    - calls `sheetShapes` with the band and title block, then
      `judgeShapes`;
    - returns `shapes` and `operatorsMarked` (any prepared `operator`);
    - each `SymbolOut` gains `shape` (id or null) and `standard`
      (its shape's, or null).
- Fixture:
  - a `HANDLE` marked `{ operator: true }` in `OPERATOR_LIBRARY`;
  - `SHAPE_SHEET`, an invented sheet holding:
    - a WIDGET on a pipe;
    - `bodyWithHandle`;
    - a WIDGET with an extra 8 pt stroke outside its box;
    - a GADGET with its diagonal drawn 60% long;
    - an invented 3-stroke squiggle;
    - a ring with a tag in it;
    - a ring with nothing in it;
    - a dashed line ending in a SIGNAL-like dash.

- [ ] **Step 1: Write the failing tests** on `SHAPE_SHEET`:
  - the WIDGET on a pipe → standard, `explained ≥ 0.97`;
  - `bodyWithHandle` → standard with `operator.name === 'HANDLE'`;
  - the same with `LIBRARY` lacking the operator flag → `left-over`, and
    `operatorsMarked: false`;
  - the WIDGET with the extra stroke → `left-over`, closest WIDGET;
  - the short GADGET → `short-line`, `share` between 0.55 and 0.65;
  - the squiggle → `no-fit`, `closest` null or below a score;
  - the tagged ring → standard;
  - the bare ring → not standard;
  - the dashed line → no shape;
  - a circle with extra ink where a larger invented symbol explains more →
    `closest` names the larger;
  - a WIDGET over a continuous pipe drawn through it → standard;
  - goal 5: verdicts deep-equal with `options.shapes: false` on `SHEET`,
    `BUBBLE_SHEET`, `SWEEP_SHEET`, `PRINTED_SHEET`;
  - `symbols` deep-equal apart from the new `shape` and `standard` fields;
  - a 1 ms `timeLimitMs` → shapes all `why: 'time'`, never standard;
  - hostile `shapes` input → `shapes: []`.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** Reuse the sweep's windows (`windowFrom`)
  rather than rasterising the page again. Rasterise each shape once at
  `pxPerPt`.
- [ ] **Step 4: Run to see them pass;** `npm test` green, every earlier
  check test unchanged.
- [ ] **Step 5: Checkpoint.**

---

### Task 5: The operator flag in the library and the Symbols tab

**Files:**
- Modify: `assets/js/pid-symbols.js`, `assets/js/pid-symbols-view.js`
- Test: `tests/pid-symbols.test.js`, `tests/pid-symbols-view.test.js`
- Tool: `tools-src/pid-tag-register.html` (anchored patch, after backup)

**Interfaces:**
- Produces:
  - `updateSymbol` accepts `operator: boolean` → `flags.operator`.
  - `carryOver` keeps `flags.operator` like `simple`, and counts it as hand
    work.
  - `markGroupOperators(library, group, on) -> library`: sets
    `flags.operator` on every symbol whose `group` equals `group` (trimmed,
    case-insensitive). It returns the same library object when nothing
    changes.
  - Edit card:
    - check `operator` labelled
      `Operator: a handwheel, lever or actuator that sits on another symbol`;
    - a button `mark-group-operators` labelled
      `Mark every symbol under this table heading as an operator`;
    - badge `Operator`.
  - Glue:
    - `symCardPatch` reads `operator`;
    - a click on `mark-group-operators` calls
      `symApply(PS.markGroupOperators(lib, group, true))`, after a
      `confirm` naming the count.

- [ ] **Step 1: Write the failing tests:**
  - `updateSymbol` sets and clears `operator`;
  - `carryOver` keeps it across a re-import;
  - `markGroupOperators` marks 2 of 3 invented symbols by heading, leaves
    the other, and returns the same object for an unknown heading;
  - the edit card holds the tick and button; the badge shows;
  - hostile input does not throw.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement** the pure parts.
- [ ] **Step 4: Run to see them pass;** `npm test` green.
- [ ] **Step 5: Patch the tool glue** (backup first; anchors matched once
  each; `node --check` on the classic script; the save-call counts
  `register.json`, `saveToFolder(`, `scheduleSave(`, `createWritable(` are
  the same before and after).
- [ ] **Step 6: Checkpoint.**

---

### Task 6: Worker and screen

**Files:**
- Modify: `assets/js/pid-symbol-check-worker.js`, `assets/js/pid-symbol-check-view.js`
- Test: `tests/pid-symbol-check-worker.test.js`, `tests/pid-symbol-check-view.test.js`

**Interfaces:**
- Consumes: `checkSheet` result `shapes`, `operatorsMarked` (Task 4).
- Produces:
  - The worker passes `shapes` and `operatorsMarked` through unchanged.
  - `symbolSummary` adds `N standard symbols. M shapes not to standard.` and,
    when shapes were judged and `operatorsMarked` is false, the exported
    `OPERATORS_NOTE = 'Operators not marked in the library: valves with an operator will be flagged.'`.
    Shapes past the time limit add `K shapes not judged: time limit.`
  - `resultsHtml` lists **Not to standard** first, one row per flagged
    shape:
    - why, in words (`ink left over`, `line drawn short (NN%)`,
      `no standard symbol fits`);
    - `closest: <name> NN%`, or `no close symbol`;
    - jump to box.
    The tag and untagged-symbol lists follow as now.
  - `boxRects` gives flagged shapes `kind: 'not-standard'` (drawn amber
    `#E08E00`, dashed) and time-limited ones `kind: 'not-judged'` (grey).
    A standard shape's symbols are drawn as now.
- [ ] **Step 1: Write the failing tests** for each line above, plus a result
  with no `shapes` field (an older worker) rendering exactly as today.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to see them pass;** `npm test` green.
- [ ] **Step 5: Checkpoint.**

---

### Task 7: Report runner, Excel and PDF

**Files:**
- Modify: `assets/js/pid-symbol-report.js`, `assets/js/pid-symbol-report-pdf.js`, `assets/js/pid-symbol-report-run.js`
- Test: `tests/pid-symbol-report.test.js`, `tests/pid-symbol-report-pdf.test.js`, `tests/pid-symbol-report-run.test.js`

**Interfaces:**
- Produces:
  - The Symbols sheet is **one row per judged shape**: its symbols, joined
    with ` + ` with the operator last, or blank.
  - New columns after `Note`: `To standard?` (`Yes` / `No` / `Not judged`),
    `Why`, `Closest`, `Score %`.
  - Shapes come first by `To standard?` = No.
  - A listed symbol with no shape (`shape: null`) keeps a row as today, with
    `To standard?` blank.
  - The Sheets sheet gains a `Not to standard` count column.
  - PDF: flagged shapes boxed amber, dashed, numbered with the table rows.
    The per-sheet summary line gains `M not to standard`, and the
    `OPERATORS_NOTE` when it applies.
  - `runReport` passes `shapes` and `operatorsMarked` into the model.
- [ ] **Step 1: Write the failing tests:**
  - column headers;
  - row order;
  - an operator joined with ` + `;
  - the Sheets count;
  - PDF amber rectangle drawn for a flagged shape (the model's box list);
  - an old result with no `shapes` gives today's workbook rows plus blank
    new columns.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to see them pass;** `npm test` green.
- [ ] **Step 5: Checkpoint.**

---

### Task 8: The phase 3 gate (local, after the owner has marked the tuning set)

**Files:** `scripts/check-symbol-check.mjs` (tuning only through
`CHECK_DEFAULTS` and the named constants); private output in
`../pid-symbol-spike/every-format-gate/` (`<letter>-p3-*.txt`).

- [ ] **Step 1: Baseline before tuning.** Run P1, P2, C and M with `--key`,
  `--operators "<the legend's operator heading>"` and each sheet's
  `--words`. Save the outputs as `<letter>-p3-before.txt`.
- [ ] **Step 2: Tune on the tuning set only.** Change only
  `shapeExplained`, the long-run length, dash and hatch counts,
  `SHAPE_JOIN` and the key overlap. Record each change and its counts. Tests
  pinning a value change with it.
- [ ] **Step 3: Gate lines, tuning set:**
  - caught ≥ 90% of the owner's NOT STANDARD;
  - false flags ≤ 1 in 20 of the owner's STANDARD;
  - missed ≤ 1 in 20 of the owner's boxes;
  - flagged not-a-symbol ≤ 1 per 20 symbols;
  - unread 0 (or each one listed for the owner).
- [ ] **Step 4: The five trial cases, from `--verbose`:**
  - P1 and P2 pumps flagged (`left-over` or `no-fit`);
  - lever and handwheel valves standard where the owner's key says so;
  - P2's two flowmeters as the owner's key says;
  - non-standard bubbles flagged;
  - the dashed-line arrow gone.
- [ ] **Step 5: No harm, against the phase 2 after files:**
  - A, B, C and M per-tag verdicts unchanged; Wrong family 0;
  - relabel ≥ 9 of 10;
  - symbol lists unchanged (`--compare` against `<letter>-p1.json`, with
    phase 2's counts);
  - deleted-line test: a private copy of C with one line of one standard
    symbol deleted (PyMuPDF redaction of that segment) gives that shape
    flagged;
  - times under 60 s on a quiet machine.
- [ ] **Step 6: Held-out set, once.** Run each held-out sheet with `--key`.
  Write the counts in the Outcome whatever they are, against the spec's
  held-out lines (≥ 80% caught, ≤ 1 in 10 false flags; the rest reported).
  Do not tune after this run.
- [ ] **Step 7: Pictures for the owner.** `context.py` (private) of every
  flagged shape on P1 and P2, and of every disagreement with the key. The
  Outcome gives counts only, and states that by-eye judgements are the
  owner's.
- [ ] **Step 8: Write the Outcome** in this plan (numbers only, no names,
  tags or drawing numbers). Checkpoint.

---

### Task 9: Tool glue for the check, in the browser

**Files:** `tools-src/pid-tag-register.html` (anchored patch after backup),
private backup in `.superpowers/sdd/2026-11-17-pid-whole-shape-check/`.

- [ ] **Step 1:** Back up the tool (SHA-256 before). Patch only what Tasks 6
  and 7 need: amber box drawing, if `drawSymbolBoxes` does not already
  draw every `boxRects` kind; and the summary note. Anchors matched once
  each. `node --check` on the classic script. Save-call counts unchanged.
- [ ] **Step 2:** Serve the repo and open the tool in the built-in browser
  with invented sheets only:
  - an invented library with `HANDLE` ticked through the new edit card and
    the group button;
  - an invented sheet like `SHAPE_SHEET` → **Check symbols** shows the
    summary counts, the Not to standard rows first, and amber boxes;
  - untick the operator → the operators note appears;
  - export a report → the Symbols sheet has the four new columns, and the
    PDF has amber boxes.
- [ ] **Step 3:** Confirm `register.json` is byte-identical (size and
  `savedAt`) after the check, the report and both downloads.
  `npm test` green.
- [ ] **Step 4: Owner steps** (spec *Owner steps after phase 3*):
  1. In PowerShell, inside `harveydeason-site`, run
     `node scripts/lock-tools.mjs`.
  2. On the **Symbols** tab, press **Mark every symbol under this table
     heading as an operator** on the operator heading.
  3. Open P2 on the **Sheets** tab and press **Check symbols**.
  4. Do the same on a Plant 3D sheet.
  5. Run **Export report** and look at **To standard?**.

  Then ask for commit and push.

## Outcome

(Task 8 and Task 9 add their parts. Numbers only.)

**Built, 2026-11-18 (Tasks 1-7 and 9; Task 8 waits for the owner's marked key).** Rulings and deferred minors are in the
ledger (`.superpowers/sdd/2026-11-17-pid-whole-shape-check/progress.md`, gitignored).
- `npm test`: 1081 tests, 1079 pass, 0 fail, 2 skipped. Nothing committed.
- Splitter changed before the owner's copies were made: the long-run start (longest legend line x maxScale) came to 162 pt on
  the real legend, so most short pipes stayed in shapes. Added: line spreads from long runs through bends and tees, T
  connectors, hatch between any two parallel lines, connectors only between two real shapes.
- Answer-key copies (private): P1 97, P2 136, C 236, M 113 boxes, one per shape; PyMuPDF count equals the shape count on all four.
- No harm, before tuning (A, B, C, M with the operator heading marked): per-tag tallies and every non-OK verdict line identical
  to phase 2; Wrong family 0; C relabel 9 of 10, other verdicts changed 0; symbol lists against phase 1 matched 12/12, 18/18,
  102/102, 45/45. P1 lists 2 fewer symbols than phase 2 (marked operators are no longer swept).
- Time: the judge adds about 5 s on C (26.7 s without, 31.5 s with, back to back). Gate-run times swung with machine load.
- Shapes judged before tuning (counts only): C 242 shapes, 180 not to standard; M 113, 83; A 43, 31; B 44, 34; P1 90 and P2 134
  not to standard. These are not gate numbers: the owner's key decides which flags are right.
- Task 9 (browser, invented sheet, private browser folder): operator tick and group button work; Check symbols 2.2 s, Not to
  standard listed first, dashed amber boxes, jump to box; operators note shown when none is marked; report Symbols sheet has
  To standard?, Why, Closest, Closest score %; Sheets sheet has Not to standard; PDF boxes numbered after the tags;
  register.json byte-identical after the check, the report and both downloads; no console errors. Tool SHA-256 before
  9d07d3cc..b0dd, after the Task 5 and 9 patches 85d281b8..7d64; save-call counts unchanged.
- End review (Sonnet): 0 Critical, 1 Important (fixed), 6 Minor (2 re-graded Important and fixed, 4 deferred).

**Gate, as run with the owner (2026-11-18).** He could not mark the Bluebeam key, so the gate became pictures of every
flagged shape, answered in words (private files in `pid-symbol-spike/`). Counts only.
- Tuning set, flagged shapes: P1 89 -> 26, P2 134 -> 39, C 138 -> 29, M 81 -> 25 (442 -> 119). On P1, 34 of 34 shapes he
  called "not a symbol" no longer flagged and 21 of 21 he called rightly flagged still flagged. Round 2: 37 of 40 he did not
  want gone; 7 of 7 reducers standard; valves with an arrow or bubble line, two page splits and two joined valves still flagged.
- Tag verdicts on A, B, C, M unchanged throughout; symbol lists matched phase 1.
- Held-out binder (6 sheets), run once untuned: 599 flags (H1 77, H2 140, H3 111, H4 41, H5 14, H6 216), 20-53 s a sheet.
  Not judged by the owner except H1, which then found the cause of most of its flags: H1 and H2 are A1 drawings printed
  on A3 (bubbles 0.41 and 0.43 of the legend's). Sheet scale is now read from the bubbles; H1 after it: 142 of 165 shapes
  flagged, instrument bubbles 9 of 24 now standard. Gate lines (90% caught, at most 1 in 20 false) not shown to be met.
- Owner's decision: go live with the shape check as a labelled trial ("review each flag by eye"), and keep tuning from the
  sheets he checks.
- Report and screen made symbols first at his request (green named standard symbols, amber numbered not to standard,
  pictures of each, tags at the back as reference). Browser-checked on invented sheets; register.json byte-identical.
- `npm test`: 1108 tests, 1106 pass, 0 fail, 2 skipped.
