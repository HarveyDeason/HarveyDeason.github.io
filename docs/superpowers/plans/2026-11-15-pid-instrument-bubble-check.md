# P&ID Instrument Bubble Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The legend import reads the bubble table into the library. The symbol check then identifies the bubble round each tag by kind, the same way it identifies every other symbol.

**Architecture:**
- **Import (`pid-symbols.js`):** a ruled area with no SYMBOL heading row is read as symbols when every row splits into linework on one side and label words on the other. A symbol whose closed outline holds two or more lines of placeholder text is marked as a tag bubble, and the box of that outline is stored as its `ring`.
- **Check (`pid-symbol-check.js`):** before the family search, it looks for the smallest closed path round each tag's text. It aligns each bubble's `ring` with that path and scores it with the existing two-way ink score.
- **Screen and report:** they show the kind like any symbol name, plus a per-sheet count of bubbles by kind.

**Tech Stack:** vanilla ES modules, no build, `node --test`. Vendored pdf.js 3.11.174 in Node for the gate scripts. PyMuPDF only for throwaway local probes.

**Spec:** `docs/superpowers/specs/2026-11-15-pid-instrument-bubble-check-design.md`

## Global Constraints

- Nothing writes `register.json` or the register folder. Check results are shown and exported, never saved.
- The repository is public. No client data in `assets/js/`, `scripts/`, `docs/`, `tests/` or fixtures: no legend names, table headings, drawing numbers or real tags. Tests use invented bubbles. Local gate output (it prints real tags) is kept in `../pid-symbol-spike/bubble-gate/`, outside the repository.
- No company-specific bubble names, headings, outline shapes or line rules in `assets/js/`. Shapes and names come from the imported legend.
- Zero build, vendored libraries only, no new dependency.
- Pure logic in `assets/js/` modules with `node --test` coverage. The tool (`tools-src/pid-tag-register.html`, gitignored) gets thin glue by anchored patch, after a backup. The owner runs `node scripts/lock-tools.mjs`.
- All functions degrade on hostile input and never throw, as the rest of these modules do.
- The interface keeps saying the check confirms the family, not the member: "It checks the family of symbol, not which member of it."
- **Do not commit.** The owner commits on request. The tree already holds the uncommitted symbol-check report work (see `side-session-notes/.../report-built-handover.md`); build on top of it and leave it alone.
- The owner's shell is Windows PowerShell 5.1: join commands given to him with `;`, never `&&`.
- Baseline before Task 1: `npm test` is 841 tests, 839 pass, 0 fail, 2 skipped. Re-check it at Task 1 Step 0.

## Review Focus

1. **Tag text a little wider than its bubble** (a long function code). It should still be found inside the outline. Pinned in Task 4: a 3 pt margin.
2. **A sheet border or large frame round a tag.** It must never be taken for a bubble. Pinned in Task 4 by the size cap.
3. **A symbol the owner ticks as a bubble that has no stored `ring`.** It should still be matched, using its whole box. Pinned in Task 4.
4. **An old library with no bubble symbols.** Instrument tags must say to re-import the legend, not "Needs a look". Pinned in Task 4.
5. **A tag written twice, once in a bubble and once elsewhere** (a note or a table). The bubble place decides, and the tag reads OK once. Pinned in Task 4.

---

### Task 1: Import reads a headingless ruled table and marks tag bubbles

**Files:**
- Modify: `assets/js/pid-symbols.js` (`legendCells` step 8 at about line 311; new helpers beside `cleanPaths`)
- Modify: `tests/fixtures/symbol-table.js` (new `bubbleTable()`)
- Test: `tests/pid-symbols.test.js`

**Interfaces:**
- Produces: `export function isClosedPath(path) -> boolean`, true when:
  - `path.segs` holds at least 3 segments;
  - each segment starts within 0.05 pt of where the previous one ended;
  - the last segment ends within 0.05 pt of the first one's start.
- Produces: `export function bubbleOf(symbolPaths, placeholderWords, box) -> { bubble: boolean, ring: [x0,y0,x1,y1] | null }`, in page coordinates.
  - `ring` is the box of the smallest closed path whose box contains the centre of every placeholder word. It is `null` when there are no placeholder words or no such path.
  - `bubble` is true when all three hold:
    - `ring` is not null;
    - the placeholder words form **two or more lines**: two words are on the same line when their centres differ in y by less than half the taller word's height;
    - some enclosing closed path's box equals `box` within `TOL` (1.5 pt).
  - **Plan's refinement of the spec:** the two-line rule stops one-letter symbols, such as an H or M inside a circle, from being marked bubbles. A tag bubble shows a code over a number.
- Produces: legend rows gain `bubble: boolean` and `ring: number[] | null`. This applies to rows from headed tables too.
- Produces: a headingless area read as a table gets a `tables` entry: `{ header, tagId: '', symbolSide, box, rowCount, bare: true }`.

- [ ] **Step 0: Baselines, before any code changes**

1. Run: `npm test`
   Expected: 841 tests, 839 pass, 0 fail, 2 skipped. If different, record the actual numbers in the Outcome and carry on from them.
2. Save the real-sheet verdicts before anything changes. Create `../pid-symbol-spike/bubble-gate/`. Then, for each of the three real palette-drawn sheets the owner keeps in his Downloads folder, run the command below. They are named in `../pid-symbol-spike/bubble-gate/README.txt`, not here, because the repository is public, and are called sheets A, B and C below.
   `node scripts/check-symbol-check.mjs "<pdf>" --legend "../pid-symbol-spike/legend-sheets.pdf" --set-tag-id "FLOW MEASUREMENT=FE" --verbose > ../pid-symbol-spike/bubble-gate/<sheet>-before.txt`
   Expected: 11, 17 and 71 tags, with 0 Wrong family.

- [ ] **Step 1: Add the invented fixture `bubbleTable()` to `tests/fixtures/symbol-table.js`**

It returns `{ paths, words }` for one ruled area, x 0 to 300, with no column divider. Rows are 60 pt tall from y 50; the words are invented.

1. A heading row of words only: `GIZMO TAGS`.
2. A 40 pt ring (a 32-sided closed loop) at x 20. Placeholder words `AA-ZZ` and `0001` sit on two lines inside it. The label `PLAIN RING` is at x 90.
3. The same ring with one full-width bar across its middle. The label is `BARRED RING`.
4. **A stacked row, 120 pt tall:**
   - Top: a ring inscribed in a 40 pt square, so both share one box as in a real legend. Label `BOXED RING`.
   - Bottom: 14 pt below it, a ring with a bar, label `BOXED BARRED RING` (no square).
   - No rule between them.
5. A flag: a closed pentagon 60 x 20 pt holding the one-line placeholder `AA-ZZ-0001`. A leader runs from the pentagon to a dot, reaching 30 pt beyond the pentagon's box. The label `GIZMO FLAG` is to the right of the dot.

Also export `junkArea()`: a heading row plus one row whose words and linework interleave across the row, the way a line-types box does.

- [ ] **Step 2: Write the failing tests in `tests/pid-symbols.test.js`**

```js
test('isClosedPath: a ring and a pentagon are closed; a bar, a two-segment path and rubbish are not', () => {
  assert.equal(S.isClosedPath(ringPath(10, 10, 10)), true);
  assert.equal(S.isClosedPath(rule(0, 0, 20, 0)), false);
  assert.equal(S.isClosedPath({ segs: [0, 0, 5, 0, 5, 0, 0, 0] }), false);
  for (const x of [null, {}, { segs: 'x' }, { segs: [0, 0, NaN, 1, 1, 1, 0, 0, 0, 0, 0, 0] }]) assert.equal(S.isClosedPath(x), false);
});
test('legendCells: a headingless table with no divider is read as symbols, the stacked row split in two', () => {
  const { paths, words } = bubbleTable();
  const out = S.legendCells(paths, words);
  assert.deepEqual(out.rows.map(r => r.label), ['PLAIN RING', 'BARRED RING', 'BOXED RING', 'BOXED BARRED RING', 'GIZMO FLAG']);
  assert.deepEqual(out.tables.map(t => [t.header, t.bare, t.rowCount]), [['GIZMO TAGS', true, 5]]);
  assert.deepEqual([out.other.length, out.unsplit.length], [0, 0]);
});
test('legendCells: tag bubbles are marked and given a ring; the flag and one-letter symbols are not', () => {
  const rows = S.legendCells(...Object.values(bubbleTable())).rows;
  assert.deepEqual(rows.map(r => r.bubble), [true, true, true, true, false]);
  assert.ok(rows[2].ring.every((v, i) => Math.abs(v - rows[2].box[i]) < 1.5));   // inscribed ring and square share one box
  assert.equal(rows[4].ring !== null && rows[4].bubble, false);                    // the flag has a ring (its pentagon) but is no bubble
  const lone = S.bubbleOf([ringPath(10, 10, 10)], [word('H', 7, 6, 6, 8)], [0, 0, 20, 20]);
  assert.equal(lone.bubble, false);
});
test('legendCells: an area whose rows do not all split stays in other, all or nothing', () => {
  const out = S.legendCells(...Object.values(junkArea()));
  assert.deepEqual([out.rows.length, out.other.length], [0, 1]);
});
test('legendCells: the existing widget table reads exactly as before, each row with bubble false', () => {
  const out = S.legendCells(...Object.values(widgetTable()));
  assert.ok(out.rows.length > 0 && out.rows.every(r => r.bubble === false && r.ring === null));
});
```

`ringPath(cx, cy, r)` and `word` come from the fixture. Export `ringPath` from `symbol-table.js`.

- [ ] **Step 3: Run the new tests to see them fail**

Run: `node --test tests/pid-symbols.test.js`
Expected: FAIL. `S.isClosedPath is not a function`, and the rows assertions fail.

- [ ] **Step 4: Implement**

Add `isClosedPath` and `bubbleOf` to `pid-symbols.js`. In `legendCells` step 8, try to read an area with `a.headIdx < 0` as a bare table before it falls to `other`:
- **Heading:** the first non-empty row is the heading when it has words and no paths.
- **Each later non-empty row:**
  1. Sort its `pathsIn` by y0. Start a new group when a path's y0 is more than 5 pt below the current group's y1.
  2. Words whose centre lies inside a group's box, grown by `TOL`, are that group's placeholder words.
  3. Every other word is a label word. It goes to the group whose y-span is nearest its centre y.
  4. A group splits when it has at least one label word and all of them lie on one side of its box, more than `TOL` clear. The side is right when the words start at or beyond the box's x1 + TOL, left when they end at or before x0 − TOL.
- **The area becomes a table** only if all of these hold:
  - every group splits;
  - every group is on the same side;
  - there are at least 2 groups.

  Otherwise it goes to `other` exactly as today.
- **Each group becomes a row:**

  ```
  { table, label, header, tagId: '', symbolPaths, lettersInside: <placeholder words>, box: <group box>, ...bubbleOf(...) }
  ```

Rows from headed tables also get `...bubbleOf(sp.map(q => q.p), symWords, box)`.

- [ ] **Step 5: Run the tests to see them pass**

Run: `node --test tests/pid-symbols.test.js`
Expected: PASS, with no other test in the file changed.

- [ ] **Step 6: Check the real legend locally (not committed, prints client text)**

Run: `node scripts/check-symbol-import.mjs "../pid-symbol-spike/legend-sheets.pdf"`
Expected:
- `TOTAL  symbols 403`, by page `50 / 139 / 78 / 84 / 33 / 19`. That is 390 plus the 13 entries of the bubble table, all on sheet 1.
- Every other page's count is unchanged.

Then count the rows with `bubble: true` with a throwaway script in the scratchpad. Expected: 11, all from the new table.

If any figure differs, stop, find out why, and record it in the Outcome before going on.

### Task 2: The library carries the bubble mark, its ring and the owner's override

**Files:**
- Modify: `assets/js/pid-symbols.js`. The functions to change are `buildLibrary`, `cleanFlags`, `parseLibrary`, `updateSymbol`, `carryOver`, `libraryCounts`, and the library comment at about line 386.
- Test: `tests/pid-symbols.test.js`

**Interfaces:**
- Consumes: rows with `bubble` and `ring` (Task 1).
- Produces, in the library schema:
  - `symbol.flags.bubble: boolean` and `symbol.flags.bubbleByHand: boolean`.
  - `symbol.ring: [x0,y0,x1,y1]`. It is in the symbol's own coordinates, rounded to 2 places, and present only on bubbles.
  - Bubble symbols have `letters: []`: the placeholder is not stored as letters.
- Produces: `updateSymbol(library, id, { bubble })`. It sets `flags.bubble` and also `flags.bubbleByHand = true`, but only when the value changes.
- Produces: `libraryCounts(library).bubbles: number`, counting symbols with `flags.bubble === true`.
- Produces: in `carryOver`, an old symbol with `bubbleByHand` passes `bubble` and `bubbleByHand` to its match. `bubbleByHand` also counts as hand work for an unmatched symbol.

- [ ] **Step 1: Write the failing tests**

```js
test('buildLibrary: a bubble row gives flags.bubble, a ring relative to the symbol, and no letters', () => {
  const page = S.readLegendPage(bubblePage());   // bubbleTable() through toOps/toTextItems, page 1
  const lib = S.buildLibrary([page], 'T');
  const plain = lib.symbols.find(s => s.name === 'PLAIN RING');
  assert.deepEqual([plain.flags.bubble, plain.flags.bubbleByHand, plain.letters], [true, false, []]);
  assert.deepEqual(plain.ring, [0, 0, plain.w, plain.h]);
  assert.equal('ring' in lib.symbols.find(s => s.name === 'GIZMO FLAG'), false);
});
test('parseLibrary: keeps a valid ring and the bubble flags; drops a broken ring; an old file reads as before', () => {
  const lib = { version: 1, symbols: [
    { id: 'a', name: 'A', flags: { bubble: true }, ring: [0, 0, 10, 10] },
    { id: 'b', name: 'B', flags: { bubble: true }, ring: [0, 'x', 10, 10] },
    { id: 'c', name: 'C' }] };
  const out = S.parseLibrary(JSON.stringify(lib)).library.symbols;
  assert.deepEqual(out.map(s => [s.flags.bubble, s.flags.bubbleByHand, s.ring ?? null]),
    [[true, false, [0, 0, 10, 10]], [true, false, null], [false, false, null]]);
});
test('updateSymbol: changing the bubble mark records it as done by hand; re-applying the same value does not', () => {
  const lib = S.buildLibrary([S.readLegendPage(bubblePage())], 'T');
  const id = lib.symbols.find(s => s.name === 'PLAIN RING').id;
  const same = S.updateSymbol(lib, id, { bubble: true }).symbols.find(s => s.id === id);
  assert.equal(same.flags.bubbleByHand, false);
  const off = S.updateSymbol(lib, id, { bubble: false }).symbols.find(s => s.id === id);
  assert.deepEqual([off.flags.bubble, off.flags.bubbleByHand], [false, true]);
});
test('carryOver: an owner\'s bubble correction survives a re-import; an automatic mark is recomputed', () => {
  const fresh = S.buildLibrary([S.readLegendPage(bubblePage())], 'T2');
  const old = S.updateSymbol(S.buildLibrary([S.readLegendPage(bubblePage())], 'T1'),
    fresh.symbols.find(s => s.name === 'PLAIN RING').id, { bubble: false });
  const out = S.carryOver(old, fresh).library.symbols;
  assert.equal(out.find(s => s.name === 'PLAIN RING').flags.bubble, false);
  assert.equal(out.find(s => s.name === 'BARRED RING').flags.bubble, true);
});
test('libraryCounts: counts tag bubbles', () => {
  assert.equal(S.libraryCounts(S.buildLibrary([S.readLegendPage(bubblePage())], 'T')).bubbles, 4);
});
```

`bubblePage()` is a new fixture export: `{ fnArray, argsArray, OPS, viewportTransform: [1,0,0,1,0,0], textItems, page: 1 }`, built from `bubbleTable()` with `toOps` and `toTextItems`.

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/pid-symbols.test.js`
Expected: FAIL on `flags.bubble` being undefined.

- [ ] **Step 3: Implement**

As the Interfaces block says. In `buildLibrary`, offset `ring` by the same `dx, dy` as the paths. In `parseLibrary`, keep `ring` only if it is 4 finite numbers with x1 > x0 and y1 > y0; otherwise delete the key. Update the library schema comment.

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: all pass except the 2 existing skips.

### Task 3: Symbols tab shows and edits the bubble mark

**Files:**
- Modify: `assets/js/pid-symbols-view.js`. The functions are `symbolCard` (check box and badge), `renderReport` (the bubble count in the preview) and `renderStatus` (the re-import note).
- Modify, as a tool patch: `tools-src/pid-tag-register.html`, `symCardPatch` (about line 4513).
- Test: `tests/pid-symbols-view.test.js`

**Interfaces:**
- Consumes: `libraryCounts(...).bubbles` and `flags.bubble` (Task 2).
- Produces, in the edit card: a check box `data-field="bubble"` with the label `Tag bubble: the tag is written inside it`. It sits after "Drawn to suit".
- Produces, in the card: the badge `Tag bubble`.
- Produces, in the preview: `<n> tag bubbles.` after the symbol count. It reads `1 tag bubble.` when there is one, and nothing at all when there are none.
- Produces, in the status: when the library has symbols and `bubbles === 0`, the text `No tag bubbles in this library. Import the legend again to add them.`

- [ ] **Step 1: Write the failing tests**

There are four tests:
1. The edit card has the bubble check box, ticked when `flags.bubble`.
2. The plain card shows the `Tag bubble` badge.
3. `renderReport` of the bubble page's preview contains `4 tag bubbles.`
4. `renderStatus` contains the re-import sentence for the existing invented library (it has no bubbles), and not for the bubble library.

- [ ] **Step 2: Run to see them fail**

Run: `node --test tests/pid-symbols-view.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement the view changes, then make it pass**

Run: `node --test tests/pid-symbols-view.test.js`
Expected: PASS.

- [ ] **Step 4: Patch the tool**

1. Back the tool up to `.superpowers/sdd/2026-11-15-pid-instrument-bubble-check/pid-tag-register.before-bubbles.html`.
2. Re-use `patch.mjs` from `.superpowers/sdd/2026-11-15-pid-symbol-check-report/`. The anchor is the `symCardPatch` return line.
3. Add `bubble: symField(card, 'bubble') === true` to the returned object.
4. Run the workspace's `syntax.mjs` on the tool.

Expected: one anchored edit applied, and the syntax check is clean.

### Task 4: The check identifies bubbles round tags

**Files:**
- Modify: `assets/js/pid-symbol-check.js`. Change `prepareOne`, `expectedFamily`, `emptyVerdict` and `checkSheet`, and add `findOutline` and `matchBubble`.
- Modify: `tests/fixtures/symbol-check-sheet.js`. Add `BUBBLE_LIBRARY` and `BUBBLE_SHEET`, invented.
- Test: `tests/pid-symbol-check.test.js`

**Interfaces:**
- Consumes: `isClosedPath` from `./pid-symbols.js` (Task 1); `flags.bubble` and `ring` (Task 2).
- Produces, from prepared symbols:
  - `p.bubble: boolean`.
  - `p.ring: [x0,y0,x1,y1]`. It is the symbol's `ring` when valid, otherwise `[0, 0, w, h]`.
  - A bubble symbol is checkable whatever its line count: the "simple" rule is skipped for it. The manual, no-linework, stretch and size rules still apply.
  - Bubble symbols are left out of the line-pairing family search.
- Produces: `export function findOutline(paths, tagBox, options) -> [x0,y0,x1,y1] | null`. It returns the box of the smallest-area path that meets all four conditions:
  - `isClosedPath`;
  - grey below `inkGrey`;
  - its box contains the centre of `tagBox`, and `tagBox` lies within its box grown by `OUTLINE_MARGIN = 3` pt;
  - width and height both ≤ `options.maxOutline` (pt).

  `checkSheet` passes `maxOutline` as the largest bubble ring side times `maxScale`. There is no outline when no bubble symbol is checkable.
- Produces: `export function matchBubble(bubbles, outline, window, options) -> { best, oneOf, closest }`.
  - **Placement:** for each prepared bubble, `kw = outline width / ring width` and `kh = outline height / ring height`. The bubble is skipped when `|kw − kh| / kh > ASPECT_TOL = 0.1`. Otherwise `k = (kw + kh) / 2`, which must lie within `minScale` to `maxScale`. The placement is `{ o: 0, k, tx, ty, cx, cy }`, with the ring centre on the outline centre. Each is scored with `scorePlacement`.
  - `best` is the top match with score ≥ `recognise`, as `{ p, score, k, box }`, or `null`.
  - `oneOf` is the names of matches within `oneOf` of `best`, listed only when there are 2 or more.
  - `closest` is `{ symbol, score }` for the top score when `best` is null and it is ≥ `NEAR_MISS_FLOOR`, otherwise `null`. Scoring for `closest` uses `quickLook: NEAR_MISS_LOOK`.
- Produces: the verdict gains `bubble: boolean`, false by default. A bubble verdict:
  - verdict `ok`, or `off-size` outside `sizeBand`;
  - `symbol` is the bubble's name, `tagId` is `''`;
  - `sizePct`, `score`, `box` and `tagBox` are set; `oneOf` as above; `bubble: true`.
- Produces from `expectedFamily`, for a code with no carrying symbol that the lookups class as `'instrument'`:
  - `{ mode: 'bubble', symbols: [], why: '' }` when the library has a checkable bubble symbol;
  - otherwise `{ mode: 'skip', symbols: [], why: 'The library has no tag bubbles. Import the legend again to add them.' }`.

  This replaces "Instrument bubbles are not checked yet."
- Produces: in `checkSheet`, `checked` = the count of verdicts that are not `not-checked`. On sheets without bubbles this equals today's count.

**Order inside `checkSheet`:**
1. **Bubble step**, for each tag place, before the family loop:
   - `findOutline`, then `matchBubble` on `windowFrom(boxed, outline centre, cfg)`.
   - On a `best`: fill the verdict, mark the tag done, and push a spot `{ cx, cy, best: new Map(), top: 0, claimed: true }` at the outline centre. A family match landing on that spot then cannot answer another tag.
   - Without a `best`: keep `closest` for the tag.
2. **Family loop**, unchanged, but it skips tags already done and uses `checkable.filter(p => !p.bubble)`.
3. **The rest:**
   - A tag with `families[ti].mode === 'bubble'` and not done gets `verdict 'look'`, `bubble: true` and `closest` from step 1.
   - All other tags as today.

- [ ] **Step 1: Add the invented fixtures**

**`BUBBLE_LIBRARY`** is `LIBRARY` plus six bubble symbols, with `flags.bubble: true` and `ring` as stated. The sizes and the two-bar spacing are near the real legend's proportions, so the margins between kinds are realistic.

| Symbol | Linework | `ring` |
|---|---|---|
| `RING` | a 40 pt, 32-sided closed loop | `[0,0,40,40]` |
| `RING, ONE BAR` | `RING` plus a full-width bar at y 20 | `[0,0,40,40]` |
| `RING, TWO BARS` | bars at y 18.5 and 21.5 | `[0,0,40,40]` |
| `RING, BROKEN BAR` | the y 20 bar with an 8 pt gap in the middle | `[0,0,40,40]` |
| `BOXED RING` | `RING` inscribed in a 40 pt square | `[0,0,40,40]` |
| `HEXAGON` | a closed hexagon, 46 x 40 pt | `[0,0,46,40]` |

Add `LOOKUPS_B = { fc: { ZI: 'instrument', ZP: 'instrument' } }`.

**`BUBBLE_SHEET`** has the same shape as `SHEET`. Each tag is split over two lines with `label(..., { split: true })` and centred in its bubble.
- The bubbles sit on a 4-column grid with top-left corners at x 100, 220, 340 and 460 and y 100, 220 and 340, in the order listed. So `21-ZI-8001`'s ring box is `[100, 100, 140, 140]`.
- The page is 600 x 480 pt.

| Tag | What is drawn |
|---|---|
| `21-ZI-8001` | `RING` |
| `21-ZI-8002` | `RING, ONE BAR` |
| `21-ZI-8003` | `RING, TWO BARS` |
| `21-ZI-8004` | `RING, BROKEN BAR` |
| `21-ZI-8005` | `BOXED RING` |
| `21-ZI-8006` | `HEXAGON` |
| `21-ZI-8007` | `RING` at k 1.25 |
| `21-X-8008` | `RING`. X is a code with no family: equipment drawn in a bubble. |
| `21-ZP-8009` | nothing |
| `21-W-8010` | written beside, not inside, a `RING` 30 pt away; no widget |
| `21-ZI-8011` | a bare 40 pt closed square round its text: an outline that matches no bubble |
| `21-ZI-8012` | `RING`, and also written a second time, 60 pt below its ring, with no outline |

Add a closed frame `[10, 10, 590, 470]` round the whole sheet.

- [ ] **Step 2: Write the failing tests**

```js
const runB = (over = {}) => C.checkSheet({ ...BUBBLE_SHEET, library: BUBBLE_LIBRARY, lookups: LOOKUPS_B, ...over });
test('checkSheet: each bubble kind round a tag is identified as itself, with no one-of', () => {
  const r = runB();
  const want = { '21-ZI-8001': 'RING', '21-ZI-8002': 'RING, ONE BAR', '21-ZI-8003': 'RING, TWO BARS',
    '21-ZI-8004': 'RING, BROKEN BAR', '21-ZI-8005': 'BOXED RING', '21-ZI-8006': 'HEXAGON' };
  for (const [tag, name] of Object.entries(want)) {
    const v = verdictOf(r, tag);
    assert.deepEqual([v.verdict, v.symbol, v.bubble, v.oneOf, v.tagId], ['ok', name, true, [], ''], tag);
  }
});
test('checkSheet: an off-size bubble reads OK, off size', () => {
  const v = verdictOf(runB(), '21-ZI-8007');
  assert.equal(v.verdict, 'off-size'); assert.ok(near(v.sizePct, 125, 2));
});
test('checkSheet: an equipment code drawn in a bubble reads OK', () => {
  assert.equal(verdictOf(runB(), '21-X-8008').verdict, 'ok');
});
test('checkSheet: an instrument tag with no bubble needs a look; one in a non-standard outline names the closest bubble', () => {
  const r = runB();
  assert.deepEqual([verdictOf(r, '21-ZP-8009').verdict, verdictOf(r, '21-ZP-8009').bubble], ['look', true]);
  const odd = verdictOf(r, '21-ZI-8011');
  assert.equal(odd.verdict, 'look'); assert.ok(odd.closest && odd.closest.score < 0.9);
});
test('checkSheet: a bubble is not claimed by a neighbouring tag', () => {
  assert.notEqual(verdictOf(runB(), '21-W-8010').verdict, 'ok');
});
test('checkSheet: a tag written twice, once in a bubble, reads OK once', () => {
  assert.equal(verdictOf(runB(), '21-ZI-8012').verdict, 'ok');
});
test('findOutline: tag text 1 pt wider than the ring on each side is still inside; the sheet frame is never an outline', () => {
  const paths = BUBBLE_SHEET.paths;   // includes the frame
  assert.deepEqual(C.findOutline(paths, [99, 114, 141, 126], { maxOutline: 62 }).map(Math.round), [100, 100, 140, 140]);
  assert.equal(C.findOutline(paths, [40, 40, 60, 50], { maxOutline: 62 }), null);   // inside only the frame
  assert.equal(C.findOutline(null, null, null), null);
});
test('checkSheet: a bubble with no stored ring is matched on its whole box', () => {
  const noRing = s => { const { ring, ...rest } = s; return rest; };
  const lib = { ...BUBBLE_LIBRARY, symbols: BUBBLE_LIBRARY.symbols.map(s => (s.name === 'RING' ? noRing(s) : s)) };
  assert.deepEqual([verdictOf(runB({ library: lib }), '21-ZI-8001').verdict, verdictOf(runB({ library: lib }), '21-ZI-8001').symbol], ['ok', 'RING']);
});
test('checkSheet: with an old library, instrument tags say to re-import the legend', () => {
  const v = verdictOf(C.checkSheet({ ...BUBBLE_SHEET, library: LIBRARY, lookups: LOOKUPS_B }), '21-ZI-8001');
  assert.deepEqual([v.verdict, v.why], ['not-checked', 'The library has no tag bubbles. Import the legend again to add them.']);
});
```

**Update the existing test** `expectedFamily: checked, or why not`. Its `ZI` line now expects `['skip', 'The library has no tag bubbles. Import the legend again to add them.']`. Add a case: with `BUBBLE_LIBRARY`, `f('ZI').mode === 'bubble'`.

The existing `checkSheet: every verdict, on the invented sheet` test must pass **unchanged** apart from that. Its counts, and `checked` 7 and `recognised` 4, stay the same.

- [ ] **Step 3: Run them to see them fail**

Run: `node --test tests/pid-symbol-check.test.js`
Expected: FAIL on `C.findOutline is not a function` and the bubble verdicts.

- [ ] **Step 4: Implement**

As the Interfaces block and the order above say. `findOutline` works from `boxesOf` and `isClosedPath`. Add the constants `OUTLINE_MARGIN = 3` and `ASPECT_TOL = 0.1` beside `NEAR_MISS_LOOK`.

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: all pass except the 2 existing skips.

### Task 5: Screen and report show bubble kinds

**Files:**
- Modify: `assets/js/pid-symbol-check-view.js` (`sentence`, `resultsHtml`, new `bubbleSummary`)
- Modify: `assets/js/pid-symbol-report.js` (`sheetFor`, `workbookRows`)
- Modify: `assets/js/pid-symbol-report-pdf.js` (sheet page, after `countsLine` at about line 250)
- Test: `tests/pid-symbol-check-view.test.js`, `tests/pid-symbol-report.test.js`, `tests/pid-symbol-report-pdf.test.js`

**Interfaces:**
- Consumes: verdicts with `bubble`, `symbol` and `closest` (Task 4).
- Produces: `export function bubbleSummary(result) -> string`.
  - It returns `''` when no verdict has `bubble === true` with verdict `ok` or `off-size`.
  - Otherwise it returns `'Tag bubbles: '` + `'<n> <symbol>'` items joined with `', '`. Items are ordered by count, highest first, then by name. Example: `'Tag bubbles: 2 RING, 1 HEXAGON'`.
- Produces the sentences:
  - A bubble `ok`/`off-size` reads `'Tag bubble: ' + <symbol or "One of: ..."> + <", drawn at N% of legend size" when off size> + '.'`
  - A bubble `look` reads `'No standard tag bubble recognised round the tag.' + <" Closest: <symbol> at N%." when closest> + ' Could be non-standard, modified, or a gap in the library.'`
  - Non-bubble sentences are unchanged.
- Produces: the model's sheet gains `bubbleLine: string`, which is `bubbleSummary(result)` when checked and `''` otherwise.
- Produces: the Excel Sheets columns gain `'Tag bubbles'` at the end, holding `bubbleLine` without its `'Tag bubbles: '` prefix.
- Produces: the PDF sheet page writes `bubbleLine` under the counts line when it is not empty.

- [ ] **Step 1: Write the failing tests**

There are five:
1. **`verdictSentence`** for the three bubble cases, with exact strings, including one-of and off size at 125%.
2. **`bubbleSummary`** on a hand-made result with 2 RING, 1 HEXAGON, one bubble `look` and one non-bubble OK. It returns `'Tag bubbles: 2 RING, 1 HEXAGON'`. Rubbish in gives `''`.
3. **`resultsHtml`** contains the escaped summary line.
4. **`workbookRows`:** the last column of the Sheets tab is `'Tag bubbles'`, holding `'2 RING, 1 HEXAGON'`.
5. **The PDF writer** is given a model whose sheet has a `bubbleLine`. That text is among the strings written. Use the existing PDF test's capture of `w.text` calls.

- [ ] **Step 2: Run to see them fail**

Run: `node --test tests/pid-symbol-check-view.test.js tests/pid-symbol-report.test.js tests/pid-symbol-report-pdf.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement, and run the suite**

Run: `npm test`
Expected: all pass except the 2 existing skips. The existing report tests that list the Sheets columns are updated for the new last column, and only that.

### Task 6: Gate scripts for bubbles

**Files:**
- Modify: `scripts/check-symbol-import.mjs` (print the bubble count)
- Modify: `scripts/check-symbol-check.mjs` (`--instrument`, `--bubble-self-test`, the bubble summary line)
- Test: `tests/check-symbol-import.test.js`, `tests/check-symbol-check.test.js`

**Interfaces:**
- Consumes: `checkSheet` (Task 4), `bubbleSummary` (Task 5), `libraryCounts` (Task 2).
- Produces: the import script prints `tag bubbles <n>` after the TOTAL line. With `--verbose` it also prints their names.
- Produces: `--instrument "<CODE,CODE,...>"`. It passes `lookups.fc` with each code mapped to `'instrument'` to `checkSheet`, in place of `{}`.
- Produces: the check script prints `bubbleSummary(result)` when it is not empty.
- Produces: `export function bubbleSelfTest(library, options) -> [{ name, verdict, symbol, oneOf, score }]`. For each symbol with `flags.bubble`:
  1. Build an invented 300 x 300 pt page. It holds that symbol's paths at (100, 100), k 1, and two text items `AA-ZZ` and `0001` centred on its ring.
  2. Use the tag `{ tag: 'AA-ZZ-0001', fc: 'ZZ' }`.
  3. Run `checkSheet` with the library.
- Produces: `--bubble-self-test` with `--legend` or `--library`, and no drawing. It prints one line per bubble: `PASS`/`FAIL`, name, the verdict symbol and the score. Then it prints `<n> of <m> identified as themselves`. The exit code is 1 when any bubble fails. A bubble passes when the verdict is `ok`, `symbol === name` and `oneOf` is empty.

- [ ] **Step 1: Write the failing tests**

1. `bubbleSelfTest(BUBBLE_LIBRARY)` gives 6 entries, all passing.
2. A library whose `RING, ONE BAR` has had its bar removed fails at least one entry: it now duplicates `RING`, so both read "one of".
3. The command line with `--bubble-self-test --library <invented library written to a temp dir>` exits 0 and prints `6 of 6 identified as themselves`.
4. The import script on the invented bubble page prints `tag bubbles 4`.

- [ ] **Step 2: Run to see them fail; implement; run `npm test`**

Expected: FAIL first, then everything passes except the 2 existing skips.

### Task 7: Local gate on the real legend and sheets, the Outcome, and the owner's part

**Files:**
- Create (outside the repo): `../pid-symbol-spike/bubble-gate/` for verbose outputs. They print real tags.
- Modify: this plan, adding an `## Outcome` section.

The baseline verdicts were saved at Task 1 Step 0, in `../pid-symbol-spike/bubble-gate/*-before.txt`.

- [ ] **Step 2: Import gate**

Run: `node scripts/check-symbol-import.mjs "../pid-symbol-spike/legend-sheets.pdf"`
Expected: `symbols 403` and `tag bubbles 11`, with 0 rows not split. The two interlock flags must not be marked as bubbles.

- [ ] **Step 3: Self-test gate**

Run: `node scripts/check-symbol-check.mjs --bubble-self-test --legend "../pid-symbol-spike/legend-sheets.pdf"`
Expected: `11 of 11 identified as themselves`. In particular, no bubble is reported as "one of" with its back-of-panel twin. Record each back-of-panel pair's two scores in the Outcome.

- [ ] **Step 4: Real-sheet gate**

Repeat Task 1 Step 0's three commands with `--instrument "LE,PE,PIT,FIT,FE"` added, into `<sheet>-after.txt`.

Expected:
- **30 bubble tags OK:**

  | Sheet | Bubble tags | Kinds |
  |---|---|---|
  | A | 5 | 4 field mounted, 1 local control panel |
  | B | 3 | field mounted |
  | C | 22 | field mounted |

- 0 Wrong family.
- Every non-bubble tag's verdict is the same as before or better. List each change.
- Each sheet runs within its existing time limit.

Write the tag-free counts in the Outcome.

- [ ] **Step 5: Whole suite and a review**

Run `npm test`, then one review of the whole change on the most capable model. Fix Critical and Important findings test-first, and list the minor ones as deferred in the Outcome.

- [ ] **Step 6: Write `## Outcome` in this plan**

It covers:
- the test counts;
- the three gates' figures;
- the review findings;
- what is not verified: a back-of-panel, PLC or telemetry bubble round a real tag, and dashed lines on drawings.

- [ ] **Step 7: Hand the owner his part, as numbered steps**

1. Close the tool. In PowerShell in the `harveydeason-site` folder, run `node scripts/lock-tools.mjs`.
2. Open the published tool on the laptop. Go to the **Symbols** tab and click **Import legend**, then choose the legend PDF. Check that the preview says **11 tag bubbles**. Click **Use this library**, then save it to the folder.
3. Go to the **Sheets** tab, tick the three sheets, and run the report. Check that the bubble rows read **OK** with the kind you see on each sheet, and that the Excel **Sheets** tab has a **Tag bubbles** column.
4. Do the same on the work computer, against the shared folder.
5. When happy, ask for a commit and push. It must carry:
   - `tools/`;
   - the changed `assets/js/` files;
   - the tests and fixtures;
   - the scripts;
   - this plan and the spec;
   - the report work already in the tree.

## Outcome (2026-11-15)

Executed natively in one session, then one independent review of the whole change. Nothing committed; the tool is not re-locked.

- **Tests:** 876, with 874 passing, 0 failing and 2 skipped. The baseline was 841, with 839 passing.
- **Import gate, real legend:** 403 symbols, by page 50 / 139 / 78 / 84 / 33 / 19, 0 rows not split. 11 tag bubbles; the 2 interlock flags are read as symbols but not as bubbles.
- **Self-test:** 11 of 11 bubbles identified as themselves, none "one of". The thinnest margins are the back-of-panel pairs:
  - back of local panel against local panel: runner-up 0.941 (margin 0.059);
  - back of central panel against central panel: runner-up 0.965 (margin 0.035, just over the 0.03 "one of" band).
- **Real sheets A, B and C:**

  | Sheet | Bubble tags OK | Kinds | Time |
  |---|---|---|---|
  | A | 5 | 4 field mounted, 1 local control panel | 1.3 s |
  | B | 3 | field mounted | 1.2 s |
  | C | 22 | field mounted | 4.3 s |

  0 Wrong family. Every other function code's result is identical to before. Before the change these took 1.3, 1.0 and 4.2 s.
- **Deviations from the plan, each ruled in the workspace ledger:**
  - A headingless area is read only when words inside a symbol sit inside one of its closed outlines. A two-column line-types box would otherwise split.
  - "Two symbol rows" means two ruled rows. The legend's single-row box of worked examples would otherwise add 5 symbols.
  - A bubble needs at least 4 letters or digits of placeholder text. Three level-measurement symbols (an X over an L) would otherwise be marked.
  - The bubble names print in the gate scripts only with `--verbose`.
- **Review:** no Critical findings.
  - Important 1, that every tag inside a bubble is answered by it whatever its code, is kept: the spec says the drawing decides. It is now pinned by a test.
  - Important 2, a hand-ticked large bubble widening the outline cap, was re-graded minor.
  - Deferred minors: the per-candidate outline cap; a test at the 3 pt margin boundary; `bubbleByHand` staying true after a tick and untick; the closest-bubble wording when a note box is involved; the order of the import script's options; the import script's console line being untested.
- **Not verified:**
  - a back-of-panel, PLC or telemetry bubble round a real tag;
  - dashed lines drawn as a dash style, not as geometry;
  - circles written as separate arcs;
  - another company's legend;
  - the tool in a browser (the one tool edit is syntax-checked only).
