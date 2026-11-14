#!/usr/bin/env node
// Gate 2 for the P&ID sheet pre-checks: does each PDF get the status it
// should, and does it register what today's import registers?
//
// NOT part of `npm test`, on purpose. It reads client drawings, which cannot
// live in this repo. Run it by hand over drawings kept elsewhere.
//
//   node scripts/check-sheet-prechecks.mjs <pdf> [<pdf> ...] [--expect readable,none,comments]
//
// It runs the same module code, through the same vendored pdf.js, as the
// import and the Sheets tab in the tool. It prints counts, never the tags.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPdf } from './pdfjs-node.mjs';
import { extractTags } from '../assets/js/pid-core.js';
import { readSheetFacts, assessSheet, tagsToRegister, STATUS_LABELS } from '../assets/js/pid-precheck.js';

const USAGE = 'Usage:\n  node scripts/check-sheet-prechecks.mjs <pdf> [<pdf> ...] [--expect readable,none,comments]';
const isStatus = word => Object.prototype.hasOwnProperty.call(STATUS_LABELS, word);

/** 'readable, None,comments' -> ['readable', 'none', 'comments']; null if any word is not a status. */
export function parseExpect(arg) {
  if (typeof arg !== 'string' || !arg.trim()) return null;
  const words = arg.split(',').map(w => w.trim().toLowerCase());
  return words.every(isStatus) ? words : null;
}

/** Position by position, where the statuses got differ from those expected. */
export function mismatches(statuses, expect) {
  const got = Array.isArray(statuses) ? statuses : [], want = Array.isArray(expect) ? expect : [];
  const out = [];
  for (let i = 0; i < Math.max(got.length, want.length); i++) {
    if (got[i] !== want[i]) out.push({ index: i, got: got[i] ?? null, want: want[i] ?? null });
  }
  return out;
}

/**
 * Check one PDF. `textResult` is what today's import registers; `registers`
 * is what it registers with the pre-check; `unchanged` says they are the very
 * same object. Tag counts do not depend on the DS310 lookup tables, which
 * stay in the tool, so the default options pass none.
 */
export async function checkPdf(data, extractOptions) {
  try {
    const facts = await readSheetFacts(await openPdf(data));
    if (!facts.ok) return { ok: false };
    const options = extractOptions || { drawingName: 'CHECK', revision: '', lookups: {} };
    const textResult = extractTags(facts.text, options);
    const check = assessSheet({ text: facts.text, facts, extractOptions: options });
    if (!check) return { ok: false };
    const registers = tagsToRegister(textResult, check);
    return { ok: true, check, textResult, registers, unchanged: registers === textResult };
  } catch {
    return { ok: false };
  }
}

function fail(message) { console.error(message); process.exitCode = 1; }
const counts = r => `${r.confirmed.length} confirmed, ${r.review.length} for review`;

async function main() {
  const argv = process.argv.slice(2), files = [];
  let expectArg = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--expect') expectArg = argv[++i] ?? '';
    else files.push(argv[i]);
  }
  if (!files.length) return fail(USAGE);
  const expect = expectArg === null ? null : parseExpect(expectArg);
  if (expectArg !== null && (!expect || expect.length !== files.length)) {
    return fail(`--expect needs one of readable, comments or none for each of the ${files.length} PDFs, separated by commas.`);
  }

  const statuses = [];
  for (const file of files) {
    let buf;
    try { buf = await fs.readFile(file); }
    catch { fail(`Could not read ${file}.`); statuses.push(null); continue; }
    const r = await checkPdf(new Uint8Array(buf));
    if (!r.ok) { fail(`${file} could not be read as a PDF.`); statuses.push(null); continue; }
    const c = r.check;
    statuses.push(c.status);
    console.log(`\n${path.basename(file)}`);
    console.log(`  ${STATUS_LABELS[c.status]}`);
    console.log(`  text items ${c.textItemCount}, drawing comments ${c.commentCount}, other mark-up ${c.otherAnnotationCount}`);
    console.log(`  today's import registers: ${counts(r.textResult)}`);
    console.log(`  with the pre-check it registers: ${counts(r.registers)} (${r.unchanged ? 'the same as today' : 'CHANGED: read from drawing comments'})`);
    for (const finding of c.findings) console.log(`  ${finding}`);
    // Cannot happen while the golden tests pass. Checked anyway: this is the
    // one outcome that would mean a drawing that reads today comes out different.
    if (!r.unchanged && r.textResult.confirmed.length + r.textResult.review.length > 0) {
      fail('  FAULT: this drawing reads from its text layer today and would register something different. Stop and report this.');
    }
  }

  if (expect) {
    const bad = mismatches(statuses, expect);
    console.log(`\n${files.length - bad.length} of ${files.length} as expected`);
    for (const b of bad) fail(`  ${path.basename(files[b.index])}: got ${b.got || 'no result'}, expected ${b.want}`);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
