# Comments Hub Multi-User Safety — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Comments Hub safe for 2–4 concurrent users on a company drive — no stale screens, no silent same-record clobber, no half-written ledger, and recoverable backups.

**Architecture:** Pure logic lands in `assets/js/` ES modules (node-testable, no DOM); UI wiring lands in `tools-src/comments-hub.html`. Presence is a folder of per-session heartbeat files whose `editingCommentId` field doubles as the soft record lock, so the lock expires with the heartbeat and needs no separate expiry logic. A save-time conflict check backstops presence independently.

**Tech Stack:** Vanilla ES modules, File System Access API (Chromium), `node --test`, ExcelJS (vendored, untouched here).

## Global Constraints

- `npm test` runs `node --test`. All test files live in `tests/*.test.js` using `node:test` + `node:assert/strict`.
- Everything in `assets/js/` must be pure and node-testable: **no DOM, no File System Access calls** except inside `createSyncEngine`'s injected `cfg`.
- **`assets/js/hub-sync.js` is shared with Product Brain** (`tools-src/product-brain.html`). Every change must keep its existing exported contract working. Tasks 1–2 change it; both tools gain the benefit.
- `PRESENCE_TIMEOUT_MS = 90000`. `PRESENCE_HEARTBEAT_MS = 20000`. `PRESENCE_SWEEP_MS = 600000`.
- Person-field rule: **`raisedBy` and `closedBy` are NEVER pre-filled.** `enteredBy` is the only auto-stamped identity.
- Generated Excel filenames must stay stable — **never add dates or timestamps** (Autodesk Construction Cloud versions by filename; a changing name destroys version history).
- No hardcoded colours in UI — `site.css` / `tool.css` tokens only.
- `tools-src/` is **gitignored**. UI changes are not committed directly; they reach `tools/` only via `node scripts/lock-tools.mjs`, which prompts for the workshop code. **Harvey runs that step** (Task 11) — do not attempt it, and never write the workshop code into any file.

## Prior-Art Notes (read before starting)

Two pieces of this spec are **already partly built**. Do not reimplement them:

- `createSyncEngine` in `assets/js/hub-sync.js:37` already does single-flight save, read→merge→write, retry backoff, and writes a backup from `disk.raw` before overwriting (`hub-sync.js:103`). Tasks 1–2 modify this, not replace it.
- `refreshFromDisk` / `startAutoRefresh` at `tools-src/comments-hub.html:1821-1863` already re-read on a 90s timer, on window focus, and on demand. Task 7 **hardens** it; it does not build it.

`refreshFromDisk` currently calls `renderAll()` unconditionally. That is a live bug: a timer tick or window-focus while someone is typing repaints the form under them. Task 7 fixes it.

---

### Task 1: Atomic ledger write (shared engine)

A crash or lock mid-write currently leaves a truncated `hub-data.json` — the source of truth for the whole team. Write to a temp file, verify it parses, then `move()` it into place.

**Files:**
- Modify: `assets/js/hub-sync.js:62-78` (`writeFile`), `:92-112` (`saveNow`)
- Test: `tests/hub-sync.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `writeFileAtomic(dir, name, contents) -> Promise<void>` — exported from `hub-sync.js`. Writes `<name>.tmp`, re-reads and `JSON.parse`s it, then moves it over `name`. Falls back to a direct `writeFile` when `move` is unavailable on the handle.

- [ ] **Step 1: Write the failing test**

Add to `tests/hub-sync.test.js`. Extend the existing `fakeDir` helper with `move` support by adding this near the other helpers:

```js
import { writeFileAtomic } from '../assets/js/hub-sync.js';

function movableDir(files = {}, opts = {}) {
  const order = [];
  const dir = {
    files, order,
    getFileHandle: async (name, o) => {
      if (!o?.create && !(name in files)) { const e = new Error('missing'); e.name = 'NotFoundError'; throw e; }
      return {
        getFile: async () => ({ text: async () => files[name] }),
        createWritable: async () => {
          let buf = '';
          return { write: async c => { buf = c; },
                   close: async () => { files[name] = buf; order.push('write:' + name); } };
        },
        ...(opts.noMove ? {} : { move: async newName => {
          files[newName] = files[name]; delete files[name]; order.push('move:' + name + '->' + newName);
        } }),
      };
    },
  };
  return dir;
}

test('writeFileAtomic writes tmp then moves into place', async () => {
  const dir = movableDir({});
  await writeFileAtomic(dir, 'hub-data.json', '{"a":1}');
  assert.equal(dir.files['hub-data.json'], '{"a":1}');
  assert.equal(dir.files['hub-data.json.tmp'], undefined);
  assert.deepEqual(dir.order, ['write:hub-data.json.tmp', 'move:hub-data.json.tmp->hub-data.json']);
});

test('writeFileAtomic refuses to move unparseable content', async () => {
  const dir = movableDir({});
  await assert.rejects(() => writeFileAtomic(dir, 'hub-data.json', 'not json{'),
    err => err.message.includes('verification failed'));
  assert.equal(dir.files['hub-data.json'], undefined);
});

test('writeFileAtomic falls back to direct write without move support', async () => {
  const dir = movableDir({}, { noMove: true });
  await writeFileAtomic(dir, 'hub-data.json', '{"a":1}');
  assert.equal(dir.files['hub-data.json'], '{"a":1}');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `writeFileAtomic` is not exported from `hub-sync.js`.

- [ ] **Step 3: Implement**

In `assets/js/hub-sync.js`, promote the existing private `writeFile` to a module-level export (it currently lives inside `createSyncEngine`). Move it above `createSyncEngine` unchanged, then add `writeFileAtomic` beneath it:

```js
export async function writeFile(dir, name, contents) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  try {
    await w.write(contents);
    await w.close();
  } catch (e) {
    try { await w.abort(); } catch (abortErr) { /* stream already gone */ }
    if (e && e.name) e.hubFile = name;
    throw e;
  }
}

// The ledger is the team's single source of truth: a crash or lock partway
// through a direct write leaves everyone with a truncated file. Write to a
// temp name, prove it parses, and only then move it into place — so the real
// file only ever goes from one complete state to another.
export async function writeFileAtomic(dir, name, contents) {
  const tmp = name + '.tmp';
  await writeFile(dir, tmp, contents);
  const tmpHandle = await dir.getFileHandle(tmp, { create: false });
  if (typeof tmpHandle.move !== 'function') {
    // Older Chromium without FileSystemFileHandle.move(): a direct write is
    // still better than leaving the change unsaved.
    await writeFile(dir, name, contents);
    return;
  }
  const verify = await (await tmpHandle.getFile()).text();
  try { JSON.parse(verify); }
  catch (e) {
    const err = new Error('Atomic write verification failed for ' + name);
    err.hubFile = name;
    throw err;
  }
  await tmpHandle.move(name);
}
```

Inside `createSyncEngine`, delete the now-duplicated local `writeFile` definition and reference the module-level one. Then change the ledger write in `saveNow` only:

```js
    await writeFileAtomic(dir, cfg.fileName, JSON.stringify(st, null, 2));
```

Leave the backup write as plain `writeFile` — Task 2 reworks it, and a backup does not need atomicity.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all new tests plus every pre-existing `hub-sync` and `hub-core` test.

- [ ] **Step 5: Commit**

```bash
git add assets/js/hub-sync.js tests/hub-sync.test.js
git commit -m "feat(hub-sync): atomic ledger write via tmp file and move"
```

---

### Task 2: Dated backup rotation (shared engine)

One `hub-data.backup.json` is exactly one mistake deep. Keep the last 20 in a `backups/` folder.

**Files:**
- Modify: `assets/js/hub-sync.js` (`saveNow`)
- Test: `tests/hub-sync.test.js`

**Interfaces:**
- Consumes: `writeFile` from Task 1.
- Produces:
  - `backupFileName(baseName, nowIso) -> string` — e.g. `('hub-data.json', '2026-07-30T14:22:05.000Z')` → `'hub-data-2026-07-30T14-22-05.json'`.
  - `prunableBackups(names, keep) -> string[]` — given backup filenames, returns those to delete, keeping the `keep` newest by name (names sort chronologically by construction).
  - `createSyncEngine` gains optional `cfg.backupDir` (a directory handle getter, `() => dirHandle|null`) and `cfg.backupKeep` (default 20).

- [ ] **Step 1: Write the failing test**

```js
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
  assert.deepEqual(prunableBackups(names, 2), ['hub-data-2026-07-30T09-00-00.json']);
  assert.deepEqual(prunableBackups(names, 5), []);
});

test('prunableBackups ignores unrelated files', () => {
  const names = ['notes.txt', 'hub-data-2026-07-30T09-00-00.json'];
  assert.deepEqual(prunableBackups(names, 0), ['hub-data-2026-07-30T09-00-00.json']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `backupFileName` is not exported.

- [ ] **Step 3: Implement**

Add to `assets/js/hub-sync.js`:

```js
const BACKUP_RE = /^(.+)-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/;

export function backupFileName(baseName, nowIso) {
  const stem = baseName.replace(/\.json$/, '');
  // Colons are illegal in Windows filenames; dashes keep string order == time order.
  const stamp = String(nowIso).slice(0, 19).replace(/:/g, '-');
  return stem + '-' + stamp + '.json';
}

export function prunableBackups(names, keep) {
  const backups = (names || []).filter(n => BACKUP_RE.test(n)).sort();
  const n = Math.max(0, keep);
  return n === 0 ? backups : backups.slice(0, Math.max(0, backups.length - n));
}
```

In `saveNow`, replace the single-backup write:

```js
    if (disk.status === 'ok') {
      await writeBackup(dir, disk.raw);
      cfg.setState(cfg.merge(cfg.getState(), disk.data));
    }
```

and add inside `createSyncEngine`, above `saveNow`:

```js
  // A single rolling backup is one mistake deep. With several people in the
  // ledger, the mistake worth recovering from is often not the most recent one.
  async function writeBackup(dir, raw) {
    const getBackupDir = cfg.backupDir;
    if (!getBackupDir) { await writeFile(dir, cfg.backupName, raw); return; }
    const bdir = await getBackupDir();
    if (!bdir) { await writeFile(dir, cfg.backupName, raw); return; }
    await writeFile(bdir, backupFileName(cfg.fileName, new Date().toISOString()), raw);
    const names = [];
    for await (const entry of bdir.values()) if (entry.kind === 'file') names.push(entry.name);
    for (const stale of prunableBackups(names, cfg.backupKeep == null ? 20 : cfg.backupKeep)) {
      try { await bdir.removeEntry(stale); } catch (e) { /* another client got there first */ }
    }
  }
```

Product Brain passes no `cfg.backupDir`, so it keeps its current single-backup behaviour untouched.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, including all pre-existing Product Brain / hub-sync engine tests.

- [ ] **Step 5: Commit**

```bash
git add assets/js/hub-sync.js tests/hub-sync.test.js
git commit -m "feat(hub-sync): dated backup rotation keeping last 20"
```

---

### Task 3: Presence module (pure logic)

**Files:**
- Create: `assets/js/hub-presence.js`
- Test: `tests/hub-presence.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `PRESENCE_TIMEOUT_MS = 90000`, `PRESENCE_HEARTBEAT_MS = 20000`, `PRESENCE_SWEEP_MS = 600000`
  - `presenceRecord({ name, sessionId, tool, editingCommentId, nowIso }) -> object` — `tool` is `'hub'` or `'brain'`; the `presence/` folder is shared by both tools.
  - `livePresences(records, sessionId, nowMs) -> object[]` — records excluding own session and any older than `PRESENCE_TIMEOUT_MS`, sorted by name. Not filtered by tool: everyone in the folder is worth showing.
  - `editorOf(records, commentId, sessionId, nowMs) -> string|null` — name of another live session editing that record, else null. **Callers must pass only their own tool's records** (see `ofTool`), so a decision lock can never read as a comment lock.
  - `ofTool(records, tool) -> object[]` — records belonging to one tool.
  - `sweepable(records, nowMs) -> string[]` — `sessionId`s whose files are older than `PRESENCE_SWEEP_MS` and should be deleted.
  - `presenceFileName(sessionId) -> string`

- [ ] **Step 1: Write the failing test**

Create `tests/hub-presence.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRESENCE_TIMEOUT_MS, presenceRecord, livePresences, editorOf, sweepable, presenceFileName, ofTool,
} from '../assets/js/hub-presence.js';

const NOW = Date.parse('2026-07-30T14:00:00.000Z');
const at = msAgo => new Date(NOW - msAgo).toISOString();
const rec = (sessionId, name, msAgo, editingCommentId = null, tool = 'hub') =>
  ({ sessionId, name, tool, editingCommentId, lastSeen: at(msAgo) });

test('presenceRecord carries identity, tool and edit target', () => {
  const r = presenceRecord({ name: 'Harvey', sessionId: 's1', tool: 'hub', editingCommentId: 'c9', nowIso: at(0) });
  assert.deepEqual(r, { name: 'Harvey', sessionId: 's1', tool: 'hub', editingCommentId: 'c9', lastSeen: at(0) });
});

test('ofTool separates hub and brain sessions', () => {
  const records = [rec('s2', 'Sarah', 0, 'c9', 'hub'), rec('s3', 'Tom', 0, 'd4', 'brain')];
  assert.deepEqual(ofTool(records, 'hub').map(r => r.name), ['Sarah']);
  assert.deepEqual(ofTool(records, 'brain').map(r => r.name), ['Tom']);
});

test('a brain session never holds a hub lock', () => {
  const records = [rec('s3', 'Tom', 0, 'x1', 'brain')];
  assert.equal(editorOf(ofTool(records, 'hub'), 'x1', 's1', NOW), null);
  assert.equal(livePresences(records, 's1', NOW).length, 1, 'but they still show as present');
});

test('livePresences drops own session and stale sessions', () => {
  const records = [rec('s1', 'Me', 0), rec('s2', 'Sarah', 10000), rec('s3', 'Ghost', 120000)];
  const live = livePresences(records, 's1', NOW);
  assert.deepEqual(live.map(r => r.name), ['Sarah']);
});

test('livePresences keeps a session right at the timeout boundary', () => {
  const records = [rec('s2', 'Sarah', PRESENCE_TIMEOUT_MS - 1)];
  assert.equal(livePresences(records, 's1', NOW).length, 1);
  const stale = [rec('s2', 'Sarah', PRESENCE_TIMEOUT_MS + 1)];
  assert.equal(livePresences(stale, 's1', NOW).length, 0);
});

test('livePresences sorts by name', () => {
  const records = [rec('s2', 'Tom', 0), rec('s3', 'Anna', 0)];
  assert.deepEqual(livePresences(records, 's1', NOW).map(r => r.name), ['Anna', 'Tom']);
});

test('editorOf finds another live editor but never yourself', () => {
  const records = [rec('s1', 'Me', 0, 'c9'), rec('s2', 'Sarah', 0, 'c9')];
  assert.equal(editorOf(records, 'c9', 's1', NOW), 'Sarah');
  assert.equal(editorOf(records, 'c9', 's2', NOW), 'Me');
  assert.equal(editorOf(records, 'c1', 's1', NOW), null);
});

test('editorOf ignores a stale editor so a crashed tab cannot hold a lock', () => {
  const records = [rec('s2', 'Sarah', 120000, 'c9')];
  assert.equal(editorOf(records, 'c9', 's1', NOW), null);
});

test('sweepable returns only long-dead sessions', () => {
  const records = [rec('s2', 'Sarah', 120000), rec('s3', 'Ghost', 700000)];
  assert.deepEqual(sweepable(records, NOW), ['s3']);
});

test('presenceFileName is derived from sessionId', () => {
  assert.equal(presenceFileName('s1'), 's1.json');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `../assets/js/hub-presence.js`.

- [ ] **Step 3: Implement**

Create `assets/js/hub-presence.js`:

```js
// assets/js/hub-presence.js
// Pure presence logic for the Comments Hub: who else is in the hub, and who is
// editing which comment. No DOM, no File System Access — the tool page owns the
// file I/O and passes parsed records in.
//
// The soft record lock is deliberately just `editingCommentId` on the presence
// record rather than a separate lock file: it then expires with the heartbeat,
// so a crashed tab can never hold a lock, and there is no second expiry
// mechanism to keep correct.

export const PRESENCE_HEARTBEAT_MS = 20000;
export const PRESENCE_TIMEOUT_MS = 90000;
export const PRESENCE_SWEEP_MS = 600000;

export function presenceFileName(sessionId) { return String(sessionId) + '.json'; }

export function presenceRecord({ name, sessionId, tool, editingCommentId, nowIso }) {
  return {
    name: name || 'Someone',
    sessionId,
    tool: tool || 'hub',
    editingCommentId: editingCommentId || null,
    lastSeen: nowIso,
  };
}

// The presence/ folder is shared by the Comments Hub and Product Brain, so a
// caller asking "who is editing record X" must narrow to its own tool first —
// otherwise a decision id could be read as a comment id.
export function ofTool(records, tool) {
  return (records || []).filter(r => r && (r.tool || 'hub') === tool);
}

function ageMs(rec, nowMs) { return nowMs - Date.parse(rec && rec.lastSeen || 0); }

export function livePresences(records, sessionId, nowMs) {
  return (records || [])
    .filter(r => r && r.sessionId && r.sessionId !== sessionId)
    .filter(r => ageMs(r, nowMs) < PRESENCE_TIMEOUT_MS)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export function editorOf(records, commentId, sessionId, nowMs) {
  if (!commentId) return null;
  const hit = livePresences(records, sessionId, nowMs)
    .find(r => r.editingCommentId === commentId);
  return hit ? hit.name : null;
}

export function sweepable(records, nowMs) {
  return (records || [])
    .filter(r => r && r.sessionId && ageMs(r, nowMs) >= PRESENCE_SWEEP_MS)
    .map(r => r.sessionId);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 8 new tests.

- [ ] **Step 5: Commit**

```bash
git add assets/js/hub-presence.js tests/hub-presence.test.js
git commit -m "feat(hub): pure presence module with heartbeat-derived soft lock"
```

---

### Task 4: Conflict detection and `enteredBy` (shared engine)

These land in `hub-sync.js`, not `hub-core.js`: they are generic record operations with no
Comments-Hub knowledge, and Product Brain needs the identical logic (see
`2026-07-30-product-brain-multi-user.md`). `hub-sync.js` is the module both tools already share.

**Files:**
- Modify: `assets/js/hub-sync.js`
- Test: `tests/hub-sync.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `detectConflict(loadedRecord, diskRecords) -> object|null` — returns the disk record when it exists and its `updatedAt` is strictly newer than `loadedRecord.updatedAt`; otherwise null.
  - `conflictFields(mine, theirs) -> string[]` — names of fields whose values differ, excluding `updatedAt`.
  - `stampEnteredBy(comment, name) -> object` — returns a copy with `enteredBy` set; leaves `raisedBy` and `closedBy` untouched.

- [ ] **Step 1: Write the failing test**

Add to `tests/hub-sync.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `detectConflict` is not exported from `hub-sync.js`.

- [ ] **Step 3: Implement**

Append to `assets/js/hub-sync.js`:

```js
// ── Concurrent-edit safety ────────────────────────────────────────────────
// mergeState resolves collisions per *record*, not per *field*, so when two
// people edit the same comment the loser's text disappears silently. Presence
// makes that rare; this makes it safe, independently — presence can always be
// defeated by a crashed tab or a skewed clock.

export function detectConflict(loadedRecord, diskRecords) {
  if (!loadedRecord || !loadedRecord.id) return null;
  const disk = (diskRecords || []).find(r => r && r.id === loadedRecord.id);
  if (!disk) return null;
  return (disk.updatedAt || '') > (loadedRecord.updatedAt || '') ? disk : null;
}

export function conflictFields(mine, theirs) {
  const keys = new Set([...Object.keys(mine || {}), ...Object.keys(theirs || {})]);
  keys.delete('updatedAt');
  const out = [];
  for (const k of keys) {
    if (JSON.stringify((mine || {})[k]) !== JSON.stringify((theirs || {})[k])) out.push(k);
  }
  return out.sort();
}

// enteredBy is the only identity the tool stamps automatically, because it is
// the only one it actually knows: who was at the keyboard. raisedBy and
// closedBy describe real-world work that is routinely done by someone else, so
// they stay hand-entered.
export function stampEnteredBy(comment, name) {
  return { ...comment, enteredBy: name || '' };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add assets/js/hub-sync.js tests/hub-sync.test.js
git commit -m "feat(hub-sync): conflict detection and enteredBy stamping"
```

---

### Task 5: UI — local identity

**Files:**
- Modify: `tools-src/comments-hub.html`

**Interfaces:**
- Consumes: `stampEnteredBy` (Task 4).
- Produces: `getUserName() -> string`, `setUserName(name)`, module-scoped `sessionId`.

- [ ] **Step 1: Add identity helpers**

After the id helpers at `tools-src/comments-hub.html:723` (`function genId()`), insert:

```js
  // ── Local identity ────────────────────────────────────────────────────────
  // Stamped onto enteredBy and used as the presence display name. Deliberately
  // NOT used to pre-fill raisedBy or closedBy: those describe who did the
  // real-world work, which is routinely somebody else.
  const USER_KEY = 'hub-user-name';
  const sessionId = genId();
  function getUserName() {
    try { return localStorage.getItem(USER_KEY) || ''; } catch (e) { return ''; }
  }
  function setUserName(name) {
    try { localStorage.setItem(USER_KEY, String(name || '').trim()); } catch (e) { /* private mode */ }
  }
  async function ensureUserName() {
    if (getUserName()) return getUserName();
    const entered = prompt('Your name (shown to others in the hub, and recorded against comments you enter):');
    if (entered && entered.trim()) setUserName(entered.trim());
    return getUserName();
  }
```

- [ ] **Step 2: Prompt on connect**

In `connectFolder` at `tools-src/comments-hub.html:1771`, immediately after the directory picker succeeds and before `updateFolderChip('saving')`:

```js
    await ensureUserName();
```

- [ ] **Step 3: Stamp `enteredBy` on new comments**

In the New Comment submit handler near `tools-src/comments-hub.html:1045-1055`, wrap the comment object as it is built. Find where the new comment record is assembled with `const { ref, refCounter } = HubCore.nextRef(state);` and apply the stamp to the record before it is pushed into state:

```js
    const record = HubSync.stampEnteredBy(comment, getUserName());
```

Use `record` in place of the raw `comment` when appending to `state.comments`. Leave the `nc-by` (raisedBy) field untouched — it must stay blank by default.

- [ ] **Step 4: Add a name field to Settings**

In the Settings section (`tools-src/comments-hub.html:676`), add a panel above the list editors:

```html
          <div class="form-row">
            <label class="form-label" for="set-username">Your name</label>
            <input type="text" id="set-username" class="form-input" placeholder="Name"/>
            <p class="form-hint">Recorded against comments you enter, and shown to others in the hub. Not used for “raised by” or “closed by”.</p>
          </div>
```

In `renderSettings()` (`tools-src/comments-hub.html:1691`), populate and wire it:

```js
    const nameInput = el('set-username');
    if (nameInput) {
      nameInput.value = getUserName();
      nameInput.onchange = () => { setUserName(nameInput.value); renderAll(); };
    }
```

- [ ] **Step 5: Verify in the browser and commit**

Reload the tool, connect a scratch folder, confirm the name prompt appears once and not again on reload, add a comment, and confirm `hub-data.json` shows `enteredBy` set and `raisedBy` exactly as typed.

```bash
git commit --allow-empty -m "feat(hub-ui): local identity and enteredBy stamping (tools-src gitignored)"
```

---

### Task 6: UI — refresh hardening

Fixes the live bug where a background refresh repaints over someone mid-edit, and makes the poll cheap.

**Files:**
- Modify: `tools-src/comments-hub.html:1817-1863`

**Interfaces:**
- Consumes: nothing new.
- Produces: `isMidEdit() -> boolean`, `pendingUpdates` flag.

- [ ] **Step 1: Add the mid-edit guard**

Above `refreshFromDisk` at `tools-src/comments-hub.html:1821`:

```js
  // A refresh that repaints while someone is typing throws their work away.
  // Detect the three places real input lives and defer instead.
  function isMidEdit() {
    if (expandedCommentId) return true;              // a close-out panel is open
    if (productEditId !== null) return true;         // the product form is open
    const desc = el('nc-desc');
    if (desc && desc.value.trim()) return true;      // a comment is half-typed
    return false;
  }
  let pendingUpdates = false;
```

- [ ] **Step 2: Make the poll cheap and defer the repaint**

Replace the body of `refreshFromDisk` (`tools-src/comments-hub.html:1821-1844`) so that a timer-driven tick first checks the file's timestamp, and never repaints mid-edit:

```js
  let lastSeenMtime = 0;

  async function refreshFromDisk(reason) {
    if (!dirHandle || refreshing) return;
    // A timer tick only needs to know whether anything changed. getFile()
    // reads metadata, not contents, so this costs a fraction of a full read.
    if (reason === 'timer') {
      try {
        const fh = await dirHandle.getFileHandle('hub-data.json', { create: false });
        const mtime = (await fh.getFile()).lastModified;
        if (mtime === lastSeenMtime) return;
      } catch (e) { /* missing file: fall through to the full read */ }
    }
    if (isMidEdit() && reason !== 'manual') { pendingUpdates = true; updateSyncHint(); return; }
    refreshing = true;
    try {
      const before = state.products.length;
      const beforeComments = state.comments.length;
      registerJson = await findRegisterJson(dirHandle);
      const ledger = await engine.readLedger();
      if (ledger.status === 'corrupt') {
        updateFolderChip('error', 'hub-data.json is unreadable — not overwriting. Fix or remove it, then reconnect.');
        return;
      }
      if (ledger.status === 'ok') state = HubCore.mergeState(state, ledger.data);
      try {
        const fh = await dirHandle.getFileHandle('hub-data.json', { create: false });
        lastSeenMtime = (await fh.getFile()).lastModified;
      } catch (e) { /* nothing to record */ }
      invalidateFamCache();
      syncProductsFromRegister();
      renderAll();
      lastRefresh = Date.now();
      pendingUpdates = false;
      updateSyncHint();
      const added = state.products.length - before;
      const newComments = state.comments.length - beforeComments;
      if (newComments > 0) toast(newComments + ' new comment' + (newComments === 1 ? '' : 's') + ' from the team.');
      else if (added > 0 && reason === 'manual') toast(added + ' new product' + (added === 1 ? '' : 's') + ' picked up from the register.');
      else if (reason === 'manual') toast('Up to date.');
    } catch (e) {
      console.error('refreshFromDisk failed', e);
      if (reason === 'manual') toast('Could not refresh (' + ((e && e.name) || 'error') + ').');
    } finally { refreshing = false; }
  }
```

- [ ] **Step 3: Add the sync hint and shorten the interval**

Add beneath `refreshFromDisk`:

```js
  function updateSyncHint() {
    const chip = el('folder-chip');
    if (!chip) return;
    chip.dataset.pending = pendingUpdates ? 'yes' : 'no';
    chip.title = pendingUpdates
      ? 'Updates from the team are waiting — they will appear when you finish editing.'
      : (lastRefresh ? 'Last synced ' + new Date(lastRefresh).toTimeString().slice(0, 5) : '');
  }
```

Change the interval at `tools-src/comments-hub.html:1848` from `90000` to `PRESENCE_HEARTBEAT_MS` (20s) — the mtime pre-check makes the faster tick cheap:

```js
    refreshTimer = setInterval(() => { if (dirHandle) refreshFromDisk('timer'); }, 20000);
```

- [ ] **Step 4: Apply deferred updates when editing ends**

In the handler that closes an expanded row (where `expandedCommentId` is set back to `null`) and at the end of the New Comment submit, add:

```js
    if (pendingUpdates) refreshFromDisk('deferred');
```

- [ ] **Step 5: Verify in two browser windows and commit**

Open the hub twice against one scratch folder. In window A start typing a description; in window B add a comment. Confirm window A does **not** repaint, the chip tooltip says updates are waiting, and the comment appears once A's description box is cleared.

```bash
git commit --allow-empty -m "fix(hub-ui): never repaint mid-edit; cheap mtime poll for refresh"
```

---

### Task 7: UI — presence heartbeat and soft lock

**Files:**
- Modify: `tools-src/comments-hub.html`

**Interfaces:**
- Consumes: `hub-presence.js` (Task 3), `sessionId` / `getUserName` (Task 5).
- Produces: `presenceRecords` (module-scoped array), `setEditing(commentId)`.

- [ ] **Step 1: Import the module**

At `tools-src/comments-hub.html:716`, alongside the other imports:

```js
  import * as HubPresence from '/assets/js/hub-presence.js';
```

- [ ] **Step 2: Add the heartbeat**

Add near the refresh section:

```js
  // ── Presence ──────────────────────────────────────────────────────────────
  // Best-effort by design: if presence/ is unwritable the hub carries on
  // exactly as before. Nothing here is allowed to block a save or an edit.
  // The folder is shared with Product Brain, so `tool` keeps a decision lock
  // from ever reading as a comment lock.
  let presenceDirHandle = null;
  let presenceRecords = [];
  let editingCommentId = null;

  async function heartbeat() {
    if (!presenceDirHandle) return;
    const rec = HubPresence.presenceRecord({
      name: getUserName() || 'Someone', sessionId, tool: 'hub', editingCommentId, nowIso: nowIso(),
    });
    try {
      await HubSync.writeFile(presenceDirHandle, HubPresence.presenceFileName(sessionId), JSON.stringify(rec));
    } catch (e) { return; }
    const records = [];
    try {
      for await (const entry of presenceDirHandle.values()) {
        if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue;
        try { records.push(JSON.parse(await (await entry.getFile()).text())); } catch (e) { /* mid-write */ }
      }
    } catch (e) { return; }
    presenceRecords = records;
    for (const dead of HubPresence.sweepable(records, Date.now())) {
      if (dead === sessionId) continue;
      try { await presenceDirHandle.removeEntry(HubPresence.presenceFileName(dead)); } catch (e) { /* raced */ }
    }
    renderPresence();
  }

  function setEditing(commentId) { editingCommentId = commentId; void heartbeat(); }

  // Only 'hub' sessions can hold a comment lock, but everyone in the folder is
  // worth showing in the "also here" strip.
  function hubRecords() { return HubPresence.ofTool(presenceRecords, 'hub'); }

  function renderPresence() {
    const box = el('presence-strip');
    if (!box) return;
    const live = HubPresence.livePresences(presenceRecords, sessionId, Date.now());
    box.innerHTML = live.length
      ? 'Also here: ' + live.map(r => escHtml(r.name) + (r.tool === 'brain' ? ' (brain)' : '')).join(', ')
      : '';
  }
```

- [ ] **Step 3: Create the folder on connect and start the heartbeat**

In `connectFolder`, after `productsDirHandle` is obtained (`tools-src/comments-hub.html:1801`):

```js
      try {
        presenceDirHandle = await dirHandle.getDirectoryHandle('presence', { create: true });
        void heartbeat();
        setInterval(() => { void heartbeat(); }, HubPresence.PRESENCE_HEARTBEAT_MS);
      } catch (e) { presenceDirHandle = null; }   // presence is never load-bearing
```

Add the strip to the header markup near `tools-src/comments-hub.html:452`:

```html
        <span id="presence-strip" class="presence-strip"></span>
```

- [ ] **Step 4: Mark and release the lock, and badge the row**

Where a dashboard row expands (setting `expandedCommentId`), call `setEditing(expandedCommentId)`; where it collapses, call `setEditing(null)`.

In the row renderer near `tools-src/comments-hub.html:1195`, add a badge when another live session holds it:

```js
    const heldBy = HubPresence.editorOf(hubRecords(), c.id, sessionId, Date.now());
    const lockBadge = heldBy
      ? '<span class="chip chip-muted" title="' + escAttr(heldBy + ' has this open. You can still edit it.') + '">' +
        escHtml(heldBy) + ' is editing</span>'
      : '';
```

Render `lockBadge` in the row. When `heldBy` is set, the expand control gets `data-soft-locked="yes"` and the expanded panel shows a one-line banner with an **Edit anyway** button that clears the flag locally. **Never disable the control outright** — a stale record must never be able to lock someone out of their own tool.

- [ ] **Step 5: Release on unload**

```js
  window.addEventListener('beforeunload', () => {
    if (!presenceDirHandle) return;
    try { presenceDirHandle.removeEntry(HubPresence.presenceFileName(sessionId)); } catch (e) { /* best effort */ }
  });
```

- [ ] **Step 6: Verify in two windows and commit**

Two windows, different names. Expand a comment in A; confirm B badges that row within ~20s and that **Edit anyway** still opens it. Close A; confirm the badge clears within 90s.

```bash
git commit --allow-empty -m "feat(hub-ui): presence strip and heartbeat-derived soft record lock"
```

---

### Task 8: UI — save-time conflict prompt

**Files:**
- Modify: `tools-src/comments-hub.html`

**Interfaces:**
- Consumes: `detectConflict`, `conflictFields` (Task 4).

- [ ] **Step 1: Snapshot the record on expand**

When a row expands, capture the loaded copy:

```js
  let editingSnapshot = null;   // the record as it looked when the panel opened
```

Set it alongside `setEditing(expandedCommentId)`:

```js
    editingSnapshot = state.comments.find(c => c.id === expandedCommentId) || null;
```

- [ ] **Step 2: Check before committing an edit**

In the close-out / edit save path (near `tools-src/comments-hub.html:1330` and `:1364`, both of which call `queueSave`), insert before the mutation is applied:

```js
    const ledger = await engine.readLedger();
    const disk = ledger.status === 'ok' ? (ledger.data.comments || []) : [];
    const theirs = HubSync.detectConflict(editingSnapshot, disk);
    if (theirs) {
      const fields = HubSync.conflictFields(editingSnapshot, theirs).join(', ');
      const keepMine = confirm(
        'Someone else changed this comment while you had it open.\n\n' +
        'Changed: ' + fields + '\n\n' +
        'OK = keep your version (overwrites theirs)\n' +
        'Cancel = discard yours and load theirs');
      if (!keepMine) {
        state = HubCore.mergeState(state, ledger.data);
        editingSnapshot = null;
        renderAll();
        return;
      }
    }
```

`confirm` is deliberate here: this is rare, blocking, and must not be dismissible by accident. A styled three-way dialog can replace it later without changing the logic.

- [ ] **Step 3: Verify in two windows and commit**

Open the same comment in both windows. Type different `actionTaken` text in each. Save A, then save B — confirm B prompts, names `actionTaken`, and that both branches behave as described.

```bash
git commit --allow-empty -m "feat(hub-ui): save-time conflict prompt for same-record edits"
```

---

### Task 9: UI — backup list in Settings, and wire the backup folder

**Files:**
- Modify: `tools-src/comments-hub.html`

**Interfaces:**
- Consumes: `cfg.backupDir` / `cfg.backupKeep` (Task 2).

- [ ] **Step 1: Give the engine a backups folder**

At the `createSyncEngine` config (`tools-src/comments-hub.html:738-747`), add:

```js
    backupDir: async () => {
      if (!dirHandle) return null;
      try { return await dirHandle.getDirectoryHandle('backups', { create: true }); }
      catch (e) { return null; }   // fall back to the single rolling backup
    },
    backupKeep: 20,
```

- [ ] **Step 2: List backups in Settings**

Add to the Settings section markup:

```html
          <div class="form-row">
            <label class="form-label">Backups</label>
            <div id="set-backups" class="backup-list"></div>
            <p class="form-hint">The 20 most recent copies of the ledger, newest first. To restore one, close the hub, rename the file to <code>hub-data.json</code> in the hub folder, then reconnect.</p>
          </div>
```

In `renderSettings()`:

```js
    const box = el('set-backups');
    if (box && dirHandle) {
      box.textContent = 'Reading…';
      (async () => {
        try {
          const bdir = await dirHandle.getDirectoryHandle('backups', { create: false });
          const names = [];
          for await (const entry of bdir.values()) if (entry.kind === 'file') names.push(entry.name);
          names.sort().reverse();
          box.innerHTML = names.length
            ? names.map(n => '<div class="backup-row">' + escHtml(n) + '</div>').join('')
            : '<div class="backup-row muted">No backups yet.</div>';
        } catch (e) {
          box.innerHTML = '<div class="backup-row muted">No backups yet.</div>';
        }
      })();
    }
```

- [ ] **Step 3: Verify and commit**

Make several edits, then confirm `backups/` fills with dated files, that it stops growing at 20, and that Settings lists them newest-first.

```bash
git commit --allow-empty -m "feat(hub-ui): dated backups folder and Settings backup list"
```

---

### Task 10: Full verification and publish

**Files:**
- Modify: `tools/comments-hub.html`, `tools/vault-manifest.json` (generated)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — all suites, including `product-brain` and `hub-sync` tests unaffected by the shared-engine changes.

- [ ] **Step 2: Regression-check Product Brain**

Open Product Brain against a scratch folder. Confirm it still connects, saves, and writes its single `*.backup.json` — it passes no `backupDir`, so its behaviour must be unchanged.

- [ ] **Step 3: Two-window acceptance pass**

Against one scratch hub folder, in two windows with different names, confirm all of:

1. New comments from B appear in A within ~20s with a toast.
2. A typing a description is never repainted; the update lands when the box clears.
3. Expanding a comment in A badges it in B within ~20s; **Edit anyway** still works.
4. Closing A clears its badge and presence entry within 90s.
5. Simultaneous edits to one comment produce the conflict prompt, and both branches behave correctly.
6. `hub-data.json.tmp` never persists after a save.
7. `backups/` holds dated files, capped at 20.
8. Generated Excel filenames are unchanged — **no dates added** (ACC version history depends on this).

- [ ] **Step 4: Lock and publish** *(Harvey runs this — it prompts for the workshop code)*

```bash
node scripts/lock-tools.mjs
git add tools/ && git commit -m "build: republish tools with multi-user Comments Hub"
```

- [ ] **Step 5: Deploy**

`git push` — GitHub Pages publishes from `main`.
