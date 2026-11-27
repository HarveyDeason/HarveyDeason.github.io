// The lock refuses a page that has lost a fix already shipped (tools-src is per-worktree and gitignored, so a stale copy is easy to lock by mistake).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingMarkers } from '../scripts/lock-tools.mjs';

const RULES = { 'widget.html': ['fastLookup(', 'cacheFix = true'], 'other.html': ['x'] };

test('a page holding every marker passes', () => {
  assert.deepEqual(missingMarkers('widget.html', 'a fastLookup(b) c cacheFix = true', RULES), []);
});

test('a page missing a marker is refused, and the missing ones are named', () => {
  assert.deepEqual(missingMarkers('widget.html', 'only fastLookup( here', RULES), ['cacheFix = true']);
  assert.deepEqual(missingMarkers('widget.html', '', RULES), ['fastLookup(', 'cacheFix = true']);
});

test('a tool with no rules passes; bad rules or text never throw', () => {
  assert.deepEqual(missingMarkers('unlisted.html', 'anything', RULES), []);
  for (const bad of [null, undefined, 7, [], { 'widget.html': 'x' }, { 'widget.html': [3, null] }]) assert.doesNotThrow(() => missingMarkers('widget.html', 'text', bad));
  assert.doesNotThrow(() => missingMarkers('widget.html', null, RULES));
  assert.deepEqual(missingMarkers('widget.html', null, RULES), ['fastLookup(', 'cacheFix = true']);
});
