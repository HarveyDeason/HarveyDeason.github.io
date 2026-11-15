// tests/fixtures/symbol-check-sheet.js
// An invented symbol library and an invented sheet for the symbol check.
// Nothing here comes from a real legend or drawing.
const line = segs => ({ segs, width: 0.7, stroked: true, filled: false, grey: 0 });
const loop = pts => line(pts.flatMap((p, i) => [...p, ...pts[(i + 1) % pts.length]]));
const sym = (id, name, group, tagId, w, h, paths, flags = {}) => ({ id, name, legendName: name, group, tagId, sheet: '1', w, h, paths,
  letters: [], flags: { simple: false, stretch: false, manual: false, unmatched: false, ...flags }, aliases: [], notes: [] });

const bowtie = () => [loop([[0, 0], [0, 12], [12, 6]]), loop([[24, 0], [24, 12], [12, 6]])];
export const LIBRARY = { version: 1, legend: [{ sheet: '1', rev: 'A', page: 1 }], importedAt: '2026-01-01T00:00:00.000Z', families: {},
  symbols: [
    sym('s1', 'WIDGET', 'WIDGETS', 'W', 24, 12, bowtie()),
    // Same box as WIDGET with two bars inside it, so each is clearly not the other (about 0.8 either way).
    sym('s2', 'WIDGET, BARRED', 'WIDGETS', 'W', 24, 12, [...bowtie(), line([12, 0, 12, 12]), line([4, 6, 20, 6])]),
    sym('s3', 'GADGET', 'GADGETS', 'G', 20, 20, [loop([[0, 0], [20, 0], [20, 20], [0, 20]]), line([0, 0, 20, 20])]),
    sym('s4', 'PENNANT, LEFT', 'PENNANTS', 'P', 10, 20, [line([0, 0, 0, 20]), loop([[0, 0], [10, 5], [0, 10]])]),
    sym('s5', 'PENNANT, RIGHT', 'PENNANTS', 'P', 10, 20, [line([10, 0, 10, 20]), loop([[10, 0], [0, 5], [10, 10]])]),
    sym('s6', 'DASH', 'DASHES', 'D', 12, 0, [line([0, 0, 12, 0])]),
    sym('s7', 'VAT', 'VATS', 'T', 40, 30, [loop([[0, 0], [40, 0], [40, 30], [0, 30]])], { stretch: true }),
    sym('s8', 'BROKEN', 'WIDGETS', 'W', 10, 10, [{ segs: [0, 0, 'x', NaN], width: 1, stroked: true, filled: false, grey: 0 }]),
    sym('s9', '<img src=x onerror=alert(1)>', 'GADGETS', 'G', 0, 0, [], { manual: true }),
  ],
  exceptions: [{ name: 'Folding widget', status: 'approved', note: '', ref: 'RFI 1' }, { name: 'Sliding gadget', status: 'pending', note: '', ref: '' }] };
export const LOOKUPS = { fc: { ZI: 'instrument' } };
const byName = n => LIBRARY.symbols.find(s => s.name === n);

// o: 0-3 turn the symbol by 0, 90, 180, 270 degrees; 4-7 the same after a mirror. k: size. fill: closed loops solid.
// (x, y) is the top-left of the placed symbol's box.
export function place(symbol, { x, y, o = 0, k = 1, fill = false }) {
  const [c, s] = [[1, 0], [0, 1], [-1, 0], [0, -1]][o % 4], m = o >= 4 ? -1 : 1;
  const tf = (px, py) => [k * (c * m * px - s * py), k * (s * m * px + c * py)];
  const corners = [tf(0, 0), tf(symbol.w, 0), tf(0, symbol.h), tf(symbol.w, symbol.h)];
  const ox = x - Math.min(...corners.map(p => p[0])), oy = y - Math.min(...corners.map(p => p[1]));
  return symbol.paths.map(p => {
    const segs = []; for (let i = 0; i < p.segs.length; i += 2) { const q = tf(p.segs[i], p.segs[i + 1]); segs.push(q[0] + ox, q[1] + oy); }
    const closed = segs.length >= 12 && segs[0] === segs[segs.length - 2] && segs[1] === segs[segs.length - 1];
    return { ...p, segs, filled: fill && closed };
  });
}
// A tag as pdf.js text items. split: the code on one line, the number on the next, a blank item between.
export function label(tag, x, y, { split = false } = {}) {
  const item = (str, ix, iy) => ({ str, transform: [8, 0, 0, 8, ix, iy], width: str.length * 4.4, height: 8 });
  if (!split) return [item(tag, x, y)];
  const cut = tag.lastIndexOf('-');
  return [item(tag.slice(0, cut), x, y), item('', x, y), item(tag.slice(cut + 1), x, y + 10)];
}
export const octagon = (x, y) => [loop([0, 1, 2, 3, 4, 5, 6, 7].map(i => [x + 8 + 8 * Math.cos(i * Math.PI / 4), y + 8 + 8 * Math.sin(i * Math.PI / 4)]))];
const pipe = (x, y, w) => [line([x - 30, y, x, y]), line([x + w, y, x + w + 30, y])];

// Each tag sits 20 pt above its item. Items are 100 pt apart, further than the 60 pt search.
const ROWS = [
  ['21-W-1001', 100, 80, {}, place(byName('WIDGET'), { x: 100, y: 100 }), pipe(100, 106, 24)],
  ['21-W-1002', 200, 76, { split: true }, place(byName('WIDGET'), { x: 200, y: 100, o: 1, fill: true }), []],
  ['21-W-1003', 300, 80, {}, place(byName('WIDGET'), { x: 300, y: 100, k: 1.2 }), pipe(300, 107.2, 28.8)],
  ['21-P-6001', 400, 80, {}, place(byName('PENNANT, LEFT'), { x: 400, y: 100 }), []],
  ['21-G-2001', 100, 180, {}, place(byName('WIDGET, BARRED'), { x: 100, y: 200 }), pipe(100, 206, 24)],
  ['21-W-1004', 200, 180, {}, octagon(200, 200), []],
  ['21-G-2002', 300, 180, {}, octagon(300, 200), []],
  ['21-X-7001', 400, 180, {}, [], []],
  ['21-D-3001', 100, 280, {}, place(byName('DASH'), { x: 100, y: 300 }), []],
  ['21-T-4001', 200, 280, {}, place(byName('VAT'), { x: 200, y: 300, k: 1.5 }), []],
  ['21-ZI-5001', 300, 280, {}, [], []],
];
export const SHEET = {
  viewportTransform: [1, 0, 0, 1, 0, 0],   // the arrays below are already top-left points
  paths: ROWS.flatMap(r => [...r[4], ...r[5]]),
  textItems: [{ str: 'INVENTED SHEET', transform: [8, 0, 0, 8, 20, 20], width: 70, height: 8 }, ...ROWS.flatMap(r => label(r[0], r[1], r[2], r[3]))],
  tags: ROWS.map(r => ({ tag: r[0], fc: r[0].split('-')[1] })),
};

// The same sheet as a one-page 500 x 400 pt PDF, for the Gate 3 script's tests and the browser.
// rotate: the page's /Rotate. origin: where the MediaBox starts; the content is moved with it, so the
// sheet looks the same in a viewer. With no options, the bytes are exactly what they always were.
export function sheetPdfBytes({ rotate = 0, origin = [0, 0] } = {}) {
  const H = 400, n = v => String(Math.round(v * 100) / 100);
  const [ox, oy] = origin;
  let c = ox || oy ? `1 0 0 1 ${n(ox)} ${n(oy)} cm\n` : '';
  for (const p of SHEET.paths) {
    c += `${n(p.width)} w\n`;
    for (let i = 0; i + 3 < p.segs.length; i += 4) c += `${n(p.segs[i])} ${n(H - p.segs[i + 1])} m ${n(p.segs[i + 2])} ${n(H - p.segs[i + 3])} l\n`;
    c += p.filled ? 'B\n' : 'S\n';
  }
  for (const t of SHEET.textItems) if (t.str) c += `BT /F1 8 Tf ${n(t.transform[4])} ${n(H - t.transform[5] - 8)} Td (${t.str}) Tj ET\n`;
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [${n(ox)} ${n(oy)} ${n(ox + 500)} ${n(oy + 400)}]${rotate ? ` /Rotate ${rotate}` : ''} /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
    `<< /Length ${c.length} >>\nstream\n${c}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n'; const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, ch => ch.charCodeAt(0));
}

// ── Tag bubbles (invented) ────────────────────────────────────────────────
// Six invented bubble kinds, near a real legend's proportions: a 40 pt ring,
// bars 3 pt apart, a broken bar with an 8 pt gap.
const ringPts = (cx, cy, r) => Array.from({ length: 32 }, (_, i) => [cx + r * Math.cos(Math.PI * i / 16), cy + r * Math.sin(Math.PI * i / 16)]);
const RING = () => [loop(ringPts(20, 20, 20))];
const bubble = (id, name, w, h, paths, ring = [0, 0, w, h]) => ({ ...sym(id, name, 'GIZMO TAGS', '', w, h, paths, { bubble: true, bubbleByHand: false }), ring });
export const BUBBLES = [
  bubble('b1', 'RING', 40, 40, RING()),
  bubble('b2', 'RING, ONE BAR', 40, 40, [...RING(), line([0, 20, 40, 20])]),
  bubble('b3', 'RING, TWO BARS', 40, 40, [...RING(), line([0, 18.5, 40, 18.5]), line([0, 21.5, 40, 21.5])]),
  bubble('b4', 'RING, BROKEN BAR', 40, 40, [...RING(), line([0, 20, 16, 20]), line([24, 20, 40, 20])]),
  bubble('b5', 'BOXED RING', 40, 40, [...RING(), loop([[0, 0], [40, 0], [40, 40], [0, 40]])]),
  bubble('b6', 'HEXAGON', 46, 40, [loop([[0, 20], [11.5, 0], [34.5, 0], [46, 20], [34.5, 40], [11.5, 40]])]),
];
export const BUBBLE_LIBRARY = { ...LIBRARY, symbols: [...LIBRARY.symbols, ...BUBBLES] };
export const LOOKUPS_B = { fc: { ZI: 'instrument', ZP: 'instrument' } };
const bub = n => BUBBLES.find(s => s.name === n);
// A tag split over two lines, centred on (cx, cy): the code line is 22 pt wide, the whole 18 pt tall.
const inside = (tag, cx, cy) => label(tag, cx - 11, cy - 9, { split: true });
const B_ROWS = [
  // [tag, drawn paths, text items]
  ['21-ZI-8001', place(bub('RING'), { x: 100, y: 100 }), inside('21-ZI-8001', 120, 120)],
  ['21-ZI-8002', place(bub('RING, ONE BAR'), { x: 220, y: 100 }), inside('21-ZI-8002', 240, 120)],
  ['21-ZI-8003', place(bub('RING, TWO BARS'), { x: 340, y: 100 }), inside('21-ZI-8003', 360, 120)],
  ['21-ZI-8004', place(bub('RING, BROKEN BAR'), { x: 460, y: 100 }), inside('21-ZI-8004', 480, 120)],
  ['21-ZI-8005', place(bub('BOXED RING'), { x: 100, y: 220 }), inside('21-ZI-8005', 120, 240)],
  ['21-ZI-8006', place(bub('HEXAGON'), { x: 220, y: 220 }), inside('21-ZI-8006', 243, 240)],
  ['21-ZI-8007', place(bub('RING'), { x: 340, y: 220, k: 1.25 }), inside('21-ZI-8007', 365, 245)],
  ['21-X-8008', place(bub('RING'), { x: 460, y: 220 }), inside('21-X-8008', 480, 240)],
  ['21-ZP-8009', [], inside('21-ZP-8009', 120, 360)],
  // Written beside a ring, not in it: the ring's centre is (240, 360), the tag 30 pt clear of its edge.
  ['21-W-8010', place(bub('RING'), { x: 220, y: 340 }), label('21-W-8010', 290, 356)],
  // A bare square round the text: an outline, but no standard bubble.
  ['21-ZI-8011', [loop([[340, 340], [380, 340], [380, 380], [340, 380]])], inside('21-ZI-8011', 360, 360)],
  // In a ring, and written a second time below it with no outline.
  ['21-ZI-8012', place(bub('RING'), { x: 460, y: 340 }), [...inside('21-ZI-8012', 480, 360), ...label('21-ZI-8012', 460, 420)]],
];
export const BUBBLE_SHEET = {
  viewportTransform: [1, 0, 0, 1, 0, 0],
  paths: [...B_ROWS.flatMap(r => r[1]), loop([[10, 10], [590, 10], [590, 470], [10, 470]])],
  textItems: B_ROWS.flatMap(r => r[2]),
  tags: B_ROWS.map(r => ({ tag: r[0], fc: r[0].split('-')[1] })),
};
