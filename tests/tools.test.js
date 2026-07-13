import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToolCard, loadTools, renderSkeletonCells } from '../assets/js/tools.js';

const tool = { ref:'T-01', slug:'hydrosizer', name:'HydroSizer', blurb:'Tank sizing.', tags:['Hydraulics','BS EN 805'], discipline:'Process', type:'Sizing', status:'live' };

test('renderToolCard renders a bento cell linking to the tool page with name + number', () => {
  const html = renderToolCard(tool, 0);
  assert.ok(html.includes('class="cell'));
  assert.ok(html.includes('href="/tools/hydrosizer.html"'));
  assert.ok(html.includes('HydroSizer'));
  assert.ok(html.includes('№'));                 // mono index marker
});

test('renderToolCard renders chips from the tool tags', () => {
  const html = renderToolCard(tool, 0);
  assert.ok(html.includes('class="chip"'));
  assert.ok(html.includes('Hydraulics'));
  assert.ok(html.includes('BS EN 805'));
});

test('renderToolCard escapes ampersands in names', () => {
  const html = renderToolCard({ ...tool, name:'P&ID Tag Register', slug:'pid-tag-register', tags:[] }, 1);
  assert.ok(html.includes('P&amp;ID'));
  assert.ok(!html.includes('P&ID'));
});

test('renderSkeletonCells returns n cell placeholders with shimmer skeletons', () => {
  const html = renderSkeletonCells(3);
  assert.ok(html.includes('class="cell'));
  assert.ok((html.match(/skeleton/g) || []).length >= 3);
});

test('loadTools validates required fields', async () => {
  const fakeFetch = async () => ({ ok:true, json: async () => ([{ ref:'X' }]) });
  await assert.rejects(() => loadTools(fakeFetch), /missing/i);
});
