#!/usr/bin/env node
// Makes the blank P&ID Standard Pack template: a fillable PDF that holds what the checks treat as "the standard", so another company can fill in its
// own information. The generator is assets/js/pid-pack-pdf.js (also used by the tool's Export as PDF, which writes a filled pack).
//
//   node scripts/make-standard-pack-template.mjs [out.pdf] [--fc-pages N] [--pac-rows N]
//
// It holds no data of any company's standard: every worked example is fictional and the code tables are blank.
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadVendoredUmd } from './pdfjs-node.mjs';
import { buildPackPdf } from '../assets/js/pid-pack-pdf.js';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? Number(argv[i + 1]) : d; };
const OUT = argv.find(a => a.endsWith('.pdf')) || 'P&ID-Standard-Pack-Template.pdf';
const r = await buildPackPdf(loadVendoredUmd('pdf-lib.min.js'), { fcPages: flag('fc-pages', 4), pacRows: flag('pac-rows', 30) });
await fs.writeFile(path.resolve(OUT), r.bytes);
console.log(`wrote ${OUT}: ${r.pages} pages, ${r.fields} fields, ${(r.bytes.length / 1024).toFixed(0)} KB`);
