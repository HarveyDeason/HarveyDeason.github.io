// tests/fixtures/tiny-pdf.js
// A hand-built PDF with invented linework, so the walker can be tested against
// what the vendored pdf.js really emits without any client drawing.
export function tinyPdf(content, formContent = '') {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> /XObject << /X1 6 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Type /XObject /Subtype /Form /BBox [0 0 50 50] /Matrix [1 0 0 1 100 0] /Length ${formContent.length} >>\nstream\n${formContent}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, c => c.charCodeAt(0)); // ASCII only; no Buffer, so it also runs in a browser
}

export const TINY_CONTENT = [
  '2 w 10 10 m 60 10 l S',                         // 2 pt black line
  '0.5 G 1 w 10 20 30 15 re S',                    // grey rectangle outline
  'q 0.5 0 0 0.5 0 0 cm 4 w 20 80 m 120 80 l S Q', // drawn at half scale
  '0 g 70 60 m 80 60 l 75 70 l h f',               // filled triangle
  '0 G 1 w 10 50 m 20 70 40 70 50 50 c S',         // one Bezier
  '/X1 Do',                                        // form XObject, moved 100 pt right
  'BT /F1 10 Tf 12 85 Td (HELLO) Tj ET',
].join('\n');
export const TINY_FORM = '1 w 0 0 m 10 0 l S';
