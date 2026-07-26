# Product Families — Design Spec

**Date:** 2026-07-26
**Status:** Approved pending final user review
**Scope:** Family support across the Comments Hub and Product Brain, driven by the drawing families already defined in the P&ID Tag Register's `register.json`.

## Purpose

Standard products often exist as families — a range of drawings (e.g. SP51-68) defined once in the P&ID tool via name + patterns (native range syntax like `SP51-68`, expanded against register drawings). Comments and decisions usually cover the whole range, sometimes one drawing. Today the tools only know per-drawing products; this feature makes families first-class targets while keeping single drawings selectable, and consolidates family Excel output into one workbook per family.

Families are **defined only in the P&ID tool** (single owner). Both tools read them live from `register.json` (`families: [{ id, name, patterns[], updatedAt }]`) on every connect/sync; membership changes need no migration. Pattern expansion replicates the P&ID tool's semantics (uppercase trim; `PREFIX<from>-<to>` numeric ranges; its other pattern forms copied verbatim from `expandPatterns`).

## Product register (Comments Hub owns it)

- `syncProductsFromRegister()` additionally creates **one family product per register family**: id `fam-<familyId>` (deterministic — tombstones block resurrection), `name` = family name, `type` = 'OSB item', `pidDrawings` = expanded member drawings (refreshed on every sync so membership edits propagate; refresh bumps `updatedAt` only when membership actually changed).
- Per-drawing products continue to be created exactly as now. Manual products unchanged.
- A new `familyId` field on family products records the source family; member drawing products get nothing new (membership is derived live from the register, never stored on drawing products).

## Pickers (both tools)

Product multi-selects become family-grouped: a family header row with its own checkbox (selects the family product), expandable to member-drawing entries beneath it; ungrouped drawings and manual products listed as before. Search-filter box still filters across everything.

## Coverage semantics

- Comment/decision on a family product covers the range; on a drawing product covers that drawing.
- **Roll-up both directions**, always visibly marked:
  - Family views (Hub dashboard product filter, Brain "what links here", Brain search scoped to a family) include items on member-drawing products.
  - Member-drawing views include family-level items, marked "via <family name>".
- Implementation: a `familyMembership` map (familyProductId → memberDrawingProductIds, and inverse) derived from the register at render time; filters expand a selected family product id to the id set (and a drawing id to itself + its family's id for the inherited direction).
- Revision stamping on a family comment records each member drawing's current rev, comma-listed.

## Excel outputs (Comments Hub)

- **One workbook per family**: `<family name> Comments.xlsx` in `Products/<family name>/`:
  1. **Cover / Summary** — family name, member drawings with current revisions, counts (family-level and per-drawing rolled up), generated-on.
  2. **Family Comments** — comments on the family product (standard Comment Log layout).
  3. **One sheet per member drawing** — that drawing's own comments only (family context lives on sheet 2; no duplication). Sheet names: sanitized (Excel bans `[]:*?/\`), truncated to ≤31 chars, deduped with numeric suffixes; the full drawing number always appears in cell A1 of the sheet.
- Member drawings of a family get **no individual workbook** (that's the point — one file per family). Products outside families and manual products keep individual workbooks as now. Master Log unchanged.
- `regenerateExcels` touched-id handling: touching a member drawing product regenerates its family's workbook (not an individual file); touching a family product likewise.
- Files are never deleted: pre-existing per-drawing workbooks for family members go stale on disk. On regeneration, the hub shows a one-time notice listing such leftover filenames so they can be tidied by hand.

## Out of scope

- Editing families anywhere except the P&ID tool.
- Family nesting.
- Any Product Brain Excel output (still none).

## Testing

- `node --test`: pattern expansion (range + verbatim-copied forms) against fixture register data; family product sync (create/refresh/tombstone-block); membership map + filter expansion (both roll-up directions); family workbook model (sheet-per-drawing layout, name sanitize/truncate/dedupe, roll-up counts). Existing suites stay green.
- Browser verification in both tools with a seeded register containing a family; Harvey's live check against the real register.
