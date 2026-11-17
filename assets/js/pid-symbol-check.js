// assets/js/pid-symbol-check.js
// The P&ID Tag Register's symbol check: does a standard symbol of the right
// family sit beside each tag on a sheet? Pure logic. No DOM, no File System
// Access, no pdf.js import: everything here is node-testable, and it runs
// unchanged in a worker.
//
// NO LEGEND OR DRAWING DATA BELONGS HERE. assets/js/ is served publicly. The
// symbol library is the client's standard drawing; it lives only in
// symbol-library.json in the connected register folder and arrives here as an
// argument, as do the drawing's linework, its text and the lookup tables.
// Tests use invented symbols and an invented sheet. Keep it that way.
//
// WHAT THE CHECK CAN AND CANNOT SAY. It can say a standard symbol of the
// right FAMILY sits beside a tag. It cannot say the right member of that
// family was chosen.
//
// All geometry is in PDF points with a top-left origin.

import { textWords, isClosedPath } from './pid-symbols.js';

const isNum = x => typeof x === 'number' && Number.isFinite(x);
const asArr = x => (Array.isArray(x) ? x : []);
const asObj = x => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
const str = x => (typeof x === 'string' ? x : '');
const own = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

export const CHECK_DEFAULTS = Object.freeze({
  pxPerPt: 4, inkTol: 0.5,            // ink within 0.5 pt counts as a hit
  radius: 60,                         // points from a tag's centre to a symbol's centre
  recognise: 0.90, oneOf: 0.03, sameSpot: 3,
  minScale: 0.75, maxScale: 1.35, sizeBand: 0.05,
  keyLines: 2, minKeyLine: 4, angleTol: 0.035, quickLook: 0.85, fillInside: 0.85,
  inkGrey: 175, whiteGrey: 250,       // darker than 175 is ink; a fill of 250 or lighter hides what is under it
  simpleSegs: 4, simpleLength: 25, minSize: 3, maxSize: 120,
  timeLimitMs: 120000,                // a check still running after this stops and says so
  shareInk: 0.5,                      // two hits sharing this much ink are one physical symbol
  sweepStep: 80,                      // points between the sweep's centres: every point is within 57 pt of one
  plainBack: 0.96,                    // a plain symbol found by the sweep must explain this much of the ink in its box
});

const MAX_SWEEP_SIDE = 14400;         // points: the largest PDF page. A larger side is not swept.

export const VERDICTS = ['ok', 'off-size', 'wrong-family', 'exception', 'look', 'not-checked'];

// The defaults, with any positive number the caller supplied in their place.
function settings(options) {
  const o = asObj(options), out = { ...CHECK_DEFAULTS };
  for (const k of Object.keys(CHECK_DEFAULTS)) if (isNum(o[k]) && o[k] > 0) out[k] = o[k];
  out.twin = o.twin !== false;
  return out;
}

// ── Where each tag is on the page ─────────────────────────────────────────

const IDENTITY = [1, 0, 0, 1, 0, 0];
const isMatrix = m => (Array.isArray(m) || (ArrayBuffer.isView(m) && !(m instanceof DataView))) && m.length >= 6
  && [0, 1, 2, 3, 4, 5].every(i => isNum(m[i]));
function mul(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
// The same arithmetic as textWords in pid-symbols.js, kept per item so that
// an item's place in the list is not lost.
function itemBox(it, vt) {
  if (!it || typeof it !== 'object' || !isMatrix(it.transform) || !isNum(it.width) || !isNum(it.height)) return null;
  const m = mul(vt, it.transform);
  const dl = Math.hypot(m[0], m[1]), ul = Math.hypot(m[2], m[3]);
  if (!dl || !ul) return null;
  const dx = (m[0] / dl) * it.width, dy = (m[1] / dl) * it.width;
  const ux = (m[2] / ul) * it.height, uy = (m[3] / ul) * it.height;
  const xs = [m[4], m[4] + dx, m[4] + ux, m[4] + dx + ux], ys = [m[5], m[5] + dy, m[5] + uy, m[5] + dy + uy];
  const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  return box.every(isNum) ? box : null;
}
const dashless = s => s.replace(/[–—‒―]/g, '-').toUpperCase();
const validTag = t => !!t && typeof t === 'object' && typeof t.tag === 'string' && !!t.tag.trim() && typeof t.fc === 'string';

/**
 * Find each tag on the page from the text items it was read from. A tag can
 * be held in one item or split over two (the code on one line, the number on
 * the next), and can be written in more than one place.
 */
export function tagPlaces(textItems, tags, viewportTransform) {
  try {
    const vt = isMatrix(viewportTransform) ? viewportTransform : IDENTITY;
    const items = asArr(textItems);
    let joined = '';
    const spans = [];
    items.forEach((it, i) => {
      const s = it && typeof it === 'object' && typeof it.str === 'string' ? dashless(it.str) : '';
      spans.push({ start: joined.length, end: joined.length + s.length, i, blank: !s.trim() });
      joined += s + ' ';
    });
    return asArr(tags).filter(validTag).map(t => {
      const places = [];
      const parts = dashless(t.tag.trim()).split('-').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const re = new RegExp('(?<![A-Z0-9])' + parts.join('[\\s\\-]{0,3}') + '(?![A-Z0-9])', 'g');
      for (const m of joined.matchAll(re)) {
        if (places.length >= 50) break;
        let box = null, n = 0;
        for (const sp of spans) {
          if (sp.blank || sp.end <= m.index || sp.start >= m.index + m[0].length) continue;
          const b = itemBox(items[sp.i], vt);
          if (!b) continue;
          n++;
          box = box ? [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])] : b;
        }
        if (box) places.push({ box, items: n });
      }
      return { tag: t.tag, fc: t.fc, places };
    });
  } catch {
    return [];
  }
}

// ── Rasteriser ────────────────────────────────────────────────────────────
// Our own, for the legend's symbols and the drawing alike, so the two are
// drawn the same way and text is left out by construction.

const MAX_SIDE = 4096; // pixels
const blank = (x0, y0, w, h, pxPerPt) => ({ x0, y0, w, h, pxPerPt, data: new Uint8Array(w * h) });

// Even-odd fill by scanline through pixel centres. px is flat, in pixels.
function fillPoly(b, px, value) {
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

// A stroke, stamped along the part of the segment that lies near the bitmap.
function strokeLine(b, x0, y0, x1, y1, r) {
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

function drawInto(b, paths, o, cfg) {
  const S = b.pxPerPt;
  const tf = typeof o.transform === 'function' ? o.transform : null;
  const scale = isNum(o.scale) && o.scale > 0 ? o.scale : 1;
  const loops = o.fillLoops instanceof Set ? o.fillLoops : null;
  for (const p of asArr(paths)) {
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
    if (filled) fillPoly(b, px, white ? 0 : 1);
    else if (ink && loops && loops.has(p)) fillPoly(b, px, 1);
    const stroked = p.stroked === true || (p.stroked === undefined && !filled);
    if (stroked && ink) {
      const widthPx = Math.max(1, (isNum(p.width) ? p.width : 0) * scale * S);
      const r = Math.min(64, Math.max(0, Math.round(widthPx / 2 - 0.5)));
      for (let i = 0; i + 3 < px.length; i += 4) strokeLine(b, px[i], px[i + 1], px[i + 2], px[i + 3], r);
    }
  }
}

/**
 * Draw linework into a bitmap. frame = { x0, y0, w, h } in points. Paths are
 * drawn in order: a dark path is ink, a white fill hides what is under it,
 * and anything in between is ignored. options = { pxPerPt, transform, scale,
 * fillLoops }. Never throws; a frame that cannot be drawn gives an empty bitmap.
 */
export function rasterise(paths, frame, options) {
  const o = asObj(options);
  const S = isNum(o.pxPerPt) && o.pxPerPt > 0 ? o.pxPerPt : CHECK_DEFAULTS.pxPerPt;
  try {
    const f = asObj(frame);
    if (![f.x0, f.y0, f.w, f.h].every(isNum) || f.w <= 0 || f.h <= 0) return blank(0, 0, 0, 0, S);
    const w = Math.ceil(f.w * S), h = Math.ceil(f.h * S);
    if (w > MAX_SIDE || h > MAX_SIDE) return blank(0, 0, 0, 0, S);
    const b = blank(f.x0, f.y0, w, h, S);
    drawInto(b, paths, o, settings(o));
    return b;
  } catch {
    return blank(0, 0, 0, 0, S);
  }
}

/** A copy of the bitmap with every ink pixel grown into a square of side 2r + 1. */
export function dilate(bitmap, r) {
  const b = asObj(bitmap);
  if (!(b.data instanceof Uint8Array) || !Number.isInteger(b.w) || !Number.isInteger(b.h) || b.data.length !== b.w * b.h) {
    return blank(0, 0, 0, 0, CHECK_DEFAULTS.pxPerPt);
  }
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

// ── Placement proposals by pairing lines ──────────────────────────────────

/** x' = a·x + c·y, y' = b·x + d·y. 0-3 turn by 0, 90, 180, 270 degrees; 4-7 the same after mirroring x. */
export const ORIENTATIONS = Object.freeze([1, -1].flatMap(m => [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([c, s]) => Object.freeze([c * m, s * m, -s, c]))));

const MAX_SYMBOL_COORD = 1e4;   // points; an A0 sheet is under 3,400
const MAX_SYMBOL_SEGS = 4000;   // the largest symbol on a real legend has a few hundred
const tagCodes = tagId => str(tagId).toUpperCase().split(/[\s,/;]+/).filter(Boolean);

function prepareOne(symbol, cfg) {
  const out = { symbol, checkable: false, why: '', segs: [], keys: [], loops: [], points: [], plain: false };
  const s = asObj(symbol), flags = asObj(s.flags);
  let pieces = 0;   // straight pieces, consecutive collinear segments of one path joined
  let prev = null;
  let total = 0, x1 = -Infinity, y1 = -Infinity, x0 = Infinity, y0 = Infinity;
  // The library comes from a shared folder. A coordinate far off any sheet,
  // or a symbol of thousands of segments, is not walked: the symbol is set
  // aside as unusable before any work proportional to its size is done.
  let wild = false;
  for (const p of asArr(s.paths)) {
    if (wild) break;
    if (!p || typeof p !== 'object' || !Array.isArray(p.segs)) continue;
    let n = 0;
    prev = null;
    for (let i = 0; i + 3 < p.segs.length; i += 4) {
      const q = p.segs.slice(i, i + 4);
      if (!q.every(isNum)) continue;
      if (out.segs.length >= MAX_SYMBOL_SEGS || q.some(v => Math.abs(v) > MAX_SYMBOL_COORD)) { wild = true; break; }
      const len = Math.hypot(q[2] - q[0], q[3] - q[1]);
      if (len <= 0.05) continue;
      const joins = prev && Math.hypot(q[0] - prev[2], q[1] - prev[3]) < 0.05
        && Math.abs((prev[2] - prev[0]) * (q[3] - q[1]) - (prev[3] - prev[1]) * (q[2] - q[0])) <= 0.02 * prev[4] * len
        && (prev[2] - prev[0]) * (q[2] - q[0]) + (prev[3] - prev[1]) * (q[3] - q[1]) > 0;
      if (!joins) pieces++;
      prev = [q[0], q[1], q[2], q[3], len];
      out.segs.push([q[0], q[1], q[2], q[3], len]);
      total += len; n++;
      x0 = Math.min(x0, q[0], q[2]); x1 = Math.max(x1, q[0], q[2]); y0 = Math.min(y0, q[1], q[3]); y1 = Math.max(y1, q[1], q[3]);
    }
    const last = p.segs.length - 2;
    if (p.filled !== true && n >= 3 && n * 4 === p.segs.length
      && Math.abs(p.segs[0] - p.segs[last]) < 0.05 && Math.abs(p.segs[1] - p.segs[last + 1]) < 0.05) out.loops.push(p);
  }
  out.keys = out.segs.slice().sort((a, b) => b[4] - a[4]).slice(0, cfg.keyLines).filter(k => k[4] >= cfg.minKeyLine);
  out.w = isNum(s.w) && s.w > 0 ? s.w : (x1 >= x0 ? x1 - x0 : 0);
  out.h = isNum(s.h) && s.h > 0 ? s.h : (y1 >= y0 ? y1 - y0 : 0);
  // A tag bubble is placed on the outline round a tag's text, not by pairing
  // lines, so it is checked however plain it is. Its ring is the outline the
  // tag sits in; without one stored, the whole symbol.
  out.bubble = flags.bubble === true;
  const r = s.ring;
  out.ring = Array.isArray(r) && r.length === 4 && r.every(isNum) && r[2] > r[0] && r[3] > r[1] ? r.slice() : [0, 0, out.w, out.h];
  if (flags.manual === true) out.why = 'manual';
  else if (!out.segs.length) out.why = 'no-linework';
  else if (flags.stretch === true) out.why = 'stretch';
  else if (!out.bubble && (flags.simple === true || out.segs.length < cfg.simpleSegs || total < cfg.simpleLength || !out.keys.length)) out.why = 'simple';
  else if (wild || Math.max(out.w, out.h) > cfg.maxSize || Math.min(out.w, out.h) < cfg.minSize) out.why = 'size';
  out.checkable = !out.why;
  // A plain symbol (a box, an arrow) matches plain drawing linework, so a sweep
  // hit of one is held to a stricter test. Checkable ones only: "simple" comes first.
  out.plain = out.checkable && !out.bubble
    && (pieces <= 3 || out.segs.every(g => Math.min(Math.abs(g[2] - g[0]), Math.abs(g[3] - g[1])) <= 0.02 * g[4]));
  // Points about a point apart, for the quick look. Only for a symbol that
  // will be matched, whose segments are by now known to be few and short.
  if (out.checkable) {
    for (const g of out.segs) {
      const n = Math.max(1, Math.min(400, Math.round(g[4])));
      for (let i = 0; i <= n; i++) out.points.push(g[0] + (g[2] - g[0]) * i / n, g[1] + (g[3] - g[1]) * i / n);
    }
  }
  out.codes = tagCodes(s.tagId);
  return out;
}

/**
 * One entry per library symbol: whether it can be checked on a drawing, why
 * not when it cannot, and the geometry the matcher works from. The library is
 * not written to. A fresh library has no "simple" flags, so shapes too plain
 * to judge are also excluded by rule.
 */
export function prepareSymbols(library, options) {
  try {
    const cfg = settings(options);
    return asArr(asObj(library).symbols).map(s => {
      try { return prepareOne(s, cfg); } catch { return { symbol: s, checkable: false, why: 'no-linework', segs: [], keys: [], loops: [], points: [], w: 0, h: 0, codes: [], bubble: false, plain: false, ring: [0, 0, 0, 0] }; }
    });
  } catch {
    return [];
  }
}

/** The drawing's ink segments long enough to pair with a symbol's key line: [x0, y0, x1, y1, length]. */
export function drawingSegments(paths, options) {
  const cfg = settings(options), out = [], min = 0.75 * cfg.minKeyLine;
  for (const p of asArr(paths)) {
    if (!p || typeof p !== 'object' || !Array.isArray(p.segs)) continue;
    if ((isNum(p.grey) ? p.grey : 0) >= cfg.inkGrey) continue;
    for (let i = 0; i + 3 < p.segs.length; i += 4) {
      const a = p.segs[i], b = p.segs[i + 1], c = p.segs[i + 2], d = p.segs[i + 3];
      if (!(isNum(a) && isNum(b) && isNum(c) && isNum(d))) continue;
      const len = Math.hypot(c - a, d - b);
      if (len >= min) out.push([a, b, c, d, len]);
    }
  }
  return out;
}

const isPlacement = p => !!p && typeof p === 'object' && Number.isInteger(p.o) && p.o >= 0 && p.o < 8 && isNum(p.k) && p.k > 0 && isNum(p.tx) && isNum(p.ty);

/** Where a placement puts a symbol's point. */
export function placePoint(placement, x, y) {
  if (!isPlacement(placement)) return [NaN, NaN];
  const [a, b, c, d] = ORIENTATIONS[placement.o];
  return [placement.k * (a * x + c * y) + placement.tx, placement.k * (b * x + d * y) + placement.ty];
}

/**
 * Propose where a symbol might sit near a centre, by laying each of its
 * longest lines on each drawing line of a compatible length and direction.
 * One pairing fixes position, one of eight orientations and the size.
 */
export function proposePlacements(prepared, segments, centre, options) {
  const out = [];
  try {
    const cfg = settings(options), p = asObj(prepared), c = asArr(centre);
    if (p.checkable !== true || !isNum(c[0]) || !isNum(c[1])) return out;
    const seen = new Set(), reach = cfg.radius + 40;
    for (const key of asArr(p.keys)) {
      const kx = key[2] - key[0], ky = key[3] - key[1], mx = (key[0] + key[2]) / 2, my = (key[1] + key[3]) / 2;
      for (const g of asArr(segments)) {
        if (!Array.isArray(g) || !g.slice(0, 5).every(isNum)) continue;
        const k = g[4] / key[4];
        if (k < cfg.minScale || k > cfg.maxScale) continue;
        const gx = (g[0] + g[2]) / 2, gy = (g[1] + g[3]) / 2;
        if (Math.hypot(gx - c[0], gy - c[1]) > reach) continue;
        for (let o = 0; o < 8; o++) {
          const [a, b, cc, d] = ORIENTATIONS[o];
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
  } catch { /* nothing proposed */ }
  return out;
}

// ── The two-way ink score ─────────────────────────────────────────────────

function boxesOf(paths) {
  const out = [];
  for (const p of asArr(paths)) {
    if (!p || typeof p !== 'object' || !Array.isArray(p.segs)) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i + 1 < p.segs.length; i += 2) {
      const x = p.segs[i], y = p.segs[i + 1];
      if (!isNum(x) || !isNum(y)) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 >= x0) out.push({ p, b: [x0, y0, x1, y1] });
  }
  return out;
}

function windowFrom(boxed, centre, cfg) {
  const S = cfg.pxPerPt, half = cfg.radius + 70, side = Math.ceil(2 * half * S);
  const x0 = centre[0] - half, y0 = centre[1] - half;
  const ink = blank(x0, y0, side, side, S);
  const local = boxed.filter(q => q.b[2] >= x0 && q.b[0] <= x0 + 2 * half && q.b[3] >= y0 && q.b[1] <= y0 + 2 * half).map(q => q.p);
  drawInto(ink, local, {}, cfg);
  return { ink, near: dilate(ink, Math.round(cfg.inkTol * S)) };
}

/** The drawing around a centre as a bitmap, and the same grown by the ink tolerance. */
export function drawingWindow(paths, centre, options) {
  const cfg = settings(options);
  try {
    const c = asArr(centre);
    if (!isNum(c[0]) || !isNum(c[1]) || Math.ceil(2 * (cfg.radius + 70) * cfg.pxPerPt) > MAX_SIDE) throw new Error('no window');
    return windowFrom(boxesOf(paths), c, cfg);
  } catch {
    const none = blank(0, 0, 0, 0, cfg.pxPerPt);
    return { ink: none, near: none };
  }
}

/**
 * Score one placement two ways: how much of the symbol's ink is on the
 * drawing (forward), and how much of the drawing's ink inside the symbol's
 * box the symbol explains (backward). The score is the lower of the two.
 *
 * A normally closed valve is the open symbol filled in, and the legend shows
 * only the open one. So a closed loop of the symbol is filled in the template
 * when its inside is solid ink on the drawing. Without that, a filled valve
 * can read as a different symbol altogether: a wrong answer, not a miss.
 */
export function scorePlacement(prepared, placement, window, options) {
  try {
    const cfg = settings(options), p = asObj(prepared), win = asObj(window);
    const D = asObj(win.ink), N = asObj(win.near);
    if (p.checkable !== true || !isPlacement(placement) || !(D.data instanceof Uint8Array) || !(N.data instanceof Uint8Array) || !D.w || !D.h) return null;
    const S = D.pxPerPt, W = D.w, H = D.h;
    const tf = (x, y) => placePoint(placement, x, y);

    // 1. Quick look: a sample of the symbol's points must land on drawing ink.
    const pts = p.points, step = 2 * Math.max(1, Math.floor(pts.length / 2 / 30));
    let on = 0, n = 0;
    for (let i = 0; i + 1 < pts.length; i += step) {
      const q = tf(pts[i], pts[i + 1]);
      const X = Math.floor((q[0] - D.x0) * S), Y = Math.floor((q[1] - D.y0) * S);
      n++;
      if (X >= 0 && Y >= 0 && X < W && Y < H && N.data[Y * W + X]) on++;
    }
    if (!n || on < cfg.quickLook * n) return null;

    // 2. Frame: the placed symbol's box plus a point, snapped to the window's pixels.
    const c0 = tf(0, 0), c1 = tf(p.w, p.h);
    const bx0 = Math.min(c0[0], c1[0]), by0 = Math.min(c0[1], c1[1]), bw = Math.abs(c1[0] - c0[0]), bh = Math.abs(c1[1] - c0[1]);
    const ox = Math.round((bx0 - 1 - D.x0) * S), oy = Math.round((by0 - 1 - D.y0) * S);
    const tw = Math.ceil((bw + 2) * S), th = Math.ceil((bh + 2) * S);
    if (ox < 0 || oy < 0 || ox + tw > W || oy + th > H) return null;
    const fx = D.x0 + ox / S, fy = D.y0 + oy / S;

    // 3. Loops whose inside is solid ink on the drawing are filled in the template.
    let fillLoops = null;
    if (cfg.twin && p.loops.length) {
      const bare = blank(fx, fy, tw, th, S);
      drawInto(bare, p.symbol.paths, { transform: tf, scale: placement.k }, cfg);
      for (const lp of p.loops) {
        const probe = blank(fx, fy, tw, th, S), px = [];
        for (let i = 0; i + 1 < lp.segs.length; i += 2) { const q = tf(lp.segs[i], lp.segs[i + 1]); px.push((q[0] - fx) * S, (q[1] - fy) * S); }
        fillPoly(probe, px, 1);
        let inside = 0, solid = 0;
        for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
          const i = y * tw + x;
          if (probe.data[i] && !bare.data[i]) { inside++; if (D.data[(y + oy) * W + x + ox]) solid++; }
        }
        if (inside > 20 && solid >= cfg.fillInside * inside) (fillLoops = fillLoops || new Set()).add(lp);
      }
    }

    // 4. Template, and the same grown by the ink tolerance.
    const T = blank(fx, fy, tw, th, S);
    drawInto(T, p.symbol.paths, { transform: tf, scale: placement.k, fillLoops }, cfg);
    const Tn = dilate(T, Math.round(cfg.inkTol * S));

    // 5. Score.
    let tInk = 0, tHit = 0, dInk = 0, dHit = 0;
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const ti = y * tw + x, di = (y + oy) * W + x + ox;
      if (T.data[ti]) { tInk++; if (N.data[di]) tHit++; }
      if (D.data[di]) { dInk++; if (Tn.data[ti]) dHit++; }
    }
    if (!tInk || !dInk) return null;
    const forward = tHit / tInk, backward = dHit / dInk;
    return { score: Math.min(forward, backward), forward, backward, filled: !!fillLoops, box: [bx0, by0, bx0 + bw, by0 + bh] };
  } catch {
    return null;
  }
}

// ── Families ──────────────────────────────────────────────────────────────

const NO_POSITION = 'Tag position not found on this page.';
const NEAR_MISS_LOOK = 0.3;    // share of sampled points on ink before a poor match is scored at all
const NEAR_MISS_FLOOR = 0.3;   // below this a "closest symbol" means nothing and is not reported
const OUTLINE_MARGIN = 3;     // points a tag's text may stand out of the outline it is written in
const ASPECT_TOL = 0.1;       // how far a bubble's width-to-height may differ from the outline's
const NO_BUBBLES = 'The library has no tag bubbles. Import the legend again to add them.';
const OUT_OF_TIME ='The check reached its time limit before this tag.';
const clock = () => (typeof performance === 'object' && performance && typeof performance.now === 'function' ? performance.now() : Date.now());

/**
 * Which symbols a function code expects, or why the code is not checked. The
 * answer comes only from the library's own tag identifiers: no reference
 * table lives here.
 */
export function expectedFamily(fc, library, lookups, prepared) {
  try {
    const code = str(fc).toUpperCase();
    const lib = asObj(library);
    const all = Array.isArray(prepared) ? prepared : prepareSymbols(lib);
    const carrying = code ? all.filter(p => p && asArr(p.codes).includes(code)) : [];
    if (!carrying.length) {
      const fcs = asObj(lookups).fc;
      const instrument = own(fcs, code) && fcs[code] === 'instrument';
      if (!instrument) return { mode: 'skip', symbols: [], why: 'No symbol in the library carries the tag identifier ' + code + '.' };
      // An instrument is drawn as a tag bubble round its tag.
      return all.some(p => p && p.bubble && p.checkable) ? { mode: 'bubble', symbols: [], why: '' } : { mode: 'skip', symbols: [], why: NO_BUBBLES };
    }
    const fam = own(lib.families, code) ? asObj(lib.families[code]) : null;
    if (fam && fam.mode === 'skip') {
      return { mode: 'skip', symbols: [], why: 'Family marked as not checked: ' + (str(fam.why).trim() || 'no reason given') + '.' };
    }
    const symbols = carrying.filter(p => p.checkable);
    // Tanks, conveyors and the like are drawn to suit: their size and shape
    // follow the scheme, so a tag of such a family would read "Needs a look"
    // on every sheet and teach the user to ignore that verdict. Such a family
    // shows itself in the legend: most of its symbols are too large, or too
    // varied, to be matched. The library can overrule this for a family with
    // families[code].mode = 'check'.
    const judged = carrying.filter(p => p.why !== 'manual' && p.why !== 'no-linework');
    if (symbols.length && !(fam && fam.mode === 'check') && symbols.length * 2 < judged.length) {
      return { mode: 'skip', symbols: [], why: 'Drawn to suit: most symbols in this family are too large or too varied to judge.' };
    }
    if (!symbols.length) return { mode: 'skip', symbols: [], why: 'Every symbol in this family is drawn to suit, too simple to judge, or has no linework.' };
    return { mode: 'check', symbols, why: '' };
  } catch {
    return { mode: 'skip', symbols: [], why: 'This family could not be read from the library.' };
  }
}

// ── Tag bubbles ───────────────────────────────────────────────────────────

function outlineFrom(boxed, tagBox, maxOutline, cfg) {
  const t = tagBox, cx = (t[0] + t[2]) / 2, cy = (t[1] + t[3]) / 2, m = OUTLINE_MARGIN;
  let best = null, bestArea = Infinity;
  for (const q of boxed) {
    const b = q.b, w = b[2] - b[0], h = b[3] - b[1];
    if (w > maxOutline || h > maxOutline || w <= 0 || h <= 0) continue;
    if (!(cx > b[0] && cx < b[2] && cy > b[1] && cy < b[3])) continue;
    if (t[0] < b[0] - m || t[1] < b[1] - m || t[2] > b[2] + m || t[3] > b[3] + m) continue;
    if ((isNum(q.p.grey) ? q.p.grey : 0) >= cfg.inkGrey || !isClosedPath(q.p)) continue;
    if (w * h < bestArea) { best = b; bestArea = w * h; }
  }
  return best ? best.slice() : null;
}

/**
 * The outline a tag is written inside: the smallest single closed path whose
 * box holds the tag's text (standing out by at most 3 pt) and is no larger
 * than options.maxOutline on either side, so a sheet frame never counts.
 */
export function findOutline(paths, tagBox, options) {
  try {
    const t = asArr(tagBox), o = asObj(options);
    if (t.length < 4 || !t.slice(0, 4).every(isNum) || !isNum(o.maxOutline) || o.maxOutline <= 0) return null;
    return outlineFrom(boxesOf(paths), t, o.maxOutline, settings(options));
  } catch {
    return null;
  }
}

/**
 * Lay each bubble's ring on an outline and score it two ways. A bubble whose
 * width-to-height does not fit the outline's is not tried: a ring is not a
 * hexagon at any size. Returns the best match at or above `recognise`, the
 * names of kinds too close to it to tell apart, and otherwise the closest.
 */
export function matchBubble(bubbles, outline, window, options) {
  const none = { best: null, oneOf: [], closest: null };
  try {
    const cfg = settings(options), o = asArr(outline);
    if (o.length < 4 || !o.slice(0, 4).every(isNum)) return none;
    const ow = o[2] - o[0], oh = o[3] - o[1], ocx = (o[0] + o[2]) / 2, ocy = (o[1] + o[3]) / 2;
    const scored = [];
    let near = null;
    for (const p of asArr(bubbles)) {
      if (!p || p.checkable !== true || p.bubble !== true) continue;
      const r = p.ring, rw = r[2] - r[0], rh = r[3] - r[1];
      if (!(rw > 0 && rh > 0 && ow > 0 && oh > 0)) continue;
      const kw = ow / rw, kh = oh / rh;
      if (Math.abs(kw - kh) / kh > ASPECT_TOL) continue;
      const k = (kw + kh) / 2;
      if (k < cfg.minScale || k > cfg.maxScale) continue;
      const tx = ocx - k * (r[0] + r[2]) / 2, ty = ocy - k * (r[1] + r[3]) / 2;
      const pl = { o: 0, k, tx, ty, cx: tx + k * p.w / 2, cy: ty + k * p.h / 2 };
      const s = scorePlacement(p, pl, window, cfg);
      if (s && s.score >= cfg.recognise) scored.push({ p, score: s.score, k, box: s.box, placement: pl });
      else {
        const loose = s || scorePlacement(p, pl, window, { ...cfg, quickLook: NEAR_MISS_LOOK });
        if (loose && (!near || loose.score > near.score)) near = { symbol: nameOf(p), score: round3(loose.score) };
      }
    }
    if (!scored.length) return { ...none, closest: near && near.score >= NEAR_MISS_FLOOR ? near : null };
    scored.sort((a, b) => b.score - a.score);
    const close = scored.filter(m => m.score >= scored[0].score - cfg.oneOf);
    return { best: scored[0], oneOf: close.length > 1 ? close.map(m => nameOf(m.p)) : [], closest: null };
  } catch {
    return none;
  }
}

// ── One symbol per patch of ink ───────────────────────────────────────────
// A hit is one library symbol laid at one placement and scored there:
// { p, placement, score, k, box, filled, bubble, ring, tag }. Several hits can
// claim the same ink: the same symbol found from two centres, mirror twins,
// two members of a family drawn alike, or a small symbol that is a part of a
// larger one. Shared ink, not overlapping boxes, decides which hits are one
// physical symbol, so a valve drawn inside a bubble's box stays separate.

const isHit = h => !!h && typeof h === 'object' && !!h.p && typeof h.p === 'object'
  && isPlacement(h.placement) && isNum(h.score) && isNum(h.p.w) && isNum(h.p.h);
const hasTag = h => typeof h.tag === 'string' && !!h.tag;
const segCount = h => asArr(h.p.segs).length;

function placedBox(h) {
  const c0 = placePoint(h.placement, 0, 0), c1 = placePoint(h.placement, h.p.w, h.p.h);
  return [Math.min(c0[0], c1[0]), Math.min(c0[1], c1[1]), Math.max(c0[0], c1[0]), Math.max(c0[1], c1[1])];
}

// The hit's symbol drawn where the hit lays it, grown by the ink tolerance.
function hitTemplate(h, cfg) {
  const S = cfg.pxPerPt, m = cfg.inkTol + 2, b = placedBox(h);
  const w = Math.ceil((b[2] - b[0] + 2 * m) * S), ht = Math.ceil((b[3] - b[1] + 2 * m) * S);
  if (!(w > 0 && ht > 0) || w > MAX_SIDE || ht > MAX_SIDE) return null;
  const T = blank(b[0] - m, b[1] - m, w, ht, S);
  drawInto(T, asArr(asObj(h.p.symbol).paths), { transform: (x, y) => placePoint(h.placement, x, y), scale: h.placement.k }, cfg);
  return dilate(T, Math.round(cfg.inkTol * S));
}

// The share of the hit's sample points (about a point apart) that land on a template.
function shareOn(h, T) {
  if (!T || !T.w) return 0;
  let pts = asArr(h.p.points);
  if (!pts.length) {
    pts = [];
    for (const g of asArr(h.p.segs)) {
      const n = Math.max(1, Math.min(400, Math.round(g[4])));
      for (let i = 0; i <= n; i++) pts.push(g[0] + (g[2] - g[0]) * i / n, g[1] + (g[3] - g[1]) * i / n);
    }
  }
  let on = 0, n = 0;
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const q = placePoint(h.placement, pts[i], pts[i + 1]);
    if (!isNum(q[0]) || !isNum(q[1])) continue;
    n++;
    const X = Math.floor((q[0] - T.x0) * T.pxPerPt), Y = Math.floor((q[1] - T.y0) * T.pxPerPt);
    if (X >= 0 && Y >= 0 && X < T.w && Y < T.h && T.data[Y * T.w + X]) on++;
  }
  return n ? on / n : 0;
}

const boxesTouch = (a, b, m) => a[0] <= b[2] + m && b[0] <= a[2] + m && a[1] <= b[3] + m && b[1] <= a[3] + m;

/** The share (0 to 1) of hit a's ink that lies on hit b's symbol, drawn where b lays it. Never throws. */
export function sharedInk(a, b, options) {
  try {
    const cfg = settings(options);
    if (!isHit(a) || !isHit(b) || !boxesTouch(placedBox(a), placedBox(b), cfg.inkTol + 1)) return 0;
    return shareOn(a, hitTemplate(b, cfg));
  } catch {
    return 0;
  }
}

/**
 * One spot per physical symbol: { matches, box, cx, cy, bubble, ring, tag }.
 * matches[0] is the winner; the rest are alternatives scoring within `oneOf`
 * of it. Hits are taken tagged first, then best score first:
 * - two hits each lying mostly on the other are alternatives: the better score
 *   wins, and at scores within `oneOf` the one with more linework;
 * - a hit lying mostly on another whose ink does not mostly lie on it is a
 *   part of that other one, and is dropped, never offered as "one of";
 * - a hit with a tag always wins its ink; two tagged hits are never merged.
 */
export function mergeHits(hits, options) {
  try {
    const cfg = settings(options), t = cfg.shareInk;
    const list = asArr(hits).filter(isHit);
    list.sort((a, b) => (hasTag(b) - hasTag(a)) || (b.score - a.score) || (segCount(b) - segCount(a)));
    const tpl = new Map(), boxes = new Map();
    const boxOf = h => { if (!boxes.has(h)) boxes.set(h, placedBox(h)); return boxes.get(h); };
    const share = (a, b) => {
      if (!boxesTouch(boxOf(a), boxOf(b), cfg.inkTol + 1)) return 0;
      if (!tpl.has(b)) tpl.set(b, hitTemplate(b, cfg));
      return shareOn(a, tpl.get(b));
    };
    let groups = [];   // { win, alts }
    for (const h of list) {
      let absorbed = false;
      const parts = [];
      for (const g of groups) {
        const w = g.win;
        if (hasTag(h) && hasTag(w)) continue;
        const fwd = share(h, w), back = share(w, h);
        if (fwd >= t && back >= t) {
          // The same library symbol again (another orientation of a symmetric shape) adds no alternative.
          if (h.p === w.p || g.alts.some(m => m.p === h.p)) { absorbed = true; break; }
          if (!hasTag(w) && (hasTag(h) || (w.score - h.score <= cfg.oneOf && segCount(h) > segCount(w)))) { g.alts.unshift(w); g.win = h; }
          else g.alts.push(h);
          absorbed = true; break;
        }
        if (fwd >= t) { absorbed = true; break; }        // h is a part of w
        if (back >= t) {                                   // w is a part of h
          if (hasTag(w)) { absorbed = true; break; }       // the tagged hit keeps its ink
          parts.push(g);
        }
      }
      if (absorbed) continue;
      if (parts.length) groups = groups.filter(g => !parts.includes(g));
      groups.push({ win: h, alts: [] });
    }
    return groups.map(({ win, alts }) => {
      const near = alts.filter(m => Math.abs(m.score - win.score) <= cfg.oneOf + 1e-9).sort((a, b) => b.score - a.score);
      const box = Array.isArray(win.box) && win.box.length === 4 && win.box.every(isNum) ? win.box.slice() : boxOf(win);
      const cx = isNum(win.placement.cx) ? win.placement.cx : (box[0] + box[2]) / 2;
      const cy = isNum(win.placement.cy) ? win.placement.cy : (box[1] + box[3]) / 2;
      return { matches: [win, ...near], box, cx, cy, bubble: win.bubble === true,
        ring: Array.isArray(win.ring) ? win.ring.slice() : null, tag: hasTag(win) ? win.tag : null };
    });
  } catch {
    return [];
  }
}

// ── The sweep ─────────────────────────────────────────────────────────────
// Every standard symbol on the page, whether or not a tag sits beside it:
// centres on a grid across the page, today's line pairing and two-way score
// at each, tag bubbles from their closed outlines, then one symbol per patch
// of ink. The title block is not swept, and what was skipped is returned so
// that it can be shown, not hidden.

const TITLE_LONG = 0.7;      // a title block's dividing line runs at least this share of the page
const TITLE_ZONE = 0.4;      // and lies in this share of the page at its right (or its bottom)
const TITLE_INSIDE = 20;     // points inside the outermost such line (the frame) it must be
const RUN_GAP = 2;           // points between pieces of one line drawn in parts

// Axis-aligned ink lines, pieces on one line joined: [{ at, a, b }].
function axisRuns(paths, vertical, cfg) {
  const byAt = new Map();
  for (const p of asArr(paths)) {
    if (!p || typeof p !== 'object' || !Array.isArray(p.segs)) continue;
    if ((isNum(p.grey) ? p.grey : 0) >= cfg.inkGrey) continue;
    for (let i = 0; i + 3 < p.segs.length; i += 4) {
      const [x0, y0, x1, y1] = p.segs.slice(i, i + 4);
      if (![x0, y0, x1, y1].every(isNum)) continue;
      const along = vertical ? Math.abs(y1 - y0) : Math.abs(x1 - x0), across = vertical ? Math.abs(x1 - x0) : Math.abs(y1 - y0);
      if (along < 1 || across > 0.5) continue;
      const at = Math.round((vertical ? (x0 + x1) : (y0 + y1)) / 2 * 2) / 2;
      const a = vertical ? Math.min(y0, y1) : Math.min(x0, x1), b = vertical ? Math.max(y0, y1) : Math.max(x0, x1);
      if (!byAt.has(at)) byAt.set(at, []);
      byAt.get(at).push([a, b]);
    }
  }
  const runs = [];
  for (const [at, list] of byAt) {
    list.sort((u, v) => u[0] - v[0]);
    let cur = null;
    for (const [a, b] of list) {
      if (cur && a <= cur.b + RUN_GAP) cur.b = Math.max(cur.b, b);
      else { if (cur) runs.push(cur); cur = { at, a, b }; }
    }
    if (cur) runs.push(cur);
  }
  return runs;
}

/**
 * Where the title block is, in the page's own (viewport) points: the strip
 * cut off by a line running most of the page's height in its right part, or
 * failing that most of its width along the bottom, at least 20 pt inside the
 * frame. Null when no such line is found. A starting rule, to be judged on
 * real sheets; the box is shown on screen so that a wrong guess is seen.
 */
export function titleBlockBox(paths, pageSize) {
  try {
    const s = asArr(pageSize), W = s[0], H = s[1];
    if (!isNum(W) || !isNum(H) || W <= 0 || H <= 0) return null;
    const cfg = settings();
    const pick = (vertical, size, other) => {
      const long = axisRuns(paths, vertical, cfg).filter(r => r.b - r.a >= TITLE_LONG * other && r.at >= (1 - TITLE_ZONE) * size && r.at <= size);
      if (!long.length) return null;
      const outer = Math.max(...long.map(r => r.at));
      const inner = long.filter(r => r.at <= outer - TITLE_INSIDE);
      return inner.length ? Math.max(...inner.map(r => r.at)) : null;
    };
    const x = pick(true, W, H);
    if (x !== null) return [x, 0, W, H];
    const y = pick(false, H, W);
    return y !== null ? [0, y, W, H] : null;
  } catch {
    return null;
  }
}

const inBox = (b, x, y) => !!b && x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];

/** A checkable, non-bubble symbol drawn only with axis-aligned lines, or with at most 3 straight pieces. Never throws. */
export function plainShape(prepared) {
  try { const p = asObj(prepared); return p.checkable === true && p.bubble !== true && p.plain === true; } catch { return false; }
}

// The boxes of writing on a sheet: its text words and any letter-like ink the
// caller found. A box that is not four finite numbers is ignored. Never throws.
function writingBoxes(words, extra) {
  const out = [];
  try {
    for (const w of asArr(words)) { const o = asObj(w); if ([o.x, o.y, o.w, o.h].every(isNum)) out.push([o.x, o.y, o.x + o.w, o.y + o.h]); }
    for (const b of asArr(extra)) if (Array.isArray(b) && b.length === 4 && b.every(isNum)) out.push(b);
  } catch { /* what was read stands */ }
  return out;
}
const hasWriting = (writing, box) => asArr(writing).some(b => inBox(box, (b[0] + b[2]) / 2, (b[1] + b[3]) / 2));

export const LINE_MIN = 0.85;        // every line of a symbol must have this share of its points on the drawing
const LINE_LONG = 3;                 // points: a placed line shorter than this is not held to it
const LINE_DENSITY = 2;              // sample points per point of line

/**
 * The lowest share, over every line of the placed symbol at least 3 pt long, of
 * its sample points (about two per point) that lie on the window's dilated ink.
 * A symbol with a line missing or short on the drawing (hatching, lagged pipe)
 * scores low however well the rest matches. 1 when no line is long enough.
 * hit = { p, placement }. Never throws (a hostile hit gives 0).
 */
export function weakestLine(hit, window, options) {
  try {
    settings(options);
    const h = asObj(hit), p = asObj(h.p), N = asObj(asObj(window).near);
    if (!isPlacement(h.placement) || !(N.data instanceof Uint8Array) || !isNum(N.pxPerPt) || !(N.pxPerPt > 0)) return 0;
    const S = N.pxPerPt;
    let worst = 1;
    for (const g of asArr(p.segs).slice(0, MAX_SYMBOL_SEGS)) {
      if (!Array.isArray(g) || !g.slice(0, 4).every(isNum)) continue;
      const a = placePoint(h.placement, g[0], g[1]), b = placePoint(h.placement, g[2], g[3]);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!(len >= LINE_LONG)) continue;
      const n = Math.max(2, Math.ceil(len * LINE_DENSITY));
      let on = 0;
      for (let i = 0; i <= n; i++) {
        const X = Math.floor((a[0] + (b[0] - a[0]) * i / n - N.x0) * S), Y = Math.floor((a[1] + (b[1] - a[1]) * i / n - N.y0) * S);
        if (X >= 0 && Y >= 0 && X < N.w && Y < N.h && N.data[Y * N.w + X] !== 0) on++;
      }
      worst = Math.min(worst, on / (n + 1));
    }
    return worst;
  } catch {
    return 0;
  }
}

const CORNER_JOIN = 0.5;             // points: two segment ends this close are one corner
const CORNER_ANGLE = 0.5;            // sin 30 degrees: segments meeting at more than this make a corner
const RUN_PROBES = [1.5, 2.5, 3.5];  // points past a corner, along the edge
const RUN_NEEDED = 2;                // of the probes that must be ink

/**
 * Whether a placed symbol's edge runs on past one of its corners on the drawing:
 * the mark of a box that is really a panel or table cell. A corner is where one
 * segment's end meets another segment's end at more than 30 degrees to it. The
 * ink is the window's undilated bitmap. hit = { p, placement }. Never throws.
 */
export function runsOnPastCorner(hit, ink, options) {
  try {
    settings(options);
    const h = asObj(hit), p = asObj(h.p), D = asObj(ink);
    if (!(D.data instanceof Uint8Array) || !isNum(D.pxPerPt) || !(D.pxPerPt > 0) || !isPlacement(h.placement)) return false;
    const segs = asArr(p.segs);
    if (!segs.length || segs.length > 400) return false;
    const g = [];
    for (const s of segs) {
      if (!Array.isArray(s) || !s.slice(0, 4).every(isNum)) continue;
      const a = placePoint(h.placement, s[0], s[1]), b = placePoint(h.placement, s[2], s[3]);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len > 0.05) g.push({ a, b, len });
    }
    const S = D.pxPerPt, W = D.w, H = D.h;
    const isInk = (x, y) => {
      const X = Math.floor((x - D.x0) * S), Y = Math.floor((y - D.y0) * S);
      return X >= 0 && Y >= 0 && X < W && Y < H && D.data[Y * W + X] !== 0;
    };
    for (let i = 0; i < g.length; i++) {
      for (let j = 0; j < g.length; j++) {
        if (i === j) continue;
        const A = g[i], B = g[j];
        const ux = (A.b[0] - A.a[0]) / A.len, uy = (A.b[1] - A.a[1]) / A.len, vx = (B.b[0] - B.a[0]) / B.len, vy = (B.b[1] - B.a[1]) / B.len;
        if (Math.abs(ux * vy - uy * vx) <= CORNER_ANGLE) continue;
        // Each end of A that meets an end of B is a corner, and A runs on from it.
        for (const [e, dir] of [[A.b, 1], [A.a, -1]]) {
          if (Math.hypot(e[0] - B.a[0], e[1] - B.a[1]) > CORNER_JOIN && Math.hypot(e[0] - B.b[0], e[1] - B.b[1]) > CORNER_JOIN) continue;
          let on = 0;
          for (const t of RUN_PROBES) if (isInk(e[0] + dir * ux * t, e[1] + dir * uy * t)) on++;
          if (on >= RUN_NEEDED) return true;
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

// The sweep proper, sharing the caller's prepared symbols, boxed paths and
// segments: { cfg, prepared, paths, boxed, segments, pageSize, onProgress, deadline }.
function sweep(ctx) {
  const { cfg, prepared, boxed, segments } = ctx;
  const progress = typeof ctx.onProgress === 'function' ? ctx.onProgress : null;
  const deadline = isNum(ctx.deadline) ? ctx.deadline : Infinity;
  const ps = asArr(ctx.pageSize);
  let W = ps[0], H = ps[1];
  if (!isNum(W) || !isNum(H) || W <= 0 || H <= 0) {
    W = 0; H = 0;
    for (const q of boxed) { W = Math.max(W, q.b[2]); H = Math.max(H, q.b[3]); }
  }
  // No page is larger than this; a bigger side is hostile input and is not swept.
  if (W > MAX_SWEEP_SIDE || H > MAX_SWEEP_SIDE) return { spots: [], skipped: null, timedOut: false, rows: 0, hits: 0 };
  const skipped = W > 0 && H > 0 ? titleBlockBox(ctx.paths, [W, H]) : null;
  const step = cfg.sweepStep, xs = [], ys = [];
  for (let x = step / 2; x < W; x += step) xs.push(x);
  for (let y = step / 2; y < H; y += step) ys.push(y);
  // The last centre may leave a strip at the far edge beyond the search radius.
  if (xs.length && W - xs[xs.length - 1] > step / 2) xs.push(W - step / 2);
  if (ys.length && H - ys[ys.length - 1] > step / 2) ys.push(H - step / 2);
  const out = { spots: [], skipped, timedOut: false, rows: ys.length, hits: 0 };
  const checkable = prepared.filter(p => p.checkable && !p.bubble);
  const bubbles = prepared.filter(p => p.checkable && p.bubble);
  if (!checkable.length && !bubbles.length) return out;
  const hits = [];
  const late = () => clock() > deadline;
  // Writing on the sheet, when the caller supplied it: written symbols need some.
  const writing = Array.isArray(ctx.writing) ? ctx.writing : null;

  // Tag bubbles, from every closed outline the size of a bubble's ring.
  if (bubbles.length) {
    let lo = Infinity, hi = 0;
    for (const p of bubbles) {
      const rw = p.ring[2] - p.ring[0], rh = p.ring[3] - p.ring[1];
      lo = Math.min(lo, Math.min(rw, rh) * cfg.minScale); hi = Math.max(hi, Math.max(rw, rh) * cfg.maxScale);
    }
    const seen = new Set();
    for (const q of boxed) {
      if (late()) { out.timedOut = true; break; }
      const b = q.b, w = b[2] - b[0], h = b[3] - b[1];
      if (Math.min(w, h) < lo || Math.max(w, h) > hi) continue;
      if ((isNum(q.p.grey) ? q.p.grey : 0) >= cfg.inkGrey || !isClosedPath(q.p)) continue;
      const c = centreOf(b);
      if (inBox(skipped, c[0], c[1])) continue;
      const id = b.map(v => Math.round(v * 4)).join(':');
      if (seen.has(id)) continue;
      seen.add(id);
      // A bubble is a place to write a tag: an outline with no writing in it is no bubble.
      const bare = writing !== null && !hasWriting(writing, b);
      if (bare && !ctx.raw) continue;
      const m = matchBubble(bubbles, b, windowFrom(boxed, c, cfg), cfg);
      if (m.best) {
        const hit = { p: m.best.p, placement: m.best.placement, score: m.best.score, k: m.best.k, box: m.best.box,
          filled: false, bubble: true, ring: b.slice(), tag: null };
        if (bare) hit.plainRejected = true;   // as a plain shape in a panel: only the leftover-tag pass may use it
        hits.push(hit);
      }
    }
  }

  // Everything else, from centres on a grid.
  const reach = cfg.radius + 40, tried = new Map(checkable.map(p => [p, new Set()]));
  for (let r = 0; r < ys.length && !out.timedOut; r++) {
    for (const x of xs) {
      if (late()) { out.timedOut = true; break; }
      const c = [x, ys[r]];
      if (inBox(skipped, c[0], c[1])) continue;
      const nearby = segments.filter(g => Math.hypot((g[0] + g[2]) / 2 - c[0], (g[1] + g[3]) / 2 - c[1]) <= reach);
      if (!nearby.length) continue;
      const win = windowFrom(boxed, c, cfg);
      for (const p of checkable) {
        if (late()) { out.timedOut = true; break; }
        const done = tried.get(p);
        for (const pl of proposePlacements(p, nearby, c, cfg)) {
          const id = pl.o + ':' + Math.round(pl.tx * 4) + ':' + Math.round(pl.ty * 4) + ':' + Math.round(pl.k * 50);
          if (done.has(id)) continue;
          const s = scorePlacement(p, pl, win, cfg);
          if (!s) continue;
          done.add(id);
          if (s.score < cfg.recognise || inBox(skipped, pl.cx, pl.cy)) continue;
          const hit = { p, placement: pl, score: s.score, k: pl.k, box: s.box, filled: s.filled, bubble: false, ring: null, tag: null };
          // A plain shape matches panel boxes and table cells: it must explain
          // nearly all the ink in its box, and no edge may run on past a corner.
          // checkSheet's leftover-tag pass may still use such a hit (as phase 1
          // did) so a tag's verdict cannot get worse; it is never listed alone.
          // A symbol that holds letters needs writing in its box; every line of a symbol
          // must be on the drawing (a hatched run is not a symbol).
          const unwritten = writing !== null && asArr(asObj(p.symbol).letters).length > 0 && !hasWriting(writing, s.box);
          if ((plainShape(p) && (s.backward < cfg.plainBack || runsOnPastCorner(hit, win.ink, cfg))) || unwritten || weakestLine(hit, win, cfg) < LINE_MIN) {
            if (ctx.raw) { hit.plainRejected = true; hits.push(hit); }
            continue;
          }
          hits.push(hit);
        }
      }
      if (out.timedOut) break;
    }
    if (!out.timedOut && progress) { try { progress(r + 1, ys.length, 'sweep'); } catch { /* the caller's problem */ } }
  }
  out.hits = hits.filter(h => !h.plainRejected).length;
  // checkSheet merges the raw hits with the tag-led pairings itself.
  if (ctx.raw) out.list = hits; else out.spots = mergeHits(hits, cfg);
  return out;
}

/**
 * Every standard symbol on a page, with no tags used:
 * { spots, skipped, timedOut, rows }. input = { paths, library, pageSize,
 * options, onProgress(row, rows, 'sweep'), deadline } where deadline is a
 * clock value (performance.now()); past it, what was found so far is merged
 * and returned with timedOut: true. Never throws.
 */
export function sweepSymbols(input) {
  try {
    const inp = asObj(input), cfg = settings(inp.options);
    return sweep({ cfg, prepared: prepareSymbols(inp.library, cfg), paths: inp.paths, boxed: boxesOf(inp.paths),
      segments: drawingSegments(inp.paths, cfg), pageSize: inp.pageSize, onProgress: inp.onProgress, deadline: inp.deadline,
      writing: Array.isArray(inp.writing) || Array.isArray(inp.textItems) ? writingBoxes(textWords(asArr(inp.textItems), isMatrix(inp.viewportTransform) ? inp.viewportTransform : IDENTITY), inp.writing) : null });
  } catch {
    return { spots: [], skipped: null, timedOut: false, rows: 0, hits: 0 };
  }
}

// ── The sheet's verdicts ──────────────────────────────────────────────────

const wordsOf = s => str(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean)
  .map(w => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w));
const nameOf = p => str(asObj(p.symbol).name);
const centreOf = box => [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
const round3 = x => Math.round(x * 1000) / 1000;

function emptyVerdict(tag, fc) {
  return { tag, fc, verdict: 'not-checked', why: '', symbol: '', oneOf: [], tagId: '', exceptions: [],
    sizePct: null, score: null, filled: false, letters: '', tagBox: null, box: null, closest: null, bubble: false };
}

// Approved exceptions whose name shares a word with a table heading of the
// family. The tool cannot tell whether a given item IS one of them.
function familyExceptions(library, prepared, code) {
  const headings = new Set();
  for (const p of prepared) if (p.codes.includes(code)) for (const w of wordsOf(asObj(p.symbol).group)) headings.add(w);
  return asArr(asObj(library).exceptions)
    .filter(e => e && typeof e === 'object' && e.status === 'approved' && typeof e.name === 'string' && e.name.trim())
    .filter(e => wordsOf(e.name).some(w => headings.has(w)))
    .map(e => e.name.trim());
}

function lettersRead(symbol, box, words) {
  const letters = asArr(asObj(symbol).letters).map(l => str(asObj(l).text).trim().toUpperCase()).filter(Boolean);
  if (!letters.length) return '';
  const inside = words.filter(w => { const cx = w.x + w.w / 2, cy = w.y + w.h / 2; return cx >= box[0] && cx <= box[2] && cy >= box[1] && cy <= box[3]; })
    .map(w => w.str.trim().toUpperCase());
  return letters.every(l => inside.includes(l)) ? 'read' : 'not judged';
}

/**
 * Check one page. For each tag: find it on the page, look within `radius` of
 * it for every symbol in the library that can be checked, and give a verdict.
 *
 * One physical symbol answers one tag. Recognised symbols are shared out
 * across the whole sheet, nearest tag first, so that a neighbouring valve
 * cannot make a missing or wrong symbol read as right.
 *
 * Returns plain data only, so the result can be posted from a worker.
 */
export function checkSheet(input) {
  const started = clock();
  try {
    const inp = asObj(input), cfg = settings(inp.options), lib = asObj(inp.library);
    if (!Array.isArray(lib.symbols) || !lib.symbols.length) return { ok: false, why: 'no-library' };
    const tags = asArr(inp.tags).filter(validTag);   // none at all: the sheet is still swept

    const prepared = prepareSymbols(lib, cfg);
    const checkable = prepared.filter(p => p.checkable && !p.bubble);   // bubbles are found by their outline, below
    const bubbles = prepared.filter(p => p.checkable && p.bubble);
    const boxed = boxesOf(inp.paths);
    const segments = drawingSegments(inp.paths, cfg);
    const placed = tagPlaces(inp.textItems, tags, inp.viewportTransform);
    const vt = isMatrix(inp.viewportTransform) ? inp.viewportTransform : IDENTITY;
    let words = [];
    try { words = textWords(asArr(inp.textItems), vt); } catch { words = []; }
    const progress = typeof inp.onProgress === 'function' ? inp.onProgress : null;

    const verdicts = tags.map(t => emptyVerdict(t.tag, t.fc));
    const families = tags.map(t => expectedFamily(t.fc, lib, inp.lookups, prepared));
    const done = tags.map(() => false);
    const late = tags.map(() => false);
    const spots = [];   // physical symbols: { cx, cy, best: Map(prepared -> match), top, claimed }
    const pairs = [];   // { ti, place, spot, dist }
    let proposals = 0;
    const reach = cfg.radius + 40;

    // Tag bubbles first: a tag written inside an outline is answered by the
    // bubble that outline is, whatever its code. The outline's spot is
    // claimed at once, so no family symbol found there can answer another tag.
    const bubbleClosest = tags.map(() => null);
    const maxOutline = bubbles.reduce((m, p) => Math.max(m, p.ring[2] - p.ring[0], p.ring[3] - p.ring[1]), 0) * cfg.maxScale;
    if (bubbles.length) {
      tags.forEach((t, ti) => {
        for (const place of asArr(asObj(placed[ti]).places)) {
          if (done[ti]) break;
          if (clock() - started > cfg.timeLimitMs) { late[ti] = true; break; }
          const outline = outlineFrom(boxed, place.box, maxOutline, cfg);
          if (!outline) continue;
          const m = matchBubble(bubbles, outline, windowFrom(boxed, centreOf(outline), cfg), cfg);
          if (!m.best) {
            if (m.closest && (!bubbleClosest[ti] || m.closest.score > bubbleClosest[ti].score)) bubbleClosest[ti] = m.closest;
            continue;
          }
          const v = verdicts[ti], b = m.best;
          v.symbol = nameOf(b.p); v.tagId = ''; v.sizePct = Math.round(b.k * 100); v.score = round3(b.score);
          v.box = b.box.map(round3); v.tagBox = place.box.map(round3); v.oneOf = m.oneOf; v.bubble = true;
          v.verdict = Math.abs(b.k - 1) > cfg.sizeBand ? 'off-size' : 'ok';
          const c = centreOf(outline);
          spots.push({ cx: c[0], cy: c[1], best: new Map(), top: 0, claimed: true, by: { ti, m: b, bubble: true, ring: outline } });
          done[ti] = true;
        }
      });
    }

    tags.forEach((t, ti) => {
      const places = asArr(asObj(placed[ti]).places);
      if (families[ti].mode === 'check' && !done[ti] && !late[ti]) {
        for (const place of places) {
          // Hostile or enormous input must not run for ever: past the limit,
          // the tags not yet reached are marked as such and the rest is reported.
          if (clock() - started > cfg.timeLimitMs) { late[ti] = true; break; }
          const c = centreOf(place.box);
          const win = windowFrom(boxed, c, cfg);
          const nearby = segments.filter(g => Math.hypot((g[0] + g[2]) / 2 - c[0], (g[1] + g[3]) / 2 - c[1]) <= reach);
          const mine = new Map();   // spot -> nearest distance from this place
          for (const p of checkable) {
            const props = proposePlacements(p, nearby, c, cfg);
            proposals += props.length;
            for (const pl of props) {
              const s = scorePlacement(p, pl, win, cfg);
              if (!s || s.score < cfg.recognise) continue;
              let spot = spots.find(q => Math.hypot(q.cx - pl.cx, q.cy - pl.cy) < cfg.sameSpot);
              if (!spot) { spot = { cx: pl.cx, cy: pl.cy, best: new Map(), top: 0, claimed: false }; spots.push(spot); }
              const had = spot.best.get(p);
              if (!had || s.score > had.score) spot.best.set(p, { p, score: s.score, k: pl.k, filled: s.filled, box: s.box, placement: pl });
              if (s.score > spot.top) spot.top = s.score;
              const dist = Math.hypot(pl.cx - c[0], pl.cy - c[1]);
              if (!mine.has(spot) || dist < mine.get(spot)) mine.set(spot, dist);
            }
          }
          for (const [spot, dist] of mine) pairs.push({ ti, place, spot, dist });
        }
      }
      if (progress) { try { progress(ti + 1, tags.length, 'tags'); } catch { /* the caller's problem */ } }
    });

    // Symbols at a spot scoring within `oneOf` of its best, best first.
    const leading = spot => [...spot.best.values()].filter(m => m.score >= spot.top - cfg.oneOf).sort((a, b) => b.score - a.score);
    const fill = (v, m, place) => {
      v.symbol = nameOf(m.p); v.tagId = str(asObj(m.p.symbol).tagId);
      v.sizePct = Math.round(m.k * 100); v.score = round3(m.score); v.filled = m.filled;
      v.box = m.box.map(round3); v.tagBox = place.box.map(round3);
    };
    pairs.sort((a, b) => a.dist - b.dist);

    // Pass 1: the nearest unclaimed symbol that fits the tag's own family.
    for (const pr of pairs) {
      if (done[pr.ti] || pr.spot.claimed) continue;
      const code = tags[pr.ti].fc.toUpperCase();
      const fits = leading(pr.spot).filter(m => m.p.codes.includes(code));
      if (!fits.length) continue;
      const v = verdicts[pr.ti];
      fill(v, fits[0], pr.place);
      v.verdict = Math.abs(fits[0].k - 1) > cfg.sizeBand ? 'off-size' : 'ok';
      v.oneOf = fits.length > 1 ? fits.map(m => nameOf(m.p)) : [];
      v.letters = lettersRead(fits[0].p.symbol, fits[0].box, words);
      pr.spot.claimed = true; done[pr.ti] = true;
      pr.spot.by = { ti: pr.ti, m: fits[0] };
    }
    // Pass 2: failing that, a recognised symbol that carries some other tag identifier.
    for (const pr of pairs) {
      if (done[pr.ti] || pr.spot.claimed || pr.dist > cfg.radius) continue;
      const tagged = leading(pr.spot).filter(m => m.p.codes.length);
      if (!tagged.length) continue;
      const v = verdicts[pr.ti];
      fill(v, tagged[0], pr.place);
      v.verdict = 'wrong-family';
      pr.spot.claimed = true; done[pr.ti] = true;   // one symbol answers one tag here too
      pr.spot.by = { ti: pr.ti, m: tagged[0] };
    }
    // For a tag left with nothing recognised: the symbol of its OWN family
    // that came closest, and how close. "Needs a look" at 86% and at 59% are
    // different findings, and the user cannot tell them apart without this.
    // Only these tags pay for it: the quick look is relaxed so that poor
    // matches are scored at all.
    const closestOf = (places, symbols) => {
      let best = null;
      for (const place of places) {
        if (clock() - started > cfg.timeLimitMs) break;
        const c = centreOf(place.box);
        const win = windowFrom(boxed, c, cfg);
        const nearby = segments.filter(g => Math.hypot((g[0] + g[2]) / 2 - c[0], (g[1] + g[3]) / 2 - c[1]) <= reach);
        for (const p of symbols) {
          for (const pl of proposePlacements(p, nearby, c, cfg)) {
            // A symbol that has already answered another tag is not this tag's near miss.
            if (spots.some(q => q.claimed && Math.hypot(q.cx - pl.cx, q.cy - pl.cy) < cfg.sameSpot)) continue;
            const s = scorePlacement(p, pl, win, { ...cfg, quickLook: NEAR_MISS_LOOK });
            if (s && (!best || s.score > best.score)) best = { symbol: nameOf(p), score: round3(s.score) };
          }
        }
      }
      return best && best.score >= NEAR_MISS_FLOOR ? best : null;
    };

    // The closest near miss for each tag still without a symbol, worked out
    // here, before the sweep, so that the sweep can never use up the time it
    // needs. Same answer as today: the sweep changes none of the spots it reads.
    const closestPre = tags.map((t, ti) => {
      const places = asArr(asObj(placed[ti]).places);
      return !done[ti] && !late[ti] && places.length && families[ti].mode === 'check' ? closestOf(places, families[ti].symbols) : null;
    });

    // The sweep: every standard symbol on the page. The tag-led pairings above
    // stand as they are; each claims the swept symbol that shares its ink.
    let symbols = [], skipped = null, sweptLate = false;
    if (asObj(inp.options).sweep !== false) {
      const sw = sweep({ cfg, prepared, paths: inp.paths, boxed, segments, pageSize: inp.pageSize,
        onProgress: progress, deadline: started + cfg.timeLimitMs, raw: true, writing: writingBoxes(words, inp.writing) });
      skipped = sw.skipped; sweptLate = sw.timedOut;
      const taggedHits = [];
      for (const spot of spots) {
        const by = spot.by;
        if (!by || !by.m || !isPlacement(by.m.placement)) continue;
        taggedHits.push({ p: by.m.p, placement: by.m.placement, score: by.m.score, k: by.m.k, box: by.m.box,
          filled: by.m.filled === true, bubble: by.bubble === true, ring: by.ring || null, tag: tags[by.ti].tag });
      }
      const swept = asArr(sw.list);
      const merged = mergeHits([...swept.filter(h => !h.plainRejected), ...taggedHits], cfg);
      // Plain-rejected hits (a box in a panel): only the leftover pass below may
      // use them, and only those standing apart from every listed symbol.
      const rejected = mergeHits(swept.filter(h => h.plainRejected), cfg)
        .filter(r => !merged.some(m => r.box[0] < m.box[2] && m.box[0] < r.box[2] && r.box[1] < m.box[3] && m.box[1] < r.box[3]));
      const candidates = [...merged, ...rejected];

      // Leftover tags: one still without a symbol takes the nearest untagged
      // swept symbol of its OWN family within reach. Only this pass runs for
      // them, so a tag's verdict can only improve.
      const lefts = [];
      tags.forEach((t, ti) => {
        if (done[ti] || late[ti] || families[ti].mode !== 'check') return;
        const code = t.fc.toUpperCase();
        for (const place of asArr(asObj(placed[ti]).places)) {
          const c = centreOf(place.box);
          for (const spot of candidates) {
            if (spot.tag !== null || !spot.matches.some(m => m.p.codes.includes(code))) continue;
            const dist = Math.hypot(spot.cx - c[0], spot.cy - c[1]);
            if (dist <= cfg.radius) lefts.push({ ti, place, spot, dist });
          }
        }
      });
      lefts.sort((a, b) => a.dist - b.dist);
      for (const lf of lefts) {
        if (done[lf.ti] || lf.spot.tag !== null) continue;
        const code = tags[lf.ti].fc.toUpperCase();
        const fits = lf.spot.matches.filter(m => m.p.codes.includes(code));
        const v = verdicts[lf.ti];
        fill(v, fits[0], lf.place);
        v.verdict = Math.abs(fits[0].k - 1) > cfg.sizeBand ? 'off-size' : 'ok';
        v.oneOf = fits.length > 1 ? fits.map(m => nameOf(m.p)) : [];
        v.letters = lettersRead(fits[0].p.symbol, fits[0].box, words);
        lf.spot.tag = tags[lf.ti].tag;
        lf.spot.matches = [fits[0], ...lf.spot.matches.filter(m => m !== fits[0])];
        done[lf.ti] = true;
      }

      symbols = candidates.filter(spot => spot.tag !== null || merged.includes(spot)).map(spot => {
        const w = spot.matches[0];
        return { name: nameOf(w.p), tagId: str(asObj(w.p.symbol).tagId), box: spot.box.map(round3), sizePct: Math.round(w.k * 100),
          score: round3(w.score), oneOf: spot.matches.length > 1 ? spot.matches.map(m => nameOf(m.p)) : [], bubble: spot.bubble, tag: spot.tag,
          plain: plainShape(w.p) };
      }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : (a.box[1] - b.box[1]) || (a.box[0] - b.box[0])));
    }

    // The rest.
    tags.forEach((t, ti) => {
      if (done[ti]) return;
      const v = verdicts[ti], places = asArr(asObj(placed[ti]).places);
      if (places.length) v.tagBox = places[0].box.map(round3);
      if (!places.length) { v.why = NO_POSITION; return; }
      if (late[ti]) { v.why = OUT_OF_TIME; return; }
      if (families[ti].mode === 'bubble') {
        v.verdict = 'look'; v.bubble = true; v.closest = bubbleClosest[ti];
        v.why = 'No standard tag bubble recognised round the tag.';
        return;
      }
      if (families[ti].mode !== 'check') { v.why = families[ti].why; return; }
      v.exceptions = familyExceptions(lib, prepared, t.fc.toUpperCase());
      v.verdict = v.exceptions.length ? 'exception' : 'look';
      v.closest = closestPre[ti];
    });

    const counts = Object.fromEntries(VERDICTS.map(k => [k, 0]));
    for (const v of verdicts) counts[v.verdict]++;
    const checked = verdicts.filter(v => v.verdict !== 'not-checked').length;
    return { ok: true, verdicts, counts, checked, recognised: counts.ok + counts['off-size'], proposals,
      timedOut: late.some(Boolean) || sweptLate, tagsTimedOut: late.some(Boolean), sweepTimedOut: sweptLate,
      ms: Math.round(clock() - started), symbols, skipped };
  } catch {
    return { ok: false, why: 'failed' };
  }
}
