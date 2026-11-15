#!/usr/bin/env node
// Gate 3 for the P&ID symbol check: on a real palette-drawn sheet, does a
// standard symbol of the right family get found beside each tag, with no
// false "wrong family", in under the time limit?
//
// NOT part of `npm test`, on purpose. It reads things that cannot live in
// this repo: the client's legend sheets and drawings. Run it by hand.
//
//   node scripts/check-symbol-check.mjs "<drawing pdf>" (--legend "<legend pdf>" | --library "<symbol-library.json>")
//        [--set-tag-id "<table heading>=<code>"]... [--expect <code>=<least OK>]... [--allow-wrong <n>]
//        [--relabel <count>:<code>] [--max-seconds <n>] [--no-twin] [--grid <pitch>:<code>] [--verbose]
//
// It runs the same module code, through the same vendored pdf.js, as the
// Check symbols button in the tool. It writes no file. Tags and symbol names
// are printed only with --verbose, and that output must stay in the terminal.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPdf, loadVendoredPdfjs } from './pdfjs-node.mjs';
import { importLegend } from './check-symbol-import.mjs';
import { pagePaths, parseLibrary } from '../assets/js/pid-symbols.js';
import { extractTags } from '../assets/js/pid-core.js';
import { checkSheet, VERDICTS } from '../assets/js/pid-symbol-check.js';

const USAGE = [
  'Usage:',
  '  node scripts/check-symbol-check.mjs "<drawing pdf>" (--legend "<legend pdf>" | --library "<symbol-library.json>")',
  '       [--set-tag-id "<table heading>=<code>"]... [--expect <code>=<least OK>]... [--allow-wrong <n>]',
  '       [--relabel <count>:<code>] [--max-seconds <n>] [--no-twin] [--grid <pitch>:<code>] [--verbose]',
].join('\n');
const LABELS = { ok: 'OK', 'off-size': 'OK, off size', 'wrong-family': 'Wrong family', exception: 'Approved exception', look: 'Needs a look', 'not-checked': 'Not checked' };

/** Page 1 of a drawing: linework, text items and confirmed tags, read as the tool reads them. */
export async function readSheet(data) {
  try {
    const pdfjsLib = loadVendoredPdfjs();
    const doc = await openPdf(data);
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const ol = await page.getOperatorList();
    const textItems = (await page.getTextContent()).items;
    const paths = pagePaths(ol.fnArray, ol.argsArray, pdfjsLib.OPS, viewport.transform);
    // Tag reading does not depend on the DS310 lookup tables, which stay in the tool.
    const found = extractTags(textItems.map(i => i.str).join(' ') + '\n', { drawingName: 'CHECK', revision: '', lookups: {} });
    return { ok: true, paths, textItems, viewportTransform: viewport.transform, width: viewport.width, height: viewport.height,
      tags: found.confirmed.map(t => ({ tag: t.tag, fc: t.fc })) };
  } catch {
    return { ok: false };
  }
}

/** Give every symbol under a table heading a tag identifier, in a copy. pairs: ['<heading>=<code>']. */
export function setTagIds(library, pairs) {
  let changed = 0;
  const wanted = new Map();
  for (const pair of Array.isArray(pairs) ? pairs : []) {
    if (typeof pair !== 'string') continue;
    const at = pair.lastIndexOf('=');
    const heading = at > 0 ? pair.slice(0, at).trim() : '', code = at > 0 ? pair.slice(at + 1).trim().toUpperCase() : '';
    if (heading && code) wanted.set(heading, code);
  }
  const lib = library && typeof library === 'object' ? library : { symbols: [] };
  const symbols = (Array.isArray(lib.symbols) ? lib.symbols : []).map(s => {
    if (!s || typeof s !== 'object' || !wanted.has(s.group)) return s;
    changed++;
    return { ...s, tagId: wanted.get(s.group) };
  });
  return { library: { ...lib, symbols }, changed };
}

/** Give `count` of the OK tags, spread evenly through the list, another function code. */
export function relabel(tags, verdicts, count, toCode) {
  const list = Array.isArray(tags) ? tags : [], vs = Array.isArray(verdicts) ? verdicts : [];
  const okTags = vs.filter(v => v && v.verdict === 'ok' && v.fc !== toCode).map(v => v.tag);
  const step = Math.max(1, Math.floor(okTags.length / Math.max(1, count)));
  const changed = okTags.filter((_, i) => i % step === 0).slice(0, Math.max(0, count));
  return { tags: list.map(t => (changed.includes(t.tag) ? { ...t, fc: toCode } : t)), changed };
}

/** Counts by function code, then by verdict. */
export function tally(verdicts) {
  const out = {};
  for (const v of Array.isArray(verdicts) ? verdicts : []) {
    if (!v || typeof v !== 'object') continue;
    const row = out[v.fc] || (out[v.fc] = {});
    row[v.verdict] = (row[v.verdict] || 0) + 1;
  }
  return out;
}

function fail(message) { console.error(message); process.exitCode = 1; }
async function readOr(file, encoding) { try { return await fs.readFile(file, encoding); } catch { return null; } }
function parseArgs(argv) {
  const opts = { file: null, setTagId: [], expect: [], verbose: false, noTwin: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--verbose') opts.verbose = true;
    else if (a === '--no-twin') opts.noTwin = true;
    else if (a === '--set-tag-id') opts.setTagId.push(argv[++i]);
    else if (a === '--expect') opts.expect.push(argv[++i]);
    else if (a.startsWith('--')) opts[a.slice(2)] = argv[++i];
    else if (!opts.file) opts.file = a;
  }
  return opts;
}

async function loadLibrary(opts) {
  if (opts.library) {
    const raw = await readOr(opts.library, 'utf8');
    if (raw == null) { fail(`Could not read ${opts.library}.`); return null; }
    const parsed = parseLibrary(raw);
    if (!parsed.ok) { fail(`${opts.library} is not a readable symbol library (${parsed.error}).`); return null; }
    return parsed.library;
  }
  const buf = await readOr(opts.legend);
  if (!buf) { fail(`Could not read ${opts.legend}.`); return null; }
  // Built in memory and never written: the library is client data.
  try { return (await importLegend(new Uint8Array(buf))).library; }
  catch { fail(`${opts.legend} could not be read as a PDF.`); return null; }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.file || (!opts.legend && !opts.library)) return fail(USAGE);
  const buf = await readOr(opts.file);
  if (!buf) return fail(`Could not read ${opts.file}.`);
  let library = await loadLibrary(opts);
  if (!library) return;
  if (opts.setTagId.length) {
    const set = setTagIds(library, opts.setTagId);
    library = set.library;
    console.log(`Tag identifier set on ${set.changed} symbols.`);
    if (!set.changed) return fail('No symbol has that table heading. Check --set-tag-id.');
  }
  const sheet = await readSheet(new Uint8Array(buf));
  if (!sheet.ok) return fail(`${opts.file} could not be read as a PDF.`);

  let input = { paths: sheet.paths, textItems: sheet.textItems, viewportTransform: sheet.viewportTransform, tags: sheet.tags,
    library, lookups: {}, options: opts.noTwin ? { twin: false } : {} };
  const grid = opts.grid ? String(opts.grid).split(':') : null;
  if (grid) {
    // Stand-in places on a grid, for a drawing with no text. The checker is not told where the symbols are.
    const pitch = Number(grid[0]), code = String(grid[1] || '').toUpperCase();
    if (!(pitch > 0) || !code) return fail('--grid needs <pitch>:<code>, for example 80:V.');
    const tags = [], textItems = [];
    for (let y = pitch / 2; y < sheet.height; y += pitch) for (let x = pitch / 2; x < sheet.width; x += pitch) {
      const tag = 'GRID-' + code + '-' + String(tags.length).padStart(5, '0');
      tags.push({ tag, fc: code });
      textItems.push({ str: tag, transform: [1, 0, 0, 1, x, y], width: 0.01, height: 0.01 });
    }
    input = { ...input, tags, textItems, viewportTransform: [1, 0, 0, 1, 0, 0] };
  }

  const result = checkSheet(input);
  if (!result.ok) return fail(`The check did not run (${result.why}).`);
  console.log(`\n${path.basename(opts.file)}`);
  console.log(`  tags ${input.tags.length}, located ${result.verdicts.filter(v => v.tagBox).length}`);

  if (grid) {
    const sizes = {};
    for (const v of result.verdicts) if (v.verdict === 'ok' || v.verdict === 'off-size') sizes[v.sizePct] = (sizes[v.sizePct] || 0) + 1;
    console.log('  distinct symbols recognised, by size:');
    for (const [pct, n] of Object.entries(sizes)) console.log(`    ${n} at ${pct}%`);
    if (!Object.keys(sizes).length) console.log('    none');
  } else {
    const t = tally(result.verdicts);
    for (const [code, row] of Object.entries(t)) {
      const total = Object.values(row).reduce((a, b) => a + b, 0);
      const rest = VERDICTS.filter(k => k !== 'ok' && row[k]).map(k => `${row[k]} ${LABELS[k]}`);
      console.log(`  ${code}: ${row.ok || 0} OK of ${total}${rest.length ? ', ' + rest.join(', ') : ''}`);
    }
    console.log(`  Wrong family: ${result.counts['wrong-family']}`);
    const pct = result.checked ? Math.round(100 * result.recognised / result.checked) : 0;
    console.log(`  Recognised: ${result.recognised} of ${result.checked} checked (${pct}%)`);
    for (const e of opts.expect) {
      const [code, least] = String(e || '').split('=');
      const got = (t[String(code).toUpperCase()] || {}).ok || 0;
      if (!(got >= Number(least))) fail(`  ${String(code).toUpperCase()}: expected at least ${least} OK, got ${got}`);
    }
    const allowed = Number(opts['allow-wrong'] || 0);
    if (result.counts['wrong-family'] > allowed) fail(`  Wrong family verdicts: ${result.counts['wrong-family']}, allowed ${allowed}.`);
  }
  console.log(`  Proposals per tag: ${Math.round(result.proposals / input.tags.length)}`);
  console.log(`  Time: ${(result.ms / 1000).toFixed(1)} s`);
  if (opts['max-seconds'] && result.ms / 1000 > Number(opts['max-seconds'])) fail(`  Took longer than ${opts['max-seconds']} s.`);
  if (opts.verbose) {
    for (const v of result.verdicts) {
      if (v.verdict === 'ok' && !grid) continue;
      if (grid && v.verdict !== 'ok' && v.verdict !== 'off-size') continue;
      console.log(`    ${v.tag}  ${LABELS[v.verdict]}  ${v.symbol}${v.sizePct ? ' ' + v.sizePct + '%' : ''}${v.score ? ' ' + v.score : ''}${v.filled ? ' filled' : ''}  ${v.why}`);
    }
  }

  if (opts.relabel && !grid) {
    const [count, code] = String(opts.relabel).split(':');
    const to = String(code || '').toUpperCase();
    const changed = relabel(input.tags, result.verdicts, Number(count), to);
    if (!changed.changed.length) return fail('  Relabel: no OK tag of another code to relabel.');
    const second = checkSheet({ ...input, tags: changed.tags });
    if (!second.ok) return fail('  Relabel: the second run did not complete.');
    const by = new Map(second.verdicts.map(v => [v.tag, v.verdict]));
    const wrong = changed.changed.filter(tag => by.get(tag) === 'wrong-family').length;
    const others = result.verdicts.filter(v => !changed.changed.includes(v.tag) && by.get(v.tag) !== v.verdict).length;
    console.log(`  Relabel: ${wrong} of ${changed.changed.length} reported Wrong family`);
    console.log(`  Other verdicts changed: ${others}`);
    if (wrong < 0.9 * changed.changed.length) fail('  Relabel: fewer than 90% were reported Wrong family.');
    if (others) fail('  Relabel: a tag that was not relabelled changed its verdict.');
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
