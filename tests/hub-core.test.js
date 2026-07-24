// tests/hub-core.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, mergeState, DEFAULT_CATEGORIES } from '../assets/js/hub-core.js';

const P = (id, updatedAt, name = 'OSB-01') =>
  ({ id, name, type: 'OSB item', pidDrawings: [], modelRef: '', sheetRefs: '', updatedAt });
const C = (id, updatedAt, extra = {}) => ({
  id, ref: 'HUB-0001', productIds: ['p1'], affectedTypes: ['P&ID'], category: 'Pipework change',
  source: 'Site feedback', dateRaised: '2026-07-24', raisedBy: 'A N Other', description: 'x',
  priority: 'medium', status: 'open', hold: false, pidRevision: '', dateClosed: '', actionTaken: '',
  closedBy: '', updatedAt, ...extra,
});

test('emptyState seeds defaults', () => {
  const s = emptyState('2026-07-24T00:00:00Z');
  assert.equal(s.version, 1);
  assert.deepEqual(s.lists.categories, DEFAULT_CATEGORIES);
  assert.equal(s.refCounter, 0);
});

test('mergeState: later updatedAt wins per comment id', () => {
  const local = { ...emptyState('t'), comments: [C('c1', '2026-07-24T10:00:00Z', { description: 'old' })] };
  const disk  = { ...emptyState('t'), comments: [C('c1', '2026-07-24T11:00:00Z', { description: 'new' })] };
  assert.equal(mergeState(local, disk).comments[0].description, 'new');
  assert.equal(mergeState(disk, local).comments[0].description, 'new'); // symmetric
});

test('mergeState: union of distinct records from both sides', () => {
  const local = { ...emptyState('t'), products: [P('p1', '2026-07-24T10:00:00Z')] };
  const disk  = { ...emptyState('t'), products: [P('p2', '2026-07-24T10:00:00Z', 'OSB-02')] };
  assert.equal(mergeState(local, disk).products.length, 2);
});

test('mergeState: tombstone at/after updatedAt removes record; max tombstone kept', () => {
  const local = { ...emptyState('t'), comments: [C('c1', '2026-07-24T10:00:00Z')] };
  const disk  = { ...emptyState('t'), tombstones: { c1: '2026-07-24T10:00:00Z' } };
  const m = mergeState(local, disk);
  assert.equal(m.comments.length, 0);
  assert.equal(m.tombstones.c1, '2026-07-24T10:00:00Z');
});

test('mergeState: record edited after tombstone survives (reinstated)', () => {
  const local = { ...emptyState('t'), comments: [C('c1', '2026-07-24T12:00:00Z')] };
  const disk  = { ...emptyState('t'), tombstones: { c1: '2026-07-24T10:00:00Z' } };
  assert.equal(mergeState(local, disk).comments.length, 1);
});

test('mergeState: lists deduped case-insensitively, local order first', () => {
  const local = { ...emptyState('t') };
  const disk  = { ...emptyState('t') };
  disk.lists = { categories: ['pipework change', 'Cable change'], sources: [] };
  const m = mergeState(local, disk);
  assert.equal(m.lists.categories.filter(c => c.toLowerCase() === 'pipework change').length, 1);
  assert.ok(m.lists.categories.includes('Cable change'));
});

test('mergeState: refCounter takes the max, does not mutate inputs', () => {
  const local = { ...emptyState('t'), refCounter: 7 };
  const disk  = { ...emptyState('t'), refCounter: 12 };
  const snapshot = JSON.stringify(local);
  assert.equal(mergeState(local, disk).refCounter, 12);
  assert.equal(JSON.stringify(local), snapshot);
});
