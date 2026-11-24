import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadVendoredUmd, openPdf } from '../scripts/pdfjs-node.mjs';
import { titleBlockNumber, pageNumberItems, splitPdfPages, binderRowName, duplicateNames, namesAlreadyIn } from '../assets/js/pid-binder.js';

// Invented sheets only: every drawing number here is made up.
const PDFLib = loadVendoredUmd('pdf-lib.min.js');
const A3 = [1191, 842];
const item = (str, x, y, size = 10) => ({ str, x, y, size });

async function binderBytes(pages) {
  const doc = await PDFLib.PDFDocument.create();
  const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
  for (const draw of pages) {
    const page = doc.addPage(A3);
    draw(page, font);
  }
  return doc.save();
}
async function textOf(bytes) {
  const doc = await openPdf(new Uint8Array(bytes));
  const page = await doc.getPage(1);
  return { pages: doc.numPages, text: (await page.getTextContent()).items.map(i => i.str).join(' ') };
}
const sheet = n => (page, font) => {
  page.drawText('SHEET ' + n, { x: 500, y: 420, size: 14, font });
  page.drawText('INV3-ABCD-01-XX-G-P-400' + n, { x: 1040, y: 40, size: 12, font });
  page.drawText('INV3-ABCD-01-XX-G-P-4009 PIPEWORK', { x: 1040, y: 600, size: 9, font });   // a cross-reference, upper right
};

test('titleBlockNumber picks the number nearest the bottom-right corner', () => {
  assert.equal(titleBlockNumber([
    item('INV1-ABCD-01-XX-G-P-4102', 0.89, 0.32),
    item('INV1-ABCD-01-XX-G-P-4101', 0.90, 0.92, 12),
    item('INV1-ABCD-01-XX-G-P-4103', 0.89, 0.34),
  ]), 'INV1-ABCD-01-XX-G-P-4101');
});

test('titleBlockNumber ignores numbers outside the lower-right quarter', () => {
  assert.equal(titleBlockNumber([item('INV1-ABCD-01-XX-G-P-4102', 0.89, 0.32), item('INV1-ABCD-01-XX-G-P-4104', 0.03, 0.95)]), null);
});

test('titleBlockNumber finds a number inside a longer string', () => {
  assert.equal(titleBlockNumber([item('REFER TO INV2-WXYZ-52-TT-G-P-4001 FOR DETAILS', 0.8, 0.8)]), 'INV2-WXYZ-52-TT-G-P-4001');
});

test('titleBlockNumber breaks a tie on distance with the larger text', () => {
  assert.equal(titleBlockNumber([item('INV1-ABCD-01-XX-G-P-4105', 0.9, 0.9, 8), item('INV1-ABCD-01-XX-G-P-4106', 0.9, 0.905, 14)]),
    'INV1-ABCD-01-XX-G-P-4106');
});

test('titleBlockNumber returns null for no items', () => {
  assert.equal(titleBlockNumber([]), null);
  assert.equal(titleBlockNumber(null), null);
});

test('splitPdfPages gives one one-page PDF per page, each with its own text', async () => {
  const parts = await splitPdfPages(await binderBytes([sheet(1), sheet(2), sheet(3)]), PDFLib);
  assert.equal(parts.length, 3);
  for (let n = 1; n <= 3; n++) {
    const { pages, text } = await textOf(parts[n - 1]);
    assert.equal(pages, 1);
    assert.match(text, new RegExp('SHEET ' + n));
    for (const other of [1, 2, 3].filter(o => o !== n)) assert.doesNotMatch(text, new RegExp('SHEET ' + other));
  }
});

test('pageNumberItems + titleBlockNumber read each split page\'s title block', async () => {
  const parts = await splitPdfPages(await binderBytes([sheet(1), sheet(2), sheet(3)]), PDFLib);
  const found = [];
  for (const bytes of parts) found.push(titleBlockNumber(await pageNumberItems(await (await openPdf(new Uint8Array(bytes))).getPage(1))));
  assert.deepEqual(found, ['INV3-ABCD-01-XX-G-P-4001', 'INV3-ABCD-01-XX-G-P-4002', 'INV3-ABCD-01-XX-G-P-4003']);
});

test('a rotated page is judged as shown, not as stored', async () => {
  // Rotate 90 (clockwise as shown): the stored top-right corner is shown bottom-right.
  const bytes = await binderBytes([(page, font) => {
    page.setRotation(PDFLib.degrees(90));
    page.drawText('INV4-ABCD-01-XX-G-P-4001', { x: 1000, y: 800, size: 12, font });   // stored top-right
    page.drawText('INV4-ABCD-01-XX-G-P-4002', { x: 1000, y: 30, size: 12, font });    // stored bottom-right (decoy)
  }]);
  const page = await (await openPdf(new Uint8Array(bytes))).getPage(1);
  assert.equal(titleBlockNumber(await pageNumberItems(page)), 'INV4-ABCD-01-XX-G-P-4001');
});

test('a page with no text gives no number', async () => {
  const bytes = await binderBytes([page => page.drawRectangle({ x: 10, y: 10, width: 100, height: 100 })]);
  const page = await (await openPdf(new Uint8Array(bytes))).getPage(1);
  assert.equal(titleBlockNumber(await pageNumberItems(page)), null);
});

test('splitPdfPages returns null for bytes pdf-lib cannot read', async () => {
  assert.equal(await splitPdfPages(new Uint8Array([1, 2, 3]), PDFLib), null);
  assert.equal(await splitPdfPages(new Uint8Array([1, 2, 3]), null), null);
});

test('binderRowName falls back to file and page', () => {
  assert.equal(binderRowName(null, 'Binder test', 3), 'Binder test p3');
  assert.equal(binderRowName('  X-1 ', 'B', 1), 'X-1');
  assert.equal(binderRowName('', 'B', 2), 'B p2');
});

test('duplicateNames finds repeats ignoring case and spaces', () => {
  assert.deepEqual(duplicateNames(['A-1', 'a-1 ', 'B']), ['A-1']);
  assert.deepEqual(duplicateNames(['A', 'B']), []);
});

test('duplicateNames can compare by the archive file name', () => {
  const asFile = s => s.replace(/[\/:*?"<>|]/g, '-');
  assert.deepEqual(duplicateNames(['D1-4021:A', 'D1-4021-A'], asFile), ['D1-4021:A']);
  assert.deepEqual(duplicateNames(['D1-4021:A', 'D1-4021-B'], asFile), []);
});

test('namesAlreadyIn lists binder names that would replace a drawing in the register', () => {
  const asFile = s => s.replace(/[\/:*?"<>|]/g, '-');
  assert.deepEqual(namesAlreadyIn(['INV-4001', 'inv-4002 ', 'INV:4003'], ['INV-4002', 'INV-4003', 'OTHER'], asFile), ['inv-4002', 'INV:4003']);
  assert.deepEqual(namesAlreadyIn(['INV-4001'], [], asFile), []);
});
