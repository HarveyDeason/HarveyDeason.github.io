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
  const m = model({ outcomes: [{ ...checked, pages: 3, result: { ...RESULT, timedOut: true } }], stopped: false, ms: 1 });
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
    'Approved exception', 'Needs a look', 'Not checked', 'Time (s)', 'Timed out', 'Pages', 'Tag bubbles']);
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
  assert.deepEqual(wb.worksheets.map(s => s.name), ['Tags', 'Sheets', 'About']);
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
  assert.deepEqual(w.sheets.rows.map(r => r[r.length - 1]), ['2 RING, 1 HEXAGON', '']);
  assert.equal(model().sheets[0].bubbleLine, '');
});
