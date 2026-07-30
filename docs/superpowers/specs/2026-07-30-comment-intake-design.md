# Comments Hub — Excel Comment Intake — Design Spec

**Date:** 2026-07-30
**Status:** Approved pending final user review
**Builds on:** `2026-07-24-comments-hub-design.md`
**Sequenced after:** `2026-07-30-hub-multi-user-design.md`

## Purpose

Site teams and other contributors cannot reach the company drive, so they cannot use the hub
directly. Today their comments arrive as free text and get re-typed by hand.

This spec adds a round-trip: the hub **generates** a pre-scoped Excel intake sheet, that sheet is
emailed out and filled in offline, and the hub **imports** the returned file through a review
table where rows are accepted, edited, or rejected.

Excel was chosen over a web form because it needs no IT approval, works with no signal, is
already on every machine, and — through data-validation dropdowns — constrains input better than
free text or email ever could.

### Relationship to "Excel is never read back"

The original design states Excel files are generated outputs, never parsed. **That principle is
preserved.** The importer parses a *separate intake file* that the hub authored for this purpose.
Generated logs (`Master Log.xlsx`, per-product files) are still never read back.

## Non-goals

- **No inbox folder, no watched directory, no import queue.** Rejected explicitly. Files arrive
  by email; the user picks them with a file picker when ready.
- **No photo handling.** Intake is text-only. Photos emailed alongside are attached by hand to
  the comment after import, using the existing photo support.
- **No new `site` field.** `sources[]` is already an editable list, so naming the site *is* the
  source (e.g. "Site feedback — Barnstaple"). Most feedback is not site-specific, and templates
  are scoped by product so one sheet is distributable to every site touching that product.

## Template generation

Settings → **Generate intake template**. A dialog selects **one or more products**. No site
selection — scoping is by product only.

Output: `Comment Intake Template.xlsx`, styled consistently with the other generated workbooks.

### Sheet 1 — "Comments"

Columns: Product, Affects P&ID, Affects Model, Affects Drawing Sheets, Category, Source,
Date Raised, Raised By, Priority, Description.

`affectedTypes[]` is multi-valued, which a single Excel dropdown cannot express. It is therefore
split into **three separate Yes/No columns**, recombined into the array on import. A row with all
three blank imports with an empty `affectedTypes[]` rather than failing.

All list columns are data-validated dropdowns sourced from the hub's **current** lists, so
contributors pick rather than type.

- **One product selected** → stamped into a header cell, Product column pre-filled on every row,
  and the product's linked P&ID drawings listed on the instructions sheet so the contributor can
  see what they are commenting on.
- **Several products selected** → the Product dropdown is restricted to just those, so nothing
  irrelevant can be picked.

### Sheet 2 — "Lists" (hidden)

Holds the validation source ranges, a template version, the generated date, and — critically —
the **product IDs** alongside their display names.

Matching on stable IDs means **fuzzy product matching disappears entirely** for any sheet
returned unmodified. Fuzzy matching survives only as the fallback for hand-typed rows or a
product renamed between generation and return.

## Import

Dashboard → **Import comments** → file picker (`.xlsx`, multi-select) → review table. Nothing is
written until the user commits.

Columns are matched by **header name, not position**, so an old template kept on someone's
desktop still imports. A template version mismatch warns but does not block.

### Review table

Every parsed row appears with all fields inline-editable:

| Condition | Behaviour |
|---|---|
| Product resolved by embedded ID | Accepted silently |
| Product unresolved | Flagged; fuzzy suggestion offered, plus "create new product" |
| Category or source not in list | Offer "add to list", or remap to an existing value |
| Description empty | **Hard error** — row cannot be accepted |
| Date Raised empty | Defaults to today |
| Priority empty | Defaults to medium |
| Description similar to an existing *open* comment on that product | **Soft duplicate warning** — flag only, never blocking |

Per-row Accept/Reject toggles, plus Accept all / Reject all. Empty rows are skipped without
comment.

Similarity is computed on case-folded, punctuation-stripped description text against open
comments on the same product; anything above a fixed threshold is flagged. The exact measure is
an implementation detail — it only drives a non-blocking warning, so precision is not critical.

Duplicate detection is deliberately advisory: two site people reporting the same valve is common,
and so is the same file being emailed twice, but only a human can tell those apart from two
genuinely similar comments.

### Commit

Accepted rows go through the **normal comment creation path** — no side door. Each gets:

- A real `HUB-nnnn` ref via the existing `nextRef` / `resequenceRefs` sequence
- `enteredBy` stamped with the local user (per the multi-user spec)
- `importedFrom` — source filename plus import timestamp, for traceability
- `raisedBy` taken from the sheet, never inferred

Then the standard cycle: merge → atomic write → regenerate touched Excel files.

`resequenceRefs` sorts by `dateRaised` then `id`, so a bulk import of older-dated comments
interleaves them into the ref sequence correctly rather than appending them at the end.

## Failure handling

- Unparseable or non-Excel file → clear error naming the file; other selected files still import.
- No recognisable header row → error explaining the expected columns, with a prompt to
  regenerate a fresh template.
- All rows rejected → no write occurs at all.
- Import is atomic per commit: either every accepted row lands or none does.

## Testing

Follow existing `tests/` patterns; new `tests/hub-intake.test.js` plus extensions to
`tests/hub-core.test.js`.

Pure functions to unit-test:

- Workbook rows → candidate comments (header-name matching, column reordering, empty-row skipping)
- Per-row validation and defaulting (missing description / date / priority)
- Product resolution: embedded ID hit, ID miss with fuzzy fallback, no match
- Duplicate detection scoring against existing open comments
- Template model generation: single-product pre-fill, multi-product restricted dropdown, embedded
  product IDs

Manual verification: generate a template, fill it as a site team would, return it, and import —
against a scratch folder, before completion.
