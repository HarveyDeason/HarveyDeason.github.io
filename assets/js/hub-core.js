// assets/js/hub-core.js
// Pure logic for the Comments Hub tool: state shape, shared-folder merge,
// ref sequencing, dashboard filtering, and Excel workbook models.
// No DOM, no File System Access API — everything here is node-testable.

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

function mergeById(a, b, tombstones) {
  const out = new Map();
  for (const rec of [...a, ...b]) {
    if (!rec || !rec.id) continue;
    const prev = out.get(rec.id);
    if (!prev || (rec.updatedAt || '') > (prev.updatedAt || '')) out.set(rec.id, rec);
  }
  return [...out.values()].filter(r => !(tombstones[r.id] && tombstones[r.id] >= (r.updatedAt || '')));
}

function mergeList(a, b) {
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

export function mergeState(local, disk) {
  const l = local || emptyState('');
  const d = disk || emptyState('');
  const tombstones = { ...l.tombstones };
  for (const [id, ts] of Object.entries(d.tombstones || {})) {
    if (!tombstones[id] || ts > tombstones[id]) tombstones[id] = ts;
  }
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
