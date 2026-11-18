# P&ID symbol check: symbols first, on every PDF format

**Date:** 2026-11-16
**Status:** approved by the owner 2026-11-16 ("perfect write it up"). Phase 1
plan next.
**Builds on:** `2026-11-13-pid-symbol-library-and-check-design.md` (phases 1 to 3),
`2026-11-15-pid-symbol-check-report-design.md` (the report) and
`2026-11-15-pid-instrument-bubble-check-design.md` (tag bubbles).

## Intent

The symbol check runs only on sheets whose pre-check reads **Readable**: in
practice our own Plant 3D plots. Contractors' drawings arrive in other
forms. Of the first two the owner tried, one was "Readable from comments" and
one "No readable text". Neither could be checked or reported. The owner calls
the tool "hugely limited" until it copes with them.

**The tool's purpose, in the owner's words, is to find what is and isn't
compliant with the standard symbols.** So it must say both "this is a
standard symbol" and "this is a symbol, and it is not a standard one".

The owner wants:

1. **Every PDF format** a P&ID may plausibly arrive in, contractors' drawings
   first.
2. **Symbols first.** The check's main job is to find and identify every
   standard symbol on a sheet. Tags are "very nice" to have: where they can be
   read, they are attached to their symbols and checked for family, but the
   symbol check must not depend on them.
3. **Unrecognised shapes marked** (owner, 2026-11-16: "important later"). A
   symbol-like shape that matches no standard symbol is reported as
   unrecognised, so a non-standard symbol is caught even where no tag can be
   read. Without this, a sweep is blind to exactly the shapes that are not
   compliant.

Today the check works the other way round. It starts from each tag, looks
within 60 pt, and the tag's code says which family to expect. On a sheet
whose tags cannot be read, it has nowhere to start. That ordering was chosen
on 2026-11-13 because a whole-sheet sweep then gave about 600 false hits on
one sheet. Measured again on 2026-11-16 with today's matching (two-way ink
score, line-pairing proposals), the sweep works (see *What the measurements
showed*).

The check keeps saying what it always has: it confirms that a standard symbol
of the right **family** sits beside a tag, not that the right member was
chosen.

## What the measurements showed

Measured locally on nine PDFs: three Plant 3D sheets, a contractor sheet
whose text is in comments (sheet **M**), two contractor sheets printed with
no text (sheets **P1**, filled letters, and **P2**, single-line letters), a
supplier sheet, a two-page general arrangement and a scanned document. No
drawing is named here. Numbers, probes and pictures are kept outside the
repository (see *Where the evidence lives*).

### Symbols without tags: the sweep

Line-pairing proposals from centres on a 90 pt grid, every checkable symbol,
score ≥ 0.90, one spot per 3 pt, no tags used, no letter removal. Hits were
judged by eye from pictures of each one.

| Sheet | Hits | Time | Judged by eye |
|---|---|---|---|
| Plant 3D sheet (71 tags) | 88 | 23 s | 44 of its 45 tagged valves, same symbol name as the tag-led check; 34 real untagged standard symbols (14 padlocks, 12 capped ends, 4 sight glasses, 4 flowmeters that the tag-led check misses); 1 valve found twice; 9 partial matches inside 4 relief valves and 1 padlock |
| M (comments) | 41 | 19 s | all 41 real standard symbols; a few valves named as another member of the valve family |
| P1 (printed, filled letters) | 23 | 19 s | about 17 real, one actuated valve found about 5 times; 4 false: 2 reference-flag boxes, 2 non-standard bubbles |
| P2 (printed, single-line letters) | 59 | 37 s | about 52 real, several valves found many times; 7 false: 3 printed words as padlocks, 3 note boxes as a plain box symbol, 1 dashed line as a flow arrow |

What the sweep needs before it can be trusted:

- **One symbol per patch of ink.** Repeats and partial matches are the same
  ink claimed more than once.
- **Letters kept out of the ink.** Printed letters are linework and can look
  like a small symbol. This needs letters *spotted*, not read.
- **Care with very plain shapes** (a box, an arrow, a padlock).

The probe skipped a strip at the right of each sheet holding the title block
and, on some sheets, the sheet's own legend. Its effect has not been measured.

### Symbols in other formats

- A sheet turned 90° (page rotation) or drawn sideways on the page: identical
  results to upright.
- A **synthetic scan** of a Plant 3D sheet (200 and 300 dpi, sensor noise,
  speckle, thresholded, no text or linework left): 45 of 45 valve tags scored
  0.95 to 1.00, the same as the vector sheet. Placements came from the
  vector lines and tag positions from the text layer, standing in for parts a
  real scan does not have.
- A sheet printed at 90%: every symbol found, all "OK, off size".

### Tags in each format

| # | Format | How to detect it | Tags and their positions from | Measured |
|---|---|---|---|---|
| 1 | Plotted, real text layer | text items give DS310 tags | text layer | works today |
| 2 | AutoCAD SHX text: letters drawn as strokes, each piece of text also kept as a hidden comment by "AutoCAD SHX Text" | text layer gives no tags, SHX comments do (status "Readable from comments") | comment text and rectangle | sheet M: 42/42 located, 40 of 40 non-tank tags OK, 0 Wrong family, 6 s |
| 3a | Printed, letters as filled outlines, no text, no comments | 0 text items, 0 comments, many letter-sized filled paths | letter shapes, compared with letters the browser draws | P1: a one-hour prototype read 13 DS310 tags + 2 for review (not checked by eye) |
| 3b | Printed, letters as single-line strokes | 0 text, 0 comments, many short strokes in letter-sized clusters | letters learnt from comment sheets, or named once by the user | P2: letters learnt from sheet M (48 characters, 1,243 samples) read parts of P2's notes; too crude to quote a rate |
| 4 | Text with no usable character map | text items present, mostly private-use or control characters, no tags | glyphs grouped by font and glyph, each group named once | no P&ID sample; a GA had 11 characters per page at U+F0xx |
| 5 | Several pages | `numPages > 1` | every page | the report checks page 1 only today |
| 6 | Scanned image | no text, almost no paths, images cover ≥ 90% of the page | letters read from image ink | unproven |
| 7 | Mixed: text and outlines, raster underlay, DRAFT watermark, layers | per region | each region by its own reader | sheet M's watermark is text and already ignored; no sheet had a hidden layer |
| 8 | Not seen locally: Revit, MicroStation, Bluebeam | as above | they fall into formats 1, 3a or 3b | no sample; Bluebeam mark-up comments are already ignored |

**The 0.899 pressure elements on sheet M.** AutoCAD writes comment rectangles
rounded to whole points. One digit stood 0.3 pt outside its comment's
rectangle, so a 0.5 pt allowance left it inside two bubbles: forward 1.000,
backward 0.899. With a 1 pt allowance, all four bubbles scored 0.992 to
0.998 and the sheet read 40 of 40.

**Code facts that bear on this.** `pagePaths` ignores fill opacity, dash
patterns and optional-content visibility. `sheetStatus` calls a sheet with
garbled text "Readable". The Check button checks the page on screen; the
report checks page 1.

## Goals

1. On every sheet with linework, the check **finds and names every standard
   symbol**, whether or not any tag can be read.
2. Where tags can be read, each is **paired with its symbol** and gets the
   verdicts it has today (OK, OK off size, Wrong family, Approved exception,
   Needs a look, Not checked).
3. Formats are added one at a time, each proven by a gate before it is
   switched on (see *The format test bench*).
4. Every sheet in a report gets a row saying what was found and how, or
   plainly why it could not be checked.
5. On a Readable sheet, no tag verdict gets worse.
6. Shapes that look like symbols but match no standard symbol are marked
   **Unrecognised symbol**, with the closest standard symbol and its score
   (phase 3). *(2026-11-17: now "not to standard", judged on the whole
   shape; see `2026-11-17-pid-whole-shape-check-design.md`.)*

## Non-goals

- Judging the member within a family.
- Putting tags read from letter shapes or pixels into the register. They feed
  the check and the report only.
- Deciding whether a symbol *should* carry a tag. A symbol with no tag beside
  it is listed as such, not flagged as a fault: on printed sheets the tags
  often cannot be read yet, and padlocks and capped ends carry none.

## Anti-goals

- **A false symbol presented as found.** One symbol per patch of ink, letters
  kept out, plain shapes handled with care; each gate counts false hits.
- **A misread tag giving a confident verdict.** A tag with any letter the
  reader was unsure of is "for review", marked "read from letter shapes", and
  is given no Wrong family on the strength of that letter.
- **Client data in the public code.** No fonts, letter shapes, legend names
  or geometry in `assets/js/`, tests or fixtures.

## Constraints

- **Nothing writes `register.json`.** The register lost data in August 2026.
- The owner agreed (2026-11-16) that a **letter library** may be saved in the
  shared folder beside `symbol-library.json`, with the same safety: three-state
  read, atomic write, save refused if the file changed since it was loaded.
  It is the only new file written there.
- The repository is public. Tests use invented sheets, letters and symbols.
  Real sheets stay in `Downloads` and `../pid-symbol-spike/`.
- Zero build; pdf.js 3.11.174 is vendored. **No new dependency and no OCR
  library** without asking. Reference letters for filled fonts come from the
  browser's own fonts (canvas `fillText`); no font file is shipped.
- Logic in pure modules with `node --test` coverage. The tool (`tools-src/`,
  gitignored) gets thin glue by anchored patch after a backup. The owner runs
  `node scripts/lock-tools.mjs`.
- Owner's terminal: Windows PowerShell 5.1. Owner instructions are numbered
  steps naming the buttons.

## Decisions

Marked **(owner)** where the owner decided, **(my call)** where I chose.

- **(owner)** Symbols first; tags attached where they can be read.
- **(owner)** Approach: sweep the sheet, then pair tags (below).
- **(owner)** Formats one at a time, easiest first; each phase ships on its own.
- **(owner)** Contractors' non-standard shapes read Needs a look where a tag
  points to them.
- **(owner)** The letter library lives in the shared folder.
- **(owner)** The goal includes scans.
- **(owner)** Marking unrecognised shapes is important: it is how the tool
  finds what is not compliant. It is a committed phase.
- **(my call)** It comes as phase 3, straight after printed sheets, so it
  works on every format with linework before the housekeeping phase.
- **(my call)** Tags read from shapes run straight through; any tag with an
  unsure letter is "for review" and marked. (The owner was asked whether to
  correct the list first and has not chosen.)
- **(my call)** One check, many readers: a reader per format supplies ink,
  lines and words; `checkSheet` stays the single judge.
- **(my call)** The sweep lives in `pid-symbol-check.js` (it needs the
  rasteriser, window and scoring internals); the readers live in a new pure
  module, `assets/js/pid-sheet-read.js`.
- **(my call)** Untagged symbols are listed, not flagged.
- **(my call)** Comment words and comment letter removal apply only to sheets
  whose status is "Readable from comments". A Readable sheet's words stay its
  text layer. (Measured: removing SHX-comment letter ink on a Readable sheet
  changed no verdict; widening is left for later.)
- **(my call)** The letter library is its own file, `letter-library.json`.

## Approaches considered

1. **Sweep the sheet, then attach tags (chosen by the owner).** Find every
   standard symbol first; then pair readable tags with symbols nearest first,
   using today's passes. A tag with no symbol is Needs a look; a tag beside a
   symbol of another family is Wrong family. Today's tag-led search survives
   as the pairing step and for a tag's "closest" near miss.
2. **Keep the tag-led check, add a separate "symbols found" list.** Less
   change, but two answers that can disagree: the four flowmeters on the
   Plant 3D sheet are found by the sweep and read Needs a look in the tag check.
3. **Look only where pipelines meet symbols.** Faster, fewer false hits, but
   misses symbols off the line (padlocks, sight glasses, bubbles). Kept as a
   refinement if false hits stay high.

Earlier the owner also chose, among build orders, one format at a time over
"shared layer first" and over "treat every PDF as a picture" (which throws
away exact text and vectors where they exist).

## Design

### The shape of a sheet's result

`checkSheet` returns what it returns today, plus `symbols`: every standard
symbol found on the page.

```js
symbols: [{
  name, tagId,            // from the library
  box, sizePct, score,
  oneOf: [],              // names within oneOf of the best, as now
  bubble: false,          // a tag bubble kind
  tag: 'XX-V-0001' | null,  // the paired tag's own text (stable through any
                            // re-ordering in the report), or null
}]
```

One entry per physical symbol (the winner); its `oneOf` names go in a column,
not in rows of their own. `verdicts` (one per tag) keep their meaning. A
tag's verdict comes from the symbol it is paired with. A page with no tags no
longer returns `{ ok: false, why: 'no-tags' }`: it returns `ok: true`, no
verdicts, and its `symbols`.

### The sweep (`pid-symbol-check.js`)

1. **Where to look.** Centres on a grid across the page (90 pt in the probe),
   each with today's reach (radius plus 40 pt) for proposals. The sheet's
   title block is not swept. How it is found is left to the builder; the
   probe skipped a fixed strip, which is not good enough. **What was skipped
   is shown** (my call): a grey box on the overlay and a line "Title block
   not checked", so a wrong guess is visible to the owner, not silent.
   A symbol straddling several grid cells is scored from each; step 4 makes
   it one. If tuning forces a choice, accuracy comes first and the 60 s gate
   decides whether the result is usable.
2. **Proposals and scores.** Today's line pairing (`proposePlacements`) and
   two-way score (`scorePlacement`), every checkable symbol, recognise at
   0.90.
3. **Tag bubbles.** Closed single paths whose box fits a library bubble's ring
   (within `minScale`..`maxScale` and the aspect tolerance) are matched with
   `matchBubble`, whether or not a tag sits inside. Text inside is not ink on
   a Readable sheet; on comment and printed sheets the letters are removed
   first.
4. **One symbol per patch of ink.** Two hits are the same physical symbol
   when they share ink: most (for example half) of one hit's template ink
   lies on the other's. Shared ink, not box overlap, is the test (my call),
   so a valve drawn inside a bubble's box, or a padlock beside a valve, stays
   separate.
   - When each shares most of its ink with the other (mirror twins, two
     members drawn alike), they are **alternatives**: the highest score
     wins, and others within `oneOf` of it are its "one of"; at equal score
     the one with more linework wins.
   - When only the smaller one's ink lies on the larger's, the smaller is a
     **part** of the larger (the probe's partial matches inside relief
     valves) and is dropped, never offered as "one of".
   - Thresholds are tuned on the gate sheets.
   - **Grid spacing 80 pt** (my call, at planning): every point of the sheet
     is then within 57 pt of a centre, inside the 60 pt radius. At the
     probe's 90 pt, corners of a cell were 64 pt away, which is how it
     missed 1 of 45 valves.
5. **Plain shapes (phase 2, where the false hits were seen).** Symbols excluded today as simple (by flag, or inferred by
   `prepareSymbols` from segment count and length) stay excluded. The extra
   rule applies to symbols that pass that test but still have little
   linework (the probe's false hits were a box, an arrow and a padlock):
   such a hit is kept only with a stricter backward score (for example
   0.97). It adds to the exclusion; it does not replace it. Values tuned on
   the gate.
6. **Time and progress.** The sweep runs inside `checkSheet` in the worker,
   under the existing 120 s limit and the existing Cancel and Stop (the
   worker is terminated). `onProgress` reports sweep progress (grid rows
   done) then tags paired; the progress wording says which. The gate
   requires under 60 s a sheet.

### Pairing tags (`pid-symbol-check.js`)

**Settled at planning (my call), replacing "sweep spots, then a fallback":
today's tag-led check runs first, unchanged; the sweep's symbols then answer
what it left.** This gives the owner the same single answer as approach 1,
and makes goal 5 hold by construction rather than by measurement:

1. **Tag-led, as today.** Bubbles (pass 0), own family (pass 1), Wrong family
   (pass 2), exactly as `checkSheet` does now. Every verdict it gives is
   today's verdict.
2. **Merge.** Each symbol the tag-led check paired to a tag is matched to the
   swept symbol that shares its ink; that swept symbol takes the tag. A
   paired symbol the sweep missed is added to the list.
3. **Leftover tags.** A tag still without a symbol (Needs a look) is paired
   with the nearest unclaimed swept symbol of its **own** family within
   `radius`, and then reads OK or OK off size. Only that pass runs for
   leftovers, so a tag can only improve. (The four flowmeter tags on the
   Plant 3D sheet read Needs a look with no near miss at all, so their
   symbols are probably further than 60 pt from the tags. The sweep lists
   those flowmeters as symbols, but this pass will not pair them; how far a
   tag may sit from its symbol is a question for the gate to report, not
   something phase 1 changes.)
4. **The rest** keep today's Needs a look, Approved exception or Not checked,
   with today's closest near miss.

A symbol answers only one tag, as now. Swept symbols with no tag are listed
as such.

### Readers (`pid-sheet-read.js`, new, pure)

Each reader turns a page into **ink** (paths with letters removed),
**lines** (segments for proposals) and **words** (text items with positions).

Phase 1 readers:

- **Text layer** (Readable): ink = paths, words = text items. As today.
- **Comments** ("Readable from comments"):
  - `commentWords(comments)`: each comment from `sheetComments` becomes a
    pdf.js-shaped text item `{ str, transform: [h, 0, 0, h, x0, y0],
    width: w, height: h }`. Vertical comments keep their true rectangle.
    `tagPlaces` works unchanged, including a tag split across two comments.
  - `letterBoxes(comments, viewportTransform)`: comment rectangles in page
    points, grown by 1 pt (they are rounded to whole points).
  - `removeLetterInk(paths, boxes)`: drops a path whose box lies wholly
    inside a letter box, that is not filled, and whose longer side is at most
    15 pt (drawing letters are 7 to 14 pt). Measured on sheet M: 3,353 paths
    removed, 40 of 40, the same as with no size cap. A cap tied to the box's
    size fails: a one-character comment box is narrower than its letter is
    tall (4 x 7 pt for a 7.1 pt digit), which left that digit behind and put
    the sheet back to 38 of 40.

Phase 2 adds **letter spotting** for printed sheets; later phases add letter
reading and a scan reader.

### Tags on a comment sheet

The tool passes the pre-check's own result, which for a "Readable from
comments" sheet is already the comment-derived result (`assessSheet`,
`tagsToRegister`), with the same function codes and instrument lookup
(`FC_LOOKUP`) as any sheet. Nothing re-extracts tags.

### Worker and glue

- **Worker** (`pid-symbol-check-worker.js`) accepts `comments` (from
  `sheetComments`) and `words: 'text' | 'comments'`. For `'comments'` it
  removes letter ink and uses `commentWords`. Otherwise everything is as now.
- **Glue** (`runSymbolCheck`, `reportCheckSheet`): fetch
  `page.getAnnotations()` **for the page being checked** (the page on screen
  for the button, page 1 for the report until phase 4), pass through
  `PidPrecheck.sheetComments`, post `comments` and `words`.
- **Report runner** (`pid-symbol-report-run.js`): status `comments` runs like
  `readable`, and the runner passes the status to `deps.check` so the glue
  knows to send `words: 'comments'`. A sheet with no tags is still swept:
  "No confirmed tags to check" no longer stops a sheet, it becomes "No tags
  read" beside its symbol list.
- **Button** (`pid-symbol-check-view.js` `blockerText`): "Readable from
  comments" may be checked. "No readable text" reads "Printed and scanned
  sheets cannot be checked yet" until phase 2 switches printed sheets on.

### Screen and report

- **Sheet summary:** "N standard symbols found, M with tags", then the
  verdict counts for tags as now, and the bubble line.
- **Overlay:** every found symbol boxed in a neutral colour; paired tags'
  symbols in their verdict colour, as now.
- **List:** tags first, as now; then "Symbols with no tag", grouped by name
  with counts, each jumping to its place.
- **Report Excel:** a new **Symbols** sheet, one row per physical symbol:
  drawing, revision, page, symbol, "one of" (the close alternatives, if any),
  tag identifier, size, tag (blank if none). The Tags sheet is unchanged.
- **Report PDF:** each drawing page's overlay boxes every found symbol as on
  screen; the per-sheet summary gains the symbol counts.
- The family note stays ("It checks the family of symbol, not which member
  of it").

## The format test bench

The owner suggested keeping the legend in every format and cross-checking
against it. That becomes the proof for each phase. A sheet whose answer is
already known is converted into the format under test, and the check must
give the same symbols and tags:

| Conversion | How (local, outside the repo) | Truth comes from |
|---|---|---|
| Printed, filled letters | print a Plant 3D sheet through Microsoft Print To PDF | that sheet's phase 1 result |
| Printed, single-line letters | sheet M with its comments deleted | sheet M's phase 1 result |
| Scaled | print "fit to page" onto the next size down | the original |
| Rotated | page rotation 90 / 270 | the original |
| Scan | render a sheet to an image PDF with noise and slight skew; later, a real print scanned on the office scanner | the original |
| Legend | the legend sheets through each of the above | every symbol found as itself |

Converted PDFs are client data and stay in `../pid-symbol-spike/`. Gate
scripts follow `scripts/check-symbol-check.mjs`: counts only, tags and names
only with `--verbose`, a clear failure when an input is missing.

## Roadmap

| Phase | Adds | Gate (summary) |
|---|---|---|
| 1 | The sweep, one symbol per ink, pairing; Readable and comment sheets | see *Phase 1 gate* |
| 2 | Printed sheets: letter spotting, plain shapes; symbols found with no tags | Plant 3D sheets printed through Print To PDF find the same symbols as their originals (at least 95%, false hits ≤ 1 per 20 found); P1 and P2 checked by eye: no printed word or note box reported as a symbol |
| 3 | Whole shapes: each drawn shape is standard (all of its ink explained by a standard symbol, or a valve body plus a legend operator) or **not to standard** (flagged, with the closest symbol as a hint). Redesigned 2026-11-17 after the owner's trial: see `2026-11-17-pid-whole-shape-check-design.md` | measured against the owner's answer key (PDF mark-ups of 5 to 10 real sheets, some held out): at least 90% of his NOT STANDARD shapes flagged, at most 1 in 20 of his STANDARD symbols flagged; the five trial cases (pumps, valve operators, short-lined flowmeters, non-standard bubbles, dashed-line arrow); no tag verdict changed |
| 4 | Every page; sheet-wide scale; honest statuses; opacity and hidden layers | tags and symbols on page 2 are found; the 90% copy reads OK with one "Printed at 90%" line; statuses right on all nine survey PDFs |
| 5 | Tags on printed sheets: letter reader (filled letters from browser fonts; single-line letters from the letter library); broken character maps | converted Plant 3D sheets: at least 95% of tags read exactly, none invented; sheet M with comments deleted: at least 95% of its 42 tags |
| 6 | Scans: ink from pixels, line finder, circle finder, letters from ink | synthetic and real scans: at least 90% of the original's symbols found, false hits ≤ 1 per 20; under 60 s; until passed, scans read "Scanned image: not checked yet" |

### Phase 2: printed sheets (symbols without tags)

- **Letter spotting.** Find letter-like clusters: small filled paths (format
  3a) or short-stroke clusters (3b), similar heights, sitting on a shared
  baseline with letter-sized gaps, horizontal or vertical. Remove their ink.
  No letter is read.
- **Plain-shape care** as in the sweep, tuned on P1 and P2's false hits.
- The sheet status splits "No readable text" into **Printed: letters drawn as
  shapes** and **Scanned image**. Printed sheets are swept; their tags read
  "not read yet" until phase 5.

### Phase 3: unrecognised shapes

**Superseded 2026-11-17** by `2026-11-17-pid-whole-shape-check-design.md`.
That design asks whether each drawn shape is the standard symbol, all of it.
It replaces "unrecognised" with "not to standard", and it measures against
the owner's answer key. The original sketch is kept below for the record.

What is left once the sweep has explained the sheet is where non-standard
symbols hide.

- **Take away what is explained:** found symbols, spotted letters, the title
  block and frame, and pipelines (long straight lines, kept only as the
  lines symbols sit on).
- **Candidates:** compact clusters of what remains, symbol-sized (between the
  library's smallest and largest symbol, scaled by `minScale`..`maxScale`),
  and either sitting on a pipeline or a closed outline (a bubble-like shape).
- **Report:** each candidate is an **Unrecognised symbol**, with the closest
  standard symbol and its score (today's near-miss search), boxed in its own
  colour on the overlay and listed in the report's Symbols sheet. A tag paired
  with one reads Needs a look, as today, now pointing at the shape.
- **Not candidates:** arrows on lines, line junction dots, dimension and
  leader lines, and note boxes, where they can be told apart. What cannot be
  told apart is tuned out on the gate sheets, never by hiding a whole class
  of shape without measuring it.
- The marks are findings for a person to look at, not judgements: the
  summary reads "N unrecognised symbols to look at".

### Phase 4: pages, scale, statuses

- **Every page.** The check runs on each page with the sheet's tags; a tag is
  "Tag position not found" only when it is on no page. Report and button alike.
- **Sheet-wide scale.** When at least 80% of a sheet's symbols (and at least
  10) share one size within 2%, the sheet reads "Printed at N% of full size"
  once and sizes are judged against N%. (My call; starting values.)
- **Statuses.** A sheet whose text is mostly private-use or control characters
  and yields no tags reads **Text unreadable (font has no character map)**.
  Characters U+F020 to U+F0FF fold to U+0020 to U+00FF only where the text
  layer otherwise yields no tags.
- **Opacity and layers.** Paths at opacity under 0.5 are not ink; content in
  an optional-content group off by default is not ink.

### Phase 5: tags on printed sheets

- **Filled letters:** spotted letters grouped by rendered shape (exact
  geometry groups badly: 2,000 letters fell into 1,307 groups), named against
  letters drawn by the browser (canvas `fillText`, common sans fonts),
  I/l/1 and O/0 settled by context, assembled into words.
- **Single-line letters:** learnt from comment sheets (strokes in each comment
  box paired with its characters when the counts agree) or named once by the
  owner from a "letters not recognised" list; compared stroke to stroke.
  Kept in `letter-library.json`: per font and character, a capped handful of
  normalised samples, with date and source; learning never removes the
  owner's named letters.
- **Broken character maps:** pdf.js knows the font and glyph of each
  character; group by those, render each group once, name it as above.
- Runs in the worker (OffscreenCanvas).

### Phase 6: scans

Binarise, remove skew, find lines (long runs, then angled lines) and circles,
spot and read letters from ink blobs with the phase 5 readers, and give the
pixels to the sweep as ink. No OCR library unless the owner agrees after this
phase's numbers are known.

## Phase 1 in full

### Tests (`npm test`, invented data only)

- `commentWords`: horizontal and vertical comments; a comment with no
  rectangle left out; hostile input does not throw.
- `removeLetterInk`: strokes standing 0.3 pt out of a whole-point rectangle
  removed; a 7 pt letter in a 4 pt-wide one-character box removed; a filled
  path kept; a 16 pt line inside a big comment box kept; a stroke outside
  every box kept.
- Sweep on an invented sheet with no tags: each invented symbol found once and
  named; a symbol drawn twice overlapping is reported once; a small symbol
  inside a larger one is not reported separately; a plain box among other
  ink is not reported; a bubble with no tag inside is found as its kind.
- Pairing: a tag beside its symbol is OK; beside another family is Wrong
  family; a tag with no symbol is Needs a look with its closest; one symbol
  answers one tag; untagged symbols are listed with `tag: null`.
- Comment sheet: a bubble whose tag is stored as two comments reads OK with
  letter ink removed and Needs a look without it.
- View, runner and report: `comments` accepted; a sheet with no tags still
  gives its symbol list; the Symbols sheet in the Excel report.

### Phase 1 gate (local, not in `npm test`)

- Extend `scripts/check-symbol-check.mjs` with `--words comments` (reads the
  annotations through `sheetComments`, extracts tags from the comment text
  as `assessSheet` does, runs the same reader functions as the worker) and
  with a symbols summary: counts by symbol name, untagged count, time.
- **Before any change**, run the script with `--verbose` on the three Plant
  3D sheets and sheet M, and save each output as `<sheet>-before.txt` in
  `../pid-symbol-spike/every-format-gate/` (private, never in the repo, as
  the bubble gate did). After the change, save `<sheet>-after.txt` the same
  way and compare the two per tag. The gate can be rerun after any tuning
  against the same before files.
- **Plant 3D sheet with 71 tags:** at least 44 of 45 valve tags OK; no tag
  verdict worse than before, and any change listed; at least 30 of the 34
  untagged symbols found by eye; the 4 flowmeters found as symbols; at most
  2 false symbols; under 60 s.
- **The other two Plant 3D sheets:** no tag verdict worse; every reported
  symbol checked by eye against the sheet, at most 1 false per 20.
- **Sheet M** (`--words comments --instrument "PE,PIT"`): 42 of 42 tags
  located; 40 of 40 non-tank tags OK (29 valves, 2 pumps, 9 bubbles); 2 tanks
  Not checked; 0 Wrong family; every reported symbol real; under 60 s.
- **Relabel test** (today's gate 3): at least 9 of 10 relabelled tags Wrong
  family.
- **Supplier sheet:** no tags; symbols listed; no error.

### Owner steps after phase 1

1. In PowerShell, inside `harveydeason-site`, run
   `node scripts/lock-tools.mjs`.
2. Open the tool, connect the folder, and open sheet M on the **Sheets** tab.
3. Press **Check symbols**. Look over the symbols found and the tags.
4. Do the same on one Plant 3D sheet.
5. Tick both, press **Export report**, then **Run**, then **Download PDF** and
   **Download Excel**, and look at the new Symbols sheet.

## Risks

- **False symbols on unseen sheets.** Four sheets, two from one contractor,
  judged by eye. Each phase's gate counts false hits; a sheet with many is
  the signal to add pipeline anchoring (approach 3) as a filter.
- **The sheet's own legend box.** A contractor sheet with its own legend
  would list those symbols as found. Untested; phase 1's gate sheets show
  whether it happens, and a rule to skip a boxed area headed LEGEND or KEY is
  the likely fix.
- **Speed.** 19 to 37 s per sheet in node for the sweep alone; the browser
  may be slower. The gate requires under 60 s on the owner's machine.
- **Letter reading (phase 5) and scans (phase 6) are unproven.** Each gate
  decides; if a gate fails, that phase stops, its numbers are written up, and
  earlier phases stand.
- **Fonts on other computers** for phase 5: the gate should run on the
  owner's work computer too.

## Where the evidence lives

Survey notes: `pdf-format-survey.md` in the session notes folder. Probe
scripts and contact sheets: the session scratchpad. They hold real tags and
drawings and stay out of git.

## Calls made after the builder review (for the owner to check)

1. Today's tag-led check runs first, unchanged; the sweep then pairs tags it
   left without a symbol (own family only) and lists every other symbol. No
   tag that reads OK today can get worse. (Settled at planning; it replaced
   "sweep first, tag-led as a fallback", which could not promise that.)
2. "Same symbol" means shared ink, not overlapping boxes.
3. The skipped title block is shown on the overlay, not hidden.
4. The sweep runs inside the existing check, with progress and Cancel as now.
5. A symbol's paired tag is stored by its text, so the report can re-order
   freely; the Symbols sheet has one row per physical symbol.
6. Before-and-after gate files (with real tags) go in
   `../pid-symbol-spike/every-format-gate/`, never in the repo.
7. Phase 1 checks one page at a time, as today; every page comes in phase 4.

## Left to the builder

- How the title block is found and skipped.
- Thresholds for "overlap substantially" and for plain shapes, tuned on the
  gate sheets within the rules above.
- The sweep's grid spacing, if 90 pt is not the best trade of time and misses.
- Exact names and signatures inside `pid-sheet-read.js`, worker message
  fields, and the wording of statuses beyond those quoted.
