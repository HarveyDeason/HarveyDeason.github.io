import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyBrainState, mergeBrainState, gzipText, gunzipText, DEFAULT_DOC_TYPES } from '../assets/js/brain-core.js';
import { pdfPagesToText, sheetTextFromRows, normalizeExtractedText, extractionMethodFor,
  dedupeFilename, docFolderPath } from '../assets/js/brain-core.js';
import { buildSearchDocs, snippetFor, supersedeDecision, decisionFromComment } from '../assets/js/brain-core.js';

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
  assert.equal(extractionMethodFor('tracker.XLSM'), 'sheet');
  assert.equal(extractionMethodFor('binary.xlsb'), 'sheet');
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

test('buildSearchDocs covers all three kinds with prefixed ids', () => {
  const brain = { ...emptyBrainState('t'),
    decisions: [D('d1', 't')],
    documents: [{ id: 'f1', title: 'HAZOP 12 minutes', docType: 'HAZOP', date: '', productIds: ['p1'],
      projectTag: '', tags: [], filePath: 'x', accUrl: '', extraction: { method: 'pdf', pages: 2, textGz: 'zz' }, updatedAt: 't' }] };
  const comments = [{ id: 'c1', ref: 'HUB-0003', category: 'Instrument change', description: 'PT range', actionTaken: '', raisedBy: 'X', productIds: ['p2'] }];
  const docs = buildSearchDocs(brain, comments, new Map([['f1', '[[p1]] air valve text']]));
  assert.deepEqual(docs.map(d => d.id).sort(), ['c:c1', 'd:d1', 'f:f1']);
  assert.equal(docs.find(d => d.id === 'f:f1').text.includes('air valve'), true);
  assert.equal(docs.find(d => d.id === 'c:c1').who, 'X');
});

test('snippetFor returns context and page marker, strips markers from snippet', () => {
  const text = '[[p1]] irrelevant preamble here\n[[p2]] the air relief valve was rejected due to surge';
  const { snippet, marker } = snippetFor(text, ['relief'], 20);
  assert.equal(marker, 'p.2');
  assert.ok(snippet.includes('air relief valve'));
  assert.ok(!snippet.includes('[[p2]]'));
});

test('supersedeDecision links both directions and preserves history', () => {
  const s0 = { ...emptyBrainState('t'), decisions: [D('d1', 't')] };
  const s1 = supersedeDecision(s0, 'd1', D('d2', 't2', { supersedes: '', title: 'ARV now required' }), '2026-07-26T12:00:00Z');
  const oldD = s1.decisions.find(d => d.id === 'd1');
  const newD = s1.decisions.find(d => d.id === 'd2');
  assert.equal(oldD.status, 'superseded');
  assert.equal(oldD.supersededBy, 'd2');
  assert.equal(newD.supersedes, 'd1');
  assert.throws(() => supersedeDecision(s1, 'nope', D('d3', 't3'), 'now'));
});

test('decisionFromComment prefills reasoning, products, and back-link', () => {
  const p = decisionFromComment({ id: 'c9', description: 'why we changed it', productIds: ['p1', 'p2'] }, '2026-07-26T09:00:00Z');
  assert.equal(p.reasoning, 'why we changed it');
  assert.deepEqual(p.links.comments, ['c9']);
  assert.deepEqual(p.productIds, ['p1', 'p2']);
  assert.equal(p.date, '2026-07-26');
});

// ── Search quality ──────────────────────────────────────────────────────────
import { contentTerms, phraseOf, findPhrase, hasAllTerms, bestSnippetFor,
  highlightRanges } from '../assets/js/brain-core.js';

const SENTENCE = 'Additional costs may be incurred for backwash balance tanks where revised DS493 requirements exceed the original 5m^3 standard product';

test('contentTerms drops stopwords and one-character noise, keeps codes', () => {
  const t = contentTerms(SENTENCE);
  assert.ok(!t.includes('to'));
  assert.ok(!t.includes('may'));
  assert.ok(!t.includes('the'));
  assert.ok(!t.includes('for'));
  assert.ok(t.includes('backwash'));
  assert.ok(t.includes('ds493'));
  assert.ok(t.includes('5m'));
});

test('contentTerms keeps a short query usable even when it is all stopwords', () => {
  assert.deepEqual(contentTerms('to'), ['to']);      // nothing else to search on
  assert.deepEqual(contentTerms(''), []);
});

test('phraseOf only treats real sentences as phrases', () => {
  assert.equal(phraseOf('backwash balance tanks'), 'backwash balance tanks');
  assert.equal(phraseOf('  Backwash   Balance  Tanks '), 'backwash balance tanks');
  assert.equal(phraseOf('valve'), '');               // single word is not a phrase
});

test('findPhrase locates a sentence ignoring whitespace and case differences', () => {
  const doc = '[[p3]] Additional  costs may be\nincurred for backwash balance tanks where revised DS493 requirements exceed';
  assert.ok(findPhrase(doc, 'costs may be incurred for backwash') >= 0);
  assert.equal(findPhrase(doc, 'costs may be reduced'), -1);
});

test('hasAllTerms is the AND gate that stops one shared word matching', () => {
  const other = 'The custodian is to be notified of any change to the register.';
  const real  = 'Backwash balance tanks sized to DS493 requirements, revised from the 5m3 standard product.';
  const terms = contentTerms(SENTENCE);
  assert.equal(hasAllTerms(other, terms), false);
  assert.equal(hasAllTerms(real, ['backwash', 'ds493']), true);
});

test('bestSnippetFor centres on the phrase, and reports its page marker', () => {
  const text = '[[p1]] unrelated preamble about custodians\n[[p4]] Additional costs may be incurred for backwash balance tanks where revised DS493 requirements exceed the original';
  const r = bestSnippetFor(text, contentTerms(SENTENCE), phraseOf(SENTENCE), 60);
  assert.equal(r.marker, 'p.4');
  assert.ok(r.snippet.includes('backwash balance tanks'));
  assert.ok(!r.snippet.includes('[[p4]]'));
});

test('bestSnippetFor picks the densest passage when there is no exact phrase', () => {
  const text = 'backwash appears here alone. ' + 'filler '.repeat(40) + 'backwash balance tanks DS493 together here';
  const r = bestSnippetFor(text, ['backwash', 'balance', 'tanks', 'ds493'], '', 50);
  assert.ok(r.snippet.includes('DS493'), 'should choose the passage with the most terms');
});

test('highlightRanges marks whole words only — never "to" inside "custodian"', () => {
  const ranges = highlightRanges('The custodian is to be notified', ['to']);
  assert.equal(ranges.length, 1);
  const [s, e] = ranges[0];
  assert.equal('The custodian is to be notified'.slice(s, e), 'to');
});

test('highlightRanges merges overlaps and prefers the phrase span', () => {
  const text = 'backwash balance tanks were revised';
  const ranges = highlightRanges(text, ['backwash', 'balance'], 'backwash balance tanks');
  assert.equal(ranges.length, 1);
  assert.equal(text.slice(ranges[0][0], ranges[0][1]), 'backwash balance tanks');
});

test('findPhrase maps back to the exact offset, so the page citation is right', () => {
  const text = '[[p1]] intro about custodians and registers\n[[p3]] Additional costs may be incurred for backwash';
  const idx = findPhrase(text, phraseOf('Additional costs may be incurred'));
  assert.equal(idx, text.indexOf('Additional costs'));
  const r = bestSnippetFor(text, contentTerms('Additional costs may be incurred'), phraseOf('Additional costs may be incurred'), 90);
  assert.equal(r.marker, 'p.3');
});
