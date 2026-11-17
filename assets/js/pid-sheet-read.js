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
