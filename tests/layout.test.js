import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHeader, renderFooter } from '../assets/js/layout.js';

test('header contains all nav sections', () => {
  const html = renderHeader('tools');
  for (const label of ['Instruments','Journal','About','Contact'])
    assert.ok(html.includes(label), `missing ${label}`);
});

test('header marks the active section', () => {
  assert.ok(renderHeader('tools').includes('aria-current="page"'));
  assert.match(renderHeader('tools'), /aria-current="page"[^>]*>\s*Instruments/);
});

test('footer renders the title block name', () => {
  assert.ok(renderFooter().includes('HARVEY DEASON'));
});
