# P&ID Sheet Pre-checks (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the P&ID Tag Register say, for every PDF at import and on every sheet in the Sheets tab, whether its tags can be read and from where, so a drawing that yields no tags is never registered silently.

**Architecture:** One new tracked module, `assets/js/pid-precheck.js`, holds every decision: which comments count as drawing text, the one status per sheet, which tags the import registers, the comparison with the register, and the HTML shown. The gitignored tool gains about 70 lines of glue that fetch from pdf.js and call the module. The tool's existing text read (`extractTextFromPDF`) and its whole save path are not edited at all. A local-only script runs the same module over the three private test drawings for Gate 2.

**Tech Stack:** Vanilla ES modules, `node --test` on Node 20, pdf.js 3.11.174 (vendored, loaded in Node through `scripts/pdfjs-node.mjs`), the preview server (`.claude/launch.json` config `site`, port 5050).

**Spec:** `docs/superpowers/specs/2026-11-13-pid-symbol-library-and-check-design.md`. Phase 2 and Gate 2 only. Phase 1 is built and live. Phase 3 is context, not scope.

## Global Constraints

- **The repository is public.** No Wessex Water data in `assets/js/`, `scripts/`, `docs/`, tests or fixtures: no drawing numbers, site, contractor or supplier names, no author names from PDF metadata, no real tag lists. Tests use invented drawings and invented tags (`21-XX-…`, `21-YY-…`). The DS310 lookup tables stay in the tool and are passed in, as `pid-core.js` already requires.
- **The three test drawings are private.** They live in `../pid-symbol-spike/` (`test-drawing-A.pdf`, `-B.pdf`, `-C.pdf`) and are never copied into the repository, never served from it, and never written to a tracked file. Output from running a script over them stays in the terminal and the task report.
- **This work touches the register's import path. It adds no write path.** Nothing here calls `saveToFolder`, `scheduleSave`, `mergeState`, `buildRegisterState`, `snapshotRev` or `createWritable`, or names `register.json`, other than the calls that are already there. `readRegisterJSON`'s three-state read, `writeFileAtomic` and the destructive-save guard are not edited. Task 7 measures all of this before the edit and Task 9 measures it again after.
- **`register.json` gains no field.** The check result is kept in memory for the session and worked out again when a sheet is opened. See *Decisions* 3.
- **`extractTextFromPDF` is not edited.** It stays the only source of the text that tags are read from. Its bytes are hashed before and after.
- **Pure functions do not throw.** Every exported function in `pid-precheck.js` returns degraded output on any input, as `pid-core.js` does. `readSheetFacts` is the one function that awaits pdf.js; it never rejects.
- **A failed check never blocks or changes an import.** If the module did not load or pdf.js throws, the import registers exactly what it does today and the sheet says "Not checked".
- **Zero build, no new dependencies.** pdf.js 3.11.174 at `assets/vendor/` is the only PDF reader.
- **`tools-src/` is gitignored.** Tool edits are invisible in git, so they are made by an anchored patch, after a backup copy, in the workspace `.superpowers/sdd/2026-11-14-pid-sheet-prechecks/` (also gitignored). Never run `scripts/lock-tools.mjs`; the owner does that.
- **Do not commit.** The owner commits when he asks. Each task ends with a checkpoint listing its files and a message to use if he has asked.
- **Not built in this phase:** anything from phase 3 (`rasterise`, `matchAt`, `checkTag`, `sheetVerdicts`, a Check symbols button), OCR, any check of supplier drawings beyond whether their text can be read.
- **Baseline before starting:** `npm test` gives 736 tests, 734 passing, 0 failing, 2 skipped.

## Settled before this plan was written

Measured on 2026-11-14 with throwaway scripts kept outside the repository (in the shared notes folder for this work, under `phase2-measurements/`). Every test assertion in this plan was run against a throwaway prototype of the module: 34 of 34 passed. The prototype is reference only; do not copy it in, write the module test-first.

**The three test drawings, through the vendored pdf.js in Node.** Each is one page.

| | A: palette-drawn, plotted | B: printed | C: supplier, plain AutoCAD |
|---|---|---|---|
| Text items (non-blank) | 330 | 0 | 43 |
| DS310 tags from the text layer | 71 confirmed, 0 review | 0 | 0 |
| Annotations from `getAnnotations()` | 25 | 0 | 47 |
| DS310 tags from those comments | 0 | 0 | **0** |
| `info.Creator` | `AutoCAD Plant 3D 2026 - English 2026 (25.1s (LMS Tech))` | absent | `AutoCAD 2017 - English 2017 (21.0s (LMS Tech))` |
| `info.Producer` | `pdfplot17.hdi 17.01.074.00000` | `Microsoft: Print To PDF` | `pdfplot13.hdi 13.00.052.000` |
| Page | 2384 × 1684 pt = 841 × 594 mm (A1) | 2383.92 × 1683.72 pt = 841 × 594 mm (A1) | 1191 × 842 pt = 420 × 297 mm (A3) |
| Content-stream operators | not measured | 141,940 | 10,313 |

- **What `getAnnotations()` returns.** Every one of the 72 annotations is `subtype: 'Square'`, `annotationFlags: 64`, `hasAppearance: false`, with the text in **`contentsObj.str`** (there is no `contents` property in this build), the author in **`titleObj.str`**, and `rect` as a plain array of four numbers in PDF points with a bottom-left origin. All 72 have the author `AutoCAD SHX Text`. Other keys: `borderStyle`, `color`, `rotation`, `id`, `modificationDate`, `creationDate`, `popupRef`, `annotationType`.
- **Drawing C's comments hold no DS310 tags.** They are equipment labels, pipe sizes and the supplier's own tag numbers, which are not in DS310 form. `extractTags` gives 0 confirmed and 0 review from them, whether they are joined by spaces, by newlines, or read one at a time. None of the 47 comment strings appears in C's text layer; the 43 text items are its title block. **So no drawing on this laptop exercises the one case where this work changes what the register ingests.** That case is tested with invented PDFs only.
- **Drawing A's comments are all the same string with AutoCAD formatting codes left in** (`\pxqc;{\W0.85;M}`, 25 of 25): the letter inside each motor actuator. Comment text therefore needs its codes stripped before it is read.
- **Drawing B gives exactly zero text items and zero annotations.** No noise.
- **`getMetadata()`** returns `{ info, metadata }`. `info.Creator` and `info.Producer` are strings when the PDF records them and absent otherwise. `info.Author` and `info.Title` exist on some of these files and hold a person's name and a drawing number: they are never read or shown.
- **pdf.js empties the bytes it is given.** A 423,285-byte `Uint8Array` had `byteLength` 0 after `getDocument`. The tool already passes copies (`buf.slice(0)`); the new glue does the same.
- **An invented PDF can carry comments and metadata.** A hand-built PDF with `/Annots` and `/Info` reads back through the vendored pdf.js with the same field shapes as the real drawings, so the whole path is testable in `npm test` and drivable in the browser from the console.
- **The status decision is a pure function over plain inputs.** Confirmed with the prototype: text item count, comment count and tag counts decide the status; the tags to register follow from two `extractTags` results. The tool only fetches.
- **The tool edits in Tasks 7 and 8 were tried on a scratch copy of the tool, outside the repository, with the prototype module.** All 15 edits applied, the script parsed, the save-path hashes and counts were unchanged, and `tests/escaping-audit.test.js` passed on the patched copy (11 of 11). Driven in the built-in browser with the invented sheets, Task 9 Steps 2 to 8 gave the values written there. The real tool has not been edited.
- **The built-in browser pane may deliver no animation frames** (`requestAnimationFrame` did not fire in 3 seconds during planning). pdf.js waits for one to draw a page, so `await viewSheet(...)` never returned there. Task 9 therefore calls `viewSheet` without awaiting it, and Task 8 starts the check before the page is drawn so it does not depend on the render.
- **The tool today.** `drawings[name].warning` is set to `'NO TAGS FOUND - may be scanned PDF'` at import and is never read or shown anywhere: that is the silent registration this phase ends. `rebuildLiveFromHistory` rebuilds `drawings` from `revHistory` on every load, so anything saved in `drawings` beyond `revision` and `count` is lost on the next connect. The tool file is 3,976 lines with LF endings and names `register.json` 19 times. All 15 patch anchors used below occur exactly once in it today.

## What changes in what the register ingests

Stated plainly, because this is the code path that lost data in August 2026.

1. **A PDF whose text layer gives at least one tag, confirmed or for review: no change.** `tagsToRegister` returns the very object `extractTags` returned. Test drawing A: 71 before, 71 after.
2. **A PDF whose text layer gives no tags and whose own comments give none: no change in what is registered.** It is still registered with a count of 0, as today. What changes is that the dialog and the sheet now say so. Test drawings B and C: 0 before, 0 after.
3. **A PDF whose text layer gives no tags and whose own comments give at least one: changed.** Today it registers zero tags. After this work it registers the tags read from the comments, confirmed and review, under the same drawing and revision, through the same unedited `allTags.push` and `snapshotRev` lines. Its `drawings[name].warning` becomes `null` instead of the "no tags found" string. No real drawing here is of this kind.
4. **Mark-up comments typed by a person are never read for tags**, on any drawing.
5. `register.json` has the same eight top-level keys and the same shapes inside them. Nothing new is saved.

## Decisions made in this plan

For the owner to overrule at review.

1. **"Readable from comments" means the text layer gave no tags and the drawing has comments holding text.** It does not require the comments to hold DS310 tags. The design's wording ("when the text layer gave no tags and comments did") read literally would make drawing C "Readable", because its comments hold no DS310 tags and it has 43 text items, and Gate 2 would fail. Known oddity: an in-house sheet with a real text layer, no tags, and a few such comments (actuator letters, say) also reads "Readable from comments".
2. **Only comments whose author is `AutoCAD SHX Text` count as drawing text.** All 72 comments on drawings A and C carry it. Anything else is counted as mark-up and reported ("2 mark-up comments ignored."), never read. Risk: a CAD program that writes a different author is treated as mark-up, and the sheet says "No readable text" with the ignored count visible. The author string is an option with that default.
3. **Nothing is saved.** The status is worked out at import and again whenever a sheet is opened, and held in memory. The Sheets tab can show it that way, so the register's state and merge code are left alone. Consequence: the chip in the sheet list appears only for sheets imported or opened in this session; other cards show their tag count as today until opened. If the owner wants a chip on every card without opening the sheet, the status has to be saved: one field, `revHistory[drawing][rev].precheck = { status, tagCount, reviewCount }`, written by `snapshotRev`. `mergeState` copies whole snapshots, so no merge code would change, and a register without the field would simply show no chip. **Not built. His call.**
4. **A PDF with no tags is still imported, as today.** It is no longer silent: the dialog shows its status and a summary line before "↓ Import all", and the sheet shows it afterwards. There is no extra confirmation and no way to untick a file.
5. **"Re-importing existing drawings changes nothing" is checked without re-importing.** Opening a sheet reads its PDF again exactly as an import would and compares the tags with what the register holds. A real re-import would rewrite that revision's `importedAt` in the shared register just to run a check. Limit: the real register is on the owner's work computer, which runs only the published tool, so this part of Gate 2 can only be done after going live. If he would rather check first, he can copy the register folder to the laptop and a script mode can be added to do the same comparison in Node.
6. **Tags found only in comments on a drawing that reads from its text layer are counted and reported, not registered.** The design's rule is kept: comments are used for tags only when the text layer gives none. The sheet says "2 more tags appear only in drawing comments and were not registered."
7. **Comment text is read the way text-layer text is:** one space between comments, a newline between pages, after stripping formatting codes. A tag split over two comments then joins exactly as one split over two text items does today.
8. **Revision and date detection still read the text layer only.** A drawing whose title block exists only as comments gets no detected revision and the user types it, as for any drawing where detection fails today.
9. **Highlighting a tag on a sheet read from comments is not built.** The viewer will say "No matches on this page" for such a tag. Each comment's rectangle is kept so this is glue only when wanted.
10. **The existing `warning` field is left exactly as it is**: still set, still never shown.
11. **The check reads each PDF a second time at import**, separately from the tag read, so the tag read stays untouched. Reading the three test drawings took 0.1 to 0.9 seconds each in Node.
12. **Sheet size comes from page 1**, named A0 to A4 when both sides are within 3 mm; a PDF of several pages adds the page count.

## File structure

| File | Responsibility |
|---|---|
| `tests/fixtures/sheet-pdf.js` (create) | Builds invented PDFs with text, comments and metadata; six named sheets. |
| `tests/fixtures/sheet-import-golden.json` (create) | What the tool reads and registers today for those six, captured from the unedited tool. |
| `assets/js/pid-precheck.js` (create) | Comment filter, status, tags to register, comparison, findings, HTML, and the pdf.js fetch. |
| `scripts/check-sheet-prechecks.mjs` (create) | Local-only Gate 2 check over real PDFs. Not in `npm test`. |
| `tests/pid-precheck.test.js`, `tests/check-sheet-prechecks.test.js` (create); `tests/pdfjs-node.test.js` (append) | Tests. |
| `tools-src/pid-tag-register.html` (modify, gitignored) | A dialog column and summary line, one renamed variable and four added statements in the import, a line under the Sheets toolbar, a chip on sheet cards, the glue section, the module import. |
| `.superpowers/sdd/2026-11-14-pid-sheet-prechecks/` (gitignored workspace) | Backup of the tool, `tool-facts.mjs`, `patch.mjs`, the two edit lists, task reports. |

## Review Focus

The inputs most likely to bite a user that the design implies but does not spell out. Each has a test in the task named.

1. **A printed drawing that a reviewer has marked up, typing tags into the mark-up.** Expected: mark-up is not drawing text; nothing is registered from it; the status stays "No readable text" and the count of ignored comments is shown. Tasks 2, 3, 4.
2. **A drawing whose text layer gives some tags while more sit only in its comments.** Expected: it registers exactly what it does today, and says how many more are in comments only. Task 3.
3. **Comment text carrying AutoCAD formatting codes, or a tag split across two comments or two lines.** Measured on drawing A: 25 of 25 comments carry codes. Expected: codes are stripped; a split tag joins as it would in the text layer. Tasks 2, 4.
4. **Markup in the PDF's metadata or in a comment, or in a tag another machine wrote to the register.** The producing program is shown on screen and register tags are listed in the comparison. Expected: shown as text, escaped. Task 5.
5. **The check itself failing**: the module did not load, pdf.js rejects the file, `getAnnotations` or `getMetadata` throws. Expected: the import registers what it does today, the sheet says "Not checked", nothing is blocked. Tasks 3, 4, 9.

---

### Task 1: Invented sheets, the pdf.js shapes, and what the tool does today

Nothing in the tool is edited until its current behaviour on these sheets is on record.

**Files:**
- Create: `tests/fixtures/sheet-pdf.js`
- Create: `tests/fixtures/sheet-import-golden.json`
- Test: `tests/pdfjs-node.test.js` (append)

**Interfaces:**
- Consumes: `loadVendoredPdfjs`, `openPdf` from `scripts/pdfjs-node.mjs`.
- Produces: `sheetPdf({ pages, info }) -> Uint8Array`, `SHEETS` (six named specs: `plotted`, `printed`, `commentsWithTags`, `commentsNoTags`, `printedWithMarkup`, `hostile`), `SHX_AUTHOR`; and `sheet-import-golden.json`, an object keyed by the same six names with `{ text, confirmed: string[], review: string[], likelyScanPDF }`.

- [ ] **Step 1: Write the fixture.** Given in full: it is a file format, not an algorithm the tests could determine.

```js
// tests/fixtures/sheet-pdf.js
// Invented PDFs for the sheet pre-checks: pages with or without a text layer,
// with or without comments, and a document information dictionary. Nothing
// here comes from a real drawing: the tags, programs and names are made up.
export const SHX_AUTHOR = 'AutoCAD SHX Text';
const pdfStr = s => '(' + String(s).replace(/[\\()]/g, c => '\\' + c) + ')';

// pages: [{ size: [w, h], text: [string], comments: [{ text, author, rect, subtype }] }]
// info:  { Creator, Producer, ... }, or null for a PDF with no information dictionary
export function sheetPdf({ pages = [{}], info = null } = {}) {
  const objs = [];                                   // objs[n - 1] is object n
  const add = body => { objs.push(body); return objs.length; };
  const catalog = add(''), tree = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids = [];
  for (const p of pages) {
    const [w, h] = p.size || [200, 100];
    const content = (p.text || []).map((t, i) => `BT /F1 8 Tf 10 ${h - 12 - i * 10} Td ${pdfStr(t)} Tj ET`).join('\n');
    const stream = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const annots = (p.comments || []).map(c => add(
      `<< /Type /Annot /Subtype /${c.subtype || 'Square'} /Rect [${(c.rect || [10, 10, 60, 20]).join(' ')}] ` +
      `/Contents ${pdfStr(c.text)} /T ${pdfStr(c.author == null ? SHX_AUTHOR : c.author)} /F 64 /BS << /W 0 >> >>`));
    kids.push(add(`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${w} ${h}] /Contents ${stream} 0 R ` +
      `/Resources << /Font << /F1 ${font} 0 R >> >> /Annots [${annots.map(n => n + ' 0 R').join(' ')}] >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${tree} 0 R >>`;
  objs[tree - 1] = `<< /Type /Pages /Kids [${kids.map(n => n + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
  const infoObj = info ? add('<< ' + Object.entries(info).map(([k, v]) => `/${k} ${pdfStr(v)}`).join(' ') + ' >>') : 0;
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R${infoObj ? ` /Info ${infoObj} 0 R` : ''} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, c => c.charCodeAt(0));   // ASCII only; no Buffer, so it also runs in a browser
}

const CAD = { Creator: 'Invented CAD 1.0', Producer: 'Invented Plotter (v2)' };
const A1 = [2384, 1684], A3 = [1191, 842];

// One of each kind of sheet the pre-check has to tell apart.
export const SHEETS = {
  // Plotted, real text layer with tags. Also carries the three kinds of comment
  // seen in practice: a letter with formatting codes, a tag the text layer
  // lacks, and a reviewer's mark-up. Two pages.
  plotted: { info: CAD, pages: [
    { size: A1, text: ['21-XX-1001', 'TITLE BLOCK', '21-YY 1002'], comments: [
      { text: '\\pxqc;{\\W0.85;M}', rect: [168, 1251, 188, 1271] },
      { text: '21-XX-2001', rect: [10, 20, 60, 30] },
      { text: 'change 21-XX-9999', author: 'A Reviewer', subtype: 'Text', rect: [5, 5, 25, 25] }] },
    { size: A3 }] },
  // Printed: no text layer, no comments, and only a printer named.
  printed: { info: { Producer: 'Invented Printer' }, pages: [{ size: A1 }] },
  // Labels drawn as linework and kept as comments; the title block is real text.
  // The comments hold tags: one plain, one with formatting codes, one split over
  // two comments, one for review.
  commentsWithTags: { info: CAD, pages: [{ size: A3, text: ['TITLE BLOCK', 'REV A'], comments: [
    { text: '21-XX-3001', rect: [100, 700, 150, 710] },
    { text: '{\\W0.85;21-YY-3002}', rect: [200, 700, 250, 710] },
    { text: '21-XX', rect: [300, 700, 330, 710] }, { text: '3003', rect: [300, 688, 330, 698] },
    { text: '21_YY_3004', rect: [400, 700, 450, 710] },
    { text: 'FEED PUMP', rect: [100, 600, 160, 610] }] }] },
  // The same kind of sheet with labels but no tags in them.
  commentsNoTags: { info: CAD, pages: [{ size: A3, text: ['TITLE BLOCK', 'REV A'], comments: [
    { text: 'FEED PUMP', rect: [100, 600, 160, 610] }, { text: 'OUTLET', rect: [300, 600, 340, 610] }] }] },
  // Printed, then marked up by a reviewer who typed tags into comments.
  printedWithMarkup: { info: { Producer: 'Invented Printer' }, pages: [{ size: A1, comments: [
    { text: 'should be 21-XX-9001', author: 'A Reviewer', subtype: 'FreeText', rect: [50, 50, 200, 70] },
    { text: '21-YY-9002 missing', author: 'A Reviewer', subtype: 'Text', rect: [60, 90, 80, 110] }] }] },
  // Markup in the metadata and in a comment.
  hostile: { info: { Creator: '<img src=x onerror=alert(1)>', Producer: '"><script>alert(2)</script>' }, pages: [{ size: [1000, 700],
    comments: [{ text: '<b>21-XX-4001</b>', rect: [10, 10, 60, 20] }] }] },
};
```

- [ ] **Step 2: Write the failing tests.** Append to `tests/pdfjs-node.test.js`, adding `import { sheetPdf, SHEETS, SHX_AUTHOR } from './fixtures/sheet-pdf.js';` beside its imports.

```js
test('comments arrive as contentsObj.str, with the author in titleObj.str and a four-number rect', async () => {
  const doc = await openPdf(sheetPdf(SHEETS.plotted));
  const ann = await (await doc.getPage(1)).getAnnotations();
  assert.equal(ann.length, 3);
  assert.equal(ann[0].contents, undefined); // this build has no plain `contents`
  assert.deepEqual(ann.map(a => a.contentsObj.str), ['\\pxqc;{\\W0.85;M}', '21-XX-2001', 'change 21-XX-9999']);
  assert.deepEqual(ann.map(a => a.titleObj.str), [SHX_AUTHOR, SHX_AUTHOR, 'A Reviewer']);
  assert.deepEqual(ann.map(a => a.subtype), ['Square', 'Square', 'Text']);
  assert.deepEqual(Array.from(ann[1].rect), [10, 20, 60, 30]);
  assert.deepEqual(await (await doc.getPage(2)).getAnnotations(), []);
});

test('getMetadata().info carries Creator and Producer, and leaves them out when the PDF records none', async () => {
  const info = (await (await openPdf(sheetPdf(SHEETS.plotted))).getMetadata()).info;
  assert.deepEqual([info.Creator, info.Producer], ['Invented CAD 1.0', 'Invented Plotter (v2)']);
  const bare = (await (await openPdf(sheetPdf({ pages: [{ text: ['X'] }] }))).getMetadata()).info;
  assert.deepEqual([bare.Creator, bare.Producer], [undefined, undefined]);
});

test('a page with no text layer gives no text items, and the viewport gives the sheet size in points', async () => {
  const doc = await openPdf(sheetPdf(SHEETS.plotted));
  const items = (await (await doc.getPage(1)).getTextContent()).items;
  assert.equal(items.map(i => i.str).join(' ') + '\n', '21-XX-1001 TITLE BLOCK 21-YY 1002\n');
  const two = await doc.getPage(2);
  assert.deepEqual((await two.getTextContent()).items, []);
  const vp = two.getViewport({ scale: 1 });
  assert.deepEqual([vp.width, vp.height], [1191, 842]);
});

test('getDocument empties the bytes it is handed, so a caller that needs them passes a copy', async () => {
  const bytes = sheetPdf(SHEETS.printed);
  assert.ok(bytes.byteLength > 0);
  await openPdf(bytes);
  assert.equal(bytes.byteLength, 0);
});
```

- [ ] **Step 3: Run them.** Run: `node --test tests/pdfjs-node.test.js`. Expected: 9 pass (5 existing, 4 new). These pin what pdf.js gives, so they pass as soon as the fixture exists. If the first fails, stop: Task 2's comment reader depends on those field names.

- [ ] **Step 4: Capture what the CURRENT tool reads and registers for the six sheets.** Start the preview server (`preview_start` with name `site`) and open `http://localhost:5050/tools-src/pid-tag-register.html`. The tool must be unedited: confirm `grep -c "PidPrecheck" tools-src/pid-tag-register.html` prints `0`. In the page console run:

```js
const m = await import('/tests/fixtures/sheet-pdf.js');
const out = {};
for (const [name, spec] of Object.entries(m.SHEETS)) {
  const text = await extractTextFromPDF(m.sheetPdf(spec).buffer);          // the tool's own, unedited function
  const r = PidCore.extractTags(text, { drawingName: 'INVENTED-001', revision: 'C01', lookups: {} });
  out[name] = { text, confirmed: r.confirmed.map(t => t.tag), review: r.review.map(t => t.tag), likelyScanPDF: r.likelyScanPDF };
}
JSON.stringify(out, null, 2);
```

`lookups: {}` and tag strings only, so no DS310 table data can reach the file.

- [ ] **Step 5: Save the captured JSON** verbatim to `tests/fixtures/sheet-import-golden.json` (2-space indent, trailing newline). The planning measurement, made in Node with the same pdf.js build, predicts exactly this:

```json
{
  "plotted": { "text": "21-XX-1001 TITLE BLOCK 21-YY 1002\n\n", "confirmed": ["21-XX-1001", "21-YY-1002"], "review": [], "likelyScanPDF": false },
  "printed": { "text": "\n", "confirmed": [], "review": [], "likelyScanPDF": true },
  "commentsWithTags": { "text": "TITLE BLOCK REV A\n", "confirmed": [], "review": [], "likelyScanPDF": true },
  "commentsNoTags": { "text": "TITLE BLOCK REV A\n", "confirmed": [], "review": [], "likelyScanPDF": true },
  "printedWithMarkup": { "text": "\n", "confirmed": [], "review": [], "likelyScanPDF": true },
  "hostile": { "text": "\n", "confirmed": [], "review": [], "likelyScanPDF": true }
}
```

**The file is what the browser gave, not this prediction.** If the two differ in any value, save what the browser gave, stop, and report both: it means Node and the browser read a PDF differently, and every Node check in this plan is then in doubt.

- [ ] **Step 6: Checkpoint.** Run `npm test`: 740 tests, 738 passing, 0 failing, 2 skipped. Files: `tests/fixtures/sheet-pdf.js`, `tests/fixtures/sheet-import-golden.json`, `tests/pdfjs-node.test.js`. Message if the owner has asked for commits: `test(pid): invented sheets and a record of what the import reads today`.

---

### Task 2: Reading comments, page size and the producing program

**Files:**
- Create: `assets/js/pid-precheck.js`
- Test: `tests/pid-precheck.test.js`

**Interfaces:**
- Produces:
  - `SHX_COMMENT_AUTHOR = 'AutoCAD SHX Text'`
  - `plainCommentText(str) -> string`
  - `Comment = { text: string, rect: [x0, y0, x1, y1] | null }`, `rect` in PDF points, bottom-left origin, as pdf.js gives it.
  - `sheetComments(annotations, options?) -> { comments: Comment[], other: number }`. `options.author` defaults to `SHX_COMMENT_AUTHOR`.
  - `countTextItems(items) -> number`
  - `paperSize(widthPt, heightPt) -> { name, orientation, widthMm, heightMm, label }`
  - `producedBy(info) -> string`

- [ ] **Step 1: Write the failing tests** in a new `tests/pid-precheck.test.js`.

```js
// tests/pid-precheck.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHX_COMMENT_AUTHOR, plainCommentText, sheetComments, countTextItems, paperSize, producedBy } from '../assets/js/pid-precheck.js';

test('plainCommentText: strips AutoCAD formatting codes and reads a line break as a space', () => {
  assert.equal(plainCommentText('\\pxqc;{\\W0.85;M}'), 'M');
  assert.equal(plainCommentText('{\\fArial|b0|i0;21-YY-2002}'), '21-YY-2002');
  assert.equal(plainCommentText('21-XX\\P1001'), '21-XX 1001');
  assert.equal(plainCommentText('  A\\~B \n C '), 'A B C');
  for (const bad of [undefined, null, 5, {}, []]) assert.equal(plainCommentText(bad), '');
});

test('sheetComments: keeps drawing-text comments, counts other mark-up, never reads it', () => {
  const anns = [
    { contentsObj: { str: '\\pxqc;{\\W0.85;M}' }, titleObj: { str: SHX_COMMENT_AUTHOR }, rect: [168, 1251, 188, 1271] },
    { contentsObj: { str: '21-XX-2001' }, titleObj: { str: 'autocad shx text' }, rect: new Float32Array([10, 20, 60, 30]) },
    { contentsObj: { str: 'change 21-XX-9999' }, titleObj: { str: 'A Reviewer' }, rect: [5, 3, 27, 25] },
    { contentsObj: { str: '   ' }, titleObj: { str: SHX_COMMENT_AUTHOR }, rect: [0, 0, 1, 1] },
    { contents: 'OLD SHAPE', title: SHX_COMMENT_AUTHOR, rect: [1, 2, 3] },
  ];
  assert.deepEqual(sheetComments(anns), { comments: [
    { text: 'M', rect: [168, 1251, 188, 1271] }, { text: '21-XX-2001', rect: [10, 20, 60, 30] }, { text: 'OLD SHAPE', rect: null }], other: 1 });
  assert.deepEqual(sheetComments(anns, { author: 'A Reviewer' }), { comments: [{ text: 'change 21-XX-9999', rect: [5, 3, 27, 25] }], other: 3 });
});

test('sheetComments and countTextItems: hostile input degrades and never throws', () => {
  for (const bad of [undefined, null, 5, 'x', {}]) assert.deepEqual(sheetComments(bad, bad), { comments: [], other: 0 });
  assert.deepEqual(sheetComments([null, 7, { contentsObj: 'x' }, { get contentsObj() { throw new Error('no'); } }]), { comments: [], other: 0 });
  assert.equal(countTextItems([{ str: 'A' }, { str: ' ' }, { str: '' }, null, { str: 5 }, { str: 'B' }]), 2);
  for (const bad of [undefined, null, 5, {}]) assert.equal(countTextItems(bad), 0);
});

test('paperSize: names the A sizes within 3 mm, either way up, and says so when it cannot', () => {
  assert.deepEqual(paperSize(2384, 1684), { name: 'A1', orientation: 'landscape', widthMm: 841, heightMm: 594, label: 'A1 landscape (841 × 594 mm)' });
  assert.equal(paperSize(2383.92, 1683.72).label, 'A1 landscape (841 × 594 mm)');
  assert.equal(paperSize(1191, 842).label, 'A3 landscape (420 × 297 mm)');
  assert.equal(paperSize(595, 842).label, 'A4 portrait (210 × 297 mm)');
  assert.deepEqual(paperSize(1000, 700), { name: '', orientation: 'landscape', widthMm: 353, heightMm: 247, label: '353 × 247 mm' });
  for (const bad of [[0, 5], ['x', 'y'], [NaN, 100], [undefined, undefined], [-5, 100]])
    assert.deepEqual(paperSize(...bad), { name: '', orientation: '', widthMm: 0, heightMm: 0, label: 'not known' });
});

test('producedBy: the program and the plotter from the PDF, empty when neither is recorded', () => {
  assert.equal(producedBy({ Creator: 'Invented CAD 1.0', Producer: 'Invented Plotter (v2)' }), 'Invented CAD 1.0 / Invented Plotter (v2)');
  assert.equal(producedBy({ Producer: 'Invented Printer' }), 'Invented Printer');
  assert.equal(producedBy({ Creator: 'Same', Producer: 'Same' }), 'Same');
  assert.equal(producedBy({ Creator: 5, Producer: '  a \n  b ' }), 'a b');
  assert.equal(producedBy({ Creator: 'x'.repeat(500) }).length, 120);
  for (const bad of [undefined, null, 5, 'x', {}, { get Creator() { throw new Error('no'); } }]) assert.equal(producedBy(bad), '');
});
```

- [ ] **Step 2: Run to see them fail.** Run: `node --test tests/pid-precheck.test.js`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement the five functions** in `assets/js/pid-precheck.js`. Open the file with a header comment in the style of `pid-core.js`: what the module is for, that it decides and the tool only fetches, and that no drawing, tag list or lookup table may be placed in it. Rules the tests do not fully determine:
  - `plainCommentText`, in this order: `\P` and `\~` become a space; a code of the form backslash, one letter, any run of characters other than `;`, `\`, `{` or `}`, then `;` is removed; every `{` and `}` is removed; whitespace is collapsed and trimmed. A non-string gives `''`.
  - `sheetComments`: for each annotation, the text is `plainCommentText` of `contentsObj.str`, else of a string `contents`; the author is `titleObj.str`, else a string `title`. An annotation with no text after cleaning is skipped and not counted. One whose author differs from the wanted author, ignoring case, adds 1 to `other`. `rect` is copied with `Array.from` when it is an array or a typed array of exactly four finite numbers, else `null` (pdf.js hands some arguments over as typed arrays; never test with `Array.isArray` alone). An annotation that throws when read is skipped.
  - `countTextItems`: items whose `str` is a string with a non-blank character.
  - `paperSize`: each side is `Math.round(points / 72 * 25.4)`. A non-finite or non-positive side gives the `'not known'` object. The A sizes are 841 × 1189, 594 × 841, 420 × 594, 297 × 420 and 210 × 297; a match needs the short side and the long side each within 3 mm. `orientation` is `'landscape'`, `'portrait'` or `'square'`. The multiplication sign in `label` is `×` (U+00D7).
  - `producedBy`: `Creator` and `Producer`, each a string with whitespace collapsed, trimmed and cut to 120 characters, anything else `''`. Both present and different: joined with `' / '`. Otherwise whichever is present. `Author` and `Title` are never read.

- [ ] **Step 4: Run to see them pass.** Run: `node --test tests/pid-precheck.test.js`. Expected: 5 pass.

- [ ] **Step 5: Checkpoint.** Files: `assets/js/pid-precheck.js`, `tests/pid-precheck.test.js`. Message: `feat(pid): read drawing comments, sheet size and producing program for the pre-check`.

---

### Task 3: The status, and which tags the import registers

The task that carries the risk. Its first two tests are the characterisation: they reuse the corpus and golden output captured from the tool on 2026-08-07.

**Files:**
- Modify: `assets/js/pid-precheck.js`
- Test: `tests/pid-precheck.test.js` (append)

**Interfaces:**
- Consumes: `extractTags(text, { drawingName, revision, lookups }) -> { confirmed, review, likelyScanPDF }` from `assets/js/pid-core.js`; `paperSize`, `producedBy` from Task 2.
- Produces:
  - `STATUS_LABELS = { readable: 'Readable', comments: 'Readable from comments', none: 'No readable text' }`
  - `SheetFacts = { ok: boolean, text: string, pages: [{ width, height, textItemCount, comments: Comment[], otherAnnotations }], info: { Creator, Producer } }` (built by Task 4; written by hand in this task's tests)
  - `sheetStatus({ textItemCount, textTagCount, commentCount }) -> 'readable' | 'comments' | 'none'`
  - `assessSheet({ text, facts, extractOptions }) -> SheetCheck | null`
  - `SheetCheck = { status, source: 'text' | 'comments' | 'none', result, tagCount, reviewCount, textItemCount, commentCount, otherAnnotationCount, commentOnlyTagCount, producedBy: string, paper, pageCount, findings: string[] }`. `result` is an `extractTags` result: what the import should register.
  - `tagsToRegister(textResult, check) -> result`
  - `compareWithRegister(result, snapshotTags) -> { same, nowCount, registerCount, added: string[], missing: string[], changed: string[] }`

- [ ] **Step 1: Write the failing tests.** Append to `tests/pid-precheck.test.js`. Add `STATUS_LABELS, sheetStatus, assessSheet, tagsToRegister, compareWithRegister` to the module import, and these imports and helpers:

```js
import { readFileSync } from 'node:fs';
import { extractTags } from '../assets/js/pid-core.js';
import { FIXTURE_LOOKUPS, CORPUS } from './fixtures/pid-tag-corpus.js';

const GOLDEN = JSON.parse(readFileSync(new URL('./fixtures/pid-tag-golden.json', import.meta.url), 'utf8'));
const OPTS = { drawingName: 'SP51', revision: 'C', lookups: FIXTURE_LOOKUPS };
const tags = r => ({ confirmed: r.confirmed.map(t => t.tag), review: r.review.map(t => t.tag) });
const page = (over = {}) => ({ width: 2384, height: 1684, textItemCount: 0, comments: [], otherAnnotations: 0, ...over });
const facts = (pages, info = { Creator: 'Invented CAD 1.0', Producer: 'Invented Plotter (v2)' }) => ({ ok: true, text: '', pages, info });
const c = text => ({ text, rect: null });
// Comments and mark-up that would change the answer if they were ever allowed to.
const NOISY = facts([page({ textItemCount: 3, comments: [c('21-XX-9001'), c('21-YY-9002')], otherAnnotations: 2 })]);
```

```js
test('sheetStatus: one status per sheet, from where its text can be read', () => {
  assert.equal(sheetStatus({ textItemCount: 330, textTagCount: 71, commentCount: 25 }), 'readable');
  assert.equal(sheetStatus({ textItemCount: 43, textTagCount: 0, commentCount: 47 }), 'comments');
  assert.equal(sheetStatus({ textItemCount: 0, textTagCount: 0, commentCount: 3 }), 'comments');
  assert.equal(sheetStatus({ textItemCount: 12, textTagCount: 0, commentCount: 0 }), 'readable');
  assert.equal(sheetStatus({ textItemCount: 0, textTagCount: 0, commentCount: 0 }), 'none');
  for (const bad of [undefined, null, 5, {}, { textTagCount: 'x', commentCount: NaN }]) assert.equal(sheetStatus(bad), 'none');
  assert.deepEqual(STATUS_LABELS, { readable: 'Readable', comments: 'Readable from comments', none: 'No readable text' });
});

test('golden: a drawing whose text layer gives any tag registers exactly what it does today, whatever its comments hold', () => {
  let withTags = 0;
  for (const k of CORPUS) {
    const today = GOLDEN[k.name];
    if (today.confirmed.length + today.review.length === 0) continue;
    withTags++;
    const check = assessSheet({ text: k.text, facts: NOISY, extractOptions: OPTS });
    assert.deepEqual(check.result, today, `corpus case drifted: ${k.name}`);
    assert.deepEqual([check.status, check.source], ['readable', 'text'], k.name);
    assert.equal(tagsToRegister(today, check), today, `not the same object: ${k.name}`);
  }
  assert.ok(withTags >= 19);
});

test('golden: a drawing with no tags and no comments registers exactly what it does today', () => {
  let without = 0;
  for (const k of CORPUS) {
    const today = GOLDEN[k.name];
    if (today.confirmed.length + today.review.length > 0) continue;
    without++;
    const check = assessSheet({ text: k.text, facts: facts([page({ textItemCount: 1 })]), extractOptions: OPTS });
    assert.deepEqual(check.result, today, `corpus case drifted: ${k.name}`);
    assert.equal(check.source, 'none');
    assert.equal(tagsToRegister(today, check), today);
  }
  assert.ok(without >= 3);
});

test('assessSheet: comments are read for tags only when the text layer gives none', () => {
  const f = facts([page({ width: 1191, height: 842, textItemCount: 2, comments: [
    { text: '21-XX-2001', rect: [1, 2, 3, 4] }, c('21-YY'), c('2002'), c('21_YY_2003'), c('FEED PUMP')] })]);
  const check = assessSheet({ text: 'TITLE BLOCK REV A\n', facts: f, extractOptions: OPTS });
  assert.deepEqual([check.status, check.source, check.tagCount, check.reviewCount, check.commentCount], ['comments', 'comments', 2, 1, 5]);
  assert.deepEqual(tags(check.result), { confirmed: ['21-XX-2001', '21-YY-2002'], review: ['21-YY-2003'] });
  // Rows are the same shape extractTags gives, carrying the drawing and revision asked for.
  assert.deepEqual(check.result.confirmed[0], { tag: '21-XX-2001', pac: '21', fc: 'XX', id: '2001', desc: 'Example Widget',
    drawing: 'SP51', revision: 'C', type: 'widget', isClash: false, isReview: false });
  assert.equal(check.result.likelyScanPDF, false);
  assert.deepEqual(check.findings, ['Text read from drawing comments.', '2 DS310 tags found, plus 1 for review.',
    'Made with: Invented CAD 1.0 / Invented Plotter (v2).', 'Sheet size: A3 landscape (420 × 297 mm).']);
});

test('assessSheet: labels in comments with no tags is still Readable from comments, and zero is said plainly', () => {
  const check = assessSheet({ text: 'TITLE BLOCK\n', facts: facts([page({ textItemCount: 43, comments: [c('FEED PUMP'), c('OUTLET')] })]), extractOptions: OPTS });
  assert.deepEqual([check.status, check.source, check.tagCount, check.reviewCount], ['comments', 'none', 0, 0]);
  assert.deepEqual(check.result, extractTags('TITLE BLOCK\n', OPTS));
  assert.deepEqual(check.findings.slice(0, 2), ['Text read from drawing comments.', 'No DS310 tags found.']);
});

test('assessSheet: a printed PDF has no readable text, and says what made it', () => {
  const check = assessSheet({ text: '\n', facts: facts([page()], { Creator: '', Producer: 'Invented Printer' }), extractOptions: OPTS });
  assert.deepEqual([check.status, check.source, check.textItemCount, check.commentCount], ['none', 'none', 0, 0]);
  assert.deepEqual(check.findings, ['No readable text: this PDF was printed, not plotted. Tags cannot be read.', 'No DS310 tags found.',
    'Made with: Invented Printer.', 'Sheet size: A1 landscape (841 × 594 mm).']);
  const bare = assessSheet({ text: '\n', facts: facts([page({ width: 0 })], {}), extractOptions: OPTS });
  assert.deepEqual(bare.findings.slice(2), ['Made with: not recorded in the PDF.', 'Sheet size: not known.']);
});

test('assessSheet: a reviewer\'s mark-up is counted and never read for tags', () => {
  const check = assessSheet({ text: '\n', facts: facts([page({ otherAnnotations: 2 })]), extractOptions: OPTS });
  assert.deepEqual([check.status, check.tagCount, check.otherAnnotationCount], ['none', 0, 2]);
  assert.ok(check.findings.includes('2 mark-up comments ignored.'));
  assert.ok(assessSheet({ text: '\n', facts: facts([page({ otherAnnotations: 1 })]), extractOptions: OPTS }).findings.includes('1 mark-up comment ignored.'));
});

test('assessSheet: tags that are only in comments on a readable drawing are counted, not registered', () => {
  const check = assessSheet({ text: '21-XX-1001 TITLE 21-YY 1002', facts: facts([page({ textItemCount: 3,
    comments: [c('21-XX-1001'), c('21-XX-2001'), c('21_YY_2003')] })]), extractOptions: OPTS });
  assert.deepEqual(tags(check.result), { confirmed: ['21-XX-1001', '21-YY-1002'], review: [] });
  assert.deepEqual([check.status, check.source, check.commentOnlyTagCount], ['readable', 'text', 2]);
  assert.ok(check.findings.includes('2 more tags appear only in drawing comments and were not registered.'));
  const one = assessSheet({ text: '21-XX-1001', facts: facts([page({ textItemCount: 1, comments: [c('21-XX-2001')] })]), extractOptions: OPTS });
  assert.ok(one.findings.includes('1 more tag appears only in drawing comments and was not registered.'));
  assert.equal(one.findings[0], '1 DS310 tag found.');
});

test('assessSheet: one status for the whole PDF; the first page gives the size', () => {
  const check = assessSheet({ text: '\n\n', facts: facts([page(), page({ width: 1191, height: 842, comments: [c('21-XX-3001')] })]), extractOptions: OPTS });
  assert.deepEqual([check.status, check.source, check.tagCount, check.pageCount], ['comments', 'comments', 1, 2]);
  assert.equal(check.findings.at(-1), 'Sheet size: A1 landscape (841 × 594 mm), 2 pages.');
  const text = assessSheet({ text: 'GENERAL NOTES', facts: facts([page(), page({ textItemCount: 2 })]), extractOptions: OPTS });
  assert.deepEqual([text.status, text.source, text.findings[0]], ['readable', 'none', 'No DS310 tags found.']);
});

test('assessSheet: no usable facts means no check, and hostile input never throws', () => {
  for (const bad of [undefined, null, 5, 'x', {}, { facts: 5 }, { text: '21-XX-1001', facts: { ok: false, pages: [] } }, { text: '21-XX-1001' }])
    assert.equal(assessSheet(bad), null);
  const odd = assessSheet({ text: {}, facts: { ok: true, pages: [null, 5, { comments: 'x', textItemCount: 'y' }, { comments: [null, { text: 7 }] }], info: 9 }, extractOptions: 3 });
  assert.deepEqual([odd.status, odd.source, odd.pageCount, odd.commentCount], ['none', 'none', 4, 0]);
});

test('tagsToRegister: the text result itself unless it is empty and the comments gave tags', () => {
  const some = extractTags('21-XX-1001', OPTS), none = extractTags('NOTHING', OPTS);
  const fromComments = assessSheet({ text: 'NOTHING', facts: facts([page({ comments: [c('21-XX-2001')] })]), extractOptions: OPTS });
  assert.equal(tagsToRegister(some, fromComments), some);
  assert.equal(tagsToRegister(none, fromComments), fromComments.result);
  for (const noCheck of [null, undefined, 5, {}, { source: 'comments' }, { source: 'comments', result: { confirmed: [], review: [] } },
    { source: 'text', result: fromComments.result }]) assert.equal(tagsToRegister(none, noCheck), none);
  // A review-only text result still counts as tags found: comments are not consulted.
  const reviewOnly = extractTags('21_YY_1014', OPTS);
  assert.equal(tagsToRegister(reviewOnly, fromComments), reviewOnly);
});

test('compareWithRegister: what an import would read now against what the register holds', () => {
  const now = extractTags('21-XX-1001 21-YY-1002 1-PP-1011 21_YY_1014', OPTS);
  const snapshot = [...now.confirmed, ...now.review].map(t => ({ tag: t.tag, isReview: !!t.isReview }));
  assert.deepEqual(compareWithRegister(now, snapshot), { same: true, nowCount: 4, registerCount: 4, added: [], missing: [], changed: [] });
  assert.deepEqual(compareWithRegister(now, [{ tag: '21-XX-1001', isReview: true }, { tag: '21-ZZ-7000', isReview: false }, { tag: '1-PP-1011', isReview: true }]),
    { same: false, nowCount: 4, registerCount: 3, added: ['21-YY-1002', '21-YY-1014'], missing: ['21-ZZ-7000'], changed: ['21-XX-1001'] });
  for (const bad of [undefined, null, 5, {}]) assert.deepEqual(compareWithRegister(bad, bad), { same: true, nowCount: 0, registerCount: 0, added: [], missing: [], changed: [] });
  assert.equal(compareWithRegister(null, [{ tag: '21-XX-1001' }]).same, false);
});
```

- [ ] **Step 2: Run to see them fail.** Run: `node --test tests/pid-precheck.test.js`. Expected: the 12 new tests FAIL, `sheetStatus` is not exported.

- [ ] **Step 3: Implement.** Rules the tests do not fully determine:
  - **`sheetStatus`** takes counts, each read as a non-negative integer (anything else is 0). Text tags above 0: `'readable'`. Otherwise comments above 0: `'comments'`. Otherwise text items above 0: `'readable'`. Otherwise `'none'`. "Tags" here always means confirmed plus review.
  - **`assessSheet`** returns `null` unless `facts.ok === true`, and returns `null` instead of throwing. Otherwise:
    - `textResult = extractTags(text, extractOptions)`.
    - Comment text is each page's comment texts joined with one space, and the pages joined with `'\n'`: the same shape `extractTextFromPDF` gives the text layer. `commentResult = extractTags(thatText, extractOptions)`. A comment whose `text` is not a non-empty string is left out and not counted.
    - `result` is `commentResult` when `textResult` has no tags and `commentResult` has some; otherwise it is `textResult` itself, the same object.
    - `source` is `'none'` when `result` has no tags, else `'comments'` or `'text'` by which was used.
    - `status` is `sheetStatus` over the summed text item count, the text tag count and the number of comments.
    - `commentOnlyTagCount` is, when `source` is `'text'`, the number of tags in `commentResult` (confirmed and review) whose `tag` is not in `textResult`; otherwise 0.
    - `paper` is `paperSize` of the first page; `pageCount` is the number of pages; `producedBy` is `producedBy(facts.info)`.
    - `findings`, in this order, each included only when it applies:
      1. status `none`: `No readable text: this PDF was printed, not plotted. Tags cannot be read.`
      2. status `comments`: `Text read from drawing comments.`
      3. always: `No DS310 tags found.` when confirmed plus review is 0; else `N DS310 tag(s) found` followed by `, plus R for review` when R is above 0, then a full stop.
      4. `commentOnlyTagCount` above 0: `1 more tag appears only in drawing comments and was not registered.` or `N more tags appear only in drawing comments and were not registered.`
      5. mark-up above 0: `1 mark-up comment ignored.` or `N mark-up comments ignored.`
      6. always: `Made with: ` then the producing program, or `not recorded in the PDF`, then a full stop.
      7. always: `Sheet size: ` then the paper label, then `, N pages` when there is more than one page, then a full stop.
  - **`tagsToRegister(textResult, check)`**: if `textResult` has any tag, return `textResult`. Otherwise, if `check.source === 'comments'` and `check.result` has any tag, return `check.result`. Otherwise return `textResult`. It never builds a new object.
  - **`compareWithRegister`**: both sides become a map from `tag` to whether it is for review (`result.confirmed` are not, `result.review` are; a snapshot tag by its `isReview`). `added` are tags read now that the register lacks, `missing` the reverse, `changed` those in both whose review flag differs; each sorted. `same` is true when all three are empty.

- [ ] **Step 4: Run to see them pass.** Run: `node --test tests/pid-precheck.test.js`. Expected: 17 pass.

**If either golden test fails, do not adjust a fixture.** `pid-tag-golden.json` is the record of what the tool registered before any of this. A mismatch means the new code changes what a drawing that reads today would register. Find and fix that in the module.

- [ ] **Step 5: Checkpoint.** Run `npm test`: 757 tests, 755 passing, 0 failing, 2 skipped. Files: `assets/js/pid-precheck.js`, `tests/pid-precheck.test.js`. Message: `feat(pid): sheet status and the comment fallback, pinned against the tag golden`.

---

### Task 4: Fetching the facts from pdf.js

**Files:**
- Modify: `assets/js/pid-precheck.js`
- Test: `tests/pid-precheck.test.js` (append)

**Interfaces:**
- Consumes: `sheetComments`, `countTextItems` (Task 2); `assessSheet`, `tagsToRegister`, `SheetFacts` (Task 3); `openPdf`; `sheetPdf`, `SHEETS`, `sheet-import-golden.json` (Task 1).
- Produces: `readSheetFacts(doc) -> Promise<SheetFacts>`, where `doc` is a pdf.js document. The module does not import pdf.js; the caller opens the document.

- [ ] **Step 1: Write the failing tests.** Append, adding `readSheetFacts` to the module import, and:

```js
import { openPdf } from '../scripts/pdfjs-node.mjs';
import { sheetPdf, SHEETS } from './fixtures/sheet-pdf.js';

const TODAY = JSON.parse(readFileSync(new URL('./fixtures/sheet-import-golden.json', import.meta.url), 'utf8'));
const read = async spec => readSheetFacts(await openPdf(sheetPdf(spec)));
```

```js
test('readSheetFacts: text, comments, mark-up, sizes and programs from a real pdf.js document', async () => {
  assert.deepEqual(await read(SHEETS.plotted), { ok: true, text: '21-XX-1001 TITLE BLOCK 21-YY 1002\n\n',
    pages: [
      { width: 2384, height: 1684, textItemCount: 3, otherAnnotations: 1,
        comments: [{ text: 'M', rect: [168, 1251, 188, 1271] }, { text: '21-XX-2001', rect: [10, 20, 60, 30] }] },
      { width: 1191, height: 842, textItemCount: 0, comments: [], otherAnnotations: 0 }],
    info: { Creator: 'Invented CAD 1.0', Producer: 'Invented Plotter (v2)' } });
  const printed = await read(SHEETS.printed);
  assert.deepEqual([printed.text, printed.pages[0].textItemCount, printed.pages[0].comments, printed.info], ['\n', 0, [], { Creator: '', Producer: 'Invented Printer' }]);
  assert.deepEqual((await read({ pages: [{ text: ['X'] }] })).info, { Creator: '', Producer: '' });
});

test('golden: the text read here is the text the tool reads today, and the same tags are registered', async () => {
  for (const [name, spec] of Object.entries(SHEETS)) {
    const f = await read(spec), today = TODAY[name];
    assert.equal(f.text, today.text, `text drifted: ${name}`);
    const textResult = extractTags(f.text, { drawingName: 'INVENTED-001', revision: 'C01', lookups: {} });
    assert.deepEqual({ ...tags(textResult), likelyScanPDF: textResult.likelyScanPDF }, { confirmed: today.confirmed, review: today.review, likelyScanPDF: today.likelyScanPDF }, name);
    const check = assessSheet({ text: f.text, facts: f, extractOptions: { drawingName: 'INVENTED-001', revision: 'C01', lookups: {} } });
    const registered = tagsToRegister(textResult, check);
    assert.deepEqual(registered, check.result, name);
    // The whole change this work makes to the register, in one place:
    if (name === 'commentsWithTags') assert.deepEqual(tags(registered), { confirmed: ['21-XX-3001', '21-YY-3002', '21-XX-3003'], review: ['21-YY-3004'] });
    else if (name === 'hostile') assert.deepEqual(tags(registered), { confirmed: ['21-XX-4001'], review: [] });
    else assert.equal(registered, textResult, `${name} must register what it does today`);
  }
});

test('each invented sheet gets the status it should', async () => {
  const got = {};
  for (const [name, spec] of Object.entries(SHEETS)) {
    const f = await read(spec);
    const check = assessSheet({ text: f.text, facts: f, extractOptions: OPTS });
    got[name] = [check.status, check.source, check.tagCount, check.reviewCount, check.commentOnlyTagCount, check.otherAnnotationCount];
  }
  assert.deepEqual(got, {
    plotted: ['readable', 'text', 2, 0, 1, 1],
    printed: ['none', 'none', 0, 0, 0, 0],
    commentsWithTags: ['comments', 'comments', 3, 1, 0, 0],
    commentsNoTags: ['comments', 'none', 0, 0, 0, 0],
    printedWithMarkup: ['none', 'none', 0, 0, 0, 2],
    hostile: ['comments', 'comments', 1, 0, 0, 0],
  });
});

test('readSheetFacts: a failed read is reported, a failed part is left out, and nothing throws', async () => {
  const empty = { ok: false, text: '', pages: [], info: { Creator: '', Producer: '' } };
  for (const bad of [undefined, null, 5, {}, { numPages: 1 }, { numPages: 1, getPage: async () => { throw new Error('no'); } }])
    assert.deepEqual(await readSheetFacts(bad), empty);
  const partial = { numPages: 1,
    getPage: async () => ({ getViewport: () => ({ width: 200, height: 100 }), getTextContent: async () => ({ items: [{ str: 'A' }] }),
      getAnnotations: async () => { throw new Error('no'); } }),
    getMetadata: async () => { throw new Error('no'); } };
  assert.deepEqual(await readSheetFacts(partial), { ok: true, text: 'A\n',
    pages: [{ width: 200, height: 100, textItemCount: 1, comments: [], otherAnnotations: 0 }], info: { Creator: '', Producer: '' } });
});
```

- [ ] **Step 2: Run to see them fail.** Run: `node --test tests/pid-precheck.test.js`. Expected: the 4 new tests FAIL, `readSheetFacts` is not exported.

- [ ] **Step 3: Implement `readSheetFacts(doc)`.**
  - `doc.numPages` must be a positive integer, or the result is the `ok: false` object.
  - For each page 1 to `numPages`: `getViewport({ scale: 1 })` gives `width` and `height`; `getTextContent()` gives `items`; `getAnnotations()` gives the annotations, passed to `sheetComments`.
  - `text` is built exactly as the tool's `extractTextFromPDF` builds it: for each page, `items.map(i => i.str).join(' ') + '\n'`, appended. The golden test holds this to the tool's output.
  - If a page, its viewport or its text cannot be read, the whole result is the `ok: false` object. If only `getAnnotations` fails, that page has no comments and no mark-up. If `getMetadata` fails, `info` is `{ Creator: '', Producer: '' }`.
  - `info` holds `Creator` and `Producer` only, each a string or `''`. Nothing else from the metadata is kept.

- [ ] **Step 4: Run to see them pass.** Run: `node --test tests/pid-precheck.test.js`. Expected: 21 pass.

- [ ] **Step 5: Checkpoint.** Files: `assets/js/pid-precheck.js`, `tests/pid-precheck.test.js`. Message: `feat(pid): fetch the pre-check's facts from a pdf.js document`.

---

### Task 5: What the user sees, with all escaping

The producing program comes out of a PDF and the compared tags come out of a shared file, so the HTML is built here, where it is tested, and not in the tool.

**Files:**
- Modify: `assets/js/pid-precheck.js`
- Test: `tests/pid-precheck.test.js` (append)

**Interfaces:**
- Consumes: `esc(x) -> string` from `assets/js/pid-symbols-view.js`; `SheetCheck`, `STATUS_LABELS`, the result of `compareWithRegister` (Task 3).
- Produces:
  - `checkChipHtml(check) -> string`, the status as a chip.
  - `checkCellHtml(check) -> string`, the chip and the tag count, for the import dialog.
  - `checkHtml(check, compare?) -> string`, the chip, every finding and the comparison, for the Sheets tab.
  - `importSummary(checks) -> string`, plain text, for the line under the import dialog's table.

- [ ] **Step 1: Write the failing tests.** Append, adding `checkChipHtml, checkCellHtml, checkHtml, importSummary` to the module import, and:

```js
const check = async name => { const f = await read(SHEETS[name]); return assessSheet({ text: f.text, facts: f, extractOptions: OPTS }); };
```

```js
test('checkChipHtml and checkCellHtml: the status, with the findings on hover', async () => {
  const printed = await check('printed');
  assert.equal(checkChipHtml(printed), '<span class="pc-chip pc-none" title="No readable text: this PDF was printed, not plotted. Tags cannot be read. '
    + 'No DS310 tags found. Made with: Invented Printer. Sheet size: A1 landscape (841 × 594 mm).">No readable text</span>');
  assert.equal(checkCellHtml(printed), checkChipHtml(printed) + ' <span class="pc-note">No DS310 tags found.</span>');
  const plotted = await check('plotted');
  assert.ok(checkChipHtml(plotted).startsWith('<span class="pc-chip pc-readable" title="2 DS310 tags found. '));
  assert.ok(checkCellHtml(plotted).endsWith('>Readable</span> <span class="pc-note">2 DS310 tags found.</span>'));
  assert.ok(checkCellHtml(await check('commentsWithTags')).endsWith('>Readable from comments</span> <span class="pc-note">3 DS310 tags found, plus 1 for review.</span>'));
});

test('a sheet that could not be checked says so, in every view', () => {
  const chip = '<span class="pc-chip pc-unknown" title="This sheet could not be checked.">Not checked</span>';
  for (const bad of [null, undefined, 5, 'x', {}, { status: 'made-up' }, { status: 'constructor' }]) {
    assert.equal(checkChipHtml(bad), chip);
    assert.equal(checkCellHtml(bad), chip);
    assert.equal(checkHtml(bad, { same: true, nowCount: 3 }), '<div class="pc-line">' + chip + ' <span class="pc-finding">This sheet could not be checked.</span></div>');
  }
});

test('checkHtml: every finding, then how the tags read now compare with the register', async () => {
  const plotted = await check('plotted');
  assert.equal(checkHtml(plotted), '<div class="pc-line">' + checkChipHtml(plotted)
    + ' <span class="pc-finding">2 DS310 tags found.</span>'
    + ' <span class="pc-finding">1 more tag appears only in drawing comments and was not registered.</span>'
    + ' <span class="pc-finding">1 mark-up comment ignored.</span>'
    + ' <span class="pc-finding">Made with: Invented CAD 1.0 / Invented Plotter (v2).</span>'
    + ' <span class="pc-finding">Sheet size: A1 landscape (841 × 594 mm), 2 pages.</span></div>');
  assert.ok(checkHtml(plotted, { same: true, nowCount: 2 }).endsWith(' <span class="pc-compare pc-same">Tags read now match the register (2).</span></div>'));
  const differ = { same: false, nowCount: 4, registerCount: 3, added: ['21-YY-1002', '21-YY-1014'], missing: ['21-ZZ-7000'], changed: ['21-XX-1001'] };
  assert.ok(checkHtml(plotted, differ).endsWith(' <span class="pc-compare pc-differ">Tags read now differ from the register: '
    + '2 not in the register (21-YY-1002, 21-YY-1014); 1 in the register but not read now (21-ZZ-7000); '
    + '1 changed between confirmed and review (21-XX-1001).</span></div>'));
  const many = { same: false, added: Array.from({ length: 12 }, (_, i) => '21-XX-' + (5000 + i)), missing: [], changed: [] };
  assert.ok(checkHtml(plotted, many).includes('12 not in the register (21-XX-5000, 21-XX-5001, 21-XX-5002, 21-XX-5003, 21-XX-5004, 21-XX-5005, 21-XX-5006, 21-XX-5007, 21-XX-5008, 21-XX-5009 and 2 more).'));
  for (const none of [null, undefined, 5, 'x']) assert.equal(checkHtml(plotted, none), checkHtml(plotted));
});

test('markup in the PDF metadata, a comment or a tag list is shown as text', async () => {
  const hostile = await check('hostile');
  const differ = { same: false, added: ['<img src=x onerror=alert(3)>'], missing: [], changed: [] };
  for (const html of [checkChipHtml(hostile), checkCellHtml(hostile), checkHtml(hostile, differ)]) {
    assert.ok(!/<(img|script|b)\b/i.test(html), html);
    assert.ok(!/title="[^"]*"[^>]*"/.test(html), 'an attribute was broken out of: ' + html);
  }
  assert.ok(checkHtml(hostile).includes('Made with: &lt;img src=x onerror=alert(1)&gt; / &quot;&gt;&lt;script&gt;alert(2)&lt;/script&gt;.'));
});

test('importSummary: says how many PDFs will be registered with no tags, and nothing when all read', async () => {
  const plotted = await check('plotted'), printed = await check('printed'), noTags = await check('commentsNoTags');
  assert.equal(importSummary([plotted, await check('commentsWithTags')]), '');
  assert.equal(importSummary([plotted, printed, noTags]), '1 of 3 PDFs has no readable text. 1 of 3 has readable text but no DS310 tags. Importing registers them with no tags.');
  assert.equal(importSummary([printed]), '1 of 1 PDF has no readable text. Importing registers it with no tags.');
  assert.equal(importSummary([printed, printed, null]), '2 of 3 PDFs have no readable text. 1 of 3 could not be checked. Importing registers them with no tags.');
  assert.equal(importSummary([null, undefined]), '2 of 2 could not be checked.');
  for (const bad of [undefined, null, 5, {}, []]) assert.equal(importSummary(bad), '');
});
```

- [ ] **Step 2: Run to see them fail.** Run: `node --test tests/pid-precheck.test.js`. Expected: the 5 new tests FAIL, `checkChipHtml` is not exported.

- [ ] **Step 3: Implement.** Every value that came from a PDF or from the register goes through `esc`. Rules the tests do not fully determine:
  - A check is usable when it is an object whose `status` is an own key of `STATUS_LABELS` (so `'constructor'` is not). Anything else is "not checked".
  - `checkChipHtml`: class `pc-chip pc-<status>`, `title` the findings joined by one space, text the status label. Not checked: class `pc-chip pc-unknown`, title `This sheet could not be checked.`, text `Not checked`.
  - `checkCellHtml`: the chip, a space, then finding 3 of Task 3 (the tags sentence) in a `pc-note` span. Not checked: the chip alone.
  - `checkHtml`: a `pc-line` div holding the chip, then each finding in a `pc-finding` span preceded by a space, then the comparison. `compare` that is not an object adds nothing. `compare.same === true`: a `pc-compare pc-same` span. Otherwise a `pc-compare pc-differ` span whose text is `Tags read now differ from the register: ` then, for each of `added`, `missing` and `changed` that is not empty, its count, its phrase and its tags in brackets, joined by `; `, then a full stop. The phrases are `not in the register`, `in the register but not read now` and `changed between confirmed and review`. At most ten tags are listed, then ` and N more`.
  - `importSummary`: over the list, count the usable checks with status `none`, the usable checks with any other status and no tags at all (confirmed plus review), and the entries that are not usable. Sentences in that order, each only when its count is above 0, joined by one space, then `Importing registers it with no tags.` or `…them…` when the first two counts sum to 1 or more. `PDF` is singular only when the list has one entry. A list that is not an array gives `''`.

- [ ] **Step 4: Run to see them pass.** Run: `node --test tests/pid-precheck.test.js`. Expected: 26 pass.

- [ ] **Step 5: Checkpoint.** Run `npm test`: 766 tests, 764 passing, 0 failing, 2 skipped. Files: `assets/js/pid-precheck.js`, `tests/pid-precheck.test.js`. Message: `feat(pid): pre-check findings as escaped HTML`.

---

### Task 6: Gate 2 script, and the go/no-go on the three test drawings

Done before the tool is edited, so a wrong status shows now.

**Files:**
- Create: `scripts/check-sheet-prechecks.mjs`
- Test: `tests/check-sheet-prechecks.test.js`

**Interfaces:**
- Consumes: `openPdf`; `extractTags`; `readSheetFacts`, `assessSheet`, `tagsToRegister`, `STATUS_LABELS`.
- Produces (exported for tests): `checkPdf(data: Uint8Array, extractOptions?) -> Promise<{ ok: false } | { ok: true, check, textResult, registers, unchanged: boolean }>`, `parseExpect(arg) -> string[] | null`, `mismatches(statuses, expect) -> [{ index, got, want }]`.

- [ ] **Step 1: Write the failing tests** in `tests/check-sheet-prechecks.test.js`.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkPdf, parseExpect, mismatches } from '../scripts/check-sheet-prechecks.mjs';
import { sheetPdf, SHEETS } from './fixtures/sheet-pdf.js';

const SCRIPT = fileURLToPath(new URL('../scripts/check-sheet-prechecks.mjs', import.meta.url));
const run = args => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

test('parseExpect and mismatches: statuses in file order', () => {
  assert.deepEqual(parseExpect('readable, None,comments'), ['readable', 'none', 'comments']);
  for (const bad of ['readable,maybe', '', '  ', undefined, null, 5, 'constructor']) assert.equal(parseExpect(bad), null);
  assert.deepEqual(mismatches(['readable', 'none', 'comments'], ['readable', 'none', 'comments']), []);
  assert.deepEqual(mismatches(['readable', null, 'none'], ['readable', 'none', 'comments']),
    [{ index: 1, got: null, want: 'none' }, { index: 2, got: 'none', want: 'comments' }]);
  assert.deepEqual(mismatches(null, ['none']), [{ index: 0, got: null, want: 'none' }]);
});

test('checkPdf: what today\'s import registers beside what the pre-check registers', async () => {
  const count = r => [r.confirmed.length, r.review.length];
  const plotted = await checkPdf(sheetPdf(SHEETS.plotted));
  assert.deepEqual([plotted.ok, plotted.check.status, plotted.unchanged, count(plotted.registers)], [true, 'readable', true, [2, 0]]);
  const printed = await checkPdf(sheetPdf(SHEETS.printed));
  assert.deepEqual([printed.check.status, printed.unchanged, count(printed.registers)], ['none', true, [0, 0]]);
  const fromComments = await checkPdf(sheetPdf(SHEETS.commentsWithTags));
  assert.deepEqual([fromComments.check.status, fromComments.unchanged, count(fromComments.textResult), count(fromComments.registers)], ['comments', false, [0, 0], [3, 1]]);
  assert.equal((await checkPdf(sheetPdf(SHEETS.commentsNoTags))).unchanged, true);
});

test('checkPdf: bytes that are not a PDF give ok false, without throwing', async () => {
  assert.deepEqual(await checkPdf(Uint8Array.from('not a pdf', ch => ch.charCodeAt(0))), { ok: false });
  assert.deepEqual(await checkPdf(null), { ok: false });
});

test('the command line: passes only when every PDF has the status expected of it', () => {
  // Written to the system temp folder, never into the repository.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-precheck-'));
  try {
    const file = name => { const f = path.join(dir, name + '.pdf'); fs.writeFileSync(f, sheetPdf(SHEETS[name])); return f; };
    const three = [file('plotted'), file('printed'), file('commentsNoTags')];
    const good = run([...three, '--expect', 'readable,none,comments']);
    assert.equal(good.status, 0, good.stderr);
    assert.match(good.stdout, /3 of 3 as expected/);
    assert.match(good.stdout, /with the pre-check it registers: 2 confirmed, 0 for review \(the same as today\)/);
    const wrong = run([...three, '--expect', 'readable,none,readable']);
    assert.equal(wrong.status, 1);
    assert.match(wrong.stderr, /commentsNoTags\.pdf: got comments, expected readable/);
    assert.equal(run([...three, '--expect', 'readable,none']).status, 1);
    assert.equal(run([]).status, 1);
    const missing = run([path.join(dir, 'absent.pdf')]);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /Could not read .*absent\.pdf\./);
    assert.doesNotMatch(missing.stderr, /\n\s+at /);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run to see them fail.** Run: `node --test tests/check-sheet-prechecks.test.js`. Expected: FAIL, module not found.

- [ ] **Step 3: Write `scripts/check-sheet-prechecks.mjs`** in the shape of `scripts/check-symbol-import.mjs`: a header comment saying it is not part of `npm test` and why (it reads client drawings that cannot live in this repository), exported helpers, a `main()` behind the same `isMain` test. Behaviour:

```
node scripts/check-sheet-prechecks.mjs <pdf> [<pdf> ...] [--expect readable,none,comments]
```

  - `checkPdf` opens the bytes with `openPdf`, reads them with `readSheetFacts`, then `textResult = extractTags(facts.text, opts)`, `check = assessSheet({ text: facts.text, facts, extractOptions: opts })`, `registers = tagsToRegister(textResult, check)`, `unchanged = registers === textResult`. `opts` defaults to `{ drawingName: 'CHECK', revision: '', lookups: {} }`: tag counts do not depend on the lookup tables, which stay in the tool. Any failure gives `{ ok: false }`.
  - `parseExpect` splits on commas, trims and lower-cases; any word that is not an own key of `STATUS_LABELS` makes the whole result `null`. `mismatches` compares position by position over the longer of the two lists, with `null` for a missing entry.
  - No arguments prints the usage line and exits 1. A file that cannot be read prints `Could not read <path>.`; bytes that are not a PDF print `<path> could not be read as a PDF.`; both exit 1 and carry on to the next file. No stack traces.
  - Per PDF, print: the file's base name; the status label; `text items N, drawing comments N, other mark-up N`; `today's import registers: N confirmed, N for review`; `with the pre-check it registers: N confirmed, N for review (the same as today)` or `(CHANGED: read from drawing comments)`; then each finding. **Tags themselves are never printed.**
  - If a PDF whose text layer gives any tag has `unchanged === false`, print `FAULT: this drawing reads from its text layer today and would register something different. Stop and report this.` and exit 1. It cannot happen while Task 3's golden tests pass; the script checks anyway.
  - With `--expect`: a word count that differs from the number of PDFs, or an unknown word, prints one sentence naming the three allowed words and exits 1 before reading anything. Otherwise print `N of N as expected`, then `<base name>: got <status>, expected <status>` for each mismatch, and exit 1 if there is any.

- [ ] **Step 4: Run to see the tests pass.** Run: `node --test tests/check-sheet-prechecks.test.js`. Expected: 4 pass.

- [ ] **Step 5: Run Gate 2's first half on the real drawings.** This reads files outside the repository and writes nothing.

Run: `node scripts/check-sheet-prechecks.mjs "../pid-symbol-spike/test-drawing-A.pdf" "../pid-symbol-spike/test-drawing-B.pdf" "../pid-symbol-spike/test-drawing-C.pdf" --expect readable,none,comments`

Expected, from the planning measurement:

| | Status | Text items | Drawing comments | Other mark-up | Registers today | Registers with the pre-check |
|---|---|---|---|---|---|---|
| A | Readable | 330 | 25 | 0 | 71 confirmed, 0 review | 71 confirmed, 0 review (the same as today) |
| B | No readable text | 0 | 0 | 0 | 0, 0 | 0, 0 (the same as today) |
| C | Readable from comments | 43 | 47 | 0 | 0, 0 | 0, 0 (the same as today) |

and `3 of 3 as expected`, exit code 0. A and B are A1 landscape, C is A3 landscape. B is `Made with: Microsoft: Print To PDF.`

**Go:** all three statuses as expected and all three "the same as today". Record the numbers you got in the task report whether or not they match the table.

**No-go:** any status differs, or any line says CHANGED or FAULT. Stop and report the output. Do not adjust the status rule or the comment filter to make a drawing pass. Tasks 7 to 9 do not start.

- [ ] **Step 6: Checkpoint.** Run `npm test`: 770 tests, 768 passing, 0 failing, 2 skipped. Files: `scripts/check-sheet-prechecks.mjs`, `tests/check-sheet-prechecks.test.js`. Message: `feat(pid): local-only Gate 2 check for the sheet pre-checks`.

---

### Task 7: Wire the pre-check into the import

**Files:**
- Modify: `tools-src/pid-tag-register.html` (gitignored), by anchored patch only.
- Create, in the workspace `.superpowers/sdd/2026-11-14-pid-sheet-prechecks/` (gitignored): `pid-tag-register.before-prechecks.html`, `tool-facts.mjs`, `patch.mjs`, `edits-import.mjs`.

**Interfaces:**
- Consumes: `readSheetFacts`, `assessSheet`, `tagsToRegister`, `checkCellHtml`, `importSummary`, reached as `window.PidPrecheck`; from the tool, `pdfjsLib`, `extractTextFromPDF`, `PidCore.extractTags`, `FC_LOOKUP`, `FC_DESCRIPTIONS`, `pdfKey`, `showRevModal`, `confirmRevModal`.
- Produces, as globals in the tool's classic script: `sheetChecks` (object keyed by `pdfKey(drawing, revision)`), `sheetFactsFor(arrayBuffer) -> Promise<SheetFacts | null>`, `sheetCheckFrom(text, facts, drawingName, revision) -> SheetCheck | null`, and the marker line `// (end of sheet pre-checks)` that Task 8 patches against.

- [ ] **Step 1: Back up the tool and record the before-state.**

```bash
mkdir -p .superpowers/sdd/2026-11-14-pid-sheet-prechecks
cp tools-src/pid-tag-register.html .superpowers/sdd/2026-11-14-pid-sheet-prechecks/pid-tag-register.before-prechecks.html
```

Write `.superpowers/sdd/2026-11-14-pid-sheet-prechecks/tool-facts.mjs`:

```js
// Prints the facts about the tool that the pre-check work must leave exactly as they are.
// Run from the repository root.
import fs from 'node:fs';
import crypto from 'node:crypto';
const s = fs.readFileSync('tools-src/pid-tag-register.html', 'utf8');
const sha = x => crypto.createHash('sha256').update(x).digest('hex').slice(0, 16);
const cut = (from, to) => { const a = s.indexOf(from), b = s.indexOf(to, a); return a < 0 || b < 0 ? 'NOT FOUND' : s.slice(a, b); };
const count = re => (s.match(re) || []).length;
console.log('lines', s.split('\n').length - 1);
console.log('register.json mentions', count(/register\.json/g));
console.log('extractTextFromPDF', sha(cut('async function extractTextFromPDF(arrayBuffer) {', '// CLASH DETECTION')));
console.log('save path', sha(cut('function mergeState(disk) {', 'function updateFolderChip(')));
console.log('read and connect path', sha(cut('async function readRegisterJSON() {', 'function mergeState(disk) {')));
console.log('calls: scheduleSave', count(/scheduleSave\(\)/g), 'saveToFolder', count(/saveToFolder\(\)/g), 'snapshotRev', count(/snapshotRev\(/g), 'createWritable', count(/createWritable\(/g));
const pre = cut('// SHEET PRE-CHECKS', '// SYMBOLS\n');
if (pre !== 'NOT FOUND') console.log('save-path names inside the pre-check section',
  (pre.match(/saveToFolder|scheduleSave|mergeState|buildRegisterState|snapshotRev|createWritable|register\.json|allTags\s*=|revHistory\[[^\]]*\]\s*=|drawings\[[^\]]*\]\s*=/g) || []).length);
```

Run: `node .superpowers/sdd/2026-11-14-pid-sheet-prechecks/tool-facts.mjs`. Expected, as measured on 2026-11-14:

```
lines 3976
register.json mentions 19
extractTextFromPDF b584963c9ad8e30c
save path e551e57fee77ca78
read and connect path 284cb06b07a5f2f0
calls: scheduleSave 6 saveToFolder 4 snapshotRev 2 createWritable 4
```

Save the output as `facts-before.txt` in the workspace. If any value differs, the tool has changed since this plan was written: stop and report before patching.

- [ ] **Step 2: Write the patcher**, `.superpowers/sdd/2026-11-14-pid-sheet-prechecks/patch.mjs`. All or nothing: every `find` must occur exactly once or nothing is written.

```js
// Usage, from the repository root: node .superpowers/sdd/2026-11-14-pid-sheet-prechecks/patch.mjs <edits.mjs>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const TOOL = 'tools-src/pid-tag-register.html';
const { EDITS } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
let s = fs.readFileSync(TOOL, 'utf8');
const times = e => s.split(e.find).length - 1;
const bad = EDITS.filter(e => times(e) !== 1).map(e => `${e.name}: found ${times(e)} times, expected 1`);
if (bad.length) { console.error('Nothing written.\n' + bad.join('\n')); process.exit(1); }
for (const e of EDITS) s = s.replace(e.find, () => e.replace);
fs.writeFileSync(TOOL, s);
console.log(`Applied ${EDITS.length} edits.`);
```

- [ ] **Step 3: Write the edit list**, `.superpowers/sdd/2026-11-14-pid-sheet-prechecks/edits-import.mjs`. Given in full: it is glue with no tests to determine it, and the patch needs exact text. The file has LF line endings; keep them.

```js
const r = String.raw;
const TH = 'style="position:sticky;top:0;background:var(--bg3);z-index:1"';

const GLUE = r`// SHEET PRE-CHECKS
// Can this PDF's tags be read at all, and from where? assets/js/pid-precheck.js
// decides; the code here only fetches from pdf.js and puts the answer on screen.
// ─────────────────────────────────────────────────────────────────────────────
// pdfKey(drawing, revision) -> the check for that PDF. Memory only: working
// notes for this session, never part of what is written to the folder.
let sheetChecks = {};

// Reads the facts the pre-check needs. Never throws; null means "could not be
// checked". pdf.js empties the buffer it is given, so pass one you do not need back.
async function sheetFactsFor(arrayBuffer) {
  try {
    const P = window.PidPrecheck;
    if (!P || !P.readSheetFacts) return null;
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const facts = await P.readSheetFacts(pdf);
    return facts && facts.ok ? facts : null;
  } catch (e) { console.error('sheet pre-check: could not read the PDF', e); return null; }
}

// text is always what extractTextFromPDF gave, so the pre-check judges exactly
// what the import reads. Never throws; null means "not checked".
function sheetCheckFrom(text, facts, drawingName, revision) {
  try {
    const P = window.PidPrecheck;
    if (!P || !P.assessSheet || !facts) return null;
    return P.assessSheet({ text: text, facts: facts,
      extractOptions: { drawingName: drawingName, revision: revision, lookups: { fc: FC_LOOKUP, fcDescriptions: FC_DESCRIPTIONS } } });
  } catch (e) { console.error('sheet pre-check failed', e); return null; }
}

function sheetCheckCell(check) {
  const P = window.PidPrecheck;
  return (P && P.checkCellHtml) ? P.checkCellHtml(check) : '';
}

function renderImportSummary(files) {
  const el = document.getElementById('rev-precheck-summary');
  const P = window.PidPrecheck;
  if (!el) return;
  el.textContent = (P && P.importSummary) ? P.importSummary(files.map(function(f) { return f._sheetCheck; })) : '';
}
// (end of sheet pre-checks)

// ─────────────────────────────────────────────────────────────────────────────
// SYMBOLS
`;

export const EDITS = [
  { name: 'module import',
    find: r`  window.PidSymbols = Object.assign({}, PidSymbolsCore, PidSymbolsView, PidSymbolStore);
`,
    replace: r`  window.PidSymbols = Object.assign({}, PidSymbolsCore, PidSymbolsView, PidSymbolStore);
  // Sheet pre-checks: can this PDF's tags be read at all, and from where.
  import * as PidPrecheck from '/assets/js/pid-precheck.js';
  window.PidPrecheck = PidPrecheck;
` },
  { name: 'styles',
    find: r`  #sheet-msg { flex: 1;`,
    replace: r`  /* Sheet pre-checks: assets/js/pid-precheck.js builds the markup */
  .pc-line { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; }
  .pc-chip { font-size: 0.75rem; font-weight: 700; border-radius: 10px; padding: 2px 8px; white-space: nowrap; }
  .pc-readable { color: var(--green); background: color-mix(in srgb, var(--green) 14%, transparent); }
  .pc-comments { color: var(--amber); background: var(--amber-soft); }
  .pc-none { color: var(--red); background: color-mix(in srgb, var(--red) 14%, transparent); }
  .pc-unknown { color: var(--tmut); background: var(--bg2); }
  .pc-same { color: var(--green); }
  .pc-differ { color: var(--red); font-weight: 600; }
  .rev-table .td-precheck { font-size: 0.85rem; color: var(--tmut); }
  #rev-precheck-summary:not(:empty) { margin-top: 12px; font-size: 0.9rem; font-weight: 600; color: var(--amber); }
  #sheet-check:not(:empty) { padding: 8px 16px; border-bottom: 1px solid var(--border); font-size: 0.85rem; color: var(--tmut); }
  #sheet-msg { flex: 1;` },
  { name: 'dialog column heading',
    find: 'z-index:1">Drawing date</th></tr></thead>',
    replace: 'z-index:1">Drawing date</th><th ' + TH + '>Readable?</th></tr></thead>' },
  { name: 'dialog summary line',
    find: r`    <div class="modal-actions">
      <button class="btn btn-red" onclick="cancelRevModal()">Cancel</button>
`,
    replace: r`    <div id="rev-precheck-summary" role="status"></div>
    <div class="modal-actions">
      <button class="btn btn-red" onclick="cancelRevModal()">Cancel</button>
` },
  { name: 'read the facts when the dialog opens',
    find: r`      file._cachedText = text;
`,
    replace: r`      file._cachedText = text;
      // Sheet pre-check: a second, separate read of the same file. It never
      // throws and never changes the text above.
      file._sheetFacts = await sheetFactsFor(await file.arrayBuffer());
      file._sheetCheck = sheetCheckFrom(text, file._sheetFacts, name, detected || '');
` },
  { name: 'dialog cell',
    find: r`'title="Revision date from the drawing border" style="width:110px;text-transform:none"/></td>';
`,
    replace: r`'title="Revision date from the drawing border" style="width:110px;text-transform:none"/></td>' +
      '<td class="td-precheck">' + sheetCheckCell(file._sheetCheck) + '</td>';
` },
  { name: 'dialog summary',
    find: r`  setProgress(100, '');
  document.getElementById('rev-overlay').classList.add('visible');
`,
    replace: r`  setProgress(100, '');
  renderImportSummary(files);
  document.getElementById('rev-overlay').classList.add('visible');
` },
  { name: 'name the text result',
    find: r`      const result = PidCore.extractTags(text, {
`,
    replace: r`      const textResult = PidCore.extractTags(text, {
` },
  { name: 'choose what to register',
    find: r`        lookups: { fc: FC_LOOKUP, fcDescriptions: FC_DESCRIPTIONS },
      });
      drawings[drawingName] = {
`,
    replace: r`        lookups: { fc: FC_LOOKUP, fcDescriptions: FC_DESCRIPTIONS },
      });
      // Sheet pre-check (assets/js/pid-precheck.js). It changes what is
      // registered in ONE case only: the text layer gave no tags at all and the
      // drawing's own comments did. For every other drawing tagsToRegister
      // hands back textResult itself, so the lines below see what they always saw.
      const sheetCheck = sheetCheckFrom(text, file._sheetFacts, drawingName, revision);
      const result = (window.PidPrecheck && window.PidPrecheck.tagsToRegister)
        ? window.PidPrecheck.tagsToRegister(textResult, sheetCheck) : textResult;
      sheetChecks[pdfKey(drawingName, revision)] = sheetCheck;
      drawings[drawingName] = {
` },
  { name: 'glue section',
    find: '// SYMBOLS\n',
    replace: GLUE },
];
```

What the nine edits to existing code do, so a reviewer can hold them against the list above: the module import; the styles; a "Readable?" column and a summary line in the "Confirm revisions" dialog; two lines that read the facts where the dialog already reads the title block; one cell per row; one call to fill the summary; `result` renamed to `textResult` at the one place it is assigned; and three statements, under a four-line comment, that pick what to register. The tenth adds the glue section above the Symbols section. The check is worked out twice on purpose: once when the dialog opens, with the detected revision, for display; and again at import, with the revision the user confirmed, because the registered rows carry it. The second time reuses the stored facts and does not read the PDF again.

- [ ] **Step 4: Apply it.** Run: `node .superpowers/sdd/2026-11-14-pid-sheet-prechecks/patch.mjs .superpowers/sdd/2026-11-14-pid-sheet-prechecks/edits-import.mjs`. Expected: `Applied 10 edits.` If it prints "Nothing written", the tool is untouched: report which anchor failed and stop.

- [ ] **Step 5: Check the tool still parses.** Write the largest classic `<script>` body to a temp file and run `node --check` on it, as Task 10 of the phase 1 plan did:

```bash
node -e "
const fs=require('fs');
const s=fs.readFileSync('tools-src/pid-tag-register.html','utf8');
const m=[...s.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]).sort((a,b)=>b.length-a.length)[0];
fs.writeFileSync(process.env.TEMP+'/pid-check.cjs', m);
" && node --check "$TEMP/pid-check.cjs" && echo "SYNTAX OK"
```

Expected: `SYNTAX OK`.

- [ ] **Step 6: Prove what was not touched.** Run `tool-facts.mjs` again and save the output as `facts-after-import.txt`. Expected: `extractTextFromPDF`, `save path`, `read and connect path`, `register.json mentions` and the four call counts **identical to Step 1**; `lines` is now 4051; and a new last line, `save-path names inside the pre-check section 0`. Then run `diff` between the backup and the tool and confirm every changed hunk is one of the ten edits.

- [ ] **Step 7: Run the suite.** Run: `npm test`. Expected: 770 tests, 768 passing, 0 failing, 2 skipped. `tests/escaping-audit.test.js` reads this file and must still pass.

- [ ] **Step 8: Checkpoint.** Nothing tracked changed. Message if the owner has asked for commits: `git commit --allow-empty -m "feat(pid): sheet pre-check at import (source in gitignored tools-src/)"`.

---

### Task 8: Show the check on each sheet in the Sheets tab

Read-only. Opening a sheet reads its PDF again as an import would and compares the result with what the register holds. It changes no tags and saves nothing.

**Files:**
- Modify: `tools-src/pid-tag-register.html` (gitignored), by anchored patch.
- Create in the workspace: `edits-sheets.mjs`.

**Interfaces:**
- Consumes: `sheetChecks`, `sheetFactsFor`, `sheetCheckFrom` and the marker line from Task 7; `checkChipHtml`, `checkHtml`, `compareWithRegister` on `window.PidPrecheck`; from the tool, `viewSheet`, `renderSheetsList`, `extractTextFromPDF`, `revHistory`, `viewer`, `currentTab`, `pdfKey`.
- Produces: nothing other tasks rely on.

- [ ] **Step 1: Write the edit list**, `.superpowers/sdd/2026-11-14-pid-sheet-prechecks/edits-sheets.mjs`.

```js
const r = String.raw;

export const EDITS = [
  { name: 'line under the Sheets toolbar',
    find: r`          <div id="sheet-scroll" style="display:none">`,
    replace: r`          <div id="sheet-check" role="status"></div>
          <div id="sheet-scroll" style="display:none">` },
  { name: 'clear it when another sheet is opened',
    find: r`  document.getElementById('sheet-page-label').textContent = '';
  const scroll = document.getElementById('sheet-scroll');
`,
    replace: r`  document.getElementById('sheet-page-label').textContent = '';
  clearSheetCheck();
  const scroll = document.getElementById('sheet-scroll');
` },
  { name: 'show it when the sheet opens',
    find: r`    viewer.numPages = viewer.pdf.numPages;
    await renderSheetPage();
`,
    replace: r`    viewer.numPages = viewer.pdf.numPages;
    // Not awaited, and started before the page is drawn: the check does not
    // depend on the render, and it reports its own failures.
    showSheetCheck(drawingName, viewer.rev, data);
    await renderSheetPage();
` },
  { name: 'chip on the sheet card',
    find: r`'<div class="sheet-card-meta">' + drawings[name].count + ' tags <span`,
    replace: r`'<div class="sheet-card-meta">' + sheetCheckChip(name, cur) + drawings[name].count + ' tags <span` },
  { name: 'glue',
    find: '// (end of sheet pre-checks)\n',
    replace: r`function sheetCheckChip(name, rev) {
  const P = window.PidPrecheck, check = sheetChecks[pdfKey(name, rev)];
  return (P && P.checkChipHtml && check) ? P.checkChipHtml(check) + ' ' : '';
}

function clearSheetCheck() {
  const el = document.getElementById('sheet-check');
  if (el) el.innerHTML = '';
}

// The line under the Sheets toolbar. READ-ONLY: it reads the PDF again exactly
// as an import would and compares the answer with what the register already
// holds. It changes no tags and writes nothing to the folder.
async function showSheetCheck(drawingName, rev, data) {
  const el = document.getElementById('sheet-check');
  const P = window.PidPrecheck;
  if (!el || !P || !P.checkHtml) return;
  try {
    const key = pdfKey(drawingName, rev);
    let check = sheetChecks[key], fresh = false;
    if (!check) {
      const text = await extractTextFromPDF(data.slice(0));
      check = sheetCheckFrom(text, await sheetFactsFor(data.slice(0)), drawingName, rev);
      if (check) { sheetChecks[key] = check; fresh = true; }
    }
    if (viewer.drawing !== drawingName || viewer.rev !== rev) return;   // the user has moved to another sheet
    const snap = (revHistory[drawingName] || {})[rev];
    const compare = (check && snap && P.compareWithRegister) ? P.compareWithRegister(check.result, snap.tags) : null;
    el.innerHTML = P.checkHtml(check, compare);
    if (fresh && currentTab === 'sheets') renderSheetsList();
  } catch (e) {
    console.error('sheet pre-check: could not show the check', e);
    el.textContent = 'This sheet could not be checked.';
  }
}
// (end of sheet pre-checks)
` },
];
```

- [ ] **Step 2: Apply it.** Run: `node .superpowers/sdd/2026-11-14-pid-sheet-prechecks/patch.mjs .superpowers/sdd/2026-11-14-pid-sheet-prechecks/edits-sheets.mjs`. Expected: `Applied 5 edits.`

- [ ] **Step 3: Check it parses and prove what was not touched.** Repeat Task 7 Steps 5 and 6, saving the facts as `facts-after-sheets.txt`. Expected: `SYNTAX OK`; the three hashes, `register.json mentions 19` and the four call counts identical to Task 7 Step 1; `lines 4091`; `save-path names inside the pre-check section 0`.

- [ ] **Step 4: Run the suite.** Run: `npm test`. Expected: 770 tests, 768 passing, 0 failing, 2 skipped.

- [ ] **Step 5: Checkpoint.** Nothing tracked changed. Message if the owner has asked for commits: `git commit --allow-empty -m "feat(pid): sheet pre-check shown in the Sheets tab (source in gitignored tools-src/)"`.

---

### Task 9: Verify in the browser, and hand over Gate 2

**Files:** none changed. Only invented PDFs are used by the agent. The three test drawings are the owner's to put through the tool: no session tool can set a file input, and they must not be served from the repository.

- [ ] **Step 1: Open the tool.** Start the preview server (`preview_start` with name `site`) and open `http://localhost:5050/tools-src/pid-tag-register.html`. No folder connected. The console has no errors, and `typeof window.PidPrecheck.assessSheet` is `'function'`.

- [ ] **Step 2: Put the six invented sheets through the import.** In the console:

```js
const m = await import('/tests/fixtures/sheet-pdf.js');
const mk = (key, name) => new File([m.sheetPdf(m.SHEETS[key])], name + '.pdf', { type: 'application/pdf' });
await handlePIDFiles([mk('plotted', 'INV-PLOTTED'), mk('printed', 'INV-PRINTED'), mk('commentsWithTags', 'INV-COMMENTS'),
  mk('commentsNoTags', 'INV-LABELS'), mk('printedWithMarkup', 'INV-MARKUP'), mk('hostile', 'INV-HOSTILE')]);
[...document.querySelectorAll('#rev-table-body .td-precheck')].map(td => td.textContent);
```

Expected, in order:
  1. `Readable 2 DS310 tags found.`
  2. `No readable text No DS310 tags found.`
  3. `Readable from comments 3 DS310 tags found, plus 1 for review.`
  4. `Readable from comments No DS310 tags found.`
  5. `No readable text No DS310 tags found.`
  6. `Readable from comments 1 DS310 tag found.`

`document.getElementById('rev-precheck-summary').textContent` is `2 of 6 PDFs have no readable text. 1 of 6 has readable text but no DS310 tags. Importing registers them with no tags.` `document.querySelectorAll('#rev-modal script, #rev-modal img, #rev-modal b').length` is `0`, and no alert appeared.

- [ ] **Step 3: Import them and compare with the record of today.** Two of the sheets have `REV A` in their title block, so set every revision the same first:

```js
document.querySelectorAll('.rev-input:not(.rev-date-input)').forEach(i => i.value = 'C01');
await confirmRevModal();
allTags.map(t => t.drawing + ' ' + t.tag + (t.isReview ? ' (review)' : ''));
```

Expected, exactly these seven in this order: `INV-PLOTTED 21-XX-1001`, `INV-PLOTTED 21-YY-1002`, `INV-COMMENTS 21-XX-3001`, `INV-COMMENTS 21-YY-3002`, `INV-COMMENTS 21-XX-3003`, `INV-COMMENTS 21-YY-3004 (review)`, `INV-HOSTILE 21-XX-4001`.

Held against `tests/fixtures/sheet-import-golden.json`: `plotted`, `printed`, `commentsNoTags` and `printedWithMarkup` register exactly what the unedited tool registered. `commentsWithTags` and `hostile` registered nothing before and now register the tags read from their comments. That is the whole change, and it is the intended one. Also confirm `Object.keys(drawings).length` is `6` and `JSON.stringify(drawings['INV-PRINTED'])` is `{"revision":"C01","count":0,"warning":"NO TAGS FOUND - may be scanned PDF"}`, as today.

- [ ] **Step 4: The Sheets tab.** `switchTab('sheets')`. `document.querySelectorAll('#sheet-list .pc-chip').length` is `6`. Define this helper, and use it wherever a later step says to open a sheet. It does **not** await `viewSheet`: in a pane that is not being painted, pdf.js never finishes drawing the page and the call would never return.

```js
const open = async name => { viewSheet(name, 'C01', ''); await new Promise(r => setTimeout(r, 1500)); return document.getElementById('sheet-check').textContent; };
```

  Open each of these and read what `open` returns:
  - `INV-COMMENTS`: contains `Readable from comments`, `Text read from drawing comments.`, `3 DS310 tags found, plus 1 for review.`, `Sheet size: A3 landscape (420 × 297 mm).` and `Tags read now match the register (4).`
  - `INV-PRINTED`: contains `No readable text: this PDF was printed, not plotted. Tags cannot be read.`, `Made with: Invented Printer.` and `Tags read now match the register (0).`
  - `INV-PLOTTED`: contains `1 more tag appears only in drawing comments and was not registered.`, `1 mark-up comment ignored.` and `Tags read now match the register (2).`
  - `INV-MARKUP`: contains `No readable text` and `2 mark-up comments ignored.`
  - `INV-HOSTILE`: `document.querySelectorAll('#sheet-check script, #sheet-check img, #sheet-list script, #sheet-list img').length` is `0`.

- [ ] **Step 5: A sheet not seen this session is checked when opened.** `sheetChecks = {}; renderSheetsList();` then `document.querySelectorAll('#sheet-list .pc-chip').length` is `0`. `await open('INV-COMMENTS')`: the line reads as in Step 4 and the count of chips is `1`.

- [ ] **Step 6: A difference from the register is reported.** `revHistory['INV-PLOTTED'].C01.tags.pop(); await open('INV-PLOTTED')`. Expected: the line contains `Tags read now differ from the register: 1 not in the register (21-YY-1002).` No folder is connected, so nothing was saved; reload the page to discard it.

- [ ] **Step 7: A failed check changes nothing.** After the reload, define `m` and `mk` again, then:

```js
const keep = window.PidPrecheck; window.PidPrecheck = undefined;
await handlePIDFiles([mk('plotted', 'INV-NOMODULE'), new File(['not a pdf'], 'INV-BAD.pdf')]);
[...document.querySelectorAll('#rev-table-body .td-precheck')].map(td => td.textContent);   // ['', '']
await confirmRevModal();
[allTags.map(t => t.tag), Object.keys(drawings)];
window.PidPrecheck = keep;
```

Expected: `[['21-XX-1001', '21-YY-1002'], ['INV-NOMODULE']]`. The broken file is skipped with an error in the console and no drawing is registered for it, exactly as the unedited tool behaves. Then, with the module restored, `await handlePIDFiles([new File(['not a pdf'], 'INV-BAD.pdf')])`: the cell reads `Not checked` and the summary `1 of 1 could not be checked.` Click Cancel (`cancelRevModal()`).

- [ ] **Step 8: Nothing new is saved, and opening a sheet saves nothing.** Reload, then use the browser's private file system so no dialog is needed:

```js
registerDir = await navigator.storage.getDirectory(); dirHandle = registerDir; connectMode = 'legacy';
const m = await import('/tests/fixtures/sheet-pdf.js');
const mk = (key, name) => new File([m.sheetPdf(m.SHEETS[key])], name + '.pdf', { type: 'application/pdf' });
await handlePIDFiles([mk('commentsWithTags', 'INV-COMMENTS'), mk('printed', 'INV-PRINTED')]);
document.querySelectorAll('.rev-input:not(.rev-date-input)').forEach(i => i.value = 'C01');
await confirmRevModal();
```

Wait three seconds for the save, then:

```js
const readState = async () => JSON.parse(await (await (await registerDir.getFileHandle('register.json')).getFile()).text());
const st = await readState();
[Object.keys(st), Object.keys(st.drawings['INV-COMMENTS']), Object.keys(st.revHistory['INV-COMMENTS'].C01),
 Object.keys(st.revHistory['INV-COMMENTS'].C01.tags[0]), st.revHistory['INV-COMMENTS'].C01.tags.length, /sheetCheck|precheck|pc-/.test(JSON.stringify(st))];
```

Expected: `['version','savedAt','drawings','tags','revHistory','deletions','famDeletions','families']`, `['revision','count','warning']`, `['importedAt','drawingDate','tags']`, `['tag','pac','fc','id','desc','type','isReview']`, `4`, `false`. These are the keys the unedited tool writes.

Then note `st.savedAt`, call `switchTab('sheets')`, define `open` as in Step 4, `await open('INV-COMMENTS')` and `await open('INV-PRINTED')` (each ends `Tags read now match the register` with 4 and 0), wait five seconds, and read the file again: `savedAt` is unchanged. Opening sheets did not write the register.

Clean up: `for (const n of ['register.json', 'archive', 'backups']) { try { await registerDir.removeEntry(n, { recursive: true }); } catch (e) {} }`, then reload.

- [ ] **Step 9: Final suite and status.** Run: `npm test`. Expected: 770 tests, 768 passing, 0 failing, 2 skipped. `git status --short` lists only: `assets/js/pid-precheck.js`, `scripts/check-sheet-prechecks.mjs`, `tests/pid-precheck.test.js`, `tests/check-sheet-prechecks.test.js`, `tests/fixtures/sheet-pdf.js`, `tests/fixtures/sheet-import-golden.json`, `tests/pdfjs-node.test.js` (modified) and this plan. Search those files for anything from a real drawing; expected: none.

- [ ] **Step 10: Write the hand-over.** Report every line of Steps 2 to 8 that did not behave as written, with what happened instead. Then state plainly:
  - the Gate 2 numbers from Task 6 Step 5, as you got them;
  - that the one case where the register ingests something new was exercised only with invented PDFs, because none of the three test drawings is of that kind;
  - that the three test drawings have been through the script but not through the tool;
  - that the real register has not been checked, and cannot be until the tool is published.

- [ ] **Step 11: The owner's part of Gate 2.** These cannot be done by an agent. Give them to him as written.

  **A. The three test drawings through the tool, on the laptop.** Nothing is saved, because no folder is connected.
  1. With the preview running, open `http://localhost:5050/tools-src/pid-tag-register.html` in your browser. Do not click **Connect folder**.
  2. Drag the three test drawings from `pid-symbol-spike` onto **Drop PDFs here**.
  3. The **Confirm revisions** box opens. Read the **Readable?** column. It should say: drawing A, "Readable" and "71 DS310 tags found."; drawing B, "No readable text" and "No DS310 tags found."; drawing C, "Readable from comments" and "No DS310 tags found."
  4. Under the table it should say: "1 of 3 PDFs has no readable text. 1 of 3 has readable text but no DS310 tags. Importing registers them with no tags."
  5. Click **Cancel**. Nothing has been registered.

  **B. Going live.** When you are content with A:
  1. In a terminal in `harveydeason-site`, run `node scripts/lock-tools.mjs` and type your workshop code when asked.
  2. Tell me to commit and push. The commit must carry `tools/` and the new files listed in Step 9, or the live tool will not find `pid-precheck.js`.

  **C. Existing drawings in the real register, on your work computer.** This reads; it does not import or change any tag.
  1. Open the P&ID Tag Register and click **Connect folder**. Choose the register folder as usual.
  2. Click **Sheets**.
  3. Click a drawing in the list and wait for the line under the toolbar.
  4. The line should end "Tags read now match the register" with a number. If it says "Tags read now differ from the register", copy the whole line.
  5. Do this for ten drawings, from different schemes and of different ages. Do not import anything first.
  6. Tell me how many of the ten matched, and paste any line that differed.

  Gate 2 passes when A reads as written and all ten in C match. A drawing in C that says "Readable from comments" with tags, or one that differs, is a finding: report it and import nothing more until it is understood.

---

## What this plan leaves for later

- **Saving the status with the drawing**, if the owner wants a chip on every sheet card without opening the sheet. See *Decisions* 3.
- **Highlighting a tag on a sheet read from comments.** Each comment's rectangle is already kept.
- **Reading the revision from a title block that exists only as comments.**
- **A script mode that compares a copied register folder in Node**, if the owner wants the real register checked before going live.
- **Phase 3.** The Check symbols button is to be available only when a sheet is "Readable"; `sheetChecks[pdfKey(drawing, revision)].status` is where it will read that.
- **Publishing.** The owner re-locks the tool with `scripts/lock-tools.mjs`. `assets/js/pid-precheck.js` must be pushed with it.

## Outcome (2026-11-14)

Executed in one session, with one independent review at the end. Nothing is committed and the tool has not been re-locked.

- **Tests:** 771 (baseline 736), 769 passing, 0 failing, 2 skipped. One more than planned: a test for formatting codes that take no semicolon, added after the review.
- **Record of today's behaviour:** the capture from the unedited tool in the browser equalled the Node prediction on all 6 invented sheets.
- **Gate 2, first half, by the Task 6 script:** A Readable (330 text items, 25 comments, 71 tags, the same as today), B No readable text (0, 0, 0), C Readable from comments (43 text items, 47 comments, 0 tags, the same as today). 3 of 3 as expected.
- **Tool:** 15 planned edits applied, then 2 more after the review. 4,099 lines (was 3,976). The text read, the save path and the read-and-connect path hash the same as before the work; `register.json` is still named 19 times; the counts of `scheduleSave`, `saveToFolder`, `snapshotRev` and `createWritable` are unchanged; the pre-check section names none of them. The backup of the tool as it was is in the workspace, `.superpowers/sdd/2026-11-14-pid-sheet-prechecks/pid-tag-register.before-prechecks.html`.
- **Browser, Task 9 Steps 1 to 8, on the real patched tool with invented sheets:** every value as written. Served from a throwaway static server on port 5177, because port 5050 was held by another session.
- **Review:** nothing critical. Two important findings, both fixed, and one item the reviewer set aside that was fixed as well:
  1. The module was imported statically beside `pid-core.js`. Had `pid-precheck.js` failed to load, `PidCore`, `PidComments` and `PidSymbols` would all have been missing and nothing could be imported. Reproduced by blocking the file. It is now loaded with a dynamic `import()` that is allowed to fail; with the file blocked the import registers what it did before. **This replaces the "module import" edit in Task 7.**
  2. `plainCommentText` left the codes for underline, overline and strike-through (`\L`, `\O`, `\K` and their lower-case ends) in the text, so a tag wrapped in one was lost. They are now stripped first.
  3. Each pdf.js document keeps a worker alive until it is destroyed, and the new read added one per imported PDF. `sheetFactsFor` now destroys its document once the facts are read (1 worker made, 1 ended). `extractTextFromPDF` is not edited and still leaves one per read, as it always has.
- **Deferred:** a late failure checking one sheet can write "could not be checked" over the next sheet's line; a cached check is refreshed only by an import; tags read from comments are registered as confirmed, and two adjacent comments can join into a false tag just as two text items can (the owner's call whether they should go to review); `\U+XXXX` is left in comment text and a stacked fraction is removed whole; nothing in `npm test` exercises the tool glue.
- **Seen and not fixed, because it is not new:** opening a second sheet while the first is still being drawn logs "Cannot use the same canvas during multiple render() operations". `renderSheetPage` is unedited and the tool behaved this way before.
- **Not yet checked:** the three test drawings through the tool, and the real register. Both are the owner's (Task 9 Step 11). A drawn page was never seen in the built-in browser, which delivers no animation frames; the status line was.
