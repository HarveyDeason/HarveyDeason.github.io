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
