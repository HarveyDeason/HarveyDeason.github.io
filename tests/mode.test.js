import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMode } from '../assets/js/mode.js';

test('stored choice wins over system', () => {
  assert.equal(resolveMode('dark', false), 'dark');
  assert.equal(resolveMode('light', true), 'light');
});
test('no stored choice follows system', () => {
  assert.equal(resolveMode(null, true), 'dark');
  assert.equal(resolveMode(null, false), 'light');
  assert.equal(resolveMode(undefined, false), 'light');
});
test('garbage stored value falls back to system', () => {
  assert.equal(resolveMode('banana', true), 'dark');
});
