#!/usr/bin/env node
// Gate 1 for the P&ID symbol library: does the legend PDF read into symbols,
// and do the owner's searches find the right one?
//
// NOT part of `npm test`, on purpose. It reads things that cannot live in
// this repo: the client's legend sheets and the symbol library built from
// them. Run it by hand when the legend is reissued.
//
//   node scripts/check-symbol-import.mjs "<legend pdf>" [--compare <names.json>] [--out <library.json>]
//   node scripts/check-symbol-import.mjs --library <symbol-library.json> --searches <searches.json>
//
// It runs the same module code, through the same vendored pdf.js, as the
// Symbols tab in the tool.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPdf, loadVendoredPdfjs } from './pdfjs-node.mjs';
import { readLegendPage, buildLibrary, parseLibrary, serialiseLibrary, searchSymbols, normName } from '../assets/js/pid-symbols.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = [
  'Usage:',
  '  node scripts/check-symbol-import.mjs "<legend pdf>" [--compare <names.json>] [--out <library.json>]',
  '  node scripts/check-symbol-import.mjs --library <symbol-library.json> --searches <searches.json>',
].join('\n');

/** Names in `theirs` that `mine` lacks, and names `mine` has beyond `theirs`. Repeats are counted. */
export function compareNames(mine, theirs) {
  const count = list => {
    const m = new Map();
    for (const n of Array.isArray(list) ? list : []) { const k = normName(n); if (k) m.set(k, (m.get(k) || 0) + 1); }
    return m;
  };
  const a = count(mine), b = count(theirs);
  const diff = (x, y) => { const out = []; for (const [k, n] of x) for (let i = y.get(k) || 0; i < n; i++) out.push(k); return out.sort(); };
  return { missing: diff(b, a), extra: diff(a, b) };
}

/** For each { q, expect }: the 1-based place of the expected symbol in the results, 0 when absent. */
export function searchRanks(library, cases) {
  const out = [];
  for (const c of Array.isArray(cases) ? cases : []) {
    if (!c || typeof c !== 'object') continue;
    const want = normName(c.expect);
    const results = searchSymbols(library, c.q);
    const at = results.findIndex(r => r.kind === 'symbol' && normName(r.symbol.name) === want);
    out.push({ q: c.q, expect: c.expect, rank: at + 1 });
  }
  return out;
}

/** The library is client data: it must never be written inside this repository. */
export function insideRepo(filePath) {
  const rel = path.relative(REPO_ROOT, path.resolve(String(filePath)));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Read every page of a legend PDF the way the tool does. */
export async function importLegend(data) {
  const pdfjsLib = loadVendoredPdfjs();
  const doc = await openPdf(data);
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const ol = await page.getOperatorList();
    const content = await page.getTextContent();
    pages.push(readLegendPage({ fnArray: ol.fnArray, argsArray: ol.argsArray, OPS: pdfjsLib.OPS,
      viewportTransform: viewport.transform, textItems: content.items, page: n }));
  }
  return { pages, library: buildLibrary(pages, new Date().toISOString()) };
}

function fail(message) { console.error(message); process.exitCode = 1; }
async function readOr(file, encoding) { try { return await fs.readFile(file, encoding); } catch { return null; } }
function parseArgs(argv) {
  const opts = { file: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) opts[a.slice(2)] = argv[++i]; else if (!opts.file) opts.file = a;
  }
  return opts;
}

async function importMode(opts) {
  const buf = await readOr(opts.file);
  if (!buf) return fail(`Could not read the legend PDF at ${opts.file}.`);
  if (opts.out && insideRepo(opts.out)) return fail(`Refusing to write the library to ${opts.out}: that is inside this repository, and the library is client data.`);
  let result;
  try { result = await importLegend(new Uint8Array(buf)); }
  catch { return fail(`${opts.file} could not be read as a PDF.`); }

  let unsplit = 0, other = 0, empty = 0;
  for (const p of result.pages) {
    console.log(`\nPage ${p.page}  sheet ${p.sheet || '(not read)'}  rev ${p.rev || '(not read)'}  symbols ${p.rows.length}`);
    for (const t of p.tables) console.log(`  ${t.header || '(no heading)'} | ${t.tagId || '-'} | ${t.rowCount}`);
    for (const u of p.unsplit) console.log(`  NOT SPLIT  ${u.reason}: ${u.text}`);
    const otherRows = p.other.reduce((n, o) => n + o.rows.length, 0);
    console.log(`  other ruled areas: ${p.other.length} (${otherRows} rows), empty rows: ${p.emptyRows}`);
    unsplit += p.unsplit.length; other += otherRows; empty += p.emptyRows;
  }
  const total = result.library.symbols.length;
  console.log(`\nTOTAL  symbols ${total}  rows not split ${unsplit}  rows in other ruled areas ${other}  empty rows ${empty}`);
  console.log('By page: ' + result.pages.map(p => p.rows.length).join(' / '));
  // An empty read looks exactly like "nothing to report". Refuse it.
  if (!total) return fail('No symbol rows found. Either this is not a legend, or its table headings have changed.');

  if (opts.compare) {
    const raw = await readOr(opts.compare, 'utf8');
    if (raw == null) return fail(`Could not read the comparison list at ${opts.compare}.`);
    let names;
    try { names = JSON.parse(raw).map(x => (x && typeof x === 'object' ? x.name : x)); }
    catch { return fail(`${opts.compare} is not a JSON array of names.`); }
    const d = compareNames(result.library.symbols.map(s => s.name), names);
    console.log(`\nAgainst ${path.basename(opts.compare)} (${names.length} names):`);
    console.log(`  names it has that the import lacks: ${d.missing.length}`);
    for (const n of d.missing) console.log(`    ${n.length > 90 ? n.slice(0, 90) + '… (' + n.length + ' characters)' : n}`);
    console.log(`  names the import has beyond it: ${d.extra.length}`);
  }
  if (opts.out) {
    try { await fs.writeFile(opts.out, serialiseLibrary(result.library)); console.log(`\nLibrary written to ${opts.out}`); }
    catch { return fail(`Could not write ${opts.out}.`); }
  }
}

async function searchMode(opts) {
  const raw = await readOr(opts.library, 'utf8');
  if (raw == null) return fail(`Could not read the library at ${opts.library}.`);
  const parsed = parseLibrary(raw);
  if (!parsed.ok) return fail(`${opts.library} is not a readable symbol library (${parsed.error}).`);
  const casesRaw = await readOr(opts.searches, 'utf8');
  if (casesRaw == null) return fail(`Could not read the searches at ${opts.searches}.`);
  let cases;
  try { cases = JSON.parse(casesRaw); } catch { return fail(`${opts.searches} is not JSON.`); }
  const ranks = searchRanks(parsed.library, cases);
  if (!ranks.length) return fail(`${opts.searches} holds no searches. Expected [{ "q": "...", "expect": "<symbol name>" }].`);
  for (const r of ranks) console.log(`${r.rank ? String(r.rank).padStart(3) : '  -'}  ${r.q}  ->  ${r.expect}`);
  const good = ranks.filter(r => r.rank >= 1 && r.rank <= 3).length;
  console.log(`\n${good} of ${ranks.length} in the top three`);
  if (ranks.length < 20) console.log(`Gate 1 asks for twenty searches; this file has ${ranks.length}.`);
  if (good !== ranks.length) process.exitCode = 1;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.library && opts.searches) return searchMode(opts);
  if (opts.file) return importMode(opts);
  fail(USAGE);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
