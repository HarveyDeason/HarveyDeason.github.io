// Task 2: reading by line pieces. Invented linework only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../assets/js/pid-sheet-read.js';
import { isClosedPath } from '../assets/js/pid-symbols.js';

const read = (x, o) => R.readByLinePieces(x, o).paths;
const mk = (segs, extra = {}) => ({ segs, width: 0.7, stroked: true, filled: false, grey: 0, ...extra });
const boxOf = p => {
  const xs = [], ys = [];
  for (let i = 0; i < p.segs.length; i += 2) { xs.push(p.segs[i]); ys.push(p.segs[i + 1]); }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};
// `n` arcs, each its own path, together going round a circle; each arc is 8 short segments.
function arcs(cx, cy, r, n, perArc = 8) {
  const out = [], step = (2 * Math.PI) / (n * perArc);
  for (let a = 0; a < n; a++) {
    const segs = [];
    for (let k = 0; k < perArc; k++) {
      const t0 = (a * perArc + k) * step, t1 = t0 + step;
      segs.push(cx + r * Math.cos(t0), cy + r * Math.sin(t0), cx + r * Math.cos(t1), cy + r * Math.sin(t1));
    }
    out.push(mk(segs));
  }
  return out;
}
// A disc cut into n wedges, each a filled path of its own: spoke, rim points, spoke back.
function slices(cx, cy, r, n, perSlice = 6) {
  const out = [], step = (2 * Math.PI) / (n * perSlice);
  for (let a = 0; a < n; a++) {
    const pts = [[cx, cy]];
    for (let k = 0; k <= perSlice; k++) { const t = (a * perSlice + k) * step; pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); }
    pts.push([cx, cy]);
    const segs = [];
    for (let i = 0; i + 1 < pts.length; i++) segs.push(...pts[i], ...pts[i + 1]);
    out.push(mk(segs, { filled: true, stroked: false }));
  }
  return out;
}
// Edges of a path passing within 0.5 pt of (x, y).
const spokes = (p, x, y) => {
  let n = 0;
  for (let i = 0; i + 3 < p.segs.length; i += 4) {
    const [a, b, c, d] = p.segs.slice(i, i + 4), l2 = (c - a) ** 2 + (d - b) ** 2;
    const t = l2 ? Math.max(0, Math.min(1, ((x - a) * (c - a) + (y - b) * (d - b)) / l2)) : 0;
    if (Math.hypot(x - (a + t * (c - a)), y - (b + t * (d - b))) < 0.5) n++;
  }
  return n;
};
const segCount = list => list.reduce((n, p) => n + p.segs.length / 4, 0);

test('the pinned values', () => {
  assert.equal(R.RING_FIT, 0.04); assert.equal(R.RING_COVER, 0.75); assert.equal(R.JOIN_GAP, 1);
});

test('a ring drawn as four separate arcs is one closed path', () => {
  const out = read(arcs(100, 100, 12, 4));
  const rings = out.filter(p => isClosedPath(p));
  assert.equal(rings.length, 1);
  assert.equal(out.length, 1);
  const b = boxOf(rings[0]);
  assert.ok(Math.abs(b[2] - b[0] - 24) < 0.6 && Math.abs(b[3] - b[1] - 24) < 0.6, String(b));
  assert.equal(rings[0].stroked, true); assert.equal(rings[0].filled, false);
  assert.equal(rings[0].width, 0.7);
});

test('the ring is closed the way flattenInk counts it (segments end to end, last end on first start)', () => {
  const [ring] = read(arcs(100, 100, 12, 4));
  const s = ring.segs;
  for (let i = 4; i < s.length; i += 4) assert.ok(Math.abs(s[i] - s[i - 2]) < 1e-9 && Math.abs(s[i + 1] - s[i - 1]) < 1e-9);
  assert.ok(Math.abs(s[0] - s[s.length - 2]) < 1e-9 && Math.abs(s[1] - s[s.length - 1]) < 1e-9);
  assert.equal(s.length / 4, 32);
});

test('arcs from different paths at the largest width give a ring at that width', () => {
  const a = arcs(60, 60, 8, 4); a[2].width = 1.4;
  const out = read(a);
  assert.equal(out.length, 1); assert.equal(out[0].width, 1.4);
});

test('three quarters of a ring drawn is still a ring; half is not', () => {
  const three = read(arcs(100, 100, 12, 4).slice(0, 3));
  assert.equal(three.filter(p => isClosedPath(p)).length, 1);
  const half = read(arcs(100, 100, 12, 4).slice(0, 2));
  assert.equal(half.filter(p => isClosedPath(p)).length, 0);
  assert.equal(half.length, 2);
  assert.equal(segCount(half), 16);
});

test('a ring drawn as pieces of a printed line with small breaks is a ring', () => {
  const out = [], n = 24, r = 10;
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n, b = (2 * Math.PI * (k + 1)) / n;
    const p = [100 + r * Math.cos(a), 100 + r * Math.sin(a)], q = [100 + r * Math.cos(b), 100 + r * Math.sin(b)];
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]), ux = (q[0] - p[0]) / l, uy = (q[1] - p[1]) / l;
    out.push(mk([p[0] + 0.2 * ux, p[1] + 0.2 * uy, q[0] - 0.2 * ux, q[1] - 0.2 * uy]));
  }
  const res = read(out);
  assert.equal(res.length, 1);
  assert.ok(isClosedPath(res[0]));
  const b = boxOf(res[0]); assert.ok(Math.abs(b[2] - b[0] - 20) < 0.6);
});

test('a ring of a different radius drawn over the same centre is its own ring', () => {
  const out = read([...arcs(100, 100, 12, 4), ...arcs(100, 100, 6, 4).slice(0, 2)]);
  assert.equal(out.filter(p => isClosedPath(p)).length, 1);   // the inner one is only half
  const both = read([...arcs(100, 100, 12, 4), ...arcs(100, 100, 6, 4)]);
  assert.equal(both.filter(p => isClosedPath(p)).length, 2);
});

test('arcs of a circle under 2 pt across are not rings', () => {
  assert.equal(read(arcs(100, 100, 1, 4)).filter(p => isClosedPath(p)).length, 0);
});

test('a filled disc cut into eight slices is one filled outline with no spokes', () => {
  const out = read(slices(50, 50, 10, 8));
  const fills = out.filter(p => p.filled);
  assert.equal(fills.length, 1);
  assert.equal(out.length, 1);
  assert.equal(spokes(fills[0], 50, 50), 0);
  assert.equal(fills[0].segs.length / 4, 48);
});

test('filled paths that do not touch stay separate; different greys do not merge', () => {
  const a = slices(50, 50, 10, 2), b = slices(200, 50, 10, 2);
  assert.equal(read([...a, ...b]).filter(p => p.filled).length, 2);
  a[1].grey = 90;
  assert.equal(read(a).filter(p => p.filled).length, 2);
});

test('a straight line drawn in five pieces with 0.8 pt gaps is one piece', () => {
  const out = read([0, 1, 2, 3, 4].map(k => mk([k * 10.8, 5, k * 10.8 + 10, 5])));
  assert.equal(out.length, 1);
  assert.equal(out[0].segs.length, 4);
  const [x0, y0, x1, y1] = out[0].segs;
  assert.ok(Math.abs(Math.min(x0, x1)) < 1e-6 && Math.abs(Math.max(x0, x1) - 53.2) < 1e-6 && y0 === 5 && y1 === 5);
});

test('overlapping collinear pieces are one piece', () => {
  const out = read([mk([0, 0, 20, 0]), mk([10, 0.1, 40, 0.1])]);
  assert.equal(out.length, 1);
  assert.ok(Math.abs(Math.abs(out[0].segs[2] - out[0].segs[0]) - 40) < 1e-6);
});

test('two parallel lines 1 pt apart stay two pieces', () => {
  const out = read([mk([0, 0, 30, 0]), mk([5, 1, 25, 1])]);
  assert.equal(out.length, 2);
});

test('a 2 pt gap is not joined', () => {
  assert.equal(read([mk([0, 0, 10, 0]), mk([12, 0, 22, 0])]).length, 2);
});

test('paths nothing touches come back as the same objects, in order', () => {
  const sq = mk([0, 0, 10, 0, 10, 0, 10, 10, 10, 10, 0, 10, 0, 10, 0, 0]);
  const ln = mk([50, 50, 80, 50]);
  const out = read([sq, ln]);
  assert.equal(out[0], sq); assert.equal(out[1], ln);
});

test('a white fill and a pale path pass through in their place', () => {
  const white = mk([0, 0, 10, 0, 10, 10, 0, 10, 0, 10, 0, 0], { filled: true, stroked: false, grey: 255 });
  const pale = mk([0, 5, 10, 5], { grey: 200 });
  const inkA = mk([20, 0, 30, 0]), inkB = mk([30.5, 0, 40, 0]);
  const out = read([white, inkA, pale, inkB]);
  assert.equal(out.length, 3);
  assert.equal(out[0], white);
  assert.equal(out[2], pale);
  assert.equal(out[1].segs.length, 4);   // the two ink pieces joined, in the first one's place
});

test('20,000 strokes are read in under 1.5 s of CPU time', () => {
  let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const paths = [];
  for (let i = 0; i < 20000; i++) {
    const x = rnd() * 3000, y = rnd() * 2000, a = rnd() * Math.PI, l = 3 + rnd() * 30;
    paths.push(mk([x, y, x + l * Math.cos(a), y + l * Math.sin(a)]));
  }
  for (const p of arcs(500, 500, 12, 4)) paths.push(p);
  let best = Infinity, out;
  for (let k = 0; k < 2; k++) {
    const c0 = process.cpuUsage();
    out = read(paths);
    const c = process.cpuUsage(c0);
    best = Math.min(best, (c.user + c.system) / 1000);
  }
  assert.ok(out.length > 19000);
  assert.ok(best < 1500, `${best} ms of CPU`);
});

test('readByLinePieces with hostile input gives { paths: [], capped: 0 } and never throws', () => {
  const bad = [undefined, null, 5, 'x', {}, [], [null], [undefined, 5, 'x'], [{}], [{ segs: 'x' }], [{ segs: [NaN, 0, 1, 1] }],
    [{ segs: [0, 0, Infinity, 1] }], [{ segs: [1e308, 0, -1e308, 1] }], [{ segs: [] }], [{ segs: [0, 0, 1] }]];
  for (const b of bad) assert.deepEqual(R.readByLinePieces(b), { paths: [], capped: 0 });
  const trap = { get segs() { throw new Error('no'); } };
  assert.deepEqual(R.readByLinePieces([trap]), { paths: [], capped: 0 });
  assert.deepEqual(R.readByLinePieces({ get length() { throw new Error('no'); } }), { paths: [], capped: 0 });
});

test('a clean read says capped 0', () => {
  assert.equal(R.readByLinePieces([mk([0, 0, 10, 0])]).capped, 0);
});

test('an input over the piece limit is left as written and says how many pieces were left out', () => {
  const paths = []; for (let i = 0; i < 50; i++) paths.push(mk([i * 10, 0, i * 10 + 5, 0]));
  const r = R.readByLinePieces(paths, { limit: 20 });
  assert.equal(r.capped, 50);
  assert.equal(r.paths.length, 50);
  assert.equal(R.readByLinePieces(paths).capped, 0);
});

test('a short piece inside a long one is joined, in either order', () => {
  assert.equal(read([mk([0, 0, 100, 0]), mk([40, 0, 50, 0])]).length, 1);
  assert.equal(read([mk([40, 0, 50, 0]), mk([0, 0, 100, 0])]).length, 1);
  const o = read([mk([40, 0, 50, 0]), mk([0, 0, 100, 0])]);
  assert.ok(Math.abs(Math.abs(o[0].segs[2] - o[0].segs[0]) - 100) < 1e-6);
});

test('a broken line beside a dense block of strokes is still joined, and nothing is capped', () => {
  let seed = 3; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const paths = [];
  for (let i = 0; i < 400; i++) { const x = 100 + rnd() * 8, y = 100 + rnd() * 8, a = rnd() * Math.PI; paths.push(mk([x, y, x + 2 * Math.cos(a), y + 2 * Math.sin(a)])); }
  for (let k = 0; k < 5; k++) paths.push(mk([k * 10.8 + 104, 104.5, k * 10.8 + 114, 104.5].map((v, i) => i === 1 || i === 3 ? 140 : v)));
  const r = R.readByLinePieces(paths);
  assert.equal(r.capped, 0);
  assert.ok(r.paths.some(p => p.segs.length === 4 && Math.abs(Math.abs(p.segs[2] - p.segs[0]) - 53.2) < 1e-6 && p.segs[1] === 140));
});

test('a path that is already one closed loop stays whole; open arcs are still made a ring', () => {
  const hex = mk([0, 10, 8, 0, 8, 0, 20, 0, 20, 0, 28, 10, 28, 10, 20, 20, 20, 20, 8, 20, 8, 20, 0, 10]);
  const circ = arcs(100, 100, 12, 1, 22)[0];
  assert.ok(isClosedPath(circ));
  const out = read([hex, circ]);
  assert.equal(out.length, 2);
  assert.equal(out[0], hex); assert.equal(out[1], circ);
  const four = read(arcs(100, 100, 12, 4));
  assert.equal(four.length, 1); assert.ok(isClosedPath(four[0]));
});

test('capped counts distinct pieces left out, not looker and piece pairs', () => {
  // 12 pieces all starting at one point, scanned 3 at a time: no piece can be counted twice.
  const paths = []; for (let i = 0; i < 12; i++) { const a = i * 0.5; paths.push(mk([50, 50, 50 + 5 * Math.cos(a), 50 + 5 * Math.sin(a)])); }
  const r = R.readByLinePieces(paths, { scan: 3 });
  assert.ok(r.capped > 0 && r.capped <= 12, String(r.capped));
});

test('a dense block of 6,000 tiny strokes beside a broken line and four arcs: line joined, ring made, nothing capped', () => {
  let seed = 11; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const paths = [];
  for (let i = 0; i < 6000; i++) { const x = 300 + rnd() * 10, y = 300 + rnd() * 10, a = rnd() * Math.PI; paths.push(mk([x, y, x + 1.5 * Math.cos(a), y + 1.5 * Math.sin(a)])); }
  for (let k = 0; k < 5; k++) paths.push(mk([290 + k * 10.8, 330, 300 + k * 10.8, 330]));
  for (const a of arcs(340, 340, 12, 4)) paths.push(a);
  const r = R.readByLinePieces(paths);
  assert.equal(r.capped, 0);
  assert.ok(r.paths.some(p => p.segs.length === 4 && p.segs[1] === 330 && Math.abs(Math.abs(p.segs[2] - p.segs[0]) - 53.2) < 1e-6));
  assert.ok(r.paths.some(p => isClosedPath(p) && p.segs.length === 128));
});

test('300 long lines (1,000 to 3,000 pt), each broken in pieces, are read in under 1.5 s of CPU time and joined', () => {
  let seed = 5; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const paths = [];
  for (let k = 0; k < 300; k++) {
    const y = 10 + k * 6, len = 1000 + rnd() * 2000, tilt = (rnd() - 0.5) * 0.002, pieces = 20;
    for (let q = 0; q < pieces; q++) { const x0 = (q * len) / pieces, x1 = ((q + 1) * len) / pieces - 0.5; paths.push(mk([x0, y + tilt * x0, x1, y + tilt * x1])); }
  }
  const c0 = process.cpuUsage();
  const r = R.readByLinePieces(paths);
  const c = process.cpuUsage(c0);
  assert.ok((c.user + c.system) / 1000 < 1500, `${(c.user + c.system) / 1000} ms of CPU`);
  assert.equal(r.paths.length, 300);
  assert.equal(r.capped, 0);
});

test('pieces of one line either side of an angle-bin edge, far from the origin, are joined', () => {
  // Two collinear pieces about 1500 pt out: one 0.0305 rad off horizontal, one 0.03, each on the line y = 1500 + 0.0305 x - ...
  const th = 0.03, x0 = 1500;
  const a = mk([x0, 1500, x0 + 100 * Math.cos(th + 0.0005), 1500 + 100 * Math.sin(th + 0.0005)]);
  const b = mk([x0 + 100 * Math.cos(th + 0.0005), 1500 + 100 * Math.sin(th + 0.0005), x0 + 200 * Math.cos(th + 0.0005), 1500 + 200 * Math.sin(th + 0.0005)]);
  b.segs[2] = x0 + 200 * Math.cos(th - 0.0003) + 0; b.segs[3] = 1500 + 200 * Math.sin(th - 0.0003);
  assert.equal(read([a, b]).length, 1);
});

test('a horizontal line in four pieces with mixed-sign y jitter is one piece; so is a vertical one', () => {
  const j = [0.001, -0.001, 0.001, -0.001];
  const h = [0, 1, 2, 3].map(k => mk([1000 + k * 50, 300, 1000 + k * 50 + 50, 300 + j[k]]));
  assert.equal(read(h).length, 1);
  const hr = [0, 1, 2, 3].map(k => mk([1000 + k * 50 + 50, 300 + j[k], 1000 + k * 50, 300]));   // drawn the other way round
  assert.equal(read(hr).length, 1);
  const v = [0, 1, 2, 3].map(k => mk([300, 1000 + k * 50, 300 + j[k], 1000 + k * 50 + 50]));
  assert.equal(read(v).length, 1);
  const w = [0, 1, 2, 3].map(k => mk([1000 + k * 50, 300 + (k % 2 ? 0.0004 : -0.0004), 1000 + k * 50 + 50, 300 + (k % 2 ? -0.0004 : 0.0004)]));
  assert.equal(read(w).length, 1);
});

test('parallel lines 1 pt apart far from the origin still stay two pieces', () => {
  assert.equal(read([mk([1500, 1500, 1700, 1500]), mk([1500, 1501, 1700, 1501])]).length, 2);
  assert.equal(read([mk([1500, 1500, 1700, 1500.001]), mk([1500, 1499, 1700, 1499.001])]).length, 2);
});
