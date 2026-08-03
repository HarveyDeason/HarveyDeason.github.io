# P&ID Comment Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a drawing's comment badge in the P&ID Tag Register shows the open comments raised against it, read-only.

**Architecture:** The join (drawing → products → comments) already exists as `commentCountsByDrawing` in `assets/js/pid-comments.js`. This adds a sibling returning the comment records themselves, and a panel in the tool that renders them. The P&ID tool remains a strict **reader** of `hub-data.json`.

**Tech Stack:** Vanilla ES modules, File System Access API, `node --test`. Baseline **352 tests passing**.

## Why this before the product dossier

The dossier must assemble per-product state from all three ledgers. This builds and proves the drawing → product → comment join in a small, testable piece the dossier can then consume, rather than that join being written twice with the second attempt under more pressure.

## Scope

**In:** open comments only, read-only, per drawing.

**Out, deliberately:** closed comments, linked decisions, product listings, and any ability to raise or edit a comment from here. Raising a comment would mean the P&ID tool **writing** to a ledger it does not own — breaking the read-only rule that currently guarantees it cannot damage another tool's data. Revisit only if switching tools proves genuinely annoying in practice.

## Global Constraints

- `assets/js/pid-comments.js` stays pure and node-testable: no DOM, no File System Access.
- **`hub-data.json` is strictly read-only to this tool.** Never written, created, or repaired — it belongs to the Comments Hub.
- **Do not modify the Comments Hub or the Decision Register.**
- Treat `hub-data.json` as untrusted: it is written by another tool and may be read mid-write. Malformed shapes degrade to "no comments", never throw.
- `tools-src/` is gitignored — commit UI work with `git commit --allow-empty`. Never run `lock-tools.mjs`.
- No hardcoded colours — `site.css`/`tool.css` tokens only. Escape everything from the ledger before it reaches `innerHTML`.

---

### Task 1: `openCommentsByDrawing` (pure)

**Files:**
- Modify: `assets/js/pid-comments.js`
- Test: `tests/pid-comments.test.js`

**Interfaces:**
- `openCommentsByDrawing(hubData) -> Map<drawingName, comment[]>` — open comments only, grouped by drawing, each list sorted **high priority first, then oldest first** (the order someone triaging a drawing wants).

Shares the join with `commentCountsByDrawing`: a product carries `pidDrawings[]`, a comment carries `productIds[]`. A comment naming several products that share a drawing must appear **once** for that drawing.

- [ ] **Step 1: Write the failing tests.** Cover: a comment appearing against every drawing of its product; a comment spanning two products sharing a drawing listed once; only `open` included (not `in_progress`, not `closed`); sort order with mixed priorities and dates; a comment referencing a missing product ignored without throwing; malformed or empty hub data returning an empty Map; and a product whose `pidDrawings` is not an array degrading rather than throwing.
- [ ] **Step 2:** Run to confirm they fail.
- [ ] **Step 3:** Implement, factoring the shared join so `commentCountsByDrawing` keeps its exact current behaviour — it is live and tested; do not change its output.
- [ ] **Step 4:** Run to confirm they pass, including all pre-existing tests.
- [ ] **Step 5: Commit**

```bash
git add assets/js/pid-comments.js tests/pid-comments.test.js
git commit -m "feat(pid-comments): open comments grouped by drawing"
```

---

### Task 2: The panel

**Files:**
- Modify: `tools-src/pid-tag-register.html`

- [ ] **Step 1:** Store the grouped comments alongside the existing counts when `hub-data.json` is read in `refreshCommentCounts` — one read, both results. Do not add a second read or a second timer.
- [ ] **Step 2:** Make the existing comment badge clickable, opening a panel listing that drawing's open comments: **ref, priority, date raised, raised by, and the description**. Descriptions run long — show enough to be useful rather than one truncated line.
- [ ] **Step 3:** Make it obvious the panel is read-only and that comments are managed in the Comments Hub, so nobody hunts for an edit button that will never exist.
- [ ] **Step 4:** Handle the empty and unavailable cases plainly: legacy mode (no hub link), no `hub-data.json`, or a drawing with no open comments should each read sensibly rather than showing a blank panel.
- [ ] **Step 5:** Refresh the panel contents on the existing refresh tick if it is open, so it does not sit showing stale comments.
- [ ] **Step 6: Verify** against the real hub folder: a drawing with comments matches what the Comments Hub shows for the same drawing; a drawing with none reads correctly; legacy mode shows no badges and no panel.
- [ ] **Step 7: Commit**

```bash
git commit --allow-empty -m "feat(pid-ui): read-only comment panel per drawing"
```

---

### Task 3: Verification and publish

- [ ] **Step 1:** `npm test` — all green.
- [ ] **Step 2:** Confirm `hub-data.json` is still only ever opened with `create: false` and never written.
- [ ] **Step 3:** Confirm the safety work from `2026-08-03-pid-register-safety.md` is untouched — particularly that `clearAll` while disconnected still leaves the register intact, since that is the regression that matters most in this tool.
- [ ] **Step 4:** Confirm the Comments Hub and Decision Register are unaffected.
- [ ] **Step 5: Publish** *(owner runs this — prompts for the workshop code)*

```bash
node scripts/lock-tools.mjs
git add tools/ && git commit -m "build: republish tools with P&ID comment panel"
git push
```
