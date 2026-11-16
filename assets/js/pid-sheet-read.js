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
