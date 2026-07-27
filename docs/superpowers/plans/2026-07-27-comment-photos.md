# Photos on Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attach photos to Comments Hub comments — while logging one and afterwards — storing resized copies and thumbnails in the shared folder and listing their filenames in the Excel logs.

**Architecture:** Photos hang off the comment record as `comment.photos[]` (approach A in the spec), so they ride the existing merge, save-queue and workbook regeneration untouched. Pure logic (filename derivation, add/remove, the Excel cell) lives in `assets/js/hub-core.js` under TDD; the browser-only work (canvas resize, File System Access writes, UI) lives in `tools-src/comments-hub.html`.

**Tech Stack:** Vanilla ES modules, node:test, File System Access API, canvas/`createImageBitmap`, ExcelJS (already vendored).

## Global Constraints

- `tools-src/*.html` is **gitignored**. Tasks that only touch it produce **no commit** — the deliverable is the file on disk plus a report. Only `assets/`, `tests/` and `docs/` changes get committed.
- Never write to `tools/` by hand. Locked loaders are regenerated only by `scripts/lock-tools.mjs` at the endgame, with the workshop code supplied by Harvey. The code is **not on disk**.
- No external network requests from any tool file — everything vendored under `assets/`.
- No hardcoded colours in tool CSS; use the existing custom properties (`--bg2`, `--border`, `--accent`, `--muted2`, `--tmut`, `--radius-md`, …). **One approved exception** (Harvey, 2026-07-27): the photo viewer's `.pv-bar` caption and buttons in Task 6 use `#fff` and `rgba(255,255,255,0.5)`, because that bar sits on a dimmed photo rather than the page background and must stay white in both light and dark mode. No other literal colour is permitted.
- All user-supplied text reaches the DOM through `escHtml` / `escAttr`.
- Never prefill a person's name (`addedBy`), matching the existing house rule for `raisedBy` / `closedBy`.
- Stored images are always re-encoded to JPEG: `.jpg` extension, main copy longest edge ≤ 2000px at quality 0.82, thumbnail longest edge ≤ 320px at quality 0.7.
- Removing a photo unlinks it only — files are never deleted from disk.
- Run the whole suite with `npm test` (104 tests green before this plan starts). Every hub-core task must leave it green.

---

### Task 1: `photoFileName` in hub-core

**Files:**
- Modify: `assets/js/hub-core.js` (append after `sanitizeFilename`, currently ends line 171)
- Test: `tests/hub-core.test.js`

**Interfaces:**
- Consumes: `sanitizeFilename(x)` — already exported from `hub-core.js`; strips `/\:*?"<>|` and control characters, trims trailing dots/spaces, suffixes Windows reserved device names (`CON`, `LPT1`, …) with `_`, returns `'Unnamed'` when nothing survives.
- Produces: `photoFileName(caption, originalName, existingNames) -> string` — the `.jpg` filename to store a photo under. Task 3 calls it before writing files.

- [ ] **Step 1: Write the failing tests**

Add to the end of `tests/hub-core.test.js`, and add `photoFileName` to the existing
`import { buildProductWorkbookModel, … sanitizeFilename } from '../assets/js/hub-core.js';` line:

```js
test('photoFileName: caption becomes the filename', () => {
  assert.equal(photoFileName('flange clash at pump 2', 'IMG_4471.JPG', []), 'flange clash at pump 2.jpg');
});

test('photoFileName: blank caption falls back to the original name, always .jpg', () => {
  assert.equal(photoFileName('', 'IMG_4471.JPG', []), 'IMG_4471.jpg');
  assert.equal(photoFileName('   ', 'scan.png', []), 'scan.jpg');
});

test('photoFileName: unsafe captions are sanitised for Windows', () => {
  assert.equal(photoFileName('valve: A/B "spec"', 'x.jpg', []), 'valve- A-B -spec-.jpg');
  assert.equal(photoFileName('CON', 'x.jpg', []), 'CON_.jpg');
  assert.equal(photoFileName('trailing dots...', 'x.jpg', []), 'trailing dots.jpg');
});

test('photoFileName: nothing usable anywhere still yields a name', () => {
  assert.equal(photoFileName('', '', []), 'Unnamed.jpg');
});

test('photoFileName: collisions get a numeric suffix, case-insensitively', () => {
  assert.equal(photoFileName('clash', 'x.jpg', ['clash.jpg']), 'clash (2).jpg');
  assert.equal(photoFileName('clash', 'x.jpg', ['clash.jpg', 'clash (2).jpg']), 'clash (3).jpg');
  assert.equal(photoFileName('Clash', 'x.jpg', ['clash.jpg']), 'Clash (2).jpg');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL — `photoFileName is not defined` (an import of a missing export is `undefined` at call time).

- [ ] **Step 3: Write the implementation**

Append to `assets/js/hub-core.js` after `sanitizeFilename`:

```js
// Photos are stored as JPEG under Photos/<REF>/, named from the caption the
// user typed — "IMG_4471.JPG" tells nobody anything. Falls back to the original
// filename's base when the caption is blank, and suffixes duplicates rather
// than silently overwriting a colleague's photo.
export function photoFileName(caption, originalName, existingNames) {
  const base = String(caption || '').trim()
    || String(originalName || '').replace(/\.[^.]*$/, '').trim();
  const safe = sanitizeFilename(base);
  const taken = new Set((existingNames || []).map(n => String(n).toLowerCase()));
  let name = safe + '.jpg';
  let n = 2;
  while (taken.has(name.toLowerCase())) { name = `${safe} (${n}).jpg`; n += 1; }
  return name;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test 2>&1 | tail -12`
Expected: PASS — `# pass 109`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add assets/js/hub-core.js tests/hub-core.test.js
git commit -m "feat: derive photo filenames from their captions"
```

---

### Task 2: photo records on comments + the Excel column

**Files:**
- Modify: `assets/js/hub-core.js` — `COMMENT_COLUMNS` (line 140), `commentRow` (line 175), plus new exports
- Test: `tests/hub-core.test.js`

**Interfaces:**
- Consumes: `photoFileName` (Task 1); the existing `C(id, updatedAt, extra)` comment factory in the test file.
- Produces, all called by Tasks 4–5:
  - `addPhotoToComment(state, commentId, photo, nowIso) -> state` — appends to `comment.photos`, bumps `updatedAt`.
  - `removePhotoFromComment(state, commentId, photoId, nowIso) -> state` — drops the entry, bumps `updatedAt`. Files on disk are untouched.
  - `photosCell(comment) -> string` — the Excel cell text.
  - A photo record is `{ id, file, thumb, caption, addedAt, addedBy }`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/hub-core.test.js`, extending the import line with
`addPhotoToComment, removePhotoFromComment, photosCell`:

```js
const PH = (id, file, caption = '') =>
  ({ id, file, thumb: file, caption, addedAt: '2026-07-27T09:00:00Z', addedBy: '' });

test('addPhotoToComment appends and bumps updatedAt', () => {
  const s0 = { ...emptyState('t'), comments: [C('c1', '2026-07-27T08:00:00Z')] };
  const s1 = addPhotoToComment(s0, 'c1', PH('p1', 'clash.jpg', 'clash'), '2026-07-27T09:00:00Z');
  assert.equal(s1.comments[0].photos.length, 1);
  assert.equal(s1.comments[0].photos[0].file, 'clash.jpg');
  assert.equal(s1.comments[0].updatedAt, '2026-07-27T09:00:00Z');
  assert.equal(s0.comments[0].photos, undefined);          // input untouched
});

test('addPhotoToComment on an unknown id is a no-op', () => {
  const s0 = { ...emptyState('t'), comments: [C('c1', '2026-07-27T08:00:00Z')] };
  assert.deepEqual(addPhotoToComment(s0, 'nope', PH('p1', 'a.jpg'), 'x'), s0);
});

test('removePhotoFromComment drops one entry and bumps updatedAt', () => {
  const s0 = { ...emptyState('t'), comments: [
    C('c1', '2026-07-27T08:00:00Z', { photos: [PH('p1', 'a.jpg'), PH('p2', 'b.jpg')] })] };
  const s1 = removePhotoFromComment(s0, 'c1', 'p1', '2026-07-27T10:00:00Z');
  assert.deepEqual(s1.comments[0].photos.map(p => p.id), ['p2']);
  assert.equal(s1.comments[0].updatedAt, '2026-07-27T10:00:00Z');
});

test('removePhotoFromComment on an unknown photo id is a no-op', () => {
  const s0 = { ...emptyState('t'), comments: [
    C('c1', '2026-07-27T08:00:00Z', { photos: [PH('p1', 'a.jpg')] })] };
  assert.deepEqual(removePhotoFromComment(s0, 'c1', 'nope', 'x'), s0);
});

test('photosCell: empty, singular, plural', () => {
  assert.equal(photosCell(C('c1', 't')), '');
  assert.equal(photosCell(C('c1', 't', { photos: [] })), '');
  assert.equal(photosCell(C('c1', 't', { photos: [PH('p1', 'clash.jpg')] })), '1 photo: clash.jpg');
  assert.equal(photosCell(C('c1', 't', { photos: [PH('p1', 'clash.jpg'), PH('p2', 'valve label.jpg')] })),
    '2 photos: clash.jpg, valve label.jpg');
});

test('COMMENT_COLUMNS ends with the Photos column', () => {
  const last = COMMENT_COLUMNS[COMMENT_COLUMNS.length - 1];
  assert.deepEqual(last, { key: 'photos', header: 'Photos', width: 30 });
});

test('every workbook log sheet carries the photos cell', () => {
  const state = { ...emptyState('t'),
    products: [P('p1', 't', 'OSB-01')],
    comments: [C('c1', 't', { productIds: ['p1'], photos: [PH('ph1', 'clash.jpg')] })] };
  const master = buildMasterWorkbookModel(state, new Map(), '2026-07-27');
  assert.equal(master.sheets[1].rows[0].cells.photos, '1 photo: clash.jpg');
  const prod = buildProductWorkbookModel(state, 'p1', new Map(), '2026-07-27');
  assert.equal(prod.sheets[1].rows[0].cells.photos, '1 photo: clash.jpg');
  const filtered = buildFilteredWorkbookModel(state, state.comments, '2026-07-27');
  assert.equal(filtered.sheets[0].rows[0].cells.photos, '1 photo: clash.jpg');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL — `addPhotoToComment is not a function` and the `COMMENT_COLUMNS` assertion failing on `closedBy`.

- [ ] **Step 3: Write the implementation**

In `assets/js/hub-core.js`, append the `photos` column to `COMMENT_COLUMNS` (after the `closedBy` entry, line 152):

```js
  { key: 'closedBy', header: 'Closed by', width: 14 },
  { key: 'photos', header: 'Photos', width: 30 },
```

Add `photos: photosCell(c),` to the `cells` object inside `commentRow`, immediately after the `closedBy` line:

```js
      closedBy: c.closedBy || '',
      photos: photosCell(c),
```

Then append the three new exports next to `photoFileName`:

```js
// Photos live on the comment record so they ride the existing merge, save queue
// and workbook regeneration. Removing one unlinks it; the files stay on disk.
export function addPhotoToComment(state, commentId, photo, nowIso) {
  if (!state.comments.some(c => c.id === commentId)) return state;
  return { ...state, comments: state.comments.map(c => c.id === commentId
    ? { ...c, photos: [...(c.photos || []), photo], updatedAt: nowIso } : c) };
}

export function removePhotoFromComment(state, commentId, photoId, nowIso) {
  const c = state.comments.find(x => x.id === commentId);
  if (!c || !(c.photos || []).some(p => p.id === photoId)) return state;
  return { ...state, comments: state.comments.map(x => x.id === commentId
    ? { ...x, photos: x.photos.filter(p => p.id !== photoId), updatedAt: nowIso } : x) };
}

export function photosCell(comment) {
  const photos = (comment && comment.photos) || [];
  if (!photos.length) return '';
  const noun = photos.length === 1 ? 'photo' : 'photos';
  return `${photos.length} ${noun}: ${photos.map(p => p.file).join(', ')}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test 2>&1 | tail -12`
Expected: PASS — `# pass 116`, `# fail 0`. The family workbook builder shares `COMMENT_COLUMNS` and `commentRow`, so its existing tests must still pass untouched.

- [ ] **Step 5: Commit**

```bash
git add assets/js/hub-core.js tests/hub-core.test.js
git commit -m "feat: carry comment photos through state and the Excel logs"
```

---

### Task 3: image pipeline + folder writes in the tool

**Files:**
- Modify: `tools-src/comments-hub.html` (gitignored — **no commit**; write `.superpowers/sdd/photos-task-3-report.md` instead)

Insert the new code after `folderErrorMessage` (currently ends line 1725) and before the workbook regeneration block.

**Interfaces:**
- Consumes: `HubCore.photoFileName` (Task 1); `engine.writeFile(dir, name, contents)` from `assets/js/hub-sync.js` — creates the file, always aborts a failed writable, and stamps `e.hubFile`; `folderErrorMessage(name, e)`; `dirHandle`; `toast`; `nowIso`.
- Produces, called by Tasks 4–5:
  - `encodePhoto(file, maxEdge, quality) -> Promise<Blob>` — decoded, orientation-corrected, downscaled JPEG.
  - `photoThumbUrl(photo, ref) -> Promise<string>` and `photoFullUrl(photo, ref) -> Promise<string>` — object URLs read back from disk for display.
  - `savePhoto(ref, file, caption, existingNames) -> Promise<photoRecord>` — writes both files, returns `{ id, file, thumb, caption, addedAt, addedBy }`. Throws on write failure with the file named.

- [ ] **Step 1: Add the constants and the encoder**

```js
  // ── Photos ────────────────────────────────────────────────────────────────
  // Phone photos are 5–12MB; a shared OneDrive folder should not carry that.
  // Everything is re-encoded to JPEG on the way in: a working copy for viewing
  // and a thumbnail for the strip.
  const PHOTO_MAX_EDGE = 2000, PHOTO_QUALITY = 0.82;
  const THUMB_MAX_EDGE = 320,  THUMB_QUALITY = 0.7;

  // createImageBitmap applies EXIF orientation, so portrait phone photos are not
  // stored sideways. Throws for anything that is not a decodable image.
  async function encodePhoto(file, maxEdge, quality) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
    if (!blob) throw new Error('Could not encode the image.');
    return blob;
  }
```

- [ ] **Step 2: Add folder resolution and the save path**

```js
  // <root>/Photos/<REF>/ and <root>/Photos/<REF>/thumbs/. Created on demand;
  // failures carry the folder name so folderErrorMessage can be specific.
  async function photoDirs(ref) {
    const photosRoot = await dirHandle.getDirectoryHandle('Photos', { create: true });
    const refDir = await photosRoot.getDirectoryHandle(ref, { create: true });
    const thumbDir = await refDir.getDirectoryHandle('thumbs', { create: true });
    return { refDir, thumbDir };
  }

  async function savePhoto(ref, file, caption, existingNames) {
    const name = HubCore.photoFileName(caption, file.name, existingNames);
    const [full, thumb] = await Promise.all([
      encodePhoto(file, PHOTO_MAX_EDGE, PHOTO_QUALITY),
      encodePhoto(file, THUMB_MAX_EDGE, THUMB_QUALITY),
    ]);
    const { refDir, thumbDir } = await photoDirs(ref);
    await engine.writeFile(refDir, name, full);
    await engine.writeFile(thumbDir, name, thumb);
    return { id: crypto.randomUUID(), file: name, thumb: name, caption: String(caption || '').trim(),
      addedAt: nowIso(), addedBy: '' };
  }
```

- [ ] **Step 3: Add the read-back helpers**

```js
  // Object URLs are cached per filename so a repaint does not re-read the disk.
  // Cleared wholesale when a comment's photos change.
  const photoUrlCache = new Map();
  function clearPhotoUrlCache() {
    for (const url of photoUrlCache.values()) URL.revokeObjectURL(url);
    photoUrlCache.clear();
  }
  async function photoUrl(ref, name, thumbs) {
    const key = (thumbs ? 't:' : 'f:') + ref + '/' + name;
    if (photoUrlCache.has(key)) return photoUrlCache.get(key);
    const { refDir, thumbDir } = await photoDirs(ref);
    const fh = await (thumbs ? thumbDir : refDir).getFileHandle(name, { create: false });
    const url = URL.createObjectURL(await fh.getFile());
    photoUrlCache.set(key, url);
    return url;
  }
  const photoThumbUrl = (photo, ref) => photoUrl(ref, photo.thumb, true);
  const photoFullUrl  = (photo, ref) => photoUrl(ref, photo.file, false);
```

- [ ] **Step 4: Export the new functions on `window`**

Add to the existing `Object.assign(window, { … })` block (currently line 1924), on the line after `applyModel, regenerateExcels, syncProductsFromRegister,`:

```js
    encodePhoto, savePhoto, photoThumbUrl, photoFullUrl, clearPhotoUrlCache,
```

- [ ] **Step 5: Verify in the browser**

Start the preview server (`preview_start` with the `site` config from `.claude/launch.json`) and open
`http://localhost:5050/tools-src/comments-hub.html`. Install the fake-handle harness
(a `dirHandle` whose `getFileHandle`/`getDirectoryHandle`/`values()` are backed by a
plain object of path → contents, and `createWritable()` records what was written),
set `window.showDirectoryPicker` to return it, then run:

```js
// 1200x800 red PNG through the pipeline
const c = document.createElement('canvas'); c.width = 1200; c.height = 800;
const cx = c.getContext('2d'); cx.fillStyle = '#c00'; cx.fillRect(0, 0, 1200, 800);
const blob = await new Promise(r => c.toBlob(r, 'image/png'));
const file = new File([blob], 'IMG_0001.PNG', { type: 'image/png' });
const rec = await window.savePhoto('HUB-0001', file, 'flange clash at pump 2', []);
```

Expected: `rec.file === 'flange clash at pump 2.jpg'`; the harness recorded writes at
`Photos/HUB-0001/flange clash at pump 2.jpg` and `Photos/HUB-0001/thumbs/flange clash at pump 2.jpg`;
the thumbnail blob is smaller than the full copy; a second `savePhoto` with the same
caption and `['flange clash at pump 2.jpg']` returns `'flange clash at pump 2 (2).jpg'`.
Then check rejection: `await window.encodePhoto(new File(['not an image'], 'x.txt', { type: 'text/plain' }), 320, 0.7)`
must reject, not resolve.

- [ ] **Step 6: Write the report**

Write `.superpowers/sdd/photos-task-3-report.md` recording what was added, the verification
output above, and anything deviating from this plan. No git commit — the file is gitignored.

---

### Task 4: attach photos while logging a new comment

**Files:**
- Modify: `tools-src/comments-hub.html` — form markup near line 566, CSS near line 270, submit handler at line 947, `clearNewCommentForm` at line 912 (**no commit**; report to `.superpowers/sdd/photos-task-4-report.md`)

**Interfaces:**
- Consumes: `savePhoto`, `encodePhoto` (Task 3); `HubCore.photoFileName`; `submitComment`, `queueSave`, `toast`, `escHtml`, `escAttr`, `folderErrorMessage`.
- Produces: `ncPhotoQueue` — module-level array of `{ uid, file, caption, previewUrl }` drained by `submitComment`; handlers `onNcPhotoPick`, `onNcPhotoDrop`, `onNcPhotoDragOver`, `onNcPhotoDragLeave`, `onNcPhotoCaption`, `removeNcPhoto`.

- [ ] **Step 1: Add the form markup**

Insert immediately after the `nc-desc` form-group (closes at line 569):

```html
          <div class="form-group">
            <label class="form-label">Photos</label>
            <div id="nc-photo-drop" class="photo-dropzone"
                 ondragover="onNcPhotoDragOver(event)" ondragleave="onNcPhotoDragLeave(event)" ondrop="onNcPhotoDrop(event)">
              <span class="pz-icon">🖼</span>
              <span class="pz-title">Drop photos here</span>
              <span class="pz-sub">or <label class="pz-link">choose files<input type="file" accept="image/*" multiple hidden onchange="onNcPhotoPick(this)"/></label> — they are saved when you log the comment</span>
            </div>
            <div id="nc-photo-queue" class="photo-queue"></div>
          </div>
```

- [ ] **Step 2: Add the CSS**

Insert after the `.hub-toast.visible` rule (line 271):

```css
  /* ── Photos ── */
  .photo-dropzone { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 18px; border: 1px dashed var(--border2); border-radius: var(--radius-md); background: var(--bg2); color: var(--muted2); font-size: 0.85rem; text-align: center; }
  .photo-dropzone.dragover { border-color: var(--accent); background: var(--bg3); color: var(--text); }
  .photo-dropzone .pz-icon { font-size: 1.5rem; }
  .photo-dropzone .pz-title { font-size: 0.95rem; font-weight: 600; color: var(--text); }
  .photo-dropzone .pz-link { color: var(--accent); cursor: pointer; text-decoration: underline; }
  .photo-queue { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 12px; }
  .photo-card { width: 160px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg2); overflow: hidden; }
  .photo-card img { display: block; width: 100%; height: 110px; object-fit: cover; background: var(--bg3); }
  .photo-card .pc-body { padding: 8px; display: flex; flex-direction: column; gap: 6px; }
  .photo-card .pc-caption { width: 100%; font-size: 0.8rem; padding: 5px 7px; border: 1px solid var(--border2); border-radius: var(--radius-md); background: var(--bg); color: var(--text); }
  .photo-card .pc-x { align-self: flex-end; cursor: pointer; color: var(--muted2); font-size: 0.85rem; }
  .photo-card .pc-x:hover { color: var(--red); }
  .photo-strip { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; }
  .photo-thumb { position: relative; width: 96px; }
  .photo-thumb img { display: block; width: 96px; height: 72px; object-fit: cover; border: 1px solid var(--border); border-radius: var(--radius-md); cursor: pointer; background: var(--bg3); }
  .photo-thumb .pt-cap { display: block; font-size: 0.7rem; color: var(--muted2); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .photo-thumb .pt-x { position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; line-height: 17px; text-align: center; border-radius: 50%; background: var(--bg2); border: 1px solid var(--border2); color: var(--muted2); font-size: 0.7rem; cursor: pointer; }
  .photo-thumb .pt-x:hover { color: var(--red); }
```

Every token used above is already defined in this file's `:root` block: `--bg`, `--bg2`,
`--bg3`, `--border`, `--border2`, `--accent`, `--muted2`, `--text`, `--red`
(`var(--destructive)`) and `--radius-md`. There is no `--radius-sm` — use `--radius-md`.

- [ ] **Step 3: Add the queue state and handlers**

Insert before `submitComment` (line 947):

```js
  // Photos chosen on the New Comment form cannot be written yet: the ref does
  // not exist until the comment is logged, and the ref names the folder. Hold
  // them in memory with a local preview and drain the queue on submit.
  let ncPhotoQueue = [];

  function onNcPhotoDragOver(ev) { ev.preventDefault(); el('nc-photo-drop').classList.add('dragover'); }
  function onNcPhotoDragLeave() { el('nc-photo-drop').classList.remove('dragover'); }
  function onNcPhotoDrop(ev) {
    ev.preventDefault();
    el('nc-photo-drop').classList.remove('dragover');
    queueNcPhotos(ev.dataTransfer && ev.dataTransfer.files);
  }
  function onNcPhotoPick(input) { queueNcPhotos(input.files); input.value = ''; }

  async function queueNcPhotos(fileList) {
    for (const file of Array.from(fileList || [])) {
      try {
        const preview = await encodePhoto(file, THUMB_MAX_EDGE, THUMB_QUALITY);
        ncPhotoQueue = [...ncPhotoQueue, { uid: crypto.randomUUID(), file, caption: '',
          previewUrl: URL.createObjectURL(preview) }];
      } catch (e) {
        toast('“' + file.name + '” is not an image the browser can read.');
      }
    }
    renderNcPhotoQueue();
  }

  function onNcPhotoCaption(uid, value) {
    const item = ncPhotoQueue.find(i => i.uid === uid);
    if (item) item.caption = value;               // no repaint: it would steal focus
  }

  function removeNcPhoto(uid) {
    const item = ncPhotoQueue.find(i => i.uid === uid);
    if (item) URL.revokeObjectURL(item.previewUrl);
    ncPhotoQueue = ncPhotoQueue.filter(i => i.uid !== uid);
    renderNcPhotoQueue();
  }

  function renderNcPhotoQueue() {
    const wrap = el('nc-photo-queue');
    if (!wrap) return;
    wrap.innerHTML = ncPhotoQueue.map(i =>
      '<div class="photo-card">' +
        '<img src="' + escAttr(i.previewUrl) + '" alt="' + escAttr(i.file.name) + '"/>' +
        '<div class="pc-body">' +
          '<input type="text" class="pc-caption" placeholder="What is this a photo of?" ' +
            'value="' + escAttr(i.caption) + '" oninput="onNcPhotoCaption(\'' + i.uid + '\', this.value)"/>' +
          '<span class="pc-x" title="Remove" onclick="removeNcPhoto(\'' + i.uid + '\')">✕ remove</span>' +
        '</div>' +
      '</div>').join('');
  }
```

- [ ] **Step 4: Drain the queue on submit**

`submitComment` currently builds the record, calls `queueSave(productIds)` then
`clearNewCommentForm()`. Photos must not block the repaint, so capture the queue,
clear the form immediately, and write in the background. Replace the tail of
`submitComment` (from `queueSave(productIds);` to the closing `}`) with:

```js
    queueSave(productIds);
    const pending = ncPhotoQueue;
    const commentId = state.comments[state.comments.length - 1].id;
    ncPhotoQueue = [];
    clearNewCommentForm();
    toast(`Comment ${ref} logged`);
    if (pending.length) writeQueuedPhotos(commentId, ref, pending);
  }

  // Writes the New Comment queue after the comment exists. Each success updates
  // state through HubCore so the strip appears as files land; a failure names
  // the file and leaves the rest of the queue alone.
  async function writeQueuedPhotos(commentId, ref, pending) {
    for (const item of pending) {
      try {
        const c = state.comments.find(x => x.id === commentId);
        const existing = ((c && c.photos) || []).map(p => p.file);
        const rec = await savePhoto(ref, item.file, item.caption, existing);
        state = HubCore.addPhotoToComment(state, commentId, rec, nowIso());
        queueSave([]);
      } catch (e) {
        console.error('savePhoto failed', e);
        toast(folderErrorMessage(e && e.hubFile ? e.hubFile : 'Photos', e));
      } finally {
        URL.revokeObjectURL(item.previewUrl);
      }
    }
  }
```

- [ ] **Step 5: Clear the queue with the form**

Add to the end of `clearNewCommentForm` (line 912–921):

```js
    for (const i of ncPhotoQueue) URL.revokeObjectURL(i.previewUrl);
    ncPhotoQueue = [];
    renderNcPhotoQueue();
```

- [ ] **Step 6: Export the handlers**

Add to `Object.assign(window, { … })` after the `submitComment, clearNewCommentForm,` line:

```js
    onNcPhotoPick, onNcPhotoDrop, onNcPhotoDragOver, onNcPhotoDragLeave,
    onNcPhotoCaption, removeNcPhoto, writeQueuedPhotos,
```

- [ ] **Step 7: Verify in the browser**

With the fake-handle harness connected, on the New Comment tab:

1. Feed two generated image `File`s through `queueNcPhotos` — two cards appear with previews.
2. Type captions, pick a product, write a description, click Submit.
3. Expected: the form clears at once; within a second the harness holds
   `Photos/HUB-0001/<caption>.jpg` and `Photos/HUB-0001/thumbs/<caption>.jpg` for both;
   `state.comments[0].photos` has two records whose `file` matches the captions;
   `hub-data.json` on the fake disk contains them.
4. Two photos given the *same* caption produce `name.jpg` and `name (2).jpg`.
5. Drop a `.txt` file — toast names it, nothing is queued.
6. Console shows no errors.

- [ ] **Step 8: Write the report**

Write `.superpowers/sdd/photos-task-4-report.md` with the verification output. No commit.

---

### Task 5: attach and remove photos on an existing comment

**Files:**
- Modify: `tools-src/comments-hub.html` — `detailPanelHtml` (line 1111) and new handlers (**no commit**; report to `.superpowers/sdd/photos-task-5-report.md`)

**Interfaces:**
- Consumes: `savePhoto`, `photoThumbUrl`, `clearPhotoUrlCache` (Task 3); `HubCore.addPhotoToComment`, `HubCore.removePhotoFromComment` (Task 2); `renderDashboard`, `queueSave`, `expandedCommentId`.
- Produces: `renderPhotoStrip(commentId)`, `onRowPhotoPick(input, commentId)`, `removeCommentPhoto(commentId, photoId)`, used by Task 6's viewer for the same thumbnails.

- [ ] **Step 1: Add the strip to the detail panel**

In `detailPanelHtml`, insert between the `Action taken` field and `'<div class="detail-controls">'`:

```js
      '<div class="detail-field"><div class="df-label">Photos</div>' +
        '<div class="photo-strip" id="pstrip-' + c.id + '"></div>' +
        '<label class="pz-link">＋ Add photos' +
          '<input type="file" accept="image/*" multiple hidden onchange="onRowPhotoPick(this, \'' + c.id + '\')"/>' +
        '</label>' +
      '</div>' +
```

- [ ] **Step 2: Fill the strip asynchronously**

Thumbnails come off the disk, so the strip is filled after the row paints. Add
next to the dashboard handlers:

```js
  // The strip is filled after the row paints: thumbnails are read from disk.
  // Bails out if the row collapsed or another comment expanded while awaiting.
  async function renderPhotoStrip(commentId) {
    const c = state.comments.find(x => x.id === commentId);
    const wrap = el('pstrip-' + commentId);
    if (!c || !wrap) return;
    const photos = c.photos || [];
    if (!photos.length) { wrap.innerHTML = '<span class="df-value">—</span>'; return; }
    const parts = [];
    for (let i = 0; i < photos.length; i += 1) {
      const p = photos[i];
      let url = '';
      try { url = await photoThumbUrl(p, c.ref); }
      catch (e) { console.warn('thumbnail missing', p.thumb, e); }
      parts.push(
        '<span class="photo-thumb">' +
          (url
            ? '<img src="' + escAttr(url) + '" alt="' + escAttr(p.caption || p.file) + '" ' +
              'title="' + escAttr(p.caption || p.file) + '" onclick="openPhotoViewer(\'' + c.id + '\', ' + i + ')"/>'
            : '<img alt="missing" title="' + escAttr(p.file) + ' is not in the folder"/>') +
          '<span class="pt-x" title="Remove from this comment" ' +
            'onclick="removeCommentPhoto(\'' + c.id + '\', \'' + p.id + '\')">✕</span>' +
          '<span class="pt-cap">' + escHtml(p.caption || p.file) + '</span>' +
        '</span>');
    }
    if (expandedCommentId !== commentId) return;      // row closed while reading
    wrap.innerHTML = parts.join('');
  }
```

Call it wherever the expanded row is painted — at the end of `renderDashboard`, after
the table HTML is assigned:

```js
    if (expandedCommentId) renderPhotoStrip(expandedCommentId);
```

- [ ] **Step 3: Add the row handlers**

```js
  // The ref already exists here, so photos are written straight away.
  async function onRowPhotoPick(input, commentId) {
    const files = Array.from(input.files || []);
    input.value = '';
    const c = state.comments.find(x => x.id === commentId);
    if (!c) return;
    for (const file of files) {
      try {
        const cur = state.comments.find(x => x.id === commentId);
        const existing = ((cur && cur.photos) || []).map(p => p.file);
        const rec = await savePhoto(c.ref, file, '', existing);
        state = HubCore.addPhotoToComment(state, commentId, rec, nowIso());
        queueSave([]);
      } catch (e) {
        console.error('savePhoto failed', e);
        toast(folderErrorMessage(e && e.hubFile ? e.hubFile : 'Photos', e));
      }
    }
  }

  // Unlinks only — the files stay in Photos/<REF>/, matching the tools' rule of
  // never deleting anyone's data.
  function removeCommentPhoto(commentId, photoId) {
    state = HubCore.removePhotoFromComment(state, commentId, photoId, nowIso());
    clearPhotoUrlCache();
    queueSave([]);
  }
```

Photos added from the row have no caption box, so they are named from the original
filename. That is deliberate: renaming happens where the user is typing anyway (the
new-comment form), and a rename UI on the row would mean renaming files on disk.

- [ ] **Step 4: Export the handlers**

Add to `Object.assign(window, { … })` after `toggleCommentHold, closeOutComment, reopenComment, deleteComment,`:

```js
    renderPhotoStrip, onRowPhotoPick, removeCommentPhoto,
```

- [ ] **Step 5: Verify in the browser**

With the harness connected and a comment already carrying two photos from Task 4:

1. Expand the row — both thumbnails render with their captions.
2. Add a photo through `onRowPhotoPick` with a generated `File` named `valve label.png`
   → stored as `valve label.jpg`, strip repaints with three.
3. Click ✕ on one → it disappears from the strip, `state.comments[0].photos` is down to
   two, and the harness still holds all three files on disk (unlink, not delete).
4. Collapse and re-expand the row — the strip rebuilds correctly.
5. Delete `Photos/<REF>/thumbs/<name>.jpg` from the fake disk and repaint — the entry
   shows the missing-file placeholder instead of throwing.
6. Console shows no errors.

- [ ] **Step 6: Write the report**

Write `.superpowers/sdd/photos-task-5-report.md`. No commit.

---

### Task 6: full-size photo viewer

**Files:**
- Modify: `tools-src/comments-hub.html` — CSS after the `.photo-thumb` rules, viewer code after `renderPhotoStrip` (**no commit**; report to `.superpowers/sdd/photos-task-6-report.md`)

**Interfaces:**
- Consumes: `photoFullUrl` (Task 3); `state.comments`.
- Produces: `openPhotoViewer(commentId, index)`, `photoViewerStep(delta)`, `closePhotoViewer()` — `openPhotoViewer` is already referenced by Task 5's thumbnails.

- [ ] **Step 1: Add the CSS**

```css
  .pv-backdrop { position: fixed; inset: 0; background: color-mix(in srgb, #000 55%, transparent); display: flex; align-items: center; justify-content: center; z-index: 800; padding: 24px; }
  .pv-panel { position: relative; max-width: 92vw; max-height: 88vh; display: flex; flex-direction: column; gap: 10px; }
  .pv-panel img { max-width: 92vw; max-height: 78vh; object-fit: contain; border-radius: var(--radius-md); background: var(--bg2); }
  .pv-bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; color: var(--bg); font-size: 0.85rem; }
  .pv-cap { color: #fff; }
  .pv-btn { cursor: pointer; color: #fff; background: none; border: 1px solid rgba(255,255,255,0.5); border-radius: var(--radius-md); padding: 4px 10px; font-size: 0.85rem; }
```

The two `#fff` literals are deliberate: the bar sits on a dimmed photo, not on the
page background, so it must stay white in both light and dark modes.

- [ ] **Step 2: Add the viewer**

```js
  // Full-size viewer. The node is REMOVED on close, never just hidden:
  // .pv-backdrop declares display:flex, which beats [hidden] — the bug that made
  // the Product Brain's reader impossible to close.
  let photoViewer = null;      // { commentId, index }

  async function openPhotoViewer(commentId, index) {
    const c = state.comments.find(x => x.id === commentId);
    if (!c || !(c.photos || []).length) return;
    photoViewer = { commentId, index };
    closePhotoViewer(true);                       // drop any previous node
    const wrap = document.createElement('div');
    wrap.className = 'pv-backdrop';
    wrap.id = 'photo-viewer';
    wrap.onclick = ev => { if (ev.target === wrap) closePhotoViewer(); };
    document.body.appendChild(wrap);
    await paintPhotoViewer();
  }

  async function paintPhotoViewer() {
    const wrap = el('photo-viewer');
    if (!wrap || !photoViewer) return;
    const c = state.comments.find(x => x.id === photoViewer.commentId);
    const photos = (c && c.photos) || [];
    const p = photos[photoViewer.index];
    if (!p) { closePhotoViewer(); return; }
    let url = '';
    try { url = await photoFullUrl(p, c.ref); }
    catch (e) { toast('“' + p.file + '” is not in the Photos folder.'); closePhotoViewer(); return; }
    wrap.innerHTML =
      '<div class="pv-panel">' +
        '<img src="' + escAttr(url) + '" alt="' + escAttr(p.caption || p.file) + '"/>' +
        '<div class="pv-bar">' +
          '<span class="pv-cap">' + escHtml(p.caption || p.file) +
            ' · ' + (photoViewer.index + 1) + ' of ' + photos.length + '</span>' +
          '<span>' +
            (photos.length > 1
              ? '<button type="button" class="pv-btn" onclick="photoViewerStep(-1)">‹ Prev</button> ' +
                '<button type="button" class="pv-btn" onclick="photoViewerStep(1)">Next ›</button> '
              : '') +
            '<button type="button" class="pv-btn" onclick="closePhotoViewer()">✕ Close</button>' +
          '</span>' +
        '</div>' +
      '</div>';
  }

  function photoViewerStep(delta) {
    if (!photoViewer) return;
    const c = state.comments.find(x => x.id === photoViewer.commentId);
    const n = ((c && c.photos) || []).length;
    if (!n) { closePhotoViewer(); return; }
    photoViewer.index = (photoViewer.index + delta + n) % n;
    paintPhotoViewer();
  }

  function closePhotoViewer(keepState) {
    const wrap = el('photo-viewer');
    if (wrap) wrap.remove();
    if (!keepState) photoViewer = null;
  }
```

- [ ] **Step 3: Wire the keyboard**

Add a global listener next to the viewer code:

```js
  // Escape closes, arrows step — but never while the user is typing.
  document.addEventListener('keydown', ev => {
    if (!photoViewer) return;
    const t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (ev.key === 'Escape') { ev.preventDefault(); closePhotoViewer(); }
    else if (ev.key === 'ArrowRight') { ev.preventDefault(); photoViewerStep(1); }
    else if (ev.key === 'ArrowLeft') { ev.preventDefault(); photoViewerStep(-1); }
  });
```

- [ ] **Step 4: Export the handlers**

Add to `Object.assign(window, { … })` next to the Task 5 exports:

```js
    openPhotoViewer, photoViewerStep, closePhotoViewer,
```

- [ ] **Step 5: Verify in the browser**

Assert the **effect**, not the flag — a previous round was fooled by checking
`hidden` on a node that was still visible, and again by `offsetParent`, which is
null for `position: fixed`. Use `getComputedStyle` and `getBoundingClientRect`:

1. Click a thumbnail → `#photo-viewer` exists, its `getBoundingClientRect().height > 0`,
   and the caption reads `<caption> · 1 of 3`.
2. Next/Prev cycle through and wrap around.
3. `ArrowRight` steps; typing in the close-out textarea with the viewer open does not.
4. Escape closes: `document.getElementById('photo-viewer') === null`.
5. Clicking the image itself does **not** close; clicking the backdrop does.
6. Reopen after closing works.
7. Console shows no errors.

- [ ] **Step 6: Write the report**

Write `.superpowers/sdd/photos-task-6-report.md`. No commit.

---

### Task 7: endgame — sweep, lock, deploy

**Files:**
- Modify: `.superpowers/sdd/progress.md` (gitignored)
- Regenerate: `tools/*.html`, `tools/vault-manifest.json` via `scripts/lock-tools.mjs`

**Interfaces:**
- Consumes: everything above.
- Produces: a deployed, live-verified Comments Hub.

- [ ] **Step 1: Review sweep**

Read the whole photo path in `tools-src/comments-hub.html` in one pass. Confirm: every
user string goes through `escHtml`/`escAttr`; no external requests; no hardcoded colours
outside the two documented `#fff` literals in `.pv-bar`; object URLs are revoked on
remove and on form clear; no `removeEntry` call anywhere near photos (files are never
deleted).

- [ ] **Step 2: Full-suite gate**

Run: `npm test 2>&1 | tail -12`
Expected: `# fail 0` with 116 tests.

- [ ] **Step 3: End-to-end browser pass**

With the fake-handle harness: log a comment with two captioned photos, add a third from
the dashboard row, remove one, open the viewer and close it with Escape, then trigger the
Excel regeneration and re-parse `Master Log.xlsx` with the vendored ExcelJS. Expected: the
Photos column reads `2 photos: …` for that comment. Zero console errors.

- [ ] **Step 4: Lock**

Ask Harvey for the workshop code in chat — it is **not on disk**. Feed it to
`scripts/lock-tools.mjs` through the delayed-stdin harness (write the code to an env var,
feed it at 1s and 3s; the zero-delay pipe path flakes). Then verify: `checkKey` true with
the real code and false with a wrong one, and all 7 payloads decrypt byte-identical to
their `tools-src/` sources.

- [ ] **Step 5: Deploy and live-verify**

```bash
git add tools/
git commit -m "feat: photos on comments in the Comments Hub"
git push origin main
```

Then confirm the live site: `tools/comments-hub.html` and `assets/js/hub-core.js` return
200, `tools-src/` returns 404, and the live loader's md5 matches the local build.

- [ ] **Step 6: Update the ledger**

Append a section to `.superpowers/sdd/progress.md` recording what shipped, the
verification evidence, and anything left open for Harvey (notably: click through the real
folder — attach a real site photo, confirm it lands in `Photos/<REF>/` and opens from
another machine once OneDrive syncs).

---

## Notes for the implementer

- The New Comment queue holds `File` objects, not bytes. If the tab is closed before
  the comment is logged, the photos are simply never written — that is intended.
- `savePhoto` writes the full copy before the thumbnail. A failure between the two
  leaves a full copy with no thumbnail; the strip then shows the missing-thumbnail
  placeholder rather than throwing, and re-adding the photo writes a ` (2)` copy.
  Accepted for v1.
- Family and per-product workbooks inherit the Photos column automatically because
  they build their rows from `COMMENT_COLUMNS` and `commentRow`. Do not add it twice.
