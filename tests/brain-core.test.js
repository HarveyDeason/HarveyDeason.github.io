import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyBrainState, mergeBrainState, gzipText, gunzipText, DEFAULT_DOC_TYPES } from '../assets/js/brain-core.js';
import { pdfPagesToText, sheetTextFromRows, normalizeExtractedText, extractionMethodFor,
  dedupeFilename, docFolderPath } from '../assets/js/brain-core.js';
import { buildSearchDocs, snippetFor, supersedeDecision, decisionFromComment } from '../assets/js/brain-core.js';
import { addPhotoToDecision, removePhotoFromDecision, decisionPhotoNames } from '../assets/js/brain-core.js';
import { DECISION_COLUMNS, buildDecisionsWorkbookModel } from '../assets/js/brain-core.js';

const D = (id, updatedAt, extra = {}) => ({
  id, title: 'A decision', decision: 'We did X', reasoning: 'Surge analysis showed…',
  madeBy: 'A N Other', recordedBy: 'HD', date: '2026-07-01', productIds: ['p1'], projectTag: '',
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

test('emptyBrainState has a history collection', () => {
  assert.deepEqual(emptyBrainState('T').history, []);
});

test('mergeBrainState unions history from both sides — no entry is ever lost', () => {
  const e = (id, recordId) => ({ id, recordId, recordType: 'decision', at: 'T', by: 'X', changes: [] });
  const local = { ...emptyBrainState('T'), history: [e('h1', 'd1')] };
  const disk  = { ...emptyBrainState('T'), history: [e('h2', 'd1')] };
  assert.deepEqual(mergeBrainState(local, disk).history.map(x => x.id).sort(), ['h1', 'h2']);
});

test('history survives a tombstoned decision — a deleted decision still has a trail', () => {
  const local = { ...emptyBrainState('T'),
    history: [{ id: 'h1', recordId: 'd1', recordType: 'decision', at: 'T', by: 'X', changes: [] }],
    tombstones: { d1: '2026-08-02T10:00:00Z' } };
  assert.equal(mergeBrainState(local, emptyBrainState('T')).history.length, 1);
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

const PH = (id, file, caption = '') =>
  ({ id, file, thumb: file, caption, addedAt: '2026-07-27T09:00:00Z', addedBy: '' });

test('addPhotoToDecision appends and bumps updatedAt', () => {
  const s0 = { ...emptyBrainState('t'), decisions: [D('d1', '2026-07-27T08:00:00Z')] };
  const s1 = addPhotoToDecision(s0, 'd1', PH('p1', 'access.jpg', 'access'), '2026-07-27T09:00:00Z');
  assert.equal(s1.decisions[0].photos.length, 1);
  assert.equal(s1.decisions[0].photos[0].file, 'access.jpg');
  assert.equal(s1.decisions[0].updatedAt, '2026-07-27T09:00:00Z');
  assert.equal(s0.decisions[0].photos, undefined);          // input untouched
});

test('addPhotoToDecision on an unknown id is a no-op', () => {
  const s0 = { ...emptyBrainState('t'), decisions: [D('d1', '2026-07-27T08:00:00Z')] };
  assert.deepEqual(addPhotoToDecision(s0, 'nope', PH('p1', 'a.jpg'), 'x'), s0);
});

test('removePhotoFromDecision drops one entry and bumps updatedAt', () => {
  const s0 = { ...emptyBrainState('t'), decisions: [
    D('d1', '2026-07-27T08:00:00Z', { photos: [PH('p1', 'a.jpg'), PH('p2', 'b.jpg')] })] };
  const s1 = removePhotoFromDecision(s0, 'd1', 'p1', '2026-07-27T10:00:00Z');
  assert.deepEqual(s1.decisions[0].photos.map(p => p.id), ['p2']);
  assert.equal(s1.decisions[0].updatedAt, '2026-07-27T10:00:00Z');
});

test('removePhotoFromDecision on an unknown photo id is a no-op', () => {
  const s0 = { ...emptyBrainState('t'), decisions: [
    D('d1', '2026-07-27T08:00:00Z', { photos: [PH('p1', 'a.jpg')] })] };
  assert.deepEqual(removePhotoFromDecision(s0, 'd1', 'nope', 'x'), s0);
});

test('decisionPhotoNames collects every filename across decisions', () => {
  const s = { ...emptyBrainState('t'), decisions: [
    D('d1', 't', { photos: [PH('p1', 'access.jpg'), PH('p2', 'valve.jpg')] }),
    D('d2', 't', { photos: [PH('p3', 'access (2).jpg')] }),
    D('d3', 't'),
  ] };
  assert.deepEqual(decisionPhotoNames(s).sort(), ['access (2).jpg', 'access.jpg', 'valve.jpg']);
});

test('decisionPhotoNames is empty when nothing has photos', () => {
  assert.deepEqual(decisionPhotoNames({ ...emptyBrainState('t'), decisions: [D('d1', 't')] }), []);
});

// ── Decisions workbook model ────────────────────────────────────────────────

test('DECISION_COLUMNS covers the record and ends with Photos', () => {
  assert.deepEqual(DECISION_COLUMNS.map(c => c.key), [
    'date', 'title', 'decision', 'reasoning', 'products', 'projectTag', 'tags',
    'madeBy', 'recordedBy', 'status', 'supersedes', 'photos',
  ]);
  assert.deepEqual(DECISION_COLUMNS[DECISION_COLUMNS.length - 1], { key: 'photos', header: 'Photos', width: 30 });
});

test('buildDecisionsWorkbookModel renders one row per decision, newest first', () => {
  const state = { ...emptyBrainState('t'), decisions: [
    D('d1', 't', { date: '2026-07-01', title: 'Older' }),
    D('d2', 't', { date: '2026-07-20', title: 'Newer' }),
  ] };
  const m = buildDecisionsWorkbookModel(state, state.decisions, '2026-07-27');
  assert.equal(m.filename, 'Decisions Export 2026-07-27.xlsx');
  assert.equal(m.sheets.length, 1);
  assert.equal(m.sheets[0].kind, 'log');
  assert.deepEqual(m.sheets[0].rows.map(r => r.cells.title), ['Newer', 'Older']);
});

test('buildDecisionsWorkbookModel fills the cells from the record', () => {
  const state = { ...emptyBrainState('t'),
    decisions: [D('d1', 't', { tags: ['hazop', 'access'], projectTag: 'AMP8',
      photos: [PH('p1', 'access.jpg'), PH('p2', 'valve.jpg')] })] };
  const cells = buildDecisionsWorkbookModel(state, state.decisions, '2026-07-27').sheets[0].rows[0].cells;
  assert.equal(cells.title, 'A decision');
  assert.equal(cells.decision, 'We did X');
  assert.equal(cells.tags, 'hazop, access');
  assert.equal(cells.projectTag, 'AMP8');
  assert.equal(cells.madeBy, 'A N Other');
  assert.equal(cells.status, 'Active');
  assert.equal(cells.photos, '2 photos: access.jpg, valve.jpg');
});

test('buildDecisionsWorkbookModel keeps superseded decisions and names the successor', () => {
  const state = { ...emptyBrainState('t'), decisions: [
    D('old', 't', { title: 'Old way', status: 'superseded', supersededBy: 'new', date: '2026-07-01' }),
    D('new', 't', { title: 'New way', supersedes: 'old', date: '2026-07-02' }),
  ] };
  const rows = buildDecisionsWorkbookModel(state, state.decisions, '2026-07-27').sheets[0].rows;
  assert.equal(rows.length, 2);
  const oldRow = rows.find(r => r.cells.title === 'Old way');
  assert.equal(oldRow.cells.status, 'Superseded');
  assert.equal(oldRow.statusKey, 'superseded');
  assert.equal(rows.find(r => r.cells.title === 'New way').cells.supersedes, 'Old way');
});

test('buildDecisionsWorkbookModel names products, falling back to the id', () => {
  const state = { ...emptyBrainState('t'), decisions: [D('d1', 't', { productIds: ['p1', 'ghost'] })] };
  const cells = buildDecisionsWorkbookModel(state, state.decisions,
    '2026-07-27', new Map([['p1', 'Sampler Kiosk']])).sheets[0].rows[0].cells;
  assert.equal(cells.products, 'Sampler Kiosk, ghost');
});

test('buildDecisionsWorkbookModel with no decisions still produces a sheet', () => {
  const m = buildDecisionsWorkbookModel(emptyBrainState('t'), [], '2026-07-27');
  assert.deepEqual(m.sheets[0].rows, []);
});
