import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { esc, symbolSvg, renderStatus, renderReport, renderResults, renderExceptions, replaceConfirmText, refusalMessage } from '../assets/js/pid-symbols-view.js';
import { parseLibrary, searchSymbols, legendCells, buildLibrary, libraryCounts, carryOver } from '../assets/js/pid-symbols.js';
import { widgetTable, ruledTable, word } from './fixtures/symbol-table.js';

const LIB = parseLibrary(readFileSync(new URL('./fixtures/invented-symbol-library.json', import.meta.url), 'utf8')).library;
const all = searchSymbols(LIB, '');
// No markup from library text may survive: every "<" in the output must open a tag this module wrote.
const RAW_MARKUP = /<(?!\/?(?:div|span|button|input|select|option|label|details|summary|ul|li|p|h3|h4|small|br|strong|em|svg|path|rect|text)\b)/;

test('esc', () => {
  assert.equal(esc(`<a href="x" onclick='y'>&`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;');
  assert.deepEqual([esc(null), esc(undefined), esc(5)], ['', '', '5']);
});

test('symbolSvg: stored linework becomes one scalable inline SVG', () => {
  const svg = symbolSvg(LIB.symbols[0]);
  assert.match(svg, /^<svg class="sym-svg" viewBox="-2 -2 44 24"/);
  assert.match(svg, /<path d="M0 0L40 0L40 20L0 20L0 0" fill="none" stroke="currentColor" stroke-width="0.7"/);
  assert.match(symbolSvg(LIB.symbols[1]), /<path d="M0 0L30 30M30 0L0 30"/); // a break starts a new subpath
  assert.match(symbolSvg(LIB.symbols[1]), /<text x="11" y="18" font-size="8"[^>]*>M<\/text>/);
});

test('symbolSvg: fills, white masks, hairlines, and a placeholder when there is no linework', () => {
  const s = paths => symbolSvg({ w: 10, h: 10, paths });
  assert.match(s([{ segs: [0, 0, 10, 0, 10, 0, 5, 10, 5, 10, 0, 0], width: 0, stroked: false, filled: true, grey: 0 }]), /fill="currentColor" fill-rule="evenodd" stroke="none"/);
  assert.match(s([{ segs: [0, 0, 10, 0], width: 1, stroked: true, filled: true, grey: 255 }]), /fill="var\(--bg, #fff\)"/);
  assert.match(s([{ segs: [0, 0, 10, 0], width: 0, stroked: true, filled: false, grey: 0 }]), /stroke-width="0.35"/);
  assert.match(s([{ segs: [0, 0, 10, 0], width: 1, stroked: true, filled: false, grey: 128 }]), /opacity="0.5"/);
  assert.match(symbolSvg(LIB.symbols[3]), /class="sym-svg sym-svg-none"/);
});

test('symbolSvg: hostile symbols cannot inject markup or break the SVG', () => {
  const svg = symbolSvg({ w: 10, h: 10, paths: [{ segs: [0, 0, 10, 0], width: 1, stroked: true }], letters: LIB.symbols[2].letters });
  assert.ok(!/<script/i.test(svg) && svg.includes('&lt;/text&gt;'));
  assert.match(symbolSvg(LIB.symbols[2]), /sym-svg-none/); // letters alone are not linework
  const junk = symbolSvg({ w: 'x', h: NaN, paths: [{ segs: [0, 0, '"><script>', 1], width: '1" onload="x' }, null, 5], letters: [{ text: 'A', x: '"', y: {}, size: 'big' }] });
  assert.ok(!junk.includes('script') && !junk.includes('onload'));
  for (const bad of [undefined, null, 5, 'x', []]) assert.match(symbolSvg(bad), /^<svg /);
});

test('renderResults: shows the symbol, name, tag identifier, sheet, notes and aliases, all escaped', () => {
  const html = renderResults(all, { hasTags: true, editId: null });
  assert.ok(!RAW_MARKUP.test(html), 'unescaped markup from the library reached the page');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;') && html.includes('&lt;b&gt;GADGETS&lt;/b&gt;'));
  assert.ok(html.includes('ROUND WIDGET') && html.includes('Sheet 7') && html.includes('peep hole') && html.includes('Use for the rare tilting kind too.') && html.includes('RFI 12'));
  assert.match(html, /<button[^>]*data-act="next-tag"[^>]*data-code="Q"[^>]*>Next available tag: Q<\/button>/);
  assert.match(html, /data-act="edit" data-id="p1-001"/);
  assert.ok(html.includes('Manual entry') && html.includes('Simple shape'));
});

test('renderResults: the next-tag link is off without drawings, split per code, absent without a tag identifier', () => {
  const off = renderResults(all, { hasTags: false });
  assert.match(off, /data-act="next-tag"[^>]*disabled[^>]*title="Load drawings first"/);
  const two = renderResults(searchSymbols(parseLibrary('{"version":1,"symbols":[{"name":"A","tagId":"K/KX"},{"name":"B"}]}').library, ''), { hasTags: true });
  assert.deepEqual([...two.matchAll(/data-code="([^"]*)"/g)].map(m => m[1]), ['K', 'KX']);
});

test('renderResults: exceptions answer in words, an empty result says so, a long list is capped', () => {
  const html = renderResults(searchSymbols(LIB, 'gizmo'), { hasTags: true });
  assert.ok(html.includes('GIZMO') && html.includes('No palette symbol. Pending the next palette release.') && html.includes('RFI 20'));
  assert.ok(renderResults(searchSymbols(LIB, 'doohickey'), {}).includes('No palette symbol. Approved to use as a CAD block.'));
  assert.ok(renderResults([], {}).includes('No symbol matches.'));
  const many = Array.from({ length: 130 }, (_, i) => ({ kind: 'symbol', score: 0, symbol: { ...LIB.symbols[0], id: 'k' + i } }));
  const capped = renderResults(many, {});
  assert.equal((capped.match(/class="sym-card/g) || []).length, 120);
  assert.ok(capped.includes('10 more. Keep typing to narrow the list.'));
  for (const bad of [undefined, null, 5, [null, 7, {}]]) assert.doesNotThrow(() => renderResults(bad, bad));
});

test('renderResults: the card being edited shows its fields', () => {
  const html = renderResults(all, { hasTags: true, editId: 'p1-002' });
  for (const f of ['name', 'group', 'tagId', 'aliases', 'simple', 'stretch', 'note-text', 'note-ref']) assert.ok(html.includes('data-field="' + f + '"'), f);
  assert.match(html, /data-field="aliases"[^>]*value="peep hole"/);
  assert.match(html, /data-field="simple"[^>]*checked/);
  for (const a of ['apply', 'cancel', 'delete', 'add-note', 'remove-note']) assert.ok(html.includes('data-act="' + a + '"'), a);
  assert.equal((html.match(/data-field="name"/g) || []).length, 1);
});

test('renderStatus: says what is loaded, where it came from and whether it is saved', () => {
  const s = renderStatus({ library: LIB, pending: null, dirty: true, connected: true, fileStatus: 'loaded' });
  assert.ok(s.includes('4 symbols') && s.includes('Sheet 7 rev B03') && s.includes('Unsaved changes'));
  assert.ok(renderStatus({ library: null, connected: false, fileStatus: 'none' }).includes('No symbol library yet.'));
  assert.ok(renderStatus({ library: LIB, dirty: true, connected: false, fileStatus: 'none' }).includes('Connect the folder to save.'));
  assert.ok(renderStatus({ library: null, connected: true, fileStatus: 'unreadable' }).includes('could not be read'));
  for (const bad of [undefined, null, 5]) assert.doesNotThrow(() => renderStatus(bad));
});

test('renderReport: a preview states its totals and lists every row it could not read', () => {
  const t = widgetTable();
  const paths = [...ruledTable({ x0: 100, x1: 400, divider: 250, ys: [50, 80, 110, 150, 190, 230], dividerTo: 4 }), ...t.paths.slice(-3),
    ...ruledTable({ x0: 450, x1: 750, divider: 600, ys: [50, 80] })];
  const page = { page: 2, sheet: '7', rev: 'B03', ...legendCells(paths, [...t.words, word('<b>NOTE</b>', 455, 60)]) };
  const html = renderReport({ library: buildLibrary([page], 'now'), pages: [page] });
  assert.ok(html.includes('Preview. Nothing is saved yet.') && html.includes('2 symbols from 1 page'));
  assert.ok(html.includes('1 row could not be split') && html.includes('LAST WIDGET') && html.includes('no divider'));
  assert.match(html, /<details[^>]*>\s*<summary>Other ruled areas \(1\)/);
  assert.ok(html.includes('&lt;b&gt;NOTE&lt;/b&gt;') && !RAW_MARKUP.test(html));
  assert.match(html, /data-act="manual-from-row"[^>]*data-text="LAST WIDGET"[^>]*data-page="2"/);
  assert.ok(html.includes('data-act="use-pending"') && html.includes('data-act="discard-pending"'));
  assert.equal(renderReport(null), '');
  assert.ok(renderReport({ library: LIB, pages: [] }).includes('4 symbols from a library file'));
});

test('renderExceptions: lists each with its status and offers the add form', () => {
  const html = renderExceptions(LIB);
  assert.ok(html.includes('GIZMO') && html.includes('Pending the next palette release') && html.includes('DOOHICKEY') && html.includes('Approved to use as a CAD block'));
  assert.match(html, /data-act="remove-exception" data-name="GIZMO"/);
  for (const f of ['ex-name', 'ex-status', 'ex-note', 'ex-ref']) assert.ok(html.includes('data-field="' + f + '"'));
  assert.doesNotThrow(() => renderExceptions(null));
});

test('replaceConfirmText and refusalMessage', () => {
  const carry = carryOver(LIB, buildLibrary([], 'now'));
  const text = replaceConfirmText(libraryCounts(LIB), carry);
  assert.ok(text.startsWith('The library in use holds 4 symbols, 2 notes, 2 aliases and 2 exceptions.'));
  assert.ok(text.includes('could not be matched') && text.includes('VIEWING PORT'));
  assert.equal(refusalMessage('changed'), 'Someone else has saved the symbol library since you loaded it. Nothing was overwritten. Reload from the folder, then make your change again.');
  assert.equal(refusalMessage('unreadable'), 'symbol-library.json could not be read just now, so nothing was saved and nothing was overwritten. Try again in a moment.');
  assert.equal(refusalMessage('gone'), 'The symbol library file has gone from the folder since you loaded it. Nothing was saved. Reload from the folder to check, then save again.');
  assert.equal(refusalMessage('exists'), 'This folder already holds a symbol library that this session has not loaded. Nothing was overwritten.');
  assert.equal(typeof refusalMessage(null), 'string');
});

// Found drawing real extracted symbols: a symbol that is one horizontal line
// has no height, and was magnified until the line looked like a bar.
test('symbolSvg: a very thin or very small symbol is centred in a minimum view, not blown up', () => {
  const line = { segs: [42.54, 0, 0, 0], width: 1.41, stroked: true, filled: false, grey: 0 };
  assert.match(symbolSvg({ w: 42.54, h: 0, paths: [line] }), /viewBox="-2 -12 46.54 24"/);
  assert.match(symbolSvg({ w: 6, h: 6, paths: [{ ...line, segs: [0, 0, 6, 6] }] }), /viewBox="-9 -9 24 24"/);
});
