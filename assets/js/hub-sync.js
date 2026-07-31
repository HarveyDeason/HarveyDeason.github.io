// assets/js/hub-sync.js
// Shared sync logic for the Comments Hub and Decision Register: generic ledger
// merging here, and (Task 3) the single-flight save engine. Pure and
// node-testable; no DOM.

export function mergeById(a, b, tombstones) {
  const out = new Map();
  for (const rec of [...(a || []), ...(b || [])]) {
    if (!rec || !rec.id) continue;
    const prev = out.get(rec.id);
    if (!prev || (rec.updatedAt || '') > (prev.updatedAt || '')) out.set(rec.id, rec);
  }
  const t = tombstones || {};
  return [...out.values()].filter(r => !(t[r.id] && t[r.id] >= (r.updatedAt || '')));
}

export function mergeList(a, b) {
  const seen = new Set();
  const out = [];
  for (const v of [...(a || []), ...(b || [])]) {
    const k = String(v).trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(String(v).trim());
  }
  return out;
}

export function mergeTombstones(a, b) {
  const out = { ...(a || {}) };
  for (const [id, ts] of Object.entries(b || {})) {
    if (!out[id] || ts > out[id]) out[id] = ts;
  }
  return out;
}

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
    // Key-order-sensitive for nested objects, so two semantically-equal ones
    // written with different key order would read as differing. Fine here:
    // these records are flat scalars plus arrays (whose order IS meaningful),
    // and the result only names fields in a prompt the user is already reading.
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

export async function writeFile(dir, name, contents) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  try {
    await w.write(contents);
    await w.close();
  } catch (e) {
    // A half-open writable holds an OS lock and a .crswap swap file, and
    // every later createWritable() on this file then fails with
    // InvalidStateError — one transient lock would otherwise poison all
    // future saves. Always release it, and never let abort's own failure
    // hide the error that actually happened.
    try { await w.abort(); } catch (abortErr) { /* stream already gone */ }
    if (e && e.name) e.hubFile = name;   // so callers can name the file
    throw e;
  }
}

// Sweeping is best-effort tidiness, never load-bearing for correctness — a
// crashed tab's litter sits harmlessly until someone reconnects and sweeps it.
// 10 minutes comfortably outlives the retry backoff (longest delay 30s) so an
// in-flight session's own temp file is never mistaken for litter.
const TMP_SWEEP_AGE_MS = 10 * 60 * 1000;

async function sweepStaleTmp(dir, name) {
  // Best-effort only: a failure here must never fail the save it follows.
  try {
    if (typeof dir.values !== 'function') return;
    const prefix = name + '.';
    const now = Date.now();
    for await (const entry of dir.values()) {
      if (entry.kind !== 'file' || !entry.name.startsWith(prefix) || !entry.name.endsWith('.tmp')) continue;
      try {
        const fh = await dir.getFileHandle(entry.name, { create: false });
        const file = await fh.getFile();
        if (now - file.lastModified >= TMP_SWEEP_AGE_MS) {
          await dir.removeEntry(entry.name);
        }
      } catch (e) { /* another client got there first, or it's not actually removable — leave it */ }
    }
  } catch (e) { /* enumeration itself failed; nothing more we can do */ }
}

// The ledger is the team's single source of truth: a crash or lock partway
// through a direct write leaves everyone with a truncated file. Write to a
// temp name, prove it parses, and only then move it into place — so the real
// file only ever goes from one complete state to another.
//
// sessionId makes the temp name unique per session: a shared `name + '.tmp'`
// means every session on every machine writes the SAME temp file, so two
// sessions saving around the same time can interleave — one session's write
// lands on top of another's, and the "verify" read can see a mix of both (or
// entirely the other session's content), which then gets moved over the real
// ledger. That is silent data loss at best and a wedged, unparseable ledger
// for the whole team at worst. A per-session name means sessions never share
// a temp file, so they can never collide on it.
export async function writeFileAtomic(dir, name, contents, sessionId) {
  const tmp = name + '.' + (sessionId || Math.random().toString(36).slice(2)) + '.tmp';
  // Write the temp file first and probe move() support on the TEMP handle,
  // never the destination: getFileHandle(name, { create: true }) on the real
  // destination would create it immediately, per spec, before a verified
  // copy exists to swap in — leaving a zero-byte file the moment anything
  // (crash, closed tab, failed verification) interrupts the save between
  // probe and move. The real file must only ever go from one complete state
  // to another.
  await writeFile(dir, tmp, contents);
  const tmpHandle = await dir.getFileHandle(tmp, { create: false });
  if (typeof tmpHandle.move !== 'function') {
    // Older Chromium without FileSystemFileHandle.move(): a direct write is
    // still better than leaving the change unsaved. Keep the verified-good
    // temp file until the direct write has SUCCEEDED — writeFile's
    // getFileHandle(name, { create: true }) creates a zero-length file
    // immediately, so removing our only good copy first and then hitting the
    // same transient lock the retry loop exists for would leave the ledger
    // at 0 bytes, unparseable, and the whole team wedged until someone
    // deletes it by hand.
    console.warn('writeFileAtomic: no move() support, falling back to a direct (non-atomic) write for ' + name);
    await writeFile(dir, name, contents);
    try { await dir.removeEntry(tmp); } catch (removeErr) { /* stray .tmp left, nothing more we can do */ }
    return;
  }
  const verify = await (await tmpHandle.getFile()).text();
  // A JSON.parse check only proves the temp file is SOME valid JSON — it
  // would happily accept a different session's complete ledger if that
  // session's write interleaved with ours on the same temp name. Compare
  // against exactly what we wrote instead: that subsumes "is it parseable"
  // and also catches "is it ours".
  if (verify !== contents) {
    // Best-effort cleanup: a failure here must never mask the real
    // verification error below.
    try { await dir.removeEntry(tmp); } catch (removeErr) { /* stray .tmp left, nothing more we can do */ }
    const err = new Error('Atomic write verification failed for ' + name + ': content changed underneath us before the move');
    err.hubFile = name;
    throw err;
  }
  // move() overwrites an existing destination unconditionally — verified
  // against Chrome docs — which is what makes this swap atomic; do not add
  // an existence check. Requires Chrome 111+ for files outside the OPFS.
  await tmpHandle.move(name);
  // Session-unique temp names mean a crashed tab's own leftovers no longer
  // get silently clobbered by its next save — so nothing removes them for
  // us. Sweep other sessions' old litter for this same ledger now that we
  // know the folder is reachable and writable.
  await sweepStaleTmp(dir, name);
}

const BACKUP_RE = /^(.+)-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/;

export function backupFileName(baseName, nowIso) {
  const stem = baseName.replace(/\.json$/, '');
  // Colons are illegal in Windows filenames; dashes keep string order == time order.
  const stamp = String(nowIso).slice(0, 19).replace(/:/g, '-');
  return stem + '-' + stamp + '.json';
}

// baseName scopes the prune to one ledger: the Comments Hub and Decision Register
// share a backups/ folder, and an unscoped prune would delete the other tool's
// history the moment either passed 20 saves. This is a startsWith(stem + '-')
// match, not collision-proof in general: a future ledger named e.g. "hub.json"
// would have its "hub-" prefix match "hub-data-*.json" backups too, so keep
// ledger stems from being a prefix of one another when adding a third one.
export function prunableBackups(names, keep, baseName) {
  const prefix = baseName ? baseName.replace(/\.json$/, '') + '-' : '';
  const backups = (names || [])
    .filter(n => BACKUP_RE.test(n) && (!prefix || n.startsWith(prefix)))
    .sort();
  const n = Math.max(0, keep);
  return n === 0 ? backups : backups.slice(0, Math.max(0, backups.length - n));
}

export function createSyncEngine(cfg) {
  let running = false, pending = false, pendingAll = false;
  let pendingIds = new Set();

  // A lock is transient — OneDrive mid-sync, the workbook open in Excel, a
  // stale .crswap — so the save that just failed will usually succeed moments
  // later. Retrying only on the user's next change meant a change could sit
  // unsaved indefinitely without anyone knowing. Back off, then hand back to
  // the next change rather than hammering the disk forever.
  const retryDelays = cfg.retryDelays || [3000, 10000, 30000];
  let retryTimer = null, retryIndex = 0;

  // writeBackup runs before the ledger write that can fail, so a transient
  // lock on that write sends the retry loop back through saveNow from the
  // top — and without this memo, a single lock event backs up the exact same
  // (unchanged) disk content up to 4 times, burning a chunk of the team's
  // keep=20 backup history on duplicates of one moment. Track the raw
  // content we last actually backed up, per engine instance, and skip when
  // it hasn't changed.
  let lastBackedUpRaw = null;

  function clearRetry() {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  }

  function scheduleRetry() {
    if (retryIndex >= retryDelays.length) return;   // give up; the next change tries again
    const delay = retryDelays[retryIndex];
    retryIndex += 1;
    clearRetry();
    retryTimer = setTimeout(() => { retryTimer = null; pending = true; void loop(); }, delay);
    if (retryTimer && typeof retryTimer.unref === 'function') retryTimer.unref();   // never hold a test process open
  }

  // A single rolling backup is one mistake deep. With several people in the
  // ledger, the mistake worth recovering from is often not the most recent one.
  //
  // A backup is a courtesy, not the save itself: a read-only or missing
  // backups/ folder, a locked backup file, or a failed prune must never take
  // down the ledger save it was meant to protect. So the entire body is
  // wrapped — every await in here can throw straight into saveNow otherwise.
  async function writeBackup(dir, raw) {
    if (raw === lastBackedUpRaw) return;
    try {
      const getBackupDir = cfg.backupDir;
      if (!getBackupDir) { await writeFile(dir, cfg.backupName, raw); lastBackedUpRaw = raw; return; }
      const bdir = await getBackupDir();
      if (!bdir) { await writeFile(dir, cfg.backupName, raw); lastBackedUpRaw = raw; return; }
      await writeFile(bdir, backupFileName(cfg.fileName, new Date().toISOString()), raw);
      lastBackedUpRaw = raw;
      const names = [];
      for await (const entry of bdir.values()) if (entry.kind === 'file') names.push(entry.name);
      const keep = cfg.backupKeep == null ? 20 : cfg.backupKeep;
      for (const stale of prunableBackups(names, keep, cfg.fileName)) {
        try { await bdir.removeEntry(stale); } catch (e) { /* another client got there first */ }
      }
    } catch (e) {
      console.warn('backup failed, continuing with ledger save', e);
    }
  }

  async function readLedger() {
    const dir = cfg.getDir();
    if (!dir) return { status: 'missing' };
    let txt;
    try {
      const fh = await dir.getFileHandle(cfg.fileName, { create: false });
      txt = await (await fh.getFile()).text();
    } catch (e) {
      // NotFoundError means the ledger genuinely doesn't exist yet (first
      // run) — writing local state over nothing is correct. Anything else
      // (NotAllowedError from a permission that lapsed after a browser
      // restart, NoModificationAllowedError, a transient I/O error from a
      // network share hiccup, ...) means the ledger is very likely still
      // there, we just couldn't read it right now — treating that as
      // "missing" would skip the backup and the merge and overwrite
      // everyone else's work with stale local state.
      if (e && e.name === 'NotFoundError') return { status: 'missing' };
      return { status: 'unreadable' };
    }
    try { return { status: 'ok', data: JSON.parse(txt), raw: txt }; }
    catch (e) { return { status: 'corrupt' }; }
  }

  async function saveNow(touched) {
    const dir = cfg.getDir();
    if (!dir) return true;
    cfg.onStatus('saving');
    const disk = await readLedger();
    if (disk.status === 'corrupt') {
      // Final: no amount of retrying fixes a file someone has to go and mend.
      cfg.onStatus('error', cfg.fileName + ' is unreadable — not overwriting. Fix or remove it, then reconnect.', true);
      return false;
    }
    if (disk.status === 'unreadable') {
      // Transient, unlike corrupt: a network blip, a lapsed permission, a
      // momentary lock. Write nothing — no backup, no merge, no overwrite —
      // and throw so loop()'s existing catch/backoff retries this shortly.
      // A direct engine.saveNow(...) caller (outside loop()) sees a rejected
      // promise rather than a silent `true`/`synced` that never happened.
      const err = new Error(cfg.fileName + ' could not be read right now (not overwriting)');
      err.name = 'LedgerUnreadableError';
      err.hubFile = cfg.fileName;
      throw err;
    }
    if (disk.status === 'ok') {
      await writeBackup(dir, disk.raw);
      cfg.setState(cfg.merge(cfg.getState(), disk.data));
    }
    const st = cfg.getState();
    st.savedAt = new Date().toISOString();
    await writeFileAtomic(dir, cfg.fileName, JSON.stringify(st, null, 2), cfg.sessionId);
    await cfg.afterSave(touched);
    cfg.onStatus('synced');
    return true;
  }

  function queueSave(touched) {
    if (touched === null) pendingAll = true;
    else for (const id of touched || []) pendingIds.add(id);
    pending = true;
    clearRetry();        // this change supersedes any pending retry
    retryIndex = 0;
    void loop();
  }

  async function loop() {
    if (running) return;
    running = true;
    try {
      while (pending) {
        pending = false;
        const touched = pendingAll ? null : [...pendingIds];
        pendingAll = false; pendingIds = new Set();
        try {
          await saveNow(touched);
          retryIndex = 0;                       // a clean save resets the backoff
        } catch (e) {
          console.error('save failed', e);
          const which = e && e.hubFile ? ' writing ' + e.hubFile : '';
          // final=false means "we are about to try again" — the tools keep it to
          // the chip rather than interrupting with a dialog.
          const willRetry = retryIndex < retryDelays.length;
          const more = willRetry
            ? ' Your change is kept on screen and will retry shortly.'
            : ' Your change is kept on screen and will retry on the next change.';
          cfg.onStatus('error', 'Save failed' + which + ' (' + ((e && e.name) || 'error') + ').' + more, !willRetry);
          if (touched === null) pendingAll = true;
          else for (const id of touched) pendingIds.add(id);
          scheduleRetry();
        }
      }
    } finally { running = false; }
  }

  return { queueSave, saveNow, readLedger, writeFile };
}
