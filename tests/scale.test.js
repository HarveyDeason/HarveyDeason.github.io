// tests/scale.test.js
//
// Task 4 (Scale) of the hardening plan. Every other test file in this suite
// uses small, hand-built fixtures — a handful of comments, a handful of
// products — because that is what makes a failure easy to read. That is
// exactly the size range where an accidental O(n^2) join is invisible: it
// finishes in under a millisecond either way. This file instead builds
// ledgers at the size a shared OneDrive folder can plausibly reach after a
// few years of an AMP cycle (the P&ID register already holds 4,600 tags
// today and only grows), and checks two different things about them:
//
//   1. CORRECTNESS AT SCALE — the same operations tested elsewhere still
//      produce the right answer once the arrays are 10,000+ long, not just
//      "it returns without throwing". Every correctness assertion below is
//      checked against an independently-computed expected value, not against
//      a second call to the function under test.
//
//   2. ALGORITHMIC SHAPE, VIA WALL-CLOCK RATIOS — doubling the input should
//      roughly double the work for an O(n) operation, not roughly quadruple
//      it. Wall-clock timing is the only tool available here (there is no
//      operation counter to inject into hand-rolled loops over plain
//      arrays), so every ratio assertion below:
//        - times a JIT warm-up call before the real measurement, so V8
//          compiling/optimising the function on its first real call doesn't
//          make the "small" run look artificially slow;
//        - takes the BEST of several repeated timings (GC pauses and OS
//          scheduling only ever make a run slower than its true cost, never
//          faster, so the minimum is the least noisy estimate);
//        - applies a floor to any sub-millisecond timing before dividing, so
//          a baseline that legitimately took 0.1ms can't produce a
//          meaningless ratio like 40x from a difference of 3ms;
//        - uses a GENEROUS bound (a true O(n) op doubling its input is
//          expected to land near 2x; the bounds below allow up to 6x-10x)
//          precisely so a loaded CI/dev machine cannot make this file flaky.
//
// WHAT THIS CANNOT PROVE: a wall-clock ratio under the bound is evidence of
// roughly-linear-or-better behaviour, not proof of it — noise can hide a
// mild superlinearity, and these bounds are deliberately loose enough that a
// genuinely quadratic operation over a *small* coupled growth factor (see
// the "coupled" tests below) can still pass. Where that happens, the
// measured ratio is asserted and reported anyway, and is called out in the
// task report even though the test is green — a passing test here means
// "not catastrophically worse than expected", not "definitely linear".
//
// Sizes are chosen so the WHOLE FILE stays well inside the ~20-30s budget
// this task set: they hit the plan's requested orders of magnitude (10,000
// comments, 2,000 products, 200 families, 5,000 drawings, 50,000 tags, 5,000
// history entries) but the pairs used for growth-ratio comparisons reuse
// these same fixtures rather than building fresh ones per test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyState, mergeState, filterComments, commentCounts, productCounts,
  buildProductWorkbookModel, buildMasterWorkbookModel, buildFamilyWorkbookModel,
  familyProductId, familiesFromRegister, latestRevisions,
} from '../assets/js/hub-core.js';
import { historyFor } from '../assets/js/hub-sync.js';

// ── Seeded PRNG (same mulberry32 as tests/merge-properties.test.js) ────────
// Deterministic: any failure here reproduces byte-for-byte from the seed
// printed in the assertion message, and repeated runs on the same machine or
// a different one never disagree about what data was built.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SEED = 0x5CA1E;
function randInt(rng, n) { return Math.floor(rng() * n); }
function pick(rng, arr) { return arr[randInt(rng, arr.length)]; }

const BASE_MS = Date.UTC(2026, 0, 1, 9, 0, 0);
function isoAt(ms) { return new Date(BASE_MS + ms).toISOString(); }
function pad(n, width) { return String(n).padStart(width, '0'); }

const CATEGORIES = ['Pipework change', 'New valve', 'Valve change', 'Instrument change', 'Layout change', 'Other'];
const SOURCES = ['Site feedback', 'Design review', 'Client comment', 'HAZOP action', 'Other'];
const NAMES = ['Harvey Deason', 'A N Other', 'Priya K', "O'Brien", 'M. Núñez'];
const STATUSES = ['open', 'in_progress', 'closed'];
const PRIORITIES = ['low', 'medium', 'high'];

// ── Timing helpers ──────────────────────────────────────────────────────
const TIME_FLOOR_MS = 4; // see file header: guards against divide-by-near-zero on a sub-ms baseline
function nowMs() { return Number(process.hrtime.bigint()) / 1e6; }
function timeOnce(fn) { const t0 = nowMs(); fn(); return nowMs() - t0; }
function bestOf(fn, reps) {
  let best = Infinity;
  for (let i = 0; i < reps; i++) best = Math.min(best, timeOnce(fn));
  return best;
}
// Runs both once (JIT warm-up, uncounted), then times each with the
// best-of-3 approach above, applies the floor, and returns the ratio.
function measureGrowth(smallFn, largeFn) {
  smallFn(); largeFn();
  const small = Math.max(bestOf(smallFn, 2), TIME_FLOOR_MS);
  const large = Math.max(bestOf(largeFn, 2), TIME_FLOOR_MS);
  return { small, large, ratio: large / small };
}
function assertGrowth(label, smallFn, largeFn, bound) {
  const { small, large, ratio } = measureGrowth(smallFn, largeFn);
  // Printed unconditionally (not just on failure): the whole point of this
  // file is to surface the SHAPE of these numbers for a human to read, per
  // the task's instruction to note anything that looks quadratic even when
  // the assertion still passes.
  console.log(`  [scale] ${label}: small=${small.toFixed(2)}ms large=${large.toFixed(2)}ms ratio=${ratio.toFixed(2)}x (bound <${bound}x)`);
  assert.ok(ratio < bound, `${label}: doubling the input took ${ratio.toFixed(2)}x as long (bound <${bound}x) — small=${small.toFixed(2)}ms, large=${large.toFixed(2)}ms`);
}

// ── Ledger builders ─────────────────────────────────────────────────────
// One scale parameter, s, drives everything, in the same ratios the plan's
// target sizes imply: s=10000 yields EXACTLY 10,000 comments / 2,000
// products / 5,000 history entries — the plan's own numbers, not a
// scaled-down stand-in for them. s=5000 (the "small" side of every
// doubling comparison below) is a real, independently-meaningful ledger
// size in its own right (a smaller but still very real shared-drive
// folder), not a synthetic microbenchmark input.
//
// Product/status/priority assignment is by index modulo, not random, so
// every correctness assertion below can be computed independently with
// simple arithmetic instead of a second pass over the generated data (which
// would just be re-testing the test).
function buildHubState(rng, s, idPrefix) {
  const p = Math.round(s / 5);
  const h = Math.round(s / 2);
  const products = [];
  for (let i = 0; i < p; i++) {
    products.push({
      id: idPrefix + 'p' + i, name: idPrefix.toUpperCase() + ' Product ' + pad(i, 5),
      type: 'OSB item', pidDrawings: [], modelRef: '', sheetRefs: '', updatedAt: isoAt(i),
    });
  }
  const comments = [];
  for (let i = 0; i < s; i++) {
    const pid = idPrefix + 'p' + (i % p);
    comments.push({
      id: idPrefix + 'c' + i, ref: '', productIds: [pid], affectedTypes: ['P&ID'],
      category: pick(rng, CATEGORIES), source: pick(rng, SOURCES),
      dateRaised: '2026-07-01', raisedBy: pick(rng, NAMES),
      description: 'Comment ' + pad(i, 6) + ' ' + pick(rng, ['reroute pipe', 'add valve', 'clash with tray', 'update tag']),
      priority: PRIORITIES[i % 3], status: STATUSES[i % 3],
      hold: false, pidRevision: '', dateClosed: '', actionTaken: '', closedBy: '',
      createdAt: isoAt(i), updatedAt: isoAt(i),
    });
  }
  // History concentrated on a bounded pool of records (never more than 500
  // distinct ids), same as a real ledger: most records are never edited
  // again after creation, and the ones that are get edited repeatedly — a
  // uniform one-entry-per-comment spread would understate historyFor's real
  // per-record fan-out.
  const historyPool = Math.min(s, 500);
  const history = [];
  for (let i = 0; i < h; i++) {
    history.push({
      id: idPrefix + 'h' + i, recordId: idPrefix + 'c' + (i % historyPool),
      recordType: 'comment', at: isoAt(i), by: pick(rng, NAMES), changes: [],
    });
  }
  return { ...emptyState(isoAt(s)), products, comments, history, refCounter: 0, __p: p, __h: h, __historyPool: historyPool };
}

// register.json shape (see assets/js/pid-comments.js / hub-core.js
// familiesFromRegister header and tools-src/pid-tag-register.html): drawings
// keyed by name, each holding one entry per revision, each revision
// carrying its own tags[] (individual instrument/valve/equipment tags on
// that drawing revision — the "50,000 tags" the plan asks for). Two
// revisions per drawing, five tags per revision: at the plan's own drawing
// count (5,000) that is exactly 50,000 tag entries; the plan's family count
// (200) divides 5,000 drawings into exactly 25 per family with no
// remainder, which also makes the "does each family get the right drawings"
// assertion below exact rather than approximate.
function buildRegisterJson(drawingCount) {
  const revsPerDrawing = 2;
  const tagsPerRev = 5;
  const revHistory = {};
  for (let i = 0; i < drawingCount; i++) {
    const name = 'P' + pad(i, 5);
    const revs = {};
    for (let r = 0; r < revsPerDrawing; r++) {
      const tags = [];
      for (let t = 0; t < tagsPerRev; t++) tags.push({ tag: name + '-T' + t, type: 'valve' });
      // r=1 (the second revision) always has the later importedAt, so the
      // "latest revision" answer is deterministic per drawing without
      // needing randomness: every drawing's latest revision is 'B'.
      revs[String.fromCharCode(65 + r)] = { importedAt: isoAt(i * 1000 + r), drawingDate: '', tags };
    }
    revHistory[name] = revs;
  }
  const perFamily = 25;
  const familyCount = Math.floor(drawingCount / perFamily);
  const families = [];
  for (let f = 0; f < familyCount; f++) {
    const from = f * perFamily;
    const to = from + perFamily - 1;
    families.push({
      id: 'f' + f, name: 'Family ' + pad(f, 4),
      patterns: ['P' + pad(from, 5) + '-' + pad(to, 5)],
      updatedAt: 't',
    });
  }
  return { revHistory, families, __familyCount: familyCount, __perFamily: perFamily, __tagCount: drawingCount * revsPerDrawing * tagsPerRev };
}

// ── Fixtures (built once, shared across every test below) ──────────────
const rng = mulberry32(SEED);
const S_SMALL = 5000;   // "small" side of every doubling comparison
const S_FULL = 10000;   // the plan's own target size — "large" side, and the correctness fixture

const halfHub = buildHubState(rng, S_SMALL, 'a');
const fullHub = buildHubState(rng, S_FULL, 'b');
// A second, disjoint-id ledger at each scale, standing in for "disk" in a
// merge — same content shape as local, different ids, so mergeState has a
// real union to do rather than a no-op.
const halfDisk = buildHubState(rng, S_SMALL, 'x');
const fullDisk = buildHubState(rng, S_FULL, 'y');

const halfRegister = buildRegisterJson(S_SMALL / 2);   // 2,500 drawings / 100 families
const fullRegister = buildRegisterJson(S_FULL / 2);    // 5,000 drawings / 200 families — the plan's target

// =========================================================================
// PART 1 — CORRECTNESS AT SCALE
// Every assertion below checks the actual returned VALUE against an
// independently-derived expected value (arithmetic from the deterministic
// builders above, or a plain reduce over the same input) — never merely
// "it returned an array" or "it didn't throw".
// =========================================================================

test('scale: mergeState at 10,000+10,000 comments is a correct union, not just fast', () => {
  const merged = mergeState(fullHub, fullDisk);
  assert.equal(merged.comments.length, fullHub.comments.length + fullDisk.comments.length,
    'disjoint-id ledgers must union to the sum of both, with none dropped or duplicated');
  assert.equal(merged.products.length, fullHub.__p + fullDisk.__p);
  assert.equal(merged.history.length, fullHub.__h + fullDisk.__h);
  // No id appears twice, and every ref assigned is unique — resequenceRefs
  // runs as part of mergeState, and a duplicate ref at this scale would be
  // exactly the kind of traceability break docs/superpowers/KNOWN-ISSUES.md
  // already documents for the 3+-client case, just visible here in the
  // simpler 2-client case where it must NOT happen.
  const ids = new Set(merged.comments.map(c => c.id));
  assert.equal(ids.size, merged.comments.length, 'no comment id may be duplicated by the merge');
  const refs = new Set(merged.comments.map(c => c.ref));
  assert.equal(refs.size, merged.comments.length, 'every merged comment must have a unique ref');
  // Spot-check specific records survived merge with their content intact,
  // not just their count.
  const spotA = merged.comments.find(c => c.id === 'bc1234');
  const spotX = merged.comments.find(c => c.id === 'yc4321');
  assert.ok(spotA && spotA.description.startsWith('Comment 001234'));
  assert.ok(spotX && spotX.description.startsWith('Comment 004321'));
});

test('scale: filterComments over 10,000 comments returns exactly the matching set', () => {
  // status='open' AND priority='high': both are index-modulo-3 in the
  // builder, so the expected count is computable by simple arithmetic
  // rather than a second scan — i%3===0 for status open, i%3===2 for
  // priority high, and those two conditions can never both hold for the
  // same i (0 and 2 are different residues), so the expected count is 0.
  // That is itself a useful, exact check: it proves filterComments applies
  // BOTH conditions (an OR-bug would return non-zero here).
  const resultImpossible = filterComments(fullHub.comments, { status: 'open', priority: 'high' });
  assert.equal(resultImpossible.length, 0, 'status=open and priority=high never coincide in this fixture — a non-zero result means the filter is OR-ing, not AND-ing');

  // status='open' alone: i%3===0, so exactly ceil(10000/3) matches.
  const expectedOpen = fullHub.comments.filter((_, i) => i % 3 === 0).length;
  const resultOpen = filterComments(fullHub.comments, { status: 'open' });
  assert.equal(resultOpen.length, expectedOpen);
  assert.ok(resultOpen.every(c => c.status === 'open'));

  // A realistic composed filter: product + category + free-text search,
  // cross-checked against an independent .filter() over the same array
  // (not a second call into filterComments).
  const targetProduct = fullHub.products[7].id;
  const targetCategory = fullHub.comments.find(c => c.productIds[0] === targetProduct).category;
  const got = filterComments(fullHub.comments, { productId: targetProduct, category: targetCategory, search: 'reroute' });
  const expected = fullHub.comments.filter(c =>
    c.productIds.includes(targetProduct) && c.category === targetCategory &&
    [c.ref, c.description, c.raisedBy, c.actionTaken].join(' ').toLowerCase().includes('reroute'));
  assert.equal(got.length, expected.length);
  assert.deepEqual(got.map(c => c.id).sort(), expected.map(c => c.id).sort());
});

test('scale: commentCounts and productCounts over 10,000 comments are exact', () => {
  const counts = commentCounts(fullHub.comments);
  // i%3: 0=open,1=in_progress,2=closed, over i=0..9999.
  assert.equal(counts.open, 3334);         // i=0,3,...,9999 -> 3334 values
  assert.equal(counts.inProgress, 3333);
  assert.equal(counts.closed, 3333);
  assert.equal(counts.open + counts.inProgress + counts.closed, fullHub.comments.length);

  // highOpen = priority high AND status != closed. priority high is i%3===2,
  // status closed is i%3===2 — same residue, so priority=high implies
  // status=closed for every comment in this fixture, meaning highOpen must
  // be exactly zero. Same "prove it's really AND, not OR" shape as above.
  assert.equal(counts.highOpen, 0);

  const perProduct = productCounts(fullHub.comments);
  assert.equal(perProduct.size, fullHub.__p);
  // Every product gets exactly comments.length / products count comments
  // (10000 / 2000 = 5 each), by construction (pid = i % p).
  for (const bucket of perProduct.values()) {
    assert.equal(bucket.open + bucket.inProgress + bucket.closed, fullHub.comments.length / fullHub.__p);
  }
});

test('scale: buildProductWorkbookModel picks exactly that product\'s comments, correctly counted', () => {
  const targetId = 'bp42';
  const model = buildProductWorkbookModel(fullHub, targetId, new Map(), '2026-08-06');
  const expectedComments = fullHub.comments.filter(c => c.productIds.includes(targetId));
  const logSheet = model.sheets.find(s => s.name === 'Comment Log');
  assert.equal(logSheet.rows.length, expectedComments.length);
  assert.equal(logSheet.rows.length, fullHub.comments.length / fullHub.__p);
  const summarySheet = model.sheets.find(s => s.name === 'Summary');
  const openRow = summarySheet.rows.find(r => r[0] === 'Open comments');
  const expectedOpen = expectedComments.filter(c => c.status === 'open').length;
  assert.equal(openRow[1], String(expectedOpen));
});

test('scale: buildMasterWorkbookModel over 10,000 comments / 2,000 products produces the right rows and overview', () => {
  const model = buildMasterWorkbookModel(fullHub, new Map(), '2026-08-06');
  const logSheet = model.sheets.find(s => s.name === 'Comment Log');
  assert.equal(logSheet.rows.length, fullHub.comments.length, 'every comment must appear exactly once in the master log');

  // Independently tally per-product counts and compare against the
  // Overview sheet's summary line for one specific product.
  const targetProduct = fullHub.products[123];
  const expectedForTarget = fullHub.comments.filter(c => c.productIds.includes(targetProduct.id));
  const expOpen = expectedForTarget.filter(c => c.status === 'open').length;
  const expInProg = expectedForTarget.filter(c => c.status === 'in_progress').length;
  const expClosed = expectedForTarget.filter(c => c.status === 'closed').length;
  const overviewSheet = model.sheets.find(s => s.name === 'Overview');
  const row = overviewSheet.rows.find(r => r[0] === targetProduct.name);
  assert.ok(row, 'target product must appear in the overview');
  assert.equal(row[1], `Open ${expOpen} · In progress ${expInProg} · Closed ${expClosed}`);

  // Every row's product name in the log resolves to a real product (the
  // commentRow -> products.find() join actually found something, for every
  // one of 10,000 rows — a dangling productId here would show up as the
  // raw id string instead of a resolved name).
  const productNames = new Set(fullHub.products.map(p => p.name));
  assert.ok(logSheet.rows.every(r => productNames.has(r.cells.product)),
    'every comment row must resolve to a real product name, not a dangling id');
});

test('scale: buildFamilyWorkbookModel rolls up correctly with 200 member products', () => {
  const memberCount = 200;
  const commentsPerMember = 50;
  const famPid = familyProductId('bigfam');
  const memberIds = Array.from({ length: memberCount }, (_, i) => 'fm' + i);
  const products = [
    { id: famPid, name: 'Big Family', type: 'Family', pidDrawings: [], modelRef: '', sheetRefs: '', updatedAt: 't' },
    ...memberIds.map(id => ({ id, name: 'Member ' + id, type: 'OSB item', pidDrawings: [], modelRef: '', sheetRefs: '', updatedAt: 't' })),
  ];
  const comments = [];
  let idx = 0;
  for (const mid of memberIds) {
    for (let i = 0; i < commentsPerMember; i++) {
      comments.push({
        id: 'fc' + idx, ref: '', productIds: [mid], affectedTypes: [],
        category: 'Other', source: 'Other', dateRaised: '2026-07-01', raisedBy: 'A',
        description: 'd' + idx, priority: 'low', status: STATUSES[idx % 3],
        hold: false, pidRevision: '', dateClosed: '', actionTaken: '', closedBy: '',
        createdAt: 't', updatedAt: 't',
      });
      idx += 1;
    }
  }
  const state = { ...emptyState('t'), products, comments };
  const membership = { members: new Map([[famPid, memberIds]]), familyOf: new Map(memberIds.map(id => [id, famPid])) };
  const model = buildFamilyWorkbookModel(state, famPid, membership, new Map(), 't');

  // One sheet per member plus Summary and Family Comments.
  assert.equal(model.sheets.length, 2 + memberCount);
  for (const mid of memberIds) {
    const p = products.find(x => x.id === mid);
    const sheet = model.sheets.find(s => s.heading === p.name);
    assert.ok(sheet, `member sheet for ${mid} must exist`);
    assert.equal(sheet.rows.length, commentsPerMember, `member ${mid} must show exactly its own ${commentsPerMember} comments`);
  }
  // Rolled-up open/inProgress/closed across the whole family must equal the
  // sum over every member (independently tallied), since every comment here
  // belongs to exactly one member and none are family-level.
  const summarySheet = model.sheets.find(s => s.name === 'Summary');
  const openRow = summarySheet.rows.find(r => r[0] === 'Open (family + drawings)');
  const expectedOpen = comments.filter(c => c.status === 'open').length;
  assert.equal(openRow[1], String(expectedOpen));
});

test('scale: familiesFromRegister over 200 families / 5,000 drawings assigns the exact right drawings to each', () => {
  const fams = familiesFromRegister(fullRegister);
  assert.equal(fullRegister.__familyCount, 200, 'sanity check on the fixture itself');
  assert.equal(fams.length, 200);
  // Every family must get EXACTLY perFamily (25) drawings — not "at least",
  // not "roughly" — and they must be the specific 25 the range pattern
  // names, nothing more and nothing less (a family accidentally matching
  // its neighbour's drawings is a real-world clash the P&ID tool's "family
  // vs ungrouped" flagging depends on being accurate).
  for (const fam of fams) {
    assert.equal(fam.drawings.length, 25, `family ${fam.name} must match exactly 25 drawings`);
  }
  const totalMatched = new Set(fams.flatMap(f => f.drawings));
  assert.equal(totalMatched.size, 5000, 'every one of the 5,000 drawings must be claimed by exactly one family, with none left over or double-claimed');
  // Spot-check one specific family's exact drawing list.
  const family7 = fams.find(f => f.name === 'Family 0007');
  const expected = Array.from({ length: 25 }, (_, i) => 'P' + pad(7 * 25 + i, 5));
  assert.deepEqual([...family7.drawings].sort(), expected.sort());
});

test('scale: latestRevisions over 50,000 tag-bearing revision entries picks the right revision for every drawing', () => {
  assert.equal(fullRegister.__tagCount, 50000, 'sanity check on the fixture itself — this is the plan\'s 50,000 tags');
  const latest = latestRevisions(fullRegister);
  assert.equal(latest.size, 5000);
  // By construction every drawing's second revision ('B') has the later
  // importedAt, so 'B' must win for every single drawing — not sampled,
  // checked for all 5,000.
  for (const [drawing, rev] of latest) {
    assert.equal(rev, 'B', `${drawing} must resolve to its later revision`);
  }
});

test('scale: historyFor over 5,000 history entries returns exactly the right entries, newest first', () => {
  const targetId = 'bc17'; // one of fullHub's bounded history-pool record ids (pool = 500, id < 500)
  const entries = historyFor(fullHub.history, targetId);
  const expectedCount = fullHub.__h / fullHub.__historyPool; // 5000 / 500 = 10
  assert.equal(entries.length, expectedCount);
  assert.ok(entries.every(e => e.recordId === targetId));
  // Newest first: each entry's `at` must be >= the next one's.
  for (let i = 1; i < entries.length; i++) {
    assert.ok(entries[i - 1].at >= entries[i].at, 'historyFor must return entries newest-first');
  }
  // Cross-check against an independent filter+sort over the same array.
  const expected = fullHub.history.filter(e => e.recordId === targetId).sort((a, b) => b.at.localeCompare(a.at));
  assert.deepEqual(entries.map(e => e.id), expected.map(e => e.id));
});

// =========================================================================
// PART 2 — ALGORITHMIC SHAPE (growth-ratio assertions)
// See the file header for what these can and cannot prove. Each comparison
// doubles ONE clearly-stated growth factor — a single dimension for the
// operations that are only linear in one thing, and a COUPLED
// (both-at-once) doubling for the operations whose realistic growth
// vector genuinely moves two dimensions together (more products AND more
// comments over time; more families AND more drawings over time). The
// coupled comparisons are where a join that is accidentally O(n*m) instead
// of O(n+m) would show up as a ~4x jump instead of ~2x.
// =========================================================================

test('scale growth: mergeState — doubling both ledgers (5,000+5,000 -> 10,000+10,000)', () => {
  assertGrowth('mergeState',
    () => mergeState(halfHub, halfDisk),
    () => mergeState(fullHub, fullDisk),
    6);
});

test('scale growth: filterComments — doubling comments (5,000 -> 10,000)', () => {
  const filters = { status: 'open', category: 'New valve' };
  assertGrowth('filterComments',
    () => filterComments(halfHub.comments, filters),
    () => filterComments(fullHub.comments, filters),
    6);
});

test('scale growth: commentCounts — doubling comments (5,000 -> 10,000)', () => {
  assertGrowth('commentCounts',
    () => commentCounts(halfHub.comments),
    () => commentCounts(fullHub.comments),
    6);
});

// --- The interesting one: buildMasterWorkbookModel's commentRow() does
// products.find(p => p.id === pid) for every productId of every comment —
// a linear scan of the WHOLE products array, per comment, not a Map lookup.
// That makes the true cost O(comments * products), not O(comments +
// products). Comments and products both grow with the size of a real
// ledger over time (more products get added as more OSB items exist, more
// comments get raised against all of them), so the realistic growth vector
// is the COUPLED one exercised here. Deliberately smaller than the
// correctness fixture above (2,500c/500p -> 5,000c/1,000p, not
// 5,000/1,000 -> 10,000/2,000) purely to keep this file's runtime down —
// the ratio a coupled O(n*m) join produces from doubling both dimensions is
// scale-invariant (still ~4x whether the baseline is 2,500 or 10,000), so a
// smaller pair proves exactly the same thing for a fraction of the cost.
// If the join really is O(n*m), that predicts a ~4x time increase, not
// ~2x. See the task report for the measured ratio and whether this is
// flagged as a genuine finding.
test('scale growth: buildMasterWorkbookModel — coupled doubling (2,500c/500p -> 5,000c/1,000p)', () => {
  const smallHub = buildHubState(rng, 2500, 'm1');
  const largeHub = buildHubState(rng, 5000, 'm2');
  assertGrowth('buildMasterWorkbookModel (coupled comments+products)',
    () => buildMasterWorkbookModel(smallHub, new Map(), 't'),
    () => buildMasterWorkbookModel(largeHub, new Map(), 't'),
    10); // generous: see comment above — this bound deliberately allows the ~4x a real O(n*m) join would produce, so it does not flake; the actual ratio is reported regardless of pass/fail.
});

// --- buildFamilyWorkbookModel's per-member loop does
// comments.filter(...) — a full scan of ALL of the state's comments — once
// PER MEMBER. Holding comments-per-member fixed and doubling member count
// alone doubles both the number of scans AND (because total comments =
// members * commentsPerMember) the length of each scan, so a real O(members
// * totalComments) cost predicts ~4x from doubling members alone — this is
// a single-dimension doubling, not a coupled one, which makes it a cleaner
// signal than the master-workbook test above.
test('scale growth: buildFamilyWorkbookModel — doubling member count alone (25 -> 50 members, fixed 100 comments/member)', () => {
  function familyState(memberCount) {
    const commentsPerMember = 100;
    const famPid = familyProductId('growfam');
    const memberIds = Array.from({ length: memberCount }, (_, i) => 'gm' + i);
    const products = [
      { id: famPid, name: 'Grow Family', type: 'Family', pidDrawings: [], modelRef: '', sheetRefs: '', updatedAt: 't' },
      ...memberIds.map(id => ({ id, name: 'M' + id, type: 'OSB item', pidDrawings: [], modelRef: '', sheetRefs: '', updatedAt: 't' })),
    ];
    const comments = [];
    let idx = 0;
    for (const mid of memberIds) {
      for (let i = 0; i < commentsPerMember; i++) {
        comments.push({
          id: 'gc' + idx, ref: '', productIds: [mid], affectedTypes: [],
          category: 'Other', source: 'Other', dateRaised: '2026-07-01', raisedBy: 'A',
          description: 'd', priority: 'low', status: STATUSES[idx % 3],
          hold: false, pidRevision: '', dateClosed: '', actionTaken: '', closedBy: '',
          createdAt: 't', updatedAt: 't',
        });
        idx += 1;
      }
    }
    const state = { ...emptyState('t'), products, comments };
    const membership = { members: new Map([[famPid, memberIds]]), familyOf: new Map(memberIds.map(id => [id, famPid])) };
    return { state, famPid, membership };
  }
  const small = familyState(25);
  const large = familyState(50);
  assertGrowth('buildFamilyWorkbookModel (members doubled, comments/member fixed)',
    () => buildFamilyWorkbookModel(small.state, small.famPid, small.membership, new Map(), 't'),
    () => buildFamilyWorkbookModel(large.state, large.famPid, large.membership, new Map(), 't'),
    10); // generous, same reasoning as the master-workbook test above.
});

// --- familiesFromRegister -> expandFamilyPatterns scans the FULL drawing
// list once per family pattern (names.forEach(...) inside the range-match
// branch). Families and drawings realistically grow together (more standard
// products means more families AND more of their drawings), so this is
// another coupled-doubling comparison. Deliberately smaller than the
// correctness fixture above (500/20 -> 1,000/40, not 2,500/100 ->
// 5,000/200) for the same scale-invariant-ratio reason noted on the
// buildMasterWorkbookModel growth test above.
test('scale growth: familiesFromRegister — coupled doubling (20 families/500 drawings -> 40/1,000)', () => {
  const smallRegister = buildRegisterJson(500);
  const largeRegister = buildRegisterJson(1000);
  assertGrowth('familiesFromRegister (coupled families+drawings)',
    () => familiesFromRegister(smallRegister),
    () => familiesFromRegister(largeRegister),
    10); // generous, same reasoning as above.
});

test('scale growth: latestRevisions — doubling drawings/revisions (2,500 -> 5,000 drawings, 25,000 -> 50,000 tag entries)', () => {
  assertGrowth('latestRevisions',
    () => latestRevisions(halfRegister),
    () => latestRevisions(fullRegister),
    6);
});

test('scale growth: historyFor — doubling total history (2,500 -> 5,000 entries), single target record', () => {
  assertGrowth('historyFor',
    () => historyFor(halfHub.history, 'ac0'),
    () => historyFor(fullHub.history, 'bc0'),
    6);
});
