# P&ID symbol check, phase 3 redesign: box every shape, flag only what can be pinned to a standard symbol

**Date:** 2026-11-18
**Status:** approved by the owner 2026-11-18 ("approved build it"). Plan next (superpowers:writing-plans).
**Replaces:** the verdict rule, the reasons and the report and screen marks of
`2026-11-17-pid-whole-shape-check-design.md`. Until now, every shape the standard symbols do not wholly explain
has been called "not to standard". The splitter, the sweep, operators, hatch and arrowhead rules and the tag
pairing stand.
**Takes from phase 4** of `2026-11-16-pid-every-pdf-format-design.md`: sheet-wide scale and sizes judged against
it. Phase 4 keeps every page, statuses, opacity and layers.
**Builds on:** phase 3 live as a trial (9306702, ba50949, 3a1bb9c) and the P1 scale fix (7aae000).

## Intent

The shape check went live as a trial on 2026-11-18. Three rounds of rules, one round per drawing, took four tuning
sheets from 442 flags to 119. The owner's six-sheet "worst case" binder still flooded: 785 flags over the ten
sheets, 409 of them resembling no legend symbol at all. He said: *"you need to identify the cause though, not just
fix it for these drawings."*

The two causes, both measured (private notes in `pid-symbol-spike/phase4-measure/`):

1. **The question was wrong.** The check judges every symbol-sized blob of ink. Most ink on a P&ID is not a symbol:
   frame, title block, logo, labels, arrowheads, pipe ends, and on printed sheets the text. With only the legend to
   go on, the check cannot tell "a non-standard symbol" from "not a symbol". So every gap in the hand rules became a
   flag.
2. **Recognition depended on how the PDF was written, not on what was drawn.** Bubbles were found only as one
   closed path. The sheet's scale was read once per sheet. Fills split into slices and circles drawn as arcs
   defeated the match. On contractors' sheets, "no match" often meant "could not read it", not "not standard".

The tool still exists to find what is and isn't compliant with the standard symbols. The redesign keeps a box on
every shape it looks at, but calls a shape **not to standard** only when it can say which standard symbol the shape
departs from, and how.

### The owner's rulings (2026-11-18, his words where quoted)

- **Pick the reading method to suit the PDF.** "I don't want to default to one method, let's have it intelligent
  enough to choose which works best based off the PDF style."
- **Size is a fault too.** "If symbols are scaled too small this needs to be flagged as well, too small or too big."
- **Tolerance:** "10-20% maybe", for both "different in shape or different in size".
- **Keep boxes on everything; no guessing.** "I like all the boxes around items, it doesn't need to try and assume
  what they are, but if it's not a symbol but boxed.. that alone is useful."
- **Crop to the drawing area.** "We still need to avoid all the border bits… just crop the drawing area to what we
  want to check."
- **Unidentified shapes in red, not grey:** "a bolder colour than grey because it's quite hard to see, maybe red?
  as we don't think it's standard."
- **Contractor sets usually come without their own legend sheet.** So comparing their legend with ours is not the
  route.
- **Other standards' symbol libraries:** his idea, tested (see *Approaches*) and not built.

## Goals

1. Every judged shape inside the drawing area gets a box in one of three marks:
   - **Green, standard:** named, as today.
   - **Amber, not to standard:** numbered, with a reason that names a standard symbol.
   - **Red, not identified:** no name and no guess.
2. Nothing outside the drawing area is judged: not the frame, the edge marks, the title strip or block, the logo,
   or notes and legend boxes inside the title strip. This holds on CAD, printed and turned sheets alike.
3. Amber means the check can point at one of the owner's symbols. The reasons:
   - **Drawn differently from X:** at least 80% alike, but not a match.
   - **Drawn at N% of standard size:** more than 15% off at the sheet's scale.
   - **X with extra linework:** what is still attached once the pipe is cut away.
   - **Tag T has no standard symbol.**
4. Each sheet is read by the method that suits how its PDF was written, chosen by the check and stated in the
   result.
5. The sweep's symbol lists and the tag verdicts of phases 1 and 2 do not change.

## Non-goals

- Naming red shapes, or saying what they were meant to be.
- Learning a "not a symbol" library from the owner's answers (option B). It is deferred until he has seen what the
  red boxes hold.
- Matching other standards' libraries (BS 1646, ISO 10628, ISA).
- Reading a contractor's own legend sheet.
- Scanned images (phase 6), and OCR of any kind.
- Pictures or table rows for red shapes in the report.

## Anti-goals (a failure even if it works)

- **Rules written for one drawing.** Every rule must be a general property of P&IDs or PDFs, tested on invented
  data, and measured on all ten sheets, not on the sheet that prompted it.
- **Hiding a class of shape without measuring it.**
- **Regressions:** a tag verdict or a sweep symbol list changing on the no-harm sheets.
- **A report that floods:** hundreds of pictures, or a wrong "closest" name printed as if it were a finding.
- **A per-symbol scale** that silently absorbs a symbol drawn at the wrong size.

## Constraints

- Nothing writes `register.json`.
- No client data in the repo. Real sheets, outputs and answers stay in `../pid-symbol-spike/`, and tests use
  invented data only.
- `tools-src/` is changed only by anchored patch after a backup; the owner runs `node scripts/lock-tools.mjs`.
- No new dependency and no OCR without asking. Pixel rendering in Node would need one, so the build works from the
  PDF's line pieces, not from pixels.
- Sonnet for subagents. The owner's terminal is PowerShell 5.1. Commit only when he asks.
- He judges by eye from numbered picture PDFs answered in plain words. He cannot use Bluebeam answer keys. Show him
  samples made from his real sheets, never invented ones.

## Approaches considered

All were scored against his 205 plain-word answers, mapped onto today's judged shapes: 36 "not a symbol", 9
"right flag" and 77 "standard" still in play. The other 75 "not a symbol" answers are already gone under every
option. Counts are answers got right.

| Approach | Not a symbol | Right flag | Standard | Boxes |
|---|---|---|---|---|
| Live trial: flag every unexplained shape | 2/36 | 9/9 | 20/77 | 785 on 10 sheets |
| **A.** Flag only near-misses of a standard symbol, loose (closest score ≥ 0.50, explained ≥ 0.30) | 23/36 | 7/9 | 56/77 | 283 |
| **A.** Near-misses, strict (closest score ≥ 0.80, explained ≥ 0.50) | 32/36 | 1/9 | 64/77 | 128 |
| **B.** Library of his rejections, tried on a sheet he had not checked | 12/36 | 8/9 | 28/77 | 626 |
| A then B | 30/36 | 3/9 | 64/77 | 186 |
| Black & Veatch BS 1646 library (153 symbols) added, box only its look-alikes | 48/52 | 0/9 | 69/88 | 58 on 5 sheets |
| "Have a look" picture page for everything not anchored | — | — | — | 443 pictures after grouping repeats |

- **C, reading from the drawing rather than the PDF's structure,** cannot be scored until it is built. One proxy was
  measured: a circle test on the ink found all 17 bubbles on H1 that are flagged today, with 1 false hit among 34
  "not a symbol" and none among the 9 right flags.
- **Prior art.** Published methods (legend-based template matching; a two-stage "is it a symbol?" detector plus
  one-shot naming; graph networks on vector CAD) all detect known symbols. None tries to find symbols that are not
  in the legend. The trained detectors need a model, marked-up drawings and new dependencies.
- **Black & Veatch library.** His right flags look like no symbol in it. Its look-alikes on H1 were his standard
  symbols, unreadable on the print. In the table, 52 and 88 are the answer counts under that library, which splits
  the drawing differently.
- **No near-miss threshold separates his right flags from the noise.** Five of them resemble a standard symbol at
  only 0.55 to 0.56. Two (an arc stack) resemble nothing. Two are a found valve that took in extra ink. And 13 of
  his "standard" answers are also a found valve joined to its pipe.

**Chosen (by the owner, 2026-11-18):** A strict, with every other shape kept as a red box rather than a count, plus
C, the drawing-area crop and the size rule.
- **Measured with the crop and A strict only** (no C, no pipe cut), on the five answered sheets:
  - Not a symbol: 19 cropped out, 2 green, 11 red, 4 amber.
  - Right flags: 1 amber, 8 red. All 9 still boxed.
  - Standard: 20 green, 44 red, 13 amber.
- **On all ten sheets:** 124 amber and 601 red.

## Design

### 1. Drawing area (`pid-symbol-check.js`, beside `titleBlockBox`)

- **Find the frame.** Take the page's long straight lines, after rotation, which is the step that failed on turned
  sheets. The frame is the innermost line on each side among those running at least 60% of the page width or
  height, and lying in the outer 15% of the page.
- **Find the title strip.** It is a vertical line in the right 30% of the frame that covers at least half the
  frame's height once collinear pieces are joined, with at least two horizontal lines running from it to the
  frame's right edge.
  - Printed sheets draw this line in pieces. On H1 it covers 64% of the height.
  - A bottom-right title block that is not full height is found the same way, from its top and left lines.
- **Judge only inside the frame and outside the title strip or block.** Shapes touching the frame line, within 4
  pt, count as outside.
- **Measured:** frames found on all ten sheets. The crop removes 47 of H1's 142 flags and 12 of H3's. 19 of his 36
  "not a symbol" answers go, and no standard or right-flag answer is lost.
- Today's 20 pt border strip and `titleBlockBox` stay as fallbacks when no frame is found. The sheet's heading then
  says so: "Drawing area: frame not found, page edge used" (my call).
- The result carries the drawing area, so the report can draw it faintly.

### 2. Reading method chosen per sheet (`pid-sheet-read.js`, judge)

There are two methods. Both work from the PDF's own line pieces; neither needs pixels.

- **By path, as today.** Closed paths, fills and arcs are taken as written. This is the most exact method on a
  clean CAD PDF.
- **By line pieces.** Path boundaries are ignored, and every stroke and every fill edge becomes loose segments.
  - Collinear pieces are joined, curves are flattened, and filled slices are merged into one outline.
  - A circle is recognised when its pieces lie on a ring, whatever paths they came from. This catches bubbles drawn
    as arcs or pieces.
  - In the measurement, line pieces drawn from the PDF agreed exactly with the printed picture on H1, once the
    page's rotation was applied.

**Choosing (my call on the measure).** Read by path first.
- If fewer than half the judged shapes inside the drawing area come out **green**, read again by line pieces.
  Keep whichever method gives more green shapes. Amber does not count, because it is a finding, not a recognition.
- Red shapes are in the denominator. A sheet that really is full of non-symbols may be read twice; the 60 s time
  gate covers that cost.
- **Line pieces feed the judge only (my call).** The sweep, its symbol lists and the tag pairing keep reading by
  path. So the no-harm gate holds by construction, including on printed sheets that switch.
- A shape the judge recognises from line pieces (a bubble drawn as arcs, say) is green on the drawing and in the
  counts, but is not added to the sweep's symbol list.
- Today's identified shares: C 90 of 119 shapes standard; M 30/55; P1 8/34; P2 11/50; H1 23/165.
- The threshold is set on the tuning sheets.
- The sheet's result and report state which method was used: "Read from: drawn paths" or "Read from: line pieces".
- Scanned sheets keep phase 6's "not checked yet".

### 3. Sheet scale, then size per symbol

- **Sheet scale.** It is the median, over all found symbols and bubbles, of found size against legend size. That
  generalises `estimateSheetScale`: an A1 drawing printed on A3 reads about 0.41, and a clean sheet reads 1.0.
  - Scale is never estimated per symbol, so a wrongly sized symbol cannot hide.
  - The sheet reads "Printed at N% of full size" once, when N is outside 95-105%.
- **Where the scale comes from.** The median is taken over the symbols the sweep finds in today's band, as
  `estimateSheetScale` already does with bubbles.
  - It is a median, so a minority drawn at another size does not move it. On H2, 14 of 64 symbols sit at about 75%
    while the median sits at 100%.
  - With fewer than 5 found symbols the sheet keeps today's scale reading.
- **Search band (my call).** The sweep's band is unchanged, which keeps the no-harm gate.
  - The judge alone searches 0.6-1.6 times the sheet scale when it fits a symbol to a shape. So a symbol at 70% is
    still matched, then flagged amber for size.
  - The time gate measures the cost.
- **Size rule.** A matched symbol whose size differs from the sheet scale by more than **15%** is amber: "drawn at
  N% of standard size".
  - 15% is the midpoint of his 10-20% and is a named setting.
  - A stretched fit (a symbol fitted to its box at its own proportions) is judged on its larger side.
- **Measured** (found symbols only, size at the sheet's scale):
  - C (102 symbols) and M (45): all 99-100%.
  - H1 (9): all 100%.
  - H2 (64): 75-101%, with 14 more than 20% below the rest.
  - P1 (11): 87-130%. P2 (21): 91-130%.

### 4. Cut the pipe off a found symbol

Before a shape holding a found symbol is judged, straight ink leaving the symbol's ends in line with its pipe
connection is treated as pipe and removed from the shape. That ink runs past the symbol's box along the pipe axis,
and stops at the next shape or junction.
- This is aimed at the 13 standard answers that turn amber only because a valve was taken with its pipe (C ball
  valves 105-110 and 155-157, P1 #2, #3, #12, M #170).
- What is still attached after the cut is real extra linework: amber "X with extra linework", as with his right flags
  M #191 and #192, a wedge gate.
- **Finding the pipe line (my call).**
  - Use the legend symbol's connection points where they can be read: line ends on its box edge.
  - Otherwise use its long axis.
  - A symbol with neither, such as a bubble, gets no cut.
- No answer set exists yet for the cut alone. The gate's "standard" count measures it.

### 5. Verdicts and reasons (judge)

Each judged shape in the drawing area gets exactly one verdict.

| Mark | When | Text |
|---|---|---|
| **Green, standard** | today's rule (all ink explained, size within 15%) | the symbol's name |
| **Amber, not to standard** | (a) a standard symbol lines up at least 80% both ways but does not explain the shape (start: closest score ≥ 0.80 and explained ≥ 0.50, as measured); (b) a matched symbol off size by more than 15%; (c) a found symbol with linework still attached after the pipe cut; (d) a tag paired with a shape that is not green | "drawn differently from X (N% alike)"; "X drawn at N% of standard size"; "X with extra linework"; "tag T has no standard symbol" |
| **Red, not identified** | anything else judged | none: no closest name, no number |

- **What "80% alike" means in the code.** "Closest score" is today's `closest.score` from the judge's near-miss
  search, with its existing floor unchanged. "Explained" is `closest.explained`, the share of the shape's ink that
  symbol accounts for. Reason (a) needs both: score ≥ 0.80 and explained ≥ 0.50. Those are exactly the values
  measured as "A strict", and the gate counts in *Gate* 2 were measured with them.
- **Reason (d) applies to red shapes too (my call).** A tag pairs with a shape only when the shape is meant to be a
  symbol, so a tagged red shape is promoted to amber "tag T has no standard symbol". This is the "a tag with no
  standard symbol beside it" flag the owner was shown on 2026-11-18. Tag pairing itself does not change.
- 80%, 15% and 0.50 are named settings. Today's "closest" stays in the data but is shown only on amber.
- Today's "line drawn short" becomes an amber reason under (a) when its closest symbol passes 80%; otherwise the
  shape is red.

### 6. Screen and report

- **Drawing page.** Green boxes are named, as today.
  - Amber boxes are dashed and numbered, as today.
  - Red boxes are a **solid, thin red line, unnumbered**. Solid against dashed, so amber and red still tell apart in
    greyscale and for red-green colour blindness.
  - The drawing area is drawn faintly.
- **Each sheet's heading** reads, for example: "23 standard · 12 not to standard · 140 not identified · Read from:
  line pieces · Printed at 41% of full size".
- **Pictures and table rows are for amber only.** Red is a count per sheet and boxes on the drawing.
- **Key:** Green standard. Amber "not to standard: the reason names the standard symbol it departs from". Red "not
  identified: looked at, not matched to any standard symbol; check by eye". The trial note stays.
- **Screen.** It shows the same three marks. The list shows amber in full and red as a count. Jump to box works for
  amber.

### 7. What does not change

The sweep's symbol lists, the tag verdicts and the tag table, the operator heading, `register.json`, and save-call
counts in the tool.

## Gate

1. **No harm.** Tag verdicts and symbol lists are identical to the post-7aae000 baseline on A, B, C, M, P1, P2 and the
   supplier sheet. Wrong family stays 0.
2. **Against his answers.** Use the private scorer in `pid-symbol-spike/phase4-measure/`, re-run on the new shapes.
   No worse than the measured design:
   - amber on at most 4 of the 36 "not a symbol";
   - amber on at most 13 of the 77 "standard", and green on at least 20 of them;
   - all 9 right flags boxed, amber or red.
   - Report the green count too, since C and the pipe cut should raise it.
3. **Border.** No box outside the drawing area on any of the ten sheets, checked on a picture of each.
4. **His eye, held out.** A numbered picture PDF of every amber shape on H2-H6 (never answered shape by shape),
   answered in plain words. Target, my call: at least 3 in 4 amber boxes called right. A red-box overview page per
   sheet goes to him too, so he can see what red holds.
5. **Time.** No sheet over 60 s on his machine. Today's runs take 20-53 s, and reading twice costs more.
6. `npm test` green, with each new rule test-first on invented data.

## Left to the builder

- The exact frame and title-block geometry, within the measured rule.
- How collinear joining and the ring test tolerate printed line breaks.
- The method-switch threshold.
- How the pipe cut finds a symbol's pipe ends: legend connection points, or the long axis.
- Data shapes and the report layout within section 6.
- Settings names. The three thresholds (80%, 15%, 0.50) start at the measured values and change only on the
  tuning sheets, never on held-out ones.

## Evidence (private, outside the repo)

- `pid-symbol-spike/phase4-measure/`: labels from his answers (`labels.py`), scorer (`score.py`), options A and B
  (`options.py`), circle test (`ctest.py`).
- `pid-symbol-spike/foreign/`: the B&V library test (`compare_foreign.py`, `probe-foreign.mjs`), look-alike
  grouping (`groups.py`), frame and title strip (`frame3.py`, `design.py`).
- Notes with every count:
  `side-session-notes/local_8be0f1f2-3dfc-4be0-9370-a47fd4955ef3/phase4-option-counts.md`.
