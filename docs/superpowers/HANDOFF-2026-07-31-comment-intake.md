# Handoff — Excel comment intake

**Date:** 2026-07-31
**Branch:** `comment-intake` (from `main` @ `93daa2f`) — **not merged, not pushed**
**Suite:** 280 tests passing (`npm test`)
**Plan:** `docs/superpowers/plans/2026-07-31-comment-intake.md`
**Spec:** `docs/superpowers/specs/2026-07-30-comment-intake-design.md`

Start here, then pick up the plan at **Task 5**.

---

## What this feature is

Site teams cannot reach the company drive where the Comments Hub syncs, so their
feedback arrives as emails that Harvey re-types. The fix is a round trip: the hub
generates a **pre-scoped Excel intake sheet**, it gets emailed out and filled in offline,
and the hub imports it back through a **review table** where rows are accepted, edited or
rejected before anything is written.

Excel was chosen over a web form because it needs no IT approval, works with no signal,
and constrains input through dropdowns better than email ever could.

---

## DONE — Tasks 1–4, all the pure logic

| Task | Commit | What |
|---|---|---|
| 1 | `68d661c` | Template model in new `assets/js/hub-intake.js` |
| 2 | `ee76a4c` + `393192f` | `template`/`lists` sheet kinds in `assets/js/xlsx-render.js` |
| 3 | `84b6825` | `parseIntakeWorkbook` — reads a returned sheet |
| — | `7cfffe0` | **Date bug fix** (see below) |
| 4 | `ff607ca` | `reviewRows` — validation, product resolution, duplicates |

All of it is pure and node-testable: no DOM, no File System Access, and **ExcelJS is never
imported** — it is passed in, matching the existing convention in `xlsx-render.js`.

### Verified end to end, not just unit-tested

Template → fill in like a site team → save → parse → review, against deliberately messy
data. Confirmed working: UK date `29/07/2026` parsed day-first, `Pump  house` resolved to
the right product despite case and double space, unknown category warned, unresolvable
product warned (not blocked), duplicate matched across case and punctuation, missing
description the only hard error.

### The bug worth remembering

`7cfffe0`. Unit tests passed a JS `Date` object straight into the parser and went green.
But a date that has actually been **through an xlsx file** comes back as an **Excel serial
number** (`46232`), not a `Date`. Every real site-team date would have landed in the
comment as `"46232"`.

Only an end-to-end round trip caught it. **When touching anything that crosses the Excel
boundary, round-trip through a real file — a unit test that hands the parser a clean value
cannot catch this class of bug.**

### Design decisions baked in

- **The hidden `Lists` sheet carries product IDs, not just names.** A returned template
  matches exactly even if the product was renamed since. Fuzzy matching is only a fallback
  for hand-typed rows. Do not drop the IDs.
- **`affectedTypes[]` is three Yes/No columns**, recombined on import — one dropdown cannot
  express a multi-value field.
- **Only a missing description is a hard error.** Everything else is a warning a human
  resolves in the review table. A site team's imperfect spreadsheet must always be
  importable after review.
- **Duplicate detection is advisory and must stay that way.** `Replace valve V-101` and
  `Replace valve V-102` are one character apart and completely different comments. Any rule
  confident enough to auto-reject real duplicates would swallow those too.
- **The "Excel is never read back" principle still holds.** The importer parses only the
  hub's own intake file. Generated logs (`Master Log.xlsx`, per-product logs) are still
  never parsed. Do not add a path that reads them.

### Lists sheet layout (Task 3 depends on this)

- Columns 1–6: dropdown source lists. **`products` uses TWO columns — 1 is the name, 2 is
  the stable ID**, paired on the same row.
- Columns 8–9: metadata as **label/value pairs** (`templateVersion`, `generatedOn`), found
  **by label, not row**, so adding a field later cannot shift the others.
- Sheet is `veryHidden` but `wb.getWorksheet('Lists')` still retrieves it.

---

## NEXT — Tasks 5–7 (UI) then 8 (verify + publish)

All in `tools-src/comments-hub.html`, which is **gitignored** — it will not appear in
`git status`. Edit it anyway; commit those tasks with `git commit --allow-empty`.

- **Task 5** — "Generate intake template" in Settings, with a product multi-select.
- **Task 6** — "Import comments" on the Dashboard: file picker → review table with inline
  editing, per-row accept/reject, issue chips, duplicate warnings.
- **Task 7** — Commit accepted rows through the **normal** comment path (`HubCore.nextRef`,
  `HubSync.stampEnteredBy`, plus `importedFrom`), then **one** `queueSave` for the batch —
  not one per row, which would regenerate every Excel file per comment.
- **Task 8** — Verification and publish.

Note for Task 7: `resequenceRefs` sorts by `dateRaised`, so importing older-dated site
comments **interleaves them into the ref sequence** rather than appending. Correct, but
surprising — worth telling Harvey when he first sees it.

---

## Publishing

`tools-src/` is gitignored; the published tools are the encrypted `tools/*.html` produced
by `node scripts/lock-tools.mjs`, which prompts for the workshop code. **Harvey runs that
step** — it re-encrypts every tool and pushing deploys the live site.

**Critical coupling:** `assets/js/*.js` is served unencrypted and imported by the decrypted
tool HTML, so `assets/js/` and `tools/` **must ship in the same push**. Do not merge this
branch and push until the UI is done and `lock-tools.mjs` has been run.

Sequence: `npm test` → Harvey runs `lock-tools.mjs` → `git add tools/ && git commit` →
merge `comment-intake` → `main` → `git push`.

---

## Also open, unrelated to intake

- `plans/2026-07-30-product-brain-multi-user.md` — mirrors the Comments Hub. **Apply the
  viewing/editing split** (built 2026-07-31) rather than the original editing-only design.
- Deferred minor findings are listed in `.superpowers/sdd/progress.md` (gitignored).
- The **audit-trail question**: comment editing currently records *who* last edited but not
  *what it said before*. Gets harder to retrofit the longer edits accumulate.
