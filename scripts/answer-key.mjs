// scripts/answer-key.mjs
// Phase 3's answer key: the owner's mark-ups on PDF copies of real sheets,
// read back and scored against the symbol check. Pure: no pdf.js import, no
// file access. The gate script loads the annotations and passes them in.
//
// NOTHING FROM A REAL DRAWING BELONGS HERE. Names come from the owner's
// library at run time; tests use invented ones.
//
// A mark-up is a rectangle comment whose text starts STANDARD or NOT
// STANDARD (also NOT-STANDARD, NON STANDARD, NON-STANDARD), optionally with
// ": <name>" or ": closest <name>". Anything the reader cannot use is listed
// in `unread` with its reason, never guessed and never thrown on.

import { normName, searchSymbols } from '../assets/js/pid-symbols.js';

const isNum = x => typeof x === 'number' && Number.isFinite(x);
const asArr = x => (Array.isArray(x) ? x : []);
const asObj = x => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
const str = x => (typeof x === 'string' ? x : '');
const list = x => (Array.isArray(x) || (ArrayBuffer.isView(x) && !(x instanceof DataView)) ? Array.from(x) : []);
const isMatrix = m => list(m).length >= 6 && list(m).slice(0, 6).every(isNum);

const FIRST = /^\s*(not[\s-]*standard|non[\s-]*standard|standard)\b\s*:?\s*(.*)$/is;

// The four corners of a rectangle through the viewport transform: its box in page points.
function pageBox(rect, vt) {
  const r = list(rect);
  if (r.length !== 4 || !r.every(isNum)) return null;
  const m = isMatrix(vt) ? list(vt) : [1, 0, 0, 1, 0, 0];
  const at = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const a = at(r[0], r[1]), b = at(r[2], r[3]);
  const box = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  return box.every(isNum) ? box : null;
}

// A polygon of four points (flat numbers or { x, y }) counts as a rectangle.
function fourPoints(v) {
  const a = list(v);
  if (a.length === 8 && a.every(isNum)) return true;
  return a.length === 4 && a.every(p => isNum(asObj(p).x) && isNum(asObj(p).y));
}

function matchName(name, library) {
  const symbols = asArr(asObj(library).symbols).filter(s => s && typeof s === 'object' && typeof s.name === 'string');
  const want = normName(name);
  const exact = symbols.find(s => normName(s.name) === want || asArr(s.aliases).some(a => normName(a) === want));
  if (exact) return exact;
  try {
    const hit = searchSymbols({ symbols }, name).find(r => r.kind === 'symbol');
    return hit ? hit.symbol : null;
  } catch { return null; }
}

/**
 * The owner's boxes: { boxes: [{ box, standard, name, family }], unread: [{ reason, text }] }.
 * annotations: pdf.js annotation data; viewportTransform: the page's viewport transform at scale 1.
 * family is the matched symbol's tag identifier. Never throws.
 */
export function readAnswerKey(annotations, viewportTransform, library) {
  const out = { boxes: [], unread: [] };
  for (const raw of asArr(annotations)) {
    try {
      const a = asObj(raw);
      const text = (str(asObj(a.contentsObj).str) || str(a.contents)).trim();
      const kind = str(a.subtype);
      const rectangle = kind === 'Square' || (kind === 'Polygon' && fourPoints(a.vertices));
      if (!rectangle) {
        if (text) out.unread.push({ reason: 'not a rectangle', text });
        continue;
      }
      const box = pageBox(a.rect, viewportTransform);
      if (!box) continue;
      if (!text) { out.unread.push({ reason: 'no text', text: '' }); continue; }
      const m = FIRST.exec(text);
      if (!m) { out.unread.push({ reason: 'first word', text }); continue; }
      const standard = !/^(not|non)/i.test(m[1]);
      const rest = m[2].replace(/^\s*closest\b\s*/i, '').trim();
      let name = null, family = null;
      if (rest) {
        const s = matchName(rest, library);
        if (s) { name = s.name; family = str(s.tagId) || null; } else out.unread.push({ reason: 'name', text });
      }
      out.boxes.push({ box, standard, name, family });
    } catch { /* a mark-up that cannot be read is left out */ }
  }
  return out;
}

const goodBox = b => list(b).length === 4 && list(b).every(isNum) && b[2] > b[0] && b[3] > b[1];
const area = b => (b[2] - b[0]) * (b[3] - b[1]);
// The intersection over the smaller box.
function overlapOf(a, b) {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min(area(a), area(b));
}
// A tool shape is flagged when it says it is not standard; a shapes file with no `standard` (Task 2) reads a named shape as standard.
const flagged = s => (typeof s.standard === 'boolean' ? !s.standard : s.standard === undefined && !s.name);

/**
 * Score the check against the key. Matching is one to one, greatest overlap
 * first; a pair needs overlap (intersection over the smaller box) of at least
 * `overlap`. Counts, and `lists` of each for --verbose. Never throws.
 */
export function scoreAgainstKey(key, shapes, symbols, { overlap = 0.5 } = {}) {
  const score = { keyStandard: 0, keyNot: 0, matched: 0, caught: 0, falseFlags: 0, missed: 0, notASymbolFlagged: 0,
    namedRight: 0, toolShapes: 0, unboxed: 0, unread: 0,
    lists: { caught: [], falseFlags: [], missed: [], notASymbolFlagged: [], unread: [] } };
  try {
    const k = asObj(key), boxes = asArr(k.boxes).filter(b => b && goodBox(b.box));
    const tool = asArr(shapes).filter(s => s && goodBox(s.box)), syms = asArr(symbols);
    score.unread = asArr(k.unread).length; score.lists.unread = asArr(k.unread).slice();
    score.toolShapes = tool.length;
    for (const b of boxes) { if (b.standard) score.keyStandard++; else score.keyNot++; }
    const pairs = [];
    boxes.forEach((b, i) => tool.forEach((s, j) => { const o = overlapOf(b.box, s.box); if (o >= overlap) pairs.push([o, i, j]); }));
    pairs.sort((p, q) => q[0] - p[0]);
    const kUsed = new Map(), tUsed = new Set();
    for (const [, i, j] of pairs) { if (kUsed.has(i) || tUsed.has(j)) continue; kUsed.set(i, j); tUsed.add(j); }
    score.matched = kUsed.size;
    // The tool's names and families for a shape: its listed symbols, or the name it carries.
    const named = s => {
      const idx = asArr(s.symbols).filter(n => Number.isInteger(n) && syms[n]);
      const names = idx.map(n => str(syms[n].name)), families = idx.map(n => str(syms[n].tagId)).filter(Boolean);
      if (typeof s.name === 'string' && s.name) names.push(s.name);
      return { names, families };
    };
    boxes.forEach((b, i) => {
      if (!kUsed.has(i)) { score.missed++; score.lists.missed.push({ box: b.box, standard: b.standard, name: b.name }); return; }
      const s = tool[kUsed.get(i)], f = flagged(s);
      if (!b.standard && f) { score.caught++; score.lists.caught.push({ box: b.box, tool: s.id }); }
      if (b.standard && f) { score.falseFlags++; score.lists.falseFlags.push({ box: b.box, name: b.name, tool: s.id, why: s.why || null }); }
      if (b.standard) {
        const t = named(s);
        if ((b.family && t.families.includes(b.family)) || (b.name && t.names.includes(b.name))) score.namedRight++;
      }
    });
    tool.forEach((s, j) => {
      if (tUsed.has(j)) return;
      score.unboxed++;
      if (flagged(s)) { score.notASymbolFlagged++; score.lists.notASymbolFlagged.push({ box: s.box, tool: s.id, why: s.why || null }); }
    });
  } catch { /* what was counted stands */ }
  return score;
}

/** The counts line the gate script prints. */
export function keyLine(s) {
  return `  key: standard ${s.keyStandard}, not standard ${s.keyNot}; caught ${s.caught} of ${s.keyNot}; false flags ${s.falseFlags} of ${s.keyStandard}; `
    + `missed ${s.missed}; flagged not-a-symbol ${s.notASymbolFlagged}; named right ${s.namedRight} of ${s.keyStandard}; unread ${s.unread}`;
}
