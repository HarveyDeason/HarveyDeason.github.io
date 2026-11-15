# P&ID symbol check: instrument bubbles

**Date:** 2026-11-15
**Status:** approved by the owner 2026-11-15 ("write the plan").
**Builds on:** `2026-11-13-pid-symbol-library-and-check-design.md` (phases 1 to 3)
and `2026-11-15-pid-symbol-check-report-design.md` (the report).

## Intent

The symbol check names the standard symbol beside each tag: "Ball valve",
"Flowmeter", and so on. Tags of instruments read "Not checked: Instrument
bubbles are not checked yet". On a typical sheet they are the largest group
of Not checked rows. In the report they look odd: listed, but with no answer.

The owner wants bubbles **identified the same way as the other symbols**. The
check should say "a standard bubble, this kind" (field mounted, local panel,
PLC and so on). It should not judge whether that kind is the right one for
the instrument. The sheet's summary and the report then read, for example,
"25 field mounted, 1 local control panel", each bubble confirmed as drawn
with a standard symbol.

The owner also wants the tool **not tied to one company**. What a bubble looks
like and what each kind is called must come from the legend the user imports,
never from the public code.

## What was found (2026-11-15)

Measured locally on the client's legend and on three real palette-drawn
sheets. Nothing below names a drawing or a tag. The measurements are kept
outside the repository.

**The legend does hold the bubbles.** Legend sheet 1 has a ruled table of 13
entries: 11 bubbles and 2 interlock tag flags (a pentagon box on a leader line
ending in a dot). Phase 1 did not read it. It has no heading row with the
word SYMBOL, no tag identifier row and no column divider, so the importer
listed it as an "other ruled area". One of its ruled rows holds two entries
stacked, because the rule between them is missing or too short to count.

- Every bubble outline is 42.5 pt across (the hexagon is 49.1 x 42.5).
  The linework is clean 0.51 pt strokes.
- Outline: circle, hexagon, or circle inside a square.
- Lines across the middle at full width: none, one, or two (2.9 pt apart). A
  "back of panel" variant has its line(s) broken by a gap of about 9 pt in
  the middle. That gap is real geometry in the legend: two segments, not a
  dash pattern.
- Placeholder text sits inside each outline: a code line on top and a number
  line below. **A bubble carries the tag itself.**

These conventions are the general ISA 5.1 ones. The design still reads them
from the legend, so a company whose legend differs gets its own.

**The library.** The library behind the 2026-11-15 report was imported from
the legend at 19:34 and has no bubble entries: the importer never takes this
table. The copy in the owner's shared folder could not be inspected from this
machine. Manual entries have no linework, so they could not be matched in any
case.

**The three real sheets:** 99 tags, 30 Not checked.

- 4 are tanks ("Drawn to suit").
- The other 26 all sit inside a 42.5 pt circle, exactly legend size, with the
  tag split over two lines (code on top, number below). 25 have no line
  (field mounted) and 1 has two lines (local control panel).
- 4 of those 26 have function codes that the tool's instrument lookup does not
  list. Two of them are equipment codes. The bubble on the sheet is better
  evidence than the lookup.
- 4 more bubbles hold flow element tags. Their flowmeter symbol beside them
  carries a separate flowmeter tag.
- One sheet has a PLC hexagon holding placeholder text, not a tag.
- No sheet has a back-of-panel, PLC or telemetry bubble round a real tag.

## Goals

1. The legend import reads the bubble table into the library, as symbols with
   linework, names and table heading, like every other table.
2. A tag written inside a bubble gets a verdict like any other symbol: **OK**
   or **OK, off size**, naming the bubble kind from the legend.
3. A tag with an instrument function code that is not in a bubble, and has no
   library family of its own, reads **Needs a look**, not Not checked.
4. The screen, the sheet summary and the PDF and Excel report show bubble
   kinds like any other symbol, with no special columns.

## Non-goals

- Judging whether the kind is right for the instrument: for example a
  pressure element drawn as panel mounted. The owner does not want this.
- Comparing the letters in the bubble with the tag. The tag was read from
  those letters, so the comparison would always agree.
- The two interlock tag flags. None appear on the owner's sheets. They are
  left out on purpose (see *Import*).
- Tanks and other families "Drawn to suit". They stay **Not checked**, as now.
- Untagged bubbles, and bubbles holding placeholder text. Only tags are
  checked, as now.

## Anti-goals

- **Anything company-specific in the public code.** No bubble names, table
  headings, outline shapes or line rules are written into `assets/js/`.
  Shapes and names come from the imported legend. The only general idea in
  code is "a legend symbol whose outline holds placeholder text is a tag
  bubble".
- A bubble kind reported on a guess. When two kinds score too close to call,
  the check says "one of" both, as it does for mirror-image valves.
- A bubble's own outline making a neighbouring tag read as Wrong family.

## Constraints (unchanged from phase 3)

- Nothing writes `register.json` or the register folder. Results are shown and
  exported, never saved.
- The repository is public. No client data in `assets/js/`, `scripts/`,
  `docs/`, tests or fixtures. Tests use invented bubbles.
- Zero build, vendored libraries only.
- Logic goes in the pure modules (`pid-symbols.js`, `pid-symbol-check.js`)
  with `node --test` coverage. The tool (`tools-src/`, gitignored) gets thin
  glue by anchored patch after a backup. The owner runs
  `node scripts/lock-tools.mjs`.
- The interface keeps saying the check confirms the family, not the member.
  For a bubble, the family is "tag bubble" and the member is the kind.

## Approaches considered

1. **Match the legend's bubbles with the existing ink score (chosen by the
   owner).** The import reads the bubble table into library symbols. The check
   places each bubble symbol on the outline round the tag's text and scores
   it two ways, as for valves. The best score gives the kind.
   - Gains: same method and verdicts as everything else; names and shapes come
     from the user's legend; a new legend issue is picked up by re-importing.
   - Cost: the import must read a table with no heading row and no divider.
2. **Read the shape by rule.** Find a circle, hexagon or square round the tag
   text, measure it, count the lines across it, and name the kind from a
   fixed rule.
   - Rejected: the kinds and names would live in public code, so the tool
     would be tied to one convention. It also depends on how each CAD package
     writes a circle (one curve, arcs or a polyline), and it differs from how
     every other symbol is checked.
3. **Enter the bubbles by hand.** Rejected: the same work as approach 1 minus
   reading the legend, and it goes stale when the legend changes.

## Design

### Import (`legendCells`, `buildLibrary` in `pid-symbols.js`)

- A ruled area with no SYMBOL heading row is still read as symbols when **every
  non-empty row splits into one compact cluster of linework on one side and
  label words on the other**. A compact cluster is one whose box is at most
  `maxSize` (120 pt) on each side. There is no divider, so the split is the
  gap between the cluster's box and the label's words.
  - The area's first row, when it holds words only, is the group heading.
  - A ruled row holding two clusters stacked one above the other, each with
    its own label words beside it, is split at the gap between them.
  - **All or nothing (my call).** The area is read as symbols only if it has
    at least two symbol rows and every non-empty row after the heading
    splits. Otherwise the whole area stays in `other`, as now, so a line-type
    table, a title block cell or a worked-example box never adds junk symbols.
    Line types, demarcation, title block cells and worked examples each fail
    this test on the client's legend: they are words only, or one row holds
    many clusters.
- **Tag bubble.** A symbol read this way, or from any table, is marked
  `flags.bubble = true` when both of these hold:
  - a single closed path in its linework encloses the placeholder words in
    its cell;
  - some path that encloses those words has a box equal to the symbol's whole
    box, within tolerance.

  For a circle inside a square, the square satisfies the second condition.
  The interlock flags fail it: their leader line reaches beyond the box round
  their text.
- **Ring (new field, my call).** For each bubble the library stores `ring`.
  It is the box, in symbol coordinates, of the *smallest* closed path that
  encloses the placeholder: the circle for a circle-in-square, and the
  outline itself otherwise. The check aligns this ring with the outline found
  on the drawing.
- Placeholder words inside a bubble are **not** stored as `letters`. Letters
  are text a drawing must also show, like the H in a manual control station.
  A bubble's placeholder is replaced by the tag.
- The import preview shows a "Tag bubble" badge and a tick box beside
  "Simple shape" and "Drawn to suit", so the owner can correct the automatic
  mark. When the owner changes it, `flags.bubbleByHand = true` is also set.
  That counts as hand work in the re-import carry-over (beside `simple` and
  `stretch`), so a correction survives a new legend issue. An unchanged
  automatic mark is simply recomputed (my call).
- Library file: `flags.bubble`, `flags.bubbleByHand` and `ring` are the only
  new fields. A library without them reads as before. Getting bubbles needs a re-import of the legend; notes,
  aliases and exceptions carry over as now.

### Check (`pid-symbol-check.js`)

`prepareSymbols` today marks a symbol with no straight lines as "simple" and
skips it; a field-mounted circle is all curves. A bubble symbol is prepared
as checkable whatever its line count. It is not proposed by line pairing,
because the text inside tells the check where it is.

**Order (my call).** The bubble step runs first, for every tag place, before
the family search. It only acts where an outline encloses the tag's text. A
valve or flowmeter tag written beside its symbol is never enclosed, so it goes
straight to the family search, unchanged. A recognised bubble claims only its
own outline's spot. A flowmeter or valve symbol next to it is a different
spot and stays free for its own tag.

For each tag place (from `tagPlaces`, which already handles a tag split over
two lines):

1. **Find the outline round the text.** It is the smallest **single** path on
   the drawing that meets all three conditions:
   - its box contains the tag's text box;
   - it is closed;
   - its box is no larger than the largest bubble ring times `maxScale`.

   That size cap rules out sheet frames and borders. Path boxes already come
   from `boxesOf`. A circle drawn as several unjoined arcs is not joined up in
   this version (my call): no outline is found, and the tag falls through to
   step 4. The owner's sheets and legend draw each circle as one path. This is
   a listed risk.
2. **Place every bubble symbol on it.** Align each symbol's `ring` with the
   outline's box: same centre, upright, scaled so the widths agree. The scale
   must be within `minScale` to `maxScale`. Score each with `scorePlacement`.
   The rasteriser draws linework only, so the tag text inside the bubble
   never affects the score: on the legend side the placeholder is text too.
3. **Verdict.** If the best score is at least `recognise` (0.90):
   - Verdict **OK**, or **OK, off size** outside the ±5% band, as for any
     symbol.
   - `symbol` is the bubble's legend name.
   - `tagId` is empty.
   - `oneOf` lists kinds within `oneOf` (0.03) of the best.

   The spot is marked claimed, so passes 1 and 2 cannot give this outline to
   another tag. The tag then skips the family search.
4. **No bubble recognised:**
   - If the tag's code has a library family, the existing family check runs
     unchanged.
   - Otherwise, a tag whose code the lookup classes as instrument reads
     **Needs a look**. When an outline was found, it names the closest bubble
     kind and score, using the existing `closest`. Example: "No standard
     bubble recognised round the tag. Closest: \<kind\> at 72%."
   - Any other code without a family stays **Not checked**, with today's
     reason.

Which tags count as bubble tags is decided by the drawing: any tag whose text
sits inside a recognised bubble, whatever its code. Equipment codes drawn in
bubbles (seen on the owner's sheets) therefore read OK. A flow element tag in
a bubble is answered by its bubble. The flowmeter symbol beside it stays
available to its own flowmeter tag.

**Expected margins** (estimated from the legend geometry; to be confirmed by
the gate):

- A field circle scored on a two-line bubble: about 0.61.
- One line against two: about 0.80.
- Back-of-panel against the solid line: about 0.95 against 1.00.
  This is the thinnest margin; it stays outside `oneOf`, but only just.

### Screen and report

- `verdictSentence` for a bubble OK reads `Tag bubble: <legend name>.` (plus
  ", drawn at N% of legend size" when off size).
- The results summary adds one line per sheet counting bubbles by kind, for
  example "Bubbles: 25 \<field kind\>, 1 \<local panel kind\>".
- The report's Excel Tags sheet and PDF use the existing columns: Symbol = the
  bubble's legend name, Tag identifier blank.
- The PDF overlay boxes the bubble outline in the verdict colour, as for any
  symbol.
- The family note is unchanged ("It checks the family of symbol, not which
  member of it").

## Testing

- **`npm test` (invented data only):**
  - An invented legend page with a bubble table in the same layout: no
    heading row, no divider, one row holding two entries, a flag with a
    leader. It must give the right symbols, `flags.bubble` on bubbles only,
    and no placeholder `letters`.
  - The automatic bubble mark and its override carried over on re-import.
  - The check on an invented sheet:
    - each invented bubble kind round a tag is identified as itself;
    - a back-of-panel bubble is not reported as its solid-line twin;
    - an off-size bubble reads OK, off size;
    - an instrument tag with no bubble reads Needs a look;
    - an equipment code in a bubble reads OK;
    - a bubble's outline is not claimed by a neighbouring tag.
  - The view and report sentences and summary line.
- **Local gate (not in `npm test`; uses the legend and the owner's sheets):**
  - **Import:** the legend gives 11 bubble symbols, 0 flags marked as bubbles,
    0 rows lost.
  - **Self-test:** each of the 11 legend bubbles, stamped onto a blank page
    round an invented tag, is identified as itself. No "one of" between a
    bubble and its back-of-panel twin.
  - **The three real sheets:** all 26 + 4 bubble tags OK with the kind the
    owner sees on the sheet (29 field mounted, 1 local control panel); 0 Wrong
    family. No verdict outside the bubble tags gets worse. A flowmeter tag
    that now finds its symbol free may improve, and any such change is
    listed. Time per sheet stays within the existing limit.
  - Extended from `scripts/check-symbol-check.mjs` and
    `check-symbol-import.mjs`. Tags print only with `--verbose`.
- **Owner:** re-import the legend in the tool, save the library to the shared
  folder, run the report on a pack, and check the bubble rows by eye.

## Risks

- **Dashed lines on drawings.** The page walker ignores dash patterns, so a
  back-of-panel line drawn with a dash style would render solid and read as
  the solid-line kind. The legend draws it as two segments. No real sheet has
  one. The gate's self-test cannot catch this; the first real back-of-panel
  bubble should be checked by eye.
- **Other authors' circles.** A circle written as one polyline is found and
  scored the same way. A circle written as several unjoined arcs is not found
  in this version, and its tag reads Needs a look. If such sheets turn up,
  joining touching pieces into one outline is the follow-up.
- **Other companies' legends.** The headingless-table rule is general, but
  only one legend has been read.
- **Old libraries.** Until the legend is re-imported, bubbles stay Not
  checked. The Symbols tab should say a re-import adds them.

## Calls made after the builder review (for the owner to check)

1. Bubble step runs before the family search, and only where an outline
   encloses the tag's text.
2. Only single closed paths count as an outline; unjoined arcs are a
   follow-up.
3. Each bubble stores a `ring` (its innermost outline round the
   placeholder) to align with the drawing.
4. A headingless area becomes symbols only if every row splits (all or
   nothing).
5. An owner's change to the bubble mark survives re-import.
6. Size bands are the same as for every other symbol: OK within ±5%, matched
   between 75% and 135%.

## Left to the builder

- The tolerance for "the outline's box is the symbol's whole box", and for
  the gap between a cluster and its label.
- How the smallest enclosing outline is found efficiently (path boxes are
  already computed in `boxesOf`).
- Whether bubble placement tries small centre offsets as well as the
  outline's centre.
- Exact wording of the Symbols tab note about re-importing.
