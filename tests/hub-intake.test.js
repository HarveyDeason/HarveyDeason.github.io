import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INTAKE_TEMPLATE_VERSION, INTAKE_COLUMNS, buildIntakeTemplateModel,
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
