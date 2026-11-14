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
    for (const op of ops) {
      if (op === OPS.moveTo) { ux = c[j++]; uy = c[j++]; sux = ux; suy = uy; cur = null; }
      else if (op === OPS.lineTo) { lineTo(c[j++], c[j++]); }
      else if (op === OPS.curveTo) { curve(c[j], c[j + 1], c[j + 2], c[j + 3], c[j + 4], c[j + 5]); j += 6; }
      else if (op === OPS.curveTo2) { curve(ux, uy, c[j], c[j + 1], c[j + 2], c[j + 3]); j += 4; }
      else if (op === OPS.curveTo3) { curve(c[j], c[j + 1], c[j + 2], c[j + 3], c[j + 2], c[j + 3]); j += 4; }
      else if (op === OPS.closePath) { close(); }
      else if (op === OPS.rectangle) {
        const x = c[j++], y = c[j++], w = c[j++], h = c[j++];
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

  for (const a of areas) {
    if (a.headIdx < 0) {
      // 8. Not a symbol table. A frame around other areas, and linework ruled
      // inside a symbol table's own cells, are not listed.
      if (areas.some(o => o !== a && (contains(a.box, o.box) || (o.headIdx >= 0 && contains(o.box, a.box))))) continue;
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
        lettersInside: symWords.map(w => ({ text: w.str.trim(), x: w.x, y: w.y, size: w.h })), box });
      entry.rowCount++;
    });
  }
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
  return { page: Number.isFinite(n) ? n : 0, ...titleBlock(words), ...legendCells(paths, words, i.options) };
}

// ── The library ───────────────────────────────────────────────────────────
// Library = { version: 1, legend: [{ sheet, rev, page }], importedAt,
//   families: {}, symbols: Symbol[], exceptions: [{ name, status, note, ref }] }
// Symbol  = { id, name, legendName, group, tagId, sheet, w, h, paths, letters,
//   flags: { simple, stretch, manual, unmatched }, aliases, notes }
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
  manual: asObj(f).manual === true, unmatched: asObj(f).unmatched === true });
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
    let n = 0;
    for (const row of asArr(page.rows)) {
      if (!isPlain(row) || typeof row.label !== 'string' || !row.label.trim()) continue;
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
      n++;
      const name = row.label.replace(/\s+/g, ' ').trim();
      lib.symbols.push({
        id: 'p' + pg + '-' + String(n).padStart(3, '0'), name, legendName: name,
        group: text(row.header).trim(), tagId: text(row.tagId).trim(), sheet,
        w: has ? round2(x1 - x0) : 0, h: has ? round2(y1 - y0) : 0,
        paths: asArr(row.symbolPaths).map(p => cleanPath(p, dx, dy)).filter(Boolean),
        letters: cleanLetters(row.lettersInside, dx, dy),
        flags: { simple: false, stretch: false, manual: false, unmatched: false }, aliases: [], notes: [],
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
    return {
      ...s,
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

/** Change the fields an owner may edit: name, group, tagId, sheet, aliases, simple, stretch. */
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
    return next;
  });
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
      if (normName(s.name) !== legendKey(s)) { f.name = s.name; summary.renames++; }
      if (!text(f.tagId).trim() && text(s.tagId).trim()) f.tagId = s.tagId;
      summary.matched++; summary.notes += notes.length; summary.aliases += aliases.length;
      return;
    }
    // Kept whenever it carries anything entered by hand: a note, an alias, a
    // rename, or a simple / drawn-to-suit mark. Only a symbol exactly as the
    // old legend gave it is let go, because a fresh import can regenerate it.
    const handWork = notes.length || aliases.length || normName(s.name) !== legendKey(s) || flags.simple === true || flags.stretch === true;
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
