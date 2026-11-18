// assets/js/pid-symbol-report.js
// The symbol check report as data: the front-page facts, a section per sheet
// with its rows numbered in the order the screen shows them, each row's box
// in the PDF page's own coordinates, the Excel workbook and the file names.
// Pure: no DOM, nothing saved, nothing thrown.
//
// Tags and symbol names come from PDFs and a library file in a shared folder.
// They are kept here as plain text: the PDF renderer passes them through
// pdfSafe, and the workbook strips control characters.

import { FAMILY_NOTE, VERDICT_LABELS, kindOf, ROW_ORDER, SUMMARY_ORDER, verdictSentence, bubbleSummary, symbolSummary, SKIPPED_NOTE, tagsTimedOut, shapeWhy, NOT_STANDARD_COLOUR, OPERATORS_NOTE } from './pid-symbol-check-view.js';
import { STATUS_LABELS } from './pid-precheck.js';
import { REASONS } from './pid-symbol-report-run.js';

export const SHORT_NOTE = 'It checks the family of symbol, not which member of it.';
export const TIMED_OUT = 'The check stopped at its time limit. Tags it did not reach are marked Not checked.';
export const FALLBACK = 'The drawing could not be copied into this report. Results are listed below; open the sheet in the tool to see the boxes.';
export const PRINT_COLOURS = { ok: '#2E7D32', 'off-size': '#E08E00', exception: '#E08E00', look: '#E08E00', 'wrong-family': '#C62828', 'not-checked': '#757575',
  symbol: '#546E7A',     // a standard symbol with no tag beside it
  'not-standard': NOT_STANDARD_COLOUR,     // a shape not to standard (phase 3)
  standard: '#2E7D32' };                 // a standard symbol, named on the drawing (symbols first)
const SAVED = 'Nothing from this check is saved in the register.';
const MARGIN = 3; // pt, as on screen

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isNum = x => typeof x === 'number' && Number.isFinite(x);
const str = x => (typeof x === 'string' ? x : '');
const obj = x => (x && typeof x === 'object' ? x : {});
const asArr = x => (Array.isArray(x) ? x : []);
const count = x => (isNum(x) && x > 0 ? Math.floor(x) : 0);
const isBox = b => Array.isArray(b) && b.length === 4 && b.every(isNum);
const isTransform = t => Array.isArray(t) && t.length === 6 && t.every(isNum);
const tenths = ms => (isNum(ms) && ms > 0 ? Math.round(ms / 100) / 10 : 0);
const pad = n => String(n).padStart(2, '0');

/**
 * A box from the check (pdf.js viewport space at scale 1: origin top left,
 * rotation applied) grown by `margin`, as [x0, y0, x1, y1] in the page's own
 * user space: each corner through the inverse of the viewport transform.
 */
export function toUserRect(box, viewportTransform, margin) {
  if (!isBox(box) || !isTransform(viewportTransform)) return null;
  const [a, b, c, d, e, f] = viewportTransform;
  const det = a * d - b * c;
  if (!isNum(det) || det === 0) return null;
  const m = isNum(margin) ? margin : 0;
  const x0 = Math.min(box[0], box[2]) - m, x1 = Math.max(box[0], box[2]) + m;
  const y0 = Math.min(box[1], box[3]) - m, y1 = Math.max(box[1], box[3]) + m;
  const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([X, Y]) => [(d * (X - e) - c * (Y - f)) / det, (-b * (X - e) + a * (Y - f)) / det]);
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const out = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(v => v + 0);   // + 0 turns -0 into 0
  return out.every(isNum) ? out : null;
}

function legendText(library) {
  const parts = asArr(obj(library).legend).filter(l => l && typeof l === 'object')
    .map(l => 'Legend sheet ' + String(str(l.sheet) || (isNum(l.sheet) ? l.sheet : '?')) + ' rev ' + (str(l.rev) || '?'));
  return parts.length ? parts.join('; ') : 'Legend sheets not recorded in the library.';
}

function rowsFor(result, vt) {
  const list = asArr(result.verdicts).filter(v => v && typeof v === 'object').map(v => ({ v, kind: kindOf(v) }));
  list.sort((p, q) => ROW_ORDER.indexOf(p.kind) - ROW_ORDER.indexOf(q.kind) || str(p.v.tag).localeCompare(str(q.v.tag)));
  return list.map(({ v, kind }, i) => {
    const names = asArr(v.oneOf).map(str).filter(Boolean);
    const c = obj(v.closest);
    return {
      no: i + 1, tag: str(v.tag), fc: str(v.fc), kind, label: VERDICT_LABELS[kind], detail: verdictSentence(v),
      symbol: names.length > 1 ? 'One of: ' + names.join(', ') : str(v.symbol), tagId: str(v.tagId),
      sizePct: isNum(v.sizePct) ? v.sizePct : null, score: isNum(v.score) ? v.score : null, filled: v.filled === true,
      letters: str(v.letters), closestSymbol: str(c.symbol), closestScore: isNum(c.score) ? c.score : null,
      userRect: toUserRect(isBox(v.box) ? v.box : isBox(v.tagBox) ? v.tagBox : null, vt, MARGIN),
    };
  });
}

// The sweep's symbols: every one for the workbook; those with no tag boxed on the drawing.
// With phase 3's shapes, the workbook has one row per judged shape (not to
// standard first), then any listed symbol that lies in no shape.
const symbolsOf = result => asArr(result.symbols).filter(s => s && typeof s === 'object' && str(s.name));
const shapesOf = result => (Array.isArray(result.shapes) ? result.shapes.filter(s => s && typeof s === 'object' && isBox(s.box)) : null);
const toStandard = s => (s.standard === true ? 'Yes' : s.standard === false ? 'No' : 'Not judged');
const closestText = s => { const c = obj(s.closest); return str(c.name) && isNum(c.score) ? 'closest: ' + str(c.name) + ' ' + Math.round(c.score * 100) + '%' : 'no close symbol'; };
function symbolEntry(s) {
  const alts = asArr(s.oneOf).map(str).filter(Boolean);
  return { page: 1, symbol: str(s.name), oneOf: alts.length > 1 ? alts.join(', ') : '', tagId: str(s.tagId),
    sizePct: isNum(s.sizePct) ? s.sizePct : null, score: isNum(s.score) ? s.score : null, tag: str(s.tag), plain: s.plain === true,
    toStandard: '', why: '', closest: '', closestScore: null };
}
function symbolParts(result, vt) {
  const all = symbolsOf(result), raw = asArr(result.symbols), shapes = shapesOf(result);
  const symbolRows = all.filter(s => !str(s.tag)).map(s => ({ name: str(s.name), userRect: toUserRect(isBox(s.box) ? s.box : null, vt, MARGIN) }));
  if (!shapes) return { symbolRows, allSymbols: all.map(symbolEntry), shapeRows: [], notStandard: null, layout: 'tags', standardRows: [], shapeLine: '' };
  const order = s => (s.standard === false ? 0 : s.standard === true ? 1 : 2);
  const inShape = new Set();
  const allSymbols = shapes.map((s, n) => ({ s, n })).sort((a, b) => order(a.s) - order(b.s) || a.n - b.n).map(({ s }) => {
    const mine = asArr(s.symbols).filter(i => Number.isInteger(i) && raw[i] && typeof raw[i] === 'object' && str(raw[i].name));
    for (const i of mine) inShape.add(raw[i]);
    const first = mine.length ? symbolEntry(raw[mine[0]]) : symbolEntry({});
    const names = mine.map(i => str(raw[i].name));
    if (str(obj(s.operator).name)) names.push(str(s.operator.name));
    const c = obj(s.closest);
    return { ...first, symbol: names.join(' + '), toStandard: toStandard(s), why: shapeWhy(s), closest: s.standard === true ? '' : str(c.name),
      closestScore: s.standard !== true && isNum(c.score) ? c.score : null };
  });
  for (const s of all) if (!inShape.has(s)) allSymbols.push(symbolEntry(s));
  const flagged = shapes.filter(s => s.standard === false), good = shapes.filter(s => s.standard === true);
  const late = shapes.filter(s => s.standard !== true && s.standard !== false).length;
  // A standard shape is named by its symbols (operator last), or by the symbol fitted to it alone.
  const nameOf = s => {
    const names = asArr(s.symbols).filter(i => Number.isInteger(i) && raw[i] && str(raw[i].name)).map(i => str(raw[i].name));
    if (str(obj(s.operator).name)) names.push(str(s.operator.name));
    return names.length ? names.join(' + ') : str(obj(s.closest).name);
  };
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  const shapeLine = plural(good.length, 'standard symbol', 'standard symbols') + ' · ' + flagged.length + ' not to standard'
    + (late ? ' · ' + late + ' not judged (time limit)' : '') + (result.operatorsMarked === false ? '. ' + OPERATORS_NOTE : '');
  return { symbolRows, allSymbols, shapeRows: flagged.map(s => ({ kind: 'not-standard', label: 'Not to standard', tag: '', fc: '',
    detail: shapeWhy(s) + '; ' + closestText(s), userRect: toUserRect(s.box, vt, MARGIN) })), notStandard: flagged.length,
    layout: 'symbols', shapeLine, standardRows: good.map(s => ({ name: nameOf(s), userRect: toUserRect(s.box, vt, MARGIN) })),
    standardCount: good.length, notStandardCount: flagged.length, notJudgedCount: late,
    reasonLine: flagged.length ? 'Why: ' + [['left-over', 'ink left over'], ['short-line', 'line drawn short'], ['no-fit', 'no standard symbol fits']]
      .map(([k, words]) => [flagged.filter(s => s.why === k).length, words]).filter(x => x[0]).map(x => x[0] + ' ' + x[1]).join(', ') : '' };
}

function sheetFor(o) {
  const drawing = str(o.drawing), rev = str(o.rev);
  const result = obj(o.result);
  const isChecked = o.status === 'checked' && result.ok === true && Array.isArray(result.verdicts);
  const reason = isChecked ? '' : (str(o.reason) || REASONS.failed);
  const rows = isChecked ? rowsFor(result, isTransform(o.viewportTransform) ? o.viewportTransform : null) : [];
  const counts = Object.fromEntries(SUMMARY_ORDER.map(k => [k, rows.filter(r => r.kind === k).length]));
  const pages = count(o.pages);
  return {
    drawing, rev, family: str(o.family),
    precheckLabel: has(STATUS_LABELS, o.precheck) ? STATUS_LABELS[o.precheck] : 'Not run',
    status: isChecked ? 'checked' : 'not-checked', reason,
    resultText: isChecked ? 'Checked' : 'Not checked: ' + reason,
    counts, seconds: tenths(o.ms), pages,
    tagsLine: o.precheck === 'printed' ? 'Tags not read yet: letters drawn as shapes.' : isChecked && rows.length === 0 ? 'No tags read.' : '',
    bubbleLine: isChecked ? bubbleSummary(result) : '',
    pageNote: isChecked && pages > 1 ? 'Page 1 of ' + pages + ' only.' : '',
    timedOutLine: isChecked && tagsTimedOut(result) ? TIMED_OUT : '',
    symbolLine: isChecked ? symbolSummary(result) : '',
    skippedLine: isChecked && isBox(result.skipped) ? SKIPPED_NOTE : '',
    ...(isChecked ? symbolParts(result, isTransform(o.viewportTransform) ? o.viewportTransform : null) : { symbolRows: [], allSymbols: [], shapeRows: [], notStandard: null, layout: 'tags', standardRows: [], shapeLine: '' }),
    pageSize: Array.isArray(o.pageSize) && o.pageSize.length === 2 && o.pageSize.every(x => isNum(x) && x > 0) ? o.pageSize.slice() : null,
    key: drawing + '||' + rev,
    rows,
  };
}
// Symbols first, the flagged shapes are numbered from 1 (the tags are reference, with no boxes on the drawing);
// otherwise on after the tag rows, so the drawing's boxes and the table share one count.
function numbered(sheet) {
  const n = sheet.layout === 'symbols' ? 0 : asArr(sheet.rows).length;
  return { ...sheet, shapeRows: asArr(sheet.shapeRows).map((r, i) => ({ ...r, no: n + i + 1 })) };
}

/** The whole report as plain data, from a runReport result. */
export function buildReportModel(opts) {
  const o = obj(opts);
  const run = obj(o.run);
  const startedAt = o.startedAt instanceof Date && isNum(o.startedAt.getTime()) ? o.startedAt : new Date();
  const when = startedAt.getFullYear() + '-' + pad(startedAt.getMonth() + 1) + '-' + pad(startedAt.getDate())
    + ' ' + pad(startedAt.getHours()) + ':' + pad(startedAt.getMinutes());
  const outcomes = asArr(run.outcomes).filter(x => x && typeof x === 'object');
  const sheets = outcomes.map(sheetFor).map(numbered);
  const reached = outcomes.filter(x => x.reason !== REASONS.stopped).length;
  const stopped = run.stopped === true || reached < outcomes.length;
  const checked = sheets.filter(s => s.status === 'checked').length;
  const library = obj(o.library);
  return {
    title: 'P&ID symbol check', startedAt, when, checkedBy: str(o.checkedBy).trim(),
    familyNote: FAMILY_NOTE, shortNote: SHORT_NOTE,
    library: { legend: legendText(library), importedAt: str(library.importedAt) || 'Not recorded in the library.' },
    run: { ticked: sheets.length, checked, notChecked: sheets.length - checked, seconds: tenths(run.ms),
      stoppedLine: stopped ? 'Stopped by user after ' + reached + ' of ' + outcomes.length + ' sheets.' : '' },
    sheets,
  };
}

// The tool's sanitizeFilename rule, plus control characters.
const fileSafe = s => String(s).replace(/[\/\\:*?"<>|\u0000-\u001f\u007f]/g, '-');

/** The download's name without its extension. */
export function fileBase(model) {
  const m = obj(model);
  const d = m.startedAt instanceof Date && isNum(m.startedAt.getTime()) ? m.startedAt : new Date();
  const day = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const sheets = asArr(m.sheets).filter(s => s && typeof s === 'object');
  if (sheets.length === 1) return fileSafe(str(sheets[0].drawing) + '_' + str(sheets[0].rev) + '_SymbolCheck_' + day);
  return fileSafe('SymbolCheck_' + sheets.length + '-sheets_' + day + '_' + pad(d.getHours()) + pad(d.getMinutes()));
}

// XML cannot hold most control characters: an .xlsx with one will not open.
const cell = x => (typeof x === 'string' ? x.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '') : x);
const pct = x => (isNum(x) ? Math.round(x * 100) : '');

/** The three sheets of the workbook as plain rows. */
export function workbookRows(model) {
  const m = obj(model);
  const sheets = asArr(m.sheets).filter(s => s && typeof s === 'object');
  const run = obj(m.run), lib = obj(m.library);
  const tags = { columns: ['Drawing', 'Revision', 'No.', 'Tag', 'Function code', 'Verdict', 'Symbol', 'Tag identifier', 'Size %',
    'Score %', 'Filled', 'Letters', 'Closest in family', 'Closest score %', 'Detail'], rows: [] };
  const symbols = { columns: ['Drawing', 'Revision', 'Page', 'Symbol', 'One of', 'Tag identifier', 'Size %', 'Score %', 'Tag', 'Note',
    'To standard?', 'Why', 'Closest', 'Closest score %'], rows: [] };
  const sh = { columns: ['Drawing', 'Revision', 'Family', 'Pre-check', 'Result', 'Reason', 'OK', 'OK, off size', 'Wrong family',
    'Approved exception', 'Needs a look', 'Not checked', 'Time (s)', 'Timed out', 'Pages', 'Tag bubbles', 'Not to standard'], rows: [] };
  for (const s of sheets) {
    const checked = s.status === 'checked';
    for (const r of asArr(s.rows).filter(x => x && typeof x === 'object')) {
      tags.rows.push([s.drawing, s.rev, r.no, r.tag, r.fc, r.label, r.symbol, r.tagId, isNum(r.sizePct) ? r.sizePct : '', pct(r.score),
        r.filled ? 'Yes' : '', r.letters, r.closestSymbol, pct(r.closestScore), r.detail].map(cell));
    }
    for (const y of asArr(s.allSymbols).filter(x => x && typeof x === 'object')) {
      symbols.rows.push([s.drawing, s.rev, count(y.page) || 1, str(y.symbol), str(y.oneOf), str(y.tagId), isNum(y.sizePct) ? y.sizePct : '',
        pct(y.score), str(y.tag), y.plain === true ? 'Plain shape: check by eye' : '', str(y.toStandard), str(y.why), str(y.closest), pct(y.closestScore)].map(cell));
    }
    const c = obj(s.counts);
    sh.rows.push([s.drawing, s.rev, s.family, s.precheckLabel, checked ? 'Checked' : 'Not checked', s.reason,
      ...SUMMARY_ORDER.map(k => (checked ? count(c[k]) : '')), checked ? s.seconds : '', s.timedOutLine ? 'Yes' : '',
      checked ? (count(s.pages) || '') : '', str(s.bubbleLine).replace(/^Tag bubbles: /, ''), checked && isNum(s.notStandard) ? s.notStandard : ''].map(cell));
  }
  const about = [['Report', str(m.title)], ['Run', str(m.when)], ['Checked by', str(m.checkedBy)], ['What it checks', FAMILY_NOTE],
    ['Library', str(lib.legend)], ['Library imported', str(lib.importedAt)], ['Sheets ticked', count(run.ticked)],
    ['Checked', count(run.checked)], ['Not checked', count(run.notChecked)], ['Stopped', str(run.stoppedLine) || 'No'], ['Saved', SAVED]]
    .map(r => r.map(cell));
  return { tags, symbols, sheets: sh, about };
}

/** The workbook's bytes, or null if it could not be made. Never rejects. */
export async function writeWorkbook(model, ExcelJS) {
  try {
    if (!model || typeof model !== 'object' || !ExcelJS || typeof ExcelJS.Workbook !== 'function') return null;
    const w = workbookRows(model);
    const wb = new ExcelJS.Workbook();
    const table = (name, { columns, rows }) => {
      const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
      ws.addRow(columns);
      for (const r of rows) ws.addRow(r);
      ws.getRow(1).font = { bold: true };
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
      ws.columns.forEach((col, i) => { col.width = Math.min(60, Math.max(8, columns[i].length + 2, ...rows.map(r => String(r[i] ?? '').length + 2).slice(0, 500))); });
    };
    table('Tags', w.tags);
    table('Symbols', w.symbols);
    table('Sheets', w.sheets);
    const about = wb.addWorksheet('About');
    for (const r of w.about) about.addRow(r);
    about.getColumn(1).font = { bold: true };
    about.getColumn(1).width = 20;
    about.getColumn(2).width = 100;
    about.getColumn(2).alignment = { wrapText: true, vertical: 'top' };
    const buf = await wb.xlsx.writeBuffer();
    return buf || null;
  } catch {
    return null;
  }
}
