// assets/js/pid-families.js
// Which drawings belong to which family (the Sheets list, the family cards, the clash check). Pure: no DOM; holds no data.
//
// A family is a name and a list of patterns:
//   "SP50-SP60"  a range: the drawing starts with the letters, then a number from 50 to 60
//   anything else  matches a drawing whose name contains it, in any case
// This is the page's original rule, exactly, made fast: names are upper-cased once, each range's regular expression is built once,
// and a whole pass (every family, every drawing) is worked out once as an index, not again for each drawing asked about.

const RANGE = /^([A-Z]+)(\d+)-(?:[A-Z]+)?(\d+)$/;
const arr = x => (Array.isArray(x) ? x : []);
const text = x => (typeof x === 'string' ? x : '');

function prepare(names) {
  const list = arr(names).filter(n => typeof n === 'string');
  return { list, upper: list.map(n => n.toUpperCase()) };
}

function expand(patterns, prepared) {
  const matched = new Set();
  const { list, upper } = prepared;
  const ranges = new Map();   // prefix -> its regular expression, built once
  for (const raw of arr(patterns)) {
    const pat = text(raw).trim().toUpperCase();
    if (!pat) continue;
    const r = RANGE.exec(pat);
    if (r) {
      const from = parseInt(r[2]), to = parseInt(r[3]);
      let re = ranges.get(r[1]);
      if (!re) { re = new RegExp('^' + r[1] + '(\\d+)'); ranges.set(r[1], re); }
      for (let i = 0; i < upper.length; i++) {
        const m = re.exec(upper[i]);
        if (m) { const n = parseInt(m[1]); if (n >= from && n <= to) matched.add(list[i]); }
      }
      continue;
    }
    for (let i = 0; i < upper.length; i++) if (upper[i].includes(pat)) matched.add(list[i]);
  }
  return matched;
}

/** The drawing names a list of patterns matches, as a Set. */
export function expandPatterns(patterns, names) {
  try { return expand(patterns, prepare(names)); } catch { return new Set(); }
}

/**
 * One pass over every family: { members: Map(familyId -> Set of every drawing it matches), owner: Map(drawing -> familyId of the first
 * family that claims it) }. A drawing no family matches has no owner.
 */
export function familyIndex(families, names) {
  const members = new Map(), owner = new Map();
  try {
    const prepared = prepare(names);
    for (const fam of arr(families)) {
      if (!fam || typeof fam !== 'object') continue;
      const set = expand(fam.patterns, prepared);
      members.set(fam.id, set);
      for (const d of set) if (!owner.has(d)) owner.set(d, fam.id);
    }
  } catch { /* what was worked out stands */ }
  return { members, owner };
}
