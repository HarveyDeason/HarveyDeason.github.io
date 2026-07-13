# Phase 2 — Gated Instruments & Portfolio Copy — Design Spec

**Date:** 2026-07-13
**Status:** Approved by Harvey (chat, 2026-07-13): 5-tool set, single shared workshop code.
**Depends on:** redesign branch `redesign/modern-old-money` (Tasks 1–10 complete).

## 1. Goal

Replace the tool cabinet with Harvey's five updated instruments, gate every tool behind a
single "workshop code" using real client-side encryption (not a bypassable prompt), and
reword public-facing copy as an engineering portfolio.

## 2. Tool set (replaces all existing tools)

Source: `C:\Users\deaso\Downloads\tools\` → copied to git-ignored `tools-src/` with slugs:

| Slug | Name | Portfolio blurb (voice: confident, specific, no fluff) | Tags |
|---|---|---|---|
| `naming-validator` | File Naming Validator | Validates and generates drawing-office file names — structure, codes and revisions checked before they ever reach the EDMS. | `QA`, `Drawing office` |
| `hydrosizer` | HydroSizer | Hydraulic flow sizing and storage-tank design: submergence, overflow, freeboard and working volume in one pass. | `Hydraulics`, `Storage` |
| `pid-tag-register` | P&ID Tag Register | Scans P&ID PDFs into a living tag register — numbering checked, clashes caught, next-available always known. | `Instrumentation`, `QA` |
| `steelwork-checker` | Steelwork Checker | Point load, UDL, flooring and stair configurations checked against British Standards. | `Structural`, `British Standards` |
| `schedule-sync` | Schedule Sync | Match a shared column across two Excel schedules and carry the data you choose from one to the other. | `Data`, `Excel` |

Removed from the site: `pipe-hydraulics.html`, `pcf-matrix.html`, `column-merge.html`,
`platform-access.html`, old `hydrosizer.html`, old `pid-tag-register.html`. `data/tools.json`
rewritten to the 5 rows above (shape unchanged: slug/name/blurb/href/tags + new `locked: true`).
Stats row on home: `data-count="5"`.

## 3. Access gate — client-side encryption

**Threat model addressed:** knowing a tool URL yields only ciphertext. No server, no database
(nothing to RLS), no secret in repo/logs.

- **Crypto:** AES-256-GCM per file (unique 12-byte IV); key = PBKDF2-SHA256(passphrase,
  site-wide random 16-byte salt, 600,000 iterations). One `tools/vault-manifest.json` holds
  `{salt, verifier}` where verifier = GCM-encryption of the constant string `"hd-vault-ok"`
  (allows instant wrong-code feedback without decrypting a whole tool).
- **At rest:** each `tools/<slug>.html` committed to the repo is a small *loader page* in the
  site design system (anti-flash script, tokens, lock icon, code input, "Unlock the workshop"
  button) with the tool's ciphertext embedded as base64 JSON in a `<script type="application/json">`
  block. The plaintext tools live only in git-ignored `tools-src/`.
- **Unlock flow (`assets/js/vault.js`):** derive key → check verifier → decrypt → replace the
  document via `document.open()/write()/close()` so the tool runs exactly as its standalone
  self. Derived key bits (NOT the passphrase) cached in `sessionStorage['hd-vault-key']` so one
  entry unlocks every tool for the tab session; loader auto-unlocks silently if a valid cached
  key exists. Wrong code → shake + message, no logging of input. Enter submits.
- **Lock tooling (`scripts/lock-tools.mjs`):** Node, zero deps (`node:crypto`). Reads
  `tools-src/*.html`, prompts for passphrase twice with echo disabled, derives, encrypts,
  writes loader pages + manifest. Never prints the passphrase; prints only per-file byte counts.
  Rotating the code = re-run the script. Shared pure functions in `scripts/vault-lib.mjs`
  (encrypt/decrypt/derive) so Node tests can round-trip them; `vault.js` mirrors the same
  parameters in WebCrypto.
- **Hygiene:** `.gitignore` += `.env`, `.env.*`, `tools-src/`. Loader pages + vault.js contain
  no secrets by construction. Sanity grep before commit: passphrase string absent from tree.
- **Stated limits (accepted):** shared-code model — recipients can use and save decrypted
  tools; public ciphertext means a weak code could be brute-forced offline → code must be a
  strong generated passphrase (delivered to Harvey in chat, never committed; rotation
  documented in README).

## 4. Cabinet & copy changes

- Bento cells for locked tools show a small lock glyph beside the `№` (tools.js reads `locked`).
- `/tools/` sub-line gains: "Instruments open with a workshop code — ask me for it."
- Home hero sub reworded, no tool count in prose (count lives in the stats row only):
  "Hand-built engineering instruments and a journal on work, output, and the well-considered
  life. Everything here is drawn to scale." Badge/H1/flourish unchanged.
- Command palette: tools remain searchable by public metadata (name/blurb — public by design);
  navigation lands on the unlock page.

## 5. Testing

- `tests/vault.test.js`: round-trip encrypt→decrypt via `vault-lib.mjs`; wrong-key rejection;
  verifier accept/reject; unique IVs across two encryptions of same plaintext.
- `tests/tools.test.js`: update fixtures to 5-tool shape (+`locked`), lock glyph in cell markup.
- Suite green; existing sanitizer/layout/palette/gear tests untouched.

## 6. Out of scope

Per-person codes, server-side auth, analytics, About-page copy (still flagged for Harvey),
deploy (existing Task 13).
