// Phase 3: the shape splitter. Invented linework only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../assets/js/pid-sheet-read.js';
import { LIBRARY, BUBBLES, place, bodyWithHandle, fixtureLine as line } from './fixtures/symbol-check-sheet.js';

const W = LIBRARY.symbols.find(s => s.name === 'WIDGET');
const RING = BUBBLES.find(s => s.name === 'RING');
const OPT = { minSide: 6, maxSide: 60, longRun: 40 };
const near = (a, b, tol = 1) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const kindOf = (r, i) => (r.lines.find(l => l.pieces.includes(i)) || {}).kind || null;
// Segment indexes of the given paths, in the order sheetShapes flattens them (every test path is plain ink).
function indexesOf(paths, from) {
  const out = []; let at = 0;
  paths.forEach(p => { const n = p.segs.length / 4; if (from.includes(p)) for (let k = 0; k < n; k++) out.push(at + k); at += n; });
  return out;
}

test('the pinned values', () => {
  assert.equal(R.SHAPE_JOIN, 0.5); assert.equal(R.DASH_MIN, 3); assert.equal(R.HATCH_MIN, 3);   // tuned from 4 on the owner's answers
});

test('a WIDGET on a pipe running 200 pt each side: one shape, the pipe is run line', () => {
  const pipe = [line([100, 206, 300, 206]), line([324, 206, 524, 206])];
  const paths = [...place(W, { x: 300, y: 200 }), ...pipe];
  const r = R.sheetShapes(paths, OPT);
  assert.equal(r.shapes.length, 1);
  assert.ok(near(r.shapes[0].box, [300, 200, 324, 212]), String(r.shapes[0].box));
  for (const i of indexesOf(paths, pipe)) assert.equal(kindOf(r, i), 'run');
  assert.equal(r.segments.length, 8);
  assert.ok(r.segments.every(s => s.length === 6));
});

test('a WIDGET over a pipe drawn straight through it: one shape, the pipe stays line', () => {
  const pipe = [line([100, 206, 524, 206])];
  const r = R.sheetShapes([...place(W, { x: 300, y: 200 }), ...pipe], OPT);
  assert.equal(r.shapes.length, 1);
  assert.ok(near(r.shapes[0].box, [300, 200, 324, 212]));
  assert.equal(kindOf(r, 6), 'run');
});

test('a body with a handle on its stem, on a pipe: one shape holding both', () => {
  const paths = [...bodyWithHandle(300, 200), line([100, 206, 300, 206]), line([324, 206, 524, 206])];
  const r = R.sheetShapes(paths, OPT);
  assert.equal(r.shapes.length, 1);
  assert.ok(near(r.shapes[0].box, [300, 198, 324, 212]), String(r.shapes[0].box));
  assert.equal(r.shapes[0].pieces.length, 8);
});

test('a WIDGET 15 pt from a tee on its own pipe: the stub to the tee and the branch join no shape', () => {
  // Main pipe along y = 206; the WIDGET on it at x 300-324; a tee at x 339 with a branch running up.
  const left = line([100, 206, 300, 206]), stub = line([324, 206, 339, 206]), right = line([339, 206, 539, 206]), branch = line([339, 206, 339, 100]);
  const paths = [...place(W, { x: 300, y: 200 }), left, stub, right, branch];
  const r = R.sheetShapes(paths, OPT);
  assert.equal(r.shapes.length, 1);
  assert.ok(near(r.shapes[0].box, [300, 200, 324, 212]));
  for (const i of indexesOf(paths, [stub, branch])) { assert.ok(!r.shapes[0].pieces.includes(i)); assert.ok(kindOf(r, i)); }
});

test('a WIDGET on a branch 15 pt from a tee: the branch stub joins no shape', () => {
  // Main pipe along y = 300; the branch rises from the tee at x 312, the WIDGET (turned) on it from y 261 to 285.
  const main = line([100, 300, 500, 300]), stub = line([312, 300, 312, 285]), up = line([312, 261, 312, 150]);
  const paths = [...place(W, { x: 306, y: 261, o: 1 }), main, stub, up];
  const r = R.sheetShapes(paths, OPT);
  assert.equal(r.shapes.length, 1);
  assert.ok(near(r.shapes[0].box, [306, 261, 318, 285]), String(r.shapes[0].box));
  assert.ok(!r.shapes[0].pieces.includes(indexesOf(paths, [stub])[0]));
  assert.equal(kindOf(r, indexesOf(paths, [stub])[0]), 'connector');
});

test('a ring with a 30 pt leader to a WIDGET: two shapes and one connector', () => {
  const ring = place(RING, { x: 100, y: 100 });   // centre (120, 120), radius 20
  const leader = line([140, 120, 170, 120]);
  const paths = [...ring, leader, ...place(W, { x: 170, y: 114 })];
  const r = R.sheetShapes(paths, OPT);
  assert.equal(r.shapes.length, 2);
  const con = r.lines.filter(l => l.kind === 'connector');
  assert.equal(con.length, 1);
  assert.deepEqual(con[0].pieces, indexesOf(paths, [leader]));
  assert.equal(r.shapes.filter(s => s.closed).length, 1);
});

test('a closed outline holding writing is its own shape, even when a symbol touches it', () => {
  const ring = place(RING, { x: 100, y: 100 });
  const paths = [...ring, ...place(W, { x: 140, y: 114 })];   // the WIDGET's left edge on the ring's right
  const wide = { ...OPT, maxSide: 100 };
  assert.equal(R.sheetShapes(paths, wide).shapes.length, 1);
  const r = R.sheetShapes(paths, { ...wide, writing: [[112, 115, 128, 125]] });
  assert.equal(r.shapes.length, 2);
});

test('a dashed line (3 pt dashes, 2 pt gaps, 120 pt) is dashed line, no shape', () => {
  const dashes = []; for (let x = 100; x < 220; x += 5) dashes.push(line([x, 300, x + 3, 300]));
  const r = R.sheetShapes(dashes, OPT);
  assert.equal(r.shapes.length, 0);
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].kind, 'dashed');
  assert.equal(r.lines[0].pieces.length, dashes.length);
});

test('a dashed diagonal line is dashed line too', () => {
  const dashes = []; for (let t = 0; t < 100; t += 6) dashes.push(line([100 + t * 0.6, 100 + t * 0.8, 100 + (t + 3.5) * 0.6, 100 + (t + 3.5) * 0.8]));
  const r = R.sheetShapes(dashes, OPT);
  assert.equal(r.shapes.length, 0);
  assert.deepEqual(r.lines.map(l => l.kind), ['dashed']);
});

test('two parallel 200 pt runs 4 pt apart with 20 short diagonals: hatch and run lines, no shape', () => {
  const paths = [line([100, 100, 300, 100]), line([100, 104, 300, 104])];
  for (let i = 0; i < 20; i++) paths.push(line([105 + i * 10, 104, 109 + i * 10, 100]));
  const r = R.sheetShapes(paths, OPT);
  assert.equal(r.shapes.length, 0);
  const kinds = new Set(r.lines.map(l => l.kind));
  assert.ok(kinds.has('hatch') && kinds.has('run'));
  assert.equal(r.lines.find(l => l.kind === 'hatch').pieces.length, 20);
});

test('a 1 pt tick and a 400 x 300 tank outline give no shape; a lone straight line is line', () => {
  const tank = [line([50, 50, 450, 50]), line([450, 50, 450, 350]), line([450, 350, 50, 350]), line([50, 350, 50, 50])];
  const lone = line([600, 200, 620, 200]);
  const r = R.sheetShapes([line([600, 100, 601, 100]), ...tank, lone], OPT);
  assert.equal(r.shapes.length, 0);
  assert.equal(kindOf(r, 5), 'run');
});

test('a symbol above the size band is not a shape', () => {
  const r = R.sheetShapes(place(W, { x: 100, y: 100, k: 3 }), OPT);   // 72 pt wide: over maxSide
  assert.equal(r.shapes.length, 0);
});

test('a shape inside the skip box is not split', () => {
  const r = R.sheetShapes(place(W, { x: 300, y: 200 }), { ...OPT, skip: [250, 150, 400, 300] });
  assert.equal(r.shapes.length, 0);
  assert.equal(r.segments.length, 0);
});

test('two WIDGETs joined by a short pipe between their edges: two shapes and a connector', () => {
  const paths = [...place(W, { x: 100, y: 100 }), line([124, 106, 144, 106]), ...place(W, { x: 144, y: 100 })];
  const r = R.sheetShapes(paths, OPT);
  assert.equal(r.shapes.length, 2);
  assert.equal(r.lines.filter(l => l.kind === 'connector').length, 1);
});

test('shape ids follow reading order', () => {
  const r = R.sheetShapes([...place(W, { x: 300, y: 300 }), ...place(W, { x: 100, y: 100 })], OPT);
  assert.deepEqual(r.shapes.map(s => s.id), [0, 1]);
  assert.ok(r.shapes[0].box[1] < r.shapes[1].box[1]);
});

test('20,000 short strokes are split in under 2 s', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const paths = [];
  for (let i = 0; i < 20000; i++) {
    const x = rnd() * 3000, y = rnd() * 2000, a = rnd() * Math.PI, l = 1 + rnd() * 6;
    paths.push(line([x, y, x + l * Math.cos(a), y + l * Math.sin(a)]));
  }
  // The better of two runs by the clock: other test files and sessions load the machine.
  let best = Infinity, r = null;
  for (let k = 0; k < 2; k++) { const t = Date.now(); r = R.sheetShapes(paths, OPT); best = Math.min(best, Date.now() - t); }
  assert.ok(best < 2000, `took ${best} ms`);
  assert.ok(Array.isArray(r.shapes));
});

test('hostile input never throws and gives nothing', () => {
  const empty = { shapes: [], lines: [], segments: [] };
  assert.deepEqual(R.sheetShapes(null, OPT), empty);
  assert.deepEqual(R.sheetShapes([{ segs: [NaN, 1, 2, 3] }, { segs: [1, 2, 3] }, null, 5, { segs: 'x' }], OPT), empty);
  assert.deepEqual(R.sheetShapes(place(W, { x: 1, y: 1 })), empty);
  assert.deepEqual(R.sheetShapes(place(W, { x: 1, y: 1 }), { minSide: NaN, maxSide: 60, longRun: 40 }), empty);
  assert.deepEqual(R.sheetShapes([line([1e9, 0, 2e9, 0]), line([0, 0, 1e300, 1e300])], OPT), empty);
  assert.doesNotThrow(() => R.sheetShapes(place(W, { x: 1, y: 1 }), { ...OPT, skip: 'x', writing: [null, [1, 'a']] }));
});

// ── Where a pipe ends and a symbol starts ─────────────────────────────────
test('a pipe network: short pipes reached from a long run through a bend and a tee are line', () => {
  // A long main; from a tee, 30 pt up, then four 20 pt zigzags (bends), then 30 pt across to a WIDGET, whose far side has a 30 pt stub with a free end.
  const main = line([0, 300, 300, 300]), up = line([100, 300, 100, 270]);
  const zig = [line([100, 270, 120, 270]), line([120, 270, 120, 250]), line([120, 250, 140, 250]), line([140, 250, 140, 270])];
  const across = line([140, 270, 130 + 40, 270]);
  const paths = [main, up, ...zig, across, ...place(W, { x: 170, y: 264 }), line([194, 270, 224, 270])];
  const r = R.sheetShapes(paths, { ...OPT, longRun: 150 });
  assert.equal(r.shapes.length, 1);
  // The 30 pt stub with a free end hangs off the WIDGET: linework too (owner, 2026-11-18).
  assert.ok(near(r.shapes[0].box, [170, 264, 194, 276]), String(r.shapes[0].box));
  for (const i of [1, 2, 3, 4, 5, 6]) assert.ok(kindOf(r, i), 'piece ' + i);
});

test('a row of sixty WIDGETs joined by 10 pt pipes is sixty shapes', () => {
  const paths = [];
  for (let i = 0; i < 60; i++) { paths.push(...place(W, { x: 100 + i * 34, y: 100 })); if (i < 59) paths.push(line([124 + i * 34, 106, 134 + i * 34, 106])); }
  const r = R.sheetShapes(paths, { ...OPT, longRun: 150, maxSide: 60 });
  assert.equal(r.shapes.length, 60);
  assert.equal(r.lines.filter(l => l.kind === 'connector').length, 59);
});

test('hatch between two short parallel lines is hatch, and the two lines go with it', () => {
  const paths = [line([100, 100, 150, 100]), line([100, 104, 150, 104])];
  for (let i = 0; i < 5; i++) paths.push(line([105 + i * 10, 104, 109 + i * 10, 100]));
  const r = R.sheetShapes(paths, { ...OPT, longRun: 150 });
  assert.equal(r.shapes.length, 0);
  assert.equal(r.lines.find(l => l.kind === 'hatch').pieces.length, 5);
  assert.ok(kindOf(r, 0) && kindOf(r, 1));
});

test('corners of a symbol never turn into line: a box a long pipe runs into at one corner stays whole', () => {
  const box = [line([200, 100, 220, 100]), line([220, 100, 220, 120]), line([220, 120, 200, 120]), line([200, 120, 200, 100])];
  const r = R.sheetShapes([line([50, -50, 200, 100]), ...box], { ...OPT, longRun: 150 });
  assert.equal(r.shapes.length, 1);
  assert.equal(r.shapes[0].pieces.length, 4);
});

test('a connector joins two shapes, never a lone straight line: a zigzag and a hexagon on a base stay whole', () => {
  const zig = R.sheetShapes([line([580, 60, 590, 75, 590, 75, 600, 60, 600, 60, 610, 75])], OPT);
  assert.equal(zig.shapes.length, 1);
  const hex = [0, 1, 2, 3, 4, 5].map(i => [108 + 8 * Math.cos(i * Math.PI / 3), 106.928 + 8 * Math.sin(i * Math.PI / 3)]);
  const ring = line(hex.flatMap((p, i) => [...p, ...hex[(i + 1) % 6]]));
  const r = R.sheetShapes([ring, line([104, 113.856, 100, 122]), line([100, 122, 116, 122])], OPT);
  assert.equal(r.shapes.length, 1);
  assert.equal(r.shapes[0].pieces.length, 8);
});

test('a cell too full to scan says so: capped, never a silent split', () => {
  // 600 short strokes piled in one 10 pt cell, then a WIDGET beside them.
  const pile = [];
  for (let i = 0; i < 600; i++) pile.push(line([200 + (i % 30) * 0.3, 200 + Math.floor(i / 30) * 0.4, 200.2 + (i % 30) * 0.3, 200.3 + Math.floor(i / 30) * 0.4]));
  const r = R.sheetShapes(pile, OPT);
  assert.ok(r.capped > 0, String(r.capped));
  const plain = R.sheetShapes(place(W, { x: 300, y: 200 }), OPT);
  assert.equal(plain.capped, undefined);
});

// ── The owner's answers on a real printed sheet (2026-11-18), as invented cases ──
const OPT2 = { ...OPT, minShort: 2.65 };
const poly = pts => line(pts.flatMap((p, i) => (i ? [...pts[i - 1], ...p] : [])).slice(0));
const closedPoly = pts => line(pts.flatMap((p, i) => [...p, ...pts[(i + 1) % pts.length]]));

test('owner: two valves joined by a short lagged pipe (3 hatch strokes) stay two shapes', () => {
  // Three parallel lines (the lagged pipe's edges and centre line); each diagonal split at the centre line; the first cut short.
  const paths = [...place(W, { x: 100, y: 100 }), ...place(W, { x: 154, y: 100 }), line([124, 103, 154, 103]), line([124, 106, 152, 106]), line([124, 109, 150, 109])];
  // As on the real sheet, the last diagonal ends exactly at the lines' ends, so they are no T connectors.
  paths.push(line([124, 108.4, 125.6, 106]), line([125.6, 106, 127.6, 103]));
  for (let i = 1; i < 3; i++) paths.push(line([124 + i * 13, 109, 126 + i * 13, 106]), line([126 + i * 13, 106, 128 + i * 13, 103]));
  const r = R.sheetShapes(paths, { ...OPT2, longRun: 150 });
  assert.equal(r.shapes.length, 2, JSON.stringify(r.shapes.map(x => x.box)));
});

test('owner: an arrowhead on a line is linework; a triangle with a bar (a check valve) is still a shape', () => {
  const arrow = [closedPoly([[96, 100], [104, 100], [100, 115]]), line([100, 40, 100, 200])];
  const r = R.sheetShapes(arrow, OPT2);
  assert.equal(r.shapes.length, 0, JSON.stringify(r.shapes.map(x => x.box)));
  assert.ok(r.lines.some(l => l.kind === 'arrow'));
  const check = [closedPoly([[96, 100], [104, 100], [100, 112]]), line([94, 112, 106, 112]), line([100, 40, 100, 100]), line([100, 112, 100, 200])];
  assert.equal(R.sheetShapes(check, OPT2).shapes.length, 1);
});

test('owner: a shape thinner than any legend symbol is linework', () => {
  const sliver = [closedPoly([[100, 100], [160, 100], [160, 101], [100, 101]])];
  assert.equal(R.sheetShapes(sliver, { ...OPT2, longRun: 150 }).shapes.length, 0);
  assert.equal(R.sheetShapes(sliver, { ...OPT, longRun: 150 }).shapes.length, 1);   // no minShort given: judged as before
});

test('owner: a square-cornered L, T or + of plain lines is linework; a Y is still a shape', () => {
  const L = [line([100, 100, 130, 100]), line([130, 100, 130, 120])];
  const T = [line([200, 100, 240, 100]), line([220, 100, 220, 125])];
  const plus = [line([300, 110, 330, 110]), line([315, 95, 315, 125])];
  assert.equal(R.sheetShapes([...L, ...T, ...plus], OPT2).shapes.length, 0);
  const Y = [line([400, 100, 410, 110]), line([420, 100, 410, 110]), line([410, 110, 410, 125])];
  assert.equal(R.sheetShapes(Y, OPT2).shapes.length, 1);
});

test('owner: a straight line hanging off a shape with a free end is linework; a stroke from a corner stays', () => {
  const tail = [...place(W, { x: 100, y: 100 }), line([100, 106, 75, 106])];
  const r = R.sheetShapes(tail, OPT2);
  assert.equal(r.shapes.length, 1);
  assert.ok(near(r.shapes[0].box, [100, 100, 124, 112]), String(r.shapes[0].box));
  const corner = [...place(W, { x: 100, y: 100 }), line([124, 100, 129.66, 94.34])];
  assert.equal(R.sheetShapes(corner, OPT2).shapes[0].pieces.length, 7);
});

test('owner: a short stem is not cut when it would leave a piece too small to be a symbol', () => {
  // A hexagon on a stem whose foot stands on the base of a small triangle (too small to be a shape alone).
  const hex = [0, 1, 2, 3, 4, 5].map(i => [108 + 8 * Math.cos(i * Math.PI / 3), 106.928 + 8 * Math.sin(i * Math.PI / 3)]);
  const paths = [closedPoly(hex), line([108, 113.856, 108, 124]), closedPoly([[105.5, 124], [110.5, 124], [108, 120]])];
  const r = R.sheetShapes(paths, OPT2);
  assert.equal(r.shapes.length, 1);
  assert.ok(r.shapes[0].box[3] >= 123.5, String(r.shapes[0].box));
});

test('owner: stacked curved lines close together are one shape', () => {
  const arc = (y, w) => poly(Array.from({ length: 9 }, (_, i) => { const t = (i / 8) * 2 - 1; return [200 + t * w, y + 2.5 * t * t]; }));
  const paths = [arc(100, 6), arc(103.5, 8), arc(107, 10), arc(110.5, 12), arc(114, 14)];
  const r = R.sheetShapes(paths, OPT2);
  assert.equal(r.shapes.length, 1, JSON.stringify(r.shapes.map(x => x.box)));
});

test('owner: a long label box with writing in it (a page connector) is not judged; a bubble still is', () => {
  const label = [closedPoly([[100, 100], [160, 100], [166, 106], [160, 112], [100, 112]])];
  const r = R.sheetShapes(label, { ...OPT2, maxSide: 100, longRun: 150, writing: [[105, 102, 150, 110]] });
  assert.equal(r.shapes.length, 0);
  assert.equal(R.sheetShapes(label, { ...OPT2, maxSide: 100, longRun: 150 }).shapes.length, 1);   // no writing in it: judged
  const ring = R.sheetShapes(place(RING, { x: 100, y: 100 }), { ...OPT2, writing: [[112, 115, 128, 125]] });
  assert.equal(ring.shapes.length, 1);
});

test('owner: arcs drawn with three 4 pt pieces each, stacked close, are one shape', () => {
  const arc = (y, w) => poly(Array.from({ length: 4 }, (_, i) => { const t = (i / 3) * 2 - 1; return [300 + t * w, y + 1.2 * t * t]; }));
  const r = R.sheetShapes([arc(100, 6), arc(103, 6.5), arc(106, 7), arc(109, 7.5)], OPT2);
  assert.equal(r.shapes.length, 1, JSON.stringify(r.shapes.map(x => x.box)));
});

test('owner: border marks in the outer strip of the page are not judged', () => {
  const mark = [closedPoly([[490, 2], [510, 2], [500, 14]])];
  assert.equal(R.sheetShapes(mark, { ...OPT2, page: [1000, 700] }).shapes.length, 0);
  assert.equal(R.sheetShapes(mark, OPT2).shapes.length, 1);   // page size unknown: judged
  const inner = [closedPoly([[490, 40], [510, 40], [500, 52]])];
  assert.equal(R.sheetShapes(inner, { ...OPT2, page: [1000, 700] }).shapes.length, 1);
});

test('owner: an arrowhead drawn four times with tiny rounding differences is still an arrowhead', () => {
  const tri = d => closedPoly([[96 + d, 100 - d], [104 - d, 100 + d], [100 + d, 115 - d]]);
  const r = R.sheetShapes([tri(0), tri(1e-5), tri(-2e-5), tri(3e-6), line([100, 115, 100, 300])], { ...OPT2, longRun: 150 });
  assert.equal(r.shapes.length, 0, JSON.stringify(r.shapes.map(x => x.box)));
});

test('owner: a small arrowhead on a short line (not long enough to be pipe) is linework, the line too', () => {
  const r = R.sheetShapes([line([100, 100, 140, 100]), closedPoly([[110, 100], [117, 98.3], [117, 101.7]])], { ...OPT2, longRun: 150 });
  assert.equal(r.shapes.length, 0, JSON.stringify(r.shapes.map(x => x.box)));
  // A check valve on a short pipe is no arrowhead: its bar makes the rest no triangle.
  const cv = [line([100, 100, 140, 100]), closedPoly([[110, 100], [117, 96], [117, 104]]), line([110, 95, 110, 105])];
  assert.equal(R.sheetShapes(cv, { ...OPT2, longRun: 150 }).shapes.length, 1);
});

// ── Round 2 of the owner's answers (2026-11-18) ──
const arcPts = (cx, cy, r, a0, a1, n) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
test('owner 2: a rounded pipe bend and a crossover hop are linework; a zigzag and a stack of arcs are not', () => {
  const bend = poly([[100, 100], [100, 130], ...arcPts(110, 130, 10, Math.PI, Math.PI / 2, 6).slice(1), [140, 140]]);
  const hop = poly(arcPts(200, 120, 6, Math.PI, 0, 8));
  const r = R.sheetShapes([bend, hop, line([140, 120, 194, 120]), line([206, 120, 260, 120])], OPT2);
  assert.equal(r.shapes.length, 0, JSON.stringify(r.shapes.map(x => x.box)));
  assert.equal(R.sheetShapes([line([580, 60, 590, 75, 590, 75, 600, 60, 600, 60, 610, 75])], OPT2).shapes.length, 1);
});

test('owner 2: small triangles are listed for the judge as arrowhead candidates, drawn copies counted once', () => {
  const tri = d => closedPoly([[102 + d, 134], [110 + d, 134], [106 + d, 124]]);
  const r = R.sheetShapes([...place(W, { x: 100, y: 100, o: 1 }), tri(0), tri(1e-5)], { ...OPT2, longRun: 150 });
  // Every small triangle is a candidate (the WIDGET's two as well); the judge decides which are left over.
  assert.equal(r.arrows.length, 3);
  assert.equal(r.arrows.filter(m => m.length === 6).length, 1);
  assert.equal(R.sheetShapes(place(W, { x: 100, y: 100 }), OPT2).arrows.length, 2);
  assert.deepEqual(R.sheetShapes([line([0, 0, 50, 0])], OPT2).arrows, []);
});

test('owner 2: a line with small marks along it, 3 pt tall (an electrical line), is linework', () => {
  const paths = [line([100, 100, 125, 100])];
  for (let i = 0; i < 3; i++) paths.push(poly([[104 + i * 7, 98.5], [106 + i * 7, 101.5], [108 + i * 7, 98.5]]));
  assert.equal(R.sheetShapes(paths, { ...OPT2, longRun: 150 }).shapes.length, 0);
});

// Contractor set (2026-11-20): two valves joined by a bent pipe made one group bigger than any symbol, and it was
// dropped with no box. An oversized group gives up its open straight pieces (its pipework) and is grouped again.
test('two WIDGETs joined by a bent pipe, the whole too big for a symbol: each WIDGET is a shape, the pipe is linework', () => {
  const pipe = [line([124, 106, 150, 106]), line([150, 106, 150, 146]), line([150, 146, 190, 146])];
  const paths = [...place(W, { x: 100, y: 100 }), ...pipe, ...place(W, { x: 190, y: 140 })];
  const r = R.sheetShapes(paths, OPT);
  assert.equal(r.shapes.length, 2, JSON.stringify(r.shapes.map(x => x.box)));
  assert.ok(r.shapes.some(x => near(x.box, [100, 100, 124, 112])) && r.shapes.some(x => near(x.box, [190, 140, 214, 152])), JSON.stringify(r.shapes.map(x => x.box)));
  for (const i of indexesOf(paths, pipe)) assert.ok(['run', 'connector'].includes(kindOf(r, i)), String(kindOf(r, i)));
});
