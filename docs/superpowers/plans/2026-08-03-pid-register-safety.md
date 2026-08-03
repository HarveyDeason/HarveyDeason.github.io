# P&ID Register Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `register.json` as hard to lose as the other two ledgers. It is the foundation of the whole suite — families and drawing numbers are what the Comments Hub and Decision Register hang their links off — so its loss breaks everything downstream, and it is currently the least protected of the three.

**Architecture:** Reuse the primitives already built and tested for the other tools (`writeFileAtomic`, `backupFileName`, `prunableBackups` in `assets/js/hub-sync.js`), exposed to this tool's classic script through the existing module bridge. New pure logic goes in `assets/js/pid-comments.js` so it is node-testable.

**Tech Stack:** Vanilla ES modules, File System Access API, `node --test`. Baseline **330 tests passing**.

## What happened on 2026-08-03 (the reason for this plan)

A user pressed **Clear all** while disconnected, wanting a local fresh slate before reconnecting to a different folder. `clearAll` stamped a deletion tombstone against all 144 drawings and held them in memory. Nothing was written at the time — but on the next connect those tombstones merged into the real register and deleted **1.8 MB / 144 drawings / 4,608 tags**. There were no backups. Explorer showed no previous versions.

Recovery only worked because the archived PDFs survived and the tool can re-extract tags from them. That recovery then introduced a *second* fault: re-importing from `archive/` made every drawing name `<drawing>_<rev>`, because import derives the drawing name from the filename and archive filenames already carry the revision.

Every fix below traces to that incident.

## Global Constraints

- `assets/js/` stays pure and node-testable: no DOM, no File System Access.
- **Do not change the Comments Hub or Decision Register.** `hub-sync.js` may be *used* but not modified.
- `tools-src/` is gitignored — commit UI tasks with `git commit --allow-empty`. Never run `lock-tools.mjs`; that is the owner's step.
- The P&ID tool's main logic is a **classic script**, not a module. Shared ES modules reach it via the existing `<script type="module">` bridge that assigns to `window.PidComments`. Extend that bridge rather than converting the tool to a module.
- No hardcoded colours — `site.css`/`tool.css` tokens only.
- **Never widen the blast radius:** every change here must fail safe. If a safety check cannot run, it must block the write, not allow it.

---

### Task 1: Never let a failed read authorise a write

**Files:** `tools-src/pid-tag-register.html`

`readRegisterJSON` returns `null` for **every** failure — file missing, JSON parse error, permission blip — and `saveToFolder` then writes whatever is in memory. So a transient read failure with empty memory silently replaces a 1.8 MB register with nothing. This is the same defect fixed in the Comments Hub's `readLedger`; it was never fixed here.

- [ ] **Step 1:** Make `readRegisterJSON` return a status, not a bare value: `{ status: 'ok'|'missing'|'unreadable', data }`. Only a genuine `NotFoundError` is `missing`. A parse failure or any other error is `unreadable`.
- [ ] **Step 2:** `saveToFolder` must **refuse to write** when the status is `unreadable`, surface it on the folder chip, and leave the on-disk file untouched. `missing` keeps today's behaviour — writing a first register is correct.
- [ ] **Step 3:** `connectFolder` must not present an unreadable register as an empty one. Say so plainly and do not save.
- [ ] **Step 4: Verify** — temporarily point the tool at a folder holding a deliberately corrupt `register.json` and confirm nothing is overwritten.
- [ ] **Step 5: Commit** — `fix(pid-ui): a failed register read must never authorise a write`

---

### Task 2: Atomic writes

**Files:** `tools-src/pid-tag-register.html`

The register is written directly. A crash, lock, or sync collision partway through a 1.8 MB write leaves a truncated file — which then reads as corrupt, and (before Task 1) got replaced with empty state.

- [ ] **Step 1:** Expose `writeFileAtomic` from `assets/js/hub-sync.js` on the module bridge alongside `PidComments`. Do not reimplement it — it is already tested, including the session-unique temp name that stops two machines colliding.
- [ ] **Step 2:** Use it for `register.json`. Pass a per-session id so concurrent sessions never share a temp file.
- [ ] **Step 3:** Leave the PDF archive writes as they are — a half-written PDF is recoverable by re-importing; a half-written register is not.
- [ ] **Step 4: Verify** no stray `.tmp` survives a normal save.
- [ ] **Step 5: Commit** — `feat(pid-ui): atomic register writes`

---

### Task 3: Dated backups

**Files:** `tools-src/pid-tag-register.html`

This tool holds the least replaceable data of the three and is the only one with no backup at all. That is what turned a bug into a lost morning.

- [ ] **Step 1:** Expose `backupFileName` and `prunableBackups` from `hub-sync.js` on the module bridge.
- [ ] **Step 2:** Before each save, write the **previous** disk contents to `backups/register-<timestamp>.json` inside the register folder, pruned to the most recent 20. Scope pruning by base name so it never touches another ledger's backups.
- [ ] **Step 3:** **A backup failure must never block a save**, exactly as in the Comments Hub — wrap the whole thing, warn, continue. Losing a backup is an inconvenience; losing the ability to save is an outage.
- [ ] **Step 4:** Skip the backup when the previous contents are byte-identical to the last one taken, so retries and no-op saves do not burn the 20-deep history on duplicates.
- [ ] **Step 5: Verify** — make several edits, confirm `backups/` fills and caps at 20.
- [ ] **Step 6: Commit** — `feat(pid-ui): dated register backups`

---

### Task 4: `clearAll` must not arm a delete while disconnected

**Files:** `tools-src/pid-tag-register.html`

The direct cause of the incident:

```js
Object.keys(revHistory).forEach(function(dd){ deletions[dd] = now; });
```

This runs whether or not a folder is connected. Disconnected, the user reasonably reads "Clear all tags and drawings?" as a local reset — but it silently arms a delete-everything that fires on the next connect.

- [ ] **Step 1:** Only record deletions when a register folder is connected. Disconnected, `clearAll` is a purely local reset: clear `allTags`, `drawings`, `revHistory`, `pdfBin`, and **do not touch `deletions`**.
- [ ] **Step 2:** Make the connected-mode dialog state the consequence plainly and quantitatively — how many drawings, and that it removes them for everyone on the shared folder. "Also removes these drawings from the shared register.json" undersold it.
- [ ] **Step 3:** In connected mode, require a **second** confirmation naming the drawing count. This deletes the team's shared data; one reflexive click should not be enough.
- [ ] **Step 4: Verify both paths** — disconnected clear then connect must leave the register fully intact (this is the exact incident; it must be impossible now). Connected clear must still work as intended after both confirmations.
- [ ] **Step 5: Commit** — `fix(pid-ui): clearAll no longer arms a delete-everything while disconnected`

---

### Task 5: Import must not double the revision into the drawing name

**Files:** `assets/js/pid-comments.js`, `tests/pid-comments.test.js`, `tools-src/pid-tag-register.html`

Import derives the drawing name from the filename:

```js
const drawingName = file.name.replace(/\.pdf$/i, '')...
```

Archive filenames are `<drawing>_<rev>.pdf`, so re-importing from `archive/` — the obvious move during a recovery — silently renames every drawing to `<drawing>_<rev>` and then appends the revision again on save. It corrupts names precisely when the user is already in trouble.

**Interfaces:**
- `drawingNameFromFile(fileName, revisions) -> { name, revisionFromName }` in `pid-comments.js`. Strips `.pdf`, strips a trailing `(1)`-style copy marker, and strips a trailing `_<rev>` **only when that suffix looks like a revision** — matching the tool's own revision format rather than any trailing underscore chunk.

- [ ] **Step 1: Write the failing tests.** Cover: a plain name unchanged; `X_C01.pdf` → name `X`, revision `C01`; `X_P01.pdf`; a name with a legitimate underscore that is NOT a revision (e.g. `PUMP_HOUSE.pdf`) left alone; `X (1).pdf` copy markers; case handling; and an empty or extension-only filename not throwing.
- [ ] **Step 2–4:** Implement, run, confirm.
- [ ] **Step 5:** Wire into the import path. When a revision is recovered from the filename, **pre-fill the revision input with it** rather than silently overriding what the user typed — the user stays in control, but the sensible default is right.
- [ ] **Step 6: Verify** — re-import a file straight out of `archive/` and confirm the drawing name matches the original and no `_rev_rev` file appears.
- [ ] **Step 7: Commit** — `fix(pid): a revision suffix in the filename must not become part of the drawing name`

---

### Task 6: Refuse a catastrophic save without confirmation

**Files:** `assets/js/pid-comments.js`, `tests/pid-comments.test.js`, `tools-src/pid-tag-register.html`

Tasks 1–5 fix the failures we know about. This one catches the ones we do not.

Every version of this incident had the same shape: **memory held far less than disk, and the save went ahead silently.** A guard on that shape protects against future bugs of a kind nobody has thought of yet — which matters more here than anywhere else, because this register anchors the links for all three tools.

**Interfaces:**
- `isDestructiveSave(diskCount, memoryCount) -> boolean` — true when the save would remove a large share of what is on disk. Zero-from-many is always destructive. Keep the threshold in a named constant.

- [ ] **Step 1: Write the failing tests.** Cover: 142 → 0 destructive; 142 → 1 destructive; 142 → 141 not destructive; 0 → 5 not destructive (a first save); equal counts not destructive; growth never destructive; and missing or non-numeric counts treated as **destructive** (fail safe — if the check cannot be evaluated, block and ask).
- [ ] **Step 2–4:** Implement, run, confirm.
- [ ] **Step 5:** In `saveToFolder`, after reading and merging, compare the drawing count about to be written against the count read from disk. If destructive, **confirm with the user, naming both numbers**, and abort on decline leaving the disk untouched.
- [ ] **Step 6:** A genuine intentional `clearAll` will trip this. That is correct — it should be loud. Word it so the confirmed case reads sensibly rather than like an error.
- [ ] **Step 7: Verify** — simulate an empty-memory save against a populated register and confirm it is blocked.
- [ ] **Step 8: Commit** — `feat(pid): confirm before a save that would remove most of the register`

---

### Task 7: Verification and publish

- [ ] **Step 1:** `npm test` — all green.
- [ ] **Step 2: Replay the incident exactly.** Connect a scratch folder with a populated register; disconnect; press Clear all; reconnect. **The register must be intact.** This is the regression that matters most in this plan.
- [ ] **Step 3:** Re-import a PDF straight from `archive/` and confirm the drawing name is clean.
- [ ] **Step 4:** Confirm `backups/` fills, caps at 20, and that a backup failure does not block saving.
- [ ] **Step 5:** Confirm a corrupt `register.json` is never overwritten.
- [ ] **Step 6:** Confirm legacy mode and hub-root mode both still work, and the Comments Hub still reads the register.
- [ ] **Step 7: Publish** *(owner runs this — prompts for the workshop code)*

```bash
node scripts/lock-tools.mjs
git add tools/ && git commit -m "build: republish tools with P&ID register safety"
git push
```
