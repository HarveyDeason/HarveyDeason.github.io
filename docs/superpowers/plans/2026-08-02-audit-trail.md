# Audit Trail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every change to a comment or a decision keeps its previous values, so anyone can step through a record's history and see exactly what changed, when, and who did it.

**Architecture:** History is a **top-level, append-only collection** in each ledger (`state.history`), merged by entry id — never nested inside the record it describes. The entry shape and diffing are generic, so they live in `assets/js/hub-sync.js`, already shared by both tools.

**Tech Stack:** Vanilla ES modules, File System Access API, `node --test`.

## Why history is NOT stored on the record

The obvious design is `comment.history = [...]`. It silently loses data.

`mergeById` resolves collisions **per record, last-`updatedAt`-wins**. When two people edit the same comment, the losing record is discarded *including its history entries*. The audit trail would have gaps exactly when two people were working at once — which is precisely when it matters. An audit trail with holes is worse than none, because it is trusted and wrong.

A separate collection merged by entry id unions instead of overwriting, so no entry can ever be lost.

## Global Constraints

- `npm test` runs `node --test`. Tests in `tests/*.test.js` with `node:test` + `node:assert/strict`. Baseline: **291 passing**.
- `assets/js/hub-sync.js` and `hub-core.js`/`brain-core.js` stay pure and node-testable: no DOM, no File System Access.
- **`hub-sync.js` is shared by the Comments Hub and the Decision Register.** Changes must keep both working.
- Person-field rule unchanged: `raisedBy`, `closedBy`, `madeBy`, `recordedBy` are never auto-filled. History records the **local user** as the actor, because that is the one thing the tool knows for a fact.
- History entries are **append-only**. Nothing edits or deletes one. There is no UI to remove an entry.
- **History survives record deletion.** Tombstones remove records, not their history — a deleted comment's trail is exactly what an audit needs. History entry ids are distinct from record ids so tombstones cannot touch them.
- Generated Excel filenames stay stable and dateless (ACC versions by filename).
- `tools-src/` is gitignored — commit UI tasks with `git commit --allow-empty`. Never run `lock-tools.mjs`; that is the owner's step.
- No hardcoded colours in UI — `site.css`/`tool.css` tokens only.

---

### Task 1: History primitives (shared)

**Files:**
- Modify: `assets/js/hub-sync.js`
- Test: `tests/hub-sync.test.js`

**Interfaces:**
- Produces:
  - `diffRecord(before, after, ignoreFields) -> [{ field, from, to }]` — fields whose values differ, sorted by field name, excluding `ignoreFields`.
  - `historyEntry({ recordId, recordType, by, nowIso, changes }) -> { id, recordId, recordType, at, by, changes }` — `id` is a fresh uuid.
  - `createEntry({ recordId, recordType, by, nowIso }) -> entry` — a creation marker with empty `changes`, so a trail starts at the beginning rather than mid-story.
  - `historyFor(history, recordId) -> entry[]` — newest first, stable ordering for equal timestamps.

- [ ] **Step 1: Write the failing test**

```js
import { diffRecord, historyEntry, createEntry, historyFor } from '../assets/js/hub-sync.js';

test('diffRecord reports only changed fields, sorted, ignoring what it is told to', () => {
  const before = { id: 'c1', description: 'Old text', priority: 'low', updatedAt: 'A' };
  const after  = { id: 'c1', description: 'New text', priority: 'low', updatedAt: 'B' };
  assert.deepEqual(diffRecord(before, after, ['updatedAt']),
    [{ field: 'description', from: 'Old text', to: 'New text' }]);
});

test('diffRecord catches a field appearing or disappearing', () => {
  assert.deepEqual(diffRecord({ a: 1 }, { a: 1, b: 2 }, []), [{ field: 'b', from: undefined, to: 2 }]);
  assert.deepEqual(diffRecord({ a: 1, b: 2 }, { a: 1 }, []), [{ field: 'b', from: 2, to: undefined }]);
});

test('diffRecord returns empty when nothing changed', () => {
  assert.deepEqual(diffRecord({ a: 1 }, { a: 1 }, []), []);
});

test('historyEntry carries a unique id so entries union rather than overwrite on merge', () => {
  const a = historyEntry({ recordId: 'c1', recordType: 'comment', by: 'Harvey', nowIso: 'T', changes: [] });
  const b = historyEntry({ recordId: 'c1', recordType: 'comment', by: 'Harvey', nowIso: 'T', changes: [] });
  assert.notEqual(a.id, b.id);
  assert.equal(a.recordId, 'c1');
  assert.equal(a.by, 'Harvey');
});

test('createEntry marks creation with no changes', () => {
  const e = createEntry({ recordId: 'c1', recordType: 'comment', by: 'Harvey', nowIso: 'T' });
  assert.deepEqual(e.changes, []);
  assert.equal(e.recordId, 'c1');
});

test('historyFor filters to one record, newest first', () => {
  const h = [
    historyEntry({ recordId: 'c1', recordType: 'comment', by: 'A', nowIso: '2026-08-01T09:00:00Z', changes: [] }),
    historyEntry({ recordId: 'c2', recordType: 'comment', by: 'B', nowIso: '2026-08-01T10:00:00Z', changes: [] }),
    historyEntry({ recordId: 'c1', recordType: 'comment', by: 'C', nowIso: '2026-08-01T11:00:00Z', changes: [] }),
  ];
  const out = historyFor(h, 'c1');
  assert.deepEqual(out.map(e => e.by), ['C', 'A']);
});

test('historyFor is deterministic when timestamps tie', () => {
  const mk = by => historyEntry({ recordId: 'c1', recordType: 'comment', by, nowIso: 'T', changes: [] });
  const h = [mk('A'), mk('B')];
  assert.deepEqual(historyFor(h, 'c1').map(e => e.id), historyFor([...h].reverse(), 'c1').map(e => e.id));
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test`, FAIL (`diffRecord` not exported).

- [ ] **Step 3: Implement** in `assets/js/hub-sync.js`, near the other pure record helpers. Compare values with `JSON.stringify` as `conflictFields` already does, and record the same caveat comment about nested key order. Tie-break `historyFor` on `id` so two clients sort identically.

- [ ] **Step 4: Run to verify pass** — `npm test`.

- [ ] **Step 5: Commit**

```bash
git add assets/js/hub-sync.js tests/hub-sync.test.js
git commit -m "feat(hub-sync): append-only history primitives"
```

---

### Task 2: History in the Comments Hub ledger

**Files:**
- Modify: `assets/js/hub-core.js`
- Test: `tests/hub-core.test.js`

**Interfaces:**
- `emptyState` gains `history: []`.
- `mergeState` merges `history` with `mergeById` — **union by entry id, never last-write-wins**.
- History is NOT filtered by tombstones: a deleted comment's trail must survive.

- [ ] **Step 1: Write the failing test**

```js
test('emptyState has a history collection', () => {
  assert.deepEqual(emptyState('T').history, []);
});

test('mergeState unions history from both sides — no entry is ever lost', () => {
  const e = (id, recordId) => ({ id, recordId, recordType: 'comment', at: 'T', by: 'X', changes: [] });
  const local = { ...emptyState('T'), history: [e('h1', 'c1')] };
  const disk  = { ...emptyState('T'), history: [e('h2', 'c1')] };
  assert.deepEqual(mergeState(local, disk).history.map(x => x.id).sort(), ['h1', 'h2']);
});

test('history survives a tombstoned record — a deleted comment still has a trail', () => {
  const local = { ...emptyState('T'),
    history: [{ id: 'h1', recordId: 'c1', recordType: 'comment', at: 'T', by: 'X', changes: [] }],
    tombstones: { c1: '2026-08-02T10:00:00Z' } };
  assert.equal(mergeState(local, emptyState('T')).history.length, 1);
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test`.

- [ ] **Step 3: Implement.** Add `history: []` to `emptyState`; in `mergeState` merge it with `mergeById(l.history, d.history, {})` — pass an **empty** tombstone map, not the state's, so tombstones cannot delete history. Comment why.

- [ ] **Step 4: Run to verify pass.**

- [ ] **Step 5: Commit**

```bash
git add assets/js/hub-core.js tests/hub-core.test.js
git commit -m "feat(hub-core): history collection merged by entry id"
```

---

### Task 3: History in the Decision Register ledger

**Files:**
- Modify: `assets/js/brain-core.js`
- Test: `tests/brain-core.test.js`

Same change as Task 2, applied to `emptyBrainState` and `mergeBrainState`. Write the equivalent three tests against the brain's own functions — do not import hub-core.

- [ ] **Step 1–5:** as Task 2.

```bash
git commit -m "feat(brain-core): history collection merged by entry id"
```

---

### Task 4: Record history in the Comments Hub UI

**Files:**
- Modify: `tools-src/comments-hub.html`

Every mutation path records an entry. Find them all — `submitComment`, `mutateComment` (which `setCommentStatus`, `setCommentPriority`, `toggleCommentHold`, `closeOutComment`, `reopenComment` and `saveCommentEdit` all funnel through), `deleteComment`, and the intake commit path.

- [ ] **Step 1: Record on create** — `createEntry` for each new comment, including every row of an intake import (the trail must show a comment arrived by import, and from which file).
- [ ] **Step 2: Record on change** — in `mutateComment`, diff the record before and after, ignoring `updatedAt`, and append an entry when `changes` is non-empty. A no-op edit must not create a noise entry. Since every mutation funnels through here, this is one place, not seven.
- [ ] **Step 3: Record on delete** — an entry noting the deletion before the tombstone is written.
- [ ] **Step 4: Actor** is `getUserName()`. Never `raisedBy`/`closedBy`.
- [ ] **Step 5: Save** — history rides along in the same `queueSave`; do not add a second save cycle.
- [ ] **Step 6: Verify and commit** — make an edit, confirm one entry with the right before/after in `hub-data.json`.

```bash
git commit --allow-empty -m "feat(hub-ui): record every comment change in the history trail"
```

---

### Task 5: History viewer in the Comments Hub

**Files:**
- Modify: `tools-src/comments-hub.html`

- [ ] **Step 1:** A **History** section in the expanded comment row listing entries newest first: who, when, and what changed as `field: old → new`. Creation and deletion read as their own events, not as diffs.
- [ ] **Step 2:** Long text (descriptions, action taken) must be readable — show enough to see what changed rather than one truncated line.
- [ ] **Step 3:** Empty state for a comment with no recorded history, since comments created before this feature have none. Say so plainly rather than showing a blank panel.
- [ ] **Step 4:** Use existing chip/table styling, `escHtml` throughout — history holds text from other people's machines.
- [ ] **Step 5: Verify and commit** — edit a comment three times, confirm the trail reads correctly in order.

```bash
git commit --allow-empty -m "feat(hub-ui): comment history viewer"
```

---

### Task 6: Same for the Decision Register

**Files:**
- Modify: `tools-src/product-brain.html`

Mirror Tasks 4–5 for decisions and documents. Mutation paths: `saveDecisionForm` (edit and supersede), `deleteDecision`, document add/edit/remove.

**Supersede is a create plus a change** — a new decision record *and* a modification to the old one. Record both, so the chain reads correctly from either end.

- [ ] **Steps as Tasks 4–5**, then commit.

```bash
git commit --allow-empty -m "feat(brain-ui): decision history recording and viewer"
```

---

### Task 7: Verification and publish

- [ ] **Step 1:** `npm test` — all green.
- [ ] **Step 2: The merge test that matters.** Two windows, same folder. Edit the *same* comment in both, save both, then check the history. **Both edits must appear.** This is the case the naive record-nested design would have silently lost, and the whole reason for the separate collection.
- [ ] **Step 3:** Confirm a deleted comment keeps its trail.
- [ ] **Step 4:** Confirm ledger growth is sane after ~20 edits — history entries are small, but check nothing is storing whole record copies.
- [ ] **Step 5: Publish** *(owner runs this — prompts for the workshop code)*

```bash
node scripts/lock-tools.mjs
git add tools/ && git commit -m "build: republish tools with audit trail"
git push
```
