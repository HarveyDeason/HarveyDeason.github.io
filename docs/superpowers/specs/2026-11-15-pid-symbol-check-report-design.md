# P&ID Tag Register — symbol check report

Date: 2026-11-15. Status: approved by the owner, 2026-11-15.

Follows phase 3 of `2026-11-13-pid-symbol-library-and-check-design.md` (the
**Check symbols** button), which is live. Plan and outcome of that phase:
`docs/superpowers/plans/2026-11-15-pid-symbol-check.md`.

## Intent

The symbol check shows its results on screen, as a list and as coloured boxes
on the drawing, and keeps nothing. The owner wants those results as a report
that goes into a **review pack**. A review pack is normally a set of P&IDs
checked together, and the people reading it (reviewers, colleagues) may never
open the tool. So the report has to stand on its own: what was checked,
against what, what was found, and where on each drawing.

## Goals

1. Choose any set of sheets in the **Sheets** tab, run the symbol check on all
   of them in one go, and download the results.
2. A **PDF** that reads as an official record for the review pack.
3. An **Excel** workbook of the same results, one row per tag, for working
   through the items and filtering.
4. Each sheet's section shows the drawing itself with the coloured boxes, each
   box **numbered** to match its row in that sheet's table.
5. One sheet is just a pack of one: the same report with one section.

## Non-goals

- Saving check results anywhere, or writing anything about symbols into the
  register (unchanged from phase 3).
- Checking every page of a multi-page PDF (still deferred; see Decisions).
- Changing what the check decides. The verdicts and their wording come from
  `assets/js/pid-symbol-check.js` and `pid-symbol-check-view.js` as they are.
- A full backup export of the register. The owner asked whether Export CSV
  can be reloaded if the tool breaks: **Load saved CSV** brings back tags,
  drawings, current revisions, review status and families, but not revision
  history, deletions, comments or the symbol library, and loading it replaces
  the register (and saves over `register.json` if the folder is connected).
  A proper backup export, if wanted, is a separate piece of work.

## Anti-goals (a failure even if it works)

- A report that looks like it says the **right symbol** was used. The check
  confirms the right **family**, not the right member. That must be on the
  front page and in every sheet section.
- A sheet left out silently. Every ticked sheet appears in the report, as
  checked or with the reason it was not checked.
- A part report that can pass for a whole one. A stopped run says so on its
  front page.
- Any write to the shared folder or `register.json`. The register lost data
  in August 2026; this feature adds no write path.

## Constraints

- Static site, vanilla ES modules, no build step, `node --test`.
- The tool's source `tools-src/pid-tag-register.html` is gitignored and
  published by the owner with `node scripts/lock-tools.mjs`. Tool edits are
  anchored patches after a backup. Keep the tool's side to thin glue and put
  behaviour in tested modules under `assets/js/`.
- **Public repo:** no client data (drawing numbers, real tags, legend
  geometry, names) in `assets/js/`, `scripts/`, `docs/`, tests or fixtures.
  Tests use invented sheets and symbols, like
  `tests/fixtures/symbol-check-sheet.js` and `sheet-pdf.js`.
- Everything shown or written into the report that came from a PDF or the
  library file is untrusted text (the library is in a shared folder anyone
  connected can edit). Escape it for HTML and sanitise it for the PDF font.
- The check takes about 1 to 10 s per sheet, plus loading and pre-check.
  A 30-sheet pack can take several minutes.

## Approaches considered

1. **Draw the report from scratch with jsPDF** (already in `assets/vendor/`,
   used by HydroSizer), with each drawing as a picture and the boxes drawn on
   top. One file download, no new library. But the drawing is a raster: small
   text on an A1 sheet goes soft when zoomed, and each sheet adds 1 to 3 MB.
2. **A print page** (as Steelwork Checker does): build the report as an HTML
   page and use the browser's Print, then Save as PDF. Least code and easy
   tables. But extra clicks every time, page breaks and margins depend on the
   browser, 30 sheets of large pictures in one page are slow, and it feels the
   least official.
3. **Copy the original drawing pages into the report with pdf-lib, and draw
   the numbered boxes and the tables on top.** **Chosen by the owner.** The
   drawing stays vector, sharp at any zoom, its text still searchable, and
   each sheet adds roughly the size of its original PDF. Costs one new vendored
   library, and a drawing PDF with an odd internal structure (encrypted,
   damaged) may not copy; that case has a fallback (below).

The Excel workbook uses ExcelJS in all three (already vendored, used by
Comments Hub and Decision Register).

## What the owner decided

- **Format:** PDF for the review pack, Excel alongside, both from one run.
- **What a pack is:** tick boxes on the sheet cards in the Sheets tab, plus a
  tick-all on each family header, so a whole family is one click and a mixed
  selection still works.
- **Contents:** a front page, then a section per sheet, as listed below.
- **Drawing picture with coloured, numbered boxes** in every sheet section,
  numbers matching the table rows.
- **Stop part-way:** you get the report for the sheets already done, with the
  front page saying it was stopped and the rest listed as not checked.
- **Build:** approach 3 (pdf-lib).

## How it works for the user

1. On the **Sheets** tab, tick sheets: a tick box on each sheet card, and a
   tick box on each family header (and on the Ungrouped header) that ticks or
   unticks every sheet in it. A family tick-all covers all its members, even
   ones hidden by the search box. Ticking does not open the sheet, and does
   not fold or unfold the family. A count shows ("12 sheets ticked"), with a
   **Clear ticks** link, whatever the search box or folded families hide.
2. Press **Export report**. It is disabled, with the reason as its tooltip,
   when nothing is ticked or the symbol library is not loaded (same wording
   as the Check symbols button's reasons where they overlap).
3. The tool says what it can reach before starting, for example: "28 of 30
   ticked sheets can be checked. 2 have no PDF in this session: connect the
   folder or re-import them." It lists the ticked sheets by name, so a sheet
   ticked but hidden in the list is seen before the run. Optional **Checked
   by** box. Buttons **Run** and **Cancel**.
4. While it runs: "Checking sheet 4 of 28: tag 31 of 71", with a **Stop**
   button. The rest of the tool stays usable. Opening a sheet or running Check
   symbols on screen while a report runs is allowed and does not disturb it.
5. When it finishes (or is stopped): a summary line ("26 checked, 2 not
   checked, 4 min 12 s") and two buttons, **Download PDF** and **Download
   Excel**. The results stay available for download until the panel is closed
   or another report is started. Nothing is written to the folder.

## What happens to each ticked sheet

In ticked order, sorted by family then drawing name as the Sheets list shows
them, one sheet at a time:

1. **PDF.** `getPdfData(drawing, currentRevision)`: from memory, or from the
   folder's `archive/` if connected. None → not checked, "PDF not available in
   this session: connect the folder or re-import it."
2. **Pre-check.** Use `sheetChecks[pdfKey(drawing, rev)]` if this session has
   it; otherwise run it exactly as `showSheetCheck` does (text extraction and
   `readSheetFacts`, then `assessSheet`) and keep it in `sheetChecks` (memory
   only, as today). Status other than Readable → not checked, with the status
   ("No readable text", "Readable from comments").
3. **Symbol check.** Page 1, in a fresh worker, with the same message
   `runSymbolCheck` posts today (operator list, viewport transform at scale 1,
   text items, the pre-check's confirmed tags, the library, the lookups).
   Keep that `viewportTransform` with the result: the report's box maths
   needs it. A Readable sheet with no confirmed tags (`why: 'no-tags'`) →
   not checked, "No confirmed tags to check." Any other result with
   `ok: false`, or a worker error → not checked, "The symbol check could not
   run on this sheet." A result with `timedOut` is reported as checked, with the time-limit line,
   and the tags it did not reach read Not checked as they do on screen.
4. Release the pdf.js document before the next sheet. pdf.js empties any
   buffer handed to it, so it is always given a copy.

Every ticked sheet is checked afresh by the run, even if its result is on
screen: the on-screen result does not keep the transform the boxes need, and
it may be a different revision or page.

**Stop:** terminates the worker. The sheet in progress and every sheet not
reached are listed as not checked, "Stopped before this sheet was checked."

## The PDF

Built with pdf-lib, in the browser, from the results held in memory.

**Front page** (A4 portrait):

- Title "P&ID symbol check", date and time of the run, **Checked by** if
  given.
- The family note, in full: `FAMILY_NOTE` from `pid-symbol-check-view.js`.
- Library: the legend sheets and revisions it records (`library.legend`), and
  its `importedAt`.
- Run: sheets ticked, checked, not checked, total time; "Stopped by user after
  N of M sheets" when stopped; "Page 1 only" noted for any multi-page PDF.
- A table, one row per ticked sheet: drawing, revision, pre-check status,
  result (Checked, or Not checked and why), and the count of each verdict.
- A short key to the verdicts and box colours.

**Per checked sheet:**

1. A heading page (A4) with drawing, revision, pre-check status, the verdict
   counts, the time taken, the time-limit line if it applies, and the short
   family note ("It checks the family of symbol, not which member of it.").
2. **The drawing page**: page 1 of the original PDF copied into the report at
   its own size, with a box around each item and a small numbered label at
   the box's corner, coloured by verdict as on screen. Boxes use `box` when a
   symbol was recognised, else `tagBox`, with the same 3 pt margin.
3. **The table** (A4, continuing over pages as needed): rows ordered as on
   screen (Wrong family, Needs a look, Approved exception, OK off size, Not
   checked, OK; then by tag), numbered 1, 2, 3 in that order. The number is the
   box label. Columns: No., Tag, Verdict, Detail. Detail is the sentence the
   screen shows (`sentence()` in the view module), so a Needs a look row names
   the closest symbol in its family and its score.

Colour is never the only cue: every box has its number and every row its
verdict word.

**Per not-checked sheet:** listed on the front page with its reason. No
section.

**If a drawing cannot be copied** (pdf-lib cannot load it, it is encrypted,
or copying throws): that sheet's section keeps its heading page and table, and
the drawing page is replaced by one line: "The drawing could not be copied
into this report. Results are listed below; open the sheet in the tool to see
the boxes."

**Coordinates.** The check's boxes are in pdf.js viewport space at scale 1
(origin top left, y down, page rotation applied). On the copied page, draw in
the page's own user space: map each corner through the inverse of the
`viewportTransform` the check used, and take the min and max. Labels on a
rotated page are turned with the page so they read upright when it is viewed.

**Text and fonts.** pdf-lib's standard Helvetica covers only the Windows
Latin character set. Any character it cannot encode is replaced (for example
with "?") rather than allowed to throw. Long details wrap.

## The Excel workbook

ExcelJS, loaded only when **Download Excel** is pressed.

- **Tags** sheet, one row per tag across the pack: Drawing, Revision, No.
  (matches the PDF box), Tag, Function code, Verdict, Symbol (or "One of: …"),
  Tag identifier, Size %, Score, Filled, Letters, Closest in family, Closest
  score, Detail. Header row frozen, autofilter on.
- **Sheets** sheet, one row per ticked sheet: Drawing, Revision, Pre-check
  status, Result, Reason if not checked, a column per verdict count, Time (s),
  Timed out.
- **About** sheet: the front page's facts and the family note in full.

## File names

- One sheet: `<drawing>_<rev>_SymbolCheck_<YYYY-MM-DD>.pdf` and `.xlsx`.
- More than one: `SymbolCheck_<N>-sheets_<YYYY-MM-DD_HHMM>.pdf` and `.xlsx`.

Names pass through the tool's existing `sanitizeFilename`. They are
downloaded to the user's machine and never written to the folder.

## Where the code goes

- **`assets/js/pid-symbol-report.js`** (new, pure, no DOM): from a list of
  per-sheet outcomes, builds the report model: front-page facts, per-sheet
  numbered rows in screen order, box rectangles in PDF user space, the Excel
  rows, the file names, and the "can it be reached" summary text. It reuses
  `VERDICT_LABELS`, `FAMILY_NOTE` and the row sentence from
  `pid-symbol-check-view.js` (export `sentence` and the row order from there
  rather than copying them). Node-tested with invented data.
- **`assets/js/pid-symbol-report-pdf.js`** (new): turns the model plus the
  source PDF bytes into report bytes with pdf-lib. Takes the pdf-lib object as
  a parameter so it can be tested in Node if the vendored file loads there.
- **`assets/vendor/pdf-lib.min.js`** (new): pdf-lib 1.17.1 UMD, MIT licence,
  fetched once with the owner's OK and recorded with its checksum, as the
  other vendored files are.
- **The tool** (glue only): tick state (memory only, cleared on reload), the
  tick boxes and family tick-all in `renderSheetsList`, the **Export report**
  button, the run loop, the progress and finished panel, and the two
  downloads. The run loop must name no save function, no save timer and no
  merge, and touch nothing in `buildRegisterState`.

## Testing

- `tests/pid-symbol-report.test.js` with invented sheets and results: row
  order and numbering; numbers match box labels; box conversion through the
  inverse transform, including a rotated page and a page whose MediaBox does
  not start at zero; a not-checked sheet for each reason; a stopped run; a
  timed-out sheet; the family note on the front page and in every section;
  hostile text (markup, control characters, characters outside the font) in
  tags and symbol names; file names.
- The PDF builder, in Node if pdf-lib loads there: the report has the
  expected page count, each drawing page has the source page's size, and a
  source that cannot be loaded gives the fallback line, not a failure.
- **Browser, with the invented sheet:** the builder makes a throwaway
  register folder outside the repo (invented `register.json`, an `archive/`
  holding the invented sheet PDF, an invented symbol library) and drives the
  tool from the console, as phase 3's Task 9 did. Tick, run, stop, download both; open
  the PDF and see the boxes sit on the symbols; confirm `register.json` has
  the same length and `savedAt` after a full run, and the folder holds the
  same entries.
- **The owner, on his machine, with real sheets (not committed):** a pack of
  real P&IDs. Record the time, the PDF size, whether every drawing copied, and
  whether the boxes sit on the symbols when zoomed in.

## Decisions made in writing this up (the owner may overrule)

1. **Two download buttons at the end, not two automatic downloads.** Browsers
   often block or ask about a second automatic download; buttons also let you
   download again without re-running.
2. **Page 1 only** for a multi-page PDF, stated on the front page and in that
   sheet's section, for checked sheets (the page count is known once the PDF
   is loaded). Checking every page is still deferred, as in the phase 3 plan.
3. **Current revision** of each ticked sheet, printed in the report, even if
   an older revision is open on screen.
4. **Drawing pages at their original size** (an A1 sheet stays A1 inside the
   report, the rest A4). Keeps the drawing to scale and prints "fit to page" on
   any paper.
5. **Optional Checked by box.** The tool knows no user names. What is typed is
   remembered in this browser only (localStorage, wrapped in try/catch), never
   in the folder.
6. **No reuse of the on-screen result**: every ticked sheet is checked by the
   run (see above).
7. **Ticks are not saved.** They clear on reload.
8. **pdf-lib is fetched in the plan's first step**, with the owner's OK at
   that moment (he chose approach 3 knowing it adds this library). Its version,
   source URL and SHA-256 go in the commit message and in the plan's outcome;
   there is no vendor manifest to add it to.
9. **Sheets with tags but no symbols in the library's families** are still
   checked; their rows read as the check says (usually Not checked).

## Left to the builder

- Layout details of the A4 pages: margins, type sizes, table column widths,
  label size on the drawing (readable at 100% on an A1 sheet without hiding
  the symbol).
- How the progress panel and finished panel sit in the Sheets tab.
- Whether the run loop lives in the tool or in a small module the tool calls,
  so long as the tool's part is glue.
- Memory handling for large packs (holding results only, re-fetching PDF bytes
  via `getPdfData` at build time is fine).

## Risks

- **pdf-lib cannot copy some real drawings.** Unproven on the owner's sheets.
  The fallback keeps the results; the owner's real-pack check will show how
  often it happens.
- **Boxes misplaced on real sheets** (rotation, offset MediaBox or CropBox).
  Covered by tests with invented pages; confirmed on real sheets by the owner.
- **Large packs.** 30 drawings at a few MB each make a report of tens of MB,
  which may be too big to email. Stated, not solved here.
- **Long runs.** A sheet can take up to the 120 s limit. The Stop button and
  the part report cover this.
