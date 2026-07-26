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

export function createSyncEngine(cfg) {
  let running = false, pending = false, pendingAll = false;
  let pendingIds = new Set();

  async function writeFile(dir, name, contents) {
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
      cfg.onStatus('error', cfg.fileName + ' is unreadable — not overwriting. Fix or remove it, then reconnect.');
      return false;
    }
    if (disk.status === 'ok') {
      await writeFile(dir, cfg.backupName, disk.raw);
      cfg.setState(cfg.merge(cfg.getState(), disk.data));
    }
    const st = cfg.getState();
    st.savedAt = new Date().toISOString();
    await writeFile(dir, cfg.fileName, JSON.stringify(st, null, 2));
    await cfg.afterSave(touched);
    cfg.onStatus('synced');
    return true;
  }

  function queueSave(touched) {
    if (touched === null) pendingAll = true;
    else for (const id of touched || []) pendingIds.add(id);
    pending = true;
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
        try { await saveNow(touched); }
        catch (e) {
          console.error('save failed', e);
          const which = e && e.hubFile ? ' writing ' + e.hubFile : '';
          cfg.onStatus('error', 'Save failed' + which + ' (' + ((e && e.name) || 'error') + '). Your change is kept on screen and will retry on the next change.');
          if (touched === null) pendingAll = true;
          else for (const id of touched) pendingIds.add(id);
        }
      }
    } finally { running = false; }
  }

  return { queueSave, saveNow, readLedger, writeFile };
}
