// Whole-shape verdicts: cutting a found symbol's own pipe off its shape. Invented sheets only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../assets/js/pid-symbol-check.js';
import { OPERATOR_LIBRARY, SHAPE_SHEET, strokeGlyphRow, place, fixtureLine as line } from './fixtures/symbol-check-sheet.js';

const WIDGET = OPERATOR_LIBRARY.symbols.find(s => s.name === 'WIDGET');
const GADGET = OPERATOR_LIBRARY.symbols.find(s => s.name === 'GADGET');
const RING = OPERATOR_LIBRARY.symbols.find(s => s.name === 'RING');
const HANDLE = OPERATOR_LIBRARY.symbols.find(s => s.name === 'HANDLE');
const loop = pts => line(pts.flatMap((p, i) => [...p, ...pts[(i + 1) % pts.length]]));
// An invented symbol with stems on its top and bottom edges at x = 5.
const STEMMED = { ...WIDGET, id: 'x1', name: 'STEMMED', w: 10, h: 12,
  paths: [line([5, 0, 5, 3]), line([5, 9, 5, 12]), loop([[2, 3], [8, 3], [8, 9], [2, 9]])] };
const prepOf = sym => C.prepareSymbols({ ...OPERATOR_LIBRARY, symbols: [sym] })[0];
const prep = n => prepOf(OPERATOR_LIBRARY.symbols.find(s => s.name === n));

const run = paths => C.checkSheet({ pageSize: [300, 250], viewportTransform: [1, 0, 0, 1, 0, 0], textItems: [], tags: [], paths,
  library: OPERATOR_LIBRARY, lookups: {} });
const at = (r, x, y) => r.shapes.find(s => x >= s.box[0] - 1 && x <= s.box[2] + 1 && y >= s.box[1] - 1 && y <= s.box[3] + 1);
// A WIDGET at (x, y) with a stub of `len` either side.
const widgetWithStubs = (x, y, len) => [...place(WIDGET, { x, y }), line([x - len, y + 6, x, y + 6]), line([x + 24, y + 6, x + 24 + len, y + 6])];

test('pipeLines: a bowtie has no ends on its box edge off the corners, so its long axis', () => {
  assert.deepEqual(C.pipeLines(prep('WIDGET')), { axis: 'h', at: [6] });
});
test('pipeLines: a symbol with stubs on its top and bottom edges is cut vertically', () => {
  assert.deepEqual(C.pipeLines(prepOf(STEMMED)), { axis: 'v', at: [5] });
});
// Gate trace (2026-11-19, M): the legend's BALL is a bowtie with its ball touching the box's top and bottom. The arc's
// touch points are no pipe connections: the pipe runs along its length, as a bowtie's.
test('pipeLines: a circle touching the box edges is no connection; a bowtie with its ball runs along its length', () => {
  const ring = []; for (let k = 0; k < 32; k++) { const a0 = (k / 32) * 2 * Math.PI, a1 = ((k + 1) / 32) * 2 * Math.PI; ring.push(14.16 + 7.14 * Math.cos(a0), 7.14 + 7.14 * Math.sin(a0), 14.16 + 7.14 * Math.cos(a1), 7.14 + 7.14 * Math.sin(a1)); }
  const BALLISH = { id: 'bp1', name: 'BALLISH', legendName: 'BALLISH', group: 'VALVES', tagId: 'V', sheet: '2', w: 28.32, h: 14.28, aliases: [], notes: [], letters: [],
    flags: { simple: false, stretch: false, manual: false, unmatched: false },
    paths: [{ segs: ring, width: 0.7, stroked: true, filled: false, grey: 0 },
      { segs: [0, 0.1, 0, 14.28, 0, 14.28, 28.32, 0.1, 28.32, 0.1, 28.32, 14.28, 28.32, 14.28, 0, 0.1], width: 0.7, stroked: true, filled: false, grey: 0 }] };
  assert.deepEqual(C.pipeLines(prepOf(BALLISH)), { axis: 'h', at: [7.14] });
});
test('pipeLines: a ring (bubble), an operator and a square symbol with no stubs give null', () => {
  assert.equal(C.pipeLines(prep('RING')), null);
  assert.equal(C.pipeLines(prep('HANDLE')), null);
  assert.equal(C.pipeLines(prep('GADGET')), null);
  assert.equal(C.pipeLines(null), null);
  assert.equal(C.pipeLines({ w: NaN, h: 3, segs: 'x' }), null);
});

// A flow arrow on a stub's far end joins the stub to the shape (the splitter keeps the arrowhead with it); the arrow is not judged ink.
test('a WIDGET with 8 pt pipe stubs, shorter than the long run, each ending in a flow arrow: standard after the cut', () => {
  const paths = [...place(WIDGET, { x: 100, y: 100 }), line([92, 106, 100, 106]), loop([[92, 102], [92, 110], [86, 106]]),
    line([124, 106, 132, 106]), loop([[132, 102], [132, 110], [138, 106]])];
  const s = at(run(paths), 112, 106);
  assert.ok(s, 'a shape there');
  assert.equal(s.standard, true, JSON.stringify(s));
  assert.equal(s.why, null);
});

test('the same WIDGET turned 90 degrees: the vertical stubs are cut', () => {
  const paths = [...place(WIDGET, { x: 100, y: 100, o: 1 }), line([106, 92, 106, 100]), loop([[102, 92], [110, 92], [106, 86]]),
    line([106, 124, 106, 132]), loop([[102, 132], [110, 132], [106, 138]])];
  const s = at(run(paths), 106, 112);
  assert.ok(s, 'a shape there');
  assert.equal(s.standard, true, JSON.stringify(s));
});

test('stubs that end in a cross tick: the straight stubs are cut, the ticks stay as extra linework', () => {
  const stubs = [...widgetWithStubs(100, 100, 8), line([92, 102, 92, 110]), line([132, 102, 132, 110])];
  const s = at(run(stubs), 112, 106);
  assert.equal(s.standard, false, JSON.stringify(s));
  assert.equal(s.why, 'left-over');
  // The ticks are about 17% of the ink left once the stubs are cut (0.83); stubs left on would give about 0.71.
  assert.ok(s.explained > 0.8, 'only the ticks are left over, not the stubs: ' + s.explained);
  // Legend rules (2026-11-18): an operator stands on its body, never out on the pipe past the body's ends.
  assert.equal(s.operator, null, JSON.stringify(s));
});

test('a stub that turns a corner: the straight part is cut, the bend stays as extra linework', () => {
  const paths = [...widgetWithStubs(100, 100, 8), line([92, 106, 92, 98])];
  const s = at(run(paths), 112, 106);
  assert.ok(s, 'a shape there');
  assert.equal(s.standard, false, JSON.stringify(s));
  assert.equal(s.why, 'left-over');
  assert.ok(s.box[0] <= 92.5 && s.box[0] >= 91.5, 'the bend is still in the shape: ' + JSON.stringify(s.box));
  assert.equal(s.verdict, 'not-standard');
  assert.deepEqual(s.reason, { kind: 'extra', name: 'WIDGET' });
  assert.ok(s.explained > 0.9, 'the straight stub is not counted as left over: ' + s.explained);
});

// cutPipe on hand-made segments: [x0, y0, x1, y1, len, pathIndex].
const seg = (x0, y0, x1, y1, i = 0) => [x0, y0, x1, y1, Math.hypot(x1 - x0, y1 - y0), i];
const hitAt = (x, y, p = prep('WIDGET')) => ({ p, placement: { o: 0, k: 1, tx: x, ty: y, cx: x + p.w / 2, cy: y + p.h / 2 }, score: 1 });

test('a tee 6 pt from the WIDGET: the cut stops at the junction, the branch stays', () => {
  const S = [seg(124, 106, 130, 106), seg(130, 106, 130, 90), seg(130, 106, 160, 106)];
  assert.deepEqual(C.cutPipe(S, [0, 1, 2], hitAt(100, 100)), [0]);
});

test('cutPipe grows along collinear pieces and stops at the first junction', () => {
  const S = [seg(124, 106, 130, 106), seg(130, 106, 140, 106), seg(140, 106, 150, 106), seg(140, 106, 140, 90)];
  assert.deepEqual(C.cutPipe(S, [0, 1, 2, 3], hitAt(100, 100)).sort(), [0, 1]);
});

test('a stroke off the pipe axis is not cut (extra linework)', () => {
  const S = [seg(124, 108, 132, 108), seg(124, 106, 130, 100), seg(124, 106, 132, 106.5)];
  assert.deepEqual(C.cutPipe(S, [0, 1, 2], hitAt(100, 100)), []);
});

test('pieces inside the symbol box are never cut', () => {
  const S = [seg(110, 106, 114, 106)];
  assert.deepEqual(C.cutPipe(S, [0], hitAt(100, 100)), []);
});

test('cutPipe with hostile input gives [] and never throws', () => {
  const S = [seg(124, 106, 132, 106)];
  for (const args of [[null, null, null], [S, [0], null], [S, [0], {}], [S, [0], { p: {}, placement: {} }], [S, 'x', hitAt(100, 100)],
    [S, [7, NaN, 'a'], hitAt(100, 100)], [[null, [1]], [0, 1], hitAt(100, 100)], [S, [0], { ...hitAt(100, 100), placement: { o: 9, k: -1, tx: NaN, ty: 0 } }], [undefined, undefined, undefined]]) {
    assert.deepEqual(C.cutPipe(...args), []);
  }
});

// ── Task 4: sheet scale, the size rule and the three verdicts ─────────────
const RUN_SHAPES = C.checkSheet({ ...SHAPE_SHEET, library: OPERATOR_LIBRARY, lookups: {} });
// `sizeScale` is read from options by checkSheet until the sheet's own scale is measured and passed (a test hook, nothing more).
const runAt = (paths, extra = {}) => C.checkSheet({ pageSize: [300, 250], viewportTransform: [1, 0, 0, 1, 0, 0], textItems: [], tags: [], paths, library: OPERATOR_LIBRARY, lookups: {}, ...extra });
const widgetAt = (k, extra) => at(runAt(place(WIDGET, { x: 100, y: 100, k }), extra), 100 + 12 * k, 100 + 6 * k);

test('the pinned settings', () => {
  assert.equal(C.AMBER_ALIKE, 0.8); assert.equal(C.AMBER_EXPLAINED, 0.5); assert.equal(C.SIZE_TOL, 0.15); assert.deepEqual(C.JUDGE_BAND, [0.6, 1.6]);
  assert.equal(C.SCALE_SYMBOLS_MIN, 5);
});
test('sizeScaleOf: the median of five or more; 1 for four', () => {
  assert.equal(C.sizeScaleOf([1, 1, 1, 0.75, 0.75].map(k => ({ k }))), 1);
  assert.equal(C.sizeScaleOf([0.4, 0.41, 0.42, 0.4, 0.43].map(k => ({ k }))), 0.41);
  assert.equal(C.sizeScaleOf([0.5, 0.5, 0.5, 0.5].map(k => ({ k }))), 1);
  assert.equal(C.sizeScaleOf(null), 1);
  assert.equal(C.sizeScaleOf([1, 'x', null, NaN, 1, 1, 1, 1].map(k => ({ k }))), 1);
});
test('hitSize: the longer side of the placed box over the legend symbol; a box fit gives its fitted scale', () => {
  assert.equal(C.hitSize(hitAt(10, 10)), 1);
  const h = hitAt(10, 10); h.placement.k = 1.25;
  assert.equal(C.hitSize(h), 1.25);
  const f = hitAt(10, 10); f.placement.fitK = 1.3;
  assert.equal(C.hitSize(f), 1.3);
  assert.equal(C.hitSize(null), 1);
});

test('a WIDGET drawn alone at 70% among WIDGETs at full size: amber, drawn at 70% of standard size', () => {
  const s = widgetAt(0.7);
  assert.equal(s.verdict, 'not-standard', JSON.stringify(s));
  assert.deepEqual(s.reason, { kind: 'size', name: 'WIDGET', pct: 70 });
  assert.equal(s.standard, false);
});
test('a WIDGET at 110%: green (inside 15%)', () => {
  const s = widgetAt(1.1);
  assert.equal(s.verdict, 'standard', JSON.stringify(s)); assert.equal(s.reason, null); assert.equal(s.standard, true);
});
test('a WIDGET at 120% on a sheet whose symbols are all at 120%: green (judged against the sheet scale); on a full-size sheet it is amber', () => {
  const s = widgetAt(1.2, { options: { sizeScale: 1.2 } });
  assert.equal(s.verdict, 'standard', JSON.stringify(s));
  const t = widgetAt(1.2);
  assert.equal(t.verdict, 'not-standard', JSON.stringify(t));
  assert.deepEqual(t.reason, { kind: 'size', name: 'WIDGET', pct: 120 });
});
// An invented TAPER, 21 across and 28 long, drawn 1.3 times wider and the same length, on a long pipe.
test('a stretched fit is judged on its larger side: 1.3 across, 1.0 along is 130%', () => {
  const ln = segs => line(segs);
  const TAPER = { id: 't1', name: 'TAPER', legendName: 'TAPER', group: 'TAPERS', tagId: 'Q', sheet: '1', w: 21, h: 28, letters: [], aliases: [], notes: [],
    flags: { simple: false, stretch: false, manual: false, unmatched: false },
    paths: [ln([0, 28, 0, 0]), ln([0, 28, 21, 21]), ln([21, 21, 21, 7]), ln([21, 7, 0, 0])] };
  const lib = { ...OPERATOR_LIBRARY, symbols: [...OPERATOR_LIBRARY.symbols, TAPER] };
  const X = v => 100 + v * 1.3;
  const drawn = [ln([X(0), 128, X(0), 100]), ln([X(0), 128, X(21), 121]), ln([X(21), 121, X(21), 107]), ln([X(21), 107, X(0), 100]),
    ln([20, 114, X(0), 114]), ln([X(21), 114, 200, 114])];
  const r = runAt(drawn, { library: lib });
  const s = r.shapes.find(x => x.box[0] <= 101 && x.box[2] >= 125);
  assert.equal(s.verdict, 'not-standard', JSON.stringify(r.shapes));
  assert.deepEqual(s.reason, { kind: 'size', name: 'TAPER', pct: 130 });
});

test('a WIDGET with an extra stroke off its pipe: amber, WIDGET with extra linework', () => {
  const s = at(RUN_SHAPES, 352, 66);
  assert.equal(s.verdict, 'not-standard', JSON.stringify(s));
  assert.deepEqual(s.reason, { kind: 'extra', name: 'WIDGET' });
  assert.equal(s.standard, false);
});

// The verdict on its own: shapeVerdict({ bodies: [{ name, size }], explained, closest, sizeScale }).
const closestOf = (name, score, explained) => ({ name, score, explained });
test('shapeVerdict: a body that explains under half its shape is red with no reason', () => {
  const v = C.shapeVerdict({ bodies: [{ name: 'WIDGET', size: 1 }], explained: 0.3, closest: closestOf('WIDGET', 1, 0.3), sizeScale: 1 });
  assert.deepEqual(v, { verdict: 'not-identified', reason: null });
});
test('shapeVerdict: a body that explains half or more, with ink left over: extra; and off size when it is', () => {
  assert.deepEqual(C.shapeVerdict({ bodies: [{ name: 'WIDGET', size: 1 }, { name: 'B', size: 1 }], explained: 0.5, closest: null, sizeScale: 1 }),
    { verdict: 'not-standard', reason: { kind: 'extra', name: 'WIDGET' } });
  assert.deepEqual(C.shapeVerdict({ bodies: [{ name: 'WIDGET', size: 0.7 }], explained: 0.8, closest: null, sizeScale: 1 }),
    { verdict: 'not-standard', reason: { kind: 'size', name: 'WIDGET', pct: 70 } });
  assert.deepEqual(C.shapeVerdict({ bodies: [{ name: 'WIDGET', size: 1 }], explained: 0.97, closest: null, sizeScale: 1 }), { verdict: 'standard', reason: null });
});
test('shapeVerdict: the worst size of several bodies is the one named', () => {
  const v = C.shapeVerdict({ bodies: [{ name: 'A', size: 1.2 }, { name: 'B', size: 0.6 }], explained: 1, closest: null, sizeScale: 1 });
  assert.deepEqual(v, { verdict: 'not-standard', reason: { kind: 'size', name: 'B', pct: 60 } });
});
test('shapeVerdict: no body, closest 0.86 explaining 0.6: amber, drawn differently from GADGET (86% alike)', () => {
  assert.deepEqual(C.shapeVerdict({ bodies: [], explained: 0, closest: closestOf('GADGET', 0.86, 0.6), sizeScale: 1 }),
    { verdict: 'not-standard', reason: { kind: 'differs', name: 'GADGET', pct: 86 } });
});
test('shapeVerdict: no body, closest 0.86 explaining 0.3: red; closest 0.7 explaining 1: red; nothing close: red', () => {
  const red = { verdict: 'not-identified', reason: null };
  assert.deepEqual(C.shapeVerdict({ bodies: [], explained: 0, closest: closestOf('GADGET', 0.86, 0.3), sizeScale: 1 }), red);
  assert.deepEqual(C.shapeVerdict({ bodies: [], explained: 0, closest: closestOf('GADGET', 0.7, 1), sizeScale: 1 }), red);
  assert.deepEqual(C.shapeVerdict({ bodies: [], explained: 0, closest: null, sizeScale: 1 }), red);
});
test('shapeVerdict: only operators (no body) takes the closest rule; hostile input never throws', () => {
  assert.deepEqual(C.shapeVerdict({ bodies: [], explained: 0.2, closest: closestOf('HANDLE', 0.9, 0.9), sizeScale: 1 }).reason, { kind: 'differs', name: 'HANDLE', pct: 90 });
  for (const bad of [null, undefined, {}, { bodies: 'x' }, { bodies: [null, { size: NaN }], explained: 'a' }]) assert.doesNotThrow(() => C.shapeVerdict(bad));
});

// The GADGET with its diagonal drawn 60% long (SHAPE_SHEET, at 470, 70): measured with the sweep and the judge as they stand.
test('the GADGET with its diagonal drawn 60% long: amber, drawn differently from GADGET; the old reason stays', () => {
  const s = at(RUN_SHAPES, 470, 70);
  assert.ok(s.closest.score >= 0.8 && s.closest.explained >= 0.5, JSON.stringify(s.closest));
  assert.equal(s.verdict, 'not-standard', JSON.stringify(s));
  assert.deepEqual(s.reason, { kind: 'differs', name: 'GADGET', pct: Math.round(s.closest.score * 100) });
  assert.equal(s.reason.pct, 91);
  assert.equal(s.why, 'short-line');
});

test('past the time limit: not-judged, standard null', () => {
  const r = runAt(place(WIDGET, { x: 100, y: 100 }), { options: { timeLimitMs: 1 } });
  assert.ok(r.shapes.length);
  for (const s of r.shapes) { assert.equal(s.verdict, 'not-judged'); assert.equal(s.reason, null); assert.equal(s.standard, null); }
});
test('every ShapeOut has verdict and reason, and standard is true only for green', () => {
  assert.ok(RUN_SHAPES.shapes.length >= 8);
  for (const s of RUN_SHAPES.shapes) {
    assert.ok(['standard', 'not-standard', 'not-identified', 'not-judged'].includes(s.verdict), JSON.stringify(s));
    assert.ok('reason' in s);
    assert.equal(s.standard, s.verdict === 'standard' ? true : s.verdict === 'not-judged' ? null : false);
    if (s.verdict === 'not-standard') assert.ok(['differs', 'size', 'extra'].includes(s.reason.kind) && s.reason.name, JSON.stringify(s)); else assert.equal(s.reason, null);
  }
  assert.equal(at(RUN_SHAPES, 92, 66).verdict, 'standard');
  assert.equal(at(RUN_SHAPES, 595, 67).verdict, 'not-identified');
});

// A one-line symbol matches any line: a stray line is no DASH. judgeShapes called by hand on a shape that is one 12 pt line.
const strayShape = extra => {
  const paths = [line([100, 100, 112, 100])];
  const prepared = C.prepareSymbols(OPERATOR_LIBRARY);
  const split = { segments: [[100, 100, 112, 100, 12, 0]], shapes: [{ id: 0, pieces: [0], box: [100, 100, 112, 100], closed: false }], lines: [], arrows: [] };
  const out = C.judgeShapes({ prepared, boxed: paths.map(p => ({ b: [100, 100, 112, 100], p })), paths, split, writing: [], spots: [], near: [], rejected: [], ...extra });
  return { out, dash: prepared.find(p => p.symbol.name === 'DASH') };
};
test('a stray line with a one-line symbol in the library: red, never a DASH fit', () => {
  const { out } = strayShape();
  assert.equal(out.length, 1);
  assert.equal(out[0].verdict, 'not-identified', JSON.stringify(out[0]));
  assert.equal(out[0].reason, null);
  assert.equal(out[0].symbols.length, 0);
});
test('a one-line symbol as the closest candidate never makes an amber "drawn differently"', () => {
  const { dash } = strayShape();
  const near = [{ p: dash, placement: { o: 0, k: 1, tx: 100, ty: 100, cx: 106, cy: 100 }, score: 1 }];
  const { out } = strayShape({ near });
  assert.equal(out[0].verdict, 'not-identified', JSON.stringify(out[0]));
  assert.equal(out[0].reason, null);
});

// A ring with letters drawn as strokes inside it, and writing boxes over the letters.
const glyphs = strokeGlyphRow(110, 113, 3);
const WRITING = [[109.5, 112.5, 114.7, 120.5], [115.2, 112.5, 119.1, 120.5], [119.6, 112.5, 125.4, 120.5]];
test('bubble on a printed sheet: a ring with letter strokes under writing boxes is the bubble; an extra bar outside them is not', () => {
  const ring = place(RING, { x: 100, y: 100 });
  const good = runAt([...ring, ...glyphs], { writing: WRITING });
  const g = at(good, 120, 120);
  assert.equal(g.verdict, 'standard', JSON.stringify(g));
  assert.equal(g.closest.name, 'RING');
  const bar = runAt([...ring, ...glyphs, line([104, 130, 136, 130])], { writing: WRITING });
  const b = at(bar, 120, 120);
  assert.notEqual(b.verdict, 'standard', JSON.stringify(b));
});

test('a bubble is never the closest behind "differs"; a bare ring at a bubble’s size and the ringed tag are both green', () => {
  const bare = at(RUN_SHAPES, 220, 220), tagged = at(RUN_SHAPES, 80, 220);
  // Owner, 2026-11-20: a ring matching a legend bubble is standard even with no tag in it.
  assert.equal(bare.verdict, 'standard', JSON.stringify(bare));
  assert.equal(tagged.verdict, 'standard', JSON.stringify(tagged));
  assert.deepEqual(C.shapeVerdict({ bodies: [], explained: 0, closest: { name: 'RING', score: 1, explained: 1, bubble: true }, sizeScale: 1 }), { verdict: 'not-identified', reason: null });
});

// ── Task 5: the sheet: crop, sheet scale, reading method, tag promotion, result fields ──
import { SHEET, BUBBLE_SHEET, SWEEP_SHEET, BUBBLE_LIBRARY, SWEEP_LIBRARY, LIBRARY, LOOKUPS, label } from './fixtures/symbol-check-sheet.js';

const frameLines = (W, H, m = 20) => [line([m, m, W - m, m]), line([m, H - m, W - m, H - m]), line([m, m, m, H - m]), line([W - m, m, W - m, H - m])];
// A 600 x 400 page: a frame at 20 pt, a title strip right of x = 450 (divider in three pieces, two row lines), a WIDGET
// in the drawing (100, 100), one in the strip (480, 60), one standing across the frame's left line (8, 200).
const STRIP_PATHS = [line([450, 20, 450, 160]), line([450, 160.3, 450, 300]), line([450, 300.3, 450, 380]), line([450, 150, 580, 150]), line([450, 250, 580, 250])];
const FRAMED = [...frameLines(600, 400), ...STRIP_PATHS, ...widgetWithStubs(100, 100, 30), ...place(WIDGET, { x: 480, y: 60 }), ...place(WIDGET, { x: 8, y: 200 })];
const flip = paths => paths.map(p => ({ ...p, segs: p.segs.map((v, i, a) => a[i % 2 ? i - 1 : i + 1]) }));   // x and y swapped
const runPage = (paths, extra = {}) => C.checkSheet({ pageSize: [600, 400], viewportTransform: [1, 0, 0, 1, 0, 0], textItems: [], tags: [], paths, library: OPERATOR_LIBRARY, lookups: {}, ...extra });
const offOf = input => C.checkSheet({ library: OPERATOR_LIBRARY, lookups: {}, ...input, options: { ...input.options, shapes: false } });
const PAGE = { pageSize: [600, 400], viewportTransform: [1, 0, 0, 1, 0, 0], textItems: [], tags: [] };

test('a WIDGET in the title strip and one on the frame line are not judged; one in the area is', () => {
  const r = runPage(FRAMED);
  assert.equal(r.drawingArea.found, true);
  assert.deepEqual(r.drawingArea.cuts.map(c => c.map(Math.round)), [[450, 20, 580, 380]]);
  assert.equal(r.shapes.filter(s => !C.insideArea(r.drawingArea, s.box)).length, 0);
  assert.ok(r.shapes.some(s => s.box[0] > 65 && s.box[2] < 160 && s.verdict === 'standard'), 'the WIDGET in the area is judged: ' + JSON.stringify(r.shapes));
  assert.ok(!r.shapes.some(s => s.box[0] >= 440), 'nothing in the strip');
  assert.ok(!r.shapes.some(s => s.box[0] < 30 && s.box[1] > 150), 'nothing on the frame line');
  const none = offOf({ ...PAGE, paths: FRAMED });
  assert.deepEqual(r.symbols.map(s => [s.name, s.box]), none.symbols.map(s => [s.name, s.box]), 'the symbol list is unchanged');
});
test('shape ids run 0..n-1 after the crop and every symbol points at its shape or null', () => {
  const r = runPage(FRAMED);
  assert.ok(r.shapes.length >= 1 && r.symbols.length >= 1);
  r.shapes.forEach((s, i) => assert.equal(s.id, i));
  r.symbols.forEach((sy, i) => {
    assert.ok(sy.shape === null || r.shapes[sy.shape], JSON.stringify(sy));
    if (sy.shape !== null) { assert.ok(r.shapes[sy.shape].symbols.includes(i)); assert.equal(sy.standard, r.shapes[sy.shape].standard); }
    else assert.equal(sy.standard, null);
  });
});
test('a sheet with no frame: found false, the page edge, and every shape kept', () => {
  const r = C.checkSheet({ ...SHAPE_SHEET, library: OPERATOR_LIBRARY, lookups: {} });
  assert.deepEqual(r.drawingArea, { box: [0, 0, 900, 500], cuts: [], found: false });
  assert.equal(r.shapes.length, RUN_SHAPES.shapes.length);
  assert.ok(r.shapes.length >= 8);
  assert.equal(at(r, 92, 66).verdict, 'standard');
  assert.equal(at(r, 595, 67).verdict, 'not-identified');
});
test('a turned framed sheet: no judged box outside the area', () => {
  const r = runPage(flip(FRAMED), { pageSize: [400, 600], viewportTransform: [0, 1, 1, 0, 0, 0] });
  assert.equal(r.drawingArea.found, true);
  assert.deepEqual(r.drawingArea.box.map(Math.round), [20, 20, 380, 580]);
  assert.ok(r.shapes.length >= 1);
  assert.equal(r.shapes.filter(s => !C.insideArea(r.drawingArea, s.box)).length, 0);
  assert.ok(!r.shapes.some(s => s.box[1] >= 440), 'nothing in the strip');
});

// Six rings (a legend RING, 40 pt) each drawn as four arcs.
const arcsOf = (cx, cy, r, n = 4, per = 8) => {
  const out = [], step = (2 * Math.PI) / (n * per);
  for (let a = 0; a < n; a++) {
    const segs = [];
    for (let k = 0; k < per; k++) { const t0 = (a * per + k) * step, t1 = t0 + step; segs.push(cx + r * Math.cos(t0), cy + r * Math.sin(t0), cx + r * Math.cos(t1), cy + r * Math.sin(t1)); }
    out.push({ segs, width: 0.7, stroked: true, filled: false, grey: 0 });
  }
  return out;
};
const RINGS = Array.from({ length: 6 }, (_, i) => arcsOf(60 + i * 70, 100, 20)).flat();
// Each ring has its tag written inside it (a bare ring is red whatever way it is read).
const RING_TAGS = Array.from({ length: 6 }, (_, i) => ({ tag: `21-ZI-80${10 + i}`, fc: 'ZI' }));
const RING_TEXT = RING_TAGS.flatMap((t, i) => label(t.tag, 60 + i * 70 - 11, 100 - 9, { split: true }));
const RINGED = { ...PAGE, paths: RINGS, tags: RING_TAGS, textItems: RING_TEXT, lookups: LOOKUPS };
test('a sheet of rings drawn as arcs: read from line pieces, rings green; the tag verdicts and symbols unchanged', () => {
  const r = C.checkSheet({ library: OPERATOR_LIBRARY, ...RINGED }), byPath = offOf(RINGED);
  assert.equal(r.readFrom, 'line-pieces');
  assert.equal(r.shapes.length, 6);
  assert.ok(r.shapes.every(s => s.verdict === 'standard'), JSON.stringify(r.shapes));
  assert.equal(r.lineCapped, 0);
  assert.deepEqual(r.verdicts, byPath.verdicts);
  assert.deepEqual(r.symbols.map(s => [s.name, s.box]), byPath.symbols.map(s => [s.name, s.box]));
  assert.equal(r.symbols.length, 0, 'a ring found only from line pieces is never added to the symbols');
  assert.ok(r.verdicts.every(v => v.verdict === 'look'), 'the tags are as the drawn paths left them');
});
test('a clean sheet stays read from drawn paths', () => {
  const clean = Array.from({ length: 6 }, (_, i) => place(WIDGET, { x: 60 + 80 * i, y: 100 })).flat();
  const r = runPage(clean);
  assert.equal(r.shapes.length, 6);
  assert.ok(r.shapes.every(s => s.verdict === 'standard'));
  assert.equal(r.readFrom, 'paths');
  assert.equal(r.sizeScale, 1);
  assert.equal(r.printScale, 1);
  assert.equal('lineCapped' in r, false);
});
test('results with shapes off carry none of the new fields', () => {
  const r = offOf({ ...SHAPE_SHEET });
  for (const k of ['drawingArea', 'readFrom', 'sizeScale', 'printScale', 'lineCapped']) assert.equal(k in r, false, k);
});
test('the pinned switch', () => { assert.equal(C.GREEN_SWITCH, 0.5); });

// Six WIDGETs and a frame drawn at legend size, printed at 0.45; the sheet scale is given.
test('a sheet printed at 0.45: sizeScale ~1, printScale ~0.45, boxes and drawing area on the page as drawn', () => {
  const k = 0.45, W = 600, H = 400;
  const sc = p => ({ ...p, segs: p.segs.map(v => v * k), width: p.width * k });
  const drawn = [...frameLines(W / k, H / k, 20 / k)];
  for (let i = 0; i < 6; i++) drawn.push(...place(WIDGET, { x: (60 + 80 * i) / k, y: 100 / k }));
  const r = runPage(drawn.map(sc), { options: { sheetScale: k } });
  assert.equal(r.sheetScale, k);
  assert.ok(Math.abs(r.sizeScale - 1) < 0.1, String(r.sizeScale));
  assert.ok(Math.abs(r.printScale - 0.45) < 0.05, String(r.printScale));
  assert.equal(r.printScale, Math.round(r.sheetScale * r.sizeScale * 1000) / 1000);
  assert.deepEqual(r.drawingArea.box.map(Math.round), [20, 20, 580, 380]);
  assert.ok(r.shapes.length >= 6);
  for (const s of r.shapes) assert.ok(s.box[0] >= 20 && s.box[2] <= 580 && s.box[3] <= 380, JSON.stringify(s.box));
  assert.ok(r.shapes.some(s => Math.abs(s.box[0] - 60) < 2), 'a box is at the page position, 60');
});

// Tag promotion: a tag with no symbol, a red shape beside it.
const TAGGED = (x, y) => ({ tags: [{ tag: '21-W-1001', fc: 'W' }], textItems: label('21-W-1001', x, y) });
const SQUIGGLE = [line([280, 160, 290, 175, 290, 175, 300, 160, 300, 160, 310, 175])];
const sq = r => r.shapes.find(x => x.box[0] > 270 && x.box[2] < 320 && x.box[1] < 200);
test('a tag with no symbol beside a red shape: amber, tag T has no standard symbol; the tag verdict is unchanged', () => {
  const r = runPage(SQUIGGLE, TAGGED(270, 140));
  assert.equal(r.verdicts[0].verdict, 'exception', 'the tag verdict (W has an approved exception) is untouched');
  assert.deepEqual(r.verdicts, offOf({ ...PAGE, ...TAGGED(270, 140), paths: SQUIGGLE }).verdicts);
  assert.equal(sq(r).verdict, 'not-standard', JSON.stringify(sq(r)));
  assert.deepEqual(sq(r).reason, { kind: 'tag', tag: '21-W-1001' });
  assert.equal(sq(r).standard, false);
  assert.equal(sq(runPage(SQUIGGLE)).verdict, 'not-identified');
});
test('a tag 80 pt from a red shape promotes nothing', () => {
  const r = runPage(SQUIGGLE, TAGGED(270, 255));
  assert.equal(r.verdicts[0].verdict, 'exception');
  for (const s of r.shapes) assert.notEqual(s.reason && s.reason.kind, 'tag');
  assert.equal(sq(r).verdict, 'not-identified');
});
test('one tag promotes one shape: the nearer', () => {
  const two = [...SQUIGGLE, line([280, 215, 290, 230, 290, 230, 300, 215, 300, 215, 310, 230])];
  const r = runPage(two, TAGGED(270, 150));
  const promoted = r.shapes.filter(s => s.reason && s.reason.kind === 'tag');
  assert.equal(promoted.length, 1);
  assert.ok(promoted[0].box[1] < 180);
});

test('goal 5: verdicts deep-equal and symbol names and boxes equal with shapes on and off', () => {
  const cases = [[SHAPE_SHEET, OPERATOR_LIBRARY], [SHEET, LIBRARY], [BUBBLE_SHEET, BUBBLE_LIBRARY], [SWEEP_SHEET, SWEEP_LIBRARY],
    [{ ...PAGE, paths: RINGS }, OPERATOR_LIBRARY], [{ ...PAGE, paths: FRAMED }, OPERATOR_LIBRARY]];
  for (const [sheet, library] of cases) {
    const input = { lookups: LOOKUPS, ...sheet, library };
    const on = C.checkSheet(input), no = C.checkSheet({ ...input, options: { shapes: false } });
    assert.ok(on.shapes, 'shapes on');
    assert.deepEqual(on.verdicts, no.verdicts);
    assert.deepEqual(on.symbols.map(s => [s.name, s.box, s.tag]), no.symbols.map(s => [s.name, s.box, s.tag]));
  }
});

test('a red shape holding a tagged symbol is amber: that symbol with extra linework', () => {
  // A WIDGET tagged W inside a box it is wired to: it explains a third of the shape, which is red until the tag names it.
  const clutter = [[100, 100, 84, 84], [100, 112, 84, 128], [124, 100, 140, 84], [124, 112, 140, 128], [84, 84, 140, 84], [140, 84, 140, 128], [140, 128, 84, 128], [84, 128, 84, 84],
    [84, 106, 100, 106], [124, 106, 140, 106], [112, 84, 112, 100], [112, 112, 112, 128]].map(c => line(c));
  const input = { ...PAGE, paths: [...place(WIDGET, { x: 100, y: 100 }), ...clutter], ...TAGGED(95, 90) };
  const r = C.checkSheet({ library: OPERATOR_LIBRARY, lookups: {}, ...input });
  const sy = r.symbols.find(s => s.name === 'WIDGET');
  assert.ok(sy && sy.tag === '21-W-1001', JSON.stringify(r.symbols));
  const sh = r.shapes[sy.shape];
  assert.equal(sh.verdict, 'not-standard', JSON.stringify(sh));
  assert.deepEqual(sh.reason, { kind: 'extra', name: 'WIDGET' });
  assert.equal(sy.standard, false);
  assert.ok(sh.explained < 0.5, 'it is a red shape by the explained share: ' + sh.explained);
});

test('judgeShapes with a memo: a shape drawn exactly like one judged before is copied, with its new id, not judged again', () => {
  const { out: first } = strayShape();
  assert.equal(first.length, 1);
  const memo = new Map();
  const a = strayShape({ memo }).out;
  assert.equal(memo.size, 1);
  const b = strayShape({ memo, deadline: 0 }).out;   // out of time: only the memo can answer
  assert.equal(b[0].verdict, a[0].verdict);
  assert.equal(b[0].why, a[0].why);
  assert.notEqual(b[0].why, 'time');
  assert.equal(strayShape({ deadline: 0 }).out[0].why, 'time');
});
