# P&ID register: binder PDFs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A multi-page PDF added to the P&ID tag register becomes one drawing per page.

**Architecture:** A new pure module `assets/js/pid-binder.js` splits a binder into one-page PDFs with the
already-vendored pdf-lib and reads each page's title-block drawing number. The tool expands binders into
per-page entries before the existing "Confirm revisions" modal, so everything downstream is unchanged.

**Tech Stack:** vanilla ES modules, pdf.js + pdf-lib from `assets/vendor/`, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-24-pid-binder-pdfs-design.md`

## Global Constraints

- No new dependency, no OCR. pdf-lib is passed in (`window.PDFLib` / `loadVendoredUmd('pdf-lib.min.js')`).
- Invented fixture data only in tests; no client sheets in the repo.
- Nothing writes `register.json`; archive naming stays `<drawing>_<rev>.pdf`.
- `tools-src/` edits by anchored patches after a backup to `.superpowers/sdd/`.
- Single-page PDFs import exactly as today (same code path, no name input).
- Commit only own files; never `tests/pid-symbol-store.test.js`, `tests/_scratch.mjs`. Commit/push only when Harvey says.

## Review Focus

- Binder page with no text at all (scanned) → `null` number → `<file> p<N>`; must not throw.
- Rotated page (`/Rotate 90`) → "lower-right" judged as shown, not as stored (test with a rotated invented page).
- Cross-references down the right edge above the title block → ignored (only lower-right quarter counts).
- Two binder rows with the same name → import refused, modal stays open, rows unchanged.
- pdf-lib cannot load the file (garbage / encrypted) → `splitPdfPages` returns `null`, file imports as one drawing.

---

### Task 1: `assets/js/pid-binder.js`

**Files:**
- Create: `assets/js/pid-binder.js`
- Test: `tests/pid-binder.test.js`

**Interfaces:**
- Produces:
  - `DRAWING_NUMBER: RegExp` — seven dash-separated fields: `[A-Z0-9]{2,8}-[A-Z0-9]{2,6}-[A-Z0-9]{2}-[A-Z0-9]{2}-[A-Z0-9]-[A-Z0-9]-\d{3,5}`, global, upper-case text.
  - `titleBlockNumber(items: {str,x,y,size}[]) -> string|null` — x,y fractions of the page as shown (0,0 top-left).
    Candidates: every regex match in an item with `x >= 0.5 && y >= 0.5`. Winner: smallest distance to (1,1); tie (within 0.01) → larger `size`.
  - `async pageNumberItems(page) -> {str,x,y,size}[]` — pdf.js page: `getViewport({scale:1})`, `getTextContent()`, `viewport.convertToViewportPoint(t[4], t[5])` divided by viewport width/height; `size = Math.hypot(t[2], t[3])`.
  - `async splitPdfPages(bytes: Uint8Array|ArrayBuffer, PDFLib) -> Uint8Array[]|null` — one `PDFDocument.create()` + `copyPages` + `addPage` + `save()` per page; any throw → `null`.
  - `binderRowName(found: string|null, fileBase: string, pageNo: number) -> string` — `found` trimmed if non-empty, else `` `${fileBase} p${pageNo}` ``.
  - `duplicateNames(names: string[]) -> string[]` — names (as first written) that occur more than once, compared trimmed and case-insensitive.

- [ ] **Step 1: Write the failing tests** (`tests/pid-binder.test.js`), fixtures built in-test with pdf-lib, text in Helvetica:
  - `titleBlockNumber picks the number nearest the bottom-right corner` — items: `INV1-ABCD-01-XX-G-P-4101` at (0.90,0.92), `INV1-ABCD-01-XX-G-P-4102` at (0.89,0.32), `INV1-ABCD-01-XX-G-P-4103` at (0.89,0.34) → `'INV1-ABCD-01-XX-G-P-4101'`.
  - `titleBlockNumber ignores numbers outside the lower-right quarter` — only (0.89,0.32) and (0.03,0.95) → `null`.
  - `titleBlockNumber finds a number inside a longer string` — `'REFER TO INV2-WXYZ-52-TT-G-P-4001 FOR DETAILS'` at (0.8,0.8) → `'INV2-WXYZ-52-TT-G-P-4001'`.
  - `titleBlockNumber returns null for no items` → `null`.
  - `splitPdfPages gives one one-page PDF per page, each with its own text` — 3-page invented PDF (page n draws `INV3-ABCD-01-XX-G-P-400n` near its bottom-right, and `SHEET n` mid-page); result length 3; each opens with `openPdf` with `numPages === 1`; page n's text contains `SHEET n` and not the others.
  - `pageNumberItems + titleBlockNumber read each split page's title block` → `INV3-…-4001`, `-4002`, `-4003`.
  - `a rotated page is judged as shown` — page with `setRotation(degrees(90))`, number drawn at the stored corner that shows as bottom-right after rotation, a decoy at the stored bottom-right → returns the first.
  - `splitPdfPages returns null for bytes pdf-lib cannot read` — `new Uint8Array([1,2,3])` → `null`.
  - `binderRowName falls back to file and page` — `(null,'Binder test',3)` → `'Binder test p3'`; `('  X-1 ','B',1)` → `'X-1'`; `('', 'B', 2)` → `'B p2'`.
  - `duplicateNames finds repeats ignoring case and spaces` — `['A-1','a-1 ','B']` → `['A-1']`; `['A','B']` → `[]`.
- [ ] **Step 2: Run** `node --test tests/pid-binder.test.js` → FAIL (module not found).
- [ ] **Step 3: Implement** the module per Interfaces (no DOM, no imports).
- [ ] **Step 4: Run** `node --test tests/pid-binder.test.js` → all pass.

### Task 2: tool wiring (`tools-src/pid-tag-register.html`, gitignored)

**Files:**
- Backup: copy to `.superpowers/sdd/pid-tag-register.before-binder.html`
- Modify: `handlePIDFiles` (~1216), `showRevModal` (~1319), `confirmRevModal` (~1388), module loader script (~4662)

**Interfaces:**
- Consumes: Task 1 exports via `window.PidBinder`; `loadVendorScript('/assets/vendor/pdf-lib.min.js','PDFLib')` (existing).
- Produces: per-page entry objects `{ name, arrayBuffer(), _binder: { fileName, page, name } }` in `_pendingFiles`.

- [ ] **Step 1:** Add `async function expandBinders(files)`: if `window.PidBinder` missing, return `files`. Per file: open with pdf.js; `numPages <= 1` → push the original file object unchanged. Else load PDFLib, `splitPdfPages`; `null` → push original file. Otherwise per page n: number = `titleBlockNumber(await pageNumberItems(await pdf.getPage(n)))`, entry name = `binderRowName(number, drawingNameFromFile(file.name).name, n)`, entry `arrayBuffer` returns a fresh copy of that page's bytes. Destroy the pdf.js doc. Any throw for a file → push the original file.
- [ ] **Step 2:** `handlePIDFiles`: `_pendingFiles = await expandBinders(files)`, then `showRevModal(_pendingFiles)`.
- [ ] **Step 3:** `showRevModal`: for an entry with `_binder`, `parsed = { name: file._binder.name, revisionFromName: null }` and the name cell is `<input class="bind-name-input" data-file=i value=escAttr(name) title="Drawing number read from this page's title block — page N of <file>">` plus a small `p<N> of <file>` note; non-binder rows unchanged.
- [ ] **Step 4:** `confirmRevModal`: before closing the overlay, if any `_pendingFiles` entry has `_binder`, collect names (input value trimmed, empty → `binderRowName(null, …)`); if `duplicateNames` is non-empty, `alert('Two rows have the same drawing number: … Change one before importing.')` and return with the modal open. In the loop, a `_binder` entry's `drawingName` is its collected name.
- [ ] **Step 5:** Loader: `import('/assets/js/pid-binder.js').then(m => { window.PidBinder = m; }).catch(e => console.error('Binder PDFs unavailable; each PDF imports as one drawing.', e));`
- [ ] **Step 6:** Browser check on a local server: a single-page invented PDF imports as before (no name input, same row); an invented 3-page binder shows 3 rows named from title blocks; duplicate names refused; imported drawings open in the viewer as one page each. Then `Downloads/Binder test.pdf`: record each row's name.

### Task 3: verify and hand over

- [ ] `npm test` → all green (report counts).
- [ ] Report per page of `Binder test.pdf`; tell Harvey `tools/` needs `node scripts/lock-tools.mjs` before any push.
- [ ] Commit (only on Harvey's word): `assets/js/pid-binder.js`, `tests/pid-binder.test.js`, the spec, this plan, re-locked `tools/` files.
