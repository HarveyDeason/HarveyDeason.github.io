import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readSheet, setTagIds, relabel, tally } from '../scripts/check-symbol-check.mjs';
import { LIBRARY, SHEET, sheetPdfBytes } from './fixtures/symbol-check-sheet.js';

const SCRIPT = fileURLToPath(new URL('../scripts/check-symbol-check.mjs', import.meta.url));
const run = args => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

test('setTagIds, relabel and tally work on plain data', () => {
  const before = JSON.stringify(LIBRARY);
  const set = setTagIds(LIBRARY, ['WIDGETS=q']);
  assert.equal(set.changed, 3);
  assert.deepEqual(set.library.symbols.filter(s => s.group === 'WIDGETS').map(s => s.tagId), ['Q', 'Q', 'Q']);
  assert.equal(JSON.stringify(LIBRARY), before);
  for (const bad of [['WIDGETS'], ['NOWHERE=Q'], ['=Q'], null, [5]]) assert.equal(setTagIds(LIBRARY, bad).changed, 0);

  const tags = [{ tag: 'a', fc: 'W' }, { tag: 'b', fc: 'W' }, { tag: 'c', fc: 'G' }, { tag: 'd', fc: 'W' }, { tag: 'e', fc: 'W' }];
  const verdicts = tags.map(t => ({ tag: t.tag, fc: t.fc, verdict: t.tag === 'b' ? 'look' : 'ok' }));
  const r = relabel(tags, verdicts, 2, 'G');
  assert.equal(r.changed.length, 2);
  assert.ok(r.changed.every(tag => ['a', 'd', 'e'].includes(tag)));   // OK, and not already G
  assert.deepEqual(r.tags.filter(t => r.changed.includes(t.tag)).map(t => t.fc), ['G', 'G']);
  assert.deepEqual(tags.map(t => t.fc), ['W', 'W', 'G', 'W', 'W']);
  assert.deepEqual(relabel(null, null, 2, 'G'), { tags: [], changed: [] });

  assert.deepEqual(tally(verdicts), { W: { ok: 3, look: 1 }, G: { ok: 1 } });
  assert.deepEqual(tally(null), {});
});

test('readSheet: an invented PDF gives its linework, text and confirmed tags', async () => {
  const sheet = await readSheet(sheetPdfBytes());
  assert.equal(sheet.ok, true);
  assert.deepEqual(sheet.tags, SHEET.tags);
  assert.ok(sheet.paths.length > 40, String(sheet.paths.length));
  assert.deepEqual(await readSheet(Uint8Array.from('not a pdf', ch => ch.charCodeAt(0))), { ok: false });
  assert.deepEqual(await readSheet(null), { ok: false });
});

test('the command line: counts, expectations, relabelling and missing files', () => {
  // Written to the system temp folder, never into the repository.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'symbol-check-'));
  try {
    const pdf = path.join(dir, 'invented.pdf'), lib = path.join(dir, 'library.json');
    fs.writeFileSync(pdf, sheetPdfBytes());
    fs.writeFileSync(lib, JSON.stringify(LIBRARY));
    const base = [pdf, '--library', lib];

    const wrong = run([...base, '--expect', 'W=2']);
    assert.equal(wrong.status, 1, wrong.stdout + wrong.stderr);
    assert.match(wrong.stdout, /Wrong family: 1/);

    const good = run([...base, '--expect', 'W=2', '--allow-wrong', '1']);
    assert.equal(good.status, 0, good.stdout + good.stderr);
    assert.match(good.stdout, /W: 2 OK of 4/);
    assert.match(good.stdout, /tags 11, located 11/);
    assert.doesNotMatch(good.stdout, /21-W-1001|WIDGET/);   // tags and symbol names only with --verbose

    const short = run([...base, '--expect', 'W=3', '--allow-wrong', '1']);
    assert.equal(short.status, 1);
    assert.match(short.stderr, /W: expected at least 3 OK, got 2/);

    const rel = run([...base, '--relabel', '2:G', '--allow-wrong', '1']);
    assert.equal(rel.status, 0, rel.stdout + rel.stderr);
    assert.match(rel.stdout, /Relabel: 2 of 2 reported Wrong family/);
    assert.match(rel.stdout, /Other verdicts changed: 0/);

    assert.equal(run([]).status, 1);
    const missing = run([path.join(dir, 'absent.pdf'), '--library', lib]);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /Could not read .*absent\.pdf\./);
    assert.doesNotMatch(missing.stderr, /\n\s+at /);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
