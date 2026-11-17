import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIBRARY, LOOKUPS } from './fixtures/symbol-check-sheet.js';

// The worker is a script that answers self.onmessage: stand a fake self in for it.
test('worker: a printed sheet is checked with no tags, so no tag verdict can arise', async () => {
  const posted = [];
  globalThis.self = { postMessage: m => posted.push(m), onmessage: null };
  await import('../assets/js/pid-symbol-check-worker.js');
  const msg = words => ({ data: { fnArray: [], argsArray: [], OPS: {}, viewportTransform: [1, 0, 0, 1, 0, 0], words,
    tags: [{ tag: '21-W-1001', fc: 'W' }], pageSize: [400, 300], library: LIBRARY, lookups: LOOKUPS, textItems: [] } });
  self.onmessage(msg('printed'));
  self.onmessage(msg('text'));
  const [printed, text] = posted.filter(m => m.type === 'result').map(m => m.result);
  assert.equal(printed.words, 'printed');
  assert.deepEqual(printed.verdicts, []);
  assert.equal(text.verdicts.length, 1);   // the same tag on a text sheet still gets its verdict
  delete globalThis.self;
});
