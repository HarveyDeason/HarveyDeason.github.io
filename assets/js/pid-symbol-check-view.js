// assets/js/pid-symbol-check-view.js
// What the user sees of the symbol check: why the button is disabled, the
// progress line, the results list and the rectangles drawn on the sheet.
// Pure strings and numbers: no DOM, so the escaping is node-tested.
//
// EVERYTHING SHOWN HERE COMES FROM OUTSIDE. Tags come out of a PDF and symbol
// names out of a library file in a shared folder that anyone connected can
// edit. Every such value goes through esc(), and a verdict this module does
// not know is shown as "Not checked", never trusted as a class name.

import { esc } from './pid-symbols-view.js';

const isNum = x => typeof x === 'number' && Number.isFinite(x);
const asArr = x => (Array.isArray(x) ? x : []);
const str = x => (typeof x === 'string' ? x : '');
const letterLine = lt => { const n = count(lt.removed), r = count(lt.rows); return n === 0 ? 'No letters spotted.' : n + (n === 1 ? ' letter' : ' letters') + ' spotted in ' + r + (r === 1 ? ' row' : ' rows') + ' and left out of the linework.'; };
const count = x => (isNum(x) && x > 0 ? Math.floor(x) : 0);

// The limit of what the check can say. Shown above every set of results.
export const FAMILY_NOTE = 'This check confirms that a standard symbol of the right family sits beside each tag. '
  + 'It cannot tell whether the right member of that family was chosen: a ball valve drawn where a butterfly valve was intended passes.';
export const VERDICT_LABELS = { ok: 'OK', 'off-size': 'OK, off size', 'wrong-family': 'Wrong family',
  exception: 'Approved exception', look: 'Needs a look', 'not-checked': 'Not checked' };

const COULD_NOT_RUN = 'The symbol check could not run on this sheet.';
export const SUMMARY_ORDER = ['ok', 'off-size', 'wrong-family', 'exception', 'look', 'not-checked'];
export const ROW_ORDER = ['wrong-family', 'look', 'exception', 'off-size', 'not-checked', 'ok'];   // what needs attention first
// hasOwnProperty, not `in`: a verdict of 'constructor' must not pass as known.
export const kindOf = v => (v && Object.prototype.hasOwnProperty.call(VERDICT_LABELS, v.verdict) ? v.verdict : 'not-checked');
const usable = result => !!result && typeof result === 'object' && result.ok === true && Array.isArray(result.verdicts);
const verdictsOf = result => result.verdicts.map((v, i) => ({ v, i })).filter(x => x.v && typeof x.v === 'object');

/** Why Check symbols cannot run just now; '' when it can. */
export function blockerText(state) {
  const s = state && typeof state === 'object' ? state : {};
  if (!s.sheetOpen) return 'Open a sheet first.';
  if (s.running) return 'A check is running.';
  if (!s.hasLibrary) return 'Load the symbol library first, on the Symbols tab.';
  if (!str(s.status)) return 'This sheet has not been pre-checked yet.';
  if (s.status === 'scanned') return 'This is a scanned image: scanned sheets cannot be checked yet.';
  if (s.status === 'none') return 'This sheet has no readable text and no linework to check.';
  if (s.status !== 'readable' && s.status !== 'comments' && s.status !== 'printed') return 'Only a Readable, Readable from comments or Printed sheet can be checked.';
  return '';
}

const CANCEL = '<button type="button" class="btn" data-act="sym-cancel">Cancel</button>';
/** The progress line: tags checked, then (stage 'sweep') the rows of the page looked over for symbols. */
export function progressHtml(done, total, stage) {
  if (stage === 'sweep') return '<div class="sc-line">Looking for symbols: row ' + count(done) + ' of ' + count(total) + '… ' + CANCEL + '</div>';
  return '<div class="sc-line">Checking symbols: ' + count(done) + ' of ' + count(total) + ' tags… ' + CANCEL + '</div>';
}

const symbolsOf = result => (result && typeof result === 'object' && Array.isArray(result.symbols) ? result.symbols : null);
const isSymbol = s => !!s && typeof s === 'object' && !!str(s.name);
const untagged = s => isSymbol(s) && !str(s.tag);
export const SKIPPED_NOTE = 'Title block not checked.';
const INCOMPLETE = 'The time limit was reached: this list is incomplete.';
/** True when the tags themselves ran out of time (a result from before the separate flags: whenever it timed out). */
export const tagsTimedOut = result => !!result && typeof result === 'object'
  && (result.tagsTimedOut === true || (result.timedOut === true && typeof result.tagsTimedOut !== 'boolean'));

// ── Phase 3: shapes not to standard ─────────────────────────────────────
/** Shown wherever the shape check's flags show, until it has been tuned on more sheets (owner, 2026-11-18). */
export const TRIAL_NOTE = 'The shape check is new and on trial: review each "not to standard" flag by eye before acting on it.';
export const OPERATORS_NOTE = 'Operators not marked in the library: valves with an operator will be flagged.';
export const NOT_STANDARD_COLOUR = '#E08E00';
export const NOT_IDENTIFIED_COLOUR = '#C62828';
export const KEY_NOT_STANDARD = 'Not to standard: the reason names the standard symbol it departs from';
export const KEY_NOT_IDENTIFIED = 'Not identified: looked at, not matched to any standard symbol; check by eye';
export const VERDICTS = ['standard', 'not-standard', 'not-identified', 'not-judged'];
// A shape's verdict. Results from before the redesign carry none: fall back on `standard`.
export const verdictOf = s => (VERDICTS.includes(s.verdict) ? s.verdict : s.standard === true ? 'standard' : s.standard === false ? 'not-standard' : s.standard === null ? 'not-judged' : '');
const hasVerdicts = list => !!list && list.some(s => VERDICTS.includes(s.verdict));
/** The reason a shape is not to standard, in words: plain text. '' when it has none. */
export function reasonText(shape) {
  const r = shape && typeof shape === 'object' && shape.reason && typeof shape.reason === 'object' ? shape.reason : null;
  if (!r) return '';
  if (r.kind === 'differs') return 'drawn differently from ' + str(r.name) + ' (' + count(r.pct) + '% alike)';
  if (r.kind === 'size') return str(r.name) + ' drawn at ' + count(r.pct) + '% of standard size';
  if (r.kind === 'extra') return str(r.name) + ' with extra linework';
  if (r.kind === 'tag') return 'tag ' + str(r.tag) + ' has no standard symbol';
  return '';
}
// The words for an amber shape: the new reason, or (no reason given) the old why and closest symbol.
const amberText = s => reasonText(s) || (shapeWhy(s) + '; ' + closestText(s));
/**
 * A shape's parts in words (legend rules): bodies first, then the standard symbols peeled off it, then its
 * attachments, a repeat counted ('BALL + MANUAL ISOLATION + FLANGED CONNECTION ×2'). '' for none. Plain text.
 */
export function partsName(parts) {
  const order = { body: 0, symbol: 1, attachment: 2 };
  const list = asArr(parts).filter(p => p && typeof p === 'object' && str(p.name)).map((p, i) => ({ name: str(p.name), rank: order[p.role] ?? 0, i }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i);
  const seen = new Map();
  for (const p of list) { const k = p.rank + '|' + p.name; seen.set(k, seen.has(k) ? { ...seen.get(k), n: seen.get(k).n + 1 } : { name: p.name, n: 1 }); }
  return [...seen.values()].map(p => p.name + (p.n > 1 ? ' ×' + p.n : '')).join(' + ');
}

/** 'N standard · M not to standard · K not identified · Read from: … · Printed at N% of full size'; '' when no shapes. */
export function markLine(result) {
  const list = shapesOf(result);
  if (!list || !list.length) return '';
  const n = v => list.filter(s => verdictOf(s) === v).length;
  const parts = [n('standard') + ' standard', n('not-standard') + ' not to standard', n('not-identified') + ' not identified'];
  // Ticks standing alone on a line, read as part of it (counted, so the class is visible).
  if (isNum(result.lineMarks) && result.lineMarks > 0) parts.push(result.lineMarks === 1 ? '1 line mark read as part of its line' : result.lineMarks + ' line marks read as part of their lines');
  if (result.readFrom === 'paths') parts.push('Read from: drawn paths');
  else if (result.readFrom === 'line-pieces') parts.push('Read from: line pieces' + (isNum(result.lineCapped) && result.lineCapped > 0 ? ' · Line-piece reading incomplete' : ''));
  if (isNum(result.printScale)) { const p = Math.round(result.printScale * 100); if (p < 95 || p > 105) parts.push('Printed at ' + p + '% of full size'); }
  if (result.drawingArea && typeof result.drawingArea === 'object' && result.drawingArea.found === false) parts.push('Drawing area: frame not found, page edge used');
  return parts.join(' · ');
}
const shapesOf = result => (result && typeof result === 'object' && Array.isArray(result.shapes) ? result.shapes.filter(s => s && typeof s === 'object' && isBox(s.box)) : null);
const pct = x => Math.round(Math.max(0, Math.min(1, x)) * 100) + '%';
/** Why a shape is not to standard, in words: plain text. */
export function shapeWhy(shape) {
  const s = shape && typeof shape === 'object' ? shape : {};
  if (s.why === 'left-over') return 'ink left over';
  if (s.why === 'short-line') return 'line drawn short' + (isNum(s.share) ? ' (' + pct(s.share) + ')' : '');
  if (s.why === 'no-fit') return 'no standard symbol fits';
  if (s.why === 'time') return 'not judged: time limit';
  return '';
}
const closestText = s => (s.closest && typeof s.closest === 'object' && str(s.closest.name) && isNum(s.closest.score)
  ? 'closest: ' + str(s.closest.name) + ' ' + pct(s.closest.score) : 'no close symbol');
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
// A standard shape's name: its listed symbols (operator last), or the symbol fitted to it alone.
function shapeName(result, s) {
  if (partsName(s.parts)) return partsName(s.parts);
  const syms = asArr(result.symbols);
  const names = asArr(s.symbols).filter(i => Number.isInteger(i) && syms[i] && str(syms[i].name)).map(i => str(syms[i].name));
  if (s.operator && str(s.operator.name)) names.push(str(s.operator.name));
  return names.length ? names.join(' + ') : (s.closest && str(s.closest.name)) || 'standard symbol';
}
// ' M shapes not to standard. K shapes not judged: time limit. <operators note>', or '' when no shape was judged.
function shapeLine(result) {
  const list = shapesOf(result);
  if (!list) return '';
  const bad = list.filter(s => s.standard === false).length, late = list.filter(s => s.standard === null).length;
  if (hasVerdicts(list)) {
    const n = v => list.filter(s => verdictOf(s) === v).length;
    return ' ' + plural(n('standard'), 'standard shape', 'standard shapes') + ', ' + n('not-standard') + ' not to standard, ' + n('not-identified') + ' not identified.'
      + (late ? ' ' + plural(late, 'shape', 'shapes') + ' not judged: time limit.' : '') + (result.operatorsMarked === false ? ' ' + OPERATORS_NOTE : '');
  }
  return ' ' + plural(bad, 'shape', 'shapes') + ' not to standard.' + (late ? ' ' + plural(late, 'shape', 'shapes') + ' not judged: time limit.' : '')
    + (result.operatorsMarked === false ? ' ' + OPERATORS_NOTE : '');
}

/** 'N standard symbols found, M with tags.'; 'No standard symbols found.' for none; '' when the result has no symbol list. Then the shapes not to standard, when shapes were judged. */
export function symbolSummary(result) {
  try {
    const list = symbolsOf(result);
    if (!list) return '';
    const all = list.filter(isSymbol), tagged = all.filter(s => !!str(s.tag)).length;
    const short = result.sweepTimedOut === true;
    if (!all.length) return (short ? 'No standard symbols found before the time limit: this list is incomplete.' : 'No standard symbols found.') + shapeLine(result);
    return all.length + ' standard symbol' + (all.length === 1 ? '' : 's') + ' found, ' + tagged + ' with tags.' + (short ? ' ' + INCOMPLETE : '') + shapeLine(result);
  } catch {
    return '';
  }
}

// The sentence for one verdict. Plain text: the caller escapes it.
function sentence(v, kind) {
  if (kind === 'not-checked') return str(v.why) || 'Not checked.';
  const c = v.closest && typeof v.closest === 'object' ? v.closest : null;
  if (v.bubble === true) {
    if (kind === 'look') {
      return 'No standard tag bubble recognised round the tag.'
        + (c && str(c.symbol) && isNum(c.score) ? ' Closest: ' + str(c.symbol) + ' at ' + Math.round(c.score * 100) + '%.' : '')
        + ' Could be non-standard, modified, or a gap in the library.';
    }
    if (kind === 'ok' || kind === 'off-size') {
      const kinds = asArr(v.oneOf).map(str).filter(Boolean);
      return 'Tag bubble: ' + (kinds.length > 1 ? 'One of: ' + kinds.join(', ') : str(v.symbol))
        + (kind === 'off-size' ? ', drawn at ' + count(v.sizePct) + '% of legend size' : '') + '.';
    }
  }
  const closest = c && str(c.symbol) && isNum(c.score) ? ' Closest in its family: ' + str(c.symbol) + ' at ' + Math.round(c.score * 100) + '%.' : '';
  if (kind === 'look') return 'Nothing recognised within 60 pt.' + closest + ' Could be non-standard, modified, or a gap in the library.';
  if (kind === 'exception') {
    return 'Nothing recognised.' + closest + ' Approved exceptions for this family: ' + asArr(v.exceptions).map(str).filter(Boolean).join(', ')
      + '. The tool cannot tell whether this item is one of them.';
  }
  if (kind === 'wrong-family') return 'Recognised as ' + str(v.symbol) + ' (tag identifier ' + str(v.tagId) + '), which does not fit ' + str(v.fc) + '.';
  const names = asArr(v.oneOf).map(str).filter(Boolean);
  let out = names.length > 1 ? 'One of: ' + names.join(', ') : str(v.symbol);
  if (kind === 'off-size') out += ', drawn at ' + count(v.sizePct) + '% of legend size';
  if (v.filled === true) out += ', filled in (normally closed)';
  if (v.letters === 'read') out += ', letter read';
  if (v.letters === 'not judged') out += ', letter not judged';
  return out + '.';
}

/** Recognised tag bubbles counted by kind, most first: 'Tag bubbles: 2 RING, 1 HEXAGON', or '' when there are none. */
export function bubbleSummary(result) {
  try {
    const n = new Map();
    for (const v of asArr(result && typeof result === 'object' ? result.verdicts : null)) {
      if (!v || typeof v !== 'object' || v.bubble !== true || (v.verdict !== 'ok' && v.verdict !== 'off-size') || !str(v.symbol)) continue;
      n.set(str(v.symbol), (n.get(str(v.symbol)) || 0) + 1);
    }
    if (!n.size) return '';
    return 'Tag bubbles: ' + [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, c]) => c + ' ' + k).join(', ');
  } catch {
    return '';
  }
}

/** The sentence the screen shows for one verdict, as plain text (the report's Detail). */
export function verdictSentence(v) {
  const x = v && typeof v === 'object' ? v : {};
  return sentence(x, kindOf(x));
}

/** The results under the sheet toolbar: what the check can say, the counts, and a row per tag that jumps to it. */
export function resultsHtml(result) {
  if (!usable(result)) {
    return '<div class="sc-line">' + COULD_NOT_RUN + '</div>';
  }
  const list = verdictsOf(result).map(x => ({ ...x, kind: kindOf(x.v) }));
  const counts = SUMMARY_ORDER.map(k => [k, list.filter(x => x.kind === k).length]).filter(c => c[1])
    .map(c => c[1] + ' ' + VERDICT_LABELS[c[0]]).join(' · ');
  const took = isNum(result.ms) ? ' Checked in ' + (Math.max(0, result.ms) / 1000).toFixed(1) + ' s.' : '';
  list.sort((a, b) => ROW_ORDER.indexOf(a.kind) - ROW_ORDER.indexOf(b.kind) || str(a.v.tag).localeCompare(str(b.v.tag)));
  // A <details>, so the list folds away to its one summary line and the
  // drawing can be seen. The summary keeps the counts and, in short, the limit
  // of what the check can say; the full note is the first thing in the body.
  const printed = result.words === 'printed';
  const lt = result.letters && typeof result.letters === 'object' ? result.letters : null;
  let out = '<details class="sc-results" open><summary>'
    + esc(counts ? counts + '.' : printed ? 'Tags not read yet: on a printed sheet the letters are drawn as shapes.' : 'No tags read.') + took
    + ' <span class="sc-hint">It checks the family of symbol, not which member of it.</span></summary>'
    + '<div class="sc-note">' + esc(FAMILY_NOTE) + '</div>'
    + '<div class="sc-summary">'
    + (tagsTimedOut(result) ? 'The check stopped at its time limit. Tags it did not reach are marked Not checked. ' : '')
    + 'Results are shown here and are not saved.</div>'
    + (printed && lt ? '<div class="sc-summary">' + esc(letterLine(lt)) + '</div>' : '')
    + (bubbleSummary(result) ? '<div class="sc-summary">' + esc(bubbleSummary(result)) + '</div>' : '')
    + (symbolSummary(result) ? '<div class="sc-summary">' + esc(symbolSummary(result)) + '</div>' : '')
    + (isBox(result.skipped) ? '<div class="sc-summary">' + SKIPPED_NOTE + '</div>' : '');
  // What the tool is for, first: each shape not to standard, why, and the closest standard symbol.
  if (shapesOf(result)) out += '<div class="sc-summary"><strong>' + esc(TRIAL_NOTE) + '</strong></div>';
  const newStyle = hasVerdicts(shapesOf(result));
  if (newStyle && markLine(result)) {
    out += '<div class="sc-summary">' + esc(markLine(result)) + '</div>'
      + '<div class="sc-summary">' + esc(KEY_NOT_STANDARD) + '</div><div class="sc-summary">' + esc(KEY_NOT_IDENTIFIED) + '</div>';
  }
  const flagged = (shapesOf(result) || []).map((s, n) => ({ s, n })).filter(x => verdictOf(x.s) === 'not-standard');
  if (flagged.length) {
    out += '<div class="sc-summary"><strong>Not to standard</strong>: ' + plural(flagged.length, 'shape', 'shapes') + '</div><ul class="sc-list">';
    for (const { s, n } of flagged) {
      out += '<li><button type="button" class="sc-row sc-not-standard" data-act="sym-jump-shape" data-sh="' + n + '">'
        + '<strong>Not to standard</strong> <span class="sc-detail">' + esc(newStyle ? amberText(s) : shapeWhy(s) + '; ' + closestText(s)) + '</span></button></li>';
    }
    out += '</ul>';
  }
  const unknown = newStyle ? shapesOf(result).filter(s => verdictOf(s) === 'not-identified').length : 0;
  if (unknown) out += '<div class="sc-summary">' + unknown + ' not identified (boxed in red on the drawing)</div>';
  out += '<ul class="sc-list">';
  for (const { v, i, kind } of list) {
    out += '<li><button type="button" class="sc-row sc-' + kind + '" data-act="sym-jump" data-i="' + i + '">'
      + '<strong>' + esc(str(v.tag)) + '</strong> <span class="sc-label">' + VERDICT_LABELS[kind] + '</span> '
      + '<span class="sc-detail">' + esc(sentence(v, kind)) + '</span></button></li>';
  }
  out += '</ul>';
  // Symbols first (owner, 2026-11-18): once shapes were judged, every standard shape is listed by name,
  // whether or not a tag sits beside it.
  const judged = shapesOf(result);
  if (judged) {
    const good = judged.map((s, n) => ({ s, n, name: shapeName(result, s) })).filter(x => verdictOf(x.s) === 'standard');
    if (good.length) {
      const byName = new Map();
      for (const { name } of good) byName.set(name, (byName.get(name) || 0) + 1);
      out += '<div class="sc-summary"><strong>Standard symbols</strong>: ' + esc([...byName].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, c]) => c + ' ' + k).join(', ')) + '</div><ul class="sc-list">';
      for (const { n, name } of good) out += '<li><button type="button" class="sc-row sc-standard" data-act="sym-jump-shape" data-sh="' + n + '"><strong>' + esc(name) + '</strong></button></li>';
      out += '</ul>';
    }
    return out + '</details>';
  }
  // Symbols with no tag beside them: listed, not flagged. Padlocks and capped
  // ends carry none, and on some sheets the tags cannot be read yet.
  const loose = asArr(symbolsOf(result)).map((s, n) => ({ s, n })).filter(x => untagged(x.s))
    .sort((a, b) => str(a.s.name).localeCompare(str(b.s.name)) || a.n - b.n);
  if (loose.length) {
    const byName = new Map();
    for (const { s } of loose) byName.set(str(s.name), (byName.get(str(s.name)) || 0) + 1);
    out += '<div class="sc-summary"><strong>Symbols with no tag</strong>: '
      + esc([...byName].map(([k, c]) => c + ' ' + k).join(', ')) + '</div><ul class="sc-list">';
    for (const { s, n } of loose) {
      const alts = asArr(s.oneOf).map(str).filter(Boolean);
      out += '<li><button type="button" class="sc-row sc-symbol" data-act="sym-jump-s" data-s="' + n + '">'
        + '<strong>' + esc(str(s.name)) + '</strong>'
        + (alts.length > 1 ? ' <span class="sc-detail">(one of: ' + esc(alts.join(', ')) + ')</span>' : '')
        + (s.plain === true ? ' <span class="sc-detail">(plain shape: check by eye)</span>' : '')
        + '</button></li>';
    }
    out += '</ul>';
  }
  return out + '</details>';
}

const isBox = b => Array.isArray(b) && b.length === 4 && b.every(isNum);
const MARGIN = 3; // pixels

/**
 * Rectangles for the sheet overlay, in pixels at the viewer's scale: around
 * the symbol when one was recognised, otherwise around the tag. `title` is
 * plain text for a tooltip; the caller must set it as text, not markup.
 */
export function boxRects(result, scale) {
  if (!usable(result) || !isNum(scale) || scale <= 0) return [];
  const out = [];
  for (const { v, i } of verdictsOf(result)) {
    const b = isBox(v.box) ? v.box : isBox(v.tagBox) ? v.tagBox : null;
    if (!b) continue;
    const kind = kindOf(v);
    out.push({ i, kind, left: b[0] * scale - MARGIN, top: b[1] * scale - MARGIN,
      width: (b[2] - b[0]) * scale + 2 * MARGIN, height: (b[3] - b[1]) * scale + 2 * MARGIN,
      title: str(v.tag) + ': ' + VERDICT_LABELS[kind] + '. ' + sentence(v, kind) });
  }
  const rect = b => ({ left: b[0] * scale - MARGIN, top: b[1] * scale - MARGIN,
    width: (b[2] - b[0]) * scale + 2 * MARGIN, height: (b[3] - b[1]) * scale + 2 * MARGIN });
  const judged = shapesOf(result);
  asArr(symbolsOf(result)).forEach((s, n) => {
    if (judged || !untagged(s) || !isBox(s.box)) return;   // once shapes were judged, the shapes are boxed instead
    out.push({ s: n, kind: 'symbol', ...rect(s.box), title: str(s.name) + ': standard symbol, no tag.' + (s.plain === true ? ' Plain shape: check by eye.' : '') });
  });
  const newStyle = hasVerdicts(judged);
  let amber = 0;
  (judged || []).forEach((s, n) => {
    const v = verdictOf(s);
    if (v === 'standard') out.push({ sh: n, kind: 'standard', ...rect(s.box), title: 'Standard symbol: ' + shapeName(result, s) + '.' });
    else if (v === 'not-standard') out.push({ sh: n, ...(newStyle ? { num: ++amber } : {}), kind: 'not-standard', ...rect(s.box), title: 'Not to standard: ' + (newStyle ? amberText(s) : shapeWhy(s) + '. ' + closestText(s)) + '.' });
    else if (v === 'not-identified') out.push({ sh: n, kind: 'not-identified', ...rect(s.box), title: 'Not identified: check by eye.' });
    else if (v === 'not-judged') out.push({ sh: n, kind: 'not-judged', ...rect(s.box), title: 'Not judged: time limit.' });
  });
  const area = result.drawingArea && typeof result.drawingArea === 'object' ? result.drawingArea : null;
  if (newStyle && area && area.found !== false && isBox(area.box)) out.push({ kind: 'area', ...rect(area.box), title: 'Drawing area checked.' });
  if (isBox(result.skipped)) out.push({ kind: 'skipped', ...rect(result.skipped), title: SKIPPED_NOTE });
  return out;
}
