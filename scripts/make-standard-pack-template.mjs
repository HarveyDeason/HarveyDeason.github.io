#!/usr/bin/env node
// Makes the P&ID Standard Pack template: a fillable PDF that holds everything the checks treat as "the standard", so another company can
// fill in its own information. The defaults printed beside each field are read from the code, so the template cannot drift from the tool.
//
//   node scripts/make-standard-pack-template.mjs [out.pdf] [--fc-pages N] [--pac-rows N]
//
// It holds no data of any company's standard: every worked example is fictional, and the function-code and process-area tables are
// blank. (A company's own tables are its confidential reference data; they go in the pack it fills in, which stays a private file.)
// Every fillable field has a stable name (pack_name, fc_001_code, settings_recognise ...): do not rename them, a filled pack is read back by them.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadVendoredUmd } from './pdfjs-node.mjs';
import { CHECK_DEFAULTS, SIZE_TOL, JUDGE_BAND, AMBER_ALIKE, AMBER_EXPLAINED, GREEN_SWITCH, HEAVY_PIPE, HEAVY_MIN, PALE_MIN, PALE_STEP, DRIVE_SHARE, SCALE_SYMBOLS_MIN, LETTER_ROOM } from '../assets/js/pid-symbol-check.js';
import { PIPE_MATERIAL_CODES } from '../assets/js/pid-core.js';
import { PRINTED_MIN_PATHS, SCAN_COVER } from '../assets/js/pid-precheck.js';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? Number(argv[i + 1]) : d; };
const OUT = argv.find(a => a.endsWith('.pdf')) || 'P&ID-Standard-Pack-Template.pdf';
const FC_PAGES = flag('fc-pages', 4), PAC_ROWS = flag('pac-rows', 30), FC_ROWS_PER_PAGE = 32;
const PDFLib = loadVendoredUmd('pdf-lib.min.js');
const { PDFDocument, StandardFonts, rgb } = PDFLib;
const A4 = [595.28, 841.89], M = 42, W = A4[0] - 2 * M;
const GREEN = rgb(0.10, 0.37, 0.22), INK = rgb(0.1, 0.1, 0.1), GREY = rgb(0.45, 0.45, 0.45), LINE = rgb(0.78, 0.78, 0.78), PALE = rgb(0.95, 0.97, 0.95), FIELD = rgb(1, 0.99, 0.92);
const TEMPLATE_VERSION = '1';

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
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const w of para.split(/\s+/).filter(Boolean)) {
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
function h1(text) { section = text; newPage(); page.drawText(text, { x: M, y, size: 18, font: F.b, color: GREEN }); y -= 26; }
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
// A table. cols: [{ title, width, key? }]; rows: arrays of cells. A cell is text, or { field, options?, multiline? } for a fillable field.
function table(cols, rows, { rowH = 14, size = 8, headFill = GREEN } = {}) {
  const total = cols.reduce((m, c) => m + c.width, 0), scale = W / total, widths = cols.map(c => c.width * scale);
  const head = () => {
    need(rowH + 8);
    page.drawRectangle({ x: M, y: y - 15, width: W, height: 15, color: headFill });
    let x = M; cols.forEach((c, k) => { page.drawText(c.title, { x: x + 4, y: y - 11, size: 7.6, font: F.b, color: rgb(1, 1, 1), maxWidth: widths[k] - 6 }); x += widths[k]; });
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
const num = (v) => (Array.isArray(v) ? v.join(' to ') : String(v));

// ───────────────────────────────────────────────────────────── cover
newPage(); section = '';
page.drawText('P&ID Standard Pack', { x: M, y, size: 28, font: F.b, color: GREEN }); y -= 30;
page.drawText('Template and guide', { x: M, y, size: 14, font: F.r, color: INK }); y -= 26;
para('A Standard Pack is the single document that says what "the standard" means for the P&ID checks: how a drawing is named, how a tag is written, what each function code means, which legend the symbols are checked against, and how strict the checks are. The tool reads a filled-in pack, applies it, and stamps every drawing and every report with the pack and legend it was checked against.', { size: 10 });
para('Nothing in this template is any company\'s standard. Every worked example is fictional, and the function-code and process-area tables are blank. Fill it in with your own standard, save it as your own file, and keep it as private as the standard it describes.', { size: 10 });
h2('How to use it');
[
  '1. Identify the pack (section 1). Give it a name, an issuer, the standard\'s own document number and revision, and an issue date. These make the stamp.',
  '2. Describe how drawings are identified (section 2) and how a tag is written (section 3). The defaults printed beside each field are what the tool does today; type only where your standard differs.',
  '3. List your process-area codes and function codes (sections 4 and 5). Each function code carries a category and says whether the symbol check applies to it.',
  '4. Name the symbol legend the pack is checked against, and how its operators, attachments, drives and variants are treated (section 6).',
  '5. Review the check settings (section 7) and the sheet pre-check settings (section 8). Leave a value blank to keep the default; every change needs a reason in the change log (section 10).',
  '6. Sign off (section 10) and import the saved file into the tool. Do not rename the fields: the tool reads them by name.',
].forEach(t => para(t, { size: 9.2, gap: 3 }));
h2('What the stamp says');
box('Checked against: <pack name> <pack revision> (<standard document number>, <issue date>)  |  Legend: <legend sheet numbers and revisions>  |  Checked on <date> by <tool build>\n\nThe stamp is printed on the front page of every report and stored against the drawing in the register. A drawing keeps the stamp it was checked under. When a standard changes, a drawing checked under the earlier revision is still correct to it: it shows the earlier stamp, and the register can list which drawings were checked under which revision.');
h2('Contents');
[['1', 'Pack identity and stamp'], ['2', 'Drawing identification and revisions'], ['3', 'Tag format'], ['4', 'Process-area codes'], ['5', 'Function codes'], ['6', 'Symbol legend and symbol rules'],
  ['7', 'Check settings'], ['8', 'Sheet pre-check settings'], ['9', 'How the register records the stamp'], ['10', 'Sign-off and change log'], ['A', 'Field names and bulk files']]
  .forEach(([n, t]) => { page.drawText(n + '   ' + t, { x: M + 8, y: y - 10, size: 9.5, font: F.r, color: INK }); y -= 15; });
note('Template version ' + TEMPLATE_VERSION + '. The defaults shown are read from the tool\'s own settings when this template is generated.');

// ───────────────────────────────────────────────────────────── 1 identity
h1('1  Pack identity and stamp');
para('These fields make the stamp. Fill every one; a pack with an empty name, revision or issue date cannot be imported.', { size: 9 });
labelled('Pack name', 'pack.name', '', { width: 330 });
labelled('Pack id (short, no spaces)', 'pack.id', '', { width: 200 });
labelled('Pack revision', 'pack.revision', '', { width: 120 });
labelled('Issuing organisation', 'pack.issuer', '', { width: 330 });
labelled('Standard document title', 'pack.standard.title', '', { width: 330 });
labelled('Standard document number', 'pack.standard.number', '', { width: 200 });
labelled('Standard revision', 'pack.standard.revision', '', { width: 120 });
labelled('Standard issue date', 'pack.standard.date', 'dd/mm/yyyy', { width: 120 });
labelled('Standard custodian', 'pack.standard.custodian', '', { width: 330 });
labelled('Status of the standard', 'pack.standard.status', '', { width: 160, options: ['In effect', 'Under review, in effect', 'Superseded', 'Draft'] });
labelled('Pack supersedes (pack id + rev)', 'pack.supersedes', '', { width: 330 });
labelled('Applies to (sites, projects)', 'pack.applies', '', { width: 330, height: 40, multiline: true });
labelled('Pack owner and contact', 'pack.owner', '', { width: 330 });
labelled('Notes', 'pack.notes', '', { width: 330, height: 52, multiline: true });
h2('Worked example (fictional)');
box('Pack name: Northfield Water P&ID Pack   |   Pack id: NFW-PID   |   Pack revision: 2\nStandard: "Asset Identification Requirements", number NFW-STD-014, revision 4, 12/03/2021, custodian: Asset Data Team\n\nStamp printed on reports: Checked against: Northfield Water P&ID Pack 2 (NFW-STD-014 rev 4, 12/03/2021)');
note('Two revisions are kept apart on purpose: the pack revision (changes when settings or tables change) and the standard revision (changes when the issuing standard changes). A drawing is stamped with both.');

// ───────────────────────────────────────────────────────────── 2 drawing identification
h1('2  Drawing identification and revisions');
para('How the tool finds a drawing\'s number in a title block, names a drawing, and decides which revision a drawing is.', { size: 9 });
h2('Drawing number');
const dn = String(/\b[A-Z0-9]{2,8}-[A-Z0-9]{2,6}-[A-Z0-9]{2}-[A-Z0-9]{2}-[A-Z0-9]-[A-Z0-9]-\d{3,5}\b/.source);
table([{ title: 'Item', width: 120 }, { title: 'Tool default today', width: 235 }, { title: 'Your standard', width: 190 }], [
  ['Number layout', 'Seven parts joined by hyphens: project - originator - site/zone - level - type - role - sequence', { field: 'drawingno.layout', multiline: true }],
  ['Pattern (regular expression)', dn, { field: 'drawingno.pattern', multiline: true }],
  ['Worked example (fictional)', 'ABCD-NFW-01-00-D-P-4001', { field: 'drawingno.example' }],
  ['File name for the archived copy', '<drawing>_<revision>.pdf  (an old <drawing>.pdf is also accepted)', { field: 'drawingno.filename' }],
  ['Where the number is read from', 'The title block, found by the number pattern; one page of a multi-page file is one drawing', { field: 'drawingno.where', multiline: true }],
], { rowH: 30 });
table([{ title: 'Part', width: 30 }, { title: 'Meaning in your standard', width: 200 }, { title: 'Allowed characters / length', width: 130 }, { title: 'Example (fictional)', width: 100 }],
  Array.from({ length: 8 }, (_, k) => [String(k + 1), { field: `drawingno.part.${k + 1}.meaning` }, { field: `drawingno.part.${k + 1}.allowed` }, { field: `drawingno.part.${k + 1}.example` }]));
h2('Revision');
table([{ title: 'Item', width: 120 }, { title: 'Tool default today', width: 235 }, { title: 'Your standard', width: 190 }], [
  ['Revision token', 'C followed by 1-2 digits (contract issue) or P followed by 1-2 digits (preliminary); otherwise a letter with up to two digits after "REV"', { field: 'revision.token', multiline: true }],
  ['Where it is read', 'After NTS, after STATUS, after REV, or at the start of a revision row whose description is one of the words below', { field: 'revision.where', multiline: true }],
  ['Which row wins', 'The highest: any C revision beats any P revision; within a kind, the higher number', { field: 'revision.rule', multiline: true }],
  ['Revision description words', 'APPROVED, ISSUED, SUITABLE, TAGGING, UPDATED, REVISED, PRELIMINARY, CONSTRUCTION, FIRST ISSUE, FOR <any purpose>', { field: 'revision.words', multiline: true }],
  ['Date format', 'UK day/month/year, month names as JAN to DEC', { field: 'revision.date' }],
  ['Drawing family (project name)', 'Free text recorded against each drawing in the register', { field: 'revision.family' }],
], { rowH: 30 });
note('A drawing whose revision cannot be read is recorded with no revision and flagged, never given a guessed one.');

// ───────────────────────────────────────────────────────────── 3 tag format
h1('3  Tag format');
para('How a tag is written on a drawing and how the tool recognises it. The tool reads tag text from the drawing, repairs predictable breakages, then matches the pattern.', { size: 9 });
box('Structure today:   <process area>-<function code>-<number><suffix>      for example  21-ZZ-1234A  (fictional)\n\nprocess area: 1 or 2 digits    function code: 1-6 letters (looser reading: 1-8)    number: 3-5 digits    suffix: up to 2 letters (looser: 3)\nThe suffix is the parallel-plant letter (duty, assist) and any sub-asset code. A site identifier before the process area is normally left off drawings and is not read.');
table([{ title: 'Item', width: 120 }, { title: 'Tool default today', width: 235 }, { title: 'Your standard', width: 190 }], [
  ['Tag structure', 'process area - function code - number + suffix', { field: 'tag.structure', multiline: true }],
  ['Process area', '1-2 digits', { field: 'tag.pac' }],
  ['Function code', '1-6 capital letters', { field: 'tag.fc' }],
  ['Identification number', '3-5 digits', { field: 'tag.number' }],
  ['Suffix (parallel plant, sub-asset)', 'Up to 2 capital letters; a lone letter A-E split off by a space is joined back', { field: 'tag.suffix', multiline: true }],
  ['Separator', 'Hyphen. Repaired before matching: en and em dashes, double hyphens, spaces round hyphens', { field: 'tag.separator', multiline: true }],
  ['Looser reading (sent for review)', 'Separators _ . or - and 1-8 letters; always sent to review, never registered unchecked', { field: 'tag.loose', multiline: true }],
  ['Site identifier', 'Not read', { field: 'tag.site' }],
  ['Asset id (a separate numbering system)', 'Not read: it belongs to the machine, the function tag to the job', { field: 'tag.assetid', multiline: true }],
], { rowH: 28 });
h2('A pipe line number is not a tag');
para('A single-digit process area followed by one of these material codes reads as a pipe line number, so it goes to review for a person to confirm instead of being registered as an asset tag.', { size: 9 });
box('Tool default list: ' + PIPE_MATERIAL_CODES.join(', '));
labelled('Your material codes (comma separated)', 'tag.materials', '', { width: 330, height: 40, multiline: true });
note('The default list is generic material abbreviations, not any standard\'s data. Replace or add to it only for materials your drawings really use in line numbers.');
h2('Worked example (fictional)');
box('Drawing text: "21 - ZZ 1234 A" -> repaired to 21-ZZ-1234A -> process area 21, function code ZZ, number 1234, suffix A -> classed by the function-code table (section 5).\nDrawing text: "2-PE-1500" -> process area 2 with a material code: reads as a pipe line number -> review.');

// ───────────────────────────────────────────────────────────── 4 PAC
h1('4  Process-area codes');
para('The code before the function code names an area of the works. The tool shows its description beside each tag. List your own. The tool does not need every code; a code not listed is shown by its number.', { size: 9 });
const pacRows = [];
for (let k = 1; k <= PAC_ROWS; k++) { const p = String(k).padStart(3, '0'); pacRows.push([p, { field: `pac.${p}.code` }, { field: `pac.${p}.desc` }, { field: `pac.${p}.note` }]); }
table([{ title: 'Row', width: 34 }, { title: 'Code', width: 70 }, { title: 'Description', width: 260 }, { title: 'Note', width: 180 }], pacRows);
note('Example (fictional): code 21 = Inlet Works. More rows: add pages of the same layout with the next row numbers, or use the bulk file in appendix A.');

// ───────────────────────────────────────────────────────────── 5 FC
h1('5  Function codes');
para('One row per function code in your standard. Category decides how a tag is classed and how the symbol check treats it; the description is what the register shows. Check mode says whether the symbol check applies.', { size: 9 });
table([{ title: 'Category', width: 85 }, { title: 'Meaning', width: 460 }], [
  ['instrument', 'Drawn as a tag bubble round its tag; the symbol check looks for a bubble (of any legend bubble type) rather than a body.'],
  ['valve', 'A valve or valve-like item. Checked against legend symbols that carry the same tag identifier.'],
  ['equipment', 'Plant and machines. Checked against legend symbols that carry the same tag identifier.'],
  ['electrical', 'Electrical items. Grouped for the register; checked the same way as equipment.'],
  ['other', 'Anything not listed. Kept as a tag with the code as its description; never lost.'],
  ['none', 'A description only: the code is not given a category. The tool reads it as other, so this changes nothing in how a tag is classed; it keeps the pack an exact copy of a table that never gave the code a category.'],
]);
table([{ title: 'Check mode', width: 85 }, { title: 'Meaning', width: 460 }], [
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
note('Example row (fictional): code ZZ | Zone Gate Actuator | valve | auto. A standard with more codes than rows here: use the bulk file in appendix A (the same columns) rather than more pages.');

// ───────────────────────────────────────────────────────────── 6 legend
h1('6  Symbol legend and symbol rules');
para('The symbol check compares every drawn shape with a legend. The legend is imported from its own PDF sheets; the pack says which sheets, and how a few kinds of symbol are treated.', { size: 9 });
h2('Legend sheets this pack is checked against');
table([{ title: 'Row', width: 30 }, { title: 'Sheet number', width: 130 }, { title: 'Revision', width: 70 }, { title: 'Date', width: 80 }, { title: 'File or document reference', width: 235 }],
  Array.from({ length: 8 }, (_, k) => [String(k + 1), { field: `legend.${k + 1}.sheet` }, { field: `legend.${k + 1}.rev` }, { field: `legend.${k + 1}.date` }, { field: `legend.${k + 1}.ref` }]));
note('The legend revisions are part of the stamp. Import the legend sheets in the tool; it records what it read. A pack whose listed revisions differ from the imported legend is flagged.');
h2('How the legend is read');
table([{ title: 'Item', width: 130 }, { title: 'Tool default today', width: 235 }, { title: 'Your legend', width: 180 }], [
  ['Layout', 'Tables with a heading row (the symbol family) and one row per symbol: a name, a tag identifier, and the drawn symbol', { field: 'legend.layout', multiline: true }],
  ['Tag identifier', 'The function-code letters a symbol carries (for example V for valves); it ties a tag to the symbols that may stand beside it', { field: 'legend.tagid', multiline: true }],
  ['Tag bubble', 'A circle round placeholder text; sample bubbles with rim marks are read (good-engineering-practice, quality, safety marks)', { field: 'legend.bubble', multiline: true }],
  ['Worked examples', 'Example rows (sample combinations) are read as judge-only symbols, never swept for', { field: 'legend.samples', multiline: true }],
], { rowH: 30 });
h2('Operators: legend headings whose symbols belong to a body');
para('A symbol under one of these headings (an actuator, a handwheel) is never a body on its own. It is found only beside a body, and it is not size-judged.', { size: 9 });
for (let r = 0; r < 2; r++) { need(18); let x = M; for (let c = 0; c < 3; c++) { const k = r * 3 + c + 1; field(`operators.${k}`, x, y + 1, W / 3 - 6, 14); x += W / 3; } y -= 18; }
note('Tool default: none preset; the owner marks headings in the legend view (for example the one holding valve actuators). Recorded with the pack and stamped; not yet applied by the import.');
h2('Attachments: symbols that may ride on a body');
para('Named legend symbols that may stand on a body and are then part of it, never size-judged. Found alone, they stay symbols of their own.', { size: 9 });
box('Tool default list:\n' + CHECK_DEFAULTS.attachments.join(';  '));
for (let r = 0; r < 5; r++) { need(18); let x = M; for (let c = 0; c < 2; c++) { const k = r * 2 + c + 1; field(`attachments.${k}`, x, y + 1, W / 2 - 6, 14); x += W / 2; } y -= 18; }
note('Your attachments: legend names of fittings and marks your drawings carry on bodies. The names you list are ADDED to the default list above; leave blank to keep the default list as it is.');
h2('Drives');
para('Drives are treated as attachments of the body they are drawn on (a valve with its motor, a pump with its motor). A drive standing apart from its body joins it only when it is almost all of its own neighbouring shape.', { size: 9 });
box('Tool default list: ' + CHECK_DEFAULTS.drives.join(', '));
note('The names you list are ADDED to the default list; leave blank to keep it as it is.');
for (let r = 0; r < 2; r++) { need(18); let x = M; for (let c = 0; c < 3; c++) { const k = r * 3 + c + 1; field(`drives.${k}`, x, y + 1, W / 3 - 6, 14); x += W / 3; } y -= 18; }
h2('Variants: one legend entry holding alternative drawings');
para('A legend entry that draws two or more alternatives side by side (for example a pump with a variable-speed motor beside the same pump with a plain one) is prepared as one symbol per separate drawing, each with the entry\'s name. Only named entries are split.', { size: 9 });
box('Tool default list: ' + CHECK_DEFAULTS.variants.join(', '));
note('The names you list are ADDED to the default list; leave blank to keep it as it is.');
for (let r = 0; r < 3; r++) { need(18); field(`variants.${r + 1}`, M, y + 1, W, 14); y -= 18; }
h2('Family overrides');
table([{ title: 'Row', width: 30 }, { title: 'Tag identifier', width: 90 }, { title: 'Mode', width: 70 }, { title: 'Reason (required for skip)', width: 355 }],
  Array.from({ length: 8 }, (_, k) => [String(k + 1), { field: `family.${k + 1}.code` }, { field: `family.${k + 1}.mode`, options: ['', 'check', 'skip'] }, { field: `family.${k + 1}.why` }]));
h2('Approved exceptions');
para('Symbols the standard tolerates although they are not in the legend. An exception names the symbol, says whether it is approved or pending, and cites where the approval is recorded.', { size: 9 });
table([{ title: 'Row', width: 30 }, { title: 'Symbol name', width: 180 }, { title: 'Status', width: 70 }, { title: 'Note', width: 150 }, { title: 'Reference', width: 115 }],
  Array.from({ length: 8 }, (_, k) => [String(k + 1), { field: `exception.${k + 1}.name` }, { field: `exception.${k + 1}.status`, options: ['', 'approved', 'pending'] }, { field: `exception.${k + 1}.note` }, { field: `exception.${k + 1}.ref` }]));

// ───────────────────────────────────────────────────────────── 7 check settings
h1('7  Check settings');
para('How strict the symbol and shape checks are. These are tuned on real drawings; the defaults work for the drawings they were tuned on. Leave a value blank to keep the default. Change one only with a reason (section 10) and re-check at least five of your own drawings before relying on it.', { size: 9 });
const S = [
  ['settings.recognise', 'Recognition score', 'How well a legend symbol must match the ink to count as found (0 to 1). Higher is stricter.', CHECK_DEFAULTS.recognise],
  ['settings.shapeExplained', 'Share explained', 'A shape is standard when its symbols explain this share of its ink. Lower tolerates more extra linework.', CHECK_DEFAULTS.shapeExplained],
  ['settings.sizeTol', 'Size tolerance', 'A symbol drawn more than this share off the sheet\'s own symbol size is flagged as off size.', SIZE_TOL],
  ['settings.minScale', 'Smallest scale (tag check)', 'Symbols are looked for from this share of their legend size.', CHECK_DEFAULTS.minScale],
  ['settings.maxScale', 'Largest scale (tag check)', '... to this share of it.', CHECK_DEFAULTS.maxScale],
  ['settings.judgeBand', 'Shape judge band', 'The shape judge looks for symbols at this share of the sheet\'s own size, to this much of it.', JUDGE_BAND],
  ['settings.radius', 'Search radius', 'Points from a tag\'s centre to the centre of the symbol it names.', CHECK_DEFAULTS.radius],
  ['settings.inkTol', 'Ink tolerance', 'Points: ink this close to the legend symbol counts as a hit.', CHECK_DEFAULTS.inkTol],
  ['settings.plainBack', 'Plain symbol cover', 'A simple symbol found alone must explain this share of the ink in its box.', CHECK_DEFAULTS.plainBack],
  ['settings.shareInk', 'Shared ink', 'Two hits sharing this much ink are one physical symbol.', CHECK_DEFAULTS.shareInk],
  ['settings.minSize', 'Smallest symbol', 'Points: the smallest symbol side the shape check looks at.', CHECK_DEFAULTS.minSize],
  ['settings.maxSize', 'Largest symbol', 'Points: the largest symbol side; bigger drawn shapes are pipework or structures.', CHECK_DEFAULTS.maxSize],
  ['settings.sweepStep', 'Sweep step', 'Points between the centres the symbol sweep searches round.', CHECK_DEFAULTS.sweepStep],
  ['settings.amberAlike', 'Looks like (differs)', 'No body found: the closest symbol scoring this makes "drawn differently from ...".', AMBER_ALIKE],
  ['settings.amberExplained', 'Explains (extra linework)', 'A body must explain this share of its shape to be called "extra linework".', AMBER_EXPLAINED],
  ['settings.greenSwitch', 'Line-piece switch', 'Fewer than this share of shapes standard when read by drawn paths: the sheet is read by line pieces too.', GREEN_SWITCH],
  ['settings.scaleSymbolsMin', 'Symbols for sheet size', 'Fewer found symbols than this and the sheet\'s size is taken as the legend\'s.', SCALE_SYMBOLS_MIN],
  ['settings.letterRoom', 'Writing in a lettered symbol', 'A lettered symbol\'s box may hold at most this many times its legend letters\' share of writing.', LETTER_ROOM],
  ['settings.heavyPipe', 'Heavy pipework', 'A straight piece at least this many times as wide as its shape\'s usual ink is pipework, not symbol.', HEAVY_PIPE],
  ['settings.heavyMin', 'Heavy pipework, least width', 'Points: and at least this wide.', HEAVY_MIN],
  ['settings.paleMin', 'Background lines, grey', 'Grey level (0 black, 255 white): lines at least this pale ...', PALE_MIN],
  ['settings.paleStep', 'Background lines, step', '... and this much paler than their shape\'s ink are background.', PALE_STEP],
  ['settings.driveShare', 'Drive share', 'A drive standing apart joins its body when it is this share of the neighbouring shape.', DRIVE_SHARE],
  ['settings.inkGrey', 'Ink grey', 'Grey darker than this is ink.', CHECK_DEFAULTS.inkGrey],
  ['settings.timeLimitMs', 'Time limit', 'Milliseconds: a check still running after this stops and says so.', CHECK_DEFAULTS.timeLimitMs],
];
table([{ title: 'Setting', width: 105 }, { title: 'What it does', width: 270 }, { title: 'Default', width: 55 }, { title: 'Your value', width: 65 }, { title: 'Why changed', width: 120 }],
  S.map(([key, label, what, def]) => [label, what, num(def), { field: key }, { field: key + '.why' }]), { rowH: 24, size: 7.6 });
note('Settings that name legend symbols (operators, attachments, drives, variants) are in section 6, and the sheet pre-check in section 8. Every value above is a number; the tool ignores anything else.');

// ───────────────────────────────────────────────────────────── 8 precheck
h1('8  Sheet pre-check settings');
para('Before a sheet is checked, the tool decides how its text can be read. The status is about text, not tags: a supplier drawing can keep every label in comments and hold no tag at all.', { size: 9 });
table([{ title: 'Status', width: 95 }, { title: 'Meaning', width: 450 }], [
  ['Readable', 'The text layer holds text. Tags are read from it.'],
  ['Readable from comments', 'The text layer holds none, but the drawing\'s comments do. Comments are read for tags only when the text layer gives none at all.'],
  ['Printed', 'No text and no comments, but plenty of linework: the letters are drawn as shapes. Symbols can be checked; tags cannot be read yet.'],
  ['Scanned', 'Images cover almost every page and there is little linework. Neither tags nor symbols can be read.'],
  ['None', 'Nothing readable and too little linework to check.'],
]);
table([{ title: 'Setting', width: 105 }, { title: 'What it does', width: 255 }, { title: 'Default', width: 55 }, { title: 'Your value', width: 65 }, { title: 'Why changed', width: 105 }], [
  ['Printed threshold', 'A page with no text is "printed" when it holds this many drawn paths (a real drawing holds thousands).', num(PRINTED_MIN_PATHS), { field: 'precheck.printedMinPaths' }, { field: 'precheck.printedMinPaths.why' }],
  ['Scan cover', 'A page is "scanned" when images cover this share of it and it has fewer paths than the printed threshold.', num(SCAN_COVER), { field: 'precheck.scanCover' }, { field: 'precheck.scanCover.why' }],
  ['Sheet size tolerance', 'Millimetres: a page within this of a standard size (A0 to A4) is that size.', '3', { field: 'precheck.sizeTolerance' }, { field: 'precheck.sizeTolerance.why' }],
], { rowH: 26, size: 7.8 });
h2('The drawing area');
para('Shapes standing in the title strip, on the frame or outside it are not judged. The frame is found from long rules near the page edge and a title strip or block dividers; where none is found, the page edge is used and the report says so.', { size: 9 });
table([{ title: 'Item', width: 140 }, { title: 'Tool default today', width: 235 }, { title: 'Your drawings', width: 170 }], [
  ['Frame side', 'A rule at least 0.6 of the page width (or height), in the outer 0.15 of the page', { field: 'frame.side', multiline: true }],
  ['Title strip', 'A divider in the outer 0.3 of the frame, covering at least 0.5 of its height, with at least 2 rows', { field: 'frame.strip', multiline: true }],
  ['Shape size band', 'From the smallest to the largest legend symbol, scaled to the sheet', { field: 'frame.band', multiline: true }],
], { rowH: 28 });

// ───────────────────────────────────────────────────────────── 9 register stamp
h1('9  How the register records the stamp');
para('Every drawing in the register carries the stamp of the last check made on it. This is what keeps a drawing correct to the standard it was produced under when the standard later changes.', { size: 9.2 });
table([{ title: 'Recorded per drawing', width: 150 }, { title: 'Meaning', width: 395 }], [
  ['Pack id and pack revision', 'Which filled pack was applied.'],
  ['Standard document and revision', 'The standard the pack implements, with its issue date.'],
  ['Legend sheets and revisions', 'The legend the symbols were compared with.'],
  ['Date checked', 'When the check was made.'],
  ['Tool build', 'The version of the checking code, so a result can be reproduced.'],
  ['Pack fingerprint', 'A short code worked out from the pack\'s contents. Two packs with the same name and revision but different contents have different fingerprints.'],
]);
h2('Rules');
[
  'A drawing keeps the stamp it was checked under. A new pack revision never rewrites it.',
  'The register can list drawings by stamp: which were checked under revision 2 and which under 3, and which have no stamp.',
  'When a pack is replaced, drawings checked under the earlier revision are shown as "checked under an earlier pack". Re-checking is optional and is a new stamp, not a correction.',
  'Reports print the stamp on the front page and under each sheet heading, so a printed report is traceable on its own.',
  'A pack revision that changes only wording keeps the same fingerprint family; one that changes a table or setting must change the pack revision.',
].forEach(t => para('- ' + t, { size: 9, gap: 3 }));
h2('Report wording');
box('Front page:  Checked against: <pack name> <pack revision> (<standard number> rev <standard revision>, <issue date>)\n                      Legend: <sheet> rev <revision>; <sheet> rev <revision>\n                      Pack fingerprint: <code>        Checked <date>, tool build <build>');

// ───────────────────────────────────────────────────────────── 10 sign-off
h1('10  Sign-off and change log');
para('Who approved this pack and what changed. A change to any table or setting needs a line here, with the reason.', { size: 9 });
labelled('Prepared by', 'signoff.prepared.by', '', { width: 220 }); labelled('Date', 'signoff.prepared.date', 'dd/mm/yyyy', { width: 120 });
labelled('Checked by', 'signoff.checked.by', '', { width: 220 }); labelled('Date', 'signoff.checked.date', 'dd/mm/yyyy', { width: 120 });
labelled('Approved by', 'signoff.approved.by', '', { width: 220 }); labelled('Date', 'signoff.approved.date', 'dd/mm/yyyy', { width: 120 });
h2('Change log');
table([{ title: 'Pack rev', width: 55 }, { title: 'Date', width: 70 }, { title: 'What changed', width: 230 }, { title: 'Why', width: 150 }, { title: 'By', width: 70 }],
  Array.from({ length: 14 }, (_, k) => [{ field: `changelog.${k + 1}.rev` }, { field: `changelog.${k + 1}.date` }, { field: `changelog.${k + 1}.what` }, { field: `changelog.${k + 1}.why` }, { field: `changelog.${k + 1}.by` }], ), { rowH: 18 });

// ───────────────────────────────────────────────────────────── A bulk
h1('A  Field names and bulk files');
para('A filled pack is read back by field name. Do not rename or delete fields; leave unused ones blank. For tables longer than the pages here (a standard with several hundred function codes), the same columns can be supplied as a bulk file.', { size: 9 });
table([{ title: 'Section', width: 95 }, { title: 'Field name pattern', width: 215 }, { title: 'Example', width: 235 }], [
  ['1 Identity', 'pack_<item>', 'pack_name, pack_standard_number'],
  ['2 Drawing / revision', 'drawingno_<item>, revision_<item>', 'drawingno_pattern, revision_words'],
  ['3 Tag', 'tag_<item>', 'tag_materials'],
  ['4 Process areas', 'pac_<row>_code | desc | note', 'pac_001_code'],
  ['5 Function codes', 'fc_<row>_code | desc | cat | mode | note', 'fc_012_cat'],
  ['6 Legend and symbols', 'legend_<row>_<item>, operators_<n>, attachments_<n>, drives_<n>, variants_<n>, family_<row>_<item>, exception_<row>_<item>', 'legend_1_rev'],
  ['7 Check settings', 'settings_<name> and settings_<name>_why', 'settings_recognise'],
  ['8 Pre-check', 'precheck_<name>, frame_<item>', 'precheck_scanCover'],
  ['10 Sign-off', 'signoff_<role>_by | date, changelog_<row>_<item>', 'changelog_3_what'],
]);
h2('Bulk file for process areas and function codes');
para('A comma-separated file with a header row, one row per code. Fields containing a comma or a line break must be quoted: read it with a reader that understands quotes, never by splitting each line on commas.', { size: 9 });
box('Process areas:   code,description,note\nFunction codes:   code,description,category,check,note\n\ncategory is one of: instrument, valve, equipment, electrical, other.   check is one of: auto, check, skip (a note giving the reason is required for skip).');
h2('Before you rely on a pack');
[
  'Import it, then check at least five of your own drawings, including one you know well. Read every "not to standard" flag by eye before acting on it.',
  'Keep the filled pack, the standard it implements and the legend sheets together; the stamp refers to all three.',
  'Treat the filled pack as the standard\'s data: it is as confidential as the standard.',
].forEach(t => para('- ' + t, { size: 9, gap: 3 }));

// footers
const pages = doc.getPages();
pages.forEach((p, k) => { const t = `Page ${k + 1} of ${pages.length}`; p.drawText(t, { x: A4[0] - M - F.r.widthOfTextAtSize(t, 7.5), y: 22, size: 7.5, font: F.r, color: GREY }); p.drawText('Fill in the yellow fields. Do not rename fields.', { x: M, y: 22, size: 7.5, font: F.i, color: GREY }); });
form.updateFieldAppearances(F.r);
const bytes = await doc.save();
await fs.writeFile(path.resolve(OUT), bytes);
console.log(`wrote ${OUT}: ${pages.length} pages, ${names.size} fields, ${(bytes.length / 1024).toFixed(0)} KB`);
