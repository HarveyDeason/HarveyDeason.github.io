// assets/js/xlsx-render.js
// Turns a workbook model ({filename, sheets:[{name, kind, columns, rows}]})
// into an xlsx buffer. Shared by the Comments Hub (comment logs) and the
// Decision Register (decisions export) so the two never drift apart.
// ExcelJS is passed in rather than imported: both tools load the vendored
// browser bundle as a global script.

// The `lists` sheet backs the dropdowns on a `template` sheet. Each list is
// written into its own column, one value per row, starting at row 1 (no
// header) so validation formulae can address a clean $COL$1:$COL$N range.
// The `products` list is special: a dropdown can only offer names, but the
// id is what Task 3 needs to match a returned template back to a product
// without guessing from a (possibly hand-edited) name. So `products` gets
// two adjacent columns — name first (what the dropdown points at), id right
// next to it on the same row — keeping the pairing trivial to read back.
const LIST_COLUMN_ORDER = ['products', 'categories', 'sources', 'priorities', 'yesNo'];

function listColumnLetters() {
  // Assigns column letters left-to-right in LIST_COLUMN_ORDER, giving
  // `products` two columns (name, id) and everything else one.
  const letters = {};
  let col = 1;
  for (const key of LIST_COLUMN_ORDER) {
    letters[key] = col;
    col += key === 'products' ? 2 : 1;
  }
  return letters;
}

function colLetter(n) {
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Comment photo thumbnails, embedded per log row (see hub-core.js's
// photoRefs). Sized in pixels, not Excel's native column/row units, because
// that is the unit ExcelJS's image `ext` and this file's row-height math
// both work in.
const PHOTO_THUMB_PX = 80;
// Row height in points (Excel's row-height unit; 1pt = 4/3 px) tall enough
// to show an 80px-high thumbnail without clipping it, plus a little padding
// so it doesn't touch the row above/below.
const PHOTO_ROW_HEIGHT_PT = 62;
// Pixel-to-column-width conversion is only approximate (Excel's width unit
// depends on the default font), but exactness doesn't matter here — this
// only sizes the virtual columns to the right of `photos` widely enough that
// consecutive 80px thumbnails don't visually overlap each other.
const PHOTO_COL_WIDTH = Math.ceil(PHOTO_THUMB_PX / 7) + 1;

// Failsafe ceiling on total images embedded in one workbook. Generous — a
// realistic per-product log tops out in the hundreds — but a hand-edited
// ledger or a huge family rollup could in principle carry far more, and
// exhausting browser memory mid-generation fails the ENTIRE export. Past
// this cap we stop embedding and fall back to the text list (already the
// per-row fallback for any missing thumbnail) rather than risk that.
export const MAX_EMBEDDED_IMAGES_PER_WORKBOOK = 2500;

function imageExtension(filename) {
  const ext = String(filename || '').split('.').pop().toLowerCase();
  if (ext === 'png') return 'png';
  if (ext === 'gif') return 'gif';
  return 'jpeg'; // thumbnails are always written as .jpg by savePhoto
}

// images is an optional Map< `${ref}/${file}`, ArrayBuffer|Uint8Array >
// carrying thumbnail bytes for photoRefs declared on log rows (see
// hub-core.js). Omitted/empty reproduces today's behaviour exactly — no
// model in the codebase relies on this parameter yet except product comment
// logs, and this file is shared with the Decision Register, which never
// passes it.
//
// maxImages defaults to the real production ceiling and is not part of the
// documented call shape (Task 3 always calls with exactly 4 arguments) — it
// exists purely so tests can exercise the failsafe's exact-cap behaviour
// without actually embedding thousands of images and paying real zip-
// compression cost for every test run.
export async function renderWorkbook(model, ExcelJS, colors, images, maxImages = MAX_EMBEDDED_IMAGES_PER_WORKBOOK) {
  const imageMap = images instanceof Map ? images : new Map();
  const wb = new ExcelJS.Workbook();
  // Lists sheets are written before template sheets need to reference them,
  // but a model's sheet order isn't guaranteed either way, so collect the
  // validation ranges up front by walking all sheets first.
  const listRanges = {};
  for (const sheet of model.sheets) {
    if (sheet.kind !== 'lists') continue;
    const letters = listColumnLetters();
    for (const key of Object.keys(sheet.lists || {})) {
      const values = sheet.lists[key];
      const nameCol = letters[key];
      if (nameCol === undefined || !values.length) continue;
      const letter = colLetter(nameCol);
      listRanges[key] = `${sheet.name}!$${letter}$1:$${letter}$${values.length}`;
    }
  }
  // Pre-scan every log row's photoRefs to see how many images this workbook
  // would actually embed (i.e. have matching bytes in imageMap) BEFORE
  // writing anything — the Summary sheet, which needs to carry the failsafe
  // note when the cap bites, is very likely written before the log sheet
  // that triggers it, so the decision can't be made mid-write.
  let embeddable = 0;
  for (const sheet of model.sheets) {
    if (sheet.kind !== 'log') continue;
    for (const row of sheet.rows || []) {
      for (const pr of (Array.isArray(row.photoRefs) ? row.photoRefs : [])) {
        if (pr && pr.file && imageMap.has(`${pr.ref}/${pr.file}`)) embeddable += 1;
      }
    }
  }
  const capped = embeddable > maxImages;
  let embeddedCount = 0;
  for (const sheet of model.sheets) {
    const ws = wb.addWorksheet(sheet.name);
    if (sheet.kind === 'summary') {
      ws.columns = [{ width: 24 }, { width: 70 }];
      const t = ws.addRow([sheet.meta.title]);
      t.font = { bold: true, size: 14, color: { argb: colors.headerFill } };
      ws.addRow([]);
      for (const [label, value] of sheet.rows) {
        const r = ws.addRow([label, value]);
        r.getCell(1).font = { bold: true };
        r.alignment = { vertical: 'top', wrapText: true };
      }
      // Failsafe note: a comment log that stopped short of embedding every
      // photo is far better than one that failed to generate at all, but a
      // reader flipping straight to the Comment Log sheet has no way to
      // notice photos are missing unless the Summary sheet says so.
      if (capped) {
        const note = ws.addRow(['Note', `Photo embedding stopped after ${maxImages} images to protect memory during export. Remaining photos are listed by filename in the Photos column and remain available in the shared Photos folder.`]);
        note.getCell(1).font = { bold: true };
        note.alignment = { vertical: 'top', wrapText: true };
      }
    } else if (sheet.kind === 'template') {
      // The blank sheet a site team fills in offline: header band, frozen
      // so it stays visible while they scroll, and dropdowns backed by the
      // hidden Lists sheet rather than free text.
      ws.columns = sheet.columns.map(c => ({ key: c.key, width: c.width }));
      const head = ws.addRow(sheet.columns.map(c => c.header));
      head.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.headerFill } };
        cell.font = { bold: true, color: { argb: colors.headerText } };
      });
      ws.views = [{ state: 'frozen', ySplit: 1 }];

      const descCol = sheet.columns.findIndex(c => c.key === 'description') + 1;
      // A date-formatted cell both shows the site team a proper date (rather
      // than a raw serial number) and is more likely to come back as a Date
      // object instead of a serial once they've edited and re-saved it.
      const dateCol = sheet.columns.findIndex(c => c.key === 'dateRaised') + 1;
      const rowCount = sheet.rowCount || 0;
      for (let i = 0; i < rowCount; i++) {
        // Only the very first blank row gets pre-filled (e.g. a single
        // scoped product) — the rest stay empty for the site team.
        const values = sheet.columns.map(c => (i === 0 && sheet.prefill && sheet.prefill[c.key]) || '');
        const r = ws.addRow(values);
        r.alignment = { vertical: 'top' };
        if (descCol) r.getCell(descCol).alignment = { vertical: 'top', wrapText: true };
        if (dateCol) r.getCell(dateCol).numFmt = 'dd/mm/yyyy';
      }

      // Validation is applied down every blank row (not just the first) so
      // a site team adding rows beneath the pre-filled ones doesn't
      // silently lose the dropdown.
      for (const v of sheet.validations || []) {
        const colIndex = sheet.columns.findIndex(c => c.key === v.columnKey) + 1;
        const formula = listRanges[v.listRef];
        if (!colIndex || !formula) continue;
        for (let r = 2; r <= rowCount + 1; r++) {
          ws.getCell(r, colIndex).dataValidation = { type: 'list', allowBlank: true, formulae: [formula] };
        }
      }
    } else if (sheet.kind === 'lists') {
      // Reference data for the template's dropdowns, kept off-screen from
      // the site team. Each list gets its own column, one value per row,
      // starting at row 1 with no header — see listColumnLetters() above
      // for why `products` gets two columns (name + id) instead of one.
      const letters = listColumnLetters();
      for (const key of Object.keys(sheet.lists || {})) {
        const values = sheet.lists[key];
        const col = letters[key];
        if (col === undefined) continue;
        values.forEach((item, i) => {
          if (key === 'products') {
            ws.getCell(i + 1, col).value = item.name;
            ws.getCell(i + 1, col + 1).value = item.id;
          } else {
            ws.getCell(i + 1, col).value = item;
          }
        });
      }
      // Metadata as label/value pairs in a column pair well clear of the
      // lists (which end at column 6). The importer finds these by LABEL, not
      // by row, so adding a field later cannot shift the others out from
      // under it. Without this the template version exists only in the model
      // and never reaches the file, so a returned sheet could not be checked
      // for drift at all.
      const META_LABEL_COL = 8;
      let metaRow = 1;
      for (const [key, value] of Object.entries(sheet.meta || {})) {
        ws.getCell(metaRow, META_LABEL_COL).value = key;
        ws.getCell(metaRow, META_LABEL_COL + 1).value = value;
        metaRow += 1;
      }
      // veryHidden (not just hidden) means it can't be unhidden from the
      // Excel UI by right-clicking the sheet tabs — only via the VBA/object
      // model, which a site team filling in a form has no reason to touch.
      ws.state = 'veryHidden';
    } else {
      ws.columns = sheet.columns.map(c => ({ key: c.key, width: c.width }));
      // Optional per-sheet heading: a bold title row spanning the columns,
      // above the header band. Freeze/autofilter then shift down one row.
      let headerRow = 1;
      if (sheet.heading) {
        const hr = ws.addRow([sheet.heading]);
        ws.mergeCells(1, 1, 1, sheet.columns.length);
        hr.getCell(1).font = { bold: true, size: 13, color: { argb: colors.headerFill } };
        hr.getCell(1).alignment = { vertical: 'middle' };
        headerRow = 2;
      }
      const head = ws.addRow(sheet.columns.map(c => c.header));
      head.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.headerFill } };
        cell.font = { bold: true, color: { argb: colors.headerText } };
      });
      ws.views = [{ state: 'frozen', ySplit: headerRow }];
      ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: sheet.columns.length } };
      // 0-based column index of `photos`, the last COMMENT_COLUMNS entry —
      // thumbnails are placed as a strip starting here and extending
      // rightward into the empty columns beyond the table, which is exactly
      // why that column was chosen as the anchor (see the plan).
      const photosColIndex0 = sheet.columns.findIndex(c => c.key === 'photos');
      sheet.rows.forEach((row, i) => {
        const r = ws.addRow(sheet.columns.map(c => row.cells[c.key] ?? ''));
        r.alignment = { vertical: 'top', wrapText: true };
        if (i % 2 === 1) r.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.zebra } };
        });
        const statusCol = sheet.columns.findIndex(c => c.key === 'status') + 1;
        const statusColor = { open: colors.open, in_progress: colors.inProgress, closed: colors.closed }[row.statusKey];
        if (statusCol && statusColor) r.getCell(statusCol).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: statusColor } };
        const prioCol = sheet.columns.findIndex(c => c.key === 'priority') + 1;
        if (prioCol && row.high) r.getCell(prioCol).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.high } };

        // photoRefs is only ever set by buildProductWorkbookModel — every
        // other model (Master Log, filtered export, Decision Register) has
        // no photoRefs on its rows, so this whole block is a no-op for them.
        const photoRefs = photosColIndex0 < 0 ? [] : (Array.isArray(row.photoRefs) ? row.photoRefs : []);
        let embeddedOnRow = false;
        photoRefs.forEach((pr, slot) => {
          if (!pr || !pr.file || embeddedCount >= maxImages) return;
          const bytes = imageMap.get(`${pr.ref}/${pr.file}`);
          // No matching bytes is the normal case for a missing/unreadable
          // thumbnail — fall back silently to the text cell (already
          // written above via row.cells.photos) rather than erroring.
          if (!bytes) return;
          const col0 = photosColIndex0 + slot;
          try {
            const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
            const imgId = wb.addImage({ buffer, extension: imageExtension(pr.file) });
            ws.addImage(imgId, {
              tl: { col: col0, row: r.number - 1 },
              ext: { width: PHOTO_THUMB_PX, height: PHOTO_THUMB_PX },
            });
            // ExcelJS leaves .width undefined for a column nobody has
            // touched yet (`undefined < n` is false), so that has to be
            // treated as "narrower than we need", not skipped.
            const imgCol = ws.getColumn(col0 + 1);
            if (!(imgCol.width >= PHOTO_COL_WIDTH)) imgCol.width = PHOTO_COL_WIDTH;
            embeddedCount += 1;
            embeddedOnRow = true;
          } catch {
            // A corrupt/unreadable buffer must never fail the whole export —
            // this one photo silently falls back to the text cell.
          }
        });
        if (embeddedOnRow) r.height = PHOTO_ROW_HEIGHT_PT;
      });
    }
  }
  return wb.xlsx.writeBuffer();
}
