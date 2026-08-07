// assets/js/pid-core.js
// Pure tag-extraction logic for the P&ID Tag Register: turning the text
// scraped out of a P&ID PDF into DS310 function tags. No DOM, no File System
// Access — everything here is node-testable.
//
// THE LOOKUP TABLES ARE NOT HERE, AND MUST NOT BE. assets/js/ is served
// publicly (that is why the tools themselves are encrypted), and the PAC/FC
// tables are Wessex Water DS310 reference data. They stay inside the tool and
// arrive as the `lookups` argument. Keep it that way.

function asObj(x) { return x && typeof x === 'object' ? x : {}; }
// String(x) throws on an object with no toString/valueOf (e.g.
// Object.create(null)), on one with a throwing toString/Symbol.toPrimitive,
// and so on. No exported function here may throw on any input, so any
// coercion failure degrades to '' rather than propagating.
function asStr(x) {
  if (typeof x === 'string') return x;
  if (x == null) return '';
  try { return String(x); } catch { return ''; }
}

// A single-digit process area code paired with one of these reads as a pipe
// LINE number rather than an asset tag, so it goes to review for a human to
// confirm. These are generic material abbreviations, not DS310 data.
export const PIPE_MATERIAL_CODES = [
  'FW', 'SW', 'SS', 'ST', 'CS', 'GI', 'PE', 'CU', 'PP',
  'HDPE', 'MDPE', 'PVC', 'ABS', 'CPVC', 'UPVC',
];

// DS310 function tag: process area code - function code - identification
// number, with an optional parallel-plant letter and sub-asset code.
const TAG_EXACT = /\b(\d{1,2})-([A-Z]{1,6})-(\d{3,5}[A-Z]{0,2})\b/g;
// Looser: accepts the separators PDF text extraction tends to mangle.
const TAG_FUZZY = /\b(\d{1,2})[_.\-]([A-Z]{1,8})[_.\-](\d{2,6}[A-Z]{0,3})\b/g;

// ── Archived PDFs ─────────────────────────────────────────────────────────
// The register keeps a copy of each imported drawing revision in archive/ as
// `<drawing>_<rev>.pdf`, so an old revision can still be viewed after the
// original file is long gone.

/**
 * Is this actually usable PDF data?
 *
 * The reason this exists rather than a plain truthiness check: **an empty
 * ArrayBuffer is truthy.** A 0-byte archived file therefore sailed past
 * `if (!data)` and reached pdf.js, which reported "The PDF file is empty"
 * as a render failure — so the user was told the PDF was broken rather than
 * that it needed re-importing. Found live on 2026-08-07.
 */
export function isUsablePdf(buf) {
  if (!buf) return false;
  // Check the TYPE, not just for a byteLength property: a plain object like
  // { byteLength: 10 } would otherwise pass and be handed to pdf.js.
  if (!(buf instanceof ArrayBuffer) && !ArrayBuffer.isView(buf)) return false;
  return buf.byteLength > 0;
}

/**
 * Choose which archived file to use for a drawing revision, given the names
 * present in archive/. Both arguments must already be filename-sanitised.
 *
 * Returns null rather than guessing. The previous behaviour was to return the
 * first file whose name merely STARTED WITH the drawing name, which meant a
 * missing C01 silently handed back C02's drawing labelled as C01 — and on a
 * P&ID, marking up against the wrong revision is exactly the kind of error
 * this register exists to prevent. It also matched 'SP66A_C01.pdf' when asked
 * for 'SP66'.
 *
 * A legacy unversioned `<drawing>.pdf` is still accepted: older archives wrote
 * that shape, and it is unambiguous — it is the only PDF for that drawing. An
 * exact revision match always wins over it.
 */
export function pickArchiveFile(names, drawingFile, revFile) {
  const list = Array.isArray(names) ? names : [];
  const d = typeof drawingFile === 'string' ? drawingFile : '';
  const r = typeof revFile === 'string' ? revFile : '';
  if (!d) return null;
  if (r) {
    const exact = d + '_' + r + '.pdf';
    if (list.includes(exact)) return exact;
  }
  const legacy = d + '.pdf';
  return list.includes(legacy) ? legacy : null;
}

export function resolveFC(fc, lookups) {
  // A property access on `lookups` (e.g. a throwing getter for `fc`) can
  // fail even though `lookups` itself is a plain-looking object, so the
  // whole lookup is wrapped rather than just the initial coercion.
  try {
    const l = asObj(lookups);
    return {
      cat: asObj(l.fc)[fc] || 'other',
      desc: asObj(l.fcDescriptions)[fc] || fc,
    };
  } catch {
    return { cat: 'other', desc: fc };
  }
}

// PDF text extraction breaks tags apart in predictable ways: en/em dashes for
// hyphens, and whitespace wherever the original had none. Repair those first,
// or the patterns below match nothing on a perfectly ordinary drawing.
export function normaliseTagText(text) {
  const clean = asStr(text)
    .replace(/[–—‒―]/g, '-')
    .replace(/--+/g, '-')
    .toUpperCase();
  return clean
    // function code and id separated by a space
    .replace(/(\d{1,2}-[A-Z]{1,6})\s+(\d{3,5}[A-Z]{0,2})(?=\s|$)/g, (_, fc, id) => `${fc}-${id}`)
    // a trailing parallel-plant letter split off from the tag
    .replace(/(\d{1,2}-[A-Z]{1,6}-\d{3,5})\s+([A-E])(?=\s|$)/g, (_, tag, suffix) => `${tag}${suffix}`)
    // spaces around either hyphen
    .replace(/(\d{1,2})\s*-\s*([A-Z]{1,6})\s*-\s*(\d{3,5}[A-Z]{0,2})/g, (_, a, b, c) => `${a}-${b}-${c}`);
}

// matchAll rather than a .exec loop over a shared global regex: matchAll works
// on an internal clone, so lastIndex never persists between calls. The old
// code reset lastIndex by hand before each loop, which worked but left the
// hazard one forgotten line away — and the symptom would have been the SECOND
// drawing of a session quietly losing tags.
export function extractTags(text, options) {
  const opts = asObj(options);
  const drawingName = opts.drawingName;
  const revision = opts.revision;
  const lookups = asObj(opts.lookups);

  const confirmed = [];
  const review = [];
  const seen = new Set();
  const clean = normaliseTagText(text);

  for (const m of clean.matchAll(TAG_EXACT)) {
    const tag = m[0];
    if (seen.has(tag)) continue;
    seen.add(tag);
    const pac = m[1], fc = m[2], id = m[3];
    const { cat, desc } = resolveFC(fc, lookups);
    const likelyLineNum = /^[1-9]$/.test(pac) && PIPE_MATERIAL_CODES.includes(fc);
    const row = { tag, pac, fc, id, desc, drawing: drawingName, revision,
      type: cat, isClash: false, isReview: likelyLineNum };
    (likelyLineNum ? review : confirmed).push(row);
  }

  for (const m of clean.matchAll(TAG_FUZZY)) {
    const norm = `${m[1]}-${m[2]}-${m[3]}`;
    if (seen.has(norm)) continue;
    // Unreachable today: TAG_FUZZY's middle capture group is [A-Z]{1,8},
    // letters only, so m[2] can never be all digits — this branch cannot
    // fire on any input the pattern above it can match. Kept because it
    // becomes live logic the moment that pattern is loosened to allow
    // digits in the middle group; verified unreachable during Task 1 review.
    if (/^\d+$/.test(m[2])) continue;
    seen.add(norm);
    const { cat, desc } = resolveFC(m[2], lookups);
    review.push({ tag: norm, pac: m[1], fc: m[2], id: m[3], desc,
      drawing: drawingName, revision, type: cat, isClash: false, isReview: true });
  }

  return { confirmed, review, likelyScanPDF: confirmed.length + review.length === 0 };
}
