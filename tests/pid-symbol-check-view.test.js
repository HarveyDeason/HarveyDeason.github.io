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
  assert.ok(rowFor(html, '21-ZI-5001').includes('Instrument bubbles are not checked yet.'));
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

test('resultsHtml: a check that hit its time limit says so', () => {
  assert.ok(V.resultsHtml({ ...RESULT, timedOut: true }).includes('The check stopped at its time limit. Tags it did not reach are marked Not checked.'));
  assert.ok(!V.resultsHtml(RESULT).includes('time limit'));
});

test('progressHtml: how far it has got, and a way to stop', () => {
  const html = V.progressHtml(3, 71);
  assert.ok(html.includes('Checking symbols: 3 of 71 tags'));
  assert.ok(html.includes('data-act="sym-cancel"'));
  assert.ok(V.progressHtml(HOSTILE, null).includes('Checking symbols: 0 of 0 tags'));
});
