// tests/pid-comments.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConnectMode, connectModeLabel, commentCountsByDrawing, openCommentsByDrawing,
  commentCountsByProduct, openCommentsByProduct,
  CONVENTIONAL_REGISTER_SUBFOLDER, drawingNameFromFile, isDestructiveSave } from '../assets/js/pid-comments.js';

// ── resolveConnectMode (Task 2) ─────────────────────────────────────────

test('case 1: register.json directly present -> legacy, always wins', () => {
  const r = resolveConnectMode({ hasRegisterHere: true, hasHubDataHere: false, registerSubfolders: [] });
  assert.deepEqual(r, { mode: 'legacy', registerSubfolder: null });
});

// This once asserted the opposite — that a register.json in the root made the
// folder "legacy" even alongside hub-data.json. That was wrong, and it broke a
// real hub folder: a 10 KB register.json left over from the P&ID tool once
// being pointed at the hub root won over the 1.8 MB real register in the
// subfolder, so the tool read the stale file and reported no tags at all.
// hub-data.json is the only unambiguous marker of a hub root. Do not reinstate
// the old precedence.
test('hub-data.json wins over a stray register.json in the root', () => {
  const r = resolveConnectMode({ hasRegisterHere: true, hasHubDataHere: true, registerSubfolders: ['P&ID Register'] });
  assert.deepEqual(r, { mode: 'hub-root', registerSubfolder: 'P&ID Register' });
});

test('case 2: hub-data.json present, no register subfolder yet -> hub-root, conventional name, not created', () => {
  const r = resolveConnectMode({ hasRegisterHere: false, hasHubDataHere: true, registerSubfolders: [] });
  assert.deepEqual(r, { mode: 'hub-root', registerSubfolder: CONVENTIONAL_REGISTER_SUBFOLDER });
});

test('case 2: hub-data.json present, register subfolder already exists -> hub-root, that subfolder', () => {
  const r = resolveConnectMode({ hasRegisterHere: false, hasHubDataHere: true, registerSubfolders: ['P&ID Register'] });
  assert.deepEqual(r, { mode: 'hub-root', registerSubfolder: 'P&ID Register' });
});

test('case 3: no hub-data.json, a subfolder holds register.json -> hub-root, that subfolder', () => {
  const r = resolveConnectMode({ hasRegisterHere: false, hasHubDataHere: false, registerSubfolders: ['Drawings'] });
  assert.deepEqual(r, { mode: 'hub-root', registerSubfolder: 'Drawings' });
});

test('case 4: fresh empty folder -> legacy, exactly as today', () => {
  const r = resolveConnectMode({ hasRegisterHere: false, hasHubDataHere: false, registerSubfolders: [] });
  assert.deepEqual(r, { mode: 'legacy', registerSubfolder: null });
});

test('case 4: no facts object at all -> legacy (defensive default)', () => {
  const r = resolveConnectMode();
  assert.deepEqual(r, { mode: 'legacy', registerSubfolder: null });
});

test('ambiguous: hub-data.json present with multiple register subfolders -> deterministic (alphabetically first)', () => {
  const r = resolveConnectMode({ hasRegisterHere: false, hasHubDataHere: true, registerSubfolders: ['Zeta', 'Alpha'] });
  assert.deepEqual(r, { mode: 'hub-root', registerSubfolder: 'Alpha' });
});

test('ambiguous: no hub-data.json, multiple register subfolders -> deterministic (alphabetically first)', () => {
  const r = resolveConnectMode({ hasRegisterHere: false, hasHubDataHere: false, registerSubfolders: ['Zeta', 'Alpha'] });
  assert.deepEqual(r, { mode: 'hub-root', registerSubfolder: 'Alpha' });
});

test('connectModeLabel names the two modes', () => {
  assert.equal(connectModeLabel('hub-root'), 'linked to hub');
  assert.equal(connectModeLabel('legacy'), 'legacy (no hub link)');
});

// ── commentCountsByDrawing (Task 3) ─────────────────────────────────────

const P = (id, pidDrawings) => ({ id, name: id, type: 'OSB item', pidDrawings });
const C = (id, productIds, status) => ({ id, productIds, status, ref: 'HUB-0001' });

test('empty/malformed hub data returns an empty Map, never throws', () => {
  assert.equal(commentCountsByDrawing(null).size, 0);
  assert.equal(commentCountsByDrawing(undefined).size, 0);
  assert.equal(commentCountsByDrawing({}).size, 0);
  assert.equal(commentCountsByDrawing({ products: null, comments: null }).size, 0);
  assert.equal(commentCountsByDrawing({ products: 'nope', comments: 'nope' }).size, 0);
});

test('a drawing with no products has no entry', () => {
  const hub = { products: [], comments: [C('c1', ['p1'], 'open')] };
  assert.equal(commentCountsByDrawing(hub).size, 0);
});

test('a product with no comments contributes no counts', () => {
  const hub = { products: [P('p1', ['D-001'])], comments: [] };
  assert.equal(commentCountsByDrawing(hub).size, 0);
});

test('one comment is counted against every drawing of its product', () => {
  const hub = {
    products: [P('p1', ['D-001', 'D-002', 'D-003'])],
    comments: [C('c1', ['p1'], 'open')],
  };
  const counts = commentCountsByDrawing(hub);
  assert.equal(counts.size, 3);
  for (const d of ['D-001', 'D-002', 'D-003']) {
    assert.deepEqual(counts.get(d), { open: 1, inProgress: 0, closed: 0 });
  }
});

test('a comment spanning two products that share a drawing counts once, not twice', () => {
  const hub = {
    products: [P('p1', ['D-001']), P('p2', ['D-001', 'D-002'])],
    comments: [C('c1', ['p1', 'p2'], 'open')],
  };
  const counts = commentCountsByDrawing(hub);
  assert.deepEqual(counts.get('D-001'), { open: 1, inProgress: 0, closed: 0 }); // not 2
  assert.deepEqual(counts.get('D-002'), { open: 1, inProgress: 0, closed: 0 });
});

test('open, in-progress and closed are counted separately', () => {
  const hub = {
    products: [P('p1', ['D-001'])],
    comments: [
      C('c1', ['p1'], 'open'),
      C('c2', ['p1'], 'open'),
      C('c3', ['p1'], 'in_progress'),
      C('c4', ['p1'], 'closed'),
    ],
  };
  assert.deepEqual(commentCountsByDrawing(hub).get('D-001'), { open: 2, inProgress: 1, closed: 1 });
});

test('a comment referencing a tombstoned/missing product is ignored, not thrown', () => {
  const hub = {
    products: [P('p1', ['D-001'])],
    comments: [C('c1', ['p1', 'ghost-product'], 'open')],
  };
  const counts = commentCountsByDrawing(hub);
  assert.deepEqual(counts.get('D-001'), { open: 1, inProgress: 0, closed: 0 });
  assert.equal(counts.size, 1);
});

test('a comment referencing ONLY a missing product contributes nothing, and does not throw', () => {
  const hub = {
    products: [P('p1', ['D-001'])],
    comments: [C('c1', ['ghost-product'], 'open')],
  };
  assert.equal(commentCountsByDrawing(hub).size, 0);
});

test('malformed comment/product entries in otherwise-valid arrays are skipped, not thrown', () => {
  const hub = {
    products: [null, P('p1', ['D-001']), { id: 'p2' /* no pidDrawings */ }],
    comments: [null, 'nope', C('c1', ['p1'], 'open'), { id: 'c2', productIds: ['p1'] /* no status */ }],
  };
  const counts = commentCountsByDrawing(hub);
  assert.deepEqual(counts.get('D-001'), { open: 1, inProgress: 0, closed: 0 });
});

test('a product with pidDrawings not an array degrades to no drawings, not a throw', () => {
  const hub = {
    products: [{ id: 'p1', pidDrawings: 'D-001' }],
    comments: [C('c1', ['p1'], 'open')],
  };
  assert.equal(commentCountsByDrawing(hub).size, 0);
});

// ── openCommentsByDrawing (Task 7) ───────────────────────────────────────

const OC = (id, productIds, overrides) => ({
  id, productIds, ref: 'HUB-0001', status: 'open',
  priority: 'medium', dateRaised: '2026-01-01', raisedBy: 'A. Person',
  description: 'A description.', ...overrides,
});

test('open comments: malformed/empty hub data returns an empty Map, never throws', () => {
  assert.equal(openCommentsByDrawing(null).size, 0);
  assert.equal(openCommentsByDrawing(undefined).size, 0);
  assert.equal(openCommentsByDrawing({}).size, 0);
  assert.equal(openCommentsByDrawing({ products: null, comments: null }).size, 0);
  assert.equal(openCommentsByDrawing({ products: 'nope', comments: 'nope' }).size, 0);
});

test('open comments: one comment appears against every drawing of its product', () => {
  const hub = {
    products: [P('p1', ['D-001', 'D-002', 'D-003'])],
    comments: [OC('c1', ['p1'])],
  };
  const grouped = openCommentsByDrawing(hub);
  assert.equal(grouped.size, 3);
  for (const d of ['D-001', 'D-002', 'D-003']) {
    assert.equal(grouped.get(d).length, 1);
    assert.equal(grouped.get(d)[0].id, 'c1');
  }
});

test('open comments: a comment spanning two products that share a drawing is listed once, not twice', () => {
  const hub = {
    products: [P('p1', ['D-001']), P('p2', ['D-001', 'D-002'])],
    comments: [OC('c1', ['p1', 'p2'])],
  };
  const grouped = openCommentsByDrawing(hub);
  assert.equal(grouped.get('D-001').length, 1);
  assert.equal(grouped.get('D-002').length, 1);
});

test('open comments: only open is included, not in_progress or closed', () => {
  const hub = {
    products: [P('p1', ['D-001'])],
    comments: [
      OC('c1', ['p1'], { status: 'open' }),
      OC('c2', ['p1'], { status: 'in_progress' }),
      OC('c3', ['p1'], { status: 'closed' }),
    ],
  };
  const grouped = openCommentsByDrawing(hub);
  assert.equal(grouped.get('D-001').length, 1);
  assert.equal(grouped.get('D-001')[0].id, 'c1');
});

test('open comments: a drawing whose only comments are non-open gets no entry at all', () => {
  const hub = {
    products: [P('p1', ['D-001'])],
    comments: [OC('c1', ['p1'], { status: 'closed' })],
  };
  assert.equal(openCommentsByDrawing(hub).size, 0);
});

test('open comments: sorted high priority first, then oldest first within a priority', () => {
  const hub = {
    products: [P('p1', ['D-001'])],
    comments: [
      OC('c-med-late', ['p1'], { priority: 'medium', dateRaised: '2026-03-01' }),
      OC('c-high-late', ['p1'], { priority: 'high', dateRaised: '2026-02-01' }),
      OC('c-low-early', ['p1'], { priority: 'low', dateRaised: '2026-01-01' }),
      OC('c-high-early', ['p1'], { priority: 'high', dateRaised: '2026-01-01' }),
      OC('c-med-early', ['p1'], { priority: 'medium', dateRaised: '2026-01-15' }),
    ],
  };
  const ids = openCommentsByDrawing(hub).get('D-001').map(c => c.id);
  assert.deepEqual(ids, [
    'c-high-early', 'c-high-late', 'c-med-early', 'c-med-late', 'c-low-early',
  ]);
});

test('open comments: a comment referencing a missing product is ignored, not thrown', () => {
  const hub = {
    products: [P('p1', ['D-001'])],
    comments: [OC('c1', ['p1', 'ghost-product'])],
  };
  const grouped = openCommentsByDrawing(hub);
  assert.equal(grouped.get('D-001').length, 1);
  assert.equal(grouped.size, 1);
});

test('open comments: a comment referencing ONLY a missing product contributes nothing, and does not throw', () => {
  const hub = {
    products: [P('p1', ['D-001'])],
    comments: [OC('c1', ['ghost-product'])],
  };
  assert.equal(openCommentsByDrawing(hub).size, 0);
});

test('open comments: a product whose pidDrawings is not an array degrades to no drawings, not a throw', () => {
  const hub = {
    products: [{ id: 'p1', pidDrawings: 'D-001' }],
    comments: [OC('c1', ['p1'])],
  };
  assert.equal(openCommentsByDrawing(hub).size, 0);
});

test('open comments: commentCountsByDrawing is unaffected by the shared-join refactor', () => {
  const hub = {
    products: [P('p1', ['D-001', 'D-002']), P('p2', ['D-001'])],
    comments: [
      C('c1', ['p1'], 'open'),
      C('c2', ['p1', 'p2'], 'open'),
      C('c3', ['p1'], 'in_progress'),
      C('c4', ['p1'], 'closed'),
    ],
  };
  const counts = commentCountsByDrawing(hub);
  assert.deepEqual(counts.get('D-001'), { open: 2, inProgress: 1, closed: 1 });
  assert.deepEqual(counts.get('D-002'), { open: 2, inProgress: 1, closed: 1 });
});

// ── Precedence: hub-data.json is the authority, not register.json ────────
// Found in real use: a hub root can legitimately contain a register.json —
// left behind when the P&ID tool was once pointed at the hub folder and, in
// legacy mode, treated it as its own register folder. Checking "register here"
// FIRST made that stray win, so the tool read a 10 KB leftover instead of the
// 1.8 MB real register in the subfolder, and reported "legacy, no hub link".
// hub-data.json is the only unambiguous marker of a hub root.
test('a stray register.json in the hub root does not defeat hub-root detection', () => {
  assert.deepEqual(
    resolveConnectMode({ hasRegisterHere: true, hasHubDataHere: true, registerSubfolders: ['P&ID Tag Register'] }),
    { mode: 'hub-root', registerSubfolder: 'P&ID Tag Register' });
});

// A hub root holding the register directly, with no subfolder, is a legitimate
// combined layout — use that folder rather than creating a second register.
test('hub root that IS the register folder uses itself, not a new subfolder', () => {
  assert.deepEqual(
    resolveConnectMode({ hasRegisterHere: true, hasHubDataHere: true, registerSubfolders: [] }),
    { mode: 'hub-root', registerSubfolder: null });
});

test('no hub-data: a register here is still plain legacy', () => {
  assert.deepEqual(
    resolveConnectMode({ hasRegisterHere: true, hasHubDataHere: false, registerSubfolders: [] }),
    { mode: 'legacy', registerSubfolder: null });
});

// ── drawingNameFromFile (Task 5) ─────────────────────────────────────────
//
// Motivated by the 2026-08-03 incident: re-importing archived PDFs (named
// `<drawing>_<rev>.pdf`) folded the revision into the drawing name, and the
// tool then appended the revision again on the next archive write.

test('a plain filename is unchanged, revisionFromName is null', () => {
  assert.deepEqual(drawingNameFromFile('D-001.pdf'), { name: 'D-001', revisionFromName: null });
});

test('a trailing _C01 is recognised as a revision and stripped', () => {
  assert.deepEqual(drawingNameFromFile('X_C01.pdf'), { name: 'X', revisionFromName: 'C01' });
});

test('a trailing _P01 is recognised as a revision and stripped', () => {
  assert.deepEqual(drawingNameFromFile('X_P01.pdf'), { name: 'X', revisionFromName: 'P01' });
});

test('a genuine underscore that is not a revision is left alone', () => {
  assert.deepEqual(drawingNameFromFile('PUMP_HOUSE.pdf'), { name: 'PUMP_HOUSE', revisionFromName: null });
});

test('a copy marker like " (1)" is stripped, exactly as before', () => {
  assert.deepEqual(drawingNameFromFile('X (1).pdf'), { name: 'X', revisionFromName: null });
});

test('both a copy marker and a revision suffix are handled together', () => {
  assert.deepEqual(drawingNameFromFile('X_C01 (1).pdf'), { name: 'X', revisionFromName: 'C01' });
});

test('revision detection is case-insensitive', () => {
  assert.deepEqual(drawingNameFromFile('x_c01.pdf'), { name: 'x', revisionFromName: 'C01' });
});

test('a filename that is only an extension does not throw', () => {
  assert.deepEqual(drawingNameFromFile('.pdf'), { name: '', revisionFromName: null });
});

test('an empty filename does not throw', () => {
  assert.deepEqual(drawingNameFromFile(''), { name: '', revisionFromName: null });
});

test('several underscores: only a genuine trailing revision is stripped', () => {
  assert.deepEqual(drawingNameFromFile('SITE_PUMP_HOUSE_C01.pdf'),
    { name: 'SITE_PUMP_HOUSE', revisionFromName: 'C01' });
});

test('several underscores with no genuine revision at the end: name unchanged', () => {
  assert.deepEqual(drawingNameFromFile('SITE_PUMP_HOUSE.pdf'),
    { name: 'SITE_PUMP_HOUSE', revisionFromName: null });
});

// ── isDestructiveSave (Task 6) ───────────────────────────────────────────
//
// Every version of the 2026-08-03 incident had the same shape: memory held
// far less than disk, and the save proceeded silently. This guards that
// shape generically, to catch failure modes nobody has found yet.

test('142 -> 0 is destructive (the exact incident: zero from many)', () => {
  assert.equal(isDestructiveSave(142, 0), true);
});

test('142 -> 1 is destructive', () => {
  assert.equal(isDestructiveSave(142, 1), true);
});

test('142 -> 141 (losing one of many) is not destructive', () => {
  assert.equal(isDestructiveSave(142, 141), false);
});

test('0 -> 5 is not destructive (a first save)', () => {
  assert.equal(isDestructiveSave(0, 5), false);
});

test('5 -> 5 (no change) is not destructive', () => {
  assert.equal(isDestructiveSave(5, 5), false);
});

test('5 -> 50 (growth) is not destructive', () => {
  assert.equal(isDestructiveSave(5, 50), false);
});

test('undefined counts are treated as destructive (fail safe)', () => {
  assert.equal(isDestructiveSave(undefined, 0), true);
  assert.equal(isDestructiveSave(142, undefined), true);
});

test('null counts are treated as destructive (fail safe)', () => {
  assert.equal(isDestructiveSave(null, 0), true);
  assert.equal(isDestructiveSave(142, null), true);
});

test('NaN counts are treated as destructive (fail safe)', () => {
  assert.equal(isDestructiveSave(NaN, 0), true);
  assert.equal(isDestructiveSave(142, NaN), true);
});

test('non-numeric (string) counts are treated as destructive (fail safe)', () => {
  assert.equal(isDestructiveSave('142', 0), true);
  assert.equal(isDestructiveSave(142, '0'), true);
});

test('negative counts are treated as destructive (fail safe)', () => {
  assert.equal(isDestructiveSave(-1, 0), true);
  assert.equal(isDestructiveSave(142, -1), true);
});

// ── commentCountsByProduct / openCommentsByProduct ───────────────────────
//
// Unlike the *ByDrawing functions, these key directly on the comment's
// productIds — no products array, no pidDrawings join. A family in the P&ID
// tool is exposed by the Comments Hub as a pseudo-product with id
// 'fam-' + familyId (see familyProductId in assets/js/hub-core.js), so a
// comment naming that id resolves here exactly like any other product.

test('commentCountsByProduct: malformed/empty hub data returns an empty Map, never throws', () => {
  assert.equal(commentCountsByProduct(null).size, 0);
  assert.equal(commentCountsByProduct(undefined).size, 0);
  assert.equal(commentCountsByProduct({}).size, 0);
  assert.equal(commentCountsByProduct({ comments: null }).size, 0);
  assert.equal(commentCountsByProduct({ comments: 'nope' }).size, 0);
});

test('commentCountsByProduct: counts a comment against its product id', () => {
  const hub = { comments: [C('c1', ['p1'], 'open')] };
  const counts = commentCountsByProduct(hub);
  assert.deepEqual(counts.get('p1'), { open: 1, inProgress: 0, closed: 0 });
});

test('commentCountsByProduct: a comment listing two products is counted once for each', () => {
  const hub = { comments: [C('c1', ['p1', 'p2'], 'open')] };
  const counts = commentCountsByProduct(hub);
  assert.deepEqual(counts.get('p1'), { open: 1, inProgress: 0, closed: 0 });
  assert.deepEqual(counts.get('p2'), { open: 1, inProgress: 0, closed: 0 });
});

test('commentCountsByProduct: open, in-progress and closed are counted separately', () => {
  const hub = {
    comments: [
      C('c1', ['p1'], 'open'),
      C('c2', ['p1'], 'open'),
      C('c3', ['p1'], 'in_progress'),
      C('c4', ['p1'], 'closed'),
    ],
  };
  assert.deepEqual(commentCountsByProduct(hub).get('p1'), { open: 2, inProgress: 1, closed: 1 });
});

test('commentCountsByProduct: a family pseudo-product id resolves like any other product', () => {
  const hub = { comments: [C('c1', ['fam-abc123'], 'open')] };
  assert.deepEqual(commentCountsByProduct(hub).get('fam-abc123'), { open: 1, inProgress: 0, closed: 0 });
});

test('commentCountsByProduct: malformed entries are skipped, not thrown', () => {
  const hub = {
    comments: [null, 'nope', C('c1', ['p1'], 'open'), { id: 'c2', productIds: ['p1'] /* no status */ }],
  };
  assert.deepEqual(commentCountsByProduct(hub).get('p1'), { open: 1, inProgress: 0, closed: 0 });
});

test('commentCountsByProduct: productIds not an array degrades to no entries, not a throw', () => {
  const hub = { comments: [{ id: 'c1', productIds: 'p1', status: 'open' }] };
  assert.equal(commentCountsByProduct(hub).size, 0);
});

test('openCommentsByProduct: malformed/empty hub data returns an empty Map, never throws', () => {
  assert.equal(openCommentsByProduct(null).size, 0);
  assert.equal(openCommentsByProduct(undefined).size, 0);
  assert.equal(openCommentsByProduct({}).size, 0);
  assert.equal(openCommentsByProduct({ comments: null }).size, 0);
  assert.equal(openCommentsByProduct({ comments: 'nope' }).size, 0);
});

test('openCommentsByProduct: only open is included, not in_progress or closed', () => {
  const hub = {
    comments: [
      OC('c1', ['p1'], { status: 'open' }),
      OC('c2', ['p1'], { status: 'in_progress' }),
      OC('c3', ['p1'], { status: 'closed' }),
    ],
  };
  const grouped = openCommentsByProduct(hub);
  assert.equal(grouped.get('p1').length, 1);
  assert.equal(grouped.get('p1')[0].id, 'c1');
});

test('openCommentsByProduct: sorted high priority first, then oldest first within a priority', () => {
  const hub = {
    comments: [
      OC('c-med-late', ['p1'], { priority: 'medium', dateRaised: '2026-03-01' }),
      OC('c-high-late', ['p1'], { priority: 'high', dateRaised: '2026-02-01' }),
      OC('c-low-early', ['p1'], { priority: 'low', dateRaised: '2026-01-01' }),
      OC('c-high-early', ['p1'], { priority: 'high', dateRaised: '2026-01-01' }),
      OC('c-med-early', ['p1'], { priority: 'medium', dateRaised: '2026-01-15' }),
    ],
  };
  const ids = openCommentsByProduct(hub).get('p1').map(c => c.id);
  assert.deepEqual(ids, [
    'c-high-early', 'c-high-late', 'c-med-early', 'c-med-late', 'c-low-early',
  ]);
});

test('openCommentsByProduct: a family pseudo-product id resolves', () => {
  const hub = { comments: [OC('c1', ['fam-abc123'])] };
  const grouped = openCommentsByProduct(hub);
  assert.equal(grouped.get('fam-abc123').length, 1);
  assert.equal(grouped.get('fam-abc123')[0].id, 'c1');
});

test('openCommentsByProduct: a comment listing two products is listed for each, not deduped away', () => {
  const hub = { comments: [OC('c1', ['p1', 'p2'])] };
  const grouped = openCommentsByProduct(hub);
  assert.equal(grouped.get('p1').length, 1);
  assert.equal(grouped.get('p2').length, 1);
});
