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

export function resequenceRefs(state) {
  const ordered = [...state.comments].sort((x, y) =>
    (x.dateRaised || '').localeCompare(y.dateRaised || '') || String(x.id).localeCompare(String(y.id)));
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
];

export function statusLabel(s) {
  return s === 'in_progress' ? 'In progress' : s === 'closed' ? 'Closed' : 'Open';
}

export function sanitizeFilename(x) {
  return String(x).replace(/[\/\\:*?"<>|]/g, '-');
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
