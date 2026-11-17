import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readSheet, setTagIds, relabel, tally, bubbleSelfTest, matchSymbolLists, insideRepo } from '../scripts/check-symbol-check.mjs';
import { LIBRARY, SHEET, sheetPdfBytes, BUBBLE_LIBRARY } from './fixtures/symbol-check-sheet.js';

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

test('readSheet: words printed reads no words and no tags, and reports the letters spotted', async () => {
  const sheet = await readSheet(sheetPdfBytes(), { words: 'printed' });
  assert.equal(sheet.ok, true);
  assert.equal(sheet.words, 'printed');
  assert.deepEqual(sheet.tags, []);
  assert.deepEqual(sheet.textItems, []);
  assert.ok(Number.isFinite(sheet.letters.removed) && Number.isFinite(sheet.letters.rows));
  assert.equal((await readSheet(sheetPdfBytes(), { words: 'nonsense' })).words, 'text');
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

test('bubbleSelfTest: each bubble, stamped round an invented tag, is identified as itself', () => {
  const r = bubbleSelfTest(BUBBLE_LIBRARY);
  assert.equal(r.length, 6);
  assert.ok(r.every(x => x.pass), JSON.stringify(r.filter(x => !x.pass)));
  // Strip the bar from one: it is now the plain ring twice over, and cannot be told apart.
  const lib = { ...BUBBLE_LIBRARY, symbols: BUBBLE_LIBRARY.symbols.map(s => (s.name === 'RING, ONE BAR' ? { ...s, paths: s.paths.slice(0, 1) } : s)) };
  assert.ok(bubbleSelfTest(lib).some(x => !x.pass));
  assert.deepEqual(bubbleSelfTest(null), []);
});

test('the command line: the bubble self-test, and instrument codes passed in', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'symbol-check-'));
  try {
    const lib = path.join(dir, 'library.json'), old = path.join(dir, 'old.json'), pdf = path.join(dir, 'invented.pdf');
    fs.writeFileSync(lib, JSON.stringify(BUBBLE_LIBRARY));
    fs.writeFileSync(old, JSON.stringify(LIBRARY));
    fs.writeFileSync(pdf, sheetPdfBytes());
    const self = run(['--bubble-self-test', '--library', lib]);
    assert.equal(self.status, 0, self.stdout + self.stderr);
    assert.match(self.stdout, /6 of 6 identified as themselves/);
    assert.doesNotMatch(self.stdout, /RING/);   // names only with --verbose
    assert.match(run(['--bubble-self-test', '--library', lib, '--verbose']).stdout, /PASS +RING, BROKEN BAR/);
    const none = run(['--bubble-self-test', '--library', old]);
    assert.equal(none.status, 1);
    assert.match(none.stderr, /no tag bubbles/);
    const inst = run([pdf, '--library', old, '--instrument', 'ZI', '--allow-wrong', '1', '--verbose']);
    assert.match(inst.stdout, /21-ZI-5001 +Not checked .*The library has no tag bubbles/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const SYM = (name, x, y, oneOf = []) => ({ name, oneOf, box: [x - 5, y - 5, x + 5, y + 5] });
const TRUTH = [SYM('ALPHA', 100, 100), SYM('BETA', 200, 150), SYM('GAMMA', 300, 90), SYM('DELTA', 50, 400)];
const shifted = (list, dx, dy) => list.map(s => ({ ...s, box: [s.box[0] + dx, s.box[1] + dy, s.box[2] + dx, s.box[3] + dy] }));

test('matchSymbolLists: identical, shifted, oneOf, too far, crowded and rubbish', () => {
  const same = matchSymbolLists(TRUTH, TRUTH);
  assert.equal(same.matched, 4);
  assert.deepEqual([same.missing, same.extra], [[], []]);

  const sh = matchSymbolLists(TRUTH, shifted(TRUTH, 2.5, -1.5));
  assert.equal(sh.matched, 4);
  assert.ok(Math.abs(sh.offset[0] - 2.5) < 0.01 && Math.abs(sh.offset[1] + 1.5) < 0.01, String(sh.offset));

  const one = matchSymbolLists([SYM('ALPHA', 10, 10, ['ALPHA TWIN'])], [SYM('ALPHA TWIN', 10, 10)]);
  assert.equal(one.matched, 1);

  const far = matchSymbolLists([SYM('ALPHA', 10, 10)], [SYM('ALPHA', 16, 10)]);
  assert.equal(far.matched, 0);
  assert.equal(far.missing.length, 1);
  assert.equal(far.extra.length, 1);

  const crowd = matchSymbolLists([SYM('ALPHA', 10, 10), SYM('ALPHA', 11, 10)], [SYM('ALPHA', 10.5, 10)]);
  assert.equal(crowd.matched, 1);
  assert.equal(crowd.missing.length, 1);
  assert.equal(crowd.extra.length, 0);

  const empty = { matched: 0, missing: [], extra: [], offset: [0, 0] };
  assert.deepEqual(matchSymbolLists(null, null), empty);
  assert.deepEqual(matchSymbolLists([{}], [{}]), empty);
  assert.deepEqual(matchSymbolLists([{ name: 'A', oneOf: [], box: [NaN, 0, 1, 1] }], [{ name: 'A', oneOf: [], box: [NaN, 0, 1, 1] }]), empty);
});

test('insideRepo and --symbols-out: a path under the repository is refused and nothing is written', () => {
  assert.equal(insideRepo(path.join(SCRIPT, '..', '..', 'tests', 'x.json')), true);
  assert.equal(insideRepo(path.join(os.tmpdir(), 'x.json')), false);
  assert.equal(insideRepo(null), true);   // cannot tell: refuse
  assert.equal(insideRepo(path.join(SCRIPT, '..', '..', '..x', 'a.json')), true);   // a folder named ..x inside the repo is inside
  assert.equal(insideRepo(path.join(SCRIPT, '..', '..', '..', 'elsewhere.json')), false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'symbol-check-'));
  const inside = path.join(path.dirname(SCRIPT), '..', 'tests', 'never-written-symbols.json');
  try {
    const pdf = path.join(dir, 'invented.pdf'), lib = path.join(dir, 'library.json'), out = path.join(dir, 'out.json');
    fs.writeFileSync(pdf, sheetPdfBytes());
    fs.writeFileSync(lib, JSON.stringify(LIBRARY));
    const bad = run([pdf, '--library', lib, '--allow-wrong', '1', '--symbols-out', inside]);
    assert.equal(bad.status, 1, bad.stdout + bad.stderr);
    assert.equal(fs.existsSync(inside), false);
    assert.match(bad.stderr, /outside the repository/);
    const ok = run([pdf, '--library', lib, '--allow-wrong', '1', '--symbols-out', out]);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /format: text items \d+, comments 0, paths \d+/);
    const saved = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(saved.sheet, 'invented.pdf');
    assert.ok(Array.isArray(saved.symbols) && saved.symbols.length > 0, 'the invented sheet must yield symbols');
    const cmp = run([pdf, '--library', lib, '--allow-wrong', '1', '--compare', out]);
    assert.ok(cmp.stdout.includes(`compared with out.json: matched ${saved.symbols.length} of ${saved.symbols.length}, missing 0, extra 0, offset 0, 0`), cmp.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(inside, { force: true }); }
});
