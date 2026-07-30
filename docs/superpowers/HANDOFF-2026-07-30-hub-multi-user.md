# Handoff — Comments Hub / Product Brain multi-user safety

**Date:** 2026-07-30
**Branch:** `hub-multi-user` (branched from `main` @ `afd1767`) — **not merged, not pushed**
**Suite:** 237 tests passing (`npm test`)

Start the next session by reading this file, then
`docs/superpowers/plans/2026-07-30-hub-multi-user.md` from Task 5.

---

## What this work is

The Comments Hub and Product Brain are used by a small team (2–4, growing) through a
folder on a shared company drive. There is no server — the folder IS the database. The
dominant pattern is **one person reading while another writes**, which is why a hub-wide
lock was explicitly rejected: the viewer who got in first would block the person who
actually wants to type.

Specs:
- `docs/superpowers/specs/2026-07-30-hub-multi-user-design.md`
- `docs/superpowers/specs/2026-07-30-comment-intake-design.md` (spec only — **no plan written yet**)

Plans:
- `docs/superpowers/plans/2026-07-30-hub-multi-user.md` — Tasks 1–4 DONE, **5–10 remain**
- `docs/superpowers/plans/2026-07-30-product-brain-multi-user.md` — not started

Detailed progress, every finding, and the deferred Minor list live in
`.superpowers/sdd/progress.md`. **That folder is gitignored** — `git clean -fdx` destroys
it. If that happens, recover from `git log` and this file.

---

## DONE — Tasks 1–4, the shared primitives

All in `assets/js/`, all pure and node-tested. Both tools share them.

| Primitive | File |
|---|---|
| `writeFileAtomic` — crash-safe ledger write | `hub-sync.js` |
| Dated backup rotation, keep 20, scoped per ledger | `hub-sync.js` |
| `detectConflict` / `conflictFields` / `stampEnteredBy` | `hub-sync.js` |
| `readLedger` error classification (`missing` / `unreadable` / `corrupt`) | `hub-sync.js` |
| Presence + heartbeat-derived soft lock | `hub-presence.js` (new) |

**Product Brain already benefits** from atomic writes and the `readLedger` fix — they are
in shared code. It does NOT yet get dated backups (it passes no `cfg.backupDir`).

### Bugs the reviews caught — context for why the code looks like it does

Do not "simplify" these away:

- **Shared temp filename = silent data loss.** `writeFileAtomic` originally used a fixed
  `<name>.tmp`, so every session on every machine wrote the same file. Two people saving
  together: one overwrote the other's temp, verification passed (it only checked "is this
  valid JSON", not "is this mine"), and the wrong content went over the ledger. Now
  session-unique names + content-equality verification + a 10-minute stale-tmp sweep.
- **`readLedger` mapped every error to `missing`**, and `saveNow` skips both backup and
  merge on `missing` — so a one-second drive blip wrote stale local state over everyone's
  work and reported "synced". Now only `NotFoundError` is `missing`.
- **Anything that leaves the ledger unparseable wedges the whole team**, because
  `readLedger` → `corrupt` → `saveNow` refuses to write, permanently, until a human
  deletes the file. Two separate bugs could do this (a probe creating a zero-byte file,
  and the no-move fallback deleting its good copy too early). Both fixed. **Treat any new
  code path that can leave a partial ledger as critical.**
- **The test mock was kinder than the real API.** `fakeDir` had no `move()`, so every
  engine test silently took the fallback branch and the atomic path had zero coverage
  while the suite was green. Mocks are now faithful — **keep them that way**. If a test
  fails after hardening a mock, that is real information; never weaken the mock.

---

## NEXT — Tasks 5–10: UI wiring

All in `tools-src/comments-hub.html` (~2,250 lines). Plan has exact line anchors.

5. Local identity (`enteredBy` stamped; `raisedBy`/`closedBy` never pre-filled)
6. Refresh hardening — **fixes a live bug**: `refreshFromDisk` calls `renderAll()`
   unconditionally, so alt-tabbing back while typing wipes the form. Affects users today.
7. Presence strip + soft record lock (always with an "Edit anyway" escape hatch)
8. Save-time conflict prompt
9. Backups list in Settings
10. Verification and publish

Then `plans/2026-07-30-product-brain-multi-user.md`, then write a plan for the Excel
intake spec.

### How to verify without Harvey clicking

`showDirectoryPicker()` is a native OS dialog — browser automation cannot touch it. But
it can be **stubbed with a fake in-memory directory handle**, which exercises the whole
save / merge / presence / conflict path across two tabs. Do that first.

**Then hand it to Harvey for a real-folder pass.** The stub is by definition kinder than
a real network share, and every serious bug this session came from real file behaviour —
`move()` semantics, locked files, mocks that were too generous. The stub proves the
logic; it does not prove the risk.

---

## PUBLISHING — read before pushing anything

`tools-src/` is **gitignored**. The published tools are the encrypted `tools/*.html`,
produced by `node scripts/lock-tools.mjs`, which prompts for the workshop code.
**Harvey runs that** — it re-encrypts every tool and pushing deploys the live site.

**Critical coupling:** `assets/js/*.js` is served to the site *unencrypted* and is
imported by the decrypted tool HTML. So pushing new `assets/js` WITHOUT republishing
`tools/` leaves the live tools running new shared code they were not written against —
e.g. the published pages would not understand the new `unreadable` status and would show
a "corrupt — fix or remove it" error on a transient blip.

**Therefore: `assets/js/` and `tools/` must ship in the same push.** Do not merge this
branch to `main` and push until the UI work is done and `lock-tools.mjs` has been run.

Publish sequence, once Tasks 5–10 are complete:
1. `npm test` — must be green
2. Harvey: `node scripts/lock-tools.mjs` (prompts for the workshop code)
3. `git add tools/ && git commit`
4. Merge `hub-multi-user` → `main`
5. `git push` (GitHub Pages publishes from `main`)

---

## Open decisions and deferred items

Nothing is blocking. Deferred Minor findings are listed in `.superpowers/sdd/progress.md`;
the ones most worth doing:

- `conflictFields` will name `enteredBy` on essentially every conflict (it differs by
  construction), adding noise to the prompt. Exclude `id` and `enteredBy`.
- Backup filenames are second-resolution, so two saves in the same second collide and
  silently reduce the 20-deep history.
- `editorOf` / `livePresences` rely on the caller remembering `ofTool`; a `tool` parameter
  would make the safe call the only call.
- A few tests assert trivially-true things — notably "a brain session never holds a hub
  lock", which passes against any implementation.

## Working preferences confirmed this session

- Strongest model for planning and review; Sonnet subagents for execution.
- Scope sessions tightly and hand off rather than running long.
- Person-fields describing real-world work (`raisedBy`, `closedBy`) are **never**
  pre-filled. `enteredBy` is the only auto-stamped identity.
- Generated Excel filenames must stay stable and dateless — Autodesk Construction Cloud
  versions by filename, and a changing name destroys version history.
