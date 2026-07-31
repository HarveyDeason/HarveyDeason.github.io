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

export async function renderWorkbook(model, ExcelJS, colors) {
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
      });
    }
  }
  return wb.xlsx.writeBuffer();
}
