# Product Brain — Design Spec

**Date:** 2026-07-26
**Status:** Approved pending final user review
**Tool name (working):** Product Brain — a searchable second brain for standard products and offsite-built items: decision records with attribution, a document repository (HAZOPs, meeting minutes, datasheets), and one search across decisions, documents, and Comments Hub comments.

## Purpose

Standard products accumulate knowledge that today lives in people's heads, inboxes, and scattered ACC folders: why a component was or wasn't used, what a HAZOP concluded, what was agreed in a meeting. When a future decision comes up ("should this design use an air relief valve?"), that history is unfindable. The Product Brain captures decisions and documents against products and makes all of it searchable — so the answer to "why didn't we use X?" is a search away, with the who/when/why attached.

It is a **sibling tool** to the Comments Hub: separate page, separate data file, same shared parent folder, same product register (read from the hub, never duplicated).

## Architecture (Approach A — sibling tool, own ledger)

- New gated instrument at `tools/product-brain.html` (source `tools-src/product-brain.html`, gitignored; locked via lock-tools like the others).
- Own source of truth: `brain-data.json` in the hub folder root. The Comments Hub's `hub-data.json` is **strictly read-only** to the brain (products + comments for search). The brain's files are never touched by the Comments Hub. One owner per file — no cross-tool write conflicts possible.
- Same sync semantics as the Comments Hub: read → merge by id/`updatedAt` → tombstones → backup (`brain-data.backup.json`) → write, through a single-flight save queue with error chip and retry-on-next-change.
- **Shared tested module**: the merge/tombstone/queue logic is extracted from the Comments Hub into `assets/js/hub-sync.js` (unit-tested; both tools import it) so fixes land in both tools. Brain-specific logic lives in `assets/js/brain-core.js` (unit-tested). The Comments Hub is refactored to use `hub-sync.js` with **zero behaviour change**.
- Search: vendored **MiniSearch** (fuzzy + prefix + field boosting), index built in memory on load/sync. Text extraction at import time: PDF via vendored pdf.js (per-page, page numbers kept), DOCX via vendored mammoth.js, XLSX/XLS/CSV via the already-vendored SheetJS (all sheets, sheet names included). Binary `.doc` and other formats: metadata-only, stated at import. Extracted text stored in `brain-data.json` compressed via `CompressionStream` (base64 gzip per document).
- Zero external network requests (site rule). Everything vendored.

Rejected alternatives: folding decisions/documents into `hub-data.json` (cross-tool write conflicts, ledger bloat); jumping to a server backend (abandons the zero-infrastructure model that makes team adoption free).

## Folder layout

```
Hub Folder/
├── hub-data.json               ← Comments Hub's (read-only here)
├── brain-data.json             ← Product Brain source of truth
├── brain-data.backup.json      ← previous version, written before each save
├── P&ID Register/              ← untouched
├── Products/                   ← Comments Hub Excel outputs, untouched
└── Documents/
    ├── <product name>/
    │   ├── HAZOP/
    │   ├── Meeting minutes/
    │   └── <other doc types>/
    └── _General/               ← documents not tied to one product
```

Imported files are copied by the tool into `Documents/<product>/<type>/` (first-listed product wins for filing; all linked products get the index entry) so the tree stays browsable in Explorer without the tool. Multi-product docs are filed once, linked many times.

## Data model (`brain-data.json`)

Top-level: `{ version, savedAt, decisions, documents, lists, tombstones }`.

### Decisions
`{ id, title, decision, reasoning, madeBy, recordedBy, date, productIds[], projectTag, tags[], status: 'active' | 'superseded', supersededBy, supersedes, links: { documents[], comments[], urls[] }, updatedAt }`

- `madeBy` (who made the call, e.g. "HAZOP 12 chair") vs `recordedBy` (who typed it in) — honest attribution.
- **Supersession**: superseding creates a new decision pre-linked via `supersedes`; the old record gets `status: 'superseded'` + `supersededBy`. Superseded records render struck-through in search results with a pointer to the successor. Both directions always consistent.
- **From comment**: a decision can be created from any Comments Hub comment — form pre-filled (reasoning from description, productIds carried over), `links.comments` stores the comment id, and the UI shows the source comment when viewing the decision.

### Documents
`{ id, title, docType, date, productIds[], projectTag, tags[], filePath, accUrl, extraction: { method: 'pdf' | 'docx' | 'sheet' | 'none', pages, textGz }, updatedAt }`

- `filePath` — relative path under `Documents/` when imported; empty for ACC-link-only entries (`accUrl` set instead). Either or both may be present.
- `extraction.textGz` — gzip+base64 extracted text; per-page markers retained for PDFs so search hits can cite a page.
- Scanned PDFs with no text layer report "no searchable text found" at import (metadata-only entry, user informed — never a silent failure). Extraction can also be deliberately skipped for huge files.
- Duplicate filename in the same target folder → saved with "(2)" suffix as a new entry (both indexed); the import form flags it.

### Lists
Editable, synced: `tags[]`, `projects[]`, `docTypes[]` (seeded: HAZOP, Meeting minutes, Datasheet, Report, Drawing, Other).

### Tombstones
Same semantics as the Comments Hub (max-timestamp union; deletion wins over stale edits). Deleting an imported document tombstones the index entry but **never deletes the file** from `Documents/` — files are the team's property; the tool only manages its index.

## Search

- One search box + optional scope: product, kind (Decisions / Documents / Comments), document type, project tag.
- Index fields (boosted in this order): decision titles, document titles, tags, decision text/reasoning, extracted document text, comment text. Comments are indexed live from `hub-data.json` at load/sync — never copied into `brain-data.json`.
- Fuzzy + prefix matching (MiniSearch defaults tuned: fuzzy 0.2, prefix true).
- Results grouped by kind; every hit shows title, product(s), date, who, and a highlighted snippet (PDF hits include page number; sheet hits include sheet name). Superseded decisions struck-through with successor pointer.
- Clicking through: decisions open in place; imported documents open the actual file; ACC entries open the ACC URL; comment hits show the comment detail (read-only, with a note to manage it in the Comments Hub).

### AI seam (explicitly deferred)
No AI features in v1 (company policy disallows API use). The design keeps the seam: search produces ranked snippets, which is the exact input a future "ask" feature would pass to an LLM with a user-supplied API key. Nothing about v1's data model blocks or presupposes it.

## Interface

Same chrome/tokens/folder-chip as the Comments Hub. Tabs:

1. **Search** (landing) — as above.
2. **Decisions** — filterable table (product/tag/status), New decision form, "From comment…" picker, Supersede action, edit in place.
3. **Documents** — drag-and-drop import → metadata form (title from filename, docType, date, products, tags, project, optional ACC URL) → copy file + extract text + save, with progress bar per file. "Link ACC document" for index-only entries. Table with type badges, re-tag/edit.
4. **Products** — "what links here": pick a product → its active decisions, superseded decisions (collapsed), documents by type, and open comments (live from hub), all clickable. The pre-design-review page.
5. **Settings** — tag/project/docType lists; rebuild search index; re-extract a document.

If `hub-data.json` is absent (no Comments Hub in the folder), the brain still runs — decisions/documents work against an empty product list, and the UI prompts the user to open the Comments Hub once to seed products. The brain never writes products itself (single owner: the hub).

## Excel outputs

None, deliberately. The Comments Hub's job is circulation; the brain's job is retrieval. A decision-register export can be added later if a real need appears.

## Sync & failure handling

Inherited from the Comments Hub via the shared `hub-sync.js`: single-flight queued saves, immediate optimistic repaint, error chip with reason + retry on next change, corrupt-ledger refusal (never overwrite), one-deep backup, File System Access API (Chrome/Edge desktop) with the same unsupported-browser message. Picker errors surfaced (AbortError silent).

## Testing

- `node --test` for: extraction functions (PDF/docx/sheet text assembly from parsed inputs), gzip round-trip, merge behaviour via shared `hub-sync.js`, search-index document building, snippet/highlight logic, supersession consistency (both links always set), from-comment prefill mapping.
- Comments Hub regression: existing 58-test suite must stay green after the `hub-sync.js` extraction refactor.
- Browser verification against a scratch folder with real sample PDF (text + scanned), DOCX, XLSX before completion.

## Out of scope (v1)

- AI / LLM features (seam preserved, nothing built).
- Full project register (projects are a tag list; a product can stand in for a project meanwhile).
- OCR for scanned PDFs.
- Binary `.doc` / `.msg` text extraction (metadata-only).
- Excel/report outputs.
- Any write access to `hub-data.json`, the P&ID Register, or the hub's Products/ outputs.
- Editing/moving files already in `Documents/` (the tool copies in and indexes; file management stays human).
