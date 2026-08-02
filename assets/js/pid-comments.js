// assets/js/pid-comments.js
// Pure logic for the P&ID Tag Register's link to the shared hub: which mode
// applies to a newly-connected folder. No DOM, no File System Access API —
// everything here is node-testable, per the plan at
// docs/superpowers/plans/2026-08-02-pid-comment-link.md.

// The subfolder name used when a hub root is connected for the first time
// and no register subfolder exists yet. The caller creates it lazily, only
// on the user's first save — never on connect (see resolveConnectMode doc).
export const CONVENTIONAL_REGISTER_SUBFOLDER = 'P&ID Register';

// ── Mode detection (Task 2) ─────────────────────────────────────────────
//
// Detection order, and it matters (see the plan's "THE RISK" section):
//
//   1. register.json directly in the connected folder -> legacy mode. An
//      existing register folder always wins, so nobody's current setup
//      changes behaviour.
//   2. hub-data.json directly in the connected folder -> this IS the hub
//      root. Find the subfolder holding register.json; if none exists yet,
//      resolve to the conventional "P&ID Register" name (the caller creates
//      it only when the user first saves). This case exists specifically to
//      stop a hub root whose register subfolder is still empty from falling
//      through to case 4 and writing a second, stray register.json into the
//      root.
//   3. A subfolder of the connected folder contains register.json -> hub
//      root; registerDir is that subfolder.
//   4. Otherwise (a fresh, empty folder) -> legacy mode, exactly as today.
//
// `facts` is plain data the caller (the HTML, which does the real file
// probing) hands in — never a directory handle:
//   hasRegisterHere     - boolean: register.json sits directly in the
//                          connected folder
//   hasHubDataHere      - boolean: hub-data.json sits directly in the
//                          connected folder
//   registerSubfolders  - array of subfolder names (direct children of the
//                          connected folder) that themselves directly
//                          contain a register.json
//
// Returns { mode: 'legacy' | 'hub-root', registerSubfolder: string | null }.
// In 'legacy' mode registerSubfolder is always null (registerDir = the
// connected folder itself). In 'hub-root' mode registerSubfolder names the
// child folder to use as registerDir, creating it lazily if it doesn't
// exist on disk yet.
//
// Ambiguous case (more than one subfolder holds a register.json, with or
// without hub-data.json present): there is no correct answer, only a
// deterministic one, so the lexicographically first subfolder name wins —
// same result on every machine, every run.
export function resolveConnectMode(facts) {
  const f = facts || {};
  const subfolders = (Array.isArray(f.registerSubfolders) ? f.registerSubfolders.slice() : [])
    .filter(Boolean)
    .sort();

  // Case 1: an existing register folder always wins.
  if (f.hasRegisterHere) {
    return { mode: 'legacy', registerSubfolder: null };
  }

  // Case 2: hub-data.json is the reliable marker that this folder is the
  // hub root, even when its register subfolder is still empty.
  if (f.hasHubDataHere) {
    return { mode: 'hub-root', registerSubfolder: subfolders[0] || CONVENTIONAL_REGISTER_SUBFOLDER };
  }

  // Case 3: no hub-data.json, but a subfolder already holds a register.
  if (subfolders.length) {
    return { mode: 'hub-root', registerSubfolder: subfolders[0] };
  }

  // Case 4: nothing recognisable here — fresh, empty folder.
  return { mode: 'legacy', registerSubfolder: null };
}

// A short, user-facing label for the folder chip, so a user connecting a
// folder can tell whether comment badges are available and why not.
export function connectModeLabel(mode) {
  return mode === 'hub-root' ? 'linked to hub' : 'legacy (no hub link)';
}

// ── Comment counts per drawing (Task 3) ─────────────────────────────────
//
// The join: a hub product carries pidDrawings[]; a hub comment carries
// productIds[]. A drawing's comments are the comments of every product that
// lists that drawing. hubData is read read-only from hub-data.json, written
// by the Comments Hub, not this tool — treat every shape as untrusted:
// missing fields, non-array collections, dangling productIds (a tombstoned
// or otherwise-missing product) must all degrade to "no count", never throw.
export function commentCountsByDrawing(hubData) {
  const out = new Map();
  const products = Array.isArray(hubData && hubData.products) ? hubData.products : [];
  const comments = Array.isArray(hubData && hubData.comments) ? hubData.comments : [];
  if (!products.length || !comments.length) return out;

  const productById = new Map();
  for (const p of products) {
    if (p && p.id) productById.set(p.id, p);
  }

  for (const c of comments) {
    if (!c || typeof c !== 'object') continue;
    const status = c.status;
    if (status !== 'open' && status !== 'in_progress' && status !== 'closed') continue;

    // A comment naming several products, two of which share a drawing, must
    // count once for that drawing — collect into a Set keyed by drawing
    // name before touching any counters, so the dedup happens per comment,
    // not per product.
    const drawings = new Set();
    for (const pid of (Array.isArray(c.productIds) ? c.productIds : [])) {
      const p = productById.get(pid);
      if (!p) continue; // tombstoned or otherwise-missing product: ignore, don't throw
      for (const d of (Array.isArray(p.pidDrawings) ? p.pidDrawings : [])) {
        if (d) drawings.add(d);
      }
    }

    for (const d of drawings) {
      if (!out.has(d)) out.set(d, { open: 0, inProgress: 0, closed: 0 });
      const bucket = out.get(d);
      if (status === 'open') bucket.open += 1;
      else if (status === 'in_progress') bucket.inProgress += 1;
      else bucket.closed += 1;
    }
  }

  return out;
}
