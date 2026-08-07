// tests/pid-core.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractTags, resolveFC, normaliseTagText, PIPE_MATERIAL_CODES, isUsablePdf, pickArchiveFile } from '../assets/js/pid-core.js';
import { FIXTURE_LOOKUPS, CORPUS } from './fixtures/pid-tag-corpus.js';

const GOLDEN = JSON.parse(readFileSync(new URL('./fixtures/pid-tag-golden.json', import.meta.url), 'utf8'));
const L = FIXTURE_LOOKUPS;

// ── The golden comparison: the whole point of this extraction ──
// These fixtures were captured from the tool BEFORE any code moved. If one of
// these fails, the extraction changed what the register produces — which is
// the only failure mode that actually matters here.
test('golden: every corpus case reproduces the captured output exactly', () => {
  for (const c of CORPUS) {
    const actual = extractTags(c.text, { drawingName: 'SP51', revision: 'C', lookups: L });
    assert.deepEqual(actual, GOLDEN[c.name], `corpus case drifted: ${c.name}`);
  }
});

// ── resolveFC ──
test('resolveFC maps a known code to its category and description', () => {
  assert.deepEqual(resolveFC('XX', L), { cat: 'widget', desc: 'Example Widget' });
});

test('resolveFC falls back to other, and to the code as its own description', () => {
  assert.deepEqual(resolveFC('ZZ', L), { cat: 'other', desc: 'ZZ' });
  // A code that is classified but undescribed keeps its category.
  assert.deepEqual(resolveFC('PP', L), { cat: 'pipework', desc: 'PP' });
});

test('resolveFC degrades rather than throwing when lookups are missing or junk', () => {
  for (const bad of [undefined, null, 0, '', [], 'nope']) {
    assert.doesNotThrow(() => resolveFC('XX', bad));
    assert.deepEqual(resolveFC('XX', bad), { cat: 'other', desc: 'XX' });
  }
});

// ── normaliseTagText ──
test('normaliseTagText converts every dash variant and collapses doubles', () => {
  assert.equal(normaliseTagText('21–XX–1001'), '21-XX-1001');
  assert.equal(normaliseTagText('21—XX—1001'), '21-XX-1001');
  assert.equal(normaliseTagText('21‒XX‒1001'), '21-XX-1001');
  assert.equal(normaliseTagText('21―XX―1001'), '21-XX-1001');
  assert.equal(normaliseTagText('21--XX---1001'), '21-XX-1001');
});

test('normaliseTagText upper-cases, so lower-case PDF text still matches', () => {
  assert.equal(normaliseTagText('21-xx-1001'), '21-XX-1001');
});

test('normaliseTagText rejoins tags split by extracted-PDF whitespace', () => {
  // Rule 1: function code and id separated by a space.
  assert.equal(normaliseTagText('21-XX 1001'), '21-XX-1001');
  // Rule 2: a trailing parallel-plant letter split off.
  assert.equal(normaliseTagText('21-XX-1001 A'), '21-XX-1001A');
  // Rule 3: spaces around both hyphens.
  assert.equal(normaliseTagText('21 - XX - 1001'), '21-XX-1001');
});

test('normaliseTagText never throws on non-string input', () => {
  for (const bad of [undefined, null, 0, {}, [], NaN]) {
    assert.doesNotThrow(() => normaliseTagText(bad));
  }
});

// ── extractTags ──
test('extractTags splits an exact tag into its DS310 parts', () => {
  const r = extractTags('21-XX-1001', { drawingName: 'SP51', revision: 'C', lookups: L });
  assert.equal(r.confirmed.length, 1);
  assert.deepEqual(r.confirmed[0], {
    tag: '21-XX-1001', pac: '21', fc: 'XX', id: '1001', desc: 'Example Widget',
    drawing: 'SP51', revision: 'C', type: 'widget', isClash: false, isReview: false,
  });
  assert.equal(r.review.length, 0);
  assert.equal(r.likelyScanPDF, false);
});

test('extractTags routes a likely line number to review, not confirmed', () => {
  // Single-digit process area plus a pipe-material code reads as a line
  // number rather than an asset, so it needs a human to confirm.
  const r = extractTags('1-PP-1001', { drawingName: 'SP51', revision: 'C', lookups: L });
  assert.equal(r.confirmed.length, 0);
  assert.equal(r.review.length, 1);
  assert.equal(r.review[0].isReview, true);
});

test('extractTags keeps a two-digit process area with a pipe material as confirmed', () => {
  const r = extractTags('21-PP-1001', { drawingName: 'SP51', revision: 'C', lookups: L });
  assert.equal(r.confirmed.length, 1);
  assert.equal(r.review.length, 0);
});

test('extractTags accepts fuzzy separators but always sends them to review', () => {
  const r = extractTags('21_YY_1001 21.YY.1002', { drawingName: 'SP51', revision: 'C', lookups: L });
  assert.equal(r.confirmed.length, 0);
  assert.deepEqual(r.review.map(t => t.tag), ['21-YY-1001', '21-YY-1002']);
});

// The brief called this "rejects a fuzzy match whose middle group is all
// digits," but TAG_FUZZY's middle capture group is [A-Z]{1,8} — letters
// only — so no input can ever produce an all-digit m[2], and the rejection
// branch in extractTags can never fire. What this case actually proves is
// that digit-separated text like '21_99_1001' (a number range, not a tag)
// simply never matches TAG_FUZZY in the first place, so it produces no tags
// at all. Renamed to describe what it actually asserts.
test('extractTags finds no tags in a digit-separated number range', () => {
  // '21_99_1001' is a number range, not a tag.
  const r = extractTags('21_99_1001', { drawingName: 'SP51', revision: 'C', lookups: L });
  assert.equal(r.confirmed.length + r.review.length, 0);
  assert.equal(r.likelyScanPDF, true);
});

test('extractTags de-duplicates, and an exact match beats a fuzzy one', () => {
  const r = extractTags('21-XX-1001 21-XX-1001 21_XX_1001', { drawingName: 'SP51', revision: 'C', lookups: L });
  assert.equal(r.confirmed.length, 1);
  assert.equal(r.review.length, 0);
});

test('extractTags reports likelyScanPDF only when nothing at all was found', () => {
  assert.equal(extractTags('NO TAGS HERE', { lookups: L }).likelyScanPDF, true);
  assert.equal(extractTags('', { lookups: L }).likelyScanPDF, true);
  assert.equal(extractTags('21-XX-1001', { lookups: L }).likelyScanPDF, false);
});

// This is the regex-state hazard called out in the spec. TAG_EXACT and
// TAG_FUZZY are global regexes; if the module lets lastIndex persist between
// calls, the SECOND drawing someone imports silently loses tags.
test('extractTags gives identical results when called repeatedly', () => {
  const opts = { drawingName: 'SP51', revision: 'C', lookups: L };
  // Both patterns must appear here. The earlier version used only exact-format
  // tags, so a lastIndex leak isolated to TAG_FUZZY would have gone unnoticed.
  const first = extractTags('21-XX-1001 21_YY_1002', opts);
  const second = extractTags('21-XX-1001 21_YY_1002', opts);
  const third = extractTags('21-XX-1001 21_YY_1002', opts);
  assert.deepEqual(second, first, 'regex lastIndex leaked between calls');
  assert.deepEqual(third, first);
});

test('extractTags never throws on hostile or malformed input', () => {
  const cases = [undefined, null, 0, '', [], {}, NaN, 12345, { text: 'nope' }];
  const emptyResult = { confirmed: [], review: [], likelyScanPDF: true };
  for (const bad of cases) {
    assert.doesNotThrow(() => extractTags(bad, { lookups: L }), `threw on ${JSON.stringify(bad)}`);
    const result = extractTags(bad, { lookups: L });
    assert.deepEqual(result, emptyResult, `unexpected result for ${JSON.stringify(bad)}`);
  }
  assert.doesNotThrow(() => extractTags('21-XX-1001', undefined));
  assert.doesNotThrow(() => extractTags('21-XX-1001', { lookups: null }));
  // A very long string must complete rather than hang.
  const huge = ('21-XX-1001 '.repeat(5000));
  assert.doesNotThrow(() => extractTags(huge, { lookups: L }));
});

// The module's stated constraint is that no exported function throws on any
// input. String(x) throws on an object with no toString/valueOf, and on one
// with a throwing toString/Symbol.toPrimitive, so the coercion has to be
// wrapped, not just typeof-checked. Property access on `lookups` can throw
// too, independent of the text argument.
test('extractTags never throws on inputs that break String() coercion', () => {
  const emptyResult = { confirmed: [], review: [], likelyScanPDF: true };

  const nullProto = Object.create(null);
  assert.doesNotThrow(() => extractTags(nullProto, { lookups: L }));
  assert.deepEqual(extractTags(nullProto, { lookups: L }), emptyResult);

  const throwingToString = { toString() { throw new Error('x'); } };
  assert.doesNotThrow(() => extractTags(throwingToString, { lookups: L }));
  assert.deepEqual(extractTags(throwingToString, { lookups: L }), emptyResult);

  const throwingToPrimitive = { [Symbol.toPrimitive]() { throw new Error('x'); } };
  assert.doesNotThrow(() => extractTags(throwingToPrimitive, { lookups: L }));
  assert.deepEqual(extractTags(throwingToPrimitive, { lookups: L }), emptyResult);

  const hostileLookups = { get fc() { throw new Error('x'); }, fcDescriptions: {} };
  assert.doesNotThrow(() => extractTags('21-XX-1001', { drawingName: 'SP51', revision: 'C', lookups: hostileLookups }));
  const r = extractTags('21-XX-1001', { drawingName: 'SP51', revision: 'C', lookups: hostileLookups });
  assert.equal(r.confirmed.length, 1);
  assert.equal(r.confirmed[0].type, 'other');
  assert.equal(r.confirmed[0].desc, 'XX');
});

test('normaliseTagText never throws on inputs that break String() coercion', () => {
  assert.doesNotThrow(() => normaliseTagText(Object.create(null)));
  assert.equal(normaliseTagText(Object.create(null)), '');

  assert.doesNotThrow(() => normaliseTagText({ toString() { throw new Error('x'); } }));
  assert.equal(normaliseTagText({ toString() { throw new Error('x'); } }), '');

  assert.doesNotThrow(() => normaliseTagText({ [Symbol.toPrimitive]() { throw new Error('x'); } }));
  assert.equal(normaliseTagText({ [Symbol.toPrimitive]() { throw new Error('x'); } }), '');
});

test('resolveFC never throws when a lookups property access itself throws', () => {
  const hostileLookups = { get fc() { throw new Error('x'); }, fcDescriptions: {} };
  assert.doesNotThrow(() => resolveFC('XX', hostileLookups));
  assert.deepEqual(resolveFC('XX', hostileLookups), { cat: 'other', desc: 'XX' });
});

// ── TAG_EXACT boundaries ──
// The corpus only exercises the interior of every quantifier range (4-digit
// ids, 2-digit PACs, 2-letter FCs), so a narrowed or widened boundary passes
// the whole suite silently. These pin the edges directly against the
// documented pattern: \b(\d{1,2})-([A-Z]{1,6})-(\d{3,5}[A-Z]{0,2})\b
test('TAG_EXACT id lower bound: a 3-digit id is confirmed', () => {
  const r = extractTags('21-XX-100', { drawingName: 'SP51', revision: 'C', lookups: L });
  assert.equal(r.confirmed.length, 1);
  assert.equal(r.confirmed[0].tag, '21-XX-100');
});

test('TAG_EXACT id upper bound: a 5-digit id is confirmed', () => {
  const r = extractTags('21-XX-10000', { drawingName: 'SP51', revision: 'C', lookups: L });
  assert.equal(r.confirmed.length, 1);
  assert.equal(r.confirmed[0].tag, '21-XX-10000');
});

test('a 2-digit id falls below TAG_EXACT and lands in review via TAG_FUZZY', () => {
  const r = extractTags('21-XX-10', { drawingName: 'SP51', revision: 'C', lookups: L });
  assert.equal(r.confirmed.length, 0);
  assert.equal(r.review.length, 1);
  assert.equal(r.review[0].tag, '21-XX-10');
});

test('a 6-digit id is not confirmed (still caught by TAG_FUZZY, sent to review)', () => {
  const r = extractTags('21-XX-100000', { drawingName: 'SP51', revision: 'C', lookups: L });
  assert.equal(r.confirmed.length, 0);
  assert.equal(r.review.length, 1);
  assert.equal(r.review[0].tag, '21-XX-100000');
});

test('TAG_EXACT fc upper bound: a 6-letter function code is confirmed', () => {
  const r = extractTags('21-XXXXXX-1001', { drawingName: 'SP51', revision: 'C', lookups: L });
  assert.equal(r.confirmed.length, 1);
  assert.equal(r.confirmed[0].tag, '21-XXXXXX-1001');
});

test('a 7-letter function code is not confirmed (still caught by TAG_FUZZY, sent to review)', () => {
  const r = extractTags('21-XXXXXXX-1001', { drawingName: 'SP51', revision: 'C', lookups: L });
  assert.equal(r.confirmed.length, 0);
  assert.equal(r.review.length, 1);
  assert.equal(r.review[0].tag, '21-XXXXXXX-1001');
});

test('a 3-digit process area code produces nothing at all', () => {
  const r = extractTags('211-XX-1001', { drawingName: 'SP51', revision: 'C', lookups: L });
  assert.equal(r.confirmed.length, 0);
  assert.equal(r.review.length, 0);
  assert.equal(r.likelyScanPDF, true);
});

test('extractTags carries drawing and revision through unchanged, including when absent', () => {
  const r = extractTags('21-XX-1001', { drawingName: 'SP51', revision: 'C', lookups: L });
  assert.equal(r.confirmed[0].drawing, 'SP51');
  assert.equal(r.confirmed[0].revision, 'C');
  const bare = extractTags('21-XX-1001', { lookups: L });
  assert.equal(bare.confirmed[0].drawing, undefined);
  assert.equal(bare.confirmed[0].revision, undefined);
});

// assert.deepEqual on the whole array, not just inclusion: an inclusion
// check cannot detect an ADDITION to this list, and an addition here would
// both misclassify real instrument tags as line numbers and risk leaking
// DS310 material/process data into this public file.
test('PIPE_MATERIAL_CODES is exported and is exactly the codes the review rule depends on', () => {
  assert.deepEqual(PIPE_MATERIAL_CODES, [
    'FW', 'SW', 'SS', 'ST', 'CS', 'GI', 'PE', 'CU', 'PP',
    'HDPE', 'MDPE', 'PVC', 'ABS', 'CPVC', 'UPVC',
  ]);
});

// ── Archived PDFs ─────────────────────────────────────────────────────────
// Found live on 2026-08-07: a drawing's older revision showed "Couldn't render
// this PDF". The archived file was present but ZERO BYTES, and viewSheet's
// `if (!data)` guard missed it because an empty ArrayBuffer is truthy — so 0
// bytes reached pdf.js and produced a parse error instead of "re-import".
//
// How it became empty could not be proven after the fact (a detached buffer —
// pdf.js empties any ArrayBuffer handed to it — or an interrupted write are
// both consistent with the evidence). What IS provable is that nothing stopped
// an empty buffer being written, and nothing ever repaired it afterwards.

test('isUsablePdf rejects an empty buffer, which is truthy and therefore easy to miss', () => {
  assert.equal(isUsablePdf(new ArrayBuffer(0)), false, 'the exact case that reached pdf.js');
  assert.equal(!!new ArrayBuffer(0), true, 'why a plain truthiness check was not enough');
  assert.equal(isUsablePdf(new ArrayBuffer(8)), true);
});

test('isUsablePdf rejects anything that is not a buffer, without throwing', () => {
  for (const bad of [null, undefined, 0, '', 'nope', {}, [], NaN, { byteLength: 10 }]) {
    assert.doesNotThrow(() => isUsablePdf(bad));
    assert.equal(isUsablePdf(bad), false, `should reject ${JSON.stringify(bad)}`);
  }
});

test('isUsablePdf accepts a typed array as well as a raw ArrayBuffer', () => {
  assert.equal(isUsablePdf(new Uint8Array(4)), true);
  assert.equal(isUsablePdf(new Uint8Array(0)), false);
});

test('pickArchiveFile returns the exact revision when it is present', () => {
  const names = ['SP66_C01.pdf', 'SP66_C02.pdf', 'OTHER_C01.pdf'];
  assert.equal(pickArchiveFile(names, 'SP66', 'C01'), 'SP66_C01.pdf');
  assert.equal(pickArchiveFile(names, 'SP66', 'C02'), 'SP66_C02.pdf');
});

test('pickArchiveFile returns null rather than a DIFFERENT revision of the same drawing', () => {
  // The bug this replaces: the old fallback returned the first file whose name
  // started with the drawing, so asking for C01 handed back C02's drawing
  // labelled C01. Silently showing the wrong revision of a P&ID is worse than
  // showing nothing — someone could mark up against the wrong sheet.
  const names = ['SP66_C02.pdf', 'SP66_C03.pdf'];
  assert.equal(pickArchiveFile(names, 'SP66', 'C01'), null);
});

test('pickArchiveFile still accepts a legacy unversioned file for the drawing', () => {
  // Older archives stored `<drawing>.pdf` with no revision. That is
  // unambiguous — it is the only PDF for that drawing — so it stays usable.
  assert.equal(pickArchiveFile(['SP66.pdf'], 'SP66', 'C01'), 'SP66.pdf');
  // But an exact revision match always wins over it.
  assert.equal(pickArchiveFile(['SP66.pdf', 'SP66_C01.pdf'], 'SP66', 'C01'), 'SP66_C01.pdf');
});

test('pickArchiveFile does not confuse a drawing with one whose name extends it', () => {
  // 'SP66' must not match 'SP66A_C01.pdf' — the old startsWith test would have.
  assert.equal(pickArchiveFile(['SP66A_C01.pdf'], 'SP66', 'C01'), null);
  assert.equal(pickArchiveFile(['SP66A_C01.pdf', 'SP66_C01.pdf'], 'SP66', 'C01'), 'SP66_C01.pdf');
});

test('pickArchiveFile degrades rather than throwing on junk input', () => {
  for (const bad of [null, undefined, 'nope', 0, {}]) {
    assert.doesNotThrow(() => pickArchiveFile(bad, 'SP66', 'C01'));
    assert.equal(pickArchiveFile(bad, 'SP66', 'C01'), null);
  }
  assert.equal(pickArchiveFile(['SP66_C01.pdf'], null, null), null);
  assert.equal(pickArchiveFile(['SP66_C01.pdf'], 'SP66', ''), null);
});
