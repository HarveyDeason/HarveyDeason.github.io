import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadVendoredPdfjs, openPdf } from '../scripts/pdfjs-node.mjs';
import { tinyPdf, TINY_CONTENT, TINY_FORM } from './fixtures/tiny-pdf.js';
import { sheetPdf, SHEETS, SHX_AUTHOR } from './fixtures/sheet-pdf.js';

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

test('comments arrive as contentsObj.str, with the author in titleObj.str and a four-number rect', async () => {
  const doc = await openPdf(sheetPdf(SHEETS.plotted));
  const ann = await (await doc.getPage(1)).getAnnotations();
  assert.equal(ann.length, 3);
  assert.equal(ann[0].contents, undefined); // this build has no plain `contents`
  assert.deepEqual(ann.map(a => a.contentsObj.str), ['\\pxqc;{\\W0.85;M}', '21-XX-2001', 'change 21-XX-9999']);
  assert.deepEqual(ann.map(a => a.titleObj.str), [SHX_AUTHOR, SHX_AUTHOR, 'A Reviewer']);
  assert.deepEqual(ann.map(a => a.subtype), ['Square', 'Square', 'Text']);
  assert.deepEqual(Array.from(ann[1].rect), [10, 20, 60, 30]);
  assert.deepEqual(await (await doc.getPage(2)).getAnnotations(), []);
});

test('getMetadata().info carries Creator and Producer, and leaves them out when the PDF records none', async () => {
  const info = (await (await openPdf(sheetPdf(SHEETS.plotted))).getMetadata()).info;
  assert.deepEqual([info.Creator, info.Producer], ['Invented CAD 1.0', 'Invented Plotter (v2)']);
  const bare = (await (await openPdf(sheetPdf({ pages: [{ text: ['X'] }] }))).getMetadata()).info;
  assert.deepEqual([bare.Creator, bare.Producer], [undefined, undefined]);
});

test('a page with no text layer gives no text items, and the viewport gives the sheet size in points', async () => {
  const doc = await openPdf(sheetPdf(SHEETS.plotted));
  const items = (await (await doc.getPage(1)).getTextContent()).items;
  assert.equal(items.map(i => i.str).join(' ') + '\n', '21-XX-1001 TITLE BLOCK 21-YY 1002\n');
  const two = await doc.getPage(2);
  assert.deepEqual((await two.getTextContent()).items, []);
  const vp = two.getViewport({ scale: 1 });
  assert.deepEqual([vp.width, vp.height], [1191, 842]);
});

test('getDocument empties the bytes it is handed, so a caller that needs them passes a copy', async () => {
  const bytes = sheetPdf(SHEETS.printed);
  assert.ok(bytes.byteLength > 0);
  await openPdf(bytes);
  assert.equal(bytes.byteLength, 0);
});
