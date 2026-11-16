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
//        [--instrument "<CODE,CODE,...>"]   function codes the tool's lookup classes as instruments
//        [--words text|comments]           where the words are: the text layer (default), or the comments
//                                          ("Readable from comments": letters drawn as strokes, text kept in comments)
//   node scripts/check-symbol-check.mjs --bubble-self-test (--legend "<legend pdf>" | --library "<symbol-library.json>") [--verbose]
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
import { checkSheet, VERDICTS, prepareSymbols } from '../assets/js/pid-symbol-check.js';
import { bubbleSummary, symbolSummary } from '../assets/js/pid-symbol-check-view.js';
import { sheetComments } from '../assets/js/pid-precheck.js';
import { commentWords, letterBoxes, removeLetterInk } from '../assets/js/pid-sheet-read.js';

const USAGE = [
  'Usage:',
  '  node scripts/check-symbol-check.mjs "<drawing pdf>" (--legend "<legend pdf>" | --library "<symbol-library.json>")',
  '       [--set-tag-id "<table heading>=<code>"]... [--expect <code>=<least OK>]... [--allow-wrong <n>]',
  '       [--relabel <count>:<code>] [--max-seconds <n>] [--no-twin] [--grid <pitch>:<code>] [--instrument "<CODE,...>"]',
  '       [--words text|comments] [--verbose]',
  '  node scripts/check-symbol-check.mjs --bubble-self-test (--legend "<legend pdf>" | --library "<symbol-library.json>") [--verbose]',
].join('\n');
const LABELS = { ok: 'OK', 'off-size': 'OK, off size', 'wrong-family': 'Wrong family', exception: 'Approved exception', look: 'Needs a look', 'not-checked': 'Not checked' };

/**
 * Page 1 of a drawing: linework, text items and confirmed tags, read as the
 * tool reads them. words: 'comments' reads the words from the page's comments
 * (as the pre-check does for a "Readable from comments" sheet) and leaves the
 * stroked letters inside them out of the linework, as the worker does.
 */
export async function readSheet(data, options) {
  try {
    const words = options && options.words === 'comments' ? 'comments' : 'text';
    const pdfjsLib = loadVendoredPdfjs();
    const doc = await openPdf(data);
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const ol = await page.getOperatorList();
    let textItems = (await page.getTextContent()).items;
    let paths = pagePaths(ol.fnArray, ol.argsArray, pdfjsLib.OPS, viewport.transform);
    let text = textItems.map(i => i.str).join(' ') + '\n', removed = 0, comments = [];
    if (words === 'comments') {
      comments = sheetComments(await page.getAnnotations()).comments;
      const kept = removeLetterInk(paths, letterBoxes(comments, viewport.transform));
      paths = kept.paths; removed = kept.removed;
      textItems = commentWords(comments);
      // The same joining as assessSheet for one page: a space between comments, a newline after the page.
      text = comments.map(c => c.text).join(' ') + '\n';
    }
    // Tag reading does not depend on the DS310 lookup tables, which stay in the tool.
    const found = extractTags(text, { drawingName: 'CHECK', revision: '', lookups: {} });
    return { ok: true, paths, textItems, viewportTransform: viewport.transform, width: viewport.width, height: viewport.height,
      pageSize: [viewport.width, viewport.height], words, comments: comments.length, removed,
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

/**
 * Each tag bubble in the library, stamped on an invented page round an
 * invented two-line tag, must come back as itself and as nothing else.
 * Nothing is written; the page exists only in memory.
 */
export function bubbleSelfTest(library, options) {
  try {
    const lib = library && typeof library === 'object' ? library : null;
    if (!lib || !Array.isArray(lib.symbols)) return [];
    const prepared = prepareSymbols(lib, options);
    return lib.symbols.filter(s => s && s.flags && s.flags.bubble === true).map(s => {
      const p = prepared.find(x => x.symbol === s);
      const ring = p ? p.ring : [0, 0, Number(s.w) || 0, Number(s.h) || 0];
      const cx = 100 + (ring[0] + ring[2]) / 2, cy = 100 + (ring[1] + ring[3]) / 2;
      const h = Math.max(2, (ring[3] - ring[1]) * 0.2), cw = h * 0.55;
      const item = (str, x, y) => ({ str, transform: [h, 0, 0, h, x, y], width: str.length * cw, height: h });
      const paths = (Array.isArray(s.paths) ? s.paths : []).map(q => ({ ...q, segs: (q.segs || []).map((v, i) => v + 100) }));
      const r = checkSheet({ paths, viewportTransform: [1, 0, 0, 1, 0, 0], library: lib, lookups: {}, options,
        textItems: [item('AA-ZZ', cx - 2.75 * cw, cy - 1.1 * h), item('0001', cx - 2.75 * cw, cy + 0.15 * h)],
        tags: [{ tag: 'AA-ZZ-0001', fc: 'ZZ' }] });
      const v = r.ok ? r.verdicts[0] : {};
      const oneOf = Array.isArray(v.oneOf) ? v.oneOf : [];
      return { name: s.name, verdict: v.verdict || 'failed', symbol: v.symbol || '', oneOf, score: v.score ?? null,
        pass: v.verdict === 'ok' && v.symbol === s.name && !oneOf.length };
    });
  } catch {
    return [];
  }
}

function fail(message) { console.error(message); process.exitCode = 1; }
// --instrument "LE,PE": these function codes are instruments, as the tool's own lookup says.
const instrumentCodes = list => Object.fromEntries(String(list || '').split(/[\s,]+/).map(c => c.trim().toUpperCase()).filter(Boolean).map(c => [c, 'instrument']));
async function readOr(file, encoding) { try { return await fs.readFile(file, encoding); } catch { return null; } }
function parseArgs(argv) {
  const opts = { file: null, setTagId: [], expect: [], verbose: false, noTwin: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--verbose') opts.verbose = true;
    else if (a === '--bubble-self-test') opts.selfTest = true;
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
  if (opts.selfTest) {
    if (!opts.legend && !opts.library) return fail(USAGE);
    const lib = await loadLibrary(opts);
    if (!lib) return;
    const r = bubbleSelfTest(lib);
    if (!r.length) return fail('The library has no tag bubbles to test. Import a legend with a tag bubble table.');
    if (opts.verbose) for (const x of r) console.log(`${x.pass ? 'PASS' : 'FAIL'}  ${x.name}  ->  ${x.symbol || x.verdict}${x.oneOf.length ? ' (one of ' + x.oneOf.join(', ') + ')' : ''}  ${x.score ?? ''}`);
    const good = r.filter(x => x.pass).length;
    console.log(`${good} of ${r.length} identified as themselves`);
    if (good < r.length) fail(`${r.length - good} tag bubble(s) not identified as themselves.`);
    return;
  }
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
  const words = opts.words === 'comments' ? 'comments' : 'text';
  if (opts.words && opts.words !== 'comments' && opts.words !== 'text') return fail('--words is text or comments.');
  const sheet = await readSheet(new Uint8Array(buf), { words });
  if (!sheet.ok) return fail(`${opts.file} could not be read as a PDF.`);
  if (words === 'comments') console.log(`Words from ${sheet.comments} comments; ${sheet.removed} letter paths left out of the linework.`);

  let input = { paths: sheet.paths, textItems: sheet.textItems, viewportTransform: sheet.viewportTransform, tags: sheet.tags, pageSize: sheet.pageSize,
    library, lookups: { fc: instrumentCodes(opts.instrument) }, options: opts.noTwin ? { twin: false } : {} };
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
    const bubbled = result.verdicts.filter(v => v.bubble && (v.verdict === 'ok' || v.verdict === 'off-size')).length;
    if (bubbled) console.log(opts.verbose ? `  ${bubbleSummary(result)}` : `  Tag bubbles recognised: ${bubbled}`);
    for (const e of opts.expect) {
      const [code, least] = String(e || '').split('=');
      const got = (t[String(code).toUpperCase()] || {}).ok || 0;
      if (!(got >= Number(least))) fail(`  ${String(code).toUpperCase()}: expected at least ${least} OK, got ${got}`);
    }
    const allowed = Number(opts['allow-wrong'] || 0);
    if (result.counts['wrong-family'] > allowed) fail(`  Wrong family verdicts: ${result.counts['wrong-family']}, allowed ${allowed}.`);
  }
  const symbols = Array.isArray(result.symbols) ? result.symbols : [];
  const withTags = symbols.filter(s => s.tag).length;
  console.log(`  symbols found ${symbols.length}, with tags ${withTags}, without tags ${symbols.length - withTags}`);
  console.log(`  Title block skipped: ${result.skipped ? 'yes, ' + Math.round(result.skipped[2] - result.skipped[0]) + ' x ' + Math.round(result.skipped[3] - result.skipped[1]) + ' pt' : 'no'}`);
  if (opts.verbose) {
    console.log(`  ${symbolSummary(result)}`);
    const byName = new Map();
    for (const s of symbols) { const k = s.name + (s.tag ? '' : ' (no tag)'); byName.set(k, (byName.get(k) || 0) + 1); }
    for (const [k, n] of [...byName].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) console.log(`    ${n}  ${k}`);
    for (const s of symbols.filter(x => !x.tag)) {
      console.log(`    untagged  ${s.name}  ${s.sizePct}%  ${s.score}  [${s.box.map(v => Math.round(v * 10) / 10).join(', ')}]${s.oneOf.length ? '  one of ' + s.oneOf.join(' | ') : ''}`);
    }
  }
  console.log(`  Proposals per tag: ${input.tags.length ? Math.round(result.proposals / input.tags.length) : 0}`);
  console.log(`  Time: ${(result.ms / 1000).toFixed(1)} s`);
  if (opts['max-seconds'] && result.ms / 1000 > Number(opts['max-seconds'])) fail(`  Took longer than ${opts['max-seconds']} s.`);
  if (opts.verbose) {
    for (const v of result.verdicts) {
      if (v.verdict === 'ok' && !grid) continue;
      if (grid && v.verdict !== 'ok' && v.verdict !== 'off-size') continue;
      console.log(`    ${v.tag}  ${LABELS[v.verdict]}  ${v.symbol}${v.sizePct ? ' ' + v.sizePct + '%' : ''}${v.score ? ' ' + v.score : ''}${v.filled ? ' filled' : ''}  ${v.why}${v.closest ? 'closest ' + v.closest.symbol + ' ' + Math.round(v.closest.score * 100) + '%' : ''}`);
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
