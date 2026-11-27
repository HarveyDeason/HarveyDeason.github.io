// Rev compare, symbols: the symbol check of two revisions of a drawing, summarised and set side by side. Invented shapes only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summariseSymbols, compareSymbols } from '../assets/js/pid-rev-symbols.js';

const std = (...names) => ({ verdict: 'standard', parts: names });
const flag = (kind, name) => ({ verdict: 'not-standard', reason: { kind, name } });
const unk = () => ({ verdict: 'not-identified' });
const R = (...shapes) => ({ ok: true, shapes });

test('summariseSymbols: standard symbols counted by name (a shape of several parts counts each), flags by kind and name, unknowns', () => {
  const s = summariseSymbols(R(std('BALL'), std('BALL'), std('PERISTALTIC PUMP', 'ELECTRIC MOTOR'), flag('extra', 'FLEXIBLE HOSE'), flag('extra', 'FLEXIBLE HOSE'), flag('differs', 'PLUG'), unk()));
  assert.equal(s.ok, true);
  assert.deepEqual(s.standard, { BALL: 2, 'PERISTALTIC PUMP': 1, 'ELECTRIC MOTOR': 1 });
  assert.deepEqual(s.flagged, { 'extra|FLEXIBLE HOSE': 2, 'differs|PLUG': 1 });
  assert.equal(s.notIdentified, 1);
  assert.equal(s.shapes, 7);
});

test('summariseSymbols: a check that did not run is not ok, and hostile input never throws', () => {
  for (const bad of [null, undefined, 7, 'x', {}, { ok: false, why: 'failed' }, { ok: true, shapes: 'x' }, { ok: true, shapes: [null, 3, { verdict: 'standard', parts: 'x' }, { verdict: 'standard' }] }]) {
    assert.doesNotThrow(() => summariseSymbols(bad));
  }
  assert.equal(summariseSymbols(null).ok, false);
  assert.equal(summariseSymbols({ ok: false, why: 'no-library' }).ok, false);
  assert.equal(summariseSymbols({ ok: true, shapes: [null, { verdict: 'standard' }] }).ok, true);
});

test('compareSymbols: what changed by name, what is unchanged, and the flags that appeared and went', () => {
  const a = summariseSymbols(R(std('BALL'), std('BALL'), std('GATE'), std('CHECK'), flag('extra', 'FLEXIBLE HOSE'), unk()));
  const b = summariseSymbols(R(std('BALL'), std('BALL'), std('BALL'), std('CHECK'), std('PUMP'), flag('differs', 'PLUG'), unk(), unk()));
  const c = compareSymbols(a, b);
  assert.deepEqual(c.standard.map(r => [r.name, r.a, r.b, r.delta]), [['BALL', 2, 3, 1], ['GATE', 1, 0, -1], ['PUMP', 0, 1, 1]]);
  assert.equal(c.unchangedNames, 1);                     // CHECK
  assert.deepEqual(c.flagged.map(r => [r.kind, r.name, r.a, r.b, r.delta]), [['differs', 'PLUG', 0, 1, 1], ['extra', 'FLEXIBLE HOSE', 1, 0, -1]]);
  assert.deepEqual(c.notIdentified, { a: 1, b: 2, delta: 1 });
  assert.deepEqual(c.totals, { standardA: 4, standardB: 5, flaggedA: 1, flaggedB: 1 });
});

test('compareSymbols: identical revisions differ in nothing; either side not ok is reported, not compared', () => {
  const a = summariseSymbols(R(std('BALL'), flag('extra', 'X')));
  const same = compareSymbols(a, summariseSymbols(R(std('BALL'), flag('extra', 'X'))));
  assert.deepEqual([same.standard.length, same.flagged.length, same.notIdentified.delta], [0, 0, 0]);
  assert.equal(same.unchangedNames, 1);
  const bad = compareSymbols(a, summariseSymbols(null));
  assert.equal(bad.ok, false);
  assert.deepEqual(compareSymbols(null, null).ok, false);
});
