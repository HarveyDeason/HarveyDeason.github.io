# P&ID shape check: legend rules (attachments, several parts per shape, lines with a head, Sheet 1 boxes)

**Date:** 2026-11-18
**Status:** the owner chose the approaches on 2026-11-18 ("Go with B … Go ahead and build this step"). Plan next
(superpowers:writing-plans).
**Builds on:** the green/amber/red redesign (`2026-11-18-pid-shape-check-redesign-design.md` and its plan with the
Outcome). That redesign is built, gated (except gate 4) and uncommitted on main against HEAD 7aae000. This step goes
on top of it, uncommitted, in the same working tree.
**Keeps:** every rule of the redesign that this spec does not name, as built: the drawing area, the reading method,
sheet scale and the size rule, the pipe cut, the three marks, and the screen and report.

## Intent

The redesign failed the owner's held-out eye test. Of the 80 amber boxes on H2-H5 he called 33 right (41%), against a
target of 75%. His answers show where the check goes wrong:

- **"X with extra linework": 3 of 31 right.** The other 28 are standard symbols carrying standard parts the check
  does not combine: flanged ends, T-handles, actuators, flow arrows, reducers, signal ticks on instrument lines, and
  two standard symbols touching (pump and motor, valve and reducer, hose reel and valve). The check fits one VALVE
  ACTUATORS item, once.
- **Not a symbol: 9 amber, 7 of them** line corners and crossings read as Sheet 4's FLOW DIRECTION ARROW, a line with
  a small head.
- **"Drawn differently": three "strain gauges" read as SILENCER.** Checked on the sheet with the owner: they are LEVEL
  - GENERAL (a box with an x and an L), drawn at about 60% of standard size. The owner's ruling: they are right as
  amber "LEVEL - GENERAL drawn at 60% of standard size". Tile 22 on H2 is the real STRAIN GAUGE.
- **The importer skips boxes on Legend Sheet 1** that hold standard drawing practice: LINE TYPES, LINE DEMARCATION,
  INSTRUMENTATION DESIGNATION examples and VALVE & ACTUATOR COMBINATION examples.

Every rule here comes from the owner's own legend and is a general property of P&IDs. None is written for one drawing.
Each rule is checked on the tuning sheets C, M and P1. The gate is then measured on H2-H5, which are now answered
sheets. A fresh eye test on new contractor P&IDs follows when he supplies them.

### The owner's rulings (2026-11-18)

1. **Attachments from PIPE WORK FITTINGS.** FLANGED CONNECTION and CAPPED END/THREADED PLUG become attachments a body
   may carry, alongside VALVE ACTUATORS.
2. **Several attachments on one valve,** fitted one after another: an actuator plus a manual override, a LOCKED
   padlock, flanged ends, a touching flow arrow or reducer. This follows Sheet 1's VALVE & ACTUATOR COMBINATION
   examples.
3. **Line-with-a-head rule.** A legend symbol that is a line with a head must not make a line corner or crossing amber.
   This extends the single-straight-line rule. The first search (the sweep) is left untouched, so the no-harm gate
   does not move.
4. **Strain gauge read as silencer:** find the cause. See *Intent*: the shapes are LEVEL - GENERAL at about 60%, and
   that is the right result.
5. **Sheet 1 boxes the importer skips:**
   - LINE TYPES: DIRECTION FLOW ARROW, CONNECTION POINT and CHANNEL become symbols. The SIGNAL ticks and the PIPELINE -
     LAGGED / HEATED hatches become line marks that the pipe cut passes through.
   - LINE DEMARCATION: opposing arrows on a divider beside TP diamonds.
   - INSTRUMENTATION DESIGNATION examples: GEP / Quality / Safety marks on bubble rims, and bubbles drawn touching.
6. **Peeling (option B):** besides the attachments, any touching standard symbol that is a full match on its own ink
   may be peeled off a shape. So pump + motor, hose reel + valve, and valve + reducer + air release valve are
   explained. The small plain symbols (MANUAL ISOLATION's T, the flange tick, LOCKED, the capped end) are only ever
   allowed as attachments. The guard is that none of his 48 right flags turns green.
7. **New amber tiles:** any new amber box on H2-H5 is sent to him to answer.

## Goals

1. A shape whose ink is wholly explained by a body plus any number of attachments and touching standard symbols is
   green. Its name lists every part, for example "BALL + MANUAL ISOLATION + FLANGED CONNECTION ×2".
2. A line with a head never makes a bare line, corner or crossing amber.
3. LEVEL - GENERAL and other symbols drawn small on reduced prints are fitted at the sheet's own scale. They are then
   judged by the size rule, not passed to a look-alike.
4. Legend Sheet 1's LINE TYPES, LINE DEMARCATION and INSTRUMENTATION DESIGNATION boxes are read into the library. Their
   rules apply on the drawing.
5. The share of amber that the owner calls right on H2-H5 rises to at least 75%. No right flag turns green.

## Non-goals

- Changing the sweep, its symbol lists or the tag pairing. Every new symbol and rule here is used by the shape judge
  only.
- Reading a contractor's own legend; other standards' libraries; OCR; scanned sheets.
- Naming red shapes.
- Pipeline numbers, pipe material codes and alarm letters (HH, LL) as checked items: these are writing.
- The "Not a P&ID" pre-check. It is on branch `not-a-pid-precheck`, merged by hand later.
- The PIPELINE line styles themselves (major, minor, existing, to be removed, abandoned, boundary). They are pipes,
  not shapes.

## Anti-goals (a failure even if it works)

- **Explaining away a real departure.** A peeled symbol that hides a non-standard part turns a right flag green. The
  guard is that none of the 48 right flags (33 on H2-H5, 15 on the tuning sheets) turns green.
- **Rules written for one drawing.** Each rule is tested first on invented data and then measured on C, M and P1.
- **Hiding a class of ink without counting it.** Ink read as a line mark is counted on the sheet heading, not dropped
  silently.
- **Regressions on the no-harm sheets** (A, B, C, M, P1, P2, supplier): tag verdicts and sweep symbol lists change by
  nothing.
- **Going over time:** any sheet over 60 s on mains.

## Constraints

As the redesign:
- Nothing writes `register.json`.
- No client data in the repo. Real sheets, outputs and answers stay in `../pid-symbol-spike/`; tests use invented
  data only.
- `tools-src/` is changed only by anchored patch after a backup; the owner runs `node scripts/lock-tools.mjs`. This
  step is not expected to touch `tools-src/`.
- No new dependency; no OCR. Sonnet for subagents. The owner's terminal is PowerShell 5.1.
- Nothing is committed or shipped until he asks.
- He judges by eye from numbered picture PDFs of his real sheets, answered in plain words.
- Times are measured only on mains.

**The library is re-imported.** The new Sheet 1 symbols reach the tool only when the owner imports Legend Sheet 1
again. Today's merge (`carryOver`) keeps his hand work. The gate scripts import the legend fresh, as now.

## Approaches considered

### Which touching symbols may be peeled off a shape (the owner chose B)

- **A. Only the named attachments:** VALVE ACTUATORS, FLANGED CONNECTION, CAPPED END, LOCKED, flow arrows and reducers.
  Safest for the right flags. It leaves pump + motor, valve + valve and hose reel + valve amber, which is about 6 of
  the 28 standard "extra" answers.
- **B. A, plus any standard symbol that is a full match on its own ink, touching the shape.** It also clears the
  stacked pairs. The risk is that a symbol explains away a real departure. Guarded and measured by the 48 right flags.
  Small plain symbols are attachments only. **Chosen.**

### Where the line-with-a-head rule lives (owner agreed: judge only)

- **In the sweep:** it would stop the 5 corner arrows on H2 at source. It changes sweep lists, and P2's baseline list
  holds one FLOW DIRECTION ARROW. Rejected.
- **In the judge:** a found line-with-a-head symbol counts as a body only when its head can be told from a line. The
  sweep and the no-harm gate do not move. **Chosen.**

### How the attachments are named (my call)

- **The owner marks them in the tool, as operators.** CAPPED END (12 on C) and LOCKED (14 on C) are found by the sweep
  as bodies. An operator is never swept, so marking them would change C's symbol list. Rejected.
- **A size-and-shape property** (small and plain): it also catches CHECK VALVE, FLAP VALVE and BRANCH CONNECTION.
  Rejected.
- **A named setting:** `attachments`, a list of legend names in the check's settings. Its default is the owner's list.
  A symbol on it stays a body for the sweep and may also be an attachment in the judge. VALVE ACTUATORS stay
  attachments through the operator mark, as today. **Chosen.**

### The new Sheet 1 symbols and the sweep (my call)

New symbols in the library would let the sweep find them, and C's ball valves carry a DIRECTION FLOW ARROW. That would
change C's symbol list. So the importer marks every symbol it reads from these Sheet 1 boxes as **judge only** (a new
flag `judgeOnly`). The sweep skips it, as it skips operators, and the judge may place it.

## Design

### 1. Reading the Sheet 1 boxes (`pid-symbols.js`, importer)

The importer reads ruled symbol tables today. These boxes are laid out differently: a heading, then samples drawn
beside their names.

- **LINE TYPES** (two columns: sample left, name right).
  - Symbols, judge only: DIRECTION FLOW ARROW (solid head), CONNECTION POINT (small filled dot) and CHANNEL. Each is
    the sample's ink.
  - **Line marks**, stored with a new flag `lineMark` and a kind:
    - The five SIGNAL types (FIELD BUS, ELECTRIC, CAPILLARY, PNEUMATIC, HYDRAULIC). The stored mark is **one tick**: the
      repeated piece that crosses the sample's long line, cut out with the bit of line it sits on.
    - PIPELINE - LAGGED and PIPELINE - HEATED OR COOLED WITH LAGGING. The stored mark is **one repeat**: the dashed
      parallel lines, plus the slash for heated, cut to one period of the pattern.
  - Not read: the plain PIPELINE types and BUILDING/KIOSK/PACKAGED PLANT BOUNDARY (non-goal).
- **LINE DEMARCATION:** the drawn samples become judge-only symbols:
  - TIE-IN POINT NUMBER MARKER (the TP diamond, its letters as writing, as with bubbles);
  - TIE-IN POINT DEMARCATION (opposing arrows on a divider);
  - PROCESS CONTINUATION MARKER;
  - TIE-IN POINT.
  Text (pipeline number, material codes) is not read. Taking all four drawn samples in the box is my call: reading the
  box gives them together, and each is a standard symbol a sheet may show.
- **INSTRUMENTATION DESIGNATION examples:**
  - The three **rim marks** (the GEP circle, the Quality square and the Safety triangle beside a bubble) become
    judge-only attachments of a bubble.
  - **Touching bubbles** need no new symbol. They are a judging rule (section 5).
  - The other examples (in-line PCE, conductive probe numbering) are writing and layout, not read.
- **VALVE & ACTUATOR COMBINATION examples** are not imported as symbols. They are the evidence for sections 2 and 3:
  the normally-closed solid bodies and the actuators on stems. They give the invented tests their cases.
- **How the boxes are found (builder):**
  - by their heading words (LINE TYPES, LINE DEMARCATION, INSTRUMENTATION DESIGNATION, EXAMPLES), and their ruled
    outline;
  - each name is a text line, and its sample is the ink in the same row band within the column, on the name's left;
  - the import's summary counts what each box gave, so a re-issued legend that reads differently is visible.

### 2. Attachments (judge)

An **attachment** is a legend symbol that is either:
- marked operator by the owner (VALVE ACTUATORS today); or
- named in the `attachments` setting. The default is FLANGED CONNECTION, CAPPED END/THREADED PLUG, LOCKED, FLOW
  DIRECTION ARROW, DIRECTION FLOW ARROW, PIPE BORE CHANGE/ CONCENTRIC REDUCER, PIPE BORE CHANGE/ ECCENTRIC REDUCER,
  and the three rim marks. Names are matched as `normName` matches them.

How attachments are fitted:
- An attachment is placed on the ink a shape's found parts leave unexplained, within reach of a found part. The reach
  is the part's half-diagonal plus the attachment's own size at the judge band's top, as operators are today.
- It must score at `recognise` on that ink, every line drawn (`LINE_MIN`), as today's operator.
- Simple symbols (FLANGED CONNECTION and MANUAL ISOLATION are "simple") are placeable as attachments, as operators
  are today.
- **Attachments are not size-judged** (my call). They are drawn to suit, and his tile 32 (a flow arrow at 67% on a
  relief valve outlet) is standard. A symbol on the list found alone, as a body (LOCKED or CAPPED END found by the
  sweep, a reducer on a pipe), is a body and keeps the size rule. His tile 39 (LOCKED at 129%) stays right.

### 3. Peeling several parts off one shape (judge)

This replaces the single `bestOperator` step: after the body (or bodies) is found, parts are peeled one after another.

Each round, on the ink still unexplained:
1. Candidates are:
   - every **attachment** within reach of a found part;
   - every **standard symbol** the judge may place (checkable, not a bubble, not one line, not a line with a head),
     placed from the unexplained ink's own line pieces.
2. A standard symbol must be a **full match on its own ink**:
   - score at least `recognise` and backward at `plainBack`, as the plain step holds a plain symbol;
   - every line drawn (`LINE_MIN`);
   - not running on past a corner;
   - its box touching the shape, within `inkTol + 1`.
   **Small plain symbols are attachments only** (owner): a symbol on the attachments list, or simple, is never a
   standard-symbol candidate.
3. A candidate must explain **new ink**: at least `PEEL_NEW` of its template on ink no earlier part explains. This
   setting starts at 0.5 (my call) and changes only on the tuning sheets. It stops two symbols claiming the same ink.
4. The candidate explaining the most new ink is taken. Ties go to the higher score.
5. Stop when the shape is explained (`shapeExplained`), when nothing fits, after `PEEL_MAX` parts (start: 8, my call),
   or at the deadline.

The verdict uses the redesign's rule, with the peeled parts added:
- Bodies and peeled standard symbols are **bodies**: each is size-judged.
- Attachments are not size-judged.
- All ink explained and no body off size: **green**. Its name lists the parts: bodies first, then peeled symbols, then
  attachments, with repeats counted.
- Ink still left, and the bodies explaining at least `AMBER_EXPLAINED`: amber "X with extra linework", naming the
  first body, as today.
- The result keeps `operator` for old readers (the first attachment) and adds `parts: [{ name, role: 'body' |
  'symbol' | 'attachment' }]`.

**Normally-closed bodies** (Sheet 1 combination examples: a solid or hatched bowtie). A valve body drawn filled is the
same symbol with its triangles filled. Hatch lines or slices lying wholly inside a found body's own closed outline are
part of that body (my call; from the examples). His tiles 63 and 64 on H4 are hatched ball valves he called standard.
The half-filled valves on H3 (tiles 40 and 47, right flags) stay amber: one triangle filled is not in the legend. So
the rule needs the fill to cover both triangles, or, on a symbol with one closed outline, that outline whole.

### 4. Line marks and connection lines (judge, beside the pipe cut)

- **The pipe cut passes through line marks.** Today a piece meeting the pipe is a junction, and the cut stops there.
  - A tick or hatch repeat that matches a stored line mark, laid across the line being cut, is not a junction. It is
    cut with the line.
  - So C's ball valves lose the electric tick on their instrument line, and H4's flowmeter loses its signal line's
    ticks.
- **A line leaving a body to a tag bubble is a connection, not the body's ink.** This follows the INSTRUMENTATION
  DESIGNATION example, where a bubble is joined to its in-line element by a plain line. It is my call, and it needs
  the owner to check it on the pictures. A straight run starting on a found body's box edge and ending on a found or
  matched bubble's ring, with only line marks on it, is cut off the body like pipe. Examples: H2 tile 22's strain
  gauge stem, and H4 tiles 68 and 69.
- **Ticks and hatches standing alone** on a long line: ink that matches a line mark across a line piece is part of
  that line. It is not a shape and gets no box. The sheet heading counts it: "N line marks read as part of their
  lines". The count makes the class visible. Showing it in the heading is my call.

### 5. Bubbles: rim marks and touching bubbles (judge)

- **Rim marks.** A found or matched bubble may carry the rim-mark attachments (section 2), within reach of its ring.
  The GEP / Quality / Safety mark beside a bubble is then green with it. Alarm letters beside it are writing.
- **Touching bubbles.** A closed shape that holds two or more rings, each with writing (FIT over FE in the
  example), is matched ring by ring:
  - the bubble match runs on each ring's outline in turn;
  - the shape is green when every ring matches and nothing else is left.
  - The rings are found with the redesign's ring test.

### 6. A line with a head (judge)

- **What it is.** A symbol is *a line with a head* when:
  - one straight line runs its whole longer side;
  - and all its other ink lies within `HEAD_ZONE` of one end (start: 35% of the length, my call).
  - Sheet 4's FLOW DIRECTION ARROW (4 × 21) is one. Sheet 1's DIRECTION FLOW ARROW, a solid head with no stem, is not.
- **The rule** (extends the single-straight-line rule):
  - A line with a head is never the closest for "drawn differently", and never a standalone fit (plain, box or loose
    search).
  - When the sweep finds one, the judge keeps it as a **body only if its head can be told from a line**. At the
    placed size, the head's template points lying more than `inkTol` off the line's own ink must be on ink at
    `LINE_MIN`. If too few such points exist (the head is no wider than the line's tolerance), or they are not on ink,
    the found symbol is dropped for this shape. The shape is then judged without it, usually red.
- It may still be an **attachment** (section 2), and its head is held to the same test there.
- Sweep lists are unchanged.

### 7. Fitting at the sheet's scale (judge; the strain-gauge cause)

The cause, read from the code and to be confirmed test-first on invented data:
- The judge's box fit (`boxFit`) and its quick look (`quickFit`) check the stretch against the **absolute** band.
  That is `CHECK_DEFAULTS.minScale` 0.75 / `STRETCH_MAX` 1.5 = 0.5, not the judge band at the sheet's scale.
- On H2 the sheet scale is 0.432, so no symbol drawn at sheet size can ever be box-fitted there, and LEVEL - GENERAL
  at 60% of that is far below.
- **A second filter:** a symbol holding letters is box-fitted only when writing lies in the shape. LEVEL - GENERAL holds
  "X" and "L". On printed H2 the letters are spotted as ink, and whether they reach `writing` is checked in the
  build.

**The fix:**
- `boxFit` and `quickFit` use the judge band (`JUDGE_BAND` times the sheet's size scale), as every other judge
  placement already does.
- On a printed sheet, the letters test also counts spotted letter rows inside the shape as writing.
- Then the size rule makes LEVEL - GENERAL amber "drawn at N% of standard size", the result the owner called right.

### 8. Screen and report

- The green name lists the parts (section 3). Amber reasons are unchanged in kind.
- The heading gains "N line marks read as part of their lines" when N > 0.
- `reasonText`, `markLine` and the report take the `parts` field when it is there. Old results read as before.
- No `tools-src/` change is expected. If one is needed, it is an anchored patch after a backup.

## Gate

1. **No harm.** On A, B, C, M, P1, P2 and the supplier sheet, the tag verdicts and sweep symbol lists are identical to
   the post-7aae000 baseline (`phase4-build/baseline`). Wrong family stays 0.
2. **Tuning answers (C, M, P1, P2, H1),** on the private scorer `score4.py`, no worse than the redesign:
   - "not a symbol" amber at most 4;
   - standard amber at most 12, and standard green at least 30;
   - all 15 right flags boxed.
3. **His eye on H2-H5 (now answered sheets): at least 75% of amber called right.**
   - Each amber box is matched to an answered tile, as `score4.py` matches answers.
   - A tile's answer counts only when its reason (kind and name) is unchanged, or when the answer was "not a symbol".
     A box that is not a symbol is never a right flag, whatever the reason.
   - Pre-answered: tiles 5, 6 and 7 as "LEVEL - GENERAL drawn at N% of standard size" are right (owner, 2026-11-18).
   - Every other amber box goes on a new numbered tile PDF for him to answer, and the score waits for his answers.
4. **The right-flag guard:** none of the 48 right flags (33 on H2-H5, 15 on the tuning sheets) is green.
5. **Border:** 0 boxes outside the drawing area on any of the ten sheets.
6. **Time:** no sheet over 60 s on mains. The new code and HEAD are run back to back, both reported.
7. **Tests:** `npm test` green, with each rule written test-first on invented data.
8. **Afterwards:** a fresh eye test on new contractor P&IDs he will supply. These are held out, and no rule is tuned on
   them.

Each rule is also shown on C, M and P1 before the gate. There is a picture of each place a rule changes a mark, and a
count per rule, so the owner sees what each one does.

## Left to the builder

- How the importer finds and cuts the Sheet 1 samples, within section 1.
- The exact peel order and candidate pruning, within section 3, kept inside the time gate. One example: only symbols
  no bigger than the unexplained ink's box at the band's top.
- The fill rule's geometry for normally-closed bodies.
- How a line mark is matched across a line: template placed along the line's axis, both sides.
- Setting names. `PEEL_NEW` 0.5, `PEEL_MAX` 8 and `HEAD_ZONE` 0.35 start at these values and change only on the tuning
  sheets C, M, P1, P2 and H1, never on H2-H5's new tiles or the contractor set.

## Evidence (private, outside the repo)

- The owner's answers on the 80 amber tiles: `pid-symbol-spike/phase4-build/owner-answers-H2-H5.py`. Tile pictures are
  in `held-out-amber-H2-H5.pdf`, with its index `.json`.
- Shapes per sheet from the redesign run: `phase4-build/t7/*.json`.
- Where the corner arrows came from (t7): tiles 30, 31, 33, 34 and 35 are FLOW DIRECTION ARROW found by the sweep,
  with all ink explained, amber for size at 76-81%. Tiles 2 and 3 are "drawn differently" closest at 85-86%.
- Tiles 5 and 7 also took MANUAL ISOLATION as an operator at 0.969 on the box's corner letters. This shows how freely
  a small attachment fits, which is why section 3 asks for new ink and the guard.
