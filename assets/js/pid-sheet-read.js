// assets/js/pid-sheet-read.js
// Readers for the P&ID symbol check: each turns a page into ink (paths with
// letters removed) and words (text items with positions), so that the one
// check can judge every format. Pure logic: no DOM, no pdf.js import, no
// File System Access. It runs unchanged in a worker and under `node --test`.
//
// NOTHING FROM A REAL DRAWING BELONGS HERE. assets/js/ is served publicly: no
// drawing, no tag, no legend name, no letter shape. Comments and linework
// arrive as arguments. Tests use invented ones.
//
// Phase 1 reads a sheet whose text is held in comments ("Readable from
// comments": AutoCAD SHX text drawn as strokes, each piece of text also kept
// as a comment). The comments give the words; their rectangles say where the
// stroked letters are, so that ink can be left out of the symbol check.

const isNum = x => typeof x === 'number' && Number.isFinite(x);
const asArr = x => (Array.isArray(x) ? x : []);

/** Points a comment's rectangle is grown by: AutoCAD stores it rounded to whole points. */
export const LETTER_MARGIN = 1;
/** The longest side, in points, of a path that can be a letter (drawing letters are 7 to 14 pt). */
export const LETTER_MAX = 15;

const IDENTITY = [1, 0, 0, 1, 0, 0];
const isMatrix = m => (Array.isArray(m) || (ArrayBuffer.isView(m) && !(m instanceof DataView))) && m.length >= 6
  && [0, 1, 2, 3, 4, 5].every(i => isNum(m[i]));
const rectOf = c => {
  const r = c && typeof c === 'object' ? c.rect : null;
  const a = Array.isArray(r) || (ArrayBuffer.isView(r) && !(r instanceof DataView)) ? Array.from(r) : [];
  return a.length === 4 && a.every(isNum) ? a : null;
};
const textOf = c => (c && typeof c === 'object' && typeof c.text === 'string' ? c.text : '');

/**
 * Each comment as a pdf.js-shaped text item, in PDF user space, so that
 * tagPlaces reads it as it reads a text layer. A comment with no text or no
 * rectangle is left out. A vertical comment keeps its true rectangle.
 */
export function commentWords(comments) {
  const out = [];
  for (const c of asArr(comments)) {
    try {
      const text = textOf(c), r = rectOf(c);
      if (!text.trim() || !r) continue;
      const x0 = Math.min(r[0], r[2]), y0 = Math.min(r[1], r[3]);
      const w = Math.abs(r[2] - r[0]), h = Math.max(1, Math.abs(r[3] - r[1]));
      out.push({ str: text, transform: [h, 0, 0, h, x0, y0], width: w, height: h });
    } catch { /* a comment that cannot be read is left out */ }
  }
  return out;
}

/** Each comment's rectangle in page points (through the viewport transform), grown by LETTER_MARGIN. */
export function letterBoxes(comments, viewportTransform) {
  const vt = isMatrix(viewportTransform) ? viewportTransform : IDENTITY, out = [];
  const at = (x, y) => [vt[0] * x + vt[2] * y + vt[4], vt[1] * x + vt[3] * y + vt[5]];
  for (const c of asArr(comments)) {
    try {
      const r = rectOf(c);
      if (!r) continue;
      const a = at(r[0], r[1]), b = at(r[2], r[3]);
      const box = [Math.min(a[0], b[0]) - LETTER_MARGIN, Math.min(a[1], b[1]) - LETTER_MARGIN,
        Math.max(a[0], b[0]) + LETTER_MARGIN, Math.max(a[1], b[1]) + LETTER_MARGIN];
      if (box.every(isNum)) out.push(box);
    } catch { /* left out */ }
  }
  return out;
}

function pathBox(p) {
  if (!p || typeof p !== 'object' || !Array.isArray(p.segs)) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 1 < p.segs.length; i += 2) {
    const x = p.segs[i], y = p.segs[i + 1];
    if (!isNum(x) || !isNum(y)) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 >= x0 ? [x0, y0, x1, y1] : null;
}

/**
 * Leave out the ink of letters. A path is dropped when it is not filled, lies
 * wholly inside one letter box, and its longer side is at most LETTER_MAX.
 * The cap is fixed, not tied to the box: a one-character comment is narrower
 * than its letter is tall. A big comment box over a symbol keeps the symbol's
 * longer lines and every filled path. Kept paths stay in their order.
 */
export function removeLetterInk(paths, boxes) {
  const list = asArr(paths);
  try {
    const bs = asArr(boxes).filter(b => Array.isArray(b) && b.length === 4 && b.every(isNum));
    if (!bs.length) return { paths: list.slice(), removed: 0 };
    const kept = [];
    let removed = 0;
    for (const p of list) {
      const b = p && p.filled !== true ? pathBox(p) : null;
      const letter = !!b && Math.max(b[2] - b[0], b[3] - b[1]) <= LETTER_MAX
        && bs.some(q => b[0] >= q[0] && b[1] >= q[1] && b[2] <= q[2] && b[3] <= q[3]);
      if (letter) removed++; else kept.push(p);
    }
    return { paths: kept, removed };
  } catch {
    return { paths: list.slice(), removed: 0 };
  }
}

// ── Ink facts: printed or scanned? ────────────────────────────────────────
// A page with no text and no comments is either a printed sheet (letters drawn
// as shapes: thousands of paths) or a scanned one (an image covering the page).
// These counts say which. The walk follows pagePaths in pid-symbols.js.

const asList = x => (Array.isArray(x) || (ArrayBuffer.isView(x) && !(x instanceof DataView)) ? x : []);
const IMAGE_OP_NAMES = ['paintImageXObject', 'paintInlineImageXObject', 'paintImageMaskXObject',
  'paintImageXObjectRepeat', 'paintInlineImageXObjectGroup', 'paintImageMaskXObjectGroup'];
// m x n: n is applied first, as a PDF `cm` post-multiplies the CTM.
function mulM(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

// The unit square through ctm, clipped to the page, in page-area units (points squared).
function unitSquareOnPage(ctm, pw, ph) {
  // The transformed unit square, clipped to the page rectangle edge by edge
  // (Sutherland-Hodgman), then its area by the shoelace formula.
  let poly = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]]);
  if (!poly.every(p => isNum(p[0]) && isNum(p[1]))) return 0;
  // [axis, limit, keep the side below the limit]
  for (const [axis, limit, below] of [[0, 0, false], [0, pw, true], [1, 0, false], [1, ph, true]]) {
    const inside = p => (below ? p[axis] <= limit : p[axis] >= limit);
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if (inside(a)) out.push(a);
      if (inside(a) !== inside(b)) {
        const t = (limit - a[axis]) / (b[axis] - a[axis]);
        out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      }
    }
    poly = out;
    if (poly.length < 3) return 0;
  }
  let twice = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    twice += a[0] * b[1] - b[0] * a[1];
  }
  const area = Math.abs(twice) / 2;
  return isNum(area) ? area : 0;
}

/**
 * How much a page is ink drawn as shapes and how much is picture.
 * `pathCount` is the number of constructPath operators; `imageCover` is the
 * summed area of every image over the page area, capped at 1. Bad input gives
 * zeros. Operators are addressed by OPS name, never by number.
 */
export function pageInkFacts(fnArray, argsArray, OPS, viewportTransform, pageSize) {
  const zero = { pathCount: 0, imageCover: 0 };
  try {
    if (!Array.isArray(fnArray) || !OPS || typeof OPS !== 'object') return zero;
    const args = asArr(argsArray);
    const sz = asList(pageSize);
    const pw = sz[0], ph = sz[1];
    const pageOk = isNum(pw) && isNum(ph) && pw > 0 && ph > 0;
    const imageOps = new Set(IMAGE_OP_NAMES.map(n => OPS[n]).filter(v => v !== undefined && v !== null));
    let ctm = isMatrix(viewportTransform) ? Array.from(viewportTransform).slice(0, 6) : IDENTITY;
    const stack = [];
    let pathCount = 0, cover = 0;
    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i], a = args[i];
      try {
        if (fn === undefined || fn === null) continue;
        if (fn === OPS.save) stack.push(ctm);
        else if (fn === OPS.restore) { if (stack.length) ctm = stack.pop(); }
        else if (fn === OPS.transform) { if (isMatrix(a)) ctm = mulM(ctm, a); }
        else if (fn === OPS.paintFormXObjectBegin) {
          stack.push(ctm);
          const mtx = asList(a)[0];
          if (isMatrix(mtx)) ctm = mulM(ctm, mtx);
        } else if (fn === OPS.paintFormXObjectEnd) { if (stack.length) ctm = stack.pop(); }
        else if (fn === OPS.constructPath) pathCount++;
        else if (pageOk && imageOps.has(fn)) {
          const area = unitSquareOnPage(ctm, pw, ph);
          if (isNum(area)) cover += area / (pw * ph);
        }
      } catch { /* an operator that cannot be read is skipped */ }
    }
    return { pathCount, imageCover: isNum(cover) ? Math.min(1, Math.max(0, cover)) : 0 };
  } catch {
    return zero;
  }
}

// ── Letter spotting for printed sheets ────────────────────────────────────
// On a printed sheet the letters are linework: filled glyph outlines, or
// clusters of short single-line strokes. That ink makes false symbol matches.
// NO LETTER IS READ HERE. A row of small, same-sized shapes standing close on
// one baseline is "letter-like", nothing more; its paths are left out.
// Every grid below uses cells of LETTER_MAX, so cost grows with the number of
// paths, not its square. A cell scans at most CELL_SCAN entries, so a hostile
// pile of paths in one cell cannot make the cost quadratic; what a full cell
// leaves out is counted and reported as `capped`, never skipped silently.
// A path whose box lies beyond a sane range (|cell| >= 2e6) is not a glyph, so
// no loop here can run on coordinates too big to step through.
// KNOWN LIMIT: stroked letters are joined by their boxes, so letters set closer
// than STROKE_JOIN (0.5 pt) merge, and a word longer than LETTER_MAX then
// escapes as one over-size blob and is not spotted. Repeated identical shapes
// (same box size and segment count all along a row, such as a run of small
// valves or arrowheads) are symbol linework, not letters, and are not spotted.

export const GLYPH_MIN = 1.5, ROW_MIN = 3, STROKE_JOIN = 0.5;
const CELL_SCAN = 256;
const HEIGHT_AGREE = 0.25, BASE_AGREE = 0.2, GAP_MIN = -0.1, GAP_MAX = 1.5;

// A path's box, only when its segs are whole straight segments (4 numbers each), all finite.
function strictBox(p) {
  if (!p || typeof p !== 'object' || !Array.isArray(p.segs)) return null;
  const s = p.segs;
  if (!s.length || s.length % 4 !== 0) return null;
  for (let i = 0; i < s.length; i++) if (!isNum(s[i])) return null;
  return pathBox(p);
}
const longer = b => Math.max(b[2] - b[0], b[3] - b[1]);
const fitsGlyph = b => { const l = longer(b); return l >= GLYPH_MIN && l <= LETTER_MAX; };
const cellKey = (cx, cy) => cx * 4194304 + cy;      // cx, cy are small integers in a sane page
const cellOf = v => Math.floor(v / LETTER_MAX);
const CELL_RANGE = 2e6;
const saneBox = b => b.every(v => Math.abs(cellOf(v)) < CELL_RANGE);
const segCountOf = p => p.segs.length / 4;
// Cells a box covers; a box beyond a sane range is not indexed (never a huge loop).
function eachCell(b, fn) {
  const x0 = cellOf(b[0]), x1 = cellOf(b[2]), y0 = cellOf(b[1]), y1 = cellOf(b[3]);
  if (![x0, x1, y0, y1].every(v => Math.abs(v) < 2e6) || (x1 - x0 + 1) * (y1 - y0 + 1) > 400) return;
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) fn(cellKey(x, y));
}

/**
 * Glyph candidates. Filled: one path, longer side from GLYPH_MIN to LETTER_MAX.
 * Stroked: unfilled paths no longer than LETTER_MAX, joined where their boxes
 * come within STROKE_JOIN; a joined cluster of the same size is a glyph.
 * `members` are indices into `paths`.
 */
export function glyphsOf(paths) {
  return glyphsInfo(paths).glyphs;
}

// Filled pieces that abut (the gap along one axis within +-ABUT pt, and they
// overlap by at least ABUT_SHARE of the shorter side across that shared edge)
// are the cut-up fill of one shape, such as a valve drawn as stacked slices:
// they are joined before sizing. Kerned letters overlap more than ABUT and are
// not joined. Pushes the glyphs into `out`; returns how many pieces the grid
// could not hold (reported as capped).
const ABUT = 0.1, ABUT_SHARE = 0.8;
function abuts(a, b) {
  const gx = Math.max(a[0] - b[2], b[0] - a[2]), gy = Math.max(a[1] - b[3], b[1] - a[3]);
  const oy = Math.min(a[3], b[3]) - Math.max(a[1], b[1]), ox = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  if (Math.abs(gx) <= ABUT && oy >= ABUT_SHARE * Math.min(a[3] - a[1], b[3] - b[1]) && oy > 0) return true;
  return Math.abs(gy) <= ABUT && ox >= ABUT_SHARE * Math.min(a[2] - a[0], b[2] - b[0]) && ox > 0;
}
function joinFilled(list, fills, fboxes, out) {
  let capped = 0;
  const n = fills.length, parent = Array.from({ length: n }, (_, k) => k);
  const find = k => { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; };
  const grid = new Map();
  for (let k = 0; k < n; k++) {
    let full = false;
    const b = fboxes[k], grown = [b[0] - ABUT, b[1] - ABUT, b[2] + ABUT, b[3] + ABUT];
    eachCell(grown, key => {
      let cell = grid.get(key);
      if (!cell) { cell = []; grid.set(key, cell); }
      const m = Math.min(cell.length, CELL_SCAN);
      for (let t = 0; t < m; t++) {
        if (abuts(b, fboxes[cell[t]])) { const ra = find(k), rb = find(cell[t]); if (ra !== rb) parent[ra] = rb; }
      }
      if (cell.length < CELL_SCAN) cell.push(k); else full = true;
    });
    if (full) capped++;
  }
  const groups = new Map();
  for (let k = 0; k < n; k++) {
    const r = find(k), b = fboxes[k];
    let g = groups.get(r);
    if (!g) { g = { box: b.slice(), members: [], segCount: 0 }; groups.set(r, g); }
    g.box = [Math.min(g.box[0], b[0]), Math.min(g.box[1], b[1]), Math.max(g.box[2], b[2]), Math.max(g.box[3], b[3])];
    g.members.push(fills[k]);
    g.segCount += segCountOf(list[fills[k]]);
  }
  for (const g of groups.values()) if (fitsGlyph(g.box)) out.push({ box: g.box, members: g.members, kind: 'filled', segCount: g.segCount });
  return capped;
}

function glyphsInfo(paths) {
  let capped = 0;
  try {
    const list = asArr(paths), out = [], strokes = [], sboxes = [], fills = [], fboxes = [];
    for (let i = 0; i < list.length; i++) {
      const p = list[i], b = strictBox(p);
      if (!b || !saneBox(b)) continue;
      if (p.filled === true) { if (longer(b) <= LETTER_MAX) { fills.push(i); fboxes.push(b); } continue; }
      if (longer(b) <= LETTER_MAX) { strokes.push(i); sboxes.push(b); }
    }
    capped += joinFilled(list, fills, fboxes, out);
    const n = strokes.length, parent = Array.from({ length: n }, (_, k) => k);
    const find = k => { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; };
    const grid = new Map();
    const J = STROKE_JOIN;
    for (let k = 0; k < n; k++) {
      let full = false;
      const b = sboxes[k], grown = [b[0] - J, b[1] - J, b[2] + J, b[3] + J];
      eachCell(grown, key => {
        let cell = grid.get(key);
        if (!cell) { cell = []; grid.set(key, cell); }
        const m = Math.min(cell.length, CELL_SCAN);
        for (let t = 0; t < m; t++) {
          const o = sboxes[cell[t]];
          if (Math.max(o[0] - b[2], b[0] - o[2], 0) <= J && Math.max(o[1] - b[3], b[1] - o[3], 0) <= J) {
            const ra = find(k), rb = find(cell[t]);
            if (ra !== rb) parent[ra] = rb;
          }
        }
        if (cell.length < CELL_SCAN) cell.push(k); else full = true;
      });
      if (full) capped++;
    }
    const groups = new Map();
    for (let k = 0; k < n; k++) {
      const r = find(k);
      let g = groups.get(r);
      if (!g) { g = { box: sboxes[k].slice(), members: [], segCount: 0 }; groups.set(r, g); }
      const b = sboxes[k];
      if (b[0] < g.box[0]) g.box[0] = b[0];
      if (b[1] < g.box[1]) g.box[1] = b[1];
      if (b[2] > g.box[2]) g.box[2] = b[2];
      if (b[3] > g.box[3]) g.box[3] = b[3];
      g.members.push(strokes[k]);
      g.segCount += segCountOf(list[strokes[k]]);
    }
    for (const g of groups.values()) if (fitsGlyph(g.box)) out.push({ box: g.box, members: g.members, kind: 'stroked', segCount: g.segCount });
    out.sort((a, b) => a.members[0] - b.members[0]);
    return { glyphs: out, capped };
  } catch {
    return { glyphs: [], capped };
  }
}

// A glyph's box along a row's direction: [start, top, end, bottom]; a vertical row swaps x and y.
const framed = (b, vertical) => (vertical ? [b[1], b[0], b[3], b[2]] : [b[0], b[1], b[2], b[3]]);

function rowsOfKind(glyphs, idx, vertical, used, rows) {
  let dropped = 0;
  const refused = new Set();
  const fr = new Map();
  const cand = [];
  for (const g of idx) {
    const f = framed(glyphs[g].box, vertical);
    if (f[3] - f[1] < GLYPH_MIN) continue;          // no height along this direction: a dash cannot be a glyph here
    fr.set(g, f);
    cand.push(g);
  }
  cand.sort((a, b) => fr.get(a)[0] - fr.get(b)[0]);
  const grid = new Map();
  for (const g of cand) {
    const f = fr.get(g), key = cellKey(cellOf(f[0]), cellOf(f[1]));
    const cell = grid.get(key);
    if (!cell) grid.set(key, [g]); else if (cell.length < CELL_SCAN) cell.push(g); else dropped++;
  }
  const agree = (a, b) => Math.abs(a - b) <= HEIGHT_AGREE * Math.max(a, b);
  for (const seed of cand) {
    if (used.has(seed) || refused.has(seed)) continue;
    const sf = fr.get(seed), h = sf[3] - sf[1], base = sf[3];
    const chain = [seed], inChain = new Set(chain);
    let end = sf[2];
    for (;;) {
      // Window for the next glyph's start, and (from its height) its top.
      const xLo = end + GAP_MIN * h, xHi = end + GAP_MAX * h;
      const yLo = base - BASE_AGREE * h - h / (1 - HEIGHT_AGREE), yHi = base + BASE_AGREE * h;
      let best = -1, bestStart = Infinity;
      const cx0 = cellOf(xLo), cx1 = cellOf(xHi), cy0 = cellOf(yLo), cy1 = cellOf(yHi);
      if (!(cx1 - cx0 < 16 && cy1 - cy0 < 16 && Math.abs(cx0) < CELL_RANGE && Math.abs(cy0) < CELL_RANGE)) break;
      for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
        const cell = grid.get(cellKey(cx, cy));
        if (!cell) continue;
        for (const c of cell) {
          if (used.has(c) || inChain.has(c)) continue;
          const f = fr.get(c), ch = f[3] - f[1], gap = (f[0] - end) / h;
          if (gap < GAP_MIN || gap > GAP_MAX || f[0] >= bestStart) continue;
          if (!agree(ch, h) || Math.abs(f[3] - base) > BASE_AGREE * h) continue;
          best = c; bestStart = f[0];
        }
      }
      if (best < 0) break;
      chain.push(best); inChain.add(best); end = Math.max(end, fr.get(best)[2]);
    }
    if (chain.length >= ROW_MIN && repeatedShape(glyphs, chain)) {
      for (const g of chain) refused.add(g);
    } else if (chain.length >= ROW_MIN) {
      const box = chain.reduce((u, g) => {
        const b = glyphs[g].box;
        return [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])];
      }, glyphs[chain[0]].box.slice());
      for (const g of chain) used.add(g);
      rows.push({ box, members: chain, vertical });
    }
  }
  return dropped;
}

// Identical shapes all along a row (box width and height within 3% of the first, one segment count): symbol linework, not text.
function repeatedShape(glyphs, chain) {
  const a = glyphs[chain[0]], w = a.box[2] - a.box[0], h = a.box[3] - a.box[1];
  const near = (v, r) => Math.abs(v - r) <= 0.03 * r;
  return chain.every(g => {
    const b = glyphs[g];
    return b.segCount === a.segCount && near(b.box[2] - b.box[0], w) && near(b.box[3] - b.box[1], h);
  });
}

/**
 * Rows of letter-like glyphs. Glyphs of one kind make a horizontal row when
 * their heights agree within 25%, their bottoms lie within 20% of the height
 * and each gap to the next is from -0.1 to 1.5 heights; a vertical row is the
 * same with x and y swapped. A row needs ROW_MIN glyphs; a glyph is in at most
 * one row and horizontal rows are tried first.
 */
export function letterRows(glyphs) {
  return rowsInfo(glyphs).rows;
}

function rowsInfo(glyphs) {
  let dropped = 0;
  try {
    const gs = asArr(glyphs).filter(g => g && Array.isArray(g.box) && g.box.length === 4 && g.box.every(isNum));
    const rows = [], used = new Set();
    for (const vertical of [false, true]) {
      for (const kind of ['filled', 'stroked']) {
        const idx = [];
        gs.forEach((g, i) => { if (g.kind === kind) idx.push(i); });
        dropped += rowsOfKind(gs, idx, vertical, used, rows);
      }
    }
    return { rows, dropped };
  } catch {
    return { rows: [], dropped };
  }
}

/** The paths that are letter ink: `members` (path indices, ascending), with the glyph and row counts. */
export function spotLetters(paths) {
  const none = { members: [], glyphs: 0, rows: 0, capped: 0 };
  try {
    const gi = glyphsInfo(paths), glyphs = gi.glyphs;
    const ri = rowsInfo(glyphs), rows = ri.rows;
    const set = new Set();
    for (const r of rows) for (const g of r.members) for (const m of glyphs[g].members) set.add(m);
    return { members: Array.from(set).sort((a, b) => a - b), glyphs: glyphs.length, rows: rows.length, capped: gi.capped + ri.dropped };
  } catch {
    return none;
  }
}

/** The paths with the spotted letters left out, kept in order. */
export function removeSpottedLetters(paths) {
  const list = asArr(paths);
  try {
    const s = spotLetters(list);
    if (!s.members.length) return { paths: list.slice(), removed: 0, rows: 0, capped: s.capped };
    const gone = new Set(s.members);
    return { paths: list.filter((_, i) => !gone.has(i)), removed: gone.size, rows: s.rows, capped: s.capped };
  } catch {
    return { paths: list.slice(), removed: 0, rows: 0, capped: 0 };
  }
}

// ── Shapes: the linework cut into symbol-sized pieces (phase 3) ───────────
// THIS SPLITS LINEWORK; IT RECOGNISES NOTHING. The P&ID check asks of every
// drawn shape whether standard symbols explain all of it, so it first needs
// the shapes: the sheet's ink with its linework taken out.
//
// Linework, each kind returned as a `line`:
// - run: collinear pieces joined across gaps up to RUN_GAP, longer than any
//   legend line could be drawn (options.longRun): pipelines, signal lines;
//   a straight piece standing alone is a short run too;
// - dashed: DASH_MIN or more short collinear dashes with even gaps;
// - hatch: HATCH_MIN or more like-sized strokes, each from one run to a
//   parallel one (lagged pipe);
// - connector: a straight piece from one shape's edge to another's (a leader
//   to a bubble, a short pipe between two valves), or from a line to a shape
//   with nothing else at the line end (a stub from a pipe tee).
// What is left groups into shapes wherever pieces touch or cross within
// SHAPE_JOIN. A closed outline holding writing (a bubble) is a shape of its
// own: only what lies inside its box joins it. Shapes whose longer side is
// outside [minSide, maxSide] are dropped.
// Every lookup goes through a grid of cells at least 10 pt across, so the
// cost grows with the number of pieces; a cell scans at most SHAPE_CELL_SCAN
// entries (the result's `capped` counts the lookups cut short), and a sheet
// past SHAPE_BUDGET cell entries is not split (`capped: true`). Never throws.

export const SHAPE_JOIN = 0.5, DASH_MIN = 3, HATCH_MIN = 3;   // HATCH_MIN tuned from 4 on the owner's answers (2026-11-18)
const SH_RUN_GAP = 2;           // as RUN_GAP in pid-symbol-check.js
const DASH_GAP_MAX = 5;         // points: the widest gap between two dashes of one dashed line
const DASH_LEN_MAX = 12;        // points: the longest dash
const DASH_EVEN = 0.3;          // each gap within this share of the median gap
const HATCH_TOL = 1;            // points: a hatch stroke's ends lie this close to its two runs
const HATCH_SAME = 0.25;        // hatch strokes' lengths agree within this share of their median (one may be cut short by a valve)
const TAIL_MIN = 4;            // points: a straight line hanging off a shape by a free end, at least this long, is linework
const ARROW_MAX = 16;          // points: a lone triangle on a line no longer than this is an arrowhead
const CURVE_GAP = 4;           // points: open curves this close to each other are one shape
const THIN_FLOOR = 4;          // points: a long sliver thinner than this is linework, whatever the legend's thinnest symbol (tuned)
const SMOOTH_TURN = 0.6;        // sin of the sharpest turn between pieces of a smooth curve (about 37 degrees)
const PAGE_MARGIN = 20;        // points: a shape wholly this close to the page's edge is a border mark, not judged
const LABEL_ASPECT = 3;        // an outline holding writing this many times longer than wide is a label, not judged
const SIDE_SCAN = 400;         // pieces looked at to size what a cut would leave
const COL_SIN = 0.02;           // collinear: directions within about 1 degree
const COL_OFF = 0.3;            // collinear: each end within this of the other's line
const STROKE_MERGE = 0.3;       // points: collinear pieces this close are one stroke
const NOT_PARALLEL = 0.2;       // sin of the angle a stub or hatch stroke must make with its line
const SHAPE_COORD = 15000;      // points; beyond any sheet
const SHAPE_BUDGET = 4e6, SHAPE_CELL_SCAN = 256, CONNECT_MAX = 300;
const SHAPE_INK_GREY = 175;     // as CHECK_DEFAULTS.inkGrey

const EMPTY_SHAPES = () => ({ shapes: [], lines: [], segments: [] });
const boxOk = b => Array.isArray(b) && b.length === 4 && b.every(isNum);
const inBoxPt = (b, x, y) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];

// Distance from point (px, py) to segment s.
function ptSeg(px, py, s) {
  const dx = s[2] - s[0], dy = s[3] - s[1], l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - s[0]) * dx + (py - s[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (s[0] + t * dx), py - (s[1] + t * dy));
}
// Distance from a point to the infinite line through segment s with unit direction u.
const ptLine = (x, y, s, u) => Math.abs((x - s[0]) * u[1] - (y - s[1]) * u[0]);
const orient = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
function segDist(a, b) {
  const d1 = orient(a[0], a[1], a[2], a[3], b[0], b[1]), d2 = orient(a[0], a[1], a[2], a[3], b[2], b[3]);
  const d3 = orient(b[0], b[1], b[2], b[3], a[0], a[1]), d4 = orient(b[0], b[1], b[2], b[3], a[2], a[3]);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(ptSeg(b[0], b[1], a), ptSeg(b[2], b[3], a), ptSeg(a[0], a[1], b), ptSeg(a[2], a[3], b));
}
const unitOf = s => [(s[2] - s[0]) / s[4], (s[3] - s[1]) / s[4]];
const sinBetween = (u, v) => Math.abs(u[0] * v[1] - u[1] * v[0]);
function makeFind(n) {
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = k => { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; };
  return { find, union: (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; } };
}
function boxOfSegs(S, m) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const i of m) { const q = S[i]; x0 = Math.min(x0, q[0], q[2]); y0 = Math.min(y0, q[1], q[3]); x1 = Math.max(x1, q[0], q[2]); y1 = Math.max(y1, q[1], q[3]); }
  return [x0, y0, x1, y1];
}
const longSide = b => Math.max(b[2] - b[0], b[3] - b[1]);
// The number of corners of the convex hull of some points (corners closer to straight than about 3 degrees dropped).
function hullCorners(points) {
  // Points within 0.3 pt of one already kept are the same point (a shape drawn twice, rounding apart).
  const p = [];
  for (const q of points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])) if (!p.some(k => Math.hypot(k[0] - q[0], k[1] - q[1]) < 0.3)) p.push(q);
  if (p.length < 3) return p.length;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = list => { const h = []; for (const q of list) { while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop(); h.push(q); } return h; };
  const hull = [...half(p).slice(0, -1), ...half(p.slice().reverse()).slice(0, -1)];
  const n = hull.length;
  let corners = 0;
  for (let k = 0; k < n; k++) {
    const a = hull[(k + n - 1) % n], b = hull[k], c = hull[(k + 1) % n];
    const u = [b[0] - a[0], b[1] - a[1]], v = [c[0] - b[0], c[1] - b[1]];
    const lu = Math.hypot(u[0], u[1]), lv = Math.hypot(v[0], v[1]);
    if (lu < 0.3 || lv < 0.3) continue;
    if (Math.abs(u[0] * v[1] - u[1] * v[0]) / (lu * lv) > 0.05) corners++;
  }
  return corners;
}

// Segments, and the closed paths among them ({ from, to, box }: a path whose segments run end to end and close).
function flattenInk(paths, skip) {
  const S = [], closed = [];
  asArr(paths).forEach((p, pi) => {
    if (!p || typeof p !== 'object' || !Array.isArray(p.segs)) return;
    if ((isNum(p.grey) ? p.grey : 0) >= SHAPE_INK_GREY) return;
    const s = p.segs, from = S.length;
    let whole = s.length >= 12 && s.length % 4 === 0;
    for (let i = 0; i + 3 < s.length; i += 4) {
      const a = s[i], b = s[i + 1], c = s[i + 2], d = s[i + 3];
      if (![a, b, c, d].every(isNum) || Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d)) > SHAPE_COORD) { whole = false; continue; }
      const len = Math.hypot(c - a, d - b);
      if (len <= 0.05 || (skip && inBoxPt(skip, (a + c) / 2, (b + d) / 2))) { whole = false; continue; }
      S.push([a, b, c, d, len, pi]);
    }
    if (!whole || S.length - from < 3) return;
    for (let k = from + 1; k < S.length; k++) if (Math.hypot(S[k][0] - S[k - 1][2], S[k][1] - S[k - 1][3]) >= 0.05) return;
    const last = S[S.length - 1];
    if (Math.hypot(S[from][0] - last[2], S[from][1] - last[3]) < 0.05) closed.push({ from, to: S.length, box: boxOfSegs(S, Array.from({ length: S.length - from }, (_, k) => from + k)) });
  });
  return { S, closed };
}

/**
 * Cut a sheet's ink into shapes and lines. paths: page paths in points,
 * top-left (letters already left out). options = { minSide, maxSide, longRun,
 * skip, writing }: the symbol-size band and the long-run length in points, an
 * optional box not split (the title block), optional writing boxes (for
 * the bubble rule), minShort (the thinnest symbol) and page ([w, h], for the
 * border strip). Returns { shapes, lines, segments } where
 * segments = [x0, y0, x1, y1, len, pathIndex][], shapes = [{ id, box,
 * pieces, closed }] and lines = [{ kind, pieces }]; pieces index `segments`.
 */
export function sheetShapes(paths, options) {
  try {
    const o = options && typeof options === 'object' ? options : null;
    if (!o || ![o.minSide, o.maxSide, o.longRun].every(v => isNum(v) && v > 0) || o.minSide > o.maxSide) return EMPTY_SHAPES();
    const skip = boxOk(o.skip) ? o.skip : null;
    const writing = asArr(o.writing).filter(boxOk);
    const { S, closed: closedPaths } = flattenInk(paths, skip);
    const n = S.length;
    if (!n) return EMPTY_SHAPES();

    // The grid: each segment in every cell it passes through. Cells are at
    // least twice the widest gap looked across, so a neighbour is always in
    // one of the 3 x 3 cells round one of a segment's own.
    const C = Math.max(10, o.longRun / 4), cellOfV = v => Math.floor(v / C), key = (x, y) => (x + 2048) * 4096 + y + 2048;   // |cell| < 1501: small integer keys
    const grid = new Map(), cellsOf = new Array(n);
    let budget = 0;
    for (let i = 0; i < n; i++) {
      const s = S[i], steps = Math.max(1, Math.ceil(s[4] / (C / 4))), mine = [];
      for (let k = 0; k <= steps; k++) {
        const cx = cellOfV(s[0] + (s[2] - s[0]) * k / steps), cy = cellOfV(s[1] + (s[3] - s[1]) * k / steps);
        let had = false;
        for (let q = mine.length - 2; q >= 0 && !had; q -= 2) had = mine[q] === cx && mine[q + 1] === cy;
        if (!had) mine.push(cx, cy);
      }
      budget += mine.length / 2;
      if (budget > SHAPE_BUDGET) return { ...EMPTY_SHAPES(), capped: true };
      cellsOf[i] = mine;
      for (let k = 0; k < mine.length; k += 2) { const kk = key(mine[k], mine[k + 1]); let c = grid.get(kk); if (!c) grid.set(kk, c = []); c.push(i); }
    }
    const stamp = new Int32Array(n).fill(-1);
    let capped = 0;   // neighbour lookups cut short by a full cell: reported, never silent
    // Every segment j near segment i, each once.
    const eachNear = (i, fn) => {
      const mine = cellsOf[i];
      for (let k = 0; k < mine.length; k += 2) {
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          const cell = grid.get(key(mine[k] + dx, mine[k + 1] + dy));
          if (!cell) continue;
          const m = Math.min(cell.length, SHAPE_CELL_SCAN);
          if (cell.length > m) capped++;
          for (let t = 0; t < m; t++) { const j = cell[t]; if (j !== i && stamp[j] !== i) { stamp[j] = i; fn(j); } }
        }
      }
    };
    // Touches (for grouping) and collinear neighbours (for runs and dashes).
    const units = S.map(unitOf);
    const bx0 = new Float64Array(n), by0 = new Float64Array(n), bx1 = new Float64Array(n), by1 = new Float64Array(n);
    for (let i = 0; i < n; i++) { const q = S[i]; bx0[i] = Math.min(q[0], q[2]); bx1[i] = Math.max(q[0], q[2]); by0[i] = Math.min(q[1], q[3]); by1[i] = Math.max(q[1], q[3]); }
    // adj: pieces within SHAPE_JOIN; close: within HATCH_TOL (a superset). Lists are made when first needed.
    const NONE = [], col = makeFind(n), adj = new Array(n).fill(NONE), close = new Array(n).fill(NONE);
    const link = (lists, i, j) => { if (lists[i] === NONE) lists[i] = []; if (lists[j] === NONE) lists[j] = []; lists[i].push(j); lists[j].push(i); };
    const G = DASH_GAP_MAX;
    for (let i = 0; i < n; i++) {
      const a = S[i], u = units[i];
      eachNear(i, j => {
        if (j < i || bx0[j] > bx1[i] + G || bx1[j] < bx0[i] - G || by0[j] > by1[i] + G || by1[j] < by0[i] - G) return;
        const b = S[j], v = units[j];
        const d = segDist(a, b);
        if (d > G) return;
        if (d <= HATCH_TOL) link(close, i, j);
        if (d <= SHAPE_JOIN) link(adj, i, j);
        if (sinBetween(u, v) > COL_SIN) return;
        if (ptLine(b[0], b[1], a, u) > COL_OFF || ptLine(b[2], b[3], a, u) > COL_OFF) return;
        if (ptLine(a[0], a[1], b, v) > COL_OFF || ptLine(a[2], a[3], b, v) > COL_OFF) return;
        const ta0 = a[0] * u[0] + a[1] * u[1], ta1 = a[2] * u[0] + a[3] * u[1], tb0 = b[0] * u[0] + b[1] * u[1], tb1 = b[2] * u[0] + b[3] * u[1];
        const gap = Math.max(Math.min(tb0, tb1) - Math.max(ta0, ta1), Math.min(ta0, ta1) - Math.max(tb0, tb1));
        if (gap <= G) col.union(i, j);
      });
    }

    // Collinear families: strokes, dashed lines, runs, and short straight chains.
    const kind = new Array(n).fill(null), lines = [], chains = [];
    const fams = new Map();
    for (let i = 0; i < n; i++) { const r = col.find(i); let f = fams.get(r); if (!f) fams.set(r, f = []); f.push(i); }
    for (const members of fams.values()) {
      if (members.length === 1) {
        // A piece on its own: a long run, or a short straight chain.
        const i = members[0], q = S[i];
        if (q[4] > o.longRun) { kind[i] = 'run'; lines.push({ kind: 'run', pieces: [i] }); }
        else chains.push({ m: [i], u: units[i], len: q[4], ends: [[q[0], q[1]], [q[2], q[3]]], line: false });
        continue;
      }
      let lead = members[0];
      for (const i of members) if (S[i][4] > S[lead][4]) lead = i;
      const u = units[lead], along = (x, y) => x * u[0] + y * u[1];
      const iv = members.map(i => { const s = S[i], t0 = along(s[0], s[1]), t1 = along(s[2], s[3]); return { i, t0: Math.min(t0, t1), t1: Math.max(t0, t1) }; })
        .sort((p, q) => p.t0 - q.t0);
      const strokes = [];
      for (const v of iv) {
        const cur = strokes[strokes.length - 1];
        if (cur && v.t0 <= cur.t1 + STROKE_MERGE) { cur.t1 = Math.max(cur.t1, v.t1); cur.m.push(v.i); } else strokes.push({ t0: v.t0, t1: v.t1, m: [v.i], dashed: false });
      }
      // Dashed: short strokes with gaps up to DASH_GAP_MAX, each within DASH_EVEN of the median gap.
      for (let k = 0; k < strokes.length;) {
        let e = k;
        if (strokes[k].t1 - strokes[k].t0 <= DASH_LEN_MAX) {
          while (e + 1 < strokes.length && strokes[e + 1].t1 - strokes[e + 1].t0 <= DASH_LEN_MAX && strokes[e + 1].t0 - strokes[e].t1 <= DASH_GAP_MAX) e++;
        }
        if (e - k + 1 >= DASH_MIN) {
          const gaps = [];
          for (let q = k; q < e; q++) gaps.push(strokes[q + 1].t0 - strokes[q].t1);
          const med = gaps.slice().sort((p, q) => p - q)[Math.floor(gaps.length / 2)];
          if (med > 0 && gaps.every(g => Math.abs(g - med) <= DASH_EVEN * med)) {
            const pieces = [];
            for (let q = k; q <= e; q++) { strokes[q].dashed = true; pieces.push(...strokes[q].m); }
            for (const i of pieces) kind[i] = 'dashed';
            lines.push({ kind: 'dashed', pieces: pieces.sort((p, q) => p - q) });
          }
        }
        k = e + 1;
      }
      // Runs: the other strokes joined across gaps up to RUN_GAP.
      let run = null;
      const closeRun = () => {
        if (!run) return;
        if (run.t1 - run.t0 > o.longRun) {
          for (const i of run.m) kind[i] = 'run';
          lines.push({ kind: 'run', pieces: run.m.sort((p, q) => p - q) });
        } else {
          let lo = null, hi = null, tlo = Infinity, thi = -Infinity;
          for (const i of run.m) {
            for (const e of [0, 2]) {
              const t = along(S[i][e], S[i][e + 1]);
              if (t < tlo) { tlo = t; lo = [S[i][e], S[i][e + 1]]; }
              if (t > thi) { thi = t; hi = [S[i][e], S[i][e + 1]]; }
            }
          }
          chains.push({ m: run.m, u, len: run.t1 - run.t0, ends: [lo, hi], line: false });
        }
        run = null;
      };
      for (const st of strokes) {
        if (st.dashed) continue;
        if (run && st.t0 <= run.t1 + SH_RUN_GAP) { run.t1 = Math.max(run.t1, st.t1); run.m.push(...st.m); } else { closeRun(); run = { t0: st.t0, t1: st.t1, m: st.m.slice() }; }
      }
      closeRun();
    }
    const chainOf = new Int32Array(n).fill(-1);
    chains.forEach((ch, ci) => { for (const i of ch.m) chainOf[i] = ci; });
    const asLine = (ch, k) => {
      ch.line = true;
      for (const i of ch.m) kind[i] = k;
    };

    // The pieces outside chain ci lying within tol of a point, found among the chain's own neighbours.
    const atEnd = (pt, ci, tol) => {
      const out = [];
      for (const i of chains[ci].m) for (const j of (tol > SHAPE_JOIN ? close : adj)[i]) {
        if (chainOf[j] !== ci && !out.includes(j) && ptSeg(pt[0], pt[1], S[j]) <= tol) out.push(j);
      }
      return out;
    };
    const free = i => kind[i] === null;
    const piecesAt = (pt, ci) => atEnd(pt, ci, SHAPE_JOIN);
    const asNewLine = (ch, k) => { asLine(ch, k); lines.push({ kind: k, pieces: ch.m.slice().sort((p, q) => p - q) }); };

    // Hatch: HATCH_MIN or more like-sized short chains, each from one line to
    // a parallel one (any length): the strokes are hatch, the two lines run.
    // The pieces at each end the stroke crosses (not parallel to it); the pair taken is two parallel lines of different families.
    const across = (pt, ci, u) => atEnd(pt, ci, HATCH_TOL).filter(j => sinBetween(u, units[j]) > NOT_PARALLEL);
    const hatchGroups = new Map();
    chains.forEach((ch, ci) => {
      if (ch.line) return;
      let a = -1, b = -1;
      for (const x of across(ch.ends[0], ci, ch.u)) {
        for (const y of across(ch.ends[1], ci, ch.u)) if (col.find(x) !== col.find(y) && sinBetween(units[x], units[y]) <= COL_SIN) { a = x; b = y; break; }
        if (a >= 0) break;
      }
      if (a < 0 || b < 0) return;
      const fa = col.find(a), fb = col.find(b);
      const hk = Math.min(fa, fb) + ':' + Math.max(fa, fb);
      let g = hatchGroups.get(hk);
      if (!g) hatchGroups.set(hk, g = { strokes: [], sides: new Set() });
      g.strokes.push(ch); g.sides.add(a); g.sides.add(b);
    });
    for (const g of hatchGroups.values()) {
      if (g.strokes.length < HATCH_MIN) continue;
      const med = g.strokes.map(c => c.len).sort((p, q) => p - q)[Math.floor(g.strokes.length / 2)];
      const same = g.strokes.filter(c => !c.line && Math.abs(c.len - med) <= HATCH_SAME * med);
      if (same.length < HATCH_MIN) continue;
      for (const c of same) asLine(c, 'hatch');
      lines.push({ kind: 'hatch', pieces: same.flatMap(c => c.m).sort((p, q) => p - q) });
      for (const j of g.sides) if (chainOf[j] >= 0 && !chains[chainOf[j]].line) asNewLine(chains[chainOf[j]], 'run');
    }

    // Stubs, to a fixed point: a straight chain with an end on a line it is
    // not parallel to and nothing else at that end is line too, so line
    // spreads from long runs through pipe bends and tees, never round a
    // symbol's corner (where another symbol line meets it).
    const isStub = ci => {
      const ch = chains[ci];
      for (const end of ch.ends) {
        const at = piecesAt(end, ci);
        if (!at.some(free) && at.some(j => sinBetween(ch.u, units[j]) > NOT_PARALLEL)) return true;
      }
      return false;
    };
    const queue = chains.map((_, ci) => ci), queued = new Uint8Array(chains.length).fill(1);
    for (let guard = 0; queue.length && guard < 4 * chains.length + 16; guard++) {
      const ci = queue.pop();
      queued[ci] = 0;
      const ch = chains[ci];
      if (ch.line || !isStub(ci)) continue;
      asNewLine(ch, 'connector');
      for (const i of ch.m) for (const j of adj[i]) {
        const cj = chainOf[j];
        if (cj >= 0 && !chains[cj].line && !queued[cj]) { queued[cj] = 1; queue.push(cj); }
      }
    }

    // Outlines holding writing: only what lies inside an outline's box joins it.
    const outlineOf = new Int32Array(n).fill(-1), outlines = [];
    for (const cp of closedPaths) {
      if (!writing.some(w => inBoxPt(cp.box, (w[0] + w[2]) / 2, (w[1] + w[3]) / 2))) continue;
      for (let k = cp.from; k < cp.to; k++) outlineOf[k] = outlines.length;
      outlines.push(cp.box);
    }
    const J = SHAPE_JOIN;
    // Inside: both ends within the box (grown by J), the middle clear of its edge (a bar across a ring is inside; a symbol touching its edge is not).
    const insideBox = (b, s) => Math.min(s[0], s[2]) >= b[0] - J && Math.max(s[0], s[2]) <= b[2] + J && Math.min(s[1], s[3]) >= b[1] - J && Math.max(s[1], s[3]) <= b[3] + J
      && inBoxPt([b[0] + J, b[1] + J, b[2] - J, b[3] - J], (s[0] + s[2]) / 2, (s[1] + s[3]) / 2);
    const mayJoin = (i, j) => {
      const oi = outlineOf[i], oj = outlineOf[j];
      if (oi === oj) return true;
      return !(oi >= 0 && !insideBox(outlines[oi], S[j])) && !(oj >= 0 && !insideBox(outlines[oj], S[i]));
    };
    // Components of the free pieces in `start`, leaving out `out`.
    // `comp` maps a piece to its component's index in `list`.
    const components = (start, out) => {
      const comp = new Map(), list = [];
      for (const s0 of start) {
        if (comp.has(s0) || out.has(s0) || !free(s0)) continue;
        const id = list.length, m = [s0];
        comp.set(s0, id);
        for (let q = 0; q < m.length; q++) {
          for (const j of adj[m[q]]) if (!comp.has(j) && free(j) && !out.has(j) && mayJoin(m[q], j)) { comp.set(j, id); m.push(j); }
        }
        list.push(m);
      }
      return { comp, list };
    };
    // The box of what touches `start` once `out` is left out, looking at no more than SIDE_SCAN pieces (null past that: big).
    const sideBox = (start, out) => {
      const seen = new Set(), m = [];
      for (const s0 of start) if (free(s0) && !out.has(s0) && !seen.has(s0)) { seen.add(s0); m.push(s0); }
      for (let q = 0; q < m.length; q++) {
        if (m.length > SIDE_SCAN) return null;
        for (const j of adj[m[q]]) if (!seen.has(j) && free(j) && !out.has(j) && mayJoin(m[q], j)) { seen.add(j); m.push(j); }
      }
      return m.length ? boxOfSegs(S, m) : null;
    };
    // T connectors: a straight chain whose two ends each stand on the middle
    // of other pieces (a T, as a pipe meets a valve's edge) or on a line, and
    // not inside an outline holding writing. A symbol's own lines meet at
    // their ends (corners), so they are not taken; an inner bar that is (a
    // bar across a ring) is given back to a found symbol by the check.
    const midOf = (pt, j) => Math.hypot(pt[0] - S[j][0], pt[1] - S[j][1]) > 1 && Math.hypot(pt[0] - S[j][2], pt[1] - S[j][3]) > 1;
    const inOutline = ch => outlines.some(b => inBoxPt(b, (ch.ends[0][0] + ch.ends[1][0]) / 2, (ch.ends[0][1] + ch.ends[1][1]) / 2));
    chains.forEach((ch, ci) => {
      if (ch.line || ch.len < 2 || inOutline(ch)) return;
      const ok = ch.ends.every(e => { const at = piecesAt(e, ci); return at.length > 0 && at.every(j => !free(j) || midOf(e, j)); });
      if (!ok) return;
      // Not when a side it would leave is too small to be a symbol (a pump's little base triangle on its stem).
      const out = new Set(ch.m);
      if (ch.ends.some(e => { const b = sideBox(piecesAt(e, ci), out); return b && longSide(b) < o.minSide; })) return;
      asNewLine(ch, 'connector');
    });

    // Tails: a straight chain with one free end whose other end stands on the
    // middle of a piece (a line hanging off a valve or a meter) is linework.
    for (let round = 0; round < 2; round++) {
      chains.forEach((ch, ci) => {
        if (ch.line || ch.len < TAIL_MIN || inOutline(ch)) return;
        const at = ch.ends.map(e => piecesAt(e, ci));
        const loose = at.findIndex(a => a.length === 0);
        if (loose < 0) return;
        const other = at[1 - loose], e = ch.ends[1 - loose];
        if (other.some(free) && other.every(j => !free(j) || midOf(e, j))) asNewLine(ch, 'run');
      });
    }

    const all = Array.from({ length: n }, (_, i) => i);
    let groups = components(all, new Set()).list;

    // Connectors: a straight chain whose two ends sit on the edges of two
    // different shapes, each at least minSide and more than one straight line. An end inside a shape's box (a
    // valve stem standing on the body's centre) is not on its edge.
    const inner = (b, pt) => pt[0] > b[0] + J && pt[0] < b[2] - J && pt[1] > b[1] + J && pt[1] < b[3] - J;
    let cut = false;
    for (const g of groups) {
      if (g.length < 3 || g.length > CONNECT_MAX) continue;
      const inG = new Set(g), removed = new Set();
      const mine = [...new Set(g.map(i => chainOf[i]).filter(ci => ci >= 0))];
      for (const ci of mine) {
        const ch = chains[ci];
        if (ch.line || ch.len < TAIL_MIN || !ch.m.every(i => inG.has(i) && free(i))) continue;   // a chord of a curve is no connector
        const { comp, list } = components(g, new Set([...removed, ...ch.m]));
        const ends = ch.ends.map(e => { const c = new Set(piecesAt(e, ci).filter(j => inG.has(j) && comp.has(j)).map(j => comp.get(j))); return c.size === 1 ? [...c][0] : -1; });
        if (ends[0] < 0 || ends[1] < 0 || ends[0] === ends[1]) continue;
        const bA = boxOfSegs(S, list[ends[0]]), bB = boxOfSegs(S, list[ends[1]]);
        if (longSide(bA) < o.minSide || longSide(bB) < o.minSide) continue;
        // Each side must be a shape, not one straight line (a pump's base, a zigzag's stroke).
        const straight = m => m.every(i => chainOf[i] >= 0 && chainOf[i] === chainOf[m[0]]);
        if (straight(list[ends[0]]) || straight(list[ends[1]])) continue;
        if (ch.ends.some(e => inner(bA, e) || inner(bB, e))) continue;
        for (const i of ch.m) removed.add(i);
        asLine(ch, 'connector'); cut = true;
        lines.push({ kind: 'connector', pieces: ch.m.slice().sort((p, q) => p - q) });
      }
    }
    if (cut) groups = components(all, new Set()).list;

    // Open curves close together (a stack of arcs drawn as one symbol) are one shape.
    const hasClosed = g => { const inG = new Set(g); return closedPaths.some(cp => inG.has(cp.from)); };
    // An open curve: no closed path, at least 3 pieces, each short, gently turning (a thin box).
    const curvy = g => {
      if (g.length < 3 || hasClosed(g) || !g.every(i => S[i][4] <= 6)) return false;
      const b = boxOfSegs(S, g);
      return Math.min(b[2] - b[0], b[3] - b[1]) <= 0.5 * longSide(b);
    };
    const curves = groups.filter(curvy);
    if (curves.length > 1 && curves.length <= 2000) {
      const boxes = curves.map(g => boxOfSegs(S, g)), cf = makeFind(curves.length);
      for (let a = 0; a < curves.length; a++) for (let b = a + 1; b < curves.length; b++) {
        const A = boxes[a], B = boxes[b];
        if (Math.max(A[0] - B[2], B[0] - A[2], A[1] - B[3], B[1] - A[3]) <= CURVE_GAP) cf.union(a, b);
      }
      const joined = new Map();
      curves.forEach((g, a) => { const r = cf.find(a); if (!joined.has(r)) joined.set(r, []); joined.get(r).push(...g); });
      const isCurve = new Set(curves);
      groups = [...groups.filter(g => !isCurve.has(g)), ...joined.values()];
    }

    // Linework a group can still be: a square-cornered L, T or + of up to three
    // plain lines (pipe and signal-line corners), or a lone small triangle on a
    // line (an arrowhead).
    const touchesLine = g => g.some(i => adj[i].some(j => kind[j] !== null));
    const axisTree = g => {
      const cs = new Set(g.map(i => chainOf[i]));
      if (cs.has(-1) || cs.size > 3) return false;
      if (![...cs].every(ci => Math.min(Math.abs(chains[ci].u[0]), Math.abs(chains[ci].u[1])) <= 0.02)) return false;
      const pairs = new Set();
      for (const i of g) for (const j of adj[i]) if (chainOf[j] >= 0 && chainOf[j] !== chainOf[i] && cs.has(chainOf[j])) pairs.add(Math.min(chainOf[i], chainOf[j]) + ':' + Math.max(chainOf[i], chainOf[j]));
      return pairs.size <= cs.size - 1;
    };
    const triangle = g => {
      const pts = [];
      for (const i of g) pts.push([S[i][0], S[i][1]], [S[i][2], S[i][3]]);
      return hullCorners(pts) === 3;
    };
    // A smooth open curve: one path of pieces end to end, no closed path, no branch, every turn gentle
    // (a rounded pipe bend, a crossover hop, a piece of a tank's outline). A stack of separate arcs is no one path.
    const smoothPath = g => {
      if (g.length < 2 || hasClosed(g)) return false;
      const inG = new Set(g);
      let pairs = 0;
      for (const i of g) {
        const nb = adj[i].filter(j => inG.has(j));
        if (nb.length > 2) return false;
        for (const j of nb) {
          if (j < i) continue;
          pairs++;
          const a = S[i], b = S[j];
          const ends = [[a[0], a[1]], [a[2], a[3]]].flatMap(p => [[b[0], b[1]], [b[2], b[3]]].map(q => Math.hypot(p[0] - q[0], p[1] - q[1])));
          if (Math.min(...ends) > SHAPE_JOIN) return false;              // they cross or meet mid-piece: a branch
          if (sinBetween(units[i], units[j]) > SMOOTH_TURN) return false;   // a corner
        }
      }
      return pairs === g.length - 1;
    };
    // A label: an outline holding writing, much longer than wide, that is the whole group.
    const label = (g, box) => g.some(i => outlineOf[i] >= 0 && outlines[outlineOf[i]].every((v, q) => Math.abs(v - box[q]) <= 1))
      && Math.max(box[2] - box[0], box[3] - box[1]) >= LABEL_ASPECT * Math.max(0.1, Math.min(box[2] - box[0], box[3] - box[1]));

    // A group that is one straight chain is a short run; the rest, in the size band, are shapes.
    const shapes = [];
    // Pieces of closed outlines (a valve's triangles, a pump's ring): never taken out as pipework.
    const inClosed = new Set();
    for (const cp of closedPaths) for (let k = cp.from; k < cp.to; k++) inClosed.add(k);
    const regrouped = new WeakSet();
    for (const g of groups) {
      if (chainOf[g[0]] >= 0 && g.every(i => chainOf[i] === chainOf[g[0]])) {
        for (const i of g) kind[i] = 'run';
        lines.push({ kind: 'run', pieces: g.slice().sort((p, q) => p - q) });
        continue;
      }
      const box = boxOfSegs(S, g), side = longSide(box);
      if (axisTree(g)) {
        for (const i of g) kind[i] = 'run';
        lines.push({ kind: 'run', pieces: g.slice().sort((p, q) => p - q) });
        continue;
      }
      if (smoothPath(g)) {
        for (const i of g) kind[i] = 'run';
        lines.push({ kind: 'run', pieces: g.slice().sort((p, q) => p - q) });
        continue;
      }
      if (side <= ARROW_MAX && touchesLine(g) && triangle(g)) {
        for (const i of g) kind[i] = 'arrow';
        lines.push({ kind: 'arrow', pieces: g.slice().sort((p, q) => p - q) });
        continue;
      }
      // An arrowhead on a line too short to be pipe: what is left without the long straight lines is a small
      // triangle they pass through. The triangle is an arrow, the lines are linework.
      const longs = [...new Set(g.map(i => chainOf[i]))].filter(ci => ci >= 0 && chains[ci].len > ARROW_MAX);
      if (longs.length) {
        const inLong = new Set(longs.flatMap(ci => chains[ci].m)), rest = g.filter(i => !inLong.has(i));
        const rb = rest.length >= 3 ? boxOfSegs(S, rest) : null;
        if (rb && longSide(rb) <= ARROW_MAX && triangle(rest)) {
          const c = [(rb[0] + rb[2]) / 2, (rb[1] + rb[3]) / 2];
          if (longs.every(ci => { const ch = chains[ci]; return ptLine(c[0], c[1], [ch.ends[0][0], ch.ends[0][1]], ch.u) <= 1; })) {
            for (const i of rest) kind[i] = 'arrow';
            lines.push({ kind: 'arrow', pieces: rest.slice().sort((p, q) => p - q) });
            for (const ci of longs) { for (const i of chains[ci].m) kind[i] = 'run'; lines.push({ kind: 'run', pieces: chains[ci].m.slice().sort((p, q) => p - q) }); }
            continue;
          }
        }
      }
      if (label(g, box)) continue;
      const pg = Array.isArray(o.page) ? o.page : null;
      if (pg && isNum(pg[0]) && isNum(pg[1]) && (box[2] <= PAGE_MARGIN || box[3] <= PAGE_MARGIN || box[0] >= pg[0] - PAGE_MARGIN || box[1] >= pg[1] - PAGE_MARGIN)) continue;
      // A sliver thinner than any legend symbol and long (line drawn double, a label's edge) is linework; a short one may be an operator's part.
      if (isNum(o.minShort) && Math.min(box[2] - box[0], box[3] - box[1]) < Math.max(o.minShort, THIN_FLOOR) && side >= 2 * o.minSide) continue;
      // A group bigger than any symbol (symbols joined by bent pipework: a dosing pump set) gives up its open straight
      // pieces at least minSide long, its pipework, and what is left is grouped again (owner, 2026-11-20). Once only.
      if (side > o.maxSide && !regrouped.has(g)) {
        const pipe = g.filter(i => !inClosed.has(i) && S[i][4] >= o.minSide);
        if (pipe.length && pipe.length < g.length) {
          for (const i of pipe) kind[i] = 'run';
          lines.push({ kind: 'run', pieces: pipe.slice().sort((p, q) => p - q) });
          const pipeSet = new Set(pipe);
          for (const sub of components(g.filter(i => !pipeSet.has(i)), pipeSet).list) { regrouped.add(sub); groups.push(sub); }
          continue;
        }
      }
      if (side < o.minSide || side > o.maxSide) continue;
      const inG = new Set(g);
      const closed = closedPaths.some(cp => inG.has(cp.from) && cp.box.every((v, q) => Math.abs(v - box[q]) <= 0.5));
      shapes.push({ id: 0, box, pieces: g.slice().sort((p, q) => p - q), closed });
    }
    shapes.sort((a, b) => (Math.round(a.box[1]) - Math.round(b.box[1])) || (a.box[0] - b.box[0]));
    shapes.forEach((s, i) => { s.id = i; });
    // Arrowheads, for the judge: small closed triangles, copies drawn over each other counted once.
    const tris = closedPaths.filter(cp => cp.to - cp.from === 3 && longSide(cp.box) <= ARROW_MAX);
    const tf = makeFind(tris.length);
    for (let a = 0; a < tris.length && tris.length <= 5000; a++) for (let b = a + 1; b < tris.length; b++) {
      const A = tris[a].box, B = tris[b].box;   // copies of one triangle: boxes overlapping by most of the smaller
      const w = Math.min(A[2], B[2]) - Math.max(A[0], B[0]), h = Math.min(A[3], B[3]) - Math.max(A[1], B[1]);
      const sm = Math.min((A[2] - A[0]) * (A[3] - A[1]), (B[2] - B[0]) * (B[3] - B[1]));
      if (w > 0 && h > 0 && w * h >= 0.5 * sm) tf.union(a, b);
    }
    const arrowUnits = new Map();
    tris.forEach((cp, a) => { const r = tf.find(a); if (!arrowUnits.has(r)) arrowUnits.set(r, []); for (let k = cp.from; k < cp.to; k++) arrowUnits.get(r).push(k); });
    const arrows = [...arrowUnits.values()].filter(m => { const b = boxOfSegs(S, m); return longSide(b) <= ARROW_MAX && triangle(m); }).map(m => m.sort((p, q) => p - q));
    return capped ? { shapes, lines, segments: S, arrows, capped } : { shapes, lines, segments: S, arrows };
  } catch {
    return EMPTY_SHAPES();
  }
}

// ---------------------------------------------------------------------------
// Reading by line pieces. Contractors' PDFs often write a tag bubble as
// several arcs (not one closed path), a fill as slices and a printed line in
// broken pieces. This reads the sheet as loose pieces instead of as the paths
// the file happened to use: pieces of one straight line are joined, slices of
// one fill are made one outline, and arcs of one circle become one closed
// ring. Every lookup goes through a grid, so the cost grows with the number of
// pieces. Never throws.

export const RING_FIT = 0.04, RING_COVER = 0.75, JOIN_GAP = 1;
const RING_SIDES = 32;           // sides of the polygon a ring is written as
const RING_R_MIN = 2, RING_R_MAX = 200;   // points
const RING_TURN = 0.5;           // sin of the sharpest turn between neighbouring pieces of one arc (30 degrees)
const RING_STRAIGHT = 0.005;     // sin of a turn so slight the join is a straight one, not part of an arc
const FILL_TOUCH = 0.3;          // points: edges this close are one shared edge
const PIECE_MIN = 0.05;          // points: shorter pieces are not pieces
const PIECE_CELL_SCAN = 5000;    // safety valve, far above any real sheet: entries looked at in one cell or run; pieces past it are counted (distinct) in `capped`
const PIECE_GROUP_SCAN = 1000;   // circles compared in a cell of centres (same valve)
const PIECE_INDEX_BUDGET = 4e6;  // cell entries the join index may hold
const LINE_ANGLE = 0.03;         // radians: width of an angle bin when lines are keyed (collinear pieces are within 0.02 of each other)
const PIECE_LIMIT = 300000;      // pieces past this are left as written

// True when finite segment quadruples run end to end and the last end is on the first start (as isClosedPath).
function isClosedLoop(s) {
  if (s.length < 12) return false;
  for (let i = 4; i < s.length; i += 4) if (Math.abs(s[i] - s[i - 2]) > 0.05 || Math.abs(s[i + 1] - s[i - 1]) > 0.05) return false;
  return Math.abs(s[0] - s[s.length - 2]) <= 0.05 && Math.abs(s[1] - s[s.length - 1]) <= 0.05;
}

// A cell key for small integer cells (a sane page).
const pKey = (cx, cy) => (cx + 20000) * 65536 + (cy + 20000);

// The rim of a circle through some points (Kasa least squares): { cx, cy, r } or null when they are nearly in line.
function fitCircle(pts) {
  const n = pts.length;
  if (n < 3) return null;
  let mx = 0, my = 0;
  for (const p of pts) { mx += p[0]; my += p[1]; }
  mx /= n; my /= n;
  let suu = 0, suv = 0, svv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const p of pts) {
    const u = p[0] - mx, v = p[1] - my;
    suu += u * u; suv += u * v; svv += v * v; suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (!(Math.abs(det) > 1e-9 * (suu + svv) * (suu + svv))) return null;
  const b1 = (suuu + suvv) / 2, b2 = (svvv + svuu) / 2;
  const uc = (b1 * svv - b2 * suv) / det, vc = (b2 * suu - b1 * suv) / det;
  const r2 = uc * uc + vc * vc + (suu + svv) / n;
  if (!(r2 > 0)) return null;
  return { cx: mx + uc, cy: my + vc, r: Math.sqrt(r2) };
}

// Runs of three or more pieces that meet end to end and turn the same way: { pts, segs } (segs index the pieces).
function curvedRuns(S, ok, cap) {
  const n = S.length;
  const grid = new Map();
  for (let i = 0; i < n; i++) {
    if (!ok[i]) continue;
    for (let w = 0; w < 2; w++) {
      const k = pKey(Math.floor(S[i][2 * w]), Math.floor(S[i][2 * w + 1]));
      let c = grid.get(k); if (!c) grid.set(k, c = []); c.push(2 * i + w);
    }
  }
  const px = e => S[e >> 1][(e & 1) * 2], py = e => S[e >> 1][(e & 1) * 2 + 1];
  // Unit direction of piece e>>1 pointing from end e&1 into the piece.
  const dirIn = e => { const s = S[e >> 1], w = e & 1; return [(w ? s[0] - s[2] : s[2] - s[0]) / s[4], (w ? s[1] - s[3] : s[3] - s[1]) / s[4]]; };
  const best = new Int32Array(2 * n).fill(-1), cross = new Float64Array(2 * n);
  for (let e = 0; e < 2 * n; e++) {
    if (!ok[e >> 1]) continue;
    const x = px(e), y = py(e), de = dirIn(e);   // travelling on past this end, the heading is -de
    let bd = JOIN_GAP * JOIN_GAP + 1e-12;
    const cx = Math.floor(x), cy = Math.floor(y);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const cell = grid.get(pKey(cx + dx, cy + dy));
      if (!cell) continue;
      const m = Math.min(cell.length, cap.scan);
      for (let t = m; t < cell.length; t++) cap.set.add(cell[t] >> 1);
      for (let t = 0; t < m; t++) {
        const f = cell[t];
        if ((f >> 1) === (e >> 1)) continue;
        const d2 = (px(f) - x) ** 2 + (py(f) - y) ** 2;
        if (d2 >= bd) continue;
        const df = dirIn(f);
        const c = (-de[0]) * df[1] - (-de[1]) * df[0], cosT = (-de[0]) * df[0] + (-de[1]) * df[1];
        if (cosT <= 0 || Math.abs(c) > RING_TURN) continue;
        bd = d2; best[e] = f; cross[e] = c;
      }
    }
  }
  const link = new Int32Array(2 * n).fill(-1), turn = new Float64Array(2 * n);
  for (let e = 0; e < 2 * n; e++) { const f = best[e]; if (f >= 0 && best[f] === e) { link[e] = f; turn[e] = cross[e]; } }

  const seen = new Uint8Array(n), runs = [];
  // Walk one chain from piece `first`, entering at end `entry`, until it ends or comes round to a piece seen.
  const walk = (first, entry) => {
    const chain = [];   // { i, w (end entered at), before (turn at that join) }
    let i = first, w = entry, before = 0;
    while (i >= 0 && !seen[i]) {
      seen[i] = 1; chain.push({ i, w, before });
      const exit = 2 * i + (w ^ 1), f = link[exit];
      if (f < 0) break;
      before = turn[exit]; i = f >> 1; w = f & 1;
    }
    let from = 0;
    const flush = to => {
      if (to - from >= 3) {
        const pts = [], list = [];
        for (let k = from; k < to; k++) {
          const c = chain[k], s = S[c.i];
          if (k === from) pts.push(c.w ? [s[2], s[3]] : [s[0], s[1]]);
          pts.push(c.w ? [s[0], s[1]] : [s[2], s[3]]);
          list.push(c.i);
        }
        runs.push({ pts, segs: list });
      }
      from = to;
    };
    // Cut the chain where the turn changes hand or is only a straight join.
    let sign = 0;
    for (let k = 1; k < chain.length; k++) {
      const c = chain[k].before;
      if (Math.abs(c) < RING_STRAIGHT) { flush(k); sign = 0; continue; }
      const sg = c > 0 ? 1 : -1;
      if (sign && sg !== sign) flush(k);
      sign = sg;
    }
    flush(chain.length);
  };
  for (let i = 0; i < n; i++) if (ok[i] && !seen[i]) {
    // Start at an end with nothing joined to it, so a chain is walked whole.
    if (link[2 * i] < 0) walk(i, 0); else if (link[2 * i + 1] < 0) walk(i, 1);
  }
  for (let i = 0; i < n; i++) if (ok[i] && !seen[i]) walk(i, 0);   // what is left is round a loop
  return runs;
}

// Rings: arcs of one circle, whatever paths they came from. Returns { rings: [{ segs, width, grey, key }], used: Set of piece indexes }.
function findRings(S, ok, cap) {
  const fits = [];
  for (const run of curvedRuns(S, ok, cap)) {
    const f = fitCircle(run.pts);
    if (!f || f.r < RING_R_MIN || f.r > RING_R_MAX) continue;
    let good = true;
    for (const p of run.pts) if (Math.abs(Math.hypot(p[0] - f.cx, p[1] - f.cy) - f.r) > RING_FIT * f.r) { good = false; break; }
    if (good) fits.push({ run, f });
  }
  // Group runs whose circles agree; centres go in a grid so only near ones are compared.
  const groups = [], cells = new Map();
  for (const q of fits) {
    const cx = Math.floor(q.f.cx / 10), cy = Math.floor(q.f.cy / 10);
    let hit = null;
    outer: for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const c = cells.get(pKey(cx + dx, cy + dy));
      if (!c) continue;
      for (let gi = PIECE_GROUP_SCAN; gi < c.length; gi++) for (const mq of c[gi].members) for (const i of mq.run.segs) cap.set.add(i);
      for (const g of c.slice(0, PIECE_GROUP_SCAN)) {
        const s = g.seed;
        if (Math.abs(q.f.r - s.r) <= RING_FIT * s.r && Math.hypot(q.f.cx - s.cx, q.f.cy - s.cy) <= RING_FIT * s.r) { hit = g; break outer; }
      }
    }
    if (!hit) {
      hit = { seed: q.f, members: [] }; groups.push(hit);
      const k = pKey(cx, cy); let c = cells.get(k); if (!c) cells.set(k, c = []); c.push(hit);
    }
    hit.members.push(q);
  }
  const rings = [], used = new Set(), TAU = 2 * Math.PI;
  for (const g of groups) {
    const pts = []; for (const q of g.members) for (const p of q.run.pts) pts.push(p);
    const f = fitCircle(pts);
    if (!f || f.r < RING_R_MIN || f.r > RING_R_MAX) continue;
    // The angles the pieces cover, joined across gaps of up to JOIN_GAP.
    const iv = [];
    for (const q of g.members) for (let k = 0; k + 1 < q.run.pts.length; k++) {
      const a = Math.atan2(q.run.pts[k][1] - f.cy, q.run.pts[k][0] - f.cx), b = Math.atan2(q.run.pts[k + 1][1] - f.cy, q.run.pts[k + 1][0] - f.cx);
      let d = b - a; while (d > Math.PI) d -= TAU; while (d <= -Math.PI) d += TAU;
      const lo = (((d >= 0 ? a : a + d) % TAU) + TAU) % TAU, len = Math.abs(d);
      if (lo + len > TAU) iv.push([lo, TAU], [0, lo + len - TAU]); else iv.push([lo, lo + len]);
    }
    iv.sort((p, q) => p[0] - q[0]);
    const tol = JOIN_GAP / f.r + 1e-9;
    let covered = 0, curLo = iv[0][0], curHi = iv[0][1];
    for (let k = 1; k < iv.length; k++) {
      if (iv[k][0] <= curHi + tol) curHi = Math.max(curHi, iv[k][1]);
      else { covered += curHi - curLo; if (iv[k][0] - curHi <= tol) covered += iv[k][0] - curHi; curLo = iv[k][0]; curHi = iv[k][1]; }
    }
    covered += curHi - curLo;
    const wrap = iv[0][0] + TAU - curHi;   // the gap round the back, from the last piece to the first
    if (wrap <= tol) covered += wrap;
    if (covered / TAU < RING_COVER - 1e-6) continue;
    let width = 0, grey = Infinity, key = Infinity;
    for (const q of g.members) for (const i of q.run.segs) { used.add(i); width = Math.max(width, S[i][6]); grey = Math.min(grey, S[i][7]); key = Math.min(key, S[i][5]); }
    const segs = [];
    for (let k = 0; k < RING_SIDES; k++) {
      const a0 = (TAU * k) / RING_SIDES, a1 = (TAU * (k + 1)) / RING_SIDES, last = k === RING_SIDES - 1;
      segs.push(f.cx + f.r * Math.cos(a0), f.cy + f.r * Math.sin(a0), last ? segs[0] : f.cx + f.r * Math.cos(a1), last ? segs[1] : f.cy + f.r * Math.sin(a1));
    }
    rings.push({ segs, width, grey, key });
  }
  return { rings, used };
}

// Collinear pieces that overlap or nearly meet, end to end, are one piece. Returns [{ members, segs, width, grey, key }].
// Pieces are keyed by their line (direction angle bin, perpendicular offset bin); the pieces of the lines in
// one bin and its neighbours are sorted along the line and compared only with the ones that reach as far.
function collinearJoin(S, ok, cap) {
  const n = S.length, NA = Math.ceil(Math.PI / LINE_ANGLE), cells = new Map(), idx = [];
  const ckey = (ab, ob) => ab * 1e6 + ob + 5e5;
  let budget = 0;
  for (let i = 0; i < n; i++) {
    if (!ok[i]) continue;
    idx.push(i);
    const s = S[i];
    let th = Math.atan2(s[3] - s[1], s[2] - s[0]); if (th < 0) th += Math.PI;
    const home = Math.min(NA - 1, Math.floor(th / LINE_ANGLE));
    // In its own angle bin and the two beside it (wrapping), each with the offset measured in that bin's frame.
    for (let da = -1; da <= 1; da++) {
      const ab = (home + da + NA) % NA, c = (ab + 0.5) * LINE_ANGLE, sn = Math.sin(c), cs = Math.cos(c);
      const v0 = -s[0] * sn + s[1] * cs, v1 = -s[2] * sn + s[3] * cs;
      const o0 = Math.floor(Math.min(v0, v1) - COL_OFF - 0.1), o1 = Math.floor(Math.max(v0, v1) + COL_OFF + 0.1);
      if (o1 - o0 > 400 || budget + (o1 - o0 + 1) > PIECE_INDEX_BUDGET) { cap.set.add(i); continue; }
      budget += o1 - o0 + 1;
      for (let o = o0; o <= o1; o++) { const k = ckey(ab, o); let l = cells.get(k); if (!l) cells.set(k, l = []); l.push(i); }
    }
  }
  const uf = makeFind(n), stamp = new Int32Array(n).fill(-1);
  const meets = (a, b) => {
    const ua = unitOf(a), ub = unitOf(b);
    if (sinBetween(ua, ub) > COL_SIN) return false;
    if (ptLine(b[0], b[1], a, ua) > COL_OFF || ptLine(b[2], b[3], a, ua) > COL_OFF || ptLine(a[0], a[1], b, ub) > COL_OFF || ptLine(a[2], a[3], b, ub) > COL_OFF) return false;
    const t0 = (b[0] - a[0]) * ua[0] + (b[1] - a[1]) * ua[1], t1 = (b[2] - a[0]) * ua[0] + (b[3] - a[1]) * ua[1];
    return Math.max(Math.min(t0, t1) - a[4], -Math.max(t0, t1)) <= JOIN_GAP;
  };
  let round = 0;
  for (const key of cells.keys()) {
    const ab = Math.floor((key - 5e5 + 5e5) / 1e6), ob = key - ab * 1e6 - 5e5;
    const c = (ab + 0.5) * LINE_ANGLE, sn = Math.sin(c), cs = Math.cos(c), items = [];
    round++;
    for (let d = -1; d <= 1; d++) {
      const list = cells.get(ckey(ab, ob + d));
      if (!list) continue;
      for (const i of list) {
        if (stamp[i] === round) continue;
        stamp[i] = round;
        const s = S[i], u0 = s[0] * cs + s[1] * sn, u1 = s[2] * cs + s[3] * sn;
        items.push({ i, u0: Math.min(u0, u1), u1: Math.max(u0, u1) });
      }
    }
    items.sort((p, q) => p.u0 - q.u0);
    const m = items.length;
    for (let a = 0; a < m; a++) {
      const A = items[a], lim = A.u1 + JOIN_GAP + 0.1;
      let scanned = 0;
      for (let b = a + 1; b < m && items[b].u0 <= lim; b++) {
        if (++scanned > cap.scan) { for (let q = b; q < m && items[q].u0 <= lim; q++) cap.set.add(items[q].i); break; }
        if (uf.find(A.i) !== uf.find(items[b].i) && meets(S[A.i], S[items[b].i])) uf.union(A.i, items[b].i);
      }
    }
  }
  const comps = new Map();
  for (const i of idx) { const r = uf.find(i); let c = comps.get(r); if (!c) comps.set(r, c = []); c.push(i); }
  const joined = [];
  for (const m of comps.values()) {
    if (m.length < 2) continue;
    let ref = m[0]; for (const i of m) if (S[i][4] > S[ref][4]) ref = i;
    const r = S[ref], u = unitOf(r);
    let lo = null, hi = null, width = 0, grey = Infinity, key = Infinity;
    for (const i of m) {
      const s = S[i];
      for (let w = 0; w < 2; w++) {
        const t = (s[2 * w] - r[0]) * u[0] + (s[2 * w + 1] - r[1]) * u[1], p = [s[2 * w], s[2 * w + 1]];
        if (!lo || t < lo.t) lo = { t, p };
        if (!hi || t > hi.t) hi = { t, p };
      }
      width = Math.max(width, s[6]); grey = Math.min(grey, s[7]); key = Math.min(key, s[5]);
    }
    joined.push({ members: m, segs: [lo.p[0], lo.p[1], hi.p[0], hi.p[1]], width, grey, key });
  }
  return joined;
}

// Filled ink paths of one grey whose edges touch are one filled path with the shared edges dropped. Returns [{ key, path }].
function mergeFills(fills, cap) {
  const n = fills.length, grid = new Map(), uf = makeFind(n);
  const drop = fills.map(f => new Uint8Array(f.segs.length / 4)), base = [];
  let edges = 0;
  fills.forEach((f, fi) => { base[fi] = edges; edges += f.segs.length / 4; });
  fills.forEach((f, fi) => {
    const s = f.segs;
    for (let k = 0; k < s.length / 4; k++) {
      const o = 4 * k, kk = pKey(Math.floor((s[o] + s[o + 2]) / 2), Math.floor((s[o + 1] + s[o + 3]) / 2));
      let c = grid.get(kk); if (!c) grid.set(kk, c = []); c.push(fi, k);
    }
  });
  const near = (a, b) => Math.abs(a - b) <= FILL_TOUCH;
  fills.forEach((f, fi) => {
    const s = f.segs;
    for (let k = 0; k < s.length / 4; k++) {
      const o = 4 * k, cx = Math.floor((s[o] + s[o + 2]) / 2), cy = Math.floor((s[o + 1] + s[o + 3]) / 2);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const cell = grid.get(pKey(cx + dx, cy + dy));
        if (!cell) continue;
        const m = Math.min(cell.length, 2 * cap.scan);
        for (let t = m; t < cell.length; t += 2) cap.set.add(1e9 + base[cell[t]] + cell[t + 1]);
        for (let t = 0; t < m; t += 2) {
          const gi = cell[t];
          if (gi === fi || Math.abs(fills[gi].grey - f.grey) >= 0.5) continue;
          const q = fills[gi].segs, p = 4 * cell[t + 1];
          const same = near(s[o], q[p]) && near(s[o + 1], q[p + 1]) && near(s[o + 2], q[p + 2]) && near(s[o + 3], q[p + 3]);
          const back = near(s[o], q[p + 2]) && near(s[o + 1], q[p + 3]) && near(s[o + 2], q[p]) && near(s[o + 3], q[p + 1]);
          if (same || back) { drop[fi][k] = 1; drop[gi][cell[t + 1]] = 1; uf.union(fi, gi); }
        }
      }
    }
  });
  const groups = new Map();
  fills.forEach((f, fi) => { const r = uf.find(fi); let g = groups.get(r); if (!g) groups.set(r, g = []); g.push(fi); });
  const out = [];
  for (const g of groups.values()) {
    if (g.length === 1) { out.push({ key: fills[g[0]].pi, path: fills[g[0]].p }); continue; }
    const segs = []; let width = 0, stroked = false, key = Infinity;
    for (const fi of g) {
      const f = fills[fi];
      for (let k = 0; k < f.segs.length / 4; k++) if (!drop[fi][k]) segs.push(f.segs[4 * k], f.segs[4 * k + 1], f.segs[4 * k + 2], f.segs[4 * k + 3]);
      width = Math.max(width, f.width); stroked = stroked || !!f.p.stroked; key = Math.min(key, f.pi);
    }
    if (segs.length) out.push({ key, path: { ...fills[g[0]].p, segs, width, stroked, filled: true } });
  }
  return out;
}

/**
 * Read a sheet by its line pieces. paths: page paths ({ segs, width, stroked,
 * filled, grey }, segs flat quadruples of straight segments, points, top-left).
 * Returns paths in the same shape: pale paths and white fills as they were,
 * touching fills of one grey made one outline, the arcs of a circle made one
 * closed 32-sided ring, and collinear pieces joined. Paths none of that
 * touches come back as the same objects; a path that is already one closed
 * loop stays whole. Returns { paths, capped }: capped counts the pieces or
 * distinct edges a cap left out (0 when none; options.limit and options.scan
 * lower the piece limit and the safety valve). Never throws; hostile input gives { paths: [], capped: 0 }.
 */
export function readByLinePieces(paths, options) {
  try {
    if (!Array.isArray(paths)) return { paths: [], capped: 0 };
    const limit = options && isNum(options.limit) && options.limit >= 0 ? options.limit : PIECE_LIMIT, cap = { set: new Set(), extra: 0, scan: options && isNum(options.scan) && options.scan > 0 ? options.scan : PIECE_CELL_SCAN };
    const out = [];            // { key (the input position it sorts to), path }
    const S = [], fills = [], inkPaths = [];
    paths.forEach((p, pi) => {
      if (!p || typeof p !== 'object' || !Array.isArray(p.segs) || p.segs.length < 4) return;
      const grey = isNum(p.grey) ? p.grey : 0, width = isNum(p.width) ? p.width : 0, s = p.segs;
      if (grey >= SHAPE_INK_GREY) { out.push({ key: pi, path: p }); return; }
      let clean = s.length % 4 === 0;
      for (let i = 0; clean && i < s.length; i++) if (!isNum(s[i]) || Math.abs(s[i]) > SHAPE_COORD) clean = false;
      if (p.filled) {
        if (clean && s.length >= 4) fills.push({ pi, p, segs: s, grey, width });
        else out.push({ key: pi, path: p });   // a fill that cannot be read is left as written
        return;
      }
      if (clean && isClosedLoop(s)) { out.push({ key: pi, path: p }); return; }   // one closed loop stays whole
      const from = S.length;
      for (let i = 0; i + 3 < s.length; i += 4) {
        const a = s[i], b = s[i + 1], c = s[i + 2], d = s[i + 3];
        if (![a, b, c, d].every(isNum) || Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d)) > SHAPE_COORD) continue;
        const len = Math.hypot(c - a, d - b);
        if (len > PIECE_MIN) S.push([a, b, c, d, len, pi, width, grey]);
      }
      inkPaths.push({ pi, p, from, to: S.length, bad: !clean });
    });
    const n = S.length, used = new Uint8Array(n), ok = new Uint8Array(n).fill(1), extra = [];
    if (n > limit) cap.extra += n;
    else {
      const { rings, used: ringUsed } = findRings(S, ok, cap);
      for (const i of ringUsed) { used[i] = 1; ok[i] = 0; }
      for (const r of rings) extra.push({ key: r.key, path: { segs: r.segs, width: r.width, stroked: true, filled: false, grey: r.grey } });
      for (const j of collinearJoin(S, ok, cap)) {
        for (const i of j.members) used[i] = 1;
        extra.push({ key: j.key, path: { segs: j.segs, width: j.width, stroked: true, filled: false, grey: j.grey } });
      }
    }
    // A stroked path nothing took from is handed back as it was; one that gave up pieces keeps the rest.
    for (const q of inkPaths) {
      let touched = q.bad;
      for (let i = q.from; i < q.to && !touched; i++) if (used[i]) touched = true;
      if (!touched) { out.push({ key: q.pi, path: q.p }); continue; }
      const segs = [];
      for (let i = q.from; i < q.to; i++) if (!used[i]) segs.push(S[i][0], S[i][1], S[i][2], S[i][3]);
      if (segs.length) out.push({ key: q.pi, path: { ...q.p, segs } });
    }
    for (const f of mergeFills(fills, cap)) out.push(f);
    for (const e of extra) out.push(e);
    return { paths: out.map((e, i) => ({ e, i })).sort((a, b) => a.e.key - b.e.key || a.i - b.i).map(o => o.e.path), capped: cap.set.size + cap.extra };
  } catch {
    return { paths: [], capped: 0 };
  }
}
