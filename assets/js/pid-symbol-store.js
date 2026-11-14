// assets/js/pid-symbol-store.js
// Reads and saves the P&ID symbol library through a directory handle that is
// passed in (File System Access API, or a fake in tests).
//
// THIS MODULE NAMES EXACTLY ONE FILE: symbol-library.json, plus its copies in
// backups/. It must never be given another. In particular it knows nothing
// about register.json: the register lost data in August 2026 through an
// unsafe write path, and the symbol features are kept away from it entirely.
//
// The rules, the same ones the register follows since that incident:
//   - a read has three answers (ok / missing / unreadable), and only a
//     genuine "not found" counts as missing;
//   - a failed read never leads to a write;
//   - a save is refused unless the file on disk is byte-for-byte what this
//     session loaded;
//   - writes go through writeFileAtomic, and the old file is backed up first.

import { parseLibrary, serialiseLibrary } from './pid-symbols.js';

export const LIBRARY_FILE = 'symbol-library.json';
const BACKUPS_KEPT = 20;

/** { status: 'ok', raw, library } | { status: 'missing' } | { status: 'unreadable', error }. Never rejects. */
export async function readLibraryFile(dir) {
  if (dir == null) return { status: 'missing' };
  let raw;
  try {
    const fh = await dir.getFileHandle(LIBRARY_FILE, { create: false });
    raw = await (await fh.getFile()).text();
  } catch (e) {
    if (e && e.name === 'NotFoundError') return { status: 'missing' };
    return { status: 'unreadable', error: String((e && e.message) || e) };
  }
  const parsed = parseLibrary(raw);
  if (!parsed.ok) return { status: 'unreadable', error: parsed.error };
  return { status: 'ok', raw, library: parsed.library };
}

/**
 * May this session write, given what it loaded and what is on disk now?
 * Writes only on a first save or when the file is unchanged. Anything that
 * cannot be evaluated is a refusal.
 */
export function decideSave(loadedRaw, disk) {
  const status = disk && typeof disk === 'object' ? disk.status : undefined;
  const never = loadedRaw == null;
  if (status === 'missing') return never ? { write: true, reason: 'first-save' } : { write: false, reason: 'gone' };
  if (status === 'ok' && typeof disk.raw === 'string') {
    if (never) return { write: false, reason: 'exists' };
    return disk.raw === loadedRaw ? { write: true, reason: 'unchanged' } : { write: false, reason: 'changed' };
  }
  return { write: false, reason: 'unreadable' };
}

// Best effort, exactly as the register's backup is: a read-only or missing
// backups/ folder must never take down the save it was meant to protect.
async function backUp(dir, raw, deps) {
  try {
    const bdir = await dir.getDirectoryHandle('backups', { create: true });
    const fh = await bdir.getFileHandle(deps.backupFileName(LIBRARY_FILE, deps.now()), { create: true });
    const w = await fh.createWritable();
    await w.write(raw);
    await w.close();
    const names = [];
    for await (const entry of bdir.values()) if (entry.kind === 'file') names.push(entry.name);
    for (const stale of deps.prunableBackups(names, BACKUPS_KEPT, LIBRARY_FILE)) {
      try { await bdir.removeEntry(stale); } catch { /* another session got there first */ }
    }
  } catch (e) {
    console.warn('symbol library backup failed, continuing with the save', e);
  }
}

/**
 * Save the library. Reads the file again first and refuses unless decideSave
 * allows it. Returns { status: 'saved', raw } or { status: 'refused', reason,
 * disk } having written nothing. Rejects only if the write itself fails.
 * deps = { writeFileAtomic, backupFileName, prunableBackups, now }.
 */
export async function saveLibraryFile(request) {
  const { dir, library, loadedRaw, sessionId, deps } = request && typeof request === 'object' ? request : {};
  if (dir == null) return { status: 'refused', reason: 'unreadable', disk: { status: 'unreadable', error: 'no folder' } };
  // No direct-write fallback: without the atomic writer there is no save.
  if (!deps || typeof deps.writeFileAtomic !== 'function') throw new Error('saveLibraryFile needs deps.writeFileAtomic');
  const disk = await readLibraryFile(dir);
  const decision = decideSave(loadedRaw, disk);
  if (!decision.write) return { status: 'refused', reason: decision.reason, disk };
  const raw = serialiseLibrary(library);
  if (disk.status === 'ok') {
    if (disk.raw === raw) return { status: 'saved', raw }; // nothing changed: no write, no backup burned
    await backUp(dir, disk.raw, deps);
  }
  await deps.writeFileAtomic(dir, LIBRARY_FILE, raw, sessionId);
  return { status: 'saved', raw };
}
