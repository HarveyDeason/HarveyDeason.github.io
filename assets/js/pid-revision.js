// assets/js/pid-revision.js
// Title-block reading for the P&ID Tag Register: which revision a sheet is at,
// and the date of that revision. Pure functions on the sheet's extracted text,
// moved out of tools-src/pid-tag-register.html (which is gitignored and
// encrypted) so they can be node-tested. The tool loads this as a module and
// calls it through window.PidRevision.

const MONTHS = {JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12};

// What a revision row's description column can say after the revision token.
// "FOR <purpose>" is open-ended (FOR INFORMATION, FOR PRELIMINARY, FOR COSTING…):
// contractors word it their own way, and the highest row is what identifies
// the drawing whatever that wording is.
const DESC_SRC = '(?:APPROVED|ISSUED|SUITABLE|TAGGING|UPDATED|REVISED|PRELIMINARY|CONSTRUCTION|FIRST\\s+ISSUE|FOR\\s+[A-Z]{3,})';

export function detectRevision(text) {
  const t = text.toUpperCase();
  const TOK = '(C\\d{1,2}|P\\d{1,2})';
  const DESC = DESC_SRC;
  const candidates = [];
  [new RegExp('\\bNTS\\s+' + TOK + '\\b', 'g'),
   new RegExp('\\bSTATUS\\s+' + TOK + '\\b', 'g'),
   new RegExp('\\bREV\\.?\\s*:?\\s*' + TOK + '\\b', 'g')]
    .forEach(function(re) { let m; while ((m = re.exec(t)) !== null) candidates.push(m[1]); });
  const rowRe = new RegExp('\\b' + TOK + '\\s+' + DESC, 'g');
  let m;
  while ((m = rowRe.exec(t)) !== null) candidates.push(m[1]);
  if (candidates.length) {
    candidates.sort(function(a, b) {
      const ca = a[0] === 'C' ? 1 : 0, cb = b[0] === 'C' ? 1 : 0;
      if (ca !== cb) return cb - ca;
      return parseInt(b.slice(1), 10) - parseInt(a.slice(1), 10);
    });
    return candidates[0];
  }
  const patterns = [
    /\bREV\.?\s*:?\s*([A-Z]\d{0,2})\b/,
    /NTS\s+([A-Z]{1,2}\d{0,2})\b/,
  ];
  for (const pat of patterns) {
    const mm = t.match(pat);
    if (mm && mm[1] && mm[1].length <= 4 && !/^(BY|NO|OF|ID|MK|CHK|APP|GA)$/.test(mm[1])) return mm[1];
  }
  return null;
}

export function parseUKDate(str) {
  if (!str) return '';
  const t = String(str).trim().toUpperCase();
  let m = t.match(/^(\d{1,2})[\/\.\-\s](\d{1,2})[\/\.\-\s](\d{2}|\d{4})$/);
  let d, mo, y;
  if (m) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else {
    m = t.match(/^(\d{1,2})[\s\-\.\/]?([A-Z]{3})[A-Z]*[\s\-\.\/]?(\d{2}|\d{4})$/);
    if (!m || !MONTHS[m[2]]) return '';
    d = +m[1]; mo = MONTHS[m[2]]; y = +m[3];
  }
  if (y < 100) y += y < 70 ? 2000 : 1900;
  if (d < 1 || d > 31 || mo < 1 || mo > 12 || y < 1990 || y > 2100) return '';
  return y + '-' + String(mo).padStart(2,'0') + '-' + String(d).padStart(2,'0');
}

export function detectDrawingDate(text, rev) {
  const t = text.toUpperCase();
  const dateRe = /\b(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2}|\d{4})\b|\b(\d{1,2})[\s\-]?(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-]?(\d{2}|\d{4})\b/g;
  function isoFrom(m) {
    if (m[1] !== undefined && m[1] !== null && m[1] !== '') return parseUKDate(m[1] + '/' + m[2] + '/' + m[3]);
    return parseUKDate(m[4] + ' ' + m[5] + ' ' + m[6]);
  }
  if (rev) {
    const revTokRe = /\b(C\d{1,2}|P\d{1,2})\b/g;
    const descRe = new RegExp('^\\s*' + DESC_SRC);
    let bestRow = '', bestAny = '';
    let idx = -1;
    while ((idx = t.indexOf(rev, idx + 1)) !== -1) {
      const before = t[idx - 1], after = t[idx + rev.length];
      if ((before && /[A-Z0-9]/.test(before)) || (after && /[A-Z0-9]/.test(after))) continue;
      let win = t.slice(idx + rev.length, idx + rev.length + 180);
      revTokRe.lastIndex = 0;
      const nxt = revTokRe.exec(win);
      if (nxt) win = win.slice(0, nxt.index);
      dateRe.lastIndex = 0;
      const m = dateRe.exec(win);
      if (!m) continue;
      const iso = isoFrom(m);
      if (!iso) continue;
      const isRow = descRe.test(win) || m.index < 12;
      if (isRow) { if (iso > bestRow) bestRow = iso; }
      else       { if (iso > bestAny) bestAny = iso; }
    }
    if (bestRow) return bestRow;
    if (bestAny) return bestAny;
  }
  let best = '';
  dateRe.lastIndex = 0;
  let m;
  while ((m = dateRe.exec(t)) !== null) {
    const iso = isoFrom(m);
    if (iso && iso > best) best = iso;
  }
  return best;
}
