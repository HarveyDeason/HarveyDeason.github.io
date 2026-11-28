// assets/js/pid-standards.js
// The standards a register keeps, the stamp a drawing carries, and which standard a drawing is checked against. Pure: no DOM, no files, no data.
//
// A "standard" here has two parts that change independently: the PACK (the tag tables and check settings) and the LEGEND LIBRARY (the symbols).
// A register keeps every pack it has been given (a list, with one marked current) and every legend library it has saved. When a drawing's tags
// are read it is stamped with the pack and the legend in use; checking it later defaults to what it was stamped with, so a drawing made under an
// earlier standard is not flagged for not meeting a later one. Each part falls back to the current one, with a plain note, when the stamped one
// is no longer kept.

const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const str = x => (typeof x === 'string' ? x : '');
const slug = s => String(s == null ? '' : s).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');

/** A readable, filesystem-safe id for a pack: its id (or name), its revision and its fingerprint. */
export function standardId(pack, fingerprint) {
  try {
    const id = isObj(pack) && isObj(pack.identity) ? pack.identity : {};
    return (slug(id.id || id.name) || 'pack') + '-r' + (slug(id.revision) || '0') + '-' + (slug(fingerprint) || 'nofp');
  } catch { return 'pack-r0-nofp'; }
}

const canon = x => (Array.isArray(x) ? x.map(canon) : isObj(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canon(x[k])])) : x);
/** 12 hex digits of a SHA-256 of any JSON-able value, the same whatever order its keys are in. */
export async function fingerprintJson(value) {
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(canon(value === undefined ? null : value)));
    const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
  } catch { return ''; }
}

// ── the list ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const emptyIndex = () => ({ format: 1, current: null, standards: [] });
function normEntry(e) {
  if (!isObj(e) || !str(e.id)) return null;
  return { id: e.id, name: str(e.name), packRevision: str(e.packRevision), fingerprint: str(e.fingerprint), libraryFp: typeof e.libraryFp === 'string' && e.libraryFp ? e.libraryFp : null,
    savedAt: str(e.savedAt), standardNumber: str(e.standardNumber), standardRevision: str(e.standardRevision), standardDate: str(e.standardDate),
    legend: Array.isArray(e.legend) ? e.legend.filter(isObj).map(l => ({ sheet: str(l.sheet), rev: str(l.rev) })) : [] };
}
const valid = ix => isObj(ix) && Array.isArray(ix.standards);

/** The list with an entry added (or replaced, keeping its place). Every earlier standard stays. makeCurrent marks it the current one. */
export function addStandard(index, entry, opts) {
  try {
    const base = valid(index) ? { format: 1, current: typeof index.current === 'string' ? index.current : null, standards: index.standards.map(normEntry).filter(Boolean) } : emptyIndex();
    const e = normEntry(entry);
    if (!e) return base;
    const at = base.standards.findIndex(s => s.id === e.id);
    if (at >= 0) base.standards[at] = e; else base.standards.push(e);
    if (isObj(opts) && opts.makeCurrent) base.current = e.id;
    return base;
  } catch { return emptyIndex(); }
}
/** The list with another standard current; null means the built-in tables. An id that is not listed changes nothing. */
export function setCurrent(index, id) {
  const ix = valid(index) ? index : emptyIndex();
  if (id === null) return { ...ix, current: null };
  return ix.standards.some(s => s && s.id === id) ? { ...ix, current: id } : ix;
}
/** { ok, index } with the pack taken out of the list. The current pack is not removed (make another current first); an unlisted id is a problem, not a silent no-op. */
export function removeStandard(index, id) {
  try {
    if (!valid(index)) return { ok: false, problem: 'There is no list of packs.', index: emptyIndex() };
    if (!index.standards.some(s => s && s.id === id)) return { ok: false, problem: 'That pack is not in the list.', index };
    if (index.current === id) return { ok: false, problem: 'That is the current pack. Make another pack current (or use the built-in standard) first, then delete it.', index };
    return { ok: true, index: { ...index, standards: index.standards.filter(s => s && s.id !== id) } };
  } catch { return { ok: false, problem: 'The pack could not be removed.', index: emptyIndex() }; }
}
/** How many drawing revisions (and drawings) in the register's history were read under a pack: what deleting it would leave without its own standard. */
export function countStamped(revHistory, id) {
  const out = { revisions: 0, drawings: 0 };
  try {
    if (!isObj(revHistory)) return out;
    for (const revs of Object.values(revHistory)) {
      if (!isObj(revs)) continue;
      let hit = 0;
      for (const snap of Object.values(revs)) if (isObj(snap) && isObj(snap.standard) && snap.standard.standardId === id) hit++;
      if (hit) { out.revisions += hit; out.drawings++; }
    }
  } catch { /* what was counted stands */ }
  return out;
}
export const serializeIndex = ix => JSON.stringify(valid(ix) ? ix : emptyIndex(), null, 1);
/** { ok, index } from the saved text. Unusable text is an empty list, never a throw; bad and repeated entries are dropped. */
export function parseIndex(text) {
  try {
    const raw = JSON.parse(text);
    if (!isObj(raw) || raw.format !== 1 || !Array.isArray(raw.standards)) return { ok: false, index: emptyIndex() };
    const seen = new Set(), standards = [];
    for (const e of raw.standards) { const n = normEntry(e); if (n && !seen.has(n.id)) { seen.add(n.id); standards.push(n); } }
    return { ok: true, index: { format: 1, current: typeof raw.current === 'string' && seen.has(raw.current) ? raw.current : null, standards } };
  } catch { return { ok: false, index: emptyIndex() }; }
}

// ── the stamp ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** What a drawing revision is stamped with when its tags are read: the pack (or the built-in tables) and the legend library in use. */
export function stampOf(o) {
  const x = isObj(o) ? o : {};
  const pack = isObj(x.pack) ? x.pack : null, id = pack && isObj(pack.identity) ? pack.identity : {}, std = isObj(id.standard) ? id.standard : {};
  return { builtin: !pack, standardId: pack && str(x.standardId) ? x.standardId : null, packName: str(id.name), packRevision: str(id.revision), standardNumber: str(std.number), standardRevision: str(std.revision),
    fingerprint: pack ? str(x.fingerprint) : '', libraryFp: typeof x.libraryFp === 'string' && x.libraryFp ? x.libraryFp : null,
    line: pack ? str(x.line) : 'Read against the built-in standard (no pack imported)', at: str(x.at) };
}
/** 'current' (the pack now in use), 'earlier' (another pack, or one no longer listed), 'builtin', or 'none' (no stamp: read before stamping). */
export function stampStatus(stamp, index) {
  if (!isObj(stamp)) return 'none';
  if (stamp.builtin === true) return 'builtin';
  if (!str(stamp.standardId)) return 'none';
  return valid(index) && index.current === stamp.standardId ? 'current' : 'earlier';
}

// ── which standard a drawing is checked against ──────────────────────────────────────────────────────────────────────────
/**
 * { packId (null = the built-in tables), packSource, libraryFp, librarySource, notes[] }. Default: what the drawing was stamped with, as far as it
 * is still kept; otherwise the current one, with a note. useCurrent forces the current pack and legend.
 */
export function resolveStandard(o) {
  const x = isObj(o) ? o : {};
  const index = valid(x.index) ? x.index : emptyIndex();
  const libs = x.libraries instanceof Set ? x.libraries : new Set(Array.isArray(x.libraries) ? x.libraries : []);
  const curLib = typeof x.currentLibraryFp === 'string' && x.currentLibraryFp ? x.currentLibraryFp : null;
  const curPack = typeof index.current === 'string' && index.standards.some(s => s && s.id === index.current) ? index.current : null;
  const out = { packId: curPack, packSource: 'current', libraryFp: curLib, librarySource: 'current', notes: [] };
  const stamp = isObj(x.stamp) ? x.stamp : null;
  if (x.useCurrent === true) return out;
  if (!stamp || (stamp.builtin !== true && !str(stamp.standardId))) { out.notes.push('No stamp: this drawing was read before standards were stamped, so the current standard is used.'); return out; }
  if (stamp.builtin === true) { out.packId = null; out.packSource = 'stamped'; }
  else if (index.standards.some(s => s && s.id === stamp.standardId)) { out.packId = stamp.standardId; out.packSource = 'stamped'; }
  else out.notes.push('The standard it was read under (' + (str(stamp.packName) || str(stamp.standardId)) + (str(stamp.packRevision) ? ' rev ' + stamp.packRevision : '') + ') is not kept in this folder, so the current one is used.');
  const want = typeof stamp.libraryFp === 'string' && stamp.libraryFp ? stamp.libraryFp : null;
  if (want) {
    if (want === curLib || libs.has(want)) { out.libraryFp = want; out.librarySource = 'stamped'; }
    else out.notes.push('The legend it was read under is not kept in this folder, so the current legend is used.');
  }
  return out;
}
