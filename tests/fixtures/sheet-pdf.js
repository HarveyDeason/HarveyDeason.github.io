// tests/fixtures/sheet-pdf.js
// Invented PDFs for the sheet pre-checks: pages with or without a text layer,
// with or without comments, and a document information dictionary. Nothing
// here comes from a real drawing: the tags, programs and names are made up.
export const SHX_AUTHOR = 'AutoCAD SHX Text';
const pdfStr = s => '(' + String(s).replace(/[\\()]/g, c => '\\' + c) + ')';

// pages: [{ size: [w, h], text: [string], comments: [{ text, author, rect, subtype }] }]
// info:  { Creator, Producer, ... }, or null for a PDF with no information dictionary
export function sheetPdf({ pages = [{}], info = null } = {}) {
  const objs = [];                                   // objs[n - 1] is object n
  const add = body => { objs.push(body); return objs.length; };
  const catalog = add(''), tree = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids = [];
  for (const p of pages) {
    const [w, h] = p.size || [200, 100];
    const content = (p.text || []).map((t, i) => `BT /F1 8 Tf 10 ${h - 12 - i * 10} Td ${pdfStr(t)} Tj ET`).join('\n');
    const stream = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const annots = (p.comments || []).map(c => add(
      `<< /Type /Annot /Subtype /${c.subtype || 'Square'} /Rect [${(c.rect || [10, 10, 60, 20]).join(' ')}] ` +
      `/Contents ${pdfStr(c.text)} /T ${pdfStr(c.author == null ? SHX_AUTHOR : c.author)} /F 64 /BS << /W 0 >> >>`));
    kids.push(add(`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${w} ${h}] /Contents ${stream} 0 R ` +
      `/Resources << /Font << /F1 ${font} 0 R >> >> /Annots [${annots.map(n => n + ' 0 R').join(' ')}] >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${tree} 0 R >>`;
  objs[tree - 1] = `<< /Type /Pages /Kids [${kids.map(n => n + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
  const infoObj = info ? add('<< ' + Object.entries(info).map(([k, v]) => `/${k} ${pdfStr(v)}`).join(' ') + ' >>') : 0;
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R${infoObj ? ` /Info ${infoObj} 0 R` : ''} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, c => c.charCodeAt(0));   // ASCII only; no Buffer, so it also runs in a browser
}

const CAD = { Creator: 'Invented CAD 1.0', Producer: 'Invented Plotter (v2)' };
const A1 = [2384, 1684], A3 = [1191, 842];

// One of each kind of sheet the pre-check has to tell apart.
export const SHEETS = {
  // Plotted, real text layer with tags. Also carries the three kinds of comment
  // seen in practice: a letter with formatting codes, a tag the text layer
  // lacks, and a reviewer's mark-up. Two pages.
  plotted: { info: CAD, pages: [
    { size: A1, text: ['21-XX-1001', 'TITLE BLOCK', '21-YY 1002'], comments: [
      { text: '\\pxqc;{\\W0.85;M}', rect: [168, 1251, 188, 1271] },
      { text: '21-XX-2001', rect: [10, 20, 60, 30] },
      { text: 'change 21-XX-9999', author: 'A Reviewer', subtype: 'Text', rect: [5, 5, 25, 25] }] },
    { size: A3 }] },
  // Printed: no text layer, no comments, and only a printer named.
  printed: { info: { Producer: 'Invented Printer' }, pages: [{ size: A1 }] },
  // Labels drawn as linework and kept as comments; the title block is real text.
  // The comments hold tags: one plain, one with formatting codes, one split over
  // two comments, one for review.
  commentsWithTags: { info: CAD, pages: [{ size: A3, text: ['TITLE BLOCK', 'REV A'], comments: [
    { text: '21-XX-3001', rect: [100, 700, 150, 710] },
    { text: '{\\W0.85;21-YY-3002}', rect: [200, 700, 250, 710] },
    { text: '21-XX', rect: [300, 700, 330, 710] }, { text: '3003', rect: [300, 688, 330, 698] },
    { text: '21_YY_3004', rect: [400, 700, 450, 710] },
    { text: 'FEED PUMP', rect: [100, 600, 160, 610] }] }] },
  // The same kind of sheet with labels but no tags in them.
  commentsNoTags: { info: CAD, pages: [{ size: A3, text: ['TITLE BLOCK', 'REV A'], comments: [
    { text: 'FEED PUMP', rect: [100, 600, 160, 610] }, { text: 'OUTLET', rect: [300, 600, 340, 610] }] }] },
  // Printed, then marked up by a reviewer who typed tags into comments.
  printedWithMarkup: { info: { Producer: 'Invented Printer' }, pages: [{ size: A1, comments: [
    { text: 'should be 21-XX-9001', author: 'A Reviewer', subtype: 'FreeText', rect: [50, 50, 200, 70] },
    { text: '21-YY-9002 missing', author: 'A Reviewer', subtype: 'Text', rect: [60, 90, 80, 110] }] }] },
  // Markup in the metadata and in a comment.
  hostile: { info: { Creator: '<img src=x onerror=alert(1)>', Producer: '"><script>alert(2)</script>' }, pages: [{ size: [1000, 700],
    comments: [{ text: '<b>21-XX-4001</b>', rect: [10, 10, 60, 20] }] }] },
};
