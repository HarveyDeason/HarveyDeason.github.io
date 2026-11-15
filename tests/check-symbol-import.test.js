import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { compareNames, searchRanks, insideRepo, importLegend, bubbleReport } from '../scripts/check-symbol-import.mjs';
import { parseLibrary, buildLibrary, readLegendPage } from '../assets/js/pid-symbols.js';
import { bubblePage } from './fixtures/symbol-table.js';
import { tinyPdf, TINY_CONTENT, TINY_FORM } from './fixtures/tiny-pdf.js';

test('compareNames: a multiset comparison that ignores case and spacing', () => {
  assert.deepEqual(compareNames(['Round  Widget', 'LAST WIDGET', 'LAST WIDGET'], ['ROUND WIDGET', 'LAST WIDGET', 'LOST WIDGET']),
    { missing: ['LOST WIDGET'], extra: ['LAST WIDGET'] });
  assert.deepEqual(compareNames(null, undefined), { missing: [], extra: [] });
});

test('searchRanks: the 1-based place of the expected symbol, 0 when absent', () => {
  const lib = parseLibrary(JSON.stringify({ version: 1, symbols: [{ name: 'ROUND WIDGET' }, { name: 'WIDGET' }] })).library;
  assert.deepEqual(searchRanks(lib, [{ q: 'widget', expect: 'round widget' }, { q: 'widget', expect: 'NOPE' }, null]),
    [{ q: 'widget', expect: 'round widget', rank: 2 }, { q: 'widget', expect: 'NOPE', rank: 0 }]);
});

test('insideRepo: true for any path under the repository', () => {
  assert.equal(insideRepo(fileURLToPath(new URL('../assets/js/out.json', import.meta.url))), true);
  assert.equal(insideRepo(fileURLToPath(new URL('../../elsewhere/out.json', import.meta.url))), false);
});

test('importLegend: a PDF with no ruled tables gives pages and an empty library, without throwing', async () => {
  const r = await importLegend(tinyPdf(TINY_CONTENT, TINY_FORM));
  assert.equal(r.pages.length, 1);
  assert.deepEqual(r.library.symbols, []);
});

test('bubbleReport: the count of tag bubbles always, their names only when verbose', () => {
  const lib = buildLibrary([readLegendPage(bubblePage())], 'T');
  assert.deepEqual(bubbleReport(lib, false), ['tag bubbles 4']);
  assert.deepEqual(bubbleReport(lib, true), ['tag bubbles 4', '  PLAIN RING', '  BARRED RING', '  BOXED RING', '  BOXED BARRED RING']);
  assert.deepEqual(bubbleReport(null, true), ['tag bubbles 0']);
});
