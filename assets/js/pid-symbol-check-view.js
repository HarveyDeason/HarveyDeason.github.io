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
  if (s.status === 'none') return 'This sheet has no readable text: printed and scanned sheets cannot be checked yet.';
  if (s.status !== 'readable' && s.status !== 'comments') return 'Only a sheet that is Readable, or Readable from comments, can be checked.';
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

/** 'N standard symbols found, M with tags.'; 'No standard symbols found.' for none; '' when the result has no symbol list. */
export function symbolSummary(result) {
  try {
    const list = symbolsOf(result);
    if (!list) return '';
    const all = list.filter(isSymbol), tagged = all.filter(s => !!str(s.tag)).length;
    const short = result.sweepTimedOut === true;
    if (!all.length) return short ? 'No standard symbols found before the time limit: this list is incomplete.' : 'No standard symbols found.';
    return all.length + ' standard symbol' + (all.length === 1 ? '' : 's') + ' found, ' + tagged + ' with tags.' + (short ? ' ' + INCOMPLETE : '');
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
    const why = result && typeof result === 'object' && result.why === 'no-tags' ? 'This sheet has no confirmed tags to check.' : COULD_NOT_RUN;
    return '<div class="sc-line">' + why + '</div>';
  }
  const list = verdictsOf(result).map(x => ({ ...x, kind: kindOf(x.v) }));
  const counts = SUMMARY_ORDER.map(k => [k, list.filter(x => x.kind === k).length]).filter(c => c[1])
    .map(c => c[1] + ' ' + VERDICT_LABELS[c[0]]).join(' · ');
  const took = isNum(result.ms) ? ' Checked in ' + (Math.max(0, result.ms) / 1000).toFixed(1) + ' s.' : '';
  list.sort((a, b) => ROW_ORDER.indexOf(a.kind) - ROW_ORDER.indexOf(b.kind) || str(a.v.tag).localeCompare(str(b.v.tag)));
  // A <details>, so the list folds away to its one summary line and the
  // drawing can be seen. The summary keeps the counts and, in short, the limit
  // of what the check can say; the full note is the first thing in the body.
  let out = '<details class="sc-results" open><summary>' + esc(counts ? counts + '.' : 'No tags read.') + took
    + ' <span class="sc-hint">It checks the family of symbol, not which member of it.</span></summary>'
    + '<div class="sc-note">' + esc(FAMILY_NOTE) + '</div>'
    + '<div class="sc-summary">'
    + (tagsTimedOut(result) ? 'The check stopped at its time limit. Tags it did not reach are marked Not checked. ' : '')
    + 'Results are shown here and are not saved.</div>'
    + (bubbleSummary(result) ? '<div class="sc-summary">' + esc(bubbleSummary(result)) + '</div>' : '')
    + (symbolSummary(result) ? '<div class="sc-summary">' + esc(symbolSummary(result)) + '</div>' : '')
    + (isBox(result.skipped) ? '<div class="sc-summary">' + SKIPPED_NOTE + '</div>' : '')
    + '<ul class="sc-list">';
  for (const { v, i, kind } of list) {
    out += '<li><button type="button" class="sc-row sc-' + kind + '" data-act="sym-jump" data-i="' + i + '">'
      + '<strong>' + esc(str(v.tag)) + '</strong> <span class="sc-label">' + VERDICT_LABELS[kind] + '</span> '
      + '<span class="sc-detail">' + esc(sentence(v, kind)) + '</span></button></li>';
  }
  out += '</ul>';
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
  asArr(symbolsOf(result)).forEach((s, n) => {
    if (!untagged(s) || !isBox(s.box)) return;
    out.push({ s: n, kind: 'symbol', ...rect(s.box), title: str(s.name) + ': standard symbol, no tag.' });
  });
  if (isBox(result.skipped)) out.push({ kind: 'skipped', ...rect(result.skipped), title: SKIPPED_NOTE });
  return out;
}
