# Product Brain Multi-User Safety — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Product Brain to the same concurrency safety as the Comments Hub — no stale screens, no silent same-record clobber, no half-written ledger, recoverable backups — by consuming the shared primitives that plan already builds.

**Architecture:** No new pure modules. Every primitive (`writeFileAtomic`, dated backups, `detectConflict`, `conflictFields`, `stampEnteredBy`, and the whole of `hub-presence.js`) is built and unit-tested by `2026-07-30-hub-multi-user.md` in modules Product Brain already shares. This plan is UI wiring in `tools-src/product-brain.html` plus one config change.

**Tech Stack:** Vanilla ES modules, File System Access API (Chromium), `node --test`.

## Prerequisite

**`docs/superpowers/plans/2026-07-30-hub-multi-user.md` Tasks 1–4 must be complete and committed
before starting.** They create everything this plan consumes. Task 1 (atomic write) additionally
applies to Product Brain the moment it lands, with no work here — `createSyncEngine.saveNow` is
shared code.

Verify before starting:

```bash
npm test && grep -c "writeFileAtomic\|detectConflict\|backupFileName" assets/js/hub-sync.js
```

Expected: tests PASS, count ≥ 3.

## Global Constraints

- `npm test` runs `node --test`. No new test files are needed — the shared logic is already covered.
- `PRESENCE_TIMEOUT_MS = 90000`, `PRESENCE_HEARTBEAT_MS = 20000` — imported from `hub-presence.js`, never redefined.
- Person-field rule: **fields describing who did real-world work are NEVER pre-filled.** For decisions this means the "decided by" / owner fields stay hand-entered. `enteredBy` is the only auto-stamped identity.
- Presence is **never load-bearing**: if `presence/` cannot be created or written, every other feature must continue working unchanged.
- No hardcoded colours — `site.css` / `tool.css` tokens only.
- `tools-src/` is **gitignored**. UI changes reach `tools/` only via `node scripts/lock-tools.mjs`, which prompts for the workshop code. **Harvey runs that step** (Task 7) — never attempt it, and never write the workshop code into any file.
- Product Brain shares its hub folder with the Comments Hub and **reads `hub-data.json`** (`hubState`). Its own ledger is `brain-data.json`. Presence is shared: both tools write into the same `presence/` folder, so a person in either tool is visible to both. Presence records therefore carry a `tool` field.

## Prior-Art Notes (read before starting)

Product Brain mirrors the Comments Hub almost exactly. Do not reimplement:

- `createSyncEngine` config at `tools-src/product-brain.html:987-989` (`fileName: 'brain-data.json'`, `backupName: 'brain-data.backup.json'`).
- `refreshFromDisk` at `:2656`, `startAutoRefresh` at `:2687` (90s interval), `renderAll` at `:2514`, `connectFolder` at `:2583`, `renderSettings` at `:2488`, folder chip at `:521`, Settings section at `:587`.
- Edit state is `decisionForm` (null when closed; `{ mode, editingId, links, vals }` when open) at `:1190-1206`, `editingDocId` at `:1907`, and `commentPicker`.

`refreshFromDisk` calls `renderAll()` unconditionally at `:2676` — the **same live bug** as the hub: a timer tick or window focus while someone is mid-decision repaints the form and discards their typing. Task 2 fixes it.

---

### Task 1: Dated backups for the brain ledger

**Files:**
- Modify: `tools-src/product-brain.html:987-989`

**Interfaces:**
- Consumes: `cfg.backupDir`, `cfg.backupKeep` from `createSyncEngine` (hub plan Task 2).
- Produces: nothing new.

- [ ] **Step 1: Add the backup folder to the engine config**

At `tools-src/product-brain.html:987`, extend the `createSyncEngine` config:

```js
    backupDir: async () => {
      if (!dirHandle) return null;
      try { return await dirHandle.getDirectoryHandle('backups', { create: true }); }
      catch (e) { return null; }   // fall back to the single rolling backup
    },
    backupKeep: 20,
```

Both tools write into the same `backups/` folder. Their filenames differ by stem
(`brain-data-*.json` vs `hub-data-*.json`) and `prunableBackups` matches on the full pattern, so
each tool prunes only its own files.

- [ ] **Step 2: Verify**

Connect a scratch folder, make 3 edits, and confirm `backups/` contains dated `brain-data-*.json`
files and that existing `hub-data-*.json` files are untouched.

- [ ] **Step 3: Commit**

```bash
git commit --allow-empty -m "feat(brain-ui): dated backup rotation for brain-data ledger"
```

---

### Task 2: Refresh hardening

**Files:**
- Modify: `tools-src/product-brain.html:2656-2700`

**Interfaces:**
- Produces: `isMidEdit() -> boolean`, `pendingUpdates` flag, `updateSyncHint()`.

- [ ] **Step 1: Add the mid-edit guard**

Above `refreshFromDisk` at `tools-src/product-brain.html:2656`:

```js
  // A refresh that repaints while someone is mid-decision throws their work
  // away. Every place real input lives must be checked here.
  function isMidEdit() {
    if (decisionForm) return true;        // new / edit / supersede form is open
    if (editingDocId !== null) return true;
    if (commentPicker) return true;
    return false;
  }
  let pendingUpdates = false;
  let lastSeenMtime = 0;
```

- [ ] **Step 2: Make the poll cheap and defer the repaint**

In `refreshFromDisk`, insert at the very top of the function body, before the existing
`refreshing` guard's work begins:

```js
    if (!dirHandle || refreshing) return;
    // A timer tick only needs to know whether anything changed. getFile() reads
    // metadata, not contents, so this costs a fraction of a full read.
    if (reason === 'timer') {
      try {
        const fh = await dirHandle.getFileHandle('brain-data.json', { create: false });
        const mtime = (await fh.getFile()).lastModified;
        if (mtime === lastSeenMtime) return;
      } catch (e) { /* missing file: fall through to the full read */ }
    }
    if (isMidEdit() && reason !== 'manual') { pendingUpdates = true; updateSyncHint(); return; }
```

Then, immediately after the existing successful merge (where `state` is reassigned from the
ledger, around `:2670`), record the timestamp and clear the flag:

```js
      try {
        const fh = await dirHandle.getFileHandle('brain-data.json', { create: false });
        lastSeenMtime = (await fh.getFile()).lastModified;
      } catch (e) { /* nothing to record */ }
      pendingUpdates = false;
      updateSyncHint();
```

- [ ] **Step 3: Add the sync hint**

Beneath `refreshFromDisk`:

```js
  function updateSyncHint() {
    const chip = document.getElementById('folder-chip');
    if (!chip) return;
    chip.dataset.pending = pendingUpdates ? 'yes' : 'no';
    chip.title = pendingUpdates
      ? 'Updates from the team are waiting — they will appear when you finish editing.'
      : (lastRefresh ? 'Last synced ' + new Date(lastRefresh).toTimeString().slice(0, 5) : '');
  }
```

- [ ] **Step 4: Shorten the interval**

At `tools-src/product-brain.html:2689`, change `90000` to `20000`. The mtime pre-check makes the
faster tick cheap.

- [ ] **Step 5: Apply deferred updates when editing ends**

At the end of `saveDecisionForm()` (`:1393`) and wherever `decisionForm` is set back to `null`
(cancel paths), and where `editingDocId` is cleared, add:

```js
    if (pendingUpdates) refreshFromDisk('deferred');
```

- [ ] **Step 6: Verify in two windows and commit**

Two windows on one scratch folder. In A open a decision form and type reasoning; in B add a
decision. Confirm A does **not** repaint, the chip tooltip reports waiting updates, and B's
decision appears once A's form closes.

```bash
git commit --allow-empty -m "fix(brain-ui): never repaint mid-edit; cheap mtime poll for refresh"
```

---

### Task 3: Local identity

**Files:**
- Modify: `tools-src/product-brain.html`

**Interfaces:**
- Consumes: `stampEnteredBy` (hub plan Task 4).
- Produces: `getUserName()`, `setUserName(name)`, `ensureUserName()`, module-scoped `sessionId`.

- [ ] **Step 1: Add identity helpers**

Near the other small helpers at the top of the module script:

```js
  // ── Local identity ────────────────────────────────────────────────────────
  // Shared verbatim with the Comments Hub, including the storage key, so one
  // name covers both tools. Stamped onto enteredBy only — never onto fields
  // describing who made the decision, which is routinely somebody else.
  const USER_KEY = 'hub-user-name';
  const sessionId = crypto.randomUUID();
  function getUserName() {
    try { return localStorage.getItem(USER_KEY) || ''; } catch (e) { return ''; }
  }
  function setUserName(name) {
    try { localStorage.setItem(USER_KEY, String(name || '').trim()); } catch (e) { /* private mode */ }
  }
  async function ensureUserName() {
    if (getUserName()) return getUserName();
    const entered = prompt('Your name (shown to others, and recorded against records you enter):');
    if (entered && entered.trim()) setUserName(entered.trim());
    return getUserName();
  }
```

- [ ] **Step 2: Prompt on connect**

In `connectFolder` (`:2583`), immediately after the directory picker succeeds:

```js
    await ensureUserName();
```

- [ ] **Step 3: Stamp `enteredBy` on saved decisions**

In `saveDecisionForm()` (`:1393`), apply the stamp to the record before it enters `state`:

```js
    const record = HubSync.stampEnteredBy(decision, getUserName());
```

Use `record` where the raw decision object was used. Leave every "decided by" / owner field
exactly as typed.

- [ ] **Step 4: Add a name field to Settings**

In the Settings section (`:587`):

```html
          <div class="form-row">
            <label class="form-label" for="set-username">Your name</label>
            <input type="text" id="set-username" class="form-input" placeholder="Name"/>
            <p class="form-hint">Recorded against records you enter, and shown to others. Not used for who made the decision.</p>
          </div>
```

In `renderSettings()` (`:2488`):

```js
    const nameInput = document.getElementById('set-username');
    if (nameInput) {
      nameInput.value = getUserName();
      nameInput.onchange = () => { setUserName(nameInput.value); renderAll(); };
    }
```

- [ ] **Step 5: Verify and commit**

Confirm the prompt appears once, that a name already set in the Comments Hub is picked up without
prompting, and that a saved decision carries `enteredBy` in `brain-data.json`.

```bash
git commit --allow-empty -m "feat(brain-ui): local identity and enteredBy stamping"
```

---

### Task 4: Presence and soft lock on decisions

**Files:**
- Modify: `tools-src/product-brain.html`

**Interfaces:**
- Consumes: `hub-presence.js` (hub plan Task 3), `HubSync.writeFile` (hub plan Task 1).
- Produces: `presenceRecords`, `setEditing(recordId)`, `renderPresence()`.

- [ ] **Step 1: Import the module**

Alongside the existing `HubSync` / `BrainCore` imports:

```js
  import * as HubPresence from '/assets/js/hub-presence.js';
```

- [ ] **Step 2: Add the heartbeat**

```js
  // ── Presence ──────────────────────────────────────────────────────────────
  // Best-effort by design: if presence/ is unwritable the tool carries on
  // exactly as before. Nothing here may block a save or an edit.
  // The folder is shared with the Comments Hub, so `tool` distinguishes who is
  // where — a decision lock must not be confused with a comment lock.
  let presenceDirHandle = null;
  let presenceRecords = [];
  let editingRecordId = null;

  async function heartbeat() {
    if (!presenceDirHandle) return;
    const rec = HubPresence.presenceRecord({
      name: getUserName() || 'Someone', sessionId, tool: 'brain',
      editingCommentId: editingRecordId, nowIso: nowIso(),
    });
    try {
      await HubSync.writeFile(presenceDirHandle, HubPresence.presenceFileName(sessionId), JSON.stringify(rec));
    } catch (e) { return; }
    const records = [];
    try {
      for await (const entry of presenceDirHandle.values()) {
        if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue;
        try { records.push(JSON.parse(await (await entry.getFile()).text())); } catch (e) { /* mid-write */ }
      }
    } catch (e) { return; }
    presenceRecords = records;
    for (const dead of HubPresence.sweepable(records, Date.now())) {
      if (dead === sessionId) continue;
      try { await presenceDirHandle.removeEntry(HubPresence.presenceFileName(dead)); } catch (e) { /* raced */ }
    }
    renderPresence();
  }

  function setEditing(recordId) { editingRecordId = recordId; void heartbeat(); }

  // Only 'brain' sessions can hold a decision lock, but everyone in the folder
  // is worth showing in the "also here" strip.
  function brainRecords() { return HubPresence.ofTool(presenceRecords, 'brain'); }

  function renderPresence() {
    const box = document.getElementById('presence-strip');
    if (!box) return;
    const live = HubPresence.livePresences(presenceRecords, sessionId, Date.now());
    box.innerHTML = live.length
      ? 'Also here: ' + live.map(r => escHtml(r.name) + (r.tool === 'brain' ? '' : ' (hub)')).join(', ')
      : '';
  }
```

- [ ] **Step 3: Create the folder on connect and start the heartbeat**

In `connectFolder`, after the other directory handles are obtained:

```js
      try {
        presenceDirHandle = await dirHandle.getDirectoryHandle('presence', { create: true });
        void heartbeat();
        setInterval(() => { void heartbeat(); }, HubPresence.PRESENCE_HEARTBEAT_MS);
      } catch (e) { presenceDirHandle = null; }   // presence is never load-bearing
```

Add the strip beside the folder chip at `:521`:

```html
        <span id="presence-strip" class="presence-strip"></span>
```

- [ ] **Step 4: Mark and release the lock**

In `editDecision(id)` (`:1193`) and `startSupersede(id)` (`:1200`), after `decisionForm` is set:

```js
    setEditing(id);
```

In `newDecision()` (`:1188`), and at the end of `saveDecisionForm()` and every cancel path:

```js
    setEditing(null);
```

- [ ] **Step 5: Badge locked decisions**

In the decisions table renderer, for each row:

```js
    const heldBy = HubPresence.editorOf(brainRecords(), d.id, sessionId, Date.now());
    const lockBadge = heldBy
      ? '<span class="chip chip-muted" title="' + escAttr(heldBy + ' has this open. You can still edit it.') + '">' +
        escHtml(heldBy) + ' is editing</span>'
      : '';
```

Render `lockBadge` in the row. When `heldBy` is set, the Edit control shows the badge and the form
opens with a one-line banner plus an **Edit anyway** button. **Never disable the control
outright** — a stale record must never lock someone out of their own tool.

- [ ] **Step 6: Release on unload**

```js
  window.addEventListener('beforeunload', () => {
    if (!presenceDirHandle) return;
    try { presenceDirHandle.removeEntry(HubPresence.presenceFileName(sessionId)); } catch (e) { /* best effort */ }
  });
```

- [ ] **Step 7: Verify and commit**

Two windows, different names. Edit a decision in A; confirm B badges it within ~20s and **Edit
anyway** still opens it. Open the Comments Hub in a third window and confirm it appears in the
strip marked `(hub)` but never holds a decision lock.

```bash
git commit --allow-empty -m "feat(brain-ui): presence strip and soft lock on decisions"
```

---

### Task 5: Save-time conflict prompt

**Files:**
- Modify: `tools-src/product-brain.html`

**Interfaces:**
- Consumes: `detectConflict`, `conflictFields` (hub plan Task 4).

- [ ] **Step 1: Snapshot the record when the form opens**

```js
  let editingSnapshot = null;   // the record as it looked when the form opened
```

In `editDecision(id)` and `startSupersede(id)`, alongside `setEditing(id)`:

```js
    editingSnapshot = state.decisions.find(x => x.id === id) || null;
```

In `newDecision()`, set `editingSnapshot = null` — a brand-new record cannot conflict.

- [ ] **Step 2: Check before committing the edit**

At the top of `saveDecisionForm()` (`:1393`), before the mutation is applied — and only when
`decisionForm.mode === 'edit'`:

```js
    if (decisionForm && decisionForm.mode === 'edit' && editingSnapshot) {
      const ledger = await engine.readLedger();
      const disk = ledger.status === 'ok' ? (ledger.data.decisions || []) : [];
      const theirs = HubSync.detectConflict(editingSnapshot, disk);
      if (theirs) {
        const fields = HubSync.conflictFields(editingSnapshot, theirs).join(', ');
        const keepMine = confirm(
          'Someone else changed this decision while you had it open.\n\n' +
          'Changed: ' + fields + '\n\n' +
          'OK = keep your version (overwrites theirs)\n' +
          'Cancel = discard yours and load theirs');
        if (!keepMine) {
          state = BrainCore.mergeState(state, ledger.data);
          decisionForm = null; editingSnapshot = null; setEditing(null);
          renderAll();
          return;
        }
      }
    }
```

`saveDecisionForm` must be `async` for this. Check its call sites — any inline `onclick` handler
is unaffected, but a caller that relies on it completing synchronously must `await` it.

`confirm` is deliberate: this is rare, blocking, and must not be dismissible by accident. A styled
dialog can replace it later without changing the logic.

- [ ] **Step 3: Verify and commit**

Open the same decision in two windows. Change the reasoning differently in each. Save A, then B —
confirm B prompts, names the changed field, and that both branches behave as described.

```bash
git commit --allow-empty -m "feat(brain-ui): save-time conflict prompt for same-record edits"
```

---

### Task 6: Backup list in Settings

**Files:**
- Modify: `tools-src/product-brain.html`

- [ ] **Step 1: Add the markup**

In the Settings section (`:587`):

```html
          <div class="form-row">
            <label class="form-label">Backups</label>
            <div id="set-backups" class="backup-list"></div>
            <p class="form-hint">The 20 most recent copies of the brain ledger, newest first. To restore one, close the tool, rename the file to <code>brain-data.json</code> in the hub folder, then reconnect.</p>
          </div>
```

- [ ] **Step 2: Populate it**

In `renderSettings()` (`:2488`):

```js
    const box = document.getElementById('set-backups');
    if (box && dirHandle) {
      box.textContent = 'Reading…';
      (async () => {
        try {
          const bdir = await dirHandle.getDirectoryHandle('backups', { create: false });
          const names = [];
          // The folder is shared with the Comments Hub — list only this tool's files.
          for await (const entry of bdir.values()) {
            if (entry.kind === 'file' && entry.name.startsWith('brain-data-')) names.push(entry.name);
          }
          names.sort().reverse();
          box.innerHTML = names.length
            ? names.map(n => '<div class="backup-row">' + escHtml(n) + '</div>').join('')
            : '<div class="backup-row muted">No backups yet.</div>';
        } catch (e) {
          box.innerHTML = '<div class="backup-row muted">No backups yet.</div>';
        }
      })();
    }
```

- [ ] **Step 3: Verify and commit**

Confirm the list shows only `brain-data-*` files, newest first, and caps at 20.

```bash
git commit --allow-empty -m "feat(brain-ui): Settings backup list"
```

---

### Task 7: Full verification and publish

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — all suites.

- [ ] **Step 2: Cross-tool acceptance pass**

Against one scratch hub folder, with the Comments Hub open in one window and Product Brain in two
others under different names, confirm all of:

1. New decisions from B appear in A within ~20s.
2. A typing in a decision form is never repainted; the update lands when the form closes.
3. Editing a decision in A badges it in B within ~20s; **Edit anyway** still works.
4. Closing A clears its badge and presence entry within 90s.
5. Simultaneous edits to one decision produce the conflict prompt; both branches behave correctly.
6. The Comments Hub window appears in Product Brain's strip marked `(hub)` and never holds a decision lock, and vice versa.
7. `brain-data.json.tmp` never persists after a save.
8. `backups/` holds both `brain-data-*` and `hub-data-*` files, each capped at 20 independently.
9. The Comments Hub still works end to end — same folder, same presence dir, no interference.

- [ ] **Step 3: Lock and publish** *(Harvey runs this — it prompts for the workshop code)*

```bash
node scripts/lock-tools.mjs
git add tools/ && git commit -m "build: republish tools with multi-user Product Brain"
```

- [ ] **Step 4: Deploy**

`git push` — GitHub Pages publishes from `main`.
