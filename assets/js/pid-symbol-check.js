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
import { sheetShapes, readByLinePieces } from './pid-sheet-read.js';

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
  shapeExplained: 0.97,               // a shape is standard when its symbols explain this share of its ink
  // Legend symbols a body may carry besides the owner's operators (owner, 2026-11-18): placed only beside a found part,
  // never alone, never size-judged. A symbol found alone by the sweep stays a body.
  attachments: Object.freeze(['FLANGED CONNECTION', 'CAPPED END/THREADED PLUG', 'LOCKED', 'FLOW DIRECTION ARROW', 'DIRECTION FLOW ARROW',
    'PIPE BORE CHANGE/ CONCENTRIC REDUCER', 'PIPE BORE CHANGE/ ECCENTRIC REDUCER', 'GEP MARK', 'QUALITY MARK', 'SAFETY MARK']),
  longRunCap: 1e9,                    // points: the long-run length never exceeds this (tuned at the gate)
});

const MAX_SWEEP_SIDE = 14400;         // points: the largest PDF page. A larger side is not swept.

export const VERDICTS = ['ok', 'off-size', 'wrong-family', 'exception', 'look', 'not-checked'];

// The defaults, with any positive number the caller supplied in their place.
// settings() is called on every placement scored: an options object read once is read from here after. No caller
// changes a settings object or its options after use.
const SETTINGS_SEEN = new WeakMap();
let settingsPlain = null;
function settings(options) {
  if (options === undefined || options === null) return settingsPlain || (settingsPlain = settingsOf(options));
  if (typeof options !== 'object') return settingsOf(options);
  let got = SETTINGS_SEEN.get(options);
  if (!got) { got = settingsOf(options); SETTINGS_SEEN.set(options, got); }
  return got;
}
function settingsOf(options) {
  const o = asObj(options), out = { ...CHECK_DEFAULTS };
  for (const k of Object.keys(CHECK_DEFAULTS)) if (isNum(o[k]) && o[k] > 0) out[k] = o[k];
  if (Array.isArray(o.attachments)) out.attachments = o.attachments.filter(n => typeof n === 'string');
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
  const w = b.w, data = b.data, yMax = b.h - 1, xMax = w - 1;
  // A level or upright line: the stamps are half a pixel apart or less, so every pixel along it is stamped; the union is a bar.
  if (ay === by || ax === bx) {
    // The first and last stamp are worked out by the very expression the stamps use, so an end on a pixel edge falls as it always did.
    const fx0 = Math.floor(ax + (bx - ax) * 0 / n), fx1 = Math.floor(ax + (bx - ax) * n / n), fy0 = Math.floor(ay + (by - ay) * 0 / n), fy1 = Math.floor(ay + (by - ay) * n / n);
    const cx0 = fx0 < fx1 ? fx0 : fx1, cx1 = fx0 < fx1 ? fx1 : fx0, cy0 = fy0 < fy1 ? fy0 : fy1, cy1 = fy0 < fy1 ? fy1 : fy0;
    const xa = cx0 - r < 0 ? 0 : cx0 - r, xb = cx1 + r > xMax ? xMax : cx1 + r, ya = cy0 - r < 0 ? 0 : cy0 - r, yb = cy1 + r > yMax ? yMax : cy1 + r;
    for (let y = ya; y <= yb; y++) { const row = y * w; for (let x = xa; x <= xb; x++) data[row + x] = 1; }
    return;
  }
  let lastX = NaN, lastY = NaN;
  for (let i = 0; i <= n; i++) {
    const cx = Math.floor(ax + (bx - ax) * i / n), cy = Math.floor(ay + (by - ay) * i / n);
    if (cx === lastX && cy === lastY) continue;   // the same square as the last stamp: nothing new to draw
    lastX = cx; lastY = cy;
    const xa = cx - r < 0 ? 0 : cx - r, xb = cx + r > xMax ? xMax : cx + r;
    for (let y = cy - r < 0 ? 0 : cy - r, ye = cy + r > yMax ? yMax : cy + r; y <= ye; y++) {
      for (let x = xa, row = y * w; x <= xb; x++) data[row + x] = 1;
    }
  }
}

function drawInto(b, paths, o, cfg) {
  const S = b.pxPerPt;
  const tf = typeof o.transform === 'function' ? o.transform : null;
  // o.place: a placement applied here as placePoint applies it, without making an array for every point.
  const pl = isPlacement(o.place) ? o.place : null;
  const [oa, ob, oc, od] = pl ? ORIENTATIONS[pl.o] : [1, 0, 0, 1];
  const scale = isNum(o.scale) && o.scale > 0 ? o.scale : 1;
  const loops = o.fillLoops instanceof Set ? o.fillLoops : null;
  const bx0 = b.x0, by0 = b.y0;
  for (const p of asArr(paths)) {
    if (!p || typeof p !== 'object' || !Array.isArray(p.segs)) continue;
    const grey = isNum(p.grey) ? p.grey : 0;
    const white = grey >= cfg.whiteGrey, ink = grey < cfg.inkGrey;
    if (!white && !ink) continue;
    const px = [], sg = p.segs;
    for (let i = 0; i + 3 < sg.length; i += 4) {
      let ax = sg[i], ay = sg[i + 1], cx = sg[i + 2], cy = sg[i + 3];
      if (pl) {
        const x0 = pl.k * (oa * ax + oc * ay) + pl.tx, y0 = pl.k * (ob * ax + od * ay) + pl.ty;
        const x1 = pl.k * (oa * cx + oc * cy) + pl.tx, y1 = pl.k * (ob * cx + od * cy) + pl.ty;
        ax = x0; ay = y0; cx = x1; cy = y1;
      } else if (tf) { const a = tf(ax, ay), c = tf(cx, cy); ax = a[0]; ay = a[1]; cx = c[0]; cy = c[1]; }
      const q0 = (ax - bx0) * S, q1 = (ay - by0) * S, q2 = (cx - bx0) * S, q3 = (cy - by0) * S;
      if (isNum(q0) && isNum(q1) && isNum(q2) && isNum(q3)) px.push(q0, q1, q2, q3);
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
  const { w, h, data } = b, total = w * h, across = new Uint8Array(total), out = new Uint8Array(total);
  // Same answer as growing each ink pixel into a square, but the work follows the ink: empty stretches are skipped
  // four pixels at a time, a run of ink is grown once, and only the span of a row that holds ink is copied down.
  const words = total >= 4 && data.byteOffset % 4 === 0 ? new Uint32Array(data.buffer, data.byteOffset, total >> 2) : null;
  const rowLo = new Int32Array(h).fill(-1), rowHi = new Int32Array(h);
  // Which 64-pixel blocks of each row hold grown ink: the copy down then touches only those, not the whole span of a row.
  const wide = (w & 3) === 0 && total >= 4, nb = (w + 63) >> 6, blocks = wide ? new Uint8Array(h * nb) : null;
  let y = 0, rowStart = 0, rowEnd = w, until = -1;
  for (let i = 0; i < total;) {
    if (words !== null && (i & 3) === 0 && i + 4 <= total && words[i >> 2] === 0) { i += 4; continue; }
    if (data[i] === 0) { i++; continue; }
    while (i >= rowEnd) { rowStart = rowEnd; rowEnd += w; y++; }
    // A run of ink along the row is grown once, from n before its first pixel to n after its last.
    let j = i;
    while (j + 1 < rowEnd && data[j + 1] !== 0) j++;
    let from = i - n < rowStart ? rowStart : i - n;
    const to = j + n >= rowEnd ? rowEnd - 1 : j + n;
    if (from <= until) from = until + 1;
    for (let k = from; k <= to; k++) across[k] = 1;
    if (to > until) until = to;
    if (rowLo[y] < 0) rowLo[y] = from - rowStart;
    rowHi[y] = to - rowStart;
    if (blocks !== null && from <= to) for (let bk = (from - rowStart) >> 6, bz = (to - rowStart) >> 6; bk <= bz; bk++) blocks[y * nb + bk] = 1;
    i = j + 1;
  }
  // across and out hold only 0 and 1, so OR-ing four pixels at a time gives the same bytes as setting them one by one.
  const across32 = wide ? new Uint32Array(across.buffer) : null, out32 = wide ? new Uint32Array(out.buffer) : null, w4 = w >> 2;
  for (let r0 = 0; r0 < h; r0++) {
    const lo = rowLo[r0];
    if (lo < 0) continue;
    const hi = rowHi[r0], src = r0 * w, last = r0 + n < h ? r0 + n : h - 1;
    if (wide) {
      const first = r0 - n < 0 ? 0 : r0 - n, rowW = r0 * w4;
      for (let bk = lo >> 6, bz = hi >> 6; bk <= bz; bk++) {
        if (blocks[r0 * nb + bk] === 0) continue;
        const a = rowW + bk * 16, z = a + 15 < rowW + w4 - 1 ? a + 15 : rowW + w4 - 1;
        for (let k = first; k <= last; k++) {
          const shift = (k - r0) * w4;
          for (let q = a; q <= z; q++) out32[q + shift] |= across32[q];
        }
      }
    } else {
      for (let k = r0 - n < 0 ? 0 : r0 - n; k <= last; k++) {
        const dst = k * w;
        for (let x = lo; x <= hi; x++) if (across[src + x] !== 0) out[dst + x] = 1;
      }
    }
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
  // A legend structure (a tank, a chamber) bigger than any swept symbol is drawn to suit (owner, 2026-11-22: "much like
  // the tanks they might be resized"): never swept, but box-fitted to a shape at whatever size it is drawn there.
  out.toSuit = out.why === 'size' && !wild && !out.bubble && Math.min(out.w, out.h) >= cfg.minSize && flags.judgeOnly !== true
    && !(typeof flags.lineMark === 'string' && flags.lineMark) && flags.operator !== true;
  // An operator (a handwheel, lever or actuator on another symbol's stem) is
  // never swept; the shape check places it beside a body, however plain.
  out.operator = flags.operator === true;
  // A plain symbol (a box, an arrow) matches plain drawing linework, so a sweep
  // hit of one is held to a stricter test. Checkable ones only: "simple" comes first.
  out.plain = out.checkable && !out.bubble
    && (pieces <= 3 || out.segs.every(g => Math.min(Math.abs(g[2] - g[0]), Math.abs(g[3] - g[1])) <= 0.02 * g[4]));
  // Points about a point apart, for the quick look. Only for a symbol that
  // will be matched, whose segments are by now known to be few and short.
  if (out.checkable || out.toSuit || (out.operator && out.segs.length && !wild)) {
    for (const g of out.segs) {
      const n = Math.max(1, Math.min(400, Math.round(g[4])));
      for (let i = 0; i <= n; i++) out.points.push(g[0] + (g[2] - g[0]) * i / n, g[1] + (g[3] - g[1]) * i / n);
    }
  }
  out.codes = tagCodes(s.tagId);
  // Read from Legend Sheet 1's sample boxes (judgeOnly; lineMark for a mark repeated along a line): never swept,
  // never paired with a tag, never in the sheet's size limits. The shape check alone places them.
  const mark = typeof flags.lineMark === 'string' && flags.lineMark ? flags.lineMark : null;
  if (flags.judgeOnly === true || mark) {
    out.judgeOnly = true; out.lineMark = mark; out.judgeWhy = out.why;
    if (out.checkable) { out.checkable = false; out.why = 'judge-only'; }
  }
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

const SEG_CELL = 100;   // points: the side of one cell of the segment index

/**
 * A lookup for "the segments whose midpoint is within `reach` of a centre": near(centre, reach) gives exactly what
 * segments.filter(g => Math.hypot(midX - centre[0], midY - centre[1]) <= reach) gives, in the same order, but looks
 * only at the cells round the centre instead of every segment on the sheet. Built once per sheet.
 */
export function segmentIndex(segments) {
  const list = asArr(segments), cells = new Map();
  const mid = list.map(g => (Array.isArray(g) ? [(g[0] + g[2]) / 2, (g[1] + g[3]) / 2] : [NaN, NaN]));
  const key = (i, j) => i * 100003 + j;
  mid.forEach((m, n) => {
    if (!isNum(m[0]) || !isNum(m[1])) return;
    const k = key(Math.floor(m[0] / SEG_CELL), Math.floor(m[1] / SEG_CELL));
    const cell = cells.get(k);
    if (cell) cell.push(n); else cells.set(k, [n]);
  });
  return (centre, reach) => {
    const c = asArr(centre);
    const cx = c[0], cy = c[1];
    const exact = n => Math.hypot(mid[n][0] - cx, mid[n][1] - cy) <= reach;
    // A centre or reach that is not a number, or one so wide that most of the sheet is in it: look at every segment.
    const span = isNum(reach) && isNum(cx) && isNum(cy) ? Math.floor((2 * reach) / SEG_CELL) + 3 : Infinity;
    if (!(span * span < cells.size * 2 + 64)) { const all = []; for (let n = 0; n < list.length; n++) if (exact(n)) all.push(list[n]); return all; }
    const i0 = Math.floor((cx - reach) / SEG_CELL) - 1, i1 = Math.floor((cx + reach) / SEG_CELL) + 1;
    const j0 = Math.floor((cy - reach) / SEG_CELL) - 1, j1 = Math.floor((cy + reach) / SEG_CELL) + 1;
    const found = [];
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const cell = cells.get(key(i, j));
      if (cell) for (const n of cell) if (exact(n)) found.push(n);
    }
    found.sort((a, b) => a - b);
    return found.map(n => list[n]);
  };
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
    const segs = asArr(segments), c0 = c[0], c1 = c[1];
    for (const key of asArr(p.keys)) {
      const kx = key[2] - key[0], ky = key[3] - key[1], mx = (key[0] + key[2]) / 2, my = (key[1] + key[3]) / 2;
      // Per key, once: where the key's direction goes in each of the eight orientations, and the angle allowance's scale.
      const vxs = [], vys = [];
      for (let o = 0; o < 8; o++) { const [a, b, cc, d] = ORIENTATIONS[o]; vxs.push(a * kx + cc * ky); vys.push(b * kx + d * ky); }
      const allow = cfg.angleTol * key[4];
      for (let gi = 0; gi < segs.length; gi++) {
        const g = segs[gi];
        // Not a segment: not an array, or one of its first five numbers is not a finite number (a short array passes, as before).
        if (!Array.isArray(g) || !(g.length > 0 ? isNum(g[0]) : true) || !(g.length > 1 ? isNum(g[1]) : true) || !(g.length > 2 ? isNum(g[2]) : true)
          || !(g.length > 3 ? isNum(g[3]) : true) || !(g.length > 4 ? isNum(g[4]) : true)) continue;
        const k = g[4] / key[4];
        if (k < cfg.minScale || k > cfg.maxScale) continue;
        const gx = (g[0] + g[2]) / 2, gy = (g[1] + g[3]) / 2;
        // hypot is never less than either side, so a segment further than the reach in x or y alone is out without it.
        const ddx = gx - c0, ddy = gy - c1;
        if (ddx > reach || -ddx > reach || ddy > reach || -ddy > reach || Math.hypot(ddx, ddy) > reach) continue;
        const gdy = g[3] - g[1], gdx = g[2] - g[0], lim = allow * g[4];
        for (let o = 0; o < 8; o++) {
          if (Math.abs(vxs[o] * gdy - vys[o] * gdx) > lim) continue;
          const [a, b, cc, d] = ORIENTATIONS[o];
          const tx = gx - k * (a * mx + cc * my), ty = gy - k * (b * mx + d * my);
          const cx = k * (a * p.w / 2 + cc * p.h / 2) + tx, cy = k * (b * p.w / 2 + d * p.h / 2) + ty;
          if (Math.hypot(cx - c0, cy - c1) > cfg.radius) continue;
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
    // The placement as numbers, applied exactly as placePoint applies it, with no array made for each point.
    const [oa, ob, oc, od] = ORIENTATIONS[placement.o], pk = placement.k, ptx = placement.tx, pty = placement.ty;
    const tf = (x, y) => placePoint(placement, x, y);

    // 1. Quick look: a sample of the symbol's points must land on drawing ink.
    const pts = p.points, step = 2 * Math.max(1, Math.floor(pts.length / 2 / 30)), dx0 = D.x0, dy0 = D.y0, nd = N.data;
    let on = 0, n = 0;
    for (let i = 0; i + 1 < pts.length; i += step) {
      const px0 = pts[i], py0 = pts[i + 1];
      const X = Math.floor((pk * (oa * px0 + oc * py0) + ptx - dx0) * S), Y = Math.floor((pk * (ob * px0 + od * py0) + pty - dy0) * S);
      n++;
      if (X >= 0 && Y >= 0 && X < W && Y < H && nd[Y * W + X]) on++;
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
      drawInto(bare, p.symbol.paths, { place: placement, scale: placement.k }, cfg);
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
    drawInto(T, p.symbol.paths, { place: placement, scale: placement.k, fillLoops }, cfg);
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
const NEAR_KEEP_MAX = 20000;  // near misses the sweep keeps for the shape check, at most
const NEAR_WEAK = 0.6;        // a near miss scoring this much has its weakest line measured
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

// The settings with the relaxed quick look, one per settings object (settings() reads a new object afresh each time).
const LOOSE_SEEN = new WeakMap();
function looseLook(cfg) {
  let got = LOOSE_SEEN.get(cfg);
  if (!got) { got = settings({ ...cfg, quickLook: NEAR_MISS_LOOK }); LOOSE_SEEN.set(cfg, got); }
  return got;
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
        const loose = s || scorePlacement(p, pl, window, looseLook(cfg));
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

// ── The drawing area ──────────────────────────────────────────────────────
// The sheet's frame, less its title strip or bottom-right block: where the
// drawing itself is. Measured rules; a sheet that does not fit them gets
// found: false and nothing is cropped.

export const FRAME_LONG = 0.6;    // a frame side runs at least this share of the page's width (or height)
export const FRAME_ZONE = 0.15;   // and lies in this outer share of the page
export const STRIP_ZONE = 0.3;    // a title strip's divider lies in this share of the frame at its right (a block: at its bottom)
export const STRIP_COVER = 0.5;   // and covers at least this share of the frame's height (a block: of its own height)
export const STRIP_ROWS = 2;      // with at least this many row lines running from it to the frame's edge
export const FRAME_TOUCH = 4;     // a shape closer than this to the frame is on it, not in it
export const CUT_TOUCH = 2;       // and closer than this to a cut is on it

// Share of [lo, hi] covered by the runs lying within `tol` of `at` (pieces up to `gap` apart count as one): points covered.
function coverOf(runs, at, tol, lo, hi, gap) {
  const iv = runs.filter(r => Math.abs(r.at - at) <= tol).map(r => [Math.max(r.a, lo), Math.min(r.b, hi)]).filter(v => v[1] > v[0]).sort((u, v) => u[0] - v[0]);
  let total = 0, cur = null;
  for (const [a, b] of iv) {
    if (cur && a <= cur[1] + gap) cur[1] = Math.max(cur[1], b);
    else { if (cur) total += cur[1] - cur[0]; cur = [a, b]; }
  }
  return cur ? total + cur[1] - cur[0] : total;
}

/**
 * The drawing area of a sheet, in the page's own (viewport) points:
 * { box, cuts, found }. box is the frame, cuts the title strip or block
 * inside it. found is false (box the whole page, no cuts) when the four sides
 * of a frame are not all there. Never throws.
 */
export function drawingArea(paths, pageSize) {
  let W = null, H = null;
  try {
    const s = asArr(pageSize);
    if (isNum(s[0]) && isNum(s[1]) && s[0] > 0 && s[1] > 0) { W = s[0]; H = s[1]; }
    if (W === null) return { box: null, cuts: [], found: false };
    const none = { box: [0, 0, W, H], cuts: [], found: false };
    const cfg = settings();
    const hr = axisRuns(paths, false, cfg), vr = axisRuns(paths, true, cfg);
    const side = (runs, long, lo, hi) => runs.filter(r => r.b - r.a >= FRAME_LONG * long && r.at >= lo && r.at <= hi).map(r => r.at);
    const top = side(hr, W, 0, FRAME_ZONE * H), bottom = side(hr, W, (1 - FRAME_ZONE) * H, H);
    const left = side(vr, H, 0, FRAME_ZONE * W), right = side(vr, H, (1 - FRAME_ZONE) * W, W);
    if (!top.length || !bottom.length || !left.length || !right.length) return none;
    const [x0, y0, x1, y1] = [Math.max(...left), Math.max(...top), Math.min(...right), Math.min(...bottom)];
    if (!(x1 > x0 && y1 > y0)) return none;
    const fw = x1 - x0, fh = y1 - y0, box = [x0, y0, x1, y1];

    // a strip: a divider in the frame's right part, most of its height, with row lines from it to the frame's edge
    const xs = [...new Set(vr.filter(r => r.at > x0 + (1 - STRIP_ZONE) * fw && r.at < x1 - 5).map(r => r.at))].sort((p, q) => p - q);
    for (const x of xs) {
      if (coverOf(vr, x, 0.8, y0, y1, 0.5) < STRIP_COVER * fh) continue;
      const rows = hr.filter(r => Math.abs(r.a - x) <= 2 && Math.abs(r.b - x1) <= 3 && r.at >= y0 && r.at <= y1);
      if (rows.length >= STRIP_ROWS) return { box, cuts: [[x, y0, x1, y1]], found: true };
    }

    // a bottom-right block: its top line to the frame's right edge, its left line down to the frame's bottom
    const corners = [];
    for (const h of hr) {
      if (!(h.at > y0 + (1 - STRIP_ZONE) * fh && h.at < y1 - 5) || Math.abs(h.b - x1) > 3 || !(h.a > x0 + 5)) continue;
      const side2 = vr.filter(v => Math.abs(v.at - h.a) <= 2 && v.b >= y1 - 3 && v.a <= h.at + 3);
      if (!side2.length || coverOf(vr, side2[0].at, 2, h.at, y1, 0.5) < STRIP_COVER * (y1 - h.at)) continue;
      corners.push([h.a, h.at]);
    }
    if (corners.length) {
      corners.sort((p, q) => p[1] - q[1] || p[0] - q[0]);
      return { box, cuts: [[corners[0][0], corners[0][1], x1, y1]], found: true };
    }
    return { box, cuts: [], found: true };
  } catch {
    return { box: W !== null ? [0, 0, W, H] : null, cuts: [], found: false };
  }
}

/**
 * True when a box lies in the drawing area: inside the frame by more than
 * FRAME_TOUCH on every side, and touching no cut grown by CUT_TOUCH. True for
 * every box when no frame was found. Never throws.
 */
export function insideArea(area, box) {
  try {
    const a = asObj(area);
    if (a.found !== true) return true;
    const f = a.box, b = box;
    const ok4 = v => Array.isArray(v) && v.length >= 4 && v.slice(0, 4).every(isNum);
    if (!ok4(f) || !ok4(b)) return false;
    if (b[0] <= f[0] + FRAME_TOUCH || b[1] <= f[1] + FRAME_TOUCH || b[2] >= f[2] - FRAME_TOUCH || b[3] >= f[3] - FRAME_TOUCH) return false;
    for (const c of asArr(a.cuts)) {
      if (!ok4(c)) continue;
      if (b[2] > c[0] - CUT_TOUCH && b[0] < c[2] + CUT_TOUCH && b[3] > c[1] - CUT_TOUCH && b[1] < c[3] + CUT_TOUCH) return false;
    }
    return true;
  } catch {
    return true;
  }
}

const inBox = (b, x, y) => !!b && x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];

/** A checkable, non-bubble symbol drawn only with axis-aligned lines, or with at most 3 straight pieces. Never throws. */
export function plainShape(prepared) {
  try { const p = asObj(prepared); return p.checkable === true && p.bubble !== true && p.plain === true; } catch { return false; }
}

// The longest straight line of a prepared symbol, collinear pieces joined across gaps up to RUN_GAP.
function longestJoined(segs) {
  const list = asArr(segs).filter(g => Array.isArray(g) && g.slice(0, 5).every(isNum) && g[4] > 0);
  let best = list.reduce((m, g) => Math.max(m, g[4]), 0);
  if (list.length > 400) return best;     // a huge symbol: its longest piece stands
  const used = new Set();
  for (let i = 0; i < list.length; i++) {
    if (used.has(i)) continue;
    const a = list[i], ux = (a[2] - a[0]) / a[4], uy = (a[3] - a[1]) / a[4];
    const off = (x, y) => Math.abs((x - a[0]) * uy - (y - a[1]) * ux), along = (x, y) => x * ux + y * uy;
    const iv = [];
    for (let j = 0; j < list.length; j++) {
      const b = list[j];
      if (Math.abs(ux * (b[3] - b[1]) / b[4] - uy * (b[2] - b[0]) / b[4]) > 0.02 || off(b[0], b[1]) > 0.3 || off(b[2], b[3]) > 0.3) continue;
      used.add(j);
      const t0 = along(b[0], b[1]), t1 = along(b[2], b[3]);
      iv.push([Math.min(t0, t1), Math.max(t0, t1)]);
    }
    iv.sort((p, q) => p[0] - q[0]);
    let cur = null;
    for (const v of iv) {
      if (cur && v[0] <= cur[1] + RUN_GAP) cur[1] = Math.max(cur[1], v[1]); else cur = v.slice();
      best = Math.max(best, cur[1] - cur[0]);
    }
  }
  return best;
}

/**
 * The size band for the shape splitter, from the library: the smallest
 * checkable symbol's longer side at minScale, the largest at maxScale, and
 * the longest straight line any checkable symbol could be drawn with
 * (collinear pieces joined) at maxScale, and the thinnest symbol's shorter
 * side at minScale (minShort). Null when nothing is checkable.
 */
export function shapeBand(prepared, options) {
  try {
    const cfg = settings(options), ok = asArr(prepared).filter(p => p && p.checkable === true && isNum(p.w) && isNum(p.h));
    if (!ok.length) return null;
    const sides = ok.map(p => Math.max(p.w, p.h));
    const longRun = Math.max(...ok.map(p => longestJoined(p.segs)));
    const shorts = ok.map(p => Math.min(p.w, p.h));
    return { minSide: Math.min(...sides) * cfg.minScale, maxSide: Math.max(...sides) * cfg.maxScale, longRun: Math.min(longRun * cfg.maxScale, cfg.longRunCap),
      minShort: Math.min(...shorts) * cfg.minScale };
  } catch {
    return null;
  }
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
  const nearSegs = typeof ctx.nearSegs === 'function' ? ctx.nearSegs : segmentIndex(segments);
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
  const checkable = prepared.filter(p => p.checkable && !p.bubble && !p.operator);
  const bubbles = prepared.filter(p => p.checkable && p.bubble);
  if (!checkable.length && !bubbles.length) return out;
  // Near misses (raw only): the best placement scoring at least NEAR_MISS_FLOOR but rejected, per symbol per 3 pt spot.
  const near = new Map();
  const keepNear = (p, pl, s, win) => {
    if (near.size >= NEAR_KEEP_MAX) return;
    const key = prepared.indexOf(p) + ':' + Math.round(pl.cx / 3) + ':' + Math.round(pl.cy / 3), had = near.get(key);
    if (had && had.score >= s.score) return;
    const h = { p, placement: pl, score: s.score, forward: s.forward, backward: s.backward, k: pl.k, box: s.box, weak: null };
    if (s.score >= NEAR_WEAK) h.weak = weakestLine(h, win, cfg);
    near.set(key, h);
  };
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
        if (bare) { hit.plainRejected = true; hit.rejectedFor = 'unwritten'; }   // as a plain shape in a panel: only the leftover-tag pass may use it
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
      const nearby = nearSegs(c, reach);
      if (!nearby.length) continue;
      // The window (the drawing round this centre, drawn and grown) is made when the first placement needs it:
      // a centre where nothing is proposed never pays for it.
      let winMade = null;
      for (const p of checkable) {
        if (late()) { out.timedOut = true; break; }
        const done = tried.get(p);
        for (const pl of proposePlacements(p, nearby, c, cfg)) {
          const win = winMade || (winMade = windowFrom(boxed, c, cfg));
          const id = pl.o + ':' + Math.round(pl.tx * 4) + ':' + Math.round(pl.ty * 4) + ':' + Math.round(pl.k * 50);
          if (done.has(id)) continue;
          const s = scorePlacement(p, pl, win, cfg);
          if (!s) continue;
          done.add(id);
          if (inBox(skipped, pl.cx, pl.cy)) continue;
          if (s.score < cfg.recognise) { if (ctx.raw && s.score >= NEAR_MISS_FLOOR) keepNear(p, pl, s, win); continue; }
          const hit = { p, placement: pl, score: s.score, k: pl.k, box: s.box, filled: s.filled, bubble: false, ring: null, tag: null };
          // A plain shape matches panel boxes and table cells: it must explain
          // nearly all the ink in its box, and no edge may run on past a corner.
          // checkSheet's leftover-tag pass may still use such a hit (as phase 1
          // did) so a tag's verdict cannot get worse; it is never listed alone.
          // A symbol that holds letters needs writing in its box; every line of a symbol
          // must be on the drawing (a hatched run is not a symbol).
          const unwritten = writing !== null && asArr(asObj(p.symbol).letters).length > 0 && !hasWriting(writing, s.box);
          const plainBad = plainShape(p) && (s.backward < cfg.plainBack || runsOnPastCorner(hit, win.ink, cfg));
          hit.weak = weakestLine(hit, win, cfg);
          if (plainBad || unwritten || hit.weak < LINE_MIN) {
            if (ctx.raw) { hit.plainRejected = true; hit.rejectedFor = plainBad ? 'plain' : unwritten ? 'unwritten' : 'line'; hits.push(hit); }
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
  if (ctx.raw) { out.list = hits; out.near = [...near.values()]; } else out.spots = mergeHits(hits, cfg);
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

// ── Whole shapes (phase 3) ────────────────────────────────────────────────
// Is each drawn shape the standard symbol, all of it? The sweep finds
// symbols; sheetShapes cuts the ink into shapes. Here every shape is held
// against the symbols found in it, a legend operator beside a body, a plain
// symbol or a bubble matched to the whole shape: standard when they explain
// SHAPE_EXPLAINED of its ink, else not to standard, with why and the
// closest symbol. Judged against the legend only: a shape drawn exactly like
// another standard symbol reads as that symbol.

const SPOT_SHARE = 0.3;       // a found symbol belongs to every shape holding this share of its template points
const THROUGH_SHARE = 0.8;    // a line piece this much on a found symbol's template goes with its shape
const CLOSEST_TRY = 8;        // candidates measured for "closest", per shape
const SHORT_SCORE = 0.8;      // a candidate scoring this, with a line under LINE_MIN, makes a shape "short-line"
const LOOSE_TRY = 40;         // placements scored in the loose search for a shape nothing explains

const STRETCH_MAX = 1.5;      // a symbol may be fitted to a shape this much more one way than the other
const TO_SUIT_MIN = 0.25;     // a structure drawn to suit (prepared.toSuit) is box-fitted down to this share of its legend size
const TO_SUIT_FRAME = 0.5;    // its walls frame it when they cover this share of its legend box each way
const TO_SUIT_SIDE = 60;      // points (at the sheet's symbol size): a shape a structure is fitted to is at least this long

// The quick look for a stretched fit: about 30 of the symbol's points, stretched into the box at orientation o,
// must land on the drawing's ink (grown by the tolerance) at the quick-look share. No bitmap is made.
function quickFit(prepared, o, box, near, cfg, whole = false) {
  const p = asObj(prepared);
  if (!(p.w > 0 && p.h > 0) || !(near && near.data)) return false;
  const frame = whole ? null : fitFrame(p), fr = frame || [0, 0, p.w, p.h], pw = fr[2] - fr[0], ph = fr[3] - fr[1];
  const turned = o % 2 === 1, bw = box[2] - box[0], bh = box[3] - box[1];
  const sx = (turned ? bh : bw) / pw, sy = (turned ? bw : bh) / ph;
  if (!(sx > 0 && sy > 0) || Math.max(sx, sy) / Math.min(sx, sy) > STRETCH_MAX || !scaleOk(p, sx, sy, cfg)) return false;
  // A structure drawn to suit: its points within its walls, shifted to them (worked out once).
  const pts = frame ? framedPoints(p, frame) : asArr(p.points);
  if (!pts.length) return false;
  const [a, b, c, d] = ORIENTATIONS[o];
  const at = (x, y) => [a * x * sx + c * y * sy, b * x * sx + d * y * sy];
  const cs = [at(0, 0), at(pw, 0), at(0, ph), at(pw, ph)];
  const tx = box[0] - Math.min(...cs.map(q => q[0])), ty = box[1] - Math.min(...cs.map(q => q[1]));
  const step = 2 * Math.max(1, Math.floor(pts.length / 2 / 30));
  let on = 0, n = 0;
  for (let i = 0; i + 1 < pts.length; i += step) {
    const q = at(pts[i], pts[i + 1]);
    const X = Math.floor((q[0] + tx - near.x0) * near.pxPerPt), Y = Math.floor((q[1] + ty - near.y0) * near.pxPerPt);
    n++;
    if (X >= 0 && Y >= 0 && X < near.w && Y < near.h && near.data[Y * near.w + X]) on++;
  }
  return n > 0 && on >= cfg.quickLook * n;
}

// The box a structure drawn to suit is fitted by: its walls (its outline, lines with a free end left out), not its whole legend box (a MANHOLE's
// outlet runs out past its walls, and on a sheet that outlet is often pipework of its own; whole: the symbol's own box,
// for one drawn with its outlet). Null for any other symbol.
const frames = new WeakMap();
const fitFrame = p => {
  if (p.toSuit !== true) return null;
  if (frames.has(p)) return frames.get(p);
  // A frame of most of the structure only (a LAGOON's closed part is a small piece of it: no frame, its whole box).
  const segs = asArr(p.segs), b = segs.length ? outlineBox(segs, segs.map((_, i) => i)) : null;
  const out = b && b[2] - b[0] >= TO_SUIT_FRAME * p.w && b[3] - b[1] >= TO_SUIT_FRAME * p.h ? b : null;
  frames.set(p, out);
  return out;
};
const framed = new WeakMap();
const framedPoints = (p, fr) => {
  if (framed.has(p)) return framed.get(p);
  const out = [], P = asArr(p.points);
  for (let i = 0; i + 1 < P.length; i += 2) { const x = P[i], y = P[i + 1];
    if (x >= fr[0] - 0.5 && x <= fr[2] + 0.5 && y >= fr[1] - 0.5 && y <= fr[3] + 0.5) out.push(x - fr[0], y - fr[1]); }
  framed.set(p, out);
  return out;
};
// A box fit's scales sx, sy within the size band (STRETCH_MAX beyond it either way); a structure drawn to suit at any
// size down to TO_SUIT_MIN.
const scaleOk = (p, sx, sy, b) => (p.toSuit === true ? Math.min(sx, sy) >= TO_SUIT_MIN
  : Math.min(sx, sy) >= b.minScale / STRETCH_MAX && Math.max(sx, sy) <= b.maxScale * STRETCH_MAX);

// A library symbol stretched to fill a box at orientation o (0-7): { p (prepared), placement }, or null when the
// stretch is more than STRETCH_MAX one way than the other, or far outside the size band.
function boxFit(prepared, o, box, band, whole = false) {
  const p = asObj(prepared), sym = asObj(p.symbol);
  if (!(isNum(p.w) && isNum(p.h) && p.w > 0 && p.h > 0)) return null;
  // A structure drawn to suit is fitted by its walls: only its paths within them, shifted to them.
  const fr = (!whole && fitFrame(p)) || [0, 0, p.w, p.h], pw = fr[2] - fr[0], ph = fr[3] - fr[1];
  const within = q => { const g = asArr(q.segs); for (let i = 0; i + 1 < g.length; i += 2) if (g[i] < fr[0] - 0.5 || g[i] > fr[2] + 0.5 || g[i + 1] < fr[1] - 0.5 || g[i + 1] > fr[3] + 0.5) return false; return true; };
  const turned = o % 2 === 1, bw = box[2] - box[0], bh = box[3] - box[1];
  const sx = (turned ? bh : bw) / pw, sy = (turned ? bw : bh) / ph;
  // The size band is the judge's band at the sheet's own scale (a sheet printed at 43% fits at 43%).
  const cfg = settings(), b = band && isNum(band.minScale) && isNum(band.maxScale) ? band : cfg;
  if (!(sx > 0 && sy > 0) || Math.max(sx, sy) / Math.min(sx, sy) > STRETCH_MAX || !scaleOk(p, sx, sy, b)) return null;
  const scaled = { ...sym, w: pw * sx, h: ph * sy, flags: { ...asObj(sym.flags), simple: false, stretch: false, manual: false },
    paths: asArr(sym.paths).filter(q => fr[0] === 0 && fr[1] === 0 && fr[2] === p.w && fr[3] === p.h || within(q))
      .map(q => ({ ...q, segs: asArr(q.segs).map((v, i) => (i % 2 === 0 ? (v - fr[0]) * sx : (v - fr[1]) * sy)) })) };
  const prep = placeable(prepareOne(scaled, p.toSuit === true ? { ...cfg, maxSize: Infinity } : cfg));
  if (p.toSuit === true) prep.toSuit = true;
  const base = { o, k: 1, tx: 0, ty: 0 };
  const c = [[0, 0], [prep.w, 0], [0, prep.h], [prep.w, prep.h]].map(([x, y]) => placePoint(base, x, y));
  const tx = box[0] - Math.min(...c.map(q => q[0])), ty = box[1] - Math.min(...c.map(q => q[1]));
  // fitK: the larger of the two scales the symbol was stretched by, so hitSize judges a fit on its larger side.
  return { p: prep, placement: { o, k: 1, tx, ty, cx: (box[0] + box[2]) / 2, cy: (box[1] + box[3]) / 2, fitK: Math.max(sx, sy) } };
}

const OUTLINE_JOIN = 0.5;   // points: a piece's end this close to another piece is joined to it
const OUTLINE_MAX = 400;   // pieces: a bigger shape keeps its own box
/**
 * The box of a shape's closed outlines: its pieces after every piece with a free end (a stem, a stub, a tail) is
 * taken off, again and again until none is left. Null when nothing closed is left, or the shape is too big.
 * Never throws.
 */
export function outlineBox(S, pieces) {
  try {
    if (!Array.isArray(S) || !Array.isArray(pieces)) return null;
    let live = [...new Set(pieces.filter(i => Number.isInteger(i) && Array.isArray(S[i]) && S[i].slice(0, 4).every(isNum)))];
    if (!live.length || live.length > OUTLINE_MAX) return null;
    // A stroke drawn twice is one line: its copy is no joint for its free end.
    const near2 = (x0, y0, x1, y1) => Math.hypot(x0 - x1, y0 - y1) <= OUTLINE_JOIN;
    const same = (a, b) => (near2(a[0], a[1], b[0], b[1]) && near2(a[2], a[3], b[2], b[3])) || (near2(a[0], a[1], b[2], b[3]) && near2(a[2], a[3], b[0], b[1]));
    live = live.filter((i, n) => !live.slice(0, n).some(j => same(S[i], S[j])));
    const joined = (pt, self, set) => set.some(j => j !== self && distToSeg(pt, S[j]) <= OUTLINE_JOIN);
    for (let pass = 0; pass < OUTLINE_MAX; pass++) {
      const keep = live.filter(i => { const q = S[i]; return joined([q[0], q[1]], i, live) && joined([q[2], q[3]], i, live); });
      if (keep.length === live.length) break;
      live = keep;
      if (!live.length) return null;
    }
    return boxOfPieces(S, live);
  } catch {
    return null;
  }
}

/**
 * The closed loops among a shape's pieces: what outlineBox keeps (free ends stripped, copies dropped), split into
 * pieces joined end to piece. Returns arrays of piece indexes; [] when there are none or too many pieces.
 */
export function outlineLoops(S, pieces) {
  try {
    const ob = outlineBox(S, pieces);
    if (!ob) return [];
    let live = [...new Set(pieces.filter(i => Number.isInteger(i) && Array.isArray(S[i]) && S[i].slice(0, 4).every(isNum)))];
    const near2 = (x0, y0, x1, y1) => Math.hypot(x0 - x1, y0 - y1) <= OUTLINE_JOIN;
    const same = (a, b) => (near2(a[0], a[1], b[0], b[1]) && near2(a[2], a[3], b[2], b[3])) || (near2(a[0], a[1], b[2], b[3]) && near2(a[2], a[3], b[0], b[1]));
    live = live.filter((i, n) => !live.slice(0, n).some(j => same(S[i], S[j])));
    const joined = (pt, self, set) => set.some(j => j !== self && distToSeg(pt, S[j]) <= OUTLINE_JOIN);
    for (let pass = 0; pass < OUTLINE_MAX; pass++) {
      const keep = live.filter(i => { const q = S[i]; return joined([q[0], q[1]], i, live) && joined([q[2], q[3]], i, live); });
      if (keep.length === live.length) break;
      live = keep;
    }
    const touch = (i, j) => distToSeg([S[i][0], S[i][1]], S[j]) <= OUTLINE_JOIN || distToSeg([S[i][2], S[i][3]], S[j]) <= OUTLINE_JOIN
      || distToSeg([S[j][0], S[j][1]], S[i]) <= OUTLINE_JOIN || distToSeg([S[j][2], S[j][3]], S[i]) <= OUTLINE_JOIN;
    const out = [], seen = new Set();
    for (const i0 of live) {
      if (seen.has(i0)) continue;
      const m = [i0];
      seen.add(i0);
      for (let k = 0; k < m.length; k++) for (const j of live) if (!seen.has(j) && touch(m[k], j)) { seen.add(j); m.push(j); }
      out.push(m);
    }
    return out;
  } catch {
    return [];
  }
}

// Whether segments a and b ([x0, y0, x1, y1, ...]) cross each other.
function segsCross(a, b) {
  const side = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const A0 = [a[0], a[1]], A1 = [a[2], a[3]], B0 = [b[0], b[1]], B1 = [b[2], b[3]];
  const d1 = side(B0, B1, A0), d2 = side(B0, B1, A1), d3 = side(A0, A1, B0), d4 = side(A0, A1, B1);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
// Distance from point pt to segment q ([x0, y0, x1, y1, ...]).
function distToSeg(pt, q) {
  const dx = q[2] - q[0], dy = q[3] - q[1], l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((pt[0] - q[0]) * dx + (pt[1] - q[1]) * dy) / l2)) : 0;
  return Math.hypot(pt[0] - (q[0] + t * dx), pt[1] - (q[1] + t * dy));
}
// One path per piece of the split, with its own path's stroke width.
function piecePaths(split, pieces, paths) {
  const S = asArr(split.segments), P = asArr(paths), out = [];
  for (const i of pieces) {
    const g = S[i];
    if (!Array.isArray(g) || !g.slice(0, 4).every(isNum)) continue;
    const src = asObj(P[g[5]]);
    out.push({ segs: [g[0], g[1], g[2], g[3]], width: isNum(src.width) ? src.width : 0.5, stroked: true, filled: false, grey: 0 });
  }
  return out;
}
const boxOfPieces = (S, pieces) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const i of pieces) { const q = S[i]; x0 = Math.min(x0, q[0], q[2]); y0 = Math.min(y0, q[1], q[3]); x1 = Math.max(x1, q[0], q[2]); y1 = Math.max(y1, q[1], q[3]); }
  return [x0, y0, x1, y1];
};
const overlaps = (a, b, m = 0) => a[0] <= b[2] + m && b[0] <= a[2] + m && a[1] <= b[3] + m && b[1] <= a[3] + m;
// A hit's symbol drawn into a frame where the hit lays it, grown by the ink tolerance.
function templateIn(frame, h, cfg) {
  const T = blank(frame.x0, frame.y0, frame.w, frame.h, frame.pxPerPt);
  drawInto(T, asArr(asObj(h.p.symbol).paths), { transform: (x, y) => placePoint(h.placement, x, y), scale: h.placement.k }, cfg);
  return dilate(T, Math.round(cfg.inkTol * frame.pxPerPt));
}
// Ink pixels of `own` (outside `skip` boxes) on `mask`, over all of them.
function coverage(own, mask, skip) {
  let n = 0, on = 0;
  const S = own.pxPerPt, w = own.w, h = own.h, od = own.data, md = mask.data, ns = skip.length, ox = own.x0, oy = own.y0;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      if (!od[i]) continue;
      if (ns) {
        const px = ox + (x + 0.5) / S, py = oy + (y + 0.5) / S;
        let inSkip = false;
        for (let k = 0; k < ns; k++) if (inBox(skip[k], px, py)) { inSkip = true; break; }
        if (inSkip) continue;
      }
      n++;
      if (md[i]) on++;
    }
  }
  return n ? on / n : 1;
}
// A prepared symbol that may be placed though it is not swept (plain or operator): points about a point apart.
function placeable(p) {
  if (p.checkable === true && asArr(p.points).length) return p;
  const pts = [];
  for (const g of asArr(p.segs).slice(0, 400)) {
    const n = Math.max(1, Math.min(400, Math.round(g[4])));
    for (let i = 0; i <= n; i++) pts.push(g[0] + (g[2] - g[0]) * i / n, g[1] + (g[3] - g[1]) * i / n);
  }
  return { ...p, checkable: true, points: pts };
}
// The segments of some pieces as drawingSegments gives them.
const segsOf = (S, pieces, min) => pieces.map(i => S[i]).filter(g => g && g[4] >= min).map(g => [g[0], g[1], g[2], g[3], g[4]]);
// The share of a piece's points (every half point) lying on a template.
function pieceOn(g, T) {
  if (!T || !T.w) return 0;
  const n = Math.max(2, Math.ceil(g[4] * 2));
  let on = 0;
  for (let k = 0; k <= n; k++) {
    const X = Math.floor((g[0] + (g[2] - g[0]) * k / n - T.x0) * T.pxPerPt), Y = Math.floor((g[1] + (g[3] - g[1]) * k / n - T.y0) * T.pxPerPt);
    if (X >= 0 && Y >= 0 && X < T.w && Y < T.h && T.data[Y * T.w + X]) on++;
  }
  return on / (n + 1);
}

// ── The pipe off a found symbol ──────────────────────────────────────────
// A valve found by the sweep is often joined in one shape with short stubs of
// its own pipe (shorter than the splitter's long run). The cut treats straight
// ink leaving the symbol's ends in line with its pipe connection as pipe.

const PIPE_EDGE = 0.5;      // a segment end this near the symbol's box edge is on it
const PIPE_SIN = 0.2;       // a connecting segment is not along the edge: sin of its angle to the edge above this
const PIPE_BEND = (35 * Math.PI) / 180;   // a line turning less than this at an edge point is a curve touching the edge
const PIPE_LONG = 1.2;      // no connection points: the long axis when one side is this much the other
const CUT_PARALLEL = 0.02;  // sin of the angle between a cut piece and the pipe line
const CUT_OFF = 1;          // a cut piece lies within this of the pipe line, ends within this of the box edge and of the next piece
const CUT_JOIN = 0.5;       // a piece not in line with the pipe within this of a piece's end makes a junction
const END_GAP = 4;          // points: a short bar ending a pipe this close to another found symbol is its connection

/**
 * Where a symbol's pipe runs through it, in the symbol's own frame:
 * { axis: 'h'|'v', at: [...] } (the y of each horizontal line, or the x of each
 * vertical one), or null for a symbol with no pipe axis (a bubble, an operator,
 * a squarish body with no connections). Never throws.
 */
export function pipeLines(prepared) {
  try {
    const p = asObj(prepared), w = p.w, h = p.h;
    if (!isNum(w) || !isNum(h) || !(w > 0) || !(h > 0) || p.bubble === true || p.operator === true) return null;
    const side = [], end = [];   // y of points on the left or right edges; x of points on the top or bottom edges
    const sides = new Set(), ends = new Set();   // which side (left 0, right 1) and which end (top 0, bottom 1) they are on
    const segs = asArr(p.segs).filter(g => Array.isArray(g) && g.slice(0, 4).every(isNum));
    // A bar straight across a long symbol, from one long side to the other (a gate's bar, a knife gate's blades), is no
    // pipe: the pipe runs along the symbol's length (contractor set, 2026-11-20: a wedge gate's pipe was never cut).
    const barAcross = g => {
      const upright = w >= PIPE_LONG * h, level = h >= PIPE_LONG * w;
      if (!upright && !level) return false;
      const k = upright ? 0 : 1, o = 1 - k, span = upright ? h : w;   // k: the coordinate the bar stands at
      if (Math.abs(g[2 + k] - g[k]) > PIPE_EDGE) return false;
      let lo = Infinity, hi = -Infinity;
      for (const q of segs) if (Math.abs(q[k] - g[k]) <= PIPE_EDGE && Math.abs(q[2 + k] - g[k]) <= PIPE_EDGE) { lo = Math.min(lo, q[o], q[2 + o]); hi = Math.max(hi, q[o], q[2 + o]); }
      return lo <= PIPE_EDGE && hi >= span - PIPE_EDGE;
    };
    // A body under a part standing clear of it (a bowtie under a T, a dome; owner, 2026-11-24: such valves were "extra"):
    // both sides (k 0) or both ends (k 1) are drawn as lines of one span stopping short of the box. The pipe runs through
    // the middle of that span; the body's corners there are no connections.
    for (const k of [0, 1]) {
      const v = k === 0 ? w : h, o = 1 - k, size = k === 0 ? h : w;
      if (v < PIPE_LONG * size) continue;   // the pipe runs along the symbol's length
      const span = e => { const L = segs.filter(g => Math.abs(g[k] - e) <= PIPE_EDGE && Math.abs(g[2 + k] - e) <= PIPE_EDGE);
        return L.length ? [Math.min(...L.map(q => Math.min(q[o], q[2 + o]))), Math.max(...L.map(q => Math.max(q[o], q[2 + o])))] : null; };
      const a = span(0), b = span(v);
      if (!a || !b || Math.abs(a[0] - b[0]) > PIPE_EDGE || Math.abs(a[1] - b[1]) > PIPE_EDGE) continue;
      if (a[0] <= PIPE_EDGE && a[1] >= size - PIPE_EDGE) continue;   // the whole height: nothing stands clear
      if (a[1] - a[0] < size / 2) continue;
      return { axis: k === 0 ? 'h' : 'v', at: [round3((a[0] + a[1] + b[0] + b[1]) / 4)] };
    }
    for (const g of segs) {
      const dx = g[2] - g[0], dy = g[3] - g[1], len = Math.hypot(dx, dy);
      if (!(len > 0) || barAcross(g)) continue;
      for (const [x, y] of [[g[0], g[1]], [g[2], g[3]]]) {
        const onSide = Math.abs(x) <= PIPE_EDGE || Math.abs(x - w) <= PIPE_EDGE, onEnd = Math.abs(y) <= PIPE_EDGE || Math.abs(y - h) <= PIPE_EDGE;
        if (onSide && onEnd) continue;   // a corner
        // Where the line carries on through the point turning less than PIPE_BEND, a curve touches the edge (a ball
        // valve's ball): that is no connection.
        if ((onSide || onEnd) && segs.some(q => {
          if (q === g) return false;
          const at0 = Math.hypot(q[0] - x, q[1] - y) <= 0.01, at1 = Math.hypot(q[2] - x, q[3] - y) <= 0.01;
          if (!at0 && !at1) return false;
          const ql = Math.hypot(q[2] - q[0], q[3] - q[1]);
          if (!(ql > 0)) return false;
          const ux = (x === g[0] && y === g[1] ? dx : -dx) / len, uy = (x === g[0] && y === g[1] ? dy : -dy) / len;   // g, away from the point
          const vx = (at0 ? q[2] - q[0] : q[0] - q[2]) / ql, vy = (at0 ? q[3] - q[1] : q[1] - q[3]) / ql;             // q, away from the point
          return ux * vx + uy * vy < -Math.cos(PIPE_BEND);
        })) continue;
        if (onSide && Math.abs(dx) / len > PIPE_SIN && y > PIPE_EDGE && y < h - PIPE_EDGE) { side.push(y); sides.add(Math.abs(x) <= PIPE_EDGE ? 0 : 1); }
        else if (onEnd && Math.abs(dy) / len > PIPE_SIN && x > PIPE_EDGE && x < w - PIPE_EDGE) { end.push(x); ends.add(Math.abs(y) <= PIPE_EDGE ? 0 : 1); }
      }
    }
    const uniq = v => [...new Set(v.map(round3))].sort((a, b) => a - b);
    if (side.length && !end.length) return { axis: 'h', at: uniq(side) };
    if (end.length && !side.length) return { axis: 'v', at: uniq(end) };
    // An angle body (PRESSURE RELIEF (ANGLE)): connections on one side and one end only, as an L. Its pipe turns:
    // both lines are cut.
    if (sides.size === 1 && ends.size === 1) return { axis: 'h', at: uniq(side), also: { axis: 'v', at: uniq(end) } };
    if (w >= PIPE_LONG * h) return { axis: 'h', at: [round3(h / 2)] };
    if (h >= PIPE_LONG * w) return { axis: 'v', at: [round3(w / 2)] };
    return null;
  } catch {
    return null;
  }
}

/**
 * The pieces of a shape (indexes into the split's segments S) that are a found
 * symbol's own pipe: straight pieces on one of its pipe lines, outside its box,
 * starting at its box edge and running outward through collinear pieces to the
 * first junction (the piece before a junction is cut, what meets there stays).
 * branches: indexes of other lines (not the shape's) that may meet a piece part way along it: such a piece is not cut
 * (one pipe piece running on past a tee is not all this symbol's own).
 * Never throws: hostile input gives [].
 */
export function cutPipe(S, pieces, hit, marks, branches) {
  try {
    const mk = marks instanceof Set ? marks : new Set();
    const br = Array.isArray(branches) ? branches.filter(j => Number.isInteger(j) && Array.isArray(S[j]) && S[j].slice(0, 4).every(isNum)) : [];
    // A branch's end meeting piece i away from both of its ends: a tee part way along it.
    const teeOn = i => { const q = S[i], a = [q[0], q[1]], b = [q[2], q[3]];
      const len = Math.hypot(q[2] - q[0], q[3] - q[1]);
      // A piece along the same line (the pipe drawn again, overlapping) is no branch.
      const along = j => { const g = S[j], gl = Math.hypot(g[2] - g[0], g[3] - g[1]);
        return gl > 0 && len > 0 && Math.abs((g[2] - g[0]) * (q[3] - q[1]) - (g[3] - g[1]) * (q[2] - q[0])) / (gl * len) < CUT_PARALLEL
          && Math.abs((g[0] - a[0]) * (b[1] - a[1]) - (g[1] - a[1]) * (b[0] - a[0])) / len <= CUT_OFF; };
      return br.some(j => j !== i && !along(j) && [[S[j][0], S[j][1]], [S[j][2], S[j][3]]].some(e => distToSeg(e, q) <= CUT_JOIN
        && Math.hypot(e[0] - a[0], e[1] - a[1]) > CUT_JOIN && Math.hypot(e[0] - b[0], e[1] - b[1]) > CUT_JOIN)); };
    if (!Array.isArray(S) || !Array.isArray(pieces) || !isHit(hit)) return [];
    const pl = pipeLines(hit.p);
    if (!pl) return [];
    const ok = i => Number.isInteger(i) && Array.isArray(S[i]) && S[i].slice(0, 4).every(isNum);
    const mine = [...new Set(pieces.filter(ok))];
    if (!mine.length) return [];
    const bb = placedBox(hit);
    if (!bb.every(isNum)) return [];
    const inset = [bb[0] + CUT_OFF, bb[1] + CUT_OFF, bb[2] - CUT_OFF, bb[3] - CUT_OFF];
    const insideInset = (x, y) => inset[0] < inset[2] && inset[1] < inset[3] && x > inset[0] && x < inset[2] && y > inset[1] && y < inset[3];
    const nearBox = (x, y) => x >= bb[0] - CUT_OFF && x <= bb[2] + CUT_OFF && y >= bb[1] - CUT_OFF && y <= bb[3] + CUT_OFF && !insideInset(x, y);
    const out = new Set();
    for (const [lines, at] of [pl, ...(pl.also ? [pl.also] : [])].flatMap(L => L.at.map(v => [L, v]))) {
      const a = lines.axis === 'h' ? placePoint(hit.placement, 0, at) : placePoint(hit.placement, at, 0);
      const b = lines.axis === 'h' ? placePoint(hit.placement, hit.p.w, at) : placePoint(hit.placement, at, hit.p.h);
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
      if (!isNum(L) || !(L > 0)) continue;
      const off = (x, y) => Math.abs((x - a[0]) * dy - (y - a[1]) * dx) / L;
      const collinear = i => {
        const q = S[i], len = Math.hypot(q[2] - q[0], q[3] - q[1]);
        return len > 0 && Math.abs((q[2] - q[0]) * dy - (q[3] - q[1]) * dx) / (len * L) < CUT_PARALLEL
          && off(q[0], q[1]) <= CUT_OFF && off(q[2], q[3]) <= CUT_OFF;
      };
      const line = new Set(mine.filter(collinear));
      // A line mark (a signal tick) on the line is no junction: the cut passes it, and takes it with the line.
      const isJunction = (x, y, self) => mine.some(j => j !== self && !line.has(j) && !mk.has(j) && distToSeg([x, y], S[j]) <= CUT_JOIN);
      const queue = [];
      for (const i of line) {
        const q = S[i];
        const in0 = insideInset(q[0], q[1]), in1 = insideInset(q[2], q[3]);
        // Pipe drawn on into the symbol (a union's own stub drawn with the pipe): one end inside, the other out past its box.
        const beyond = (x, y) => !nearBox(x, y) && !insideInset(x, y);
        if (in0 !== in1 && (in0 ? beyond(q[2], q[3]) : beyond(q[0], q[1]))) { queue.push([i, in0 ? [q[2], q[3]] : [q[0], q[1]]]); continue; }
        if (in0 || in1) continue;
        const e0 = nearBox(q[0], q[1]), e1 = nearBox(q[2], q[3]);
        if (e0 === e1) continue;   // both ends on the box edge (along it) or neither
        queue.push([i, e0 ? [q[2], q[3]] : [q[0], q[1]]]);
      }
      const seen = new Set();
      while (queue.length) {
        const [i, far] = queue.pop();
        if (seen.has(i)) continue;
        seen.add(i);
        if (teeOn(i)) continue;
        out.add(i);
        if (isJunction(far[0], far[1], i)) continue;
        for (const j of line) {
          if (seen.has(j)) continue;
          const q = S[j];
          const d0 = Math.hypot(q[0] - far[0], q[1] - far[1]), d1 = Math.hypot(q[2] - far[0], q[3] - far[1]);
          if (Math.min(d0, d1) > CUT_OFF) continue;
          const next = d0 <= d1 ? [q[2], q[3]] : [q[0], q[1]];
          if (insideInset(next[0], next[1]) || insideInset(q[0], q[1])) continue;
          queue.push([j, next]);
        }
      }
    }
    // The marks on what was cut go with it, every stroke of each.
    if (mk.size && out.size) {
      const near = (i, j) => distToSeg([S[j][0], S[j][1]], S[i]) <= CUT_JOIN || distToSeg([S[j][2], S[j][3]], S[i]) <= CUT_JOIN
        || distToSeg([S[i][0], S[i][1]], S[j]) <= CUT_JOIN || distToSeg([S[i][2], S[i][3]], S[j]) <= CUT_JOIN || segsCross(S[i], S[j]);   // a mark crossing the pipe
      for (let grew = true; grew;) {
        grew = false;
        for (const j of mine) if (mk.has(j) && !out.has(j) && [...out].some(i => near(i, j))) { out.add(j); grew = true; }
      }
    }
    return [...out].sort((x, y) => x - y);
  } catch {
    return [];
  }
}

// ── Sheet scale, size and the verdicts ────────────────────────────────────

export const AMBER_ALIKE = 0.8;      // no body found: the closest symbol scoring this (and AMBER_EXPLAINED) makes "drawn differently"
export const AMBER_EXPLAINED = 0.5;  // a body must explain this share of its shape (after the pipe cut) to be "extra linework"; a closest, to be "alike"
export const SIZE_TOL = 0.15;        // a body drawn more than this off the sheet's own symbol size is off size
export const JUDGE_BAND = Object.freeze([0.6, 1.6]);   // the judge looks for symbols at this share of the sheet's size, to this much of it
export const SCALE_SYMBOLS_MIN = 5;  // fewer symbols than this and the sheet's size is taken as the legend's (1)
export const LETTER_ROOM = 2;          // a lettered symbol's box holds at most this times its legend letters' share of writing
export const NEAR_RESCORE = 0.1;  // a sweep near miss scoring within this of recognise is scored again on its shape's own ink
export const PEEL_NEW = 0.5;     // a part peeled off a shape must lay this share of its template on ink no earlier part explains
const bodyBoxes = new WeakMap();   // a judged shape -> the boxes of its found symbols (not operators)
export const PEEL_MAX = 8;       // parts peeled off one shape, at most
export const MARK_MIN = 0.4;     // line marks are matched from this share of the legend's size
const LEAD_PIECES = 200;         // pieces followed along one lead, at most
const LEAD_RING = 6;             // points: a ring no bigger than this that a marker's lead runs through goes with the lead
export const OP_ON_BODY = 0.25;  // an operator laying more of its linework than this inside a found body, along its pipe, lies across it
const FILL_TWIN = 0.25;         // loops within this share of a filled loop's size are its twins, filled alike
const FILL_DENSITY = 0.2;        // ink filling this share of a body's closed outline (inside its lines) is its fill (normally closed)
export const GREEN_SWITCH = 0.5;   // fewer than this share of the shapes standard when read by drawn paths: read by line pieces too

export const OVERLAY_MAX = 200;   // segments kept in each list of a shape's overlay

/** At most `max` entries of a list, evenly spread (first kept); a short list as it is; [] for a non-list. Never throws. */
export function thinTo(list, max = OVERLAY_MAX) {
  try {
    const a = asArr(list);
    if (a.length <= max) return a.slice();
    const out = [];
    for (let i = 0; i < max; i++) out.push(a[Math.floor(i * a.length / max)]);
    return out;
  } catch {
    return [];
  }
}

/** The sheet's own symbol size: the median of hit.k over the hits; 1 when fewer than SCALE_SYMBOLS_MIN have one. Never throws. */
export function sizeScaleOf(hits) {
  try {
    const ks = asArr(hits).map(h => asObj(h).k).filter(k => isNum(k) && k > 0).sort((a, b) => a - b);
    if (ks.length < SCALE_SYMBOLS_MIN) return 1;
    const m = ks.length >> 1;
    return ks.length % 2 ? ks[m] : (ks[m - 1] + ks[m]) / 2;
  } catch {
    return 1;
  }
}

/**
 * How big a hit is drawn against its legend symbol: its placed box's longer side
 * over the symbol's longer side (a box fit: the scale it was fitted at, recorded
 * by boxFit as placement.fitK). 1 for anything that is not a hit. Never throws.
 */
export function hitSize(hit) {
  try {
    if (!isHit(hit)) return 1;
    if (isNum(hit.placement.fitK) && hit.placement.fitK > 0) return hit.placement.fitK;
    const b = placedBox(hit), side = Math.max(hit.p.w, hit.p.h), got = Math.max(b[2] - b[0], b[3] - b[1]) / side;
    return isNum(got) && got > 0 ? got : 1;
  } catch {
    return 1;
  }
}

// A symbol drawn as one straight line (a single segment, or every segment collinear and joined across the whole longer side).
function isOneLine(prepared) {
  try {
    const p = asObj(prepared);
    const segs = asArr(p.segs).filter(g => Array.isArray(g) && g.slice(0, 5).every(isNum) && g[4] > 0);
    if (!segs.length) return false;
    if (segs.length === 1) return true;
    const a = segs[0];
    const flat = segs.every(g => Math.abs((g[2] - g[0]) * (a[3] - a[1]) - (g[3] - g[1]) * (a[2] - a[0])) <= 0.02 * g[4] * a[4]
      && Math.abs((g[0] - a[0]) * (a[3] - a[1]) - (g[1] - a[1]) * (a[2] - a[0])) <= 0.3 * a[4]);
    return flat && longestJoined(segs) >= Math.max(asObj(p).w, asObj(p).h) - 1;
  } catch {
    return false;
  }
}

export const HEAD_ZONE = 0.35;   // a line with a head: all ink off its stem lies within this share of the length from one end

// The longest segment's line of a prepared symbol, and the along-line span of every segment on it: { a, t0, t1, off } or null.
function stemOf(p) {
  const segs = asArr(asObj(p).segs).filter(g => Array.isArray(g) && g.slice(0, 5).every(isNum) && g[4] > 0);
  if (!segs.length) return null;
  const a = segs.reduce((m, g) => (g[4] > m[4] ? g : m), segs[0]);
  const ux = (a[2] - a[0]) / a[4], uy = (a[3] - a[1]) / a[4];
  const offOf = (x, y) => Math.abs((x - a[0]) * uy - (y - a[1]) * ux), along = (x, y) => (x - a[0]) * ux + (y - a[1]) * uy;
  const on = [], off = [];
  for (const g of segs) {
    const par = Math.abs(ux * (g[3] - g[1]) - uy * (g[2] - g[0])) / g[4] <= 0.02;
    (par && offOf(g[0], g[1]) <= 0.3 && offOf(g[2], g[3]) <= 0.3 ? on : off).push(g);
  }
  const ts = on.flatMap(g => [along(g[0], g[1]), along(g[2], g[3])]);
  return { a, ux, uy, along, offOf, t0: Math.min(...ts), t1: Math.max(...ts), off };
}

/**
 * A symbol drawn as one straight line with a head at one end (sheet 4's FLOW DIRECTION ARROW): the line runs
 * its whole longer side and every other segment lies within HEAD_ZONE of the length from one end. Never throws.
 */
export function isLineWithHead(prepared) {
  try {
    const p = asObj(prepared), st = stemOf(p);
    if (!st || !st.off.length) return false;
    const L = Math.max(p.w, p.h);
    if (!(L > 0) || st.t1 - st.t0 < L - 1) return false;
    const ends = st.off.flatMap(g => [st.along(g[0], g[1]), st.along(g[2], g[3])]);
    return ends.every(t => t <= st.t0 + HEAD_ZONE * L) || ends.every(t => t >= st.t1 - HEAD_ZONE * L);
  } catch {
    return false;
  }
}

/**
 * Whether a placed line with a head shows its head on the drawing (win: { near }, the ink grown by the
 * tolerance). A head point tells only where the stem's own ink, at its middle and the same offset, is not ink;
 * at least 3 telling points, and LINE_MIN of them on ink. False for anything else. Never throws.
 */
export function headDrawn(hit, win) {
  try {
    if (!isHit(hit) || !isLineWithHead(hit.p)) return false;
    const m = asObj(win).near;
    if (!m || !m.data) return false;
    const at = (x, y) => { const X = Math.floor((x - m.x0) * m.pxPerPt), Y = Math.floor((y - m.y0) * m.pxPerPt); return X >= 0 && Y >= 0 && X < m.w && Y < m.h && !!m.data[Y * m.w + X]; };
    const st = stemOf(hit.p), mid = (st.t0 + st.t1) / 2, pts = asArr(hit.p.points);
    let tell = 0, on = 0;
    for (let i = 0; i + 1 < pts.length; i++, i++) {
      const x = pts[i], y = pts[i + 1], d = (x - st.a[0]) * st.uy - (y - st.a[1]) * st.ux;   // signed offset from the stem
      if (Math.abs(d) * hit.placement.k <= 0.25) continue;
      const mx = st.a[0] + st.ux * mid + st.uy * d, my = st.a[1] + st.uy * mid - st.ux * d;
      if (at(...placePoint(hit.placement, mx, my))) continue;   // the line itself is this wide: this point cannot tell
      tell++;
      if (at(...placePoint(hit.placement, x, y))) on++;
    }
    return tell >= 3 && on >= LINE_MIN * tell;
  } catch {
    return false;
  }
}

/**
 * The verdict of one judged shape: { verdict, reason }. Input: { bodies: [{ name, size }] (the found
 * symbols that are not operators, size as hitSize), explained (the share of the shape the found symbols explain),
 * closest: { name, score, explained, oneLine? } | null, sizeScale (default 1), shapeExplained }.
 *   - bodies, all ink explained: standard, or off size (the worst body, more than SIZE_TOL off).
 *   - bodies explaining AMBER_EXPLAINED or more, ink left over: off size, else "extra" naming the first body.
 *   - otherwise: the closest at AMBER_ALIKE and AMBER_EXPLAINED is "differs" (never a one-line symbol), else not identified.
 * Never throws.
 */
export function shapeVerdict(input) {
  try {
    const o = asObj(input), scale = isNum(o.sizeScale) && o.sizeScale > 0 ? o.sizeScale : 1;
    const bodies = asArr(o.bodies).filter(b => b && typeof b === 'object' && typeof b.name === 'string');
    const explained = isNum(o.explained) ? o.explained : 0;
    const need = isNum(o.shapeExplained) ? o.shapeExplained : CHECK_DEFAULTS.shapeExplained;
    let off = null;
    for (const b of bodies) {
      const rel = isNum(b.size) ? b.size / scale : 1, dev = Math.abs(rel - 1);
      if (dev > SIZE_TOL && (!off || dev > off.dev)) off = { dev, name: b.name, pct: Math.round(rel * 100) };
    }
    const sized = () => ({ verdict: 'not-standard', reason: { kind: 'size', name: off.name, pct: off.pct } });
    if (bodies.length && explained >= need) return off ? sized() : { verdict: 'standard', reason: null };
    if (bodies.length && explained >= AMBER_EXPLAINED) return off ? sized() : { verdict: 'not-standard', reason: { kind: 'extra', name: bodies[0].name } };
    const c = asObj(o.closest);
    if (o.closest && isNum(c.score) && isNum(c.explained) && c.score >= AMBER_ALIKE && c.explained >= AMBER_EXPLAINED && c.oneLine !== true && c.bubble !== true && typeof c.name === 'string') {
      return { verdict: 'not-standard', reason: { kind: 'differs', name: c.name, pct: Math.round(c.score * 100) } };
    }
    return { verdict: 'not-identified', reason: null };
  } catch {
    return { verdict: 'not-identified', reason: null };
  }
}

/**
 * Judge every shape of a split sheet. ctx = { cfg, prepared, boxed, paths,
 * split (sheetShapes' result), spots: [{ hit, symbol (index into the listed
 * symbols) }], near, rejected, writing, deadline, sizeScale (default 1) }. Returns ShapeOut[]:
 * { id, box, standard: true|false|null, verdict ('standard'|'not-standard'|'not-identified'|'not-judged'),
 * reason (null, or { kind: 'differs'|'size'|'extra', ... }), why, explained, share, symbols,
 * operator, closest }. Never throws: hostile input gives [].
 */
export function judgeShapes(ctx) {
  try {
    const c = asObj(ctx), split = asObj(c.split), S = asArr(split.segments);
    let shapesIn = asArr(split.shapes).filter(sh => sh && Array.isArray(sh.pieces) && Array.isArray(sh.box) && sh.box.length === 4 && sh.box.every(isNum)
      && sh.pieces.every(i => Number.isInteger(i) && Array.isArray(S[i])));
    if (!shapesIn.length && !asArr(c.spots).length) return [];
    const cfg = c.cfg && typeof c.cfg === 'object' ? c.cfg : settings();
    // Judge-only symbols (Sheet 1's samples) are placeable here as any checkable one; line marks are not bodies.
    const prepared = asArr(c.prepared).map(p => (p && p.judgeOnly === true && !p.lineMark && p.judgeWhy === '' ? { ...p, checkable: true, why: '' } : p)), boxed = asArr(c.boxed), paths = asArr(c.paths), writing = asArr(c.writing);
    const deadline = isNum(c.deadline) ? c.deadline : Infinity;
    const sizeScale = isNum(c.sizeScale) && c.sizeScale > 0 ? c.sizeScale : 1;
    // The judge looks for symbols at the sheet's own size: every placement it proposes is inside this band.
    const band = { ...cfg, minScale: JUDGE_BAND[0] * sizeScale, maxScale: JUDGE_BAND[1] * sizeScale };
    // The stretched fit keeps its own band at the legend's size and widens it to the sheet's own symbol size (a sheet
    // printed at 43% fits at 43%; one drawn at 122% still finds a symbol drawn at the legend's size or below it).
    // Unchanged at size 1.
    const fitBand = { ...cfg, minScale: Math.min(cfg.minScale, cfg.minScale * sizeScale), maxScale: Math.max(cfg.maxScale, cfg.maxScale * sizeScale) };
    const PX = cfg.pxPerPt, tolPx = Math.round(cfg.inkTol * PX);
    const linePieces = [];
    for (const l of asArr(split.lines)) for (const i of asArr(asObj(l).pieces)) if (Array.isArray(S[i])) linePieces.push(i);
    const arrowUnits = asArr(split.arrows).map(m => asArr(m).filter(i => Number.isInteger(i) && Array.isArray(S[i]))).filter(m => m.length);
    // A path drawn twice (C and H2 draw every stroke twice) is judged once: a path whose pieces in a shape all repeat
    // those of one earlier path with the same fill, stroke and width is left out. Its ink is the same, and twin pieces
    // otherwise read as joints (a mark's tick "runs on" from its own copy; a lead branches into its copy).
    const pieceKey = q => { const a = Math.round(q[0] * 2) + ',' + Math.round(q[1] * 2), b = Math.round(q[2] * 2) + ',' + Math.round(q[3] * 2); return a < b ? a + '|' + b : b + '|' + a; };
    const sameInk = (p, q) => !!p && !!q && !!p.filled === !!q.filled && !!p.stroked === !!q.stroked && Math.abs((p.width || 0) - (q.width || 0)) <= 0.01;
    const dropTwins = pieces => {
      const byPath = new Map();
      for (const i of pieces) { const k = S[i][5]; if (!byPath.has(k)) byPath.set(k, []); byPath.get(k).push(i); }
      if (byPath.size < 2) return pieces;
      const owners = new Map(), drop = new Set();
      for (const [pi, list] of byPath) {
        const keys = list.map(i => pieceKey(S[i]));
        let cands = null;
        for (const k of keys) { const o = owners.get(k); cands = cands === null ? new Set(o || []) : new Set([...cands].filter(x => o && o.has(x))); if (!cands.size) break; }
        if (cands && [...cands].some(q => sameInk(paths[q], paths[pi]) && byPath.get(q).length === list.length)) { drop.add(pi); continue; }
        for (const k of keys) { if (!owners.has(k)) owners.set(k, new Set()); owners.get(k).add(pi); }
      }
      return drop.size ? pieces.filter(i => !drop.has(S[i][5])) : pieces;
    };
    shapesIn = shapesIn.map(sh => { const pieces = dropTwins(sh.pieces); return pieces.length === sh.pieces.length ? sh : { ...sh, pieces }; });

    // 1. Found symbols to shapes; a symbol sharing ink with two shapes joins them; line pieces on its template go with it.
    const groups = shapesIn.map(sh => ({ pieces: new Set(sh.pieces), spots: [], closed: sh.closed === true, id: sh.id }));
    const parent = groups.map((_, i) => i);
    const find = k => { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; };
    const ownNear = new Map();
    const nearOf = gi => {
      if (!ownNear.has(gi)) {
        const b = shapesIn[gi].box, fr = { x0: b[0] - 2, y0: b[1] - 2, w: Math.ceil((b[2] - b[0] + 4) * PX), h: Math.ceil((b[3] - b[1] + 4) * PX) };
        let T = null;
        if (fr.w > 0 && fr.h > 0 && fr.w <= MAX_SIDE && fr.h <= MAX_SIDE) {
          T = blank(fr.x0, fr.y0, fr.w, fr.h, PX);
          drawInto(T, piecePaths(split, shapesIn[gi].pieces, paths), {}, cfg);
          T = dilate(T, tolPx);
        }
        ownNear.set(gi, T);
      }
      return ownNear.get(gi);
    };
    const spotList = asArr(c.spots).filter(sp => sp && isHit(sp.hit));
    const loose = [];   // spots with no shape: they may make one from line pieces
    for (const sp of spotList) {
      const hb = placedBox(sp.hit), shares = [];
      groups.forEach((g, gi) => { if (overlaps(shapesIn[gi].box, hb, 1)) { const sh = shareOn(sp.hit, nearOf(gi)); if (sh >= SPOT_SHARE) shares.push([sh, gi]); } });
      shares.sort((a, b) => b[0] - a[0]);
      const tpl = hitTemplate(sp.hit, cfg);
      const through = linePieces.filter(i => { const g = S[i]; return overlaps([Math.min(g[0], g[2]), Math.min(g[1], g[3]), Math.max(g[0], g[2]), Math.max(g[1], g[3])], hb, 1) && pieceOn(g, tpl) >= THROUGH_SHARE; });
      if (!shares.length) { if (through.length) loose.push({ sp, through }); continue; }
      const home = shares[0][1];
      for (const [, gi] of shares.slice(1)) { const a = find(gi), b = find(home); if (a !== b) parent[a] = b; }
      groups[home].spots.push(sp);
      for (const i of through) groups[home].pieces.add(i);
    }
    for (const { sp, through } of loose) groups.push({ pieces: new Set(through), spots: [sp], closed: false, id: Infinity }), parent.push(parent.length);
    const merged = new Map();
    groups.forEach((g, gi) => {
      const r = find(gi);
      if (!merged.has(r)) merged.set(r, { pieces: new Set(), spots: [], closed: false, id: Infinity });
      const m = merged.get(r);
      for (const i of g.pieces) m.pieces.add(i);
      m.spots.push(...g.spots); m.closed = m.closed || (g.closed && groups.filter((_, k) => find(k) === r).length === 1); m.id = Math.min(m.id, g.id);
    });
    const finals = [...merged.values()].filter(m => m.pieces.size).map(m => ({ ...m, pieces: [...m.pieces], box: boxOfPieces(S, [...m.pieces]) }))
      .sort((a, b) => (Math.round(a.box[1]) - Math.round(b.box[1])) || (a.box[0] - b.box[0]));

    // Symbols the judge may place: operators, plain ones, bubbles; and the sweep's candidates.
    const operators = prepared.filter(p => p && p.operator === true && asArr(p.keys).length).map(placeable);
    const opReach = operators.reduce((m, p) => Math.max(m, p.w, p.h), 0) * band.maxScale;
    // Attachments: the owner's operators and the legend symbols the attachments setting names (owner, 2026-11-18).
    const normed = n => str(n).replace(/\s+/g, ' ').trim().toUpperCase();
    const attachNames = new Set(asArr(cfg.attachments).filter(n => typeof n === 'string').map(normed));
    const isAttachment = p => !!p && (p.operator === true || attachNames.has(normed(nameOf(p))));
    const attachments = prepared.filter(p => p && isAttachment(p) && asArr(p.keys).length && asArr(p.segs).length && !isOneLine(p)).map(placeable);
    const attReach = attachments.reduce((m, p) => Math.max(m, p.w, p.h), 0) * band.maxScale;
    // A symbol drawn as one straight line matches any line: it is never a standalone fit (plain, box or loose).
    const plains = prepared.filter(p => p && !p.operator && !p.bubble && asArr(p.keys).length && asArr(p.segs).length <= 400
      && (p.why === 'simple' || plainShape(p)) && !isOneLine(p) && !isLineWithHead(p) && !isAttachment(p)).map(placeable);
    const bubbles = prepared.filter(p => p && p.checkable && p.bubble);
    // An attachment found alone is a body (a reducer on a pipe keeps the size rule); only a small plain one (a flange
    // tick, a padlock, a capped end) never fits on its own.
    const smallAttachment = p => isAttachment(p) && (p.why === 'simple' || plainShape(p));
    const looseable = prepared.filter(p => p && p.checkable && !p.bubble && !p.operator && !isOneLine(p) && !isLineWithHead(p) && !smallAttachment(p));
    // Every symbol a shape may be fitted to at its own proportions (bubbles are matched by their outline).
    const fittable = prepared.filter(p => p && (p.checkable || p.toSuit) && !p.bubble && !p.operator && asArr(p.points).length && !isOneLine(p) && !isLineWithHead(p) && !smallAttachment(p));
    // Touching standard symbols that may be peeled off a shape: a full match on their own ink; small plain ones are attachments only.
    const peelable = fittable.filter(p => p.why !== 'simple' && !isAttachment(p));
    const nearList = asArr(c.near).filter(isHit), rejected = asArr(c.rejected).filter(isHit);
    const minKey = 0.75 * cfg.minKeyLine;
    // Line marks (Sheet 1's signal ticks, lagging hatches): small ink crossing a straight line that a stored mark,
    // laid along the line, explains. Returns the set of pieces that are mark ink.
    const marks = prepared.filter(p => p && p.lineMark && asArr(p.segs).length).map(placeable);
    const markMax = marks.reduce((m, p) => Math.max(m, p.w, p.h), 0) * band.maxScale + 1;
    const touchesSeg = (a, b) => distToSeg([a[0], a[1]], b) <= 0.5 || distToSeg([a[2], a[3]], b) <= 0.5 || distToSeg([b[0], b[1]], a) <= 0.5 || distToSeg([b[2], b[3]], a) <= 0.5 || segsCross(a, b);
    const markInk = (pieces, lineCands) => {
      const found = new Set();
      if (!marks.length) return found;
      if (!pieces.length) return found;
      // Only lines near the shape can carry its marks.
      const pb = boxOfPieces(S, pieces), reach = [pb[0] - markMax, pb[1] - markMax, pb[2] + markMax, pb[3] + markMax];
      const straight = [...new Set(lineCands)].filter(i => { const q = S[i]; return q[4] >= 3 && (Math.abs(q[1] - q[3]) <= 0.02 * q[4] || Math.abs(q[0] - q[2]) <= 0.02 * q[4])
        && overlaps([Math.min(q[0], q[2]), Math.min(q[1], q[3]), Math.max(q[0], q[2]), Math.max(q[1], q[3])], reach, 0); });
      const endAt = new Map(), endKey = (x, y) => Math.round(x * 2) + ',' + Math.round(y * 2);
      for (const i of straight) for (const [x, y] of [[S[i][0], S[i][1]], [S[i][2], S[i][3]]]) {
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const k = endKey(x + dx / 2, y + dy / 2); if (!endAt.has(k)) endAt.set(k, []); endAt.get(k).push(i); }
      }
      const endNear = i => [...new Set([endAt.get(endKey(S[i][0], S[i][1])) || [], endAt.get(endKey(S[i][2], S[i][3])) || []].flat())];
      // A line is longer than any mark, or runs on from another straight piece end to end in line with it; a short
      // straight piece standing alone is a mark's own tick (SIGNAL - ELECTRIC's Z has ticks along the line).
      const level = q => Math.abs(q[1] - q[3]) <= 0.02 * q[4];
      const runsOn = (i, j) => { const a = S[i], b = S[j]; if (level(a) !== level(b) || pieceKey(a) === pieceKey(b)) return false;   // its own copy is no run
        const off = level(a) ? Math.abs(a[1] - b[1]) : Math.abs(a[0] - b[0]);
        return off <= 0.5 && [[a[0], a[1]], [a[2], a[3]]].some(p => Math.hypot(p[0] - b[0], p[1] - b[1]) <= 0.5 || Math.hypot(p[0] - b[2], p[1] - b[3]) <= 0.5); };
      const lines = straight.filter(i => S[i][4] > markMax || endNear(i).some(j => j !== i && runsOn(i, j)));
      if (!lines.length) return found;
      const lineSet = new Set(lines), rest = pieces.filter(i => !lineSet.has(i) && S[i][4] <= markMax);
      const seen = new Set();
      for (const i0 of rest) {
        if (seen.has(i0)) continue;
        const cl = [i0];
        seen.add(i0);
        for (let k = 0; k < cl.length; k++) for (const j of rest) if (!seen.has(j) && touchesSeg(S[cl[k]], S[j])) { seen.add(j); cl.push(j); }
        const cb = boxOfPieces(S, cl);
        if (Math.max(cb[2] - cb[0], cb[3] - cb[1]) > markMax) continue;
        const touched = lines.filter(L => cl.some(i => touchesSeg(S[i], S[L])));
        if (!touched.length) continue;
        // The line the mark sits on, with the pieces it runs on into (a pipe cut at a junction beside the mark).
        const onAll = [...new Set([...touched, ...touched.flatMap(T => endNear(T).filter(L => lineSet.has(L) && runsOn(L, T)))])];
        const fr = frameAround(cb, markMax);
        if (!frameOk(fr)) continue;
        const clInk = inkOf(fr, cl), centre = centreOf(cb), radius = Math.hypot(cb[2] - cb[0], cb[3] - cb[1]) / 2 + 2;
        // A mark sits on one line: it is matched on each line it touches in turn (level, then upright), so a line crossing
        // there (a tank wall across a signal line) is not read as part of it.
        let ok = false;
        for (const on of [onAll.filter(i => level(S[i])), onAll.filter(i => !level(S[i]))].filter(g => g.length)) {
          if (ok) break;
          const ink = inkOf(fr, [...cl, ...on]), mwin = { ink, near: dilate(ink, tolPx) };
          const segs = segsOf(S, [...cl, ...on], 0.5);
          for (const p of marks) {
            // Line marks are drawn at any size along their line (a legend's line-type samples are drawn large): from MARK_MIN.
            for (const pl of proposePlacements(p, segs, centre, { ...band, minScale: MARK_MIN * sizeScale, radius })) {
              const sc = scorePlacement(p, pl, mwin, cfg);
              if (!sc || sc.score < cfg.recognise) continue;
              const h = { p, placement: pl, score: sc.score };
              if (weakestLine(h, mwin, cfg) < LINE_MIN || coverage(clInk, templateIn(fr, h, cfg), []) < cfg.shapeExplained) continue;
              ok = true;
              break;
            }
            if (ok) break;
          }
        }
        if (ok) for (const i of cl) found.add(i);
      }
      found.lines = lineSet;   // the straight pieces taken as the line the marks sit on
      return found;
    };
    // The writing a lettered symbol's box may hold: no more than LETTER_ROOM times the share of the box its own
    // letters take in the legend (a text box "HOLD 1" is no LEVEL - GENERAL; owner, 2026-11-19).
    const lettersRoomOk = (p, B) => {
      const sym = asObj(asObj(p).symbol), letters = asArr(sym.letters).filter(l => l && isNum(l.size) && l.size > 0);
      if (!letters.length || !(sym.w > 0 && sym.h > 0)) return true;
      const own = letters.reduce((m, l) => m + 0.42 * l.size * l.size, 0) / (sym.w * sym.h), area = (B[2] - B[0]) * (B[3] - B[1]);
      if (!(area > 0)) return false;
      let got = 0;
      for (const b of writing) if (Array.isArray(b) && b.length === 4 && b.every(isNum)) got += Math.max(0, Math.min(b[2], B[2]) - Math.max(b[0], B[0])) * Math.max(0, Math.min(b[3], B[3]) - Math.max(b[1], B[1]));
      return got / area <= LETTER_ROOM * own;
    };
    const frameAround = (box, g) => ({ x0: box[0] - g, y0: box[1] - g, w: Math.ceil((box[2] - box[0] + 2 * g) * PX), h: Math.ceil((box[3] - box[1] + 2 * g) * PX), pxPerPt: PX });
    const frameOk = fr => fr.w > 0 && fr.h > 0 && fr.w <= MAX_SIDE && fr.h <= MAX_SIDE;
    const inkOf = (fr, pieces) => { const b = blank(fr.x0, fr.y0, fr.w, fr.h, PX); drawInto(b, piecePaths(split, pieces, paths), {}, cfg); return b; };
    const fullOf = fr => {
      const b = blank(fr.x0, fr.y0, fr.w, fr.h, PX);
      drawInto(b, boxed.filter(q => q.b[2] >= fr.x0 && q.b[0] <= fr.x0 + fr.w / PX && q.b[3] >= fr.y0 && q.b[1] <= fr.y0 + fr.h / PX).map(q => q.p), {}, cfg);
      return b;
    };
    let piecesOfPath = null;   // path index -> its pieces, read once when first needed
    const linesIn = fr => linePieces.filter(i => { const q = S[i]; return inBox([fr.x0, fr.y0, fr.x0 + fr.w / PX, fr.y0 + fr.h / PX], (q[0] + q[2]) / 2, (q[1] + q[3]) / 2); });
    // The best legend operator laid on the ink `left` (what the bodies leave unexplained), within reach of a body.
    const bestOperator = (fr, left, nearFull, pieces, bodyHits) => {
      const opWin = { ink: left, near: nearFull };
      const segs = segsOf(S, [...pieces, ...linesIn(fr)], minKey);
      let best = null;
      for (const h of bodyHits) {
        const bb = placedBox(h), centre = centreOf(bb), reach = Math.hypot(bb[2] - bb[0], bb[3] - bb[1]) / 2 + opReach;
        for (const p of operators) {
          for (const pl of proposePlacements(p, segs, centre, { ...band, radius: reach })) {
            const sc = scorePlacement(p, pl, opWin, cfg);
            if (!sc || sc.score < cfg.recognise) continue;
            const hit = { p, placement: pl, score: sc.score };
            if (weakestLine(hit, opWin, cfg) < LINE_MIN) continue;
            if (!best || sc.score > best.score) best = hit;
          }
        }
      }
      return best;
    };

    // 2. An operator the splitter cut from its body (its stem standing on the
    // body's edge, or its head an outline with writing in it) joins the body
    // again: a neighbouring shape with no symbol found in it, no bigger than an
    // operator or the body, goes with the body when a legend operator laid on
    // the two explains half its ink, or (no writing in it) when a connector
    // not in line with a pipe joins the two (the stem). So an operator that is
    // not in the legend is flagged with its body, never passed silently.
    const ownerOf = new Map();
    finals.forEach((f, fi) => { for (const i of f.pieces) ownerOf.set(i, fi); });
    const runPieces = [];
    for (const l of asArr(split.lines)) if (l && l.kind === 'run') for (const i of asArr(l.pieces)) if (Array.isArray(S[i])) runPieces.push(i);
    const touching = (pt, fi) => finals[fi].pieces.some(i => { const q = S[i]; return distToSeg(pt, q) <= 0.75; });
    const inLineWithPipe = (a, b) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
      if (!(L > 0)) return false;
      const off = q => Math.abs((q[0] - a[0]) * dy - (q[1] - a[1]) * dx) / L;
      return runPieces.some(i => { const q = S[i]; return off([q[0], q[1]]) <= 0.5 && off([q[2], q[3]]) <= 0.5; });
    };
    // A connector lying on a found body's own pipe line runs on as its pipe (a gate piped to a reducer), never a stem.
    const alongBodyPipe = (a, b, f) => f.spots.some(sp => {
      const h = sp.hit, pl = !h.p.operator && pipeLines(h.p);
      if (!pl) return false;
      return [pl, ...(pl.also ? [pl.also] : [])].some(L => L.at.some(v => {
        const p0 = L.axis === 'h' ? placePoint(h.placement, 0, v) : placePoint(h.placement, v, 0);
        const p1 = L.axis === 'h' ? placePoint(h.placement, h.p.w, v) : placePoint(h.placement, v, h.p.h);
        const dx = p1[0] - p0[0], dy = p1[1] - p0[1], len = Math.hypot(dx, dy);
        return len > 0 && [a, b].every(q => Math.abs((q[0] - p0[0]) * dy - (q[1] - p0[1]) * dx) / len <= CUT_OFF);
      }));
    });
    const isBody = f => f.spots.some(sp => !sp.hit.p.operator);
    const merged2 = new Set();
    // An empty closed outline a bubble fits at a bubble's size on this sheet is a bubble (owner, 2026-11-20), never an
    // operator on a stem (D18197: the lower of two stacked bubbles standing on a flowmeter).
    const ringMemo = new Map();
    const bubbleRing = gi => {
      if (!ringMemo.has(gi)) {
        const g = finals[gi], fr = frameAround(g.box, 2);
        let yes = false;
        if (bubbles.length && frameOk(fr)) {
          const m = matchBubble(bubbles, g.box, { ink: inkOf(fr, g.pieces), near: dilate(fullOf(fr), tolPx) }, cfg);
          yes = !!m.best && isNum(m.best.k) && m.best.k >= band.minScale && m.best.k <= band.maxScale;
        }
        ringMemo.set(gi, yes);
      }
      return ringMemo.get(gi);
    };
    if (operators.length || asArr(split.lines).some(l => l && l.kind === 'connector')) {
      const connectors = asArr(split.lines).filter(l => l && l.kind === 'connector').map(l => asArr(l.pieces).filter(i => Array.isArray(S[i])));
      finals.forEach((f, fi) => {
        if (merged2.has(fi) || !isBody(f) || clock() > deadline) return;
        const side = Math.max(f.box[2] - f.box[0], f.box[3] - f.box[1]), limit = Math.max(opReach, side);
        const cand = [];
        finals.forEach((g, gi) => {
          if (gi === fi || merged2.has(gi) || g.spots.length) return;
          if (Math.max(g.box[2] - g.box[0], g.box[3] - g.box[1]) > limit) return;
          const gap = Math.max(g.box[0] - f.box[2], f.box[0] - g.box[2], g.box[1] - f.box[3], f.box[1] - g.box[3], 0);
          if (gap <= Math.max(opReach, side / 2)) cand.push(gi);
        });
        if (!cand.length) return;
        const take = new Set(), stems = [];
        // The stem: a connector with one end on the body and the other on the neighbour, not in line with a pipe.
        for (const c of connectors) {
          if (!c.length) continue;
          const ends = c.flatMap(i => [[S[i][0], S[i][1]], [S[i][2], S[i][3]]]);
          const a = ends[0], b = ends.reduce((m, e) => (Math.hypot(e[0] - a[0], e[1] - a[1]) > Math.hypot(m[0] - a[0], m[1] - a[1]) ? e : m), a);
          const lo = ends.reduce((m, e) => (Math.hypot(e[0] - b[0], e[1] - b[1]) > Math.hypot(m[0] - b[0], m[1] - b[1]) ? e : m), b);
          const onBody = touching(lo, fi) || touching(b, fi);
          if (!onBody || inLineWithPipe(lo, b) || alongBodyPipe(lo, b, f)) continue;
          for (const gi of cand) {
            const far = touching(lo, fi) ? b : lo;
            if (!touching(far, gi)) continue;
            const g = finals[gi];
            if (g.closed && (hasWriting(writing, g.box) || bubbleRing(gi))) continue;
            take.add(gi); stems.push(...c);
          }
        }
        // A legend operator laid on body and neighbours together.
        if (operators.length) {
          const box = [f.box, ...cand.map(gi => finals[gi].box)].reduce((u, b) => [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])]);
          const fr = frameAround(box, 2);
          if (frameOk(fr)) {
            const pieces = [...f.pieces, ...cand.flatMap(gi => finals[gi].pieces)];
            const own = inkOf(fr, pieces), nearFull = dilate(fullOf(fr), tolPx);
            const mask = blank(fr.x0, fr.y0, fr.w, fr.h, PX);
            const bodyHits = f.spots.filter(sp => !sp.hit.p.operator).map(sp => sp.hit);
            for (const h of bodyHits) { const T = templateIn(fr, h, cfg); for (let i = 0; i < mask.data.length; i++) if (T.data[i]) mask.data[i] = 1; }
            const left = blank(fr.x0, fr.y0, fr.w, fr.h, PX);
            for (let i = 0; i < left.data.length; i++) left.data[i] = own.data[i] && !mask.data[i] ? 1 : 0;
            const op = bestOperator(fr, left, nearFull, pieces, bodyHits);
            if (op) {
              const T = templateIn(fr, op, cfg);
              for (const gi of cand) if (coverage(inkOf(fr, finals[gi].pieces), T, []) >= 0.5) take.add(gi);
            }
          }
        }
        if (!take.size) return;
        const all = new Set(f.pieces);
        for (const gi of take) { for (const i of finals[gi].pieces) all.add(i); merged2.add(gi); }
        for (const i of stems) all.add(i);
        f.pieces = [...all];
        f.box = boxOfPieces(S, f.pieces);
        f.closed = false;
      });
    }
    const judged = finals.filter((_, fi) => !merged2.has(fi));

    // 2b. The pipe a found body carries is not part of its shape: straight ink leaving its ends in line
    // with its pipe connection is cut off before the shape is judged, and the shape's box follows.
    // The rings a lead may end on: found bubbles, and closed shapes with writing and no body found in them.
    const rings = [];
    for (const g of judged) {
      for (const sp of g.spots) if (sp.hit.p.bubble === true) rings.push(placedBox(sp.hit));
      if (g.closed && !g.spots.some(sp => !sp.hit.p.operator) && hasWriting(writing, g.box)) rings.push(g.box);
    }
    const onRing = pt => rings.some(b => {
      const inside = pt[0] > b[0] && pt[0] < b[2] && pt[1] > b[1] && pt[1] < b[3];
      if (inside) return Math.min(pt[0] - b[0], b[2] - pt[0], pt[1] - b[1], b[3] - pt[1]) <= 1.5;
      return Math.hypot(Math.max(b[0] - pt[0], 0, pt[0] - b[2]), Math.max(b[1] - pt[1], 0, pt[1] - b[3])) <= 1.5;
    });
    // A lead from a found body to a bubble (the owner's INSTRUMENTATION DESIGNATION example): an unbranched run
    // of straight legs, from the body's box edge to a ring, with only line marks on it, is a connection.
    const leadOf = (pieces, hit, marked) => {
      if (!rings.length) return [];
      const bb = placedBox(hit), inset = [bb[0] + CUT_OFF, bb[1] + CUT_OFF, bb[2] - CUT_OFF, bb[3] - CUT_OFF];
      const inInset = q => q[0] > inset[0] && q[0] < inset[2] && q[1] > inset[1] && q[1] < inset[3];
      const onEdge = q => !inInset(q) && q[0] >= bb[0] - CUT_OFF && q[0] <= bb[2] + CUT_OFF && q[1] >= bb[1] - CUT_OFF && q[1] <= bb[3] + CUT_OFF;
      const free = pieces.filter(i => !marked.has(i));
      const meets = (j, pt) => Math.hypot(S[j][0] - pt[0], S[j][1] - pt[1]) <= 0.5 || Math.hypot(S[j][2] - pt[0], S[j][3] - pt[1]) <= 0.5;
      for (const i0 of free) {
        const q = S[i0], a = [q[0], q[1]], b = [q[2], q[3]];
        if (onEdge(a) === onEdge(b)) continue;
        const run = [i0];
        let far = onEdge(a) ? b : a;
        // Up to 6 legs, a leg being a straight stretch: pieces in line with the one before (a lead broken at each of its
        // marks) are one leg.
        const dirOf = i => { const q = S[i], L = Math.hypot(q[2] - q[0], q[3] - q[1]) || 1; return [(q[2] - q[0]) / L, (q[3] - q[1]) / L]; };
        for (let legs = 1, step = 0; legs <= 6 && step < LEAD_PIECES; step++) {
          if (onRing(far)) {
            // The marks on the lead go with it, every stroke of each (a Z's ticks touch only its own diagonal).
            const got = new Set(run);
            for (let grew = true; grew;) { grew = false; for (const j of pieces) if (marked.has(j) && !got.has(j) && [...got].some(i => touchesSeg(S[i], S[j]))) { got.add(j); grew = true; } }
            return [...got];
          }
          const next = free.filter(j => !run.includes(j) && meets(j, far));
          const branch = free.filter(j => !run.includes(j) && !next.includes(j) && distToSeg(far, S[j]) <= 0.5);
          if (next.length !== 1 || branch.length) break;
          const j = next[0], a = dirOf(run[run.length - 1]), b = dirOf(j);
          if (Math.abs(a[0] * b[1] - a[1] * b[0]) > 0.05) legs++;   // a turn starts a new leg
          run.push(j);
          far = Math.hypot(S[j][0] - far[0], S[j][1] - far[1]) <= 0.5 ? [S[j][2], S[j][3]] : [S[j][0], S[j][1]];
        }
      }
      return [];
    };
    // A flow arrow's line: ink outside a found body's box that touches it and is one straight line (pieces end to end on
    // one line) with a flow arrowhead and nothing else is the body's pipe with its flow arrow, no part of its shape.
    // Returns the pieces (arrowhead included); [] when there is none. Never throws.
    const arrowLine = (pieces, hit) => {
      try {
        if (!arrowUnits.length) return [];
        const bb = placedBox(hit), g = CUT_OFF, set = new Set(pieces);
        const mid = q => [(q[0] + q[2]) / 2, (q[1] + q[3]) / 2];
        const inBody = i => { const m = mid(S[i]); return m[0] >= bb[0] - g && m[0] <= bb[2] + g && m[1] >= bb[1] - g && m[1] <= bb[3] + g; };
        // An arrowhead inside the body's own box is the body's (a flow arrow found as the body), not a line's.
        const arrowOf = new Set(arrowUnits.filter(u => u.every(i => set.has(i)) && !u.some(inBody)).flat());
        if (!arrowOf.size) return [];
        const outside = pieces.filter(i => !inBody(i)), seen = new Set(), got = [];
        const nearBody = i => [[S[i][0], S[i][1]], [S[i][2], S[i][3]]].some(([x, y]) => x >= bb[0] - g && x <= bb[2] + g && y >= bb[1] - g && y <= bb[3] + g);
        for (const i0 of outside) {
          if (seen.has(i0)) continue;
          const m = [i0]; seen.add(i0);
          for (let k = 0; k < m.length; k++) for (const j of outside) if (!seen.has(j) && touchesSeg(S[m[k]], S[j])) { seen.add(j); m.push(j); }
          if (!m.some(nearBody) || !m.some(i => arrowOf.has(i))) continue;
          const lineOnly = m.filter(i => !arrowOf.has(i));
          if (!lineOnly.length) continue;
          const a = S[lineOnly.reduce((b, i) => (S[i][4] > S[b][4] ? i : b), lineOnly[0])], L = a[4];
          if (!(L > 0) || !lineOnly.every(i => { const q = S[i]; return [[q[0], q[1]], [q[2], q[3]]].every(([x, y]) => Math.abs((x - a[0]) * (a[3] - a[1]) - (y - a[1]) * (a[2] - a[0])) / L <= CUT_JOIN); })) continue;
          got.push(...m);
        }
        return got;
      } catch {
        return [];
      }
    };
    // A pipe ending in a short bar just short of another found symbol: the bar is that symbol's connection (owner,
    // 2026-11-20: the small T under an air release valve), cut with the pipe. Short: at most half the body's short side.
    const foundIn = judged.map(g => g.spots.filter(sp => !sp.hit.p.operator).map(sp => placedBox(sp.hit)));
    const endBar = (f, fi, pipe, hit, cut) => {
      const bb = placedBox(hit), most = Math.min(bb[2] - bb[0], bb[3] - bb[1]) / 2, got = [];
      const nearBody = q => q[0] >= bb[0] - CUT_OFF && q[0] <= bb[2] + CUT_OFF && q[1] >= bb[1] - CUT_OFF && q[1] <= bb[3] + CUT_OFF;
      const joins = (j, k) => distToSeg([S[j][0], S[j][1]], S[k]) <= CUT_JOIN || distToSeg([S[j][2], S[j][3]], S[k]) <= CUT_JOIN
        || distToSeg([S[k][0], S[k][1]], S[j]) <= CUT_JOIN || distToSeg([S[k][2], S[k][3]], S[j]) <= CUT_JOIN;
      for (const i of pipe) for (const E of [[S[i][0], S[i][1]], [S[i][2], S[i][3]]]) {
        if (nearBody(E)) continue;
        // What the pipe's far end runs into: the uncut pieces there and all they join.
        const G = f.pieces.filter(j => !cut.has(j) && distToSeg(E, S[j]) <= CUT_JOIN);
        if (!G.length) continue;
        for (let k = 0; k < G.length; k++) for (const j of f.pieces) if (!cut.has(j) && !G.includes(j) && joins(j, G[k])) G.push(j);
        const gb = boxOfPieces(S, G);
        if (Math.max(gb[2] - gb[0], gb[3] - gb[1]) > most) continue;
        // A symbol found in another shape stands within END_GAP of it, across the pipe's line.
        const grown = [gb[0] - END_GAP, gb[1] - END_GAP, gb[2] + END_GAP, gb[3] + END_GAP];
        const across = B => (B[0] <= E[0] && E[0] <= B[2]) || (B[1] <= E[1] && E[1] <= B[3]);
        if (foundIn.some((boxes, gi) => gi !== fi && boxes.some(B => overlaps(B, grown, 0) && across(B)))) got.push(...G);
      }
      return got;
    };
    // A marker's leader (contractor set, 2026-11-22): in a shape with no body found, a closed loop bigger than any line
    // mark that a bubble fits at a bubble's size, or a judge-only symbol of Sheet 1 fits (a TIE-IN POINT NUMBER MARKER),
    // is a marker. A straight lead from its rim outward, carrying only line marks and small rings it runs through (a
    // demarcation's dot, a TIE-IN POINT at its foot), is linework when nothing else is left besides the marker.
    // Returns { cut, closed } or null.
    const markerSyms = fittable.filter(p => p.judgeOnly === true);
    const sideOf = b => Math.max(b[2] - b[0], b[3] - b[1]);
    const markerLead = f => {
      if (f.pieces.length > OUTLINE_MAX || clock() > deadline) return null;
      const loops = outlineLoops(S, f.pieces).map(m => ({ m, b: boxOfPieces(S, m) })).filter(L => sideOf(L.b) > markMax);
      if (!loops.length) return null;
      const within = (B, i) => { const q = S[i]; return Math.min(q[0], q[2]) >= B[0] - OUTLINE_JOIN && Math.max(q[0], q[2]) <= B[2] + OUTLINE_JOIN && Math.min(q[1], q[3]) >= B[1] - OUTLINE_JOIN && Math.max(q[1], q[3]) <= B[3] + OUTLINE_JOIN; };
      const isMarker = L => {
        const fr = frameAround(L.b, 2);
        if (!frameOk(fr)) return false;
        const own = f.pieces.filter(i => within(L.b, i)), win = { ink: inkOf(fr, own), near: dilate(fullOf(fr), tolPx) };
        const m = bubbles.length ? matchBubble(bubbles, L.b, win, cfg) : null;
        if (m && m.best && isNum(m.best.k) && m.best.k >= band.minScale && m.best.k <= band.maxScale) return true;
        for (const p of markerSyms) for (let o = 0; o < 8; o++) {
          if (!quickFit(p, o, L.b, win.near, fitBand)) continue;
          const got = boxFit(p, o, L.b, fitBand), sc = got && scorePlacement(got.p, got.placement, win, cfg);
          if (sc && sc.score >= cfg.recognise) return true;
        }
        return false;
      };
      const markers = loops.filter(isMarker);
      if (!markers.length) return null;
      const inMarker = i => markers.some(L => within(L.b, i));
      const others = f.pieces.filter(i => !inMarker(i));
      if (!others.length) return null;
      const meets = (pt, q) => Math.hypot(q[0] - pt[0], q[1] - pt[1]) <= OUTLINE_JOIN || Math.hypot(q[2] - pt[0], q[3] - pt[1]) <= OUTLINE_JOIN;
      const dirOf = q => { const L = Math.hypot(q[2] - q[0], q[3] - q[1]) || 1; return [(q[2] - q[0]) / L, (q[3] - q[1]) / L]; };
      const inLine = (a, b) => { const u = dirOf(a), v = dirOf(b); return Math.abs(u[0] * v[1] - u[1] * v[0]) <= 0.02; };
      const lead = new Set();
      for (const L of markers) for (const i0 of others) {
        if (lead.has(i0)) continue;
        const q = S[i0], a = [q[0], q[1]], b = [q[2], q[3]];
        const onRim = pt => L.m.some(j => distToSeg(pt, S[j]) <= OUTLINE_JOIN), out = pt => !inBox(L.b, pt[0], pt[1]);
        let far = null;
        if (onRim(a) && out(b)) far = b; else if (onRim(b) && out(a)) far = a;
        if (!far) continue;
        const run = [i0];
        for (let step = 0; step < LEAD_PIECES; step++) {
          const next = others.filter(j => !run.includes(j) && meets(far, S[j]) && inLine(S[j], q));
          if (!next.length) break;
          const j = next[0];
          run.push(j);
          far = Math.hypot(S[j][0] - far[0], S[j][1] - far[1]) <= OUTLINE_JOIN ? [S[j][2], S[j][3]] : [S[j][0], S[j][1]];
        }
        for (const j of run) lead.add(j);
      }
      if (!lead.size) return null;
      // What touches the lead: line marks on it, or small rings it runs through. Anything else keeps the lead.
      const leadArr = [...lead], rest = others.filter(i => !lead.has(i));
      const marked = marks.length ? markInk(rest, leadArr) : new Set();
      const ringOn = cl => {
        const cb = boxOfPieces(S, cl);
        if (sideOf(cb) > LEAD_RING) return false;
        const c = centreOf(cb);
        return leadArr.some(i => distToSeg(c, S[i]) <= 1);
      };
      const cut = new Set(leadArr), seen = new Set();
      for (const i0 of rest) {
        if (seen.has(i0)) continue;
        const cl = [i0];
        seen.add(i0);
        for (let k = 0; k < cl.length; k++) for (const j of rest) if (!seen.has(j) && touchesSeg(S[cl[k]], S[j])) { seen.add(j); cl.push(j); }
        if (cl.every(i => marked.has(i)) || ringOn(cl)) for (const i of cl) cut.add(i);
        else return null;
      }
      return { cut, closed: markers.length === 1 && f.pieces.every(i => cut.has(i) || within(markers[0].b, i)) };
    };
    for (const [fi, f] of judged.entries()) {
      const cut = new Set();
      const bodies = f.spots.filter(sp => !sp.hit.p.operator && sp.hit.p.bubble !== true);
      const marked = marks.length && bodies.length ? markInk(f.pieces, [...f.pieces, ...linePieces]) : new Set();
      f.marked = marked;
      f.piped = new Set();
      for (const sp of bodies) {
        const fb = [f.box[0] - 2, f.box[1] - 2, f.box[2] + 2, f.box[3] + 2];
        const branches = linePieces.filter(i => { const q = S[i]; return overlaps([Math.min(q[0], q[2]), Math.min(q[1], q[3]), Math.max(q[0], q[2]), Math.max(q[1], q[3])], fb, 0); });
        const pipe = cutPipe(S, f.pieces, sp.hit, marked, branches);
        for (const i of pipe) cut.add(i);
        for (const i of endBar(f, fi, pipe, sp.hit, cut)) { cut.add(i); pipe.push(i); }
        if (pipe.length) f.piped.add(sp.hit);
        for (const i of pipe) cut.add(i);
        for (const i of leadOf(f.pieces.filter(j => !cut.has(j)), sp.hit, marked)) cut.add(i);
      }
      const lead = bodies.length ? null : markerLead(f);
      if (lead) for (const i of lead.cut) cut.add(i);
      if (!cut.size) continue;
      const rest = f.pieces.filter(i => !cut.has(i));
      if (!rest.length) continue;
      f.whole = f.pieces;   // with its pipe: the ink an attachment may lie on
      f.pieces = rest;
      f.box = boxOfPieces(S, rest);
      if (lead && lead.closed) f.closed = true;
    }

    const out = [];
    // A shape drawn exactly like one already judged (ctx.memo: a Map the caller keeps between readings) takes its judgement.
    const memo = c.memo instanceof Map ? c.memo : null;
    const r2 = v => Math.round(v * 100) / 100;
    const memoKey = f => {
      const segs = f.pieces.map(i => { const q = S[i], a = [r2(q[0]), r2(q[1])], b = [r2(q[2]), r2(q[3])]; return (a[0] - b[0] || a[1] - b[1]) <= 0 ? a.concat(b).join(',') : b.concat(a).join(','); }).sort();
      return (f.closed ? 'c' : 'o') + f.box.map(r2).join(',') + '|' + segs.join(';');   // a closed outline is read differently from the same pieces left open
    };
    judged.forEach((f, fi) => {
      let key = null;
      if (memo) { try { key = memoKey(f); } catch { key = null; } }
      if (key !== null && memo.has(key)) {
        const m = memo.get(key);
        out.push({ ...m, id: fi, box: [...m.box], symbols: [...m.symbols], reason: m.reason ? { ...m.reason } : null, closest: m.closest ? { ...m.closest } : null });
        if (bodyBoxes.has(m)) bodyBoxes.set(out[out.length - 1], bodyBoxes.get(m));
        return;
      }
      const base = { id: fi, box: f.box.map(round3), standard: null, verdict: 'not-judged', reason: null, why: 'time', explained: 0, share: null,
        symbols: [...new Set(f.spots.map(sp => sp.symbol).filter(Number.isInteger))].sort((a, b) => a - b), operator: null, closest: null };
      if (clock() > deadline) { out.push(base); return; }
      // A shape that is only line marks on a line (ticks standing alone): part of that line, no box (counted).
      if (marks.length && !f.spots.length) {
        const g = f.box, near = linePieces.filter(i => { const q = S[i]; return overlaps([Math.min(q[0], q[2]), Math.min(q[1], q[3]), Math.max(q[0], q[2]), Math.max(q[1], q[3])], g, 1); });
        if (near.length) {
          const m = markInk(f.pieces, near);
          if (m.size && f.pieces.every(i => m.has(i))) { out.push({ ...base, verdict: 'line-mark', why: null, lineMark: true }); return; }
        }
        // A marked line shorter than a long run (4024, 4030: an electric signal line, a Z at each joint, between two
        // pipes or from a boundary to a bubble) is no run, so the line is in the shape itself: a shape, not closed, that is
        // only straight line and the marks on it is part of that line too.
        if (!f.closed) {
          const m = markInk(f.pieces, [...f.pieces, ...near]);
          if (m.size && f.pieces.every(i => m.has(i) || m.lines.has(i))) { out.push({ ...base, verdict: 'line-mark', why: null, lineMark: true }); return; }
        }
      }
      const body = f.spots.some(sp => !sp.hit.p.operator);
      const g = 2 + (body && attachments.length ? Math.max(opReach, attReach) + 2 : 0);
      const fr = { x0: f.box[0] - g, y0: f.box[1] - g, w: Math.ceil((f.box[2] - f.box[0] + 2 * g) * PX), h: Math.ceil((f.box[3] - f.box[1] + 2 * g) * PX), pxPerPt: PX };
      if (!(fr.w > 0 && fr.h > 0) || fr.w > MAX_SIDE || fr.h > MAX_SIDE) { out.push({ ...base, standard: false, verdict: 'not-identified', why: 'no-fit' }); return; }
      let own = blank(fr.x0, fr.y0, fr.w, fr.h, PX);
      drawInto(own, piecePaths(split, f.pieces, paths), {}, cfg);
      const full = blank(fr.x0, fr.y0, fr.w, fr.h, PX);
      drawInto(full, boxed.filter(q => q.b[2] >= fr.x0 && q.b[0] <= fr.x0 + fr.w / PX && q.b[3] >= fr.y0 && q.b[1] <= fr.y0 + fr.h / PX).map(q => q.p), {}, cfg);
      const nearFull = dilate(full, tolPx);
      const win = { ink: own, near: nearFull };
      const inShape = h => { const b = placedBox(h), cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2; return inBox(f.box, cx, cy); };

      // A found line with a head whose head cannot be told from a line (a corner, a crossing) is no body here.
      const kept = f.spots.filter(sp => !isLineWithHead(sp.hit.p) || headDrawn(sp.hit, win)).map(sp => ({ h: sp.hit, op: sp.hit.p.operator === true }));
      const mask = blank(fr.x0, fr.y0, fr.w, fr.h, PX);
      const addMask = (h, body) => {
        const T = templateIn(fr, h, cfg);
        for (let i = 0; i < mask.data.length; i++) if (T.data[i]) mask.data[i] = 1;
        if (body) fillLoops(h, T);
      };
      // A body drawn normally closed (Sheet 1's combination examples): ink filling its closed outlines is its fill, when
      // every large outline is filled (one triangle of two filled is not in the legend).
      // The shape's own ink with its filled paths solid: a fill drawn as strips of its own (SP66) is read as solid ink
      // here, not as the strips' edges (own draws every piece as a line).
      let ownSolid = null;
      const solidOwn = () => {
        if (ownSolid) return ownSolid;
        if (!piecesOfPath) { piecesOfPath = new Map(); S.forEach((q, i) => { const k = q[5]; if (!piecesOfPath.has(k)) piecesOfPath.set(k, []); piecesOfPath.get(k).push(i); }); }
        const mine = new Set(f.pieces), fills = [];
        for (const pi of new Set(f.pieces.map(i => S[i][5]))) {
          const q = paths[pi];
          if (q && q.filled === true && asArr(piecesOfPath.get(pi)).every(i => mine.has(i))) fills.push({ ...q, stroked: false });
        }
        ownSolid = blank(fr.x0, fr.y0, fr.w, fr.h, PX);
        ownSolid.data.set(own.data);
        drawInto(ownSolid, fills, {}, cfg);
        return ownSolid;
      };
      const fillLoops = (h, T) => {
        const loops = asArr(h.p.loops);
        if (!loops.length) return;
        const solid = solidOwn();
        const got = loops.map(lp => {
          const F = blank(fr.x0, fr.y0, fr.w, fr.h, PX);
          drawInto(F, [{ ...lp, filled: true, stroked: false }], { transform: (x, y) => placePoint(h.placement, x, y), scale: h.placement.k }, cfg);
          let n = 0, on = 0;
          for (let i = 0; i < F.data.length; i++) if (F.data[i] && !T.data[i]) { n++; if (solid.data[i]) on++; }
          return { F, n, dense: n >= 8 && on >= FILL_DENSITY * n };
        });
        // A loop the size of a filled one (its twin: a valve's other triangle) must be filled too; a loop of another size
        // (a ball valve's ball) need not be.
        const twins = got.filter(g => got.some(d => d.dense && Math.abs(d.n - g.n) <= FILL_TWIN * d.n));
        if (!got.some(g => g.dense) || !twins.every(g => g.dense)) return;
        for (const g of got) if (g.dense) for (let i = 0; i < mask.data.length; i++) if (g.F.data[i]) mask.data[i] = 1;
      };
      for (const k of kept) addMask(k.h, !k.op);
      let skip = [];
      // An arrowhead pointing at a found body is not the body's ink (owner, 2026-11-18): left out of the share explained.
      // Only a triangle the found symbols leave mostly unexplained is left out: a valve's own triangles never are.
      const judgedInk = () => {
        if (!kept.some(k => !k.op)) return own;
        const inF = new Set(f.pieces), out = new Set();
        for (const unit of arrowUnits) {
          const mine = unit.filter(i => inF.has(i));
          if (mine.length && coverage(inkOf(fr, mine), mask, []) < 0.5) for (const i of mine) out.add(i);
        }
        return out.size ? inkOf(fr, f.pieces.filter(i => !out.has(i))) : own;
      };

      // On a printed sheet the letters are drawn as ink. Letters are writing, not linework: the plain step and the
      // box fit score on the ink with every piece lying wholly inside a writing box (grown 1 pt) taken out (item 4:
      // a look-alike's small ticks were explained by the letters of LEVEL - GENERAL).
      const letterBoxes = writing.filter(b => Array.isArray(b) && b.length === 4 && b.every(isNum) && b[2] >= fr.x0 && b[0] <= fr.x0 + fr.w / PX
        && b[3] >= fr.y0 && b[1] <= fr.y0 + fr.h / PX).map(b => [b[0] - 1, b[1] - 1, b[2] + 1, b[3] + 1]);
      const inLetters = b => letterBoxes.some(w => b[0] >= w[0] && b[1] >= w[1] && b[2] <= w[2] && b[3] <= w[3]);
      let bareW = null;
      const bareWin = () => {
        if (!letterBoxes.length) return win;
        if (!bareW) {
          const unlettered = f.pieces.filter(i => { const q = S[i]; return !inLetters([Math.min(q[0], q[2]), Math.min(q[1], q[3]), Math.max(q[0], q[2]), Math.max(q[1], q[3])]); });
          // A shape with no linework besides its "letters" is no writing (a printed sheet's reader takes a small
          // bowtie for a glyph): it keeps all of its ink.
          if (!unlettered.length) { bareW = win; return bareW; }
          // Letters stand apart from the linework: a "letter" stroke joined at an end to linework (an outline's edge
          // read as a dash) is linework, and so is what joins it in turn.
          const line = new Set(unlettered), joinedTo = (i, j) => distToSeg([S[i][0], S[i][1]], S[j]) <= OUTLINE_JOIN || distToSeg([S[i][2], S[i][3]], S[j]) <= OUTLINE_JOIN
            || distToSeg([S[j][0], S[j][1]], S[i]) <= OUTLINE_JOIN || distToSeg([S[j][2], S[j][3]], S[i]) <= OUTLINE_JOIN;
          for (let grew = true; grew;) {
            grew = false;
            for (const i of f.pieces) if (!line.has(i) && [...line].some(j => joinedTo(i, j))) { line.add(i); grew = true; }
          }
          const linePaths = new Set(f.pieces.filter(i => line.has(i)).map(i => paths[S[i][5]]));
          const ink = inkOf(fr, f.pieces.filter(i => line.has(i)));
          const fb = blank(fr.x0, fr.y0, fr.w, fr.h, PX);
          drawInto(fb, boxed.filter(q => q.b[2] >= fr.x0 && q.b[0] <= fr.x0 + fr.w / PX && q.b[3] >= fr.y0 && q.b[1] <= fr.y0 + fr.h / PX && (!inLetters(q.b) || linePaths.has(q.p))).map(q => q.p), {}, cfg);
          bareW = { ink, near: dilate(fb, tolPx) };
        }
        return bareW;
      };
      // The writing a shape's found symbols account for: a bubble's tag, a lettered symbol's letters.
      const skipFor = (list = kept) => (list.some(k => k.h.p.bubble === true || (!k.op && asArr(asObj(k.h.p.symbol).letters).length))
        ? writing.filter(b => inBox(f.box, (b[0] + b[2]) / 2, (b[1] + b[3]) / 2)) : []);

      // A closed outline with writing in it and nothing found: a bubble matched to its outline.
      // An empty ring is a bubble too when it is a bubble's size on this sheet (owner, 2026-11-20; overrules 2026-11-17).
      const ringWritten = f.closed && hasWriting(writing, f.box);
      if (!kept.length && f.closed) {
        // On a printed sheet the letters are drawn as ink: a path lying wholly inside a writing box (grown 1 pt) is the tag, not the bubble.
        const letters = writing.filter(b => Array.isArray(b) && b.length === 4 && b.every(isNum)).map(b => [b[0] - 1, b[1] - 1, b[2] + 1, b[3] + 1]);
        const bare = letters.length ? blank(fr.x0, fr.y0, fr.w, fr.h, PX) : full;
        if (letters.length) {
          drawInto(bare, boxed.filter(q => q.b[2] >= fr.x0 && q.b[0] <= fr.x0 + fr.w / PX && q.b[3] >= fr.y0 && q.b[1] <= fr.y0 + fr.h / PX
            && !letters.some(w => q.b[0] >= w[0] && q.b[1] >= w[1] && q.b[2] <= w[2] && q.b[3] <= w[3])).map(q => q.p), {}, cfg);
        }
        const m = matchBubble(bubbles, f.box, { ink: bare, near: nearFull }, cfg);
        const sized = h => isNum(h.placement.k) && h.placement.k >= band.minScale && h.placement.k <= band.maxScale;
        if (m.best) { const h = { p: m.best.p, placement: m.best.placement, score: m.best.score }; if (ringWritten || sized(h)) { kept.push({ h, op: false }); addMask(h, false); } }
      }
      // Not one outline, with writing in it (Sheet 1's INSTRUMENTATION DESIGNATION examples: bubbles drawn touching,
      // a rim mark beside one): each closed path holding writing is matched as a ring; a rim mark is peeled below.
      if (!kept.length && !f.closed && bubbles.length && hasWriting(writing, f.box)) {
        const own = [...new Set(f.pieces.map(i => S[i][5]))].map(pi => paths[pi]).filter(p => p && isClosedPath(p));
        for (const p of own) {
          const b = asArr(boxed.find(q => q.p === p) && boxed.find(q => q.p === p).b);
          if (b.length !== 4 || !hasWriting(writing, b)) continue;
          const m = matchBubble(bubbles, b, win, cfg);
          if (m.best) { const h = { p: m.best.p, placement: m.best.placement, score: m.best.score }; kept.push({ h, op: false }); addMask(h, false); }
        }
      }
      // A body found, with bubbles drawn touching it (4023: a flowmeter and its tag bubbles, one shape): each closed outline
      // of its own lying outside every found body is matched as a ring, held as above (writing in it, or a bubble's size).
      if (kept.some(k => !k.op) && bubbles.length) {
        const bodyBoxes = kept.filter(k => !k.op).map(k => placedBox(k.h));
        const inside = (b, B) => b[0] >= B[0] - 1 && b[1] >= B[1] - 1 && b[2] <= B[2] + 1 && b[3] <= B[3] + 1;
        for (const p of [...new Set(f.pieces.map(i => S[i][5]))].map(pi => paths[pi]).filter(p => p && isClosedPath(p))) {
          const b = asArr(boxed.find(q => q.p === p) && boxed.find(q => q.p === p).b);
          if (b.length !== 4 || bodyBoxes.some(B => inside(b, B) || inside(B, b))) continue;
          const m = matchBubble(bubbles, b, win, cfg);
          if (!m.best) continue;
          const h = { p: m.best.p, placement: m.best.placement, score: m.best.score };
          if (hasWriting(writing, b) || (isNum(h.placement.k) && h.placement.k >= band.minScale && h.placement.k <= band.maxScale)) { kept.push({ h, op: false }); addMask(h, false); }
        }
      }
      // Nothing found: a plain symbol matched to the whole shape (both ways at plainBack, nothing running on).
      let plainFound = null;
      if (!kept.length) {
        let best = null;
        const writtenIn = hasWriting(writing, f.box);
        const tryHit = h => {
          // A symbol holding letters (LEVEL - GENERAL's X and L) needs writing in the shape, as the box fit holds it.
          if (!writtenIn && asArr(asObj(h.p.symbol).letters).length) return;
          if (!lettersRoomOk(h.p, placedBox(h))) return;
          const bw = bareWin(), s = scorePlacement(h.p, h.placement, bw, cfg);
          if (!s || s.score < cfg.recognise || s.backward < cfg.plainBack) return;
          const hit = { p: h.p, placement: h.placement, score: s.score };
          if (weakestLine(hit, bw, cfg) < LINE_MIN || runsOnPastCorner(hit, full, cfg)) return;
          if (!best || s.score > best.score) best = hit;
        };
        for (const r of rejected) if (r.rejectedFor === 'plain' && inShape(r) && !isOneLine(r.p) && !isLineWithHead(r.p) && !isAttachment(r.p)) tryHit({ p: placeable(r.p), placement: r.placement });
        // The sweep's near misses, scored on all the ink in their frame (a lead's marks above a motor, a neighbour's edge),
        // are scored again on this shape's own ink, held as a plain find is (contractor set, 2026-11-20).
        // Its frame holds the shape and the placed symbol (a motor's shaft may stand off the shape, cut as a connector).
        for (const h of nearList) {
          if (!inShape(h) || h.score < cfg.recognise - NEAR_RESCORE || !h.p.checkable || h.p.bubble || h.p.operator || isOneLine(h.p) || isLineWithHead(h.p) || isAttachment(h.p)
            || !isNum(h.placement.k) || h.placement.k < band.minScale || h.placement.k > band.maxScale) continue;
          if (!writtenIn && asArr(asObj(h.p.symbol).letters).length) continue;
          if (!lettersRoomOk(h.p, placedBox(h))) continue;
          const pb = placedBox(h), fr2 = frameAround([Math.min(pb[0], f.box[0]), Math.min(pb[1], f.box[1]), Math.max(pb[2], f.box[2]), Math.max(pb[3], f.box[3])], 2);
          if (!frameOk(fr2)) continue;
          const full2 = fullOf(fr2), w2 = { ink: inkOf(fr2, f.pieces), near: dilate(full2, tolPx) }, p = placeable(h.p);
          const sc = scorePlacement(p, h.placement, w2, cfg);
          if (!sc || sc.score < cfg.recognise || sc.backward < cfg.plainBack) continue;
          const hit = { p, placement: h.placement, score: sc.score };
          if (weakestLine(hit, w2, cfg) < LINE_MIN) continue;
          // Running on past a corner is judged on ink the symbol itself does not draw (as the peel judges it): a motor's
          // own arrow line runs on through its arrowhead's corner.
          const T2 = templateIn(fr2, hit, cfg), past = blank(fr2.x0, fr2.y0, fr2.w, fr2.h, PX);
          for (let i = 0; i < past.data.length; i++) past.data[i] = full2.data[i] && !T2.data[i] ? 1 : 0;
          if (runsOnPastCorner(hit, past, cfg)) continue;
          if (!best || sc.score > best.score) best = hit;
        }
        const segs = segsOf(S, f.pieces, minKey), centre = centreOf(f.box), reach = Math.hypot(f.box[2] - f.box[0], f.box[3] - f.box[1]) / 2 + 2;
        for (const p of plains) for (const pl of proposePlacements(p, segs, centre, { ...band, radius: reach })) tryHit({ p, placement: pl });
        if (best) { kept.push({ h: best, op: false }); addMask(best, true); plainFound = best; }
      }
      skip = skipFor();
      let explained = coverage(judgedInk(), mask, skip);

      let operator = null;
      for (const k of kept) if (k.op && !operator) operator = { name: nameOf(k.h.p), score: round3(k.h.score) };

      // Closest: the candidate whose own template explains most of the shape (ties: the higher score).
      const cands = [...kept.map(k => ({ ...k.h, weak: isNum(k.h.weak) ? k.h.weak : 1 })), ...nearList.filter(inShape), ...rejected.filter(inShape)];
      if (!kept.length && !cands.length) {
        // A loose search, as for a tag with nothing near it: the symbols laid on this shape's lines, the quick look relaxed.
        const segs = segsOf(S, f.pieces, minKey), centre = centreOf(f.box), reach = Math.hypot(f.box[2] - f.box[0], f.box[3] - f.box[1]) / 2 + 2;
        const tries = [];
        for (const p of looseable) for (const pl of proposePlacements(p, segs, centre, { ...band, radius: reach })) tries.push({ p, placement: pl });
        for (const t of tries.slice(0, LOOSE_TRY * 10)) {
          if (cands.length >= LOOSE_TRY) break;
          const s = scorePlacement(t.p, t.placement, { ink: own, near: nearFull }, { ...cfg, quickLook: NEAR_MISS_LOOK });
          if (s && s.score >= NEAR_MISS_FLOOR) cands.push({ p: t.p, placement: t.placement, score: s.score, weak: s.score >= NEAR_WEAK ? weakestLine({ p: t.p, placement: t.placement }, { ink: own, near: nearFull }, cfg) : null });
        }
      }
      let closest = null;
      for (const h of cands.sort((a, b) => b.score - a.score).slice(0, CLOSEST_TRY)) {
        if (h.score < NEAR_MISS_FLOOR) continue;
        const e = coverage(own, templateIn(fr, h, cfg), skip);
        if (!closest || e > closest.e + 1e-9 || (Math.abs(e - closest.e) <= 1e-9 && h.score > closest.h.score)) closest = { h, e };
      }

      // Nothing found: the nearest candidates fitted to the shape's box, each way at its own scale (owner,
      // 2026-11-18: a reducer drawn in other proportions is standard). At most STRETCH_MAX more one way than the
      // other; both ways at `recognise`, every line drawn, and a plain one held as the plain step holds it.
      // A plain find explaining less than AMBER_EXPLAINED of its shape (a small T on a box's edge and its stem) does not
      // stop the fit: the one explaining more of the shape is kept.
      const weakPlain = !!plainFound && kept.length === 1 && kept[0].h === plainFound && explained < AMBER_EXPLAINED;
      if ((!kept.length || weakPlain) && clock() <= deadline) {
        let fit = null;
        // The shape's box, and the box of its closed outline when a stem or a stub runs off it (item 4: a lettered
        // box with a stem up to its bubble was fitted to the box of the stem as well).
        const boxes = [f.box], ob = outlineBox(S, f.pieces);
        const addBox = B => { if (B && B.every(isNum) && boxes.every(A => A.some((v, i) => Math.abs(v - B[i]) > 0.5))) boxes.push(B); };
        addBox(ob);
        // And without the flow arrowheads touching it from outside (4021: arrows on the pipes into a chamber's wall).
        const fSet = new Set(f.pieces), inArrow = new Set(arrowUnits.filter(u => u.every(i => fSet.has(i))).flat());
        const unarrowed = inArrow.size ? f.pieces.filter(i => !inArrow.has(i)) : [];
        if (unarrowed.length) { addBox(boxOfPieces(S, unarrowed)); addBox(outlineBox(S, unarrowed)); }
        const writtenIn = boxes.map(B => hasWriting(writing, B));
        for (const p of fittable) for (let bi = 0; bi < boxes.length; bi++) {
          const B = boxes[bi];
          // Symbols holding letters need writing in the shape.
          if (!writtenIn[bi] && asArr(asObj(p.symbol).letters).length) continue;
          if (!lettersRoomOk(p, B)) continue;
          // A structure is fitted only to a shape the size of one (lr26: a LAGOON was fitted to flow arrowheads).
          if (p.toSuit === true && Math.max(B[2] - B[0], B[3] - B[1]) < TO_SUIT_SIDE * sizeScale) continue;
          for (const whole of p.toSuit === true ? [false, true] : [true]) for (let o = 0; o < 8; o++) {
            const bw = bareWin();
            if (!quickFit(p, o, B, bw.near, fitBand, whole)) continue;
            const got = boxFit(p, o, B, fitBand, whole);
            if (!got) continue;
            const sc = scorePlacement(got.p, got.placement, bw, cfg);
            if (!sc || sc.score < cfg.recognise) continue;
            const hit = { p: got.p, placement: got.placement, score: sc.score };
            if (weakestLine(hit, bw, cfg) < LINE_MIN) continue;
            // A structure drawn to suit has pipes into its walls at any point: only its backward share is held.
            if (plainShape(got.p) && (sc.backward < cfg.plainBack || (got.p.toSuit !== true && runsOnPastCorner(hit, full, cfg)))) continue;
            // Fits tied on score (a box fits every box symbol alike) go to a lettered symbol: it is here only when its
            // shape holds writing.
            hit.lettered = asArr(asObj(p.symbol).letters).length > 0;
            if (!fit || sc.score > fit.score + 1e-6 || (sc.score >= fit.score - 1e-6 && hit.lettered && !fit.lettered)) fit = hit;
          }
        }
        if (fit && weakPlain) {
          const T = templateIn(fr, fit, cfg), M = blank(fr.x0, fr.y0, fr.w, fr.h, PX);
          for (let i = 0; i < M.data.length; i++) M.data[i] = T.data[i] ? 1 : 0;
          if (coverage(judgedInk(), M, skipFor([{ h: fit, op: false }])) <= explained) fit = null;
          else { kept.length = 0; mask.data.fill(0); }
        }
        if (fit) {
          kept.push({ h: fit, op: false }); addMask(fit, true); skip = skipFor(); explained = coverage(judgedInk(), mask, skip);
          closest = { h: fit, e: coverage(own, templateIn(fr, fit, cfg), skip) };
          // The pipe a body carries and its lead to a bubble are no part of its shape, as for a body the sweep found (2b):
          // cut, and the shape's box follows (binder test 3: a valve's box took in the line to its bubble and the pipe to a flow arrow).
          // Not when the body found is itself a flow arrow (an arrowhead of its own piece lies in its box): its line is its own.
          const pb = placedBox(fit), arrowBody = arrowUnits.some(u => u.some(i => { const q = S[i], mx = (q[0] + q[2]) / 2, my = (q[1] + q[3]) / 2; return mx >= pb[0] && mx <= pb[2] && my >= pb[1] && my <= pb[3]; }));
          const cut = new Set(), marked = marks.length ? markInk(f.pieces, [...f.pieces, ...linePieces]) : new Set();
          const fb = [f.box[0] - 2, f.box[1] - 2, f.box[2] + 2, f.box[3] + 2];
          const branches = linePieces.filter(i => { const q = S[i]; return overlaps([Math.min(q[0], q[2]), Math.min(q[1], q[3]), Math.max(q[0], q[2]), Math.max(q[1], q[3])], fb, 0); });
          let pipe = [];
          if (!arrowBody) {
            for (const i of arrowLine(f.pieces, fit)) cut.add(i);
            pipe = cutPipe(S, f.pieces.filter(j => !cut.has(j)), fit, marked, branches);
            for (const i of pipe) cut.add(i);
            for (const i of leadOf(f.pieces.filter(j => !cut.has(j)), fit, marked)) cut.add(i);
            // A flow arrowhead standing at the end of the pipe just cut goes with it (the line with its flow arrow).
            const live = new Set(f.pieces);
            for (const u of arrowUnits) {
              if (!u.every(i => live.has(i) && !cut.has(i)) || u.some(i => { const q = S[i], mx = (q[0] + q[2]) / 2, my = (q[1] + q[3]) / 2; return mx >= pb[0] - CUT_OFF && mx <= pb[2] + CUT_OFF && my >= pb[1] - CUT_OFF && my <= pb[3] + CUT_OFF; })) continue;
              if (u.some(i => [...cut].some(c => touchesSeg(S[i], S[c])))) for (const i of u) cut.add(i);
            }
          }
          const rest = f.pieces.filter(i => !cut.has(i));
          if (cut.size && rest.length) {
            f.whole = f.pieces; f.pieces = rest; f.box = boxOfPieces(S, rest); base.box = f.box.map(round3);
            if (pipe.length) f.piped = new Set([fit]);
            own = inkOf(fr, rest);
            explained = coverage(judgedInk(), mask, skip);
            closest = { h: fit, e: coverage(own, templateIn(fr, fit, cfg), skip) };
          }
        }
      }

      // A body with ink left over: parts peeled off one after another (owner, 2026-11-18) - attachments beside a
      // found part, and touching standard symbols that are a full match on their own ink - each laying at least
      // PEEL_NEW of itself on ink no earlier part explains. The part laying most new ink is taken each round.
      if (kept.some(k => !k.op) && explained < cfg.shapeExplained && (attachments.length || peelable.length)) {
        const at = (m, q) => { const X = Math.floor((q[0] - m.x0) * m.pxPerPt), Y = Math.floor((q[1] - m.y0) * m.pxPerPt); return X >= 0 && Y >= 0 && X < m.w && Y < m.h && !!m.data[Y * m.w + X]; };
        const diag = Math.hypot(f.box[2] - f.box[0], f.box[3] - f.box[1]);
        // An operator (actuator, handwheel) stands on its body: its centre lies within the body's length along the
        // pipe the body carries, never out on the pipe past the body's ends (that is a flange's or a reducer's place).
        // Only a body with a pipe drawn on it is held to this (LOCKED on C's actuators carries none).
        const piped = kept.filter(k => !k.op && f.piped instanceof Set && f.piped.has(k.h));
        const standsOnBody = h => {
          if (!piped.length) return true;
          const b = placedBox(h), cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
          return piped.some(k => {
            const lines = pipeLines(k.h.p);
            if (!lines) return true;
            const at = lines.at[0], a = lines.axis === 'h' ? placePoint(k.h.placement, 0, at) : placePoint(k.h.placement, at, 0);
            const e = lines.axis === 'h' ? placePoint(k.h.placement, k.h.p.w, at) : placePoint(k.h.placement, at, k.h.p.h);
            const dx = e[0] - a[0], dy = e[1] - a[1], L2 = dx * dx + dy * dy;
            if (!(L2 > 0)) return true;
            const t = ((cx - a[0]) * dx + (cy - a[1]) * dy) / L2;
            if (t >= 0 && t <= 1) return true;
            // Past an end: only where no pipe runs on from that end (a valve ending its line carries its actuator on its
            // free end; owner, 2026-11-19). What was cut there lying within the operator's own box is its stem, not pipe.
            // Pipe runs on there when ink on the pipe's line lies past that end, outside the operator's own box.
            const ob = placedBox(h), L = Math.sqrt(L2), off = (x, y) => Math.abs((x - a[0]) * dy - (y - a[1]) * dx) / L;
            const tt = (x, y) => ((x - a[0]) * dx + (y - a[1]) * dy) / L2, past = v => (t < 0 ? v < 0 : v > 1);
            const outside = (x, y) => x < ob[0] - 1 || x > ob[2] + 1 || y < ob[1] - 1 || y > ob[3] + 1;
            const onLine = asArr(f.whole || f.pieces).filter(i => { const q = S[i]; return off(q[0], q[1]) <= CUT_OFF && off(q[2], q[3]) <= CUT_OFF; });
            if (onLine.some(i => { const q = S[i]; return [[q[0], q[1]], [q[2], q[3]]].some(([x, y]) => past(tt(x, y)) && outside(x, y)); })) return false;
            // And the line comes in at the other end: pipe running at least the body's own length from it (two stubs
            // ending in ticks are a flange's place, not a valve ending its line).
            return onLine.some(i => { const q = S[i]; return [tt(q[0], q[1]), tt(q[2], q[3])].some(v => (t < 0 ? v >= 2 : v <= -1)); });
          });
        };
        let attNear = null;
        // An operator stands on its body, across its pipe (a stem may rise from the body's middle). One laying more than
        // OP_ON_BODY of its linework inside a found body's box and along the body's pipe (its longer side) lies across
        // the body (H2: a T's bar along a ball valve's middle line, its stem out along a branch): no operator.
        const acrossBody = h => {
          const segs = asArr(h.p.segs).filter(g => Array.isArray(g) && g.slice(0, 5).every(isNum) && g[4] > 0);
          const total = segs.reduce((m, g) => m + g[4], 0);
          if (!(total > 0)) return false;
          return kept.some(k => {
            if (k.op) return false;
            const b = placedBox(k.h), t = cfg.inkTol, across = b[2] - b[0] >= b[3] - b[1];
            let along = 0;
            for (const g of segs) {
              const a = placePoint(h.placement, g[0], g[1]), e = placePoint(h.placement, g[2], g[3]);
              const dx = Math.abs(e[0] - a[0]), dy = Math.abs(e[1] - a[1]), mx = (a[0] + e[0]) / 2, my = (a[1] + e[1]) / 2;
              const parallel = across ? dy <= 0.2 * dx : dx <= 0.2 * dy;
              if (parallel && mx > b[0] + t && mx < b[2] - t && my > b[1] + t && my < b[3] - t) along += g[4];
            }
            return along > OP_ON_BODY * total;
          });
        };
        for (let round = 0; round < PEEL_MAX && explained < cfg.shapeExplained && clock() <= deadline; round++) {
          const left = blank(fr.x0, fr.y0, fr.w, fr.h, PX);
          for (let i = 0; i < left.data.length; i++) left.data[i] = own.data[i] && !mask.data[i] ? 1 : 0;
          const leftNear = dilate(left, tolPx), opWin = { ink: left, near: nearFull };
          // An attachment lies on its own shape's ink and the pipes it sits on, never on a neighbouring symbol's.
          // Every pipe passing through the frame counts, however far away its middle is.
          if (!attNear) {
            const fb = [fr.x0, fr.y0, fr.x0 + fr.w / PX, fr.y0 + fr.h / PX];
            const through = linePieces.filter(i => { const q = S[i]; return overlaps([Math.min(q[0], q[2]), Math.min(q[1], q[3]), Math.max(q[0], q[2]), Math.max(q[1], q[3])], fb, 0); });
            // A path wholly in the shape or its pipes is drawn whole (a filled arrowhead keeps its fill); a path shared
            // with a neighbour (a circle one piece of which the splitter gave this shape) gives only its pieces here.
            const mine = [...new Set([...asArr(f.whole || f.pieces), ...through])], mineSet = new Set(mine);
            if (!piecesOfPath) { piecesOfPath = new Map(); S.forEach((q, i) => { const k = q[5]; if (!piecesOfPath.has(k)) piecesOfPath.set(k, []); piecesOfPath.get(k).push(i); }); }
            const whole = [], part = [];
            for (const pi of new Set(mine.map(i => S[i][5]))) {
              const all = asArr(piecesOfPath.get(pi));
              if (paths[pi] && all.every(i => mineSet.has(i))) whole.push(paths[pi]); else part.push(...all.filter(i => mineSet.has(i)));
            }
            const own = part.length ? inkOf(fr, part) : blank(fr.x0, fr.y0, fr.w, fr.h, PX);
            drawInto(own, whole, {}, cfg);
            attNear = dilate(own, tolPx);
          }
          const attWin = { ink: left, near: attNear };
          let best = null;
          // Template points on ink no earlier part explains: checked first, as it costs least.
          const newInk = (p, pl) => {
            const pts = asArr(p.points), n = Math.floor(pts.length / 2), need = PEEL_NEW * n;
            let on = 0;
            // pl is a placement the sweep made: its numbers are applied as placePoint applies them, without an array per point.
            const [oa, ob, oc, od] = ORIENTATIONS[pl.o], pk = pl.k, ptx = pl.tx, pty = pl.ty, lm = leftNear, lw = lm.w, lh = lm.h, ld = lm.data, lx = lm.x0, ly = lm.y0, lp = lm.pxPerPt;
            for (let i = 0, k = 0; i + 1 < pts.length; i += 2, k++) {
              const qx = pk * (oa * pts[i] + oc * pts[i + 1]) + ptx, qy = pk * (ob * pts[i] + od * pts[i + 1]) + pty;
              const X = Math.floor((qx - lx) * lp), Y = Math.floor((qy - ly) * lp);
              if (X >= 0 && Y >= 0 && X < lw && Y < lh && ld[Y * lw + X] !== 0) on++;
              else if (on + (n - k - 1) < need) return 0;   // the rest cannot reach PEEL_NEW
            }
            return n && on >= need ? on : 0;
          };
          const consider = (h, role, on) => {
            if (!best || on > best.on || (on === best.on && h.score > best.h.score)) best = { h, role, on };
          };
          if (attachments.length) {
            const segs = segsOf(S, [...f.pieces, ...linesIn(fr)], minKey);
            for (const k of kept) {
              const bb = placedBox(k.h), centre = centreOf(bb), reach = Math.hypot(bb[2] - bb[0], bb[3] - bb[1]) / 2 + attReach;
              for (const p of attachments) {
                for (const pl of proposePlacements(p, segs, centre, { ...band, radius: reach })) {
                  const on = newInk(p, pl);
                  if (!on) continue;
                  const sc = scorePlacement(p, pl, attWin, cfg);
                  if (!sc || sc.score < cfg.recognise) continue;
                  const hit = { p, placement: pl, score: sc.score };
                  if (weakestLine(hit, attWin, cfg) < LINE_MIN || (isLineWithHead(p) && !headDrawn(hit, win))) continue;
                  if (p.operator === true && (!standsOnBody(hit) || acrossBody(hit))) continue;
                  consider(hit, 'attachment', on);
                }
              }
            }
          }
          const leftPieces = f.pieces.filter(i => pieceOn(S[i], mask) < 0.8);
          if (peelable.length && leftPieces.length) {
            const lb = boxOfPieces(S, leftPieces), segs = segsOf(S, leftPieces, minKey), centre = centreOf(lb);
            const reach = Math.hypot(lb[2] - lb[0], lb[3] - lb[1]) / 2 + 2;
            // A peeled symbol lays at least PEEL_NEW of itself on the leftover ink, so it is no bigger than about its box.
            const ld = Math.hypot(lb[2] - lb[0], lb[3] - lb[1]);
            for (const p of peelable) {
              if (Math.hypot(p.w, p.h) * band.minScale > Math.min(diag, ld / PEEL_NEW) + 2) continue;
              for (const pl of proposePlacements(p, segs, centre, { ...band, radius: reach })) {
                const on = newInk(p, pl);
                if (!on) continue;
                const sc = scorePlacement(p, pl, opWin, cfg);
                if (!sc || sc.score < cfg.recognise || sc.backward < cfg.plainBack) continue;
                const hit = { p, placement: pl, score: sc.score };
                if (!overlaps(placedBox(hit), f.box, cfg.inkTol + 1) || weakestLine(hit, opWin, cfg) < LINE_MIN) continue;
                // Running on past a corner is judged on ink the symbol itself does not draw: a bowtie's diagonals run
                // straight through its centre, and an edge on an earlier part's ink is touching, not running on.
                const T = templateIn(fr, hit, cfg), past = blank(fr.x0, fr.y0, fr.w, fr.h, PX);
                for (let i = 0; i < past.data.length; i++) past.data[i] = left.data[i] && !T.data[i] ? 1 : 0;
                if (runsOnPastCorner(hit, past, cfg)) continue;
                consider(hit, 'symbol', on);
              }
            }
          }
          if (!best) break;
          kept.push({ h: best.h, op: best.role === 'attachment', role: best.role });
          addMask(best.h, best.role !== 'attachment');
          if (best.role === 'attachment' && !operator) operator = { name: nameOf(best.h.p), score: round3(best.h.score) };
          explained = coverage(judgedInk(), mask, skip);
        }
      }

      // An attachment sitting on the pipe (a flow arrow, a flange, a reducer; not an operator) carries the pipe through:
      // the straight run leaving its far end in line with it is pipe, as the body's own pipe is.
      if (explained < cfg.shapeExplained) {
        const run = new Set();
        for (const k of kept) if (k.role === 'attachment' && k.h.p.operator !== true && pipeLines(k.h.p)) for (const i of cutPipe(S, f.pieces, k.h, f.marked)) run.add(i);
        if (run.size) {
          const P = inkOf(fr, [...run]);
          for (let i = 0; i < mask.data.length; i++) if (P.data[i]) mask.data[i] = 1;
          explained = coverage(judgedInk(), mask, skip);
        }
      }

      // The verdict.
      const onlyOperators = kept.length > 0 && kept.every(k => k.op);
      let standard = kept.length > 0 && !onlyOperators && explained >= cfg.shapeExplained, why = null, share = null;
      if (!standard) {
        if (kept.length) why = 'left-over';
        else if (closest && isNum(closest.h.weak) && closest.h.weak < LINE_MIN && closest.h.score >= SHORT_SCORE) { why = 'short-line'; share = round3(closest.h.weak); }
        else why = 'no-fit';
      }
      // The three verdicts. why and standard keep their old meaning for the old readers; verdict and reason say how far off.
      const shown = closest ? { name: nameOf(closest.h.p), tagId: str(asObj(closest.h.p.symbol).tagId), score: round3(closest.h.score), explained: round3(closest.e) } : null;
      const v = shapeVerdict({ bodies: kept.filter(k => !k.op).map(k => ({ name: nameOf(k.h.p), size: k.h.p.toSuit === true ? null : hitSize(k.h) })), explained, sizeScale, shapeExplained: cfg.shapeExplained,
        closest: shown ? { ...shown, oneLine: isOneLine(closest.h.p) || isLineWithHead(closest.h.p), bubble: closest.h.p.bubble === true } : null });
      const ORDER = { body: 0, symbol: 1, attachment: 2 };
      const parts = kept.map(k => ({ name: nameOf(k.h.p), role: k.role || (k.op ? 'attachment' : 'body') })).sort((a, b) => ORDER[a.role] - ORDER[b.role]);
      // The overlay the report draws: the symbol the shape was matched to (its body, else the closest), placed where the verdict
      // laid it, and the shape's pieces that symbol does not account for. Only for a shape not to standard.
      let overlay = null;
      if (v.verdict === 'not-standard') {
        const body = kept.find(k => !k.op), hit = body ? body.h : closest ? closest.h : null;
        if (hit && isHit(hit)) {
          try {
            const T = templateIn(fr, hit, cfg), pl = hit.placement, turned = pl.o % 2 === 1;
            const segs = asArr(hit.p.segs).filter(g => Array.isArray(g) && g.slice(0, 4).every(isNum)).map(g => [...placePoint(pl, g[0], g[1]), ...placePoint(pl, g[2], g[3])].map(round3));
            const miss = f.pieces.filter(i => pieceOn(S[i], T) < 0.5).map(i => S[i].slice(0, 4).map(round3));
            const stretched = isNum(pl.fitK) && pl.fitK > 0;
            const drawn = f.pieces.map(i => S[i].slice(0, 4).map(round3));
            overlay = { name: nameOf(hit.p), symbol: thinTo(segs), unmatched: thinTo(miss), drawn: thinTo(drawn), placedBox: placedBox(hit).map(round3),
              expected: stretched ? null : (turned ? [hit.p.h, hit.p.w] : [hit.p.w, hit.p.h]).map(x => round3(x * sizeScale)) };
          } catch { overlay = null; }
        }
      }
      out.push({ ...base, standard: v.verdict === 'standard', verdict: v.verdict, reason: v.reason, why, explained: round3(explained), share, operator, closest: shown, parts, ...(overlay ? { overlay } : {}) });
      bodyBoxes.set(out[out.length - 1], kept.filter(k => !k.op).map(k => placedBox(k.h)));
      if (key !== null) memo.set(key, out[out.length - 1]);
    });
    // A shape lying wholly inside a symbol found in another shape (a float switch's inner marks) is part of that
    // symbol: no box of its own (owner, 2026-11-20).
    const within = (b, B) => b[0] >= B[0] - 1 && b[1] >= B[1] - 1 && b[2] <= B[2] + 1 && b[3] <= B[3] + 1;
    return out.filter(e => !out.some(o => o !== e && asArr(bodyBoxes.get(o)).some(B => within(e.box, B))));
  } catch {
    return [];
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

// ── The sheet's scale ─────────────────────────────────────────────────────
// A drawing printed smaller than drawn (an A1 sheet on A3) has every symbol
// far below the legend's size. Its tag bubbles say by how much: the closed
// outlines with writing in them, against the legend's bubbles.
const SCALE_MIN_SAMPLES = 5;       // outlines of one size, with writing, needed before a scale is read
const SCALE_SAME = 1.08;           // outlines within this ratio of each other are one size
const SCALE_NEAR = [0.7, 1.45];    // a ratio inside this is drawn at legend size: left as it is
const SCALE_SANE = [0.2, 5];       // a ratio outside this is not believed

/** The sheet's scale against the legend (1 when it cannot be told or is near 1). Never throws. */
export function estimateSheetScale(input, prepared) {
  try {
    const inp = asObj(input), prep = Array.isArray(prepared) ? prepared : prepareSymbols(inp.library);
    const rings = prep.filter(p => p && p.bubble && p.checkable).map(p => Math.max(p.ring[2] - p.ring[0], p.ring[3] - p.ring[1])).filter(v => v > 0).sort((x, y) => x - y);
    if (!rings.length) return 1;
    const vt = isMatrix(inp.viewportTransform) ? inp.viewportTransform : IDENTITY;
    let words = [];
    try { words = textWords(asArr(inp.textItems), vt); } catch { words = []; }
    const writing = writingBoxes(words, inp.writing);
    if (!writing.length) return 1;
    const sizes = [];
    for (const q of boxesOf(asArr(inp.paths).slice(0, 200000))) {
      const b = q.b, w = b[2] - b[0], h = b[3] - b[1];
      if (w < 4 || h < 4 || w > 400 || h > 400 || w / h > 1.3 || h / w > 1.3 || q.p.filled === true || !isClosedPath(q.p)) continue;
      if (hasWriting(writing, b)) sizes.push(Math.max(w, h));
    }
    // Tag bubbles repeat at one size. A scatter of unlike outlines with writing (valve-number circles, a
    // revision mark, a title-block box) is not a scale: no scale is read unless enough of them are one size.
    sizes.sort((x, y) => x - y);
    let same = 0;
    for (let i = 0, j = 0; i < sizes.length; i++) {
      while (sizes[i] > sizes[j] * SCALE_SAME) j++;
      same = Math.max(same, i - j + 1);
    }
    if (same < SCALE_MIN_SAMPLES) return 1;
    const ratio = sizes[Math.floor(sizes.length / 2)] / rings[Math.floor(rings.length / 2)];
    if (!isNum(ratio) || (ratio >= SCALE_NEAR[0] && ratio <= SCALE_NEAR[1]) || ratio < SCALE_SANE[0] || ratio > SCALE_SANE[1]) return 1;
    return ratio;
  } catch {
    return 1;
  }
}

/**
 * Check one page (see checkSheetAt). A sheet printed at another scale than
 * the legend (options.sheetScale, or read from its tag bubbles unless
 * options.autoScale is false) is checked at legend size and its boxes given
 * back in the page's own points. result.sheetScale says what was used.
 */
export function checkSheet(input) {
  const inp = asObj(input), o = asObj(inp.options);
  let k = 1;
  try {
    if (isNum(o.sheetScale) && o.sheetScale > 0) k = o.sheetScale;
    else if (o.autoScale !== false && asArr(asObj(inp.library).symbols).length) k = estimateSheetScale(inp);
  } catch { k = 1; }
  if (!(k > 0) || k === 1) { const r = checkSheetAt(inp); if (r && r.ok) { r.sheetScale = 1; if (isNum(r.sizeScale)) r.printScale = round3(r.sizeScale); } return r; }
  try {
    const f = 1 / k, vt = isMatrix(inp.viewportTransform) ? Array.from(inp.viewportTransform).slice(0, 6) : IDENTITY;
    const scaled = { ...inp,
      paths: asArr(inp.paths).map(p => (p && Array.isArray(p.segs) ? { ...p, segs: p.segs.map(v => (isNum(v) ? v * f : v)), width: isNum(p.width) ? p.width * f : p.width } : p)),
      viewportTransform: vt.map(v => v * f),
      writing: Array.isArray(inp.writing) ? inp.writing.map(b => (Array.isArray(b) ? b.map(v => (isNum(v) ? v * f : v)) : b)) : inp.writing,
      pageSize: Array.isArray(inp.pageSize) ? inp.pageSize.map(v => (isNum(v) ? v * f : v)) : inp.pageSize };
    const r = checkSheetAt(scaled);
    if (!r || !r.ok) return r;
    const back = b => (Array.isArray(b) ? b.map(v => (isNum(v) ? round3(v * k) : v)) : b);
    for (const v of asArr(r.verdicts)) { v.box = back(v.box); v.tagBox = back(v.tagBox); }
    for (const sy of asArr(r.symbols)) sy.box = back(sy.box);
    for (const sh of asArr(r.shapes)) sh.box = back(sh.box);
    r.skipped = back(r.skipped);
    if (r.drawingArea) r.drawingArea = { ...r.drawingArea, box: back(r.drawingArea.box), cuts: asArr(r.drawingArea.cuts).map(back) };
    r.sheetScale = round3(k);
    if (isNum(r.sizeScale)) r.printScale = round3(k * r.sizeScale);
    return r;
  } catch {
    return { ok: false, why: 'failed' };
  }
}

/**
 * Check one page at legend scale. For each tag: find it on the page, look within `radius` of
 * it for every symbol in the library that can be checked, and give a verdict.
 *
 * One physical symbol answers one tag. Recognised symbols are shared out
 * across the whole sheet, nearest tag first, so that a neighbouring valve
 * cannot make a missing or wrong symbol read as right.
 *
 * Returns plain data only, so the result can be posted from a worker.
 */
function checkSheetAt(input) {
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
    const nearSegs = segmentIndex(segments);   // the segments round a centre, found without reading every segment on the sheet
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
          const nearby = nearSegs(c, reach);
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
        const nearby = nearSegs(c, reach);
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
    let symbols = [], skipped = null, sweptLate = false, shapes, operatorsMarked, drawingAreaOut, sizeScaleOut, readFrom = 'paths', lineCapped, sizeScale = 1, lineMarks = 0;
    if (asObj(inp.options).sweep !== false) {
      const sw = sweep({ cfg, prepared, paths: inp.paths, boxed, segments, nearSegs, pageSize: inp.pageSize,
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

      const listed = candidates.filter(spot => spot.tag !== null || merged.includes(spot)).map(spot => {
        const w = spot.matches[0];
        return { out: { name: nameOf(w.p), tagId: str(asObj(w.p.symbol).tagId), box: spot.box.map(round3), sizePct: Math.round(w.k * 100),
          score: round3(w.score), oneOf: spot.matches.length > 1 ? spot.matches.map(m => nameOf(m.p)) : [], bubble: spot.bubble, tag: spot.tag,
          plain: plainShape(w.p) }, hit: w };
      }).sort((a, b) => (a.out.name < b.out.name ? -1 : a.out.name > b.out.name ? 1 : (a.out.box[1] - b.out.box[1]) || (a.out.box[0] - b.out.box[0])));
      symbols = listed.map(l => l.out);

      // Phase 3: every symbol-sized shape judged against the whole of its ink.
      if (asObj(inp.options).shapes !== false) {
        const band = shapeBand(prepared, cfg);
        const writing = writingBoxes(words, inp.writing);
        const pg = asArr(inp.pageSize);
        // The drawing area: shapes standing in the title strip, on the frame or off it are not judged.
        const area = drawingArea(inp.paths, inp.pageSize);
        // The sheet's own symbol size, from the symbols found on it. options.sizeScale overrides it (for tests).
        const given = asObj(inp.options).sizeScale;
        sizeScale = isNum(given) && given > 0 ? given : sizeScaleOf(listed.map(l => l.hit));
        const spotsIn = listed.map((l, i) => ({ hit: l.hit, symbol: i }));
        const memo = new Map();
        const readWith = (pathsIn, boxedIn) => {
          const split = band ? sheetShapes(pathsIn, { ...band, skip: skipped, writing, page: isNum(pg[0]) && isNum(pg[1]) ? [pg[0], pg[1]] : null }) : { shapes: [], lines: [], segments: [] };
          const centreIn = sh => { const b = asArr(sh && sh.box); if (b.length !== 4 || !b.every(isNum)) return true; const [x, y] = centreOf(b); return insideArea(area, [x, y, x, y]); };
          const cropped = { ...split, shapes: asArr(split.shapes).filter(centreIn) };
          const judged = judgeShapes({ cfg, prepared, boxed: boxedIn, sizeScale, paths: pathsIn, split: cropped, writing, deadline: started + cfg.timeLimitMs, memo,
            spots: spotsIn, near: sw.near, rejected: swept.filter(h => h.plainRejected) });
          // Ticks standing alone on a line are part of it: no box, counted for the sheet heading.
          const inArea = judged.filter(sh => insideArea(area, sh.box)), kept = inArea.filter(sh => sh.lineMark !== true);
          const list = kept.map((sh, i) => ({ ...sh, id: i }));
          list.lineMarks = inArea.length - kept.length;
          return list;
        };
        const greens = list => list.filter(sh => sh.verdict === 'standard').length;
        shapes = readWith(inp.paths, boxed);
        drawingAreaOut = area; sizeScaleOut = sizeScale;
        // Too few green by drawn paths: read the sheet by its line pieces too, and keep the reading with more green.
        if (greens(shapes) < GREEN_SWITCH * shapes.length && clock() - started < cfg.timeLimitMs) {
          const lp = readByLinePieces(inp.paths);
          lineCapped = lp.capped;
          const second = readWith(lp.paths, boxesOf(lp.paths));
          if (greens(second) > greens(shapes)) { shapes = second; readFrom = 'line-pieces'; }
        }
        lineMarks = shapes.lineMarks || 0;
        operatorsMarked = prepared.some(p => p.operator === true);
        for (const sym of symbols) { sym.shape = null; sym.standard = null; }
        for (const sh of shapes) for (const i of sh.symbols) if (symbols[i]) { symbols[i].shape = sh.id; symbols[i].standard = sh.standard; }
      }
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

    // Tag promotion (the tag verdicts are final): a red shape holding a listed symbol that carries a tag is that symbol with
    // extra linework; then a tag with no standard symbol (look or exception) names the nearest red shape within its radius.
    if (shapes) {
      for (const sh of shapes) {
        if (sh.verdict !== 'not-identified') continue;
        const held = asArr(sh.symbols).map(i => symbols[i]).find(sy => sy && sy.tag);
        if (held) { sh.verdict = 'not-standard'; sh.reason = { kind: 'extra', name: held.name }; sh.standard = false; }
      }
      const asks = [];
      tags.forEach((t, ti) => {
        const v = verdicts[ti];
        if ((v.verdict !== 'look' && v.verdict !== 'exception') || !Array.isArray(v.tagBox)) return;
        const c = centreOf(v.tagBox);
        for (const sh of shapes) {
          if (sh.verdict !== 'not-identified') continue;
          const d = Math.hypot(centreOf(sh.box)[0] - c[0], centreOf(sh.box)[1] - c[1]);
          if (d <= cfg.radius) asks.push({ ti, sh, d });
        }
      });
      asks.sort((a, b) => a.d - b.d);
      const usedTag = new Set();
      for (const a of asks) {
        if (usedTag.has(a.ti) || a.sh.verdict !== 'not-identified') continue;
        a.sh.verdict = 'not-standard'; a.sh.reason = { kind: 'tag', tag: tags[a.ti].tag }; a.sh.standard = false;
        usedTag.add(a.ti);
      }
      for (const sym of symbols) if (Number.isInteger(sym.shape) && shapes[sym.shape]) sym.standard = shapes[sym.shape].standard;
    }

    const counts = Object.fromEntries(VERDICTS.map(k => [k, 0]));
    for (const v of verdicts) counts[v.verdict]++;
    const checked = verdicts.filter(v => v.verdict !== 'not-checked').length;
    return { ok: true, verdicts, counts, checked, recognised: counts.ok + counts['off-size'], proposals,
      timedOut: late.some(Boolean) || sweptLate, tagsTimedOut: late.some(Boolean), sweepTimedOut: sweptLate,
      ms: Math.round(clock() - started), symbols, skipped, ...(shapes ? { shapes, operatorsMarked, drawingArea: drawingAreaOut, readFrom, sizeScale: sizeScaleOut, lineMarks, ...(lineCapped !== undefined ? { lineCapped } : {}) } : {}) };
  } catch {
    return { ok: false, why: 'failed' };
  }
}
