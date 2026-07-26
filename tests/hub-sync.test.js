import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeById, mergeList, mergeTombstones } from '../assets/js/hub-sync.js';

const R = (id, updatedAt, v) => ({ id, updatedAt, v });

test('mergeById: later updatedAt wins, symmetric', () => {
  const a = [R('x', '2026-07-26T10:00:00Z', 1)];
  const b = [R('x', '2026-07-26T11:00:00Z', 2)];
  assert.equal(mergeById(a, b, {})[0].v, 2);
  assert.equal(mergeById(b, a, {})[0].v, 2);
});

test('mergeById: tombstone at/after updatedAt removes; later edit survives', () => {
  const a = [R('x', '2026-07-26T10:00:00Z', 1)];
  assert.equal(mergeById(a, [], { x: '2026-07-26T10:00:00Z' }).length, 0);
  assert.equal(mergeById(a, [], { x: '2026-07-26T09:00:00Z' }).length, 1);
});

test('mergeList dedupes case-insensitively keeping first spelling', () => {
  assert.deepEqual(mergeList(['HAZOP', 'Minutes'], ['hazop', 'Datasheet']), ['HAZOP', 'Minutes', 'Datasheet']);
});

test('mergeTombstones takes max per id', () => {
  assert.deepEqual(
    mergeTombstones({ a: '2026-01-01T00:00:00Z' }, { a: '2026-02-01T00:00:00Z', b: '2026-01-05T00:00:00Z' }),
    { a: '2026-02-01T00:00:00Z', b: '2026-01-05T00:00:00Z' });
});
