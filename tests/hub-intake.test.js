import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INTAKE_TEMPLATE_VERSION, INTAKE_COLUMNS, buildIntakeTemplateModel,
} from '../assets/js/hub-intake.js';

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
