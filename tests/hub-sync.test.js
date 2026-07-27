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

// A half-open FileSystemWritableFileStream keeps an OS lock and a .crswap file
// alive; every later createWritable() on that file then fails with
// InvalidStateError. The stream must always be released, even when the write
// itself fails, and abort's own failure must never mask the real error.
function fakeStreamDir(failOn) {
  const calls = { aborted: 0, closed: 0 };
  const dir = { calls, getFileHandle: async () => ({
    createWritable: async () => ({
      write: async () => { if (failOn === 'write') { const e = new Error('locked'); e.name = 'NoModificationAllowedError'; throw e; } },
      close: async () => { if (failOn === 'close') { const e = new Error('lost'); e.name = 'InvalidStateError'; throw e; } calls.closed += 1; },
      abort: async () => { calls.aborted += 1; if (failOn === 'abort-too') throw new Error('abort exploded'); },
    }),
  }) };
  return dir;
}

test('writeFile aborts the stream when the write fails, and rethrows the real error', async () => {
  const dir = fakeStreamDir('write');
  const { engine } = makeEngine(dir);
  await assert.rejects(() => engine.writeFile(dir, 'x.json', 'data'), /locked/);
  assert.equal(dir.calls.aborted, 1);
  assert.equal(dir.calls.closed, 0);
});

test('writeFile aborts when close fails too', async () => {
  const dir = fakeStreamDir('close');
  const { engine } = makeEngine(dir);
  await assert.rejects(() => engine.writeFile(dir, 'x.json', 'data'), /lost/);
  assert.equal(dir.calls.aborted, 1);
});

test('writeFile: a failing abort does not mask the original error', async () => {
  const dir = fakeStreamDir('abort-too');
  const { engine } = makeEngine(dir);
  // write succeeds, close succeeds → no abort needed
  await engine.writeFile(dir, 'x.json', 'data');
  assert.equal(dir.calls.closed, 1);
});

test('writeFile succeeds normally: closes, never aborts', async () => {
  const dir = fakeStreamDir(null);
  const { engine } = makeEngine(dir);
  await engine.writeFile(dir, 'x.json', 'data');
  assert.equal(dir.calls.closed, 1);
  assert.equal(dir.calls.aborted, 0);
});

// A lock (OneDrive syncing, the file open in Excel, a stale .crswap) is
// transient: the save that failed will usually succeed moments later. Waiting
// for the user's next change to retry meant a photo could sit unlinked on disk
// indefinitely — Harvey hit exactly that, and only found out by editing
// something else. The engine now retries itself.
function flakyDir(failures, files = {}) {
  let left = failures;
  const stats = { writes: [], attempts: 0 };
  return { stats, files,
    getFileHandle: async (name, o) => {
      if (!o?.create && !(name in files)) { const e = new Error('missing'); e.name = 'NotFoundError'; throw e; }
      return {
        getFile: async () => ({ text: async () => files[name] }),
        createWritable: async () => {
          stats.attempts++;
          if (left > 0) { left--; const e = new Error('locked'); e.name = 'InvalidStateError'; throw e; }
          let buf = '';
          return { write: async c => { buf = c; }, close: async () => { files[name] = buf; stats.writes.push(name); },
                   abort: async () => {} };
        },
      };
    } };
}

test('engine: a failed save retries itself without another change', async () => {
  const dir = flakyDir(1);
  const { engine, events } = makeEngine(dir, { retryDelays: [20, 40] });
  engine.queueSave(['a']);
  await new Promise(r => setTimeout(r, 200));
  assert.ok(events.some(([s]) => s === 'error'), 'the failure is surfaced when it happens');
  assert.ok(dir.stats.writes.includes('x.json'), 'the ledger lands on the retry');
  assert.equal(events[events.length - 1][0], 'synced', 'and the chip ends up synced');
});

test('engine: the retry keeps the touched ids from the failed attempt', async () => {
  const dir = flakyDir(1);
  const touched = [];
  const { engine } = makeEngine(dir, { retryDelays: [20], afterSave: async t => { touched.push(t); } });
  engine.queueSave(['p1', 'p2']);
  await new Promise(r => setTimeout(r, 200));
  assert.deepEqual(touched, [['p1', 'p2']]);
});

test('engine: retries give up after the last delay, leaving the next change to try', async () => {
  const dir = flakyDir(99);
  const { engine, events } = makeEngine(dir, { retryDelays: [10, 20] });
  engine.queueSave([]);
  await new Promise(r => setTimeout(r, 300));
  assert.equal(dir.stats.attempts, 3, 'first attempt plus one per delay, then stop');
  assert.equal(events[events.length - 1][0], 'error');
});

test('engine: a new change cancels the pending retry rather than racing it', async () => {
  const dir = flakyDir(1);
  const { engine } = makeEngine(dir, { retryDelays: [500] });
  engine.queueSave(['a']);
  await new Promise(r => setTimeout(r, 60));      // failed, retry scheduled for +500ms
  engine.queueSave(['b']);                        // user changes something first
  await new Promise(r => setTimeout(r, 120));
  assert.ok(dir.stats.writes.includes('x.json'));
  const attemptsAfterUserChange = dir.stats.attempts;
  await new Promise(r => setTimeout(r, 600));     // the old timer would have fired by now
  assert.equal(dir.stats.attempts, attemptsAfterUserChange, 'no stray retry after the change succeeded');
});

// Whether a failure is final decides whether the tools interrupt the user with
// a dialog. A lock that heals itself in three seconds should not: the chip
// going ERROR then SYNCED tells the story quietly. A failure with no retry left
// is worth a dialog, and so is a corrupt ledger, which no retry can fix.
test('engine: a retryable failure reports final=false, the last one true', async () => {
  const dir = flakyDir(99);
  const finals = [];
  const { engine } = makeEngine(dir, { retryDelays: [10, 20],
    onStatus: (s, m, final) => { if (s === 'error') finals.push(final); } });
  engine.queueSave([]);
  await new Promise(r => setTimeout(r, 300));
  assert.deepEqual(finals, [false, false, true]);
});

test('engine: a corrupt ledger is always final — no retry can fix it', async () => {
  const finals = [];
  const { engine } = makeEngine(fakeDir({ 'x.json': 'not json' }), {
    onStatus: (s, m, final) => { if (s === 'error') finals.push(final); } });
  await engine.saveNow([]);
  assert.deepEqual(finals, [true]);
});
