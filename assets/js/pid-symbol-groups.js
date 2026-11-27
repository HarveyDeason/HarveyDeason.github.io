// assets/js/pid-symbol-groups.js
// Groups the shapes of one sheet for the report (PDF and screen): shapes matched to the same symbol with the same
// verdict and fault share one number, so "10 x BALL, standard" is one line, not ten. Pure; never throws.
//
// A group's key is verdict + fault + symbol name. A size fault joins the group of its first member when its percentage
// is within GROUP_PCT_TOL of that member's (so 75 and 76 are one group, and 75, 76, 77, 78 are two: measured from the
// first, never chained). Numbers: not-standard groups first, then standard; each largest first, ties by the first
// member in reading order. Shapes with no symbol (not identified, not judged, line marks) get no number.

export const GROUP_PCT_TOL = 2;   // points of percentage: a size fault this near the group's first member's joins it

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const str = v => (typeof v === 'string' ? v : '');
const obj = v => (v && typeof v === 'object' ? v : {});

// A shape's symbol: its body part, else its first part, else the symbol its reason names, else its closest.
function nameOf(s) {
  const parts = Array.isArray(s.parts) ? s.parts.filter(p => p && typeof p === 'object' && str(p.name)) : [];
  const body = parts.find(p => p.role === 'body') || parts[0];
  return str(body && body.name) || str(obj(s.reason).name) || str(obj(s.closest).name);
}

const readingOrder = (a, b) => (Math.round(a.box[1]) - Math.round(b.box[1])) || (a.box[0] - b.box[0]);

/**
 * Group a sheet's shapes. Returns { groups, noOf } where groups = [{ no, name, verdict: 'standard'|'not-standard',
 * kind: 'size'|'extra'|'differs'|'tag'|null, pct: number|null, count, members, example }] in number order (example: the
 * first member in reading order for a not-standard group, null for a standard one) and noOf(shape) is the shape's
 * group number, or null for a shape in no group. opts.nameOf(shape) may name a shape (else its parts, reason or closest name);
 * a result from before the verdicts carries only `standard`: true is standard, false not to standard.
 */
export function groupShapes(shapes, opts) {
  const none = { groups: [], noOf: () => null };
  try {
    const custom = opts && typeof opts.nameOf === 'function' ? opts.nameOf : null;
    const nameFor = s => { let n = ''; if (custom) { try { n = str(custom(s)); } catch { n = ''; } } return n || nameOf(s); };
    const verdictFor = s => (s.verdict === 'standard' || s.verdict === 'not-standard' ? s.verdict : s.verdict === undefined ? (s.standard === true ? 'standard' : s.standard === false ? 'not-standard' : null) : null);
    const list = (Array.isArray(shapes) ? shapes : []).filter(s => s && typeof s === 'object' && Array.isArray(s.box) && s.box.length === 4 && s.box.every(isNum)
      && verdictFor(s) && nameFor(s));
    list.sort(readingOrder);
    const groups = [], byKey = new Map();
    for (const s of list) {
      const name = nameFor(s), r = obj(s.reason), verdict = verdictFor(s);
      const kind = verdict === 'standard' ? null : (['size', 'extra', 'differs', 'tag'].includes(r.kind) ? r.kind : 'differs');
      const pct = kind === 'size' && isNum(r.pct) ? r.pct : null;
      const key = verdict + '|' + (kind || '') + '|' + name;
      const same = byKey.get(key) || [];
      let g = same.find(x => kind !== 'size' || pct === null || x.pct === null || Math.abs(x.pct - pct) <= GROUP_PCT_TOL);
      if (!g) { g = { no: 0, name, verdict, kind, pct, count: 0, members: [], example: verdict === 'standard' ? null : s }; groups.push(g); same.push(g); byKey.set(key, same); }
      g.members.push(s); g.count++;
    }
    const rank = g => (g.verdict === 'not-standard' ? 0 : 1);
    groups.sort((a, b) => (rank(a) - rank(b)) || (b.count - a.count) || readingOrder(a.members[0], b.members[0]));
    groups.forEach((g, i) => { g.no = i + 1; });
    const owner = new Map();
    for (const g of groups) for (const m of g.members) owner.set(m, g.no);
    return { groups, noOf: s => (owner.has(s) ? owner.get(s) : null) };
  } catch {
    return none;
  }
}
