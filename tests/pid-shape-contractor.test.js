// Contractor-set faults (2026-11-20, round 3): gate pipes, gate and reducer read together, pipe into a symbol, motors
// beside a lead, vessel linework, bubbles beside a found body. Invented sheets only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../assets/js/pid-symbol-check.js';
import { OPERATOR_LIBRARY, place, fixtureLine as line } from './fixtures/symbol-check-sheet.js';

const loop = pts => line(pts.flatMap((p, i) => [...p, ...pts[(i + 1) % pts.length]]));
const sym = (id, name, w, h, paths, flags = {}) => ({ id, name, legendName: name, group: 'VALVES', tagId: 'V', sheet: '2', w, h, paths,
  letters: [], flags: { simple: false, stretch: false, manual: false, unmatched: false, ...flags }, aliases: [], notes: [] });
// GATE: a bowtie with a bar straight across its middle, top edge to bottom edge (as a wedge gate is drawn).
const GATE = sym('c1', 'GATE', 28, 14, [loop([[0, 0], [0, 14], [14, 7]]), loop([[28, 0], [28, 14], [14, 7]]), line([14, 0, 14, 14])]);
// COUPLING: a pipe stub each side, a bar across the middle and a tick at each stub's inner end (as a union is drawn).
const COUPLING = sym('c2', 'COUPLING', 28, 14, [line([0, 7, 10, 7]), line([18, 7, 28, 7]), line([14, 0, 14, 14]), line([10, 3.5, 10, 10.5]), line([18, 3.5, 18, 10.5])]);
// DRIVE: a box with a long diagonal out past its top corner, its own box's top-left corner left empty (as a variable
// speed motor's arrow leaves it).
const DRIVE = sym('c3', 'DRIVE', 16, 20, [loop([[0, 8], [12, 8], [12, 20], [0, 20]]), line([0, 20, 16, 4])]);
// HEADED: DRIVE with an arrowhead whose one edge lies along its own diagonal (its line runs on through the head's corner).
const HEADED = sym('c4', 'HEADED', 16, 20, [loop([[0, 8], [12, 8], [12, 20], [0, 20]]), line([0, 20, 16, 4]), loop([[16, 4], [12, 8], [15, 8]])]);
const LIB = { ...OPERATOR_LIBRARY, symbols: [...OPERATOR_LIBRARY.symbols, GATE, COUPLING, DRIVE, HEADED] };
const prepOf = (sym, lib = LIB) => C.prepareSymbols({ ...lib, symbols: [sym] })[0];
const run = (paths, library = LIB) => C.checkSheet({ pageSize: [300, 250], viewportTransform: [1, 0, 0, 1, 0, 0], textItems: [], tags: [], paths,
  library, lookups: {} });
const at = (r, x, y) => r.shapes.find(s => x >= s.box[0] - 1 && x <= s.box[2] + 1 && y >= s.box[1] - 1 && y <= s.box[3] + 1);

// ── 1. A bar across a symbol is no pipe ─────────────────────────────────────
test('pipeLines: a bar straight across a long symbol, edge to edge, is no pipe: the pipe runs along its length', () => {
  assert.deepEqual(C.pipeLines(prepOf(GATE)), { axis: 'h', at: [7] });
});

test('a GATE with 16 pt pipe stubs ending in small cross ticks: the stubs are cut as its pipe, only the ticks are left', () => {
  const paths = [...place(GATE, { x: 100, y: 100 }), line([84, 107, 100, 107]), line([84, 105, 84, 109]),
    line([128, 107, 144, 107]), line([144, 105, 144, 109])];
  const s = at(run(paths), 114, 107);
  assert.ok(s, 'a shape there');
  assert.ok(s.explained > 0.9, 'only the two 4 pt ticks are left over, not the stubs: ' + s.explained + ' ' + JSON.stringify(s));
});

// ── 2. A pipe in line with a found body is no operator's stem ───────────────
// A GATE, 10 pt of pipe, then a taper the library does not hold: the pipe runs on along the GATE's own pipe line, so it
// is pipe, never the stem of an operator standing on the GATE; the taper is a shape of its own.
test('a GATE piped to a neighbouring taper along its own pipe line: the taper is not joined to it as its operator', () => {
  const paths = [...place(GATE, { x: 100, y: 100 }), line([128, 107, 138, 107]), loop([[138, 103], [150, 99], [150, 115], [138, 111]])];
  const r = run(paths), s = at(r, 114, 107);
  assert.ok(s, 'a shape there');
  assert.ok(s.box[2] < 137, 'the GATE shape stops short of the taper: ' + JSON.stringify(s));
  assert.equal(s.verdict, 'standard', JSON.stringify(s));
});

// ── 3. Pipe drawn on into a symbol ──────────────────────────────────────────
// The sheet draws the pipe as one piece running on into the COUPLING up to its tick (its own stub drawn with the pipe):
// the part outside the COUPLING is pipe as much as a piece stopping at its edge.
const seg = (x0, y0, x1, y1, i = 0) => [x0, y0, x1, y1, Math.hypot(x1 - x0, y1 - y0), i];
const hitAt = (sym, x, y) => { const p = prepOf(sym); return { p, placement: { o: 0, k: 1, tx: x, ty: y, cx: x + p.w / 2, cy: y + p.h / 2 }, score: 1 }; };
test('cutPipe: a pipe piece running from outside into a COUPLING up to its tick is cut; a piece wholly inside is not', () => {
  const S = [seg(82, 107, 110, 107), seg(82, 107, 82, 130), seg(112, 107, 113, 107)];
  assert.deepEqual(C.cutPipe(S, [0, 1, 2], hitAt(COUPLING, 100, 100)), [0]);
});

// ── 4. A pipe ending in a short bar just short of another symbol: the bar is that symbol's connection ─────────────
// 4023 (owner, 2026-11-20): the thin pipe from a gate up to an air release valve ends in a small T 3 pt under the valve.
const WIDGET = OPERATOR_LIBRARY.symbols.find(s => s.name === 'WIDGET');
const gateToWidget = gap => [...place(GATE, { x: 100, y: 100, o: 1 }), line([107, 100, 107, 81]), line([107, 81, 107, 84]),
  line([104.2, 81, 109.8, 81]), ...place(WIDGET, { x: 95, y: 81 - gap - 12 })];
test('a GATE whose pipe ends in a 5.6 pt bar 3 pt short of a found WIDGET: the bar is the connection, the GATE standard', () => {
  const r = run(gateToWidget(3)), s = at(r, 107, 114);
  assert.ok(s, 'a shape there');
  assert.equal(s.verdict, 'standard', JSON.stringify(s));
  assert.equal(at(r, 107, 72).verdict, 'standard');
});
test('the same bar with nothing beyond it is not a connection: extra linework', () => {
  const paths = gateToWidget(3).slice(0, 6);
  const s = at(run(paths), 107, 114);
  assert.equal(s.verdict, 'not-standard', JSON.stringify(s));
});

// ── 5. A near miss spoilt by other ink in its frame ──────────────────────────
// 4021/4023 motors: the sweep scores a symbol on all the ink in its frame (a lead's marks, a neighbour's edge) and
// misses; on the shape's own ink it is a full match both ways.
test('a DRIVE with a small separate cross in its empty corner: the DRIVE is found on its own ink, standard', () => {
  const paths = [...place(DRIVE, { x: 100, y: 100 }), line([101.5, 101, 106.5, 106]), line([101.5, 106, 106.5, 101])];
  const s = at(run(paths), 106, 114);
  assert.ok(s, 'a shape there');
  assert.equal(s.verdict, 'standard', JSON.stringify(s));
});
test('a HEADED drive beside a small separate cross: its own line running on through its arrowhead is no running on', () => {
  const paths = [...place(HEADED, { x: 100, y: 100 }), line([101.5, 101, 106.5, 106]), line([101.5, 106, 106.5, 101])];
  const s = at(run(paths), 106, 114);
  assert.ok(s, 'a shape there');
  assert.equal(s.verdict, 'standard', JSON.stringify(s));
  assert.deepEqual(s.parts.map(q => q.name), ['HEADED']);
});

// ── 7. A bubble drawn touching a found body ─────────────────────────────────
// 4023: a flowmeter with its tag bubbles drawn touching it, one shape. A closed outline holding writing is matched as a
// bubble whether or not a body is found beside it.
const RING = OPERATOR_LIBRARY.symbols.find(s => s.name === 'RING');
const GADGET = OPERATOR_LIBRARY.symbols.find(s => s.name === 'GADGET');
test('a GADGET with a bubble drawn touching it: the bubble is matched beside the found GADGET, standard', () => {
  const s = at(run([...place(RING, { x: 90, y: 100 }), ...place(GADGET, { x: 100, y: 140 })]), 110, 150);
  assert.ok(s, 'a shape there');
  assert.ok(s.box[1] <= 101, 'one shape, bubble and GADGET: ' + JSON.stringify(s.box));
  assert.equal(s.verdict, 'standard', JSON.stringify(s));
  assert.deepEqual(s.parts.map(q => q.name).sort(), ['GADGET', 'RING']);
});

// ── 8. A tee part way along a pipe piece ─────────────────────────────────────
// M (owner's flag r2#191): one 60 pt pipe piece runs from a GATE past a tee (a long branch line meeting its middle) to
// another symbol. Only the pipe up to the tee is the GATE's own: a piece with a branch meeting its middle is not cut.
test('cutPipe: a pipe piece with a branch line meeting part way along it is not cut', () => {
  const S = [seg(40, 107, 100, 107), seg(79, 107, 79, 300)];
  assert.deepEqual(C.cutPipe(S, [0], hitAt(GATE, 100, 100), new Set(), [1]), []);
  assert.deepEqual(C.cutPipe(S, [0], hitAt(GATE, 100, 100)), [0]);   // no branch given: cut as before
});
test('cutPipe: a second piece drawn along the same pipe, overlapping it, is no branch: the piece is cut', () => {
  const S = [seg(60, 107, 100, 107), seg(40, 107, 80, 107)];
  assert.deepEqual(C.cutPipe(S, [0], hitAt(GATE, 100, 100), new Set(), [1]), [0]);
});

// ── Round 4 (2026-11-22): vessel heads and flow arrows are linework (splitter) ──
import * as R from '../assets/js/pid-sheet-read.js';
import { LIBRARY } from './fixtures/symbol-check-sheet.js';
const OPT = { minSide: 6, maxSide: 60, longRun: 40 };
const WID = LIBRARY.symbols.find(s => s.name === 'WIDGET');
const kinds = (r, from) => { let at0 = 0; const out = []; for (const p of r.__paths) { const n = p.segs.length / 4; if (from.includes(p)) for (let k = 0; k < n; k++) out.push((r.lines.find(l => l.pieces.includes(at0 + k)) || {}).kind || null); at0 += n; } return out; };
const split = paths => ({ ...R.sheetShapes(paths, OPT), __paths: paths });
// A tank's dished head: one open path of 16 chords from the top of one side wall over to the other.
const arcPath = (cx, cy, a, b) => { const segs = []; for (let k = 0; k < 16; k++) { const t0 = Math.PI * (1 + k / 16), t1 = Math.PI * (1 + (k + 1) / 16); segs.push(cx + a * Math.cos(t0), cy + b * Math.sin(t0), cx + a * Math.cos(t1), cy + b * Math.sin(t1)); } return line(segs); };
// A flow arrow (as contractors draw it): two filled halves in one path, and its outline. Tip at (tx, ty).
const flow = (tx, ty, d, opts = {}) => {
  const [ux, uy] = { r: [1, 0], l: [-1, 0], u: [0, -1], d: [0, 1] }[d], L = opts.len || 14.16, H = opts.half || 3.54;
  const M = [tx - L * ux, ty - L * uy], A = [M[0] - H * uy, M[1] + H * ux], B = [M[0] + H * uy, M[1] - H * ux], T = [tx, ty];
  const fill = { segs: [...A, ...T, ...T, ...M, ...M, ...A, ...M, ...T, ...T, ...B, ...B, ...M], width: 0, stroked: false, filled: opts.open ? false : true, grey: 0 };
  return opts.open ? [loop([A, T, B])] : [fill, { ...loop([A, T, B]), width: 0 }];
};

test('a tank head: a smooth one-way curve carrying on from both side walls is linework; a nozzle on it is its own shape', () => {
  const head = arcPath(162, 100, 62, 41), walls = [line([100, 100, 100, 300]), line([224, 100, 224, 300])];
  const nozzle = loop([[158, 51], [166, 51], [166, 59.1], [158, 59.1]]);
  const r = split([...walls, head, { ...head }, nozzle]);
  assert.ok(kinds(r, [head]).every(k => k === 'run'), 'every chord of the head is line: ' + kinds(r, [head]));
  assert.ok(r.shapes.every(s => s.box[2] - s.box[0] <= 12), 'no chunk of the head is a shape: ' + JSON.stringify(r.shapes.map(s => s.box)));
});
test('a curve with only one end on a wall is no tank head: it is not taken as linework', () => {
  const head = arcPath(162, 100, 62, 41), wall = line([100, 100, 100, 300]);
  const nozzle = loop([[158, 51], [166, 51], [166, 59.1], [158, 59.1]]);
  const r = split([wall, head, nozzle]);
  assert.ok(kinds(r, [head]).some(k => k !== 'run'), 'the curve stays: ' + kinds(r, [head]));
});
test('two flow arrows meeting tip to tip at a tee are linework, no shape', () => {
  const r = split([line([0, 100, 85.84, 100]), ...flow(100, 100, 'r'), line([100, 100, 200, 100]), ...flow(100, 100, 'u'), line([100, 114.16, 100, 214.16])]);
  assert.deepEqual(r.shapes.map(s => s.box), []);
});
test('a flow arrow at a pipe corner: the pipe turning at its tip is pipe, no shape', () => {
  const r = split([line([0, 100, 85.84, 100]), ...flow(100, 100, 'r'), line([100, 100, 100, 130])]);
  assert.deepEqual(r.shapes.map(s => s.box), []);
});
test('a flow arrow drawn in a signal line type (like ticks centred on its outline) is linework, no shape', () => {
  const tick = (cx, cy) => line([cx - 0.855, cy + 3.405, cx + 0.855, cy - 3.405]);
  const r = split([line([0, 100, 85.84, 100]), ...flow(100, 100, 'r'), tick(92.92, 98.23), tick(92.92, 101.77), tick(99.8, 100)]);
  assert.deepEqual(r.shapes.map(s => s.box), []);
});
test('a flow arrow piped 9 pt to a WIDGET: the arrow and the pipe come off, the WIDGET is a shape on its own', () => {
  const r = split([line([0, 100, 85.84, 100]), ...flow(100, 100, 'r'), line([100, 100, 109, 100]), ...place(WID, { x: 109, y: 94 })]);
  assert.equal(r.shapes.length, 1);
  assert.ok(r.shapes[0].box[0] >= 108.5, 'the WIDGET alone: ' + JSON.stringify(r.shapes[0].box));
});
test('a filled bowtie (near equal-sided triangles tip to tip) is no pair of flow arrows: it stays a shape', () => {
  const r = split([line([0, 100, 86, 100]), ...flow(100, 100, 'r', { len: 14, half: 7 }), ...flow(100, 100, 'l', { len: 14, half: 7 }), line([114, 100, 200, 100])]);
  assert.equal(r.shapes.length, 1);
});
test('an open slim triangle with a bar at its tip (a check valve) stays a shape', () => {
  const r = split([line([0, 100, 85.84, 100]), ...flow(100, 100, 'r', { open: true }), line([100, 94, 100, 106]), line([100, 100, 200, 100])]);
  assert.equal(r.shapes.length, 1);
});
test('a flow arrow inside a box with its line to the box edge stays part of the box', () => {
  const r = split([loop([[85, 85], [115, 85], [115, 115], [85, 115]]), ...flow(110, 100, 'r'), line([85, 100, 95.84, 100])]);
  assert.equal(r.shapes.length, 1);
  assert.ok(r.shapes[0].box[0] <= 85.5 && r.shapes[0].box[2] >= 114.5);
});

// ── Round 5 (2026-11-22): stacked instrument bubbles are two shapes (splitter) ──
// D18197: two 42.5 pt bubbles drawn one on top of the other, touching at one point, no writing read in them (the
// sheet's text is flattened). The owner: each is a standard bubble, boxed on its own. A rotary lobe pump's lobes (equal
// circles touching, a line from the pump's ring to their touching point) and a side channel blower's ports (small circles on a big ring) stay one.
const circle = (cx, cy, r) => loop(Array.from({ length: 32 }, (_, i) => [cx + r * Math.cos(Math.PI * i / 16), cy + r * Math.sin(Math.PI * i / 16)]));
const OPT5 = { minSide: 6, maxSide: 100, longRun: 120 };
const shapesIn = (paths, opt = OPT5) => R.sheetShapes(paths, opt).shapes;
test('two equal rings stacked, touching at one point (one with a bar across): two shapes', () => {
  const sh = shapesIn([circle(120, 80, 20), line([100, 80, 140, 80]), circle(120, 120, 20)]);
  assert.equal(sh.length, 2, JSON.stringify(sh.map(s => s.box)));
  assert.deepEqual(sh.map(s => Math.round(s.box[1])).sort((a, b) => a - b), [60, 100]);
});
test('two equal rings touching inside a bigger ring, a line from its edge to their touching point (a rotary lobe pump): one shape', () => {
  const sh = shapesIn([circle(120, 100, 40), circle(120, 85, 15), circle(120, 115, 15), line([80, 100, 120, 100])]);
  assert.equal(sh.length, 1, JSON.stringify(sh.map(s => s.box)));
});
test('a small ring touching a big ring (a side channel blower port) stays one shape', () => {
  const sh = shapesIn([circle(120, 100, 30), circle(120, 138, 8)]);
  assert.equal(sh.length, 1, JSON.stringify(sh.map(s => s.box)));
});
test('two stacked RING bubbles, no writing, one with a bar: each found and standard on its own', () => {
  const r = run([circle(120, 80, 20), line([100, 80, 140, 80]), circle(120, 120, 20)]);
  const top = at(r, 120, 70), bot = at(r, 120, 130);
  assert.ok(top && bot && top !== bot, 'two shapes: ' + JSON.stringify(r.shapes.map(s => s.box)));
  assert.equal(top.verdict, 'standard', JSON.stringify(top));
  assert.equal(bot.verdict, 'standard', JSON.stringify(bot));
  const r2 = runRead([circle(120, 80, 20), line([100, 80, 140, 80]), circle(120, 120, 20)]);
  assert.deepEqual([at(r2, 120, 70), at(r2, 120, 130)].map(s => s && s.verdict), ['standard', 'standard'], 'no writing read: ' + JSON.stringify(r2.shapes));
});
// D18197: the lower bubble of a stack stands on a flowmeter by a 12 pt stem. With no writing read in it, the empty
// bubble was joined to the flowmeter as its operator (a stem connector to a neighbour with nothing found in it). An
// empty ring of a bubble's size is a bubble (owner, 2026-11-20): never an operator.
// The reader hands an empty writing list when it reads no words (as on the flattened sheet): an unwritten ring gets no
// bubble spot in the sweep.
// METERBOX: a 50 x 24 box with a diagonal, swept at its own size (as a flowmeter on the sheet).
const METERBOX = sym('c5', 'METERBOX', 50, 24, [loop([[0, 0], [50, 0], [50, 24], [0, 24]]), line([0, 24, 50, 0])]);
const runRead = paths => C.checkSheet({ pageSize: [300, 250], viewportTransform: [1, 0, 0, 1, 0, 0], textItems: [], tags: [], paths, writing: [],
  library: { ...LIB, symbols: [...LIB.symbols, METERBOX] }, lookups: {} });
test('an empty bubble-sized ring on a 10 pt stem on the top edge of a bigger METERBOX, no writing read: two shapes, both standard', () => {
  const r = runRead([circle(125, 96, 20), line([125, 116, 125, 126]), ...place(METERBOX, { x: 100, y: 126 })]);
  const ring = at(r, 125, 86), body = at(r, 125, 140);
  assert.ok(ring && body && ring !== body, 'two shapes: ' + JSON.stringify(r.shapes.map(s => [s.box, s.verdict])));
  assert.equal(ring.verdict, 'standard', JSON.stringify(ring));
  assert.equal(body.verdict, 'standard', JSON.stringify(body));
});

// ── Round 5: a marker's leader to its pipe is linework (judge) ──
// D18197: a bubble's own signal line runs up from its rim to a pipe, a Z mark (SIGNAL - ELECTRIC at half size) at
// every joint. TP points (4024, M, H4): a TIE-IN POINT NUMBER MARKER with a straight stem from a corner down to the
// pipe, a small TIE-IN POINT circle at its foot and the demarcation's dot on it halfway. As drawn: the lead stops
// short of its pipe (4023), the pipe is broken where the small circle sits (4024). With no body found, the lead
// and what sits on it (line marks, small rings it passes through) are cut, and the marker is judged on its own.
const ZMARK = { id: 'lm9', name: 'SIGNAL - ZED', legendName: 'SIGNAL - ZED', group: 'LINE TYPES', tagId: '', sheet: '1', w: 7.4, h: 6.84, letters: [], aliases: [], notes: [],
  flags: { simple: false, stretch: false, manual: false, unmatched: false, judgeOnly: true, lineMark: 'signal' },
  paths: [{ segs: [6.4, 0, 2.8, 0, 2.8, 0, 1, 6.8, 1, 6.8, 4.5, 6.8], width: 0.5, stroked: true, filled: false, grey: 0 }, { segs: [0, 3.5, 7.4, 3.5], width: 0.5, stroked: true, filled: false, grey: 0 }] };
const DIAMOND = { id: 'tp9', name: 'DIAMOND MARKER', legendName: 'DIAMOND MARKER', group: 'TIE-INS', tagId: '', sheet: '1', w: 42.5, h: 42.5, letters: [], aliases: [], notes: [],
  flags: { simple: false, stretch: false, manual: false, unmatched: false, judgeOnly: true },
  paths: [loop([[21.25, 0], [42.5, 21.25], [21.25, 42.5], [0, 21.25]]), line([0, 21.25, 42.5, 21.25])] };
const runLead = paths => C.checkSheet({ pageSize: [300, 300], viewportTransform: [1, 0, 0, 1, 0, 0], textItems: [], tags: [], paths, writing: [],
  library: { ...LIB, symbols: [...LIB.symbols, METERBOX, ZMARK, DIAMOND] }, lookups: {} });
// A vertical lead at x from y0 down to y1 (y0 < y1), one piece per 7 pt, a half-size Z at each joint.
const zLead = (x, y0, y1) => { const out = []; for (let y = y0; y < y1; y += 7) { const j = Math.min(y + 7, y1); out.push(line([x, y, x, j]));
  if (j < y1) out.push(line([x - 1.74, j - 2.7, x - 1.74, j - 0.9, x - 1.74, j - 0.9, x + 1.68, j, x + 1.68, j, x + 1.71, j, x + 1.71, j, x + 1.71, j - 1.74])); } return out; };
test('a bubble with its marked signal lead up to a pipe, no writing read: the bubble standard, boxed on its own', () => {
  const r = runLead([line([20, 82, 280, 82]), ...zLead(120, 85, 100), circle(120, 120, 20), line([100, 120, 140, 120])]);
  const s = at(r, 120, 130);
  assert.ok(s, 'a shape there: ' + JSON.stringify(r.shapes));
  assert.equal(s.verdict, 'standard', JSON.stringify(s));
  assert.ok(s.box[1] >= 99, 'the lead is not boxed: ' + JSON.stringify(s.box));
});
test('a TP marker on a stem to its pipe, a dot on the stem and a small ring at its foot: the marker standard', () => {
  const dot = { ...circle(121.25, 150, 1.4), filled: true };
  const r = runLead([line([20, 158, 119.5, 158]), line([123, 158, 280, 158]), ...place(DIAMOND, { x: 100, y: 100 }), line([121.25, 142.5, 121.25, 158]), dot, circle(121.25, 158, 1.8)]);
  const s = at(r, 121, 121);
  assert.ok(s, 'a shape there: ' + JSON.stringify(r.shapes));
  assert.equal(s.verdict, 'standard', JSON.stringify(s));
  assert.deepEqual(s.parts.map(q => q.name), ['DIAMOND MARKER']);
});
test('a ring no bubble fits at its size, with a marked lead: the lead is not cut off it', () => {
  const r = runLead([line([20, 82, 280, 82]), ...zLead(120, 85, 100), circle(120, 106, 6)]);
  const s = at(r, 120, 106);
  assert.ok(s && s.box[1] < 99, 'the lead stays with the small ring: ' + JSON.stringify(r.shapes));
});
