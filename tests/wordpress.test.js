import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePost, renderPostCard, renderSkeletonRows, esc } from '../assets/js/wordpress.js';

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

test('normalizePost decodes decimal numeric entities beyond the named table', () => {
  const p = normalizePost({ ...api, title: { rendered: 'Weekly Waffle &#128512; &#8211; #8' } });
  assert.equal(p.title, 'Weekly Waffle 😀 – #8');
});

test('normalizePost decodes hex numeric entities', () => {
  const p = normalizePost({ ...api, title: { rendered: 'Dash &#x2014; here' } });
  assert.equal(p.title, 'Dash — here');
});

test('normalizePost still decodes named entities', () => {
  const p = normalizePost({ ...api, title: { rendered: 'Tools &amp; Toys&hellip;' } });
  assert.equal(p.title, 'Tools & Toys…');
});

test('normalizePost leaves unknown entities intact rather than mangling them', () => {
  const p = normalizePost({ ...api, title: { rendered: 'A &notanentity; B' } });
  assert.equal(p.title, 'A &notanentity; B');
});

test('normalizePost does not let entity-encoded markup survive as HTML in title', () => {
  const p = normalizePost({ ...api, title: { rendered: '&lt;img src=x onerror=alert(1)&gt;' } });
  assert.ok(!p.title.includes('<img'));
});

test('normalizePost does not let entity-encoded markup survive as HTML in excerpt', () => {
  const p = normalizePost({ ...api, excerpt: { rendered: '&lt;img src=x onerror=alert(1)&gt;' } });
  assert.ok(!p.excerpt.includes('<img'));
});

test('normalizePost does not let numeric-entity-encoded markup survive as HTML', () => {
  const p = normalizePost({ ...api, title: { rendered: '&#60;script&#62;alert(1)&#60;/script&#62;' } });
  assert.ok(!p.title.includes('<script'));
});

test('normalizePost still decodes a legitimate mathematical comparison readably', () => {
  const p = normalizePost({ ...api, title: { rendered: '5 &lt; 10' } });
  assert.ok(p.title.includes('5 < 10'));
});

// An unterminated tag (no closing `>`) survives stripTags untouched, because
// the strip regex requires a closing `>` to match. renderPostCard/mountSinglePost
// must escape at the innerHTML sink so this can never become live markup.
test('renderPostCard escapes an unterminated tag in the title instead of emitting live markup', () => {
  const p = normalizePost({ ...api, title: { rendered: '5 &lt;img src=x onerror=alert(1)' } });
  assert.equal(p.title, '5 <img src=x onerror=alert(1)');   // confirms stripTags leaves it as-is
  const html = renderPostCard(p);
  assert.ok(!html.includes('<img'), 'no live <img tag should reach the HTML output');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)'), 'the dangerous text should appear escaped');
});

test('renderPostCard escapes an unterminated tag in the excerpt instead of emitting live markup', () => {
  const p = normalizePost({ ...api, excerpt: { rendered: '5 &lt;img src=x onerror=alert(1)' } });
  assert.equal(p.excerpt, '5 <img src=x onerror=alert(1)');
  const html = renderPostCard(p);
  assert.ok(!html.includes('<img'), 'no live <img tag should reach the HTML output');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)'), 'the dangerous text should appear escaped');
});

// mountSinglePost does DOM work (document.getElementById / innerHTML) and these
// tests run under `node --test` with no DOM available, so mountSinglePost itself
// cannot be exercised here. It interpolates the title via the same `${esc(post.title)}`
// pattern as renderPostCard, so we verify the shared escaping helper directly instead.
test('esc helper neutralizes an unterminated tag (stand-in for mountSinglePost title, which needs a DOM to test directly)', () => {
  const dangerous = '5 <img src=x onerror=alert(1)';
  const escaped = esc(dangerous);
  assert.ok(!escaped.includes('<img'), 'no live <img tag should survive escaping');
  assert.equal(escaped, '5 &lt;img src=x onerror=alert(1)');
});

test('esc helper renders ordinary punctuation readably without double-escaping', () => {
  const p = normalizePost({ ...api, title: { rendered: 'Tools &amp; Toys&#8217;s Guide' } });
  assert.equal(p.title, "Tools & Toys’s Guide");
  const html = renderPostCard(p);
  assert.ok(html.includes('Tools &amp; Toys’s Guide'), 'ampersand escaped once, apostrophe shown as-is');
  assert.ok(!html.includes('&amp;amp;'), 'must not double-escape the ampersand');
});
