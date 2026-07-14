import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePost, renderPostCard, renderSkeletonRows } from '../assets/js/wordpress.js';

const api = {
  id: 42, slug: 'weekly-waffle-19', date: '2026-01-10T09:00:00',
  title: { rendered: 'Weekly Waffle #19 &#8211; The Life of a Camel' },
  excerpt: { rendered: '<p>On Nietzsche&#8217;s camel.</p>' },
  content: { rendered: '<p>Body <strong>text</strong>.</p>' },
  _embedded: { 'wp:featuredmedia': [{ source_url: 'https://img/cover.jpg' }] }
};

test('normalizePost extracts and decodes fields', () => {
  const p = normalizePost(api);
  assert.equal(p.id, 42);
  assert.equal(p.slug, 'weekly-waffle-19');
  assert.equal(p.title, 'Weekly Waffle #19 – The Life of a Camel');
  assert.equal(p.cover, 'https://img/cover.jpg');
  assert.ok(p.excerpt.includes('camel'));
  assert.ok(!p.excerpt.includes('<p>'));      // excerpt is plain text
  assert.ok(p.html.includes('<strong>'));     // full html retained (pre-sanitise)
});

test('normalizePost tolerates missing featured media', () => {
  const p = normalizePost({ ...api, _embedded: {} });
  assert.equal(p.cover, null);
});

test('renderPostCard renders an editorial post row with a mono DD MMM YY date', () => {
  const html = renderPostCard(normalizePost(api));
  assert.ok(html.includes('class="post"'));
  assert.ok(html.includes('10 Jan 26'));          // mono short date
});

test('renderPostCard links to the in-site post reader', () => {
  const html = renderPostCard(normalizePost(api));
  assert.ok(html.includes('href="/writing/post.html?slug=weekly-waffle-19"'));
});

test('renderSkeletonRows returns n post-row placeholders with shimmer skeletons', () => {
  const html = renderSkeletonRows(2);
  assert.ok(html.includes('class="post"'));
  assert.ok((html.match(/skeleton/g) || []).length >= 2);
});
