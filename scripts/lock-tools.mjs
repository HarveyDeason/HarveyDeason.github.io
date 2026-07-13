#!/usr/bin/env node
// CLI: encrypts plaintext tool HTML files from tools-src/ into complete
// loader pages (tools/<slug>.html) plus a vault manifest, gating them
// behind one "workshop code" (passphrase) that is never written to disk.
//
// I/O and prompting only — all crypto lives in vault-lib.mjs.

import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import { deriveKey, encryptText, makeManifest } from './vault-lib.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(REPO_ROOT, 'tools-src');
const TOOLS_DIR = path.join(REPO_ROOT, 'tools');
const MANIFEST_PATH = path.join(TOOLS_DIR, 'vault-manifest.json');

/**
 * Lists the plaintext tool HTML files to lock, sorted for stable output.
 * Throws a clear, actionable error if tools-src/ is missing or empty —
 * it is gitignored and won't exist on a fresh checkout.
 */
export async function listSourceFiles(srcDir) {
  let entries;
  try {
    entries = await fs.readdir(srcDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(
        `tools-src/ not found at ${srcDir}. Create it and add the plaintext tool HTML files before running lock-tools.`,
      );
    }
    throw err;
  }

  const htmlFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.html'))
    .map((entry) => entry.name)
    .sort();

  if (htmlFiles.length === 0) {
    throw new Error(`tools-src/ is empty (no .html files found) at ${srcDir}.`);
  }

  return htmlFiles;
}

/** Slug = source filename without its extension, e.g. "hydrosizer.html" -> "hydrosizer". */
export function slugFromFilename(filename) {
  return path.basename(filename, path.extname(filename));
}

/**
 * Encrypts one tool's plaintext HTML into the { iv, ct } payload shape
 * embedded in its loader page.
 */
export async function encryptToolPayload(plaintext, keyB64) {
  return encryptText(plaintext, keyB64);
}

/** Turns a slug like "pid-tag-register" into "Pid Tag Register" for a page <title>. */
export function titleFromSlug(slug) {
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Renders a complete loader page for one gated tool: a design-system
 * unlock screen (anti-flash script, centered card) with the tool's
 * ciphertext embedded as JSON, plus the browser unlock module. The
 * decrypted plaintext never appears in this file — only { iv, ct }.
 */
export function renderLoaderPage(slug, payload) {
  const title = titleFromSlug(slug);
  const payloadJson = JSON.stringify(payload);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — Harvey Deason</title>
  <script>(function(){try{var s=localStorage.getItem('hd-mode');var d=s==='dark'||s==='light'?s:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.mode=d;}catch(e){}})();</script>
  <link rel="stylesheet" href="/assets/css/site.css">
  <link rel="icon" href="/assets/img/seal.svg">
</head>
<body>
  <main class="vault">
    <div class="vault-card" id="vault-card">
      <span class="ico"><svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></span>
      <h1>Kept under lock</h1>
      <p class="sub">Enter the workshop code to open this instrument.</p>
      <form class="vault-form" id="vault-form" autocomplete="off">
        <input class="vault-input" type="password" id="vault-input" name="code" placeholder="Workshop code" autocomplete="off" required>
        <button class="btn btn-primary" type="submit">Unlock</button>
        <p class="vault-error" id="vault-error" role="alert"></p>
      </form>
    </div>
  </main>
  <script type="application/json" id="vault-payload">${payloadJson}</script>
  <script type="module" src="/assets/js/vault.js"></script>
</body>
</html>
`;
}

/** Writes one loader page as tools/<slug>.html. */
export async function writeLoaderPage(toolsDir, slug, payload) {
  const dest = path.join(toolsDir, `${slug}.html`);
  await fs.writeFile(dest, renderLoaderPage(slug, payload), 'utf8');
  return dest;
}

/**
 * Asks one question on a shared readline interface with echo fully
 * suppressed (no characters, not even asterisks, are reflected to the
 * terminal). Works on Windows because it only relies on readline's own
 * line-writing hook, not raw-mode escape sequences.
 *
 * The interface must be reused across both passphrase prompts (not
 * recreated per-question) — otherwise any input buffered ahead of the
 * first newline is lost when the first interface closes, and the second
 * prompt hangs waiting for data that already arrived.
 */
function askHidden(rl, promptText) {
  return new Promise((resolve) => {
    process.stdout.write(promptText);
    rl.question('', (answer) => {
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

/** Prompts twice; throws if the entries don't match or either is empty. */
export async function promptPassphraseTwice() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  // eslint-disable-next-line no-underscore-dangle -- documented Node workaround for hidden prompts
  rl._writeToOutput = () => {};

  let first;
  let second;
  try {
    first = await askHidden(rl, 'Workshop code: ');
    second = await askHidden(rl, 'Confirm workshop code: ');
  } finally {
    rl.close();
  }

  if (first.length === 0) {
    throw new Error('Workshop code cannot be empty.');
  }
  if (first !== second) {
    throw new Error('Workshop codes did not match. Aborting — nothing was written.');
  }

  return first;
}

async function main() {
  const filenames = await listSourceFiles(SRC_DIR);
  const passphrase = await promptPassphraseTwice();

  const manifest = await makeManifest(passphrase);
  const keyB64 = await deriveKey(passphrase, manifest.salt);

  await fs.mkdir(TOOLS_DIR, { recursive: true });

  for (const filename of filenames) {
    const slug = slugFromFilename(filename);
    const plaintext = await fs.readFile(path.join(SRC_DIR, filename), 'utf8');
    const payload = await encryptToolPayload(plaintext, keyB64);
    await writeLoaderPage(TOOLS_DIR, slug, payload);
    console.log(`${filename} -> ${slug}.html (${Buffer.byteLength(plaintext, 'utf8')} bytes)`);
  }

  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest), 'utf8');
  console.log(`vault-manifest.json written (${filenames.length} tool(s) locked)`);
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  main().catch((err) => {
    console.error(`lock-tools: ${err.message}`);
    process.exitCode = 1;
  });
}
