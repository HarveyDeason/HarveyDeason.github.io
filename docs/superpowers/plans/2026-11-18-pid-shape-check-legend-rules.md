# P&ID shape check: legend rules — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (the owner asked for a lean build in one
> session, 2026-11-18). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the shape judge combine standard parts (attachments, touching symbols, line marks, connection lines,
touching bubbles), stop lines with a head from flagging corners, fit at the sheet's scale, and read Legend Sheet 1's
skipped boxes, so at least 3 in 4 amber boxes on H2-H5 are right.

**Architecture:** Judge-only changes in `assets/js/pid-symbol-check.js`. The sweep, its symbol lists and the tag pairing
are untouched; new library symbols carry `flags.judgeOnly` or `flags.lineMark`, so the sweep skips them. The importer
gains a reader for "sample beside name" boxes in `assets/js/pid-symbols.js`. The view and report read a new `parts`
field and a `lineMarks` count.

**Tech Stack:** vanilla ES modules, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-18-pid-shape-check-legend-rules-design.md`

## Global Constraints

- Nothing writes `register.json`. No client data in the repo; tests use invented data only.
- `tools-src/` only by anchored patch after a backup; owner runs `node scripts/lock-tools.mjs`.
- No new dependency, no OCR. Nothing committed until the owner asks.
- Sweep symbol lists and tag verdicts identical to `../pid-symbol-spike/phase4-build/baseline` on A B C M P1 P2 supplier.
- Settings start at: `PEEL_NEW` 0.5, `PEEL_MAX` 8, `HEAD_ZONE` 0.35; tuned only on C, M, P1, P2, H1.
- Default `attachments`: FLANGED CONNECTION, CAPPED END/THREADED PLUG, LOCKED, FLOW DIRECTION ARROW, DIRECTION FLOW
  ARROW, PIPE BORE CHANGE/ CONCENTRIC REDUCER, PIPE BORE CHANGE/ ECCENTRIC REDUCER, GEP MARK, QUALITY MARK, SAFETY MARK.

## Review Focus

- A peeled part claiming ink an earlier part explains: two parts on one ink must not stack (test in Task 4).
- An old saved result with no `parts` / `lineMarks` must render as before (test in Task 7).
- A library without the new Sheet 1 symbols (not re-imported) must judge exactly as today, minus the fixed bugs
  (test in Task 3: sweep skips judgeOnly; Task 4 runs with an attachments list naming absent symbols).
- Hostile input to every new export returns the empty or neutral value, never throws (each task's hostile test).
- A sheet at scale 1 (clean CAD) must not change from the band fix (Task 1 test at sizeScale 1).

---

### Task 1: Fit at the sheet's scale (strain-gauge cause)

**Files:** Modify `assets/js/pid-symbol-check.js` (`quickFit`, `boxFit`, their callers in `judgeShapes`; the
lettered-symbol test). Test: `tests/pid-symbol-judge.test.js`.

- [ ] Write failing test `box fit works on a sheet printed at 43%`: invented library with a lettered plain box symbol
  (57 × 28, letters "X","L") and a drawn box 12 × 24.6 turned, with spotted-letter writing boxes inside, `sizeScale`
  0.432 → shape verdict `standard`; the same at 60% of that → `not-standard`, reason `{ kind: 'size', pct: 60 }`.
- [ ] Run, see it fail (box fit rejects at the absolute band).
- [ ] `quickFit(prepared, o, box, near, cfg)` and `boxFit(prepared, o, box, band)` take the judge band
  (`minScale`, `maxScale` = `JUDGE_BAND` × sizeScale); `judgeShapes` passes `band`.
- [ ] Confirm the letters filter: if writing boxes from spotted printed letters reach `c.writing`, no change; if not,
  count spotted letter rows passed in `ctx.writing` by `checkSheetAt` (measured on H2 tile 5 with a probe).
- [ ] Test at sizeScale 1 unchanged; suite green.

### Task 2: A line with a head

**Files:** `assets/js/pid-symbol-check.js` (`isLineWithHead(prepared)`, `headTold(hit, ink, cfg)`; uses in
`judgeShapes`). Test: `tests/pid-symbol-judge.test.js`.

**Produces:** `export function isLineWithHead(prepared): boolean`; `export const HEAD_ZONE = 0.35`.

- [ ] Failing tests: `isLineWithHead` true for an invented 4 × 21 stem-plus-head arrow, false for a solid head with no
  stem, false for a one-line symbol, false for a valve. A sweep spot of that arrow on a bare L-corner (ink: two lines)
  → shape not amber (red); the same arrow on ink with its head drawn wide → standard.
- [ ] Implement: longest joined straight line ≥ long side − 1; every other segment's points within `HEAD_ZONE` × length
  of one end. In judging: line-with-head excluded from `plains`, `looseable`, `fittable` and as `closest` for
  "differs" (as `oneLine`); a kept non-operator spot that is a line with a head stays only if `headTold`: the head's
  template points lying > `inkTol` off the stem line are ≥ 3 and on ink at `LINE_MIN`; otherwise the spot is dropped
  from the shape before its mask is drawn.
- [ ] Suite green.

### Task 3: Legend Sheet 1 sample boxes

**Files:** `assets/js/pid-symbols.js` (`sampleRows(paths, words)`, called by `readLegendPage`; `buildLibrary` adds
`page.samples`). `assets/js/pid-symbol-check.js` (`prepareOne`: `judgeOnly` and `lineMark` never swept, placeable).
Test: `tests/pid-symbols.test.js`, `tests/pid-symbol-judge.test.js`.

**Produces:** a page's `samples: [{ label, header, symbolPaths, lettersInside, judgeOnly: true, lineMark: 'signal' |
'lagged' | null }]`; library symbols with `flags.judgeOnly === true` and, for marks, `flags.lineMark` (kind string);
prepared `p.judgeOnly`, `p.lineMark`.

- [ ] Failing tests on an invented page: a box headed LINE TYPES with "SIGNAL - ELECTRIC" beside a line carrying 6
  ticks → one `lineMark: 'signal'` symbol holding one tick; "DIRECTION FLOW ARROW" beside a solid triangle → a
  judgeOnly symbol; "PIPELINE - MAJOR PROCESS" → nothing. A LINE DEMARCATION box sample → judgeOnly symbol. An
  INSTRUMENTATION DESIGNATION box: a filled circle / square / triangle right of a bubble → GEP MARK, QUALITY MARK,
  SAFETY MARK.
- [ ] Failing test: `sweepSymbols` never lists a judgeOnly or lineMark symbol.
- [ ] Implement. Headings found by text; a row is a text line inside the box; its sample is the ink in that row's band,
  left of the label, inside the box's column. Signal mark: the sample's pieces minus its longest straight line, the
  first repeat (pieces whose centres lie within one period). Lagged/heated: the parallel dashes and slashes of one
  period. Rim marks: filled closed paths under 8 pt beside a ring, named by the row's sentence (circle → GEP, square
  → QUALITY, triangle → SAFETY).
- [ ] Real legend (private): import `legend-sheets.pdf`, list the new symbols with sizes; picture of each.
- [ ] Suite green.

### Task 4: Attachments and peeling

**Files:** `assets/js/pid-symbol-check.js` (`CHECK_DEFAULTS.attachments`, `isAttachment(p, cfg)`, `peelParts(...)`
replacing the single `bestOperator` call in step "A body with ink left over"; the filled-body rule; `shapeVerdict`
bodies; ShapeOut `parts`). Test: `tests/pid-symbol-judge.test.js`.

**Produces:** ShapeOut `parts: [{ name, role: 'body'|'symbol'|'attachment' }]` (bodies first); `operator` stays (first
attachment); exports `PEEL_NEW = 0.5`, `PEEL_MAX = 8`.

- [ ] Failing tests (invented): a valve with a T operator and two flange ticks → standard, parts BALL-like body + 1
  operator + 2 FLANGE; a valve touching a reducer (both checkable) → standard; a valve touching an invented unknown
  wedge → still `extra`; a flange tick alone (no body) → never placed; two candidates on the same ink → only one taken;
  a valve with its triangles hatched (lines inside its closed outline) → standard; one triangle hatched only → not
  standard; an attachments list naming absent symbols → as today.
- [ ] Implement per spec section 3. Attachments: `p.operator || cfg.attachments` names (normName) — placeable via
  `placeable`. Standard candidates: `fittable` minus attachments minus simple, placed with `proposePlacements` on the
  unexplained pieces, held as the plain step holds (recognise, plainBack, LINE_MIN, not running on), box touching the
  shape. New ink = template points on `left` / all its points ≥ `PEEL_NEW`. Size judged for bodies and peeled symbols,
  not attachments. Hatch rule: pieces wholly inside a body's closed template loops count explained when the body's
  loops are all filled the same way.
- [ ] Suite green.

### Task 5: Line marks and connection lines

**Files:** `assets/js/pid-symbol-check.js` (`markPieces(S, pieces, marks, cfg)`; `cutPipe` passes through marks;
connection cut; result `lineMarks`). Test: `tests/pid-symbol-judge.test.js`.

**Produces:** result `lineMarks: number` (shapes read as line marks, no box); `cutPipe(S, pieces, hit, marks?)`.

- [ ] Failing tests: a valve whose pipe carries a signal tick beyond its edge → cut passes it, shape standard; a
  stand-alone tick shape crossing a long line → not in `shapes`, `lineMarks` 1; a body with a straight run from its
  edge to a matched bubble → run cut, body standard; the same run to nothing → kept.
- [ ] Implement per spec section 4.
- [ ] Suite green.

### Task 6: Bubbles — rim marks and touching bubbles

**Files:** `assets/js/pid-symbol-check.js` (bubble branch in `judgeShapes`). Test: `tests/pid-symbol-judge.test.js`.

- [ ] Failing tests: a bubble with a small filled square beside its ring → standard with QUALITY MARK attachment; two
  tangent rings each with writing → standard, two bubble parts; a ring plus an unknown stroke → not standard.
- [ ] Implement: after the bubble match, peel (Task 4) with rim marks allowed; a closed shape with ≥ 2 rings (ring test
  from `pid-sheet-read.js`) each holding writing is matched ring by ring.
- [ ] Suite green.

### Task 7: Screen and report

**Files:** `assets/js/pid-symbol-check-view.js` (standard name from `parts`; `markLine` adds "N line marks read as part
of their lines"), `assets/js/pid-symbol-report.js` (same text). Tests: the view and report tests.

- [ ] Failing tests: parts `[BALL body, MANUAL ISOLATION att, FLANGED CONNECTION att ×2]` → "BALL + MANUAL ISOLATION +
  FLANGED CONNECTION ×2"; `lineMarks` 3 → heading part "3 line marks read as part of their lines"; an old result with
  neither → text unchanged.
- [ ] Implement. Suite green.

### Task 8: Gate (private, controller)

- [ ] Run `probe4.mjs` (legend imported fresh, VALVE ACTUATORS as operators) on all ten sheets on mains; `noharm.sh`
  against `baseline`; `score4.py`; the H2-H5 score with the reason rule; the right-flag guard; area pictures; times
  back to back with HEAD.
- [ ] New amber tiles on H2-H5 → `new-amber-H2-H5.pdf` for the owner.
- [ ] Write the Outcome below.

## Outcome

(filled in after the gate)
