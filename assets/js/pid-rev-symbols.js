// assets/js/pid-rev-symbols.js
// Rev compare, symbols: the symbol check of two revisions of one drawing, summarised and set side by side. Pure: no DOM, no data.
//
// Shapes are not matched by position (a revision can move things about), so a revision is summarised as counts: the standard symbols
// by name, the "not to standard" flags by kind and name, and the shapes not identified. Comparing two summaries lists what changed.

const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const bump = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };

/** { ok, standard: { NAME: n }, flagged: { 'kind|NAME': n }, notIdentified, shapes } from a symbol check result. ok is false when the check did not run. */
export function summariseSymbols(result) {
  const out = { ok: false, standard: {}, flagged: {}, notIdentified: 0, shapes: 0 };
  try {
    if (!isObj(result) || result.ok !== true || !Array.isArray(result.shapes)) return out;
    out.ok = true;
    for (const s of result.shapes) {
      if (!isObj(s)) continue;
      out.shapes++;
      if (s.verdict === 'standard') {
        if (Array.isArray(s.parts)) for (const p of s.parts) if (typeof p === 'string' && p) bump(out.standard, p);
      } else if (s.verdict === 'not-standard') {
        const r = isObj(s.reason) ? s.reason : {};
        bump(out.flagged, (typeof r.kind === 'string' && r.kind ? r.kind : 'other') + '|' + (typeof r.name === 'string' ? r.name : ''));
      } else if (s.verdict === 'not-identified') {
        out.notIdentified++;
      }
    }
  } catch { /* what was counted stands */ }
  return out;
}

const sum = o => Object.values(o).reduce((m, n) => m + n, 0);

/** What changed from summary a to summary b: { ok, standard: [{ name, a, b, delta }], unchangedNames, flagged: [{ key, kind, name, a, b, delta }], notIdentified, totals }. */
export function compareSymbols(a, b) {
  const bad = { ok: false, standard: [], unchangedNames: 0, flagged: [], notIdentified: { a: 0, b: 0, delta: 0 }, totals: { standardA: 0, standardB: 0, flaggedA: 0, flaggedB: 0 } };
  try {
    if (!isObj(a) || !isObj(b) || a.ok !== true || b.ok !== true) return bad;
    const names = [...new Set([...Object.keys(a.standard), ...Object.keys(b.standard)])].sort();
    const standard = [];
    let unchangedNames = 0;
    for (const name of names) {
      const x = a.standard[name] || 0, y = b.standard[name] || 0;
      if (x === y) unchangedNames++; else standard.push({ name, a: x, b: y, delta: y - x });
    }
    const keys = [...new Set([...Object.keys(a.flagged), ...Object.keys(b.flagged)])].sort();
    const flagged = [];
    for (const key of keys) {
      const x = a.flagged[key] || 0, y = b.flagged[key] || 0;
      if (x === y) continue;
      const i = key.indexOf('|');
      flagged.push({ key, kind: key.slice(0, i), name: key.slice(i + 1), a: x, b: y, delta: y - x });
    }
    return { ok: true, standard, unchangedNames, flagged, notIdentified: { a: a.notIdentified, b: b.notIdentified, delta: b.notIdentified - a.notIdentified },
      totals: { standardA: sum(a.standard), standardB: sum(b.standard), flaggedA: sum(a.flagged), flaggedB: sum(b.flagged) } };
  } catch {
    return bad;
  }
}
