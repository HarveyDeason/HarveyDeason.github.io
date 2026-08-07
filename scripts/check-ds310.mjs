#!/usr/bin/env node
// Compares the P&ID register's function-code tables against DS310 Appendix C.
//
// NOT part of `npm test`, on purpose. It reads two things that cannot live in
// this repo: the gitignored tool, and a Wessex Water standard we have agreed
// not to commit. Run it by hand when Appendix C is reissued.
//
//   node scripts/check-ds310.mjs "<path to appendix C csv>"

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(REPO_ROOT, 'tools-src', 'pid-tag-register.html');

/** Pulls the quoted keys out of a `const NAME = { ... };` block. */
export function parseToolTable(source, name) {
  const re = new RegExp(`const ${name}\\s*=\\s*\\{([\\s\\S]*?)\\n\\s*\\};`);
  const m = re.exec(String(source || ''));
  if (!m) return {};
  const out = {};
  for (const entry of m[1].matchAll(/'([^']+)'\s*:\s*'([^']*)'/g)) out[entry[1]] = entry[2];
  return out;
}

/** Primary Function Code is column 5; the first three rows are headers. */
export function parseAppendixC(csv) {
  const seen = new Set();
  for (const line of String(csv || '').split(/\r?\n/).slice(3)) {
    if (!line.trim()) continue;
    const code = (line.split(',')[5] || '').trim();
    if (/^[A-Z]{1,6}$/.test(code)) seen.add(code);
  }
  return [...seen].sort();
}

export function compareCodes(input) {
  const cfg = input && typeof input === 'object' ? input : {};
  const toolFc = cfg.toolFc && typeof cfg.toolFc === 'object' ? cfg.toolFc : {};
  const toolDesc = cfg.toolDescriptions && typeof cfg.toolDescriptions === 'object' ? cfg.toolDescriptions : {};
  const standard = Array.isArray(cfg.standardCodes) ? cfg.standardCodes : [];
  const toolCodes = Object.keys(toolFc);
  const standardSet = new Set(standard);
  return {
    missing: standard.filter(c => !(c in toolFc)).sort(),
    extra: toolCodes.filter(c => !standardSet.has(c)).sort(),
    undescribed: toolCodes.filter(c => !(c in toolDesc)).sort(),
  };
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: node scripts/check-ds310.mjs "<path to DS310 appendix C csv>"');
    process.exitCode = 1;
    return;
  }
  let source, csv;
  try {
    source = await fs.readFile(TOOL, 'utf8');
  } catch {
    console.error(`Could not read ${TOOL}. tools-src/ is gitignored — this script only works on a machine that has it.`);
    process.exitCode = 1;
    return;
  }
  try {
    csv = await fs.readFile(csvPath, 'utf8');
  } catch {
    console.error(`Could not read the Appendix C csv at ${csvPath}.`);
    process.exitCode = 1;
    return;
  }

  const toolFc = parseToolTable(source, 'FC_LOOKUP');
  const toolDescriptions = parseToolTable(source, 'FC_DESCRIPTIONS');
  const standardCodes = parseAppendixC(csv);

  // An empty parse looks exactly like "the tool classifies nothing", which
  // would be reported as every DS310 code missing. Refuse rather than present
  // a confident wrong answer — the table format has changed if this fires.
  if (!Object.keys(toolFc).length) {
    console.error('FC_LOOKUP parsed as empty. The table format in the tool has probably changed — fix parseToolTable rather than trusting this run.');
    process.exitCode = 1;
    return;
  }
  if (!standardCodes.length) {
    console.error('No function codes found in the Appendix C csv. Check the column layout (Primary Function Code is expected in column 5).');
    process.exitCode = 1;
    return;
  }

  const r = compareCodes({ toolFc, toolDescriptions, standardCodes });
  console.log(`DS310 codes the tool does not classify (${r.missing.length}):`);
  console.log('  ' + (r.missing.join(' ') || '(none)'));
  console.log(`\nTool codes absent from DS310 (${r.extra.length}):`);
  console.log('  ' + (r.extra.join(' ') || '(none)'));
  console.log(`\nClassified codes with no description (${r.undescribed.length}):`);
  console.log('  ' + (r.undescribed.join(' ') || '(none)'));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
