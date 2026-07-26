// tests/hub-core.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, mergeState, DEFAULT_CATEGORIES } from '../assets/js/hub-core.js';
import { formatRef, nextRef, resequenceRefs } from '../assets/js/hub-core.js';
import { buildProductWorkbookModel, buildMasterWorkbookModel, buildFilteredWorkbookModel,
  COMMENT_COLUMNS, statusLabel, sanitizeFilename } from '../assets/js/hub-core.js';
import { expandFamilyPatterns, familiesFromRegister, familyProductId, familyMembership,
  expandProductFilter } from '../assets/js/hub-core.js';
import { excelSheetName, buildFamilyWorkbookModel, staleFamilyMemberFiles } from '../assets/js/hub-core.js';

const P = (id, updatedAt, name = 'OSB-01') =>
  ({ id, name, type: 'OSB item', pidDrawings: [], modelRef: '', sheetRefs: '', updatedAt });
const C = (id, updatedAt, extra = {}) => ({
  id, ref: 'HUB-0001', productIds: ['p1'], affectedTypes: ['P&ID'], category: 'Pipework change',
  source: 'Site feedback', dateRaised: '2026-07-24', raisedBy: 'A N Other', description: 'x',
  priority: 'medium', status: 'open', hold: false, pidRevision: '', dateClosed: '', actionTaken: '',
  closedBy: '', updatedAt, ...extra,
});

test('emptyState seeds defaults', () => {
  const s = emptyState('2026-07-24T00:00:00Z');
  assert.equal(s.version, 1);
  assert.deepEqual(s.lists.categories, DEFAULT_CATEGORIES);
  assert.equal(s.refCounter, 0);
});

test('mergeState: later updatedAt wins per comment id', () => {
  const local = { ...emptyState('t'), comments: [C('c1', '2026-07-24T10:00:00Z', { description: 'old' })] };
  const disk  = { ...emptyState('t'), comments: [C('c1', '2026-07-24T11:00:00Z', { description: 'new' })] };
  assert.equal(mergeState(local, disk).comments[0].description, 'new');
  assert.equal(mergeState(disk, local).comments[0].description, 'new'); // symmetric
});

test('mergeState: union of distinct records from both sides', () => {
  const local = { ...emptyState('t'), products: [P('p1', '2026-07-24T10:00:00Z')] };
  const disk  = { ...emptyState('t'), products: [P('p2', '2026-07-24T10:00:00Z', 'OSB-02')] };
  assert.equal(mergeState(local, disk).products.length, 2);
});

test('mergeState: tombstone at/after updatedAt removes record; max tombstone kept', () => {
  const local = { ...emptyState('t'), comments: [C('c1', '2026-07-24T10:00:00Z')] };
  const disk  = { ...emptyState('t'), tombstones: { c1: '2026-07-24T10:00:00Z' } };
  const m = mergeState(local, disk);
  assert.equal(m.comments.length, 0);
  assert.equal(m.tombstones.c1, '2026-07-24T10:00:00Z');
});

test('mergeState: record edited after tombstone survives (reinstated)', () => {
  const local = { ...emptyState('t'), comments: [C('c1', '2026-07-24T12:00:00Z')] };
  const disk  = { ...emptyState('t'), tombstones: { c1: '2026-07-24T10:00:00Z' } };
  assert.equal(mergeState(local, disk).comments.length, 1);
});

test('mergeState: lists deduped case-insensitively, local order first', () => {
  const local = { ...emptyState('t') };
  const disk  = { ...emptyState('t') };
  disk.lists = { categories: ['pipework change', 'Cable change'], sources: [] };
  const m = mergeState(local, disk);
  assert.equal(m.lists.categories.filter(c => c.toLowerCase() === 'pipework change').length, 1);
  assert.ok(m.lists.categories.includes('Cable change'));
});

test('mergeState: refCounter takes the max, does not mutate inputs', () => {
  const local = { ...emptyState('t'), refCounter: 7 };
  const disk  = { ...emptyState('t'), refCounter: 12 };
  const snapshot = JSON.stringify(local);
  assert.equal(mergeState(local, disk).refCounter, 12);
  assert.equal(JSON.stringify(local), snapshot);
});

test('formatRef pads to 4 digits and grows beyond', () => {
  assert.equal(formatRef(7), 'HUB-0007');
  assert.equal(formatRef(12345), 'HUB-12345');
});

test('nextRef issues the next ref without mutating state', () => {
  const s = { ...emptyState('t'), refCounter: 41 };
  const { ref, refCounter } = nextRef(s);
  assert.equal(ref, 'HUB-0042');
  assert.equal(refCounter, 42);
  assert.equal(s.refCounter, 41);
});

test('merge of two sides that both issued HUB-0002 re-sequences deterministically', () => {
  const base = { ...emptyState('t'), refCounter: 1 };
  const a = { ...base, refCounter: 2, comments: [C('ca', '2026-07-24T10:00:00Z', { ref: 'HUB-0002', dateRaised: '2026-07-20' })] };
  const b = { ...base, refCounter: 2, comments: [C('cb', '2026-07-24T10:30:00Z', { ref: 'HUB-0002', dateRaised: '2026-07-22' })] };
  const m1 = mergeState(a, b);
  const m2 = mergeState(b, a);
  const refs1 = m1.comments.map(c => [c.id, c.ref]).sort();
  assert.deepEqual(refs1, m2.comments.map(c => [c.id, c.ref]).sort()); // symmetric
  const earlier = m1.comments.find(c => c.id === 'ca');
  const later = m1.comments.find(c => c.id === 'cb');
  assert.equal(earlier.ref, 'HUB-0002'); // earlier dateRaised keeps the ref
  assert.equal(later.ref, 'HUB-0003');
  assert.equal(m1.refCounter, 3);
});

import { filterComments, commentCounts, productCounts, daysOpen, latestRevisions } from '../assets/js/hub-core.js';

test('filterComments ANDs filters and searches text case-insensitively', () => {
  const cs = [
    C('c1', 't', { productIds: ['p1'], status: 'open', description: 'Replace GATE valve' }),
    C('c2', 't', { productIds: ['p2'], status: 'closed', description: 'Re-route pipework' }),
  ];
  assert.deepEqual(filterComments(cs, { productId: 'p1' }).map(c => c.id), ['c1']);
  assert.deepEqual(filterComments(cs, { search: 'gate' }).map(c => c.id), ['c1']);
  assert.deepEqual(filterComments(cs, { productId: 'p1', status: 'closed' }), []);
});

test('hold filter distinguishes held vs not-held open comments', () => {
  const cs = [C('c1', 't', { hold: true }), C('c2', 't', { hold: false })];
  assert.deepEqual(filterComments(cs, { hold: 'held' }).map(c => c.id), ['c1']);
  assert.deepEqual(filterComments(cs, { hold: 'not_held' }).map(c => c.id), ['c2']);
});

test('commentCounts and productCounts', () => {
  const cs = [
    C('c1', 't', { status: 'open', priority: 'high' }),
    C('c2', 't', { status: 'in_progress' }),
    C('c3', 't', { status: 'closed', productIds: ['p2'] }),
  ];
  assert.deepEqual(commentCounts(cs), { open: 1, inProgress: 1, closed: 1, highOpen: 1 });
  assert.deepEqual(productCounts(cs).get('p1'), { open: 1, inProgress: 1, closed: 0 });
});

test('daysOpen measures to today for open, to dateClosed for closed', () => {
  assert.equal(daysOpen(C('c', 't', { dateRaised: '2026-07-01' }), '2026-07-24'), 23);
  assert.equal(daysOpen(C('c', 't', { dateRaised: '2026-07-01', status: 'closed', dateClosed: '2026-07-10' }), '2026-07-24'), 9);
});

test('latestRevisions picks the revision with the newest importedAt', () => {
  const reg = { revHistory: { 'DRG-001': {
    A: { importedAt: '2026-01-01T00:00:00Z' },
    B: { importedAt: '2026-06-01T00:00:00Z' },
  } } };
  assert.equal(latestRevisions(reg).get('DRG-001'), 'B');
});

function demoState() {
  const s = emptyState('2026-07-24T09:00:00Z');
  s.products = [
    { id: 'p1', name: 'OSB-01 Chemical Dosing', type: 'OSB item', pidDrawings: ['DRG-001'], modelRef: 'M-01', sheetRefs: 'SH-01', updatedAt: 't' },
    { id: 'p2', name: 'OSB-02 Kiosk', type: 'Standard product', pidDrawings: [], modelRef: '', sheetRefs: '', updatedAt: 't' },
  ];
  s.comments = [
    C('c1', 't', { ref: 'HUB-0001', productIds: ['p1', 'p2'], status: 'open', priority: 'high' }),
    C('c2', 't', { ref: 'HUB-0002', productIds: ['p2'], status: 'closed', dateClosed: '2026-07-20', actionTaken: 'Done', closedBy: 'HD' }),
  ];
  return s;
}

test('product workbook: summary + log, only that product’s comments, revision from register', () => {
  const m = buildProductWorkbookModel(demoState(), 'p1', new Map([['DRG-001', 'C']]), '2026-07-24');
  assert.equal(m.filename, 'OSB-01 Chemical Dosing Comments.xlsx');
  assert.equal(m.sheets.length, 2);
  assert.equal(m.sheets[0].kind, 'summary');
  assert.ok(m.sheets[0].rows.some(([label, value]) => label.includes('P&ID') && value.includes('DRG-001 (Rev C)')));
  const log = m.sheets[1];
  assert.equal(log.rows.length, 1);
  assert.equal(log.rows[0].cells.ref, 'HUB-0001');
  assert.equal(log.rows[0].statusKey, 'open');
  assert.equal(log.rows[0].high, true);
});

test('master workbook: overview counts + product column on every row', () => {
  const m = buildMasterWorkbookModel(demoState(), new Map(), '2026-07-24');
  assert.equal(m.filename, 'Master Log.xlsx');
  assert.equal(m.sheets[0].kind, 'summary');
  assert.ok(m.sheets[0].rows.some(([label]) => label === 'OSB-01 Chemical Dosing'));
  const log = m.sheets[1];
  assert.equal(log.columns[0].key, 'product');
  assert.equal(log.rows.length, 2);
  assert.equal(log.rows[0].cells.product, 'OSB-01 Chemical Dosing, OSB-02 Kiosk');
});

test('filtered workbook uses only supplied comments', () => {
  const s = demoState();
  const m = buildFilteredWorkbookModel(s, s.comments.filter(c => c.status === 'closed'), '2026-07-24');
  assert.equal(m.sheets.length, 1);
  assert.equal(m.sheets[0].rows.length, 1);
  assert.equal(m.sheets[0].rows[0].cells.ref, 'HUB-0002');
});

test('statusLabel and sanitizeFilename', () => {
  assert.equal(statusLabel('in_progress'), 'In progress');
  assert.equal(sanitizeFilename('A/B:C'), 'A-B-C');
  assert.ok(COMMENT_COLUMNS.some(c => c.key === 'description' && c.width >= 50));
});

const DRAWINGS = ['SP51', 'SP52-01', 'SP68', 'SP69', 'WW-KIOSK-01'];

test('expandFamilyPatterns: numeric range with prefix', () => {
  const m = expandFamilyPatterns(['SP51-68'], DRAWINGS);
  assert.deepEqual([...m].sort(), ['SP51', 'SP52-01', 'SP68']);
});

test('expandFamilyPatterns: plain pattern matches prefix or substring, case-insensitive', () => {
  assert.deepEqual([...expandFamilyPatterns(['kiosk'], DRAWINGS)], ['WW-KIOSK-01']);
  assert.equal(expandFamilyPatterns(['', '  '], DRAWINGS).size, 0);
});

test('familiesFromRegister expands against revHistory keys, sorted by name', () => {
  const reg = { revHistory: Object.fromEntries(DRAWINGS.map(d => [d, {}])),
    families: [{ id: 'f2', name: 'Zeta', patterns: ['SP69'] }, { id: 'f1', name: 'SP51-68', patterns: ['SP51-68'] }] };
  const fams = familiesFromRegister(reg);
  assert.deepEqual(fams.map(f => f.name), ['SP51-68', 'Zeta']);
  assert.deepEqual(fams[0].drawings.sort(), ['SP51', 'SP52-01', 'SP68']);
  assert.deepEqual(familiesFromRegister({}), []);
});

test('familyMembership and expandProductFilter roll up both directions', () => {
  const products = [
    { id: 'fam-f1', name: 'SP51-68', familyId: 'f1', pidDrawings: ['SP51', 'SP52-01', 'SP68'] },
    { id: 'reg-SP51', name: 'SP51', pidDrawings: ['SP51'] },
    { id: 'reg-SP69', name: 'SP69', pidDrawings: ['SP69'] },
    { id: 'manual1', name: 'Kiosk', pidDrawings: [] },
  ];
  const fams = [{ id: 'f1', name: 'SP51-68', drawings: ['SP51', 'SP52-01', 'SP68'] }];
  const mem = familyMembership(products, fams);
  assert.deepEqual(mem.members.get('fam-f1'), ['reg-SP51']);
  assert.equal(mem.familyOf.get('reg-SP51'), 'fam-f1');
  assert.equal(mem.familyOf.get('reg-SP69'), undefined);
  assert.deepEqual([...expandProductFilter('fam-f1', mem)].sort(), ['fam-f1', 'reg-SP51']);
  assert.deepEqual([...expandProductFilter('reg-SP51', mem)].sort(), ['fam-f1', 'reg-SP51']);
  assert.deepEqual([...expandProductFilter('manual1', mem)], ['manual1']);
});

test('excelSheetName strips banned chars, truncates to 31, dedupes', () => {
  assert.equal(excelSheetName('SP52-01: [Rev]/A', []), 'SP52-01- -Rev--A');
  const long = 'X'.repeat(40);
  assert.equal(excelSheetName(long, []).length, 31);
  const first = excelSheetName(long, []);
  const second = excelSheetName(long, [first]);
  assert.notEqual(second, first);
  assert.ok(second.length <= 31 && second.endsWith(' (2)'));
});

function famState() {
  const s = emptyState('t');
  s.products = [
    { id: 'fam-f1', name: 'SP51-68', type: 'OSB item', familyId: 'f1', pidDrawings: ['SP51', 'SP68'], modelRef: '', sheetRefs: '', updatedAt: 't' },
    { id: 'reg-SP51', name: 'SP51', type: 'OSB item', pidDrawings: ['SP51'], modelRef: '', sheetRefs: '', updatedAt: 't' },
    { id: 'reg-SP68', name: 'SP68', type: 'OSB item', pidDrawings: ['SP68'], modelRef: '', sheetRefs: '', updatedAt: 't' },
  ];
  s.comments = [
    C('c1', 't', { ref: 'HUB-0001', productIds: ['fam-f1'], description: 'range-wide change' }),
    C('c2', 't', { ref: 'HUB-0002', productIds: ['reg-SP51'], description: 'SP51 only' }),
  ];
  return s;
}

test('family workbook: summary + family sheet + one sheet per member, no duplication', () => {
  const s = famState();
  const membership = { members: new Map([['fam-f1', ['reg-SP51', 'reg-SP68']]]),
    familyOf: new Map([['reg-SP51', 'fam-f1'], ['reg-SP68', 'fam-f1']]) };
  const m = buildFamilyWorkbookModel(s, 'fam-f1', membership, new Map([['SP51', 'C']]), '2026-07-26');
  assert.equal(m.filename, 'SP51-68 Comments.xlsx');
  assert.deepEqual(m.sheets.map(x => x.name), ['Summary', 'Family Comments', 'SP51', 'SP68']);
  assert.equal(m.sheets[1].rows.length, 1);
  assert.equal(m.sheets[1].rows[0].cells.ref, 'HUB-0001');
  assert.equal(m.sheets[2].heading, 'SP51');
  assert.equal(m.sheets[2].rows.length, 1);
  assert.equal(m.sheets[2].rows[0].cells.ref, 'HUB-0002');
  assert.equal(m.sheets[3].rows.length, 0);
  assert.ok(m.sheets[0].rows.some(([l, v]) => l.includes('Member') && v.includes('SP51 (Rev C)')));
});

test('staleFamilyMemberFiles predicts old per-member filenames', () => {
  const s = famState();
  const membership = { members: new Map([['fam-f1', ['reg-SP51', 'reg-SP68']]]), familyOf: new Map() };
  assert.deepEqual(staleFamilyMemberFiles(s, membership).sort(), ['SP51 Comments.xlsx', 'SP68 Comments.xlsx']);
});

// Folder/file names go straight to the OS. Windows rejects trailing dots and
// spaces, reserved device names, and control characters — and a name that
// sanitises to nothing would throw on create. Any of those failed folder
// creation, which the tool then mislabelled as "locked".
test('sanitizeFilename strips trailing dots and spaces Windows rejects', () => {
  assert.equal(sanitizeFilename('SP51-68 '), 'SP51-68');
  assert.equal(sanitizeFilename('SP51-68.'), 'SP51-68');
  assert.equal(sanitizeFilename('  SP51-68  '), 'SP51-68');
});

test('sanitizeFilename guards reserved device names and empty results', () => {
  assert.equal(sanitizeFilename('CON'), 'CON_');
  assert.equal(sanitizeFilename('lpt1'), 'lpt1_');
  assert.equal(sanitizeFilename('   '), 'Unnamed');
  assert.equal(sanitizeFilename('///'), '---');
});

test('sanitizeFilename keeps its existing substitution behaviour', () => {
  assert.equal(sanitizeFilename('A/B:C'), 'A-B-C');
  assert.equal(sanitizeFilename('SP51-68'), 'SP51-68');
});
