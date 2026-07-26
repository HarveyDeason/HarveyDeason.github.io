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

import { createSyncEngine } from '../assets/js/hub-sync.js';

function fakeDir(files = {}, opts = {}) {
  const stats = { writes: [], openWriters: 0, maxConcurrent: 0 };
  const dir = {
    stats, files,
    getFileHandle: async (name, o) => {
      if (!o?.create && !(name in files)) { const e = new Error('missing'); e.name = 'NotFoundError'; throw e; }
      return {
        getFile: async () => ({ text: async () => files[name] }),
        createWritable: async () => {
          if (opts.failWrites) { const e = new Error('locked'); e.name = 'NoModificationAllowedError'; throw e; }
          stats.openWriters++; stats.maxConcurrent = Math.max(stats.maxConcurrent, stats.openWriters);
          let buf = '';
          return { write: async c => { await new Promise(r => setTimeout(r, opts.delay || 0)); buf = c; },
                   close: async () => { stats.openWriters--; files[name] = buf; stats.writes.push(name); } };
        },
      };
    },
  };
  return dir;
}

function makeEngine(dir, extra = {}) {
  let state = { savedAt: '', items: [], tombstones: {} };
  const events = [];
  const engine = createSyncEngine({
    fileName: 'x.json', backupName: 'x.backup.json',
    getDir: () => dir, getState: () => state, setState: s => { state = s; },
    merge: (l, d) => ({ ...l, items: [...new Map([...d.items, ...l.items].map(i => [i.id, i])).values()] }),
    onStatus: (s, m) => events.push([s, m]),
    afterSave: async () => { events.push(['afterSave']); },
    ...extra,
  });
  return { engine, events, getState: () => state };
}

test('engine: readLedger distinguishes missing / corrupt / ok', async () => {
  const { engine: e1 } = makeEngine(fakeDir({}));
  assert.equal((await e1.readLedger()).status, 'missing');
  const { engine: e2 } = makeEngine(fakeDir({ 'x.json': '{oops' }));
  assert.equal((await e2.readLedger()).status, 'corrupt');
  const { engine: e3 } = makeEngine(fakeDir({ 'x.json': '{"items":[]}' }));
  assert.equal((await e3.readLedger()).status, 'ok');
});

test('engine: saveNow writes backup of previous disk content, then ledger', async () => {
  const dir = fakeDir({ 'x.json': '{"savedAt":"","items":[{"id":"old"}],"tombstones":{}}' });
  const { engine } = makeEngine(dir);
  assert.equal(await engine.saveNow([]), true);
  assert.ok(dir.files['x.backup.json'].includes('old'));
  assert.ok(dir.files['x.json'].includes('savedAt'));
});

test('engine: corrupt ledger blocks save with error status, saveNow returns false', async () => {
  const dir = fakeDir({ 'x.json': 'not json' });
  const { engine, events } = makeEngine(dir);
  assert.equal(await engine.saveNow([]), false);
  assert.ok(events.some(([s]) => s === 'error'));
  assert.equal(dir.files['x.json'], 'not json'); // never overwritten
});

test('engine: queueSave single-flight, coalesces, never more than one writer', async () => {
  const dir = fakeDir({}, { delay: 30 });
  const { engine } = makeEngine(dir);
  engine.queueSave(['a']); engine.queueSave(['b']); engine.queueSave(null);
  await new Promise(r => setTimeout(r, 400));
  assert.equal(dir.stats.maxConcurrent, 1);
  assert.ok(dir.stats.writes.filter(w => w === 'x.json').length <= 2); // initial + one coalesced follow-up
});

test('engine: failed queueSave reports error and does not throw', async () => {
  const dir = fakeDir({}, { failWrites: true });
  const { engine, events } = makeEngine(dir);
  engine.queueSave([]);
  await new Promise(r => setTimeout(r, 100));
  assert.ok(events.some(([s]) => s === 'error'));
});
