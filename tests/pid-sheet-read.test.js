import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../assets/js/pid-sheet-read.js';
import * as C from '../assets/js/pid-symbol-check.js';

// Invented comments and linework only.
const line = segs => ({ segs, width: 0.5, stroked: true, filled: false, grey: 0 });

test('commentWords: a horizontal and a vertical comment become text items; no text or no rect is left out', () => {
  const w = R.commentWords([{ text: '21-W-1001', rect: [100, 200, 140, 208] }, { text: '21-W-1002', rect: [300, 100, 308, 150] },
    { text: '', rect: [0, 0, 5, 5] }, { text: 'X', rect: null }]);
  assert.deepEqual(w, [{ str: '21-W-1001', transform: [8, 0, 0, 8, 100, 200], width: 40, height: 8 },
    { str: '21-W-1002', transform: [50, 0, 0, 50, 300, 100], width: 8, height: 50 }]);
});

test('commentWords: a rectangle given corners the other way round still gives its bottom-left and size', () => {
  const [w] = R.commentWords([{ text: 'AB', rect: [140, 208, 100, 200] }]);
  assert.deepEqual(w, { str: 'AB', transform: [8, 0, 0, 8, 100, 200], width: 40, height: 8 });
});

test('commentWords: tagPlaces finds a tag split across two comments', () => {
  // PDF user space (y up); the code line above the number line, as AutoCAD writes a two-line tag.
  const words = R.commentWords([{ text: '21-W', rect: [100, 710, 122, 718] }, { text: '1001', rect: [100, 700, 118, 708] }]);
  const [r] = C.tagPlaces(words, [{ tag: '21-W-1001', fc: 'W' }], [1, 0, 0, -1, 0, 800]);
  assert.equal(r.places.length, 1);
  assert.equal(r.places[0].items, 2);
  assert.deepEqual(r.places[0].box, [100, 82, 122, 100]);
});

test('letterBoxes: corners through the viewport transform, grown by 1 pt', () => {
  assert.deepEqual(R.letterBoxes([{ text: 'A', rect: [10, 700, 14, 707] }], [1, 0, 0, -1, 0, 800]), [[9, 92, 15, 101]]);
});

test('letterBoxes: a missing or bad transform means identity; a comment with no rect gives no box', () => {
  assert.deepEqual(R.letterBoxes([{ text: 'A', rect: [10, 20, 14, 27] }, { text: 'B', rect: null }]), [[9, 19, 15, 28]]);
  assert.deepEqual(R.letterBoxes([{ text: 'A', rect: [10, 20, 14, 27] }], [1, 0, NaN]), [[9, 19, 15, 28]]);
});

test('the pinned values: a 1 pt margin and a 15 pt letter cap', () => {
  assert.equal(R.LETTER_MARGIN, 1);
  assert.equal(R.LETTER_MAX, 15);
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

test('removeLetterInk: a 7 pt letter in a 4 pt-wide one-character box is removed', () => {
  // A one-character comment is narrower than its letter is tall: the cap is fixed, not tied to the box.
  const boxes = R.letterBoxes([{ text: '1', rect: [50, 50, 54, 58] }]);
  const digit = line([51, 50.6, 53, 57.7, 53, 57.7, 52, 57]);
  const r = R.removeLetterInk([digit], boxes);
  assert.equal(r.removed, 1); assert.deepEqual(r.paths, []);
});

test('removeLetterInk: a path standing partly outside every box is kept', () => {
  const r = R.removeLetterInk([line([10, 10, 30, 10])], [[9, 9, 20, 12]]);
  assert.equal(r.removed, 0); assert.equal(r.paths.length, 1);
});

test('removeLetterInk and friends never throw on rubbish', () => {
  const digit = line([1, 1, 2, 2]);
  assert.deepEqual(R.removeLetterInk(null, null), { paths: [], removed: 0 });
  assert.deepEqual(R.removeLetterInk(42, [[0, 0, 5, 5]]), { paths: [], removed: 0 });
  assert.deepEqual(R.removeLetterInk([digit], [[0, 0, 5]]), { paths: [digit], removed: 0 });
  assert.deepEqual(R.removeLetterInk([digit], 'boxes'), { paths: [digit], removed: 0 });
  const nan = line([NaN, NaN, NaN, NaN]);
  assert.deepEqual(R.removeLetterInk([nan, null, 7], [[0, 0, 5, 5]]), { paths: [nan, null, 7], removed: 0 });
  assert.deepEqual(R.commentWords(null), []);
  assert.deepEqual(R.commentWords([null, 7, { text: 'A', rect: [NaN, 0, 1, 1] }, { text: 5, rect: [0, 0, 1, 1] }]), []);
  assert.deepEqual(R.letterBoxes(null, null), []);
  assert.deepEqual(R.letterBoxes([{ text: 'A', rect: [0, 0, 'x', 1] }], [1, 0, 0, 1, 0, 0]), []);
});

// ── A comment sheet end to end (the spec's phase 1 test) ──────────────────
import { BUBBLES, BUBBLE_LIBRARY, LOOKUPS_B, place } from './fixtures/symbol-check-sheet.js';
test('comment sheet: a bubble whose tag is two comments reads OK with letter ink removed, Needs a look without', () => {
  const VT = [1, 0, 0, -1, 0, 800];                          // PDF user space, y up; the page is 800 pt tall
  const ring = place(BUBBLES.find(b => b.name === 'RING'), { x: 100, y: 100 });   // top-left points, centred on (120, 120)
  // The tag as AutoCAD keeps it: two comments, rectangles in user space, rounded to whole points.
  const comments = [{ text: '21-ZI', rect: [109, 681, 131, 689] }, { text: '8001', rect: [111, 671, 129, 679] }];
  // Its letters drawn as short strokes inside those rectangles (top-left points), one stroke standing 0.3 pt out.
  const strokes = [];
  for (const [x0, y0, x1, y1] of [[109, 111, 131, 119], [111, 121, 129, 129]]) {
    for (let x = x0 + 0.5; x + 2 < x1; x += 2.5) strokes.push(line([x, y0 + 0.5, x + 2, y1 - 0.5]), line([x, y1 - 0.5, x + 2, y0 + 0.5]));
  }
  strokes.push(line([110, 110.7, 112, 118]));
  const paths = [...ring, ...strokes];
  const input = { viewportTransform: VT, textItems: R.commentWords(comments), tags: [{ tag: '21-ZI-8001', fc: 'ZI' }],
    library: BUBBLE_LIBRARY, lookups: LOOKUPS_B, options: { sweep: false } };
  const without = C.checkSheet({ ...input, paths });
  assert.equal(without.verdicts[0].verdict, 'look');
  const kept = R.removeLetterInk(paths, R.letterBoxes(comments, VT));
  assert.equal(kept.removed, strokes.length);
  const withRemoval = C.checkSheet({ ...input, paths: kept.paths });
  assert.deepEqual([withRemoval.verdicts[0].verdict, withRemoval.verdicts[0].symbol], ['ok', 'RING']);
});
