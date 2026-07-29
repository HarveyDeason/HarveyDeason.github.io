import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashSlug, toVolume } from '../assets/js/shelf.js';

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

test('toVolume dimensions are deterministic and within the approved ranges', () => {
  const a = toVolume(post()), b = toVolume(post());
  assert.deepEqual([a.width, a.height, a.depth], [b.width, b.height, b.depth]);
  assert.ok(a.width  >= 30 && a.width  <= 46);
  assert.ok(a.height >= 196 && a.height <= 274);
  assert.ok(a.depth  >= 46 && a.depth  <= 67);
});
