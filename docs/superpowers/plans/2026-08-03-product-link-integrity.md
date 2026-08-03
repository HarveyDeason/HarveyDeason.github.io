# Product Link Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a broken product reference self-describing and repairable in bulk, instead of an opaque `fam-xxxx` string that cannot be removed.

**Architecture:** Two additive changes. Records store the product **name** alongside the id at save time, so an orphan can say what it *was*. A shared pure module finds broken links; each tool gets a repair screen for **its own** ledger.

**Tech Stack:** Vanilla ES modules, File System Access API, `node --test`. Baseline **362 tests passing**.

## The problem

Families live in the P&ID register and are exposed to the other tools as pseudo-products with id `fam-<familyId>`. Comments and decisions store that id. A family that is deleted and recreated — as happened on 2026-08-03 when families had to be rebuilt by hand — mints a **new** id, so every existing reference dangles.

`productNameById` falls back to returning the raw id, so the record displays `fam-fmrc3e7nq3ge9wz` forever. Until the fix in `0e4a83f`, those ids could not even be removed, because the picker only drew rows for products that exist.

This is a **cross-tool foreign key with no referential integrity**: the register owns families, two other tools hold references, and three independently-saved JSON files on a shared drive cannot enforce the relationship. The answer is prevention and cure, not a guarantee.

## The governing safety rule

**Never auto-clean a dangling reference.**

If `hub-data.json` fails to load, *every* product looks missing. An automatic cleanup would then strip every reference in both ledgers — the same "a failed read destroys data" class that caused the 2026-08-03 incident. So:

- Repairs only run when the product list genuinely loaded.
- Every repair is confirmed by a human, showing what will change.
- A tool only ever repairs the ledger it owns. The Comments Hub cannot rewrite decisions; the Decision Register cannot rewrite comments.

## Global Constraints

- Pure logic goes in `assets/js/`, node-testable, no DOM, no File System Access.
- **Additive schema only.** Records without labels must keep working exactly as they do now — there is live data in the field.
- Escape everything from a ledger before it reaches `innerHTML`.
- `tools-src/` is gitignored — commit UI work with `git commit --allow-empty`. Never run `lock-tools.mjs`.
- No hardcoded colours — `site.css`/`tool.css` tokens only.
- Do not touch `clearAll`, `saveToFolder`, `readRegisterJSON`, backups or the destructive-save guard in the P&ID tool.

---

### Task 1: Link-integrity primitives (shared, pure)

**Files:**
- Modify: `assets/js/hub-sync.js` (shared by both tools)
- Test: `tests/hub-sync.test.js`

**Interfaces:**
- `stampProductLabels(record, productsById) -> record` — returns a copy with `productLabels: { [productId]: name }` covering every id in `record.productIds` that currently resolves. Ids that do not resolve keep any label they already had, so a snapshot is never lost by re-saving while a product is missing.
- `brokenProductLinks(records, knownIds) -> Map<missingId, { label, records: [] }>` — every referenced id absent from `knownIds`, with the best-known label from any record's snapshot, and the records affected.
- `remapProductId(record, fromId, toId) -> record` — returns a copy with `fromId` replaced by `toId` in `productIds`, de-duplicated if `toId` is already present; `toId` of `null` removes the reference. Labels updated to match.

- [ ] **Step 1: Write the failing tests.** Cover: labels stamped for resolvable ids only; an existing label preserved when its product is currently missing; `brokenProductLinks` grouping several records under one missing id; a record with no `productIds` ignored without throwing; an empty `knownIds` set treated as **no known products** by the caller's choice, not as "everything is broken" (the guard lives in the UI, but document it); remap replacing an id; remap de-duplicating when the target is already present; remap with `null` removing; and remap leaving other ids untouched.
- [ ] **Step 2–4:** Run to fail, implement, run to pass.
- [ ] **Step 5: Commit** — `feat(hub-sync): product link integrity primitives`

---

### Task 2: Stamp labels when saving comments

**Files:** `tools-src/comments-hub.html`

- [ ] **Step 1:** Apply `stampProductLabels` wherever a comment's `productIds` is written — new comments, edits, and the intake commit path. Find them all; `mutateComment` is the funnel for most.
- [ ] **Step 2:** Show the remembered label on an unresolved reference — `fam-xxxx (was: MMF's)` rather than the bare id.
- [ ] **Step 3:** Existing comments have no labels. They must display exactly as they do today, not as an error.
- [ ] **Step 4: Verify** — save a comment, confirm `productLabels` appears in `hub-data.json` and old comments are unaffected.
- [ ] **Step 5: Commit** — `feat(hub-ui): remember product names alongside their ids`

---

### Task 3: Stamp labels when saving decisions

**Files:** `tools-src/product-brain.html`

Same as Task 2 for decisions. Mutation paths: `saveDecisionForm` (edit and supersede) and the from-comment bridge.

- [ ] **Steps as Task 2**, then commit — `feat(brain-ui): remember product names alongside their ids`

---

### Task 4: Broken-links repair in the Comments Hub

**Files:** `tools-src/comments-hub.html`

- [ ] **Step 1:** A **Product links** panel in Settings listing every dangling reference: the missing id, its remembered label if known, and how many comments reference it.
- [ ] **Step 2:** Per entry, offer **remap to an existing product** (a picker) or **remove the reference**. Apply across every affected comment in one action, through the normal save path so history is recorded.
- [ ] **Step 3: The safety guard.** The panel must be unavailable, with an explanation, unless the product list genuinely loaded. If the register could not be read, every product looks missing and a bulk repair would be catastrophic. Fail closed.
- [ ] **Step 4:** Confirm before applying, naming the number of comments affected and the change being made.
- [ ] **Step 5:** Empty state — say "no broken links" plainly.
- [ ] **Step 6: Verify** against a scratch folder with a deliberately dangling id.
- [ ] **Step 7: Commit** — `feat(hub-ui): repair broken product links in bulk`

---

### Task 5: Broken-links repair in the Decision Register

**Files:** `tools-src/product-brain.html`

Same as Task 4 for decisions, reusing the shared primitives and the same fail-closed guard.

- [ ] **Steps as Task 4**, then commit — `feat(brain-ui): repair broken product links in bulk`

---

### Task 6: Verification and publish

- [ ] **Step 1:** `npm test` — all green.
- [ ] **Step 2: The scenario that motivated this.** In a scratch folder: create a family, link a decision and a comment to it, delete and recreate the family, then confirm both tools list the dangling reference with its remembered label and repair it in one action.
- [ ] **Step 3: The safety check.** With the register unreadable, confirm both repair panels refuse to run rather than offering to strip every reference.
- [ ] **Step 4:** Confirm records saved before this change still display and save correctly.
- [ ] **Step 5:** Confirm the P&ID register safety work is untouched — `clearAll` while disconnected still leaves the register intact.
- [ ] **Step 6: Publish** *(owner runs this — prompts for the workshop code)*

```bash
node scripts/lock-tools.mjs
git add tools/ && git commit -m "build: republish tools with product link integrity"
git push
```

## Deliberately not in this plan

- **Warning before deleting a referenced family** (prevention, in the P&ID tool). Worth doing, but it needs the P&ID tool to read `brain-data.json` as well, and this plan is already two tools wide. Do it next.
- **Stable family ids derived from names or patterns.** Rejected: it trades one fragility for another — renaming would break every link, and identical patterns would collide. Volatile ids with good tooling beat clever ids.
