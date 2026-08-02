// tests/pid-comments.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConnectMode, connectModeLabel,
  CONVENTIONAL_REGISTER_SUBFOLDER } from '../assets/js/pid-comments.js';

// ── resolveConnectMode (Task 2) ─────────────────────────────────────────

test('case 1: register.json directly present -> legacy, always wins', () => {
  const r = resolveConnectMode({ hasRegisterHere: true, hasHubDataHere: false, registerSubfolders: [] });
  assert.deepEqual(r, { mode: 'legacy', registerSubfolder: null });
});

test('case 1 beats case 2: register.json AND hub-data.json both present -> legacy', () => {
  const r = resolveConnectMode({ hasRegisterHere: true, hasHubDataHere: true, registerSubfolders: ['P&ID Register'] });
  assert.deepEqual(r, { mode: 'legacy', registerSubfolder: null });
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
