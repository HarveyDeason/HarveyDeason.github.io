import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../assets/js/pid-symbol-check-view.js';
import { checkSheet } from '../assets/js/pid-symbol-check.js';
import { LIBRARY, LOOKUPS, SHEET } from './fixtures/symbol-check-sheet.js';

const RESULT = checkSheet({ ...SHEET, library: LIBRARY, lookups: LOOKUPS });
const HOSTILE = '<img src=x onerror=alert(1)>';
const rows = html => html.split('<li>').slice(1);
const rowFor = (html, tag) => rows(html).find(r => r.includes('data-act="sym-jump"') && r.includes(tag));   // a tag's verdict row (a shape row may also name the tag in its reason)

test('blockerText: why the check cannot run, or nothing when it can', () => {
  const ok = { sheetOpen: true, status: 'readable', hasLibrary: true, running: false };
  assert.equal(V.blockerText(ok), '');
  assert.equal(V.blockerText({ ...ok, sheetOpen: false }), 'Open a sheet first.');
  assert.equal(V.blockerText({ ...ok, running: true }), 'A check is running.');
  assert.equal(V.blockerText({ ...ok, hasLibrary: false }), 'Load the symbol library first, on the Symbols tab.');
  assert.equal(V.blockerText({ ...ok, status: '' }), 'This sheet has not been pre-checked yet.');
  assert.equal(V.blockerText({ ...ok, status: 'comments' }), '');
  assert.equal(V.blockerText({ ...ok, status: 'printed' }), '');
  assert.equal(V.blockerText({ ...ok, status: 'scanned' }), 'This is a scanned image: scanned sheets cannot be checked yet.');
  assert.equal(V.blockerText({ ...ok, status: 'none' }), 'This sheet has no readable text and no linework to check.');
  assert.equal(V.blockerText({ ...ok, status: 'constructor' }), 'Only a Readable, Readable from comments or Printed sheet can be checked.');
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
  assert.ok(rows(html).filter(r => r.includes('data-act="sym-jump"'))[0].includes('Recognised as WIDGET, BARRED (tag identifier W), which does not fit G.'));
  assert.ok(rowFor(html, '21-W-1003').includes('drawn at 120% of legend size'));
  assert.ok(rowFor(html, '21-W-1002').includes('filled in (normally closed)'));
  assert.ok(!rowFor(html, '21-W-1001').includes('filled in'));
  assert.ok(rowFor(html, '21-P-6001').includes('One of: PENNANT, LEFT, PENNANT, RIGHT'));
  assert.ok(rowFor(html, '21-W-1004').includes('Approved exceptions for this family: Folding widget. The tool cannot tell whether this item is one of them.'));
  assert.ok(rowFor(html, '21-G-2002').includes('Nothing recognised within 60 pt. Could be non-standard, modified, or a gap in the library.'));
  assert.ok(rowFor(html, '21-ZI-5001').includes('The library has no tag bubbles. Import the legend again to add them.'));
  // data-i is the verdict's place in the result, whatever order the rows are shown in
  assert.ok(rows(html).filter(r => r.includes('data-act="sym-jump"'))[0].includes('data-i="' + RESULT.verdicts.findIndex(v => v.tag === '21-G-2001') + '"'));
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
});

test('boxRects: one rectangle per tag, around the symbol when there is one', () => {
  const rects = V.boxRects(RESULT, 2);
  assert.equal(rects.filter(x => 'i' in x).length, 11);   // tag rectangles; phase 3 adds shape ones
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
  assert.ok(V.resultsHtml({ ...RESULT, timedOut: true, tagsTimedOut: true }).includes('The check stopped at its time limit. Tags it did not reach are marked Not checked.'));
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

// ── Symbols found by the sweep ────────────────────────────────────────────
import { SWEEP_SHEET, SWEEP_LIBRARY, LOOKUPS_B, label } from './fixtures/symbol-check-sheet.js';
// A result from before the shape check (shapes off): untagged symbols listed and boxed as they were.
const NO_TAGS = checkSheet({ ...SWEEP_SHEET, textItems: label('AB', 72, 216), library: SWEEP_LIBRARY, lookups: LOOKUPS_B, options: { shapes: false } });   // a word in the ring: a bubble needs writing
const sy = (name, tag = null, more = {}) => ({ name, tagId: '', box: [10, 10, 20, 20], sizePct: 100, score: 1, oneOf: [], bubble: false, tag, ...more });

test('progressHtml: the sweep says which row it is on, with the same Cancel', () => {
  const html = V.progressHtml(3, 5, 'sweep');
  assert.ok(html.includes('Looking for symbols: row 3 of 5'), html);
  assert.ok(html.includes('data-act="sym-cancel"'));
  assert.ok(V.progressHtml(3, 71, 'tags').includes('Checking symbols: 3 of 71 tags'));
});
test('symbolSummary: how many standard symbols, and how many with tags', () => {
  assert.equal(V.symbolSummary({ symbols: [sy('A', 't1'), sy('B', 't2'), sy('C'), sy('D'), sy('E')] }), '5 standard symbols found, 2 with tags.');
  assert.equal(V.symbolSummary({ symbols: [sy('A')] }), '1 standard symbol found, 0 with tags.');
  assert.equal(V.symbolSummary({ symbols: [] }), 'No standard symbols found.');
  for (const bad of [null, 5, {}, { symbols: 'x' }]) assert.equal(V.symbolSummary(bad), '');
});
test('resultsHtml: a sheet with no tags shows its symbols, what it skipped, and a row per untagged symbol', () => {
  const html = V.resultsHtml(NO_TAGS);
  assert.ok(html.includes('No tags read.'), html.slice(0, 200));
  assert.ok(html.includes('5 standard symbols found, 0 with tags.'));
  assert.ok(html.includes('Title block not checked.'));
  assert.ok(html.includes('Symbols with no tag'));
  assert.equal(html.split('data-act="sym-jump-s"').length - 1, 5);
  assert.equal(html.split('data-act="sym-jump"').length - 1, 0);
  // rows by name; data-s is the symbol's place in result.symbols
  const order = [...html.matchAll(/data-s="(\d+)"/g)].map(m => NO_TAGS.symbols[Number(m[1])].name);
  assert.deepEqual(order, ['GADGET', 'RING', 'SIGNAL', 'WIDGET', 'WIDGET']);
  assert.ok(html.includes(V.FAMILY_NOTE));
});
test('resultsHtml: tagged symbols are not listed again; one-of names shown; everything escaped', () => {
  const r = { ok: true, verdicts: [], symbols: [sy('A', 't1'), sy(HOSTILE, null, { oneOf: [HOSTILE, 'B'] }), sy('C', null, { oneOf: ['C'] })] };
  const html = V.resultsHtml(r);
  assert.ok(!html.includes('<img'));
  assert.equal(html.split('data-act="sym-jump-s"').length - 1, 2);
  assert.ok(html.includes('(one of: &lt;img'));
  assert.ok(!html.includes('(one of: C)'));
  assert.ok(!V.resultsHtml(RESULT).includes('Symbols with no tag'));
});
test('boxRects: a rectangle per untagged symbol and one for the skipped title block, at the viewer scale', () => {
  const rects = V.boxRects(NO_TAGS, 2);
  const syms = rects.filter(r => r.kind === 'symbol'), skip = rects.filter(r => r.kind === 'skipped');
  assert.equal(syms.length, 5); assert.equal(skip.length, 1);
  const s0 = syms.find(r => r.s === 0), b = NO_TAGS.symbols[0].box;
  assert.deepEqual([s0.left, s0.top, s0.width, s0.height], [b[0] * 2 - 3, b[1] * 2 - 3, (b[2] - b[0]) * 2 + 6, (b[3] - b[1]) * 2 + 6]);
  assert.equal(s0.title, NO_TAGS.symbols[0].name + ': standard symbol, no tag.');
  const k = NO_TAGS.skipped;
  assert.deepEqual([skip[0].left, skip[0].top, skip[0].width, skip[0].height, skip[0].title],
    [k[0] * 2 - 3, k[1] * 2 - 3, (k[2] - k[0]) * 2 + 6, (k[3] - k[1]) * 2 + 6, 'Title block not checked.']);
  assert.equal(skip[0].s, undefined); assert.equal(skip[0].i, undefined);
  // tag rects are unchanged: none here, and a symbol with a tag gets none of its own
  assert.equal(V.boxRects({ ok: true, verdicts: [], symbols: [sy('A', 't1')] }, 1).length, 0);
  assert.equal(V.boxRects({ ok: true, verdicts: [], symbols: [sy('A', null, { box: [0, 0, NaN, 1] })], skipped: [1, 2] }, 1).length, 0);
});

test('a sweep cut short says its symbol list is incomplete, and does not blame the tags', () => {
  const r = { ok: true, verdicts: [], symbols: [{ name: 'A', box: [0, 0, 1, 1], oneOf: [], tag: null }], timedOut: true, sweepTimedOut: true, tagsTimedOut: false };
  assert.equal(V.symbolSummary(r), '1 standard symbol found, 0 with tags. The time limit was reached: this list is incomplete.');
  assert.equal(V.symbolSummary({ ...r, symbols: [] }), 'No standard symbols found before the time limit: this list is incomplete.');
  const html = V.resultsHtml(r);
  assert.ok(html.includes('this list is incomplete'));
  assert.ok(!html.includes('Tags it did not reach'));
  assert.ok(V.resultsHtml({ ...r, tagsTimedOut: true }).includes('Tags it did not reach are marked Not checked.'));
  // a result from before these flags existed still says what it always said
  assert.ok(V.resultsHtml({ ok: true, verdicts: [], timedOut: true }).includes('Tags it did not reach are marked Not checked.'));
});

test('resultsHtml: a printed sheet says its tags are not read and how many letters were left out', () => {
  const html = V.resultsHtml({ ...NO_TAGS, words: 'printed', letters: { removed: 120, rows: 9 } });
  assert.ok(html.includes('Tags not read yet: on a printed sheet the letters are drawn as shapes.'), html.slice(0, 300));
  assert.ok(html.includes('120 letters spotted in 9 rows and left out of the linework.'));
  assert.ok(!html.includes('No tags read.'));
  assert.ok(V.resultsHtml({ ...NO_TAGS, words: 'text' }).includes('No tags read.'));
  const bad = V.resultsHtml({ ...NO_TAGS, words: 'printed', letters: { removed: HOSTILE, rows: null } });
  assert.ok(!bad.includes('<img'));
  assert.ok(bad.includes('No letters spotted.'));
  assert.ok(V.resultsHtml({ ...NO_TAGS, words: 'printed', letters: { removed: 1, rows: 1 } }).includes('1 letter spotted in 1 row and left out of the linework.'));
  assert.ok(V.resultsHtml({ ...NO_TAGS, words: 'printed', letters: { removed: 1, rows: 3 } }).includes('1 letter spotted in 3 rows and left out'));
});
test('resultsHtml: a plain untagged symbol is marked to check by eye, and escaped', () => {
  const r = { ok: true, verdicts: [], words: 'printed', symbols: [sy('BOXY', null, { plain: true }), sy('ROUND', null, { plain: false }), sy(HOSTILE, null, { plain: true })] };
  const html = V.resultsHtml(r);
  const rs = rows(html);
  assert.ok(rs.find(x => x.includes('BOXY')).includes('<span class="sc-detail">(plain shape: check by eye)</span>'));
  assert.ok(!rs.find(x => x.includes('ROUND')).includes('plain shape'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
});
test('boxRects: a plain symbol carries the plain note in its title', () => {
  const rects = V.boxRects({ ok: true, verdicts: [], symbols: [sy('BOXY', null, { plain: true }), sy('ROUND')] }, 1);
  assert.ok(rects.find(r => r.title.startsWith('BOXY')).title.endsWith(' Plain shape: check by eye.'));
  assert.ok(!rects.find(r => r.title.startsWith('ROUND')).title.includes('Plain shape'));
});

// ── Phase 3: shapes not to standard ───────────────────────────────────────
const SHAPED = { ok: true, verdicts: [], skipped: null, operatorsMarked: true,
  symbols: [{ name: 'WIDGET', tagId: 'W', box: [10, 10, 34, 22], tag: null, oneOf: [], plain: false, shape: 0, standard: true },
    { name: 'GADGET', tagId: 'G', box: [100, 10, 120, 30], tag: null, oneOf: [], plain: false, shape: 1, standard: false }],
  shapes: [
    { id: 0, box: [10, 10, 34, 22], standard: true, why: null, explained: 1, share: null, symbols: [0], operator: null, closest: null },
    { id: 1, box: [100, 10, 128, 30], standard: false, why: 'left-over', explained: 0.8, share: null, symbols: [1], operator: null, closest: { name: 'GADGET', tagId: 'G', score: 0.95, explained: 0.8 } },
    { id: 2, box: [200, 10, 220, 30], standard: false, why: 'short-line', explained: 0, share: 0.62, symbols: [], operator: null, closest: { name: HOSTILE, tagId: '', score: 0.91, explained: 1 } },
    { id: 3, box: [300, 10, 320, 30], standard: false, why: 'no-fit', explained: 0, share: null, symbols: [], operator: null, closest: null },
    { id: 4, box: [400, 10, 420, 30], standard: null, why: 'time', explained: 0, share: null, symbols: [], operator: null, closest: null },
  ] };

test('symbolSummary adds the shapes not to standard, those not judged, and the operators note when none is marked', () => {
  assert.equal(V.symbolSummary(SHAPED), '2 standard symbols found, 0 with tags. 3 shapes not to standard. 1 shape not judged: time limit.');
  assert.equal(V.symbolSummary({ ...SHAPED, operatorsMarked: false }), '2 standard symbols found, 0 with tags. 3 shapes not to standard. 1 shape not judged: time limit. ' + V.OPERATORS_NOTE);
  assert.equal(V.OPERATORS_NOTE, 'Operators not marked in the library: valves with an operator will be flagged.');
  const { shapes, operatorsMarked, ...old } = SHAPED;
  assert.equal(V.symbolSummary(old), '2 standard symbols found, 0 with tags.');
});

test('shapeWhy: the why in words', () => {
  assert.equal(V.shapeWhy(SHAPED.shapes[1]), 'ink left over');
  assert.equal(V.shapeWhy(SHAPED.shapes[2]), 'line drawn short (62%)');
  assert.equal(V.shapeWhy(SHAPED.shapes[3]), 'no standard symbol fits');
  assert.equal(V.shapeWhy(SHAPED.shapes[4]), 'not judged: time limit');
  assert.equal(V.shapeWhy(null), '');
});

test('resultsHtml lists Not to standard first, a row per flagged shape with why, closest and a jump', () => {
  const html = V.resultsHtml(SHAPED);
  const first = html.indexOf('Not to standard'), loose = html.indexOf('Standard symbols');
  assert.ok(first > 0 && first < loose, 'Not to standard comes before the other lists');
  const shapeRows = rows(html).filter(r => r.includes('sym-jump-shape') && r.includes('sc-not-standard'));
  assert.equal(shapeRows.length, 3);
  assert.match(shapeRows[0], /data-sh="1"/);
  assert.ok(shapeRows[0].includes('ink left over') && shapeRows[0].includes('closest: GADGET 95%'));
  assert.ok(shapeRows[1].includes('line drawn short (62%)') && !shapeRows[1].includes('<img'));
  assert.ok(shapeRows[2].includes('no close symbol'));
});

test('a result with no shapes renders exactly as before', () => {
  const { shapes, operatorsMarked, ...old } = SHAPED;
  assert.equal(V.resultsHtml(old).includes('Not to standard'), false);
  assert.deepEqual(V.boxRects(old, 1).map(b => b.kind), ['symbol', 'symbol']);
  assert.equal(V.resultsHtml(RESULT), V.resultsHtml({ ...RESULT }));
});

test('boxRects: flagged shapes amber not-standard, timed-out ones not-judged; standard ones as before', () => {
  const rects = V.boxRects(SHAPED, 2);
  const ns = rects.filter(b => b.kind === 'not-standard'), nj = rects.filter(b => b.kind === 'not-judged');
  assert.deepEqual(ns.map(b => b.sh), [1, 2, 3]);
  assert.deepEqual(nj.map(b => b.sh), [4]);
  assert.equal(ns[0].left, 100 * 2 - 3);
  assert.ok(ns[0].title.startsWith('Not to standard: ink left over.'));
  assert.equal(V.NOT_STANDARD_COLOUR, '#E08E00');
  assert.equal(rects.filter(b => b.kind === 'symbol').length, 0);     // symbols first: the standard shape is boxed instead
  assert.equal(rects.filter(b => b.kind === 'standard').length, 1);
});

// Symbols first (owner, 2026-11-18): no "no tag" wording once shapes were judged.
test('symbols first on screen: standard shapes are green named boxes, listed as Standard symbols; no "no tag" wording', () => {
  const rects = V.boxRects(SHAPED, 1);
  const std = rects.filter(b => b.kind === 'standard');
  assert.deepEqual(std.map(b => b.sh), [0]);
  assert.equal(std[0].title, 'Standard symbol: WIDGET.');
  assert.equal(rects.filter(b => b.kind === 'symbol').length, 0);
  const html = V.resultsHtml(SHAPED);
  assert.ok(!/with no tag|no tag beside/i.test(html), 'no "no tag" wording');
  assert.match(html, /<strong>Standard symbols<\/strong>: 1 WIDGET/);
  assert.match(html, /data-act="sym-jump-shape" data-sh="0"/);
});

test('the shape check is labelled a trial wherever its flags show', () => {
  assert.match(V.TRIAL_NOTE, /trial/i);
  assert.ok(V.resultsHtml(SHAPED).includes('The shape check is new and on trial'));
  const { shapes, operatorsMarked, ...old } = SHAPED;
  assert.ok(!V.resultsHtml(old).includes('on trial'));
});

// ── Redesign: three verdicts on screen ────────────────────────────────────
const sv = (verdict, reason, box, extra = {}) => ({ id: 0, box, verdict, reason, standard: verdict === 'standard' ? true : verdict === 'not-judged' ? null : false,
  why: null, explained: 1, share: null, symbols: [], operator: null, closest: null, ...extra });
const NEW = { ok: true, verdicts: [], skipped: null, operatorsMarked: true, symbols: [], readFrom: 'line-pieces', printScale: 0.41, sizeScale: 1,
  drawingArea: { box: [5, 5, 500, 400], cuts: [], found: true },
  shapes: [
    sv('standard', null, [10, 10, 34, 22], { symbols: [] , closest: { name: 'WIDGET', score: 1 } }),
    sv('not-standard', { kind: 'differs', name: 'GADGET', pct: 91 }, [100, 10, 120, 30]),
    sv('not-standard', { kind: 'size', name: HOSTILE, pct: 70 }, [200, 10, 220, 30]),
    sv('not-identified', null, [300, 10, 320, 30]),
    sv('not-identified', null, [400, 10, 420, 30]),
    sv('not-judged', null, [500, 10, 520, 30]),
  ] };

test('reasonText: the four fixed copies', () => {
  assert.equal(V.reasonText({ reason: { kind: 'differs', name: 'GADGET', pct: 91 } }), 'drawn differently from GADGET (91% alike)');
  assert.equal(V.reasonText({ reason: { kind: 'size', name: 'WIDGET', pct: 70 } }), 'WIDGET drawn at 70% of standard size');
  assert.equal(V.reasonText({ reason: { kind: 'extra', name: 'WIDGET' } }), 'WIDGET with extra linework');
  assert.equal(V.reasonText({ reason: { kind: 'tag', tag: 'XV101' } }), 'tag XV101 has no standard symbol');
  assert.equal(V.reasonText({ reason: null }), '');
  assert.equal(V.reasonText(null), '');
});

test('markLine: counts, read-from, print scale outside 95-105, frame not found', () => {
  const many = n => Array.from({ length: n }, () => sv('standard', null, [0, 0, 1, 1]));
  const r = { ...NEW, shapes: [...many(23), ...Array.from({ length: 12 }, () => sv('not-standard', { kind: 'extra', name: 'A' }, [0, 0, 1, 1])), ...Array.from({ length: 140 }, () => sv('not-identified', null, [0, 0, 1, 1]))] };
  assert.equal(V.markLine(r), '23 standard · 12 not to standard · 140 not identified · Read from: line pieces · Printed at 41% of full size');
  assert.equal(V.markLine({ ...r, readFrom: 'paths', printScale: 1 }), '23 standard · 12 not to standard · 140 not identified · Read from: drawn paths');
  assert.ok(!V.markLine({ ...r, printScale: 1.05 }).includes('Printed at'));
  assert.ok(!V.markLine({ ...r, printScale: 0.95 }).includes('Printed at'));
  assert.ok(V.markLine({ ...r, printScale: 1.06 }).includes('Printed at 106% of full size'));
  assert.ok(V.markLine({ ...r, drawingArea: { box: null, cuts: [], found: false } }).endsWith(' · Drawing area: frame not found, page edge used'));
  assert.equal(V.markLine({ ...NEW, shapes: [] }), '');
  assert.equal(V.markLine(null), '');
});

test('markLine: says the line-piece reading is incomplete when a cap left pieces out', () => {
  const r = { ...NEW, readFrom: 'line-pieces', printScale: 1, shapes: [sv('standard', null, [0, 0, 1, 1])] };
  assert.equal(V.markLine({ ...r, lineCapped: 7 }), '1 standard · 0 not to standard · 0 not identified · Read from: line pieces · Line-piece reading incomplete');
  assert.ok(!V.markLine({ ...r, lineCapped: 0 }).includes('incomplete'));
  assert.ok(!V.markLine(r).includes('incomplete'));
  assert.ok(!V.markLine({ ...r, readFrom: 'paths', lineCapped: 7 }).includes('incomplete'));
});

test('the key copy', () => {
  assert.equal(V.KEY_NOT_STANDARD, 'Not to standard: the reason names the standard symbol it departs from');
  assert.equal(V.KEY_NOT_IDENTIFIED, 'Not identified: looked at, not matched to any standard symbol; check by eye');
  assert.equal(V.NOT_IDENTIFIED_COLOUR, '#C62828');
});

test('boxRects: amber numbered 1.., red unnumbered, one area rect (none when not found)', () => {
  const rects = V.boxRects(NEW, 2);
  const am = rects.filter(b => b.kind === 'not-standard'), red = rects.filter(b => b.kind === 'not-identified');
  assert.deepEqual(am.map(b => b.num), [1, 2]);
  assert.deepEqual(am.map(b => b.sh), [1, 2]);
  assert.equal(am[0].title, 'Not to standard: drawn differently from GADGET (91% alike).');
  assert.equal(red.length, 2);
  assert.ok(red.every(b => b.num === undefined && b.title === 'Not identified: check by eye.'));
  assert.equal(rects.filter(b => b.kind === 'not-judged').length, 1);
  assert.equal(rects.filter(b => b.kind === 'standard').length, 1);
  const area = rects.filter(b => b.kind === 'area');
  assert.equal(area.length, 1);
  assert.equal(area[0].left, 5 * 2 - 3);
  assert.equal(V.boxRects({ ...NEW, drawingArea: { box: null, cuts: [], found: false } }, 2).filter(b => b.kind === 'area').length, 0);
});

test('resultsHtml: amber rows only, one red count line, mark line, escaped reasons', () => {
  const html = V.resultsHtml(NEW);
  const shapeRows = rows(html).filter(r => r.includes('sym-jump-shape') && r.includes('sc-not-standard'));
  assert.equal(shapeRows.length, 2);
  assert.ok(shapeRows[0].includes('drawn differently from GADGET (91% alike)') && /data-sh="1"/.test(shapeRows[0]));
  assert.ok(!html.includes('<img'), 'hostile name escaped');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt; drawn at 70% of standard size'));
  assert.ok(html.includes('2 not identified (boxed in red on the drawing)'));
  assert.equal(rows(html).filter(r => r.includes('not-identified')).length, 0);
  assert.ok(html.includes('1 standard · 2 not to standard · 2 not identified · Read from: line pieces · Printed at 41% of full size'));
  assert.ok(html.includes(V.TRIAL_NOTE) || html.includes('The shape check is new and on trial'));
  assert.ok(html.indexOf('on trial') < html.indexOf('Read from:'));
  assert.ok(html.includes(V.KEY_NOT_STANDARD) && html.includes(V.KEY_NOT_IDENTIFIED));
  assert.match(V.symbolSummary({ ...NEW, symbols: [] }), /1 standard shape, 2 not to standard, 2 not identified\./);
});

// Legend rules, Task 7 (2026-11-18): a green shape is named by its parts; line marks are counted on the heading.
test('partsName: bodies first, then peeled symbols, then attachments, repeats counted', () => {
  // Within a role, in the order found.
  const parts = [{ name: 'MANUAL ISOLATION', role: 'attachment' }, { name: 'BALL', role: 'body' }, { name: 'FLANGED CONNECTION', role: 'attachment' },
    { name: 'FLANGED CONNECTION', role: 'attachment' }, { name: 'REDUCER', role: 'symbol' }];
  assert.equal(V.partsName(parts), 'BALL + REDUCER + MANUAL ISOLATION + FLANGED CONNECTION ×2');
  assert.equal(V.partsName([]), '');
  assert.equal(V.partsName(null), '');
  assert.equal(V.partsName([{ name: '<b>', role: 'body' }, 7, { role: 'body' }]), '<b>');
});
test('markLine: line marks read as part of their lines, when there are any; an old result reads as before', () => {
  const r = { ...NEW, shapes: [sv('standard', null, [0, 0, 1, 1])] };
  assert.equal(V.markLine({ ...r, lineMarks: 3 }), '1 standard · 0 not to standard · 0 not identified · 3 line marks read as part of their lines · Read from: line pieces · Printed at 41% of full size');
  assert.ok(V.markLine({ ...r, lineMarks: 1 }).includes('1 line mark read as part of its line'));
  assert.equal(V.markLine({ ...r, lineMarks: 0 }), V.markLine(r));
  assert.ok(!V.markLine(r).includes('line mark'));
});

// A valve and its actuator are one symbol: one box for the whole, coloured by the verdict of the whole (owner, 2026-11-25).
// Invented data: a valve body 20 wide with an actuator above it, the tag verdict's box round the body alone.
describe_whole_box();
function describe_whole_box() {
  const tagV = (tag, verdict, box, extra = {}) => ({ tag, fc: 'V', verdict, why: '', symbol: 'WIDGET', oneOf: [], tagId: 'V', exceptions: [], sizePct: 100, score: 0.99, filled: false, letters: '', tagBox: [box[0], box[3] + 2, box[2], box[3] + 10], box, closest: null, bubble: false, ...extra });
  const shape = (box, verdict, parts, extra = {}) => ({ id: 0, box, standard: verdict === 'standard', verdict, reason: null, why: null, explained: 1, share: null, symbols: [], operator: null, closest: null, parts, ...extra });
  const BODY = [100, 100, 120, 120], WHOLE = [100, 70, 120, 120];
  const WITH_OP = [{ name: 'WIDGET', role: 'body' }, { name: 'HANDLE', role: 'attachment' }];
  const res = (verdicts, shapes) => ({ ok: true, verdicts, symbols: [], shapes, operatorsMarked: true, skipped: null });
  test('boxRects: a valve with its actuator gets one box, the whole symbol, not another round the body', () => {
    const rects = V.boxRects(res([tagV('T1', 'ok', BODY)], [shape(WHOLE, 'standard', WITH_OP)]), 1);
    assert.equal(rects.length, 1, JSON.stringify(rects));
    assert.equal(rects[0].kind, 'standard');
    assert.deepEqual([rects[0].left, rects[0].top, rects[0].width, rects[0].height], [97, 67, 26, 56]);
    assert.equal(rects[0].i, 0, 'the tag row still jumps to this box');
    assert.ok(rects[0].title.includes('WIDGET + HANDLE') && rects[0].title.includes('T1'), rects[0].title);
  });
  test('boxRects: an off-size body inside a whole that is standard is not shown amber', () => {
    const rects = V.boxRects(res([tagV('T1', 'off-size', BODY, { sizePct: 70 })], [shape(WHOLE, 'standard', WITH_OP)]), 1);
    assert.deepEqual(rects.map(r => r.kind), ['standard']);
  });
  test('boxRects: the whole takes its own colour: an amber whole stays amber, one box', () => {
    const s = shape(WHOLE, 'not-standard', WITH_OP, { standard: false, reason: { kind: 'size', name: 'WIDGET', pct: 70 } });
    const rects = V.boxRects(res([tagV('T1', 'ok', BODY)], [s]), 1);
    assert.deepEqual(rects.map(r => r.kind), ['not-standard']);
  });
  test('boxRects: a body with no actuator keeps its tag box beside its shape box', () => {
    const rects = V.boxRects(res([tagV('T1', 'ok', BODY)], [shape(BODY, 'standard', [{ name: 'WIDGET', role: 'body' }])]), 1);
    assert.deepEqual(rects.map(r => r.kind).sort(), ['ok', 'standard']);
  });
  test('boxRects: a wrong-family tag verdict is never hidden inside a whole', () => {
    const rects = V.boxRects(res([tagV('T1', 'wrong-family', BODY)], [shape(WHOLE, 'standard', WITH_OP)]), 1);
    assert.deepEqual(rects.map(r => r.kind).sort(), ['standard', 'wrong-family']);
  });
  test('boxRects: a tag verdict outside the whole keeps its box', () => {
    const far = [300, 100, 320, 120];
    const rects = V.boxRects(res([tagV('T1', 'ok', BODY), tagV('T2', 'ok', far)], [shape(WHOLE, 'standard', WITH_OP)]), 1);
    assert.deepEqual(rects.map(r => r.kind).sort(), ['ok', 'standard']);
    assert.equal(rects.find(r => r.kind === 'ok').i, 1);
  });
  test('boxRects: a whole that is not identified (no parts) leaves the tag box alone', () => {
    const rects = V.boxRects(res([tagV('T1', 'ok', BODY)], [shape(WHOLE, 'not-identified', [])]), 1);
    assert.deepEqual(rects.map(r => r.kind).sort(), ['not-identified', 'ok']);
  });
}
