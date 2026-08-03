# Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the shared-folder logic survives conditions far worse than real use, before colleagues start using these tools for real work.

**Architecture:** Automated tests only. No behaviour changes unless a test uncovers a genuine defect — in which case the defect gets fixed and the test stays as the regression.

**Tech Stack:** `node --test`. Baseline **374 tests passing**.

## Why now

Every hour of use so far has been by the person who wrote these tools. That is a specific blind spot: the author knows which paths are destructive and which folder to connect. Real users know none of it, the tools share one folder, and the failure modes are silent and collective — one person's bad save is everyone's bad save.

## The risks, ordered by damage

1. **Divergence.** Two users' ledgers permanently disagree because merge is not order-independent. Silent, unrecoverable by the user, and the entire shared-folder model rests on it never happening. **Currently untested.**
2. **Injection and render breakage.** Names and descriptions written on other people's machines are rendered into `innerHTML`. Escaping exists but has never been systematically tested.
3. **Crash on malformed data.** One bad record making a tool fail to load — for everyone, since the ledger is shared.
4. **Scale.** Months of comments across a team; a register of thousands of tags.
5. **Clock skew.** Timestamps decide who wins a merge, and workstation clocks drift.

## Global Constraints

- **Tests only.** If a test reveals a defect, fix it and keep the test as a regression — but do not refactor opportunistically.
- No production behaviour change without a failing test that justifies it.
- Tests must be **deterministic**: seed any randomness, never depend on wall-clock time or execution order.
- Keep the suite fast. Scale tests should assert complexity, not stopwatch numbers that will flake on a loaded machine.

---

### Task 1: Merge convergence and idempotency (highest value)

**Files:** `tests/merge-properties.test.js` (new)

The shared folder has no server. Every client merges independently, so merge **must** be order-independent or clients drift apart permanently — each convinced it is right.

Test `mergeState` (hub), `mergeBrainState` (brain) and the register's merge behaviour for these properties, using seeded pseudo-random records so failures reproduce:

- [ ] **Idempotent:** `merge(a, a) === a`, and `merge(merge(a,b), b) === merge(a,b)`.
- [ ] **Commutative in effect:** `merge(a,b)` and `merge(b,a)` agree on every record's final value. (Field order may differ; compare semantically.)
- [ ] **Associative in effect:** a three-way merge reaches the same state whatever order clients see each other's changes — the real scenario with three users on one folder.
- [ ] **Tombstones win regardless of order**, and a later edit still beats an older tombstone in every ordering.
- [ ] **History unions**, never loses an entry, in any order (this is why history is a top-level collection).
- [ ] **Ref assignment is deterministic:** two clients merging the same set independently produce identical refs. A disagreement here means two people quoting different refs for the same comment.
- [ ] **Convergence under repeated random merges:** simulate three clients making random edits and syncing in random order for many rounds; assert all three end identical.

Any failure here is a serious defect, not a test bug. Investigate before assuming the test is wrong.

- [ ] **Commit** — `test: merge convergence and idempotency properties`

---

### Task 2: Malformed and hostile input

**Files:** `tests/hostile-input.test.js` (new)

A ledger is written by another tool and may be read mid-write, hand-edited, or corrupted by a sync client. **No pure function may throw on any input.**

- [ ] **Every exported pure function** across `hub-core.js`, `hub-sync.js`, `brain-core.js`, `hub-presence.js`, `hub-intake.js` and `pid-comments.js`, called with: `undefined`, `null`, `0`, `''`, `[]`, `{}`, `NaN`, a string where an object is expected, an array where a scalar is expected, and deeply nested nonsense. Assert **no throw** — degraded output is fine, an exception is not.
- [ ] **Records with wrong-typed fields:** `productIds` a string, `status` a number, `updatedAt` an object, `id` null, dates as `'not-a-date'`.
- [ ] **Structurally valid but semantically broken:** duplicate ids, self-referencing supersede chains, a comment referencing itself, tombstones for records that never existed.
- [ ] **Adversarial strings** through every text path: `<script>`, `"><img onerror=x>`, `{{7*7}}`, null bytes, RTL overrides, 10,000-character single words, emoji, combining characters, and strings that look like JSON. Assert they round-trip through merge and Excel-model building **unchanged** — mangling is a bug, and so is executing.
- [ ] **Commit** — `test: no pure function throws on malformed or hostile input`

---

### Task 3: Escaping audit

**Files:** `tests/escaping-audit.test.js` (new)

Names and descriptions from other machines reach `innerHTML`. This cannot be fully verified without a browser, so the test asserts what it can and the audit records the rest.

- [ ] **Static audit:** scan each `tools-src/*.html` for `innerHTML` assignments that interpolate a value, and assert every interpolation of ledger-derived data passes through `escHtml`/`escAttr`. Fail with the offending line so it is actionable.
- [ ] Treat this as a **linting test with known exceptions**, listing any deliberate raw-HTML cases explicitly so a new one cannot slip in unnoticed.
- [ ] Where an unescaped interpolation of user data is found, **fix it** and note it in the report — that is a live vulnerability, not a hypothetical.
- [ ] **Commit** — `test: audit ledger-derived values reaching innerHTML`

---

### Task 4: Scale

**Files:** `tests/scale.test.js` (new)

- [ ] Build ledgers far beyond realistic use: **10,000 comments**, 2,000 products, 200 families, 5,000 drawings, 50,000 tags, 5,000 history entries.
- [ ] Assert merge, filter, workbook-model building, comment counting and history lookup all complete and produce correct results.
- [ ] Assert **algorithmic** behaviour rather than wall-clock: e.g. doubling the input does not roughly quadruple the work, catching accidental O(n²) joins. Use generous bounds so a loaded machine does not cause flakes.
- [ ] Note in the report anything that looks quadratic even if it passes — the register already holds 4,600 tags and will grow.
- [ ] **Commit** — `test: scale behaviour well beyond realistic use`

---

### Task 5: Clock skew and time-dependent behaviour

**Files:** `tests/clock-skew.test.js` (new)

Timestamps decide merge winners, presence liveness and tombstone precedence. Workstation clocks drift, and one machine set wrong could corrupt shared state for everyone.

- [ ] A record from a machine **hours ahead** must not permanently win every future merge in a way that silently discards correct edits — characterise what actually happens and assert it.
- [ ] Presence already handles future skew; assert it still holds under extreme values (days ahead, days behind, epoch, year 3000).
- [ ] Backup filename generation and pruning remain correct and ordered under skewed timestamps.
- [ ] Ref sequencing stays deterministic when `createdAt` values are skewed.
- [ ] Mixed timestamp formats — with and without milliseconds, with an offset instead of `Z` — since string comparison underpins the merge. **Flag any case where a semantically-later timestamp compares as earlier**; that is a real defect.
- [ ] **Commit** — `test: time skew and timestamp format edge cases`

---

### Task 6: Report and fix

- [ ] **Step 1:** `npm test` — all green.
- [ ] **Step 2:** Write `docs/superpowers/HARDENING-2026-08-03.md`: what was tested, what broke, what was fixed, and — importantly — **what remains unverifiable without a browser**, so nobody mistakes this for full coverage.
- [ ] **Step 3:** List anything found but deliberately not fixed, with reasoning.
- [ ] **Step 4: Commit** — `docs: hardening results`

## Explicitly out of scope

- Browser and DOM behaviour, the File System Access API, and real multi-window interaction. These need a human at a keyboard; the report must say so plainly rather than implying the tools are proven end to end.
