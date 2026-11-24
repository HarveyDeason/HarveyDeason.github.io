# P&ID register: binder PDFs — design (short)

Approved by Harvey 2026-11-24 (option A).

**Intent.** Contractors send one PDF holding many P&ID sheets. The register should treat each
page as its own drawing, so tags, pre-check, viewer, symbol check and report work per sheet.

**Decided (Harvey).**
- A PDF with more than one page gives one row per page in the "Confirm revisions" table.
- Each page's drawing number is read from that page's title block; if none is found the row is
  named `<file name> p<N>`. Every binder row's name is editable before importing.
- Single-page PDFs behave exactly as today.

**Approaches.**
- **A — split at import (picked).** pdf-lib (already vendored, `assets/vendor/pdf-lib.min.js`, used
  by the symbol report) copies each page into its own one-page PDF in memory. Each page then goes
  through today's import exactly as if it were a separate file and is archived as
  `<drawing>_<rev>.pdf` like any drawing. No reader, archive name or register field changes.
  Tried on a real 6-sheet binder: page sizes sum to the binder's size; comments survive.
- B — store the binder once, each drawing remembers its page. Every reader (tag text, pre-check,
  viewer, symbol check, report, CLI) and the register record would change, plus a new archive name.
  Rejected: far more to change and more ways to break the archive (2026-08-03 incident).

**How.**
- New tested module `assets/js/pid-binder.js` (no DOM):
  - `titleBlockNumber(items)` — items are `{ str, x, y, size }` with x/y as fractions of the page *as
    shown* (rotation applied, top-left origin). A drawing number is seven dash-separated fields
    (e.g. `D18197-ATKI-31-PR-G-P-4021`, `SP66-WWSL-52-XX-G-P-4001`). Only numbers in the lower-right
    quarter count (cross-references elsewhere on the sheet are ignored); the one nearest the
    bottom-right corner wins, larger text breaking a tie. None → `null`.
  - `pageNumberItems(page)` — reads a pdf.js page into those items.
  - `splitPdfPages(bytes, PDFLib)` — one-page PDFs, one per page; `null` if pdf-lib cannot do it
    (e.g. encrypted file), and the file then imports as one drawing, as today.
  - `binderRowName(found, fileBase, pageNo)` and `duplicateNames(names)`.
- `tools-src/pid-tag-register.html` (anchored patches, backup first): `handlePIDFiles` expands
  multi-page PDFs into per-page entries before `showRevModal`; binder rows get a name input;
  `confirmRevModal` uses that name and refuses to import while two binder-batch rows share a name
  (the second would silently replace the first). The module loads on its own and may fail; then
  importing works as it did before.

**Known cost.** pdf-lib does not copy PDF layers (optional content), so a layered binder's split pages
show every layer.

**Not changed.** Single-page import, archive naming, `register.json` shape, every reader, the CLI.
`tools/` must be re-locked by Harvey (`node scripts/lock-tools.mjs`, needs the workshop code).
