// Phase 3: judging each drawn shape against the whole of its ink. Invented sheets only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../assets/js/pid-symbol-check.js';
import { SHAPE_SHEET, SHAPE_LIBRARY, OPERATOR_LIBRARY, SHEET, LIBRARY, LOOKUPS, BUBBLE_SHEET, BUBBLE_LIBRARY, LOOKUPS_B,
  SWEEP_SHEET, SWEEP_LIBRARY, PRINTED_SHEET, glyphRow } from './fixtures/symbol-check-sheet.js';

const run = (library, extra = {}) => C.checkSheet({ ...SHAPE_SHEET, library, lookups: {}, ...extra });
const at = (r, x, y) => r.shapes.find(s => x >= s.box[0] - 1 && x <= s.box[2] + 1 && y >= s.box[1] - 1 && y <= s.box[3] + 1);
const R = run(OPERATOR_LIBRARY);

test('the pinned value', () => {
  assert.equal(C.CHECK_DEFAULTS.shapeExplained, 0.97);
});

test('a WIDGET on a pipe is standard, all of its ink explained', () => {
  const s = at(R, 92, 66);
  assert.ok(s, 'a shape there');
  assert.equal(s.standard, true, JSON.stringify(s));
  assert.equal(s.why, null);
  assert.ok(s.explained >= 0.97);
  assert.equal(R.symbols[s.symbols[0]].name, 'WIDGET');
  assert.equal(R.symbols[s.symbols[0]].shape, s.id);
  assert.equal(R.symbols[s.symbols[0]].standard, true);
});

test('a body with a handle on its stem is standard when HANDLE is marked an operator', () => {
  const s = at(R, 252, 66);
  assert.equal(s.standard, true, JSON.stringify(s));
  assert.deepEqual(s.operator && s.operator.name, 'HANDLE');
  assert.equal(R.operatorsMarked, true);
});

test('the same with no operator marked: left-over, and the result says operators are not marked', () => {
  const r = run(SHAPE_LIBRARY);
  const s = at(r, 252, 66);
  assert.equal(s.standard, false);
  assert.equal(s.why, 'left-over');
  assert.equal(s.operator, null);
  assert.equal(r.operatorsMarked, false);
});

test('a WIDGET with an extra stroke outside its box: left-over, closest WIDGET', () => {
  const s = at(R, 352, 66);
  assert.equal(s.standard, false);
  assert.equal(s.why, 'left-over');
  assert.equal(s.closest.name, 'WIDGET');
  assert.ok(s.explained < 0.97);
});

test('a GADGET with its diagonal drawn 60% long: short-line, with its share', () => {
  const s = at(R, 470, 70);
  assert.equal(s.standard, false, JSON.stringify(s));
  assert.equal(s.why, 'short-line');
  // 60% drawn; the ink tolerance (0.5 pt) and the box corner the line runs into add about 2 pt of its 28 pt.
  assert.ok(s.share >= 0.6 && s.share <= 0.75, String(s.share));
  assert.equal(s.closest.name, 'GADGET');
});

test('an invented squiggle: no-fit, no close symbol or a poor one', () => {
  const s = at(R, 595, 67);
  assert.equal(s.standard, false);
  assert.equal(s.why, 'no-fit');
  assert.ok(!s.closest || s.closest.score < 0.9);
});

// Owner, 2026-11-20 (overrules 2026-11-17): a ring matching a legend bubble at the sheet's size is standard even when
// no tag is written in it.
test('a ring with a tag written in it is standard; a bare ring at a bubble’s size is standard too', () => {
  const tagged = at(R, 80, 200), bare = at(R, 220, 200);
  assert.equal(tagged.standard, true, JSON.stringify(tagged));
  assert.equal(bare.standard, true, JSON.stringify(bare));
});
test('a bare ring far smaller than any bubble is no bubble', () => {
  const ring = []; for (let k = 0; k < 24; k++) { const a0 = (k / 24) * 2 * Math.PI, a1 = ((k + 1) / 24) * 2 * Math.PI; ring.push(200 + 3 * Math.cos(a0), 100 + 3 * Math.sin(a0), 200 + 3 * Math.cos(a1), 100 + 3 * Math.sin(a1)); }
  const r = judgeSplit([{ paths: [tick(ring)], closed: true }], SHAPE_LIBRARY, []);
  assert.ok(r.length && r[0].standard !== true, JSON.stringify(r));
});

test('a dashed line is no shape', () => {
  assert.equal(R.shapes.filter(s => s.box[1] <= 221 && s.box[3] >= 219 && s.box[0] >= 330 && s.box[2] <= 530).length, 0);
});

test('a circle with extra ink: closest is the symbol that explains more of the shape', () => {
  const s = at(R, 608, 205);
  assert.equal(s.standard, false);
  assert.equal(s.why, 'left-over');
  assert.equal(s.closest.name, 'PUMPISH');
});

test('a METER on a pipe drawn straight through it is standard', () => {
  const s = at(R, 90, 344);
  assert.equal(s.standard, true, JSON.stringify(s));
});

test('every shape has the fields of the result shape', () => {
  for (const s of R.shapes) {
    assert.deepEqual(Object.keys(s).filter(k => k !== 'overlay').sort(), ['box', 'closest', 'explained', 'id', 'operator', 'parts', 'reason', 'share', 'standard', 'symbols', 'verdict', 'why']);
    assert.ok([true, false, null].includes(s.standard));
  }
});

// Goal 5: no tag verdict changes, and the symbol list is the same apart from the two new fields.
const strip = syms => syms.map(({ shape, standard, ...rest }) => rest);
for (const [name, sheet, library, lookups] of [['SHEET', SHEET, LIBRARY, LOOKUPS], ['BUBBLE_SHEET', BUBBLE_SHEET, BUBBLE_LIBRARY, LOOKUPS_B],
  ['SWEEP_SHEET', SWEEP_SHEET, SWEEP_LIBRARY, {}], ['PRINTED_SHEET', PRINTED_SHEET, SWEEP_LIBRARY, {}]]) {
  test(`goal 5 on ${name}: verdicts deep-equal with and without shapes; symbols the same apart from shape and standard`, () => {
    const a = C.checkSheet({ ...sheet, library, lookups, options: { shapes: false } });
    const b = C.checkSheet({ ...sheet, library, lookups });
    assert.deepEqual(b.verdicts, a.verdicts);
    assert.deepEqual(strip(b.symbols), strip(a.symbols));
    assert.equal(a.shapes, undefined);
    assert.ok(Array.isArray(b.shapes));
    for (const s of b.symbols) assert.ok('shape' in s && 'standard' in s);
  });
}

test('past the time limit, shapes are not judged and never standard', () => {
  const r = run(OPERATOR_LIBRARY, { options: { timeLimitMs: 1 } });
  for (const s of r.shapes) { assert.equal(s.standard, null); assert.equal(s.why, 'time'); }
});

test('judgeShapes with hostile input gives no shapes and never throws', () => {
  for (const bad of [null, {}, { split: null }, { split: { shapes: 'x' } }, { split: { shapes: [{ box: [NaN] }], segments: 5 } }]) {
    assert.deepEqual(C.judgeShapes(bad), []);
  }
});

test('a page of letters only is judged without trouble', () => {
  const r = C.checkSheet({ pageSize: [400, 300], viewportTransform: [1, 0, 0, 1, 0, 0], paths: glyphRow(20, 20, 30), textItems: [], tags: [], library: SHAPE_LIBRARY });
  assert.equal(r.ok, true);
  assert.ok(Array.isArray(r.shapes));
});

// Review fix: an operator whose stem stands on the edge of its body is cut off by the splitter; the judge joins them again.
import { EDGE_STEM_SHEET, WHEEL_LIBRARY } from './fixtures/symbol-check-sheet.js';
test('an operator whose stem stands on the body edge: one shape, standard with the operator when it is a legend operator', () => {
  const r = C.checkSheet({ ...EDGE_STEM_SHEET, library: WHEEL_LIBRARY, lookups: {} });
  const s = r.shapes.filter(x => x.box[0] < 125 && x.box[2] > 95 && x.box[1] < 125 && x.box[3] > 85);
  assert.equal(s.length, 1, JSON.stringify(r.shapes));
  assert.equal(s[0].standard, true, JSON.stringify(s[0]));
  assert.equal(s[0].operator && s[0].operator.name, 'WHEEL');
  assert.ok(s[0].box[1] <= 90, 'the shape takes in the wheel');
});
test('the same wheel when it is no legend operator: the body and wheel are one shape, not to standard, never a silent pass', () => {
  const r = C.checkSheet({ ...EDGE_STEM_SHEET, library: OPERATOR_LIBRARY, lookups: {} });
  const s = r.shapes.filter(x => x.box[0] < 125 && x.box[2] > 95 && x.box[1] < 125 && x.box[3] > 85);
  assert.equal(s.length, 1, JSON.stringify(r.shapes));
  assert.equal(s[0].standard, false);
  assert.equal(s[0].why, 'left-over');
});

// Owner, round 2: an arrowhead pointing at a found valve is not the valve's ink.
import { place } from './fixtures/symbol-check-sheet.js';
test('a WIDGET with an arrowhead whose tip touches its edge: standard', () => {
  const tri = [{ segs: [102, 134, 110, 134, 110, 134, 106, 124, 106, 124, 102, 134], width: 0.7, stroked: true, filled: true, grey: 0 }];
  const W = SHAPE_LIBRARY.symbols.find(s => s.name === 'WIDGET');
  const sheet = { pageSize: [300, 250], viewportTransform: [1, 0, 0, 1, 0, 0], textItems: [], tags: [],
    paths: [...place(W, { x: 100, y: 100, o: 1 }), ...tri] };
  const r = C.checkSheet({ ...sheet, library: SHAPE_LIBRARY, lookups: {} });
  const s = r.shapes.find(x => x.box[0] <= 101 && x.box[2] >= 111);
  assert.equal(s.standard, true, JSON.stringify(r.shapes));
});

// Owner, round 2: reducers are standard though drawn in other proportions.
test('a symbol drawn in other proportions (up to 1.5 times) is standard; a different shape is not', () => {
  const ln = segs => ({ segs, width: 0.7, stroked: true, filled: false, grey: 0 });
  const TAPER = { id: 't1', name: 'TAPER', legendName: 'TAPER', group: 'TAPERS', tagId: 'Q', sheet: '1', w: 21, h: 28, letters: [], aliases: [], notes: [],
    flags: { simple: false, stretch: false, manual: false, unmatched: false },
    paths: [ln([0, 28, 0, 0]), ln([0, 28, 21, 21]), ln([21, 21, 21, 7]), ln([21, 7, 0, 0])] };
  const lib = { ...SHAPE_LIBRARY, symbols: [...SHAPE_LIBRARY.symbols, TAPER] };
  // The same taper 21 long and 20 wide (squashed 0.71 across), on a long pipe.
  const sq = v => 100 + v * 20 / 28;
  const drawn = [ln([100, sq(28), 100, sq(0)]), ln([100, sq(28), 121, sq(21)]), ln([121, sq(21), 121, sq(7)]), ln([121, sq(7), 100, sq(0)]),
    ln([20, sq(14), 100, sq(14)]), ln([121, sq(14), 200, sq(14)])];
  const page = pathsIn => ({ pageSize: [300, 250], viewportTransform: [1, 0, 0, 1, 0, 0], textItems: [], tags: [], paths: pathsIn, library: lib, lookups: {} });
  const r = C.checkSheet(page(drawn));
  const s = r.shapes.find(x => x.box[0] <= 101 && x.box[2] >= 120);
  assert.equal(s.standard, true, JSON.stringify(r.shapes));
  assert.equal(s.closest && s.closest.name, 'TAPER');
  // A plain box the same size is no taper.
  const box = [ln([100, 100, 121, 100]), ln([121, 100, 121, 120]), ln([121, 120, 100, 120]), ln([100, 120, 100, 100]), ln([20, 110, 100, 110]), ln([121, 110, 200, 110])];
  const b = C.checkSheet(page(box)).shapes.find(x => x.box[0] <= 101 && x.box[2] >= 120);
  assert.notEqual(b && b.standard, true);
});

// A filled valve drawn as thin slices (as printed sheets do): the slices inside are the valve's fill, not extra ink.
test('a WIDGET filled with thin vertical slices is standard', () => {
  const W = SHAPE_LIBRARY.symbols.find(s => s.name === 'WIDGET');
  const slices = [];
  for (let x = 100; x < 112; x += 1) {
    const h = (x + 0.5 - 100) / 2;   // the left triangle: (0,0)-(0,12)-(12,6), half-height at x
    const top = 106 - (6 - h), bot = 106 + (6 - h);
    slices.push({ segs: [x, top, x + 1, top, x + 1, top, x + 1, bot, x + 1, bot, x, bot, x, bot, x, top], width: 0, stroked: false, filled: true, grey: 0 });
    slices.push({ segs: [124 - x - 1, top, 124 - x, top, 124 - x, top, 124 - x, bot, 124 - x, bot, 124 - x - 1, bot, 124 - x - 1, bot, 124 - x - 1, top], width: 0, stroked: false, filled: true, grey: 0 });
  }
  const sheet = { pageSize: [300, 250], viewportTransform: [1, 0, 0, 1, 0, 0], textItems: [], tags: [], paths: [...place(W, { x: 100, y: 100 }), ...slices] };
  const r = C.checkSheet({ ...sheet, library: SHAPE_LIBRARY, lookups: {} });
  const s = r.shapes.find(x => x.box[0] <= 101 && x.box[2] >= 123);
  assert.ok(s, JSON.stringify(r.shapes));
  assert.equal(s.standard, true, JSON.stringify(s));
});

// Owner's binder, 2026-11-18: an A1 drawing printed on A3 has every symbol at under half the legend's size.
import { BUBBLE_SHEET as BS, BUBBLE_LIBRARY as BL, LOOKUPS_B as LB } from './fixtures/symbol-check-sheet.js';
const shrink = (sheet, k) => ({ ...sheet,
  paths: sheet.paths.map(p => ({ ...p, segs: p.segs.map(v => v * k), width: p.width * k })),
  textItems: sheet.textItems.map(it => ({ ...it, transform: it.transform.map(v => v * k), width: it.width * k, height: it.height * k })) });
test('a sheet printed at 0.45 of its size is checked at legend size: same verdicts, boxes on the page as drawn', () => {
  const full = C.checkSheet({ ...BS, library: BL, lookups: LB });
  const small = C.checkSheet({ ...shrink(BS, 0.45), library: BL, lookups: LB });
  assert.ok(Math.abs(small.sheetScale - 0.45) < 0.03, String(small.sheetScale));
  assert.deepEqual(small.verdicts.map(v => [v.tag, v.verdict]), full.verdicts.map(v => [v.tag, v.verdict]));
  const a = full.verdicts.find(v => v.tag === '21-ZI-8001').box, b = small.verdicts.find(v => v.tag === '21-ZI-8001').box;
  assert.ok(b.every((v, i) => Math.abs(v - a[i] * 0.45) < 1.5), JSON.stringify([a, b]));
  assert.equal(full.sheetScale, 1);
  assert.equal(C.checkSheet({ ...shrink(BS, 0.45), library: BL, lookups: LB, options: { autoScale: false } }).sheetScale, 1);
});

// A sheet at legend size with no tag bubbles of its own but a few small outlines with writing in them (an
// owner's tuning sheet: valve-number circles, a revision mark, a title-block box) was read at 0.39, so
// every symbol on it was judged at the wrong size. Bubbles repeat at one size; a scatter of unlike
// outlines is not a scale.
const writtenRing = (cx, cy, r, n = 1) => ({
  paths: [{ segs: Array.from({ length: 32 }, (_, i) => { const a = 2 * Math.PI * i / 32, b = 2 * Math.PI * (i + 1) / 32; return [cx + r * Math.cos(a), cy + r * Math.sin(a), cx + r * Math.cos(b), cy + r * Math.sin(b)]; }).flat(),
    width: 0.7, stroked: true, filled: false, grey: 0 }],
  items: Array.from({ length: n }, (_, i) => ({ str: 'A', transform: [4, 0, 0, 4, cx - 2 + i, cy], width: 2.5, height: 4 })) });
const scatter = sizes => {
  const made = sizes.map((d, i) => writtenRing(60 + 70 * i, 60, d / 2));
  return { pageSize: [800, 200], viewportTransform: [1, 0, 0, 1, 0, 0], tags: [], paths: made.flatMap(m => m.paths), textItems: made.flatMap(m => m.items) };
};
test('a handful of unlike small outlines with writing is not read as a scale', () => {
  const r = C.checkSheet({ ...scatter([5, 6, 6.4, 14, 16, 16.5, 21, 34, 60]), library: BL, lookups: LB });
  assert.equal(r.sheetScale, 1);
  assert.equal(C.estimateSheetScale({ ...scatter([5, 6, 6.4, 14, 16, 16.5, 21, 34, 60]), library: BL }), 1);
});
test('many outlines of one small size with writing are still read as a scale', () => {
  const k = C.estimateSheetScale({ ...scatter([18, 18.2, 18.4, 18, 18.3, 18.1, 6, 6.2]), library: BL });
  assert.ok(Math.abs(k - 18.2 / 40) < 0.03, String(k));
});

// Legend rules (2026-11-18): the stretched fit's size band moves with the sheet's own symbol size, as every
// other judge placement does. On a sheet whose symbols are drawn at 130%, one drawn at 220% is still fitted
// and flagged for its size, not left unidentified.
test('the box fit works at the sheet scale: standard at sheet size, off size well above it', () => {
  const ln = segs => ({ segs, width: 0.3, stroked: true, filled: false, grey: 0 });
  const TAPER = { id: 't1', name: 'TAPER', legendName: 'TAPER', group: 'TAPERS', tagId: 'Q', sheet: '1', w: 21, h: 28, letters: [], aliases: [], notes: [],
    flags: { simple: false, stretch: false, manual: false, unmatched: false },
    paths: [ln([0, 28, 0, 0]), ln([0, 28, 21, 21]), ln([21, 21, 21, 7]), ln([21, 7, 0, 0])] };
  const lib = { ...SHAPE_LIBRARY, symbols: [...SHAPE_LIBRARY.symbols, TAPER] };
  const judge = k => {
    const ky = k * 20 / 28, X = v => 100 + v * k, Y = v => 100 + v * ky;
    const paths = [ln([X(0), Y(28), X(0), Y(0)]), ln([X(0), Y(28), X(21), Y(21)]), ln([X(21), Y(21), X(21), Y(7)]), ln([X(21), Y(7), X(0), Y(0)]),
      ln([20, Y(14), X(0), Y(14)]), ln([X(21), Y(14), 250, Y(14)])];
    const r = C.checkSheet({ pageSize: [300, 250], viewportTransform: [1, 0, 0, 1, 0, 0], textItems: [], tags: [], paths, library: lib, lookups: {}, options: { sizeScale: 1.3 } });
    return r.shapes.find(x => x.box[0] <= 101 && x.box[2] >= 100 + 21 * k - 1);
  };
  const s = judge(1.3);
  assert.equal(s && s.verdict, 'standard', JSON.stringify(s));
  const t = judge(2.2);
  assert.equal(t && t.verdict, 'not-standard', JSON.stringify(t));
  assert.equal(t.reason.kind, 'size');
  assert.ok(Math.abs(t.reason.pct - 169) <= 3, String(t.reason.pct));
});


// Legend rules (2026-11-18): a line with a head (sheet 4's FLOW DIRECTION ARROW) is never a body unless its
// head can be told from a line. H2's corners and crossings were read as it at 76-86%.
const ARROWL = { id: 'a1', name: 'ARROWL', legendName: 'ARROWL', group: 'FITTINGS', tagId: '', sheet: '4', w: 21, h: 4, letters: [], aliases: [], notes: [], flags: {},
  paths: [{ segs: [0, 2, 21, 2], width: 0.5, stroked: true, filled: false, grey: 0 }, { segs: [16, 0, 21, 2, 21, 2, 16, 4, 16, 4, 16, 0], width: 0.3, stroked: true, filled: true, grey: 0 }] };
test('isLineWithHead: a stem with a head at one end; not a head alone, a plain line or a valve', () => {
  const prep = syms => C.prepareSymbols({ symbols: syms });
  const [arrow] = prep([ARROWL]);
  assert.equal(C.isLineWithHead(arrow), true);
  const head = { ...ARROWL, w: 10, h: 5, paths: [{ segs: [0, 0, 10, 2.5, 10, 2.5, 0, 5, 0, 5, 0, 0], width: 0.3, stroked: true, filled: true, grey: 0 }] };
  assert.equal(C.isLineWithHead(prep([head])[0]), false);
  const line = { ...ARROWL, h: 0, paths: [{ segs: [0, 0, 21, 0], width: 0.5, stroked: true, filled: false, grey: 0 }] };
  assert.equal(C.isLineWithHead(prep([line])[0]), false);
  const W = SHAPE_LIBRARY.symbols.find(s => s.name === 'WIDGET');
  assert.equal(C.isLineWithHead(prep([W])[0]), false);
  assert.equal(C.isLineWithHead(null), false);
});
test('headDrawn: an arrow laid on a thick bare line has no head; on a line with a drawn head it has one', () => {
  const [arrow] = C.prepareSymbols({ symbols: [ARROWL] });
  const pl = { o: 0, k: 0.77, tx: 100, ty: 100 - 2 * 0.77 };
  const bare = [{ segs: [90, 100, 130, 100], width: 1.2, stroked: true, filled: false, grey: 0 }];
  const tip = 100 + 21 * 0.77;
  const headed = [...bare, { segs: [tip - 3.9, 98.4, tip, 100, tip, 100, tip - 3.9, 101.6, tip - 3.9, 101.6, tip - 3.9, 98.4], width: 0.3, stroked: true, filled: true, grey: 0 }];
  const win = paths => C.drawingWindow(paths, [110, 100]);
  assert.equal(C.headDrawn({ p: arrow, placement: pl, score: 0.9 }, win(bare)), false);
  assert.equal(C.headDrawn({ p: arrow, placement: pl, score: 0.9 }, win(headed)), true);
  assert.equal(C.headDrawn(null, win(bare)), false);
});

// Legend rules (2026-11-18): several attachments on one body, fitted one after another (Sheet 1's VALVE &
// ACTUATOR COMBINATION examples): a handwheel operator and a flanged connection at each end.
import { WHEEL } from './fixtures/symbol-check-sheet.js';
const tick = segs => ({ segs, width: 0.7, stroked: true, filled: false, grey: 0 });
const FLANGE = { id: 'f1', name: 'FLANGED CONNECTION', legendName: 'FLANGED CONNECTION', group: 'PIPE WORK FITTINGS', tagId: '', sheet: '2', w: 2, h: 8,
  letters: [], aliases: [], notes: [], flags: {}, paths: [tick([0, 0, 0, 8]), tick([0, 4, 2, 4])] };
// The judge alone, on one hand-made shape (the splitter's own choices aside): every path is one piece, all in one shape.
const judgeOne = (paths, library, spots, options = {}, writing = [], outside = 0) => {
  const cfg = { ...C.CHECK_DEFAULTS, ...options };
  const prepared = C.prepareSymbols(library, cfg);
  const segments = [], boxed = [];
  paths.forEach((p, pi) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i + 3 < p.segs.length; i += 4) {
      const q = p.segs.slice(i, i + 4);
      segments.push([...q, Math.hypot(q[2] - q[0], q[3] - q[1]), pi]);
      x0 = Math.min(x0, q[0], q[2]); x1 = Math.max(x1, q[0], q[2]); y0 = Math.min(y0, q[1], q[3]); y1 = Math.max(y1, q[1], q[3]);
    }
    boxed.push({ p, b: [x0, y0, x1, y1] });
  });
  // The last `outside` paths are a neighbour: on the page, not in the shape.
  const inShape = boxed.slice(0, boxed.length - outside);
  const box = inShape.reduce((u, q) => [Math.min(u[0], q.b[0]), Math.min(u[1], q.b[1]), Math.max(u[2], q.b[2]), Math.max(u[3], q.b[3])], [Infinity, Infinity, -Infinity, -Infinity]);
  const split = { segments, shapes: [{ id: 0, pieces: segments.map((_, i) => i).filter(i => segments[i][5] < paths.length - outside), box, closed: false }], lines: [], arrows: [] };
  const sp = spots.map(([name, placement]) => ({ hit: { p: prepared[library.symbols.findIndex(x => x.name === name)], placement, score: 1 }, symbol: 0 }));
  return C.judgeShapes({ cfg, prepared, boxed, paths, split, spots: sp, near: [], rejected: [], writing, options })[0];
};
const GADGET_AT = { o: 0, k: 1, tx: 100, ty: 100 };
const gadgetWithParts = flanges => [...place(SHAPE_LIBRARY.symbols.find(x => x.name === 'GADGET'), { x: 100, y: 100 }), ...place(WHEEL, { x: 102, y: 89 }),
  ...(flanges ? [tick([98, 106, 98, 114]), tick([98, 110, 100, 110]), tick([122, 106, 122, 114]), tick([120, 110, 122, 110])] : [])];
const FLANGE_LIB = { ...WHEEL_LIBRARY, symbols: [...WHEEL_LIBRARY.symbols, FLANGE] };
test('a body with an operator and a flanged connection at each end is standard, every part named', () => {
  const s = judgeOne(gadgetWithParts(true), FLANGE_LIB, [['GADGET', GADGET_AT]]);
  assert.equal(s && s.verdict, 'standard', JSON.stringify(s));
  const names = s.parts.map(p => p.name + ':' + p.role).sort();
  assert.deepEqual(names, ['FLANGED CONNECTION:attachment', 'FLANGED CONNECTION:attachment', 'GADGET:body', 'WHEEL:attachment']);
  assert.equal(s.operator && s.operator.name, 'WHEEL');
});
test('the flange ticks are not attachments when the setting names none: ink left over', () => {
  const s = judgeOne(gadgetWithParts(true), FLANGE_LIB, [['GADGET', GADGET_AT]], { attachments: [] });
  assert.equal(s && s.verdict, 'not-standard', JSON.stringify(s));
  assert.equal(s.reason.kind, 'extra');
});
test('a lone flange tick pair with no body is never fitted as an attachment', () => {
  const s = judgeOne([tick([98, 106, 98, 114]), tick([98, 110, 100, 110])], FLANGE_LIB, []);
  assert.notEqual(s && s.verdict, 'standard', JSON.stringify(s));
});
test('a touching standard symbol the sweep did not find is peeled off the body', () => {
  const W = SHAPE_LIBRARY.symbols.find(x => x.name === 'WIDGET');
  const paths = [...place(SHAPE_LIBRARY.symbols.find(x => x.name === 'GADGET'), { x: 100, y: 100 }), ...place(W, { x: 120, y: 104 })];
  const s = judgeOne(paths, SHAPE_LIBRARY, [['GADGET', GADGET_AT]]);
  assert.equal(s && s.verdict, 'standard', JSON.stringify(s));
  assert.deepEqual(s.parts.map(p => p.name + ':' + p.role).sort(), ['GADGET:body', 'WIDGET:symbol']);
  // An invented stroke is not peeled.
  const t = judgeOne([...place(SHAPE_LIBRARY.symbols.find(x => x.name === 'GADGET'), { x: 100, y: 100 }), tick([120, 110, 126, 104, 126, 104, 132, 116])], SHAPE_LIBRARY, [['GADGET', GADGET_AT]]);
  assert.equal(t && t.verdict, 'not-standard', JSON.stringify(t));
});
// Gate fault (2026-11-19, H2 tile 10): a T operator was fitted with its stem on a branch line leaving the body and its
// bar on a neighbouring symbol's edge. An attachment lies on its own shape's ink, never on a neighbour's.
test('an operator is never fitted on a neighbouring shape’s ink', () => {
  const W = SHAPE_LIBRARY.symbols.find(x => x.name === 'WIDGET');
  const TOP = { id: 'to1', name: 'TEE OPERATOR', legendName: 'TEE OPERATOR', group: 'VALVE ACTUATORS', tagId: '', sheet: '1', w: 14.16, h: 14.16, aliases: [], notes: [], letters: [],
    flags: { simple: false, stretch: false, manual: false, unmatched: false, operator: true }, paths: [tick([7.08, 14.16, 7.08, 0]), tick([14.16, 0, 0, 0])] };
  const lib = { ...SHAPE_LIBRARY, symbols: [...SHAPE_LIBRARY.symbols, TOP] };
  const body = [...place(W, { x: 100, y: 100 }), tick([112, 106, 112, 91.84])];
  const neighbour = [tick([104.92, 91.84, 119.08, 91.84]), tick([119.08, 91.84, 119.08, 80]), tick([119.08, 80, 104.92, 80]), tick([104.92, 80, 104.92, 91.84])];
  const s = judgeOne([...body, ...neighbour], lib, [['WIDGET', { o: 0, k: 1, tx: 100, ty: 100 }]], {}, [], neighbour.length);
  assert.notEqual(s && s.verdict, 'standard', JSON.stringify(s));
  // The same T drawn in the shape is fitted.
  const t = judgeOne([...body, tick([104.92, 91.84, 119.08, 91.84])], lib, [['WIDGET', { o: 0, k: 1, tx: 100, ty: 100 }]]);
  assert.equal(t && t.verdict, 'standard', JSON.stringify(t));
});
// Gate fault (2026-11-19, H2 tile 10): a T operator laid with its bar along the line through a valve's middle and its stem
// out along a branch. An operator stands on its body, clear of it: most of it inside the body's box is no operator.
test('an operator lying across its body is not fitted; one standing clear of it is', () => {
  const W = SHAPE_LIBRARY.symbols.find(x => x.name === 'WIDGET');
  const TOP = { id: 'to2', name: 'TEE OPERATOR', legendName: 'TEE OPERATOR', group: 'VALVE ACTUATORS', tagId: '', sheet: '1', w: 14.16, h: 14.16, aliases: [], notes: [], letters: [],
    flags: { simple: false, stretch: false, manual: false, unmatched: false, operator: true }, paths: [tick([7.08, 14.16, 7.08, 0]), tick([14.16, 0, 0, 0])] };
  const lib = { ...SHAPE_LIBRARY, symbols: [...SHAPE_LIBRARY.symbols, TOP] };
  const at = [['WIDGET', { o: 0, k: 1, tx: 100, ty: 100 }]];
  const named = s => asArr(s && s.parts).map(p => p.name);
  // A line through the WIDGET's middle and a branch up from its centre: a T fits them, lying across the body.
  const across = judgeOne([...place(W, { x: 100, y: 100 }), tick([100, 106, 124, 106]), tick([112, 106, 112, 91.84])], lib, at);
  assert.ok(!named(across).includes('TEE OPERATOR'), JSON.stringify(across));
  // The T standing on the WIDGET's top, clear of it.
  const clear = judgeOne([...place(W, { x: 100, y: 100 }), tick([112, 100, 112, 85.84]), tick([104.92, 85.84, 119.08, 85.84])], lib, at);
  assert.ok(named(clear).includes('TEE OPERATOR'), JSON.stringify(clear));
});
// Owner, 2026-11-19 (H5 tiles: a ball valve ending its line, its diaphragm actuator below it): an operator may stand on
// a body's free end, along its pipe line, where no pipe leaves that end.
test('an operator on the free end of a body at the end of its line is fitted; on the piped end it is not', () => {
  const W = SHAPE_LIBRARY.symbols.find(x => x.name === 'WIDGET');
  // A short stem under a long head, as the legend's DIAPHRAGM actuator.
  const TOP = { id: 'to3', name: 'TEE OPERATOR', legendName: 'TEE OPERATOR', group: 'VALVE ACTUATORS', tagId: '', sheet: '1', w: 14.16, h: 4, aliases: [], notes: [], letters: [],
    flags: { simple: false, stretch: false, manual: false, unmatched: false, operator: true }, paths: [tick([7.08, 4, 7.08, 0]), tick([14.16, 0, 0, 0])] };
  const lib = { ...SHAPE_LIBRARY, symbols: [...SHAPE_LIBRARY.symbols, TOP] };
  const at = [['WIDGET', { o: 0, k: 1, tx: 100, ty: 100 }]];
  const named = s => asArr(s && s.parts).map(p => p.name);
  const tee = [tick([124, 106, 128, 106]), tick([128, 98.92, 128, 113.08])];
  // The line comes in from the left (40 pt, longer than the body) and ends at the WIDGET; the T stands on its free end.
  const free = judgeOne([...place(W, { x: 100, y: 100 }), tick([60, 106, 100, 106]), ...tee], lib, at);
  assert.ok(named(free).includes('TEE OPERATOR'), JSON.stringify(free));
  assert.equal(free.verdict, 'standard', JSON.stringify(free));
  // The pipe running on past the same T: the right end is piped, the T is no operator there.
  const piped = judgeOne([...place(W, { x: 100, y: 100 }), tick([60, 106, 100, 106]), ...tee, tick([128, 106, 150, 106])], lib, at);
  assert.ok(!named(piped).includes('TEE OPERATOR'), JSON.stringify(piped));
});
// A normally closed valve drawn hatched (Sheet 1's combination examples): the hatch inside both triangles is
// its fill. One triangle hatched is not in the legend.
test('a WIDGET with both triangles hatched is standard; one triangle hatched is not', () => {
  const W = SHAPE_LIBRARY.symbols.find(s => s.name === 'WIDGET');
  const hatch = (x0, dir) => { const out = []; for (let i = 1; i < 12; i += 1.5) { const h = (dir > 0 ? i : 12 - i) / 2; out.push(tick([x0 + i, 106 - (6 - h) + 0.3, x0 + i, 106 + (6 - h) - 0.3])); } return out; };
  const judge = paths => judgeOne(paths, SHAPE_LIBRARY, [['WIDGET', { o: 0, k: 1, tx: 100, ty: 100 }]]);
  const both = judge([...place(W, { x: 100, y: 100 }), ...hatch(100, 1), ...hatch(112, -1)]);
  assert.equal(both && both.verdict, 'standard', JSON.stringify(both));
  const one = judge([...place(W, { x: 100, y: 100 }), ...hatch(100, 1)]);
  assert.notEqual(one && one.verdict, 'standard', JSON.stringify(one));
});
// Gate trace (2026-11-19, C): a normally closed ball valve: the bowtie (one loop) hatched, its ball (a circle loop of
// another size) left open. The ball is no twin of the bowtie, so it need not be filled.
test('a hatched bowtie with an open ring at its middle is standard', () => {
  const ring = []; for (let k = 0; k < 24; k++) { const a0 = (k / 24) * 2 * Math.PI, a1 = ((k + 1) / 24) * 2 * Math.PI; ring.push(12 + 6 * Math.cos(a0), 6 + 6 * Math.sin(a0), 12 + 6 * Math.cos(a1), 6 + 6 * Math.sin(a1)); }
  const BALLY = { id: 'by1', name: 'BALLY', legendName: 'BALLY', group: 'VALVES', tagId: 'V', sheet: '1', w: 24, h: 12, aliases: [], notes: [], letters: [],
    flags: { simple: false, stretch: false, manual: false, unmatched: false },
    paths: [{ segs: [0, 0, 0, 12, 0, 12, 12, 6, 12, 6, 24, 12, 24, 12, 24, 0, 24, 0, 12, 6, 12, 6, 0, 0], width: 0.7, stroked: true, filled: false, grey: 0 },
      { segs: ring, width: 0.7, stroked: true, filled: false, grey: 0 }] };
  const hatch = []; for (let x = 101; x < 123; x += 1.5) { const h = Math.abs(x - 112) / 2; if (Math.abs(x - 112) < 6.6) continue; hatch.push(tick([x, 106 - h + 0.3, x, 106 + h - 0.3])); }
  const lib = { ...SHAPE_LIBRARY, symbols: [...SHAPE_LIBRARY.symbols, BALLY] };
  const s = judgeOne([...place(BALLY, { x: 100, y: 100 }), ...hatch], lib, [['BALLY', { o: 0, k: 1, tx: 100, ty: 100 }]]);
  assert.equal(s && s.verdict, 'standard', JSON.stringify(s));
});
// Two parts never stack on one ink: one flange drawn, with an unknown stroke left over, gives one FLANGED CONNECTION.
test('a flange drawn once is peeled once, however much ink is left over', () => {
  const paths = [...place(SHAPE_LIBRARY.symbols.find(x => x.name === 'GADGET'), { x: 100, y: 100 }), tick([98, 106, 98, 114]), tick([98, 110, 100, 110]),
    tick([120, 110, 126, 104, 126, 104, 132, 116])];
  const lib = { ...SHAPE_LIBRARY, symbols: [...SHAPE_LIBRARY.symbols, FLANGE] };
  const s = judgeOne(paths, lib, [['GADGET', GADGET_AT]]);
  assert.equal(s && s.verdict, 'not-standard', JSON.stringify(s));
  assert.equal(s.parts.filter(p => p.name === 'FLANGED CONNECTION').length, 1, JSON.stringify(s.parts));
});

// Item 4 (owner, 2026-11-18): a lettered box drawn small on a reduced print, with a stem up to its bubble and a stub
// down to its pipe, was read as a look-alike. Its closed outline is fitted on its own box, at the sheet's scale.
const LEVELISH = { id: 'lv1', name: 'LEVELISH', legendName: 'LEVELISH', group: 'LEVEL', tagId: 'L', sheet: '1', w: 56.67, h: 28.35, aliases: [], notes: [],
  letters: [{ text: 'X', x: 43.5, y: -1.4, size: 9.9 }, { text: 'L', x: 47.7, y: 8.7, size: 16.5 }], flags: { simple: false, stretch: false, manual: false, unmatched: false },
  paths: [{ segs: [0, 0, 56.67, 0, 56.67, 0, 56.67, 28.35, 56.67, 28.35, 0, 28.35, 0, 28.35, 0, 0], width: 0.51, stroked: true, filled: false, grey: 0 }] };
const MUFFLER = { id: 'mf1', name: 'MUFFLER', legendName: 'MUFFLER', group: 'MUFFLERS', tagId: '', sheet: '2', w: 28.44, h: 14.16, aliases: [], notes: [], letters: [],
  flags: { simple: false, stretch: false, manual: false, unmatched: false },
  paths: [{ segs: [0, 0, 28.44, 0, 28.44, 0, 28.44, 14.16, 28.44, 14.16, 0, 14.16, 0, 14.16, 0, 0], width: 0.72, stroked: true, filled: false, grey: 0 },
    tick([4.3, 9.1, 4.3, 14.16]), tick([4.3, 0, 4.3, 4.9]), tick([24.1, 9.1, 24.1, 14.16]), tick([24.1, 0, 24.1, 4.9])] };
const LEVEL_LIB = { ...SHAPE_LIBRARY, symbols: [...SHAPE_LIBRARY.symbols, LEVELISH, MUFFLER] };
const glyph = (x0, y0, x1, y1) => ({ segs: [x0, y0, x1, y0, x1, y0, x1, y1, x1, y1, x0, y1, x0, y1, x0, y0], width: 0, stroked: false, filled: true, grey: 0 });
// The box turned upright, `share` of the sheet's size (0.432), at (200, 100); its stem, its stub and two letters.
const levelSheet = (share, letters = true, stems = true, scale = 0.432, library = LEVEL_LIB) => {
  const k = scale * share, w = 28.35 * k, h = 56.67 * k, x = 200, y = 100, mx = x + w / 2;
  const box = [tick([x, y, x + w, y]), tick([x + w, y, x + w, y + h]), tick([x + w, y + h, x, y + h]), tick([x, y + h, x, y])];
  // stems 'down': one straight stem from the bottom edge's middle down to (not into) its bubble, as on H2.
  const stem = stems === 'down' ? [tick([mx, y + h, mx, y + h + 0.77 * h])]
    : stems ? [tick([mx, y, mx, y - 10.8]), tick([mx, y - 10.8, mx + 4, y - 10.8]), tick([mx, y + h, mx, y + h + 0.7])] : [];
  const lets = letters ? [glyph(x + 0.8, y + h - 2, x + 2.8, y + h - 0.7), glyph(x + w - 1.7, y + h - 2.3, x + w - 0.5, y + h - 1.2)] : [];
  const writing = letters ? [[x + 0.8, y + h - 2, x + 2.8, y + h - 0.7], [x + w - 1.7, y + h - 2.3, x + w - 0.5, y + h - 1.2]] : [];
  const r = C.checkSheet({ pageSize: [400, 300], viewportTransform: [1, 0, 0, 1, 0, 0], textItems: [], tags: [], paths: [...box, ...stem, ...lets], writing,
    library, lookups: {}, options: { sizeScale: scale } });
  return r.shapes.find(s => s.box[0] <= x + 0.5 && s.box[2] >= x + w - 0.5 && s.box[1] <= y + 1 && s.box[3] >= y + h - 1);
};
test('a lettered box with a stem and a stub on a print at 43% is fitted on its own outline: LEVELISH at sheet size', () => {
  const s = levelSheet(1);
  assert.ok(s, 'a shape there');
  assert.ok(s.parts.some(p => p.name === 'LEVELISH' && p.role === 'body'), JSON.stringify(s));
  assert.notEqual(s.reason && s.reason.kind, 'size', JSON.stringify(s));
});
test('the same box drawn at 58% of the sheet size is LEVELISH drawn small, not a look-alike', () => {
  const s = levelSheet(0.58);
  assert.equal(s && s.verdict, 'not-standard', JSON.stringify(s));
  assert.equal(s.reason.kind, 'size', JSON.stringify(s));
  assert.equal(s.reason.name, 'LEVELISH');
  assert.ok(Math.abs(s.reason.pct - 58) <= 3, String(s.reason.pct));
});
// Gate fault (2026-11-19): H2's lettered rectangles had their bottom edge read as a letter (a writing box over that one
// stroke). A "letter" joined at its end to the shape's other linework is linework.
test('an edge under a writing box of its own, joined to the rest of the outline, stays the outline ink', () => {
  // A WIDGET drawn edge by edge, each edge its own path (as H2's rectangles are).
  const edges = [[100, 100, 100, 112], [100, 112, 112, 106], [112, 106, 100, 100], [124, 100, 124, 112], [124, 112, 112, 106], [112, 106, 124, 100]].map(tick);
  const s = judgeOne(edges, SHAPE_LIBRARY, [], {}, [[100, 100, 100, 112]]);
  assert.equal(s && s.verdict, 'standard', JSON.stringify(s));
});
// Gate fault (2026-11-19): on a sheet drawn larger than the legend (P2, 1.22) a reducer drawn at 61% of the legend
// fell below the fit band moved up to the sheet's size. The fit looks at the legend's size and the sheet's, both.
test('on a sheet drawn at 122%, a box drawn at half the sheet size is still fitted: LEVELISH drawn small', () => {
  const s = levelSheet(0.5, true, true, 1.22);
  assert.equal(s && s.verdict, 'not-standard', JSON.stringify(s));
  assert.equal(s.reason && s.reason.kind, 'size', JSON.stringify(s));
  assert.equal(s.reason.name, 'LEVELISH');
});
// Gate fault (2026-11-19, H2 tiles 5-7): a small plain T (SCREENINGS COMPACTOR OUTLET FLANGE) found on the box's edge
// and its stem explained a fifth of the shape, and kept the box fit from running. A plain find that leaves most of
// its shape unexplained does not stop the box fit; the fit that explains more is kept.
const TEE = { id: 'te1', name: 'TEE FLANGE', legendName: 'TEE FLANGE', group: 'FITTINGS', tagId: '', sheet: '2', w: 14.16, h: 7.08, aliases: [], notes: [], letters: [],
  flags: { simple: true, stretch: false, manual: false, unmatched: false }, paths: [tick([7.08, 0, 7.08, 7.08]), tick([14.16, 7.08, 0, 7.08])] };
test('a plain T on the box edge and its stem does not hide LEVELISH drawn small', () => {
  // The judge alone, the box (LEVELISH upright at 58%), its stem down and its letters in one shape, as on H2.
  const k = 0.58, w = 28.35 * k, h = 56.67 * k, x = 200, y = 100, mx = x + w / 2;
  const paths = [tick([x, y, x + w, y]), tick([x + w, y, x + w, y + h]), tick([x + w, y + h, x, y + h]), tick([x, y + h, x, y]), tick([mx, y + h, mx, y + h + 0.77 * h]),
    glyph(x + 1.8, y + h - 4.6, x + 6.4, y + h - 1.6), glyph(x + w - 3.9, y + h - 5.3, x + w - 1.2, y + h - 2.8)];
  const writing = [[x + 1.8, y + h - 4.6, x + 6.4, y + h - 1.6], [x + w - 3.9, y + h - 5.3, x + w - 1.2, y + h - 2.8]];
  const s = judgeOne(paths, { ...LEVEL_LIB, symbols: [...LEVEL_LIB.symbols, TEE] }, [], {}, writing);
  assert.equal(s && s.verdict, 'not-standard', JSON.stringify(s));
  assert.equal(s.reason && s.reason.kind, 'size', JSON.stringify(s));
  assert.equal(s.reason.name, 'LEVELISH');
});
test('outlineBox: a stem drawn twice is one line, still taken off; hostile input gives null', () => {
  // A 10 x 20 box with a stem 8 down from its bottom edge's middle, the stem drawn twice (as H2's stems are).
  const S = [[0, 0, 10, 0, 10], [10, 0, 10, 20, 20], [10, 20, 0, 20, 10], [0, 20, 0, 0, 20], [5, 20, 5, 28, 8], [5, 28, 5, 20, 8]];
  assert.deepEqual(C.outlineBox(S, [0, 1, 2, 3, 4, 5]), [0, 0, 10, 20]);
  assert.deepEqual(C.outlineBox(S, [0, 1, 2, 3, 4]), [0, 0, 10, 20]);
  assert.equal(C.outlineBox(null, [1]), null);
  assert.equal(C.outlineBox([[0, 0, 5, 0, 5], [5, 0, 0, 0, 5]], [0, 1]), null);
});
test('fits tied on score go to the lettered symbol when its shape holds writing', () => {
  const BOXY = { id: 'bx1', name: 'BOXY', legendName: 'BOXY', group: 'BOXES', tagId: '', sheet: '1', w: 50, h: 30, aliases: [], notes: [], letters: [],
    flags: { simple: false, stretch: false, manual: false, unmatched: false }, paths: [{ segs: [0, 0, 50, 0, 50, 0, 50, 30, 50, 30, 0, 30, 0, 30, 0, 0], width: 0.5, stroked: true, filled: false, grey: 0 }] };
  const k = 0.58, w = 28.35 * k, h = 56.67 * k, x = 200, y = 100, mx = x + w / 2;
  const paths = [tick([x, y, x + w, y]), tick([x + w, y, x + w, y + h]), tick([x + w, y + h, x, y + h]), tick([x, y + h, x, y]), tick([mx, y + h, mx, y + h + 0.77 * h]),
    glyph(x + 1.8, y + h - 4.6, x + 6.4, y + h - 1.6)];
  const s = judgeOne(paths, { ...LEVEL_LIB, symbols: [BOXY, ...LEVEL_LIB.symbols] }, [], {}, [[x + 1.8, y + h - 4.6, x + 6.4, y + h - 1.6]]);
  assert.equal(s && s.reason && s.reason.name, 'LEVELISH', JSON.stringify(s));
  // No writing in it: the bare box is never LEVELISH.
  const t = judgeOne(paths.slice(0, 5), { ...LEVEL_LIB, symbols: [BOXY, ...LEVEL_LIB.symbols] }, []);
  assert.ok(!asArr(t && t.parts).some(p => p.name === 'LEVELISH'), JSON.stringify(t));
});
// Owner, 2026-11-19 (H4 "HOLD 1"): a text box is no lettered symbol. The writing in a lettered symbol's box is no more
// than LETTER_ROOM times the room its own letters take in the legend.
test('a box filled with a word is never a lettered symbol; its few letters still are', () => {
  const k = 0.58, w = 28.35 * k, h = 56.67 * k, x = 200, y = 100;
  const box = [tick([x, y, x + w, y]), tick([x + w, y, x + w, y + h]), tick([x + w, y + h, x, y + h]), tick([x, y + h, x, y])];
  const word = [[x + 2, y + 3, x + w - 2, y + h - 3]];
  const s = judgeOne(box, LEVEL_LIB, [], {}, word);
  assert.ok(!asArr(s && s.parts).some(p => p.name === 'LEVELISH'), JSON.stringify(s));
  const few = [[x + 1.8, y + h - 4.6, x + 6.4, y + h - 1.6]];
  const t = judgeOne(box, LEVEL_LIB, [], {}, few);
  assert.ok(asArr(t && t.parts).some(p => p.name === 'LEVELISH'), JSON.stringify(t));
});
test('a bare box with no letters in it is never green as a lettered symbol', () => {
  const s = levelSheet(1, false, false);
  assert.ok(s, 'a shape there');
  assert.ok(!(s.verdict === 'standard' && asArr(s.parts).some(p => p.name === 'LEVELISH')), JSON.stringify(s));
});
const asArr = v => (Array.isArray(v) ? v : []);
// Gate fault (2026-11-19): a printed sheet's reader took each small bowtie on H1 for a letter, its writing box the
// bowtie's own box. Letters are taken out only from a shape that has linework besides them.
test('a shape that is all "letters" is still fitted on its own ink: a lone WIDGET under a writing box of its own size', () => {
  const W = SHAPE_LIBRARY.symbols.find(x => x.name === 'WIDGET');
  const plain = judgeOne(place(W, { x: 100, y: 100 }), SHAPE_LIBRARY, []);
  assert.equal(plain && plain.verdict, 'standard', JSON.stringify(plain));
  const s = judgeOne(place(W, { x: 100, y: 100 }), SHAPE_LIBRARY, [], {}, [[100, 100, 124, 112]]);
  assert.equal(s && s.verdict, 'standard', JSON.stringify(s));
});

// Legend rules, Task 5 (2026-11-18): line marks (Sheet 1's SIGNAL ticks) are part of their line, and a straight
// line from a body to its tag bubble is a connection, not the body's ink.
const SLASH = { id: 'lm1', name: 'SIGNAL - SLASH', legendName: 'SIGNAL - SLASH', group: 'LINE TYPES', tagId: '', sheet: '1', w: 7, h: 6.8, letters: [], aliases: [], notes: [],
  flags: { simple: false, stretch: false, manual: false, unmatched: false, judgeOnly: true, lineMark: 'signal' },
  paths: [{ segs: [0, 3.4, 7, 3.4], width: 0.5, stroked: true, filled: false, grey: 0 }, { segs: [2.6, 0, 4.4, 6.8], width: 0.5, stroked: true, filled: false, grey: 0 }] };
const MARK_LIB = { ...SHAPE_LIBRARY, symbols: [...SHAPE_LIBRARY.symbols, SLASH] };
// The judge on a hand-made split: groups of paths, each one shape (closed: a ring); lines: paths in the split's lines.
const judgeSplit = (groups, library, spots, { lines = [], writing = [], sizeScale = 1 } = {}) => {
  const cfg = { ...C.CHECK_DEFAULTS };
  const prepared = C.prepareSymbols(library, cfg);
  const paths = [], segments = [], boxed = [], shapes = [], lineList = [];
  const add = p => {
    const pi = paths.push(p) - 1, idx = [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i + 3 < p.segs.length; i += 4) {
      const q = p.segs.slice(i, i + 4);
      idx.push(segments.push([...q, Math.hypot(q[2] - q[0], q[3] - q[1]), pi]) - 1);
      x0 = Math.min(x0, q[0], q[2]); x1 = Math.max(x1, q[0], q[2]); y0 = Math.min(y0, q[1], q[3]); y1 = Math.max(y1, q[1], q[3]);
    }
    boxed.push({ p, b: [x0, y0, x1, y1] });
    return { idx, b: [x0, y0, x1, y1] };
  };
  groups.forEach(({ paths: ps, closed = false }, gi) => {
    const got = ps.map(add), pieces = got.flatMap(g => g.idx);
    const box = got.reduce((u, g) => [Math.min(u[0], g.b[0]), Math.min(u[1], g.b[1]), Math.max(u[2], g.b[2]), Math.max(u[3], g.b[3])], [Infinity, Infinity, -Infinity, -Infinity]);
    shapes.push({ id: gi, pieces, box, closed });
  });
  for (const p of lines) lineList.push({ kind: 'run', pieces: add(p).idx });
  const split = { segments, shapes, lines: lineList, arrows: [] };
  const sp = spots.map(([name, placement]) => ({ hit: { p: prepared[library.symbols.findIndex(x => x.name === name)], placement, score: 1 }, symbol: 0 }));
  return C.judgeShapes({ cfg, prepared, boxed, paths, split, spots: sp, near: [], rejected: [], writing, sizeScale });
};
const WIDGET_AT = { o: 0, k: 1, tx: 100, ty: 100 };
const slashAt = (x, y) => tick([x - 0.9, y - 3.4, x + 0.9, y + 3.4]);
const widgetStubs = () => [...place(SHAPE_LIBRARY.symbols.find(s => s.name === 'WIDGET'), { x: 100, y: 100 }), tick([94, 106, 100, 106]), tick([124, 106, 130, 106]), tick([130, 106, 136, 106])];
const widgetShape = sh => sh.find(x => x.box[0] <= 101 && x.box[2] >= 123);
test('a body whose pipe carries a signal tick past its edge: the cut passes the tick, the body is standard', () => {
  const s = widgetShape(judgeSplit([{ paths: [...widgetStubs(), slashAt(130, 106)] }], MARK_LIB, [['WIDGET', WIDGET_AT]]));
  assert.equal(s && s.verdict, 'standard', JSON.stringify(s));
  // The library with no line marks (not re-imported): as before, the tick stops the cut.
  const t = widgetShape(judgeSplit([{ paths: [...widgetStubs(), slashAt(130, 106)] }], SHAPE_LIBRARY, [['WIDGET', WIDGET_AT]]));
  assert.notEqual(t && t.verdict, 'standard', JSON.stringify(t));
});
// Gate trace (2026-11-19, C): a Z mark (SIGNAL - ELECTRIC) across a body's pipe has ticks parallel to the line, each
// at least 3 pt long. They were taken for lines, so the mark was read without them and they were left over.
const ZED = { id: 'lm2', name: 'SIGNAL - ZED', legendName: 'SIGNAL - ZED', group: 'LINE TYPES', tagId: '', sheet: '1', w: 7.4, h: 6.84, letters: [], aliases: [], notes: [],
  flags: { simple: false, stretch: false, manual: false, unmatched: false, judgeOnly: true, lineMark: 'signal' },
  paths: [{ segs: [6.4, 0, 2.8, 0, 2.8, 0, 1, 6.8, 1, 6.8, 4.5, 6.8], width: 0.5, stroked: true, filled: false, grey: 0 }, { segs: [0, 3.5, 7.4, 3.5], width: 0.5, stroked: true, filled: false, grey: 0 }] };
test('a Z mark whose ticks run along the pipe is a mark, ticks and all: the body is standard', () => {
  const zed = [tick([132.6, 102.5, 129, 102.5]), tick([129, 102.5, 127.2, 109.3]), tick([127.2, 109.3, 130.7, 109.3])];
  const s = widgetShape(judgeSplit([{ paths: [...widgetStubs(), ...zed] }], { ...SHAPE_LIBRARY, symbols: [...SHAPE_LIBRARY.symbols, ZED] }, [['WIDGET', WIDGET_AT]]));
  assert.equal(s && s.verdict, 'standard', JSON.stringify(s));
});
test('the same with every path drawn twice (as C draws them): still standard', () => {
  const zed = [tick([132.6, 102.5, 129, 102.5]), tick([129, 102.5, 127.2, 109.3]), tick([127.2, 109.3, 130.7, 109.3])];
  const all = [...widgetStubs(), ...zed];
  const s = widgetShape(judgeSplit([{ paths: [...all, ...all.map(p => ({ ...p, segs: p.segs.slice() }))] }], { ...SHAPE_LIBRARY, symbols: [...SHAPE_LIBRARY.symbols, ZED] }, [['WIDGET', WIDGET_AT]]));
  assert.equal(s && s.verdict, 'standard', JSON.stringify(s));
});
// Gate trace (2026-11-19, C): a flow arrow on a body's pipe, and the pipe running on past it. The body's cut stops at the
// arrow; the arrow sits on the pipe, so the straight run leaving its far end in line is pipe too.
const FARROW = { id: 'fa1', name: 'DIRECTION FLOW ARROW', legendName: 'DIRECTION FLOW ARROW', group: 'LINE TYPES', tagId: '', sheet: '1', w: 14.16, h: 7.08, letters: [], aliases: [], notes: [],
  flags: { simple: false, stretch: false, manual: false, unmatched: false, judgeOnly: true },
  paths: [{ segs: [0, 0, 14.16, 3.54, 14.16, 3.54, 0, 7.08, 0, 7.08, 0, 0], width: 0.3, stroked: true, filled: true, grey: 0 }] };
test('the pipe running on past a flow arrow on the body’s pipe is pipe: the body standard', () => {
  const W = SHAPE_LIBRARY.symbols.find(x => x.name === 'WIDGET');
  const arrow = { segs: [130, 102.46, 144.16, 106, 144.16, 106, 130, 109.54, 130, 109.54, 130, 102.46], width: 0.3, stroked: true, filled: true, grey: 0 };
  const paths = [...place(W, { x: 100, y: 100 }), tick([94, 106, 100, 106]), tick([124, 106, 130, 106]), arrow, tick([144.16, 106, 164, 106])];
  const s = widgetShape(judgeSplit([{ paths }], { ...SHAPE_LIBRARY, symbols: [...SHAPE_LIBRARY.symbols, FARROW] }, [['WIDGET', WIDGET_AT]]));
  assert.equal(s && s.verdict, 'standard', JSON.stringify(s));
});
test('a tick standing alone on a long line is part of the line: no box, counted', () => {
  const r = judgeSplit([{ paths: [slashAt(170, 200)] }], MARK_LIB, [], { lines: [tick([40, 200, 170, 200]), tick([170, 200, 300, 200])] });
  assert.equal(r.filter(x => !x.lineMark).length, 0, JSON.stringify(r));
  assert.equal(r.filter(x => x.lineMark).length, 1);
  // An unknown stroke on the line is still a shape.
  const u = judgeSplit([{ paths: [tick([168, 196, 172, 204, 172, 204, 176, 196])] }], MARK_LIB, [], { lines: [tick([40, 200, 300, 200])] });
  assert.equal(u.filter(x => !x.lineMark).length, 1, JSON.stringify(u));
});
const ringAt = (cx, cy, r) => tick(Array.from({ length: 32 }, (_, i) => { const a = 2 * Math.PI * i / 32, b = 2 * Math.PI * (i + 1) / 32; return [cx + r * Math.cos(a), cy + r * Math.sin(a), cx + r * Math.cos(b), cy + r * Math.sin(b)]; }).flat());
// A lead from the WIDGET's top edge up 20 pt, then 4 pt across into a written ring (as H2's strain gauge).
const lead = [tick([112, 100, 112, 80]), tick([112, 80, 116, 80])];
const bubbleGroup = { paths: [ringAt(136, 80, 20)], closed: true };
const tagWriting = [[128, 72, 144, 88]];
test('a lead from a body to its tag bubble is a connection: cut off, the body standard', () => {
  const r = judgeSplit([{ paths: [...widgetStubs().slice(0, -1), ...lead] }, bubbleGroup], MARK_LIB, [['WIDGET', WIDGET_AT]], { writing: tagWriting });
  const s = widgetShape(r);
  assert.equal(s && s.verdict, 'standard', JSON.stringify(r));
});
// Gate trace (2026-11-19, C): a Z mark on a body's lead to its bubble; the lead took only the stroke crossing it.
test('a Z mark on the lead to the bubble goes with the lead, every stroke of it: the body standard', () => {
  const zed = [tick([108.5, 92.4, 108.5, 88.8]), tick([108.5, 88.8, 115.3, 87]), tick([115.3, 87, 115.3, 90.5])];
  const lib = { ...SHAPE_LIBRARY, symbols: [...SHAPE_LIBRARY.symbols, ZED] };
  const r = judgeSplit([{ paths: [...widgetStubs().slice(0, -1), ...lead, ...zed] }, bubbleGroup], lib, [['WIDGET', WIDGET_AT]], { writing: tagWriting });
  const s = widgetShape(r);
  assert.equal(s && s.verdict, 'standard', JSON.stringify(s));
});
// Contractor set (2026-11-20): signal-line Z marks drawn at half the legend's size, and the lead broken into a piece
// between every pair of marks. Line marks are matched from MARK_MIN of the legend size; a lead's legs are its turns.
test('a lead carrying half-size Z marks is still a lead: the body standard', () => {
  const zed = [tick([110.25, 91.05, 110.25, 89.25]), tick([110.25, 89.25, 113.65, 88.35]), tick([113.65, 88.35, 113.65, 90.1])];
  const lib = { ...SHAPE_LIBRARY, symbols: [...SHAPE_LIBRARY.symbols, ZED] };
  const r = judgeSplit([{ paths: [...widgetStubs().slice(0, -1), ...lead, ...zed] }, bubbleGroup], lib, [['WIDGET', WIDGET_AT]], { writing: tagWriting });
  const s = widgetShape(r);
  assert.equal(s && s.verdict, 'standard', JSON.stringify(s));
});
test('a lead drawn as many short pieces in one straight line is one leg: the body standard', () => {
  const pieces = []; for (let y = 100; y > 80; y -= 2.5) pieces.push(tick([112, y, 112, y - 2.5]));
  const r = judgeSplit([{ paths: [...widgetStubs().slice(0, -1), ...pieces, tick([112, 80, 116, 80])] }, bubbleGroup], MARK_LIB, [['WIDGET', WIDGET_AT]], { writing: tagWriting });
  const s = widgetShape(r);
  assert.equal(s && s.verdict, 'standard', JSON.stringify(s));
});
test('a Z mark where another line crosses the lead through it is still a mark: the body standard', () => {
  const zed = [tick([108.5, 92.4, 108.5, 88.8]), tick([108.5, 88.8, 115.3, 87]), tick([115.3, 87, 115.3, 90.5])];
  const lib = { ...SHAPE_LIBRARY, symbols: [...SHAPE_LIBRARY.symbols, ZED] };
  // A long line (another shape's, as a tank wall) crossing the lead at the mark.
  const r = judgeSplit([{ paths: [...widgetStubs().slice(0, -1), ...lead, ...zed] }, bubbleGroup], lib, [['WIDGET', WIDGET_AT]],
    { writing: tagWriting, lines: [tick([60, 89.2, 112, 89.2]), tick([112, 89.2, 170, 89.2])] });
  const s = widgetShape(r);
  assert.equal(s && s.verdict, 'standard', JSON.stringify(s));
});
// Owner, 2026-11-20 (a float switch's or ultrasonic's inner marks boxed red on their own): a shape lying wholly inside a
// symbol found in another shape is part of that symbol: no box of its own.
test('a shape inside a found symbol is not boxed on its own; one beside it still is', () => {
  const W = SHAPE_LIBRARY.symbols.find(x => x.name === 'WIDGET');
  const inner = { paths: [tick([104, 102, 106, 102]), tick([106, 102, 106, 104])] };
  const beside = { paths: [tick([140, 102, 142, 102]), tick([142, 102, 142, 104])] };
  const r = judgeSplit([{ paths: place(W, { x: 100, y: 100 }) }, inner, beside], SHAPE_LIBRARY, [['WIDGET', WIDGET_AT]]);
  assert.ok(!r.some(x => x.box[0] >= 103 && x.box[2] <= 107), JSON.stringify(r.map(x => x.box)));
  assert.ok(r.some(x => x.box[0] >= 139 && x.box[2] <= 143), JSON.stringify(r.map(x => x.box)));
});
test('the same lead ending on nothing stays the body ink', () => {
  const r = judgeSplit([{ paths: [...widgetStubs().slice(0, -1), ...lead] }], MARK_LIB, [['WIDGET', WIDGET_AT]]);
  const s = widgetShape(r);
  assert.notEqual(s && s.verdict, 'standard', JSON.stringify(s));
});

// Legend rules, Task 6 (2026-11-18): the INSTRUMENTATION DESIGNATION examples. A rim mark beside a bubble is green
// with it; bubbles drawn touching are matched ring by ring.
const QMARK = { id: 'q1', name: 'QUALITY MARK', legendName: 'QUALITY MARK', group: 'INSTRUMENTATION DESIGNATION', tagId: '', sheet: '1', w: 7.1, h: 7.1, letters: [], aliases: [], notes: [],
  flags: { simple: false, stretch: false, manual: false, unmatched: false, judgeOnly: true }, paths: [tick([0, 0, 7.1, 0, 7.1, 0, 7.1, 7.1, 7.1, 7.1, 0, 7.1, 0, 7.1, 0, 0])] };
const RIM_LIB = { ...SHAPE_LIBRARY, symbols: [...SHAPE_LIBRARY.symbols, QMARK] };
const square = (x, y, d) => tick([x, y, x + d, y, x + d, y, x + d, y + d, x + d, y + d, x, y + d, x, y + d, x, y]);
test('a bubble with a quality mark touching its ring is standard, the mark named', () => {
  const r = judgeSplit([{ paths: [ringAt(100, 100, 20), square(120, 96.45, 7.1)] }], RIM_LIB, [], { writing: [[92, 92, 108, 108]] });
  assert.equal(r[0].verdict, 'standard', JSON.stringify(r[0]));
  assert.ok(r[0].parts.some(p => p.name === 'QUALITY MARK' && p.role === 'attachment'), JSON.stringify(r[0].parts));
});
test('two bubbles drawn touching, each with writing, are standard ring by ring', () => {
  const r = judgeSplit([{ paths: [ringAt(100, 100, 20), ringAt(100, 140, 20)] }], RIM_LIB, [], { writing: [[92, 92, 108, 108], [92, 132, 108, 148]] });
  assert.equal(r[0].verdict, 'standard', JSON.stringify(r[0]));
  assert.equal(r[0].parts.filter(p => p.role === 'body').length, 2, JSON.stringify(r[0].parts));
});
test('a ring with an unknown stroke beside it is not standard', () => {
  const r = judgeSplit([{ paths: [ringAt(100, 100, 20), tick([120, 100, 126, 92, 126, 92, 132, 108])] }], RIM_LIB, [], { writing: [[92, 92, 108, 108]] });
  assert.notEqual(r[0].verdict, 'standard', JSON.stringify(r[0]));
});

// Gate run 1 (2026-11-18): reducers on the attachments list, found alone, are bodies and keep the size rule (the
// spec's "a reducer on a pipe"). Only small plain attachments (a flange tick, a padlock) never fit alone.
test('a symbol on the attachments list found alone is still fitted and size-judged when it is not plain', () => {
  const ln = segs => ({ segs, width: 0.7, stroked: true, filled: false, grey: 0 });
  const TAPER = { id: 't1', name: 'TAPER', legendName: 'TAPER', group: 'TAPERS', tagId: 'Q', sheet: '1', w: 21, h: 28, letters: [], aliases: [], notes: [],
    flags: { simple: false, stretch: false, manual: false, unmatched: false },
    paths: [ln([0, 28, 0, 0]), ln([0, 28, 21, 21]), ln([21, 21, 21, 7]), ln([21, 7, 0, 0])] };
  const lib = { ...SHAPE_LIBRARY, symbols: [...SHAPE_LIBRARY.symbols, TAPER] };
  const sq = v => 100 + v * 20 / 28;
  const drawn = [ln([100, sq(28), 100, sq(0)]), ln([100, sq(28), 121, sq(21)]), ln([121, sq(21), 121, sq(7)]), ln([121, sq(7), 100, sq(0)]),
    ln([20, sq(14), 100, sq(14)]), ln([121, sq(14), 200, sq(14)])];
  const page = attachments => C.checkSheet({ pageSize: [300, 250], viewportTransform: [1, 0, 0, 1, 0, 0], textItems: [], tags: [], paths: drawn, library: lib, lookups: {}, options: { attachments } });
  const s = page(['TAPER']).shapes.find(x => x.box[0] <= 101 && x.box[2] >= 120);
  assert.equal(s && s.standard, true, JSON.stringify(s));
});
// Gate run 1 (2026-11-18): the operator rule holds only for a body that carries a pipe on the drawing. A small body
// with no pipe drawn (LOCKED on C's actuators) still carries an operator wherever it stands.
test('an operator beside a small body with no pipe drawn is still placed', () => {
  const W = SHAPE_LIBRARY.symbols.find(s => s.name === 'WIDGET');
  // HANDLE upright on the WIDGET's top-left corner, no pipe anywhere: its centre lies just past the body's end.
  const paths = [...place(W, { x: 100, y: 100 }), tick([99.5, 100, 99.5, 92]), tick([94.5, 92, 104.5, 92])];
  const s = judgeOne(paths, OPERATOR_LIBRARY, [['WIDGET', { o: 0, k: 1, tx: 100, ty: 100 }]]);
  assert.equal(s && s.operator && s.operator.name, 'HANDLE', JSON.stringify(s));
});

// Binder test 3: a valve found by the box fit (drawn in other proportions than the legend) had the line to its tag
// bubble, and the pipe with its flow arrow, inside its box and its ink. A body found by the sweep has them cut (2b);
// a body found by the fit now has them cut too, so its box is its own.
describe_fit_cut();
function describe_fit_cut() {
  const ln = segs => ({ segs, width: 0.7, stroked: true, filled: false, grey: 0 });
  const TAPER = { id: 't1', name: 'TAPER', legendName: 'TAPER', group: 'TAPERS', tagId: 'Q', sheet: '1', w: 21, h: 28, letters: [], aliases: [], notes: [],
    flags: { simple: false, stretch: false, manual: false, unmatched: false },
    paths: [ln([0, 28, 0, 0]), ln([0, 28, 21, 21]), ln([21, 21, 21, 7]), ln([21, 7, 0, 0])] };
  const lib = { ...SHAPE_LIBRARY, symbols: [...SHAPE_LIBRARY.symbols, TAPER] };
  const sq = v => 100 + v * 20 / 28;   // the taper squashed to 20 across, its left edge at x 100, spanning y 100-120
  const taper = [ln([100, sq(28), 100, sq(0)]), ln([100, sq(28), 121, sq(21)]), ln([121, sq(21), 121, sq(7)]), ln([121, sq(7), 100, sq(0)])];
  const ring = (cx, cy, r) => ln(Array.from({ length: 32 }, (_, i) => { const a = 2 * Math.PI * i / 32, b = 2 * Math.PI * (i + 1) / 32; return [cx + r * Math.cos(a), cy + r * Math.sin(a), cx + r * Math.cos(b), cy + r * Math.sin(b)]; }).flat());
  const page = (paths, extra = {}) => ({ pageSize: [400, 250], viewportTransform: [1, 0, 0, 1, 0, 0], textItems: [], tags: [], paths, library: lib, lookups: {}, ...extra });
  const tall = r => r.shapes.find(x => x.box[2] >= 120 && x.box[2] <= 122 && x.box[1] <= 101);
  test('a fitted body keeps its own box when a 22 pt lead runs from its left edge to the rim of a bubble holding writing', () => {
    const paths = [...taper, ln([78, 110, 100, 110]), ring(58, 110, 20)];
    const r = C.checkSheet(page(paths, { writing: [[50, 102, 66, 118]] }));
    const s = tall(r);
    assert.ok(s, JSON.stringify(r.shapes));
    assert.ok(s.box[0] >= 99 && s.box[0] <= 101, 'box ' + s.box);   // not out to the bubble at x 78
    assert.equal(s.verdict, 'standard', JSON.stringify(s));
  });
  test('the pipe carrying a filled flow arrow, drawn off the fitted body, is cut from its box too', () => {
    const arrow = { segs: [150, 106, 164, 110, 164, 110, 150, 114, 150, 114, 150, 106], width: 0.3, stroked: true, filled: true, grey: 0 };
    const paths = [...taper, ln([121, 110, 150, 110]), arrow];
    const r = C.checkSheet(page(paths));
    const s = tall(r);
    assert.ok(s, JSON.stringify(r.shapes));
    assert.ok(s.box[2] <= 122, 'box ' + s.box);
  });
  test('a body that is not found stays as it was: a plain box with a lead to a bubble is not cut', () => {
    const box = [ln([100, 100, 121, 100]), ln([121, 100, 121, 120]), ln([121, 120, 100, 120]), ln([100, 120, 100, 100]), ln([78, 110, 100, 110]), ring(58, 110, 20)];
    const r = C.checkSheet(page(box, { writing: [[50, 102, 66, 118]] }));
    const s = r.shapes.find(x => x.box[2] >= 120 && x.box[2] <= 122);
    assert.notEqual(s && s.verdict, 'standard');
  });
}

// Report overlay (2026-11-27): a not-standard shape records the symbol it was matched to, placed where the verdict laid
// it, and the drawn pieces that symbol does not account for, so the report can draw the difference.
function overlayCase(k) {
  const ln = segs => ({ segs, width: 0.3, stroked: true, filled: false, grey: 0 });
  const TAPER = { id: 't1', name: 'TAPER', legendName: 'TAPER', group: 'TAPERS', tagId: 'Q', sheet: '1', w: 21, h: 28, letters: [], aliases: [], notes: [],
    flags: { simple: false, stretch: false, manual: false, unmatched: false },
    paths: [ln([0, 28, 0, 0]), ln([0, 28, 21, 21]), ln([21, 21, 21, 7]), ln([21, 7, 0, 0])] };
  const lib = { ...SHAPE_LIBRARY, symbols: [...SHAPE_LIBRARY.symbols, TAPER] };
  const ky = k * 20 / 28, X = v => 100 + v * k, Y = v => 100 + v * ky;
  const paths = [ln([X(0), Y(28), X(0), Y(0)]), ln([X(0), Y(28), X(21), Y(21)]), ln([X(21), Y(21), X(21), Y(7)]), ln([X(21), Y(7), X(0), Y(0)]),
    ln([20, Y(14), X(0), Y(14)]), ln([X(21), Y(14), 250, Y(14)])];
  const r = C.checkSheet({ pageSize: [300, 250], viewportTransform: [1, 0, 0, 1, 0, 0], textItems: [], tags: [], paths, library: lib, lookups: {}, options: { sizeScale: 1.3 } });
  return r.shapes.find(x => x.box[0] <= 101 && x.box[2] >= 100 + 21 * k - 1);
}
test('an off-size shape records its overlay: the matched symbol placed on the shape, and nothing unmatched', () => {
  const t = overlayCase(2.2);
  assert.equal(t.verdict, 'not-standard');
  const o = t.overlay;
  assert.ok(o, JSON.stringify(t));
  assert.equal(o.name, 'TAPER');
  assert.ok(o.symbol.length >= 4 && o.symbol.every(g => g.length === 4 && g.every(Number.isFinite)));
  assert.ok(o.placedBox.every(Number.isFinite));
  assert.ok(o.placedBox[0] >= t.box[0] - 1 && o.placedBox[2] <= t.box[2] + 1);
  assert.ok(Array.isArray(o.unmatched));
  assert.equal(o.expected, null);   // a stretched fit has no single scale to show
  assert.ok(o.drawn.length >= 4 && o.drawn.length <= 200 && o.drawn.every(g => g.length === 4 && g.every(Number.isFinite)), 'the shape ink, for the screen to draw');
});
test('a standard shape has no overlay', () => {
  const s = overlayCase(1.3);
  assert.equal(s.verdict, 'standard');
  assert.equal('overlay' in s, false);
});
test('thinTo keeps at most the limit, evenly spread, and a short list as it is', () => {
  const list = Array.from({ length: 500 }, (_, i) => [i, 0, i + 1, 0]);
  const t = C.thinTo(list, 200);
  assert.equal(t.length, 200);
  assert.deepEqual(t[0], list[0]);
  assert.ok(t[199][0] >= 490);
  assert.deepEqual(C.thinTo(list.slice(0, 50), 200), list.slice(0, 50));
  assert.deepEqual(C.thinTo(null, 200), []);
});

// SP66 (owner, 2026-11-25): two valves in a row, each with its actuator standing beside it as a shape of its own. A body
// took the actuator that suited the legend best among its neighbours, not its own: each valve's box then ran across the
// other's actuator, and the two boxes overlapped. An actuator belongs to the nearer body, whatever order the shapes come in.
// NOTE: a guard only. No invented drawing reproduced the real tie (two actuator placements scoring alike, the far one tried
// first); the real sheet did, and its before/after verdicts are what proved the fix (see the commit message).
import { HANDLE } from './fixtures/symbol-check-sheet.js';
test('two bodies in a row, each with an actuator of its own cut off: each box holds its own actuator only', () => {
  const W = SHAPE_LIBRARY.symbols.find(s => s.name === 'WIDGET');
  const at = x => ({ o: 0, k: 1, tx: x, ty: 100 });
  // Bodies at x 100 and 150 (24 wide); each actuator 5 pt above its own body, 33 pt from the other. The first actuator is
  // drawn half a point off.
  const g = { B1: { paths: place(W, { x: 100, y: 100 }) }, H1: { paths: place(HANDLE, { x: 107.5, y: 87 }) }, B2: { paths: place(W, { x: 150, y: 100 }) }, H2: { paths: place(HANDLE, { x: 157, y: 87 }) } };
  const orders = [['B1', 'H1', 'B2', 'H2'], ['H2', 'B2', 'H1', 'B1'], ['H2', 'H1', 'B2', 'B1'], ['B2', 'H2', 'B1', 'H1'], ['H1', 'H2', 'B1', 'B2'], ['B1', 'B2', 'H1', 'H2'], ['H2', 'H1', 'B1', 'B2'], ['B2', 'B1', 'H2', 'H1']];
  for (const order of orders) {
    const shapes = judgeSplit(order.map(k => g[k]), OPERATOR_LIBRARY, [['WIDGET', at(100)], ['WIDGET', at(150)]]);
    const note = order.join(',') + ': ' + JSON.stringify(shapes.map(s => [s.box, s.verdict]));
    assert.equal(shapes.length, 2, note);
    for (const s of shapes) {
      assert.equal(s.verdict, 'standard', note);
      assert.ok(s.box[2] - s.box[0] <= 25, 'one body wide: ' + note);
      assert.ok(s.parts.some(p => p.role === 'attachment'), note);
    }
  }
});
