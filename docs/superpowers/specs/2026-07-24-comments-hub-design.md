# Comments Hub — Design Spec

**Date:** 2026-07-24
**Status:** Approved pending final user review
**Tool name (working):** Comments Hub — a central place to log, track, and close out comments/updates against OSB items and Standard products (P&IDs, models, drawing sheets).

## Purpose

Each OSB item and Standard product has a P&ID, a model, and drawing sheets. Over the coming years these accumulate comments and updates from many sources (site teams, design reviews, client feedback). Today there is no single place to capture them. The Comments Hub is an overarching tool that:

- Connects to a shared **parent hub folder** (the existing P&ID folder becomes a subfolder of it).
- Reads the P&ID tool's `register.json` (read-only) to know the P&IDs and their revisions.
- Captures comments with structured tags, distributes them into **nicely formatted, distributable Excel files** (per product + master log).
- Provides a **dashboard** to filter, review, and close out comments.

The existing P&ID Tag Register tool is **not modified** in any way.

## Architecture decision (Approach A)

**The JSON ledger is the single source of truth. Excel files are generated outputs, never read back.**

- `hub-data.json` in the hub folder root holds all data.
- Every save: re-read the file → merge by ID (latest `updatedAt` wins per record) → write → regenerate only the touched Excel files.
- Excel files are disposable: hand-edits are harmless because they are never parsed; deleting one just means it regenerates on next save (or via a manual "regenerate all" button).
- This mirrors the proven `register.json` merge-on-save pattern in the P&ID tool.

Rejected alternatives: Excel-as-truth (fragile parsing, lock/corruption risk) and per-user ledger files (more complexity than the team size warrants).

## Folder layout

```
Hub Folder/                        ← everyone connects here (File System Access API, readwrite)
├── hub-data.json                  ← source of truth
├── hub-data.backup.json           ← previous version, written before each save
├── Master Log.xlsx                ← generated: all comments, all products
├── P&ID Register/                 ← existing P&ID folder moved inside; read-only to the hub
│   └── register.json
└── Products/
    └── <product name>/
        └── <product name> Comments.xlsx   ← generated per-product log
```

On connect, the hub scans its subfolders for a `register.json` to locate the P&ID folder automatically. P&ID tool users continue connecting directly to the `P&ID Register/` subfolder as they do today.

## Data model (`hub-data.json`)

Top-level: `{ version, savedAt, products, comments, lists, tombstones, refCounter }`.

### Products
Sourced two ways: auto-populated from the P&ID register, and manually added in the hub.

- `id` — stable unique ID
- `name`, `type` (`OSB item` | `Standard product`)
- `pidDrawings[]` — drawing numbers linked from the P&ID register (revision looked up live at Excel-generation time)
- `modelRef`, `sheetRefs` — free-text references
- `updatedAt`, plus tombstone support for deletion
- **Linking:** a manually added product can later be linked to P&ID drawing(s) from the register. A **merge action** combines a duplicate pair: comments are re-pointed to the survivor, the loser is tombstoned.

### Comments
Append-only ledger; each record:

- `id` (unique, for merging), `ref` (human-friendly, `HUB-0001` global sequence via `refCounter`; on merge-collision the higher counter wins and duplicated refs are re-sequenced deterministically)
- `productIds[]` — one comment can span multiple products/drawings (multi-select)
- `affectedTypes[]` — any of `P&ID`, `Model`, `Drawing sheets`
- `category` — from editable list (e.g. pipework change, new valve, instrument change, layout change, annotation/drafting)
- `source` — from editable list (e.g. site feedback, design review, client comment, HAZOP action)
- `dateRaised` (defaults today), `raisedBy` (free text, **never pre-filled** — comments often originate from people other than the person typing)
- `description` — the big text box
- `priority` — low / medium / high
- `status` — `open` | `in_progress` | `closed` (reopening allowed; close-out history retained)
- `hold` — boolean "Hold for annual update" marker
- `pidRevision` — auto-stamped revision(s) the comment was raised against, when the product links to P&IDs
- Close-out fields: `dateClosed` (defaults today), `actionTaken`, `closedBy`
- `updatedAt` for merge resolution

### Lists
Editable, shared via sync: `categories[]`, `sources[]`. Ships with the starter values above; "+ add new" inline from the New Comment form or Settings.

### Tombstones
Deletion timestamps per record ID (products and comments), so deletions survive merges with stale copies — same trick as the P&ID tool.

## Excel outputs (generated with vendored ExcelJS)

Formatting standard: print-safe translation of the site palette — dark green header band with white bold text, frozen header row, autofilter, alternating row shading, wrapped text, sensible column widths, status cells colour-coded (amber open, blue in progress, green closed), priority flagged.

### Per-product file — `<product> Comments.xlsx`
1. **Cover / Summary** — product name & type, linked P&ID numbers with current revision (live from register at generation time), model/sheet refs, open / in-progress / closed counts, generated-on date.
2. **Comment Log** — one row per comment: ref, date raised, raised by, source, affected types, category, priority, description, revision raised against, status, date closed, action taken, closed by.

### Master Log.xlsx
1. **Overview** — every product with open / in-progress / closed counts.
2. **Comment Log** — same layout plus a Product column.

Regeneration is full-rewrite (never append), so formatting never drifts. Locked-file handling: retry once, then flag on screen; the file catches up on the next save or via "regenerate all".

## Interface

Single-file HTML tool at `tools/comments-hub.html` (source in `tools-src/`), matching the P&ID tool chrome: collapsible left sidebar, `site.css`/`tool.css` tokens only (no hardcoded colours), automatic dark/light mode, connect-folder chip with sync state, `tool-chrome.js`. Registered in `data/tools.json` / vault manifest per existing conventions.

### Tabs

**Dashboard** (landing)
- Stat cards: Open / In Progress / Closed / High-priority open — clickable to filter.
- Filter bar: product, status, affected type, category, source, priority, hold state, free-text search.
- Table: ref, product(s), category, priority, status, days open (neutral, sortable — no red stale flag), date raised, description snippet.
- Row expands to full record with actions: change status/priority, toggle hold, **close-out panel** (date defaults today, action taken, closed by), reopen.
- "Open and not held" filter = the real to-do list of items that should not wait for the annual update cycle.
- **Export filtered view** to a styled Excel.

**New Comment**
Top-to-bottom for fast entry: product multi-select with search → affected type toggles → category + source dropdowns (each with inline "+ add new") → date raised + raised by → priority → hold toggle → big description box → submit. On submit: ledger save, touched Excels regenerate, toast shows the new ref, form clears.

**Products**
Register of products with open-comment count badges. Add/edit, link a manual product to P&ID drawing(s) from the register, merge duplicates.

**Settings**
Edit category/source lists, "Regenerate all Excels" button.

## Sync & failure handling

- File System Access API (Chrome/Edge desktop). Unsupported browsers get an up-front message in the P&ID tool's style.
- Save cycle: read → merge → write `hub-data.backup.json` (previous version) → write `hub-data.json` → regenerate touched Excels.
- Corrupt/unparseable `hub-data.json`: the hub refuses to write and surfaces the error — never clobbers team data.
- `register.json` is strictly read-only.

## Testing

- Follow the existing `tests/` patterns in the repo.
- Unit-test as pure functions: merge logic (including tombstones and ref-counter collisions), ref sequencing, Excel workbook generation (structure-level assertions).
- Manual verification in browser preview against a scratch folder before completion.

## Out of scope

- Any change to the P&ID Tag Register tool.
- Authentication/user accounts (names are free text).
- Due dates / assignees / overdue tracking (fuller workflow rejected as overhead).
- Reading data back from Excel files.
