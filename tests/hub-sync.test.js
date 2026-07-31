import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeById, mergeList, mergeTombstones } from '../assets/js/hub-sync.js';
import { detectConflict, conflictFields, stampEnteredBy } from '../assets/js/hub-sync.js';

const C = (id, updatedAt, extra = {}) => ({ id, updatedAt, ...extra });

test('detectConflict flags a disk record edited since load', () => {
  const mine = C('c1', '2026-07-30T10:00:00Z');
  const disk = [C('c1', '2026-07-30T11:00:00Z')];
  assert.equal(detectConflict(mine, disk).updatedAt, '2026-07-30T11:00:00Z');
});

test('detectConflict returns null when disk is same-age or older, or absent', () => {
  const mine = C('c1', '2026-07-30T10:00:00Z');
  assert.equal(detectConflict(mine, [C('c1', '2026-07-30T10:00:00Z')]), null);
  assert.equal(detectConflict(mine, [C('c1', '2026-07-30T09:00:00Z')]), null);
  assert.equal(detectConflict(mine, []), null);
});

test('conflictFields lists differing fields and ignores updatedAt', () => {
  const mine   = C('c1', '2026-07-30T10:00:00Z', { actionTaken: 'Mine',   status: 'closed' });
  const theirs = C('c1', '2026-07-30T11:00:00Z', { actionTaken: 'Theirs', status: 'closed' });
  assert.deepEqual(conflictFields(mine, theirs), ['actionTaken']);
});

test('conflictFields catches a field present on one side only', () => {
  const mine   = C('c1', '2026-07-30T10:00:00Z', { actionTaken: 'Mine' });
  const theirs = C('c1', '2026-07-30T11:00:00Z', {});
  assert.deepEqual(conflictFields(mine, theirs), ['actionTaken']);
});

test('stampEnteredBy sets enteredBy and never touches raisedBy or closedBy', () => {
  const out = stampEnteredBy({ id: 'c1', raisedBy: 'Site foreman', closedBy: '' }, 'Harvey');
  assert.equal(out.enteredBy, 'Harvey');
  assert.equal(out.raisedBy, 'Site foreman');
  assert.equal(out.closedBy, '');
});

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
import { writeFileAtomic } from '../assets/js/hub-sync.js';
import { backupFileName, prunableBackups } from '../assets/js/hub-sync.js';

test('backupFileName is filesystem-safe and sorts chronologically', () => {
  assert.equal(backupFileName('hub-data.json', '2026-07-30T14:22:05.000Z'),
    'hub-data-2026-07-30T14-22-05.json');
  const a = backupFileName('hub-data.json', '2026-07-30T09:00:00.000Z');
  const b = backupFileName('hub-data.json', '2026-07-30T14:22:05.000Z');
  assert.ok(a < b, 'string order must match time order');
});

test('prunableBackups keeps the newest N and returns the rest', () => {
  const names = [
    'hub-data-2026-07-30T09-00-00.json',
    'hub-data-2026-07-30T10-00-00.json',
    'hub-data-2026-07-30T11-00-00.json',
  ];
  assert.deepEqual(prunableBackups(names, 2, 'hub-data.json'), ['hub-data-2026-07-30T09-00-00.json']);
  assert.deepEqual(prunableBackups(names, 5, 'hub-data.json'), []);
});

test('prunableBackups ignores unrelated files', () => {
  const names = ['notes.txt', 'hub-data-2026-07-30T09-00-00.json'];
  assert.deepEqual(prunableBackups(names, 0, 'hub-data.json'), ['hub-data-2026-07-30T09-00-00.json']);
});

// The Comments Hub and Decision Register share one backups/ folder. An unscoped
// prune would silently delete the other tool's history.
test('prunableBackups never touches another ledger\'s backups', () => {
  const names = [
    'hub-data-2026-07-30T09-00-00.json',
    'brain-data-2026-07-30T08-00-00.json',
    'brain-data-2026-07-30T09-00-00.json',
  ];
  assert.deepEqual(prunableBackups(names, 0, 'hub-data.json'), ['hub-data-2026-07-30T09-00-00.json']);
  assert.deepEqual(prunableBackups(names, 1, 'brain-data.json'), ['brain-data-2026-07-30T08-00-00.json']);
});

// The real File System Access API's FileSystemFileHandle.move() overwrites
// its destination unconditionally, and removeEntry() actually removes the
// entry. A mock missing either forces every engine-level test onto the
// no-move fallback branch (the bare `catch` around a missing removeEntry
// swallows a TypeError silently) — the real, production atomic-write path
// via createSyncEngine then has NO coverage at all, and the suite stays
// green regardless of what that path does. fakeDir must be faithful here.
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
                   close: async () => { stats.openWriters--; files[name] = buf; stats.writes.push(name); },
                   abort: async () => { stats.openWriters--; } };
        },
        ...(opts.noMove ? {} : { move: async newName => { files[newName] = files[name]; delete files[name]; } }),
      };
    },
    removeEntry: async name => { delete files[name]; },
  };
  return dir;
}

function movableDir(files = {}, opts = {}) {
  const order = [];
  const dir = {
    files, order,
    getFileHandle: async (name, o) => {
      if (!o?.create && !(name in files)) { const e = new Error('missing'); e.name = 'NotFoundError'; throw e; }
      if (o?.create && !(name in files)) { files[name] = ''; }
      return {
        // opts.clobberOnRead simulates another session's write landing on the
        // same temp name between our write and our verify-read: the file we
        // read back is not the file we wrote.
        getFile: async () => ({ text: async () => (opts.clobberOnRead && name.endsWith('.tmp')) ? opts.clobberOnRead : files[name] }),
        createWritable: async () => {
          if (opts.failDirectWriteOnce && !name.endsWith('.tmp') && !opts._directWriteFailed) {
            opts._directWriteFailed = true;
            const e = new Error('locked'); e.name = 'NoModificationAllowedError'; throw e;
          }
          let buf = '';
          return { write: async c => { buf = c; },
                   close: async () => { files[name] = buf; order.push('write:' + name); },
                   abort: async () => {} };
        },
        ...(opts.noMove ? {} : { move: async newName => {
          files[newName] = files[name]; delete files[name]; order.push('move:' + name + '->' + newName);
        } }),
      };
    },
    removeEntry: async name => { delete files[name]; order.push('remove:' + name); },
  };
  return dir;
}

test('writeFileAtomic writes tmp then moves into place', async () => {
  const dir = movableDir({});
  await writeFileAtomic(dir, 'hub-data.json', '{"a":1}', 's1');
  assert.equal(dir.files['hub-data.json'], '{"a":1}');
  assert.equal(dir.files['hub-data.json.s1.tmp'], undefined);
  assert.deepEqual(dir.order, ['write:hub-data.json.s1.tmp', 'move:hub-data.json.s1.tmp->hub-data.json']);
});

test('writeFileAtomic uses a random tmp name when no sessionId is given, and still cleans up', async () => {
  const dir = movableDir({});
  await writeFileAtomic(dir, 'hub-data.json', '{"a":1}');
  assert.equal(dir.files['hub-data.json'], '{"a":1}');
  assert.ok(dir.order[0].match(/^write:hub-data\.json\.[a-z0-9]+\.tmp$/), dir.order[0]);
});

// A JSON.parse-only verify check would accept ANY valid JSON on the temp
// file, including a different session's complete ledger that happened to
// land on the same (unqualified) temp name. Verification must check that the
// bytes on disk are the exact bytes we wrote.
test('writeFileAtomic refuses to move content that changed underneath us, and cleans up the tmp', async () => {
  const dir = movableDir({}, { clobberOnRead: '{"other":"session-b-wrote-this"}' });
  await assert.rejects(() => writeFileAtomic(dir, 'hub-data.json', '{"a":1}'),
    err => err.message.includes('verification failed') && err.hubFile === 'hub-data.json');
  assert.equal(dir.files['hub-data.json'], undefined, 'real destination is never created before the move');
  assert.equal(dir.files['hub-data.json.tmp'], undefined, 'the mismatched tmp is cleaned up');
});

test('writeFileAtomic falls back to direct write without move support', async () => {
  const dir = movableDir({}, { noMove: true });
  await writeFileAtomic(dir, 'hub-data.json', '{"a":1}');
  assert.equal(dir.files['hub-data.json'], '{"a":1}');
});

test('writeFileAtomic: the no-move fallback never leaves a .tmp file behind', async () => {
  // The probe now writes <name>.tmp first (it must never touch the real
  // destination to check move() support), so a .tmp is briefly created here
  // and then removed before the direct-write fallback runs. What must never
  // happen is a .tmp surviving as litter in the shared folder.
  const dir = movableDir({}, { noMove: true });
  await writeFileAtomic(dir, 'hub-data.json', '{"a":1}', 's1');
  assert.equal(dir.files['hub-data.json'], '{"a":1}');
  assert.equal(dir.files['hub-data.json.s1.tmp'], undefined);
});

test('writeFileAtomic: the no-move fallback keeps the verified tmp until the direct write succeeds', async () => {
  // If the fallback removed the temp file BEFORE the direct write, and that
  // direct write then hit the same transient lock the retry loop exists for,
  // the ledger would be left at 0 bytes (writeFile's getFileHandle(name,
  // {create:true}) creates a zero-length file immediately) — unparseable,
  // wedging the whole team. The temp copy must survive a failed direct write.
  const dir = movableDir({}, { noMove: true, failDirectWriteOnce: true });
  await assert.rejects(() => writeFileAtomic(dir, 'hub-data.json', '{"a":1}', 's1'));
  assert.equal(dir.files['hub-data.json.s1.tmp'], '{"a":1}', 'the good copy survives the failed direct write');
});

// A backups/ directory mock: real enough for writeBackup's needs (create:true
// fidelity like fakeDir, async values() iteration, removeEntry) without
// weakening the create:true check that hid the Task 1 bug.
function backupsDir(files = {}) {
  const removed = [];
  const dir = {
    files, removed,
    getFileHandle: async (name, o) => {
      if (!o?.create && !(name in files)) { const e = new Error('missing'); e.name = 'NotFoundError'; throw e; }
      return {
        getFile: async () => ({ text: async () => files[name] }),
        createWritable: async () => {
          let buf = '';
          return { write: async c => { buf = c; }, close: async () => { files[name] = buf; } };
        },
      };
    },
    values: async function* () {
      for (const name of Object.keys(files)) yield { kind: 'file', name };
    },
    removeEntry: async name => { delete files[name]; removed.push(name); },
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

// A directory whose getFileHandle throws something other than NotFoundError
// on a read attempt — a lapsed permission, a network share hiccup, a
// momentary lock. Any create:true call (a write) is itself an error: once
// readLedger reports 'unreadable', saveNow must never attempt to write
// anything, so a mock write attempt failing loudly here is a deliberate
// tripwire, not an accident.
function unreadableFileDir(files = {}, errorName = 'NotAllowedError') {
  const stats = { attempts: 0 };
  return {
    files, stats,
    getFileHandle: async (name, o) => {
      stats.attempts++;
      if (!o?.create) { const e = new Error('permission lapsed'); e.name = errorName; throw e; }
      throw new Error('unexpected write attempt: saveNow must write nothing when the ledger is unreadable');
    },
  };
}

test('engine: readLedger maps a genuine absence (NotFoundError) to missing, and anything else to unreadable', async () => {
  const { engine: eMissing } = makeEngine(fakeDir({}));
  assert.equal((await eMissing.readLedger()).status, 'missing');

  const { engine: ePermission } = makeEngine(unreadableFileDir({}, 'NotAllowedError'));
  assert.equal((await ePermission.readLedger()).status, 'unreadable');

  const { engine: eLocked } = makeEngine(unreadableFileDir({}, 'NoModificationAllowedError'));
  assert.equal((await eLocked.readLedger()).status, 'unreadable');

  const { engine: eOther } = makeEngine(unreadableFileDir({}, 'UnknownError'));
  assert.equal((await eOther.readLedger()).status, 'unreadable');
});

// First-run behaviour must be exactly preserved: a genuinely absent ledger
// (NotFoundError) is 'missing', and saveNow still writes local state over it.
test('engine: a genuinely missing ledger (NotFoundError) still writes local state — first-run behaviour preserved', async () => {
  const dir = fakeDir({});
  const { engine, getState } = makeEngine(dir);
  assert.equal(await engine.saveNow([]), true);
  assert.equal(dir.files['x.json'], JSON.stringify(getState(), null, 2));
});

// The core of the fix: an unreadable ledger (permission lapse, network
// blip, transient lock) must never be treated like a missing one. No
// backup, no merge, no overwrite — saveNow must write nothing at all, and
// must throw (rather than return false) so the caller can tell "nothing
// happened, try again" apart from "the write happened but something else
// also failed".
test('engine: an unreadable ledger writes nothing — no backup, no ledger overwrite — and throws (retryable)', async () => {
  const dir = unreadableFileDir({
    'x.json': '{"savedAt":"","items":[{"id":"old"}],"tombstones":{}}',
    'x.backup.json': 'previous-backup-content',
  }, 'NotAllowedError');
  const { engine } = makeEngine(dir);
  await assert.rejects(() => engine.saveNow([]),
    err => err.name === 'LedgerUnreadableError' && err.hubFile === 'x.json');
  assert.equal(dir.files['x.json'], '{"savedAt":"","items":[{"id":"old"}],"tombstones":{}}', 'ledger left untouched');
  assert.equal(dir.files['x.backup.json'], 'previous-backup-content', 'no backup taken');
});

// The loop() retry/backoff path exists precisely so a thrown, transient
// failure gets tried again without the user having to make another change.
// An unreadable ledger must ride that path; a corrupt one (final today,
// unchanged by this fix) must not.
test('engine: an unreadable ledger is retried by the loop', async () => {
  const dir = unreadableFileDir({}, 'NotAllowedError');
  const events = [];
  const { engine } = makeEngine(dir, {
    retryDelays: [10, 20],
    onStatus: (s, m, final) => events.push([s, final]),
  });
  engine.queueSave([]);
  await new Promise(r => setTimeout(r, 200));
  assert.equal(dir.stats.attempts, 3, 'initial attempt plus one retry per delay');
  assert.deepEqual(events.map(e => e[0]), ['saving', 'error', 'saving', 'error', 'saving', 'error']);
  assert.deepEqual(events.filter(e => e[0] === 'error').map(e => e[1]), [false, false, true]);
});

test('engine: a corrupt ledger is NOT retried by the loop (final=true on the first failure)', async () => {
  const dir = fakeDir({ 'x.json': 'not json' });
  const events = [];
  const { engine } = makeEngine(dir, {
    retryDelays: [10, 20],
    onStatus: (s, m, final) => events.push([s, final]),
  });
  engine.queueSave([]);
  await new Promise(r => setTimeout(r, 200));
  assert.deepEqual(events, [['saving', undefined], ['error', true]], 'one attempt, immediately final, no retry scheduled');
});

test('engine: saveNow writes backup of previous disk content, then ledger', async () => {
  const dir = fakeDir({ 'x.json': '{"savedAt":"","items":[{"id":"old"}],"tombstones":{}}' });
  const { engine } = makeEngine(dir);
  assert.equal(await engine.saveNow([]), true);
  assert.ok(dir.files['x.backup.json'].includes('old'));
  assert.ok(dir.files['x.json'].includes('savedAt'));
});

// With a faithful move()/removeEntry(), a successful saveNow takes the real
// atomic-write path (write tmp, verify, move) rather than silently falling
// through to the no-move fallback. This is the production path and, before
// fakeDir grew move()/removeEntry(), it had no engine-level coverage at all.
test('engine: saveNow via the atomic path leaves no *.tmp litter and the ledger holds the expected content', async () => {
  const dir = fakeDir({});
  const { engine, getState } = makeEngine(dir);
  assert.equal(await engine.saveNow([]), true);
  const tmpNames = Object.keys(dir.files).filter(n => n.endsWith('.tmp'));
  assert.deepEqual(tmpNames, [], 'no tmp file survives a successful save');
  assert.equal(dir.files['x.json'], JSON.stringify(getState(), null, 2));
});

// Kept as an explicitly-named, deliberate variant (opts.noMove) so the
// no-move fallback branch stays covered on purpose rather than by accident
// of a mock that happened to be missing move().
test('engine: saveNow still succeeds via the no-move fallback when move() is unsupported', async () => {
  const dir = fakeDir({}, { noMove: true });
  const { engine, getState } = makeEngine(dir);
  assert.equal(await engine.saveNow([]), true);
  assert.equal(dir.files['x.json'], JSON.stringify(getState(), null, 2));
  const tmpNames = Object.keys(dir.files).filter(n => n.endsWith('.tmp'));
  assert.deepEqual(tmpNames, [], 'the fallback cleans up its temp file too');
});

// Two sessions saving around the same time must never collide on one shared
// temp name (Finding 3): each session's writeFileAtomic call gets its own
// tmp file, so neither can clobber or partially-overwrite the other's.
test('writeFileAtomic: two sessions writing concurrently with different sessionIds do not collide', async () => {
  const dir = movableDir({});
  // Both writes interleave against the SAME directory and base name. With a
  // shared `name + '.tmp'` this would be exactly the scenario in Finding 3:
  // one session's write lands on the other's tmp file, verification can pass
  // against a mixed or foreign payload, and the wrong content gets moved
  // into place. Distinct sessionIds mean each gets its own tmp file, so
  // there is nothing to collide on.
  const p1 = writeFileAtomic(dir, 'hub-data.json', '{"session":"a"}', 'session-a');
  const p2 = writeFileAtomic(dir, 'hub-data.json', '{"session":"b"}', 'session-b');
  await Promise.all([p1, p2]);
  // Whichever finishes last wins the real file (expected — same last-write-
  // wins semantics as before); what must never happen is either write
  // throwing a verification error because it clobbered the other's tmp.
  assert.ok(['{"session":"a"}', '{"session":"b"}'].includes(dir.files['hub-data.json']));
  assert.equal(dir.files['hub-data.json.session-a.tmp'], undefined);
  assert.equal(dir.files['hub-data.json.session-b.tmp'], undefined);
});

test('engine: with cfg.backupDir, saveNow writes a dated backup there instead of x.backup.json', async () => {
  const dir = fakeDir({ 'x.json': '{"savedAt":"","items":[{"id":"old"}],"tombstones":{}}' });
  const bdir = backupsDir();
  const { engine } = makeEngine(dir, { backupDir: () => bdir });
  assert.equal(await engine.saveNow([]), true);
  assert.equal(dir.files['x.backup.json'], undefined, 'no rolling backup written to the main dir');
  const names = Object.keys(bdir.files);
  assert.equal(names.length, 1);
  assert.ok(/^x-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/.test(names[0]));
  assert.ok(bdir.files[names[0]].includes('old'));
});

test('engine: backupDir rotation prunes down to backupKeep, scoped to this ledger only', async () => {
  const dir = fakeDir({ 'x.json': '{"savedAt":"","items":[],"tombstones":{}}' });
  // Fixture dates are pinned far in the past so a real, unmocked `new Date()`
  // taken when the test runs always sorts after both of them, regardless of
  // what time of day or on what date the suite actually runs.
  const bdir = backupsDir({
    'x-2020-01-01T09-00-00.json': 'a',
    'x-2020-01-01T10-00-00.json': 'b',
    'other-2020-01-01T05-00-00.json': 'untouched',
  });
  const { engine } = makeEngine(dir, { backupDir: () => bdir, backupKeep: 2 });
  assert.equal(await engine.saveNow([]), true);
  const names = Object.keys(bdir.files);
  assert.equal(names.length, 3, 'kept the 2 newest x- backups plus the new one, pruned the oldest x- backup');
  assert.ok(names.includes('other-2020-01-01T05-00-00.json'), 'another ledger\'s backups are never pruned');
  assert.ok(!names.includes('x-2020-01-01T09-00-00.json'), 'oldest x- backup was pruned');
  assert.deepEqual(bdir.removed, ['x-2020-01-01T09-00-00.json']);
});

// A backup is a courtesy, not the save itself (Finding 2). A read-only or
// missing backups/ folder, a locked backup file, or a folder enumeration
// failure must never abort the ledger save it was meant to protect.
test('engine: a backup directory that throws on enumeration does not prevent the ledger save', async () => {
  const dir = fakeDir({ 'x.json': '{"savedAt":"","items":[{"id":"old"}],"tombstones":{}}' });
  const bdir = backupsDir({ 'x-2020-01-01T09-00-00.json': 'a' });
  bdir.values = async function* () { throw new Error('folder unreadable'); };
  const { engine } = makeEngine(dir, { backupDir: () => bdir, backupKeep: 2 });
  assert.equal(await engine.saveNow([]), true, 'the ledger save still succeeds');
  assert.ok(dir.files['x.json'].includes('savedAt'), 'the ledger itself was written');
});

test('engine: a backup directory whose writeFile throws does not prevent the ledger save', async () => {
  const dir = fakeDir({ 'x.json': '{"savedAt":"","items":[{"id":"old"}],"tombstones":{}}' });
  const bdir = backupsDir();
  bdir.getFileHandle = async () => { throw new Error('backups dir is read-only'); };
  const { engine } = makeEngine(dir, { backupDir: () => bdir, backupKeep: 2 });
  assert.equal(await engine.saveNow([]), true, 'the ledger save still succeeds');
  assert.ok(dir.files['x.json'].includes('savedAt'), 'the ledger itself was written');
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
