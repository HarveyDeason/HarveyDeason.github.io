// Task 1 of the shape-check redesign: the drawing area (frame, title strip, bottom-right block). Invented sheets only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../assets/js/pid-symbol-check.js';

const line = (x0, y0, x1, y1) => ({ segs: [x0, y0, x1, y1], width: 1, stroked: true, filled: false, grey: 0 });
const frame = (W, H, m = 20) => [line(m, m, W - m, m), line(m, H - m, W - m, H - m), line(m, m, m, H - m), line(W - m, m, W - m, H - m)];
const round = a => a.map(Math.round);

// 1000 x 700 page, frame at 20 pt, divider at x = 800 in 3 pieces (64% of the height), rows at y = 300 and 500.
const divider = (pieces, x = 800) => pieces.map(([a, b]) => line(x, a, x, b));
const FULL = [[20, 240], [242, 460], [462, 680]];            // ~100% of the height, small gaps
const STRIP = [...frame(1000, 700), ...divider([[20, 160], [160.3, 300], [300.3, 468]]), line(800, 300, 980, 300), line(800, 500, 980, 500)];
const STRIP_FULL = [...frame(1000, 700), ...divider(FULL), line(800, 300, 980, 300), line(800, 500, 980, 500)];

test('a frame and a full-height title strip: the area is the frame left of the strip', () => {
  const a = C.drawingArea(STRIP_FULL, [1000, 700]);
  assert.equal(a.found, true);
  assert.deepEqual(round(a.box), [20, 20, 980, 680]);
  assert.deepEqual(a.cuts.map(round), [[800, 20, 980, 680]]);
});

test('a divider drawn in pieces covering 64% of the height is a strip', () => {
  const a = C.drawingArea(STRIP, [1000, 700]);
  assert.deepEqual(a.cuts.map(round), [[800, 20, 980, 680]]);
});

test('a divider covering under half the height is no strip', () => {
  const paths = [...frame(1000, 700), ...divider([[20, 160], [160.3, 280]]), line(800, 300, 980, 300), line(800, 500, 980, 500)];
  const a = C.drawingArea(paths, [1000, 700]);
  assert.equal(a.found, true);
  assert.deepEqual(a.cuts, []);
});

test('a divider with only one row line to the frame edge is no strip', () => {
  const paths = [...frame(1000, 700), ...divider(FULL), line(800, 300, 980, 300)];
  assert.deepEqual(C.drawingArea(paths, [1000, 700]).cuts, []);
});

test('a bottom-right title block not full height is cut from its top and left lines', () => {
  const paths = [...frame(1000, 700), line(700, 520, 980, 520), line(700, 520, 700, 680)];
  const a = C.drawingArea(paths, [1000, 700]);
  assert.equal(a.found, true);
  assert.deepEqual(a.cuts.map(round), [[700, 520, 980, 680]]);
});

test('the frame is the innermost long line on each side (a double border)', () => {
  const a = C.drawingArea([...frame(1000, 700, 10), ...frame(1000, 700, 20)], [1000, 700]);
  assert.equal(a.found, true);
  assert.deepEqual(round(a.box), [20, 20, 980, 680]);
});

test('a long pipe across the middle of the sheet is not the frame', () => {
  const a = C.drawingArea([...frame(1000, 700), line(50, 350, 950, 350)], [1000, 700]);
  assert.deepEqual(round(a.box), [20, 20, 980, 680]);
  assert.deepEqual(a.cuts, []);
});

test('a turned sheet: frame and strip found in shown coordinates', () => {
  // the same sheet turned: shown 700 x 1000, the strip on the shown right
  const paths = [...frame(700, 1000), ...divider([[20, 300], [300.3, 560], [560.3, 980]], 500), line(500, 400, 680, 400), line(500, 700, 680, 700)];
  const a = C.drawingArea(paths, [700, 1000]);
  assert.equal(a.found, true);
  assert.deepEqual(round(a.box), [20, 20, 680, 980]);
  assert.deepEqual(a.cuts.map(round), [[500, 20, 680, 980]]);
});

test('no frame: found false, and insideArea keeps every box', () => {
  const a = C.drawingArea([], [1000, 700]);
  assert.equal(a.found, false);
  assert.deepEqual(a.cuts, []);
  assert.deepEqual(a.box, [0, 0, 1000, 700]);
  assert.equal(C.insideArea(a, [0, 0, 5, 5]), true);
});

test('only three sides of a frame: found false', () => {
  const [t, b, l] = frame(1000, 700);
  assert.equal(C.drawingArea([t, b, l], [1000, 700]).found, false);
});

test('insideArea: touching the frame within 4 pt, or the strip within 2 pt, is outside', () => {
  const a = C.drawingArea(STRIP_FULL, [1000, 700]);
  assert.equal(C.insideArea(a, [23, 100, 40, 120]), false);   // 3 pt from the frame
  assert.equal(C.insideArea(a, [25, 100, 40, 120]), true);
  assert.equal(C.insideArea(a, [760, 100, 799, 120]), false); // 1 pt from the strip
  assert.equal(C.insideArea(a, [760, 100, 790, 120]), true);
  assert.equal(C.insideArea(a, [850, 100, 900, 120]), false); // in the strip
});

test('the exported constants are the measured values', () => {
  assert.deepEqual([C.FRAME_LONG, C.FRAME_ZONE, C.STRIP_ZONE, C.STRIP_COVER, C.STRIP_ROWS, C.FRAME_TOUCH, C.CUT_TOUCH],
    [0.6, 0.15, 0.3, 0.5, 2, 4, 2]);
});

test('drawingArea and insideArea with hostile input never throw', () => {
  const hostile = [null, undefined, 'x', 5, [null, { segs: 'x' }, { segs: [NaN, 0, 1, Infinity] }, { segs: [1, 2] }, { grey: 'a' }]];
  for (const p of hostile) for (const s of [null, 'x', [NaN, 5], [0, 0], [-1, 10], [1000, 700], undefined]) {
    const a = C.drawingArea(p, s);
    assert.equal(a.found, false);
    assert.deepEqual(a.cuts, []);
    assert.equal(typeof C.insideArea(a, [0, 0, 1, 1]), 'boolean');
  }
  assert.equal(C.drawingArea([], 'x').box, null);
  for (const a of [null, undefined, 'x', {}, { found: true }, { found: true, box: 'x', cuts: 5 }, { found: true, box: [0, 0, 10, 10], cuts: [null, 'x'] }])
    for (const b of [null, 'x', [NaN, 0, 1, 1], [0, 0, 1], undefined]) assert.equal(typeof C.insideArea(a, b), 'boolean');
});
