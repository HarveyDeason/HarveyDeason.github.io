// assets/js/pid-symbol-report-pdf.js
// The symbol check report as a PDF for a review pack: a front page, then for
// each checked sheet a heading page, page 1 of the original drawing copied in
// at its own size with a numbered box around each item, and the table.
//
// pdf-lib is passed in (window.PDFLib in the browser, the vendored file in
// Node), so this module loads nothing itself. Every string drawn goes through
// pdfSafe: the standard Helvetica font holds only Latin-1, and a character it
// cannot encode would otherwise make pdf-lib throw.
// Nothing here throws: a drawing that cannot be copied gets a line saying so.

import { FAMILY_NOTE, VERDICT_LABELS, SUMMARY_ORDER } from './pid-symbol-check-view.js';
import { PRINT_COLOURS, FALLBACK, SHORT_NOTE } from './pid-symbol-report.js';

const A4 = [595.28, 841.89];
const MARGIN = 42;
const BOX_LINE = 1.5;
const isNum = x => typeof x === 'number' && Number.isFinite(x);
const str = x => (typeof x === 'string' ? x : isNum(x) ? String(x) : '');
const obj = x => (x && typeof x === 'object' ? x : {});
const asArr = x => (Array.isArray(x) ? x : []);
const count = x => (isNum(x) && x > 0 ? Math.floor(x) : 0);
const isRect = r => Array.isArray(r) && r.length === 4 && r.every(isNum) && r[2] > r[0] && r[3] > r[1];

/** Text the PDF's font can hold: Latin-1 printable kept, tab and line breaks a space, anything else one '?'. */
export function pdfSafe(s) {
  if (typeof s !== 'string') return '';
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c === 9 || c === 10 || c === 13) out += ' ';
    else if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff)) out += ch;
    else out += '?';
  }
  return out;
}

const KEY = {
  ok: 'A standard symbol of the right family sits beside the tag.',
  'off-size': 'Right family, drawn at a different size from the legend.',
  'wrong-family': 'The symbol beside the tag belongs to another family.',
  exception: 'Nothing recognised; this family has approved exceptions.',
  look: 'Nothing recognised beside the tag.',
  'not-checked': 'The check could not judge this tag; the row says why.',
};

function duration(seconds) {
  const s = Math.round(isNum(seconds) && seconds > 0 ? seconds : 0);
  return s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + (s % 60) + ' s';
}

function colourOf(PDFLib, hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(str(hex));
  return m ? PDFLib.rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255) : PDFLib.rgb(0.46, 0.46, 0.46);
}

// Lines no wider than `width`: broken at spaces, and inside a word only when the word alone is too wide.
function wrap(text, font, size, width) {
  const words = pdfSafe(text).split(' ');
  const lines = [];
  let cur = '';
  const fits = t => font.widthOfTextAtSize(t, size) <= width;
  for (let w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (fits(next)) { cur = next; continue; }
    if (cur) lines.push(cur);
    cur = '';
    while (w && !fits(w)) {
      let k = 1;
      while (k < w.length && fits(w.slice(0, k + 1))) k++;
      lines.push(w.slice(0, k));
      w = w.slice(k);
    }
    cur = w;
  }
  if (cur || !lines.length) lines.push(cur);
  return lines;
}

// A4 pages written top to bottom, a new page when the next block will not fit.
function writer(doc, PDFLib, fonts) {
  const black = PDFLib.rgb(0, 0, 0), grey = PDFLib.rgb(0.35, 0.35, 0.35), rule = PDFLib.rgb(0.75, 0.75, 0.75);
  const W = A4[0] - 2 * MARGIN;
  const w = { page: null, y: 0, pages: [] };
  w.newPage = () => { w.page = doc.addPage(A4); w.y = A4[1] - MARGIN; w.pages.push(w.page); };
  w.room = h => { if (!w.page || w.y - h < MARGIN + 16) w.newPage(); };
  w.text = (text, { size = 10, bold = false, colour = black, gap = 0.35 } = {}) => {
    const font = bold ? fonts.bold : fonts.regular;
    for (const ln of wrap(text, font, size, W)) {
      w.room(size * 1.3);
      w.page.drawText(ln, { x: MARGIN, y: w.y - size, size, font, color: colour });
      w.y -= size * 1.3;
    }
    w.y -= size * gap;
  };
  w.gap = h => { w.y -= h; };
  // cols: [{ title, width }]; rows: [[cell]] where a cell is text or { text, swatch: kind }.
  w.table = (cols, rows, { size = 8, headSize = 7 } = {}) => {
    const pad = 3, lh = size * 1.25, hlh = headSize * 1.2;
    const scale = W / cols.reduce((a, c) => a + c.width, 0);
    const widths = cols.map(c => c.width * scale);
    const head = cols.map((c, i) => wrap(c.title, fonts.bold, headSize, widths[i] - 2 * pad));
    const headH = Math.max(...head.map(l => l.length)) * hlh + 2 * pad;
    const drawHead = () => {
      w.room(headH + lh + 2 * pad);
      let x = MARGIN;
      head.forEach((lines, i) => {
        lines.forEach((ln, k) => w.page.drawText(ln, { x: x + pad, y: w.y - pad - headSize - k * hlh, size: headSize, font: fonts.bold, color: black }));
        x += widths[i];
      });
      w.y -= headH;
      w.page.drawLine({ start: { x: MARGIN, y: w.y }, end: { x: MARGIN + W, y: w.y }, thickness: 0.8, color: black });
    };
    drawHead();
    for (const row of rows) {
      const cells = cols.map((_, i) => {
        const c = row[i];
        const swatch = c && typeof c === 'object' ? str(c.swatch) : '';
        const text = c && typeof c === 'object' ? str(c.text) : str(c);
        const inner = widths[i] - 2 * pad - (swatch ? 9 : 0);
        return { swatch, lines: wrap(text, fonts.regular, size, Math.max(4, inner)) };
      });
      const h = Math.max(...cells.map(c => c.lines.length)) * lh + 2 * pad;
      if (w.y - h < MARGIN + 16) { w.newPage(); drawHead(); }
      let x = MARGIN;
      cells.forEach((c, i) => {
        let tx = x + pad;
        if (c.swatch) { swatchAt(w.page, PDFLib, c.swatch, tx, w.y - pad - size + 0.5, 6, 6); tx += 9; }
        c.lines.forEach((ln, k) => w.page.drawText(ln, { x: tx, y: w.y - pad - size - k * lh + 1, size, font: fonts.regular, color: black }));
        x += widths[i];
      });
      w.y -= h;
      w.page.drawLine({ start: { x: MARGIN, y: w.y }, end: { x: MARGIN + W, y: w.y }, thickness: 0.4, color: rule });
    }
    w.y -= 6;
  };
  w.grey = grey;
  return w;
}

function swatchAt(page, PDFLib, kind, x, y, wd, ht) {
  const k = Object.prototype.hasOwnProperty.call(PRINT_COLOURS, kind) ? kind : 'not-checked';
  page.drawRectangle({ x, y, width: wd, height: ht, borderColor: colourOf(PDFLib, PRINT_COLOURS[k]), borderWidth: BOX_LINE,
    ...(k === 'not-checked' ? { borderDashArray: [2, 1.5] } : {}) });
}

const countsLine = counts => {
  const c = obj(counts);
  return SUMMARY_ORDER.map(k => [k, count(c[k])]).filter(x => x[1]).map(x => x[1] + ' ' + VERDICT_LABELS[x[0]]).join(' · ') || 'No tags.';
};

// In the page's user space, which way is right and which is up for someone viewing it, by its /Rotate.
const AXES = { 0: [[1, 0], [0, 1]], 90: [[0, 1], [-1, 0]], 180: [[-1, 0], [0, -1]], 270: [[0, -1], [1, 0]] };
// The corner a viewer sees as top left, of an upright rectangle in user space.
const TOP_LEFT = { 0: r => [r[0], r[3]], 90: r => [r[0], r[1]], 180: r => [r[2], r[1]], 270: r => [r[2], r[3]] };

function drawBoxes(page, PDFLib, fonts, rows) {
  let angle = 0;
  try { angle = page.getRotation().angle; } catch { angle = 0; }
  angle = (((Math.round((isNum(angle) ? angle : 0) / 90) * 90) % 360) + 360) % 360;
  const [R, U] = AXES[angle];
  const white = PDFLib.rgb(1, 1, 1);
  const size = 6, lh = 8;
  for (const r of rows) {
    const rect = obj(r).userRect;
    if (!isRect(rect)) continue;
    const kind = Object.prototype.hasOwnProperty.call(PRINT_COLOURS, r.kind) ? r.kind : 'not-checked';
    const colour = colourOf(PDFLib, PRINT_COLOURS[kind]);
    page.drawRectangle({ x: rect[0], y: rect[1], width: rect[2] - rect[0], height: rect[3] - rect[1], borderColor: colour, borderWidth: BOX_LINE,
      ...(kind === 'not-checked' ? { borderDashArray: [3, 2] } : {}) });
    // The number on a small filled tab sitting on the box's top-left corner, upright for the viewer.
    const label = String(count(r.no));
    const lw = fonts.bold.widthOfTextAtSize(label, size) + 3;
    const C = TOP_LEFT[angle](rect);
    const at = (dx, dy) => [C[0] + dx * R[0] + dy * U[0], C[1] + dx * R[1] + dy * U[1]];
    const corners = [at(0, 0), at(lw, 0), at(0, lh), at(lw, lh)];
    const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]);
    page.drawRectangle({ x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys), color: colour });
    const o = at(1.5, 2);
    page.drawText(label, { x: o[0], y: o[1], size, font: fonts.bold, color: white, rotate: PDFLib.degrees(angle) });
  }
}

async function loadSource(PDFLib, doc, bytes) {
  try {
    if (!bytes || !(bytes instanceof ArrayBuffer || ArrayBuffer.isView(bytes))) return null;
    const src = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
    if (src.getPageCount() < 1) return null;
    const [page] = await doc.copyPages(src, [0]);
    return page || null;
  } catch {
    return null;
  }
}

async function render(model, sources, PDFLib, withDrawings) {
  const m = obj(model);
  const run = obj(m.run), lib = obj(m.library);
  const sheets = asArr(m.sheets).filter(s => s && typeof s === 'object');
  const doc = await PDFLib.PDFDocument.create();
  try { doc.setTitle(pdfSafe(str(m.title) || 'P&ID symbol check')); doc.setCreator('P&ID Tag Register'); doc.setProducer('P&ID Tag Register'); } catch { /* metadata is optional */ }
  const fonts = { regular: await doc.embedFont(PDFLib.StandardFonts.Helvetica), bold: await doc.embedFont(PDFLib.StandardFonts.HelveticaBold) };
  const w = writer(doc, PDFLib, fonts);
  const get = key => (sources instanceof Map ? sources.get(key) : null);

  // Front page(s)
  w.newPage();
  w.text(str(m.title) || 'P&ID symbol check', { size: 18, bold: true });
  w.text('Run ' + str(m.when), { size: 10 });
  if (str(m.checkedBy)) w.text('Checked by: ' + str(m.checkedBy), { size: 10 });
  w.gap(6);
  w.text('What this check can say', { size: 10, bold: true, gap: 0.1 });
  w.text(str(m.familyNote) || FAMILY_NOTE, { size: 10 });
  w.gap(4);
  w.text('Symbol library', { size: 10, bold: true, gap: 0.1 });
  w.text(str(lib.legend), { size: 9, gap: 0.1 });
  w.text('Imported: ' + str(lib.importedAt), { size: 9 });
  w.gap(4);
  w.text('This run', { size: 10, bold: true, gap: 0.1 });
  if (str(run.stoppedLine)) w.text(str(run.stoppedLine), { size: 10, bold: true, gap: 0.1 });
  w.text(count(run.ticked) + ' sheets ticked: ' + count(run.checked) + ' checked, ' + count(run.notChecked) + ' not checked, '
    + duration(run.seconds) + ' in all.', { size: 9, gap: 0.1 });
  for (const s of sheets) if (str(s.pageNote)) w.text(str(s.drawing) + ' rev ' + str(s.rev) + ': ' + str(s.pageNote), { size: 9, gap: 0.1 });
  w.text('These results are in this report only. Nothing from this check is saved in the register.', { size: 9 });
  w.gap(6);
  const kinds = SUMMARY_ORDER;
  // Count columns wide enough for their longest header word ("exception") at 6.5 pt.
  w.table([{ title: 'Drawing', width: 80 }, { title: 'Rev.', width: 30 }, { title: 'Pre-check', width: 55 }, { title: 'Result', width: 110 },
    ...kinds.map(k => ({ title: VERDICT_LABELS[k], width: 40 }))],
  sheets.map(s => [str(s.drawing), str(s.rev), str(s.precheckLabel), str(s.resultText),
    ...kinds.map(k => (s.status === 'checked' ? String(count(obj(s.counts)[k])) : ''))]), { size: 8, headSize: 6.5 });
  w.gap(4);
  w.text('Key', { size: 10, bold: true, gap: 0.2 });
  w.text('On each drawing, every item has a box in its verdict\'s colour, numbered to match its row in that sheet\'s table.', { size: 8.5, gap: 0.3 });
  for (const k of kinds) {
    w.room(12);
    swatchAt(w.page, PDFLib, k, MARGIN, w.y - 8, 14, 8);
    w.page.drawText(pdfSafe(VERDICT_LABELS[k] + ': ' + KEY[k]), { x: MARGIN + 20, y: w.y - 7.5, size: 8.5, font: fonts.regular, color: PDFLib.rgb(0, 0, 0) });
    w.y -= 12;
  }

  // A section per checked sheet
  for (const s of sheets) {
    if (s.status !== 'checked') continue;
    const drawingPage = withDrawings ? await loadSource(PDFLib, doc, get(str(s.key))) : null;
    w.newPage();
    w.text(str(s.drawing), { size: 16, bold: true, gap: 0.2 });
    w.text('Revision ' + str(s.rev) + (str(s.family) ? '. Family: ' + str(s.family) + '.' : ''), { size: 10, gap: 0.1 });
    w.text('Pre-check: ' + str(s.precheckLabel), { size: 10, gap: 0.1 });
    w.text(countsLine(s.counts), { size: 10, gap: 0.1 });
    w.text('Checked in ' + (isNum(s.seconds) ? s.seconds : 0) + ' s.', { size: 10, gap: 0.1 });
    if (str(s.timedOutLine)) w.text(str(s.timedOutLine), { size: 10, gap: 0.1 });
    if (str(s.pageNote)) w.text(str(s.pageNote), { size: 10, gap: 0.1 });
    w.gap(6);
    w.text(str(m.shortNote) || SHORT_NOTE, { size: 11, bold: true });
    w.gap(6);
    w.text(drawingPage ? 'The next page is the drawing, with a numbered box around each item. The numbers match the table after it.' : FALLBACK, { size: 10 });
    const rows = asArr(s.rows).filter(r => r && typeof r === 'object');
    if (drawingPage) {
      const page = doc.addPage(drawingPage);
      try { drawBoxes(page, PDFLib, fonts, rows); } catch { /* the drawing stays, with what was drawn */ }
    }
    w.newPage();
    w.text(str(s.drawing) + ' rev ' + str(s.rev) + ': results', { size: 12, bold: true });
    w.table([{ title: 'No.', width: 26 }, { title: 'Tag', width: 88 }, { title: 'Verdict', width: 86 }, { title: 'Detail', width: 315 }],
      rows.map(r => [String(count(r.no)), str(r.tag), { text: str(r.label), swatch: str(r.kind) }, str(r.detail)]));
  }

  // Footer on the A4 pages
  const all = doc.getPages();
  const foot = pdfSafe(str(m.title) || 'P&ID symbol check') + ' · ' + pdfSafe(str(m.when));
  w.pages.forEach(p => {
    const n = all.indexOf(p) + 1;
    p.drawText(foot + ' · page ' + n + ' of ' + all.length, { x: MARGIN, y: MARGIN - 18, size: 7, font: fonts.regular, color: w.grey });
  });
  return doc.save();
}

/**
 * The report's bytes. `sources` maps a sheet's key ('drawing||rev') to its
 * PDF bytes. Resolves null only when pdf-lib itself is unusable; if the
 * report cannot be saved with the drawings in it, it is made without them.
 */
export async function buildReportPdf(model, sources, PDFLib) {
  if (!PDFLib || !PDFLib.PDFDocument || typeof PDFLib.PDFDocument.create !== 'function' || !PDFLib.StandardFonts
    || typeof PDFLib.rgb !== 'function' || typeof PDFLib.degrees !== 'function') return null;
  try {
    return await render(model, sources, PDFLib, true);
  } catch {
    try { return await render(model, sources, PDFLib, false); } catch { return null; }
  }
}
