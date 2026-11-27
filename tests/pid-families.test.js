// Family matching for the register's Sheets list and clash check. Invented drawing names only.
// `legacy` is the page's original algorithm, kept here as the reference: the module must give exactly its answers, only faster.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandPatterns, familyIndex } from '../assets/js/pid-families.js';

function legacy(patterns, allDrawings) {
  const matched = new Set();
  patterns.forEach(pat => {
    pat = pat.trim().toUpperCase();
    if (!pat) return;
    const rangeMatch = pat.match(/^([A-Z]+)(\d+)-(?:[A-Z]+)?(\d+)$/);
    if (rangeMatch) {
      const prefix = rangeMatch[1], from = parseInt(rangeMatch[2]), to = parseInt(rangeMatch[3]);
      allDrawings.forEach(d => {
        const dm = d.toUpperCase().match(new RegExp('^' + prefix + '(\\d+)'));
        if (dm) { const n = parseInt(dm[1]); if (n >= from && n <= to) matched.add(d); }
      });
      return;
    }
    allDrawings.forEach(d => { if (d.toUpperCase().startsWith(pat) || d.toUpperCase().includes(pat)) matched.add(d); });
  });
  return matched;
}

const NAMES = ['SP51', 'SP52', 'SP60', 'sp70', 'D100-ATKI-52-TT-G-P-4024', 'D100-ATKI-52-TT-G-P-4030', 'PS12-A', 'PS13-B', 'XX1', 'Q9', 'FOO BAR'];
const PATTERN_SETS = [['SP51-SP60'], ['SP5'], ['sp'], ['ps12', 'ps13'], ['4024'], ['SP50-SP55', 'Q'], ['  XX  '], [''], [], ['SP51-60'], ['NOPE'], ['(', '[a-z]+', '.*'], ['SP5-SP6'], ['4030', 'FOO BAR']];

test('expandPatterns gives exactly the original answers: ranges, prefixes, anywhere-in-name, case, blanks, regex characters', () => {
  for (const p of PATTERN_SETS) assert.deepEqual([...expandPatterns(p, NAMES)].sort(), [...legacy(p, NAMES)].sort(), JSON.stringify(p));
});

test('a larger invented set agrees with the original on every pattern set', () => {
  const names = []; for (let f = 0; f < 30; f++) for (let i = 0; i < 20; i++) names.push((f % 3 ? 'P' : 'Q') + String(f).padStart(2, '0') + '-' + String(i).padStart(3, '0'));
  for (const p of [['P05-P12'], ['Q'], ['P1'], ['-00'], ['P20-Q29'], ['Q03-P09']]) assert.deepEqual([...expandPatterns(p, names)].sort(), [...legacy(p, names)].sort(), JSON.stringify(p));
});

test('familyIndex: members are every match; the owner of a drawing is the first family that claims it; unclaimed drawings have none', () => {
  const families = [{ id: 'a', name: 'A', patterns: ['SP5'] }, { id: 'b', name: 'B', patterns: ['SP51', 'SP60'] }, { id: 'c', name: 'C', patterns: [] }];
  const idx = familyIndex(families, NAMES);
  assert.deepEqual([...idx.members.get('a')].sort(), ['SP51', 'SP52']);
  assert.deepEqual([...idx.members.get('b')].sort(), ['SP51', 'SP60']);
  assert.deepEqual([...idx.members.get('c')], []);
  assert.equal(idx.owner.get('SP51'), 'a', 'first family keeps it');
  assert.equal(idx.owner.get('SP60'), 'b');
  assert.equal(idx.owner.has('Q9'), false);
});

test('hostile input never throws and gives empty answers', () => {
  for (const bad of [null, undefined, 7, 'x', [null], [{}], [{ id: 'a', patterns: 'x' }], [{ id: 'a', patterns: [null, 4] }]]) {
    assert.doesNotThrow(() => familyIndex(bad, NAMES));
    assert.doesNotThrow(() => familyIndex([{ id: 'a', patterns: ['SP'] }], bad));
  }
  assert.deepEqual([...expandPatterns(null, NAMES)], []);
  assert.deepEqual([...expandPatterns(['SP'], null)], []);
});

test('it is fast: 800 drawings, 40 families of 3 patterns, resolved in well under a second', () => {
  const names = []; for (let i = 0; i < 800; i++) names.push('P' + String(i % 40).padStart(2, '0') + '-' + String(i).padStart(4, '0'));
  const families = []; for (let f = 0; f < 40; f++) families.push({ id: 'f' + f, name: 'F' + f, patterns: ['P' + String(f).padStart(2, '0') + '-', 'XQ' + f + '-1-5', 'ZZ' + f] });
  const t = performance.now(); const idx = familyIndex(families, names); const ms = performance.now() - t;
  assert.equal(idx.owner.size, 800);
  assert.ok(ms < 500, 'took ' + Math.round(ms) + ' ms');
});
