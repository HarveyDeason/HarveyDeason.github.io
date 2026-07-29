import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePost, renderPostCard, renderSkeletonRows, esc, fetchPosts } from '../assets/js/wordpress.js';

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

// --- excerpt normalisation: block-boundary spacing + "Continue reading" tail ---

test('normalizePost inserts a single space at a paragraph boundary instead of running words together', () => {
  const p = normalizePost({ ...api, excerpt: { rendered: '<p>One.</p><p>Two.</p>' } });
  assert.equal(p.excerpt, 'One. Two.');
});

test('normalizePost strips a trailing WordPress "Continue reading" read-more clause, preserving the sentence before it', () => {
  const p = normalizePost({
    ...api,
    excerpt: {
      rendered: '<p>This is the real sentence.</p><a class="more-link">Continue reading "Weekly Waffle #12 (Silence is Golden)"</a>'
    }
  });
  assert.equal(p.excerpt, 'This is the real sentence.');
});

test('normalizePost strips a trailing "Continue reading" clause wrapped in curly quotes', () => {
  const p = normalizePost({
    ...api,
    excerpt: {
      rendered: '<p>This is the real sentence.</p><a class="more-link">Continue reading “Weekly Waffle #12 (Silence is Golden)”</a>'
    }
  });
  assert.equal(p.excerpt, 'This is the real sentence.');
});

test('normalizePost does not truncate an excerpt that legitimately contains "continue reading" mid-sentence', () => {
  const p = normalizePost({
    ...api,
    excerpt: { rendered: '<p>You should continue reading this book before bed, it only gets better.</p>' }
  });
  assert.equal(p.excerpt, 'You should continue reading this book before bed, it only gets better.');
});

// Mirrors the existing unterminated-tag tests above: with no closing `>`,
// stripTags' tag-strip regex can't match, so the decoded `<` legitimately
// survives in the plain-text field. The security guarantee is that it can
// never reach the DOM as live markup — renderPostCard must escape it at the
// interpolation sink. This confirms decode-then-strip ordering (and the
// space-not-empty tag replacement) hasn't reopened that hole for excerpts.
test('normalizePost excerpt regression: entity-encoded unterminated markup still does not survive as live HTML', () => {
  const p = normalizePost({ ...api, excerpt: { rendered: '5 &lt;img src=x onerror=alert(1)' } });
  assert.equal(p.excerpt, '5 <img src=x onerror=alert(1)');
  const html = renderPostCard(p);
  assert.ok(!html.includes('<img'), 'no live <img tag should reach the HTML output');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)'), 'the dangerous text should appear escaped');
});

test('normalizePost excerpt regression: ampersand and apostrophe render readably without double-escaping', () => {
  const p = normalizePost({ ...api, excerpt: { rendered: '<p>Tools &amp; Toys&#8217;s Guide</p>' } });
  assert.equal(p.excerpt, "Tools & Toys’s Guide");
  const html = renderPostCard(p);
  assert.ok(html.includes('Tools &amp; Toys’s Guide'), 'ampersand escaped once, apostrophe shown as-is');
  assert.ok(!html.includes('&amp;amp;'), 'must not double-escape the ampersand');
});

// —— fetchPosts pagination ——
const page = (n, headers = {}) => ({
  ok: true,
  headers: { get: k => headers[k] ?? null },
  json: async () => Array.from({ length: n }, (_, i) => ({ ...api, id: i, slug: 's' + i }))
});

test('fetchPosts without all:true requests a single page at perPage', async () => {
  const urls = [];
  const fetchFn = async u => { urls.push(u); return page(3); };
  const posts = await fetchPosts({ perPage: 3, fetchFn });
  assert.equal(urls.length, 1);
  assert.ok(urls[0].includes('per_page=3'));
  assert.equal(posts.length, 3);
});

test('fetchPosts with all:true follows every page reported by X-WP-TotalPages', async () => {
  const urls = [];
  const fetchFn = async u => {
    urls.push(u);
    return page(100, { 'X-WP-TotalPages': '3' });
  };
  const posts = await fetchPosts({ all: true, fetchFn });
  assert.equal(urls.length, 3);                       // page 1 + pages 2 and 3
  assert.ok(urls[0].includes('per_page=100'));
  assert.ok(urls[1].includes('page=2'));
  assert.ok(urls[2].includes('page=3'));
  assert.equal(posts.length, 300);
});

test('fetchPosts with all:true stops at one page when there is only one', async () => {
  let calls = 0;
  const fetchFn = async () => { calls++; return page(37, { 'X-WP-TotalPages': '1' }); };
  const posts = await fetchPosts({ all: true, fetchFn });
  assert.equal(calls, 1);
  assert.equal(posts.length, 37);
});

test('fetchPosts with all:true keeps the pages it already has if a later one fails', async () => {
  let calls = 0;
  const fetchFn = async () => {
    calls++;
    return calls === 1 ? page(100, { 'X-WP-TotalPages': '2' }) : { ok: false, status: 500 };
  };
  const posts = await fetchPosts({ all: true, fetchFn });
  assert.equal(posts.length, 100);                    // partial archive beats an empty page
});
