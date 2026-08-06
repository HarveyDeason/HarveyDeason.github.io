# Embedded Photos in Comment Logs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-product comment logs carry their photos **inside** the workbook, so a reader in Autodesk Construction Cloud sees them without needing the shared folder.

**Architecture:** The existing 320px thumbnails are embedded; full-size images stay in `Photos/` for anyone who needs detail. The workbook model stays pure — it *declares* which images belong where, and the tool supplies the bytes.

**Tech Stack:** Vanilla ES modules, vendored ExcelJS, `node --test`. Baseline **502 passing, 2 skipped**.

## Verified before planning

Run against the actual vendored bundle at `assets/vendor/exceljs.min.js`:

- `workbook.addImage({ buffer, extension })` and `worksheet.addImage(id, anchor)` both exist.
- An embedded image survives a `writeBuffer` → `load` round-trip.

So the mechanism is proven, not assumed.

## Why thumbnails, not originals

`savePhoto` already writes two copies: a full-size image (2000px, quality 0.82, ~400 KB) and a thumbnail (320px, quality 0.7, **~20–30 KB**). Embedding the originals would make a 100-photo log roughly 40 MB — unusable in ACC. Embedding thumbnails makes it about 2.5 MB.

The expensive part, downscaling, already runs today. This is largely plumbing the existing thumbnail into the workbook instead of writing its filename.

## Scope, as decided by the owner

- **Per-product and family logs.** *(Revised 2026-08-06.)* Originally scoped to per-product
  logs only. A family member has no individual workbook — its comments live on a sheet inside
  the family workbook — so under the original scope any product in a family would have shown
  no photos anywhere. Each row now carries its own comment's photos: a comment on the family
  appears on the Family Comments sheet, a comment on one drawing appears on that drawing's
  sheet. The Master Log keeps its text list of filenames, so it stays light as it accumulates
  every comment across every product for years.
- **Embed every photo on a comment.** Per product, even 500 photos is only ~12 MB, and 500 photos against one product is already an enormous amount.
- **Full-size images stay in `Photos/`** and are not embedded anywhere.

## Layout

`photos` is the **last** column in `COMMENT_COLUMNS`, which makes the layout tractable: thumbnails are placed as a horizontal strip starting at that column and extending rightward into empty space. Nothing sits to the right to collide with, so a comment with many photos simply extends further right rather than overlapping the log.

## Global Constraints

- `assets/js/hub-core.js` and `xlsx-render.js` stay **pure and node-testable**: no DOM, no File System Access. The model declares image placements; the tool reads the bytes and passes them in.
- **`xlsx-render.js` is shared** with the Decision Register. Existing `summary`, `log`, `template` and `lists` behaviour must not change.
- **Generated filenames stay stable and dateless** — ACC versions by filename.
- A missing, unreadable or corrupt thumbnail must **never** fail the export. Fall back to the filename text for that photo and carry on. A comment log that fails to generate is far worse than one with a missing picture.
- `tools-src/` is gitignored — commit UI work with `git commit --allow-empty`. Never run `lock-tools.mjs`.

---

### Task 1: Model declares image placements (pure)

**Files:**
- Modify: `assets/js/hub-core.js`
- Test: `tests/hub-core.test.js`

**Interfaces:**
- Each log row gains `photoRefs: [{ ref, file }]` — the comment's ref and each thumbnail's filename, in order. `photosCell` keeps returning its text summary, unchanged, for the Master Log and as the fallback.
- `buildProductWorkbookModel` populates `photoRefs`; `buildMasterWorkbookModel` does **not** (per-product only).

- [ ] **Step 1: Write the failing tests.** Cover: a comment with no photos yielding an empty `photoRefs`; several photos preserving order; `photosCell` text unchanged from today (it is the Master Log's cell and the fallback); the master model carrying no `photoRefs`; malformed `photos` entries (not an array, missing `file`, null) degrading rather than throwing — the hostile-input work established that rule and it holds here.
- [ ] **Step 2–4:** Run to fail, implement, run to pass.
- [ ] **Step 5: Commit** — `feat(hub-core): log rows declare their photo thumbnails`

---

### Task 2: Renderer embeds the images

**Files:**
- Modify: `assets/js/xlsx-render.js`
- Test: `tests/hub-core.test.js` or a new `tests/xlsx-images.test.js`

**Interfaces:**
- `renderWorkbook(model, ExcelJS, colors, images)` — `images` is an optional `Map` keyed `` `${ref}/${file}` `` holding an `ArrayBuffer`/`Uint8Array` per thumbnail. Omitted or empty means today's behaviour exactly.

- [ ] **Step 1:** For a `log` sheet row carrying `photoRefs`, place each available thumbnail as a horizontal strip from the `photos` column rightward, and set the row height to fit. Keep a sensible thumbnail display size (~80px) so rows stay readable.
- [ ] **Step 2:** A `photoRefs` entry with **no matching image** in the map falls back silently to the text cell. This is the normal case when a thumbnail is missing or unreadable — not an error.
- [ ] **Step 3: Failsafe.** Cap total embedded images per workbook at a generous ceiling (a few thousand — far above the owner's stated worst case). Beyond it, stop embedding, keep the text list, and add a visible note on the Summary sheet saying so. Rationale: exhausting browser memory mid-generation fails the whole export, which is worse than a note.
- [ ] **Step 4: Write tests** round-tripping a real workbook: images present when supplied; the file still opens and the log sheet still reads correctly; no images supplied behaves exactly as before; a `photoRefs` entry with no bytes does not throw.
- [ ] **Step 5: Confirm** `summary`, `template` and `lists` sheets are byte-identical to before for a model with no `photoRefs`.
- [ ] **Step 6: Commit** — `feat(xlsx-render): embed comment photo thumbnails in log sheets`

---

### Task 3: The tool supplies the bytes

**Files:** `tools-src/comments-hub.html`

- [ ] **Step 1:** Before generating a **per-product** workbook, read the thumbnails its rows reference from `Photos/<ref>/thumbs/<file>` into an images map. Read only what that product's rows actually need — not the whole folder.
- [ ] **Step 2:** Any read failure for one photo is skipped silently and the export continues. Log it to the console; never surface an error or abort.
- [ ] **Step 3:** Pass the map to `renderWorkbook`. The Master Log and the filtered export pass nothing, keeping today's behaviour.
- [ ] **Step 4:** Regenerating many products at once must not read the same thumbnail repeatedly — cache within one regeneration pass.
- [ ] **Step 5: Verify** against a real folder: a product with photos produces a workbook that opens in Excel with the images visible; a product with none is unchanged; a deliberately deleted thumbnail still exports cleanly.
- [ ] **Step 6: Commit** — `feat(hub-ui): supply photo thumbnails when generating product logs`

---

### Task 4: Verification and publish

- [ ] **Step 1:** `npm test` — all green (502 passing, 2 skipped, plus new).
- [ ] **Step 2:** Open a generated log in **real Excel**, not just a round-trip test: images visible, rows readable, sorting and filtering still work with images present.
- [ ] **Step 3:** Check the file size against expectation (~25 KB per photo).
- [ ] **Step 4:** Confirm the Master Log is unchanged and still light.
- [ ] **Step 5:** Confirm the Decision Register's exports are unaffected (shared renderer).
- [ ] **Step 6: Publish** *(owner runs this — prompts for the workshop code)*

```bash
node scripts/lock-tools.mjs
git add tools/ && git commit -m "build: republish tools with embedded comment photos"
git push
```

## Still outstanding after this

Hardening plan `2026-08-03-hardening.md` Tasks 4 (scale), 5 (clock skew) and 6 (write-up).
