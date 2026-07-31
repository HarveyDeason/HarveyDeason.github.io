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
  const refCounter = (state.refCounter || 0) + 1;
  return { ref: formatRef(refCounter), refCounter };
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
  return c.createdAt || c.updatedAt || c.dateRaised || '';
}

export function resequenceRefs(state) {
  const ordered = [...state.comments].sort((x, y) =>
    refSortKey(x).localeCompare(refSortKey(y)) || String(x.id).localeCompare(String(y.id)));
  let high = state.refCounter || 0;
  for (const c of ordered) high = Math.max(high, refNumber(c.ref));
  const seen = new Set();
  const comments = ordered.map(c => {
    if (c.ref && !seen.has(c.ref)) { seen.add(c.ref); return c; }
    high += 1;
    const ref = formatRef(high);
    seen.add(ref);
    return { ...c, ref };
  });
  return { ...state, comments, refCounter: high };
}

export function filterComments(comments, filters) {
  const f = filters || {};
  const q = (f.search || '').trim().toLowerCase();
  return comments.filter(c =>
    (!f.productId || (c.productIds || []).includes(f.productId)) &&
    (!f.status || c.status === f.status) &&
    (!f.affectedType || (c.affectedTypes || []).includes(f.affectedType)) &&
    (!f.category || c.category === f.category) &&
    (!f.source || c.source === f.source) &&
    (!f.priority || c.priority === f.priority) &&
    (!f.hold || (f.hold === 'held') === !!c.hold) &&
    (!q || [c.ref, c.description, c.raisedBy, c.actionTaken].join(' ').toLowerCase().includes(q)));
}

export function commentCounts(comments) {
  const out = { open: 0, inProgress: 0, closed: 0, highOpen: 0 };
  for (const c of comments) {
    if (c.status === 'open') out.open += 1;
    else if (c.status === 'in_progress') out.inProgress += 1;
    else if (c.status === 'closed') out.closed += 1;
    if (c.priority === 'high' && c.status !== 'closed') out.highOpen += 1;
  }
  return out;
}

export function productCounts(comments) {
  const map = new Map();
  for (const c of comments) {
    for (const pid of c.productIds || []) {
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
  const end = comment.status === 'closed' && comment.dateClosed ? comment.dateClosed : todayIso;
  const ms = new Date(end + 'T00:00:00Z') - new Date(comment.dateRaised + 'T00:00:00Z');
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
  const taken = new Set((existingNames || []).map(n => String(n).toLowerCase()));
  let name = safe + '.jpg';
  let n = 2;
  while (taken.has(name.toLowerCase())) { name = `${safe} (${n}).jpg`; n += 1; }
  return name;
}

// Photos live on the comment record so they ride the existing merge, save queue
// and workbook regeneration. Removing one unlinks it; the files stay on disk.
export function addPhotoToComment(state, commentId, photo, nowIso) {
  if (!state.comments.some(c => c.id === commentId)) return state;
  return { ...state, comments: state.comments.map(c => c.id === commentId
    ? { ...c, photos: [...(c.photos || []), photo], updatedAt: nowIso } : c) };
}

export function removePhotoFromComment(state, commentId, photoId, nowIso) {
  const c = state.comments.find(x => x.id === commentId);
  if (!c || !(c.photos || []).some(p => p.id === photoId)) return state;
  return { ...state, comments: state.comments.map(x => x.id === commentId
    ? { ...x, photos: x.photos.filter(p => p.id !== photoId), updatedAt: nowIso } : x) };
}

export function photosCell(comment) {
  const photos = (comment && comment.photos) || [];
  if (!photos.length) return '';
  const noun = photos.length === 1 ? 'photo' : 'photos';
  return `${photos.length} ${noun}: ${photos.map(p => p.file).join(', ')}`;
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

function titleCase(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function commentRow(c, state) {
  const names = (c.productIds || [])
    .map(pid => { const p = state.products.find(x => x.id === pid); return p ? p.name : pid; });
  return {
    cells: {
      product: names.join(', '),
      ref: c.ref, dateRaised: c.dateRaised, raisedBy: c.raisedBy, source: c.source,
      affectedTypes: (c.affectedTypes || []).join(', '), category: c.category,
      priority: titleCase(c.priority || ''), description: c.description,
      pidRevision: c.pidRevision || '', status: statusLabel(c.status),
      dateClosed: c.dateClosed || '', actionTaken: c.actionTaken || '', closedBy: c.closedBy || '',
      edited: editedCell(c), photos: photosCell(c),
    },
    statusKey: c.status, high: c.priority === 'high' && c.status !== 'closed',
  };
}

function sortForLog(comments) {
  return [...comments].sort((a, b) => (a.ref || '').localeCompare(b.ref || '', undefined, { numeric: true }));
}

export function buildProductWorkbookModel(state, productId, revisions, nowIso) {
  const p = state.products.find(x => x.id === productId);
  const comments = sortForLog(state.comments.filter(c => (c.productIds || []).includes(productId)));
  const counts = commentCounts(comments);
  const pids = (p.pidDrawings || [])
    .map(d => revisions.has(d) ? `${d} (Rev ${revisions.get(d)})` : d).join(', ');
  return {
    filename: `${sanitizeFilename(p.name)} Comments.xlsx`,
    sheets: [
      { name: 'Summary', kind: 'summary', meta: { title: p.name, generatedOn: nowIso }, rows: [
        ['Product', p.name], ['Type', p.type],
        ['P&ID drawings', pids || '—'],
        ['Model reference', p.modelRef || '—'], ['Sheet references', p.sheetRefs || '—'],
        ['Open comments', String(counts.open)], ['In progress', String(counts.inProgress)],
        ['Closed', String(counts.closed)], ['Generated on', nowIso],
      ] },
      { name: 'Comment Log', kind: 'log', columns: COMMENT_COLUMNS,
        rows: comments.map(c => commentRow(c, state)) },
    ],
  };
}

const MASTER_COLUMNS = [{ key: 'product', header: 'Product', width: 28 }, ...COMMENT_COLUMNS];

export function buildMasterWorkbookModel(state, revisions, nowIso) {
  const perProduct = productCounts(state.comments);
  const overview = state.products.map(p => {
    const b = perProduct.get(p.id) || { open: 0, inProgress: 0, closed: 0 };
    return [p.name, `Open ${b.open} · In progress ${b.inProgress} · Closed ${b.closed}`];
  });
  return {
    filename: 'Master Log.xlsx',
    sheets: [
      { name: 'Overview', kind: 'summary', meta: { title: 'Comments Hub — Master Log', generatedOn: nowIso },
        rows: [['Generated on', nowIso], ...overview] },
      { name: 'Comment Log', kind: 'log', columns: MASTER_COLUMNS,
        rows: sortForLog(state.comments).map(c => commentRow(c, state)) },
    ],
  };
}

export function buildFilteredWorkbookModel(state, comments, nowIso) {
  return {
    filename: `Comments Export ${nowIso}.xlsx`,
    sheets: [{ name: 'Comments', kind: 'log', columns: MASTER_COLUMNS,
      rows: sortForLog(comments).map(c => commentRow(c, state)) }],
  };
}

// ── Product families (defined in the P&ID tool; read-only here) ──
export function expandFamilyPatterns(patterns, drawingNames) {
  const matched = new Set();
  (patterns || []).forEach(raw => {
    const pat = String(raw).trim().toUpperCase();
    if (!pat) return;
    const rangeMatch = pat.match(/^([A-Z]+)(\d+)-(?:[A-Z]+)?(\d+)$/);
    if (rangeMatch) {
      const prefix = rangeMatch[1];
      const from = parseInt(rangeMatch[2], 10);
      const to = parseInt(rangeMatch[3], 10);
      drawingNames.forEach(d => {
        const dm = d.toUpperCase().match(new RegExp('^' + prefix + '(\\d+)'));
        if (dm) {
          const n = parseInt(dm[1], 10);
          if (n >= from && n <= to) matched.add(d);
        }
      });
      return;
    }
    drawingNames.forEach(d => {
      if (d.toUpperCase().startsWith(pat) || d.toUpperCase().includes(pat)) matched.add(d);
    });
  });
  return matched;
}

export function familiesFromRegister(registerJson) {
  const drawings = Object.keys((registerJson && registerJson.revHistory) || {});
  return ((registerJson && registerJson.families) || [])
    .map(f => ({ id: f.id, name: f.name, drawings: [...expandFamilyPatterns(f.patterns, drawings)] }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function familyProductId(famId) { return 'fam-' + famId; }

export function familyMembership(products, families) {
  const members = new Map();
  const familyOf = new Map();
  for (const fam of families || []) {
    const fpid = familyProductId(fam.id);
    const drawingSet = new Set(fam.drawings);
    const ids = (products || [])
      .filter(p => !p.familyId && (p.pidDrawings || []).some(d => drawingSet.has(d)))
      .map(p => p.id);
    members.set(fpid, ids);
    for (const id of ids) familyOf.set(id, fpid);
  }
  return { members, familyOf };
}

export function expandProductFilter(productId, membership) {
  const out = new Set([productId]);
  const m = membership || { members: new Map(), familyOf: new Map() };
  if (m.members.has(productId)) for (const id of m.members.get(productId)) out.add(id);
  if (m.familyOf.has(productId)) out.add(m.familyOf.get(productId));
  return out;
}

export function excelSheetName(name, takenNames) {
  const cleaned = String(name).replace(/[[\]:*?/\\]/g, '-').slice(0, 31);
  const taken = new Set(takenNames || []);
  if (!taken.has(cleaned)) return cleaned;
  for (let n = 2; ; n++) {
    const suffix = ' (' + n + ')';
    const candidate = cleaned.slice(0, 31 - suffix.length) + suffix;
    if (!taken.has(candidate)) return candidate;
  }
}

export function buildFamilyWorkbookModel(state, familyPid, membership, revisions, nowIso) {
  const fam = state.products.find(p => p.id === familyPid);
  const memberIds = (membership.members.get(familyPid)) || [];
  const familyComments = sortForLog(state.comments.filter(c => (c.productIds || []).includes(familyPid)));
  const allIds = [familyPid, ...memberIds];
  const rolled = commentCounts(state.comments.filter(c => (c.productIds || []).some(id => allIds.includes(id))));
  const memberList = (fam.pidDrawings || [])
    .map(d => revisions.has(d) ? `${d} (Rev ${revisions.get(d)})` : d).join(', ');
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
      rows: familyComments.map(c => commentRow(c, state)) },
  ];
  const taken = sheets.map(s => s.name);
  for (const mid of memberIds) {
    const mp = state.products.find(p => p.id === mid);
    if (!mp) continue;
    const name = excelSheetName(mp.name, taken);
    taken.push(name);
    sheets.push({ name, kind: 'log', heading: mp.name, columns: COMMENT_COLUMNS,
      rows: sortForLog(state.comments.filter(c => (c.productIds || []).includes(mid)))
        .map(c => commentRow(c, state)) });
  }
  return { filename: `${sanitizeFilename(fam.name)} Comments.xlsx`, sheets };
}

export function staleFamilyMemberFiles(state, membership) {
  const out = [];
  for (const ids of membership.members.values()) {
    for (const id of ids) {
      const p = state.products.find(x => x.id === id);
      if (p) out.push(`${sanitizeFilename(p.name)} Comments.xlsx`);
    }
  }
  return out;
}
