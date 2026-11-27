// Report grouping: shapes with the same symbol, verdict and fault share one number. Invented shapes only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../assets/js/pid-symbol-groups.js';

let at = 0;
const std = (name, y = 10 * ++at, x = 0) => ({ verdict: 'standard', reason: null, parts: [{ name, role: 'body' }], box: [x, y, x + 8, y + 8] });
const size = (name, pct, y = 10 * ++at, x = 0) => ({ verdict: 'not-standard', reason: { kind: 'size', name, pct }, parts: [{ name, role: 'body' }], box: [x, y, x + 8, y + 8] });
const extra = (name, y = 10 * ++at) => ({ verdict: 'not-standard', reason: { kind: 'extra', name }, parts: [{ name, role: 'body' }], box: [0, y, 8, y + 8] });
const grey = (y = 10 * ++at) => ({ verdict: 'not-identified', reason: null, parts: [], box: [0, y, 8, y + 8] });

test('the tolerance is pinned', () => { assert.equal(G.GROUP_PCT_TOL, 2); });

test('four standard BALLs are one group of 4 with no example', () => {
  const r = G.groupShapes([std('BALL'), std('BALL'), std('BALL'), std('BALL')]);
  assert.equal(r.groups.length, 1);
  assert.deepEqual([r.groups[0].name, r.groups[0].verdict, r.groups[0].count, r.groups[0].example], ['BALL', 'standard', 4, null]);
});

test('75 and 76 percent size faults share a group; measured from the first member, 75 to 77 do and 78 does not', () => {
  const s = [size('BALL', 75), size('BALL', 76), size('BALL', 77), size('BALL', 78)];
  const r = G.groupShapes(s);
  assert.deepEqual(r.groups.map(g => g.count).sort(), [1, 3]);
  assert.equal(r.noOf(s[0]), r.noOf(s[2]));
  assert.notEqual(r.noOf(s[0]), r.noOf(s[3]));
});

test('different faults of one symbol, and the standard ones, are different groups', () => {
  const s = [std('BALL'), size('BALL', 75), extra('BALL')];
  const r = G.groupShapes(s);
  assert.equal(r.groups.length, 3);
  assert.equal(new Set(s.map(x => r.noOf(x))).size, 3);
});

test('amber groups are numbered before standard, largest first, ties in reading order', () => {
  const a = size('BALL', 75, 100), b = size('GATE', 60, 20), c = size('GATE', 60, 30), d = extra('MOTOR', 5), e = std('PUMP', 1), f = std('PUMP', 2), g = std('PUMP', 3);
  const r = G.groupShapes([a, b, c, d, e, f, g]);
  assert.deepEqual(r.groups.map(x => x.name + ':' + x.count), ['GATE:2', 'MOTOR:1', 'BALL:1', 'PUMP:3']);
  assert.deepEqual(r.groups.map(x => x.no), [1, 2, 3, 4]);
  assert.equal(r.groups[0].example, b);   // first member in reading order
});

test('not-identified and not-judged shapes have no number and no group', () => {
  const g1 = grey(), g2 = { verdict: 'not-judged', box: [0, 0, 1, 1] }, s = std('BALL');
  const r = G.groupShapes([g1, g2, s]);
  assert.equal(r.noOf(g1), null); assert.equal(r.noOf(g2), null); assert.equal(r.noOf(s), 1);
  assert.equal(r.groups.length, 1);
});

test('a shape with two symbols is named by its body; a wrong match with no parts by its reason, then its closest', () => {
  const two = { verdict: 'standard', reason: null, parts: [{ name: 'HANDLE', role: 'attachment' }, { name: 'WIDGET', role: 'body' }], box: [0, 1, 2, 3] };
  const bare = { verdict: 'not-standard', reason: { kind: 'differs', name: 'DIAPHRAGM', pct: 85 }, parts: [], box: [0, 5, 2, 7] };
  const noReason = { verdict: 'not-standard', reason: { kind: 'tag', tag: 'X' }, parts: [], closest: { name: 'BUTTERFLY' }, box: [0, 9, 2, 11] };
  const r = G.groupShapes([two, bare, noReason]);
  assert.deepEqual(r.groups.map(g => g.name).sort(), ['BUTTERFLY', 'DIAPHRAGM', 'WIDGET']);
});

test('an empty or hostile list gives no groups and never throws', () => {
  for (const x of [[], null, undefined, 'x', [null, 7, {}], [{ verdict: 'standard' }]]) {
    assert.doesNotThrow(() => G.groupShapes(x));
    assert.equal(Array.isArray(G.groupShapes(x).groups), true);
    assert.equal(typeof G.groupShapes(x).noOf, 'function');
  }
  assert.deepEqual(G.groupShapes([]).groups, []);
});

test('a result from before the verdicts (only `standard`) still groups, and the caller may name the shapes', () => {
  const a = { standard: true, box: [0, 1, 2, 3], symbols: [0] }, b = { standard: true, box: [0, 5, 2, 7], symbols: [0] }, c = { standard: false, box: [0, 9, 2, 11], symbols: [] };
  const r = G.groupShapes([a, b, c], { nameOf: s => (s.symbols.length ? 'WIDGET + HANDLE' : '') });
  assert.deepEqual(r.groups.map(g => [g.name, g.verdict, g.count]), [['WIDGET + HANDLE', 'standard', 2]]);
  assert.equal(r.noOf(c), null);
});
