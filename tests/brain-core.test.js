import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyBrainState, mergeBrainState, gzipText, gunzipText, DEFAULT_DOC_TYPES } from '../assets/js/brain-core.js';
import { pdfPagesToText, sheetTextFromRows, normalizeExtractedText, extractionMethodFor,
  dedupeFilename, docFolderPath } from '../assets/js/brain-core.js';

const D = (id, updatedAt, extra = {}) => ({
  id, title: 'ARV omitted', decision: 'No ARV on OSB-04 discharge', reasoning: 'Surge analysis showed…',
  madeBy: 'HAZOP chair', recordedBy: 'HD', date: '2026-07-01', productIds: ['p1'], projectTag: '',
  tags: ['air valve'], status: 'active', supersededBy: '', supersedes: '',
  links: { documents: [], comments: [], urls: [] }, updatedAt, ...extra,
});

test('emptyBrainState seeds doc types', () => {
  const s = emptyBrainState('t');
  assert.deepEqual(s.lists.docTypes, DEFAULT_DOC_TYPES);
  assert.equal(s.version, 1);
});

test('mergeBrainState: later updatedAt wins; tombstones respected; lists deduped', () => {
  const a = { ...emptyBrainState('t'), decisions: [D('d1', '2026-07-26T10:00:00Z', { title: 'old' })] };
  const b = { ...emptyBrainState('t'), decisions: [D('d1', '2026-07-26T11:00:00Z', { title: 'new' })] };
  b.lists.tags = ['Air Valve', 'surge'];
  a.lists.tags = ['air valve'];
  const m = mergeBrainState(a, b);
  assert.equal(m.decisions[0].title, 'new');
  assert.equal(m.lists.tags.filter(t => t.toLowerCase() === 'air valve').length, 1);
  const c = mergeBrainState(a, { ...emptyBrainState('t'), tombstones: { d1: '2026-07-26T12:00:00Z' } });
  assert.equal(c.decisions.length, 0);
});

test('gzip round-trips text incl. unicode and page markers', async () => {
  const text = '[[p1]] Air relief valve — HAZOP said ≥ DN80\n[[p2]] more';
  assert.equal(await gunzipText(await gzipText(text)), text);
});

test('pdfPagesToText marks pages', () => {
  assert.equal(pdfPagesToText([['Air', 'valve'], ['DN80']]), '[[p1]] Air valve\n[[p2]] DN80');
});

test('sheetTextFromRows marks sheets and joins cells', () => {
  assert.equal(sheetTextFromRows([{ name: 'Actions', rows: [['1', 'Fit ARV'], ['2', 'Review']] }]),
    '[[sheet:Actions]] 1 Fit ARV\n2 Review');
});

test('normalizeExtractedText collapses runs but keeps line breaks', () => {
  assert.equal(normalizeExtractedText('a   b\n\n\nc\t d '), 'a b\nc d');
});

test('extractionMethodFor maps extensions, .doc is none', () => {
  assert.equal(extractionMethodFor('minutes.PDF'), 'pdf');
  assert.equal(extractionMethodFor('minutes.docx'), 'docx');
  assert.equal(extractionMethodFor('reg.xlsx'), 'sheet');
  assert.equal(extractionMethodFor('old.doc'), 'none');
  assert.equal(extractionMethodFor('photo.png'), 'none');
});

test('dedupeFilename suffixes (2), (3)…', () => {
  assert.equal(dedupeFilename(['a.pdf'], 'b.pdf'), 'b.pdf');
  assert.equal(dedupeFilename(['a.pdf'], 'a.pdf'), 'a (2).pdf');
  assert.equal(dedupeFilename(['a.pdf', 'a (2).pdf'], 'a.pdf'), 'a (3).pdf');
});

test('docFolderPath files under product/type, _General without type', () => {
  assert.deepEqual(docFolderPath('OSB-01 Chemical Dosing', 'HAZOP'), ['Documents', 'OSB-01 Chemical Dosing', 'HAZOP']);
  assert.deepEqual(docFolderPath(null, 'HAZOP'), ['Documents', '_General']);
});
