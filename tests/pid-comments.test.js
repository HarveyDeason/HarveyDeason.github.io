// tests/pid-comments.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConnectMode, connectModeLabel, commentCountsByDrawing,
  CONVENTIONAL_REGISTER_SUBFOLDER } from '../assets/js/pid-comments.js';

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
