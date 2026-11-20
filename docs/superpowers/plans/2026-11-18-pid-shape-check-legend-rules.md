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

**Gate: FAILED** (2026-11-18, one run per sheet on mains, HEAD c7b178c and the working tree back to back). Gates 1, 2, 5
and 7 pass; gates 3, 4 and 6 fail. Not committed.

| Gate | Result | Counts |
|---|---|---|
| 1 No harm (A B C M P1 P2 supplier) | pass | sweep symbol lists identical, tag verdict lines differ 0, wrong family 0, on all seven |
| 2 Tuning answers (C M P1 P2 H1) | pass | not-a-symbol amber 1 (≤ 4); standard amber 11 (≤ 12), standard green 31 (≥ 30); right flags 15 of 15 boxed, 0 green |
| 3 Eye on H2-H5, ≥ 75% of amber right | **fail** | 80 amber: 21 right, 33 wrong, 26 new (reason changed or no tile). Of answered: 21/54 = 39%. With the 26 new tiles all right it would be 47/80 = 59%, so the gate cannot pass whatever the answers |
| 4 Right-flag guard | **fail** | 1 of 48 green: H2 tile 10 (was "BALL with extra linework", now green as BALL + MANUAL ISOLATION). Tuning right flags: 0 green |
| 5 Border | pass | 0 boxes outside the drawing area on all ten sheets |
| 6 Time, ≤ 60 s | **fail** | H2 62.5 s new against 43.5 s HEAD. All other sheets ≤ 34.4 s new (HEAD ≤ 30.1 s). New is 1-10 s slower per sheet |
| 7 Tests | pass | npm test 1243, 1241 pass, 0 fail (2 skipped) |

**What the H2-H5 answers show.** Tile by tile (answer → now):
- **Tiles 5-7 (LEVEL - GENERAL, pre-answered right): still "differs from SILENCER".** On the real sheet the sweep finds
  SCREENINGS COMPACTOR OUTLET FLANGE inside the shape, so the outline box fit (which runs only when nothing is found)
  never runs there. The item-4 fix works on invented data only.
- Standard "extra linework" (28 answered): 3 now green (18 hoist + motor, 67 motors + hoist, 80 flowmeter + flow arrow),
  2 now red (12, 13), 23 still amber. Peeling clears few of them.
- Right flags: 28 amber unchanged, 1 green (10), 4 red (28, 29 check valves; 37, 38 hydraulic press).
- Not a symbol: 2 amber, 7 red (the corner arrows 30-35 are no longer amber).

**Changes on the tuning sheets** (`lr2-changes-tuning.pdf`, 23 tiles): C 1 amber → green (BALL + DIRECTION FLOW ARROW),
1 red → amber; M 1 green → amber (ERHARD NEEDLE VALVE), 2 red → amber, 1 red → green (TIE-IN POINT NUMBER MARKER);
P2 2 reducers amber → red (fix incomplete), 1 red → amber reducer, 1 red → amber LOCKED, 2 PLC panels green → amber
(HEAD's green came from an actuator fitted on a dash of a signal line); **H1 9 IN-LINE (ANY TYPE) green → red, cause not
traced**, 2 amber reasons changed.

**Built** (test-first except Task 3): box fit at the sheet's scale; line with a head; Sheet 1 sample boxes (17 judge-only
symbols, 7 of them line marks: library 403 → 420; written against the real legend first, tests after); attachments
setting and peeling, with fill rule; an operator stands on a piped body, not out on its pipe; small plain attachments
never fit alone; item 4 (outline box fit, letters scored as writing, a lettered symbol needs writing); line marks
through the pipe cut, ticks alone counted, a lead to a bubble cut as a connection (a run of straight legs, not only one
straight run: my call, H2 tile 22's lead turns once); rim marks and touching bubbles; parts names and the line-mark count
on screen and report.

**Next** (owner's call): the new tiles (`new-amber-H2-H5.pdf`, 26) cannot rescue gate 3. The H1 regression, tile 10 and
H2's time need fixing before any ship; the attachment/peel rules clear too few standard "extra" shapes to reach 75%.
Private evidence: `phase4-build/lr2`, `lr2-head`, `lr2-noharm`, `score-lr.py`, `lr-tiles.py`, `gate-run.sh`.

## Outcome, second pass (2026-11-19)

**Gate: still FAILED** on gates 3 and 6. Gates 1, 2, 4, 5 and 7 pass. Each fault from the first pass was traced on the real
sheet first and fixed by a general rule, each with a test on invented data that fails without it. Not committed.

| Gate | Result | Counts |
|---|---|---|
| 1 No harm | pass | sweep symbol lists identical, tag verdict lines differ 0, wrong family 0, on all seven |
| 2 Tuning answers | pass | not-a-symbol amber 1 (≤ 4); standard amber 12 (≤ 12), standard green 31 (≥ 30); right flags 15 boxed, 0 green |
| 3 H2-H5, ≥ 75% of amber right | **fail** | 88 amber: 29 right, 33 wrong, 26 new. Of answered: 29/62 = 47% (was 39%). Bounds with the new tiles: 33% to 62%, so it cannot pass whatever the answers |
| 4 Right-flag guard | pass | 0 of 48 green (H2 tile 10 is amber again: "BALL with extra linework") |
| 5 Border | pass | drawing area found on all ten sheets; shapes kept only inside it |
| 6 Time, ≤ 60 s | **fail** | gate run (mains, back to back): H2 62.5 s new against 52.8 s HEAD; every other sheet ≤ 39.2 s (H6). Timings swung by up to 15 s between runs today (HEAD H2 48-66 s); in one process, alternately, H2 averaged 66.6 s new against 57.4 s HEAD (+16%) |
| 7 Tests | pass | npm test 1251: 1249 pass, 0 fail, 2 skipped. One run of four had 1 failure that did not come back in three re-runs (not identified; likely a timing test under load) |

**Causes and fixes** (first-pass fault → cause on the real sheet → rule):
- **H1, 9 IN-LINE (ANY TYPE) green → red.** The printed-sheet reader gives each small bowtie a writing box of its own size,
  and the item-4 step took letters out of the ink before fitting, so nothing was left. Rule: a shape with no linework
  besides its "letters" keeps all of its ink. All 9 are green again.
- **H2 right flags 28, 29, 37, 38 amber → red.** Same family: one edge of a lettered rectangle (37, 38) had its own writing
  box. Rule: a "letter" stroke joined at an end to the shape's other linework is linework. All four amber again, with
  their HEAD reasons (check valve 77%/75%, HYDRAULIC PRESS EXTENSION LENGTH 123%).
- **P2, 2 reducers amber → red.** The box-fit band was moved to the sheet's size (1.22), and a reducer drawn at 61% of the
  legend fell below it by a hair. Rule: the fit band covers the legend's size and the sheet's size. Both amber at 60% again.
- **H2 tiles 5-7, "differs from SILENCER".** Three causes, not the sweep: (a) the plain step kept a small T (SCREENINGS
  COMPACTOR OUTLET FLANGE) on the box's bottom edge and stem, explaining a fifth of the shape, which stopped the box fit;
  (b) the stem is drawn twice, so `outlineBox` saw each copy's free end as joined and never took the stem off; (c) on the
  line-piece read LEVEL - GENERAL and BASIC SYMBOL (a bare box) tied, and the first won. Rules: a plain find explaining
  under AMBER_EXPLAINED does not stop the box fit (the fit explaining more is kept); a stroke drawn twice is one line;
  fits tied on score go to a lettered symbol (it is only tried when its shape holds writing). All three now read
  "LEVEL - GENERAL drawn at 59%", the pre-answered reason.
- **H2 tile 10, green as BALL + MANUAL ISOLATION.** The T lay with its bar along the line through the ball valve's middle
  and its stem out along a branch. Rule: an operator laying more than OP_ON_BODY (0.25) of its linework inside a found
  body, along the body's pipe, lies across it and is not taken (a stem rising from the body's middle still passes).
  Also, attachments are scored on their own shape's ink and the pipes through it, never a neighbour's (whole paths when
  wholly in the shape, so a filled arrowhead keeps its fill).
- **H2 time.** Profiled: the new steps are the peel (8.4 s on H2), line marks (≈3 s) and the box fit (1.4 s). Two speedups
  with identical results: the peel drops a placement as soon as it cannot reach PEEL_NEW, and `settings()` is read once
  per options object. The letters check in the box fit is worked out once per box again. Not enough for gate 6.

**Changes on the tuning sheets against HEAD** are in `lr4-changes-tuning.pdf` (24 tiles). Since the first pass (26
shapes): H1 9 bowties red → green (IN-LINE (ANY TYPE)), 3 red → amber DIAPHRAGM extra, 3 red → amber IN-LINE extra, 5
amber reasons BASIC SYMBOL → LEVEL - GENERAL (size kept); M 2 red → amber and 1 amber reason now TIE-IN POINT NUMBER
MARKER extra; P2 2 reducers red → amber at 60% (as HEAD), LOCKED amber → red (as HEAD). C's ball valve stays green as
BALL + DIRECTION FLOW ARROW.

**For the owner:** `new-amber-H2-H5-lr4.pdf` (3 tiles): 2 new amber boxes (H2: a panel box read as LEVEL - GENERAL at
197%; H4: a TIE-IN POINT NUMBER MARKER with extra linework) and 1 whose reason changed (H3: now BALL at 75%). The other
23 of the 26 earlier new tiles (`new-amber-H2-H5.pdf`) are unchanged; 2 are no longer amber.

**Next** (owner's call): gate 3 is still out of reach (62% at best) and needs more standard "extra" shapes cleared; gate 6
needs a cheaper peel or a time budget decision. Private evidence: `phase4-build/lr4`, `lr4-head`, `lr4-noharm`,
`gate-run4.sh`, `ab-time.mjs`.

## Outcome, third pass (2026-11-19, after the owner's rulings on the 3 lr4 tiles)

**Gate: still FAILED on gate 3 only.** Gate 6 now passes. Gates 1, 2, 4, 5 and 7 pass. Not committed.

The owner's rulings: H2 panel box (LEVEL - GENERAL 197%) right flag; H3 valve (BALL 75%) right flag; H4 TP diamond with
LINE DEMARCATION arrows standard. They are in `phase4-build/owner-answers-lr4.json`, read by `score-lr.py`.

| Gate | Result | Counts |
|---|---|---|
| 1 No harm | pass | all seven identical, verdict lines differ 0, wrong family 0 |
| 2 Tuning answers | pass | not-a-symbol amber 1 (≤ 4); standard amber 3 (≤ 12; was 12), standard green 40 (≥ 30; was 31); right flags 15 boxed, 0 green |
| 3 H2-H5, ≥ 75% amber right | **fail** | 80 amber: 31 right, 25 wrong, 24 unanswered. Of answered: 31/56 = 55% (was 48% on the owner's answers). Bounds: 39% to 69%; it cannot pass until the unanswered tiles are answered and about 7 more wrong ambers clear |
| 4 Right-flag guard | pass | 0 of 48 green |
| 5 Border | pass | |
| 6 Time, ≤ 60 s | **pass** | mains, back to back: H2 46.8 s new against 45.2 s HEAD; slowest sheet H2 |
| 7 Tests | pass | npm test 1257: 1255 pass, 0 fail, 2 skipped |

**Causes traced on the tuning sheets first, each fixed test-first:**
- **A path drawn twice is judged once.** C and H2 draw every stroke twice; a path whose pieces in a shape all repeat one
  earlier path's (same fill, stroke and width) is left out. It is what stopped C's Z marks being read (each tick "ran
  on" from its own copy) and it is most of the time saved on H2 (the peel and the cut did everything twice).
- **SIGNAL - ELECTRIC's Z mark on a lead** (C, 5 balls with flow arrows): its ticks run along the line and are 3.6 pt
  long, so they were taken for lines. A line is now longer than any mark or runs on from another straight piece end to
  end; the mark is read on its line and the pieces that line runs on into; and a mark goes with a lead (or a cut pipe)
  whole, every stroke, when it crosses it mid-piece.
- **A hatched ball valve** (C, 3 shapes): the fill rule wanted every large outline filled, and the ball's own circle is
  large and open. Now only a loop the size of a filled one (its twin, a valve's other triangle) must be filled
  (FILL_TWIN 0.25). One triangle of two hatched stays not standard.
- **BALL's pipe read as vertical** (M, two balls joined by a bent pipe): the ball's circle touches the box's top and
  bottom, and those touch points were read as pipe connections, so no BALL ever had its pipe cut. An edge point where the
  line carries on turning less than 35° (a curve touching the edge) is no connection. 43 of 420 legend symbols read their
  pipe differently, mostly curves no longer taken for connections (BALL, ROTARY VALVE, bellows, vessels).
- **Pipe running on past a flow arrow** (C): an attachment sitting on the pipe (not an operator) carries the pipe through;
  the straight run leaving its far end in line is pipe.

**On the pasted suggestions:** extra-parts matching already ran only when a legend body is found (the peel needs a body);
duplicate strokes are now collapsed as above (per whole path, so fills stay right); the "stub between a valve and a
bend" on M was the BALL pipe-axis fault, not a missing stub rule.

**Not fixed, traced on H2:** flexible hoses and a flowmeter miss 97% by a sliver with nothing left over (drawing
differences: tuning the threshold is the owner's call, on the tuning sheets only); the angle relief valve's second pipe
is not cut (pipeLines gives one axis; an angle valve needs two); a motor shaft to a dot and a lead's 4 pt end leg. The
H4 TP diamond with demarcation arrows (answered standard) is still amber at 72%: not traced.

**For the owner:** `new-amber-H2-H5-lr7.pdf` (3 new amber tiles: H3 dimension arrows read as SCREENINGS COMPACTOR
OUTLET FLANGE with extra linework; H4 "HOLD 1" text box read as LEVEL - GENERAL at 73%, which is likely the tied-fit
rule of the second pass preferring a lettered symbol where there is writing; H5 a ball valve with a T handle and a
half-round below). The other 21 unanswered tiles are on `new-amber-H2-H5.pdf` (18 Nov), unchanged. Tuning changes against HEAD:
`lr7-changes-tuning.pdf` (51 tiles). Private run: `phase4-build/lr7`, `lr7-head`, `lr7-noharm`, `gate-run7.sh`.

## Outcome, fourth pass (2026-11-19, every H2-H5 amber answered)

**Gate: FAILED on gate 3 only** (62%). Gates 1, 2, 4, 5, 6 and 7 pass. Not committed.

The owner answered the last 24 tiles (kept in `phase4-build/owner-answers-lr4.json`): every amber box on H2-H5 is now
answered, so gate 3's number is no longer a bound.

| Gate | Result | Counts |
|---|---|---|
| 1 No harm | pass | all seven identical |
| 2 Tuning answers | pass | not-a-symbol amber 1; standard amber 3, green 40; right flags 15 boxed, 0 green |
| 3 H2-H5, ≥ 75% amber right | **fail** | 79 amber: 49 right, 30 wrong = 62% (49/80 = 61% before this pass) |
| 4 Right-flag guard | pass | 0 of 48 green |
| 6 Time | pass | mains: H2 44.6 s new against 43.6 s HEAD |
| 7 Tests | pass | npm test 1259: 1257 pass, 0 fail, 2 skipped (a letter-spotting timing test failed once under load, passed on re-run) |

**Built this pass (test-first):**
- **Lettered symbols hold no more writing than their letters:** the writing in a lettered symbol's box is at most
  LETTER_ROOM (2) times the share of the box its legend letters take. "HOLD 1" is no longer LEVEL - GENERAL (it now
  reads BASIC SYMBOL at 72%, still amber: not-a-symbol, so still wrong). Tiles 5-7 keep LEVEL - GENERAL at 59%.
- **An operator on a valve's free end:** past the body's end along its pipe line only where no ink runs on past the
  operator, and the line comes in at the other end (pipe at least the body's length). H5's ball valve with its
  diaphragm below is now green. Two stubs ending in ticks stay as before (a flange's place).
- **Angle bodies cut both ways:** connections on one side and one end only (an L) give two pipe lines. 13 legend symbols
  (ANGLE, WEIGHT LOADED, SAMPLE TAP, VARIABLE SPEED MOTOR, ...). PRESSURE RELIEF (ANGLE) is not one of them: its spring
  lines touch the right edge too, so it reads as connected on both sides.

**Tried and taken out:** a "clean fit" (no piece left over: standard from 95%). It made right flag 11 (H2, BALL at
96.2%, nothing left over) green, while the standard hoses, flowmeter and TP diamonds sit at 95.7-97%: no cut-off
separates them, so it fails the right-flag guard.

**On the suggestions:** the multi-part peel was already iterative (up to PEEL_MAX 8 parts); the H5 parts were refused by
the operator rule, now fixed as above. The TP diamonds' leftover is not demarcation arrows: on H4 and M it is a lead from
the diamond to a small TIE-IN POINT circle on the pipe, and the judge cannot place a small circle (no key lines); on H2
the two TPs leave nothing over and miss 97% by drawing difference.

**What the 30 wrong ambers are** (no shared cause left): 5 at 96-97% with nothing left over (H2 hoses x2, flowmeter, TP
diamonds x2: the right flags share that band); 4 at 93-96% with a part left over (H5 pumps x2, H4 hose reel, H5 needle
valve); 5 "drawn differently", no body found (H2 spray device, wedge gate, angle relief valve, motor; H4 3-stage pump);
11 explained 31-89% (H2 butterflies x2, strain gauge, angle relief valve, variable speed motor; H4 check valve, screwdown,
float, flowmeter, control panel, ball); 2 others (H2 BASIC SYMBOL at 75%, H4 TP with its lead); 3 not a symbol (H3
demarcation arrows, H4 "HOLD 1", H5 vent).

**Your own sheets:** `phase4-build/own-sheets-C-M.pdf`: C 101 green, 2 amber, 16 red of 119; M 41 green, 10 amber, 4 red
of 55; no box outside the drawing area.

## Follow-up (2026-11-20): signal-line marks on a contractor set

On a new contractor set the signal lines from float switches carry SIGNAL - ELECTRIC marks at about half the legend's
size, the line broken into a piece between each pair of marks, and in one place a tank wall crossing through a mark.
Fixed test-first: line marks are matched from MARK_MIN (0.4) of the legend size; a lead's legs are its turns, not its
pieces; a mark is matched on each line it touches in turn. On that set's sheet 4028 all four float switches turn green
(40 / 11 / 12 green / amber / red to 44 / 7 / 12). Tuning answers unchanged (standard amber 3, green 40), H2-H5 64%,
right flags 0 green, npm test 1262 (1260 pass, 0 fail). Left for later (owner's call): a lead starting at a part found
only by the peel (a variable-speed motor's signal line) is not cut.
