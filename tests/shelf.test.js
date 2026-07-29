import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashSlug, toVolume, packShelves } from '../assets/js/shelf.js';

const post = (over = {}) => ({
  slug: 'weekly-waffle-12', dateISO: '2024-10-06T09:00:00',
  title: 'Weekly Waffle #12 — Silence is Golden',
  excerpt: 'On saying less.', ...over
});

test('hashSlug is deterministic and non-negative', () => {
  assert.equal(hashSlug('weekly-waffle-12'), hashSlug('weekly-waffle-12'));
  assert.ok(hashSlug('the-unlived-life') >= 0);
  assert.notEqual(hashSlug('a'), hashSlug('b'));
});

test('toVolume marks Weekly Waffle posts as series and extracts the volume', () => {
  const v = toVolume(post());
  assert.equal(v.series, true);
  assert.equal(v.volume, '12');
  assert.equal(v.cloth, 'series');
});

test('toVolume pads single-digit volume numbers', () => {
  const v = toVolume(post({ title: 'Weekly Waffle #9', slug: 'weekly-waffle-9' }));
  assert.equal(v.volume, '09');
});

test('toVolume strips the series prefix for the spine label', () => {
  assert.equal(toVolume(post()).shortTitle, 'Silence is Golden');
});

test('toVolume falls back to the series name when there is no subtitle', () => {
  const v = toVolume(post({ title: 'Weekly Waffle #4', slug: 'weekly-waffle-4' }));
  assert.equal(v.shortTitle, 'Weekly Waffle');
});

test('toVolume treats standalone essays as non-series with their own cloth', () => {
  const v = toVolume(post({ title: 'The Unlived Life', slug: 'the-unlived-life' }));
  assert.equal(v.series, false);
  assert.equal(v.volume, '');
  assert.equal(v.shortTitle, 'The Unlived Life');
  assert.ok(['oxblood','navy','tan','plum'].includes(v.cloth));
});

test('toVolume strips a dash-before-hash prefix with no subtitle (falls back to series name)', () => {
  const v = toVolume(post({ title: 'Weekly waffle – #2', slug: 'weekly-waffle-2' }));
  assert.equal(v.shortTitle, 'Weekly Waffle');
});

test('toVolume strips a dash-before-hash prefix with a parenthesised subtitle', () => {
  const v = toVolume(post({ title: 'Weekly Waffle – #8 (Overoptimization)', slug: 'weekly-waffle-8' }));
  assert.equal(v.shortTitle, 'Overoptimization');
});

test('toVolume strips a space-after-hash prefix with a parenthesised subtitle', () => {
  const v = toVolume(post({ title: 'Weekly Waffle # 11 (Growth Mindset)', slug: 'weekly-waffle-11' }));
  assert.equal(v.shortTitle, 'Growth Mindset');
});

test('toVolume strips a colon separator with a parenthesised subtitle', () => {
  const v = toVolume(post({
    title: 'Weekly Waffle #14: (Luck, Struggle and the cards of Life)',
    slug: 'weekly-waffle-14'
  }));
  assert.equal(v.shortTitle, 'Luck, Struggle and the cards of Life');
});

test('toVolume still strips the already-working dash-after-number case', () => {
  const v = toVolume(post({ title: 'Weekly Waffle #19 – The Life of a Camel', slug: 'weekly-waffle-19' }));
  assert.equal(v.shortTitle, 'The Life of a Camel');
});

test('toVolume handles a bare "Weekly Waffle #9" with no separator or subtitle', () => {
  const v = toVolume(post({ title: 'Weekly Waffle #9', slug: 'weekly-waffle-9' }));
  assert.equal(v.shortTitle, 'Weekly Waffle');
});

test('toVolume leaves a non-series title with an empty title as an empty shortTitle', () => {
  const v = toVolume(post({ title: '', slug: 'no-title-essay' }));
  assert.equal(v.series, false);
  assert.equal(v.shortTitle, '');
});

test('toVolume does not unwrap parentheses that appear mid-string, not wrapping the whole remainder', () => {
  const v = toVolume(post({
    title: 'Weekly Waffle #20: Time flies (mostly) when you are having fun',
    slug: 'weekly-waffle-20'
  }));
  assert.equal(v.shortTitle, 'Time flies (mostly) when you are having fun');
});

test('toVolume dimensions are deterministic and within the approved ranges', () => {
  const a = toVolume(post()), b = toVolume(post());
  assert.deepEqual([a.width, a.height, a.depth], [b.width, b.height, b.depth]);
  assert.ok(a.width  >= 30 && a.width  <= 46);
  assert.ok(a.height >= 196 && a.height <= 274);
  assert.ok(a.depth  >= 46 && a.depth  <= 67);
});

const vol = w => ({ slug: 's' + w, width: w });

test('packShelves wraps books onto rows that fit the container', () => {
  const rows = packShelves([vol(40), vol(40), vol(40)], 100, 2);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].length, 2);   // 40 + 2 + 40 = 82 fits; adding a third = 124 does not
  assert.equal(rows[1].length, 1);
});

test('packShelves is stable — same input and width gives the same rows', () => {
  const books = [vol(40), vol(30), vol(46), vol(35)];
  assert.deepEqual(packShelves(books, 120, 2), packShelves(books, 120, 2));
});

test('packShelves keeps a single over-wide book on its own row', () => {
  const rows = packShelves([vol(500)], 100, 2);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].length, 1);
});

test('packShelves returns no rows for an empty journal', () => {
  assert.deepEqual(packShelves([], 800, 2), []);
});
