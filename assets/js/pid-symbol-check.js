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

import { textWords } from './pid-symbols.js';

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
});

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
  const out = { symbol, checkable: false, why: '', segs: [], keys: [], loops: [], points: [] };
  const s = asObj(symbol), flags = asObj(s.flags);
  let total = 0, x1 = -Infinity, y1 = -Infinity, x0 = Infinity, y0 = Infinity;
  // The library comes from a shared folder. A coordinate far off any sheet,
  // or a symbol of thousands of segments, is not walked: the symbol is set
  // aside as unusable before any work proportional to its size is done.
  let wild = false;
  for (const p of asArr(s.paths)) {
    if (wild) break;
    if (!p || typeof p !== 'object' || !Array.isArray(p.segs)) continue;
    let n = 0;
    for (let i = 0; i + 3 < p.segs.length; i += 4) {
      const q = p.segs.slice(i, i + 4);
      if (!q.every(isNum)) continue;
      if (out.segs.length >= MAX_SYMBOL_SEGS || q.some(v => Math.abs(v) > MAX_SYMBOL_COORD)) { wild = true; break; }
      const len = Math.hypot(q[2] - q[0], q[3] - q[1]);
      if (len <= 0.05) continue;
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
  if (flags.manual === true) out.why = 'manual';
  else if (!out.segs.length) out.why = 'no-linework';
  else if (flags.stretch === true) out.why = 'stretch';
  else if (flags.simple === true || out.segs.length < cfg.simpleSegs || total < cfg.simpleLength || !out.keys.length) out.why = 'simple';
  else if (wild || Math.max(out.w, out.h) > cfg.maxSize || Math.min(out.w, out.h) < cfg.minSize) out.why = 'size';
  out.checkable = !out.why;
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
      try { return prepareOne(s, cfg); } catch { return { symbol: s, checkable: false, why: 'no-linework', segs: [], keys: [], loops: [], points: [], w: 0, h: 0, codes: [] }; }
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
      return { mode: 'skip', symbols: [], why: instrument ? 'Instrument bubbles are not checked yet.' : 'No symbol in the library carries the tag identifier ' + code + '.' };
    }
    const fam = own(lib.families, code) ? asObj(lib.families[code]) : null;
    if (fam && fam.mode === 'skip') {
      return { mode: 'skip', symbols: [], why: 'Family marked as not checked: ' + (str(fam.why).trim() || 'no reason given') + '.' };
    }
    const symbols = carrying.filter(p => p.checkable);
    if (!symbols.length) return { mode: 'skip', symbols: [], why: 'Every symbol in this family is drawn to suit, too simple to judge, or has no linework.' };
    return { mode: 'check', symbols, why: '' };
  } catch {
    return { mode: 'skip', symbols: [], why: 'This family could not be read from the library.' };
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
    sizePct: null, score: null, filled: false, letters: '', tagBox: null, box: null, closest: null };
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
    const tags = asArr(inp.tags).filter(validTag);
    if (!tags.length) return { ok: false, why: 'no-tags' };

    const prepared = prepareSymbols(lib, cfg);
    const checkable = prepared.filter(p => p.checkable);
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

    tags.forEach((t, ti) => {
      const places = asArr(asObj(placed[ti]).places);
      if (families[ti].mode === 'check') {
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
              if (!had || s.score > had.score) spot.best.set(p, { p, score: s.score, k: pl.k, filled: s.filled, box: s.box });
              if (s.score > spot.top) spot.top = s.score;
              const dist = Math.hypot(pl.cx - c[0], pl.cy - c[1]);
              if (!mine.has(spot) || dist < mine.get(spot)) mine.set(spot, dist);
            }
          }
          for (const [spot, dist] of mine) pairs.push({ ti, place, spot, dist });
        }
      }
      if (progress) { try { progress(ti + 1, tags.length); } catch { /* the caller's problem */ } }
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
            const s = scorePlacement(p, pl, win, { ...cfg, quickLook: NEAR_MISS_LOOK });
            if (s && (!best || s.score > best.score)) best = { symbol: nameOf(p), score: round3(s.score) };
          }
        }
      }
      return best && best.score >= NEAR_MISS_FLOOR ? best : null;
    };

    // The rest.
    tags.forEach((t, ti) => {
      if (done[ti]) return;
      const v = verdicts[ti], places = asArr(asObj(placed[ti]).places);
      if (places.length) v.tagBox = places[0].box.map(round3);
      if (!places.length) { v.why = NO_POSITION; return; }
      if (families[ti].mode !== 'check') { v.why = families[ti].why; return; }
      if (late[ti]) { v.why = OUT_OF_TIME; return; }
      v.exceptions = familyExceptions(lib, prepared, t.fc.toUpperCase());
      v.verdict = v.exceptions.length ? 'exception' : 'look';
      v.closest = closestOf(places, families[ti].symbols);
    });

    const counts = Object.fromEntries(VERDICTS.map(k => [k, 0]));
    for (const v of verdicts) counts[v.verdict]++;
    const checked = tags.filter((t, ti) => families[ti].mode === 'check' && !late[ti] && asArr(asObj(placed[ti]).places).length).length;
    return { ok: true, verdicts, counts, checked, recognised: counts.ok + counts['off-size'], proposals,
      timedOut: late.some(Boolean), ms: Math.round(clock() - started) };
  } catch {
    return { ok: false, why: 'failed' };
  }
}
