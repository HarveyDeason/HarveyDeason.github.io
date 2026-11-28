import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../assets/js/pid-symbol-report.js';
import { REASONS, notReadable } from '../assets/js/pid-symbol-report-run.js';
import { FAMILY_NOTE } from '../assets/js/pid-symbol-check-view.js';
import { checkSheet } from '../assets/js/pid-symbol-check.js';
import { readSheet } from '../scripts/check-symbol-check.mjs';
import { LIBRARY, LOOKUPS, sheetPdfBytes } from './fixtures/symbol-check-sheet.js';

// Invented sheet only: read it as the tool does, check it, and build a run by hand.
const SHEET = await readSheet(sheetPdfBytes());
const RESULT = checkSheet({ paths: SHEET.paths, textItems: SHEET.textItems, viewportTransform: SHEET.viewportTransform, tags: SHEET.tags,
  library: LIBRARY, lookups: LOOKUPS });
const VT = SHEET.viewportTransform;
const base = { family: '', pages: 0, pageSize: null, viewportTransform: null, result: null, ms: 10 };
const checked = { ...base, drawing: 'INV-0001', rev: 'C01', family: 'Invented', status: 'checked', reason: '', precheck: 'readable',
  pages: 1, pageSize: [500, 400], viewportTransform: VT, result: RESULT, ms: 2500 };
const noPdf = { ...base, drawing: 'INV-0002', rev: 'C01', status: 'not-checked', reason: REASONS.noPdf, precheck: '' };
const unreadable = { ...base, drawing: 'INV-0003', rev: 'P02', status: 'not-checked', reason: notReadable('none'), precheck: 'none' };
const startedAt = new Date(2026, 0, 2, 3, 4);
const RUN = { outcomes: [checked, noPdf, unreadable], stopped: false, ms: 4200 };
const model = (run = RUN, more = {}) => M.buildReportModel({ run, startedAt, checkedBy: 'A Tester', library: LIBRARY, ...more });

test('buildReportModel: front-page facts, counts and numbered rows in screen order', () => {
  const m = model();
  assert.equal(m.title, 'P&ID symbol check');
  assert.equal(m.when, '2026-01-02 03:04');
  assert.equal(m.checkedBy, 'A Tester');
  assert.equal(m.familyNote, FAMILY_NOTE);
  assert.equal(m.shortNote, 'It checks the family of symbol, not which member of it.');
  assert.equal(m.library.legend, 'Legend sheet 1 rev A');
  assert.equal(m.library.importedAt, LIBRARY.importedAt);
  assert.equal(m.run.ticked, 3);
  assert.equal(m.run.checked, 1);
  assert.equal(m.run.notChecked, 2);
  assert.equal(m.run.stoppedLine, '');
  assert.equal(typeof m.run.seconds, 'number');
  const [s1, s2, s3] = m.sheets;
  assert.deepEqual(s1.counts, { ok: 3, 'off-size': 1, 'wrong-family': 1, exception: 1, look: 1, 'not-checked': 4 });
  assert.equal(s1.rows.length, 11);
  assert.deepEqual(s1.rows.map(r => r.no), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(s1.rows[0].kind, 'wrong-family');
  assert.equal(s1.rows[0].label, 'Wrong family');
  assert.equal(s1.rows[0].detail, 'Recognised as WIDGET, BARRED (tag identifier W), which does not fit G.');
  assert.deepEqual(s1.rows.map(r => r.kind), ['wrong-family', 'look', 'exception', 'off-size', 'not-checked', 'not-checked', 'not-checked', 'not-checked', 'ok', 'ok', 'ok']);
  assert.equal(s1.rows.find(r => r.tag === '21-P-6001').symbol, 'One of: PENNANT, LEFT, PENNANT, RIGHT');
  assert.equal(s1.resultText, 'Checked');
  assert.equal(s1.precheckLabel, 'Readable');
  assert.equal(s1.key, 'INV-0001||C01');
  assert.equal(s1.pageNote, '');
  assert.equal(s1.timedOutLine, '');
  assert.deepEqual(s1.pageSize, [500, 400]);
  assert.equal(s1.seconds, 2.5);
  for (const s of [s2, s3]) assert.deepEqual(s.rows, []);
  assert.equal(s2.resultText, 'Not checked: ' + REASONS.noPdf);
  assert.equal(s3.resultText, 'Not checked: ' + notReadable('none'));
  assert.equal(s3.precheckLabel, 'No readable text');
  assert.equal(M.buildReportModel({ run: RUN, startedAt, library: { legend: [] } }).library.legend, 'Legend sheets not recorded in the library.');
  assert.equal(M.buildReportModel({ run: RUN, startedAt, library: { legend: [{ sheet: '1', rev: 'A' }, { sheet: '2', rev: 'B' }] } }).library.legend,
    'Legend sheet 1 rev A; Legend sheet 2 rev B');
});

test('buildReportModel: a stopped run says how far it got', () => {
  const st = o => ({ ...o, status: 'not-checked', reason: REASONS.stopped, result: null });
  assert.equal(model({ outcomes: [checked, st(noPdf), st(unreadable)], stopped: true, ms: 1 }).run.stoppedLine, 'Stopped by user after 1 of 3 sheets.');
  assert.equal(model({ outcomes: [st(checked), st(noPdf), st(unreadable)], stopped: true, ms: 1 }).run.stoppedLine, 'Stopped by user after 0 of 3 sheets.');
});

test('toUserRect: a box on screen maps back to the page, rotated or offset', () => {
  assert.deepEqual(M.toUserRect([100, 100, 124, 112], [1, 0, 0, -1, 0, 400], 3), [97, 285, 127, 303]);
  assert.deepEqual(M.toUserRect([10, 20, 30, 40], [0, 1, 1, 0, 0, 0], 0), [20, 10, 40, 30]);
  assert.deepEqual(M.toUserRect([0, 0, 10, 10], [1, 0, 0, -1, -100, 450], 0), [100, 440, 110, 450]);
  assert.equal(M.toUserRect([0, 0, 10, 10], [0, 0, 0, 0, 0, 0], 0), null);
  assert.equal(M.toUserRect([0, 0, 10], [1, 0, 0, 1, 0, 0], 0), null);
  assert.equal(M.toUserRect([0, 0, NaN, 10], [1, 0, 0, 1, 0, 0], 0), null);
  assert.equal(M.toUserRect([0, 0, 10, 10], [1, 0, 0, 1, NaN, 0], 0), null);
  assert.equal(M.toUserRect(null, null, 3), null);
  for (const r of model().sheets[0].rows) {
    const v = RESULT.verdicts.find(x => x.tag === r.tag);
    assert.deepEqual(r.userRect, M.toUserRect(v.box || v.tagBox, VT, 3), r.tag);
    assert.ok(r.userRect, r.tag);
  }
});

test('buildReportModel: page 1 only, and the time limit, are said', () => {
  const m = model({ outcomes: [{ ...checked, pages: 3, result: { ...RESULT, timedOut: true, tagsTimedOut: true } }], stopped: false, ms: 1 });
  assert.equal(m.sheets[0].pageNote, 'Page 1 of 3 only.');
  assert.equal(m.sheets[0].timedOutLine, M.TIMED_OUT);
  assert.equal(M.TIMED_OUT, 'The check stopped at its time limit. Tags it did not reach are marked Not checked.');
});

test('fileBase: one sheet by its name, a pack by its size, nothing a file name cannot hold', () => {
  const one = model({ outcomes: [{ ...checked, drawing: 'INV/01:ü' }], stopped: false, ms: 1 });
  assert.equal(M.fileBase(one), 'INV-01-ü_C01_SymbolCheck_2026-01-02');
  assert.equal(M.fileBase(model()), 'SymbolCheck_3-sheets_2026-01-02_0304');
  const ctl = model({ outcomes: [{ ...checked, drawing: 'INV\u0007A*"<>|\\' }], stopped: false, ms: 1 });
  assert.equal(M.fileBase(ctl), 'INV-A------_C01_SymbolCheck_2026-01-02');
  assert.equal(typeof M.fileBase(null), 'string');
});

async function loadExcelJS() {
  globalThis.window = globalThis; globalThis.self = globalThis;
  const m = await import('../assets/vendor/exceljs.min.js');
  return m.default || m.ExcelJS || globalThis.ExcelJS || m;
}

test('workbookRows and writeWorkbook: Tags, Sheets and About', async () => {
  const w = M.workbookRows(model());
  assert.deepEqual(w.tags.columns, ['Drawing', 'Revision', 'No.', 'Tag', 'Function code', 'Verdict', 'Symbol', 'Tag identifier', 'Size %',
    'Score %', 'Filled', 'Letters', 'Closest in family', 'Closest score %', 'Detail']);
  assert.deepEqual(w.sheets.columns, ['Drawing', 'Revision', 'Family', 'Pre-check', 'Result', 'Reason', 'OK', 'OK, off size', 'Wrong family',
    'Approved exception', 'Needs a look', 'Not checked', 'Time (s)', 'Timed out', 'Pages', 'Tag bubbles', 'Not to standard', 'Not identified', 'Standard']);
  assert.equal(w.tags.rows.length, 11);
  assert.ok(w.tags.rows.every(r => r[0] === 'INV-0001' && r.length === 15));
  assert.equal(w.sheets.rows.length, 3);
  assert.equal(w.sheets.rows[1][5], REASONS.noPdf);
  const about = Object.fromEntries(w.about);
  assert.equal(about['What it checks'], FAMILY_NOTE);
  assert.equal(about.Stopped, 'No');
  assert.equal(about.Saved, 'Nothing from this check is saved in the register.');
  for (const k of ['Report', 'Run', 'Checked by', 'Library', 'Library imported', 'Sheets ticked', 'Checked', 'Not checked']) assert.ok(k in about, k);

  const ExcelJS = await loadExcelJS();
  const buf = await M.writeWorkbook(model(), ExcelJS);
  assert.ok(buf && buf.byteLength > 0);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  assert.deepEqual(wb.worksheets.map(s => s.name), ['Tags', 'Symbols', 'Sheets', 'About']);
  const tags = wb.getWorksheet('Tags');
  assert.equal(tags.views[0].state, 'frozen');
  assert.equal(tags.views[0].ySplit, 1);
  assert.ok(tags.autoFilter);
  assert.ok(wb.getWorksheet('Sheets').autoFilter);
  assert.equal(tags.rowCount, 12);
  assert.equal(tags.getRow(1).font.bold, true);
});

test('hostile input: a model, never a throw; text kept plain for the renderer', async () => {
  const m0 = M.buildReportModel(null);
  assert.deepEqual(m0.sheets, []);
  assert.equal(m0.familyNote, FAMILY_NOTE);
  const odd = { ...checked, result: { ok: true, verdicts: [null, 'x', { tag: '<b>x</b>', fc: 'W', verdict: 'constructor', box: [0, 0, 'x', 1], tagBox: null },
    { tag: '\u0001', verdict: 'ok', box: [1, 1, 2, 2] }] } };
  const m = M.buildReportModel({ run: { outcomes: [null, 'x', odd, 5], stopped: 'x', ms: 'x' }, startedAt: 'nope', checkedBy: 7, library: 'x' });
  const s = m.sheets.find(x => x.drawing === 'INV-0001');
  assert.equal(s.counts['not-checked'], 1);
  assert.equal(s.counts.ok, 1);
  assert.equal(s.rows.length, 2);
  assert.equal(s.rows.find(r => r.kind === 'not-checked').tag, '<b>x</b>');
  assert.equal(s.rows.find(r => r.kind === 'not-checked').userRect, null);
  assert.equal(typeof m.when, 'string');
  assert.equal(m.checkedBy, '');
  const w = M.workbookRows(m);
  assert.ok(!JSON.stringify(w).includes('\\u0001'));
  const ExcelJS = await loadExcelJS();
  assert.equal(await M.writeWorkbook(null, ExcelJS), null);
  assert.equal(await M.writeWorkbook(model(), null), null);
  assert.ok(await M.writeWorkbook(m, ExcelJS));
});

test('buildReportModel and workbookRows: each sheet lists its tag bubbles by kind', () => {
  const bv = (tag, verdict, symbol) => ({ tag, fc: 'ZI', verdict, why: '', symbol, oneOf: [], tagId: '', exceptions: [], sizePct: 100, score: 1,
    filled: false, letters: '', tagBox: [0, 0, 1, 1], box: [0, 0, 1, 1], closest: null, bubble: true });
  const result = { ok: true, ms: 5, timedOut: false, verdicts: [bv('21-ZI-1', 'ok', 'RING'), bv('21-ZI-2', 'ok', 'RING'), bv('21-ZI-3', 'ok', 'HEXAGON')],
    counts: { ok: 3 } };
  const m = model({ outcomes: [{ ...checked, result }, noPdf], stopped: false, ms: 1 });
  assert.deepEqual(m.sheets.map(s => s.bubbleLine), ['Tag bubbles: 2 RING, 1 HEXAGON', '']);
  const w = M.workbookRows(m);
  assert.deepEqual(w.sheets.rows.map(r => r[r.length - 4]), ['2 RING, 1 HEXAGON', '']);   // the last three columns are Not to standard, Not identified, Standard
  assert.equal(model().sheets[0].bubbleLine, '');
});

// ── Symbols found by the sweep ────────────────────────────────────────────
const sy = (name, tag, box, more = {}) => ({ name, tagId: 'W', box, sizePct: 100, score: 0.987, oneOf: [], bubble: false, tag, ...more });
const SYMBOLS = [sy('GADGET', null, [100, 100, 120, 120], { tagId: 'G', oneOf: ['GADGET', 'WIDGET'] }), sy('WIDGET', '21-W-1001', [100, 200, 124, 212]),
  sy('WIDGET', null, [300, 300, 324, 312], { sizePct: 120 })];
// Hand-made symbols stand for a result from before phase 3: the real sheet's shapes do not belong with them.
const { shapes: _shapes, operatorsMarked: _ops, ...PRE_SHAPES } = RESULT;
const withSymbols = { ...checked, result: { ...PRE_SHAPES, symbols: SYMBOLS, skipped: [400, 0, 500, 400] } };

test('buildReportModel: each checked sheet gets its symbol line, untagged symbol boxes and every symbol', () => {
  const m = model({ outcomes: [withSymbols, noPdf], stopped: false, ms: 1 });
  const [s, n] = m.sheets;
  assert.equal(s.symbolLine, '3 standard symbols found, 1 with tags.');
  assert.equal(s.skippedLine, 'Title block not checked.');
  assert.deepEqual(s.symbolRows.map(r => r.name), ['GADGET', 'WIDGET']);
  assert.deepEqual(s.symbolRows[0].userRect, M.toUserRect([100, 100, 120, 120], VT, 3));
  assert.equal(s.allSymbols.length, 3);
  assert.deepEqual(s.allSymbols[0], { page: 1, symbol: 'GADGET', oneOf: 'GADGET, WIDGET', tagId: 'G', sizePct: 100, score: 0.987, tag: '', plain: false,
    toStandard: '', why: '', closest: '', closestScore: null });
  assert.equal(s.allSymbols[1].tag, '21-W-1001');
  assert.deepEqual([n.symbolLine, n.skippedLine, n.symbolRows, n.allSymbols], ['', '', [], []]);
  assert.equal(model().sheets[0].skippedLine, '');
});
test('workbookRows: a Symbols sheet, one row per physical symbol', async () => {
  const m = model({ outcomes: [withSymbols, noPdf], stopped: false, ms: 1 });
  const w = M.workbookRows(m);
  assert.deepEqual(w.symbols.columns, ['Drawing', 'Revision', 'Page', 'Symbol', 'One of', 'Tag identifier', 'Size %', 'Score %', 'Tag', 'Note',
    'To standard?', 'Why', 'Closest', 'Closest score %']);
  assert.deepEqual(w.symbols.rows.map(r => r.slice(0, 10)), [
    ['INV-0001', 'C01', 1, 'GADGET', 'GADGET, WIDGET', 'G', 100, 99, '', ''],
    ['INV-0001', 'C01', 1, 'WIDGET', '', 'W', 100, 99, '21-W-1001', ''],
    ['INV-0001', 'C01', 1, 'WIDGET', '', 'W', 120, 99, '', '']]);
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await M.writeWorkbook(m, ExcelJS));
  assert.deepEqual(wb.worksheets.map(s => s.name), ['Tags', 'Symbols', 'Sheets', 'About']);
  assert.equal(wb.getWorksheet('Symbols').rowCount, 4);
});
test('the print colour for a standard symbol with no tag', () => {
  assert.equal(M.PRINT_COLOURS.symbol, '#546E7A');
});
test('hostile symbols: a model, never a throw; text kept plain', () => {
  const odd = { ...checked, result: { ...RESULT, symbols: [null, 5, { name: '<b>\u0001', tag: null, box: [0, 0, 'x', 1] }, { name: 7 }], skipped: 'x' } };
  const m = model({ outcomes: [odd], stopped: false, ms: 1 });
  assert.equal(m.sheets[0].symbolRows.length, 1); assert.equal(m.sheets[0].symbolRows[0].userRect, null);
  assert.equal(m.sheets[0].skippedLine, '');
  assert.ok(!JSON.stringify(M.workbookRows(m)).includes('\\u0001'));
});
test('report: a sweep cut short says the symbol list is incomplete and does not blame the tags', () => {
  const res = { ...PRE_SHAPES, symbols: SYMBOLS, timedOut: true, sweepTimedOut: true, tagsTimedOut: false };
  const s = model({ outcomes: [{ ...checked, result: res }], stopped: false, ms: 1 }).sheets[0];
  assert.ok(s.symbolLine.endsWith('The time limit was reached: this list is incomplete.'), s.symbolLine);
  assert.equal(s.timedOutLine, '');
  const t = model({ outcomes: [{ ...checked, result: { ...res, tagsTimedOut: true } }], stopped: false, ms: 1 }).sheets[0];
  assert.equal(t.timedOutLine, M.TIMED_OUT);
});
test('sheetFor: tagsLine for printed, checked with no verdicts, and checked with verdicts', () => {
  const none = { ...checked, result: { ok: true, verdicts: [], symbols: [] } };
  assert.equal(model({ outcomes: [{ ...none, precheck: 'printed' }], stopped: false, ms: 1 }).sheets[0].tagsLine, 'Tags not read yet: letters drawn as shapes.');
  assert.equal(model({ outcomes: [none], stopped: false, ms: 1 }).sheets[0].tagsLine, 'No tags read.');
  assert.equal(model().sheets[0].tagsLine, '');
  assert.equal(model().sheets[1].tagsLine, '');
});
test('plain symbols: allSymbols carries plain and the Symbols sheet says check by eye', () => {
  const res = { ok: true, verdicts: [], symbols: [sy('BOX', null, [1, 1, 5, 5], { plain: true }), sy('WIDGET', null, [9, 9, 20, 20])] };
  const m = model({ outcomes: [{ ...checked, precheck: 'printed', result: res }], stopped: false, ms: 1 });
  assert.deepEqual(m.sheets[0].allSymbols.map(s => s.plain), [true, false]);
  const w = M.workbookRows(m);
  assert.equal(w.symbols.columns[9], 'Note');
  assert.deepEqual(w.symbols.rows.map(r => r[9]), ['Plain shape: check by eye', '']);
});

// ── Phase 3: shapes in the report ─────────────────────────────────────────
const SHAPED_RESULT = { ...PRE_SHAPES, operatorsMarked: true,
  symbols: [sy('WIDGET', null, [100, 100, 124, 112]), sy('GADGET', null, [200, 100, 220, 120], { tagId: 'G' }), sy('WIDGET', '21-W-1001', [100, 200, 124, 212])],
  shapes: [
    { id: 0, box: [100, 98, 124, 112], standard: true, why: null, explained: 1, share: null, symbols: [0], operator: { name: 'HANDLE', score: 0.95 }, closest: null },
    { id: 1, box: [200, 100, 228, 120], standard: false, why: 'left-over', explained: 0.8, share: null, symbols: [1], operator: null, closest: { name: 'GADGET', tagId: 'G', score: 0.97, explained: 0.8 } },
    { id: 2, box: [300, 100, 320, 120], standard: false, why: 'no-fit', explained: 0, share: null, symbols: [], operator: null, closest: null },
    { id: 3, box: [400, 100, 420, 120], standard: null, why: 'time', explained: 0, share: null, symbols: [], operator: null, closest: null },
  ] };
const shapedSheet = { ...checked, result: SHAPED_RESULT };

test('workbookRows: the Symbols sheet is one row per shape, not to standard first, with the four new columns', () => {
  const w = M.workbookRows(model({ outcomes: [shapedSheet], stopped: false, ms: 1 }));
  assert.deepEqual(w.symbols.columns, ['Drawing', 'Revision', 'Page', 'Symbol', 'One of', 'Tag identifier', 'Size %', 'Score %', 'Tag', 'Note',
    'To standard?', 'Why', 'Closest', 'Closest score %']);
  const r = w.symbols.rows.map(x => [x[3], x[10], x[11], x[12], x[13]]);
  assert.deepEqual(r, [
    ['GADGET', 'No', 'ink left over', 'GADGET', 97],
    ['', 'No', 'no standard symbol fits', '', ''],
    ['WIDGET + HANDLE', 'Yes', '', '', ''],
    ['', 'Not judged', 'not judged: time limit', '', ''],
    ['WIDGET', '', '', '', '']]);   // a listed symbol in no shape keeps its row
  assert.equal(w.sheets.columns[w.sheets.columns.length - 3], 'Not to standard');
  assert.equal(w.sheets.rows[0][w.sheets.columns.length - 3], 2);
});

test('workbookRows: an old result with no shapes gives the rows of before with the new columns blank', () => {
  const w = M.workbookRows(model({ outcomes: [withSymbols, noPdf], stopped: false, ms: 1 }));
  assert.deepEqual(w.symbols.rows, [
    ['INV-0001', 'C01', 1, 'GADGET', 'GADGET, WIDGET', 'G', 100, 99, '', '', '', '', '', ''],
    ['INV-0001', 'C01', 1, 'WIDGET', '', 'W', 100, 99, '21-W-1001', '', '', '', '', ''],
    ['INV-0001', 'C01', 1, 'WIDGET', '', 'W', 120, 99, '', '', '', '', '', '']]);
  assert.equal(w.sheets.rows[0][w.sheets.columns.length - 2], '');
});

test('buildReportModel: flagged shapes become numbered amber rows, with their boxes', () => {
  const s = model({ outcomes: [shapedSheet], stopped: false, ms: 1 }).sheets[0];
  assert.equal(s.shapeRows.length, 2);
  assert.deepEqual(s.shapeRows.map(r => r.no), [1, 2]);   // symbols first: the tags carry no boxes on the drawing
  assert.deepEqual(s.shapeRows.map(r => r.kind), ['not-standard', 'not-standard']);
  assert.equal(s.shapeRows[0].label, 'Not to standard');
  assert.equal(s.shapeRows[0].detail, 'ink left over; closest: GADGET 97%');
  assert.deepEqual(s.shapeRows[0].userRect, M.toUserRect([200, 100, 228, 120], VT, 3));
  assert.equal(M.PRINT_COLOURS['not-standard'], '#E08E00');
  assert.ok(s.symbolLine.includes('2 shapes not to standard.'));
  assert.deepEqual(model().sheets[0].shapeRows.length >= 0, true);
});

// ── Symbols first (owner, 2026-11-18): standard symbols named in green, shapes not to standard numbered in amber ──
test('buildReportModel, symbols first: a shape line, named standard boxes, flagged shapes numbered from 1', () => {
  const s = model({ outcomes: [shapedSheet], stopped: false, ms: 1 }).sheets[0];
  assert.equal(s.layout, 'symbols');
  assert.equal(s.shapeLine, '1 standard symbol · 2 not to standard · 1 not judged (time limit)');
  assert.deepEqual(s.standardRows.map(r => r.name), ['WIDGET + HANDLE']);
  assert.deepEqual(s.standardRows[0].userRect, M.toUserRect([100, 98, 124, 112], VT, 3));
  assert.deepEqual(s.shapeRows.map(r => r.no), [1, 2]);
  assert.equal(M.PRINT_COLOURS.standard, '#2E7D32');
  const old = model({ outcomes: [withSymbols], stopped: false, ms: 1 }).sheets[0];
  assert.equal(old.layout, 'tags');
  assert.deepEqual(old.standardRows, []);
});

test('buildReportModel, symbols first: counts and a line of reasons for the heading', () => {
  const s = model({ outcomes: [shapedSheet], stopped: false, ms: 1 }).sheets[0];
  assert.deepEqual([s.standardCount, s.notStandardCount, s.notJudgedCount], [1, 2, 1]);
  assert.equal(s.reasonLine, 'Why: 1 ink left over, 1 no standard symbol fits');
});

// ── Task 7 (shape-check redesign): verdicts amber and red in the report ───
const VERDICT_RESULT = { ...PRE_SHAPES, operatorsMarked: true, readFrom: 'paths', printScale: 0.5,
  drawingArea: { box: [10, 10, 490, 390], cuts: [], found: false },
  symbols: [sy('WIDGET', null, [100, 100, 124, 112]), sy('GADGET', null, [200, 100, 220, 120], { tagId: 'G' })],
  shapes: [
    { id: 0, box: [100, 98, 124, 112], verdict: 'standard', standard: true, reason: null, symbols: [0], operator: null, closest: null },
    { id: 1, box: [200, 100, 228, 120], verdict: 'not-standard', standard: false, reason: { kind: 'differs', name: 'GADGET', pct: 92 }, symbols: [1], operator: null, closest: { name: 'GADGET', score: 0.92 } },
    { id: 2, box: [300, 100, 320, 120], verdict: 'not-standard', standard: false, reason: { kind: 'size', name: 'WIDGET', pct: 70 }, symbols: [], operator: null, closest: null },
    { id: 3, box: [400, 100, 420, 120], verdict: 'not-identified', standard: false, reason: null, symbols: [], operator: null, closest: null },
    { id: 4, box: [400, 200, 420, 220], verdict: 'not-identified', standard: false, reason: null, symbols: [], operator: null, closest: null },
  ] };
const verdictSheet = { ...checked, result: VERDICT_RESULT };

test('buildReportModel, verdicts: amber rows only, red as boxes with no label, the heading is markLine', async () => {
  const { markLine, reasonText } = await import('../assets/js/pid-symbol-check-view.js');
  const s = model({ outcomes: [verdictSheet], stopped: false, ms: 1 }).sheets[0];
  assert.equal(s.shapeLine, markLine(VERDICT_RESULT));
  assert.ok(s.shapeLine.includes('2 not identified'));
  assert.deepEqual(s.shapeRows.map(r => r.no), [1, 2]);
  assert.deepEqual(s.shapeRows.map(r => r.kind), ['not-standard', 'not-standard']);
  assert.deepEqual(s.shapeRows.map(r => r.detail), [reasonText(VERDICT_RESULT.shapes[1]), reasonText(VERDICT_RESULT.shapes[2])]);
  assert.equal(s.shapeRows[0].detail, 'drawn differently from GADGET (92% alike)');
  assert.equal(s.redRows.length, 2);
  assert.deepEqual(Object.keys(s.redRows[0]), ['userRect']);
  assert.deepEqual(s.redRows[0].userRect, M.toUserRect([400, 100, 420, 120], VT, 3));
  assert.equal(s.notIdentifiedCount, 2);
  assert.equal(s.notStandardCount, 2);
  assert.equal(s.areaRect, null);   // frame not found: the page edge is not drawn, as on screen
  const found = model({ outcomes: [{ ...verdictSheet, result: { ...VERDICT_RESULT, drawingArea: { box: [10, 10, 490, 390], cuts: [], found: true } } }], stopped: false, ms: 1 }).sheets[0];
  assert.deepEqual(found.areaRect, M.toUserRect([10, 10, 490, 390], VT, 0));
  assert.equal(M.PRINT_COLOURS['not-identified'], '#C62828');
});

test('buildReportModel: a result with no verdicts keeps the shape model of before, with no red and no area', () => {
  const s = model({ outcomes: [shapedSheet], stopped: false, ms: 1 }).sheets[0];
  assert.deepEqual(s.redRows, []);
  assert.equal(s.areaRect, null);
  assert.equal(s.notIdentifiedCount, 0);
  assert.equal(s.shapeLine, '1 standard symbol · 2 not to standard · 1 not judged (time limit)');
});

test('workbookRows, verdicts: Sheets gains Not identified after Not to standard; red shapes with no symbol have no Symbols row', () => {
  const w = M.workbookRows(model({ outcomes: [verdictSheet], stopped: false, ms: 1 }));
  const n = w.sheets.columns.length;
  assert.deepEqual(w.sheets.columns.slice(-3, -1), ['Not to standard', 'Not identified']);
  assert.deepEqual(w.sheets.rows[0].slice(-3, -1), [2, 2]);
  assert.equal(w.symbols.rows.length, 3);   // two amber and one standard, no red
  assert.ok(w.symbols.rows.every(r => r[10] !== 'Not identified'));
  const old = M.workbookRows(model({ outcomes: [shapedSheet], stopped: false, ms: 1 }));
  assert.equal(old.sheets.rows[0][n - 2], '');
});

test('buildReportModel, verdicts: the heading keeps the not judged count and the operators note', async () => {
  const { markLine, OPERATORS_NOTE } = await import('../assets/js/pid-symbol-check-view.js');
  const late = { id: 5, box: [50, 300, 70, 320], verdict: 'not-judged', standard: null, reason: null, symbols: [], operator: null, closest: null };
  const r = { ...VERDICT_RESULT, operatorsMarked: false, shapes: [...VERDICT_RESULT.shapes, late] };
  const s = model({ outcomes: [{ ...checked, result: r }], stopped: false, ms: 1 }).sheets[0];
  assert.equal(s.shapeLine, markLine(r) + ' · 1 not judged (time limit). ' + OPERATORS_NOTE);
  const t = model({ outcomes: [{ ...checked, result: { ...VERDICT_RESULT, operatorsMarked: false } }], stopped: false, ms: 1 }).sheets[0];
  assert.equal(t.shapeLine, markLine({ ...VERDICT_RESULT }) + '. ' + OPERATORS_NOTE);
  assert.equal(model({ outcomes: [verdictSheet], stopped: false, ms: 1 }).sheets[0].shapeLine, markLine(VERDICT_RESULT));
});

// Legend rules, Task 7 (2026-11-18): a green shape with parts is named by them; one without reads as before.
test('buildReportModel: a standard shape with parts is named by its parts', () => {
  const shapes = SHAPED_RESULT.shapes.map(s => (s.standard === true ? { ...s, parts: [{ name: 'WIDGET', role: 'body' }, { name: 'HANDLE', role: 'attachment' }, { name: 'FLANGE', role: 'attachment' }, { name: 'FLANGE', role: 'attachment' }] } : s));
  const s = model({ outcomes: [{ ...checked, result: { ...SHAPED_RESULT, shapes } }], stopped: false, ms: 1 }).sheets[0];
  assert.deepEqual(s.standardRows.map(r => r.name), ['WIDGET + HANDLE + FLANGE ×2']);
  const w = M.workbookRows(model({ outcomes: [{ ...checked, result: { ...SHAPED_RESULT, shapes } }], stopped: false, ms: 1 }));
  assert.ok(w.symbols.rows.some(x => x[3] === 'WIDGET + HANDLE + FLANGE ×2'), JSON.stringify(w.symbols.rows.map(x => x[3])));
});

test('the standard each sheet was checked against: on its row, and the distinct ones listed for the front page', () => {
  const o1 = { ...RUN.outcomes[0], standard: 'Checked against: P 2' }, o2 = { ...RUN.outcomes[0], drawing: 'INV-0009', standard: 'Checked against: P 1' }, o3 = { ...RUN.outcomes[0], drawing: 'INV-0010', standard: 'Checked against: P 2' };
  const m = model({ ...RUN, outcomes: [o1, o2, o3] });
  assert.deepEqual(m.sheets.map(s => s.standard), ['Checked against: P 2', 'Checked against: P 1', 'Checked against: P 2']);
  assert.deepEqual(m.standards, ['Checked against: P 2', 'Checked against: P 1']);
  assert.deepEqual(model().standards, []);
  assert.equal(model().sheets[0].standard, '');
  const rows = M.workbookRows(m).sheets;
  assert.ok(rows.columns.includes('Standard'));
  assert.equal(rows.rows[1][rows.columns.indexOf('Standard')], 'Checked against: P 1');
});
