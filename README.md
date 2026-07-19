# harveydeason.github.io

Personal site of Harvey Deason — Engineer & Essayist.
Static site (no build step). Open `index.html` locally or serve the folder.

- Tools manifest: `data/tools.json`
- Blog source: WordPress.com public API
- Tests: `npm test`
- Tool skin lives in `assets/css/tool.css` (chrome injected by `assets/js/tool-chrome.js`); SheetJS is vendored at `assets/vendor/xlsx.full.min.js`.

## Gated instruments (vault)

The five tools under `/tools/` are encrypted at rest. Each `tools/<slug>.html`
committed to the repo is a loader page — the working tool lives only in the
git-ignored `tools-src/` directory and is embedded as AES-256-GCM ciphertext.
A single "workshop code" (passphrase) decrypts all of them client-side; there
is no server and no secret in the repo.

### Rotating the workshop code

1. Edit the plaintext tool(s) in `tools-src/*.html` as needed.
2. Run `node scripts/lock-tools.mjs`. It prompts twice, hidden-echo, for the
   workshop code (the two entries must match) — then re-encrypts every file
   in `tools-src/` and regenerates the loader pages plus
   `tools/vault-manifest.json`.
3. Commit the regenerated `tools/*.html` and `tools/vault-manifest.json`.

Each loader also embeds a clear preview screenshot below the unlock card,
served from `assets/img/previews/<slug>.webp` (also used as the cabinet card
thumbnails). These are committed images regenerated only when a tool's UI
changes; the loader template in `scripts/lock-tools.mjs` references them.

Rotating the code is just re-running the script with a new passphrase — it
re-encrypts everything from `tools-src/`, so every loader and the manifest
must be regenerated and committed together.

### Passphrase hygiene

The workshop code is never written to any file, log, commit, or test
fixture — it only ever lives in the terminal prompt while the script is
running. Don't paste it into commit messages, issues, chat transcripts that
get saved to the repo, or anywhere else it could end up in git history.
