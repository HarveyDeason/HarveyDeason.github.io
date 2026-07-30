// assets/js/hub-sync.js
// Shared sync logic for the Comments Hub and Product Brain: generic ledger
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

  async function readLedger() {
    const dir = cfg.getDir();
    if (!dir) return { status: 'missing' };
    let txt;
    try {
      const fh = await dir.getFileHandle(cfg.fileName, { create: false });
      txt = await (await fh.getFile()).text();
    } catch (e) { return { status: 'missing' }; }
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
    if (disk.status === 'ok') {
      await writeFile(dir, cfg.backupName, disk.raw);
      cfg.setState(cfg.merge(cfg.getState(), disk.data));
    }
    const st = cfg.getState();
    st.savedAt = new Date().toISOString();
    await writeFileAtomic(dir, cfg.fileName, JSON.stringify(st, null, 2));
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
