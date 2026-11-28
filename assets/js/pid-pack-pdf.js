// assets/js/pid-pack-pdf.js
// Writes the Standard Pack template, blank or filled in with a pack, as a fillable PDF. One generator for both: the command line
// (scripts/make-standard-pack-template.mjs) and the tool (Export as PDF) call it with pdf-lib. Pure: no files, no DOM; pdf-lib is passed in.
//
// The defaults printed beside each field are read from the code, so the template cannot drift from the tool. It holds no data of any company's
// standard: every worked example is fictional, and a company's own tables appear only when its pack is passed in. Every fillable field has a stable
// name (pack_name, fc_001_code, settings_recognise ...); a filled pack is read back by them. With a pack, the tables are made as long as the pack
// needs, the pack's fields are written (the same fields the editor uses: pid-pack-edit.js), and `dropped` lists the fields the form has no place
// for (what an older template held and this one does not).
import { CHECK_DEFAULTS } from './pid-symbol-check.js';
import { PIPE_MATERIAL_CODES } from './pid-core.js';
import { fieldsFromPack } from './pid-pack-edit.js';

const TEMPLATE_VERSION = '2';
/** { bytes, pages, fields, dropped }. opts: { pack } to fill it in, or { fcPages, pacRows } for a blank one of another size. */
export async function buildPackPdf(PDFLib, opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const pack = o.pack && typeof o.pack === 'object' && !Array.isArray(o.pack) && o.pack.identity && typeof o.pack.identity === 'object' ? o.pack : null;
  const fieldsIn = pack ? fieldsFromPack(pack) : {};
const { PDFDocument, StandardFonts, rgb } = PDFLib;
const FC_ROWS_PER_PAGE = 32;
const own = (x, k) => x && typeof x === 'object' && !Array.isArray(x) && Array.isArray(x[k]) ? x[k].length : 0;
const keysOf = x => (x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x) : []);
const nFc = pack ? new Set([...keysOf(pack.fc), ...keysOf(pack.fcDescriptions), ...keysOf(pack.fcMode)]).size : 0;
// A filled pack is never smaller than the blank form (people add rows by hand), and grows when the pack needs more.
const FC_PAGES = pack ? Math.max(4, Math.ceil(nFc / FC_ROWS_PER_PAGE)) : (Number.isInteger(o.fcPages) && o.fcPages > 0 ? o.fcPages : 4);
const PAC_ROWS = pack ? Math.max(30, keysOf(pack.pac).length) : (Number.isInteger(o.pacRows) && o.pacRows > 0 ? o.pacRows : 30);
const LEGEND_ROWS = Math.max(8, own(pack, 'legend')), LOG_ROWS = Math.max(10, own(pack, 'changelog'));
const lists = pack && pack.lists && typeof pack.lists === 'object' ? pack.lists : {};
const ATT_ROWS = Math.max(5, Math.ceil((Array.isArray(lists.attachments) ? lists.attachments.length : 0) / 2)), DRV_ROWS = Math.max(2, Math.ceil((Array.isArray(lists.drives) ? lists.drives.length : 0) / 3));
const VAR_ROWS = Math.max(3, Array.isArray(lists.variants) ? lists.variants.length : 0);
const A4 = [595.28, 841.89], M = 42, W = A4[0] - 2 * M;
const GREEN = rgb(0.10, 0.37, 0.22), INK = rgb(0.1, 0.1, 0.1), GREY = rgb(0.45, 0.45, 0.45), LINE = rgb(0.78, 0.78, 0.78), PALE = rgb(0.95, 0.97, 0.95), FIELD = rgb(1, 0.99, 0.92), WHITE = rgb(1, 1, 1);

const doc = await PDFDocument.create();
doc.setTitle('P&ID Standard Pack - template and guide'); doc.setCreator('P&ID Tag Register'); doc.setProducer('P&ID Tag Register');
const F = { r: await doc.embedFont(StandardFonts.Helvetica), b: await doc.embedFont(StandardFonts.HelveticaBold), i: await doc.embedFont(StandardFonts.HelveticaOblique) };
const form = doc.getForm();
let page = null, y = 0, pageNo = 0, section = '';
const names = new Set();

function newPage() {
  page = doc.addPage(A4); pageNo++; y = A4[1] - M;
  if (pageNo === 1) { y = A4[1] - 64; return; }   // the cover has no running header
  page.drawText('P&ID Standard Pack - template', { x: M, y: A4[1] - 24, size: 7.5, font: F.r, color: GREY });
  if (section) page.drawText(section, { x: A4[0] - M - F.r.widthOfTextAtSize(section, 7.5), y: A4[1] - 24, size: 7.5, font: F.r, color: GREY });
  page.drawLine({ start: { x: M, y: A4[1] - 29 }, end: { x: A4[0] - M, y: A4[1] - 29 }, thickness: 0.4, color: LINE });
  y = A4[1] - 48;
}
const need = h => { if (!page || y - h < M + 22) newPage(); };
function wrap(text, font, size, width) {
  const out = [];
  for (const p of String(text).split('\n')) {
    let line = '';
    for (const w of p.split(/\s+/).filter(Boolean)) {
      const t = line ? line + ' ' + w : w;
      if (font.widthOfTextAtSize(t, size) <= width) line = t; else { if (line) out.push(line); line = w; }
    }
    out.push(line);
  }
  return out;
}
function para(text, { size = 9, font = F.r, color = INK, width = W, x = M, gap = 4, lead = 1.32 } = {}) {
  for (const ln of wrap(text, font, size, width)) { need(size * lead); y -= size * lead; page.drawText(ln, { x, y, size, font, color }); }
  y -= gap;
}
// A section starts a page; a small label says which part of the form it belongs to.
function h1(text, partLabel = '') {
  section = text; newPage();
  page.drawText(text, { x: M, y, size: 18, font: F.b, color: GREEN });
  if (partLabel) { const w = F.b.widthOfTextAtSize(partLabel, 7.2) + 14; page.drawRectangle({ x: A4[0] - M - w, y: y - 2, width: w, height: 15, color: partLabel.startsWith('PART 1') ? GREEN : GREY }); page.drawText(partLabel, { x: A4[0] - M - w + 7, y: y + 2.5, size: 7.2, font: F.b, color: WHITE }); }
  y -= 26;
}
function h2(text) { need(40); y -= 6; page.drawText(text, { x: M, y: y - 11, size: 11, font: F.b, color: GREEN }); y -= 18; }
function note(text) { para(text, { size: 8, font: F.i, color: GREY }); }
function box(text, { fill = PALE } = {}) {
  const lines = wrap(text, F.r, 8.6, W - 16), h = lines.length * 11.6 + 10;
  need(h + 6); page.drawRectangle({ x: M, y: y - h, width: W, height: h, color: fill, borderColor: LINE, borderWidth: 0.5 });
  lines.forEach((ln, k) => page.drawText(ln, { x: M + 8, y: y - 13 - k * 11.6, size: 8.6, font: F.r, color: INK }));
  y -= h + 8;
}
function field(rawName, x, top, width, height = 13, { multiline = false, options = null, value = '' } = {}) {
  const name = rawName.replace(/\./g, '_');   // a dot would make a nested PDF field name, which clashes with a field that is also a parent
  if (names.has(name)) throw new Error('duplicate field ' + name);
  names.add(name);
  const f = options ? form.createDropdown(name) : form.createTextField(name);
  if (options) { f.addOptions(options); } else { if (multiline) f.enableMultiline(); if (value) f.setText(value); }
  f.addToPage(page, { x, y: top - height, width, height, font: F.r, borderWidth: 0.5, borderColor: GREY, backgroundColor: FIELD });
  try { f.setFontSize(options || height < 20 ? 8 : 8.5); } catch { /* default size */ }
  return f;
}
// A label with a fillable field beside it (or under it when wide).
function labelled(label, name, hint = '', { width = 300, height = 14, multiline = false, options = null } = {}) {
  const hh = multiline ? height : 14;
  need(hh + 6);
  const LW = 182;
  let ls = 8.6; while (F.b.widthOfTextAtSize(label, ls) > LW - 6 && ls > 6.5) ls -= 0.2;
  page.drawText(label, { x: M, y: y - 10, size: ls, font: F.b, color: INK });
  field(name, M + LW, y + 1, Math.min(width, W - LW), hh, { multiline, options });
  if (hint) page.drawText(hint, { x: M + LW + Math.min(width, W - LW) + 6, y: y - 9, size: 7, font: F.i, color: GREY });
  y -= hh + 4;
}
// A table. cols: [{ title, width }]; rows: arrays of cells. A cell is text, or { field, options?, multiline? } for a fillable field.
function table(cols, rows, { rowH = 14, size = 8, headFill = GREEN } = {}) {
  const total = cols.reduce((m, c) => m + c.width, 0), scale = W / total, widths = cols.map(c => c.width * scale);
  const head = () => {
    need(rowH + 8);
    page.drawRectangle({ x: M, y: y - 15, width: W, height: 15, color: headFill });
    let x = M; cols.forEach((c, k) => { page.drawText(c.title, { x: x + 4, y: y - 11, size: 7.6, font: F.b, color: WHITE, maxWidth: widths[k] - 6 }); x += widths[k]; });
    y -= 15;
  };
  head();
  for (const row of rows) {
    const cells = row.map((c, k) => (typeof c === 'string' ? wrap(c, F.r, size, widths[k] - 8) : null));
    const h = Math.max(rowH, ...cells.map(l => (l ? l.length * (size + 2.4) + 4 : 0)));
    if (y - h < M + 22) { newPage(); head(); }
    let x = M;
    row.forEach((c, k) => {
      page.drawRectangle({ x, y: y - h, width: widths[k], height: h, borderColor: LINE, borderWidth: 0.4 });
      if (typeof c === 'string') cells[k].forEach((ln, j) => page.drawText(ln, { x: x + 4, y: y - size - 3 - j * (size + 2.4), size, font: F.r, color: INK }));
      else if (c && c.field) field(c.field, x + 1, y - 1, widths[k] - 2, h - 2, { options: c.options, multiline: !!c.multiline });
      x += widths[k];
    });
    y -= h;
  }
  y -= 8;
}
const grid = (prefix, rows, cols, width) => { for (let r = 0; r < rows; r++) { need(18); let x = M; for (let c = 0; c < cols; c++) { field(`${prefix}.${r * cols + c + 1}`, x, y + 1, width / cols - 6, 14); x += width / cols; } y -= 18; } };

// ───────────────────────────────────────────────────────────── cover
newPage(); section = '';
page.drawText('P&ID Standard Pack', { x: M, y, size: 28, font: F.b, color: GREEN }); y -= 30;
page.drawText('Template and guide', { x: M, y, size: 14, font: F.r, color: INK }); y -= 26;
para('A Standard Pack is the document that says what "the standard" means for the P&ID checks: what each tag code means, which legend the symbols are checked against, and how strict the checks are. The tool reads a filled-in pack, applies it, and stamps every drawing and report with the pack and legend it was checked against, so a drawing stays correct to the standard it was produced under when the standard later changes.', { size: 10 });
para('Nothing in this template is any company\'s standard. Every worked example is fictional and the code tables are blank. Fill it in with your own standard, save it as your own file, and keep it as private as the standard it describes.', { size: 10 });
h2('How to use it');
[
  '1. Look at the worked example on the next page: a made-up drawing with numbered pointers to the part of this form that governs each thing on it.',
  '2. Fill in Part 1 (sections 1 to 6). It is all the tool needs. A long list of function codes is quicker to supply as a spreadsheet than to type here (appendix A).',
  '3. Part 2 (sections 7 and 8) is optional. Every box there already has a default, printed beside it; fill one only where your drawings really differ, and say why.',
  '4. Save the filled file and import it in the tool. Do not rename the fields: the tool reads them by name.',
].forEach(t => para(t, { size: 9.4, gap: 4 }));
h2('Contents');
[['', 'The worked example'], ['', 'PART 1 - fill these in'], ['1', 'Pack identity and stamp'], ['2', 'Process-area codes'], ['3', 'Function codes'], ['4', 'Pipe material codes'], ['5', 'Symbol legend sheets'], ['6', 'Sign-off and change log'],
  ['', 'PART 2 - only if you need to'], ['7', 'Symbol lists: attachments, drives, variants'], ['8', 'Check settings'], ['A', 'Field names, bulk files, and what this form does not ask']]
  .forEach(([n, t]) => { const head = !n && /^PART/.test(t); page.drawText((n ? n + '   ' : '') + t, { x: M + (n ? 16 : 0), y: y - 10, size: 9.5, font: head ? F.b : F.r, color: head ? GREEN : INK }); y -= 15; });
note('Template version ' + TEMPLATE_VERSION + '. The defaults shown are read from the tool\'s own settings when this template is generated. Version 2 asks only for what the tool reads or stamps; a pack filled in on version 1 still imports.');

// ───────────────────────────────────────────────────────────── the worked example: a fictional drawing with numbered pointers
h1('A worked example');
para('A made-up sheet from a made-up company (Northfield Water). The numbered pointers say which part of this form governs each thing you see. None of it is any real standard.', { size: 9 });
{
  const bx = M, bw = W, bh = 280, by = y - bh - 4, pipeY = by + 118;
  const stroke = (a, b, t = 0.9, c = INK) => page.drawLine({ start: { x: a[0], y: a[1] }, end: { x: b[0], y: b[1] }, thickness: t, color: c });
  const txt = (s, x, yy, size = 6.8, font = F.r, color = INK) => page.drawText(s, { x, y: yy, size, font, color });
  page.drawRectangle({ x: bx, y: by, width: bw, height: bh, borderColor: INK, borderWidth: 1.2, color: rgb(1, 1, 1) });
  const bowtie = (cx, cy) => { stroke([cx - 12, cy + 8], [cx, cy]); stroke([cx - 12, cy - 8], [cx, cy]); stroke([cx - 12, cy + 8], [cx - 12, cy - 8]); stroke([cx + 12, cy + 8], [cx, cy]); stroke([cx + 12, cy - 8], [cx, cy]); stroke([cx + 12, cy + 8], [cx + 12, cy - 8]); };
  // the process line, left to right, with a flow arrow
  stroke([bx + 16, pipeY], [bx + 470, pipeY], 1.3);
  stroke([bx + 462, pipeY + 4], [bx + 470, pipeY], 1.3); stroke([bx + 462, pipeY - 4], [bx + 470, pipeY], 1.3);
  // an isolating valve with its tag
  bowtie(bx + 76, pipeY); txt('21-V-1001', bx + 50, pipeY + 17);
  // a pipe line number
  txt('2-PE-1500', bx + 104, pipeY + 4, 6.4);
  // a pump with its motor
  page.drawCircle({ x: bx + 190, y: pipeY, size: 16, borderColor: INK, borderWidth: 0.9 }); stroke([bx + 180, pipeY + 10], [bx + 202, pipeY], 0.8); stroke([bx + 180, pipeY - 10], [bx + 202, pipeY], 0.8);
  stroke([bx + 190, pipeY + 16], [bx + 190, pipeY + 24]); page.drawCircle({ x: bx + 190, y: pipeY + 33, size: 9, borderColor: INK, borderWidth: 0.9 }); txt('M', bx + 187.4, pipeY + 30.4, 7, F.b);
  txt('21-P-1001A', bx + 164, pipeY - 30);
  // an instrument bubble on a tee
  stroke([bx + 262, pipeY], [bx + 262, pipeY + 36], 0.6); page.drawCircle({ x: bx + 262, y: pipeY + 49, size: 12, borderColor: INK, borderWidth: 0.9 }); stroke([bx + 250, pipeY + 49], [bx + 274, pipeY + 49], 0.6);
  txt('PT', bx + 257, pipeY + 52, 6.2, F.b); txt('1002', bx + 255.5, pipeY + 42.6, 5.4);
  txt('21-PT-1002', bx + 278, pipeY + 47);
  // a check valve
  stroke([bx + 322, pipeY + 8], [bx + 340, pipeY]); stroke([bx + 322, pipeY - 8], [bx + 340, pipeY]); stroke([bx + 322, pipeY + 8], [bx + 322, pipeY - 8]); stroke([bx + 340, pipeY + 8], [bx + 340, pipeY - 8]);
  txt('21-V-1002', bx + 308, pipeY + 17);
  // a valve with a motor on it
  bowtie(bx + 404, pipeY); stroke([bx + 404, pipeY], [bx + 404, pipeY + 20]); page.drawCircle({ x: bx + 404, y: pipeY + 29, size: 9, borderColor: INK, borderWidth: 0.9 }); txt('M', bx + 401.4, pipeY + 26.4, 7, F.b);
  txt('21-V-1003', bx + 378, pipeY - 24);
  // the legend box (top left)
  page.drawRectangle({ x: bx + 14, y: by + bh - 74, width: 132, height: 60, borderColor: INK, borderWidth: 0.8 });
  txt('LEGEND  -  SHEET 1  REV C02', bx + 20, by + bh - 26, 6.2, F.b); bowtie(bx + 36, by + bh - 50); txt('VALVE', bx + 56, by + bh - 52, 6.2);
  txt('(example symbols)', bx + 20, by + bh - 68, 5.6, F.i, GREY);
  // the title block (bottom right)
  page.drawRectangle({ x: bx + bw - 214, y: by + 8, width: 206, height: 64, borderColor: INK, borderWidth: 0.8 });
  [[bx + bw - 214, by + 56], [bx + bw - 214, by + 40], [bx + bw - 214, by + 24]].forEach(([x0, y0]) => stroke([x0, y0], [x0 + 206, y0], 0.4));
  txt('NORTHFIELD WATER   INLET WORKS P&ID', bx + bw - 208, by + 62, 6.2, F.b);
  txt('DRAWING NO  NFW-ABCD-01-00-D-P-4001      REV  C02', bx + bw - 208, by + 46, 5.8);
  txt('STANDARD  NFW-STD-014  REV 4  12/03/2021', bx + bw - 208, by + 30, 5.8);
  txt('A FICTIONAL EXAMPLE', bx + bw - 208, by + 14, 5.8, F.i, GREY);
  // the pointers
  const pointer = (n, cx, cy, tx, ty) => { stroke([cx, cy], [tx, ty], 0.7, GREEN); page.drawCircle({ x: cx, y: cy, size: 7.2, color: GREEN }); const s = String(n); txt(s, cx - F.b.widthOfTextAtSize(s, 7.6) / 2, cy - 2.6, 7.6, F.b, WHITE); };
  pointer(1, bx + 40, pipeY + 58, bx + 54, pipeY + 21);
  pointer(2, bx + 200, pipeY - 56, bx + 200, pipeY - 33);
  pointer(3, bx + 106, pipeY + 58, bx + 88, pipeY + 21);
  pointer(4, bx + 302, pipeY + 86, bx + 273, pipeY + 58);
  pointer(5, bx + 122, pipeY - 38, bx + 118, pipeY + 2);
  pointer(6, bx + 452, pipeY + 70, bx + 411, pipeY + 33);
  pointer(7, bx + 176, by + bh - 36, bx + 146, by + bh - 40);
  pointer(8, bx + bw - 240, by + 64, bx + bw - 215, by + 33);
  pointer(9, bx + 366, pipeY + 40, bx + 341, pipeY + 5);
  y = by - 14;
}
[
  ['1', 'The process area, the first part of a tag (21). Listed in section 2, where each code is given its name.'],
  ['2', 'The function code, the letters (P = a pump). Section 3 gives each code a category (valve, equipment, instrument ...) and says whether the symbol check applies to it.'],
  ['3', 'The number and its suffix (1001, 1001A). Read by a fixed rule; nothing to fill in.'],
  ['4', 'A tag inside a circle is an instrument bubble. A function code with the category "instrument" is checked for a bubble, not for a valve body (section 3).'],
  ['5', 'A single digit then a material code (2-PE-1500) is a pipe line number, not an asset tag. The material codes are in section 4.'],
  ['6', 'A motor drawn on a valve is part of that valve, not a symbol of its own. The names treated this way are in section 7.'],
  ['7', 'The legend the symbols are checked against: which sheets and which revision of each (section 5). They become part of the stamp.'],
  ['8', 'The standard the pack implements: its number, revision and date (section 1). These make the stamp printed on every report.'],
  ['9', 'How strict the check is: how closely a drawn symbol has to match its legend symbol, and so on (section 8). The defaults are fine for most drawings.'],
].forEach(([n, t]) => { need(24); const ls = wrap(t, F.r, 8.6, W - 24); page.drawCircle({ x: M + 6, y: y - 5, size: 6.4, color: GREEN }); page.drawText(n, { x: M + 3.5, y: y - 7.6, size: 7.4, font: F.b, color: WHITE }); ls.forEach((ln, k) => { page.drawText(ln, { x: M + 20, y: y - 8 - k * 11, size: 8.6, font: F.r, color: INK }); }); y -= Math.max(16, ls.length * 11 + 5); });

// ───────────────────────────────────────────────────────────── 1 identity
h1('1  Pack identity and stamp', 'PART 1 - FILL IN');
para('These fields make the stamp. Fill the name, the revision and the standard\'s issue date: a pack without them cannot be imported.', { size: 9 });
labelled('Pack name', 'pack.name', '', { width: 330 });
labelled('Pack id (short, no spaces)', 'pack.id', '', { width: 200 });
labelled('Pack revision', 'pack.revision', '', { width: 120 });
labelled('Issuing organisation', 'pack.issuer', '', { width: 330 });
labelled('Standard document title', 'pack.standard.title', '', { width: 330 });
labelled('Standard document number', 'pack.standard.number', '', { width: 200 });
labelled('Standard revision', 'pack.standard.revision', '', { width: 120 });
labelled('Standard issue date', 'pack.standard.date', 'dd/mm/yyyy', { width: 120 });
labelled('Status of the standard', 'pack.standard.status', '', { width: 160, options: ['In effect', 'Under review, in effect', 'Superseded', 'Draft'] });
labelled('Pack owner and contact', 'pack.owner', '', { width: 330 });
labelled('Notes', 'pack.notes', '', { width: 330, height: 52, multiline: true });
h2('Worked example (fictional)');
box('Pack name: Northfield Water P&ID Pack   |   Pack id: NFW-PID   |   Pack revision: 2\nStandard: "Asset Identification Requirements", number NFW-STD-014, revision 4, 12/03/2021\n\nStamp printed on reports: Checked against: Northfield Water P&ID Pack 2 (NFW-STD-014 rev 4, 12/03/2021)');
note('Two revisions are kept apart on purpose: the pack revision (changes when a table or setting here changes) and the standard revision (changes when the issuing standard changes). A drawing is stamped with both.');

// ───────────────────────────────────────────────────────────── 2 PAC
h1('2  Process-area codes', 'PART 1 - FILL IN');
para('The code before the function code names an area of the works (pointer 1). The tool shows its description beside each tag. List your own; a code not listed is shown by its number.', { size: 9 });
const pacRows = [];
for (let k = 1; k <= PAC_ROWS; k++) { const p = String(k).padStart(3, '0'); pacRows.push([p, { field: `pac.${p}.code` }, { field: `pac.${p}.desc` }, { field: `pac.${p}.note` }]); }
table([{ title: 'Row', width: 34 }, { title: 'Code', width: 70 }, { title: 'Description', width: 260 }, { title: 'Note', width: 180 }], pacRows);
note('Example (fictional): code 21 = Inlet Works. More rows than fit here: use the bulk file in appendix A.');

// ───────────────────────────────────────────────────────────── 3 FC
h1('3  Function codes', 'PART 1 - FILL IN');
para('One row per function code in your standard (pointer 2). The category decides how a tag is classed and how the symbol check treats it; the description is what the register shows.', { size: 9 });
table([{ title: 'Category', width: 85 }, { title: 'Meaning', width: 460 }], [
  ['instrument', 'Drawn as a tag bubble round its tag; the symbol check looks for a bubble rather than a body (pointer 4).'],
  ['valve', 'A valve or valve-like item. Checked against legend symbols that carry the same tag identifier.'],
  ['equipment', 'Plant and machines. Checked against legend symbols that carry the same tag identifier.'],
  ['electrical', 'Electrical items. Grouped for the register; checked the same way as equipment.'],
  ['other', 'Anything not listed. Kept as a tag with the code as its description; never lost.'],
  ['none', 'A description only: the code is not given a category. The tool reads it as other, so nothing changes in how a tag is classed.'],
]);
table([{ title: 'Check', width: 85 }, { title: 'Meaning', width: 460 }], [
  ['auto', 'Default. The tool decides: a family whose legend symbols are mostly drawn to suit (tanks, conveyors) is not judged, because every drawing would read "needs a look".'],
  ['check', 'Always check this code against the legend, even when most of its symbols are drawn to suit.'],
  ['skip', 'Never check this code. A reason is required and is shown in the report.'],
]);
const fcRows = [];
for (let k = 1; k <= FC_PAGES * FC_ROWS_PER_PAGE; k++) {
  const p = String(k).padStart(3, '0');
  fcRows.push([p, { field: `fc.${p}.code` }, { field: `fc.${p}.desc` }, { field: `fc.${p}.cat`, options: ['', 'instrument', 'valve', 'equipment', 'electrical', 'other', 'none'] }, { field: `fc.${p}.mode`, options: ['', 'auto', 'check', 'skip'] }, { field: `fc.${p}.note` }]);
}
h2('Function-code table');
table([{ title: 'Row', width: 28 }, { title: 'Code', width: 46 }, { title: 'Description', width: 190 }, { title: 'Category', width: 74 }, { title: 'Check', width: 52 }, { title: 'Note / reason if skipped', width: 155 }], fcRows);
note('Example row (fictional): code ZZ | Zone Gate Actuator | valve | auto. A standard with many codes is quicker to supply as a spreadsheet: appendix A.');

// ───────────────────────────────────────────────────────────── 4 materials
h1('4  Pipe material codes', 'PART 1 - FILL IN');
para('A single-digit process area followed by one of these material codes reads as a pipe line number (pointer 5), so it goes to review for a person to confirm instead of being registered as an asset tag.', { size: 9 });
box('Default list: ' + PIPE_MATERIAL_CODES.join(', '));
labelled('Your material codes (comma separated)', 'tag.materials', '', { width: 330, height: 40, multiline: true });
note('The default list is generic material abbreviations, not any standard\'s data. Leave the box blank to keep it, or list the materials your drawings really use in line numbers (the list you give replaces the default).');
h2('Worked example (fictional)');
box('Drawing text "21 - ZZ 1234 A" is repaired to 21-ZZ-1234A: process area 21, function code ZZ, number 1234, suffix A, then classed by the table in section 3.\nDrawing text "2-PE-1500": a single digit then a material code reads as a pipe line number, so it goes to review.');

// ───────────────────────────────────────────────────────────── 5 legend
h1('5  Symbol legend sheets', 'PART 1 - FILL IN');
para('The symbol check compares every drawn shape with a legend (pointer 7). The legend is imported from its own PDF sheets in the tool; this table says which sheets and revisions this pack is checked against. They become part of the stamp.', { size: 9 });
table([{ title: 'Row', width: 30 }, { title: 'Sheet number', width: 130 }, { title: 'Revision', width: 70 }, { title: 'Date', width: 80 }, { title: 'File or document reference', width: 235 }],
  Array.from({ length: LEGEND_ROWS }, (_, k) => [String(k + 1), { field: `legend.${k + 1}.sheet` }, { field: `legend.${k + 1}.rev` }, { field: `legend.${k + 1}.date` }, { field: `legend.${k + 1}.ref` }]));
note('Example (fictional): sheet 1 | C02 | 17/09/2026 | Northfield legend sheets, issue C. When the legend changes, import the new sheets and issue a new pack revision.');

// ───────────────────────────────────────────────────────────── 6 sign-off
h1('6  Sign-off and change log', 'PART 1 - FILL IN');
para('Who approved this pack and what changed. A change to any table or setting needs a line in the log, with the reason.', { size: 9 });
labelled('Prepared by', 'signoff.prepared.by', '', { width: 220 }); labelled('Date', 'signoff.prepared.date', 'dd/mm/yyyy', { width: 120 });
labelled('Checked by', 'signoff.checked.by', '', { width: 220 }); labelled('Date', 'signoff.checked.date', 'dd/mm/yyyy', { width: 120 });
labelled('Approved by', 'signoff.approved.by', '', { width: 220 }); labelled('Date', 'signoff.approved.date', 'dd/mm/yyyy', { width: 120 });
h2('Change log');
table([{ title: 'Pack rev', width: 55 }, { title: 'Date', width: 70 }, { title: 'What changed', width: 230 }, { title: 'Why', width: 150 }, { title: 'By', width: 70 }],
  Array.from({ length: LOG_ROWS }, (_, k) => [{ field: `changelog.${k + 1}.rev` }, { field: `changelog.${k + 1}.date` }, { field: `changelog.${k + 1}.what` }, { field: `changelog.${k + 1}.why` }, { field: `changelog.${k + 1}.by` }]), { rowH: 18 });

// ───────────────────────────────────────────────────────────── 7 symbol lists
h1('7  Symbol lists', 'PART 2 - ONLY IF YOU NEED TO');
para('Three short lists name legend symbols that need special handling. Each already has a default; the names you add are ADDED to it. Leave them blank unless a symbol on your drawings is being flagged wrongly.', { size: 9 });
h2('Attachments: symbols that may ride on a body');
para('Named legend symbols that may stand on a body and are then part of it, never size-judged. Found alone, they stay symbols of their own.', { size: 9 });
box('Default list:\n' + CHECK_DEFAULTS.attachments.join(';  '));
grid('attachments', ATT_ROWS, 2, W);
h2('Drives (pointer 6)');
para('A drive is treated as part of the body it is drawn on: a valve with its motor, a pump with its motor. A drive standing apart from its body joins it only when it is almost all of its own neighbouring shape.', { size: 9 });
box('Default list: ' + CHECK_DEFAULTS.drives.join(', '));
grid('drives', DRV_ROWS, 3, W);
h2('Variants: one legend entry holding alternative drawings');
para('A legend entry that draws two or more alternatives side by side (for example a pump with a variable-speed motor beside the same pump with a plain one) is split into one symbol per drawing. Only named entries are split.', { size: 9 });
box('Default list: ' + CHECK_DEFAULTS.variants.join(', '));
for (let r = 0; r < VAR_ROWS; r++) { need(18); field(`variants.${r + 1}`, M, y + 1, W, 14); y -= 18; }

// ───────────────────────────────────────────────────────────── 8 check settings
h1('8  Check settings', 'PART 2 - ONLY IF YOU NEED TO');
para('How strict the symbol and shape checks are (pointer 9). They were tuned on real drawings, and the defaults work for those. Leave a value blank to keep the default. Change one only with a reason, and re-check at least five of your own drawings before relying on it.', { size: 9 });
const S = [
  ['settings.recognise', 'Recognition score', 'How well a legend symbol must match the ink to count as found (0 to 1). Higher is stricter.', CHECK_DEFAULTS.recognise],
  ['settings.shapeExplained', 'Share explained', 'A shape is standard when its symbols explain this share of its ink. Lower tolerates more extra linework.', CHECK_DEFAULTS.shapeExplained],
  ['settings.minScale', 'Smallest scale (tag check)', 'Symbols are looked for from this share of their legend size.', CHECK_DEFAULTS.minScale],
  ['settings.maxScale', 'Largest scale (tag check)', '... to this share of it.', CHECK_DEFAULTS.maxScale],
  ['settings.radius', 'Search radius', 'Points from a tag\'s centre to the centre of the symbol it names.', CHECK_DEFAULTS.radius],
  ['settings.inkTol', 'Ink tolerance', 'Points: ink this close to the legend symbol counts as a hit.', CHECK_DEFAULTS.inkTol],
  ['settings.plainBack', 'Plain symbol cover', 'A simple symbol found alone must explain this share of the ink in its box.', CHECK_DEFAULTS.plainBack],
  ['settings.shareInk', 'Shared ink', 'Two hits sharing this much ink are one physical symbol.', CHECK_DEFAULTS.shareInk],
  ['settings.minSize', 'Smallest symbol', 'Points: the smallest symbol side the shape check looks at.', CHECK_DEFAULTS.minSize],
  ['settings.maxSize', 'Largest symbol', 'Points: the largest symbol side; bigger drawn shapes are pipework or structures.', CHECK_DEFAULTS.maxSize],
  ['settings.sweepStep', 'Sweep step', 'Points between the centres the symbol sweep searches round.', CHECK_DEFAULTS.sweepStep],
  ['settings.inkGrey', 'Ink grey', 'Grey darker than this is ink.', CHECK_DEFAULTS.inkGrey],
  ['settings.timeLimitMs', 'Time limit', 'Milliseconds: a check still running after this stops and says so.', CHECK_DEFAULTS.timeLimitMs],
];
table([{ title: 'Setting', width: 105 }, { title: 'What it does', width: 270 }, { title: 'Default', width: 55 }, { title: 'Your value', width: 65 }, { title: 'Why changed', width: 120 }],
  S.map(([key, label, what, def]) => [label, what, String(def), { field: key }, { field: key + '.why' }]), { rowH: 24, size: 7.6 });
note('Every value above is a number; the tool ignores anything else. The other thresholds the checks use are fixed in the tool today and are not asked for here.');

// ───────────────────────────────────────────────────────────── A appendix
h1('A  Field names, bulk files, and what this form does not ask');
para('A filled pack is read back by field name. Do not rename or delete fields; leave unused ones blank.', { size: 9 });
table([{ title: 'Section', width: 95 }, { title: 'Field name pattern', width: 215 }, { title: 'Example', width: 235 }], [
  ['1 Identity', 'pack_<item>', 'pack_name, pack_standard_number'],
  ['2 Process areas', 'pac_<row>_code | desc | note', 'pac_001_code'],
  ['3 Function codes', 'fc_<row>_code | desc | cat | mode | note', 'fc_012_cat'],
  ['4 Materials', 'tag_materials', 'tag_materials'],
  ['5 Legend sheets', 'legend_<row>_sheet | rev | date | ref', 'legend_1_rev'],
  ['6 Sign-off', 'signoff_<role>_by | date, changelog_<row>_<item>', 'changelog_3_what'],
  ['7 Symbol lists', 'attachments_<n>, drives_<n>, variants_<n>', 'drives_1'],
  ['8 Check settings', 'settings_<name> and settings_<name>_why', 'settings_recognise'],
]);
h2('Bulk file for process areas and function codes');
para('A comma-separated file with a header row, one row per code. Fields containing a comma or a line break must be quoted: read it with a reader that understands quotes, never by splitting each line on commas.', { size: 9 });
box('Process areas:   code,description,note\nFunction codes:   code,description,category,check,note\n\ncategory is one of: instrument, valve, equipment, electrical, other, none.   check is one of: auto, check, skip (a note giving the reason is required for skip).');
h2('What this form does not ask');
para('The tool reads some things by fixed rules today, so there is nothing to fill in for them: how a drawing number and a revision are found in a title block, the exact layout of a tag, how the frame of a sheet is found, how a sheet\'s text is judged readable, and the thresholds the checks use beyond section 8. When the tool can read any of these from a pack they will appear here as a new template version, and a pack filled in on an older version stays valid.', { size: 9 });
h2('Before you rely on a pack');
[
  'Import it, then check at least five of your own drawings, including one you know well. Read every "not to standard" flag by eye before acting on it.',
  'Keep the filled pack, the standard it implements and the legend sheets together; the stamp refers to all three.',
  'Treat the filled pack as the standard\'s data: it is as confidential as the standard.',
].forEach(t => para('- ' + t, { size: 9, gap: 3 }));

// footers
const pages = doc.getPages();
pages.forEach((p, k) => { const t = `Page ${k + 1} of ${pages.length}`; p.drawText(t, { x: A4[0] - M - F.r.widthOfTextAtSize(t, 7.5), y: 22, size: 7.5, font: F.r, color: GREY }); p.drawText('Fill in the yellow fields. Do not rename fields.', { x: M, y: 22, size: 7.5, font: F.i, color: GREY }); });
// A filled pack: write every field the form holds, and report the ones it does not (what an older template held that this one does not).
const dropped = [];
for (const [name, value] of Object.entries(fieldsIn)) {
  let f = null; try { f = form.getField(name); } catch { f = null; }
  if (!f) { dropped.push(name); continue; }
  try {
    if (typeof f.getOptions === 'function') { if (!f.getOptions().includes(value)) f.addOptions([value]); f.select(value); }
    else if (typeof f.setText === 'function') f.setText(value);
  } catch { dropped.push(name); }
}
form.updateFieldAppearances(F.r);
const bytes = await doc.save();
return { bytes, pages: pages.length, fields: names.size, dropped };
}
