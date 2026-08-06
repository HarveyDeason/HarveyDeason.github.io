// tests/xlsx-images.test.js
// Round-trips renderWorkbook's photo-embedding against the real vendored
// ExcelJS bundle: images present when supplied, no images behaves exactly
// as before, and a photoRefs entry with no bytes never throws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderWorkbook, MAX_EMBEDDED_IMAGES_PER_WORKBOOK } from '../assets/js/xlsx-render.js';
import { buildMasterWorkbookModel, emptyState } from '../assets/js/hub-core.js';

async function loadExcelJS() {
  globalThis.window = globalThis; globalThis.self = globalThis;
  const m = await import('../assets/vendor/exceljs.min.js');
  return m.default || m.ExcelJS || globalThis.ExcelJS || m;
}

// A valid 1x1 PNG, kept tiny so tests writing hundreds/thousands of them
// stay fast.
const PNG_1PX = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));

const COLUMNS = [
  { key: 'ref', header: 'Ref', width: 10 },
  { key: 'description', header: 'Description', width: 30 },
  { key: 'photos', header: 'Photos', width: 30 },
];

function logModel(rows, summaryRows = [['Product', 'X']]) {
  return {
    filename: 'Test.xlsx',
    sheets: [
      { name: 'Summary', kind: 'summary', meta: { title: 'Test', generatedOn: 't' }, rows: summaryRows },
      { name: 'Comment Log', kind: 'log', columns: COLUMNS, rows },
    ],
  };
}

function row(ref, photoRefs) {
  const files = photoRefs.filter(p => p && p.file).map(p => p.file);
  return {
    cells: { ref, description: 'x', photos: files.length ? `${files.length} photos: ${files.join(', ')}` : '' },
    statusKey: 'open', high: false, photoRefs,
  };
}

test('images present when supplied are embedded on the log sheet', async () => {
  const ExcelJS = await loadExcelJS();
  const photoRefs = [{ ref: 'HUB-0001', file: 'a.jpg' }, { ref: 'HUB-0001', file: 'b.jpg' }];
  const model = logModel([row('HUB-0001', photoRefs)]);
  const images = new Map([
    ['HUB-0001/a.jpg', PNG_1PX.buffer],
    ['HUB-0001/b.jpg', PNG_1PX],
  ]);
  const buf = await renderWorkbook(model, ExcelJS, {}, images);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('Comment Log');
  assert.equal(ws.getImages().length, 2, 'both thumbnails embedded');
  // row height was set to fit the thumbnail
  assert.ok(ws.getRow(2).height >= 60);
});

test('workbook still loads and the log sheet still reads correctly with images present', async () => {
  const ExcelJS = await loadExcelJS();
  const photoRefs = [{ ref: 'HUB-0001', file: 'a.jpg' }];
  const model = logModel([row('HUB-0001', photoRefs)]);
  const images = new Map([['HUB-0001/a.jpg', PNG_1PX]]);
  const buf = await renderWorkbook(model, ExcelJS, {}, images);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('Comment Log');
  assert.deepEqual(ws.getRow(1).values.slice(1), ['Ref', 'Description', 'Photos']);
  assert.equal(ws.getCell(2, 1).value, 'HUB-0001');
  assert.equal(ws.getCell(2, 3).value, '1 photos: a.jpg');
});

test('no images supplied behaves exactly as before (param omitted)', async () => {
  const ExcelJS = await loadExcelJS();
  const photoRefs = [{ ref: 'HUB-0001', file: 'a.jpg' }];
  const model = logModel([row('HUB-0001', photoRefs)]);
  const buf = await renderWorkbook(model, ExcelJS, {}); // no images arg at all

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('Comment Log');
  assert.equal(ws.getImages().length, 0);
  assert.equal(ws.getCell(2, 1).value, 'HUB-0001');
  assert.equal(ws.getCell(2, 3).value, '1 photos: a.jpg');
});

test('no images supplied behaves exactly as before (empty Map)', async () => {
  const ExcelJS = await loadExcelJS();
  const photoRefs = [{ ref: 'HUB-0001', file: 'a.jpg' }];
  const model = logModel([row('HUB-0001', photoRefs)]);
  const buf = await renderWorkbook(model, ExcelJS, {}, new Map());

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('Comment Log');
  assert.equal(ws.getImages().length, 0);
});

test('a photoRefs entry with no bytes falls back silently and does not throw', async () => {
  const ExcelJS = await loadExcelJS();
  const photoRefs = [{ ref: 'HUB-0001', file: 'missing.jpg' }];
  const model = logModel([row('HUB-0001', photoRefs)]);
  await assert.doesNotReject(renderWorkbook(model, ExcelJS, {}, new Map()));
  const buf = await renderWorkbook(model, ExcelJS, {}, new Map());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('Comment Log');
  assert.equal(ws.getImages().length, 0);
  assert.equal(ws.getCell(2, 3).value, '1 photos: missing.jpg'); // text fallback intact
});

test('malformed photoRefs entries (missing file, null) are skipped without throwing', async () => {
  const ExcelJS = await loadExcelJS();
  const model = logModel([row('HUB-0001', [{ ref: 'HUB-0001' }, null, { ref: 'HUB-0001', file: 'a.jpg' }])]);
  const images = new Map([['HUB-0001/a.jpg', PNG_1PX]]);
  const buf = await renderWorkbook(model, ExcelJS, {}, images);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  assert.equal(wb.getWorksheet('Comment Log').getImages().length, 1);
});

test('rows without photoRefs are unaffected by an images map that has no matches', async () => {
  const ExcelJS = await loadExcelJS();
  const model = logModel([row('HUB-0001', [])]);
  const images = new Map([['HUB-9999/unrelated.jpg', PNG_1PX]]);
  const buf = await renderWorkbook(model, ExcelJS, {}, images);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  assert.equal(wb.getWorksheet('Comment Log').getImages().length, 0);
});

test('MAX_EMBEDDED_IMAGES_PER_WORKBOOK is a generous ceiling, well above any realistic per-product log', () => {
  // 500 photos on one product is already called out in the plan as an
  // enormous amount for a single product; the cap must sit far above that.
  assert.ok(MAX_EMBEDDED_IMAGES_PER_WORKBOOK >= 1000);
});

test('failsafe: beyond the cap, embedding stops exactly at the limit and the Summary sheet gets a visible note', async () => {
  // Exercises the real production cap logic (the same `capped` / `embeddedCount
  // >= maxImages` code path renderWorkbook always runs) with a small injected
  // cap, so the test proves the mechanism without paying the real zip-
  // compression cost of thousands of embedded images on every test run.
  const ExcelJS = await loadExcelJS();
  const CAP = 8;
  const total = CAP + 3;
  const rows = [];
  const images = new Map();
  for (let i = 0; i < total; i++) {
    const ref = `HUB-${String(i).padStart(4, '0')}`;
    rows.push(row(ref, [{ ref, file: 'p.jpg' }]));
    images.set(`${ref}/p.jpg`, PNG_1PX);
  }
  const model = logModel(rows);
  const buf = await renderWorkbook(model, ExcelJS, {}, images, CAP);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('Comment Log');
  assert.equal(ws.getImages().length, CAP, 'stopped exactly at the cap');
  // The rows beyond the cap keep their text fallback — the export never fails.
  assert.equal(ws.getCell(total + 1, 3).value, '1 photos: p.jpg');

  const summary = wb.getWorksheet('Summary');
  const text = summary.getSheetValues().flat().filter(v => typeof v === 'string').join(' ');
  assert.match(text, /stopped after 8 images/i);
  assert.match(text, /Photos folder/i);
});

test('summary, template and lists sheets are unaffected for a model with no photoRefs (Decision Register / Master Log)', async () => {
  const ExcelJS = await loadExcelJS();
  const state = { ...emptyState('t'),
    products: [{ id: 'p1', name: 'OSB-01', type: 'OSB item', pidDrawings: [], modelRef: '', sheetRefs: '', updatedAt: 't' }],
    comments: [{ id: 'c1', ref: 'HUB-0001', productIds: ['p1'], affectedTypes: [], category: 'x', source: 'x',
      dateRaised: '2026-07-24', raisedBy: 'A', description: 'd', priority: 'medium', status: 'open',
      hold: false, pidRevision: '', dateClosed: '', actionTaken: '', closedBy: '', updatedAt: 't' }] };
  const master = buildMasterWorkbookModel(state, new Map(), 't'); // never carries photoRefs
  assert.equal(master.sheets[1].rows[0].photoRefs, undefined, 'sanity: master rows carry no photoRefs');

  // An images map is passed but nothing in this model has photoRefs to look
  // it up against, so it must not be able to affect the output at all.
  const unrelatedImages = new Map([['HUB-0001/nope.jpg', PNG_1PX]]);
  const bufA = await renderWorkbook(master, ExcelJS, {});
  const bufB = await renderWorkbook(master, ExcelJS, {}, unrelatedImages);

  const wbA = new ExcelJS.Workbook(); await wbA.xlsx.load(bufA);
  const wbB = new ExcelJS.Workbook(); await wbB.xlsx.load(bufB);
  const logA = wbA.getWorksheet('Comment Log');
  const logB = wbB.getWorksheet('Comment Log');
  assert.equal(logA.getImages().length, 0);
  assert.equal(logB.getImages().length, 0);
  assert.deepEqual(logA.getSheetValues(), logB.getSheetValues());
  assert.equal(logA.getRow(2).height, logB.getRow(2).height, 'row height unaffected by an unused images map');
});

// A family workbook has several log sheets, and each member drawing's sheet
// carries an extra heading row above the header band. That shifts every data
// row down by one, so it is the case most likely to anchor an image to the
// wrong row — worth round-tripping rather than reasoning about.
test('family workbook: images land on the right row of each log sheet, heading row and all', async () => {
  const ExcelJS = await loadExcelJS();
  const model = {
    filename: 'Family.xlsx',
    sheets: [
      { name: 'Summary', kind: 'summary', meta: { title: 'SP51-68', generatedOn: 't' }, rows: [['Family', 'SP51-68']] },
      { name: 'Family Comments', kind: 'log', columns: COLUMNS,
        rows: [row('HUB-0001', [{ ref: 'HUB-0001', file: 'range.jpg' }])] },
      // heading present: data starts on row 3 here, not row 2
      { name: 'SP51', kind: 'log', heading: 'SP51', columns: COLUMNS,
        rows: [row('HUB-0002', [{ ref: 'HUB-0002', file: 'valve.jpg' }])] },
      { name: 'SP68', kind: 'log', heading: 'SP68', columns: COLUMNS, rows: [] },
    ],
  };
  const images = new Map([
    ['HUB-0001/range.jpg', PNG_1PX],
    ['HUB-0002/valve.jpg', PNG_1PX],
  ]);
  const buf = await renderWorkbook(model, ExcelJS, {}, images);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const fam = wb.getWorksheet('Family Comments');
  const sp51 = wb.getWorksheet('SP51');

  assert.equal(fam.getImages().length, 1, 'family-level comment keeps its photo');
  assert.equal(sp51.getImages().length, 1, "the drawing's comment keeps its photo on the drawing's sheet");
  assert.equal(wb.getWorksheet('SP68').getImages().length, 0, 'a drawing with no comments gets nothing');

  // No heading: header on row 1, data on row 2 -> image anchored at row index 1.
  assert.equal(fam.getImages()[0].range.tl.nativeRow, 1);
  // Heading: heading row 1, header row 2, data row 3 -> image anchored at row index 2.
  assert.equal(sp51.getImages()[0].range.tl.nativeRow, 2);
  assert.equal(sp51.getCell(3, 1).value, 'HUB-0002', 'sanity: that is indeed the data row');
});
