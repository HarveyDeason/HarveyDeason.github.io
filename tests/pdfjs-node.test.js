import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadVendoredPdfjs, openPdf } from '../scripts/pdfjs-node.mjs';
import { tinyPdf, TINY_CONTENT, TINY_FORM } from './fixtures/tiny-pdf.js';

async function tinyPage() {
  const pdfjsLib = loadVendoredPdfjs();
  const page = await (await openPdf(tinyPdf(TINY_CONTENT, TINY_FORM))).getPage(1);
  return { pdfjsLib, OPS: pdfjsLib.OPS, page, ol: await page.getOperatorList() };
}

test('the vendored pdf.js loads in Node', () => {
  const pdfjsLib = loadVendoredPdfjs();
  assert.equal(pdfjsLib.version, '3.11.174');
  assert.equal(typeof pdfjsLib.OPS.constructPath, 'number');
  assert.equal(loadVendoredPdfjs(), pdfjsLib); // cached
});

test('constructPath args are [ops, coords, minMax], painted by a separate operator', async () => {
  const { OPS, ol } = await tinyPage();
  const i = ol.fnArray.indexOf(OPS.constructPath);
  const args = ol.argsArray[i];
  assert.equal(args.length, 3);
  assert.deepEqual(Array.from(args[0]), [OPS.moveTo, OPS.lineTo]);
  assert.deepEqual(Array.from(args[1]), [10, 10, 60, 10]);
  assert.equal(ol.fnArray[i + 1], OPS.stroke);
});

test('greys arrive as 0-255 RGB and a form carries its matrix first', async () => {
  const { OPS, ol } = await tinyPage();
  assert.deepEqual(Array.from(ol.argsArray[ol.fnArray.indexOf(OPS.setStrokeRGBColor)]), [128, 128, 128]);
  assert.deepEqual(Array.from(ol.argsArray[ol.fnArray.indexOf(OPS.paintFormXObjectBegin)][0]), [1, 0, 0, 1, 100, 0]);
});

test('the scale-1 viewport transform flips to a top-left origin', async () => {
  const { page } = await tinyPage();
  assert.deepEqual(page.getViewport({ scale: 1 }).transform, [1, 0, 0, -1, 0, 100]);
});

test('text items carry str, transform, width and height', async () => {
  const { page } = await tinyPage();
  const item = (await page.getTextContent()).items.find(i => i.str === 'HELLO');
  assert.deepEqual(item.transform, [10, 0, 0, 10, 12, 85]);
  assert.equal(item.height, 10);
  assert.ok(item.width > 20 && item.width < 45);
});
