// assets/js/brain-core.js
// Pure logic for the Product Brain: state, merge, compressed text storage,
// extraction assembly, search documents, snippets, supersession. Node-testable.
import { mergeById, mergeList, mergeTombstones } from './hub-sync.js';

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
