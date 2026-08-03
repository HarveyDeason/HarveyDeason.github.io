// assets/js/hub-core.js
// Pure logic for the Comments Hub tool: state shape, shared-folder merge,
// ref sequencing, dashboard filtering, and Excel workbook models.
// No DOM, no File System Access API — everything here is node-testable.

import { mergeById, mergeList, mergeTombstones } from './hub-sync.js';

export const HUB_VERSION = 1;

export const DEFAULT_CATEGORIES = ['Pipework change', 'New valve', 'Valve change',
  'Instrument change', 'Equipment change', 'Layout change', 'Annotation / drafting', 'Other'];
export const DEFAULT_SOURCES = ['Site feedback', 'Design review', 'Client comment',
  'HAZOP action', 'Internal QA', 'Other'];

export function emptyState(nowIso) {
  return {
    version: HUB_VERSION,
    savedAt: nowIso || '',
    products: [],
    comments: [],
    lists: { categories: DEFAULT_CATEGORIES.slice(), sources: DEFAULT_SOURCES.slice() },
    tombstones: {},
    refCounter: 0,
    history: [],
  };
}

export function mergeState(local, disk) {
  const l = local || emptyState('');
  const d = disk || emptyState('');
  const tombstones = mergeTombstones(l.tombstones, d.tombstones);
  const merged = {
    version: HUB_VERSION,
    savedAt: (l.savedAt || '') > (d.savedAt || '') ? l.savedAt : d.savedAt,
    products: mergeById(l.products || [], d.products || [], tombstones),
    comments: mergeById(l.comments || [], d.comments || [], tombstones),
    // History is unioned by entry id, not filtered by tombstones: a deleted
    // comment's trail must survive the deletion, and history entry ids are
    // distinct from record ids so an empty tombstone map here is always safe
    // — it can never accidentally resurrect a tombstoned comment.
    history: mergeById(l.history || [], d.history || [], {}),
    lists: {
      categories: mergeList(l.lists && l.lists.categories, d.lists && d.lists.categories),
      sources: mergeList(l.lists && l.lists.sources, d.lists && d.lists.sources),
    },
    tombstones,
    refCounter: Math.max(l.refCounter || 0, d.refCounter || 0),
  };
  return resequenceRefs(merged);
}

export function formatRef(n) {
  return 'HUB-' + String(n).padStart(4, '0');
}

export function nextRef(state) {
  const s = state || {};
  const refCounter = (s.refCounter || 0) + 1;
  // refIssued is the immutable claim (see the block comment on resequenceRefs
  // below) — it is set once, here, at creation, and never overwritten again.
  const ref = formatRef(refCounter);
  return { ref, refIssued: ref, refCounter };
}

function refNumber(ref) {
  const m = /^HUB-(\d+)$/.exec(ref || '');
  return m ? parseInt(m[1], 10) : 0;
}

// A ref, once issued, must never move to a different comment: these refs are
// printed into Excel logs that get uploaded to ACC, and a ref that later
// means something else is a traceability break in an already-distributed
// record. resequenceRefs only reassigns a ref on an actual COLLISION (two
// comments holding the same string), and the collision is won by whichever
// comment was created first — not by dateRaised, which is a business date
// the commenter picks and is routinely backdated (imported site feedback
// about an issue raised weeks ago) or postdated relative to when the record
// actually entered the ledger. Sorting collisions on dateRaised, as this used
// to, meant a comment Harvey typed today could lose its ref to an older-dated
// import purely because the import described an earlier event.
//
// createdAt is the real signal and wins whenever present. Comments written
// before this field existed don't have it, and there is live data in that
// shape already, so they need a deterministic fallback: updatedAt, which for
// a comment that has never been edited equals its creation time and is
// already relied on elsewhere in this file (mergeById) as the record's own
// recency signal — unlike dateRaised it is a system timestamp, not a
// business date, so it approximates creation order far better. dateRaised is
// kept as a further fallback only for the (currently theoretical) case of a
// comment missing both createdAt and updatedAt, and id is the final,
// always-unique tiebreak so ordering is total and fully deterministic: two
// clients merging the same records independently compute the same order,
// because every key in the chain lives on the record itself and never on
// which side of the merge it came from.
function refSortKey(c) {
  const r = c || {};
  return r.createdAt || r.updatedAt || r.dateRaised || '';
}

// refIssued is the ref a comment originally claimed, set once by nextRef and
// never rewritten afterwards (see below). Comments saved before this field
// existed have none — for those, live data in the field means the ref they
// already carry IS the claim, so treating it as such on first load is
// mandatory: nothing already issued may shift the moment this ships.
function claimOf(c) {
  const r = c || {};
  return r.refIssued || r.ref || '';
}

// THE BUG THIS REPLACES, AND WHY: resequenceRefs used to resolve a ref
// collision against the `ref` fields as they stood on the two states being
// merged right now. That is fine for exactly two clients, but mergeState
// chains pairwise for three or more (mergeState(mergeState(a, b), c)), and
// resequenceRefs reruns on EVERY call, including the intermediate a+b step —
// so a collision between a and c got "resolved" using whatever a had already
// agreed with b, before c was ever in the picture. Which two clients happened
// to sync first therefore changed the final ref-to-comment mapping. No
// timestamp tie was needed; three people numbering new comments from their
// own local counters is completely ordinary use.
//
// The fix: resequenceRefs must be a PURE FUNCTION OF THE WHOLE COMMENT SET,
// not of merge order. It resolves collisions against each comment's
// immutable refIssued claim (see claimOf above), never against the mutable,
// possibly-already-bumped `ref` some earlier partial merge assigned. Because
// every client that has ever seen a given comment computes claimOf() the
// same way from data that lives on the record itself, every client walking
// the same (deterministically ordered) comment set reaches the same output —
// regardless of which two clients merged first, or how many times this
// function has already run on the way there. Do not go back to resolving
// against `ref`: that reintroduces exactly this defect.
//
// Ordering rule for who keeps a claim on collision: earlier-issued (by
// refSortKey — creation order, see above) wins; a stable id tiebreak makes
// the order total, so two clients never disagree on who is "earlier".
//
// OUTPUT SHAPE IS CANONICAL, NOT PATH-DEPENDENT: refIssued is present on a
// comment if and only if its displayed `ref` currently differs from its
// claim — i.e. only while it is actively "owed" its original number back.
// A comment that currently holds its own claim (whether it never collided,
// or collided once somewhere upstream and has since reclaimed the number
// because whatever was squatting on it got merged away or renumbered) always
// comes out with refIssued OMITTED. Without this normalisation, two strictly
// identical merge outcomes reached via different intermediate merge paths
// could differ only in whether a settled winner happens to carry a leftover
// refIssued key from an earlier partial merge — same meaning, different
// object shape — which fails every equality check downstream (including
// idempotency: merge(a, a) must reproduce `a`'s exact shape, which never had
// the key at all for a comment that has never lost a collision).
//
// THE BUMP WATERMARK MUST NOT CARRY OVER FROM refCounter: an earlier version
// of this fix seeded `high` from state.refCounter, which is itself set to
// whatever `high` this same function last returned. A comment that keeps
// losing the SAME unresolved collision (e.g. c4 permanently outranked by c1
// for HUB-0001, every single time these two states meet) then got bumped to
// a NEW, higher number on every re-run — HUB-0006, then HUB-0009, then
// HUB-0012 — because the starting point kept climbing even though nothing
// about the underlying collision had changed. That broke idempotency
// (re-merging with an already-absorbed peer kept moving refs) and, at scale,
// meant two clients whose merge histories took a different number of hops to
// the same final record set could land on different bump numbers for the
// same loser. The watermark used to assign NEW numbers must depend only on
// the claims actually present in this exact comment set — never on how many
// times resequencing has already run over it.
export function resequenceRefs(state) {
  const s = state || {};
  // A comment record that is itself not a plain object (a stray null, a
  // string, ...) has no id and no ref to resequence — drop it rather than
  // let it crash the whole pass. The shared ledger can only ever be as
  // trustworthy as the least careful hand-edit that touched it.
  const rawComments = (Array.isArray(s.comments) ? s.comments : [])
    .filter(c => c && typeof c === 'object');
  const ordered = [...rawComments].sort((x, y) =>
    String(refSortKey(x)).localeCompare(String(refSortKey(y))) || String(x.id).localeCompare(String(y.id)));
  let high = 0;
  for (const c of ordered) high = Math.max(high, refNumber(claimOf(c)));
  const seen = new Set();
  const comments = ordered.map(c => {
    const claim = claimOf(c);
    let ref, refIssued;
    if (claim && !seen.has(claim)) {
      seen.add(claim);
      ref = claim;
      refIssued = undefined;   // reclaimed (or never lost) its own number — nothing to remember
    } else {
      high += 1;
      ref = formatRef(high);
      seen.add(ref);
      refIssued = claim;       // still owed its original number — must be remembered
    }
    const hadRefIssued = Object.prototype.hasOwnProperty.call(c, 'refIssued');
    if (c.ref === ref && hadRefIssued === (refIssued !== undefined) && c.refIssued === refIssued) return c; // already canonical, true no-op
    if (refIssued !== undefined) return { ...c, ref, refIssued };
    if (!hadRefIssued) return { ...c, ref };
    const { refIssued: _drop, ...rest } = c;   // strip a now-stale claim: this comment just reclaimed its number
    return { ...rest, ref };
  });
  // refCounter is a floor for nextRef's NEXT brand-new comment, not an input
  // to the bump watermark above — it must never shrink (a client's own
  // counter can be ahead of any ref currently visible here, e.g. after a
  // tombstoned comment), so the stored value is the max of what came in and
  // what this pass actually used, taken only now, after bump assignment.
  return { ...s, comments, refCounter: Math.max(s.refCounter || 0, high) };
}

function asArray(x) { return Array.isArray(x) ? x : []; }
function asObj(x) { return x && typeof x === 'object' ? x : {}; }

export function filterComments(comments, filters) {
  const f = asObj(filters);
  const q = String(f.search || '').trim().toLowerCase();
  return asArray(comments).filter(raw => {
    const c = asObj(raw);
    return (!f.productId || asArray(c.productIds).includes(f.productId)) &&
      (!f.status || c.status === f.status) &&
      (!f.affectedType || asArray(c.affectedTypes).includes(f.affectedType)) &&
      (!f.category || c.category === f.category) &&
      (!f.source || c.source === f.source) &&
      (!f.priority || c.priority === f.priority) &&
      (!f.hold || (f.hold === 'held') === !!c.hold) &&
      (!q || [c.ref, c.description, c.raisedBy, c.actionTaken].join(' ').toLowerCase().includes(q));
  });
}

export function commentCounts(comments) {
  const out = { open: 0, inProgress: 0, closed: 0, highOpen: 0 };
  for (const raw of asArray(comments)) {
    const c = asObj(raw);
    if (c.status === 'open') out.open += 1;
    else if (c.status === 'in_progress') out.inProgress += 1;
    else if (c.status === 'closed') out.closed += 1;
    if (c.priority === 'high' && c.status !== 'closed') out.highOpen += 1;
  }
  return out;
}

export function productCounts(comments) {
  const map = new Map();
  for (const raw of asArray(comments)) {
    const c = asObj(raw);
    for (const pid of asArray(c.productIds)) {
      if (!map.has(pid)) map.set(pid, { open: 0, inProgress: 0, closed: 0 });
      const b = map.get(pid);
      if (c.status === 'open') b.open += 1;
      else if (c.status === 'in_progress') b.inProgress += 1;
      else if (c.status === 'closed') b.closed += 1;
    }
  }
  return map;
}

export function daysOpen(comment, todayIso) {
  const c = asObj(comment);
  const end = c.status === 'closed' && c.dateClosed ? c.dateClosed : todayIso;
  const ms = new Date(end + 'T00:00:00Z') - new Date(c.dateRaised + 'T00:00:00Z');
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 86400000)) : 0;
}

export function latestRevisions(registerJson) {
  const out = new Map();
  const hist = (registerJson && registerJson.revHistory) || {};
  for (const [drawing, revs] of Object.entries(hist)) {
    let best = '';
    let bestAt = '';
    for (const [rev, info] of Object.entries(revs || {})) {
      if ((info && info.importedAt || '') >= bestAt) { bestAt = (info && info.importedAt) || ''; best = rev; }
    }
    if (best) out.set(drawing, best);
  }
  return out;
}

export const EXCEL_COLORS = {
  headerFill: 'FF1F4D38', headerText: 'FFFFFFFF', zebra: 'FFF2F5F0',
  open: 'FFF6E3B4', inProgress: 'FFDCE8F5', closed: 'FFDDEBD9', high: 'FFF5D6D0',
};

export const COMMENT_COLUMNS = [
  { key: 'ref', header: 'Ref', width: 10 },
  { key: 'dateRaised', header: 'Date raised', width: 12 },
  { key: 'raisedBy', header: 'Raised by', width: 16 },
  { key: 'source', header: 'Source', width: 16 },
  { key: 'affectedTypes', header: 'Affects', width: 18 },
  { key: 'category', header: 'Category', width: 18 },
  { key: 'priority', header: 'Priority', width: 10 },
  { key: 'description', header: 'Description', width: 60 },
  { key: 'pidRevision', header: 'Rev raised against', width: 14 },
  { key: 'status', header: 'Status', width: 12 },
  { key: 'dateClosed', header: 'Date closed', width: 12 },
  { key: 'actionTaken', header: 'Action taken', width: 40 },
  { key: 'closedBy', header: 'Closed by', width: 14 },
  { key: 'edited', header: 'Edited', width: 20 },
  { key: 'photos', header: 'Photos', width: 30 },
];

export function statusLabel(s) {
  return s === 'in_progress' ? 'In progress' : s === 'closed' ? 'Closed' : 'Open';
}

const WINDOWS_RESERVED_NAME = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

// Names here become real folders and files. Beyond the characters Windows
// bans outright, it also rejects trailing dots and spaces and a handful of
// reserved device names — each of which fails folder creation rather than
// merely looking odd.
export function sanitizeFilename(x) {
  let s = String(x).replace(/[\/\\:*?"<>|]/g, '-').replace(/[\x00-\x1f]/g, '');
  s = s.replace(/[. ]+$/, '').trim();
  if (!s) return 'Unnamed';
  return WINDOWS_RESERVED_NAME.test(s) ? s + '_' : s;
}

// Photos are stored as JPEG under Photos/<REF>/, named from the caption the
// user typed — "IMG_4471.JPG" tells nobody anything. Falls back to the original
// filename's base when the caption is blank, and suffixes duplicates rather
// than silently overwriting a colleague's photo.
export function photoFileName(caption, originalName, existingNames) {
  const base = String(caption || '').trim()
    || String(originalName || '').replace(/\.[^.]*$/, '').trim();
  const safe = sanitizeFilename(base);
  const taken = new Set(asArray(existingNames).map(n => String(n).toLowerCase()));
  let name = safe + '.jpg';
  let n = 2;
  while (taken.has(name.toLowerCase())) { name = `${safe} (${n}).jpg`; n += 1; }
  return name;
}

// Photos live on the comment record so they ride the existing merge, save queue
// and workbook regeneration. Removing one unlinks it; the files stay on disk.
export function addPhotoToComment(state, commentId, photo, nowIso) {
  const comments = asArray(state && state.comments);
  if (!comments.some(c => c && c.id === commentId)) return state;
  return { ...asObj(state), comments: comments.map(c => c && c.id === commentId
    ? { ...c, photos: [...asArray(c.photos), photo], updatedAt: nowIso } : c) };
}

export function removePhotoFromComment(state, commentId, photoId, nowIso) {
  const comments = asArray(state && state.comments);
  const c = comments.find(x => x && x.id === commentId);
  if (!c || !asArray(c.photos).some(p => p && p.id === photoId)) return state;
  return { ...asObj(state), comments: comments.map(x => x && x.id === commentId
    ? { ...x, photos: asArray(x.photos).filter(p => !p || p.id !== photoId), updatedAt: nowIso } : x) };
}

export function photosCell(comment) {
  const photos = asArray(comment && comment.photos);
  if (!photos.length) return '';
  const noun = photos.length === 1 ? 'photo' : 'photos';
  return `${photos.length} ${noun}: ${photos.map(p => (p && p.file) || '').join(', ')}`;
}

// Comment text (description, category, source) is often typed up by whoever
// is at the keyboard on behalf of a site team, not the person who actually
// raised or reworded it — the same reasoning stampEnteredBy in hub-sync.js
// applies to enteredBy. Unlike enteredBy, an edit stamp must survive on the
// record and travel to the distributed workbook (see editedCell below), so a
// silent reword by someone else is never invisible to the rest of the team.
export function stampEdit(comment, name, nowIso) {
  return { ...comment, editedBy: name || '', editedAt: nowIso || '' };
}

// Only the date, not the full timestamp, so the cell reads at a glance in a
// printed or emailed log: "Name (2026-07-31)". Empty for a comment that has
// never been edited, so the column stays quiet for the common case.
export function editedCell(comment) {
  if (!comment || !comment.editedBy || !comment.editedAt) return '';
  return `${comment.editedBy} (${String(comment.editedAt).slice(0, 10)})`;
}

function titleCase(s) { const t = String(s == null ? '' : s); return t.charAt(0).toUpperCase() + t.slice(1); }

function commentRow(raw, state) {
  const c = asObj(raw);
  const products = asArray(state && state.products);
  const names = asArray(c.productIds)
    .map(pid => { const p = products.find(x => x && x.id === pid); return p ? p.name : pid; });
  return {
    cells: {
      product: names.join(', '),
      ref: c.ref, dateRaised: c.dateRaised, raisedBy: c.raisedBy, source: c.source,
      affectedTypes: asArray(c.affectedTypes).join(', '), category: c.category,
      priority: titleCase(c.priority || ''), description: c.description,
      pidRevision: c.pidRevision || '', status: statusLabel(c.status),
      dateClosed: c.dateClosed || '', actionTaken: c.actionTaken || '', closedBy: c.closedBy || '',
      edited: editedCell(c), photos: photosCell(c),
    },
    statusKey: c.status, high: c.priority === 'high' && c.status !== 'closed',
  };
}

function sortForLog(comments) {
  return [...asArray(comments)].sort((a, b) => String((a && a.ref) || '').localeCompare(String((b && b.ref) || ''), undefined, { numeric: true }));
}

// revisions is a Map in real use (see latestRevisions); anything else is
// treated as empty rather than trusted, since a hostile/garbage value here
// must never crash a workbook build.
function asMap(x) { return x instanceof Map ? x : new Map(); }

export function buildProductWorkbookModel(state, productId, revisions, nowIso) {
  const s = asObj(state);
  const products = asArray(s.products);
  const revs = asMap(revisions);
  const p = asObj(products.find(x => x && x.id === productId));
  const comments = sortForLog(asArray(s.comments).filter(c => c && asArray(c.productIds).includes(productId)));
  const counts = commentCounts(comments);
  const pids = asArray(p.pidDrawings)
    .map(d => revs.has(d) ? `${d} (Rev ${revs.get(d)})` : d).join(', ');
  return {
    filename: `${sanitizeFilename(p.name || '')} Comments.xlsx`,
    sheets: [
      { name: 'Summary', kind: 'summary', meta: { title: p.name, generatedOn: nowIso }, rows: [
        ['Product', p.name], ['Type', p.type],
        ['P&ID drawings', pids || '—'],
        ['Model reference', p.modelRef || '—'], ['Sheet references', p.sheetRefs || '—'],
        ['Open comments', String(counts.open)], ['In progress', String(counts.inProgress)],
        ['Closed', String(counts.closed)], ['Generated on', nowIso],
      ] },
      { name: 'Comment Log', kind: 'log', columns: COMMENT_COLUMNS,
        rows: comments.map(c => commentRow(c, s)) },
    ],
  };
}

const MASTER_COLUMNS = [{ key: 'product', header: 'Product', width: 28 }, ...COMMENT_COLUMNS];

export function buildMasterWorkbookModel(state, revisions, nowIso) {
  const s = asObj(state);
  const comments = asArray(s.comments);
  const perProduct = productCounts(comments);
  const overview = asArray(s.products).map(raw => {
    const p = asObj(raw);
    const b = perProduct.get(p.id) || { open: 0, inProgress: 0, closed: 0 };
    return [p.name, `Open ${b.open} · In progress ${b.inProgress} · Closed ${b.closed}`];
  });
  return {
    filename: 'Master Log.xlsx',
    sheets: [
      { name: 'Overview', kind: 'summary', meta: { title: 'Comments Hub — Master Log', generatedOn: nowIso },
        rows: [['Generated on', nowIso], ...overview] },
      { name: 'Comment Log', kind: 'log', columns: MASTER_COLUMNS,
        rows: sortForLog(comments).map(c => commentRow(c, s)) },
    ],
  };
}

export function buildFilteredWorkbookModel(state, comments, nowIso) {
  const s = asObj(state);
  return {
    filename: `Comments Export ${nowIso}.xlsx`,
    sheets: [{ name: 'Comments', kind: 'log', columns: MASTER_COLUMNS,
      rows: sortForLog(comments).map(c => commentRow(c, s)) }],
  };
}

// ── Product families (defined in the P&ID tool; read-only here) ──
export function expandFamilyPatterns(patterns, drawingNames) {
  const matched = new Set();
  const names = asArray(drawingNames).filter(d => d != null).map(d => String(d));
  asArray(patterns).forEach(raw => {
    const pat = String(raw).trim().toUpperCase();
    if (!pat) return;
    const rangeMatch = pat.match(/^([A-Z]+)(\d+)-(?:[A-Z]+)?(\d+)$/);
    if (rangeMatch) {
      const prefix = rangeMatch[1];
      const from = parseInt(rangeMatch[2], 10);
      const to = parseInt(rangeMatch[3], 10);
      names.forEach(d => {
        const dm = d.toUpperCase().match(new RegExp('^' + prefix + '(\\d+)'));
        if (dm) {
          const n = parseInt(dm[1], 10);
          if (n >= from && n <= to) matched.add(d);
        }
      });
      return;
    }
    names.forEach(d => {
      if (d.toUpperCase().startsWith(pat) || d.toUpperCase().includes(pat)) matched.add(d);
    });
  });
  return matched;
}

export function familiesFromRegister(registerJson) {
  const r = asObj(registerJson);
  const drawings = Object.keys(asObj(r.revHistory));
  return asArray(r.families)
    .map(raw => { const f = asObj(raw); return { id: f.id, name: f.name, drawings: [...expandFamilyPatterns(f.patterns, drawings)] }; })
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

export function familyProductId(famId) { return 'fam-' + famId; }

// members/familyOf are always real Maps on the returned object; a hostile
// `membership` handed BACK into expandProductFilter/buildFamilyWorkbookModel/
// staleFamilyMemberFiles is guarded there too (asMembership below), since
// this value is read back from a caller's own state, not always freshly
// built here.
export function familyMembership(products, families) {
  const members = new Map();
  const familyOf = new Map();
  for (const raw of asArray(families)) {
    const fam = asObj(raw);
    const fpid = familyProductId(fam.id);
    const drawingSet = new Set(asArray(fam.drawings));
    const ids = asArray(products)
      .filter(p => p && !p.familyId && asArray(p.pidDrawings).some(d => drawingSet.has(d)))
      .map(p => p.id);
    members.set(fpid, ids);
    for (const id of ids) familyOf.set(id, fpid);
  }
  return { members, familyOf };
}

function asMembership(m) {
  const o = asObj(m);
  return { members: o.members instanceof Map ? o.members : new Map(), familyOf: o.familyOf instanceof Map ? o.familyOf : new Map() };
}

export function expandProductFilter(productId, membership) {
  const out = new Set([productId]);
  const m = asMembership(membership);
  if (m.members.has(productId)) for (const id of asArray(m.members.get(productId))) out.add(id);
  if (m.familyOf.has(productId)) out.add(m.familyOf.get(productId));
  return out;
}

export function excelSheetName(name, takenNames) {
  const cleaned = String(name).replace(/[[\]:*?/\\]/g, '-').slice(0, 31);
  const taken = new Set(asArray(takenNames));
  if (!taken.has(cleaned)) return cleaned;
  for (let n = 2; ; n++) {
    const suffix = ' (' + n + ')';
    const candidate = cleaned.slice(0, 31 - suffix.length) + suffix;
    if (!taken.has(candidate)) return candidate;
  }
}

export function buildFamilyWorkbookModel(state, familyPid, membership, revisions, nowIso) {
  const s = asObj(state);
  const products = asArray(s.products);
  const comments = asArray(s.comments);
  const revs = asMap(revisions);
  const m = asMembership(membership);
  const fam = asObj(products.find(p => p && p.id === familyPid));
  const memberIds = asArray(m.members.get(familyPid));
  const familyComments = sortForLog(comments.filter(c => c && asArray(c.productIds).includes(familyPid)));
  const allIds = [familyPid, ...memberIds];
  const rolled = commentCounts(comments.filter(c => c && asArray(c.productIds).some(id => allIds.includes(id))));
  const memberList = asArray(fam.pidDrawings)
    .map(d => revs.has(d) ? `${d} (Rev ${revs.get(d)})` : d).join(', ');
  const sheets = [
    { name: 'Summary', kind: 'summary', meta: { title: fam.name, generatedOn: nowIso }, rows: [
      ['Family', fam.name], ['Type', fam.type],
      ['Member drawings', memberList || '—'],
      ['Family-level comments', String(familyComments.length)],
      ['Open (family + drawings)', String(rolled.open)],
      ['In progress', String(rolled.inProgress)], ['Closed', String(rolled.closed)],
      ['Generated on', nowIso],
    ] },
    { name: 'Family Comments', kind: 'log', columns: COMMENT_COLUMNS,
      rows: familyComments.map(c => commentRow(c, s)) },
  ];
  const taken = sheets.map(sh => sh.name);
  for (const mid of memberIds) {
    const mp = products.find(p => p && p.id === mid);
    if (!mp) continue;
    const name = excelSheetName(mp.name, taken);
    taken.push(name);
    sheets.push({ name, kind: 'log', heading: mp.name, columns: COMMENT_COLUMNS,
      rows: sortForLog(comments.filter(c => c && asArray(c.productIds).includes(mid)))
        .map(c => commentRow(c, s)) });
  }
  return { filename: `${sanitizeFilename(fam.name || '')} Comments.xlsx`, sheets };
}

export function staleFamilyMemberFiles(state, membership) {
  const out = [];
  const s = asObj(state);
  const products = asArray(s.products);
  const m = asMembership(membership);
  for (const ids of m.members.values()) {
    for (const id of asArray(ids)) {
      const p = products.find(x => x && x.id === id);
      if (p) out.push(`${sanitizeFilename(p.name)} Comments.xlsx`);
    }
  }
  return out;
}
