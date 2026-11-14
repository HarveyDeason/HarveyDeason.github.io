// assets/js/pid-precheck.js
// Sheet pre-checks for the P&ID Tag Register: can a PDF's tags be read at all,
// and from where? A plotted drawing has a text layer. A printed one has none.
// A drawing whose labels were drawn as linework can still carry them as
// comments (AutoCAD stores SHX text that way).
//
// This module DECIDES; the tool only fetches from pdf.js and shows the answer.
// Everything here is node-testable. No DOM, no File System Access.
//
// NOTHING FROM A REAL DRAWING BELONGS HERE. assets/js/ is served publicly:
// no drawing, no tag list, no DS310 lookup table. The lookup tables stay in
// the tool and arrive inside `extractOptions`, as pid-core.js requires.

import { extractTags } from './pid-core.js';
import { esc } from './pid-symbols-view.js';

function asObj(x) { return x && typeof x === 'object' ? x : {}; }
function asArr(x) { return Array.isArray(x) ? x : []; }
function str(x) { return typeof x === 'string' ? x : ''; }
function num(x) { return typeof x === 'number' && Number.isFinite(x) ? x : 0; }
function count(x) { return Math.max(0, Math.floor(num(x))); }
function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

// AutoCAD writes this as the author of every comment that stands in for a
// piece of SHX text. A product string, not client data.
export const SHX_COMMENT_AUTHOR = 'AutoCAD SHX Text';

// ── Comments ──────────────────────────────────────────────────────────────

/**
 * A comment's text with AutoCAD's inline formatting codes removed.
 *
 * The codes come through raw: on a real plotted drawing every one of 25
 * comments read `\pxqc;{\W0.85;M}` for a single letter M. Left in, they would
 * sit in the middle of a tag and stop it matching.
 */
export function plainCommentText(s) {
  return str(s)
    .replace(/\\P/g, ' ')                       // paragraph break
    .replace(/\\~/g, ' ')                       // non-breaking space
    // Underline, overline and strike-through switch on and off with no
    // semicolon. They go first: left in, \L would read as the start of a
    // semicolon code and swallow text up to the next semicolon.
    .replace(/\\[LlOoKk]/g, '')
    .replace(/\\[A-Za-z][^;\\{}]*;/g, '')       // \W0.85;  \pxqc;  \fArial|b0|i0;
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Split a page's annotations into drawing text and everything else.
 *
 * Only comments written by `options.author` count as drawing text. Anything
 * else is a person's mark-up: it is COUNTED, so the user can be told it was
 * there, and never read. A reviewer typing "should be 21-XX-9001" onto a
 * printed drawing must not put that tag in the register.
 */
export function sheetComments(annotations, options) {
  const want = (str(asObj(options).author) || SHX_COMMENT_AUTHOR).toLowerCase();
  const comments = [];
  let other = 0;
  for (const raw of asArr(annotations)) {
    try {
      const a = asObj(raw);
      const text = plainCommentText(str(asObj(a.contentsObj).str) || str(a.contents));
      if (!text) continue;
      const author = (str(asObj(a.titleObj).str) || str(a.title)).toLowerCase();
      if (author !== want) { other++; continue; }
      // pdf.js hands some values over as typed arrays, so Array.isArray alone is not enough.
      const r = (Array.isArray(a.rect) || ArrayBuffer.isView(a.rect)) ? Array.from(a.rect) : [];
      comments.push({ text, rect: r.length === 4 && r.every(Number.isFinite) ? r : null });
    } catch { /* an annotation that cannot be read is left out */ }
  }
  return { comments, other };
}

/** How many text items actually hold text. pdf.js also emits blank ones for spacing. */
export function countTextItems(items) {
  let n = 0;
  for (const i of asArr(items)) if (str(asObj(i).str).trim()) n++;
  return n;
}

// ── Sheet size and producing program ──────────────────────────────────────

// ISO A sizes in millimetres, short side then long side.
const A_SIZES = [['A0', 841, 1189], ['A1', 594, 841], ['A2', 420, 594], ['A3', 297, 420], ['A4', 210, 297]];
const SIZE_TOLERANCE_MM = 3;

/** A page size in points as millimetres, named when it is an A size. */
export function paperSize(widthPt, heightPt) {
  const w = Math.round(num(widthPt) / 72 * 25.4), h = Math.round(num(heightPt) / 72 * 25.4);
  if (w <= 0 || h <= 0) return { name: '', orientation: '', widthMm: 0, heightMm: 0, label: 'not known' };
  const short = Math.min(w, h), long = Math.max(w, h);
  const hit = A_SIZES.find(a => Math.abs(a[1] - short) <= SIZE_TOLERANCE_MM && Math.abs(a[2] - long) <= SIZE_TOLERANCE_MM);
  const orientation = w > h ? 'landscape' : w < h ? 'portrait' : 'square';
  const mm = w + ' × ' + h + ' mm';
  return { name: hit ? hit[0] : '', orientation, widthMm: w, heightMm: h,
    label: hit ? hit[0] + ' ' + orientation + ' (' + mm + ')' : mm };
}

/**
 * The program that made the PDF, from its information dictionary.
 *
 * Only Creator and Producer are read. Author and Title are deliberately left
 * alone: on real drawings they hold a person's name and a drawing number.
 */
export function producedBy(info) {
  const clean = x => str(x).replace(/\s+/g, ' ').trim().slice(0, 120);
  let creator = '', producer = '';
  try {
    const i = asObj(info);
    creator = clean(i.Creator);
    producer = clean(i.Producer);
  } catch { /* a throwing getter reads as "not recorded" */ }
  if (creator && producer && creator !== producer) return creator + ' / ' + producer;
  return creator || producer;
}

// ── The status, and which tags the import registers ───────────────────────

export const STATUS_LABELS = { readable: 'Readable', comments: 'Readable from comments', none: 'No readable text' };

// "Tags" always means confirmed plus review: a drawing that yields only
// review candidates has still had its text read.
function tagTotal(result) {
  const r = asObj(result);
  return asArr(r.confirmed).length + asArr(r.review).length;
}

/**
 * One status per sheet, from where its text can be read.
 *
 * The status is about TEXT, not tags. A supplier's drawing can keep every
 * label in comments and hold no DS310 tag at all; it is still "Readable from
 * comments", with a tag count of zero stated beside it.
 */
export function sheetStatus(counts) {
  const c = asObj(counts);
  if (count(c.textTagCount) > 0) return 'readable';
  if (count(c.commentCount) > 0) return 'comments';
  return count(c.textItemCount) > 0 ? 'readable' : 'none';
}

function tagsSentence(check) {
  const tags = count(check.tagCount), review = count(check.reviewCount);
  if (tags + review === 0) return 'No DS310 tags found.';
  return plural(tags, 'DS310 tag') + ' found' + (review ? ', plus ' + review + ' for review' : '') + '.';
}

function sheetFindings(check) {
  const out = [];
  if (check.status === 'none') out.push('No readable text: this PDF was printed, not plotted. Tags cannot be read.');
  if (check.status === 'comments') out.push('Text read from drawing comments.');
  out.push(tagsSentence(check));
  const only = count(check.commentOnlyTagCount);
  if (only === 1) out.push('1 more tag appears only in drawing comments and was not registered.');
  if (only > 1) out.push(only + ' more tags appear only in drawing comments and were not registered.');
  const markup = count(check.otherAnnotationCount);
  if (markup) out.push(plural(markup, 'mark-up comment') + ' ignored.');
  out.push('Made with: ' + (str(check.producedBy) || 'not recorded in the PDF') + '.');
  const pages = count(check.pageCount);
  out.push('Sheet size: ' + (str(asObj(check.paper).label) || 'not known') + (pages > 1 ? ', ' + pages + ' pages' : '') + '.');
  return out;
}

/**
 * Judge one PDF. `text` is the text the import read from the text layer;
 * `facts` is what readSheetFacts gathered; `extractOptions` goes straight to
 * extractTags. Returns null when there are no usable facts, and never throws.
 *
 * THE RULE THAT PROTECTS THE REGISTER: comments are read for tags only when
 * the text layer gives none at all. For every drawing that reads from its
 * text layer, `result` is the very object extractTags returned for the text.
 */
export function assessSheet(input) {
  try {
    const inp = asObj(input), facts = asObj(inp.facts), options = asObj(inp.extractOptions);
    if (facts.ok !== true) return null;
    const pages = asArr(facts.pages).map(asObj);
    const commentsByPage = pages.map(p => asArr(p.comments).map(c => str(asObj(c).text)).filter(Boolean));

    const textResult = extractTags(inp.text, options);
    // Comment text is shaped the way extractTextFromPDF shapes the text layer:
    // a space between items, a newline after each page.
    const commentResult = extractTags(commentsByPage.map(list => list.join(' ')).join('\n'), options);

    const useComments = tagTotal(textResult) === 0 && tagTotal(commentResult) > 0;
    const result = useComments ? commentResult : textResult;
    const source = tagTotal(result) === 0 ? 'none' : (useComments ? 'comments' : 'text');

    let commentOnlyTagCount = 0;
    if (source === 'text') {
      const inText = new Set(textResult.confirmed.concat(textResult.review).map(t => t.tag));
      commentOnlyTagCount = commentResult.confirmed.concat(commentResult.review).filter(t => !inText.has(t.tag)).length;
    }

    const textItemCount = pages.reduce((n, p) => n + count(p.textItemCount), 0);
    const commentCount = commentsByPage.reduce((n, list) => n + list.length, 0);
    const first = pages[0] || {};
    const check = {
      status: sheetStatus({ textItemCount, textTagCount: tagTotal(textResult), commentCount }),
      source,
      result,
      tagCount: result.confirmed.length,
      reviewCount: result.review.length,
      textItemCount,
      commentCount,
      otherAnnotationCount: pages.reduce((n, p) => n + count(p.otherAnnotations), 0),
      commentOnlyTagCount,
      producedBy: producedBy(facts.info),
      paper: paperSize(first.width, first.height),
      pageCount: pages.length,
    };
    check.findings = sheetFindings(check);
    return check;
  } catch {
    return null;
  }
}

/**
 * What the import registers. Returns `textResult` ITSELF, the same object,
 * unless it holds no tags and the check read some from comments. It never
 * builds a new result, so a drawing that reads today cannot come out changed.
 */
export function tagsToRegister(textResult, check) {
  if (tagTotal(textResult) > 0) return textResult;
  const c = asObj(check);
  if (c.source === 'comments' && tagTotal(c.result) > 0) return c.result;
  return textResult;
}

/**
 * Compare what an import would read now with the tags the register already
 * holds for that revision. Read-only: this is how "re-importing changes
 * nothing" is checked without re-importing.
 */
export function compareWithRegister(result, snapshotTags) {
  const now = new Map(), held = new Map();
  const r = asObj(result);
  for (const t of asArr(r.confirmed)) now.set(str(asObj(t).tag), false);
  for (const t of asArr(r.review)) { const tag = str(asObj(t).tag); if (!now.has(tag)) now.set(tag, true); }
  for (const t of asArr(snapshotTags)) held.set(str(asObj(t).tag), !!asObj(t).isReview);
  const added = [...now.keys()].filter(k => !held.has(k)).sort();
  const missing = [...held.keys()].filter(k => !now.has(k)).sort();
  const changed = [...now.keys()].filter(k => held.has(k) && held.get(k) !== now.get(k)).sort();
  return { same: !added.length && !missing.length && !changed.length,
    nowCount: now.size, registerCount: held.size, added, missing, changed };
}

// ── Fetching the facts from pdf.js ────────────────────────────────────────

const NO_FACTS = () => ({ ok: false, text: '', pages: [], info: { Creator: '', Producer: '' } });

/**
 * Gather what assessSheet needs from an open pdf.js document. The caller opens
 * the document; this module never imports pdf.js. Never rejects.
 *
 * `text` is built exactly as the tool's extractTextFromPDF builds it, and a
 * golden test holds the two together. The tool's import still reads its tag
 * text with its own function; `text` here is for the Gate 2 script.
 *
 * A page that cannot be read fails the whole read (ok: false): a half-read
 * drawing must not be given a status. Comments and metadata are extras, so a
 * failure there only leaves them out.
 */
export async function readSheetFacts(doc) {
  try {
    if (!doc || !Number.isInteger(doc.numPages) || doc.numPages < 1) return NO_FACTS();
    const pages = [];
    let text = '';
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const items = (await page.getTextContent()).items;
      text += items.map(i => i.str).join(' ') + '\n';
      let annotations = [];
      try { annotations = await page.getAnnotations(); } catch { annotations = []; }
      const read = sheetComments(annotations);
      pages.push({ width: viewport.width, height: viewport.height, textItemCount: countTextItems(items),
        comments: read.comments, otherAnnotations: read.other });
    }
    const info = { Creator: '', Producer: '' };
    try {
      const meta = asObj(asObj(await doc.getMetadata()).info);
      info.Creator = str(meta.Creator);
      info.Producer = str(meta.Producer);
    } catch { /* not recorded */ }
    return { ok: true, text, pages, info };
  } catch {
    return NO_FACTS();
  }
}

// ── What the user sees ────────────────────────────────────────────────────
// The producing program comes out of a PDF and the compared tags come out of
// a shared file other people write to. Both are untrusted text, so the markup
// is built here, where it is tested, and every such value goes through esc().

const NOT_CHECKED = 'This sheet could not be checked.';
const LISTED_TAGS = 10;

// hasOwnProperty, not `in`: a status of 'constructor' must not pass as known.
function usable(check) {
  return !!check && typeof check === 'object' && Object.prototype.hasOwnProperty.call(STATUS_LABELS, check.status);
}

/** The status as a chip, with every finding on hover. */
export function checkChipHtml(check) {
  if (!usable(check)) return '<span class="pc-chip pc-unknown" title="' + NOT_CHECKED + '">Not checked</span>';
  return '<span class="pc-chip pc-' + check.status + '" title="' + esc(asArr(check.findings).map(str).join(' ')) + '">'
    + esc(STATUS_LABELS[check.status]) + '</span>';
}

/** The chip and the tag count: one cell of the import dialog. */
export function checkCellHtml(check) {
  if (!usable(check)) return checkChipHtml(check);
  return checkChipHtml(check) + ' <span class="pc-note">' + esc(tagsSentence(check)) + '</span>';
}

function tagList(tags) {
  const list = asArr(tags).map(str);
  return list.slice(0, LISTED_TAGS).join(', ') + (list.length > LISTED_TAGS ? ' and ' + (list.length - LISTED_TAGS) + ' more' : '');
}

function compareHtml(compare) {
  if (!compare || typeof compare !== 'object') return '';
  if (compare.same === true) {
    return ' <span class="pc-compare pc-same">Tags read now match the register (' + count(compare.nowCount) + ').</span>';
  }
  const parts = [];
  const add = (tags, phrase) => { const l = asArr(tags); if (l.length) parts.push(l.length + ' ' + phrase + ' (' + tagList(l) + ')'); };
  add(compare.added, 'not in the register');
  add(compare.missing, 'in the register but not read now');
  add(compare.changed, 'changed between confirmed and review');
  return ' <span class="pc-compare pc-differ">' + esc('Tags read now differ from the register: ' + parts.join('; ') + '.') + '</span>';
}

/** The chip, every finding, and how the tags read now compare with the register: the line on a sheet. */
export function checkHtml(check, compare) {
  if (!usable(check)) {
    return '<div class="pc-line">' + checkChipHtml(check) + ' <span class="pc-finding">' + NOT_CHECKED + '</span></div>';
  }
  return '<div class="pc-line">' + checkChipHtml(check)
    + asArr(check.findings).map(f => ' <span class="pc-finding">' + esc(str(f)) + '</span>').join('')
    + compareHtml(compare) + '</div>';
}

/**
 * Plain text for the line under the import dialog's table: how many of the
 * PDFs about to be imported will be registered with no tags. Empty when every
 * one of them reads. This is what stops a tagless drawing going in silently.
 */
export function importSummary(checks) {
  const list = asArr(checks), n = list.length;
  const noText = list.filter(c => usable(c) && c.status === 'none').length;
  const noTags = list.filter(c => usable(c) && c.status !== 'none' && count(c.tagCount) + count(c.reviewCount) === 0).length;
  const unchecked = list.filter(c => !usable(c)).length;
  const out = [];
  if (noText) out.push(noText + ' of ' + plural(n, 'PDF') + ' ' + (noText === 1 ? 'has' : 'have') + ' no readable text.');
  if (noTags) out.push(noTags + ' of ' + n + ' ' + (noTags === 1 ? 'has' : 'have') + ' readable text but no DS310 tags.');
  if (unchecked) out.push(unchecked + ' of ' + n + ' could not be checked.');
  if (noText + noTags) out.push('Importing registers ' + (noText + noTags === 1 ? 'it' : 'them') + ' with no tags.');
  return out.join(' ');
}
