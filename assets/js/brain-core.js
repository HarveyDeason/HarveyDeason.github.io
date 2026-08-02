// assets/js/brain-core.js
// Pure logic for the Decision Register: state, merge, compressed text storage,
// extraction assembly, search documents, snippets, supersession. Node-testable.
import { mergeById, mergeList, mergeTombstones } from './hub-sync.js';
import { sanitizeFilename, photosCell } from './hub-core.js';
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
    history: [],
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
    // History is unioned by entry id, not filtered by tombstones: a deleted
    // decision's trail must survive the deletion, and history entry ids are
    // distinct from record ids so an empty tombstone map here is always safe
    // — it can never accidentally resurrect a tombstoned decision.
    history: mergeById(l.history || [], d.history || [], {}),
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
  if (['xlsx', 'xlsm', 'xlsb', 'xls', 'csv'].includes(ext)) return 'sheet';
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

// ── Search quality ──────────────────────────────────────────────────────────
// Pasting a sentence should find the document containing that sentence, not
// every document sharing one common word with it. Three parts do that work:
// stopword-stripped content terms, an AND gate, and phrase-aware snippets.

const STOPWORDS = new Set(['a','an','and','are','as','at','be','been','but','by','can','could','do','does',
  'for','from','had','has','have','how','if','in','into','is','it','its','may','might','must','no','not',
  'of','on','or','shall','should','so','such','than','that','the','their','then','there','these','this',
  'those','to','was','we','were','what','when','where','which','while','who','will','with','would','you','your']);

/** Query words worth searching on: lowercased, stopwords and single characters
 *  dropped. A query made entirely of stopwords keeps them — otherwise
 *  searching for "to" would search for nothing. */
export function contentTerms(query) {
  const all = String(query || '').toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean);
  const kept = all.filter(t => t.length > 1 && !STOPWORDS.has(t));
  return kept.length ? kept : all;
}

/** The query as a normalised phrase, or '' when it is too short to be one. */
export function phraseOf(query) {
  const norm = String(query || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return norm.split(' ').filter(Boolean).length >= 2 ? norm : '';
}

/** Index of `phrase` in `text`, tolerating whitespace and case differences and
 *  ignoring page/sheet markers. -1 when absent. */
export function findPhrase(text, phrase) {
  if (!phrase) return -1;
  const raw = String(text || '');
  const lower = raw.toLowerCase();
  // Normalise (markers dropped, whitespace collapsed) while recording where
  // each normalised character came from, so the hit maps back exactly. An
  // approximate map lands in the wrong page and mis-reports the citation.
  let norm = '';
  const origin = [];
  let i = 0, lastWasSpace = true;
  while (i < lower.length) {
    if (lower.startsWith('[[', i)) {
      const close = lower.indexOf(']]', i);
      if (close !== -1) { i = close + 2; continue; }
    }
    if (/\s/.test(lower[i])) {
      if (!lastWasSpace) { norm += ' '; origin.push(i); lastWasSpace = true; }
      i++;
      continue;
    }
    norm += lower[i]; origin.push(i); lastWasSpace = false;
    i++;
  }
  const needle = String(phrase).toLowerCase().replace(/\s+/g, ' ').trim();
  const idx = norm.indexOf(needle);
  return idx === -1 ? -1 : origin[idx];
}

/** True when every term appears in the text as a whole word. */
export function hasAllTerms(text, terms) {
  const hay = String(text || '').toLowerCase();
  return (terms || []).every(t => wordRegex(t).test(hay));
}

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function wordRegex(term, flags) {
  const t = escapeRe(String(term).toLowerCase());
  // \b is unreliable next to non-word characters, so anchor on non-alphanumerics.
  return new RegExp('(?<![a-z0-9])' + t + '(?![a-z0-9])', flags || '');
}

/** The most relevant passage: the exact phrase where present, otherwise the
 *  window containing the most distinct query terms. */
export function bestSnippetFor(text, terms, phrase, radius) {
  const t = String(text || '');
  const r = radius || 60;
  if (!t) return { snippet: '', marker: '', hit: -1 };

  let hit = findPhrase(t, phrase);
  if (hit === -1) {
    const lower = t.toLowerCase();
    let best = -1, bestScore = -1;
    for (const term of terms || []) {
      const re = wordRegex(term, 'g');
      let m;
      while ((m = re.exec(lower)) !== null) {
        const from = m.index - r, to = m.index + r;
        const window = lower.slice(Math.max(0, from), to);
        const score = (terms || []).filter(x => wordRegex(x).test(window)).length;
        if (score > bestScore) { bestScore = score; best = m.index; }
      }
    }
    hit = best;
  }
  if (hit === -1) return { snippet: t.replace(MARKER_RE, '').slice(0, r * 2), marker: '', hit: -1 };

  let marker = '';
  for (const m of t.slice(0, hit).matchAll(MARKER_RE)) marker = m[2] ? 'p.' + m[2] : 'sheet ' + m[3];
  const start = Math.max(0, hit - r);
  const end = Math.min(t.length, hit + r * 2);
  const snippet = (start > 0 ? '…' : '') + t.slice(start, end).replace(MARKER_RE, '') + (end < t.length ? '…' : '');
  return { snippet, marker, hit };
}

/** Character ranges to highlight: whole-word term matches, plus the phrase as
 *  one span when present. Overlapping ranges merge. */
export function highlightRanges(text, terms, phrase) {
  const t = String(text || '');
  const lower = t.toLowerCase();
  const ranges = [];
  if (phrase) {
    const re = new RegExp(escapeRe(phrase).replace(/\s+/g, '\\s+'), 'gi');
    let m;
    while ((m = re.exec(t)) !== null) ranges.push([m.index, m.index + m[0].length]);
  }
  for (const term of terms || []) {
    const re = wordRegex(term, 'g');
    let m;
    while ((m = re.exec(lower)) !== null) ranges.push([m.index, m.index + m[0].length]);
  }
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged = [];
  for (const [s, e] of ranges) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

// Photos hang off the decision record so they ride the existing merge and save
// queue. Removing one unlinks it; the files stay in the folder.
export function addPhotoToDecision(state, decisionId, photo, nowIso) {
  if (!state.decisions.some(d => d.id === decisionId)) return state;
  return { ...state, decisions: state.decisions.map(d => d.id === decisionId
    ? { ...d, photos: [...(d.photos || []), photo], updatedAt: nowIso } : d) };
}

export function removePhotoFromDecision(state, decisionId, photoId, nowIso) {
  const d = state.decisions.find(x => x.id === decisionId);
  if (!d || !(d.photos || []).some(p => p.id === photoId)) return state;
  return { ...state, decisions: state.decisions.map(x => x.id === decisionId
    ? { ...x, photos: x.photos.filter(p => p.id !== photoId), updatedAt: nowIso } : x) };
}

// Decision photos share one flat folder (decisions have no ref to name a folder
// with), so collision checks span every decision, not just the current one.
export function decisionPhotoNames(state) {
  const out = [];
  for (const d of (state && state.decisions) || []) {
    for (const p of d.photos || []) out.push(p.file);
  }
  return out;
}

export const DECISION_COLUMNS = [
  { key: 'date', header: 'Date', width: 12 },
  { key: 'title', header: 'Decision', width: 34 },
  { key: 'decision', header: 'What was decided', width: 60 },
  { key: 'reasoning', header: 'Why', width: 60 },
  { key: 'products', header: 'Product(s)', width: 28 },
  { key: 'projectTag', header: 'Project', width: 16 },
  { key: 'tags', header: 'Tags', width: 22 },
  { key: 'madeBy', header: 'Made by', width: 16 },
  { key: 'recordedBy', header: 'Recorded by', width: 16 },
  { key: 'status', header: 'Status', width: 12 },
  { key: 'supersedes', header: 'Supersedes', width: 28 },
  { key: 'photos', header: 'Photos', width: 30 },
];

// Products live in the Comments Hub's data, which brain-core does not read, so
// the caller passes the id→name map it already has. Unknown ids fall back to
// the id rather than vanishing from the export.
export function buildDecisionsWorkbookModel(state, decisions, nowIso, productNames) {
  const names = productNames || new Map();
  const titleOf = id => {
    const d = (state.decisions || []).find(x => x.id === id);
    return d ? (d.title || id) : id;
  };
  const rows = [...(decisions || [])]
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))
      || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .map(d => ({
      cells: {
        date: d.date || '',
        title: d.title || '',
        decision: d.decision || '',
        reasoning: d.reasoning || '',
        products: (d.productIds || []).map(id => names.get(id) || id).join(', '),
        projectTag: d.projectTag || '',
        tags: (d.tags || []).join(', '),
        madeBy: d.madeBy || '',
        recordedBy: d.recordedBy || '',
        status: (d.status === 'superseded') ? 'Superseded' : 'Active',
        supersedes: d.supersedes ? titleOf(d.supersedes) : '',
        photos: photosCell(d),      // same wording as the Comments Hub column
      },
      statusKey: d.status || 'active',
    }));
  return {
    filename: `Decisions Export ${nowIso}.xlsx`,
    sheets: [{ name: 'Decisions', kind: 'log', columns: DECISION_COLUMNS, rows }],
  };
}
