import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { loadVendoredUmd, openPdf, loadVendoredPdfjs } from '../scripts/pdfjs-node.mjs';
import { readSheet } from '../scripts/check-symbol-check.mjs';
import { pagePaths } from '../assets/js/pid-symbols.js';
import { checkSheet } from '../assets/js/pid-symbol-check.js';
import { FAMILY_NOTE, VERDICT_LABELS } from '../assets/js/pid-symbol-check-view.js';
import { REASONS, notReadable } from '../assets/js/pid-symbol-report-run.js';
import { buildReportModel, FALLBACK } from '../assets/js/pid-symbol-report.js';
import { pdfSafe, buildReportPdf, SYMBOLS_NOTE } from '../assets/js/pid-symbol-report-pdf.js';
import { LIBRARY, LOOKUPS, sheetPdfBytes } from './fixtures/symbol-check-sheet.js';

const PDFLib = loadVendoredUmd('pdf-lib.min.js');
const A4 = [595.28, 841.89];

// Invented sheets only. One run: INV-0001 checked, INV-0002 with no PDF, INV-0003 unreadable.
// The tag-led layout is what a result from before the shape check gets: these sheets are checked with shapes off.
async function checkedOutcome(bytes, drawing = 'INV-0001') {
  const s = await readSheet(bytes.slice(0));
  const result = checkSheet({ paths: s.paths, textItems: s.textItems, viewportTransform: s.viewportTransform, tags: s.tags, library: LIBRARY, lookups: LOOKUPS, options: { shapes: false } });
  return { drawing, rev: 'C01', family: 'Invented', status: 'checked', reason: '', precheck: 'readable', pages: 1,
    pageSize: [s.width, s.height], viewportTransform: s.viewportTransform, result, ms: 2500 };
}
const base = { family: '', pages: 0, pageSize: null, viewportTransform: null, result: null, ms: 10 };
const noPdf = { ...base, drawing: 'INV-0002', rev: 'C01', status: 'not-checked', reason: REASONS.noPdf, precheck: '' };
const unreadable = { ...base, drawing: 'INV-0003', rev: 'P02', status: 'not-checked', reason: notReadable('none'), precheck: 'none' };
const startedAt = new Date(2026, 0, 2, 3, 4);
const modelOf = outcomes => buildReportModel({ run: { outcomes, stopped: false, ms: 4200 }, startedAt, checkedBy: 'A Tester', library: LIBRARY });
const BYTES = sheetPdfBytes();
const MODEL = modelOf([await checkedOutcome(BYTES), noPdf, unreadable]);

async function pages(bytes) {
  const doc = await openPdf(bytes.slice(0));
  const out = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const p = await doc.getPage(n);
    const vp = p.getViewport({ scale: 1 });
    const text = (await p.getTextContent()).items.map(i => i.str).join(' ').replace(/\s+/g, ' ');
    out.push({ n, page: p, vp, text, w: Math.round(vp.width * 100) / 100, h: Math.round(vp.height * 100) / 100 });
  }
  return out;
}
const isA4 = p => Math.abs(p.w - A4[0]) < 0.5 && Math.abs(p.h - A4[1]) < 0.5;

test('pdf-lib loads in Node, and the fixture with no options is unchanged', () => {
  assert.equal(typeof PDFLib.PDFDocument.create, 'function');
  // sheetPdfBytes() as it was before the rotate/origin options were added
  assert.equal(BYTES.length, 2525);
  assert.equal(crypto.createHash('sha256').update(BYTES).digest('hex'), '564f10e4491d5d92a1d08581fdb66727ab3c22eaf691eccb3073566fa3374d3d');
});

test('buildReportPdf: front page, heading, drawing page and table', async () => {
  const out = await buildReportPdf(MODEL, new Map([['INV-0001||C01', BYTES]]), PDFLib);
  assert.ok(out instanceof Uint8Array);
  const ps = await pages(out);
  assert.equal(ps.length, 4);   // front 1 + heading 1 + drawing 1 + table 1
  const [front, heading, drawing, table] = ps;
  for (const part of [FAMILY_NOTE, 'INV-0002', 'PDF not available in this session', 'INV-0003', 'A Tester', '2026-01-02 03:04', 'P&ID symbol check',
    'Legend sheet 1 rev A']) assert.ok(front.text.includes(part), part);
  // The table's count headers wrap between words, never inside one ("Approv ed").
  const head = front.text.slice(front.text.indexOf('Drawing Rev.'), front.text.indexOf('INV-0001'));
  for (const label of Object.values(VERDICT_LABELS)) assert.ok(head.includes(label), label + ' in: ' + head);
  assert.ok(isA4(front) && isA4(heading) && isA4(table));
  assert.ok(heading.text.includes('It checks the family of symbol, not which member of it.'));
  assert.ok(heading.text.includes('INV-0001'));
  assert.deepEqual([drawing.w, drawing.h], [500, 400]);
  for (let k = 1; k <= 11; k++) assert.ok(drawing.text.split(' ').includes(String(k)), String(k));
  assert.ok(drawing.text.includes('21-W-1001'));
  assert.ok(table.text.includes('Recognised as WIDGET, BARRED (tag identifier W), which does not fit G.'));
  assert.ok(table.text.includes('21-ZI-5001'));
});

// The drawing page's stroked closed paths, as top-left boxes in its own viewport.
function strokedBoxes(ol, vp) {
  const { OPS } = loadVendoredPdfjs();
  return pagePaths(ol.fnArray, ol.argsArray, OPS, vp.transform).filter(p => p.stroked && p.segs.length >= 8).map(p => {
    const xs = p.segs.filter((_, i) => i % 2 === 0), ys = p.segs.filter((_, i) => i % 2 === 1);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  });
}

test('buildReportPdf: each box lands where the screen puts it, on a plain, rotated or offset page', async () => {
  for (const opts of [undefined, { rotate: 90 }, { origin: [100, 50] }]) {
    const bytes = sheetPdfBytes(opts);
    const outcome = await checkedOutcome(bytes);
    const model = modelOf([outcome]);
    const out = await buildReportPdf(model, new Map([['INV-0001||C01', bytes]]), PDFLib);
    const ps = await pages(out);
    const drawing = ps.find(p => !isA4(p));
    assert.ok(drawing, JSON.stringify(opts));
    if (opts && opts.rotate) assert.deepEqual([drawing.w, drawing.h], [400, 500]);
    const boxes = strokedBoxes(await drawing.page.getOperatorList(), drawing.vp);
    const withRect = model.sheets[0].rows.filter(r => r.userRect);
    assert.ok(withRect.length >= 8, JSON.stringify(opts));
    for (const r of withRect) {
      const v = outcome.result.verdicts.find(x => x.tag === r.tag);
      const b = v.box || v.tagBox;
      const want = [b[0] - 3, b[1] - 3, b[2] + 3, b[3] + 3];
      assert.ok(boxes.some(q => q.every((x, i) => Math.abs(x - want[i]) <= 0.5)), JSON.stringify({ opts, tag: r.tag, want }));
    }
  }
});

test('buildReportPdf: a drawing it cannot copy keeps its heading and table, with the fallback line', async () => {
  for (const sources of [new Map(), new Map([['INV-0001||C01', Uint8Array.from('not a pdf', c => c.charCodeAt(0))]]), null]) {
    const out = await buildReportPdf(MODEL, sources, PDFLib);
    const ps = await pages(out);
    assert.equal(ps.length, 3);
    assert.ok(ps.every(isA4));
    assert.ok(ps[1].text.includes(FALLBACK));
    assert.ok(ps[2].text.includes('Recognised as WIDGET, BARRED (tag identifier W), which does not fit G.'));
  }
});

test('buildReportPdf: stopped before anything, the front page only, saying so', async () => {
  const st = o => ({ ...o, status: 'not-checked', reason: REASONS.stopped, result: null });
  const model = buildReportModel({ run: { outcomes: [st(noPdf), st(unreadable), st({ ...noPdf, drawing: 'INV-0004' })], stopped: true, ms: 5 }, startedAt, library: LIBRARY });
  const ps = await pages(await buildReportPdf(model, new Map(), PDFLib));
  assert.ok(ps.length >= 1 && ps.every(isA4));
  assert.ok(ps[0].text.includes('Stopped by user after 0 of 3 sheets.'));
  assert.ok(ps.map(p => p.text).join(' ').includes('INV-0004'));
});

test('pdfSafe: text the font cannot hold becomes ?, and the report still builds', async () => {
  assert.equal(pdfSafe('a😀b\tc€ü'), 'a?b c?ü');
  assert.equal(pdfSafe('x\r\ny'), 'x  y');
  assert.equal(pdfSafe('\u0001\u0085é'), '??é');
  assert.equal(pdfSafe(null), '');
  assert.equal(pdfSafe(5), '');
  const model = modelOf([await checkedOutcome(BYTES, 'INV/€'), noPdf]);
  model.sheets[0].rows[0].tag = '21-W-€😀';
  model.sheets[0].rows[0].symbol = '\u0001<b>';
  model.sheets[0].rows[0].detail = 'x'.repeat(400);
  model.checkedBy = '\u0007😀';
  const out = await buildReportPdf(model, new Map([['INV/€||C01', BYTES]]), PDFLib);
  const ps = await pages(out);
  assert.equal(ps.length, 4);
  assert.ok(ps[0].text.includes('INV/?'));
  assert.ok(ps.map(p => p.text).join(' ').includes('21-W-??'));
  assert.equal(await buildReportPdf(null, null, PDFLib) instanceof Uint8Array, true);
  assert.equal(await buildReportPdf(MODEL, null, null), null);
  assert.equal(await buildReportPdf(MODEL, null, {}), null);
});

test('buildReportPdf: the tag bubble line is written under the sheet counts', async () => {
  const m = { ...MODEL, sheets: MODEL.sheets.map((s, i) => (i === 0 ? { ...s, bubbleLine: 'Tag bubbles: 2 RING, 1 HEXAGON' } : s)) };
  const ps = await pages(await buildReportPdf(m, new Map([['INV-0001||C01', BYTES]]), PDFLib));
  assert.ok(ps[1].text.includes('Tag bubbles: 2 RING, 1 HEXAGON'));
  const plain = await pages(await buildReportPdf(MODEL, new Map([['INV-0001||C01', BYTES]]), PDFLib));
  assert.ok(!plain[1].text.includes('Tag bubbles'));
});

// ── Symbols found by the sweep ────────────────────────────────────────────
function rectCounts(ol) {
  // pdf-lib draws each rectangle as a path then a paint operator: count stroke-only and filled ones.
  const { OPS } = loadVendoredPdfjs();
  let stroked = 0, filled = 0;
  for (const fn of ol.fnArray) {
    if (fn === OPS.stroke || fn === OPS.closeStroke) stroked++;
    if (fn === OPS.fill || fn === OPS.eoFill || fn === OPS.fillStroke || fn === OPS.eoFillStroke) filled++;
  }
  return { stroked, filled };
}
test('buildReportPdf: the symbol line under the counts; a box per untagged symbol, with no number; the key says so', async () => {
  const s0 = MODEL.sheets[0];
  const ur = s0.rows.find(r => r.userRect).userRect;
  const m = { ...MODEL, sheets: MODEL.sheets.map((s, i) => (i === 0 ? { ...s, symbolLine: '7 standard symbols found, 4 with tags.',
    skippedLine: 'Title block not checked.', symbolRows: [{ name: 'GADGET', userRect: [10, 10, 40, 40] }, { name: 'WIDGET', userRect: [ur[0] + 50, ur[1], ur[2] + 50, ur[3]] }] } : s)) };
  const ps = await pages(await buildReportPdf(m, new Map([['INV-0001||C01', BYTES]]), PDFLib));
  const before = await pages(await buildReportPdf(MODEL, new Map([['INV-0001||C01', BYTES]]), PDFLib));
  assert.ok(ps[1].text.includes('7 standard symbols found, 4 with tags.'));
  assert.ok(ps[1].text.includes('Title block not checked.'));
  assert.ok(ps[0].text.includes('Standard symbol with no tag'));
  const drawing = ps.find(p => !isA4(p)), drawingBefore = before.find(p => !isA4(p));
  const a = rectCounts(await drawing.page.getOperatorList()), b = rectCounts(await drawingBefore.page.getOperatorList());
  assert.equal(a.stroked - b.stroked, 2, JSON.stringify([a, b]));
  assert.equal(a.filled, b.filled);   // no number tab
  assert.equal(drawing.text, drawingBefore.text);   // no number
});

test('buildReportPdf: a printed sheet says its tags are not read yet; no page says "No tags."', async () => {
  const out0 = await checkedOutcome(BYTES);
  const printed = { ...out0, precheck: 'printed', result: { ok: true, verdicts: [], symbols: [] } };
  const ps = await pages(await buildReportPdf(modelOf([printed]), new Map(), PDFLib));
  assert.ok(ps.some(p => p.text.includes('Tags not read yet')));
  const bare = { ...out0, result: { ok: true, verdicts: [], symbols: [] } };
  const ps2 = await pages(await buildReportPdf(modelOf([bare]), new Map(), PDFLib));
  assert.ok(ps2.some(p => p.text.includes('No tags read.')));
  for (const p of [...ps, ...ps2]) assert.ok(!p.text.includes('No tags.'), p.text.slice(0, 200));
});

test('buildReportPdf: a flagged shape gets a numbered amber box on the drawing and a row in the table', async () => {
  const s0 = MODEL.sheets[0];
  const shapeRows = [{ no: s0.rows.length + 1, tag: '', fc: '', kind: 'not-standard', label: 'Not to standard', detail: 'ink left over; closest: GADGET 97%', userRect: [20, 20, 50, 50] }];
  const m = { ...MODEL, sheets: MODEL.sheets.map((s, i) => (i === 0 ? { ...s, shapeRows } : s)) };
  const ps = await pages(await buildReportPdf(m, new Map([['INV-0001||C01', BYTES]]), PDFLib));
  const before = await pages(await buildReportPdf({ ...MODEL, sheets: MODEL.sheets.map((s, i) => (i === 0 ? { ...s, shapeRows: [] } : s)) }, new Map([['INV-0001||C01', BYTES]]), PDFLib));
  const drawing = ps.find(p => !isA4(p)), drawingBefore = before.find(p => !isA4(p));
  const a = rectCounts(await drawing.page.getOperatorList()), b = rectCounts(await drawingBefore.page.getOperatorList());
  assert.equal(a.stroked - b.stroked, 1, JSON.stringify([a, b]));
  assert.equal(a.filled - b.filled, 1);   // its number tab
  assert.ok(ps.some(p => p.text.includes('ink left over; closest: GADGET 97%')));
  assert.ok(ps[0].text.includes('Not to standard'));
});

// ── Symbols first (owner, 2026-11-18) ──
test('buildReportPdf, symbols first: green named boxes and amber numbered ones on the drawing, a picture page, tags at the back', async () => {
  const s0 = MODEL.sheets[0];
  const sheet = { ...s0, layout: 'symbols', shapeLine: '2 standard symbols · 1 not to standard',
    standardRows: [{ name: 'WIDGET', userRect: [100, 190, 130, 210] }, { name: 'GADGET', userRect: [200, 190, 230, 220] }],
    shapeRows: [{ no: 1, kind: 'not-standard', label: 'Not to standard', tag: '', fc: '', detail: 'extra ink; closest: WIDGET 97%', userRect: [300, 190, 330, 210] }] };
  const m = { ...MODEL, sheets: [sheet, ...MODEL.sheets.slice(1)] };
  const ps = await pages(await buildReportPdf(m, new Map([['INV-0001||C01', BYTES]]), PDFLib));
  const bare = { ...MODEL, sheets: [{ ...sheet, standardRows: [], shapeRows: [] }, ...MODEL.sheets.slice(1)] };
  const drawing = ps.find(p => !isA4(p)), drawingBare = (await pages(await buildReportPdf(bare, new Map([['INV-0001||C01', BYTES]]), PDFLib))).find(p => !isA4(p));
  const rc = rectCounts(await drawing.page.getOperatorList()), rb = rectCounts(await drawingBare.page.getOperatorList());
  assert.equal(rc.stroked - rb.stroked, 3, JSON.stringify([rc, rb]));   // two green, one amber
  assert.equal(rc.filled - rb.filled, 1);                                 // one number tab: the tags have no boxes here
  assert.ok(drawing.text.includes('WIDGET') && drawing.text.includes('GADGET'), drawing.text);
  const heading = ps.find(p => p.text.includes('INV-0001') && p.text.includes('2 standard symbols · 1 not to standard'));
  assert.ok(heading, 'the shape line heads the sheet');
  const pics = ps.find(p => isA4(p) && p.text.includes('Not to standard: pictures'));
  assert.ok(pics && pics.text.includes('extra ink; closest: WIDGET 97%'));
  assert.ok(ps.some(p => p.text.includes('Tags (reference)')));
});

test('buildReportPdf, symbols first: the front page says what the symbol check does and counts shapes; pictures start under the heading', async () => {
  const s0 = MODEL.sheets[0];
  const sheet = { ...s0, layout: 'symbols', shapeLine: '2 standard symbols · 1 not to standard', standardCount: 2, notStandardCount: 1, notJudgedCount: 0,
    reasonLine: 'Why: 1 ink left over', standardRows: [{ name: 'WIDGET', userRect: [100, 190, 130, 210] }],
    shapeRows: [{ no: 1, kind: 'not-standard', label: 'Not to standard', tag: '', fc: '', detail: 'ink left over; closest: WIDGET 97%', userRect: [300, 190, 330, 210] }] };
  const m = { ...MODEL, sheets: [sheet, ...MODEL.sheets.slice(1)] };
  const ps = await pages(await buildReportPdf(m, new Map([['INV-0001||C01', BYTES]]), PDFLib));
  assert.ok(ps[0].text.includes(SYMBOLS_NOTE), ps[0].text.slice(0, 300));
  assert.ok(ps[0].text.includes('Standard symbols') && ps[0].text.includes('Not to standard'));
  const heading = ps.find(p => p.text.includes('2 standard symbols · 1 not to standard'));
  assert.ok(heading.text.includes('Why: 1 ink left over'));
  assert.ok(heading.text.includes('Not to standard: pictures'), 'the pictures start on the heading page');
});

test('buildReportPdf, symbols first: the trial note is on the front page and under each sheet heading', async () => {
  const { TRIAL_NOTE } = await import('../assets/js/pid-symbol-check-view.js');
  const sheet = { ...MODEL.sheets[0], layout: 'symbols', shapeLine: '1 standard symbol · 0 not to standard', standardRows: [], shapeRows: [] };
  const ps = await pages(await buildReportPdf({ ...MODEL, sheets: [sheet] }, new Map([['INV-0001||C01', BYTES]]), PDFLib));
  assert.ok(ps[0].text.includes(TRIAL_NOTE));
  assert.ok(ps.find(p => p.text.includes('1 standard symbol')).text.includes(TRIAL_NOTE));
});

// ── Task 7 (shape-check redesign): red boxes, the drawing area, the not identified column ──
function lineWidths(ol) {
  const { OPS } = loadVendoredPdfjs();
  const out = [];
  ol.fnArray.forEach((fn, i) => { if (fn === OPS.setLineWidth) out.push(Math.round(ol.argsArray[i][0] * 100) / 100); });
  return out;
}
const VSHEET = { ...MODEL.sheets[0], layout: 'symbols', shapeLine: '2 standard · 1 not to standard · 2 not identified', standardCount: 2, notStandardCount: 1, notJudgedCount: 0, notIdentifiedCount: 2,
  reasonLine: '', standardRows: [{ name: 'WIDGET', userRect: [100, 190, 130, 210] }],
  shapeRows: [{ no: 1, kind: 'not-standard', label: 'Not to standard', tag: '', fc: '', detail: 'drawn differently from WIDGET (92% alike)', userRect: [300, 190, 330, 210] }],
  redRows: [{ userRect: [20, 20, 50, 50] }, { userRect: [60, 20, 90, 50] }], areaRect: [10, 10, 490, 390], markVerdicts: true };
const vModel = sheet => ({ ...MODEL, sheets: [sheet, ...MODEL.sheets.slice(1)] });

test('buildReportPdf, verdicts: red boxes are thin, solid and unnumbered; the drawing area is faint', async () => {
  const src = new Map([['INV-0001||C01', BYTES]]);
  const ps = await pages(await buildReportPdf(vModel(VSHEET), src, PDFLib));
  const bare = await pages(await buildReportPdf(vModel({ ...VSHEET, redRows: [], areaRect: null }), src, PDFLib));
  const d = ps.find(p => !isA4(p)), db = bare.find(p => !isA4(p));
  const a = rectCounts(await d.page.getOperatorList()), b = rectCounts(await db.page.getOperatorList());
  assert.equal(a.stroked - b.stroked, 3, JSON.stringify([a, b]));   // two red and the area
  assert.equal(a.filled - b.filled, 0);                              // no number tab for red
  const wa = lineWidths(await d.page.getOperatorList()), wb = lineWidths(await db.page.getOperatorList());
  assert.equal(wa.filter(x => x === 0.3).length - wb.filter(x => x === 0.3).length, 1, 'the area at 0.3 pt: ' + wa);
  assert.equal(wa.filter(x => x === 0.5).length - wb.filter(x => x === 0.5).length, 2, 'two red lines at 0.5 pt: ' + wa);
  assert.equal(d.text, db.text, 'red boxes and the area carry no text');
});

test('buildReportPdf, verdicts: red has no picture and no table row; the front page has a Not identified column and the key lines', async () => {
  const { KEY_NOT_STANDARD, KEY_NOT_IDENTIFIED } = await import('../assets/js/pid-symbol-check-view.js');
  const src = new Map([['INV-0001||C01', BYTES]]);
  const ps = await pages(await buildReportPdf(vModel(VSHEET), src, PDFLib));
  const none = await pages(await buildReportPdf(vModel({ ...VSHEET, redRows: [] }), src, PDFLib));
  assert.equal(ps.length, none.length, 'red rows add no page');
  assert.ok(ps[0].text.includes('Not identified'));
  assert.ok(ps[0].text.includes(KEY_NOT_STANDARD) && ps[0].text.includes(KEY_NOT_IDENTIFIED), ps[0].text);
  assert.ok(ps[0].text.includes('a solid, thin red line, unnumbered'));
  assert.ok(ps[0].text.includes('Pictures and table rows are for amber only. Red is a count per sheet and boxes on the drawing.'));
  assert.ok(ps.some(p => p.text.includes('drawn differently from WIDGET') && p.text.includes('not to standard')));
  assert.ok(ps.some(p => isA4(p) && p.text.includes('Not to standard: pictures')));
});

test('buildReportPdf: a symbols sheet from a result with no verdicts keeps the old front page', async () => {
  const sheet = { ...MODEL.sheets[0], layout: 'symbols', shapeLine: '1 standard symbol · 0 not to standard', standardRows: [], shapeRows: [] };
  const ps = await pages(await buildReportPdf({ ...MODEL, sheets: [sheet] }, new Map([['INV-0001||C01', BYTES]]), PDFLib));
  assert.ok(!ps[0].text.includes('Not identified'));
  assert.ok(ps[0].text.includes('Not to standard (dashed)'));
});
