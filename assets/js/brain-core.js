// assets/js/brain-core.js
// Pure logic for the Product Brain: state, merge, compressed text storage,
// extraction assembly, search documents, snippets, supersession. Node-testable.
import { mergeById, mergeList, mergeTombstones } from './hub-sync.js';
import { sanitizeFilename } from './hub-core.js';
export { sanitizeFilename };

export const BRAIN_VERSION = 1;
export const DEFAULT_DOC_TYPES = ['HAZOP', 'Meeting minutes', 'Datasheet', 'Report', 'Drawing', 'Other'];

export function emptyBrainState(nowIso) {
  return {
    version: BRAIN_VERSION,
    savedAt: nowIso || '',
    decisions: [],
    documents: [],
    lists: { tags: [], projects: [], docTypes: DEFAULT_DOC_TYPES.slice() },
    tombstones: {},
  };
}

export function mergeBrainState(local, disk) {
  const l = local || emptyBrainState('');
  const d = disk || emptyBrainState('');
  const tombstones = mergeTombstones(l.tombstones, d.tombstones);
  return {
    version: BRAIN_VERSION,
    savedAt: (l.savedAt || '') > (d.savedAt || '') ? l.savedAt : d.savedAt,
    decisions: mergeById(l.decisions, d.decisions, tombstones),
    documents: mergeById(l.documents, d.documents, tombstones),
    lists: {
      tags: mergeList(l.lists?.tags, d.lists?.tags),
      projects: mergeList(l.lists?.projects, d.lists?.projects),
      docTypes: mergeList(l.lists?.docTypes, d.lists?.docTypes),
    },
    tombstones,
  };
}

async function streamToB64(stream) {
  const buf = await new Response(stream).arrayBuffer();
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function gzipText(text) {
  const cs = new CompressionStream('gzip');
  return streamToB64(new Blob([text]).stream().pipeThrough(cs));
}

export async function gunzipText(b64) {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  const ds = new DecompressionStream('gzip');
  return new Response(new Blob([bytes]).stream().pipeThrough(ds)).text();
}

export function pdfPagesToText(pages) {
  return (pages || []).map((items, i) => '[[p' + (i + 1) + ']] ' + items.join(' ')).join('\n');
}

export function sheetTextFromRows(sheets) {
  return (sheets || []).map(s =>
    '[[sheet:' + s.name + ']] ' + s.rows.map(r => r.join(' ')).join('\n')).join('\n');
}

export function normalizeExtractedText(s) {
  return String(s || '').split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

export function extractionMethodFor(filename) {
  const ext = (/\.([a-z0-9]+)$/i.exec(filename || '') || [])[1]?.toLowerCase() || '';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'docx') return 'docx';
  if (['xlsx', 'xls', 'csv'].includes(ext)) return 'sheet';
  return 'none';
}

export function dedupeFilename(existingNames, name) {
  const taken = new Set(existingNames);
  if (!taken.has(name)) return name;
  const m = /^(.*?)(\.[^.]*)?$/.exec(name);
  const base = m[1], ext = m[2] || '';
  for (let n = 2; ; n++) {
    const candidate = base + ' (' + n + ')' + ext;
    if (!taken.has(candidate)) return candidate;
  }
}

export function docFolderPath(productName, docType) {
  if (!productName) return ['Documents', '_General'];
  return ['Documents', sanitizeFilename(productName), sanitizeFilename(docType || 'Other')];
}

export function buildSearchDocs(brain, hubComments, textById) {
  const docs = [];
  for (const d of brain.decisions) {
    docs.push({ id: 'd:' + d.id, kind: 'decision', title: d.title,
      text: (d.decision || '') + '\n' + (d.reasoning || ''), tags: (d.tags || []).join(' '),
      productIds: d.productIds || [], projectTag: d.projectTag || '', date: d.date || '',
      who: d.madeBy || '', status: d.status || 'active' });
  }
  for (const f of brain.documents) {
    docs.push({ id: 'f:' + f.id, kind: 'document', title: f.title,
      text: (textById && textById.get(f.id)) || '', tags: (f.tags || []).join(' '),
      productIds: f.productIds || [], projectTag: f.projectTag || '', date: f.date || '',
      who: '', status: 'active' });
  }
  for (const c of hubComments || []) {
    docs.push({ id: 'c:' + c.id, kind: 'comment', title: (c.ref || '') + ' ' + (c.category || ''),
      text: (c.description || '') + '\n' + (c.actionTaken || ''), tags: '',
      productIds: c.productIds || [], projectTag: '', date: c.dateRaised || '',
      who: c.raisedBy || '', status: 'active' });
  }
  return docs;
}

const MARKER_RE = /\[\[(p(\d+)|sheet:([^\]]+))\]\]\s?/g;

export function snippetFor(text, terms, radius = 60) {
  const t = String(text || '');
  const lower = t.toLowerCase();
  let hit = -1;
  for (const term of terms || []) {
    const i = lower.indexOf(String(term).toLowerCase());
    if (i !== -1 && (hit === -1 || i < hit)) hit = i;
  }
  if (hit === -1) return { snippet: t.replace(MARKER_RE, '').slice(0, radius * 2), marker: '' };
  let marker = '';
  for (const m of t.slice(0, hit).matchAll(MARKER_RE)) {
    marker = m[2] ? 'p.' + m[2] : 'sheet ' + m[3];
  }
  const start = Math.max(0, hit - radius);
  const end = Math.min(t.length, hit + radius);
  const snippet = (start > 0 ? '…' : '') + t.slice(start, end).replace(MARKER_RE, '') + (end < t.length ? '…' : '');
  return { snippet, marker };
}

export function supersedeDecision(state, oldId, newDecision, nowIso) {
  const oldD = state.decisions.find(d => d.id === oldId);
  if (!oldD) throw new Error('supersedeDecision: unknown decision ' + oldId);
  const decisions = state.decisions
    .map(d => d.id === oldId ? { ...d, status: 'superseded', supersededBy: newDecision.id, updatedAt: nowIso } : d)
    .concat([{ ...newDecision, supersedes: oldId, updatedAt: nowIso }]);
  return { ...state, decisions };
}

export function decisionFromComment(comment, nowIso) {
  return {
    title: '', decision: '', reasoning: comment.description || '',
    madeBy: '', recordedBy: '', date: (nowIso || '').slice(0, 10),
    productIds: [...(comment.productIds || [])], projectTag: '', tags: [],
    status: 'active', supersededBy: '', supersedes: '',
    links: { documents: [], comments: [comment.id], urls: [] },
  };
}
