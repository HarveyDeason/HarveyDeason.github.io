// Phase 3: reading the owner's marked answer key and scoring the check against it.
// Invented annotations and an invented library only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAnswerKey, scoreAgainstKey } from '../scripts/answer-key.mjs';
import { LIBRARY } from './fixtures/symbol-check-sheet.js';

// pdf.js annotation data, PDF user space (y up) on an 800 pt high page.
const VT = [1, 0, 0, -1, 0, 800];
const sq = (text, rect, extra = {}) => ({ subtype: 'Square', rect, contentsObj: { str: text }, titleObj: { str: 'answer-key' }, ...extra });

test('first words and names: standard, not standard, closest, unknown first word, unknown name', () => {
  const k = readAnswerKey([
    sq('STANDARD: widget', [100, 700, 124, 712]),
    sq('not standard', [200, 700, 220, 720]),
    sq('NOT STANDARD: closest GADGET', [300, 700, 320, 720]),
    sq('maybe', [400, 700, 420, 720]),
    sq('STANDARD: BANANA', [500, 700, 520, 720]),
    sq('Non-standard', [600, 700, 620, 720]),
  ], VT, LIBRARY);
  assert.equal(k.boxes.length, 5);
  assert.deepEqual(k.boxes[0], { box: [100, 88, 124, 100], standard: true, name: 'WIDGET', family: 'W' });
  assert.deepEqual(k.boxes[1], { box: [200, 80, 220, 100], standard: false, name: null, family: null });
  assert.equal(k.boxes[2].standard, false);
  assert.equal(k.boxes[2].name, 'GADGET');
  assert.equal(k.boxes[3].standard, true);
  assert.equal(k.boxes[3].name, null);
  assert.equal(k.boxes[4].standard, false);
  assert.deepEqual(k.unread.map(u => u.reason), ['first word', 'name']);
  assert.deepEqual(k.unread.map(u => u.text), ['maybe', 'STANDARD: BANANA']);
});

test('only rectangles are boxes: a circle is listed, not read; a four-point polygon is read', () => {
  const k = readAnswerKey([
    { subtype: 'Circle', rect: [0, 0, 10, 10], contentsObj: { str: 'STANDARD: WIDGET' } },
    { subtype: 'Polygon', rect: [10, 700, 40, 720], vertices: [10, 700, 40, 700, 40, 720, 10, 720], contentsObj: { str: 'NOT STANDARD' } },
    { subtype: 'Polygon', rect: [10, 700, 40, 720], vertices: [10, 700, 40, 700, 25, 720], contentsObj: { str: 'NOT STANDARD' } },
    { subtype: 'Text', rect: [0, 0, 10, 10], contentsObj: { str: '' } },
  ], VT, LIBRARY);
  assert.equal(k.boxes.length, 1);
  assert.deepEqual(k.boxes[0].box, [10, 80, 40, 100]);
  assert.deepEqual(k.unread.map(u => u.reason), ['not a rectangle', 'not a rectangle']);
});

test('a rotated page gives the box in page points, as its unrotated twin', () => {
  // A 90 degree page: pdf.js viewport transform [0, 1, 1, 0, 0, 0] for a page whose user space is 800 wide.
  const flat = readAnswerKey([sq('NOT STANDARD', [100, 200, 130, 210])], [1, 0, 0, 1, 0, 0], LIBRARY).boxes[0].box;
  const turned = readAnswerKey([sq('NOT STANDARD', [100, 200, 130, 210])], [0, 1, 1, 0, 0, 0], LIBRARY).boxes[0].box;
  assert.deepEqual(flat, [100, 200, 130, 210]);
  assert.deepEqual(turned, [200, 100, 210, 130]);
});

test('hostile annotations never throw', () => {
  const empty = { boxes: [], unread: [] };
  assert.deepEqual(readAnswerKey(null, VT, LIBRARY), empty);
  assert.deepEqual(readAnswerKey([null, 5, { subtype: 'Square', rect: [NaN, 0, 1, 1], contentsObj: { str: 'STANDARD' } }, { subtype: 'Square', rect: [0, 0, 1, 1] }], VT, LIBRARY).boxes, []);
  assert.doesNotThrow(() => readAnswerKey([sq('STANDARD: WIDGET', [0, 0, 5, 5])], null, null));
  const k = readAnswerKey([sq('STANDARD: WIDGET', [0, 0, 5, 5])], 'x', { symbols: 'no' });
  assert.equal(k.boxes.length, 1);
  assert.equal(k.boxes[0].name, null);
});

// Tool shapes as checkSheet returns them (Task 4), and symbols they index.
const SYMS = [{ name: 'WIDGET', tagId: 'W', box: [100, 100, 124, 112] }, { name: 'GADGET', tagId: 'G', box: [300, 100, 320, 120] }];
const shape = (id, box, standard, symbols = []) => ({ id, box, standard, why: standard ? null : 'left-over', symbols });

test('scoring: caught, false flags, missed, flagged not-a-symbol, named right', () => {
  const key = { boxes: [
    { box: [99, 99, 125, 113], standard: true, name: 'WIDGET', family: 'W' },    // matches shape 0, standard, named right
    { box: [299, 99, 321, 121], standard: true, name: 'GADGET', family: 'G' },   // matches shape 1, which the tool flagged: a false flag (still named right)
    { box: [500, 100, 520, 120], standard: false, name: null, family: null },     // matches shape 2, flagged: caught
    { box: [700, 100, 720, 120], standard: false, name: null, family: null },     // no tool shape: missed
  ], unread: [{ reason: 'name', text: 'STANDARD: BANANA' }] };
  const shapes = [shape(0, [100, 100, 124, 112], true, [0]), shape(1, [300, 100, 320, 120], false, [1]),
    shape(2, [500, 100, 520, 120], false), shape(3, [900, 100, 920, 120], false), shape(4, [900, 300, 920, 320], true)];
  const s = scoreAgainstKey(key, shapes, SYMS);
  assert.deepEqual({ keyStandard: s.keyStandard, keyNot: s.keyNot, caught: s.caught, falseFlags: s.falseFlags, missed: s.missed,
    notASymbolFlagged: s.notASymbolFlagged, namedRight: s.namedRight, toolShapes: s.toolShapes, unread: s.unread, unboxed: s.unboxed },
  { keyStandard: 2, keyNot: 2, caught: 1, falseFlags: 1, missed: 1, notASymbolFlagged: 1, namedRight: 2, toolShapes: 5, unread: 1, unboxed: 2 });
  assert.equal(s.lists.missed.length, 1);
  assert.deepEqual(s.lists.missed[0].box, [700, 100, 720, 120]);
});

test('scoring is one to one: one key box over two tool shapes, two key boxes over one tool shape', () => {
  const one = scoreAgainstKey({ boxes: [{ box: [100, 100, 160, 120], standard: true, name: null, family: null }], unread: [] },
    [shape(0, [100, 100, 124, 120], true), shape(1, [136, 100, 160, 120], true)], []);
  assert.equal(one.matched, 1);
  assert.equal(one.unboxed, 1);
  const two = scoreAgainstKey({ boxes: [{ box: [100, 100, 124, 120], standard: true, name: null, family: null },
    { box: [136, 100, 160, 120], standard: true, name: null, family: null }], unread: [] },
  [shape(0, [100, 100, 160, 120], true)], []);
  assert.equal(two.matched, 1);
  assert.equal(two.missed, 1);
});

test('scoring: shapes with no standard field (the Task 2 shapes file) count a named shape as standard', () => {
  const s = scoreAgainstKey({ boxes: [{ box: [0, 0, 10, 10], standard: false, name: null, family: null }], unread: [] },
    [{ id: 0, box: [0, 0, 10, 10], name: null, score: null }], []);
  assert.equal(s.caught, 1);
});

test('scoring hostile input never throws', () => {
  for (const args of [[null, null, null], [{ boxes: 'x' }, [null, { box: [NaN] }], 5], [{ boxes: [{ box: [0, 0, 0, 0], standard: true }] }, [{ box: [0, 0, 0, 0] }], []]]) {
    const s = scoreAgainstKey(...args);
    assert.equal(typeof s.caught, 'number');
  }
});

test('a rectangle with no text is listed, not dropped', () => {
  const k = readAnswerKey([sq('', [100, 700, 124, 712]), { subtype: 'Square', rect: [0, 0, 5, 5] }], VT, LIBRARY);
  assert.equal(k.boxes.length, 0);
  assert.deepEqual(k.unread.map(u => u.reason), ['no text', 'no text']);
});
