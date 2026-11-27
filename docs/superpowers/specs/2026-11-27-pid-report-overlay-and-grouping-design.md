# P&ID symbol report: overlay and grouping (design)

Status: DRAFT for the owner's approval, 2026-11-27. Not built. Invented data only in tests; real sheets stay outside the repo.

## Intent and why
The owner likes the boxes on the drawing. What the report does not yet do is make a flag **clear at a glance**:
- A subtle fault (a DIAPHRAGM drawn with a rounder dome than the legend's) is wrong but looks almost right, and a size fault (a BALL at 75% of the sheet's size) is invisible in a lone picture. Today a flagged shape is a picture of the drawn shape plus a caption like "closest: IN-LINE (ANY TYPE) 98%". That percentage is how well the nearest symbol fits, not what differs, and here it hid the missing dome.
- One sheet (binder test 3) flags 24 BALL valves with the same size fault, each its own entry. The list is long and says one thing 24 times.

The owner wants to **see the difference** and **cut the list down**, in the PDF report and on the tool's screen alike ("it'll tidy things up").

## Goals
1. For each flagged shape, an overlay showing the drawn ink, the legend symbol the check thinks it is, and the drawn ink the symbol does not have.
2. For a size fault, the legend symbol at the sheet's own size beside the drawn one, with the percentage.
3. Group shapes by result: the same symbol with the same verdict and fault share one number. The list becomes one line per group ("#3 BALL ×4 standard", "#4 BALL ×6 drawn at about 75% of sheet size").
4. Smaller tiles so fewer pages are used.
5. The same numbers and groups on the drawing, in the PDF list and in the on-screen view.

## Non-goals
- No change to any verdict, box or percentage the check gives (the check is only asked to record more; see Constraints).
- No change to the grey "not identified" handling beyond smaller tiles: they have no symbol, so no number and no overlay (they stay one group of their own).
- No attempt in this work to make the check name the rounder-dome diaphragm correctly. The owner is happy for a wrong match to stay wrong; the overlay is meant to show why.

## Anti-goals (a failure even if it technically works)
- An overlay that disagrees with the verdict it sits beside.
- Grouping that hides a fault: two different faults under one number, or a lone odd shape lost inside a large group.
- A report longer than today's for the same sheet.

## The design
### Numbering and grouping
- Every shape matched to a symbol gets a **group number**, green or amber alike. Group key = symbol name + verdict + fault. Fault = the reason kind (size, extra linework, differs) and, for size, the percentage rounded to the nearest whole number with 75 and 76 treated as one (within 2 points of the group's first member). The wrong symbol named by a wrong match is the symbol of its group.
- A standard symbol's group is "NAME, standard". Each fault of a symbol is its own group, so one BALL can have #3 standard, #4 at 75%, #5 with extra linework.
- Unmatched (not identified) shapes carry no number; they are listed as one "not identified" group with a count.
- A shape that appears once is a group of one (a normal tile).
- Numbers are given in a fixed order: amber groups first (largest first), then standard groups (largest first), so a sheet's main problem is on page one. The same shape always gets the same number for the same result.
- Every box on the drawing page shows its group number.

### The list (PDF and screen)
One line per group: number, symbol name, count, and the verdict or fault in words. The boxes are not listed one by one; the drawing shows where each is by its group number. Amber groups carry one overlay tile each (the group's first member, in reading order). A standard group is one line, no tile.

### The overlay tile
Drawn from a recorded overlay (below), smaller than today's tile:
- Black: the shape's drawn ink.
- Blue dashed: the closest/matched legend symbol laid where the verdict laid it.
- Red: drawn ink the symbol does not account for.
- Size faults: a second small picture, the symbol at the sheet's own size, with "drawn at N% of sheet size".
Caption: group number, symbol name, fault in words, count.

### Approaches considered (the owner chose 1)
1. **The check records the overlay.** When the judge settles a shape's closest or matched symbol, it keeps that symbol's outline in page coordinates and the unmatched drawn pieces on the shape's result. Chosen: the overlay is exactly what the verdict used. Costs a larger result (a few dozen segments per shape).
2. The report re-places the symbol itself from the library by name. Rejected: a second match that can disagree with the verdict, and slow.
3. The report places the symbol only for each group's example. Rejected: the same disagreement risk, and the report step would need the legend and the ink.

## Where it lives (existing files)
- `assets/js/pid-symbol-check.js`, judgeShapes: add to each shape's result a field `overlay` = `{ symbol: [[x0,y0,x1,y1]...], unmatched: [[...]...], placedBox, sheetSizeBox }` (page points, same frame as `box`), from the placement the verdict already computed. Shapes memoised by `memo` carry it too.
- `assets/js/pid-symbol-report.js` (`buildReportModel`, `symbolParts`, `numbered`): replace flag-by-flag numbering with grouping; model carries groups.
- `assets/js/pid-symbol-report-pdf.js`: draw group numbers on boxes, the group list, the overlay tiles (smaller).
- `assets/js/pid-symbol-check-view.js` and the tool page: the same grouping and numbers on screen. The tool's page is `tools-src/pid-tag-register.html` (gitignored, patched with anchored edits, then the owner runs `node scripts/lock-tools.mjs`); the view module carries as much as possible so the page edit is small.

## Constraints
- **Verdicts unchanged:** the check's verdicts, symbols, boxes and percentages must be byte-identical before and after on A, B, C, M, P1, P2, H1-H6 and the six binder pages, apart from the new `overlay` field. Compare with `scripts/time-pid-pipeline.mjs --verdicts/--compare` after excluding `overlay` from the compare (or strip it in the compare), and say plainly if anything else moved.
- Result size: worker messages stay small; check the largest sheet's result size before and after, in counts.
- Old results (saved before this change) have no overlay: groups still work, the tile falls back to today's picture and caption.
- Tests first, invented data only; real sheets stay outside the repo, report counts only.
- Time: no extra check time beyond a negligible placement copy (the placement is already computed).

## What is left to the builder
- Exact tile sizes, fonts and colours (match the existing PDF's look; amber/red/green already defined).
- How the percentage grouping tolerance is applied across a group (running first member vs rounded value): pick one, test it.
- The visual detail of the overlay when the legend symbol has hundreds of segments (thin it as the current tile does).
- Page count rules: fill pages top to bottom; no tile split across pages.

## My calls (not yet agreed by the owner)
- Group size faults within 2 points; number order amber-first, largest-first; the first member in reading order is the example; standard groups are one line without a tile.
- Not-identified shapes stay unnumbered.
- Tolerance and ordering rules are easy to change later; the grouping lives in one function.
