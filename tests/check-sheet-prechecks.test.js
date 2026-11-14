import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkPdf, parseExpect, mismatches } from '../scripts/check-sheet-prechecks.mjs';
import { sheetPdf, SHEETS } from './fixtures/sheet-pdf.js';

const SCRIPT = fileURLToPath(new URL('../scripts/check-sheet-prechecks.mjs', import.meta.url));
const run = args => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

test('parseExpect and mismatches: statuses in file order', () => {
  assert.deepEqual(parseExpect('readable, None,comments'), ['readable', 'none', 'comments']);
  for (const bad of ['readable,maybe', '', '  ', undefined, null, 5, 'constructor']) assert.equal(parseExpect(bad), null);
  assert.deepEqual(mismatches(['readable', 'none', 'comments'], ['readable', 'none', 'comments']), []);
  assert.deepEqual(mismatches(['readable', null, 'none'], ['readable', 'none', 'comments']),
    [{ index: 1, got: null, want: 'none' }, { index: 2, got: 'none', want: 'comments' }]);
  assert.deepEqual(mismatches(null, ['none']), [{ index: 0, got: null, want: 'none' }]);
});

test('checkPdf: what today\'s import registers beside what the pre-check registers', async () => {
  const count = r => [r.confirmed.length, r.review.length];
  const plotted = await checkPdf(sheetPdf(SHEETS.plotted));
  assert.deepEqual([plotted.ok, plotted.check.status, plotted.unchanged, count(plotted.registers)], [true, 'readable', true, [2, 0]]);
  const printed = await checkPdf(sheetPdf(SHEETS.printed));
  assert.deepEqual([printed.check.status, printed.unchanged, count(printed.registers)], ['none', true, [0, 0]]);
  const fromComments = await checkPdf(sheetPdf(SHEETS.commentsWithTags));
  assert.deepEqual([fromComments.check.status, fromComments.unchanged, count(fromComments.textResult), count(fromComments.registers)], ['comments', false, [0, 0], [3, 1]]);
  assert.equal((await checkPdf(sheetPdf(SHEETS.commentsNoTags))).unchanged, true);
});

test('checkPdf: bytes that are not a PDF give ok false, without throwing', async () => {
  assert.deepEqual(await checkPdf(Uint8Array.from('not a pdf', ch => ch.charCodeAt(0))), { ok: false });
  assert.deepEqual(await checkPdf(null), { ok: false });
});

test('the command line: passes only when every PDF has the status expected of it', () => {
  // Written to the system temp folder, never into the repository.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-precheck-'));
  try {
    const file = name => { const f = path.join(dir, name + '.pdf'); fs.writeFileSync(f, sheetPdf(SHEETS[name])); return f; };
    const three = [file('plotted'), file('printed'), file('commentsNoTags')];
    const good = run([...three, '--expect', 'readable,none,comments']);
    assert.equal(good.status, 0, good.stderr);
    assert.match(good.stdout, /3 of 3 as expected/);
    assert.match(good.stdout, /with the pre-check it registers: 2 confirmed, 0 for review \(the same as today\)/);
    const wrong = run([...three, '--expect', 'readable,none,readable']);
    assert.equal(wrong.status, 1);
    assert.match(wrong.stderr, /commentsNoTags\.pdf: got comments, expected readable/);
    assert.equal(run([...three, '--expect', 'readable,none']).status, 1);
    assert.equal(run([]).status, 1);
    const missing = run([path.join(dir, 'absent.pdf')]);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /Could not read .*absent\.pdf\./);
    assert.doesNotMatch(missing.stderr, /\n\s+at /);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
