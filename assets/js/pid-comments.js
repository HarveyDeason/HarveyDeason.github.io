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

  // hub-data.json is the ONLY unambiguous marker of a hub root, so it is
  // checked first. A register.json sitting in the root proves nothing: one
  // gets left behind whenever the P&ID tool is pointed at the hub folder and,
  // in legacy mode, treats it as its own register folder. Testing "register
  // here" first let that leftover win, so the tool read a small stale file
  // instead of the real register in the subfolder and reported itself legacy.
  if (f.hasHubDataHere) {
    // A subfolder register is the real one — the documented layout, and the
    // file that actually holds the tags.
    if (subfolders.length) {
      return { mode: 'hub-root', registerSubfolder: subfolders[0] };
    }
    // No subfolder, but a register right here: a legitimate combined layout
    // where one folder serves every tool. Use it rather than creating a
    // second register alongside the existing one.
    if (f.hasRegisterHere) {
      return { mode: 'hub-root', registerSubfolder: null };
    }
    // A hub root whose register subfolder does not exist yet. Named, not
    // created — only a real save may bring it into existence, so connecting
    // never writes a stray register.json into the root.
    return { mode: 'hub-root', registerSubfolder: CONVENTIONAL_REGISTER_SUBFOLDER };
  }

  // No hub-data.json below here, so this is not a hub root.
  if (f.hasRegisterHere) {
    return { mode: 'legacy', registerSubfolder: null };
  }

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

// ── The drawing -> product -> comment join (Task 3, factored for Task 7) ──
//
// The join: a hub product carries pidDrawings[]; a hub comment carries
// productIds[]. A drawing's comments are the comments of every product that
// lists that drawing. hubData is read read-only from hub-data.json, written
// by the Comments Hub, not this tool — treat every shape as untrusted:
// missing fields, non-array collections, dangling productIds (a tombstoned
// or otherwise-missing product) must all degrade to "no comments", never
// throw.
//
// `includeStatus(status)` decides, per comment, whether it participates at
// all — checked BEFORE the drawing dedup below, exactly as the original
// single-purpose commentCountsByDrawing did, so a comment excluded by status
// never causes an empty-but-present Map entry for a drawing it would
// otherwise touch.
//
// Returns Map<drawingName, comment[]> — the raw comment objects (not
// copies), each appearing once per drawing even when the comment names
// several products that share it: collected into a Set keyed by drawing
// name before anything is pushed, so the dedup happens per comment, not per
// product.
function commentsByDrawing(hubData, includeStatus) {
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
    if (!includeStatus(c.status)) continue;

    const drawings = new Set();
    for (const pid of (Array.isArray(c.productIds) ? c.productIds : [])) {
      const p = productById.get(pid);
      if (!p) continue; // tombstoned or otherwise-missing product: ignore, don't throw
      for (const d of (Array.isArray(p.pidDrawings) ? p.pidDrawings : [])) {
        if (d) drawings.add(d);
      }
    }

    for (const d of drawings) {
      if (!out.has(d)) out.set(d, []);
      out.get(d).push(c);
    }
  }

  return out;
}

// ── Comment counts per drawing (Task 3) ─────────────────────────────────
export function commentCountsByDrawing(hubData) {
  const grouped = commentsByDrawing(hubData, s => s === 'open' || s === 'in_progress' || s === 'closed');
  const out = new Map();
  for (const [d, list] of grouped) {
    const bucket = { open: 0, inProgress: 0, closed: 0 };
    for (const c of list) {
      if (c.status === 'open') bucket.open += 1;
      else if (c.status === 'in_progress') bucket.inProgress += 1;
      else bucket.closed += 1;
    }
    out.set(d, bucket);
  }
  return out;
}

// ── Open comments per drawing, triage-ordered (Task 7) ───────────────────
//
// Same join as commentCountsByDrawing, restricted to status === 'open', but
// returning the comment records themselves rather than counts, so the P&ID
// tool's panel can list them. Each drawing's list is sorted high priority
// first, then oldest raised first — the order someone triaging a drawing
// actually wants. dateRaised is a plain "YYYY-MM-DD" business date, so
// string comparison sorts it correctly; a missing/malformed date sorts
// first (empty string is the lowest ISO-date string) rather than throwing,
// and id is a final deterministic tiebreak.
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

function priorityRank(p) {
  return Object.prototype.hasOwnProperty.call(PRIORITY_RANK, p) ? PRIORITY_RANK[p] : 3;
}

function compareForTriage(a, b) {
  const byPriority = priorityRank(a.priority) - priorityRank(b.priority);
  if (byPriority !== 0) return byPriority;
  const da = typeof a.dateRaised === 'string' ? a.dateRaised : '';
  const db = typeof b.dateRaised === 'string' ? b.dateRaised : '';
  if (da !== db) return da < db ? -1 : 1;
  return String(a.id || '').localeCompare(String(b.id || ''));
}

export function openCommentsByDrawing(hubData) {
  const grouped = commentsByDrawing(hubData, s => s === 'open');
  const out = new Map();
  for (const [d, list] of grouped) {
    out.set(d, list.slice().sort(compareForTriage));
  }
  return out;
}

// ── drawingNameFromFile (Task 5) ─────────────────────────────────────────
//
// 2026-08-03 incident: import derives the drawing name straight from the
// filename. Archived PDFs are named `<drawing>_<rev>.pdf` (see archivePDF /
// the fname built at save time), so re-importing from `archive/` — the
// obvious move during recovery — turned every drawing name into
// `<drawing>_<rev>`, and the tool then appended the revision AGAIN on the
// next archive write. It corrupted names at exactly the moment the user was
// already in trouble.
//
// The revision shapes actually accepted by this tool (see detectRevision
// and the rev-modal placeholder/help text in tools-src/pid-tag-register.html)
// are short: 1-3 letters optionally followed by 1-2 digits — A, B, C, C01,
// C02, P01, P1, IFD, IFC. That is deliberately narrow. A longer or
// digit-less trailing chunk (e.g. "HOUSE" in "PUMP_HOUSE") is real drawing
// name, not a revision, and must never be stripped.
const REVISION_SUFFIX_RE = /^[A-Z]{1,3}\d{0,2}$/;

export function drawingNameFromFile(fileName, revisions) {
  let name = String(fileName == null ? '' : fileName)
    .replace(/\.pdf$/i, '')
    .replace(/\s*\(\d+\)$/, '');

  const knownRevisions = new Set(
    (Array.isArray(revisions) ? revisions : [])
      .filter(Boolean)
      .map(function (r) { return String(r).toUpperCase(); })
  );

  const underscoreIdx = name.lastIndexOf('_');
  if (underscoreIdx > 0 && underscoreIdx < name.length - 1) {
    const suffix = name.slice(underscoreIdx + 1);
    const upperSuffix = suffix.toUpperCase();
    if (REVISION_SUFFIX_RE.test(upperSuffix) || knownRevisions.has(upperSuffix)) {
      return { name: name.slice(0, underscoreIdx), revisionFromName: upperSuffix };
    }
  }

  return { name: name, revisionFromName: null };
}

// ── isDestructiveSave (Task 6) ───────────────────────────────────────────
//
// Tasks 1-5 fix the failures already found. This one is a backstop for the
// ones nobody has found yet: every version of the 2026-08-03 incident had
// the same shape — memory held far less than disk, and the save went ahead
// silently. Guarding that shape, rather than any specific bug, is what
// protects the register from the NEXT unknown defect.
//
// Threshold kept as a named constant so it can be tuned without hunting
// through call sites. 0.5 means "a save that would remove more than half of
// what's on disk needs a human to confirm it" — loose enough that normal
// pruning/editing never trips it, tight enough to catch every shape the
// incident actually took (142->0, 142->1, ...).
const DESTRUCTIVE_LOSS_FRACTION = 0.5;

export function isDestructiveSave(diskCount, memoryCount) {
  // Fail safe: if either count cannot be trusted as a real, non-negative
  // number, we cannot evaluate whether the save is safe — so treat it as
  // destructive and let the caller block/confirm. A safety check that
  // cannot run must never be treated as a pass; that was the entire failure
  // mode of readRegisterJSON before this plan (Task 1) — "can't tell" quietly
  // became "must be fine".
  if (!isNonNegativeFiniteNumber(diskCount) || !isNonNegativeFiniteNumber(memoryCount)) {
    return true;
  }

  // Nothing on disk yet: any memory content is a first save, never
  // destructive, however small or large.
  if (diskCount === 0) return false;

  // Never shrinking, or growing: not destructive.
  if (memoryCount >= diskCount) return false;

  const remainingFraction = memoryCount / diskCount;
  return remainingFraction <= (1 - DESTRUCTIVE_LOSS_FRACTION);
}

function isNonNegativeFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}
