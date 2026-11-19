// Legend rules (2026-11-18): Legend Sheet 1's sample boxes (LINE TYPES, LINE DEMARCATION, INSTRUMENTATION
// DESIGNATION) read into judge-only symbols and line marks. Invented pages only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleRows, buildLibrary } from '../assets/js/pid-symbols.js';
import * as C from '../assets/js/pid-symbol-check.js';
import { SWEEP_LIBRARY, place } from './fixtures/symbol-check-sheet.js';

const ln = segs => ({ segs, width: 0.5, stroked: true, filled: false, grey: 0 });
const word = (str, x, y, h = 10) => ({ str, x, y, w: str.length * 6, h });
// A LINE TYPES box at (0, 0)-(600, 300): a heading, then samples left of their names.
const linePage = () => {
  const paths = [], words = [word('LINE TYPES', 20, 10, 14)];
  // SIGNAL - ELECTRIC: a line 100..190 at y 50 in pieces, an E-ish tick every 14 pt.
  for (let x = 100; x < 190; x += 14) paths.push(ln([x, 50, Math.min(x + 14, 190), 50]));
  for (let x = 107; x < 185; x += 14) paths.push(ln([x + 3, 46, x, 46, x, 46, x, 54, x, 54, x + 3, 54]));
  words.push(word('SIGNAL - ELECTRIC', 220, 45));
  // DIRECTION FLOW ARROW: a solid triangle.
  paths.push({ segs: [140, 96, 150, 100, 150, 100, 140, 104, 140, 104, 140, 96], width: 0, stroked: false, filled: true, grey: 0 });
  words.push(word('DIRECTION FLOW ARROW', 220, 95));
  // PIPELINE - MAJOR PROCESS: a plain thick line, not read.
  paths.push({ ...ln([100, 150, 190, 150]), width: 2 });
  words.push(word('PIPELINE - MAJOR PROCESS', 220, 145));
  return { paths, words, areas: [{ box: [0, 0, 600, 300] }] };
};

test('LINE TYPES: a signal gives one tick on its bit of line; a flow arrow a judge-only symbol; a pipeline nothing', () => {
  const { paths, words, areas } = linePage();
  const rows = sampleRows(paths, words, areas);
  assert.deepEqual(rows.map(r => r.label).sort(), ['DIRECTION FLOW ARROW', 'SIGNAL - ELECTRIC']);
  const sig = rows.find(r => r.label === 'SIGNAL - ELECTRIC');
  assert.equal(sig.lineMark, 'signal');
  assert.equal(sig.judgeOnly, true);
  assert.equal(sig.header, 'LINE TYPES');
  // One tick (x 107..110) and the line under it, not six.
  assert.ok(sig.box[2] - sig.box[0] < 8, JSON.stringify(sig.box));
  assert.equal(sig.symbolPaths.filter(p => p.segs.length > 4).length, 1);
  const arrow = rows.find(r => r.label === 'DIRECTION FLOW ARROW');
  assert.equal(arrow.lineMark, null);
  assert.equal(arrow.symbolPaths.length, 1);
});

test('a box with another heading is not read; hostile input gives nothing and never throws', () => {
  const { paths, words, areas } = linePage();
  words[0] = word('NOTES', 20, 10, 14);
  assert.deepEqual(sampleRows(paths, words, areas), []);
  assert.deepEqual(sampleRows(null, undefined, 7), []);
  assert.deepEqual(sampleRows([{ segs: 'x' }], [{ str: 5 }], [{ box: [NaN] }]), []);
});

test('LINE DEMARCATION: a composite sample is cut into its parts; the stem joining them belongs to none', () => {
  const words = [word('LINE DEMARCATION', 20, 10, 14), word('TIE-IN POINT NUMBER', 150, 60), word('MARKER', 150, 71), word('TIE-IN POINT', 150, 120)];
  // One path: a stem from (80, 130) up to a diamond, round the diamond (60..100, 50..80) back to its foot.
  const comp = ln([80, 130, 80, 80, 80, 80, 100, 65, 100, 65, 80, 50, 80, 50, 60, 65, 60, 65, 80, 80]);
  const dot = { segs: [78, 128, 82, 128, 82, 128, 82, 132, 82, 132, 78, 132, 78, 132, 78, 128], width: 0.5, stroked: true, filled: false, grey: 0 };
  const rows = sampleRows([comp, dot], words, [{ box: [0, 0, 400, 200] }]);
  const marker = rows.find(r => r.label === 'TIE-IN POINT NUMBER MARKER'), point = rows.find(r => r.label === 'TIE-IN POINT');
  assert.ok(marker && point, JSON.stringify(rows.map(r => r.label)));
  assert.deepEqual(marker.box, [60, 50, 100, 80]);
  assert.deepEqual(point.box, [78, 128, 82, 132]);
});

test('INSTRUMENTATION DESIGNATION: a small circle, square and triangle named by their sentences', () => {
  const words = [word('INSTRUMENTATION', 10, 10, 15), word('DESIGNATION', 10, 27, 15)];
  const paths = [];
  const ring = Array.from({ length: 16 }, (_, i) => { const a = i * Math.PI / 8, b = (i + 1) * Math.PI / 8; return [104 + 3.5 * Math.cos(a), 104 + 3.5 * Math.sin(a), 104 + 3.5 * Math.cos(b), 104 + 3.5 * Math.sin(b)]; }).flat();
  const shapes = { Circle: ring, Square: [100, 150, 107, 150, 107, 150, 107, 157, 107, 157, 100, 157, 100, 157, 100, 150],
    Triangle: [100, 207, 103.5, 200, 103.5, 200, 107, 207, 107, 207, 100, 207] };
  const says = { Circle: ['Circle shown to the right of PCE Symbol to', 'identify Good Engineering Practice (GEP).'],
    Square: ['Square shown to the right of PCE Symbol', 'to identify process Quality Elements.'], Triangle: ['Triangle shown to the right of PCE Symbol', 'to identify process Safety Elements.'] };
  let y = 100;
  for (const k of ['Circle', 'Square', 'Triangle']) { paths.push(ln(shapes[k])); words.push(word(says[k][0], 120, y - 6), word(says[k][1], 120, y + 6)); y += 50; }
  const rows = sampleRows(paths, words, []);
  assert.deepEqual(rows.map(r => r.label), ['GEP MARK', 'QUALITY MARK', 'SAFETY MARK']);
  assert.ok(rows.every(r => r.judgeOnly === true && r.lineMark === null && r.header === 'INSTRUMENTATION DESIGNATION'));
  // No heading on the page: nothing.
  assert.deepEqual(sampleRows(paths, words.slice(2), []), []);
});

test('buildLibrary keeps the samples as judge-only symbols, line marks with their kind', () => {
  const { paths, words, areas } = linePage();
  const lib = buildLibrary([{ page: 1, sheet: '1', rev: 'A', rows: [], samples: sampleRows(paths, words, areas) }], '2026-11-18');
  const sig = lib.symbols.find(s => s.name === 'SIGNAL - ELECTRIC'), arrow = lib.symbols.find(s => s.name === 'DIRECTION FLOW ARROW');
  assert.equal(sig.flags.judgeOnly, true);
  assert.equal(sig.flags.lineMark, 'signal');
  assert.equal(arrow.flags.judgeOnly, true);
  assert.equal('lineMark' in arrow.flags, false);
  assert.ok(sig.id.startsWith('p1-s'));
});

test('the sweep never lists a judge-only symbol or a line mark', () => {
  const W = SWEEP_LIBRARY.symbols[0];
  const only = { ...SWEEP_LIBRARY, symbols: [{ ...W, flags: { ...W.flags, judgeOnly: true } }, { ...W, id: 'lm', name: 'MARKED', flags: { ...W.flags, lineMark: 'signal' } }] };
  const paths = place(W, { x: 100, y: 100 });
  const r = C.sweepSymbols({ paths, library: only, pageSize: [300, 250] });
  assert.equal(r.spots.length, 0);
  const prepared = C.prepareSymbols(only);
  assert.deepEqual(prepared.map(p => [p.checkable, p.why, p.judgeOnly, p.lineMark]), [[false, 'judge-only', true, null], [false, 'judge-only', true, 'signal']]);
  const sheet = C.checkSheet({ pageSize: [300, 250], viewportTransform: [1, 0, 0, 1, 0, 0], textItems: [], tags: [], paths, library: only, lookups: {} });
  assert.equal(sheet.symbols.length, 0);
});
