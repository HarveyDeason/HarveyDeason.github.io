// scripts/pdfjs-node.mjs
// Loads the SAME pdf.js the tools ship (assets/vendor/) inside Node, so local
// checks and tests read a PDF exactly as the browser does.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const VENDOR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'vendor');
const require = createRequire(import.meta.url);
let cached = null;

// package.json says "type": "module", so Node refuses to require() these UMD
// builds. Evaluate each inside a CommonJS-shaped wrapper instead.
function loadUmd(file) {
  const module = { exports: {} };
  const wrapper = vm.runInThisContext(
    '(function (module, exports, require) {' + fs.readFileSync(file, 'utf8') + '\n})', { filename: file });
  wrapper.call(module.exports, module, module.exports, require);
  return module.exports;
}

export function loadVendoredPdfjs() {
  if (cached) return cached;
  // With no real Worker available, pdf.js runs its worker code in-process when
  // it finds it on globalThis.pdfjsWorker.
  globalThis.pdfjsWorker = loadUmd(path.join(VENDOR, 'pdf.worker.min.js'));
  cached = loadUmd(path.join(VENDOR, 'pdf.min.js'));
  return cached;
}

export async function openPdf(data) {
  return loadVendoredPdfjs().getDocument({ data, disableFontFace: true, isEvalSupported: false, verbosity: 0 }).promise;
}
