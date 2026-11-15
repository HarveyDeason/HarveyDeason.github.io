import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../assets/js/pid-symbol-check-view.js';
import { checkSheet } from '../assets/js/pid-symbol-check.js';
import { LIBRARY, LOOKUPS, SHEET } from './fixtures/symbol-check-sheet.js';

const RESULT = checkSheet({ ...SHEET, library: LIBRARY, lookups: LOOKUPS });
const HOSTILE = '<img src=x onerror=alert(1)>';
const rows = html => html.split('<li>').slice(1);
const rowFor = (html, tag) => rows(html).find(r => r.includes(tag));

test('blockerText: why the check cannot run, or nothing when it can', () => {
  const ok = { sheetOpen: true, status: 'readable', hasLibrary: true, running: false };
  assert.equal(V.blockerText(ok), '');
  assert.equal(V.blockerText({ ...ok, sheetOpen: false }), 'Open a sheet first.');
  assert.equal(V.blockerText({ ...ok, running: true }), 'A check is running.');
  assert.equal(V.blockerText({ ...ok, hasLibrary: false }), 'Load the symbol library first, on the Symbols tab.');
  assert.equal(V.blockerText({ ...ok, status: '' }), 'This sheet has not been pre-checked yet.');
  for (const status of ['comments', 'none', 'constructor']) {
    assert.equal(V.blockerText({ ...ok, status }), 'Only a sheet that is Readable can be checked: its tags need positions on the page.');
  }
  assert.equal(V.blockerText(null), 'Open a sheet first.');
});

test('resultsHtml: the family note, the counts, and a row for every tag in order of concern', () => {
  const html = V.resultsHtml(RESULT);
  assert.ok(html.includes(V.FAMILY_NOTE));
  assert.match(V.FAMILY_NOTE, /right family/);
  assert.match(V.FAMILY_NOTE, /cannot tell whether the right member of that family was chosen/);
  for (const part of ['3 OK', '1 OK, off size', '1 Wrong family', '1 Approved exception', '1 Needs a look', '4 Not checked',
    'Results are shown here and are not saved.']) assert.ok(html.includes(part), part);
  assert.equal(html.split('data-act="sym-jump"').length - 1, 11);
  assert.ok(rows(html)[0].includes('Recognised as WIDGET, BARRED (tag identifier W), which does not fit G.'));
  assert.ok(rowFor(html, '21-W-1003').includes('drawn at 120% of legend size'));
  assert.ok(rowFor(html, '21-W-1002').includes('filled in (normally closed)'));
  assert.ok(!rowFor(html, '21-W-1001').includes('filled in'));
  assert.ok(rowFor(html, '21-P-6001').includes('One of: PENNANT, LEFT, PENNANT, RIGHT'));
  assert.ok(rowFor(html, '21-W-1004').includes('Approved exceptions for this family: Folding widget. The tool cannot tell whether this item is one of them.'));
  assert.ok(rowFor(html, '21-G-2002').includes('Nothing recognised within 60 pt. Could be non-standard, modified, or a gap in the library.'));
  assert.ok(rowFor(html, '21-ZI-5001').includes('The library has no tag bubbles. Import the legend again to add them.'));
  // data-i is the verdict's place in the result, whatever order the rows are shown in
  assert.ok(rows(html)[0].includes('data-i="' + RESULT.verdicts.findIndex(v => v.tag === '21-G-2001') + '"'));
});

test('resultsHtml: everything from the result is shown as text', () => {
  const v = { tag: HOSTILE, fc: HOSTILE, verdict: 'ok', why: HOSTILE, symbol: HOSTILE, oneOf: [HOSTILE, HOSTILE], tagId: HOSTILE,
    exceptions: [HOSTILE], sizePct: 100, score: 1, filled: false, letters: HOSTILE, tagBox: [0, 0, 1, 1], box: [0, 0, 1, 1] };
  const all = ['ok', 'off-size', 'wrong-family', 'exception', 'look', 'not-checked', 'constructor', HOSTILE].map(verdict => ({ ...v, verdict }));
  const html = V.resultsHtml({ ok: true, verdicts: [...all, null, 5], ms: HOSTILE });
  assert.ok(!html.includes('<img'));
  assert.equal(html.split('data-act="sym-jump"').length - 1, 8);
  assert.equal(html.split('sc-not-checked').length - 1, 3);   // the two unknown verdicts are shown as Not checked
  assert.ok(!V.boxRects({ ok: true, verdicts: all }, 1).some(b => b.title.includes('<img') && /sc-|class=/.test(b.kind)));
  assert.deepEqual([...new Set(V.boxRects({ ok: true, verdicts: all }, 1).map(b => b.kind))].sort(),
    ['exception', 'look', 'not-checked', 'off-size', 'ok', 'wrong-family']);
});

test('resultsHtml: a check that did not run says so', () => {
  for (const bad of [null, undefined, 'x', 5, { ok: false }, { ok: true }, { ok: false, why: HOSTILE }]) {
    const html = V.resultsHtml(bad);
    assert.ok(html.includes('The symbol check could not run on this sheet.'), String(bad));
    assert.ok(!html.includes('<img'));
  }
  assert.ok(V.resultsHtml({ ok: false, why: 'no-tags' }).includes('This sheet has no confirmed tags to check.'));
});

test('boxRects: one rectangle per tag, around the symbol when there is one', () => {
  const rects = V.boxRects(RESULT, 2);
  assert.equal(rects.length, 11);
  const i = RESULT.verdicts.findIndex(v => v.tag === '21-W-1001');
  const r = rects.find(x => x.i === i), b = RESULT.verdicts[i].box;
  assert.deepEqual([r.kind, r.left, r.top, r.width, r.height], ['ok', b[0] * 2 - 3, b[1] * 2 - 3, (b[2] - b[0]) * 2 + 6, (b[3] - b[1]) * 2 + 6]);
  assert.match(r.title, /^21-W-1001: OK/);
  const j = RESULT.verdicts.findIndex(v => v.tag === '21-X-7001');
  const t = rects.find(x => x.i === j), tb = RESULT.verdicts[j].tagBox;
  assert.deepEqual([t.kind, t.left, t.top], ['not-checked', tb[0] * 2 - 3, tb[1] * 2 - 3]);   // no symbol: the tag itself
  for (const bad of [NaN, 0, -1, null, 'x']) assert.deepEqual(V.boxRects(RESULT, bad), []);
  for (const bad of [null, 'x', { ok: false }, { ok: true, verdicts: 'x' }]) assert.deepEqual(V.boxRects(bad, 1), []);
  assert.deepEqual(V.boxRects({ ok: true, verdicts: [{ tag: 'a', verdict: 'ok', box: [0, 0, NaN, 1], tagBox: null }] }, 1), []);
});

test('resultsHtml: a row with nothing recognised says which symbol came closest, and by how much', () => {
  const v = RESULT.verdicts.find(x => x.verdict === 'look');
  const near = { ...RESULT, verdicts: [{ ...v, closest: { symbol: 'GADGET', score: 0.857 } }, { ...v, tag: '21-G-9', closest: { symbol: HOSTILE, score: HOSTILE } },
    { ...v, tag: '21-G-8', verdict: 'exception', exceptions: ['Sliding gadget'], closest: { symbol: 'GADGET', score: 0.5 } }] };
  const html = V.resultsHtml(near);
  assert.ok(html.includes('Nothing recognised within 60 pt. Closest in its family: GADGET at 86%. Could be non-standard, modified, or a gap in the library.'));
  assert.ok(html.includes('Nothing recognised. Closest in its family: GADGET at 50%. Approved exceptions for this family: Sliding gadget.'));
  assert.ok(!html.includes('<img'));
  assert.ok(V.boxRects(near, 1)[0].title.includes('Closest in its family: GADGET at 86%.'));
  assert.ok(!V.resultsHtml(RESULT).includes('Closest in its family'));
});

test('resultsHtml: the list folds away to one line, so the drawing can be seen', () => {
  const html = V.resultsHtml(RESULT);
  assert.ok(html.startsWith('<details class="sc-results" open>'), html.slice(0, 60));
  assert.ok(html.endsWith('</details>'));
  const summary = html.slice(html.indexOf('<summary'), html.indexOf('</summary>'));
  // what stays on screen when folded: the counts, and the limit of what the check can say
  for (const part of ['3 OK', '1 Wrong family', '4 Not checked', 'It checks the family of symbol, not which member of it.']) assert.ok(summary.includes(part), part);
  assert.ok(!summary.includes('data-act'));
  const body = html.slice(html.indexOf('</summary>'));
  assert.ok(body.includes(V.FAMILY_NOTE) && body.includes('Results are shown here and are not saved.') && body.includes('<ul class="sc-list">'));
});

test('resultsHtml: a check that hit its time limit says so', () => {
  assert.ok(V.resultsHtml({ ...RESULT, timedOut: true }).includes('The check stopped at its time limit. Tags it did not reach are marked Not checked.'));
  assert.ok(!V.resultsHtml(RESULT).includes('time limit'));
});

test('verdictSentence, kindOf and ROW_ORDER: the report says exactly what the screen says', () => {
  const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const html = V.resultsHtml(RESULT);
  for (const v of RESULT.verdicts) {
    const row = rows(html).find(r => r.includes('data-i="' + RESULT.verdicts.indexOf(v) + '"'));
    const detail = row.slice(row.indexOf('<span class="sc-detail">') + '<span class="sc-detail">'.length, row.indexOf('</span></button>'));
    assert.equal(V.verdictSentence(v), decode(detail), v.tag);
  }
  assert.equal(V.kindOf({ verdict: 'constructor' }), 'not-checked');
  assert.equal(V.kindOf({ verdict: 'look' }), 'look');
  assert.equal(V.ROW_ORDER[0], 'wrong-family');
  assert.deepEqual(V.SUMMARY_ORDER, ['ok', 'off-size', 'wrong-family', 'exception', 'look', 'not-checked']);
  assert.equal(V.verdictSentence(null), 'Not checked.');
});

test('progressHtml: how far it has got, and a way to stop', () => {
  const html = V.progressHtml(3, 71);
  assert.ok(html.includes('Checking symbols: 3 of 71 tags'));
  assert.ok(html.includes('data-act="sym-cancel"'));
  assert.ok(V.progressHtml(HOSTILE, null).includes('Checking symbols: 0 of 0 tags'));
});

// ── Tag bubbles ───────────────────────────────────────────────────────────
const bv = (tag, verdict, more = {}) => ({ tag, fc: 'ZI', verdict, why: '', symbol: '', oneOf: [], tagId: '', exceptions: [], sizePct: 100,
  score: 1, filled: false, letters: '', tagBox: [0, 0, 1, 1], box: [0, 0, 1, 1], closest: null, bubble: true, ...more });
const BUBBLE_RESULT = { ok: true, ms: 10, timedOut: false, verdicts: [
  bv('21-ZI-1', 'ok', { symbol: 'RING' }), bv('21-ZI-2', 'ok', { symbol: 'RING' }), bv('21-ZI-3', 'off-size', { symbol: 'HEXAGON', sizePct: 125 }),
  bv('21-ZI-4', 'look', { closest: { symbol: 'BOXED RING', score: 0.56 } }), bv('21-W-5', 'ok', { symbol: 'WIDGET', bubble: false })] };

test('verdictSentence: a bubble reads as a tag bubble of its kind; one not found says so and names the closest', () => {
  assert.equal(V.verdictSentence(bv('t', 'ok', { symbol: 'RING' })), 'Tag bubble: RING.');
  assert.equal(V.verdictSentence(bv('t', 'off-size', { symbol: 'RING', sizePct: 125 })), 'Tag bubble: RING, drawn at 125% of legend size.');
  assert.equal(V.verdictSentence(bv('t', 'ok', { symbol: 'RING', oneOf: ['RING', 'RING, BROKEN BAR'] })), 'Tag bubble: One of: RING, RING, BROKEN BAR.');
  assert.equal(V.verdictSentence(bv('t', 'look', { closest: { symbol: 'BOXED RING', score: 0.56 } })),
    'No standard tag bubble recognised round the tag. Closest: BOXED RING at 56%. Could be non-standard, modified, or a gap in the library.');
  assert.equal(V.verdictSentence(bv('t', 'look')), 'No standard tag bubble recognised round the tag. Could be non-standard, modified, or a gap in the library.');
  assert.equal(V.verdictSentence(bv('t', 'ok', { symbol: 'WIDGET', bubble: false })), 'WIDGET.');
});

test('bubbleSummary: counts recognised bubbles by kind, most first', () => {
  assert.equal(V.bubbleSummary(BUBBLE_RESULT), 'Tag bubbles: 2 RING, 1 HEXAGON');
  assert.equal(V.bubbleSummary(RESULT), '');
  for (const bad of [null, undefined, 5, { verdicts: 'x' }, { verdicts: [null, 7] }]) assert.equal(V.bubbleSummary(bad), '');
});

test('resultsHtml: shows the tag bubble line, escaped', () => {
  assert.ok(V.resultsHtml(BUBBLE_RESULT).includes('Tag bubbles: 2 RING, 1 HEXAGON'));
  const evil = { ...BUBBLE_RESULT, verdicts: [bv('21-ZI-1', 'ok', { symbol: HOSTILE })] };
  assert.ok(!V.resultsHtml(evil).includes('<img'));
  assert.ok(!V.resultsHtml(RESULT).includes('Tag bubbles'));
});
