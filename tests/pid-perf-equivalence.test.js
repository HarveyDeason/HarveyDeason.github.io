// tests/pid-perf-equivalence.test.js
// The speed work on the symbol check must not change one answer. Each test here
// keeps a frozen copy of the ORIGINAL (slow) code and holds the current one to
// it, over invented data and a seeded random generator. If one of these fails,
// an optimisation changed behaviour: stop and report it, do not edit the test.
//
// Invented data only: nothing here comes from a real drawing or legend.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../assets/js/pid-symbol-check.js';
import { LIBRARY, SHEET } from './fixtures/symbol-check-sheet.js';

// A small seeded generator, so a failure can be repeated.
function rng(seed) { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }
const isNum = x => typeof x === 'number' && Number.isFinite(x);

// ---- frozen: the original dilate -------------------------------------------------------------------------------
function refDilate(bitmap, r) {
  const b = bitmap;
  const n = Math.max(0, Math.min(64, Math.round(isNum(r) ? r : 0)));
  const { w, h, data } = b, across = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!data[y * w + x]) continue;
    for (let k = Math.max(0, x - n); k <= Math.min(w - 1, x + n); k++) across[y * w + k] = 1;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!across[y * w + x]) continue;
    for (let k = Math.max(0, y - n); k <= Math.min(h - 1, y + n); k++) out[k * w + x] = 1;
  }
  return { x0: b.x0, y0: b.y0, w, h, pxPerPt: b.pxPerPt, data: out };
}

// ---- frozen: the original strokes and fills (what rasterise drew) -----------------------------------------------
const BLANK = (x0, y0, w, h, pxPerPt) => ({ x0, y0, w, h, pxPerPt, data: new Uint8Array(w * h) });
function refFillPoly(b, px, value) {
  let ya = Infinity, yb = -Infinity;
  for (let i = 1; i < px.length; i += 2) { if (px[i] < ya) ya = px[i]; if (px[i] > yb) yb = px[i]; }
  const y0 = Math.max(0, Math.floor(ya)), y1 = Math.min(b.h - 1, Math.ceil(yb));
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5, xs = [];
    for (let i = 0; i + 3 < px.length; i += 4) {
      const p0 = px[i + 1], p1 = px[i + 3];
      if ((p0 <= yc) !== (p1 <= yc)) xs.push(px[i] + (yc - p0) / (p1 - p0) * (px[i + 2] - px[i]));
    }
    xs.sort((a, c) => a - c);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.round(xs[k])), xb = Math.min(b.w, Math.round(xs[k + 1]));
      for (let x = xa; x < xb; x++) b.data[y * b.w + x] = value;
    }
  }
}
function refStrokeLine(b, x0, y0, x1, y1, r) {
  const dx = x1 - x0, dy = y1 - y0, m = r + 1;
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, x0 + m], [dx, b.w + m - x0], [-dy, y0 + m], [dy, b.h + m - y0]]) {
    if (p === 0) { if (q < 0) return; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return; if (t > t0) t0 = t; } else { if (t < t0) return; if (t < t1) t1 = t; }
  }
  const ax = x0 + dx * t0, ay = y0 + dy * t0, bx = x0 + dx * t1, by = y0 + dy * t1;
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
  for (let i = 0; i <= n; i++) {
    const cx = Math.floor(ax + (bx - ax) * i / n), cy = Math.floor(ay + (by - ay) * i / n);
    for (let y = Math.max(0, cy - r); y <= Math.min(b.h - 1, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(b.w - 1, cx + r); x++) b.data[y * b.w + x] = 1;
    }
  }
}
function refDrawInto(b, paths, o, cfg) {
  const S = b.pxPerPt;
  const tf = typeof o.transform === 'function' ? o.transform : null;
  const scale = isNum(o.scale) && o.scale > 0 ? o.scale : 1;
  const loops = o.fillLoops instanceof Set ? o.fillLoops : null;
  for (const p of paths) {
    if (!p || typeof p !== 'object' || !Array.isArray(p.segs)) continue;
    const grey = isNum(p.grey) ? p.grey : 0;
    const white = grey >= cfg.whiteGrey, ink = grey < cfg.inkGrey;
    if (!white && !ink) continue;
    const px = [];
    for (let i = 0; i + 3 < p.segs.length; i += 4) {
      let a = [p.segs[i], p.segs[i + 1]], c = [p.segs[i + 2], p.segs[i + 3]];
      if (tf) { a = tf(a[0], a[1]); c = tf(c[0], c[1]); }
      const q = [(a[0] - b.x0) * S, (a[1] - b.y0) * S, (c[0] - b.x0) * S, (c[1] - b.y0) * S];
      if (q.every(isNum)) px.push(q[0], q[1], q[2], q[3]);
    }
    if (!px.length) continue;
    const filled = p.filled === true;
    if (filled) refFillPoly(b, px, white ? 0 : 1);
    else if (ink && loops && loops.has(p)) refFillPoly(b, px, 1);
    const stroked = p.stroked === true || (p.stroked === undefined && !filled);
    if (stroked && ink) {
      const widthPx = Math.max(1, (isNum(p.width) ? p.width : 0) * scale * S);
      const r = Math.min(64, Math.max(0, Math.round(widthPx / 2 - 0.5)));
      for (let i = 0; i + 3 < px.length; i += 4) refStrokeLine(b, px[i], px[i + 1], px[i + 2], px[i + 3], r);
    }
  }
}
const CFG = { ...C.CHECK_DEFAULTS, twin: true };   // as the check's settings: the twin rule is on unless an option turns it off
function refRasterise(paths, frame, options) {
  const S = options && options.pxPerPt > 0 ? options.pxPerPt : CFG.pxPerPt;
  const b = BLANK(frame.x0, frame.y0, Math.ceil(frame.w * S), Math.ceil(frame.h * S), S);
  refDrawInto(b, paths, options || {}, CFG);
  return b;
}

// Random linework: lines of every direction and width, closed fills, white fills, grey paths, off-frame ink.
function randomPaths(rand, count, span) {
  const paths = [];
  for (let i = 0; i < count; i++) {
    const x = (rand() - 0.1) * span, y = (rand() - 0.1) * span, kind = rand();
    const pts = [x, y];
    const n = kind < 0.5 ? 1 : 3 + Math.floor(rand() * 4);
    for (let j = 0; j < n; j++) pts.push(pts[pts.length - 2] + (rand() - 0.5) * 60, pts[pts.length - 1] + (rand() - 0.5) * 60);
    const segs = [];
    for (let j = 0; j + 3 < pts.length; j += 2) segs.push(pts[j], pts[j + 1], pts[j + 2], pts[j + 3]);
    if (kind > 0.75) segs.push(pts[pts.length - 2], pts[pts.length - 1], pts[0], pts[1]);
    const flat = [];
    for (let j = 0; j < segs.length; j += 4) flat.push(segs[j], segs[j + 1], segs[j + 2], segs[j + 3]);
    paths.push({ segs: flat, width: [0, 0.18, 0.35, 0.7, 1.4, 3][Math.floor(rand() * 6)], stroked: kind < 0.9, filled: kind > 0.8,
      grey: kind > 0.97 ? 255 : kind > 0.94 ? 200 : 0 });
  }
  return paths;
}

test('dilate: identical to the original, every size, margin and grown distance', () => {
  const rand = rng(11);
  for (const [w, h] of [[1, 1], [3, 5], [17, 9], [64, 64], [101, 37], [260, 260]]) {
    for (const density of [0, 0.002, 0.05, 0.4, 1]) {
      const b = BLANK(0, 0, w, h, 4);
      for (let i = 0; i < w * h; i++) if (rand() < density) b.data[i] = density === 0.4 ? 1 + Math.floor(rand() * 200) : 1;   // any non-zero byte is ink
      for (const r of [0, 1, 2, 5, 70]) {
        const got = C.dilate(b, r), want = refDilate(b, r);
        assert.deepEqual([got.w, got.h, got.x0, got.y0, got.pxPerPt], [want.w, want.h, want.x0, want.y0, want.pxPerPt]);
        assert.ok(Buffer.compare(Buffer.from(got.data), Buffer.from(want.data)) === 0, `dilate differs: ${w}x${h} density ${density} r ${r}`);
      }
    }
  }
});

test('dilate: a bitmap over a shared buffer at an odd offset is read correctly', () => {
  const rand = rng(5), w = 30, h = 20, whole = new Uint8Array(w * h + 7);
  for (let i = 0; i < w * h; i++) if (rand() < 0.03) whole[i + 3] = 1;
  const b = { x0: 0, y0: 0, w, h, pxPerPt: 4, data: whole.subarray(3, 3 + w * h) };
  assert.ok(Buffer.compare(Buffer.from(C.dilate(b, 2).data), Buffer.from(refDilate(b, 2).data)) === 0);
});

test('rasterise: identical to the original over random linework, widths, fills, white fills and clipped ink', () => {
  const rand = rng(23);
  for (let round = 0; round < 40; round++) {
    const paths = randomPaths(rand, 5 + Math.floor(rand() * 40), 200);
    const frame = { x0: rand() * 40 - 20, y0: rand() * 40 - 20, w: 40 + rand() * 120, h: 40 + rand() * 120 };
    const got = C.rasterise(paths, frame), want = refRasterise(paths, frame);
    assert.deepEqual([got.w, got.h], [want.w, want.h]);
    assert.ok(Buffer.compare(Buffer.from(got.data), Buffer.from(want.data)) === 0, `rasterise differs in round ${round}`);
  }
});

test('rasterise: transform, scale and fillLoops give the original bitmap', () => {
  const rand = rng(31);
  for (let round = 0; round < 12; round++) {
    const paths = randomPaths(rand, 12, 80);
    const frame = { x0: 0, y0: 0, w: 120, h: 120 };
    const o = { transform: (x, y) => [0.9 * x - 0.3 * y + 7, 0.3 * x + 0.9 * y + 3], scale: 0.5 + rand() * 2, fillLoops: new Set(paths.filter((_, i) => i % 3 === 0)) };
    assert.ok(Buffer.compare(Buffer.from(C.rasterise(paths, frame, o).data), Buffer.from(refRasterise(paths, frame, o).data)) === 0, `round ${round}`);
  }
});

// ---- frozen: the original proposePlacements and scorePlacement --------------------------------------------------
function refPropose(prepared, segments, centre, options) {
  const out = [];
  const cfg = { ...CFG, ...(options || {}) }, p = prepared, c = centre;
  if (p.checkable !== true || !isNum(c[0]) || !isNum(c[1])) return out;
  const seen = new Set(), reach = cfg.radius + 40;
  for (const key of p.keys) {
    const kx = key[2] - key[0], ky = key[3] - key[1], mx = (key[0] + key[2]) / 2, my = (key[1] + key[3]) / 2;
    for (const g of segments) {
      if (!Array.isArray(g) || !g.slice(0, 5).every(isNum)) continue;
      const k = g[4] / key[4];
      if (k < cfg.minScale || k > cfg.maxScale) continue;
      const gx = (g[0] + g[2]) / 2, gy = (g[1] + g[3]) / 2;
      if (Math.hypot(gx - c[0], gy - c[1]) > reach) continue;
      for (let o = 0; o < 8; o++) {
        const [a, b, cc, d] = C.ORIENTATIONS[o];
        const vx = a * kx + cc * ky, vy = b * kx + d * ky;
        if (Math.abs(vx * (g[3] - g[1]) - vy * (g[2] - g[0])) > cfg.angleTol * key[4] * g[4]) continue;
        const tx = gx - k * (a * mx + cc * my), ty = gy - k * (b * mx + d * my);
        const cx = k * (a * p.w / 2 + cc * p.h / 2) + tx, cy = k * (b * p.w / 2 + d * p.h / 2) + ty;
        if (Math.hypot(cx - c[0], cy - c[1]) > cfg.radius) continue;
        const id = o + ':' + Math.round(tx * 4) + ':' + Math.round(ty * 4) + ':' + Math.round(k * 50);
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ o, k, tx, ty, cx, cy });
      }
    }
  }
  return out;
}

function refScore(prepared, placement, window, cfg) {
  const p = prepared, D = window.ink, N = window.near;
  const S = D.pxPerPt, W = D.w, H = D.h;
  const tf = (x, y) => C.placePoint(placement, x, y);
  const pts = p.points, step = 2 * Math.max(1, Math.floor(pts.length / 2 / 30));
  let on = 0, n = 0;
  for (let i = 0; i + 1 < pts.length; i += step) {
    const q = tf(pts[i], pts[i + 1]);
    const X = Math.floor((q[0] - D.x0) * S), Y = Math.floor((q[1] - D.y0) * S);
    n++;
    if (X >= 0 && Y >= 0 && X < W && Y < H && N.data[Y * W + X]) on++;
  }
  if (!n || on < cfg.quickLook * n) return null;
  const c0 = tf(0, 0), c1 = tf(p.w, p.h);
  const bx0 = Math.min(c0[0], c1[0]), by0 = Math.min(c0[1], c1[1]), bw = Math.abs(c1[0] - c0[0]), bh = Math.abs(c1[1] - c0[1]);
  const ox = Math.round((bx0 - 1 - D.x0) * S), oy = Math.round((by0 - 1 - D.y0) * S);
  const tw = Math.ceil((bw + 2) * S), th = Math.ceil((bh + 2) * S);
  if (ox < 0 || oy < 0 || ox + tw > W || oy + th > H) return null;
  const fx = D.x0 + ox / S, fy = D.y0 + oy / S;
  let fillLoops = null;
  if (cfg.twin && p.loops.length) {
    const bare = BLANK(fx, fy, tw, th, S);
    refDrawInto(bare, p.symbol.paths, { transform: tf, scale: placement.k }, cfg);
    for (const lp of p.loops) {
      const probe = BLANK(fx, fy, tw, th, S), px = [];
      for (let i = 0; i + 1 < lp.segs.length; i += 2) { const q = tf(lp.segs[i], lp.segs[i + 1]); px.push((q[0] - fx) * S, (q[1] - fy) * S); }
      refFillPoly(probe, px, 1);
      let inside = 0, solid = 0;
      for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
        const i = y * tw + x;
        if (probe.data[i] && !bare.data[i]) { inside++; if (D.data[(y + oy) * W + x + ox]) solid++; }
      }
      if (inside > 20 && solid >= cfg.fillInside * inside) (fillLoops = fillLoops || new Set()).add(lp);
    }
  }
  const T = BLANK(fx, fy, tw, th, S);
  refDrawInto(T, p.symbol.paths, { transform: tf, scale: placement.k, fillLoops }, cfg);
  const Tn = refDilate(T, Math.round(cfg.inkTol * S));
  let tInk = 0, tHit = 0, dInk = 0, dHit = 0;
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const ti = y * tw + x, di = (y + oy) * W + x + ox;
    if (T.data[ti]) { tInk++; if (N.data[di]) tHit++; }
    if (D.data[di]) { dInk++; if (Tn.data[ti]) dHit++; }
  }
  if (!tInk || !dInk) return null;
  const forward = tHit / tInk, backward = dHit / dInk;
  return { score: Math.min(forward, backward), forward, backward, filled: !!fillLoops, box: [bx0, by0, bx0 + bw, by0 + bh] };
}

function segmentsOf(paths) { return C.drawingSegments(paths); }

// A sheet of real-looking symbols: every library symbol stamped in every orientation and several sizes, with noise between.
function stampedSheet(rand) {
  const prepared = C.prepareSymbols(LIBRARY);
  const paths = [];
  const checkable = prepared.filter(p => p.checkable);
  let n = 0;
  for (const p of checkable) {
    for (let o = 0; o < 8; o += 3) {
      const k = [0.9, 1, 1.2][Math.floor(rand() * 3)];
      const x0 = 30 + (n % 6) * 55, y0 = 30 + Math.floor(n / 6) * 55; n++;
      for (const q of p.symbol.paths) {
        const segs = [];
        for (let i = 0; i + 1 < q.segs.length; i += 2) { const t = C.placePoint({ o, k, tx: x0, ty: y0 }, q.segs[i], q.segs[i + 1]); segs.push(t[0], t[1]); }
        paths.push({ ...q, segs });
      }
    }
  }
  paths.push(...randomPaths(rand, 25, 340));
  return { prepared, paths };
}

test('proposePlacements: the same placements, in the same order, as the original', () => {
  const rand = rng(41);
  const { prepared, paths } = stampedSheet(rand);
  const segs = segmentsOf(paths);
  assert.ok(segs.length > 100);
  let total = 0;
  for (const p of prepared) {
    for (let t = 0; t < 12; t++) {
      const c = [30 + rand() * 300, 30 + rand() * 300];
      const near = segs.filter(g => Math.hypot((g[0] + g[2]) / 2 - c[0], (g[1] + g[3]) / 2 - c[1]) <= 100);
      for (const opt of [undefined, { minScale: 0.3, maxScale: 2.2 }, { radius: 20 }]) {
        const got = C.proposePlacements(p, near, c, opt), want = refPropose(p, near, c, opt);
        total += got.length;
        assert.deepEqual(got, want);
      }
    }
  }
  assert.ok(total > 200, 'the test must actually propose placements: ' + total);
});

test('proposePlacements: segments that are not segments are skipped as before', () => {
  const p = C.prepareSymbols(LIBRARY).find(x => x.checkable);
  const good = [10, 10, 34, 10, 24];
  const odd = [null, undefined, 'x', [1, 2], [1, 2, 3], [1, 2, 3, 4], [NaN, 1, 2, 3, 4], [1, 2, 3, 4, Infinity], { 0: 1 }, [...good, 'extra']];
  for (const list of [[...odd, good], [good, ...odd]]) {
    assert.deepEqual(C.proposePlacements(p, list, [20, 10]), refPropose(p, list.filter(Array.isArray), [20, 10]));
  }
});

test('scorePlacement: the same score, fill reading and box as the original, for every proposed placement', () => {
  const rand = rng(53);
  const { prepared, paths } = stampedSheet(rand);
  const segs = segmentsOf(paths);
  let scored = 0, passed = 0;
  for (let t = 0; t < 14; t++) {
    const c = [60 + rand() * 250, 60 + rand() * 250];
    const win = C.drawingWindow(paths, c);
    const near = segs.filter(g => Math.hypot((g[0] + g[2]) / 2 - c[0], (g[1] + g[3]) / 2 - c[1]) <= 100);
    for (const p of prepared.filter(x => x.checkable)) {
      for (const pl of C.proposePlacements(p, near, c)) {
        const cfg = rand() < 0.3 ? { ...CFG, quickLook: 0.3 } : CFG;
        const got = C.scorePlacement(p, pl, win, cfg.quickLook === 0.3 ? { quickLook: 0.3 } : undefined), want = refScore(p, pl, win, cfg);
        scored++;
        if (want) passed++;
        assert.deepEqual(got, want);
        // a twin-off read as well
        assert.deepEqual(C.scorePlacement(p, pl, win, { twin: false }), refScore(p, pl, win, { ...CFG, twin: false }));
      }
    }
  }
  assert.ok(scored > 200 && passed > 20, `scored ${scored}, passed the quick look ${passed}`);
});

test('scorePlacement: bad placements and windows still give null, never a throw', () => {
  const p = C.prepareSymbols(LIBRARY).find(x => x.checkable);
  const win = C.drawingWindow([], [100, 100]);
  for (const pl of [null, {}, { o: 9, k: 1, tx: 0, ty: 0 }, { o: 0, k: -1, tx: 0, ty: 0 }, { o: 0, k: 1, tx: NaN, ty: 0 }]) assert.equal(C.scorePlacement(p, pl, win), null);
  assert.equal(C.scorePlacement(p, { o: 0, k: 1, tx: 100, ty: 100 }, null), null);
  assert.equal(C.scorePlacement(p, { o: 0, k: 1, tx: 100, ty: 100 }, { ink: {}, near: {} }), null);
  assert.equal(C.scorePlacement(null, { o: 0, k: 1, tx: 100, ty: 100 }, win), null);
});

test('drawingWindow: the same ink and grown ink as the original round a centre', () => {
  const rand = rng(61);
  for (let t = 0; t < 8; t++) {
    const paths = randomPaths(rand, 30, 400), c = [100 + rand() * 200, 100 + rand() * 200];
    const w = C.drawingWindow(paths, c);
    const half = CFG.radius + 70, side = Math.ceil(2 * half * CFG.pxPerPt);
    const ref = BLANK(c[0] - half, c[1] - half, side, side, CFG.pxPerPt);
    refDrawInto(ref, paths, {}, CFG);
    assert.ok(Buffer.compare(Buffer.from(w.ink.data), Buffer.from(ref.data)) === 0, 'ink differs');
    assert.ok(Buffer.compare(Buffer.from(w.near.data), Buffer.from(refDilate(ref, Math.round(CFG.inkTol * CFG.pxPerPt)).data)) === 0, 'grown ink differs');
  }
});

test('the invented sheet gives the same verdict list as before the speed work', () => {
  // A fixed fingerprint of one whole check, taken before the speed work: if a change alters any verdict, symbol or shape, this changes.
  const r = C.checkSheet({ paths: SHEET.paths, textItems: SHEET.textItems, viewportTransform: SHEET.viewportTransform, tags: SHEET.tags, pageSize: SHEET.pageSize, library: LIBRARY, lookups: { fc: {} } });
  assert.equal(r.ok, true);
  const answer = JSON.stringify({ v: r.verdicts, s: r.symbols, sh: r.shapes, c: r.counts }, (k, v) => (k === 'ms' || k === 'overlay' ? undefined : v));
  assert.equal(answer.length > 100, true);
  assert.equal(fingerprint(answer), EXPECTED_SHEET_FINGERPRINT);
});

// A small stable hash (FNV-1a, 32 bit) of the answer's text.
function fingerprint(text) { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); }
const EXPECTED_SHEET_FINGERPRINT = '8ea753fc';

// ---- the segments near a centre ---------------------------------------------------------------------------------
test('segmentIndex: the segments within reach of a centre, in the order given, exactly as a filter finds them', () => {
  const rand = rng(77);
  const segs = [];
  for (let i = 0; i < 3000; i++) { const x = rand() * 2400 - 100, y = rand() * 1700 - 100, l = 1 + rand() * 120, a = rand() * 6.3; segs.push([x, y, x + l * Math.cos(a), y + l * Math.sin(a), l]); }
  const near = C.segmentIndex(segs);
  const want = (c, reach) => segs.filter(g => Math.hypot((g[0] + g[2]) / 2 - c[0], (g[1] + g[3]) / 2 - c[1]) <= reach);
  let total = 0;
  for (let t = 0; t < 120; t++) {
    const c = [rand() * 2500 - 50, rand() * 1800 - 50], reach = [100, 100, 60, 250, 0, 1e5][t % 6];
    const got = near(c, reach), exp = want(c, reach);
    total += got.length;
    assert.equal(got.length, exp.length);
    for (let i = 0; i < exp.length; i++) assert.equal(got[i], exp[i], 'same segment, same place in the list');
  }
  assert.ok(total > 1000);
  assert.deepEqual(C.segmentIndex([])([5, 5], 100), []);
});

test('rasterise: level and upright lines whose ends sit exactly on pixel edges match the original', () => {
  const rand = rng(91);
  const paths = [];
  for (let i = 0; i < 300; i++) {
    // ends at quarter points: exactly on pixel edges at 4 px per point; widths from hairline to heavy
    const x = Math.round(rand() * 160) / 4, y = Math.round(rand() * 160) / 4, l = Math.round(rand() * 120) / 4, w = [0, 0.18, 0.5, 1, 2.5][i % 5];
    paths.push({ segs: i % 2 ? [x, y, x + l, y] : [x, y, x, y + l], width: w, stroked: true, grey: 0 });
    if (i % 7 === 0) paths.push({ segs: [x + 0.1, y, x + l + 0.37, y], width: w, stroked: true, grey: 0 });   // and a few that are not on an edge
  }
  for (const frame of [{ x0: 0, y0: 0, w: 120, h: 120 }, { x0: 13.25, y0: -7.5, w: 90, h: 70 }, { x0: 50, y0: 50, w: 30.5, h: 30.5 }]) {
    assert.ok(Buffer.compare(Buffer.from(C.rasterise(paths, frame).data), Buffer.from(refRasterise(paths, frame).data)) === 0);
  }
});
