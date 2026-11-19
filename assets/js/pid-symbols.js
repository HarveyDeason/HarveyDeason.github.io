// assets/js/pid-symbols.js
// Pure logic for the P&ID Tag Register's symbol library: turning a pdf.js
// operator list into linework, reading ruled legend tables into symbol rows,
// and building, editing and searching the library. No DOM, no File System
// Access, no pdf.js import: everything here is node-testable.
//
// THE SYMBOL LIBRARY IS NOT HERE, AND MUST NOT BE. assets/js/ is served
// publicly. The legend's symbols are the client's standard drawing; they live
// only in symbol-library.json in the connected register folder and arrive
// here as arguments. Tests use invented symbols. Keep it that way.
//
// All geometry is in PDF points with a top-left origin, as produced by
// page.getViewport({ scale: 1 }).transform.

const isNum = x => typeof x === 'number' && Number.isFinite(x);
const asArr = x => (Array.isArray(x) ? x : []);
const asObj = x => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});

// ── Geometry walker ───────────────────────────────────────────────────────

/** Straight segments a Bezier curve is flattened to. */
export const CURVE_STEPS = 8;

const IDENTITY = [1, 0, 0, 1, 0, 0];
// pdf.js hands some arguments over as typed arrays (colours arrive as a
// Uint8ClampedArray), so operator arguments are read as "any list", not only
// as plain arrays.
const asList = x => (Array.isArray(x) || (ArrayBuffer.isView(x) && !(x instanceof DataView)) ? x : []);
const isMatrix = m => asList(m).length >= 6 && Array.prototype.every.call(Array.prototype.slice.call(m, 0, 6), isNum);
// m x n: n is applied first, as a PDF `cm` post-multiplies the CTM.
function mul(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
const greyOf = c => Math.max(0, Math.min(255, Math.round(0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2])));
function rgbOf(args, fallback) {
  const a = asList(args);
  return isNum(a[0]) && isNum(a[1]) && isNum(a[2]) ? [a[0], a[1], a[2]] : fallback;
}

/**
 * Walk a pdf.js operator list (page.getOperatorList()) and return the page's
 * linework. Operators are addressed by OPS name, never by number.
 *
 * Path = { segs, width, stroked, filled, grey }. segs is flat, four numbers
 * per straight segment. A paint that only strokes gives one Path per subpath;
 * a paint that fills gives one Path holding all its subpaths, so a shape with
 * a hole keeps its hole. The split matters: plotted drawings batch unrelated
 * lines into one stroke, and the cell finder keeps a path only when all of it
 * lies in one cell.
 */
export function pagePaths(fnArray, argsArray, OPS, viewportTransform) {
  if (!Array.isArray(fnArray) || !OPS || typeof OPS !== 'object') return [];
  const args = asArr(argsArray);
  const out = [];
  let state = { ctm: isMatrix(viewportTransform) ? Array.from(viewportTransform).slice(0, 6) : IDENTITY, lineWidth: 1, stroke: [0, 0, 0], fill: [0, 0, 0] };
  const stack = [];
  let pending = []; // subpaths: { segs, sx, sy, x, y, bad }

  const push = () => stack.push({ ...state });
  const pop = () => { if (stack.length) state = stack.pop(); };

  function construct(a) {
    const ops = asList(asList(a)[0]);
    const c = asList(asList(a)[1]);
    let j = 0;
    let cur = null;          // subpath being built
    let ux = 0, uy = 0;      // current point, user space
    let sux = 0, suy = 0;    // subpath start, user space
    const ctm = state.ctm;
    const dev = (x, y) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]];
    const begin = () => { cur = { segs: [], bad: false }; pending.push(cur); };
    const lineTo = (x, y) => {
      if (!cur) begin();
      const p0 = dev(ux, uy), p1 = dev(x, y);
      if (!(isNum(p0[0]) && isNum(p0[1]) && isNum(p1[0]) && isNum(p1[1]))) cur.bad = true;
      cur.segs.push(p0[0], p0[1], p1[0], p1[1]);
      ux = x; uy = y;
    };
    const curve = (x1, y1, x2, y2, x3, y3) => {
      const x0 = ux, y0 = uy;
      for (let k = 1; k <= CURVE_STEPS; k++) {
        const t = k / CURVE_STEPS, u = 1 - t;
        lineTo(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
          u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3);
      }
    };
    const close = () => { if (cur && (ux !== sux || uy !== suy)) lineTo(sux, suy); cur = null; ux = sux; uy = suy; };
    // A path that opens with a line or a curve has no point to start from.
    // A browser canvas then only puts the pen down at the first point given
    // and draws nothing. Do the same. Starting from (0, 0) instead invents a
    // line from the page corner that is not on the drawing, and that line
    // crosses real symbols: found on a real sheet, where it took two of four
    // identical valves below the recognition score.
    let has = false;
    const start = (x, y) => { ux = x; uy = y; sux = x; suy = y; cur = null; has = true; };
    for (const op of ops) {
      if (op === OPS.moveTo) { start(c[j++], c[j++]); }
      else if (op === OPS.lineTo) { const x = c[j++], y = c[j++]; if (has) lineTo(x, y); else start(x, y); }
      else if (op === OPS.curveTo) { if (!has) start(c[j], c[j + 1]); curve(c[j], c[j + 1], c[j + 2], c[j + 3], c[j + 4], c[j + 5]); j += 6; }
      else if (op === OPS.curveTo2) { if (!has) start(c[j], c[j + 1]); curve(ux, uy, c[j], c[j + 1], c[j + 2], c[j + 3]); j += 4; }
      else if (op === OPS.curveTo3) { if (!has) start(c[j], c[j + 1]); curve(c[j], c[j + 1], c[j + 2], c[j + 3], c[j + 2], c[j + 3]); j += 4; }
      else if (op === OPS.closePath) { close(); }
      else if (op === OPS.rectangle) {
        const x = c[j++], y = c[j++], w = c[j++], h = c[j++];
        has = true;
        ux = x; uy = y; sux = x; suy = y; cur = null;
        lineTo(x + w, y); lineTo(x + w, y + h); lineTo(x, y + h); lineTo(x, y);
        cur = null;
      }
    }
  }

  function closeOpenSubpaths() {
    for (const sp of pending) {
      const s = sp.segs, n = s.length;
      if (n >= 4 && (s[n - 2] !== s[0] || s[n - 1] !== s[1])) s.push(s[n - 2], s[n - 1], s[0], s[1]);
    }
  }

  function paint(strokes, fills, closes) {
    if (closes) closeOpenSubpaths();
    const subs = pending.filter(sp => sp.segs.length >= 4);
    pending = [];
    if (!subs.length) return;
    const m = state.ctm;
    const width = strokes ? state.lineWidth * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) : 0;
    const base = { width: isNum(width) ? width : 0, stroked: strokes, filled: fills, grey: greyOf(strokes ? state.stroke : state.fill) };
    if (fills) {
      if (subs.some(sp => sp.bad)) return;
      out.push({ segs: [].concat(...subs.map(sp => sp.segs)), ...base });
    } else {
      for (const sp of subs) if (!sp.bad) out.push({ segs: sp.segs, ...base });
    }
  }

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const a = args[i];
    try {
      if (fn === undefined || fn === null) continue;
      if (fn === OPS.save) push();
      else if (fn === OPS.restore) pop();
      else if (fn === OPS.transform) { if (isMatrix(a)) state.ctm = mul(state.ctm, a); }
      else if (fn === OPS.paintFormXObjectBegin) { push(); const mtx = asList(a)[0]; if (isMatrix(mtx)) state.ctm = mul(state.ctm, mtx); }
      else if (fn === OPS.paintFormXObjectEnd) pop();
      else if (fn === OPS.setLineWidth) { const w = asList(a)[0]; if (isNum(w)) state.lineWidth = w; }
      else if (fn === OPS.setStrokeRGBColor) state.stroke = rgbOf(a, state.stroke);
      else if (fn === OPS.setFillRGBColor) state.fill = rgbOf(a, state.fill);
      else if (fn === OPS.constructPath) construct(a);
      else if (fn === OPS.stroke) paint(true, false, false);
      else if (fn === OPS.closeStroke) paint(true, false, true);
      else if (fn === OPS.fill || fn === OPS.eoFill) paint(false, true, false);
      else if (fn === OPS.fillStroke || fn === OPS.eoFillStroke) paint(true, true, false);
      else if (fn === OPS.closeFillStroke || fn === OPS.closeEOFillStroke) paint(true, true, true);
      else if (fn === OPS.endPath) pending = [];
    } catch { pending = []; }
  }
  return out;
}

/**
 * pdf.js text items (page.getTextContent().items) to top-left boxes. The box
 * is worked out through the whole transform, so text that runs up the page,
 * or a rotated page, still lands where it is drawn.
 */
export function textWords(items, viewportTransform) {
  const vt = isMatrix(viewportTransform) ? viewportTransform : IDENTITY;
  const out = [];
  for (const it of asArr(items)) {
    if (!it || typeof it !== 'object' || typeof it.str !== 'string') continue;
    const str = it.str.trim();
    if (!str || !isMatrix(it.transform) || !isNum(it.width) || !isNum(it.height)) continue;
    const m = mul(vt, it.transform);
    const dl = Math.hypot(m[0], m[1]), ul = Math.hypot(m[2], m[3]);
    if (!dl || !ul) continue;
    const dx = (m[0] / dl) * it.width, dy = (m[1] / dl) * it.width;
    const ux = (m[2] / ul) * it.height, uy = (m[3] / ul) * it.height;
    const xs = [m[4], m[4] + dx, m[4] + ux, m[4] + dx + ux];
    const ys = [m[5], m[5] + dy, m[5] + uy, m[5] + dy + uy];
    const x = Math.min(...xs), y = Math.min(...ys);
    const w = Math.max(...xs) - x, h = Math.max(...ys) - y;
    if (![x, y, w, h].every(isNum)) continue;
    out.push({ str, x, y, w, h });
  }
  return out;
}

// ── Ruled legend tables ───────────────────────────────────────────────────
// A legend sheet lists its symbols in ruled two-column tables: a label in one
// cell, the symbol's linework in the other. Everything below works from the
// rules alone (where they are and what they enclose), never from line weight
// or colour, so it does not depend on one plot style.

const TOL = 1.5;          // points: how far apart two rules may be and still be "the same"
const AXIS = 0.3;         // points: how far off true a rule may be drawn
const MIN_UPRIGHT = 10;   // points: shortest vertical that can be a border or divider
const DIVIDER_INSET = 20; // points: a divider lies at least this far inside both edges

const upper = s => (typeof s === 'string' ? s : '').replace(/\s+/g, ' ').trim().toUpperCase();

function boxOfSegs(segs) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 1 < segs.length; i += 2) {
    const x = segs[i], y = segs[i + 1];
    if (!isNum(x) || !isNum(y)) return null;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 >= x0 ? [x0, y0, x1, y1] : null;
}
const cleanPaths = paths => asArr(paths)
  .filter(p => p && typeof p === 'object' && Array.isArray(p.segs) && p.segs.length >= 4)
  .map(p => ({ p, b: boxOfSegs(p.segs) })).filter(q => q.b);
const cleanWords = words => asArr(words)
  .filter(w => w && typeof w === 'object' && typeof w.str === 'string' && w.str.trim() && [w.x, w.y, w.w, w.h].every(isNum));

function emptyCells() { return { tables: [], rows: [], unsplit: [], other: [], emptyRows: 0 }; }

const JOIN = 0.05; // points: how far apart two segment ends may be and still meet

/** True when a path's segments run end to start round a loop of at least three. */
export function isClosedPath(path) {
  try {
    const s = asObj(path).segs;
    if (!Array.isArray(s) || s.length < 12 || s.length % 4 !== 0 || !s.every(isNum)) return false;
    for (let i = 4; i < s.length; i += 4) {
      if (Math.abs(s[i] - s[i - 2]) > JOIN || Math.abs(s[i + 1] - s[i - 1]) > JOIN) return false;
    }
    return Math.abs(s[0] - s[s.length - 2]) <= JOIN && Math.abs(s[1] - s[s.length - 1]) <= JOIN;
  } catch {
    return false;
  }
}

// Words on separate lines: centres further apart in y than half the taller word.
function lineCount(words) {
  const ys = [];
  for (const w of words.slice().sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2))) {
    const cy = w.y + w.h / 2, last = ys[ys.length - 1];
    if (last && Math.abs(cy - last.cy) < 0.5 * Math.max(w.h, last.h)) continue;
    ys.push({ cy, h: w.h });
  }
  return ys.length;
}

/**
 * Whether a legend symbol is a tag bubble: an outline the tag is written
 * inside. Its ring is the smallest closed path holding every placeholder
 * word. It is a bubble when the placeholder runs to two lines or more (a tag
 * is a code over a number; a lone letter such as an actuator's M is not a
 * tag) and some closed path holding the words is the symbol's whole outline
 * (a flag on a leader line is not).
 */
export function bubbleOf(symbolPaths, placeholderWords, box) {
  const none = { bubble: false, ring: null };
  try {
    const ws = cleanWords(placeholderWords);
    const b = asArr(box);
    if (!ws.length || b.length < 4 || !b.slice(0, 4).every(isNum)) return none;
    const holding = asArr(symbolPaths).filter(isClosedPath).map(p => boxOfSegs(p.segs)).filter(Boolean)
      .filter(q => ws.every(w => { const cx = w.x + w.w / 2, cy = w.y + w.h / 2; return cx > q[0] && cx < q[2] && cy > q[1] && cy < q[3]; }));
    if (!holding.length) return none;
    const area = q => (q[2] - q[0]) * (q[3] - q[1]);
    const ring = holding.reduce((m, q) => (area(q) < area(m) ? q : m));
    const whole = holding.some(q => [0, 1, 2, 3].every(i => Math.abs(q[i] - b[i]) <= TOL));
    // A tag placeholder has some length to it; two single letters (an X over
    // an L in a measurement mark) do not.
    const chars = ws.map(w => w.str).join('').replace(/[^\p{L}\p{N}]/gu, '').length;
    return { bubble: whole && lineCount(ws) >= 2 && chars >= 4, ring: ring.slice() };
  } catch {
    return none;
  }
}

/**
 * Find the ruled tables on a legend page and read each row as label + symbol.
 * Rows that cannot be read that way are returned in `unsplit`, and ruled
 * areas that are not symbol tables in `other`: nothing is dropped unseen.
 */
export function legendCells(paths, words, options) {
  const out = emptyCells();
  let pb, ws;
  try { pb = cleanPaths(paths); ws = cleanWords(words); } catch { return out; }
  const opt = asObj(options);
  const symbolWord = upper(typeof opt.symbolWord === 'string' ? opt.symbolWord : 'SYMBOL');
  const tagIdLabel = upper(typeof opt.tagIdLabel === 'string' ? opt.tagIdLabel : 'FUNCTIONAL TAG IDENTIFIER');
  const minRule = isNum(opt.minRule) ? opt.minRule : 150;

  // 1. Rules.
  const H = [], V = [];
  for (const { p } of pb) {
    if (!p.stroked) continue;
    const s = p.segs;
    for (let i = 0; i + 3 < s.length; i += 4) {
      const x0 = s[i], y0 = s[i + 1], x1 = s[i + 2], y1 = s[i + 3];
      if (Math.abs(y0 - y1) <= AXIS && Math.abs(x0 - x1) >= minRule) H.push({ y: y0, x0: Math.min(x0, x1), x1: Math.max(x0, x1) });
      else if (Math.abs(x0 - x1) <= AXIS && Math.abs(y0 - y1) >= MIN_UPRIGHT) V.push({ x: x0, y0: Math.min(y0, y1), y1: Math.max(y0, y1) });
    }
  }
  const spans = (v, ya, yb) => v.y0 <= ya + TOL && v.y1 >= yb - TOL;
  const bordered = (x, ya, yb) => V.some(v => Math.abs(v.x - x) <= TOL && spans(v, ya, yb));

  // 2. Bands: horizontals sharing one x-extent.
  const bands = [];
  for (const h of H) {
    let b = bands.find(q => Math.abs(q.x0 - h.x0) <= TOL && Math.abs(q.x1 - h.x1) <= TOL);
    if (!b) { b = { x0: h.x0, x1: h.x1, ys: [] }; bands.push(b); }
    b.ys.push(h.y);
  }

  // 3. Areas: runs of rows closed by a border on both sides.
  const areas = [];
  for (const b of bands) {
    const ys = [];
    for (const y of b.ys.slice().sort((a, c) => a - c)) if (!ys.length || y - ys[ys.length - 1] > TOL) ys.push(y);
    let cur = null;
    for (let i = 0; i + 1 < ys.length; i++) {
      const ya = ys[i], yb = ys[i + 1];
      if (!(bordered(b.x0, ya, yb) && bordered(b.x1, ya, yb))) { cur = null; continue; }
      if (!cur) { cur = { x0: b.x0, x1: b.x1, rows: [] }; areas.push(cur); }
      // 4. Dividers.
      const divs = [];
      for (const x of V.filter(v => v.x > b.x0 + DIVIDER_INSET && v.x < b.x1 - DIVIDER_INSET && spans(v, ya, yb)).map(v => v.x).sort((a, c) => a - c)) {
        if (!divs.length || x - divs[divs.length - 1] > TOL) divs.push(x);
      }
      cur.rows.push({ ya, yb, divs });
    }
  }
  for (const a of areas) a.box = [a.x0, a.rows[0].ya, a.x1, a.rows[a.rows.length - 1].yb];
  areas.sort((a, c) => a.box[0] - c.box[0] || a.box[1] - c.box[1]);

  // 5. Cell contents.
  const wordsIn = c => {
    const inside = ws.filter(w => { const cx = w.x + w.w / 2, cy = w.y + w.h / 2; return cx > c[0] && cx < c[2] && cy > c[1] && cy < c[3]; })
      .sort((a, d) => a.y - d.y);
    const lines = [];
    for (const w of inside) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(w.y - last.y) < 0.5 * Math.max(w.h, last.h)) last.words.push(w);
      else lines.push({ y: w.y, h: w.h, words: [w] });
    }
    return [].concat(...lines.map(l => l.words.sort((a, d) => a.x - d.x)));
  };
  const textOf = list => list.map(w => w.str.trim()).join(' ').replace(/\s+/g, ' ').trim();
  const pathsIn = c => pb.filter(q => q.b[0] >= c[0] + TOL && q.b[2] <= c[2] - TOL && q.b[1] >= c[1] + TOL && q.b[3] <= c[3] - TOL);
  const contains = (o, i) => o[0] <= i[0] + TOL && o[1] <= i[1] + TOL && o[2] >= i[2] - TOL && o[3] >= i[3] - TOL;

  // 6. Heading rows decide which areas are symbol tables.
  for (const a of areas) {
    a.headIdx = -1; a.tagIdx = -1; a.header = ''; a.tagId = ''; a.side = 'right';
    a.rows.forEach((r, i) => {
      if (r.divs.length !== 1) return;
      r.L = [a.x0, r.ya, r.divs[0], r.yb]; r.R = [r.divs[0], r.ya, a.x1, r.yb];
      r.lt = textOf(wordsIn(r.L)); r.rt = textOf(wordsIn(r.R));
      const lu = upper(r.lt), ru = upper(r.rt);
      if (a.headIdx < 0 && symbolWord && (ru === symbolWord) !== (lu === symbolWord)) {
        a.headIdx = i; a.side = ru === symbolWord ? 'right' : 'left'; a.header = ru === symbolWord ? r.lt : r.rt;
      } else if (a.tagIdx < 0 && tagIdLabel && (lu.startsWith(tagIdLabel) || ru.startsWith(tagIdLabel))) {
        a.tagIdx = i; a.tagId = lu.startsWith(tagIdLabel) ? r.rt : r.lt;
      }
    });
  }

  // A ruled area with no SYMBOL heading and no divider, read as symbols only
  // when every row splits into one cluster of linework (or a stack of them)
  // on one side and label words on the other. All or nothing: an area that
  // only partly splits is a line-type box or a worked example, not a table.
  const bareTable = a => {
    const groups = [];
    let header = '', side = '', symbolRows = 0;
    for (let i = 0; i < a.rows.length; i++) {
      const r = a.rows[i], c = [a.x0, r.ya, a.x1, r.yb];
      const ps = pathsIn(c).sort((p, q) => p.b[1] - q.b[1]), ws = wordsIn(c);
      if (!ps.length && !ws.length) continue;
      if (!ps.length) { if (groups.length || header) return null; header = textOf(ws); continue; }
      symbolRows++;
      // Paths stacked with a gap of more than 5 pt are separate symbols.
      const stack = [];
      for (const q of ps) {
        const g = stack[stack.length - 1];
        if (g && q.b[1] <= g.box[3] + 5) { g.ps.push(q); g.box = [Math.min(g.box[0], q.b[0]), g.box[1], Math.max(g.box[2], q.b[2]), Math.max(g.box[3], q.b[3])]; }
        else stack.push({ ps: [q], box: q.b.slice(), inside: [], labels: [] });
      }
      for (const w of ws) {
        const cx = w.x + w.w / 2, cy = w.y + w.h / 2;
        const home = stack.find(g => cx > g.box[0] - TOL && cx < g.box[2] + TOL && cy > g.box[1] - TOL && cy < g.box[3] + TOL);
        if (home) { home.inside.push(w); continue; }
        const gapTo = g => (cy < g.box[1] ? g.box[1] - cy : cy > g.box[3] ? cy - g.box[3] : 0);
        stack.reduce((m, g) => (gapTo(g) < gapTo(m) ? g : m)).labels.push(w);
      }
      for (const g of stack) {
        if (!g.labels.length) return null;
        // Text inside a symbol sits inside one of its outlines. Words merely
        // between pieces of linework are a second column of labels.
        if (g.inside.length && !bubbleOf(g.ps.map(q => q.p), g.inside, g.box).ring) return null;
        const right = g.labels.every(w => w.x >= g.box[2] + TOL), left = g.labels.every(w => w.x + w.w <= g.box[0] - TOL);
        const s = right ? 'left' : left ? 'right' : '';   // the symbol's side, as symbolSide
        if (!s || (side && s !== side)) return null;
        side = s;
        groups.push(g);
      }
    }
    // Two ruled rows with linework at least: one ruled row holding a stack of
    // drawings is a box of worked examples, not a table.
    if (symbolRows < 2) return null;
    return { header, side, groups };
  };

  for (const a of areas) {
    if (a.headIdx < 0) {
      // 8. Not a symbol table. A frame around other areas, and linework ruled
      // inside a symbol table's own cells, are not listed.
      if (areas.some(o => o !== a && (contains(a.box, o.box) || (o.headIdx >= 0 && contains(o.box, a.box))))) continue;
      const bare = bareTable(a);
      if (bare) {
        const table = out.tables.length;
        out.tables.push({ header: bare.header, tagId: '', symbolSide: bare.side, box: a.box, rowCount: bare.groups.length, bare: true });
        for (const g of bare.groups) {
          out.rows.push({ table, label: textOf(g.labels), header: bare.header, tagId: '', symbolPaths: g.ps.map(q => q.p),
            lettersInside: g.inside.map(w => ({ text: w.str.trim(), x: w.x, y: w.y, size: w.h })), box: g.box,
            ...bubbleOf(g.ps.map(q => q.p), g.inside, g.box) });
        }
        continue;
      }
      const rows = [];
      for (const r of a.rows) {
        const c = [a.x0, r.ya, a.x1, r.yb];
        const text = textOf(wordsIn(c)), pathCount = pathsIn(c).length;
        if (text || pathCount) rows.push({ text: text.slice(0, 120), pathCount, box: c });
      }
      if (rows.length) out.other.push({ box: a.box, rows });
      continue;
    }
    // 7. Data rows of a symbol table.
    const table = out.tables.length;
    const entry = { header: a.header, tagId: a.tagId, symbolSide: a.side, box: a.box, rowCount: 0 };
    out.tables.push(entry);
    a.rows.forEach((r, i) => {
      if (i === a.headIdx || i === a.tagIdx) return;
      const whole = [a.x0, r.ya, a.x1, r.yb];
      const fail = (reason, text, pathCount) => out.unsplit.push({ table, header: a.header, reason, text, pathCount, box: whole });
      if (r.divs.length !== 1) {
        const text = textOf(wordsIn(whole)), n = pathsIn(whole).length;
        if (text || n) fail(r.divs.length ? 'several dividers' : 'no divider', text, n);
        else out.emptyRows++;
        return;
      }
      const symCell = a.side === 'right' ? r.R : r.L;
      const label = a.side === 'right' ? r.lt : r.rt;
      const symWords = wordsIn(symCell);
      const sp = pathsIn(symCell);
      if (!label && !sp.length && !symWords.length) { out.emptyRows++; return; }
      if (!label) { fail('no label', textOf(symWords), sp.length); return; }
      if (!sp.length) { fail('no linework', label, 0); return; }
      const box = [Infinity, Infinity, -Infinity, -Infinity];
      for (const q of sp) { box[0] = Math.min(box[0], q.b[0]); box[1] = Math.min(box[1], q.b[1]); box[2] = Math.max(box[2], q.b[2]); box[3] = Math.max(box[3], q.b[3]); }
      out.rows.push({ table, label, header: a.header, tagId: a.tagId, symbolPaths: sp.map(q => q.p),
        lettersInside: symWords.map(w => ({ text: w.str.trim(), x: w.x, y: w.y, size: w.h })), box,
        ...bubbleOf(sp.map(q => q.p), symWords, box) });
      entry.rowCount++;
    });
  }
  return out;
}

// ── Sample boxes (Legend Sheet 1) ─────────────────────────────────────────
// Some boxes draw standard practice as samples beside their names, not as a
// ruled table: LINE TYPES, LINE DEMARCATION and the INSTRUMENTATION
// DESIGNATION examples. The symbols read from them are for the shape check
// only (judgeOnly): the sweep never looks for them. Line types that are
// marks repeated along a line (signal ticks, lagging hatches) are stored as
// one repeat (lineMark), for the pipe cut to pass through.
const SAMPLE_NAMES = [
  ['LINE TYPES', /^SIGNAL - /, 'signal'], ['LINE TYPES', /^PIPELINE - LAGGED$/, 'lagged'],
  ['LINE TYPES', /^PIPELINE - HEATED OR COOLED WITH LAGGING$/, 'heated'],
  ['LINE TYPES', /^(CONNECTION POINT|DIRECTION FLOW ARROW|CHANNEL)$/, null],
  ['LINE DEMARCATION', /^(TIE-IN POINT NUMBER MARKER|TIE-IN POINT DEMARCATION|PROCESS CONTINUATION MARKER|TIE-IN POINT)$/, null],
];
const RIM_MARKS = [[/\bGEP\b|GOOD ENGINEERING/i, 'GEP MARK'], [/QUALITY/i, 'QUALITY MARK'], [/SAFETY/i, 'SAFETY MARK']];
const RIM_MAX = 8;       // points: a rim mark beside a bubble is no bigger than this
const SAMPLE_REACH = 12; // points: a sample's centre lies this close (in y) to its name's lines

// Words as text lines (a gap wider than 1.5 heights starts a new line), then a
// line and the one just under it, starting at the same x, as one label.
function textLines(ws) {
  const lines = [];
  for (const w of ws.slice().sort((a, b) => a.y - b.y || a.x - b.x)) {
    const cy = w.y + w.h / 2;
    const l = lines.find(q => Math.abs(cy - q.cy) < 0.5 * Math.max(w.h, q.h) && w.x - q.x1 <= 1.5 * w.h && q.x0 - (w.x + w.w) <= 1.5 * w.h);
    if (l) { l.words.push(w); l.x0 = Math.min(l.x0, w.x); l.x1 = Math.max(l.x1, w.x + w.w); l.y0 = Math.min(l.y0, w.y); l.y1 = Math.max(l.y1, w.y + w.h); }
    else lines.push({ cy, h: w.h, x0: w.x, x1: w.x + w.w, y0: w.y, y1: w.y + w.h, words: [w] });
  }
  for (const l of lines) l.text = upper(l.words.sort((a, b) => a.x - b.x).map(w => w.str).join(' '));
  return lines.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
}
const under = (a, b) => Math.abs(b.x0 - a.x0) <= 2 && b.y0 - a.y1 >= -1 && b.y0 - a.y1 <= 0.6 * a.h;

// One repeat of a mark drawn along a line: the line is the horizontal (or vertical) run with the most length;
// the rest repeats. A tick (signal) is the first cluster of the rest; a hatch (lagging) one period of it.
function oneRepeat(ps, kind) {
  const seg = [];
  for (const q of ps) for (let i = 0; i + 3 < q.p.segs.length; i += 4) seg.push({ q, s: q.p.segs.slice(i, i + 4) });
  const runs = new Map();
  for (const { q, s } of seg) {
    if (Math.abs(s[1] - s[3]) > 0.3) continue;
    const k = Math.round(s[1] * 2) / 2;
    runs.set(k, (runs.get(k) || 0) + Math.abs(s[2] - s[0]));
  }
  if (!runs.size) return null;
  const y = [...runs.entries()].reduce((m, e) => (e[1] > m[1] ? e : m))[0];
  const onLine = q => { for (let i = 0; i + 3 < q.p.segs.length; i += 4) if (Math.abs(q.p.segs[i + 1] - y) > 0.5 || Math.abs(q.p.segs[i + 3] - y) > 0.5) return false; return true; };
  const line = ps.filter(onLine), rest = ps.filter(q => !onLine(q)).sort((a, b) => a.b[0] - b.b[0]);
  if (!line.length || !rest.length) return null;
  const width = line.reduce((m, q) => Math.max(m, isNum(q.p.width) ? q.p.width : 0), 0);
  let x0, x1;
  if (kind === 'signal') {
    x0 = rest[0].b[0]; x1 = rest[0].b[2];
    for (const q of rest) { if (q.b[0] > x1 + 2) break; x1 = Math.max(x1, q.b[2]); }
    x0 -= 1; x1 += 1;
  } else {
    // The period: per kind of piece (its size), the usual gap between one and the next; the longest such.
    const kinds = new Map();
    for (const q of rest) { const k = Math.round((q.b[2] - q.b[0]) * 2) + ':' + Math.round((q.b[3] - q.b[1]) * 2); if (!kinds.has(k)) kinds.set(k, []); kinds.get(k).push(q.b[0]); }
    let period = 0, start = null;
    for (const xs of kinds.values()) {
      if (xs.length < 3) continue;
      // Pieces at one x (a hatch's two rows) are one repeat.
      const at = xs.sort((a, b) => a - b).filter((v, i) => !i || v - xs[i - 1] > 0.3);
      if (at.length < 3) continue;
      const gaps = at.slice(1).map((v, i) => v - at[i]).sort((a, b) => a - b);
      const g = gaps[Math.floor(gaps.length / 2)];
      if (g > period) { period = g; start = at[1]; }
    }
    if (!(period > 0)) return null;
    x0 = start - 0.01; x1 = start + period;
  }
  const kept = rest.filter(q => { const cx = (q.b[0] + q.b[2]) / 2; return cx >= x0 && cx <= x1; }).map(q => q.p);
  return [...kept, { segs: [x0, y, x1, y], width, stroked: true, filled: false, grey: 0 }];
}

/**
 * The symbols drawn as samples beside their names in Legend Sheet 1's LINE
 * TYPES, LINE DEMARCATION and INSTRUMENTATION DESIGNATION boxes. areas: the
 * ruled areas that are not symbol tables (legendCells' `other`). Returns
 * [{ label, header, symbolPaths, lettersInside: [], box, judgeOnly: true,
 * lineMark: 'signal'|'lagged'|'heated'|null }]. Never throws.
 */
// A path as its sub-paths (runs of segments each starting where the last ended): a composite sample draws
// several symbols in one path.
function subPaths(pb) {
  const out = [];
  for (const q of pb) {
    const s = q.p.segs;
    let cur = [];
    const flush = () => { if (cur.length) { const p = { ...q.p, segs: cur }; out.push({ p, b: boxOfSegs(cur) }); } cur = []; };
    for (let i = 0; i + 3 < s.length; i += 4) {
      if (cur.length && (Math.abs(s[i] - cur[cur.length - 2]) > JOIN || Math.abs(s[i + 1] - cur[cur.length - 1]) > JOIN)) flush();
      cur.push(s[i], s[i + 1], s[i + 2], s[i + 3]);
      // A loop closed on a point drawn before (a stem, then a diamond round from its top): the run up to that
      // point and the loop are separate parts, and what comes next is another.
      for (let k = 0; k + 12 <= cur.length; k += 4) {
        if (Math.abs(s[i + 2] - cur[k]) > JOIN || Math.abs(s[i + 3] - cur[k + 1]) > JOIN) continue;
        const tail = cur.slice(0, k), loop = cur.slice(k);
        if (tail.length) { cur = tail; flush(); }
        cur = loop; flush();
        break;
      }
    }
    flush();
  }
  return out.filter(q => q.b);
}

export function sampleRows(paths, words, areas) {
  const out = [];
  let pb = [], lines = [];
  try { pb = subPaths(cleanPaths(paths)); lines = textLines(cleanWords(words)); } catch { return out; }
  for (const a of asArr(areas)) {
   try {
    // Labels: a line, or a line with the one under it, that names a sample.
    const named = (l, i) => {
      const next = lines.slice(i + 1).find(b => under(l, b));
      for (const text of next ? [l.text + ' ' + next.text, l.text] : [l.text]) {
        const hit = SAMPLE_NAMES.find(n => n[1].test(text));
        if (hit) return { text, heading: hit[0], kind: hit[2], x0: l.x0, y0: l.y0, y1: text === l.text ? l.y1 : next.y1 };
      }
      return null;
    };
      const box = asArr(asObj(a).box);
      if (box.length !== 4 || !box.every(isNum)) continue;
      const inA = (x, y) => x > box[0] && x < box[2] && y > box[1] && y < box[3];
      const heads = lines.filter(l => inA(l.x0 + 1, l.cy));
      const heading = ['LINE TYPES', 'LINE DEMARCATION'].find(h => heads.some(l => l.text === h));
      if (!heading) continue;
      const labels = [];
      lines.forEach((l, i) => { if (!inA(l.x0 + 1, l.cy)) return; const n = named(l, i); if (n && n.heading === heading) labels.push({ ...n, ps: [] }); });
      // A path's name: of the names to its right, those in the nearest column; of those, the nearest in y.
      for (const q of pb) {
        if (!inA(q.b[0], q.b[1]) || !inA(q.b[2], q.b[3])) continue;
        const right = labels.filter(l => l.x0 >= q.b[2] - 1);
        if (!right.length) continue;
        const col = Math.min(...right.map(l => l.x0));
        const cy = (q.b[1] + q.b[3]) / 2, dy = l => (cy < l.y0 ? l.y0 - cy : cy > l.y1 ? cy - l.y1 : 0);
        const column = right.filter(r => r.x0 - col <= 20);
        // Linework running past two names (a stem joining a composite sample's parts) belongs to neither.
        if (column.filter(r => q.b[1] < r.y1 + 2 && q.b[3] > r.y0 - 2).length >= 2) continue;
        const l = column.reduce((m, r) => (dy(r) < dy(m) ? r : m));
        if (dy(l) <= SAMPLE_REACH) l.ps.push(q);
      }
      for (const l of labels) {
        if (!l.ps.length) continue;
        const symbolPaths = l.kind ? oneRepeat(l.ps, l.kind) : l.ps.map(q => q.p);
        if (!symbolPaths || !symbolPaths.length) continue;
        const b = symbolPaths.map(p => boxOfSegs(p.segs)).filter(Boolean).reduce((u, v) => [Math.min(u[0], v[0]), Math.min(u[1], v[1]), Math.max(u[2], v[2]), Math.max(u[3], v[3])]);
        if (!(b[2] - b[0] > 0.5 && b[3] - b[1] > 0.5)) continue;   // a lone line is no sample
        out.push({ label: l.text, header: heading, symbolPaths, lettersInside: [], box: b, judgeOnly: true, lineMark: l.kind });
      }
   } catch { /* this box stands as read */ }
  }
  try {
    // Rim marks: a small closed outline with a sentence beside it naming GEP, Quality or Safety, on a page
    // with an INSTRUMENTATION DESIGNATION heading.
    if (lines.some(l => l.text === 'INSTRUMENTATION DESIGNATION' || (l.text === 'INSTRUMENTATION' && lines.some(b => under(l, b) && b.text === 'DESIGNATION')))) {
      const seen = new Set();
      for (const q of pb) {
        const w = q.b[2] - q.b[0], h = q.b[3] - q.b[1];
        if (!isClosedPath(q.p) || Math.max(w, h) > RIM_MAX || Math.min(w, h) < 3) continue;
        const cy = (q.b[1] + q.b[3]) / 2;
        const says = lines.find(l => l.x0 >= q.b[2] && l.x0 - q.b[2] <= 30 && cy >= l.y0 - 2 && cy <= l.y1 + 12 && /^(CIRCLE|SQUARE|TRIANGLE)\b/.test(l.text));
        if (!says) continue;
        const sentence = [says, ...lines.filter(b => Math.abs(b.x0 - says.x0) <= 2 && b.y0 > says.y0 && b.y0 - says.y1 <= 2.5 * says.h)].map(l => l.text).join(' ');
        const rim = RIM_MARKS.find(m => m[0].test(sentence));
        if (!rim || seen.has(rim[1])) continue;
        seen.add(rim[1]);
        out.push({ label: rim[1], header: 'INSTRUMENTATION DESIGNATION', symbolPaths: [q.p], lettersInside: [], box: q.b.slice(), judgeOnly: true, lineMark: null });
      }
    }
  } catch { /* what was read stands */ }
  return out;
}

/** Sheet number and revision from a title block's words; '' for either when not found. */
export function titleBlock(words) {
  const res = { sheet: '', rev: '' };
  let ws;
  try { ws = cleanWords(words); } catch { return res; }
  for (const w of ws) { const m = /^SHEET\s+(\d+)\b/i.exec(w.str.trim()); if (m) { res.sheet = m[1]; break; } }
  for (const label of ws) {
    if (!/^REV\.?$/i.test(label.str.trim())) continue;
    const cx = label.x + label.w / 2;
    let best = null;
    for (const w of ws) {
      const dy = w.y - label.y;
      if (w === label || dy <= 0 || dy > 30 || Math.abs(w.x + w.w / 2 - cx) > 30) continue;
      if (!best || dy < best.y - label.y) best = w;
    }
    if (best) { res.rev = best.str.trim(); break; }
  }
  return res;
}

/** One legend page: operator list and text items in, rows and title block out. */
export function readLegendPage(input) {
  const i = asObj(input);
  const paths = pagePaths(i.fnArray, i.argsArray, i.OPS, i.viewportTransform);
  const words = textWords(i.textItems, i.viewportTransform);
  const n = typeof i.page === 'number' || typeof i.page === 'string' ? Number(i.page) : 0;
  const cells = legendCells(paths, words, i.options);
  return { page: Number.isFinite(n) ? n : 0, ...titleBlock(words), ...cells, samples: sampleRows(paths, words, cells.other) };
}

// ── The library ───────────────────────────────────────────────────────────
// Library = { version: 1, legend: [{ sheet, rev, page }], importedAt,
//   families: {}, symbols: Symbol[], exceptions: [{ name, status, note, ref }] }
// Symbol  = { id, name, legendName, group, tagId, sheet, w, h, paths, letters,
//   flags: { simple, stretch, manual, unmatched, bubble, bubbleByHand }, aliases, notes,
//   ring? }  ring = [x0, y0, x1, y1], only on a tag bubble: the outline the tag
//   is written inside. bubbleByHand = the owner changed the automatic mark.
// legendName is the label as extracted; name is what the owner may have
// renamed it to. Paths and letters are relative to the symbol's own top-left.

/** Upper case, whitespace collapsed, trimmed. '' for anything but a string. */
export function normName(s) { return upper(s); }

const text = x => (typeof x === 'string' ? x : isNum(x) ? String(x) : '');
// Two decimal places, and never -0 (JSON would turn it into 0 and break a round trip).
const round2 = v => { const r = Math.round(v * 100) / 100; return r === 0 ? 0 : r; };
const isPlain = x => !!x && typeof x === 'object' && !Array.isArray(x);

function emptyLibrary(importedAt) {
  return { version: 1, legend: [], importedAt: text(importedAt), families: {}, symbols: [], exceptions: [] };
}

// Keeps only complete quadruples of finite numbers; null when none remain.
function cleanPath(p, dx, dy) {
  if (!isPlain(p) || !Array.isArray(p.segs)) return null;
  const segs = [];
  for (let i = 0; i + 3 < p.segs.length; i += 4) {
    const q = p.segs.slice(i, i + 4);
    if (q.every(isNum)) segs.push(round2(q[0] - dx), round2(q[1] - dy), round2(q[2] - dx), round2(q[3] - dy));
  }
  if (!segs.length) return null;
  return { segs, width: isNum(p.width) && p.width > 0 ? round2(p.width) : 0, stroked: p.stroked === true, filled: p.filled === true,
    grey: isNum(p.grey) ? Math.max(0, Math.min(255, Math.round(p.grey))) : 0 };
}
function cleanLetters(list, dx, dy) {
  return asArr(list).filter(l => isPlain(l) && typeof l.text === 'string' && l.text.trim() && [l.x, l.y, l.size].every(isNum))
    .map(l => ({ text: l.text.trim(), x: round2(l.x - dx), y: round2(l.y - dy), size: round2(l.size) }));
}
const cleanFlags = f => ({ ...asObj(f), simple: asObj(f).simple === true, stretch: asObj(f).stretch === true,
  manual: asObj(f).manual === true, unmatched: asObj(f).unmatched === true,
  bubble: asObj(f).bubble === true, bubbleByHand: asObj(f).bubbleByHand === true });
// A ring is four finite numbers with some size to it, or nothing.
const cleanRing = r => (Array.isArray(r) && r.length === 4 && r.every(isNum) && r[2] > r[0] && r[3] > r[1] ? r.map(round2) : null);
const cleanAliases = list => asArr(list).filter(a => typeof a === 'string' && a.trim()).map(a => a.trim());
const cleanNotes = list => asArr(list).filter(isPlain)
  .map(n => ({ text: text(n.text).trim(), ref: text(n.ref).trim(), date: text(n.date).trim() })).filter(n => n.text);

/** Build a library from readLegendPage results. One symbol per row. */
export function buildLibrary(pages, importedAt) {
  const lib = emptyLibrary(importedAt);
  for (const page of asArr(pages)) {
    if (!isPlain(page)) continue;
    const pg = isNum(page.page) ? page.page : 0;
    const sheet = text(page.sheet).trim() || String(pg);
    lib.legend.push({ sheet, rev: text(page.rev).trim(), page: pg });
    let n = 0, ns = 0;
    const rows = [...asArr(page.rows), ...asArr(page.samples).filter(r => isPlain(r) && r.judgeOnly === true)];
    for (const row of rows) {
      if (!isPlain(row) || typeof row.label !== 'string' || !row.label.trim()) continue;
      const sample = row.judgeOnly === true;
      // The box comes from the linework itself, not from the row's own box.
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of asArr(row.symbolPaths)) {
        if (!isPlain(p) || !Array.isArray(p.segs)) continue;
        // Unrounded values, and only the quadruples cleanPath will keep.
        for (let i = 0; i + 3 < p.segs.length; i += 4) {
          const q = p.segs.slice(i, i + 4);
          if (!q.every(isNum)) continue;
          x0 = Math.min(x0, q[0], q[2]); x1 = Math.max(x1, q[0], q[2]); y0 = Math.min(y0, q[1], q[3]); y1 = Math.max(y1, q[1], q[3]);
        }
      }
      const has = x1 >= x0;
      const dx = has ? x0 : 0, dy = has ? y0 : 0;
      if (sample) ns++; else n++;
      const name = row.label.replace(/\s+/g, ' ').trim();
      // A tag bubble's placeholder text is replaced by the tag on a drawing,
      // so it is not kept as letters a drawing must show.
      const ring = row.bubble === true && has ? cleanRing(asArr(row.ring).map((v, i) => (i % 2 ? v - dy : v - dx))) : null;
      const bubble = !!ring;
      lib.symbols.push({
        id: 'p' + pg + '-' + (sample ? 's' + String(ns).padStart(2, '0') : String(n).padStart(3, '0')), name, legendName: name,
        group: text(row.header).trim(), tagId: text(row.tagId).trim(), sheet,
        w: has ? round2(x1 - x0) : 0, h: has ? round2(y1 - y0) : 0,
        paths: asArr(row.symbolPaths).map(p => cleanPath(p, dx, dy)).filter(Boolean),
        letters: bubble ? [] : cleanLetters(row.lettersInside, dx, dy),
        flags: { simple: false, stretch: false, manual: false, unmatched: false, bubble, bubbleByHand: false,
          ...(sample ? { judgeOnly: true, ...(typeof row.lineMark === 'string' && row.lineMark ? { lineMark: row.lineMark } : {}) } : {}) }, aliases: [], notes: [],
        ...(ring ? { ring } : {}),
      });
    }
  }
  return lib;
}

/**
 * Read a library file's text. Refuses on structure and never drops a symbol:
 * a file this cannot fully understand is reported, not half-read, so that a
 * later save cannot quietly lose what was skipped.
 */
export function parseLibrary(source) {
  if (typeof source !== 'string') return { ok: false, error: 'not-json' };
  let data;
  try { data = JSON.parse(source); } catch { return { ok: false, error: 'not-json' }; }
  if (!isPlain(data) || typeof data.version !== 'number') return { ok: false, error: 'not-a-library' };
  if (data.version > 1) return { ok: false, error: 'newer-version' };
  if (data.version !== 1 || !Array.isArray(data.symbols)) return { ok: false, error: 'not-a-library' };
  if (!data.symbols.every(s => isPlain(s) && typeof s.name === 'string' && s.name.trim())) return { ok: false, error: 'bad-symbol' };

  // The first holder of an id keeps it; a missing or repeated one is replaced.
  const used = new Set();
  const keeps = data.symbols.map(s => {
    const ok = typeof s.id === 'string' && s.id && !used.has(s.id);
    if (ok) used.add(s.id);
    return ok;
  });
  let next = 1;
  const freshId = () => { while (used.has('r-' + next)) next++; const id = 'r-' + next; used.add(id); return id; };

  const symbols = data.symbols.map((s, i) => {
    const name = s.name.trim();
    const ring = cleanRing(s.ring);
    const { ring: _drop, ...rest } = s;
    return {
      ...rest,
      ...(ring ? { ring } : {}),
      id: keeps[i] ? s.id : freshId(),
      name,
      legendName: typeof s.legendName === 'string' && s.legendName.trim() ? s.legendName.trim() : name,
      group: text(s.group), tagId: text(s.tagId), sheet: text(s.sheet),
      w: isNum(s.w) && s.w > 0 ? s.w : 0, h: isNum(s.h) && s.h > 0 ? s.h : 0,
      paths: asArr(s.paths).map(p => cleanPath(p, 0, 0)).filter(Boolean),
      letters: cleanLetters(s.letters, 0, 0),
      flags: cleanFlags(s.flags), aliases: cleanAliases(s.aliases), notes: cleanNotes(s.notes),
    };
  });
  const library = {
    ...data,
    version: 1,
    legend: asArr(data.legend).filter(isPlain).map(l => ({ sheet: text(l.sheet), rev: text(l.rev), page: isNum(l.page) ? l.page : 0 })),
    importedAt: text(data.importedAt),
    families: asObj(data.families),
    symbols,
    exceptions: asArr(data.exceptions).filter(e => isPlain(e) && typeof e.name === 'string' && e.name.trim())
      .map(e => ({ name: e.name.trim(), status: e.status === 'approved' ? 'approved' : 'pending', note: text(e.note), ref: text(e.ref) })),
  };
  return { ok: true, library };
}

/** Compact JSON for symbol-library.json. */
export function serialiseLibrary(library) {
  try { return JSON.stringify(isPlain(library) ? library : emptyLibrary('')); } catch { return JSON.stringify(emptyLibrary('')); }
}

export function libraryCounts(library) {
  const symbols = asArr(asObj(library).symbols).filter(isPlain);
  return {
    symbols: symbols.length,
    notes: symbols.reduce((n, s) => n + asArr(s.notes).length, 0),
    aliases: symbols.reduce((n, s) => n + asArr(s.aliases).length, 0),
    exceptions: asArr(asObj(library).exceptions).filter(isPlain).length,
    manual: symbols.filter(s => asObj(s.flags).manual === true).length,
    bubbles: symbols.filter(s => asObj(s.flags).bubble === true).length,
  };
}

// ── Search ────────────────────────────────────────────────────────────────

const wordsOf = s => text(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
// A tag identifier cell can hold several codes.
const tagCodes = tagId => text(tagId).toLowerCase().split(/[\s,/;]+/).filter(Boolean);

// Best score one term earns against one entry's fields. See the weights in
// docs/superpowers/plans/2026-11-13-pid-symbol-search.md, Task 5.
function termScore(term, f) {
  const one = t => {
    if (f.codes.includes(t)) return 12;
    if (f.named.some(w => w === t)) return 10;
    if (f.named.some(w => w.startsWith(t))) return 7;
    if (f.group.some(w => w.startsWith(t))) return 4;
    if (f.joined.some(j => j.includes(t)) || f.letters.includes(t)) return 3;
    if (f.notes.includes(t)) return 2;
    return 0;
  };
  // A plural finds its singular: "valves" finds "valve".
  return term.length > 3 && term.endsWith('s') ? Math.max(one(term), one(term.slice(0, -1))) : one(term);
}

function scoreEntry(terms, query, f) {
  let score = 0;
  for (const t of terms) { const s = termScore(t, f); if (!s) return 0; score += s; }
  if (f.joined.some(j => j === query)) score += 30;
  if (f.joined.some(j => j.startsWith(query))) score += 10;
  if (terms.length === 1 && f.codes.includes(terms[0])) score += 50;
  return score;
}

/**
 * One box over name, aliases, table heading, tag identifier, notes and
 * exceptions. Every word of the query must match somewhere. Ties keep library
 * order, which is what makes a tag code list its family as the legend does.
 */
export function searchSymbols(library, query) {
  const lib = asObj(library);
  const symbols = asArr(lib.symbols).filter(s => isPlain(s) && typeof s.name === 'string');
  const exceptions = asArr(lib.exceptions).filter(e => isPlain(e) && typeof e.name === 'string');
  const terms = wordsOf(query);
  const all = [...symbols.map(symbol => ({ kind: 'symbol', symbol, score: 0 })),
    ...exceptions.map(exception => ({ kind: 'exception', exception, score: 0 }))];
  if (!terms.length) return all;
  const joinedQuery = terms.join(' ');
  for (const r of all) {
    if (r.kind === 'symbol') {
      const s = r.symbol;
      const names = [s.name, ...asArr(s.aliases)].map(n => wordsOf(n));
      r.score = scoreEntry(terms, joinedQuery, {
        codes: tagCodes(s.tagId), named: [].concat(...names), joined: names.map(w => w.join(' ')),
        group: wordsOf(s.group), letters: asArr(s.letters).map(l => text(asObj(l).text).toLowerCase()),
        notes: asArr(s.notes).map(n => (text(asObj(n).text) + ' ' + text(asObj(n).ref)).toLowerCase()).join(' \n '),
      });
    } else {
      const e = r.exception;
      const name = wordsOf(e.name);
      r.score = scoreEntry(terms, joinedQuery, { codes: [], named: name, joined: [name.join(' ')], group: [], letters: [],
        notes: (text(e.note) + ' ' + text(e.ref)).toLowerCase() });
    }
  }
  return all.map((r, i) => ({ r, i })).filter(x => x.r.score > 0).sort((a, b) => b.r.score - a.r.score || a.i - b.i).map(x => x.r);
}

// ── Editing ───────────────────────────────────────────────────────────────
// Every function returns a new library and leaves its argument untouched. An
// unknown id, or a library that is not one, comes back unchanged.

const hasSymbols = library => isPlain(library) && Array.isArray(library.symbols);
function mapSymbol(library, id, fn) {
  if (!hasSymbols(library)) return library;
  let hit = false;
  const symbols = library.symbols.map(s => {
    if (!isPlain(s) || s.id !== id || hit) return s;
    const next = fn(s);
    if (next !== s) hit = true;
    return next;
  });
  return hit ? { ...library, symbols } : library;
}

/** Change the fields an owner may edit: name, group, tagId, sheet, aliases, simple, stretch, bubble. */
export function updateSymbol(library, id, patch) {
  const p = asObj(patch);
  return mapSymbol(library, id, s => {
    const next = { ...s, flags: { ...asObj(s.flags) } };
    if (typeof p.name === 'string' && p.name.trim()) next.name = p.name.trim();
    if (typeof p.group === 'string') next.group = p.group.trim();
    if (typeof p.tagId === 'string') next.tagId = p.tagId.trim().toUpperCase();
    if (typeof p.sheet === 'string') next.sheet = p.sheet.trim();
    if (Array.isArray(p.aliases)) next.aliases = cleanAliases(p.aliases);
    if (typeof p.simple === 'boolean') next.flags.simple = p.simple;
    if (typeof p.stretch === 'boolean') next.flags.stretch = p.stretch;
    if (typeof p.operator === 'boolean') next.flags.operator = p.operator;
    // The automatic tag-bubble mark, changed by the owner, is hand work.
    if (typeof p.bubble === 'boolean' && p.bubble !== (next.flags.bubble === true)) { next.flags.bubble = p.bubble; next.flags.bubbleByHand = true; }
    return next;
  });
}

/**
 * Mark (on) or unmark every symbol under one table heading as an operator: a
 * handwheel, lever or actuator that sits on another symbol's stem. Headings
 * match trimmed and case-blind. The same library comes back when nothing changes.
 */
export function markGroupOperators(library, group, on) {
  if (!hasSymbols(library) || typeof group !== 'string' || !group.trim()) return library;
  const want = normName(group), value = on === true;
  let changed = false;
  const symbols = library.symbols.map(s => {
    if (!isPlain(s) || normName(text(s.group)) !== want || (asObj(s.flags).operator === true) === value) return s;
    changed = true;
    return { ...s, flags: { ...asObj(s.flags), operator: value } };
  });
  return changed ? { ...library, symbols } : library;
}

export function deleteSymbol(library, id) {
  if (!hasSymbols(library) || !library.symbols.some(s => isPlain(s) && s.id === id)) return library;
  return { ...library, symbols: library.symbols.filter(s => !(isPlain(s) && s.id === id)) };
}

function nextManualId(symbols) {
  let max = 0;
  for (const s of symbols) { const m = isPlain(s) && typeof s.id === 'string' ? /^m-(\d+)$/.exec(s.id) : null; if (m) max = Math.max(max, Number(m[1])); }
  return 'm-' + (max + 1);
}

/** A symbol entered by hand, with no linework. Returns { library, id }; id is '' when the name is blank. */
export function addManualSymbol(library, entry) {
  const e = asObj(entry);
  const name = text(e.name).replace(/\s+/g, ' ').trim();
  if (!hasSymbols(library) || !name) return { library, id: '' };
  const id = nextManualId(library.symbols);
  const symbol = { id, name, legendName: name, group: text(e.group).trim(), tagId: text(e.tagId).trim().toUpperCase(), sheet: text(e.sheet).trim(),
    w: 0, h: 0, paths: [], letters: [], flags: { simple: false, stretch: false, manual: true, unmatched: false }, aliases: [], notes: [] };
  return { library: { ...library, symbols: [...library.symbols, symbol] }, id };
}

export function addNote(library, id, note) {
  const n = asObj(note);
  const body = text(n.text).trim();
  if (!body) return library;
  return mapSymbol(library, id, s => ({ ...s, notes: [...asArr(s.notes), { text: body, ref: text(n.ref).trim(), date: text(n.date).trim() }] }));
}

export function removeNote(library, id, index) {
  return mapSymbol(library, id, s => {
    const notes = asArr(s.notes);
    return Number.isInteger(index) && index >= 0 && index < notes.length ? { ...s, notes: notes.filter((_, i) => i !== index) } : s;
  });
}

/** Add an exception (an item with no palette symbol), or replace the one with the same name. */
export function setException(library, exception) {
  const e = asObj(exception);
  const name = text(e.name).trim();
  if (!isPlain(library) || !name) return library;
  const entry = { name, status: e.status === 'approved' ? 'approved' : 'pending', note: text(e.note).trim(), ref: text(e.ref).trim() };
  const list = asArr(library.exceptions);
  const at = list.findIndex(x => isPlain(x) && normName(x.name) === normName(name));
  return { ...library, exceptions: at < 0 ? [...list, entry] : list.map((x, i) => (i === at ? entry : x)) };
}

export function removeException(library, name) {
  if (!isPlain(library) || !Array.isArray(library.exceptions)) return library;
  const key = normName(name);
  if (!key || !library.exceptions.some(x => isPlain(x) && normName(x.name) === key)) return library;
  return { ...library, exceptions: library.exceptions.filter(x => !(isPlain(x) && normName(x.name) === key)) };
}

// ── Carrying hand-entered work across a re-import ─────────────────────────

const usableSymbols = library => asArr(asObj(library).symbols).filter(s => isPlain(s) && typeof s.name === 'string' && s.name.trim());
const legendKey = s => normName(typeof s.legendName === 'string' && s.legendName.trim() ? s.legendName : s.name);
// legend name | table heading | which one of that pair this is, counting from 0.
function occurrenceKeys(symbols) {
  const seen = new Map();
  return symbols.map(s => {
    const base = legendKey(s) + '|' + normName(s.group);
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    return base + '|' + n;
  });
}
function mergeAliases(first, second) {
  const out = [];
  for (const a of [...asArr(first), ...asArr(second)]) if (typeof a === 'string' && a.trim() && !out.some(x => normName(x) === normName(a))) out.push(a.trim());
  return out;
}

/**
 * Replace oldLibrary with newLibrary (a fresh import) without losing what was
 * entered by hand. Notes, aliases, flags and renames follow a symbol by its
 * legend name. Manual entries and exceptions come across. An old symbol that
 * holds notes or aliases and finds no match is kept and flagged, and listed
 * in `unmatched`: listed, not dropped.
 */
export function carryOver(oldLibrary, newLibrary) {
  const base = isPlain(newLibrary) ? newLibrary : emptyLibrary('');
  const old = isPlain(oldLibrary) ? oldLibrary : emptyLibrary('');
  const summary = { matched: 0, notes: 0, aliases: 0, renames: 0, manual: 0, exceptions: 0, dropped: 0 };
  const unmatched = [];

  const fresh = usableSymbols(base).map(s => ({ ...s, flags: { ...asObj(s.flags) }, aliases: asArr(s.aliases).slice(), notes: asArr(s.notes).slice() }));
  const imported = fresh.length;
  const freshKeys = occurrenceKeys(fresh);
  const claimed = new Set();
  const oldSymbols = usableSymbols(old);
  const oldKeys = occurrenceKeys(oldSymbols);

  // Matching is settled before anything is merged: exact keys first, then a
  // lone unclaimed symbol of the same legend name (its table heading changed).
  const match = new Map();
  oldSymbols.forEach((s, i) => {
    if (asObj(s.flags).manual === true) return;
    const at = freshKeys.findIndex((k, j) => k === oldKeys[i] && !claimed.has(j));
    if (at >= 0) { match.set(i, at); claimed.add(at); }
  });
  oldSymbols.forEach((s, i) => {
    if (asObj(s.flags).manual === true || match.has(i)) return;
    const candidates = fresh.map((f, j) => j).filter(j => !claimed.has(j) && legendKey(fresh[j]) === legendKey(s));
    if (candidates.length === 1) { match.set(i, candidates[0]); claimed.add(candidates[0]); }
  });

  const carried = [];
  oldSymbols.forEach((s, i) => {
    const flags = asObj(s.flags), notes = asArr(s.notes), aliases = asArr(s.aliases);
    if (flags.manual === true) {
      const twin = fresh.find(f => normName(f.name) === normName(s.name));
      if (twin) { twin.notes = [...notes, ...twin.notes]; twin.aliases = mergeAliases(aliases, twin.aliases); }
      else { carried.push({ ...s }); summary.manual++; }
      return;
    }
    if (match.has(i)) {
      const f = fresh[match.get(i)];
      f.notes = [...notes, ...f.notes];
      f.aliases = mergeAliases(aliases, f.aliases);
      f.flags.simple = flags.simple === true;
      f.flags.stretch = flags.stretch === true;
      if (flags.operator === true) f.flags.operator = true;
      if (flags.bubbleByHand === true) { f.flags.bubble = flags.bubble === true; f.flags.bubbleByHand = true; }
      if (normName(s.name) !== legendKey(s)) { f.name = s.name; summary.renames++; }
      if (!text(f.tagId).trim() && text(s.tagId).trim()) f.tagId = s.tagId;
      summary.matched++; summary.notes += notes.length; summary.aliases += aliases.length;
      return;
    }
    // Kept whenever it carries anything entered by hand: a note, an alias, a
    // rename, or a simple / drawn-to-suit / operator mark. Only a symbol exactly as the
    // old legend gave it is let go, because a fresh import can regenerate it.
    const handWork = notes.length || aliases.length || normName(s.name) !== legendKey(s) || flags.simple === true || flags.stretch === true || flags.bubbleByHand === true || flags.operator === true;
    if (handWork) {
      carried.push({ ...s, flags: { ...flags, unmatched: true } });
      unmatched.push({ name: s.name, group: text(s.group), notes: notes.length, aliases: aliases.length });
    } else summary.dropped++;
  });

  // Carried-in symbols get fresh ids so nothing collides with the new import's.
  const symbols = fresh.slice();
  for (const c of carried) { const id = nextManualId(symbols); symbols.push({ ...c, id }); }

  const exceptions = asArr(old.exceptions).filter(e => isPlain(e) && typeof e.name === 'string' && e.name.trim());
  summary.exceptions = exceptions.length;
  for (const e of asArr(base.exceptions)) {
    if (isPlain(e) && typeof e.name === 'string' && e.name.trim() && !exceptions.some(x => normName(x.name) === normName(e.name))) exceptions.push(e);
  }
  const importedNames = new Set();
  for (const f of fresh.slice(0, imported)) {
    importedNames.add(normName(f.name)); importedNames.add(legendKey(f));
    for (const a of f.aliases) importedNames.add(normName(a));
  }
  const exceptionsNowInLibrary = exceptions.filter(e => importedNames.has(normName(e.name))).map(e => e.name);

  return {
    library: { ...base, families: { ...asObj(old.families), ...asObj(base.families) }, symbols, exceptions },
    summary, unmatched, exceptionsNowInLibrary,
  };
}
