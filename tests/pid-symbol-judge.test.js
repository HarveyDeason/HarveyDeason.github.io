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

test('a ring with a tag written in it is standard; a bare ring is not', () => {
  const tagged = at(R, 80, 200), bare = at(R, 220, 200);
  assert.equal(tagged.standard, true, JSON.stringify(tagged));
  assert.equal(bare.standard, false, JSON.stringify(bare));
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
    assert.deepEqual(Object.keys(s).sort(), ['box', 'closest', 'explained', 'id', 'operator', 'share', 'standard', 'symbols', 'why']);
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
