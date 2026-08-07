// tests/check-ds310.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareCodes, parseAppendixC, parseToolTable } from '../scripts/check-ds310.mjs';

// parseToolTable earns its own tests the hard way: while scoping this work, an
// ad-hoc version of it silently matched nothing and returned {}, which turned
// the whole comparison into "the tool is missing all 252 codes". A parser that
// fails by returning empty is worse than one that throws, because the result
// still looks like an answer.
test('parseToolTable reads the keys out of a const object block', () => {
  const src = [
    'const FC_LOOKUP = {',
    "  'AA':'widget','BB':'gadget',",
    "  'CC':'widget',",
    '};',
  ].join('\n');
  assert.deepEqual(parseToolTable(src, 'FC_LOOKUP'), { AA: 'widget', BB: 'gadget', CC: 'widget' });
});

test('parseToolTable reads only the named table, not a neighbouring one', () => {
  const src = [
    'const FC_LOOKUP = {',
    "  'AA':'widget',",
    '};',
    'const PAC_LOOKUP = {',
    "  '21':'Example Area',",
    '};',
  ].join('\n');
  assert.deepEqual(parseToolTable(src, 'PAC_LOOKUP'), { 21: 'Example Area' });
});

test('parseToolTable tolerates comment lines inside the block', () => {
  const src = [
    'const FC_LOOKUP = {',
    '  // INSTRUMENTS',
    "  'AA':'instrument',",
    '};',
  ].join('\n');
  assert.deepEqual(parseToolTable(src, 'FC_LOOKUP'), { AA: 'instrument' });
});

test('parseToolTable returns {} for a table that is not there — the caller must check', () => {
  assert.deepEqual(parseToolTable('const OTHER = {};', 'FC_LOOKUP'), {});
  assert.deepEqual(parseToolTable('', 'FC_LOOKUP'), {});
  assert.deepEqual(parseToolTable(null, 'FC_LOOKUP'), {});
});

// Fictional codes: the real DS310 lists must not be committed.
test('compareCodes reports codes the standard has and the tool does not', () => {
  const r = compareCodes({
    toolFc: { AA: 'widget' },
    toolDescriptions: { AA: 'A Widget' },
    standardCodes: ['AA', 'BB', 'CC'],
  });
  assert.deepEqual(r.missing, ['BB', 'CC']);
});

test('compareCodes reports tool codes absent from the standard', () => {
  const r = compareCodes({
    toolFc: { AA: 'widget', ZZ: 'legacy' },
    toolDescriptions: {},
    standardCodes: ['AA'],
  });
  assert.deepEqual(r.extra, ['ZZ']);
});

test('compareCodes reports classified codes carrying no description', () => {
  const r = compareCodes({
    toolFc: { AA: 'widget', BB: 'gadget' },
    toolDescriptions: { AA: 'A Widget' },
    standardCodes: ['AA', 'BB'],
  });
  assert.deepEqual(r.undescribed, ['BB']);
});

test('compareCodes sorts every list, so runs are comparable', () => {
  const r = compareCodes({
    toolFc: {},
    toolDescriptions: {},
    standardCodes: ['CC', 'AA', 'BB'],
  });
  assert.deepEqual(r.missing, ['AA', 'BB', 'CC']);
});

test('compareCodes degrades rather than throwing on missing inputs', () => {
  assert.doesNotThrow(() => compareCodes({}));
  const r = compareCodes({});
  assert.deepEqual(r, { missing: [], extra: [], undescribed: [] });
});

test('parseAppendixC reads primary function codes from column 5, skipping headers', () => {
  const csv = [
    ',,,,"Issue 2",,,,',
    ',,,,1,2,3,4',
    'Code,Primary Function Type,Primary Asset Type,Unique Primary,ASSET DESCRIPTION,Primary Function Code,Primary Asset ID Code,Secondary Asset ID Code',
    'A-AAA,A,A,A,EXAMPLE,AA,A,AAA',
    'B-BBB,B,B,FALSE,,BB,B,BBB',
    ',,,,,,,',
  ].join('\n');
  assert.deepEqual(parseAppendixC(csv), ['AA', 'BB']);
});

test('parseAppendixC ignores rows whose function code is blank or not a code', () => {
  const csv = 'h\nh\nh\nx,,,,,,,\ny,,,,,123,,\nz,,,,,CC,,';
  assert.deepEqual(parseAppendixC(csv), ['CC']);
});
