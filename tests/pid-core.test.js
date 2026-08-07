// tests/pid-core.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractTags, resolveFC, normaliseTagText, PIPE_MATERIAL_CODES } from '../assets/js/pid-core.js';
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

test('extractTags carries drawing and revision through unchanged, including when absent', () => {
  const r = extractTags('21-XX-1001', { drawingName: 'SP51', revision: 'C', lookups: L });
  assert.equal(r.confirmed[0].drawing, 'SP51');
  assert.equal(r.confirmed[0].revision, 'C');
  const bare = extractTags('21-XX-1001', { lookups: L });
  assert.equal(bare.confirmed[0].drawing, undefined);
  assert.equal(bare.confirmed[0].revision, undefined);
});

test('PIPE_MATERIAL_CODES is exported and contains the codes the review rule depends on', () => {
  for (const code of ['FW', 'SW', 'SS', 'ST', 'CS', 'GI', 'PE', 'CU', 'PP', 'HDPE', 'MDPE', 'PVC', 'ABS', 'CPVC', 'UPVC']) {
    assert.ok(PIPE_MATERIAL_CODES.includes(code), `missing ${code}`);
  }
});
