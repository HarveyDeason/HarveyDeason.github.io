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

// ── pageInkFacts ──
import { FAKE_OPS as OPS, opList } from './fixtures/symbol-ops.js';
const INK_VT = [1, 0, 0, 1, 0, 0], PAGE = [600, 400];
const ink = (steps, vt = INK_VT, size = PAGE) => { const { fnArray, argsArray } = opList(steps); return R.pageInkFacts(fnArray, argsArray, OPS, vt, size); };
const tiny = ['path', ['M', 0, 0, 'L', 3, 0]];

test('pageInkFacts: counts constructPath operators', () => {
  assert.deepEqual(ink([tiny, ['stroke'], tiny, ['stroke'], tiny, ['stroke']]), { pathCount: 3, imageCover: 0 });
});

test('pageInkFacts: an image scaled to the whole page covers 1; two quarter-page images cover 0.5', () => {
  assert.equal(ink([['save'], ['transform', 600, 0, 0, 400, 0, 0], ['paintImageXObject', 'Im1', 1, 1], ['restore']]).imageCover, 1);
  const quarter = [['save'], ['transform', 300, 0, 0, 200, 0, 0], ['paintImageXObject', 'Im1', 1, 1], ['restore']];
  const second = [['save'], ['transform', 300, 0, 0, 200, 300, 200], ['paintInlineImageXObject', {}], ['restore']];
  assert.equal(ink([...quarter, ...second]).imageCover, 0.5);
  assert.equal(ink([...quarter, ...quarter, ...quarter, ...quarter, ...quarter]).imageCover, 1, 'capped at 1');
});

test('pageInkFacts: restore undoes a transform, and an image off or half off the page counts only the part on it', () => {
  const big = [['save'], ['transform', 600, 0, 0, 400, 0, 0], ['paintImageXObject', 'Im1', 1, 1], ['restore']];
  // After the restore the unit square is 1 pt: only the first image is large.
  const r = ink([...big, ['paintImageXObject', 'Im2', 1, 1]]);
  assert.ok(r.imageCover > 0.999 && r.imageCover <= 1);
  assert.ok(ink([['paintImageXObject', 'Im2', 1, 1]]).imageCover < 0.001);
  assert.equal(ink([['save'], ['transform', 100, 0, 0, 100, 900, 900], ['paintImageXObject', 'x'], ['restore']]).imageCover, 0);
  assert.equal(ink([['save'], ['transform', 600, 0, 0, 400, 300, 0], ['paintImageXObject', 'x'], ['restore']]).imageCover, 0.5);
});

test('pageInkFacts: the viewport transform and form XObjects are followed', () => {
  assert.equal(ink([['paintFormXObjectBegin', [600, 0, 0, 400, 0, 0]], ['paintImageMaskXObject', {}], ['paintFormXObjectEnd']], [1, 0, 0, -1, 0, 400]).imageCover, 1);
});

test('pageInkFacts: hostile input gives zeros and never throws', () => {
  const zero = { pathCount: 0, imageCover: 0 };
  for (const bad of [undefined, null, 5, {}, 'x']) assert.deepEqual(R.pageInkFacts(bad, bad, bad, bad, bad), zero);
  assert.deepEqual(R.pageInkFacts([], [], OPS, INK_VT, PAGE), zero);
  assert.deepEqual(R.pageInkFacts([OPS.paintImageXObject], [null], OPS, INK_VT, [0, 0]), zero);
  assert.ok(R.pageInkFacts([OPS.paintImageXObject], [null], OPS, [NaN, 0, 0, 1, 0, 0], PAGE).imageCover < 0.001); // falls back to the identity
  assert.deepEqual(R.pageInkFacts([OPS.save, OPS.transform, OPS.paintImageXObject, undefined, null], [null, [NaN, 1, 2, 3, 4, 5], null], OPS, INK_VT, [NaN, 5]), zero);
  assert.deepEqual(R.pageInkFacts([OPS.constructPath, 99999], [], {}, INK_VT, PAGE), zero);
});

test('pageInkFacts: turned and skewed images are clipped as the shapes they are', () => {
  const rot = (deg, sx, sy, cx, cy) => { // unit square -> sx by sy, turned, centred on (cx, cy)
    const c = Math.cos(deg * Math.PI / 180), s = Math.sin(deg * Math.PI / 180);
    return [sx * c, sx * s, -sy * s, sy * c, cx - (sx * c - sy * s) / 2, cy - (sx * s + sy * c) / 2];
  };
  const draw = m => ink([['save'], ['transform', ...m], ['paintImageXObject', 'x'], ['restore']]).imageCover;
  // (a) a scan turned 5 degrees and drawn big enough to overhang every edge
  assert.ok(draw(rot(5, 700, 500, 300, 200)) >= 0.99);
  // (b) a turned image wholly inside the page: its true share (area / page area)
  assert.ok(Math.abs(draw(rot(30, 200, 100, 300, 200)) - 200 * 100 / (600 * 400)) < 0.01);
  // (c) a sheared image wholly inside: |det| over page area
  const shear = [200, 0, 50, 100, 100, 100];
  assert.ok(Math.abs(draw(shear) - Math.abs(200 * 100) / (600 * 400)) < 0.001);
});

// ── Letter spotting ───────────────────────────────────────────────────────
import { glyphRow, strokeGlyphRow, fixtureLine, place as placeSym, LIBRARY as LIB3, SWEEP_LIBRARY as SWEEP3 } from './fixtures/symbol-check-sheet.js';
const widgetOf = lib => lib.symbols.find(s => s.name === 'WIDGET');
const seq = (a, n) => Array.from({ length: n }, (_, i) => a + i);

test('spotLetters: a filled row of 5 at 7 pt is one row and every path is spotted; the same row vertical is a vertical row', () => {
  const paths = glyphRow(50, 50, 5);
  const s = R.spotLetters(paths);
  assert.deepEqual(s, { members: [0, 1, 2, 3, 4], glyphs: 5, rows: 1, capped: 0 });
  assert.equal(R.letterRows(R.glyphsOf(paths))[0].vertical, false);
  const v = glyphRow(50, 50, 5, { vertical: true });
  assert.equal(R.spotLetters(v).rows, 1);
  assert.deepEqual(R.spotLetters(v).members, [0, 1, 2, 3, 4]);
  assert.equal(R.letterRows(R.glyphsOf(v))[0].vertical, true);
});

test('spotLetters: a stroked row of 4 glyphs of 3 strokes removes 12 paths in one row', () => {
  const paths = strokeGlyphRow(50, 50, 4);
  const g = R.glyphsOf(paths);
  assert.equal(g.length, 4);
  assert.ok(g.every(x => x.kind === 'stroked' && x.members.length === 3));
  const r = R.removeSpottedLetters([...paths, fixtureLine([300, 300, 340, 300])]);
  assert.equal(r.removed, 12);
  assert.equal(r.rows, 1);
  assert.equal(r.paths.length, 1);
});

test('spotLetters: two glyphs alone are not a row', () => {
  assert.deepEqual(R.spotLetters(glyphRow(50, 50, 2)), { members: [], glyphs: 2, rows: 0, capped: 0 });
});

test('symbol ink kept: a filled WIDGET beside a row is not spotted and the sweep still finds it', () => {
  const widget = placeSym(widgetOf(LIB3), { x: 120, y: 50, fill: true });
  const paths = [...glyphRow(50, 50, 5), ...widget];
  const s = R.spotLetters(paths);
  assert.equal(s.rows, 1);
  assert.deepEqual(s.members, [0, 1, 2, 3, 4]);
  const left = R.removeSpottedLetters(paths).paths;
  assert.equal(left.length, 2);
  const r = C.sweepSymbols({ paths: left, library: SWEEP3, pageSize: [300, 200] });
  assert.ok(r.spots.some(sp => sp.matches[0].p.symbol.name === 'WIDGET'), 'WIDGET still found');
});

test('symbol ink kept: a WIDGET in line with a row of 5 is not taken (heights differ)', () => {
  const paths = [...glyphRow(50, 50, 5), ...placeSym(widgetOf(LIB3), { x: 82, y: 45, fill: true })];
  assert.deepEqual(R.spotLetters(paths).members, [0, 1, 2, 3, 4]);
});

test('symbol ink kept: 6 filled 1.5 pt junction dots 40 pt apart are nothing; a dashed line is nothing', () => {
  const dot = x => ({ segs: [x, 100, x + 1.5, 100, x + 1.5, 101.5, x, 101.5, x, 100], width: 0.5, stroked: false, filled: true, grey: 0 });
  assert.equal(R.spotLetters(seq(0, 6).map(i => dot(20 + i * 40))).rows, 0);
  const dashes = seq(0, 10).map(i => fixtureLine([20 + i * 5, 100, 23 + i * 5, 100]));
  assert.deepEqual(R.spotLetters(dashes).members, []);
  const vdashes = seq(0, 10).map(i => fixtureLine([100, 20 + i * 5, 100, 23 + i * 5]));
  assert.deepEqual(R.spotLetters(vdashes).members, []);
});

test('spotLetters: a 12 pt glyph in a 7 pt row is not in the row', () => {
  const a = glyphRow(50, 50, 4), aEnd = Math.max(...a.flatMap(p => p.segs.filter((_, k) => k % 2 === 0)));
  const big = glyphRow(aEnd + 1.5, 45, 1, { h: 12 }), bigEnd = Math.max(...big[0].segs.filter((_, k) => k % 2 === 0));
  const b = glyphRow(bigEnd + 1.5, 50, 4);
  const s = R.spotLetters([...a, ...big, ...b]);
  assert.ok(!s.members.includes(4), 'the 12 pt glyph is kept');
  assert.equal(s.members.length, 8);
});

test('spotLetters: a 16 pt stroke inside a row box is kept', () => {
  const stroke = fixtureLine([52, 52, 52, 68]);
  const paths = [...glyphRow(50, 50, 5), stroke];
  const s = R.spotLetters(paths);
  assert.deepEqual(s.members, [0, 1, 2, 3, 4]);
});

test('spotLetters: 20,000 invented strokes in 2,000 rows are spotted in under 2 s', () => {
  const paths = [];
  for (let r = 0; r < 2000; r++) paths.push(...strokeGlyphRow(10 + Math.floor(r / 100) * 60, 10 + (r % 100) * 12, 5, { strokes: 2 }));
  assert.equal(paths.length, 20000);
  const t0 = performance.now();
  const s = R.spotLetters(paths);
  const ms = performance.now() - t0;
  console.log(`spotLetters 20000 strokes: ${ms.toFixed(0)} ms`);
  assert.equal(s.rows, 2000);
  assert.equal(s.members.length, 20000);
  assert.ok(ms < 2000, `took ${ms} ms`);
});

test('spotLetters: hostile input gives nothing and never throws', () => {
  const none = { members: [], glyphs: 0, rows: 0, capped: 0 };
  assert.deepEqual(R.spotLetters(null), none);
  assert.deepEqual(R.spotLetters('x'), none);
  const bad = [null, 3, { segs: [0, 0, NaN, 4] }, { segs: [0, 0, 'x', 1] }, { segs: [0, 0, 5, 5, 6] }, { segs: [0, 0, 5] }, { segs: null }, { segs: [Infinity, 0, 1, 1], filled: true }];
  assert.deepEqual(R.spotLetters(bad), none);
  assert.deepEqual(R.removeSpottedLetters(bad).paths, bad);
  assert.deepEqual(R.removeSpottedLetters(null), { paths: [], removed: 0, rows: 0, capped: 0 });
  assert.deepEqual(R.letterRows(null), []);
  assert.deepEqual(R.letterRows([null, { box: [NaN, 0, 1, 1], kind: 'filled' }]), []);
  assert.deepEqual(R.glyphsOf(undefined), []);
});

test('huge finite coordinates are not glyphs and return at once (no endless loop)', () => {
  const paths = [0, 1, 2, 3].map(i => ({ segs: [1e18, 10 + 9 * i, 1e18, 17 + 9 * i, 1e18 + 4, 17 + 9 * i, 1e18, 10 + 9 * i], width: 1, stroked: false, filled: true, grey: 0 }));
  const strokes = [0, 1, 2, 3].map(i => fixtureLine([1e18, 10 + 9 * i, 1e18, 17 + 9 * i]));
  const t0 = performance.now();
  assert.deepEqual(R.spotLetters([...paths, ...strokes]), { members: [], glyphs: 0, rows: 0, capped: 0 });
  assert.ok(performance.now() - t0 < 200);
});

test('repeated identical shapes are symbol linework: three filled WIDGETs 4 pt apart are not spotted and the sweep finds all three', () => {
  const paths = [20, 48, 76].flatMap(x => placeSym(widgetOf(LIB3), { x, y: 50, fill: true }));
  assert.deepEqual(R.spotLetters(paths).members, []);
  const left = R.removeSpottedLetters(paths).paths;
  assert.equal(left.length, 6);
  const r = C.sweepSymbols({ paths: left, library: SWEEP3, pageSize: [300, 200] });
  assert.equal(r.spots.filter(sp => sp.matches[0].p.symbol.name === 'WIDGET').length, 3);
});

test('repeated identical shapes: a run of 4 filled arrowheads 3 pt apart is not spotted', () => {
  const arrow = x => ({ segs: [x, 50, x + 6, 52.5, x + 6, 52.5, x, 55, x, 55, x, 50], width: 0.5, stroked: false, filled: true, grey: 0 });
  assert.deepEqual(R.spotLetters([0, 1, 2, 3].map(i => arrow(20 + i * 9))).members, []);
});

test('known limit: stroked letters set 0.3 pt apart merge into one over-size blob and are not spotted', () => {
  const paths = strokeGlyphRow(50, 50, 4, { gap: 0.3 });
  const s = R.spotLetters(paths);
  assert.deepEqual(s, { members: [], glyphs: 0, rows: 0, capped: 0 });
});

test('capped: more than 256 strokes piled in one cell are counted, not skipped silently', () => {
  const paths = Array.from({ length: 300 }, (_, i) => fixtureLine([2 + i * 0.01, 2, 3 + i * 0.01, 2]));
  const s = R.spotLetters(paths);
  assert.ok(s.capped > 0, 'capped ' + s.capped);
  assert.equal(R.removeSpottedLetters(paths).capped, s.capped);
});

// ── Slice rule: the cut-up fill of one shape is not letters ───────────────
// A filled closed path of straight edges, cut into n horizontal slices (each its own filled path).
function sliceFilled(path, n) {
  const pts = [];
  for (let i = 0; i < path.segs.length; i += 4) pts.push([path.segs[i], path.segs[i + 1]]);
  const ys = pts.map(p => p[1]), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const clip = (poly, keep, edge) => {
    const out = [];
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length], ina = keep(a), inb = keep(b);
      if (ina) out.push(a);
      if (ina !== inb) { const t = (edge - a[1]) / (b[1] - a[1]); out.push([a[0] + t * (b[0] - a[0]), edge]); }
    });
    return out;
  };
  const out = [];
  for (let k = 0; k < n; k++) {
    const lo = y0 + (y1 - y0) * k / n, hi = y0 + (y1 - y0) * (k + 1) / n;
    const poly = clip(clip(pts, p => p[1] >= lo, lo), p => p[1] <= hi, hi);
    if (poly.length < 3) continue;
    out.push({ ...path, stroked: false, segs: poly.flatMap((p, i) => [...p, ...poly[(i + 1) % poly.length]]) });
  }
  return out;
}
// Drawn as a printer does: the outline, and the fill cut into slices.
const slicedWidget = (x, y) => [...placeSym(widgetOf(LIB3), { x, y }),
  ...placeSym(widgetOf(LIB3), { x, y, fill: true }).flatMap(p => (p.filled ? sliceFilled(p, 8) : []))];

test('slice rule: a filled WIDGET with each triangle cut into 8 slices is not spotted, and the sweep still finds it', () => {
  const paths = slicedWidget(120, 50);
  assert.ok(paths.length >= 14, String(paths.length));
  assert.deepEqual(R.spotLetters(paths).members, []);
  assert.equal(R.removeSpottedLetters(paths).removed, 0);
  const r = C.sweepSymbols({ paths, library: SWEEP3, pageSize: [300, 200] });
  assert.ok(r.spots.some(sp => sp.matches[0].p.symbol.name === 'WIDGET'), 'WIDGET still found');
});

test('slice rule: the sliced WIDGET beside a filled row of 5 leaves only the row spotted', () => {
  const row = glyphRow(50, 50, 5), widget = slicedWidget(120, 50);
  const s = R.spotLetters([...row, ...widget]);
  assert.deepEqual(s.members, [0, 1, 2, 3, 4]);
  assert.equal(s.rows, 1);
  assert.equal(R.removeSpottedLetters([...row, ...widget]).paths.length, widget.length);
});

test('slice rule: pieces that merely overlap or sit 0.5 pt apart are not joined; a row with 0.5 pt gaps still spots', () => {
  assert.deepEqual(R.spotLetters(glyphRow(50, 50, 5, { gap: 0.5 })), { members: [0, 1, 2, 3, 4], glyphs: 5, rows: 1, capped: 0 });
  // Kerned: boxes overlap by 0.3 pt, so they are separate glyphs still.
  assert.equal(R.glyphsOf(glyphRow(50, 50, 5, { gap: -0.3 })).length, 5);
});

test('slice rule: two filled letters touching exactly inside a row join into one glyph, and the row of 4 still spots every path', () => {
  const row = glyphRow(50, 50, 5);
  row[2] = { ...row[2], segs: row[2].segs.map((v, k) => (k % 2 === 0 ? v - 1.5 : v)) };   // letter 3 now touches letter 2 (gap 0, same height)
  const g = R.glyphsOf(row);
  assert.equal(g.length, 4);
  assert.deepEqual(g.find(x => x.members.length === 2).members, [1, 2]);
  let s;
  assert.doesNotThrow(() => { s = R.spotLetters(row); });
  assert.deepEqual(s.members, [0, 1, 2, 3, 4]);
  assert.equal(s.rows, 1);
});

test('capped: 300 abutting filled pieces piled in one cell are counted, not skipped silently, and never throw', () => {
  const piece = i => ({ segs: [2, 2 + i * 0.01, 3, 2 + i * 0.01, 3, 4 + i * 0.01, 3, 4 + i * 0.01, 3, 4 + i * 0.01, 2, 4 + i * 0.01, 2, 4 + i * 0.01, 2, 2 + i * 0.01], width: 0.5, stroked: false, filled: true, grey: 0 });
  const paths = Array.from({ length: 300 }, (_, i) => piece(i));
  let s;
  assert.doesNotThrow(() => { s = R.spotLetters(paths); });
  assert.ok(s.capped > 0, 'capped ' + s.capped);
  assert.equal(R.removeSpottedLetters(paths).capped, s.capped);
});
