import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LIBRARY_FILE, readLibraryFile, decideSave, saveLibraryFile } from '../assets/js/pid-symbol-store.js';
import { parseLibrary, serialiseLibrary, updateSymbol } from '../assets/js/pid-symbols.js';
import { writeFileAtomic, backupFileName, prunableBackups } from '../assets/js/hub-sync.js';

const INVENTED = readFileSync(new URL('./fixtures/invented-symbol-library.json', import.meta.url), 'utf8');
const RAW = serialiseLibrary(parseLibrary(INVENTED).library);
const deps = { writeFileAtomic, backupFileName, prunableBackups, now: () => '2026-11-13T10:00:00.000Z' };

// A directory handle faithful enough for writeFileAtomic: move() overwrites,
// removeEntry() removes, values() lists, and a subdirectory can be created.
function fakeDir(files = {}, opts = {}) {
  const subs = {};
  const dir = {
    files, subs, writes: [],
    getFileHandle: async (name, o) => {
      if (opts.readError && !o?.create) { const e = new Error('lapsed'); e.name = opts.readError; throw e; }
      if (!o?.create && !(name in files)) { const e = new Error('missing'); e.name = 'NotFoundError'; throw e; }
      if (o?.create && !(name in files)) files[name] = '';
      return {
        getFile: async () => ({ text: async () => files[name], lastModified: 0 }),
        createWritable: async () => { let buf = ''; return { write: async c => { buf = c; }, close: async () => { files[name] = buf; dir.writes.push(name); } }; },
        move: async to => { files[to] = files[name]; delete files[name]; dir.writes.push(to); },
      };
    },
    getDirectoryHandle: async (name, o) => {
      if (!subs[name]) { if (!o?.create) { const e = new Error('missing'); e.name = 'NotFoundError'; throw e; } subs[name] = fakeDir({}); }
      return subs[name];
    },
    removeEntry: async name => { delete files[name]; },
    values: async function* () { for (const n of Object.keys(files)) yield { kind: 'file', name: n }; },
  };
  return dir;
}
const edited = () => updateSymbol(parseLibrary(RAW).library, 'p1-001', { name: 'DISC WIDGET' });

test('readLibraryFile: ok, missing and unreadable are three different answers', async () => {
  const ok = await readLibraryFile(fakeDir({ [LIBRARY_FILE]: RAW }));
  assert.deepEqual([ok.status, ok.raw, ok.library.symbols.length], ['ok', RAW, 4]);
  assert.deepEqual(await readLibraryFile(fakeDir({})), { status: 'missing' });
  assert.equal((await readLibraryFile(fakeDir({ [LIBRARY_FILE]: '{oops' }))).status, 'unreadable');
  assert.equal((await readLibraryFile(fakeDir({ [LIBRARY_FILE]: '{"version":2,"symbols":[]}' }))).status, 'unreadable');
  assert.equal((await readLibraryFile(fakeDir({ [LIBRARY_FILE]: RAW }, { readError: 'NotAllowedError' }))).status, 'unreadable');
  for (const bad of [undefined, null, 5, {}]) assert.equal((await readLibraryFile(bad)).status, bad == null ? 'missing' : 'unreadable');
});

test('decideSave: writes only on a first save or an unchanged file', () => {
  const ok = raw => ({ status: 'ok', raw });
  assert.deepEqual(decideSave(null, { status: 'missing' }), { write: true, reason: 'first-save' });
  assert.deepEqual(decideSave(RAW, ok(RAW)), { write: true, reason: 'unchanged' });
  assert.deepEqual(decideSave(RAW, { status: 'unreadable' }), { write: false, reason: 'unreadable' });
  assert.deepEqual(decideSave(null, { status: 'unreadable' }), { write: false, reason: 'unreadable' });
  assert.deepEqual(decideSave(RAW, ok(RAW + ' ')), { write: false, reason: 'changed' });
  assert.deepEqual(decideSave(null, ok(RAW)), { write: false, reason: 'exists' });
  assert.deepEqual(decideSave(RAW, { status: 'missing' }), { write: false, reason: 'gone' });
  for (const bad of [undefined, null, 5, {}]) assert.equal(decideSave(bad, bad).write, false);
});

test('saveLibraryFile: a first save writes the library and nothing else', async () => {
  const dir = fakeDir({ 'register.json': '{"untouched":true}' });
  const r = await saveLibraryFile({ dir, library: edited(), loadedRaw: null, sessionId: 's1', deps });
  assert.equal(r.status, 'saved');
  assert.equal(dir.files[LIBRARY_FILE], r.raw);
  assert.equal(parseLibrary(r.raw).library.symbols[0].name, 'DISC WIDGET');
  assert.deepEqual(Object.keys(dir.files).sort(), ['register.json', LIBRARY_FILE]);
  assert.equal(dir.files['register.json'], '{"untouched":true}');
  assert.ok(dir.writes.every(n => n.startsWith('symbol-library.')));
});

test('saveLibraryFile: an unchanged file is replaced, with the old one backed up first', async () => {
  const dir = fakeDir({ [LIBRARY_FILE]: RAW });
  const r = await saveLibraryFile({ dir, library: edited(), loadedRaw: RAW, sessionId: 's1', deps });
  assert.equal(r.status, 'saved');
  assert.deepEqual(dir.subs.backups.files, { 'symbol-library-2026-11-13T10-00-00.json': RAW });
});

test('saveLibraryFile: every refusal leaves the folder exactly as it was', async () => {
  const cases = [
    ['changed', { [LIBRARY_FILE]: RAW + ' ' }, RAW, {}],
    ['exists', { [LIBRARY_FILE]: RAW }, null, {}],
    ['gone', {}, RAW, {}],
    ['unreadable', { [LIBRARY_FILE]: '{oops' }, RAW, {}],
    ['unreadable', { [LIBRARY_FILE]: RAW }, RAW, { readError: 'NotAllowedError' }],
  ];
  for (const [reason, files, loadedRaw, opts] of cases) {
    const dir = fakeDir({ ...files }, opts);
    const r = await saveLibraryFile({ dir, library: edited(), loadedRaw, sessionId: 's1', deps });
    assert.deepEqual([r.status, r.reason], ['refused', reason]);
    assert.deepEqual(dir.files, files);
    assert.deepEqual([dir.writes, dir.subs], [[], {}]);
  }
});

test('saveLibraryFile: a failed backup does not stop the save, and identical content is not rewritten', async () => {
  const dir = fakeDir({ [LIBRARY_FILE]: RAW });
  dir.getDirectoryHandle = async () => { throw new Error('read-only'); };
  assert.equal((await saveLibraryFile({ dir, library: edited(), loadedRaw: RAW, sessionId: 's1', deps })).status, 'saved');
  const same = fakeDir({ [LIBRARY_FILE]: RAW });
  const r = await saveLibraryFile({ dir: same, library: parseLibrary(RAW).library, loadedRaw: RAW, sessionId: 's1', deps });
  assert.deepEqual([r.status, same.writes, same.subs], ['saved', [], {}]);
});
