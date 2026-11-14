// assets/js/pid-symbols-view.js
// HTML and SVG strings for the P&ID Tag Register's Symbols tab. Pure strings:
// no DOM, so the escaping is node-tested.
//
// EVERYTHING SHOWN HERE COMES FROM A SHARED FOLDER. symbol-library.json can be
// edited by anyone connected, by hand, or mangled by a sync client, so its
// text is treated as hostile: every string goes through esc(), every number
// through a finite-number check, and nothing from the library is ever written
// as markup. Buttons carry data-act / data-id attributes for one delegated
// listener in the tool; there are no inline handlers.

import { libraryCounts } from './pid-symbols.js';

const isNum = x => typeof x === 'number' && Number.isFinite(x);
const asArr = x => (Array.isArray(x) ? x : []);
const asObj = x => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
const str = x => (typeof x === 'string' ? x : isNum(x) ? String(x) : '');
const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

export function esc(x) {
  if (x === null || x === undefined) return '';
  let s;
  try { s = String(x); } catch { return ''; }
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Symbol drawing ────────────────────────────────────────────────────────

const fmt = n => String(Math.round(n * 100) / 100);
const MIN_VIEW = 24; // points
const PLACEHOLDER = '<svg class="sym-svg sym-svg-none" viewBox="0 0 40 24" preserveAspectRatio="xMidYMid meet" aria-hidden="true">'
  + '<rect x="1" y="1" width="38" height="22" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="3 3"/></svg>';

function pathMarkup(p) {
  if (!p || typeof p !== 'object' || !Array.isArray(p.segs)) return '';
  let d = '', px = NaN, py = NaN;
  for (let i = 0; i + 3 < p.segs.length; i += 4) {
    const x0 = p.segs[i], y0 = p.segs[i + 1], x1 = p.segs[i + 2], y1 = p.segs[i + 3];
    if (!(isNum(x0) && isNum(y0) && isNum(x1) && isNum(y1))) continue;
    if (x0 !== px || y0 !== py) d += 'M' + fmt(x0) + ' ' + fmt(y0);
    d += 'L' + fmt(x1) + ' ' + fmt(y1);
    px = x1; py = y1;
  }
  if (!d) return '';
  const grey = isNum(p.grey) ? Math.max(0, Math.min(255, p.grey)) : 0;
  const filled = p.filled === true, stroked = p.stroked === true || !filled;
  const mask = filled && grey >= 250; // a white fill hides what is behind it
  let out = '<path d="' + d + '"';
  out += filled ? ' fill="' + (mask ? 'var(--bg, #fff)' : 'currentColor') + '" fill-rule="evenodd"' : ' fill="none"';
  out += stroked ? ' stroke="currentColor" stroke-width="' + fmt(Math.max(isNum(p.width) ? p.width : 0, 0.35)) + '"' : ' stroke="none"';
  const opacity = Math.max(0.3, Math.round((1 - grey / 255) * 100) / 100);
  if (!mask && opacity < 1) out += ' opacity="' + fmt(opacity) + '"';
  return out + '/>';
}

/** One symbol as inline SVG, drawn from its stored linework so it stays sharp at any size. */
export function symbolSvg(symbol) {
  const s = asObj(symbol);
  const paths = asArr(s.paths).map(pathMarkup).filter(Boolean);
  if (!paths.length) return PLACEHOLDER;
  const w = isNum(s.w) && s.w > 0 ? s.w : 0, h = isNum(s.h) && s.h > 0 ? s.h : 0;
  // 2 pt of margin, and a minimum view so that a single line or a tiny symbol
  // is centred at a sensible size instead of being magnified to fill the card.
  const vw = Math.max(w + 4, MIN_VIEW), vh = Math.max(h + 4, MIN_VIEW);
  let out = '<svg class="sym-svg" viewBox="' + fmt(-(vw - w) / 2) + ' ' + fmt(-(vh - h) / 2) + ' ' + fmt(vw) + ' ' + fmt(vh)
    + '" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' + paths.join('');
  for (const l of asArr(s.letters)) {
    if (!l || typeof l !== 'object' || typeof l.text !== 'string' || !isNum(l.x) || !isNum(l.y) || !isNum(l.size) || l.size <= 0) continue;
    out += '<text x="' + fmt(l.x) + '" y="' + fmt(l.y + l.size) + '" font-size="' + fmt(l.size) + '" fill="currentColor" stroke="none">' + esc(l.text) + '</text>';
  }
  return out + '</svg>';
}

// ── Results ───────────────────────────────────────────────────────────────

const codesOf = tagId => str(tagId).toUpperCase().split(/[\s,/;]+/).filter(Boolean);
const button = (act, attrs, label, extra) => '<button type="button" class="btn" data-act="' + act + '"' + (attrs || '') + (extra || '') + '>' + label + '</button>';
const EXCEPTION_STATUS = { approved: 'Approved to use as a CAD block', pending: 'Pending the next palette release' };
const statusText = e => EXCEPTION_STATUS[e && e.status === 'approved' ? 'approved' : 'pending'];

function noteMarkup(n, editAttrs) {
  const note = asObj(n);
  const tail = [str(note.ref), str(note.date)].filter(Boolean).join(' · ');
  return '<div class="sym-note">' + esc(str(note.text)) + (tail ? ' <small>' + esc(tail) + '</small>' : '') + (editAttrs || '') + '</div>';
}

function symbolCard(s, opts) {
  const id = ' data-id="' + esc(str(s.id)) + '"';
  const flags = asObj(s.flags);
  const notes = asArr(s.notes), aliases = asArr(s.aliases).filter(a => typeof a === 'string');
  if (opts.editId !== null && opts.editId !== undefined && s.id === opts.editId) {
    const field = (name, label, value) => '<label>' + label + ' <input type="text" data-field="' + name + '" value="' + esc(value) + '"></label>';
    const check = (name, label, on) => '<label><input type="checkbox" data-field="' + name + '"' + (on ? ' checked' : '') + '> ' + label + '</label>';
    return '<div class="sym-card sym-editing"' + id + '>' + symbolSvg(s)
      + field('name', 'Name', str(s.name)) + field('group', 'Table heading', str(s.group)) + field('tagId', 'Tag identifier', str(s.tagId))
      + field('aliases', 'Also known as (comma separated)', aliases.join(', '))
      + check('simple', 'Simple shape: too plain to check on a drawing', flags.simple === true)
      + check('stretch', 'Drawn to suit: its size varies', flags.stretch === true)
      + notes.map((n, i) => noteMarkup(n, ' ' + button('remove-note', id + ' data-index="' + i + '"', 'Remove note'))).join('')
      + '<label>New note <input type="text" data-field="note-text" value=""></label>'
      + '<label>Reference <input type="text" data-field="note-ref" value=""></label>'
      + '<div class="sym-actions">' + button('add-note', id, 'Add note') + button('apply', id, 'Apply') + button('cancel', id, 'Cancel') + button('delete', id, 'Delete symbol') + '</div>'
      + '</div>';
  }
  const meta = [str(s.group), str(s.tagId), str(s.sheet) ? 'Sheet ' + str(s.sheet) : ''].filter(Boolean).map(esc).join(' · ');
  const badges = [flags.manual === true ? 'Manual entry' : '', flags.simple === true ? 'Simple shape' : '',
    flags.stretch === true ? 'Drawn to suit' : '', flags.unmatched === true ? 'Not in the imported legend' : ''].filter(Boolean);
  const nextTag = codesOf(s.tagId).map(c => button('next-tag', ' data-code="' + esc(c) + '"', 'Next available tag: ' + esc(c),
    opts.hasTags ? '' : ' disabled title="Load drawings first"')).join('');
  return '<div class="sym-card"' + id + '>' + symbolSvg(s)
    + '<div class="sym-name">' + esc(str(s.name)) + '</div>'
    + (meta ? '<div class="sym-meta">' + meta + '</div>' : '')
    + (badges.length ? '<div class="sym-badges">' + badges.map(b => '<span class="sym-badge">' + b + '</span>').join(' ') + '</div>' : '')
    + (aliases.length ? '<div class="sym-alias">Also: ' + esc(aliases.join(', ')) + '</div>' : '')
    + notes.map(n => noteMarkup(n)).join('')
    + '<div class="sym-actions">' + nextTag + button('edit', id, 'Edit') + '</div>'
    + '</div>';
}

function exceptionCard(e) {
  const tail = [str(e.note), str(e.ref)].filter(Boolean);
  return '<div class="sym-card sym-exception"><div class="sym-name">' + esc(str(e.name)) + '</div>'
    + '<div class="sym-meta">No palette symbol. ' + statusText(e) + '.</div>'
    + tail.map(t => '<div class="sym-note">' + esc(t) + '</div>').join('') + '</div>';
}

/** Search results as cards. opts = { hasTags, editId, limit = 120 }. */
export function renderResults(results, options) {
  const opts = asObj(options);
  const limit = isNum(opts.limit) && opts.limit > 0 ? opts.limit : 120;
  const list = asArr(results).filter(r => r && typeof r === 'object'
    && ((r.kind === 'symbol' && r.symbol && typeof r.symbol === 'object') || (r.kind === 'exception' && r.exception && typeof r.exception === 'object')));
  if (!list.length) return '<p class="sug-no-data">No symbol matches.</p>';
  let out = '';
  for (const r of list.slice(0, limit)) out += r.kind === 'symbol' ? symbolCard(r.symbol, opts) : exceptionCard(r.exception);
  if (list.length > limit) out += '<p class="sym-more">' + (list.length - limit) + ' more. Keep typing to narrow the list.</p>';
  return out;
}

// ── Status, import preview, exceptions ────────────────────────────────────

/** One line saying what is loaded, which legend it came from and whether it is saved. */
export function renderStatus(state) {
  const s = asObj(state);
  if (s.fileStatus === 'unreadable') {
    return '<span class="sym-warn">symbol-library.json in this folder could not be read. It has not been loaded and saving is blocked until it can be read.</span>';
  }
  if (!s.library || typeof s.library !== 'object') return '<span>No symbol library yet. Import the legend PDF to build one.</span>';
  const lib = asObj(s.library);
  const legend = asArr(lib.legend).filter(l => l && typeof l === 'object')
    .map(l => 'Sheet ' + str(l.sheet) + (str(l.rev) ? ' rev ' + str(l.rev) : '')).join(', ');
  const parts = [plural(libraryCounts(lib).symbols, 'symbol'), legend, str(lib.importedAt) ? 'imported ' + str(lib.importedAt).slice(0, 10) : ''].filter(Boolean);
  let out = '<span>' + esc(parts.join(' · ')) + '</span>';
  if (s.dirty) out += ' <strong class="sym-warn">Unsaved changes</strong>';
  if (s.dirty && !s.connected) out += ' <span>Connect the folder to save.</span>';
  return out;
}

function reportRow(page, bits, rowText) {
  return '<li>' + bits.filter(Boolean).map(esc).join(' · ') + ' '
    + button('manual-from-row', ' data-text="' + esc(rowText) + '" data-page="' + esc(str(page)) + '"', 'Add as manual entry') + '</li>';
}

/** The preview shown after an import and before anything is kept. pending = { library, pages } | null. */
export function renderReport(pending) {
  if (!pending || typeof pending !== 'object') return '';
  const pages = asArr(pending.pages).filter(p => p && typeof p === 'object');
  const count = libraryCounts(pending.library).symbols;
  const actions = '<div class="sym-actions">' + button('use-pending', '', 'Use this library') + button('discard-pending', '', 'Discard') + '</div>';
  if (!pages.length) {
    return '<p><strong>Preview. Nothing is saved yet.</strong> ' + plural(count, 'symbol') + ' from a library file.</p>' + actions;
  }
  let out = '<p><strong>Preview. Nothing is saved yet.</strong> ' + plural(count, 'symbol') + ' from ' + plural(pages.length, 'page') + '.</p>';
  let unsplit = '', unsplitCount = 0, other = '', otherCount = 0, empty = 0;
  for (const p of pages) {
    for (const u of asArr(p.unsplit)) {
      if (!u || typeof u !== 'object') continue;
      unsplitCount++;
      unsplit += reportRow(p.page, ['Page ' + str(p.page), str(u.header), str(u.reason), str(u.text) || '(linework only)'], str(u.text));
    }
    for (const area of asArr(p.other)) {
      for (const r of asArr(asObj(area).rows)) {
        if (!r || typeof r !== 'object') continue;
        otherCount++;
        other += reportRow(p.page, ['Page ' + str(p.page), str(r.text) || '(linework only)'], str(r.text));
      }
    }
    if (isNum(p.emptyRows)) empty += p.emptyRows;
  }
  if (unsplitCount) out += '<p>' + plural(unsplitCount, 'row') + ' could not be split into a label and a symbol:</p><ul>' + unsplit + '</ul>';
  if (otherCount) out += '<details><summary>Other ruled areas (' + otherCount + '): not read as symbol tables</summary><ul>' + other + '</ul></details>';
  if (empty) out += '<p>' + plural(empty, 'empty row') + '.</p>';
  return out + actions;
}

/** Items with no palette symbol, with the form to add one. */
export function renderExceptions(library) {
  if (!library || typeof library !== 'object') return '';
  let out = '<h3>Items with no palette symbol</h3>';
  const list = asArr(library.exceptions).filter(e => e && typeof e === 'object');
  if (!list.length) out += '<p class="sym-meta">None recorded.</p>';
  for (const e of list) {
    const tail = [str(e.note), str(e.ref)].filter(Boolean).map(esc).join(' · ');
    out += '<div class="sym-exception-row"><strong>' + esc(str(e.name)) + '</strong> <span>' + statusText(e) + '</span>'
      + (tail ? ' <small>' + tail + '</small>' : '') + ' ' + button('remove-exception', ' data-name="' + esc(str(e.name)) + '"', 'Remove') + '</div>';
  }
  return out + '<div class="sym-bar">'
    + '<input type="text" data-field="ex-name" placeholder="Item name" value="">'
    + '<select data-field="ex-status"><option value="pending">Pending the next palette release</option><option value="approved">Approved to use as a CAD block</option></select>'
    + '<input type="text" data-field="ex-note" placeholder="Note" value="">'
    + '<input type="text" data-field="ex-ref" placeholder="Reference" value="">'
    + button('add-exception', '', 'Add') + '</div>';
}

// ── Message copy (plain text) ─────────────────────────────────────────────

/** The question put to the user before one library replaces another. Plain text for confirm(). */
export function replaceConfirmText(counts, carry) {
  const c = asObj(counts), k = asObj(carry), s = asObj(k.summary);
  const n = x => (isNum(x) ? x : 0);
  const lines = ['The library in use holds ' + plural(n(c.symbols), 'symbol') + ', ' + plural(n(c.notes), 'note') + ', '
    + plural(n(c.aliases), 'alias').replace(/alias(s?)$/, (m, p) => (p ? 'aliases' : 'alias')) + ' and ' + plural(n(c.exceptions), 'exception') + '.', ''];
  lines.push('Carried over: ' + plural(n(s.notes), 'note') + ' and ' + n(s.aliases) + (n(s.aliases) === 1 ? ' alias' : ' aliases') + ' on '
    + plural(n(s.matched), 'matched symbol') + ', ' + plural(n(s.renames), 'rename') + ', ' + plural(n(s.manual), 'manual entry').replace(/entrys$/, 'entries')
    + ', ' + plural(n(s.exceptions), 'exception') + '.');
  const unmatched = asArr(k.unmatched).filter(u => u && typeof u === 'object');
  if (unmatched.length) {
    lines.push('', unmatched.length + ' could not be matched to the new legend and will be kept, marked "Not in the imported legend":');
    lines.push(unmatched.slice(0, 15).map(u => str(u.name)).join(', ') + (unmatched.length > 15 ? ', and ' + (unmatched.length - 15) + ' more' : ''));
  }
  if (n(s.dropped)) lines.push('', plural(n(s.dropped), 'symbol') + ' with no notes or aliases ' + (n(s.dropped) === 1 ? 'is' : 'are') + ' not in the new legend and will go.');
  const now = asArr(k.exceptionsNowInLibrary).filter(x => typeof x === 'string');
  if (now.length) lines.push('', 'These exceptions now have a symbol: ' + now.join(', '));
  lines.push('', 'Replace the library?');
  return lines.join('\n');
}

const REFUSALS = {
  changed: 'Someone else has saved the symbol library since you loaded it. Nothing was overwritten. Reload from the folder, then make your change again.',
  unreadable: 'symbol-library.json could not be read just now, so nothing was saved and nothing was overwritten. Try again in a moment.',
  gone: 'The symbol library file has gone from the folder since you loaded it. Nothing was saved. Reload from the folder to check, then save again.',
  exists: 'This folder already holds a symbol library that this session has not loaded. Nothing was overwritten.',
};
/** Why a save was refused, in words. */
export function refusalMessage(reason) {
  return Object.prototype.hasOwnProperty.call(REFUSALS, reason) ? REFUSALS[reason] : 'The symbol library was not saved. Nothing was overwritten.';
}
