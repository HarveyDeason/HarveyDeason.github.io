# P&ID symbol check, symbols first: phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Readable and "Readable from comments" sheet gets a list of every standard symbol found on it, with tags attached where they can be read, while no tag verdict on a Readable sheet changes for the worse.

**Architecture:** Today's tag-led `checkSheet` runs first, unchanged. A whole-sheet sweep (`sweepSymbols`) then finds every standard symbol, a shared-ink rule makes one entry per physical symbol, the tag-led pairings are merged in, and leftover tags may pair with a swept symbol of their own family. A new pure module, `pid-sheet-read.js`, turns a comment sheet into words and letter-free ink. Worker, view, report runner and report gain the symbol list.

**Tech Stack:** Vanilla ES modules, no build; `node --test`; pdf.js 3.11.174 (vendored); ExcelJS and pdf-lib already vendored for the report.

**Spec:** `docs/superpowers/specs/2026-11-16-pid-every-pdf-format-design.md` (approved 2026-11-16). Read its *Design* and *Phase 1 in full* sections before starting.

## Global Constraints

- **Nothing writes `register.json` or the register folder.** No new glue calls `saveToFolder`, `scheduleSave`, `mergeState`, `buildRegisterState`, `snapshotRev`, `createWritable` or `saveLibraryFile`.
- **The repository is public.** No client data (drawing numbers, real tags, legend names or geometry, firm names) in `assets/js/`, `scripts/`, `docs/`, `tests/` or fixtures. Tests use invented symbols; tags like `21-W-1001`.
- **Real sheets stay out of git:** `C:\Users\deaso\Downloads\` and `../pid-symbol-spike/`. Gate output with real tags goes only in `../pid-symbol-spike/every-format-gate/`.
- **No new dependency.** No OCR library.
- **`tools-src/` is gitignored.** Tool edits are anchored patches after a backup in `.superpowers/sdd/2026-11-16-pid-symbols-first/` (gitignored). Never run `scripts/lock-tools.mjs`; the owner does.
- **Do not commit unless the owner asks.** Each task's last step is a checkpoint: run the tests, and stage nothing.
- **The check keeps saying it confirms the family, not the member.** `FAMILY_NOTE` and `SHORT_NOTE` are unchanged.
- **Every new function degrades on hostile input** (never throws), as `pid-symbol-check.js` does today.
- **Values pinned by the spec:** letter box margin `1` pt; letter path cap `15` pt; sweep grid `80` pt; shared-ink share `0.5`; recognise `0.90`; `oneOf` `0.03`; `radius` `60`; time limit `120000` ms; gate time under `60` s a sheet.

## Review Focus

1. **A sheet with no tags at all** (the supplier sheet, or a comment sheet whose comments hold no DS310 tag). Expected: the sweep still runs, the result is `ok: true` with `verdicts: []`, the screen reads "No tags read." with its symbol list, and the report lists the sheet as Checked. Tests in Tasks 5, 6, 7.
2. **A comment box far larger than a letter, lying over symbol linework** (sheet M has one 239 × 202 pt). Expected: only unfilled paths of 15 pt or less inside it are removed; a 16 pt line and any filled path survive. Test in Task 2.
3. **The time limit reached during the sweep.** Expected: `timedOut: true`, the symbols found so far are returned, every tag verdict already given stands, nothing throws. Test in Task 5.
4. **A page shown rotated, or with its title block along the bottom.** Expected: `titleBlockBox` finds a bottom strip as well as a right-hand one, in viewport coordinates, and nothing is swept inside it. Test in Task 4.
5. **A hostile or empty library** (NaN coordinates, a symbol of 5,000 segments, no symbols). Expected: those symbols are skipped by `prepareSymbols` as today; `sweepSymbols` returns an empty list, never throws. Test in Task 4.

---

## File map

| File | Change |
|---|---|
| `assets/js/pid-sheet-read.js` | **new.** Comment words, letter boxes, letter-ink removal. |
| `assets/js/pid-symbol-check.js` | `sharedInk`, `mergeHits`, `titleBlockBox`, `sweepSymbols`; `checkSheet` gains `symbols`, `skipped`, `pageSize`, progress stages, no-tags sweep; `matchBubble` and tag-led spots keep their placement. |
| `assets/js/pid-symbol-check-worker.js` | `words`, `comments`, `pageSize`, progress stage. |
| `assets/js/pid-symbol-check-view.js` | `blockerText`, `progressHtml` stage, `symbolSummary`, symbol list in `resultsHtml`, symbol and skipped boxes in `boxRects`. |
| `assets/js/pid-symbol-report-run.js` | `comments` status runs; status passed to `deps.check`; progress stage. |
| `assets/js/pid-symbol-report.js` | per-sheet `symbolLine`, `symbolRows`; Excel **Symbols** sheet; `PRINT_COLOURS.symbol`. |
| `assets/js/pid-symbol-report-pdf.js` | symbol line, untagged symbol boxes, key line. |
| `scripts/check-symbol-check.mjs` | `--words comments`, `pageSize`, symbols summary. |
| `tests/pid-sheet-read.test.js` | **new.** |
| `tests/fixtures/symbol-check-sheet.js` | `SIGNAL`, `SWEEP_LIBRARY`, `SWEEP_SHEET`. |
| `tests/pid-symbol-check.test.js`, `tests/pid-symbol-check-view.test.js`, `tests/pid-symbol-report-run.test.js`, `tests/pid-symbol-report.test.js`, `tests/pid-symbol-report-pdf.test.js` | new tests. |
| `tools-src/pid-tag-register.html` | glue only, anchored patch (gitignored). |

---

### Task 1: The gate baseline, before any change

**Files:** none tracked. Create `../pid-symbol-spike/every-format-gate/` (private).

The sheets are named only in private files: the three Plant 3D sheets are A, B and C in `../pid-symbol-spike/bubble-gate/README.txt`; sheet M is the "Readable from comments" contractor sheet and the supplier sheet is `../pid-symbol-spike/test-drawing-C.pdf`. The owner's session notes (`pdf-format-survey.md`) and the brainstorm name sheet M's file. This plan and every repo file use only the letters.

- [ ] **Step 1: Write `../pid-symbol-spike/every-format-gate/README.txt`** naming sheets A, B, C and M with their file paths in `C:\Users\deaso\Downloads\` (private folder; never copied into the repo).
- [ ] **Step 2: Run the current gate on sheets A, B and C and save it.** From `harveydeason-site`, for each:

```bash
node scripts/check-symbol-check.mjs "<sheet path>" --legend ../pid-symbol-spike/legend-sheets.pdf --instrument "PE,PT,FE,FIT,PIT,LIT,LE" --verbose > ../pid-symbol-spike/every-format-gate/<letter>-before.txt
```

Expected: three files; sheet C's shows `tags 71, located 71`, `V: 45 OK of 45`, `Wrong family: 0`. Never put these files' contents in a commit, doc or note.

- [ ] **Step 3: Note sheet M's baseline** in the README. The script cannot read comments yet; its baseline is the spec's probe result: 42/42 located, 40 of 40 non-tank OK, 2 tanks Not checked, 0 Wrong family.

---

### Task 2: Reading a comment sheet (`pid-sheet-read.js`)

**Files:**
- Create: `assets/js/pid-sheet-read.js`
- Test: `tests/pid-sheet-read.test.js`

**Interfaces:**
- Consumes: the `{ text, rect }` comments `sheetComments` returns (`pid-precheck.js`); `rect` is `[x0, y0, x1, y1]` in PDF user space or `null`.
- Produces:
  - `export const LETTER_MARGIN = 1; export const LETTER_MAX = 15;`
  - `commentWords(comments) -> TextItem[]`, where `TextItem = { str, transform: [h, 0, 0, h, x0, y0], width: w, height: h }`, `x0 = min(rect x)`, `y0 = min(rect y)`, `w = |x1 - x0|`, `h = max(1, |y1 - y0|)`. Comments with no text or no rectangle are left out.
  - `letterBoxes(comments, viewportTransform) -> Box[]`: each rectangle's two corners mapped through the transform, as a page-point box `[x0, y0, x1, y1]` grown by `LETTER_MARGIN` on every side. A missing or bad transform means identity.
  - `removeLetterInk(paths, boxes) -> { paths, removed }`: a path is dropped when it is not `filled === true`, its bounding box lies wholly inside one box, and its longer side is at most `LETTER_MAX`. Order of kept paths is preserved.

- [ ] **Step 1: Write the failing tests.**

```js
test('commentWords: a horizontal and a vertical comment become text items; no text or no rect is left out', () => {
  const w = R.commentWords([{ text: '21-W-1001', rect: [100, 200, 140, 208] }, { text: '21-W-1002', rect: [300, 100, 308, 150] },
    { text: '', rect: [0, 0, 5, 5] }, { text: 'X', rect: null }]);
  assert.deepEqual(w, [{ str: '21-W-1001', transform: [8, 0, 0, 8, 100, 200], width: 40, height: 8 },
    { str: '21-W-1002', transform: [50, 0, 0, 50, 300, 100], width: 8, height: 50 }]);
});
test('commentWords: tagPlaces finds a tag split across two comments', () => { /* two comments '21-W' and '1001' one above the other; C.tagPlaces(...) gives one place whose box spans both */ });
test('letterBoxes: corners through the viewport transform, grown by 1 pt', () => {
  assert.deepEqual(R.letterBoxes([{ text: 'A', rect: [10, 700, 14, 707] }], [1, 0, 0, -1, 0, 800]), [[9, 92, 15, 101]]);
});
test('removeLetterInk: whole-point rectangles, one-character boxes, big boxes, fills', () => {
  const box = [[1115, 1181, 1121, 1190]];                          // comment [1116,1182,1120,1189] grown by 1
  const digit = line([1116.4, 1181.2, 1120.2, 1188.3]);           // stands 0.3 pt out of the rounded rectangle
  const long = line([1000, 1000, 1016, 1000]);                    // 16 pt, inside a 239 x 202 box
  const filled = { ...line([1002, 1002, 1008, 1008]), filled: true };
  const outside = line([10, 10, 14, 14]);
  const r = R.removeLetterInk([digit, long, filled, outside], [...box, [990, 990, 1229, 1192]]);
  assert.equal(r.removed, 1); assert.deepEqual(r.paths, [long, filled, outside]);
});
test('removeLetterInk and friends never throw on rubbish', () => { /* null, numbers, NaN segs, boxes of 3 numbers: empty or unchanged output */ });
```

`line` and `C` (from `pid-symbol-check.js`) are imported the way `tests/pid-symbol-check.test.js` does; build `line` locally as `{ segs, width: 0.5, stroked: true, filled: false, grey: 0 }`.

- [ ] **Step 2: Run them to see them fail.** `node --test tests/pid-sheet-read.test.js` → FAIL, module not found.
- [ ] **Step 3: Implement `pid-sheet-read.js`** with the three functions and two constants above. Header comment in the house style: pure, no DOM, no pdf.js, no client data.
- [ ] **Step 4: Run them to see them pass.** `node --test tests/pid-sheet-read.test.js` → PASS.
- [ ] **Step 5: Checkpoint.** `npm test` → every test passes except the existing skips.

---

### Task 3: One symbol per patch of ink (`sharedInk`, `mergeHits`)

**Files:**
- Modify: `assets/js/pid-symbol-check.js` (new section `// ── One symbol per patch of ink`; `matchBubble` scored entries; tag-led `spot.best` entries)
- Modify: `tests/fixtures/symbol-check-sheet.js` (add `SIGNAL` and `SWEEP_LIBRARY`, below)
- Test: `tests/pid-symbol-check.test.js`

**Interfaces:**
- Consumes: `placePoint`, `rasterise`, `dilate`, `prepareSymbols` (existing).
- Produces:
  - `Hit = { p, placement, score, k, box, filled, bubble, ring, tag }`: `p` a prepared symbol, `placement` as `proposePlacements` gives (`{ o, k, tx, ty, cx, cy }`), `ring` the outline box for a bubble hit or `null`, `tag` a tag's text or `null`.
  - `sharedInk(a, b, options) -> number` in 0..1: the share of `a`'s sample points (`a.p.points` through `placePoint(a.placement, …)`) that land on `b`'s template drawn at `b.placement` and dilated by `inkTol`.
  - `mergeHits(hits, options) -> Spot[]`, `Spot = { matches: Hit[], box, cx, cy, bubble, ring, tag }`; `matches[0]` is the winner, the rest are its alternatives within `oneOf`.
  - `CHECK_DEFAULTS` gains `shareInk: 0.5`, `sweepStep: 80`.
  - Fixture: `SIGNAL = sym('s10', 'SIGNAL', 'SIGNALS', 'S', 30, 20, [...PENNANT, LEFT's paths, line([10, 5, 30, 5])])` (a pennant with a tail, so a PENNANT, LEFT hit on it is a part); `SWEEP_LIBRARY = { ...BUBBLE_LIBRARY, symbols: [...BUBBLE_LIBRARY.symbols, SIGNAL] }`. `LIBRARY` is not changed, so existing tests keep their library.
  - `matchBubble`'s `best` (and each scored entry) gains `placement`. Tag-led `spot.best` entries gain `placement: pl`.

Merge rules (the spec's step 4), applied greedily to hits sorted by score, highest first:

1. `a` and `b` are **alternatives** when `sharedInk(a, b) >= shareInk` and `sharedInk(b, a) >= shareInk`. The winner is the higher score; at scores within `oneOf`, the one with more `p.segs` wins. An alternative within `oneOf` of the winner joins `matches`; one further below is dropped.
2. `a` is a **part** of `b` when only `sharedInk(a, b) >= shareInk` and `a` has fewer `p.segs`: `a` is dropped, never listed.
3. A hit with a `tag` always wins its group, whatever its score; two hits that both carry tags are never merged.

- [ ] **Step 1: Write the failing tests** (using `LIBRARY` and `place` from the fixture):
  - `sharedInk`: a WIDGET hit against itself is ≥ 0.95; against a WIDGET 40 pt away is 0; PENNANT, LEFT placed on the same spot as PENNANT, RIGHT gives ≥ 0.5 both ways (mirror twins).
  - `mergeHits`: two WIDGET hits 1 pt apart → one spot; WIDGET and WIDGET, BARRED at the same place → WIDGET, BARRED wins (more segs) with WIDGET in `matches` only if within `oneOf`; `SIGNAL` with a PENNANT, LEFT hit on its pennant → one spot, `matches.length === 1`, name `SIGNAL`; a tagged hit with score 0.91 beats an untagged one at 0.99 on the same ink; two tagged hits on shared ink stay two spots; rubbish in → `[]`.
- [ ] **Step 2: Run to see them fail.** `node --test tests/pid-symbol-check.test.js` → FAIL (`sharedInk` not a function).
- [ ] **Step 3: Implement** `sharedInk` and `mergeHits`, add the two defaults, and add `placement` where the Interfaces say. No verdict changes.
- [ ] **Step 4: Run to see them pass,** and run `npm test`: every existing check test still passes unchanged.
- [ ] **Step 5: Checkpoint.**

---

### Task 4: The sweep (`titleBlockBox`, `sweepSymbols`)

**Files:**
- Modify: `assets/js/pid-symbol-check.js` (new section `// ── The sweep`)
- Modify: `tests/fixtures/symbol-check-sheet.js`
- Test: `tests/pid-symbol-check.test.js`

**Interfaces:**
- Consumes: `mergeHits`, `Hit` (Task 3); `proposePlacements`, `scorePlacement`, `drawingSegments`, `matchBubble`, `isClosedPath` (existing).
- Produces:
  - `titleBlockBox(paths, pageSize) -> Box | null`. Starting rule (tune on the gate): among ink lines at least 70% of the page height, in the right 40% of the page and at least 20 pt inside the outermost vertical of that kind, take the rightmost; the box runs from it to the page's right edge, full height. Failing that, the same for horizontal lines at least 70% of the page width in the bottom 40%, box to the bottom edge, full width. Otherwise `null`.
  - `sweepSymbols({ paths, library, pageSize, options, onProgress, deadline }) -> { spots: Spot[], skipped: Box | null, timedOut: boolean, rows: number }`. Internally a `sweep(ctx)` that `checkSheet` calls with its own `prepared`, `boxed` and `segments` (no second preparation).
  - Grid centres every `sweepStep` (80) pt from `sweepStep / 2`, across `pageSize`, skipping centres inside `skipped`. Each centre: segments within `radius + 40`, window from `windowFrom`, `proposePlacements` and `scorePlacement` for every checkable non-bubble symbol, hits at `recognise` or above. Bubbles: every closed single ink path whose box is between the smallest ring × `minScale` and the largest ring × `maxScale` is passed to `matchBubble`; its `best` is a hit with `bubble: true` and `ring` = that path's box. Hits whose centre is inside `skipped` are dropped. Then `mergeHits`.
  - `onProgress(row, rows, 'sweep')` after each grid row. Past `deadline` (a clock value), stop, merge what was found, `timedOut: true`.
- Fixture addition:
  - `SWEEP_SHEET = { pageSize: [600, 400], viewportTransform: [1, 0, 0, 1, 0, 0], paths, textItems: [], tags: [] }` with a frame (10 to 590 × 10 to 390), a title-block line at x = 500 from 10 to 390, and, untagged: WIDGET at (60, 60) drawn twice on the same spot; GADGET at (160, 60); SIGNAL at (260, 60); WIDGET turned 90° at (360, 60); RING bubble at (60, 200) with nothing inside; WIDGET at (520, 60), inside the title block.

- [ ] **Step 1: Write the failing tests.**
  - `titleBlockBox(SWEEP_SHEET.paths, [600, 400])` → `[500, 0, 600, 400]` (within 0.5); with the line moved to the bottom (y = 330, 10 to 590) → `[0, 330, 600, 400]`; with no such line → `null`.
  - `sweepSymbols` on `SWEEP_SHEET` with `SWEEP_LIBRARY`: spot names sorted are `['GADGET', 'RING', 'SIGNAL', 'WIDGET', 'WIDGET']` (the doubled WIDGET once, the turned one once, the one in the title block not at all); no spot is PENNANT, LEFT; `skipped` is the title block; `rows` is 5.
  - Progress: `onProgress` called with `(1, 5, 'sweep')` … `(5, 5, 'sweep')`.
  - Deadline in the past: `timedOut: true`, `spots: []`, no throw.
  - Hostile: `library` with `symbols: []`, `null`, or symbols of NaN segs; `paths: null`; `pageSize: [0, 0]` → `{ spots: [], timedOut: false }` or the same with `skipped: null`, never a throw.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement** `titleBlockBox`, `sweep` and `sweepSymbols`, and the fixture.
- [ ] **Step 4: Run to see them pass;** `npm test` all green.
- [ ] **Step 5: Checkpoint.**

---

### Task 5: `checkSheet` returns every symbol

**Files:**
- Modify: `assets/js/pid-symbol-check.js` (`checkSheet`)
- Test: `tests/pid-symbol-check.test.js`

**Interfaces:**
- Consumes: `sweep`, `mergeHits`, `titleBlockBox` (Tasks 3 and 4).
- Produces: `checkSheet(input)` where `input` gains `pageSize: [w, h]` (optional; without it, the page extent is the paths' bounding box) and `options.sweep` (`false` turns the sweep off, for comparison tests). The result gains:
  - `symbols: SymbolOut[]`, `SymbolOut = { name, tagId, box, sizePct, score, oneOf: string[], bubble, tag: string | null }`, ordered by name, then top, then left;
  - `skipped: Box | null`;
  - with no tags: `{ ok: true, verdicts: [], counts: all 0, checked: 0, recognised: 0, symbols, skipped, ... }` instead of `{ ok: false, why: 'no-tags' }`;
  - `onProgress(done, total, stage)`, with `stage` `'tags'` for today's calls and `'sweep'` for the sweep's.

Order inside `checkSheet` (the spec's "Pairing tags"):

1. Today's code, unchanged, down to the end of pass 2.
2. The sweep, with the same `prepared`, `boxed`, `segments`, `started + timeLimitMs` as deadline.
3. **Merge:** each tag-led claimed spot's winning match becomes a `Hit` with `tag` set to its tag; `mergeHits(sweepHits + taggedHits)`. A tagged hit with no swept twin stays as its own spot.
4. **Leftovers:** for each tag not done whose family mode is `check`, the nearest spot with `tag === null` within `radius` of any of its places whose `matches` carry its code (`p.codes`) gets it; the verdict is filled as `fill()` does today (`ok` or `off-size`), `letters` as `lettersRead` gives, and the spot's `tag` is set.
5. Today's "The rest" loop, unchanged.
6. Build `symbols` from the spots: name from `matches[0]`, `oneOf` = all match names when there is more than one, `tagId` from `matches[0].p.symbol.tagId`, `sizePct` and `score` as verdicts round them.

- [ ] **Step 1: Write the failing tests.**
  - **Goal 5 by construction:** for `SHEET` and `BUBBLE_SHEET`, `checkSheet({...})` and `checkSheet({..., options: { sweep: false }})` give deep-equal `verdicts` (compare `verdicts` only).
  - On `SHEET`: every verdict that is `ok` or `off-size` has exactly one symbol whose `tag` is its tag and whose `name` is its `symbol`; `symbols` with `tag: null` are only those the sheet draws without a tag.
  - On `SWEEP_SHEET` (no tags): `ok: true`, `verdicts: []`, five symbols, all `tag: null`, `skipped` the title block.
  - **Leftover:** an invented sheet where a WIDGET tag's place is 50 pt from a WIDGET whose key lines all lie more than 100 pt from the tag's centre, so today's proposals around the tag never see it (build it with a long WIDGET-coloured lead-in if needed, or give the tag-led search `options.radius` small and the sweep its default). Expected: today (`sweep: false`) `look`; with the sweep `ok`, and that symbol's `tag` set. If no honest invented sheet can show this, write the test against a stub of `sweep` instead and say so in the Outcome.
  - **Time limit in the sweep:** `options.timeLimitMs: 1` on `SHEET` → `timedOut: true`, `ok: true`, no throw; verdicts given before the limit stand.
  - Progress stages: the callback sees `'tags'` then `'sweep'`.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement** the order above. Keep today's code paths byte-for-byte where the order says "unchanged".
- [ ] **Step 4: Run to see them pass;** `npm test` all green, including every earlier check test.
- [ ] **Step 5: Checkpoint.**

---

### Task 6: Worker and screen

**Files:**
- Modify: `assets/js/pid-symbol-check-worker.js`, `assets/js/pid-symbol-check-view.js`
- Test: `tests/pid-symbol-check-view.test.js`

**Interfaces:**
- Consumes: `commentWords`, `letterBoxes`, `removeLetterInk` (Task 2); `checkSheet` result (Task 5).
- Produces:
  - Worker message adds `words: 'text' | 'comments'`, `comments`, `pageSize`. For `'comments'`: `paths = removeLetterInk(paths, letterBoxes(comments, viewportTransform)).paths`, `textItems = commentWords(comments)`. Otherwise as today. Progress posts `{ type: 'progress', done, total, stage }`.
  - `blockerText`: `comments` may be checked; `none` reads exactly `This sheet has no readable text: printed and scanned sheets cannot be checked yet.`
  - `progressHtml(done, total, stage)`: for `'sweep'`, `Looking for symbols: row N of M… ` + the Cancel button; otherwise as today.
  - `symbolSummary(result) -> string`: `'N standard symbols found, M with tags.'`; `'No standard symbols found.'` for zero; `''` when `result.symbols` is not an array.
  - `resultsHtml`: with `verdicts: []` the counts read `No tags read.`; the summary block adds `symbolSummary` and, when `skipped`, `Title block not checked.`; after the tag list, a heading `Symbols with no tag` and one row per untagged symbol, sorted by name: `<button type="button" class="sc-row sc-symbol" data-act="sym-jump-s" data-s="<index into result.symbols>">` holding the name, and `(one of: …)` when `oneOf` has more than one name. All text through `esc()`.
  - `boxRects`: also one rect per untagged symbol `{ s, kind: 'symbol', …, title: name + ': standard symbol, no tag.' }`, and one for `skipped` `{ kind: 'skipped', title: 'Title block not checked.' }`. Tag rects unchanged.

- [ ] **Step 1: Write the failing tests:** the `blockerText` sentence and `comments` allowed; `progressHtml(3, 5, 'sweep')` contains `Looking for symbols: row 3 of 5`; `symbolSummary` for 5 symbols with 2 tagged → `5 standard symbols found, 2 with tags.`; `resultsHtml` of a no-tags result contains `No tags read.`, `Title block not checked.` and five `data-act="sym-jump-s"` rows; a symbol named `<img src=x onerror=alert(1)>` comes out escaped; `boxRects` gives the symbol and skipped rects at the viewer scale with the same 3 px margin as tag rects. A worker test is not possible in node; Task 9 covers it in the browser.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to see them pass;** `npm test` green.
- [ ] **Step 5: Checkpoint.**

---

### Task 7: Report runner, Excel and PDF

**Files:**
- Modify: `assets/js/pid-symbol-report-run.js`, `assets/js/pid-symbol-report.js`, `assets/js/pid-symbol-report-pdf.js`
- Test: `tests/pid-symbol-report-run.test.js`, `tests/pid-symbol-report.test.js`, `tests/pid-symbol-report-pdf.test.js`

**Interfaces:**
- Consumes: `symbolSummary` (Task 6); `result.symbols`, `result.skipped` (Task 5).
- Produces:
  - `runReport`: status `comments` runs like `readable`; `deps.check(bytes, tags, onProgress, status)` (fourth argument new); progress objects gain `stage`; `notReadable(status)` reads `'Pre-check status is ' + label + ': printed and scanned sheets cannot be checked yet.'`; a result with `ok: true` and `verdicts: []` is Checked.
  - `progressText`: for `stage === 'sweep'`, `'Checking sheet i of n: <drawing>, looking for symbols, row d of t…'`.
  - Report model `sheetFor` adds `symbolLine` (= `symbolSummary(result)`), `symbolRows` (untagged: `{ name, userRect }`), `allSymbols` (`{ page: 1, symbol, oneOf, tagId, sizePct, score, tag }`), `skippedLine` (`'Title block not checked.'` or `''`).
  - `workbookRows` adds `symbols: { columns: ['Drawing', 'Revision', 'Page', 'Symbol', 'One of', 'Tag identifier', 'Size %', 'Score %', 'Tag'], rows }`; `writeWorkbook` adds worksheet `Symbols` after `Tags`.
  - `PRINT_COLOURS.symbol = '#546E7A'`.
  - PDF: each checked sheet's heading page prints `symbolLine` and `skippedLine` under the counts; its drawing page draws each `symbolRows` rect in `PRINT_COLOURS.symbol`, border 0.5, no number tab; the key gains `Standard symbol with no tag`.

- [ ] **Step 1: Write the failing tests:** runner — a `comments` sheet reaches `deps.check` with `status === 'comments'`; a `none` sheet gives the new sentence; a check result with no tags is Checked; progress carries `stage`. Model — `symbolLine`, `symbolRows`, `allSymbols` from an invented result; workbook `symbols` columns exactly as above and one row per symbol; `writeWorkbook` (with the vendored ExcelJS, as today's test does) has sheets `Tags`, `Symbols`, `Sheets`, `About` in that order. PDF — the heading page text contains the symbol line; the drawing page holds one more rectangle per untagged symbol than before, none with a number; the front page contains `Standard symbol with no tag`.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to see them pass;** `npm test` green.
- [ ] **Step 5: Checkpoint.**

---

### Task 8: The gate script, and the gate

**Files:**
- Modify: `scripts/check-symbol-check.mjs`

**Interfaces:**
- Consumes: `sheetComments` (`pid-precheck.js`), Task 2 readers, Task 5 result.
- Produces: `readSheet(data, { words })`. With `words === 'comments'`: read `page.getAnnotations()` through `sheetComments`; tags from `extractTags(comments.map(c => c.text).join(' ') + '\n', { drawingName: 'CHECK', revision: '', lookups: {} })` (the same joining `assessSheet` uses for one page); `paths` through `removeLetterInk(…, letterBoxes(…))`; `textItems = commentWords(comments)`. Always return `pageSize: [width, height]` and pass it to `checkSheet`. New output lines: `  symbols found N, with tags M, without tags K` and, with `--verbose` only, counts by symbol name. A sheet with no tags no longer fails the script.

- [ ] **Step 1: Implement** the flag, `pageSize` and output lines. `--words` defaults to `text`.
- [ ] **Step 2: Run the gate** and save each output as `<sheet>-after.txt` beside the Task 1 files:
  - Sheets A, B and C (same arguments as Task 1).
  - Sheet M: `node scripts/check-symbol-check.mjs "<sheet M path>" --legend ../pid-symbol-spike/legend-sheets.pdf --words comments --instrument "PE,PIT" --verbose`.
  - The supplier sheet: `../pid-symbol-spike/test-drawing-C.pdf --words comments`.
  - Relabel: sheet C with `--relabel 10:P`.
- [ ] **Step 3: Judge against the spec's phase 1 gate**, and write the numbers (counts only, no tags, no names) into an **Outcome** section at the end of this plan:
  - Sheet C: ≥ 44 of 45 valve tags OK; per-tag diff of before/after shows no verdict worse; ≥ 30 of the 34 untagged symbols judged real by eye (render a contact sheet of the untagged symbols' boxes with PyMuPDF into the private folder, as the brainstorm probes did); the 4 flowmeters in the list; ≤ 2 false symbols; under 60 s.
  - Sheets A and B: no verdict worse; every listed symbol checked by eye, ≤ 1 false per 20.
  - Sheet M: 42/42 located; 40 of 40 non-tank OK (29 V, 2 P, 9 bubbles); 2 tanks Not checked; 0 Wrong family; every listed symbol real; under 60 s.
  - Relabel: ≥ 9 of 10 Wrong family; no other verdict changed.
  - Supplier sheet: runs, no tags, symbols listed, no error.
  - Also report: the distance from each of sheet C's four flowmeter tags to its nearest flowmeter symbol (the spec's open question about pairing distance).
  - **If any line fails, stop and report the numbers to the owner as they are.** Tuning `shareInk`, `sweepStep` or the title-block rule is allowed within the spec; changing a pinned value is not.
- [ ] **Step 4: Checkpoint.** `npm test` green.

---

### Task 9: Wire it into the tool, and check it in the browser

**Files:** Modify `tools-src/pid-tag-register.html` (gitignored) by anchored patch only. Backup first to `.superpowers/sdd/2026-11-16-pid-symbols-first/pid-tag-register.before.html`.

**Edits (each anchored on today's text; every anchor must match exactly once):**
1. `runSymbolCheck`: after `const content = await page.getTextContent();`, fetch `page.getAnnotations()` (on failure `[]`), `const read = window.PidPrecheck.sheetComments(annotations)`; the status is `sheetChecks[key].status`; post `words: status === 'comments' ? 'comments' : 'text'`, `comments: read.comments`, `pageSize: [vp.width, vp.height]` with `vp = page.getViewport({ scale: 1 })`. The progress handler passes `m.stage` to `V.progressHtml`.
2. `reportCheckSheet(run, lib, bytes, tags, onTags, status)`: the same fetch and fields for page 1; `onTags(m.done, m.total, m.stage)`.
3. `reportDeps.check`: `function(bytes, tags, onTags, status) { return reportCheckSheet(run, lib, bytes, tags, onTags, status); }`.
4. `drawSymbolBoxes`: set `d.dataset.s` when `b.s` is a number.
5. The click handler: `sym-jump-s` scrolls to `#sheet-symboxes .sc-box[data-s="<n>"]`, as `sym-jump` does for `data-i`.
6. Styles: `.sc-box.sc-symbol` border `#546E7A` 1px solid; `.sc-box.sc-skipped` background `rgba(0,0,0,0.06)`, border `1px dashed #9E9E9E`, `pointer-events: none`; `.sc-row.sc-symbol` like the other rows.

- [ ] **Step 1: Back up and record facts.** Copy the tool to the backup path. Record its SHA-256 and the counts of `register.json`, `saveToFolder(`, `scheduleSave(` and `createWritable(`.
- [ ] **Step 2: Apply the six edits** with a small patch script in the workspace folder that refuses to write if any anchor matches other than once.
- [ ] **Step 3: Check it parses and nothing else moved.** `node --check` on the largest classic `<script>` body → `SYNTAX OK`. The four counts unchanged. `diff` backup against tool: every hunk is one of the six edits.
- [ ] **Step 4: Browser, invented data only.** `preview_start` name `site`, open `http://localhost:5050/tools-src/pid-tag-register.html` (if 5050 is held, say so and use the server already there). Drive it from the console as the report plan's Task 5 did: import `sheetPdfBytes()` from the fixture as `INV-0001.pdf`, set `symLib = F.SWEEP_LIBRARY`, open the sheet, press **Check symbols**. Expected: progress shows `Looking for symbols: row …`; results show tag verdicts as before, the symbol line, and a `Symbols with no tag` list whose rows jump to grey-blue boxes. Run **Export report** on it: the Excel has a `Symbols` sheet; the PDF's drawing page has the extra boxes. No console errors.
- [ ] **Step 5: Nothing is saved.** As the report plan's Task 5 Step 6: connect the browser's private file system, import, wait for the save, note `register.json`'s `savedAt`, length and the folder's entries; check symbols, export; wait 5 s; all unchanged.
- [ ] **Step 6: Hand over to the owner** with the spec's numbered owner steps (lock-tools, open sheet M, **Check symbols**, a Plant 3D sheet, **Export report**, **Run**, **Download PDF**, **Download Excel**). Do not commit unless asked.

---

## Outcome

(Filled in by the implementer at Task 8 Step 3 and Task 9: numbers only, no tags or names.)

### Task 8: the phase 1 gate (2026-11-16, run in node on the build machine)

Before and after files, and contact sheets of every untagged symbol, are in
`../pid-symbol-spike/every-format-gate/` (private). Every gate line passed.

| Sheet | Gate line | Result |
|---|---|---|
| C (Plant 3D, 71 tags) | ≥ 44 of 45 valve tags OK | 45 of 45 |
| | no tag verdict worse | per-tag comparison identical: 71 located, same counts per code, same 4 non-OK lines (the 4 flowmeter tags, Needs a look, as before) |
| | ≥ 30 of the 34 untagged symbols found | 34 of 34 (12 capped ends, 4 sight glasses, 4 flowmeters, 14 padlocks) |
| | the 4 flowmeters listed | yes, 4 |
| | ≤ 2 false symbols | 0. 102 symbols listed: 67 with tags, 35 without. The 35th untagged one is a real actuated valve beside a tag that today's check pairs with another symbol (no shared ink with any tagged symbol) |
| | under 60 s | 30.3 s (tag check and sweep together; 9.9 s before) |
| A | no verdict worse | identical (5 non-OK lines, same counts) |
| | ≤ 1 false per 20, by eye | 0 false of 12 listed (6 with tags, 6 without); 10.4 s |
| B | no verdict worse | identical (3 non-OK lines, same counts) |
| | ≤ 1 false per 20, by eye | 0 false of 18 listed (14 with tags, 4 without); 9.7 s |
| M (comments, `--words comments`) | 42 of 42 located | 42 of 42 (200 comments read; 3,353 letter paths left out of the linework) |
| | 40 of 40 non-tank OK (29 V, 2 P, 9 bubbles) | 40 of 40: 29 V, 2 P, 9 bubbles (4 + 4 + 1) |
| | 2 tanks Not checked; 0 Wrong family | 2; 0 |
| | every listed symbol real | 45 listed (40 with tags, 5 without), all real by eye. One untagged bubble holds the same tag text as a tagged one: the tag is written in two bubbles, and one symbol answers one tag |
| | under 60 s | 15.5 s |
| Relabel (C, `--relabel 10:P`) | ≥ 9 of 10 Wrong family; no other verdict changed | 9 of 10; 0 changed |
| Supplier (`--words comments`) | runs, no tags, symbols listed, no error | 0 tags; 3 symbols listed; no error; 5.2 s |

Seen while judging, not gate lines:

- **Supplier sheet: all 3 listed symbols look false by eye**: two plain
  panel boxes read as the plain box symbol at 80% size, and one rectangle of
  pipe lines at 76%. This is the plain-shape case phase 2 is for.
- **Title block found** on A, B, C and M (a 281 pt strip at the right, full
  height); **not found** on the supplier sheet (nothing skipped there).
- **Flowmeter tags on sheet C**: each of the 4 tags' nearest flowmeter symbol
  is 180.6 to 181.9 pt from the tag (the search reaches 60 pt). The library's
  flowmeter symbol also carries no tag identifier, so even within reach the
  leftover pass could not pair it with an F tag. They stay Needs a look, as before.
- Times are node on this machine; the owner's browser may differ.

### Task 9: the tool glue, in the browser (2026-11-16, invented sheets only)

- Backup of the tool before the patch in the plan's workspace folder; SHA-256 before
  `e6998731…c405`. Six edits applied by an anchored patch (11 anchors, each matched
  once); the largest classic script passes `node --check`; `diff` shows 11 hunks, all
  from the six edits. Counts before and after: `register.json` 19, `saveToFolder(` 4,
  `scheduleSave(` 6, `createWritable(` 4: unchanged.
- `preview_start site` could not bind port 5050: a server already held it, serving this
  repository with the new files, so the tool was opened there.
- Invented sheet with tags plus two untagged symbols, library `SWEEP_LIBRARY`, **Check
  symbols**: progress read `Checking symbols: N of 11 tags…` then `Looking for symbols:
  row N of 5…`; results 3 OK, 1 OK off size, 1 Wrong family, 1 Approved exception,
  2 Needs a look, 3 Not checked; `7 standard symbols found, 5 with tags.`; `Symbols with
  no tag: 1 GADGET, 1 SIGNAL`; 2 grey-blue boxes (`#546E7A`), each with `data-s`; a row
  jumped to its box (the only `sc-here`). No console errors. 0.4 s.
- Invented "Readable from comments" sheet (same sheet, no text layer, tags in SHX
  comments): pre-check status `comments`, **Check symbols** enabled, the same 11
  verdicts as the text-layer sheet.
- **Export report** on both: `2 of 2 ticked sheets can be checked.`; progress read
  `…, looking for symbols, row N of 5…` for each; `2 checked, 0 not checked`. Excel
  sheets Tags, Symbols, Sheets, About; Symbols has 12 rows, 2 untagged. PDF: the key
  line on the front page, the symbol line on each heading page, and the first drawing
  page holds exactly 2 more boxes than the second (its 2 untagged symbols).
- Nothing saved: with the browser's private folder connected, `register.json` was
  byte-identical (4,440 bytes, same `savedAt`) after a check, two jumps, a report run and
  both downloads, plus 5 s; the folder held the same two entries; no report words in it.
  The private folder was emptied afterwards.
