import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToolCard, loadTools } from '../assets/js/tools.js';

const tool = { ref:'T-01', slug:'hydrosizer', name:'HydroSizer', blurb:'Tank sizing.', discipline:'Process', type:'Sizing', status:'live' };

test('renderToolCard links to the tool page and shows name + ref', () => {
  const html = renderToolCard(tool);
  assert.ok(html.includes('href="/tools/hydrosizer.html"'));
  assert.ok(html.includes('HydroSizer'));
  assert.ok(html.includes('T-01'));
});

test('renderToolCard escapes ampersands in names', () => {
  const html = renderToolCard({ ...tool, name:'P&ID Tag Register', slug:'pid-tag-register' });
  assert.ok(html.includes('P&amp;ID'));
  assert.ok(!html.includes('P&ID'));
});

test('loadTools validates required fields', async () => {
  const fakeFetch = async () => ({ ok:true, json: async () => ([{ ref:'X' }]) });
  await assert.rejects(() => loadTools(fakeFetch), /missing/i);
});
