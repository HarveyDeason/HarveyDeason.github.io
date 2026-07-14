# Phase 2 — Gated Instruments & Portfolio Copy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tool cabinet with Harvey's five updated instruments, gate every tool behind one AES-encrypted "workshop code", and reword public copy as a portfolio — per `docs/superpowers/specs/2026-07-13-phase2-gated-instruments.md`.

**Architecture:** Static site unchanged. New: `scripts/vault-lib.mjs` (pure crypto, Node-testable) + `scripts/lock-tools.mjs` (CLI encryptor) + `assets/js/vault.js` (browser unlock) + loader pages replacing plaintext tools. Plaintext lives in git-ignored `tools-src/`.

**Tech Stack:** node:crypto (webcrypto) in scripts, WebCrypto API in browser, Node built-in test runner.

## Global Constraints

- Crypto parameters everywhere: AES-256-GCM, 12-byte random IV per encryption; key = PBKDF2-SHA256(passphrase, 16-byte site salt, 600000 iterations, 32 bytes). Verifier plaintext constant: `hd-vault-ok`. Manifest: `tools/vault-manifest.json` = `{"salt":"<b64>","verifier":{"iv":"<b64>","ct":"<b64>"}}`.
- The passphrase is NEVER written to any file, log, commit, or test fixture. Lock script reads it via hidden-echo prompt (twice, must match). Tests use their own throwaway passphrases.
- sessionStorage key name: `hd-vault-key` (stores base64 of derived key bits, not the passphrase).
- No frameworks/build step; token classes only for all new UI; `prefers-reduced-motion` respected; focus-visible ring on unlock input/button.
- Suite `node --test tests/` green before every commit; sanitizer untouched; commit trailer `Co-Authored-By: Claude <noreply@anthropic.com>`.
- `.gitignore` gains `.env`, `.env.*`, `tools-src/`.
- Tool inner HTML is Harvey's work: import files byte-identical (rename only), never edit their contents.

---

### Task P2-1: Vault crypto library + lock script (TDD)

**Files:**
- Create: `scripts/vault-lib.mjs`, `scripts/lock-tools.mjs`, `tests/vault.test.js`
- Modify: `.gitignore`

**Interfaces:**
- Produces (vault-lib.mjs, all async, Uint8Array/base64-string based):
  - `deriveKey(passphrase, saltB64)` → base64 key bits (PBKDF2 params from Global Constraints)
  - `encryptText(plaintext, keyB64)` → `{iv, ct}` (base64 pair; fresh random IV)
  - `decryptText({iv, ct}, keyB64)` → plaintext string; throws on wrong key/tampered ct
  - `makeManifest(passphrase)` → `{salt, verifier}` ; `checkKey(keyB64, manifest)` → boolean
- Produces (lock-tools.mjs CLI): reads `tools-src/*.html`, hidden double prompt, writes `tools/vault-manifest.json` + per-tool payload JSON consumed by Task P2-2's loader template. Prints filenames + byte counts only.

- [ ] Step 1: Write failing tests (round-trip; wrong-key throws; verifier accept/reject; two encryptions of same plaintext have different IV and ct). Run `node --test tests/vault.test.js` → FAIL (module missing).
- [ ] Step 2: Implement vault-lib.mjs with `node:crypto` webcrypto so the same code paths mirror browser WebCrypto parameters.
- [ ] Step 3: Tests PASS; full suite green.
- [ ] Step 4: Implement lock-tools.mjs (readline with muted echo; confirm-match; abort on mismatch; `mkdir -p` output dirs).
- [ ] Step 5: `.gitignore` += `.env`, `.env.*`, `tools-src/`.
- [ ] Step 6: Commit `feat: vault crypto library and lock-tools script`.

### Task P2-2: Import tools, loader pages, unlock UI

**Files:**
- Create: `tools-src/` (5 renamed copies from `C:\Users\deaso\Downloads\tools\`), `assets/js/vault.js`, loader template inside `scripts/lock-tools.mjs` (extend), `tools/naming-validator.html`, `tools/steelwork-checker.html`, `tools/schedule-sync.html` (generated), regenerate `tools/hydrosizer.html`, `tools/pid-tag-register.html`
- Delete: `tools/pipe-hydraulics.html`, `tools/pcf-matrix.html`, `tools/column-merge.html`, `tools/platform-access.html`
- Modify: `assets/css/site.css` (unlock screen + lock glyph styles), `data/tools.json`, `assets/js/tools.js` (lock glyph render), `tests/tools.test.js`

**Interfaces:**
- Consumes: vault-lib manifest/payload format from P2-1.
- Produces: loader page = design-system unlock screen (anti-flash script, centered card: lock icon, "Kept under lock" heading, muted line "Enter the workshop code to open this instrument.", password input, `.btn-primary` "Unlock" button, error state) + embedded `<script type="application/json" id="vault-payload">` + `<script type="module" src="/assets/js/vault.js">`. `vault.js`: cached-key fast path → prompt path → `checkKey` → `decryptText` → `document.open/write/close`.
- tools.json rows exactly per spec §2 table (slug/name/blurb/href/tags/locked:true); slugs = naming-validator, hydrosizer, pid-tag-register, steelwork-checker, schedule-sync.
- Note: file `YTLC_File_Naming_Convention_Validator.HTM` → `tools-src/naming-validator.html`; `P&ID_Tag_Register.html` → `tools-src/pid-tag-register.html`; `platform-access-checker.html` → `tools-src/steelwork-checker.html`; byte-identical content.
- Encryption run for real output uses a TEMPORARY placeholder passphrase (redacted from this doc after final review; controller rotates to the real one at the end of Phase 2; document this in the report).

- [ ] Step 1: TDD tests/tools.test.js for 5-tool shape + `locked` + lock glyph markup → RED.
- [ ] Step 2: Copy/rename tools into tools-src/ (verify byte-identical: `cmp`/hash).
- [ ] Step 3: tools.json rewrite; tools.js lock glyph; CSS for unlock screen + glyph.
- [ ] Step 4: vault.js + loader template; run lock-tools with temp passphrase; delete retired tool files (git rm).
- [ ] Step 5: Suite GREEN. Browser: /tools/ shows 5 cells with lock glyphs; opening hydrosizer shows unlock screen; wrong code → error, right (temp) code → tool decrypts and functions; second tool opens without re-prompt (cached key); both modes; no console errors; nothing sensitive in console/network.
- [ ] Step 6: Commit `feat: five gated instruments with encrypted vault`.

### Task P2-3: Portfolio copy + docs

**Files:**
- Modify: `index.html` (hero sub reword per spec §4; `data-count="5"`), `tools/index.html` (workshop-code line), `README.md` (rotation how-to: edit tools-src → `node scripts/lock-tools.mjs` → commit outputs; passphrase hygiene note)

- [ ] Step 1: Copy edits per spec §4 (no tool count in prose anywhere — grep "Six"/"six instruments"/"6 instruments").
- [ ] Step 2: Suite green; browser sanity home + cabinet.
- [ ] Step 3: Commit `feat: portfolio copy and vault rotation docs`.

### Model policy (per Harvey, 2026-07-13)
All implementers and reviewers dispatch on Sonnet 5; Fable is the controller. Escalate a single task to a stronger model only on BLOCKED.

### After all tasks (controller, not subagent)
- Final whole-branch review (Sonnet 5) over the Phase 2 commit range.
- Controller generates the REAL workshop passphrase locally, re-runs lock-tools to rotate away from temp code, verifies unlock in browser, commits regenerated ciphertext, and delivers the passphrase to Harvey in chat only.
