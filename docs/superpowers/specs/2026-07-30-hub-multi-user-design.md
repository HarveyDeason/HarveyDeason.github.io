# Comments Hub — Multi-User Safety — Design Spec

**Date:** 2026-07-30
**Status:** Approved pending final user review
**Builds on:** `2026-07-24-comments-hub-design.md`

## Purpose

The Comments Hub is now used by a small team (2–4 people, likely to grow) working from a
company drive. The dominant concurrency pattern is **one person reading while another
writes** — not two people writing at once.

`mergeState` already handles the write-write case correctly: every save does
read → merge-by-id → write, last-`updatedAt`-wins per record, with tombstones so deletions
survive. Two people adding different comments have always merged cleanly.

This spec closes the three gaps that merge cannot close:

1. **Stale screens.** A tab left open for hours shows old data. The *save* merges fine, but
   the *human* acts on a lie — closing out something already closed, or re-raising a comment
   someone else just logged. Merge cannot fix human duplication.
2. **Same-record clobber.** Two people editing the same comment: merge is per-record, not
   per-field, so one person's `actionTaken` text vanishes silently. This is the only real
   data-loss path in the current design.
3. **Durability.** A single `.backup.json` is one mistake deep, and a non-atomic write can
   leave a half-written source of truth.

## Applies to Product Brain too

Product Brain shares `hub-sync.js`, the same hub folder, and the same `refreshFromDisk` structure,
so it carries identical exposure. It gets the same treatment via a sibling plan
(`plans/2026-07-30-product-brain-multi-user.md`), consuming the primitives this spec's plan builds.
Consequently the shared pieces — atomic write, dated backups, conflict detection, `enteredBy`, and
the whole presence module — live in `hub-sync.js` / `hub-presence.js`, not in `hub-core.js`.

Presence is shared between the two tools: one `presence/` folder, with a `tool` field on each
record so a decision lock can never be read as a comment lock.

## Non-goals

- **No hub-wide lock.** Rejected explicitly. The common case is a viewer plus an editor, so a
  whole-hub lock would let a *viewer* block the person who actually wants to type. It also
  creates stale-lock support burden.
- **No audit trail / per-comment history.** Deferred by decision. `updatedAt` remains the only
  change record.
- **No backend.** The "it's just a folder" property is what made this deployable without IT
  involvement, and it stays.
- No change to the P&ID Tag Register tool.

## Design

### 1. Local identity

On first connect, prompt once for the user's name; store in `localStorage` under
`hubUserName`, editable in Settings.

**Rule governing every person-field:**

> Any field describing *who did the real-world work* is never pre-filled. `enteredBy` is the
> only auto-stamped identity, because it is the only thing the tool knows for a fact — who was
> sitting at the keyboard.

- `enteredBy` — new field on every comment, stamped automatically, not user-editable.
- `raisedBy` — never pre-filled (unchanged).
- `closedBy` — never pre-filled. Someone often closes out on another person's behalf.

`enteredBy` is additive; `mergeById` merges whole records so no merge change is needed.

### 2. Live refresh

A 20-second tick checks `hub-data.json` via `getFile().lastModified`. This is a metadata read,
not a content read, so the poll is nearly free.

If the timestamp has advanced since the last load:

- **User is not mid-edit** → re-read, merge into in-memory state, update the view, show a quiet
  "Synced — N new comments" chip.
- **User is mid-edit** (New Comment form dirty, or an edit panel open) → change nothing. Show an
  "Updates available" chip that applies once they finish.

A "Last synced HH:MM" readout sits alongside the existing connect chip.

### 3. Presence and per-record soft lock — one mechanism

A `presence/` folder in the hub root, one file per browser session:

```json
{ "name": "Harvey", "sessionId": "<random>", "lastSeen": "<iso>", "editingCommentId": "c-123" }
```

- Written on the same 20s tick as the refresh poll.
- Sessions with `lastSeen` older than **90s** are treated as dead and ignored. This is a single
  named constant (`PRESENCE_TIMEOUT_MS`), deliberately tunable after real-world use: too short and
  a live user on a slow drive flickers out mid-edit; too long and a crashed tab leaves a ghost
  "editing" badge. Because the "Edit anyway" escape hatch makes a ghost cheap and flicker
  expensive, erring long is the safer direction.
- Own file deleted on `beforeunload`; any client encountering a file older than 10 minutes
  deletes it.
- Header shows "Also here: Sarah, Tom".

**The soft lock is `editingCommentId` on the presence record — not a separate lock file.** It
therefore expires automatically with the heartbeat, with no separate expiry logic to write or
to get wrong.

When another session holds a comment, its row is badged "Sarah is editing" and the edit control
is greyed with a tooltip. An **"Edit anyway"** escape hatch is always present: stale state must
never be able to wedge someone out of their own tool.

`presence/` lives outside `hub-data.json` and is never merged into it.

### 4. Conflict backstop

Presence is best-effort — a crashed tab or clock skew can defeat it. So independently of
presence, at save time: if the record's `updatedAt` on disk is newer than the copy the user
loaded, prompt **Keep mine / Take theirs / Show both**.

This is what actually guarantees no silent field loss. Presence exists only to make the
collision rare; this makes it safe.

### 5. Atomic write

Replace the direct write with:

1. Write `hub-data.tmp.json`
2. Re-read and verify it parses
3. `FileSystemFileHandle.move()` it over `hub-data.json`

`move()` is available in Chromium, which is already the supported browser set. If `move()` is
unavailable, fall back to the current write-with-backup path and log a console warning. A
half-written source of truth becomes impossible.

### 6. Backup depth

A `backups/` folder. Before each save, the **previous** disk content is written as
`backups/hub-data-<compact-iso>.json`, pruned to the most recent 20.

Settings lists available backups with dates so a file can be recovered by hand. This supersedes
the single `hub-data.backup.json`; a legacy file is still readable if present but no longer
written.

### 7. Autodesk Construction Cloud constraint

Generated Excel files are uploaded to ACC weekly or monthly for wider distribution.

> **ACC versions files by filename.** Generated filenames must remain stable and must never
> contain dates or timestamps. Adding a date would make each upload a new ACC file, silently
> destroying version history and breaking everyone's links.

The current design already satisfies this. It is recorded here so it is not undone later.

## Failure handling

- Unreadable/corrupt `hub-data.json` → refuse to write, surface the error (unchanged).
- Unwritable `presence/` (permissions) → presence degrades silently to off; refresh, conflict
  detection, and saving all continue to work. Presence is never load-bearing.
- Locked Excel during regeneration → existing behaviour (retry once, flag on screen, catch up on
  next save or via "Regenerate all").

## Testing

Follow existing `tests/` patterns; extend `tests/hub-core.test.js` and `tests/hub-sync.test.js`.

Pure functions to unit-test:

- Presence liveness filter (fresh / stale / dead-session boundaries at 90s and 10min)
- Conflict detection: given loaded record + disk record, does it flag?
- Backup filename generation and pruning to 20
- `enteredBy` stamping on new comments; confirming `raisedBy`/`closedBy` are untouched

Manual browser verification against a scratch folder with two windows open before completion.
