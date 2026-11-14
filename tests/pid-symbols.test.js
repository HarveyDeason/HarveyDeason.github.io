import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pagePaths, textWords, CURVE_STEPS, legendCells, titleBlock, readLegendPage, normName, buildLibrary, parseLibrary, serialiseLibrary, libraryCounts, searchSymbols, updateSymbol, deleteSymbol, addManualSymbol, addNote, removeNote, setException, removeException, carryOver } from '../assets/js/pid-symbols.js';
import { FAKE_OPS as O, opList } from './fixtures/symbol-ops.js';
import { loadVendoredPdfjs, openPdf } from '../scripts/pdfjs-node.mjs';
import { tinyPdf, TINY_CONTENT, TINY_FORM } from './fixtures/tiny-pdf.js';

const FLIP = [1, 0, 0, -1, 0, 100]; // a 100 pt tall page at scale 1
const walk = (steps, vt = FLIP) => { const l = opList(steps); return pagePaths(l.fnArray, l.argsArray, O, vt); };
const line = ['path', ['M', 0, 0, 'L', 10, 0]];

test('pagePaths: a stroked line, in top-left points', () => {
  assert.deepEqual(walk([['setLineWidth', 2], ['path', ['M', 10, 10, 'L', 60, 10]], ['stroke']]),
    [{ segs: [10, 90, 60, 90], width: 2, stroked: true, filled: false, grey: 0 }]);
});

test('pagePaths: a transform scales coordinates and width; restore undoes both', () => {
  const p = walk([['save'], ['transform', 0.5, 0, 0, 0.5, 0, 0], ['setLineWidth', 4],
    ['path', ['M', 20, 80, 'L', 120, 80]], ['stroke'], ['restore'], line, ['stroke']]);
  assert.deepEqual(p[0].segs, [10, 60, 60, 60]);
  assert.equal(p[0].width, 2);
  assert.deepEqual(p[1].segs, [0, 100, 10, 100]);
  assert.equal(p[1].width, 1); // the PDF default line width
});

test('pagePaths: a rectangle is four segments back to its start', () => {
  assert.deepEqual(walk([['path', ['R', 10, 20, 30, 15]], ['stroke']])[0].segs,
    [10, 80, 40, 80, 40, 80, 40, 65, 40, 65, 10, 65, 10, 65, 10, 80]);
});

test('pagePaths: each curve form flattens to CURVE_STEPS segments ending on its end point', () => {
  for (const curve of [['C', 20, 70, 40, 70, 50, 50], ['V', 40, 70, 50, 50], ['Y', 20, 70, 50, 50]]) {
    const s = walk([['path', ['M', 10, 50, ...curve]], ['stroke']])[0].segs;
    assert.equal(s.length, CURVE_STEPS * 4);
    assert.deepEqual(s.slice(0, 2), [10, 50]);
    assert.ok(Math.abs(s[s.length - 2] - 50) < 1e-9 && Math.abs(s[s.length - 1] - 50) < 1e-9);
  }
});

test('pagePaths: fill, fill-and-stroke and the closing variants', () => {
  const tri = ['path', ['M', 70, 60, 'L', 80, 60, 'L', 75, 70]];
  const f = walk([['setFillRGBColor', 255, 0, 0], tri, ['fill']])[0];
  assert.deepEqual([f.stroked, f.filled, f.width, f.grey, f.segs.length], [false, true, 0, 76, 8]);
  const b = walk([['setStrokeRGBColor', 128, 128, 128], tri, ['closeFillStroke']])[0];
  assert.deepEqual([b.stroked, b.filled, b.grey, b.segs.length], [true, true, 128, 12]);
  assert.deepEqual(b.segs.slice(8), [75, 30, 70, 40]); // the closing segment
  assert.equal(walk([tri, ['closeStroke']])[0].segs.length, 12);
  for (const op of ['eoFill', 'fillStroke', 'eoFillStroke', 'closeEOFillStroke']) assert.equal(walk([tri, [op]]).length, 1);
});

test('pagePaths: a clip path ended with endPath draws nothing', () => {
  assert.deepEqual(walk([line, ['clip'], ['endPath'], line, ['stroke']]).length, 1);
});

test('pagePaths: a form XObject applies its matrix and restores after', () => {
  const p = walk([['paintFormXObjectBegin', [1, 0, 0, 1, 100, 0], [0, 0, 50, 50]], line, ['stroke'],
    ['paintFormXObjectEnd'], line, ['stroke']]);
  assert.deepEqual(p.map(x => x.segs), [[100, 100, 110, 100], [0, 100, 10, 100]]);
});

test('pagePaths: a stroke gives one path per subpath, a fill keeps its subpaths together; colour follows save and restore', () => {
  const pair = ['path', ['M', 0, 0, 'L', 10, 0, 'M', 20, 0, 'L', 30, 0]];
  assert.deepEqual(walk([pair, ['stroke']]).map(x => x.segs), [[0, 100, 10, 100], [20, 100, 30, 100]]);
  assert.deepEqual(walk([pair, ['fill']]).map(x => x.segs), [[0, 100, 10, 100, 20, 100, 30, 100]]);
  assert.deepEqual(walk([pair, ['fillStroke']]).length, 1);
  const c = walk([['save'], ['setStrokeRGBColor', 255, 255, 255], line, ['stroke'], ['restore'], line, ['stroke']]);
  assert.deepEqual(c.map(x => x.grey), [255, 0]);
});

test('pagePaths: hostile input degrades and never throws', () => {
  for (const bad of [undefined, null, 5, 'x', {}]) assert.deepEqual(pagePaths(bad, bad, bad, bad), []);
  assert.doesNotThrow(() => pagePaths([O.constructPath, O.stroke, O.restore, 77777], [null, null], O, FLIP));
  assert.doesNotThrow(() => pagePaths([O.constructPath, O.stroke], [[[O.moveTo, O.lineTo, O.curveTo], [1, 2, NaN], null], null], O, FLIP));
  assert.deepEqual(walk([['path', ['M', 0, 0, 'L', Infinity, 0]], ['stroke']]), []);
});

test('pagePaths: matches what the vendored pdf.js emits for an invented page', async () => {
  const pdfjsLib = loadVendoredPdfjs();
  const page = await (await openPdf(tinyPdf(TINY_CONTENT, TINY_FORM))).getPage(1);
  const ol = await page.getOperatorList();
  const p = pagePaths(ol.fnArray, ol.argsArray, pdfjsLib.OPS, page.getViewport({ scale: 1 }).transform);
  assert.equal(p.length, 6);
  assert.deepEqual(p[0], { segs: [10, 90, 60, 90], width: 2, stroked: true, filled: false, grey: 0 });
  assert.deepEqual([p[1].segs.length, p[1].width, p[1].grey], [16, 1, 128]);
  assert.deepEqual([p[2].segs, p[2].width], [[10, 60, 60, 60], 2]);
  assert.deepEqual([p[3].filled, p[3].stroked, p[3].segs.length], [true, false, 12]);
  assert.equal(p[4].segs.length, CURVE_STEPS * 4);
  assert.deepEqual(p[5].segs, [100, 100, 110, 100]);
});

test('textWords: an upright item becomes a top-left box', () => {
  assert.deepEqual(textWords([{ str: ' HELLO ', transform: [10, 0, 0, 10, 12, 85], width: 32, height: 10 }], FLIP),
    [{ str: 'HELLO', x: 12, y: 5, w: 32, h: 10 }]);
});

test('textWords: text running up the page gets a tall box, not a wide one', () => {
  assert.deepEqual(textWords([{ str: 'UP', transform: [0, 10, -10, 0, 50, 20], width: 30, height: 10 }], FLIP),
    [{ str: 'UP', x: 40, y: 50, w: 10, h: 30 }]);
});

test('textWords: blanks dropped, hostile input degrades', () => {
  assert.deepEqual(textWords([{ str: '   ', transform: [1, 0, 0, 1, 0, 0], width: 1, height: 1 }, null, 7, { str: 'X' }], FLIP), []);
  for (const bad of [undefined, null, 5, {}]) assert.deepEqual(textWords(bad, bad), []);
});

// Found by the vendored-pdf.js test above: pdf.js hands colour arguments over
// as a Uint8ClampedArray, and may do the same for coordinates.
test('pagePaths: typed-array arguments are read like plain arrays', () => {
  const fnArray = [O.setStrokeRGBColor, O.transform, O.constructPath, O.stroke];
  const argsArray = [new Uint8ClampedArray([128, 128, 128]), new Float32Array([1, 0, 0, 1, 5, 0]),
    [new Uint16Array([O.moveTo, O.lineTo]), new Float32Array([0, 0, 10, 0]), null], null];
  assert.deepEqual(pagePaths(fnArray, argsArray, O, FLIP), [{ segs: [5, 100, 15, 100], width: 1, stroked: true, filled: false, grey: 128 }]);
});

import { rule, box, word, ruledTable, widgetTable, toOps, toTextItems } from './fixtures/symbol-table.js';

test('legendCells: reads heading, tag identifier and every row, including the last', () => {
  const { paths, words } = widgetTable();
  const r = legendCells(paths, words);
  assert.deepEqual(r.tables, [{ header: 'WIDGETS', tagId: 'Q', symbolSide: 'right', box: [100, 50, 400, 230], rowCount: 3 }]);
  assert.deepEqual(r.rows.map(x => x.label), ['ROUND WIDGET', 'SQUARE WIDGET (LARGE)', 'LAST WIDGET']);
  assert.deepEqual(r.rows.map(x => [x.header, x.tagId, x.table]), [['WIDGETS', 'Q', 0], ['WIDGETS', 'Q', 0], ['WIDGETS', 'Q', 0]]);
  assert.deepEqual(r.rows[1].box, [290, 160, 350, 180]);
  assert.deepEqual(r.rows[1].lettersInside, [{ text: 'M', x: 315, y: 165, size: 8 }]);
  assert.equal(r.rows[0].symbolPaths.length, 1); // the rules themselves are never symbol linework
  assert.deepEqual([r.unsplit, r.other, r.emptyRows], [[], [], 0]);
});

test('legendCells: a row with no divider is listed, not dropped', () => {
  const t = widgetTable();
  const paths = [...ruledTable({ x0: 100, x1: 400, divider: 250, ys: [50, 80, 110, 150, 190, 230], dividerTo: 4 }), ...t.paths.slice(-3)];
  const r = legendCells(paths, t.words);
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.unsplit.map(u => [u.reason, u.text, u.header, u.pathCount]), [['no divider', 'LAST WIDGET', 'WIDGETS', 1]]);
});

test('legendCells: a label with no linework, and linework with no label, are both listed', () => {
  const t = widgetTable();
  const noLine = legendCells(t.paths.filter(p => p !== t.paths[t.paths.length - 1]), t.words);
  assert.deepEqual(noLine.unsplit.map(u => [u.reason, u.text]), [['no linework', 'LAST WIDGET']]);
  const noLabel = legendCells(t.paths, t.words.filter(w => w.str !== 'ROUND WIDGET'));
  assert.deepEqual(noLabel.unsplit.map(u => [u.reason, u.pathCount]), [['no label', 1]]);
  assert.equal(noLabel.rows.length, 2);
});

test('legendCells: a row with nothing in it is counted', () => {
  const t = widgetTable();
  const r = legendCells(t.paths.slice(0, -1), t.words.filter(w => w.str !== 'LAST WIDGET'));
  assert.deepEqual([r.rows.length, r.unsplit.length, r.emptyRows], [2, 0, 1]);
});

test('legendCells: two tables stacked in one column stay separate, and the gap is not a row', () => {
  const t = widgetTable();
  const paths = [...t.paths, ...ruledTable({ x0: 100, x1: 400, divider: 250, ys: [260, 290, 330] }), box(300, 300, 30, 20)];
  const words = [...t.words, word('GADGETS', 105, 270), word('SYMBOL', 300, 270), word('TALL GADGET', 105, 305)];
  const r = legendCells(paths, words);
  assert.deepEqual(r.tables.map(x => [x.header, x.tagId, x.rowCount]), [['WIDGETS', 'Q', 3], ['GADGETS', '', 1]]);
  assert.deepEqual([r.rows.length, r.emptyRows, r.rows[3].table], [4, 0, 1]);
});

test('legendCells: the symbol column follows the heading, left or right', () => {
  const paths = [...ruledTable({ x0: 100, x1: 400, divider: 250, ys: [50, 80, 120] }), box(120, 90, 30, 20)];
  const r = legendCells(paths, [word('SYMBOL', 150, 60), word('GADGETS', 260, 60), word('LEFT GADGET', 260, 95)]);
  assert.equal(r.tables[0].symbolSide, 'left');
  assert.deepEqual(r.rows.map(x => [x.label, x.box]), [['LEFT GADGET', [120, 90, 150, 110]]]);
});

test('legendCells: a ruled area with no heading is listed under other, and an enclosing frame is not', () => {
  const t = widgetTable();
  const frame = ruledTable({ x0: 20, x1: 800, ys: [20, 500] });
  const notes = ruledTable({ x0: 450, x1: 750, divider: 600, ys: [50, 80, 110] });
  const r = legendCells([...frame, ...t.paths, ...notes], [...t.words, word('NOTE ONE', 455, 60), word('NOTE TWO', 455, 90)]);
  assert.equal(r.rows.length, 3);
  assert.deepEqual(r.other.map(o => [o.box, o.rows.map(x => x.text)]), [[[450, 50, 750, 110], ['NOTE ONE', 'NOTE TWO']]]);
});

test('legendCells: rules drawn slightly out of line still make one table', () => {
  const t = widgetTable();
  const paths = t.paths.map((p, i) => i === 2 ? rule(100.8, 110.4, 399.3, 110.4) : p).concat(rule(100, 150.5, 400, 150.5));
  assert.equal(legendCells(paths, t.words).rows.length, 3);
});

test('legendCells: header words are options, and hostile input degrades', () => {
  const t = widgetTable();
  const words = t.words.map(w => w.str === 'SYMBOL' ? word('GLYPH', 300, 90) : w);
  assert.equal(legendCells(t.paths, words).rows.length, 0);
  assert.equal(legendCells(t.paths, words, { symbolWord: 'glyph' }).rows.length, 3);
  const empty = { tables: [], rows: [], unsplit: [], other: [], emptyRows: 0 };
  for (const bad of [undefined, null, 5, 'x', {}]) assert.deepEqual(legendCells(bad, bad, bad), empty);
  assert.doesNotThrow(() => legendCells([null, { segs: 'x' }, { segs: [NaN, 0, 1, 1], stroked: true }], [null, { str: 5 }]));
});

test('titleBlock: sheet number, and the revision is the nearest word below its label', () => {
  const words = [word('SHEET 7', 500, 200), word('REV.', 520, 300), word('B03', 518, 314), word('NTS', 470, 312), word('A1', 520, 280)];
  assert.deepEqual(titleBlock(words), { sheet: '7', rev: 'B03' });
  assert.deepEqual(titleBlock([word('NOTHING', 0, 0)]), { sheet: '', rev: '' });
  for (const bad of [undefined, null, 5, [null, {}]]) assert.deepEqual(titleBlock(bad), { sheet: '', rev: '' });
});

test('readLegendPage: operator list and text items in, rows and title block out', () => {
  const t = widgetTable();
  const { fnArray, argsArray } = toOps(t.paths);
  const textItems = toTextItems([...t.words, word('SHEET 7', 600, 400), word('REV.', 600, 420), word('B03', 600, 434)]);
  const r = readLegendPage({ fnArray, argsArray, OPS: O, viewportTransform: [1, 0, 0, 1, 0, 0], textItems, page: 3 });
  assert.deepEqual([r.page, r.sheet, r.rev], [3, '7', 'B03']);
  assert.deepEqual(r.rows.map(x => x.label), ['ROUND WIDGET', 'SQUARE WIDGET (LARGE)', 'LAST WIDGET']);
  assert.deepEqual(readLegendPage(null), { page: 0, sheet: '', rev: '', tables: [], rows: [], unsplit: [], other: [], emptyRows: 0 });
});

const INVENTED = readFileSync(new URL('./fixtures/invented-symbol-library.json', import.meta.url), 'utf8');
const widgetPage = () => { const t = widgetTable(); return { page: 3, sheet: '7', rev: 'B03', ...legendCells(t.paths, t.words) }; };

test('buildLibrary: one symbol per row, drawn from its own top-left corner', () => {
  const lib = buildLibrary([widgetPage()], '2026-11-13T10:00:00.000Z');
  assert.deepEqual([lib.version, lib.legend, lib.importedAt, lib.families, lib.exceptions],
    [1, [{ sheet: '7', rev: 'B03', page: 3 }], '2026-11-13T10:00:00.000Z', {}, []]);
  assert.deepEqual(lib.symbols[0], {
    id: 'p3-001', name: 'ROUND WIDGET', legendName: 'ROUND WIDGET', group: 'WIDGETS', tagId: 'Q', sheet: '7', w: 40, h: 20,
    paths: [{ segs: [0, 0, 40, 0, 40, 0, 40, 20, 40, 20, 0, 20, 0, 20, 0, 0], width: 0.7, stroked: true, filled: false, grey: 0 }],
    letters: [], flags: { simple: false, stretch: false, manual: false, unmatched: false }, aliases: [], notes: [] });
  assert.deepEqual(lib.symbols.map(s => s.id), ['p3-001', 'p3-002', 'p3-003']);
  assert.deepEqual(lib.symbols[1].letters, [{ text: 'M', x: 25, y: 5, size: 8 }]);
});

test('buildLibrary: rounds to 2 places, keeps same-named rows apart, falls back to the page number for sheet', () => {
  const p = widgetPage();
  p.sheet = '';
  p.rows[2].label = 'ROUND WIDGET';
  p.rows[0].symbolPaths = [{ segs: [300.123456, 120, 340.987654, 140.5049], width: 0.72001, stroked: true, filled: false, grey: 0 }];
  const lib = buildLibrary([p], 'now');
  assert.deepEqual(lib.symbols[0].paths[0], { segs: [0, 0, 40.86, 20.5], width: 0.72, stroked: true, filled: false, grey: 0 });
  assert.deepEqual(lib.symbols.filter(s => s.name === 'ROUND WIDGET').map(s => s.id), ['p3-001', 'p3-003']);
  assert.equal(lib.symbols[0].sheet, '3');
});

test('buildLibrary: hostile input gives an empty library', () => {
  for (const bad of [undefined, null, 5, 'x', [null, 7, { rows: 'x' }]]) {
    const lib = buildLibrary(bad, bad);
    assert.deepEqual([lib.version, lib.symbols, lib.exceptions], [1, [], []]);
  }
});

test('parseLibrary: round trip, and the invented fixture is valid', () => {
  const lib = buildLibrary([widgetPage()], 'now');
  assert.deepEqual(parseLibrary(serialiseLibrary(lib)), { ok: true, library: lib });
  const inv = parseLibrary(INVENTED);
  assert.equal(inv.ok, true);
  assert.deepEqual(libraryCounts(inv.library), { symbols: 4, notes: 2, aliases: 2, exceptions: 2, manual: 1 });
});

test('parseLibrary: a structurally bad or newer file is refused, never half-read', () => {
  assert.deepEqual(parseLibrary('{oops'), { ok: false, error: 'not-json' });
  for (const t of ['[]', 'null', '5', '{}', '{"version":1}', '{"version":1,"symbols":{}}']) assert.deepEqual(parseLibrary(t), { ok: false, error: 'not-a-library' });
  assert.deepEqual(parseLibrary('{"version":2,"symbols":[]}'), { ok: false, error: 'newer-version' });
  for (const s of ['null', '5', '{}', '{"name":""}', '{"name":7}']) assert.deepEqual(parseLibrary('{"version":1,"symbols":[' + s + ']}'), { ok: false, error: 'bad-symbol' });
  for (const bad of [undefined, null, 5, {}]) assert.equal(parseLibrary(bad).ok, false);
});

test('parseLibrary: fills defaults, repairs ids, cleans linework and keeps fields it does not know', () => {
  const r = parseLibrary(JSON.stringify({ version: 1, future: { a: 1 }, symbols: [
    { name: 'A', phase3: [1], paths: [{ segs: [0, 0, 1, 1, 5, null, 6, 7, 9], width: 'x' }, 7], aliases: 'no', notes: [null, { text: 5 }] },
    { name: 'B', id: 'dup' }, { name: 'C', id: 'dup' }] }));
  assert.equal(r.ok, true);
  const [a, b, c] = r.library.symbols;
  assert.deepEqual(r.library.future, { a: 1 });
  assert.deepEqual(a.phase3, [1]);
  assert.deepEqual(a.paths, [{ segs: [0, 0, 1, 1], width: 0, stroked: false, filled: false, grey: 0 }]);
  assert.deepEqual([a.aliases, a.notes, a.legendName, a.tagId, a.flags.manual], [[], [{ text: '5', ref: '', date: '' }], 'A', '', false]);
  assert.equal(new Set([a.id, b.id, c.id]).size, 3);
  assert.equal(b.id, 'dup');
  assert.deepEqual([r.library.legend, r.library.exceptions, r.library.families], [[], [], {}]);
});

test('libraryCounts and normName degrade', () => {
  assert.deepEqual(libraryCounts(null), { symbols: 0, notes: 0, aliases: 0, exceptions: 0, manual: 0 });
  assert.equal(normName('  round \n widget '), 'ROUND WIDGET');
  assert.equal(normName(null), '');
});

const SEARCH_LIB = parseLibrary(JSON.stringify({ version: 1, symbols: [
  { id: 'a', name: 'ROUND WIDGET', group: 'WIDGETS', tagId: 'Q' },
  { id: 'b', name: 'SQUARE WIDGET (LARGE)', group: 'WIDGETS', tagId: 'Q' },
  { id: 'c', name: 'VIEWING PORT', group: 'FITTINGS', tagId: '', aliases: ['peep hole'], notes: [{ text: 'Stands in for the tilting kind.' }] },
  { id: 'd', name: 'Q-TYPE GADGET', group: 'GADGETS', tagId: 'K/KX' },
  { id: 'e', name: 'WIDGET', group: 'WIDGETS', tagId: 'Q' },
  { id: 'f', name: 'MOTOR DRIVE', group: 'DRIVES', tagId: '', letters: [{ text: 'M', x: 0, y: 0, size: 8 }] }],
  exceptions: [{ name: 'GIZMO', status: 'pending', note: 'Awaiting the next palette.' }] })).library;
const ids = q => searchSymbols(SEARCH_LIB, q).map(r => r.kind === 'symbol' ? r.symbol.id : 'x:' + r.exception.name);

test('searchSymbols: an exact name comes first, then closer names', () => {
  assert.deepEqual(ids('widget'), ['e', 'a', 'b']);
  assert.equal(ids('round widget')[0], 'a');
  assert.equal(ids('  Square   WIDGET ')[0], 'b');
});

test('searchSymbols: every word must match somewhere', () => {
  assert.deepEqual(ids('round gadget'), []);
  assert.deepEqual(ids('large widget'), ['b']);
});

test('searchSymbols: aliases, notes, headings and letters are searched', () => {
  assert.equal(ids('peep hole')[0], 'c');
  assert.deepEqual(ids('tilting'), ['c']);
  assert.deepEqual(ids('fittings'), ['c']);
  assert.ok(ids('m').includes('f'));
});

test('searchSymbols: a tag code lists its family first, in library order', () => {
  assert.deepEqual(ids('q'), ['a', 'b', 'e', 'd']);
  assert.deepEqual(ids('kx'), ['d']);
});

test('searchSymbols: plurals and partial words', () => {
  assert.deepEqual(ids('widgets'), ['a', 'b', 'e']);
  assert.equal(ids('view')[0], 'c');
});

test('searchSymbols: an exception answers instead of nothing', () => {
  assert.deepEqual(ids('gizmo'), ['x:GIZMO']);
  assert.deepEqual(ids('palette'), ['x:GIZMO']);
});

test('searchSymbols: an empty query lists everything in library order; hostile input degrades', () => {
  assert.deepEqual(ids(''), ['a', 'b', 'c', 'd', 'e', 'f', 'x:GIZMO']);
  for (const bad of [undefined, null, 5, {}, []]) { assert.deepEqual(searchSymbols(bad, 'x'), []); assert.doesNotThrow(() => searchSymbols(SEARCH_LIB, bad)); }
  assert.deepEqual(searchSymbols({ symbols: [null, 5, { name: 7 }], exceptions: 'x' }, 'a'), []);
});

const lib4 = () => parseLibrary(INVENTED).library;
const sym = (lib, id) => lib.symbols.find(s => s.id === id);

test('updateSymbol: only the editable fields change, and the original is untouched', () => {
  const before = lib4();
  const after = updateSymbol(before, 'p1-001', { name: '  DISC WIDGET ', tagId: 'k', aliases: [' disc ', '', 7], simple: true, id: 'x', paths: [], legendName: 'x' });
  assert.deepEqual([sym(after, 'p1-001').name, sym(after, 'p1-001').tagId, sym(after, 'p1-001').aliases, sym(after, 'p1-001').flags.simple],
    ['DISC WIDGET', 'K', ['disc'], true]);
  assert.deepEqual([sym(after, 'p1-001').legendName, sym(after, 'p1-001').paths.length], ['ROUND WIDGET', 1]);
  assert.equal(sym(before, 'p1-001').name, 'ROUND WIDGET');
  assert.equal(sym(updateSymbol(before, 'p1-001', { name: '   ' }), 'p1-001').name, 'ROUND WIDGET');
  assert.deepEqual(updateSymbol(before, 'nope', { name: 'X' }), before);
});

test('deleteSymbol, addManualSymbol, notes and exceptions', () => {
  assert.equal(deleteSymbol(lib4(), 'p1-002').symbols.length, 3);
  const m = addManualSymbol(lib4(), { name: ' LEVEL BUBBLE ', group: 'BUBBLES', tagId: 'l' });
  assert.equal(m.id, 'm-2');
  assert.deepEqual(sym(m.library, 'm-2'), { id: 'm-2', name: 'LEVEL BUBBLE', legendName: 'LEVEL BUBBLE', group: 'BUBBLES', tagId: 'L', sheet: '',
    w: 0, h: 0, paths: [], letters: [], flags: { simple: false, stretch: false, manual: true, unmatched: false }, aliases: [], notes: [] });
  assert.equal(addManualSymbol(lib4(), { name: ' ' }).id, '');
  const n = addNote(lib4(), 'p1-001', { text: ' Ruling. ', ref: 'RFI 3', date: '2026-11-13' });
  assert.deepEqual(sym(n, 'p1-001').notes, [{ text: 'Ruling.', ref: 'RFI 3', date: '2026-11-13' }]);
  assert.deepEqual(addNote(lib4(), 'p1-001', { text: '  ' }), lib4());
  assert.deepEqual(sym(removeNote(lib4(), 'p1-002', 0), 'p1-002').notes, []);
  const e = setException(setException(lib4(), { name: 'gizmo', status: 'approved' }), { name: 'THINGY', status: 'nonsense' });
  assert.deepEqual(e.exceptions.map(x => [x.name, x.status]), [['gizmo', 'approved'], ['DOOHICKEY', 'approved'], ['THINGY', 'pending']]);
  assert.deepEqual(removeException(lib4(), ' Gizmo ').exceptions.map(x => x.name), ['DOOHICKEY']);
});

test('the edit functions degrade on hostile input', () => {
  for (const bad of [undefined, null, 5, 'x', []]) {
    for (const fn of [updateSymbol, deleteSymbol, addNote, removeNote, setException, removeException]) assert.doesNotThrow(() => fn(bad, bad, bad));
    assert.doesNotThrow(() => addManualSymbol(bad, bad));
    assert.doesNotThrow(() => carryOver(bad, bad));
  }
});

const fresh = names => parseLibrary(JSON.stringify({ version: 1, legend: [{ sheet: '8', rev: 'B04', page: 1 }], importedAt: 'later',
  symbols: names.map((n, i) => ({ id: 'p1-00' + (i + 1), name: n, group: 'WIDGETS', tagId: 'Q' })) })).library;

test('carryOver: notes, aliases and flags follow a symbol by its legend name, even after a hand rename', () => {
  const old = updateSymbol(lib4(), 'p1-002', { name: 'SPY HOLE' });
  const r = carryOver(old, fresh(['VIEWING PORT', 'ROUND WIDGET', 'NEW WIDGET']));
  const port = r.library.symbols.find(s => s.legendName === 'VIEWING PORT');
  assert.deepEqual([port.name, port.aliases, port.notes.length, port.flags.simple, port.id], ['SPY HOLE', ['peep hole'], 1, true, 'p1-001']);
  assert.deepEqual([r.library.importedAt, r.library.legend[0].rev], ['later', 'B04']);
  assert.deepEqual([r.summary.matched, r.summary.notes, r.summary.aliases, r.summary.renames], [2, 1, 1, 1]);
});

test('carryOver: nothing hand-entered is lost when a symbol has gone from the legend', () => {
  const r = carryOver(lib4(), fresh(['ROUND WIDGET']));
  const kept = r.library.symbols.find(s => s.legendName === 'VIEWING PORT');
  assert.deepEqual([kept.flags.unmatched, kept.notes.length, kept.aliases], [true, 1, ['peep hole']]);
  assert.ok(r.unmatched.some(u => u.name === 'VIEWING PORT' && u.notes === 1 && u.aliases === 1));
  assert.equal(new Set(r.library.symbols.map(s => s.id)).size, r.library.symbols.length);
});

test('carryOver: manual entries and exceptions come across; a plain unmatched symbol does not', () => {
  const old = deleteSymbol(lib4(), 'p1-003');
  const r = carryOver(old, fresh(['VIEWING PORT', 'GIZMO']));
  assert.ok(r.library.symbols.some(s => s.name === 'GAUGE BUBBLE' && s.flags.manual));
  assert.ok(!r.library.symbols.some(s => s.legendName === 'ROUND WIDGET'));
  assert.deepEqual([r.summary.manual, r.summary.exceptions, r.summary.dropped], [1, 2, 1]);
  assert.deepEqual(r.library.exceptions.map(e => e.name), ['GIZMO', 'DOOHICKEY']);
  assert.deepEqual(r.exceptionsNowInLibrary, ['GIZMO']);
});

test('carryOver: same-named symbols pair up in order, and a hand-set tag identifier fills a blank one', () => {
  const old = parseLibrary(JSON.stringify({ version: 1, symbols: [
    { id: 'a', name: 'TWIN', group: 'G', tagId: 'K', aliases: ['first'] }, { id: 'b', name: 'TWIN', group: 'G', aliases: ['second'] }] })).library;
  const next = parseLibrary(JSON.stringify({ version: 1, symbols: [
    { id: 'p1-001', name: 'TWIN', group: 'G' }, { id: 'p1-002', name: 'TWIN', group: 'G', tagId: 'Z' }] })).library;
  const r = carryOver(old, next);
  assert.deepEqual(r.library.symbols.map(s => [s.id, s.aliases, s.tagId]), [['p1-001', ['first'], 'K'], ['p1-002', ['second'], 'Z']]);
});

// Final review finding: a symbol the owner renamed or flagged, but never
// annotated, was dropped on re-import when the new legend lacked it.
test('carryOver: a renamed or flagged symbol that has gone from the legend is kept, not only an annotated one', () => {
  const renamed = carryOver(updateSymbol(lib4(), 'p1-001', { name: 'DISC WIDGET' }), fresh(['VIEWING PORT']));
  const kept = renamed.library.symbols.find(s => s.legendName === 'ROUND WIDGET');
  assert.deepEqual([kept && kept.name, kept && kept.flags.unmatched, renamed.summary.dropped], ['DISC WIDGET', true, 0]);
  assert.ok(renamed.unmatched.some(u => u.name === 'DISC WIDGET'));
  for (const flag of ['simple', 'stretch']) {
    const r = carryOver(updateSymbol(lib4(), 'p1-001', { [flag]: true }), fresh(['VIEWING PORT']));
    assert.equal(r.library.symbols.some(s => s.legendName === 'ROUND WIDGET' && s.flags.unmatched && s.flags[flag]), true, flag);
  }
});
