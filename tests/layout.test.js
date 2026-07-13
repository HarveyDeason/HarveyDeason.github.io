import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHeader, renderFooter } from '../assets/js/layout.js';

test('header renders the gilt logo', () => {
  assert.ok(renderHeader('tools').includes('class="logo"'));
});

test('header contains all nav labels', () => {
  const html = renderHeader('tools');
  for (const label of ['Instruments', 'Journal', 'About', 'Get in touch'])
    assert.ok(html.includes(label), `missing ${label}`);
});

test('header renders the lamp toggle', () => {
  assert.ok(renderHeader('tools').includes('id="lamp"'));
});

test('header renders the inert search button', () => {
  assert.ok(renderHeader('tools').includes('id="palette-btn"'));
});

test('header marks the active section', () => {
  assert.ok(renderHeader('tools').includes('aria-current="page"'));
  assert.match(renderHeader('tools'), /aria-current="page"[^>]*>\s*Instruments/);
});

test('header only marks one active section', () => {
  const html = renderHeader('writing');
  assert.equal((html.match(/aria-current="page"/g) || []).length, 1);
  assert.match(html, /aria-current="page"[^>]*>\s*Journal/);
});

test('footer renders the colophon line, not the old titleblock', () => {
  const html = renderFooter();
  assert.ok(html.includes('Built by hand'));
  assert.ok(html.includes('United Kingdom'));
  assert.ok(!html.includes('titleblock'));
});
