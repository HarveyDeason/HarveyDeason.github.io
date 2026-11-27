#!/usr/bin/env node
// Timing harness for the P&ID tool: where does the time go, per sheet and per stage?
//
// NOT part of `npm test`, on purpose. It reads client drawings and the client's
// legend, which cannot live in this repo. Run it by hand.
//
//   node scripts/time-pid-pipeline.mjs --manifest <sheets.json> [--only A,B,H1] [--report] [--no-check]
//        [--verdicts <dir>] [--compare <dir>] [--json <file>] [--runs <n>]
//   node scripts/time-pid-pipeline.mjs --binder <multi-page pdf>     times a binder import: open, split, name pages, pre-check each part
//
// manifest (a JSON file OUTSIDE this repository; it holds file names):
//   { "legend": "<legend pdf>", "operators": ["<table heading>"],
//     "sheets": { "<label>": { "pdf": "<path>", "instrument": "PE,PT" } , ... } }
//
// Per sheet, in milliseconds (everything the browser tool does, in the order it does it):
//   import-text   open the PDF and read every page's text            (extractTextFromPDF)
//   import-facts  open it AGAIN and read the pre-check facts          (sheetFactsFor = readSheetFacts)
//   assess        assessSheet over those facts
//   open          open it a THIRD time for the symbol check             (reportCheckSheet)
//   ops           page.getOperatorList()
//   textc         page.getTextContent()   (a second text read of page 1)
//   annot         page.getAnnotations()
//   clone         structured clone of the worker payload, and its size
//   spawn         start the worker and load its modules
//   worker        message sent -> result back (clone in and out, paths, check)
//     in it: check (result.ms) and the first-message time of each stage
//   --report      also runs the real runReport over all the sheets, as the Export report button does
//                 (--lanes <n>: that many sheets at once, as the tool does; it uses cores/2 - 1, at most 4)
//
// --verdicts <dir> writes each sheet's whole result (no timings) there, with a digest;
// --compare <dir>  re-reads those and says, per sheet, whether the verdicts, symbols and shapes
// are identical. Keep that directory outside the repository: it holds tags and symbol names.
// Both runs ignore the tool's 120 s limit (they send options.timeLimitMs), so the answer does not depend on how
// fast the machine is. A plain timing run keeps the limit, as the browser does, and says which sheets hit it.
//
// Output on screen: counts and times only. Never drawing numbers, tags or text.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import v8 from 'node:v8';
import { Worker } from 'node:worker_threads';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openPdf, loadVendoredPdfjs } from './pdfjs-node.mjs';
import { importLegend } from './check-symbol-import.mjs';
import { setOperators } from './check-symbol-check.mjs';
import { readSheetFacts, assessSheet, sheetComments } from '../assets/js/pid-precheck.js';
import { runReport } from '../assets/js/pid-symbol-report-run.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER_URL = pathToFileURL(path.resolve(HERE, '..', 'assets', 'js', 'pid-symbol-check-worker.js')).href;
const SHIM = path.resolve(HERE, 'time-pid-worker-shim.mjs');
const REPO_ROOT = path.resolve(HERE, '..');

const USAGE = 'Usage:\n  node scripts/time-pid-pipeline.mjs --manifest <sheets.json> [--only A,B] [--report] [--no-check] [--verdicts <dir>] [--compare <dir>] [--json <file>] [--runs <n>]';
const ms = (t0) => Math.round((performance.now() - t0) * 10) / 10;
const timed = async fn => { const t = performance.now(); const v = await fn(); return [v, ms(t)]; };
const insideRepo = file => { const rel = path.relative(REPO_ROOT, path.resolve(file)); return rel === '' || !(rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)); };
const fcLookup = inst => Object.fromEntries(String(inst || '').split(/[\s,]+/).map(c => c.trim().toUpperCase()).filter(Boolean).map(c => [c, 'instrument']));
const wordsFor = status => (status === 'comments' || status === 'printed' ? status : 'text');

/** One worker per sheet, as the tool makes one; resolves with { result, spawn, wall, stageAt }. */
export function runInWorker(payload) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const w = new Worker(SHIM, { workerData: { workerUrl: WORKER_URL } });
    let tReady = 0, tSent = 0;
    const stageAt = {};
    w.on('error', e => { w.terminate(); reject(e); });
    w.on('message', m => {
      if (m.type === 'ready') { tReady = performance.now(); tSent = tReady; w.postMessage(payload); return; }
      const at = ms(tSent);
      if (m.type === 'progress') {
        const k = m.stage || 'tag';
        if (!stageAt[k]) stageAt[k] = { first: at, last: at, n: 0 };
        stageAt[k].last = at; stageAt[k].n++;
        return;
      }
      const wall = at;
      w.terminate();
      resolve({ result: m.result, spawn: Math.round((tReady - t0) * 10) / 10, wall, stageAt });
    });
  });
}

/** What the tool reads for the check, timed step by step (reportCheckSheet / runSymbolCheck). */
export async function readForCheck(bytes, status) {
  const pdfjsLib = loadVendoredPdfjs();
  const t = {};
  let pdf;
  [pdf, t.open] = await timed(() => openPdf(bytes.slice(0)));
  const page = await pdf.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  let ol, content, annotations = [];
  [ol, t.ops] = await timed(() => page.getOperatorList());
  [content, t.textc] = await timed(() => page.getTextContent());
  [annotations, t.annot] = await timed(async () => { try { return await page.getAnnotations(); } catch { return []; } });
  const read = sheetComments(annotations);
  const payload = { fnArray: ol.fnArray, argsArray: ol.argsArray, OPS: pdfjsLib.OPS, viewportTransform: vp.transform, textItems: content.items,
    words: wordsFor(status), comments: read.comments, pageSize: [vp.width, vp.height] };
  const info = { pages: pdf.numPages, ops: ol.fnArray.length, textItems: content.items.length, comments: read.comments.length };
  try { await pdf.destroy(); } catch { /* nothing left */ }
  return { payload, t, info, viewportTransform: Array.from(vp.transform) };
}

/** The pre-check as the tool makes it: text read, then a second open for the facts. */
export async function precheckLikeTool(bytes, extractOptions) {
  const t = {};
  const [text] = await timed(async () => {
    t.importText = 0;
    const t0 = performance.now();
    const pdf = await openPdf(bytes.slice(0));
    let s = '';
    for (let p = 1; p <= pdf.numPages; p++) { const page = await pdf.getPage(p); s += (await page.getTextContent()).items.map(i => i.str).join(' ') + '\n'; }
    try { await pdf.destroy(); } catch { /* nothing left */ }
    t.importText = ms(t0);
    return s;
  });
  const t1 = performance.now();
  let facts = null;
  const pdf = await openPdf(bytes.slice(0));
  try { facts = await readSheetFacts(pdf, { OPS: loadVendoredPdfjs().OPS }); } finally { try { await pdf.destroy(); } catch { /* nothing left */ } }
  t.importFacts = ms(t1);
  t.textSame = !!(facts && facts.ok && facts.text === text);   // the single-read import relies on this
  const [check, a] = await timed(async () => assessSheet({ text, facts: facts && facts.ok ? facts : null, extractOptions }));
  t.assess = a;
  return { check, t };
}

// ---- snapshots: the answer, with no timings -----------------------------------------------------------------
const stripTimes = (k, v) => (k === 'ms' ? undefined : v);
export function canonical(result) { return JSON.stringify(result, stripTimes); }
export const digest = result => crypto.createHash('sha256').update(canonical(result)).digest('hex').slice(0, 16);

/** Per sheet: same or different, and for different, how many entries of each list differ (counts only). */
export function compareResults(a, b) {
  const out = { same: canonical(a) === canonical(b), lists: {} };
  if (out.same) return out;
  for (const key of ['verdicts', 'symbols', 'shapes']) {
    const x = Array.isArray(a && a[key]) ? a[key] : [], y = Array.isArray(b && b[key]) ? b[key] : [];
    const sx = new Map(), sy = new Map();
    for (const e of x) { const k = JSON.stringify(e, stripTimes); sx.set(k, (sx.get(k) || 0) + 1); }
    for (const e of y) { const k = JSON.stringify(e, stripTimes); sy.set(k, (sy.get(k) || 0) + 1); }
    let onlyA = 0, onlyB = 0;
    for (const [k, n] of sx) onlyA += Math.max(0, n - (sy.get(k) || 0));
    for (const [k, n] of sy) onlyB += Math.max(0, n - (sx.get(k) || 0));
    out.lists[key] = { before: x.length, after: y.length, onlyBefore: onlyA, onlyAfter: onlyB };
  }
  return out;
}

const fmt = (n, w = 7) => String(n === undefined || n === null ? '-' : n).padStart(w);
function median(list) { const v = list.filter(Number.isFinite).sort((p, q) => p - q); return v.length ? v[Math.floor(v.length / 2)] : null; }

async function loadManifest(file) {
  const m = JSON.parse(await fs.readFile(file, 'utf8'));
  if (!m || typeof m !== 'object' || !m.sheets || typeof m.sheets !== 'object' || !m.legend) throw new Error('manifest needs "legend" and "sheets"');
  return m;
}

/** A multi-page PDF imported as the tool imports it: open, split into one-page PDFs, name each page, pre-check each part. Counts and times only. */
async function binderRun(file) {
  const B = await import('../assets/js/pid-binder.js');
  const { loadVendoredUmd } = await import('./pdfjs-node.mjs');
  const PDFLib = loadVendoredUmd('pdf-lib.min.js');
  const bytes = new Uint8Array(await fs.readFile(file));
  const t = {};
  let pdf;
  [pdf, t.open] = await timed(() => openPdf(bytes.slice(0)));
  const pages = pdf.numPages;
  let parts;
  [parts, t.split] = await timed(() => B.splitPdfPages(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), PDFLib));
  let named = 0;
  const t0 = performance.now();
  for (let n = 1; n <= pages; n++) { try { if (B.titleBlockNumber(await B.pageNumberItems(await pdf.getPage(n)))) named++; } catch { /* unnamed */ } }
  t.names = ms(t0);
  try { await pdf.destroy(); } catch { /* nothing left */ }
  const t1 = performance.now();
  let checked = 0;
  for (const part of parts || []) {
    const p = await precheckLikeTool(new Uint8Array(part), { drawingName: 'X', revision: '', lookups: { fc: {} } });
    if (p.check) checked++;
  }
  t.precheck = ms(t1);
  console.log(`binder: ${pages} pages, ${(parts || []).length} parts, ${named} named from their title blocks, ${checked} pre-checked`);
  console.log(`  open ${t.open} ms, split ${t.split} ms, name pages ${t.names} ms, pre-check parts ${t.precheck} ms (${Math.round(t.precheck / Math.max(1, pages))} ms a page)`);
}

async function main() {
  const argv = process.argv.slice(2), opt = { runs: 1 };
  if (argv[0] === '--binder') { await binderRun(argv[1]); return; }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--report') opt.report = true;
    else if (a === '--no-check') opt.noCheck = true;
    else if (a.startsWith('--')) opt[a.slice(2)] = argv[++i];
  }
  if (!opt.manifest) { console.error(USAGE); process.exitCode = 1; return; }
  for (const k of ['verdicts', 'json']) if (opt[k] && insideRepo(opt[k])) { console.error(`--${k} must name a place outside the repository (it holds drawing data).`); process.exitCode = 1; return; }
  const manifest = await loadManifest(opt.manifest);
  let labels = Object.keys(manifest.sheets);
  if (opt.only) labels = String(opt.only).split(',').map(s => s.trim()).filter(l => labels.includes(l));
  const runs = Math.max(1, Number(opt.runs) || 1);

  const [lib0, tLib] = await timed(async () => (await importLegend(new Uint8Array(await fs.readFile(manifest.legend)))).library);
  const library = setOperators(lib0, manifest.operators || []).library;
  console.log(`library: ${library.symbols.length} symbols, imported in ${tLib} ms`);
  if (opt.verdicts) await fs.mkdir(opt.verdicts, { recursive: true });
  const unlimited = !!(opt.verdicts || opt.compare);

  const rows = [], keep = {};
  for (const label of labels) {
    const spec = manifest.sheets[label];
    const bytes = new Uint8Array(await fs.readFile(spec.pdf));
    keep[label] = { bytes, spec };
    const row = { label, kb: Math.round(bytes.length / 1024) };
    const extractOptions = { drawingName: 'CHECK', revision: '', lookups: { fc: fcLookup(spec.instrument) } };
    const pre = await precheckLikeTool(bytes, extractOptions);
    row.status = pre.check ? pre.check.status : 'failed';
    row.tags = pre.check ? pre.check.tagCount : 0;
    row.textSame = pre.t.textSame;
    row.importText = pre.t.importText; row.importFacts = pre.t.importFacts; row.assess = pre.t.assess;
    if (!pre.check || !['readable', 'comments', 'printed'].includes(pre.check.status)) { rows.push(row); continue; }
    const tags = pre.check.result.confirmed.map(t => ({ tag: t.tag, fc: t.fc }));
    const rd = await readForCheck(bytes, row.status);
    Object.assign(row, { open: rd.t.open, ops: rd.t.ops, textc: rd.t.textc, annot: rd.t.annot, opCount: rd.info.ops, textItems: rd.info.textItems, comments: rd.info.comments });
    const msg = { ...rd.payload, tags, library, lookups: { fc: fcLookup(spec.instrument) }, ...(unlimited ? { options: { timeLimitMs: 3.6e6 } } : {}) };
    const [ser, tClone] = await timed(() => structuredClone(msg));
    row.clone = tClone; row.cloneKb = Math.round(v8.serialize(ser).length / 1024);
    row.libKb = Math.round(v8.serialize(library).length / 1024);
    if (!opt.noCheck) {
      const checks = [], walls = [], spawns = [];
      let last = null;
      for (let r = 0; r < runs; r++) {
        const w = await runInWorker(msg);
        if (!w.result || !w.result.ok) { row.failed = true; break; }
        checks.push(w.result.ms); walls.push(w.wall); spawns.push(w.spawn); last = w;
      }
      if (last) {
        row.check = median(checks); row.worker = median(walls); row.spawn = median(spawns);
        row.stageAt = last.stageAt;
        row.verdicts = last.result.verdicts.length; row.shapes = Array.isArray(last.result.shapes) ? last.result.shapes.length : 0;
        row.symbols = Array.isArray(last.result.symbols) ? last.result.symbols.length : 0;
        row.timedOut = last.result.timedOut === true;
        row.digest = digest(last.result);
        if (opt.verdicts) await fs.writeFile(path.join(opt.verdicts, label + '.json'), canonical(last.result));
        if (opt.compare) {
          try {
            const before = JSON.parse(await fs.readFile(path.join(opt.compare, label + '.json'), 'utf8'));
            row.compare = compareResults(before, JSON.parse(canonical(last.result)));
          } catch { row.compare = { same: false, lists: {}, missing: true }; }
        }
      }
    }
    rows.push(row);
    console.log(`  ${label}: ${row.status}, ${row.tags} tags, ${row.opCount ?? '-'} ops; import ${Math.round(row.importText + row.importFacts + row.assess)} ms, check ${row.worker ?? '-'} ms`);
  }

  // ---- the table ---------------------------------------------------------------------------------------
  console.log('\nper stage, milliseconds');
  const head = ['sheet', 'KB', 'status', 'tags', 'imp-text', 'imp-facts', 'assess', 'open', 'ops', 'textc', 'annot', 'clone', 'spawn', 'worker', 'check', 'limit'];
  console.log(head.map((h, i) => (i === 2 ? h.padEnd(10) : h.padStart(i === 0 ? 5 : 8))).join(' '));
  for (const r of rows) {
    console.log([r.label.padStart(5), fmt(r.kb, 8), String(r.status).padEnd(10), fmt(r.tags, 8), fmt(r.importText, 8), fmt(r.importFacts, 8), fmt(r.assess, 8), fmt(r.open, 8), fmt(r.ops, 8),
      fmt(r.textc, 8), fmt(r.annot, 8), fmt(r.clone, 8), fmt(r.spawn, 8), fmt(r.worker, 8), fmt(r.check, 8), fmt(r.timedOut === undefined ? '-' : r.timedOut ? 'HIT' : 'no', 8)].join(' '));
  }
  const sum = k => rows.reduce((n, r) => n + (Number.isFinite(r[k]) ? r[k] : 0), 0);
  console.log(`\nfacts text identical to the import's own text read: ${rows.filter(r => r.textSame).length} of ${rows.length} sheets`);
  console.log(`per sheet, mean: pre-check ${Math.round((sum('importText') + sum('importFacts') + sum('assess')) / rows.length)} ms, check read ${Math.round((sum('open') + sum('ops') + sum('textc') + sum('annot')) / rows.length)} ms, worker ${Math.round(sum('worker') / rows.length)} ms`);
  console.log('worker payload: ' + rows.filter(r => r.cloneKb).map(r => `${r.label} ${r.cloneKb} KB (library ${r.libKb} KB)`).join('; '));
  console.log('first progress message by stage (ms after send; count): ' + rows.filter(r => r.stageAt).map(r => r.label + ' ' + Object.entries(r.stageAt).map(([k, v]) => `${k} ${v.first}-${v.last} x${v.n}`).join(', ')).join(' | '));
  if (opt.compare) {
    console.log('\nverdicts against the snapshot:');
    for (const r of rows.filter(x => x.compare)) {
      const c = r.compare;
      console.log(`  ${r.label}: ${c.same ? 'IDENTICAL' : 'DIFFERENT' + (c.missing ? ' (no snapshot)' : ' ' + JSON.stringify(c.lists))}`);
      if (!c.same) process.exitCode = 1;
    }
  }

  // ---- the report run, as Export report does it --------------------------------------------------------------
  let reportRow = null;
  if (opt.report) {
    const sheets = labels.map(l => ({ drawing: l, rev: 'X', family: '' }));
    const per = {};
    const deps = {
      loadPdf: async d => keep[d].bytes,
      precheck: async (d, r, bytes) => {
        const t0 = performance.now();
        const p = await precheckLikeTool(bytes, { drawingName: d, revision: r, lookups: { fc: fcLookup(keep[d].spec.instrument) } });
        (per[d] ||= {}).precheck = ms(t0);
        if (!p.check) return null;
        return { status: p.check.status, tags: p.check.result.confirmed.map(t => ({ tag: t.tag, fc: t.fc })) };
      },
      check: async (bytes, tags, onTags, status) => {
        const d = Object.keys(keep).find(k => keep[k].bytes === bytes);
        const t0 = performance.now();
        const rd = await readForCheck(bytes, status);
        (per[d] ||= {}).read = ms(t0);
        const t1 = performance.now();
        const w = await runInWorker({ ...rd.payload, tags, library, lookups: { fc: fcLookup(keep[d].spec.instrument) } });
        per[d].worker = ms(t1);
        return { result: w.result, viewportTransform: rd.viewportTransform, pages: rd.info.pages, pageSize: rd.payload.pageSize };
      },
    };
    const t0 = performance.now();
    const lanes = Math.max(1, Number(opt.lanes) || 1);
    const out = await runReport({ sheets, signal: { stopped: false }, deps, lanes });
    const total = ms(t0);
    const checked = out.outcomes.filter(o => o.status === 'checked').length;
    reportRow = { sheets: sheets.length, checked, total, perSheet: Math.round(total / sheets.length) };
    console.log(`\nreport run over ${sheets.length} sheets, ${lanes} at a time: ${checked} checked, ${Math.round(total)} ms in all, ${reportRow.perSheet} ms per sheet`);
    console.log(`  of which pre-check ${Math.round(Object.values(per).reduce((n, p) => n + (p.precheck || 0), 0))} ms, read for check ${Math.round(Object.values(per).reduce((n, p) => n + (p.read || 0), 0))} ms, worker ${Math.round(Object.values(per).reduce((n, p) => n + (p.worker || 0), 0))} ms`);
  }
  if (opt.json) await fs.writeFile(opt.json, JSON.stringify({ when: new Date().toISOString(), library: { symbols: library.symbols.length, importMs: tLib }, rows, report: reportRow }, null, 1));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
