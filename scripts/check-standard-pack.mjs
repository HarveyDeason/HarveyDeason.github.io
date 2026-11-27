// Reads a filled-in Standard Pack PDF the way the tool page will, and says what it holds.
//   node scripts/check-standard-pack.mjs <pack.pdf> [--page tools-src/pid-tag-register.html]
// Prints counts, problems, and what is recorded but not applied yet; no table contents.
// With --page it also compares the pack's tables and settings with the ones hard-coded in that page (and the check's defaults) and says
// whether importing the pack would change anything: it must say IDENTICAL for a pack that is meant to reproduce today's behaviour.
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const args = process.argv.slice(2);
const pageAt = args.indexOf('--page');
const pagePath = pageAt >= 0 ? args.splice(pageAt, 2)[1] : null;
const file = args[0];
if (!file) { console.error('usage: node scripts/check-standard-pack.mjs <pack.pdf> [--page tools-src/pid-tag-register.html]'); process.exit(2); }

const here = pathToFileURL(path.resolve(import.meta.dirname, '..') + path.sep).href;
const { openPdf } = await import(here + 'scripts/pdfjs-node.mjs');
const P = await import(here + 'assets/js/pid-standard-pack.js');
const { CHECK_DEFAULTS } = await import(here + 'assets/js/pid-symbol-check.js');
const { PIPE_MATERIAL_CODES } = await import(here + 'assets/js/pid-core.js');

const pdf = await openPdf(new Uint8Array(await fs.readFile(file)));
const pages = [];
for (let n = 1; n <= pdf.numPages; n++) pages.push(await (await pdf.getPage(n)).getAnnotations());
const fields = P.fieldsFromAnnotations(pages);
const r = P.packFromFields(fields);
console.log(`${file}: ${pdf.numPages} pages, ${Object.keys(fields).length} filled fields`);
console.log(r.ok ? 'READS OK' : 'CANNOT BE IMPORTED');
console.log('counts:', JSON.stringify(r.counts));
for (const p of r.problems) console.log(`  ${p.level.toUpperCase()}  ${p.field}  ${p.message}`);
if (r.notApplied.length) console.log('recorded, not applied yet:', r.notApplied.join(', '));
if (r.pack) {
  const fp = await P.fingerprint(r.pack);
  console.log(P.packStamp(r.pack, fp).line);
}

let differences = 0;
const say = s => { differences++; console.log('  DIFFERENT  ' + s); };
const sameMap = (label, mine, theirs) => {
  const a = Object.keys(mine).sort(), b = Object.keys(theirs).sort();
  const onlyPack = a.filter(k => !(k in theirs)), onlyPage = b.filter(k => !(k in mine)), changed = a.filter(k => k in theirs && String(mine[k]) !== String(theirs[k]));
  if (onlyPack.length) say(`${label}: ${onlyPack.length} in the pack but not in the tool: ${onlyPack.join(', ')}`);
  if (onlyPage.length) say(`${label}: ${onlyPage.length} in the tool but not in the pack: ${onlyPage.join(', ')}`);
  if (changed.length) say(`${label}: ${changed.length} with a different value: ${changed.join(', ')}`);
  console.log(`  ${label}: pack ${a.length}, tool ${b.length}`);
};
if (pagePath && r.pack) {
  console.log(`\nAgainst ${pagePath} (what the tool has hard-coded today):`);
  const page = await fs.readFile(pagePath, 'utf8');
  const lit = n => { const i = page.indexOf('const ' + n + ' ='); if (i < 0) throw new Error(n + ' not found in the page'); const j = page.indexOf('};', i); return new Function('return ' + page.slice(page.indexOf('{', i), j + 1))(); };
  const o = P.packOptions(r.pack, { attachments: CHECK_DEFAULTS.attachments, drives: CHECK_DEFAULTS.drives, variants: CHECK_DEFAULTS.variants });
  sameMap('function code -> category', o.lookups.fc, lit('FC_LOOKUP'));
  sameMap('function code -> description', o.lookups.fcDescriptions, lit('FC_DESCRIPTIONS'));
  sameMap('process area -> description', o.lookups.pac, lit('PAC_LOOKUP'));
  if (JSON.stringify(o.materials) !== JSON.stringify(PIPE_MATERIAL_CODES)) say(`pipe material codes: pack ${JSON.stringify(o.materials)} against ${JSON.stringify(PIPE_MATERIAL_CODES)}`);
  else console.log(`  pipe material codes: ${o.materials.length}, same order`);
  // The options the pack passes to the check, laid over the check's own defaults, must give the check's own defaults back.
  for (const [k, v] of Object.entries(o.check)) {
    if (JSON.stringify(v) !== JSON.stringify(CHECK_DEFAULTS[k])) say(`check setting ${k}: pack ${JSON.stringify(v)} against default ${JSON.stringify(CHECK_DEFAULTS[k])}`);
  }
  console.log(`  check settings passed: ${Object.keys(o.check).length ? Object.keys(o.check).join(', ') : 'none (every default stands)'}`);
  console.log(differences ? `\n${differences} DIFFERENCE(S): importing this pack would change the tool's behaviour.` : '\nIDENTICAL: importing this pack changes nothing the tool does today.');
  process.exitCode = differences ? 1 : 0;
}
