// assets/js/xlsx-render.js
// Turns a workbook model ({filename, sheets:[{name, kind, columns, rows}]})
// into an xlsx buffer. Shared by the Comments Hub (comment logs) and the
// Product Brain (decisions export) so the two never drift apart.
// ExcelJS is passed in rather than imported: both tools load the vendored
// browser bundle as a global script.

export async function renderWorkbook(model, ExcelJS, colors) {
  const wb = new ExcelJS.Workbook();
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
