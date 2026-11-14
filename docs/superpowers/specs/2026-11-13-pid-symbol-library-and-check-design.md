# P&ID Tag Register — symbol library, sheet pre-checks and symbol check

**Date:** 2026-11-13
**Status:** approved by the owner 2026-11-13. Ready for an implementation plan,
one phase at a time, starting with phase 1.

## Goal

Give the P&ID Tag Register three new abilities, in this order:

1. **Symbol search.** Find the standard symbol for a thing, with its proper
   name, functional tag identifier and legend sheet. Useful while drawing a
   P&ID, not only while checking one.
2. **Sheet pre-checks.** Say, for each PDF, whether its tags can be read at all
   and why not when they cannot.
3. **Symbol check.** For a sheet drawn with the standard palette, say for each
   tagged item whether a standard symbol of the right family sits beside it.

Each phase ships on its own. Phase 3 is conditional: it has a go/no-go gate
before any interface work, and the owner has said that if it turns out
unusable we stop and rethink rather than push on.

## Why now

The legend sheets and the RFI register are the only record of which symbol is
right. Today that knowledge is applied by eye. A throwaway test on
2026-11-13 showed that most of it can be read straight out of the legend PDF
and matched on a real drawing.

## What the test showed

The test built a library from the six legend sheets and searched three
drawings for it. Scripts and outputs are kept outside this repository (see
*Where the test lives*). This repository is public, so the drawings are
described here and not named.

**Library extraction.** 376 named symbols came out of the legend automatically,
by reading the ruled table cells: label in one cell, linework in the other.
Known gaps: the last row of most tables, two rows merged into one, the
instrument-bubble table (symbol on the left, placeholder text inside), and the
line-type and tie-in boxes. The functional tag identifier in each table header
was not read.

**Matching.** Symbols were matched by rendering linework only (no text) at
4 px per point and scoring two ways: how much of the symbol's ink is on the
drawing, and how much of the drawing's ink inside the symbol's box the symbol
explains. The lower of the two is the score. Ink within 0.5 points counts as
a hit.

| Drawing | How it was made | Result |
|---|---|---|
| A: in-house, palette-drawn, plotted from Plant 3D | Real text layer. Symbols at exactly legend size. | 40 of 46 tagged valves identified, none wrongly. 4 of 4 flowmeters. 3 of 4 sight glasses. True matches scored 0.92 to 1.00. |
| B: contractor, printed with a generic PDF printer | No text layer and no comments. Standard shapes drawn at 88%, 91% and 122% of legend size. | Almost nothing at 1:1. After rescaling the page to those sizes: 8 ball valves at 1.00, both flowmeters at 0.92 to 0.93. |
| C: supplier, plain AutoCAD, own legend and own tags | Labels drawn as linework, but each also stored as a hidden PDF comment with its position. | None of about 18 symbols matched. Correctly so: none is a standard symbol. |

**What failed, and why it matters to the design**

- **Blind search is unusable.** Sweeping a whole sheet for every symbol gave
  about 680 hits on drawing A, roughly 600 of them from five trivially simple
  shapes matching fragments of other linework. Some richer symbols matched
  falsely at up to 0.96.
- **Normally closed valves** are the open symbol filled in. The legend shows
  only the open one, so six were missed on drawing A, and on drawing B filled
  valves matched a different valve type at up to 0.95. That is a wrong answer,
  not a miss.
- **Letters inside symbols** (M, P, H in an actuator circle) are text on the
  legend but can be linework on a drawing. None of 24 motor actuators was
  identified.
- **Mirror images.** Pressure relief and vacuum relief differ only in arrow
  direction and scored within 0.03 of each other.
- **Speed.** The test took about 11 minutes per A1 sheet. That approach cannot
  run in a browser.

**Not yet shown**

- No drawing in the test had a wrong symbol on it, so catching one is unproven.
- Extraction and matching were done with a Python PDF library. Whether pdf.js
  yields the same geometry is unproven.
- Instrument bubbles were not tested at all.

## Constraints

- **Wessex Water reference data stays off the site.** `assets/js/` is served
  unencrypted, and committed test fixtures are public too. The symbol library
  is their standard drawing; it gets the same treatment as the DS310 tables.
  Tests use invented symbols.
- **The register's data is not touched.** Symbol features read drawings and
  write only their own library file. Nothing here adds a path that writes the
  register JSON.
- **Zero build, vendored libraries only.** pdf.js 3.11.174 is already vendored.
  No new dependency without asking.
- **Tool logic stays testable.** New algorithm goes in a pure module under
  `assets/js/` with `node --test` coverage, matching `pid-core.js`.

## Decisions

Marked **(owner)** where the owner decided, **(my call)** where I chose and the
owner has not yet confirmed.

- **(owner)** Build order: search, then pre-checks, then symbol check.
- **(owner)** If the symbol check proves unusable, stop and rethink.
- **(owner)** The symbol check is a deliberate action. Uploading a P&ID does
  what it does today; checking symbols is something the user then chooses to
  run on a sheet. It is a feature of the tool, not its main job, and is placed
  accordingly: never automatic, never in the way of tag work.
- **(owner)** Suppliers do not use the standard symbols and are not expected
  to. The supplier drawing was a test input only.
- **(owner)** Anyone connected to the folder may change the library, its notes
  and its exceptions.
- **(my call)** The library is a file in the connected register folder, not
  embedded in the locked tool. I said earlier it should live inside the locked
  tool; this is better. It keeps the standard off the site entirely, and a new
  legend issue is handled by re-importing a PDF, with no rebuild or republish.
- **(my call)** The library is built in the tool by importing the legend PDF,
  so the legend and the drawings pass through the same PDF reader.
- **(my call)** The check's results are shown but not saved.
- **(my call)** The gate 3 numbers that define "usable". The owner has seen
  them and not yet commented.
- **(my call)** Hidden-comment text is used for tags only when the normal text
  layer yields no tags, so every drawing that reads correctly today is
  unaffected.
- **(my call)** The "symbols at standard size" check moves from phase 2 to
  phase 3. It needs symbol detection, which phase 2 does not have.

## Architecture

```
tools-src/pid-tag-register.html   glue: pdf.js, File System Access, DOM
        |  plain arrays in, plain objects out
assets/js/pid-symbols.js          pure: cells, library, search, raster, match, verdicts
        |
<register folder>/symbol-library.json   the library; Wessex Water data; never in git
```

### Glue in the tool (needs pdf.js)

- `pageGeometry(page)` walks `page.getOperatorList()`, tracking the transform
  stack and form XObjects, and returns paths in page points with a top-left
  origin: `{ segs: [x0,y0,x1,y1,...], width, filled, grey }`. Curves are
  flattened to short segments.
- `pageWords(page)` returns text items with position and size.
- `pageComments(page)` returns annotation contents with their rectangles.

### `assets/js/pid-symbols.js` (pure, no DOM)

- `legendCells(paths, words)` finds ruled tables and returns rows of
  `{ label, header, symbolPaths, lettersInside }`. Row separators are long
  axis-aligned lines sharing an x-extent; the column divider is the vertical
  line crossing the row. The cell with linework is the symbol; the other is the
  label. It must handle a table's final row and report rows it could not split.
- `buildLibrary(rowsBySheet, sheetInfo)` returns the library object.
- `searchSymbols(library, query)` returns ranked results.
- `rasterise(paths, scale)` draws strokes and fills into a bitmap. Using our
  own rasteriser for legend and drawing alike keeps the two consistent and
  leaves text out by construction.
- `matchAt(...)`, `checkTag(...)`, `sheetVerdicts(...)` for phase 3.

All functions degrade on hostile input in the way `pid-core.js` does.

### Library file

```js
{
  version: 1,
  legend: [{ sheet, rev, page }],        // read from each title block
  importedAt,
  families: { V: { mode: 'check' }, T: { mode: 'skip', why: 'drawn to suit' } },
  symbols: [{
    id, name, group,                     // group = table heading
    tagId,                               // functional tag identifier, '' if none
    sheet, w, h, paths,
    letters: ['M'],                      // text found inside the symbol cell
    flags: { simple, stretch, manual },  // manual = entered by hand, no linework
    aliases: [], notes: [{ text, ref, date }]
  }],
  exceptions: [{ name, status: 'approved' | 'pending', note, ref }]
}
```

Reads use the register's three-state pattern (`ok` / `missing` / `unreadable`),
so a failed read never leads to a write. Writes use `writeFileAtomic`. Before
saving, the tool re-reads the file; if it changed since it was loaded, the save
is refused and the user reloads.

Anyone connected to the folder may edit the library. There is no owner role.
Replacing the whole library by re-importing a legend asks for confirmation and
states how many symbols, notes and exceptions the existing one holds, because
hand-entered notes and aliases are the part that cannot be regenerated. Notes,
aliases and exceptions carry over to the new library by symbol name; any that
find no match are listed, not dropped.

## Phase 1 — symbol search

A new **Symbols** tab.

- **Import legend.** The owner drops the legend PDF. The tool shows a preview:
  every extracted symbol with thumbnail, name, table heading, tag identifier
  and sheet, plus a list of rows it could not split. The owner can rename,
  delete, set the tag identifier, mark a symbol simple or stretch, and add a
  manual entry with no linework. Nothing is saved until the owner confirms.
- **Works disconnected.** An imported library is usable in memory at once.
  Saving it needs the folder connected.
- **Search.** One box over name, aliases, table heading, tag identifier, notes
  and exceptions. Typing a tag code such as `V` lists that family. Each result
  shows the symbol, name, tag identifier, legend sheet and any notes. Symbols
  are drawn from their stored linework as inline SVG, so they stay sharp at
  any size.
- **Notes and aliases.** Rulings from the RFI register are entered against a
  symbol by hand: for example an alias so "sight glass" finds the sight flow
  indicator, or a note that one symbol stands in for a rare case. Entry is
  manual because the RFI sheet is free text with no symbol reference.
- **Exceptions.** Items with no palette symbol are listed with their status:
  approved to use as a CAD block, or pending the next palette release. A search
  for one of them answers that, instead of returning nothing.
- **Link to Next tag.** A result with a tag identifier offers "next available
  tag", opening the existing suggester with that function code.

**Gate 1.** Importing the six legend sheets through the tool yields every
symbol row on sheets 2 to 6, checked by the owner against the sheets, with any
shortfall listed by the tool and not silently dropped. Twenty searches chosen
by the owner each return the right symbol in the top three.

**Fallback.** If reading geometry through pdf.js cannot reproduce the test's
extraction, the library is built once with the test scripts and imported as
JSON. Phase 1 still ships; phase 3 is then in doubt and is re-examined.

## Phase 2 — sheet pre-checks

Run at import and shown on each sheet in the **Sheets** tab.

| Check | Finding shown |
|---|---|
| Text layer | "No readable text: this PDF was printed, not plotted. Tags cannot be read." with the producing program from the PDF metadata. |
| Hidden comments | "Text read from drawing comments" when the text layer gave no tags and comments did. |
| Tags | Count of DS310 tags found. Zero is stated plainly. |
| Page | Sheet size, as context. |

Each sheet gets one status: **Readable**, **Readable from comments**, or **No
readable text**. A drawing that yields no tags is no longer registered
silently.

The comment fallback changes what the register ingests for some drawings, so
it is characterised first: a set of drawings already in the register is
re-imported and must give identical tags.

**Gate 2.** The three test drawings classify as Readable, No readable text and
Readable from comments respectively. Re-importing existing drawings changes
nothing.

## Phase 3 — symbol check

A **Check symbols** button on a sheet in the Sheets tab. Importing a P&ID
never runs it. The user opens a sheet and chooses to check it. The button is
available only when the sheet is Readable and the library is loaded; otherwise
it is disabled with the reason shown. Runs in a Web Worker, so the rest of the
tool stays usable while it works.

### What "correct" means here

The tool can say that a standard symbol of the right family sits beside a tag.
It cannot say the designer chose the right member of that family: a ball valve
drawn where a butterfly valve was intended passes. The interface must say so.

### Method

Tag extraction today works on joined text and keeps no positions. The check
needs them, so tags are located on the page the way the sheet viewer's
highlight already does: by mapping each match back to its text items.

For each confirmed tag on the sheet, using that position:

1. **Expected family.** A function code that equals a library tag identifier
   expects that family. A code the tool's existing lookup classes as an
   instrument expects the instrument family. No new reference table is needed.
2. **Skip rules.** Families marked `skip` (tanks, scrapers and other symbols
   drawn to suit) report **Not checked**.
3. **Find the symbol.** Look within about 60 points of the tag, the radius
   that worked in the test. Propose placements by pairing a symbol's longest
   lines with drawing lines of a compatible length and angle, which gives
   position, one of eight orientations and a size between 75% and 135% in one
   step. Score each proposal with the two-way ink score. A score of 0.90 or
   more counts as recognised to begin with; the figure is tuned on test
   drawing A, where true matches scored 0.92 and above. This replaces the
   test's whole-sheet sweep and is what makes browser speed possible. It is
   unproven and is the first thing gate 3 tests.
4. **Compare against the whole library**, not only the expected family, so a
   wrong-family symbol can be recognised as what it is.
5. **Variants.** Each closed valve body also gets a filled twin for normally
   closed. Symbols that differ only by mirroring are reported as "one of".
   Letters are read from the text layer when present and otherwise not judged.

### Verdicts

| Verdict | Meaning |
|---|---|
| **OK** | A standard symbol of the expected family, at standard size. |
| **OK, off size** | As above, drawn outside 95% to 105% of legend size. The size is shown. |
| **Wrong family** | A standard symbol was recognised, but its tag identifier does not fit the tag. |
| **Approved exception** | Nothing recognised, and the item is on the exceptions list. |
| **Needs a look** | Nothing recognised. Could be non-standard, modified, or a gap in the library. |
| **Not checked** | Family is skipped, or the symbol is too simple to judge. |

Results appear as coloured boxes on the existing sheet overlay and as a list
that jumps to each item. Untagged symbols are not examined.

### Gate 3 — go or stop

Run before any interface work, on test drawing A.

- At least 44 of 46 tagged valves reported OK, including the six normally
  closed ones. 4 of 4 flowmeters OK.
- No Wrong family verdicts. Every symbol on this sheet is right.
- **Relabel test.** Ten tags are fed to the checker with a different function
  code, so the symbol beside each is now the wrong family. At least nine are
  reported Wrong family.
- Under 30 seconds for the sheet on the owner's machine.

Then on test drawing B's linework, with tag positions supplied by hand since
it has no text: both flowmeters and at least 8 ball valves are found, each
reported off size.

**Unusable means** any of: under 90% of palette symbols recognised on a
palette-drawn sheet, more than one false Wrong family per 20 tags, or more
than 30 seconds a sheet. If gate 3 fails, work stops, the numbers are written
up as they are, and phases 1 and 2 stand on their own.

## Testing

- `tests/pid-symbols.test.js` with **invented** symbols and tables: cell
  detection including a table's last row and a row that cannot be split;
  library building; search ranking, aliases and exceptions; rasterising lines,
  fills and widths; orientation and size handling; each verdict; hostile
  input.
- Library file handling: unreadable file never leads to a write; a changed
  file refuses the save.
- **Local only, not in `npm test`:** the three gates above. They need the
  legend and real drawings, which cannot be committed. Each is a script or a
  browser check the owner can re-run, and each must fail with a clear message
  when its input is missing.

## Out of scope

- Supplier drawings. Suppliers do not use the standard, so their sheets are
  not checked against it. If one is imported, phase 2 reports whether its text
  can be read and nothing more.
- Reading text from printed PDFs. No OCR.
- Line types, line weights and signal lines.
- Sweeping a sheet for untagged symbols.
- DWG or DXF input.
- Saving check results, or writing anything about symbols into the register.
- Importing the RFI spreadsheet automatically.
- Instrument bubbles in the symbol check, until their table extracts cleanly.
  They are searchable in phase 1 as manual entries.

## Risks

- **pdf.js geometry differs from the test's.** Unproven. Gate 1 exposes it
  early, and phase 1 has a fallback.
- **Proposal-by-line-pairing does not find symbols reliably.** Unproven. It is
  the first item in gate 3. Symbols made only of curves need a second proposal
  rule based on circles.
- **One good drawing is thin evidence.** Thresholds are set on drawing A. A
  second palette-drawn sheet from a different author should be checked before
  phase 3 is called done.
- **Edits to the tool are invisible in git.** `tools-src/` is gitignored. Keep
  the tool's side to thin glue and put behaviour in the tested module.
- **Library drift.** A hand-edited library can fall behind a new legend issue.
  The library records the legend sheets and revisions it came from, and the
  Symbols tab shows them.

## Where the test lives

Scripts, the extracted library and result images are in
`../pid-symbol-spike/` beside this repository, not in it. They are throwaway:
reference for whoever plans the build, not code to carry forward.

## Questions put to the owner

1. Are supplier drawings expected to follow the standard symbols?
   **Answered 2026-11-13: no.** They are out of scope.
2. Who may change the library, notes and exceptions?
   **Answered 2026-11-13: anyone connected to the folder.**
3. Are the gate 3 numbers the right bar for "usable"? **Not yet answered.**
   They stand as written unless the owner changes them before phase 3 starts.
