import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INTAKE_TEMPLATE_VERSION, INTAKE_COLUMNS, buildIntakeTemplateModel, parseIntakeWorkbook,
  reviewRows,
} from '../assets/js/hub-intake.js';
import { renderWorkbook } from '../assets/js/xlsx-render.js';

async function loadExcelJS() {
  globalThis.window = globalThis; globalThis.self = globalThis;
  const m = await import('../assets/vendor/exceljs.min.js');
  return m.default || m.ExcelJS || globalThis.ExcelJS || m;
}

const STATE = {
  products: [
    { id: 'p1', name: 'Pump House', type: 'OSB item', pidDrawings: ['D-100'] },
    { id: 'p2', name: 'Inlet Works', type: 'Standard product', pidDrawings: [] },
  ],
  lists: { categories: ['New valve', 'Pipework change'], sources: ['Site feedback'] },
  comments: [],
};

test('template columns split affectedTypes into three Yes/No columns', () => {
  const keys = INTAKE_COLUMNS.map(c => c.key);
  assert.deepEqual(keys, ['product', 'affPid', 'affModel', 'affSheets', 'category',
    'source', 'dateRaised', 'raisedBy', 'priority', 'description']);
});

test('filename is stable and dateless (ACC versions by filename)', () => {
  const m = buildIntakeTemplateModel(STATE, ['p1'], '2026-07-31T09:00:00.000Z');
  assert.equal(m.filename, 'Comment Intake Template.xlsx');
});

test('single product is pre-filled and its drawings are listed', () => {
  const m = buildIntakeTemplateModel(STATE, ['p1'], '2026-07-31T09:00:00.000Z');
  const sheet = m.sheets.find(s => s.name === 'Comments');
  assert.equal(sheet.prefill.product, 'Pump House');
  const lists = m.sheets.find(s => s.name === 'Lists');
  assert.ok(lists.rows.some(r => r.includes('D-100')), 'linked drawings shown to the site team');
});

test('several products restrict the dropdown to just those', () => {
  const m = buildIntakeTemplateModel(STATE, ['p1', 'p2'], '2026-07-31T09:00:00.000Z');
  const sheet = m.sheets.find(s => s.name === 'Comments');
  assert.equal(sheet.prefill.product, undefined);
  const productList = m.sheets.find(s => s.name === 'Lists').lists.products;
  assert.deepEqual(productList.map(p => p.name), ['Pump House', 'Inlet Works']);
});

test('lists sheet carries stable product IDs, not just names', () => {
  const m = buildIntakeTemplateModel(STATE, ['p1'], '2026-07-31T09:00:00.000Z');
  const products = m.sheets.find(s => s.name === 'Lists').lists.products;
  assert.deepEqual(products, [{ id: 'p1', name: 'Pump House' }]);
});

test('lists sheet stamps the template version so drift is detectable', () => {
  const m = buildIntakeTemplateModel(STATE, ['p1'], '2026-07-31T09:00:00.000Z');
  const lists = m.sheets.find(s => s.name === 'Lists');
  assert.equal(lists.meta.templateVersion, INTAKE_TEMPLATE_VERSION);
});

test('category and source dropdowns come from the hub lists', () => {
  const m = buildIntakeTemplateModel(STATE, ['p1'], '2026-07-31T09:00:00.000Z');
  const lists = m.sheets.find(s => s.name === 'Lists').lists;
  assert.deepEqual(lists.categories, ['New valve', 'Pipework change']);
  assert.deepEqual(lists.sources, ['Site feedback']);
});

test('template sheet round-trips with dropdowns and a hidden lists sheet', async () => {
  const ExcelJS = await loadExcelJS();
  const model = buildIntakeTemplateModel(STATE, ['p1'], '2026-07-31T09:00:00.000Z');
  const buf = await renderWorkbook(model, ExcelJS, {});

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);

  const ws = wb.getWorksheet('Comments');
  const header = ws.getRow(1).values.slice(1);
  assert.deepEqual(header, INTAKE_COLUMNS.map(c => c.header));

  const lists = wb.getWorksheet('Lists');
  assert.ok(lists, 'lists sheet is present');
  assert.notEqual(lists.state, 'visible', 'lists sheet is hidden from the site team');

  // the category cell on the first data row carries a list validation
  const catIndex = INTAKE_COLUMNS.findIndex(c => c.key === 'category') + 1;
  const dv = ws.getCell(2, catIndex).dataValidation;
  assert.equal(dv && dv.type, 'list');
});

test('single-product template pre-fills the product column', async () => {
  const ExcelJS = await loadExcelJS();
  const model = buildIntakeTemplateModel(STATE, ['p1'], '2026-07-31T09:00:00.000Z');
  const buf = await renderWorkbook(model, ExcelJS, {});
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('Comments');
  assert.equal(ws.getCell(2, 1).value, 'Pump House');
});

// --- parseIntakeWorkbook (Task 3): reading a returned intake sheet back in ---

test('parses rows by header NAME, tolerating reordered columns', async () => {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Comments');
  ws.addRow(['Description', 'Product', 'Category']);      // deliberately reordered, subset
  ws.addRow(['Valve leaking on line 3', 'Pump House', 'New valve']);
  const parsed = parseIntakeWorkbook(wb);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].description, 'Valve leaking on line 3');
  assert.equal(parsed.rows[0].product, 'Pump House');
});

test('skips entirely blank rows without comment', async () => {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Comments');
  ws.addRow(INTAKE_COLUMNS.map(c => c.header));
  ws.addRow([]);
  ws.addRow(['Pump House', 'Yes', 'No', 'No', 'New valve', 'Site feedback',
             '2026-07-20', 'Site foreman', 'high', 'Valve leaking']);
  ws.addRow([]);
  assert.equal(parseIntakeWorkbook(wb).rows.length, 1);
});

test('recombines the three Yes/No columns into affectedTypes', async () => {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Comments');
  ws.addRow(INTAKE_COLUMNS.map(c => c.header));
  ws.addRow(['Pump House', 'Yes', 'No', 'yes', 'New valve', 'Site feedback',
             '2026-07-20', 'Site foreman', 'high', 'Valve leaking']);
  assert.deepEqual(parseIntakeWorkbook(wb).rows[0].affectedTypes, ['P&ID', 'Drawing sheets']);
});

test('all three affected columns blank yields an empty array, not a failure', async () => {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Comments');
  ws.addRow(INTAKE_COLUMNS.map(c => c.header));
  ws.addRow(['Pump House', '', '', '', 'New valve', 'Site feedback',
             '2026-07-20', 'Site foreman', 'high', 'Valve leaking']);
  assert.deepEqual(parseIntakeWorkbook(wb).rows[0].affectedTypes, []);
});

test('reads the embedded product IDs and template version from the lists sheet', async () => {
  const ExcelJS = await loadExcelJS();
  const model = buildIntakeTemplateModel(STATE, ['p1'], '2026-07-31T09:00:00.000Z');
  const buf = await renderWorkbook(model, ExcelJS, {});
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const parsed = parseIntakeWorkbook(wb);
  assert.equal(parsed.templateVersion, INTAKE_TEMPLATE_VERSION);
  assert.deepEqual(parsed.products, [{ id: 'p1', name: 'Pump House' }]);
});

test('a sheet with no recognisable header row throws a clear error', async () => {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Comments').addRow(['random', 'nonsense']);
  assert.throws(() => parseIntakeWorkbook(wb), /header/i);
});

test('tolerates a title row pasted above the real header, and stray header whitespace/case', async () => {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Comments');
  ws.addRow(['Site Comments - Pump House Batch 1']);
  ws.addRow([' product ', 'DESCRIPTION', ' Category ']);
  ws.addRow(['Pump House', 'Valve leaking', 'New valve']);
  const parsed = parseIntakeWorkbook(wb);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].product, 'Pump House');
  assert.equal(parsed.rows[0].description, 'Valve leaking');
});

test('accepts loosely-formatted Yes/No values: Y, TRUE, x, blank', async () => {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Comments');
  ws.addRow(INTAKE_COLUMNS.map(c => c.header));
  ws.addRow(['Pump House', 'Y', 'TRUE', 'x', 'New valve', 'Site feedback',
             '2026-07-20', 'Site foreman', 'high', 'Valve leaking']);
  assert.deepEqual(parseIntakeWorkbook(wb).rows[0].affectedTypes, ['P&ID', 'Model', 'Drawing sheets']);
});

test('a Date-typed cell in the date-raised column comes back as an ISO YYYY-MM-DD string', async () => {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Comments');
  ws.addRow(INTAKE_COLUMNS.map(c => c.header));
  const r = ws.addRow(['Pump House', 'Yes', 'No', 'No', 'New valve', 'Site feedback',
             new Date(Date.UTC(2026, 6, 20)), 'Site foreman', 'high', 'Valve leaking']);
  const parsed = parseIntakeWorkbook(wb);
  assert.equal(parsed.rows[0].dateRaised, '2026-07-20');
});

// --- Date Raised coercion: a real returned file commonly carries an Excel
// serial number in this column (not a Date object), even when the cell was
// rendered/formatted as a date — see xlsx-render.js's dateCol numFmt and the
// full round-trip test below, which is what actually exercises that path.

test('an Excel serial number in the date-raised column converts to the right ISO date', async () => {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Comments');
  ws.addRow(INTAKE_COLUMNS.map(c => c.header));
  // 46232 days after the Excel epoch (1899-12-30, verified independently):
  // 1899-12-30 + 46232 days = 2026-07-29.
  ws.addRow(['Pump House', 'Yes', 'No', 'No', 'New valve', 'Site feedback',
             46232, 'Site foreman', 'high', 'Valve leaking']);
  const parsed = parseIntakeWorkbook(wb);
  assert.equal(parsed.rows[0].dateRaised, '2026-07-29');
});

test('a Date object in the date-raised column still works', async () => {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Comments');
  ws.addRow(INTAKE_COLUMNS.map(c => c.header));
  ws.addRow(['Pump House', 'Yes', 'No', 'No', 'New valve', 'Site feedback',
             new Date(Date.UTC(2026, 6, 29)), 'Site foreman', 'high', 'Valve leaking']);
  const parsed = parseIntakeWorkbook(wb);
  assert.equal(parsed.rows[0].dateRaised, '2026-07-29');
});

test('a UK-formatted date string parses day-first, not US month-first', async () => {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Comments');
  ws.addRow(INTAKE_COLUMNS.map(c => c.header));
  // 29/07/2026 must read as 29 July, not get silently reinterpreted
  // month-first (which for an ambiguous UK date corrupts the value instead
  // of failing loudly). Assert the month explicitly, not just the ISO string.
  ws.addRow(['Pump House', 'Yes', 'No', 'No', 'New valve', 'Site feedback',
             '29/07/2026', 'Site foreman', 'high', 'Valve leaking']);
  const parsed = parseIntakeWorkbook(wb);
  assert.equal(parsed.rows[0].dateRaised, '2026-07-29');
  assert.equal(parsed.rows[0].dateRaised.slice(5, 7), '07', 'month must be July, not swapped with day');
});

test('an out-of-range date serial and unparseable junk both yield an empty string', async () => {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Comments');
  ws.addRow(INTAKE_COLUMNS.map(c => c.header));
  ws.addRow(['Pump House', 'Yes', 'No', 'No', 'New valve', 'Site feedback',
             500000, 'Site foreman', 'high', 'Valve leaking']);
  ws.addRow(['Inlet Works', 'No', 'No', 'No', 'New valve', 'Site feedback',
             'not a date', 'Site foreman', 'low', 'Something else']);
  const parsed = parseIntakeWorkbook(wb);
  assert.equal(parsed.rows[0].dateRaised, '');
  assert.equal(parsed.rows[1].dateRaised, '');
});

test('full round trip: a rendered template cell written as a date and reloaded parses to the right ISO date', async () => {
  const ExcelJS = await loadExcelJS();
  const model = buildIntakeTemplateModel(STATE, ['p1'], '2026-07-31T09:00:00.000Z');
  const buf = await renderWorkbook(model, ExcelJS, {});

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('Comments');
  const dateCol = INTAKE_COLUMNS.findIndex(c => c.key === 'dateRaised') + 1;
  const descCol = INTAKE_COLUMNS.findIndex(c => c.key === 'description') + 1;
  ws.getRow(2).getCell(dateCol).value = new Date('2026-07-29T00:00:00Z');
  ws.getRow(2).getCell(descCol).value = 'Handrail missing';

  const buf2 = await wb.xlsx.writeBuffer();
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(buf2);
  const parsed = parseIntakeWorkbook(wb2);
  assert.equal(parsed.rows[0].dateRaised, '2026-07-29');
});

test('a returned workbook with no Lists sheet at all parses gracefully', async () => {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Comments');
  ws.addRow(INTAKE_COLUMNS.map(c => c.header));
  ws.addRow(['Pump House', 'Yes', 'No', 'No', 'New valve', 'Site feedback',
             '2026-07-20', 'Site foreman', 'high', 'Valve leaking']);
  const parsed = parseIntakeWorkbook(wb);
  assert.deepEqual(parsed.products, []);
  assert.equal(parsed.templateVersion, undefined);
});

// --- reviewRows (Task 4): turning raw parsed rows into a reviewable list ---

const parsedRow = (over = {}) => ({
  product: 'Pump House', affectedTypes: ['P&ID'], category: 'New valve',
  source: 'Site feedback', dateRaised: '2026-07-20', raisedBy: 'Site foreman',
  priority: 'high', description: 'Valve leaking on line 3', ...over,
});

test('resolves the product by embedded ID without any name matching', () => {
  const parsed = { products: [{ id: 'p1', name: 'Renamed Since' }], rows: [parsedRow({ product: 'Renamed Since' })] };
  const rows = reviewRows(parsed, STATE, '2026-07-31');
  assert.equal(rows[0].productId, 'p1');
  assert.equal(rows[0].status, 'ok');
});

test('missing description is a hard error that cannot be accepted', () => {
  const parsed = { products: [], rows: [parsedRow({ description: '   ' })] };
  const rows = reviewRows(parsed, STATE, '2026-07-31');
  assert.equal(rows[0].status, 'error');
  assert.ok(rows[0].issues.some(i => i.field === 'description' && i.level === 'error'));
});

test('missing date defaults to today and missing priority to medium', () => {
  const parsed = { products: [], rows: [parsedRow({ dateRaised: '', priority: '' })] };
  const rows = reviewRows(parsed, STATE, '2026-07-31');
  assert.equal(rows[0].values.dateRaised, '2026-07-31');
  assert.equal(rows[0].values.priority, 'medium');
});

test('an unknown category warns and offers to add it, never blocks', () => {
  const parsed = { products: [], rows: [parsedRow({ category: 'Coating defect' })] };
  const rows = reviewRows(parsed, STATE, '2026-07-31');
  const issue = rows[0].issues.find(i => i.field === 'category');
  assert.equal(issue.level, 'warn');
  assert.equal(issue.fix, 'add-to-list');
  assert.notEqual(rows[0].status, 'error');
});

test('an unresolvable product warns rather than erroring', () => {
  const parsed = { products: [], rows: [parsedRow({ product: 'Nowhere Works' })] };
  const rows = reviewRows(parsed, STATE, '2026-07-31');
  assert.equal(rows[0].productId, null);
  assert.equal(rows[0].status, 'warn');
});

// Advisory only: "Replace valve V-101" and "Replace valve V-102" are one
// character apart and completely different comments.
test('a near-identical open comment on the same product is flagged, not blocked', () => {
  const state = { ...STATE, comments: [
    { id: 'c1', ref: 'HUB-0007', productIds: ['p1'], status: 'open',
      description: 'Valve leaking on line 3.' }] };
  const parsed = { products: [{ id: 'p1', name: 'Pump House' }], rows: [parsedRow()] };
  const rows = reviewRows(parsed, state, '2026-07-31');
  assert.equal(rows[0].duplicateOf, 'HUB-0007');
  assert.notEqual(rows[0].status, 'error', 'duplicates are advisory');
});

test('a similar CLOSED comment is not flagged as a duplicate', () => {
  const state = { ...STATE, comments: [
    { id: 'c1', ref: 'HUB-0007', productIds: ['p1'], status: 'closed',
      description: 'Valve leaking on line 3.' }] };
  const parsed = { products: [{ id: 'p1', name: 'Pump House' }], rows: [parsedRow()] };
  assert.equal(reviewRows(parsed, state, '2026-07-31')[0].duplicateOf, null);
});

test('similar text on a DIFFERENT product is not a duplicate', () => {
  const state = { ...STATE, comments: [
    { id: 'c1', ref: 'HUB-0007', productIds: ['p2'], status: 'open',
      description: 'Valve leaking on line 3.' }] };
  const parsed = { products: [{ id: 'p1', name: 'Pump House' }], rows: [parsedRow()] };
  assert.equal(reviewRows(parsed, state, '2026-07-31')[0].duplicateOf, null);
});
