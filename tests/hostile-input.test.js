// tests/hostile-input.test.js
//
// A ledger is written by another tool, may be read mid-write, hand-edited, or
// mangled by a sync client. One bad record making a tool fail to load breaks
// it for everyone, because the folder is shared. This suite fuzzes every
// exported pure function across hub-core.js, hub-sync.js, brain-core.js,
// hub-presence.js, hub-intake.js and pid-comments.js with hostile values and
// asserts none of them throw. Degraded/empty output is fine; an exception is
// not.
//
// EXCLUDED from the generic no-throw fuzz, and why:
//  - writeFile / writeFileAtomic / createSyncEngine's internal async methods
//    (hub-sync.js): these are I/O functions that throw BY DESIGN on failure
//    (a caller-visible signal, caught by the sync loop's retry/backoff). They
//    are not "pure" in the sense this task means. createSyncEngine's
//    SYNCHRONOUS construction step is still fuzzed below, since a hostile cfg
//    must not crash the tool before any I/O is attempted.
//  - supersedeDecision (brain-core.js): explicitly throws
//    `Error('supersedeDecision: unknown decision ' + oldId)` for a genuinely
//    unknown id — a documented business-validation error the caller is
//    expected to catch, not a crash on malformed data. It IS fuzzed for the
//    "state itself is garbage" case (must not throw a raw TypeError instead
//    of the documented Error).
//  - parseIntakeWorkbook (hub-intake.js): takes a live ExcelJS workbook, not
//    ledger data — throws documented Errors ("No usable sheet...") for a
//    workbook that doesn't look like the tool's own template. It IS fuzzed
//    for the "workbook itself is garbage" case (must not throw a raw
//    TypeError instead of a documented Error, or better, not throw at all
//    when possible).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as hubCore from '../assets/js/hub-core.js';
import * as hubSync from '../assets/js/hub-sync.js';
import * as brainCore from '../assets/js/brain-core.js';
import * as hubPresence from '../assets/js/hub-presence.js';
import * as hubIntake from '../assets/js/hub-intake.js';
import * as pidComments from '../assets/js/pid-comments.js';

// ── Hostile value palette ───────────────────────────────────────────────
const DEEP_NONSENSE = {
  a: { b: { c: [{ d: null }, undefined, [1, [2, [3, { e: 'f' }]]]] }, g: () => {} },
  toString() { return '[deep]'; },
};

function describe(v) {
  if (typeof v === 'function') return '<function>';
  if (Number.isNaN(v)) return 'NaN';
  try { return JSON.stringify(v); } catch { return String(v); }
}

const HOSTILE_VALUES = [
  undefined, null, 0, '', [], {}, NaN, true,
  'a string where an object is expected',
  [1, 2, 3],
  function hostileFn() { return 'x'; },
  DEEP_NONSENSE,
];

// ── Generic fuzz harness ────────────────────────────────────────────────
// For each argument position, substitutes every hostile value in turn while
// keeping the other positions at a realistic default, and asserts the call
// never throws. `safeArgs` should be a call shaped like real usage so the
// function actually reaches interesting code paths at every other position.
function fuzz(name, fn, safeArgs) {
  test(`${name}: no throw with hostile value in any argument position`, () => {
    for (let i = 0; i < safeArgs.length; i++) {
      for (const v of HOSTILE_VALUES) {
        const args = safeArgs.slice();
        args[i] = v;
        assert.doesNotThrow(() => fn(...args),
          `${name} threw with arg[${i}] = ${describe(v)}`);
      }
    }
  });
}

// Like fuzz(), but for async functions: no rejection is allowed either.
function fuzzAsync(name, fn, safeArgs) {
  test(`${name}: no throw/reject with hostile value in any argument position`, async () => {
    for (let i = 0; i < safeArgs.length; i++) {
      for (const v of HOSTILE_VALUES) {
        const args = safeArgs.slice();
        args[i] = v;
        await assert.doesNotReject(fn(...args),
          `${name} rejected with arg[${i}] = ${describe(v)}`);
      }
    }
  });
}

// ── Realistic-shaped fixtures used as "safe" positions in the fuzz table ──
const product = { id: 'p1', name: 'OSB-01', type: 'OSB item', pidDrawings: ['D-001'], modelRef: '', sheetRefs: '', updatedAt: '2026-08-01T00:00:00Z' };
const comment = {
  id: 'c1', ref: 'HUB-0001', productIds: ['p1'], affectedTypes: ['P&ID'], category: 'Pipework change',
  source: 'Site feedback', dateRaised: '2026-07-24', raisedBy: 'A N Other', description: 'x',
  priority: 'medium', status: 'open', hold: false, pidRevision: '', dateClosed: '', actionTaken: '',
  closedBy: '', updatedAt: '2026-08-01T00:00:00Z',
};
const hubState = { ...hubCore.emptyState('2026-08-01T00:00:00Z'), products: [product], comments: [comment] };
const registerJson = { revHistory: { 'D-001': { A: { importedAt: '2026-07-01T00:00:00Z' } } }, families: [{ id: 'f1', name: 'Fam', patterns: ['D-0'] }] };
const decision = {
  id: 'd1', title: 'Use gate valve', decision: 'Gate valve', reasoning: 'cost', madeBy: 'HD', recordedBy: 'HD',
  date: '2026-08-01', productIds: ['p1'], projectTag: '', tags: ['valve'], status: 'active',
  supersededBy: '', supersedes: '', updatedAt: '2026-08-01T00:00:00Z', links: { documents: [], comments: [], urls: [] },
};
const brainState = { ...brainCore.emptyBrainState('2026-08-01T00:00:00Z'), decisions: [decision], documents: [] };
const presenceRec = { name: 'Harvey', sessionId: 's1', tool: 'hub', editingCommentId: null, viewingCommentId: null, lastSeen: '2026-08-01T00:00:00Z' };
const hubData = { products: [product], comments: [comment] };
const membership = hubCore.familyMembership([product], hubCore.familiesFromRegister(registerJson));

// ── hub-core.js ─────────────────────────────────────────────────────────

fuzz('emptyState', hubCore.emptyState, ['2026-08-01T00:00:00Z']);
fuzz('mergeState', hubCore.mergeState, [hubState, hubState]);
fuzz('formatRef', hubCore.formatRef, [3]);
fuzz('nextRef', hubCore.nextRef, [hubState]);
fuzz('resequenceRefs', hubCore.resequenceRefs, [hubState]);
fuzz('filterComments', hubCore.filterComments, [[comment], { search: 'x' }]);
fuzz('commentCounts', hubCore.commentCounts, [[comment]]);
fuzz('productCounts', hubCore.productCounts, [[comment]]);
fuzz('daysOpen', hubCore.daysOpen, [comment, '2026-08-01']);
fuzz('latestRevisions', hubCore.latestRevisions, [registerJson]);
fuzz('statusLabel', hubCore.statusLabel, ['open']);
fuzz('sanitizeFilename', hubCore.sanitizeFilename, ['My File']);
fuzz('photoFileName', hubCore.photoFileName, ['Caption', 'orig.jpg', ['other.jpg']]);
fuzz('addPhotoToComment', hubCore.addPhotoToComment, [hubState, 'c1', { id: 'ph1', file: 'a.jpg' }, '2026-08-01T00:00:00Z']);
fuzz('removePhotoFromComment', hubCore.removePhotoFromComment, [hubState, 'c1', 'ph1', '2026-08-01T00:00:00Z']);
fuzz('photosCell', hubCore.photosCell, [comment]);
fuzz('stampEdit', hubCore.stampEdit, [comment, 'Harvey', '2026-08-01T00:00:00Z']);
fuzz('editedCell', hubCore.editedCell, [comment]);
fuzz('buildProductWorkbookModel', hubCore.buildProductWorkbookModel, [hubState, 'p1', new Map(), '2026-08-01T00:00:00Z']);
fuzz('buildMasterWorkbookModel', hubCore.buildMasterWorkbookModel, [hubState, new Map(), '2026-08-01T00:00:00Z']);
fuzz('buildFilteredWorkbookModel', hubCore.buildFilteredWorkbookModel, [hubState, [comment], '2026-08-01T00:00:00Z']);
fuzz('expandFamilyPatterns', hubCore.expandFamilyPatterns, [['D-0'], ['D-001', 'D-002']]);
fuzz('familiesFromRegister', hubCore.familiesFromRegister, [registerJson]);
fuzz('familyProductId', hubCore.familyProductId, ['f1']);
fuzz('familyMembership', hubCore.familyMembership, [[product], hubCore.familiesFromRegister(registerJson)]);
fuzz('expandProductFilter', hubCore.expandProductFilter, ['p1', membership]);
fuzz('excelSheetName', hubCore.excelSheetName, ['Sheet Name', ['Other']]);
fuzz('buildFamilyWorkbookModel', hubCore.buildFamilyWorkbookModel,
  [{ ...hubState, products: [product, { ...product, id: 'fam-f1', name: 'Fam' }] }, 'fam-f1', membership, new Map(), '2026-08-01T00:00:00Z']);
fuzz('staleFamilyMemberFiles', hubCore.staleFamilyMemberFiles, [hubState, membership]);

// ── hub-sync.js ─────────────────────────────────────────────────────────

fuzz('mergeById', hubSync.mergeById, [[comment], [comment], {}]);
fuzz('mergeList', hubSync.mergeList, [['a', 'b'], ['b', 'c']]);
fuzz('mergeTombstones', hubSync.mergeTombstones, [{ a: '2026-01-01' }, { b: '2026-01-02' }]);
fuzz('detectConflict', hubSync.detectConflict, [comment, [comment]]);
fuzz('conflictFields', hubSync.conflictFields, [comment, comment]);
fuzz('diffRecord', hubSync.diffRecord, [comment, comment, ['updatedAt']]);
fuzz('historyEntry', hubSync.historyEntry, [{ recordId: 'c1', recordType: 'comment', by: 'Harvey', nowIso: '2026-08-01T00:00:00Z', changes: [] }]);
fuzz('createEntry', hubSync.createEntry, [{ recordId: 'c1', recordType: 'comment', by: 'Harvey', nowIso: '2026-08-01T00:00:00Z' }]);
fuzz('historyFor', hubSync.historyFor, [[{ id: 'h1', recordId: 'c1', at: '2026-08-01T00:00:00Z' }], 'c1']);
fuzz('stampEnteredBy', hubSync.stampEnteredBy, [comment, 'Harvey']);
fuzz('backupFileName', hubSync.backupFileName, ['hub-data.json', '2026-08-01T00:00:00Z']);
fuzz('prunableBackups', hubSync.prunableBackups, [['hub-data-2026-08-01T00-00-00.json'], 20, 'hub-data.json']);

test('createSyncEngine: construction does not throw with hostile cfg', () => {
  for (const v of HOSTILE_VALUES) {
    assert.doesNotThrow(() => hubSync.createSyncEngine(v), `createSyncEngine threw with cfg = ${describe(v)}`);
  }
  assert.doesNotThrow(() => hubSync.createSyncEngine());
});

// ── brain-core.js ───────────────────────────────────────────────────────

fuzz('emptyBrainState', brainCore.emptyBrainState, ['2026-08-01T00:00:00Z']);
fuzz('mergeBrainState', brainCore.mergeBrainState, [brainState, brainState]);
fuzz('pdfPagesToText', brainCore.pdfPagesToText, [[['a', 'b'], ['c']]]);
fuzz('sheetTextFromRows', brainCore.sheetTextFromRows, [[{ name: 'Sheet1', rows: [['a', 'b']] }]]);
fuzz('normalizeExtractedText', brainCore.normalizeExtractedText, ['  hello   world  ']);
fuzz('extractionMethodFor', brainCore.extractionMethodFor, ['file.pdf']);
fuzz('dedupeFilename', brainCore.dedupeFilename, [['a.txt'], 'a.txt']);
fuzz('docFolderPath', brainCore.docFolderPath, ['OSB-01', 'Datasheet']);
fuzz('buildSearchDocs', brainCore.buildSearchDocs, [brainState, [comment], new Map()]);
fuzz('snippetFor', brainCore.snippetFor, ['some long text here', ['text'], 60]);
fuzz('decisionFromComment', brainCore.decisionFromComment, [comment, '2026-08-01T00:00:00Z']);
fuzz('contentTerms', brainCore.contentTerms, ['find this text']);
fuzz('phraseOf', brainCore.phraseOf, ['find this text']);
fuzz('findPhrase', brainCore.findPhrase, ['some long text here', 'long text']);
fuzz('hasAllTerms', brainCore.hasAllTerms, ['some long text here', ['long', 'text']]);
fuzz('bestSnippetFor', brainCore.bestSnippetFor, ['some long text here', ['text'], 'long text', 60]);
fuzz('highlightRanges', brainCore.highlightRanges, ['some long text here', ['text'], 'long text']);
fuzz('addPhotoToDecision', brainCore.addPhotoToDecision, [brainState, 'd1', { id: 'ph1', file: 'a.jpg' }, '2026-08-01T00:00:00Z']);
fuzz('removePhotoFromDecision', brainCore.removePhotoFromDecision, [brainState, 'd1', 'ph1', '2026-08-01T00:00:00Z']);
fuzz('decisionPhotoNames', brainCore.decisionPhotoNames, [brainState]);
fuzz('buildDecisionsWorkbookModel', brainCore.buildDecisionsWorkbookModel, [brainState, [decision], '2026-08-01T00:00:00Z', new Map()]);

test('supersedeDecision: hostile state never throws a raw TypeError', () => {
  for (const v of HOSTILE_VALUES) {
    try {
      brainCore.supersedeDecision(v, 'd1', decision, '2026-08-01T00:00:00Z');
    } catch (e) {
      assert.ok(e instanceof Error, `supersedeDecision threw a non-Error with state = ${describe(v)}`);
      // Must be the documented "unknown decision" business error, not an
      // incidental TypeError from touching a property of garbage state.
      assert.ok(!(e instanceof TypeError), `supersedeDecision threw a raw TypeError with state = ${describe(v)}: ${e.message}`);
    }
  }
  // Known-good state, unknown id: still the documented Error, not a crash.
  assert.throws(() => brainCore.supersedeDecision(brainState, 'nope', decision, 't'), /unknown decision/);
});

fuzzAsync('gzipText', brainCore.gzipText, ['hello world']);
fuzzAsync('gunzipText', brainCore.gunzipText, [await brainCore.gzipText('round trip me')]);

// ── hub-presence.js ─────────────────────────────────────────────────────

fuzz('presenceFileName', hubPresence.presenceFileName, ['session-1']);
fuzz('presenceRecord', hubPresence.presenceRecord, [{ name: 'Harvey', sessionId: 's1', tool: 'hub', editingCommentId: null, viewingCommentId: null, nowIso: '2026-08-01T00:00:00Z' }]);
fuzz('ofTool', hubPresence.ofTool, [[presenceRec], 'hub']);
fuzz('livePresences', hubPresence.livePresences, [[presenceRec], 's2', Date.parse('2026-08-01T00:00:10Z')]);
fuzz('editorOf', hubPresence.editorOf, [[presenceRec], 'c1', 's2', Date.parse('2026-08-01T00:00:10Z')]);
fuzz('viewersOf', hubPresence.viewersOf, [[presenceRec], 'c1', 's2', Date.parse('2026-08-01T00:00:10Z')]);
fuzz('sweepable', hubPresence.sweepable, [[presenceRec], Date.parse('2026-08-01T00:00:10Z')]);

// ── hub-intake.js ───────────────────────────────────────────────────────

fuzz('buildIntakeTemplateModel', hubIntake.buildIntakeTemplateModel, [hubState, ['p1'], '2026-08-01T00:00:00Z']);
fuzz('reviewRows', hubIntake.reviewRows, [{ rows: [{ description: 'a leak', product: 'OSB-01' }], products: [] }, hubState, '2026-08-01']);

test('parseIntakeWorkbook: hostile workbook never throws a raw TypeError', () => {
  for (const v of HOSTILE_VALUES) {
    try {
      hubIntake.parseIntakeWorkbook(v);
    } catch (e) {
      assert.ok(e instanceof Error, `parseIntakeWorkbook threw a non-Error with workbook = ${describe(v)}`);
      assert.ok(!(e instanceof TypeError), `parseIntakeWorkbook threw a raw TypeError with workbook = ${describe(v)}: ${e.message}`);
    }
  }
});

// ── pid-comments.js ─────────────────────────────────────────────────────

fuzz('resolveConnectMode', pidComments.resolveConnectMode, [{ hasRegisterHere: false, hasHubDataHere: true, registerSubfolders: ['Reg'] }]);
fuzz('connectModeLabel', pidComments.connectModeLabel, ['hub-root']);
fuzz('commentCountsByDrawing', pidComments.commentCountsByDrawing, [hubData]);
fuzz('openCommentsByDrawing', pidComments.openCommentsByDrawing, [hubData]);
fuzz('commentCountsByProduct', pidComments.commentCountsByProduct, [hubData]);
fuzz('openCommentsByProduct', pidComments.openCommentsByProduct, [hubData]);
fuzz('drawingNameFromFile', pidComments.drawingNameFromFile, ['D-001_A.pdf', ['A', 'B']]);
fuzz('isDestructiveSave', pidComments.isDestructiveSave, [100, 90]);

// ══════════════════════════════════════════════════════════════════════════
// Realistic-shaped but broken records
// ══════════════════════════════════════════════════════════════════════════

test('mergeState: wrong-typed fields on comments never throw', () => {
  const broken = [
    { ...comment, productIds: 'p1' },               // string, not array
    { ...comment, status: 0 },                        // number, not string
    { ...comment, updatedAt: { not: 'a string' } },    // object, not string
    { ...comment, id: null },                          // null id (dropped by mergeById)
    { ...comment, dateRaised: 'not-a-date' },
    { ...comment, affectedTypes: 'P&ID' },
  ];
  for (const c of broken) {
    const local = { ...hubState, comments: [c] };
    assert.doesNotThrow(() => hubCore.mergeState(local, hubState));
    assert.doesNotThrow(() => hubCore.filterComments([c], { search: 'x' }));
    assert.doesNotThrow(() => hubCore.commentCounts([c]));
    assert.doesNotThrow(() => hubCore.productCounts([c]));
    assert.doesNotThrow(() => hubCore.buildFilteredWorkbookModel({ ...hubState, comments: [c] }, [c], 't'));
  }
});

test('mergeBrainState: wrong-typed fields on decisions never throw', () => {
  const broken = [
    { ...decision, productIds: 'p1' },
    { ...decision, status: 0 },
    { ...decision, updatedAt: { not: 'a string' } },
    { ...decision, id: null },
    { ...decision, date: 'not-a-date' },
    { ...decision, tags: 'valve' },
  ];
  for (const d of broken) {
    const local = { ...brainState, decisions: [d] };
    assert.doesNotThrow(() => brainCore.mergeBrainState(local, brainState));
    assert.doesNotThrow(() => brainCore.buildDecisionsWorkbookModel(local, [d], 't', new Map()));
  }
});

test('duplicate ids in one collection: merge keeps going, does not throw', () => {
  const dupe = { ...comment, id: 'c1', description: 'dupe' };
  const local = { ...hubState, comments: [comment, dupe] };
  assert.doesNotThrow(() => hubCore.mergeState(local, hubState));
});

test('self-referencing supersede chain does not throw', () => {
  const selfSuperseded = { ...decision, id: 'd1', supersedes: 'd1', supersededBy: 'd1' };
  const state = { ...brainState, decisions: [selfSuperseded] };
  assert.doesNotThrow(() => brainCore.mergeBrainState(state, state));
  assert.doesNotThrow(() => brainCore.buildDecisionsWorkbookModel(state, [selfSuperseded], 't', new Map()));
});

test('a comment referencing itself in links does not throw', () => {
  const selfRefDecision = { ...decision, links: { documents: [], comments: ['d1'], urls: [] } };
  assert.doesNotThrow(() => brainCore.buildSearchDocs({ ...brainState, decisions: [selfRefDecision] }, [comment], new Map()));
});

test('tombstones for records that never existed do not throw', () => {
  const tombstones = { 'never-existed': '2026-08-01T00:00:00Z' };
  const state = { ...hubState, tombstones };
  assert.doesNotThrow(() => hubCore.mergeState(state, hubState));
  assert.doesNotThrow(() => hubSync.mergeTombstones(tombstones, { 'also-never-existed': '2026-08-02T00:00:00Z' }));
});

test('a family whose patterns match nothing does not throw', () => {
  const noMatch = { revHistory: { 'D-001': { A: { importedAt: 't' } } }, families: [{ id: 'f1', name: 'Empty', patterns: ['ZZZ-999'] }] };
  const families = hubCore.familiesFromRegister(noMatch);
  assert.doesNotThrow(() => hubCore.familyMembership([product], families));
  const fam = families.find(f => f.id === 'f1');
  assert.deepEqual(fam.drawings, []);
});

test('resequenceRefs: self-referencing / duplicate refIssued does not throw', () => {
  const a = { ...comment, id: 'a', refIssued: 'HUB-0001', ref: 'HUB-0002', createdAt: '2026-01-01T00:00:00Z' };
  const b = { ...comment, id: 'b', refIssued: 'HUB-0001', ref: 'HUB-0001', createdAt: '2026-01-02T00:00:00Z' };
  assert.doesNotThrow(() => hubCore.resequenceRefs({ ...hubState, comments: [a, b] }));
});

test('pid-comments: dangling productIds and non-array collections degrade, never throw', () => {
  const brokenHubData = {
    products: 'not-an-array',
    comments: [{ ...comment, productIds: ['does-not-exist'] }],
  };
  assert.doesNotThrow(() => pidComments.commentCountsByDrawing(brokenHubData));
  assert.doesNotThrow(() => pidComments.openCommentsByDrawing(brokenHubData));
  assert.doesNotThrow(() => pidComments.commentCountsByProduct(brokenHubData));
  assert.doesNotThrow(() => pidComments.openCommentsByProduct(brokenHubData));
});

// ══════════════════════════════════════════════════════════════════════════
// Adversarial strings — every text path
// ══════════════════════════════════════════════════════════════════════════

const ADVERSARIAL_STRINGS = [
  '<script>alert(1)</script>',
  '"><img src=x onerror=alert(1)>',
  '{{7*7}}',
  '${x}',
  'null byte:   embedded',
  'RTL override: ‮evil‬',
  'x'.repeat(10000),
  'emoji: \u{1F469}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F467}',   // family ZWJ sequence
  'combining: é́́ (e + combining acute x3)',
  '{"already":"valid json","n":1}',
];

test('adversarial strings: no throw through every text path', () => {
  for (const s of ADVERSARIAL_STRINGS) {
    const c = { ...comment, description: s, raisedBy: s, actionTaken: s, category: s };
    assert.doesNotThrow(() => hubCore.filterComments([c], { search: s }));
    assert.doesNotThrow(() => hubCore.buildFilteredWorkbookModel({ ...hubState, comments: [c] }, [c], 't'));
    assert.doesNotThrow(() => hubCore.sanitizeFilename(s));
    assert.doesNotThrow(() => hubCore.photoFileName(s, s, [s]));
    assert.doesNotThrow(() => hubCore.excelSheetName(s, [s]));
    assert.doesNotThrow(() => brainCore.contentTerms(s));
    assert.doesNotThrow(() => brainCore.phraseOf(s));
    assert.doesNotThrow(() => brainCore.findPhrase(s, s));
    assert.doesNotThrow(() => brainCore.hasAllTerms(s, [s]));
    assert.doesNotThrow(() => brainCore.bestSnippetFor(s, [s], s, 60));
    assert.doesNotThrow(() => brainCore.highlightRanges(s, [s], s));
    assert.doesNotThrow(() => brainCore.normalizeExtractedText(s));
    const d = { ...decision, title: s, decision: s, reasoning: s };
    assert.doesNotThrow(() => brainCore.buildDecisionsWorkbookModel({ ...brainState, decisions: [d] }, [d], 't', new Map()));
  }
});

test('adversarial strings round-trip UNCHANGED through mergeState', () => {
  for (const s of ADVERSARIAL_STRINGS) {
    const c = { ...comment, description: s, raisedBy: s, actionTaken: s };
    const local = { ...hubState, comments: [c] };
    const merged = hubCore.mergeState(local, hubState);
    const out = merged.comments.find(x => x.id === c.id);
    assert.equal(out.description, s, 'description was mangled by mergeState');
    assert.equal(out.raisedBy, s, 'raisedBy was mangled by mergeState');
    assert.equal(out.actionTaken, s, 'actionTaken was mangled by mergeState');
  }
});

test('adversarial strings round-trip UNCHANGED through mergeBrainState', () => {
  for (const s of ADVERSARIAL_STRINGS) {
    const d = { ...decision, title: s, decision: s, reasoning: s };
    const local = { ...brainState, decisions: [d] };
    const merged = brainCore.mergeBrainState(local, brainState);
    const out = merged.decisions.find(x => x.id === d.id);
    assert.equal(out.title, s, 'title was mangled by mergeBrainState');
    assert.equal(out.decision, s, 'decision was mangled by mergeBrainState');
    assert.equal(out.reasoning, s, 'reasoning was mangled by mergeBrainState');
  }
});

test('adversarial strings round-trip UNCHANGED through workbook-model building', () => {
  for (const s of ADVERSARIAL_STRINGS) {
    const c = { ...comment, description: s, raisedBy: s, actionTaken: s };
    const model = hubCore.buildFilteredWorkbookModel({ ...hubState, comments: [c] }, [c], 't');
    const row = model.sheets[0].rows[0];
    assert.equal(row.cells.description, s, 'description was mangled by buildFilteredWorkbookModel');
    assert.equal(row.cells.raisedBy, s, 'raisedBy was mangled by buildFilteredWorkbookModel');
    assert.equal(row.cells.actionTaken, s, 'actionTaken was mangled by buildFilteredWorkbookModel');

    const d = { ...decision, title: s, decision: s, reasoning: s };
    const dModel = brainCore.buildDecisionsWorkbookModel({ ...brainState, decisions: [d] }, [d], 't', new Map());
    const dRow = dModel.sheets[0].rows[0];
    assert.equal(dRow.cells.title, s, 'title was mangled by buildDecisionsWorkbookModel');
    assert.equal(dRow.cells.decision, s, 'decision was mangled by buildDecisionsWorkbookModel');
    assert.equal(dRow.cells.reasoning, s, 'reasoning was mangled by buildDecisionsWorkbookModel');
  }
});
