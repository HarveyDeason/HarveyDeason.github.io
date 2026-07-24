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
  return merged;
}
