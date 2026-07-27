# Photos on Decisions + Decisions Export — Product Brain

Date: 2026-07-27
Status: approved in chat (Harvey, 2026-07-27) — photos first, on-demand export

## Why

Decisions carry the same evidence problem comments did: "we moved the sample
point because of the access issue" is one photo away from being obvious. The
Comments Hub feature shipped today; this ports it to the Product Brain, and adds
the one thing decisions lack — a way to hand them to someone without the tool.

## Scope

Product Brain only. The Comments Hub is untouched apart from one refactor it
benefits from (the shared workbook renderer, below).

## 1. Photos on decisions

Mirrors the comments feature exactly, with the deltas below.

Each decision gains an optional `photos` array of the same record shape already
used by comments: `{ id, file, thumb, caption, addedAt, addedBy }`. Absent on
every existing decision, so nothing migrates.

**Delta — flat folder.** Comments have a ref (`HUB-0007`) that names their
folder; decisions have only an opaque generated id. A folder tree full of UUIDs
is useless to anyone browsing OneDrive, so decision photos go flat:

```
<hub folder>/Photos/decisions/
  sample point access from the walkway.jpg
  thumbs/
    sample point access from the walkway.jpg
```

The caption still becomes the filename, through the same
`HubCore.photoFileName` (Windows-safe, `.jpg`, ` (2)` on collision). Dedupe is
across every decision photo in the folder, not per decision — two decisions
whose captions collide give `name.jpg` and `name (2).jpg`.

**UI.** Two attach points, matching comments:
- The decision form (new or edit): a drop zone and an in-memory queue with
  caption boxes, written after the decision is saved.
- The decision view overlay: the same strip plus "Add photos", written
  immediately since the decision already exists.

Clicking a thumbnail opens the full-size viewer — prev/next, Escape, backdrop
click, and the node **removed** on close, never hidden (`.pv-backdrop` declares
`display: flex`, which beats `[hidden]`; this bug has shipped twice here).

Removing a photo unlinks it and leaves the files on disk.

The Brain still never writes `hub-data.json`. Decision photos live in the
Brain's own records and the shared `Photos/` tree.

## 2. On-demand decisions export

A button on the Decisions tab exports **what the filters are currently
showing** to a workbook, downloaded to the browser — nothing is written to the
shared folder, nothing regenerates on save. This is deliberate: today's round
removed per-save file writes because they made every save slow, and an
auto-generated decisions workbook would put that cost straight back.

Columns: Date, Title, Decision, Reasoning, Product(s), Project, Tags, Made by,
Recorded by, Status, Supersedes, Photos.

`Photos` reuses the comments format: `2 photos: a.jpg, b.jpg`, empty when none.
Superseded decisions keep their row, with the status column carrying the state —
an export that silently dropped them would misrepresent the record.

Filename: `Decisions Export <date>.xlsx`.

## 3. Shared workbook renderer (refactor)

`applyModel` — model in, ExcelJS buffer out — currently lives inside the
Comments Hub tool file. The Brain needs exactly it. Rather than a second copy,
it moves to a committed module `assets/js/xlsx-render.js` exporting
`renderWorkbook(model, ExcelJS, colors)`, and both tools import it.

The move is behaviour-preserving: same headers, freeze panes, autofilter, zebra
striping and status/priority fills. The Hub's existing workbook verification is
the regression gate — a regenerated Master Log must still open with its
formatting intact.

## Testing

Pure logic in `brain-core`, TDD, added to the existing suite (116 at time of
writing):
- `addPhotoToDecision` / `removePhotoFromDecision` — immutable, bump
  `updatedAt`, unknown id is a no-op.
- `decisionPhotoNames(state)` — every filename already used, for collision
  checks across decisions.
- `buildDecisionsWorkbookModel(state, decisions, productName, nowIso)` — column
  set, the photos cell, superseded rows kept, filename.

The tool file is gitignored, so its half is browser-verified with the
fake-handle harness: attach on a new decision, attach on an existing one,
caption becomes the filename, collision across two decisions suffixes, viewer
opens and closes by all three routes, remove unlinks but leaves files, and the
exported workbook re-parses with the right columns and photo cells.

The Hub is re-verified after the renderer move: connect, change a comment,
confirm `Master Log.xlsx` still regenerates and re-parses with its header band
and Photos column.

## Out of scope

Camera capture, annotation, photos on documents (they already carry the file
itself), writing the decisions workbook into the shared folder, and any change
to how comments store photos.
