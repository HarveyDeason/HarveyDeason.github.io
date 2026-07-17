import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToolCard, loadTools, renderSkeletonCells } from '../assets/js/tools.js';

const tool = { slug:'hydrosizer', name:'HydroSizer', blurb:'Tank sizing.', href:'/tools/hydrosizer.html', tags:['Hydraulics','Storage'], locked:true };

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
  assert.ok(html.includes('Storage'));
});

test('renderToolCard escapes ampersands in names', () => {
  const html = renderToolCard({ ...tool, name:'P&ID Tag Register', slug:'pid-tag-register', href:'/tools/pid-tag-register.html', tags:[] }, 1);
  assert.ok(html.includes('P&amp;ID'));
  assert.ok(!html.includes('P&ID'));
});

test('renderToolCard does not embed a preview thumbnail (previews live on the locked page only)', () => {
  const html = renderToolCard(tool, 0);
  assert.ok(!html.includes('/assets/img/previews/'));
});

test('renderToolCard shows a lock glyph for locked tools', () => {
  const html = renderToolCard({ ...tool, locked:true }, 0);
  assert.ok(html.includes('class="lock"'));
});

test('renderToolCard omits the lock glyph for unlocked tools', () => {
  const html = renderToolCard({ ...tool, locked:false }, 0);
  assert.ok(!html.includes('class="lock"'));
});

test('renderSkeletonCells returns n cell placeholders with shimmer skeletons', () => {
  const html = renderSkeletonCells(3);
  assert.ok(html.includes('class="cell'));
  assert.ok((html.match(/skeleton/g) || []).length >= 3);
});

test('loadTools validates required fields', async () => {
  const fakeFetch = async () => ({ ok:true, json: async () => ([{ slug:'x' }]) });
  await assert.rejects(() => loadTools(fakeFetch), /missing/i);
});

test('data/tools.json has exactly the five gated instruments, all locked', () => {
  const dataPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/tools.json');
  const tools = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

  assert.equal(tools.length, 5);

  const expectedSlugs = ['naming-validator', 'hydrosizer', 'pid-tag-register', 'steelwork-checker', 'schedule-sync'];
  assert.deepEqual(tools.map(t => t.slug), expectedSlugs);

  for (const t of tools) {
    assert.equal(t.locked, true);
    assert.ok(typeof t.name === 'string' && t.name.length > 0);
    assert.ok(typeof t.blurb === 'string' && t.blurb.length > 0);
    assert.equal(t.href, `/tools/${t.slug}.html`);
    assert.ok(Array.isArray(t.tags) && t.tags.length > 0);
  }
});
