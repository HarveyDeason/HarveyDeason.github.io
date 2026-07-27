# Photos on Comments — Comments Hub

Date: 2026-07-27
Status: approved (Harvey, 2026-07-27) — approach A

## Why

A comment like "flange clash at pump 2" is one photo away from being obvious and
several emails away from being understood. The Hub already owns the comment
record and the shared folder; it should own the evidence too.

## Scope

Comments Hub only. The Product Brain is untouched this round — it keeps reading
`hub-data.json` as it does now and simply ignores the new `photos` field. It
never writes hub data, and showing photos in its comment overlay is a separate
job if it is ever wanted.

## Approach

Photos hang off the comment record (approach A). They flow through the existing
comment merge, save queue, Excel regeneration and family roll-up rather than
introducing a parallel collection.

**Known trade-off, accepted:** comments merge whole-record, last-write-wins by
`updatedAt`. If two people attach a photo to the *same* comment without a sync
in between, one link is lost (both files remain on disk and can be re-attached).
The rejected alternative — photos as their own merged-by-id collection — costs a
new top-level schema, its own tombstone rules and a join in every reader, for a
case that needs two people editing one comment in the same minute.

## Data

Each comment gains an optional `photos` array. Absent on every existing comment,
so nothing needs migrating:

```js
photos: [
  { id, file, thumb, caption, addedAt, addedBy }
]
```

- `id` — `crypto.randomUUID()`.
- `file` — filename only, e.g. `flange clash at pump 2.jpg`. Resolved against
  `Photos/<REF>/`.
- `thumb` — filename of the thumbnail, resolved against `Photos/<REF>/thumbs/`.
  Same base name as `file`.
- `caption` — what the user typed. Empty is allowed.
- `addedAt` — ISO timestamp. `addedBy` — free text, never prefilled (house rule).

`hub-data.json` never holds image bytes.

## Disk layout

```
<hub folder>/
  Photos/
    HUB-0007/
      flange clash at pump 2.jpg
      thumbs/
        flange clash at pump 2.jpg
```

Naming: the caption becomes the filename, through `HubCore.sanitizeFilename`
(already hardened for Windows: `/\:*?"<>|`, control characters, trailing dots
and spaces, reserved device names such as `CON`/`LPT1`, empty-after-sanitise).
Blank caption falls back to the original filename's base. The extension is
always `.jpg` — every stored image is re-encoded (see below). A name already
present in that comment's folder gets a ` (2)`, ` (3)` … suffix.

Images are decoded, re-encoded and downscaled on the way in:

- stored copy: longest edge max 2000px, JPEG quality 0.82
- thumbnail: longest edge max 320px, JPEG quality 0.7

EXIF orientation is applied during the canvas draw so portrait phone photos are
not stored sideways.

## UI

**New Comment tab.** A Photos row under the description: a drop zone plus a
"Choose files" button, mirroring the Brain's import queue. Each queued image
shows a preview and a caption box labelled "What is this a photo of?". Nothing
is written until the comment is logged — the ref, and therefore the folder name,
does not exist before that. On submit, files are written as part of the normal
background save; the form clears immediately.

**Dashboard, expanded row.** The same strip: existing photos as thumbnails, plus
"Add photos". The ref already exists here, so files are written on confirm and
the comment updated through `queueSave` like any other edit.

**Viewer.** Clicking a thumbnail opens a full-size overlay showing the caption,
with prev/next through that comment's photos, Escape and backdrop-click to
close. The overlay node is **removed** on close, never merely `hidden` —
`.cov-backdrop { display: flex }` beats `[hidden]`, a bug this codebase has hit
twice (reader-would-not-close, inline-add-box).

**Removing.** An ✕ on each thumbnail unlinks the photo from the comment and
leaves the files in place, consistent with the tools' never-delete-anyone's-data
rule. The row shows nothing further; the file can be binned by hand.

## Excel

A `photos` column is appended to `COMMENT_COLUMNS` (and so to `MASTER_COLUMNS`,
family sheets and per-product sheets, which derive from it):

```
{ key: 'photos', header: 'Photos', width: 30 }
```

Cell value: `''` when there are none, otherwise
`2 photos: flange clash at pump 2.jpg, valve label.jpg`. No embedded images —
the workbook stays small and row heights stay untouched.

## Errors

Write failures reuse `folderErrorMessage()`, already written for family folders:
`TypeMismatchError` (a file is in the way), `NotAllowedError` (permission
withdrawn), `NoModificationAllowedError` (genuinely locked), other. A failed
write leaves the photo queued and unattached rather than half-attached, and the
folder chip shows the error state with retry on the next change. A file that
does not decode as an image is rejected at the drop zone with a toast naming it.

## Testing

Pure logic in `hub-core`, TDD, added to the existing suite (104 at time of
writing):

- `photoFileName(caption, originalName, existingNames)` — sanitisation, blank
  caption fallback, `.jpg` extension, ` (2)` collision suffixing.
- `addPhotoToComment` / `removePhotoFromComment` — immutable update, `updatedAt`
  bump, unknown id is a no-op.
- `photosCell(comment)` — the Excel string, including the empty case and
  singular/plural.
- Workbook models carry the new column in master, filtered, product and family
  sheets.

UI lives in the gitignored tool file and is browser-verified with the
fake-handle harness:

1. attach two photos while logging a new comment → files and thumbs appear under
   `Photos/<REF>/`, record references them
2. caption becomes the filename; a duplicate caption gets ` (2)`
3. attach to an existing comment from the expanded row
4. overlay opens, steps prev/next, closes by ✕, Escape and backdrop
5. remove unlinks the photo but leaves both files on disk
6. regenerated workbook round-trips with the Photos column populated
7. a locked file surfaces the right message and leaves the photo unattached
8. zero console errors

## Out of scope

Camera capture in the browser, annotation/markup, photos on decisions or
documents in the Brain, embedding images in the workbook.
