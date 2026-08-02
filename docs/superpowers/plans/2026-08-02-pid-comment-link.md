# P&ID → Comments Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show, against each drawing in the P&ID Tag Register, how many open comments exist for the products that drawing belongs to — closing the last missing hop in the chain drawing → product → comment → decision.

**Architecture:** The P&ID tool connects to the **hub root** (like the other two tools) and locates its own `register.json` in a subfolder. It then reads `hub-data.json` read-only for comment counts. A **legacy mode** preserves today's behaviour for anyone connecting the register folder directly.

**Tech Stack:** Vanilla ES modules, File System Access API, `node --test`.

## Why the tool cannot do this today

The File System Access API has **no upward traversal** — a directory handle cannot reach its parent, and `resolve()` only works downward from an ancestor you already hold. The P&ID tool connects to the register subfolder, so `hub-data.json` one level up is unreachable. Connecting to the root instead is what unblocks this, and every future cross-tool link.

## THE RISK — read before writing any code

`dirHandle` is currently used **directly** to read and write `register.json` and the `archive/` folder (18 references). If the user connects the hub root and nothing else changes, the tool writes a **second, empty `register.json` into the hub root**.

That is not a cosmetic bug. The Comments Hub scans subfolders for `register.json`, there would now be two, and the P&ID tool's real data would appear lost to its users. **Treat any path that writes `register.json` or touches `archive/` as the dangerous part of this change.**

The fix is a clean split, done first, before any feature work:

- **`dirHandle`** — the folder the user actually connected. Used only for the folder chip, connect/disconnect, and the new `hub-data.json` read.
- **`registerDir`** — where `register.json` and `archive/` live. **Every existing read and write must move to this.** In legacy mode it is the same object as `dirHandle`.

## Global Constraints

- `npm test` runs `node --test`. Baseline: **304 passing**.
- Pure logic goes in `assets/js/`, node-testable, no DOM. The P&ID tool currently has no extracted core module; put new pure logic in a new `assets/js/pid-comments.js` rather than inline in the HTML, so it can be tested.
- **`hub-data.json` is strictly read-only to this tool.** It never writes it, never repairs it, never creates it. Same rule the Comments Hub applies to `register.json`, in reverse.
- **The Comments Hub and Decision Register are not modified by this plan.**
- `tools-src/` is gitignored — commit UI tasks with `git commit --allow-empty`. Never run `lock-tools.mjs`; that is the owner's step.
- No hardcoded colours — `site.css`/`tool.css` tokens only.
- Degrade silently: no hub data, unreadable hub data, or legacy mode all mean "no badges", never an error.

---

### Task 1: Split `dirHandle` from `registerDir` (no behaviour change)

**Files:**
- Modify: `tools-src/pid-tag-register.html`

This task must produce **zero user-visible change**. It is pure groundwork, done separately so that if something breaks later the cause is obvious.

- [ ] **Step 1:** Add a module-scoped `registerDir`, set to the same handle as `dirHandle` on connect.
- [ ] **Step 2:** Move **every** `register.json` and `archive/` read/write onto `registerDir`. Work through all 18 `dirHandle` references (lines ~949, 1382, 2377, 2384, 2402, 2670, 2697, 2703–2705, 2810–2818, 2840–2851, 2866–2868, 2884–2892). Leave the folder chip, connect and disconnect on `dirHandle`.
- [ ] **Step 3:** Clear both on disconnect.
- [ ] **Step 4: Verify by hand** — connect a scratch folder, add a tag, confirm `register.json` and `archive/` land exactly where they did before, and that reconnecting reads them back.
- [ ] **Step 5: Commit**

```bash
git commit --allow-empty -m "refactor(pid-ui): separate the connected folder from the register folder"
```

---

### Task 2: Locate the register folder on connect

**Files:**
- Modify: `tools-src/pid-tag-register.html`

**Detection order, and it matters:**

1. **`register.json` directly in the connected folder** → legacy mode. `registerDir = dirHandle`, no hub link. An existing register folder always wins, so nobody's current setup changes.
2. **`hub-data.json` in the connected folder** → this is the hub root. Find the subfolder containing `register.json`; if none exists yet, use the conventional `P&ID Register` subfolder, creating it only when the user first saves.
3. **A subfolder contains `register.json`** → hub root. `registerDir` = that subfolder.
4. **Otherwise** (a fresh, empty folder) → legacy mode, exactly as today.

Case 2 exists because a hub root whose register subfolder is still empty would otherwise fall through to case 4 and write `register.json` into the root — the precise failure this plan is guarding against. `hub-data.json` is the reliable marker that a folder is the hub root.

- [ ] **Step 1:** Implement detection as a small pure function in `assets/js/pid-comments.js` — given "is there a register here / is there hub-data here / which subfolders have a register", return the mode. Unit-test the four cases plus the ambiguous ones, in `tests/pid-comments.test.js`.
- [ ] **Step 2:** Wire it into `connectFolder`.
- [ ] **Step 3:** Show the resolved mode in the folder chip, so a user can see whether comment badges are available and why not.
- [ ] **Step 4: Verify by hand — all four cases**, including connecting a hub root whose register subfolder is empty, and confirm no stray `register.json` ever appears in the root.
- [ ] **Step 5: Commit**

```bash
git commit --allow-empty -m "feat(pid-ui): connect to the hub root and locate the register folder"
```

---

### Task 3: Comment counts per drawing (pure)

**Files:**
- Create: `assets/js/pid-comments.js` (extend from Task 2)
- Test: `tests/pid-comments.test.js`

**Interfaces:**
- `commentCountsByDrawing(hubData) -> Map<drawingNumber, { open, inProgress, closed }>`

The join: a hub **product** carries `pidDrawings[]`; a hub **comment** carries `productIds[]`. So a drawing's comments are the comments of every product listing that drawing. A comment on a product spanning three drawings counts against all three — that is correct, it genuinely affects all of them.

- [ ] **Step 1: Write the failing test.** Cover: a drawing with no products; a product with no comments; one comment counted against every drawing of its product; a comment spanning two products that share a drawing counted **once**, not twice; closed and in-progress counted separately; tombstoned/missing products ignored without throwing; malformed hub data returning an empty map rather than throwing.
- [ ] **Step 2–4:** Implement, run, confirm.
- [ ] **Step 5: Commit**

```bash
git add assets/js/pid-comments.js tests/pid-comments.test.js
git commit -m "feat(pid-comments): comment counts per drawing"
```

---

### Task 4: Read hub data and badge the drawings

**Files:**
- Modify: `tools-src/pid-tag-register.html`

- [ ] **Step 1:** In hub-root mode only, read `hub-data.json` from `dirHandle` — **read-only, never written**. Parse failure or a missing file means no badges, silently.
- [ ] **Step 2:** Refresh the counts on the same tick as the existing register refresh, so badges do not go stale while the tool is open. Do not add a second timer.
- [ ] **Step 3:** Badge each drawing with its open-comment count. Zero shows nothing rather than a "0" — noise on every row helps nobody. Include in-progress and closed in the tooltip.
- [ ] **Step 4:** Clicking a badge is out of scope for this plan; a tooltip naming the top few refs is enough. Note it as a follow-up.
- [ ] **Step 5: Verify by hand** — a drawing with comments shows a count matching the Comments Hub; adding a comment in the hub updates the badge on the next refresh; legacy mode shows no badges and no errors.
- [ ] **Step 6: Commit**

```bash
git commit --allow-empty -m "feat(pid-ui): open-comment badges per drawing"
```

---

### Task 5: Verification and publish

- [ ] **Step 1:** `npm test` — all green.
- [ ] **Step 2: The regression that matters most.** In legacy mode (connecting the register folder directly), confirm the tool behaves **exactly** as before: register saves to the right place, `archive/` still works, no errors, no badges. Existing users must notice nothing.
- [ ] **Step 3:** Confirm no stray `register.json` in the hub root under any of the four connect cases.
- [ ] **Step 4:** Confirm the Comments Hub still finds the register and is otherwise untouched.
- [ ] **Step 5: Publish** *(owner runs this — prompts for the workshop code)*

```bash
node scripts/lock-tools.mjs
git add tools/ && git commit -m "build: republish tools with P&ID comment badges"
git push
```
