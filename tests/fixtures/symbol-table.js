// tests/fixtures/symbol-table.js
// Invented ruled tables. Nothing here comes from a real legend.
import { FAKE_OPS } from './symbol-ops.js';

export const rule = (x0, y0, x1, y1) => ({ segs: [x0, y0, x1, y1], width: 0.7, stroked: true, filled: false, grey: 0 });
export const box = (x, y, w, h) => ({
  segs: [x, y, x + w, y, x + w, y, x + w, y + h, x + w, y + h, x, y + h, x, y + h, x, y],
  width: 0.7, stroked: true, filled: false, grey: 0 });
export const word = (str, x, y, w = str.length * 5, h = 8) => ({ str, x, y, w, h });

// ys: every horizontal rule, top border to bottom border. The divider runs from
// the top down to ys[dividerTo].
export function ruledTable({ x0, x1, divider, ys, dividerTo = ys.length - 1 }) {
  const paths = ys.map(y => rule(x0, y, x1, y));
  paths.push(rule(x0, ys[0], x0, ys[ys.length - 1]), rule(x1, ys[0], x1, ys[ys.length - 1]));
  if (divider != null) paths.push(rule(divider, ys[0], divider, ys[dividerTo]));
  return paths;
}

export const WIDGET_YS = [50, 80, 110, 150, 190, 230];
export function widgetTable() {
  return {
    paths: [...ruledTable({ x0: 100, x1: 400, divider: 250, ys: WIDGET_YS }),
      box(300, 120, 40, 20), box(290, 160, 60, 20), box(310, 200, 20, 20)],
    words: [word('FUNCTIONAL TAG', 105, 55), word('IDENTIFIER', 105, 66), word('Q', 320, 60),
      word('WIDGETS', 105, 90), word('SYMBOL', 300, 90),
      word('ROUND WIDGET', 105, 125),
      word('WIDGET (LARGE)', 105, 170), word('SQUARE', 105, 158), word('M', 315, 165),
      word('LAST WIDGET', 105, 205)],
  };
}

// A closed ring of `sides` straight segments, centred on (cx, cy), as one path.
export function ringPath(cx, cy, r, sides = 32) {
  const pts = [];
  for (let i = 0; i < sides; i++) pts.push([cx + r * Math.cos(2 * Math.PI * i / sides), cy + r * Math.sin(2 * Math.PI * i / sides)]);
  return { segs: pts.flatMap((p, i) => [...p, ...pts[(i + 1) % sides]]), width: 0.5, stroked: true, filled: false, grey: 0 };
}
const polyPath = pts => ({ segs: pts.flatMap((p, i) => [...p, ...pts[(i + 1) % pts.length]]), width: 0.5, stroked: true, filled: false, grey: 0 });
const bar = (x0, y, x1) => ({ segs: [x0, y, x1, y], width: 0.5, stroked: true, filled: false, grey: 0 });

// An invented headingless ruled area like a legend's tag bubble table: no
// divider, a heading row of words only, a stacked row with no rule between
// its two entries, and a tag flag with a leader.
export const BUBBLE_YS = [50, 110, 170, 230, 350, 410];
export function bubbleTable() {
  const x0 = 0, x1 = 300, ys = BUBBLE_YS;
  const paths = ys.map(y => rule(x0, y, x1, y));
  paths.push(rule(x0, ys[0], x0, ys[ys.length - 1]), rule(x1, ys[0], x1, ys[ys.length - 1]));
  const words = [word('GIZMO TAGS', 10, 75)];
  const placeholder = (cx, cy) => [word('AA-ZZ', cx - 12.5, cy - 9), word('0001', cx - 10, cy + 1)];
  // Plain ring.
  paths.push(ringPath(40, 140, 20)); words.push(...placeholder(40, 140), word('PLAIN RING', 90, 136));
  // Ring with one bar.
  paths.push(ringPath(40, 200, 20), bar(20, 200, 60)); words.push(...placeholder(40, 200), word('BARRED RING', 90, 196));
  // Stacked: a ring inscribed in a square, then 14 pt below a barred ring, with no rule between.
  paths.push(ringPath(40, 260, 20), box(20, 240, 40, 40)); words.push(...placeholder(40, 260), word('BOXED RING', 90, 256));
  paths.push(ringPath(40, 314, 20), bar(20, 314, 60)); words.push(...placeholder(40, 314), word('BOXED BARRED RING', 90, 310));
  // A flag: a closed pentagon round a one-line placeholder, and a leader to a dot 30 pt beyond it.
  paths.push(polyPath([[20, 370], [70, 370], [80, 380], [70, 390], [20, 390]]), bar(80, 380, 110), ringPath(111.5, 380, 1.5, 8));
  words.push(word('AA-ZZ-0001', 22, 376, 46), word('GIZMO FLAG', 130, 376));
  return { paths, words };
}
// A heading and one row laid out like a line-types box: two columns of a
// label followed by a sample line, so words and linework interleave.
export function junkArea() {
  const paths = [50, 80, 140].map(y => rule(0, y, 300, y));
  paths.push(rule(0, 50, 0, 140), rule(300, 50, 300, 140));
  paths.push(bar(70, 100, 140), bar(210, 100, 280), bar(70, 120, 140), bar(210, 120, 280));
  const words = [word('LINE KINDS', 10, 60), word('MAJOR', 10, 96), word('MINOR', 150, 96), word('SIGNAL', 10, 116), word('BUS', 150, 116)];
  return { paths, words };
}

// Back to pdf.js shapes under an identity viewport, for readLegendPage.
export function toOps(paths) {
  const fnArray = [], argsArray = [];
  for (const p of paths) {
    const ops = [], coords = [];
    for (let i = 0; i < p.segs.length; i += 4) {
      ops.push(FAKE_OPS.moveTo, FAKE_OPS.lineTo); coords.push(p.segs[i], p.segs[i + 1], p.segs[i + 2], p.segs[i + 3]);
    }
    fnArray.push(FAKE_OPS.setLineWidth, FAKE_OPS.constructPath, FAKE_OPS.stroke);
    argsArray.push([p.width], [ops, coords, null], null);
  }
  return { fnArray, argsArray };
}
// The same, but a path whose segments join end to start is one subpath, as a
// real PDF draws a ring: one moveTo, then lineTo for each segment.
export function toOpsJoined(paths) {
  const fnArray = [], argsArray = [];
  for (const p of paths) {
    const ops = [], coords = [];
    for (let i = 0; i < p.segs.length; i += 4) {
      const joined = i > 0 && p.segs[i] === p.segs[i - 2] && p.segs[i + 1] === p.segs[i - 1];
      if (!joined) { ops.push(FAKE_OPS.moveTo); coords.push(p.segs[i], p.segs[i + 1]); }
      ops.push(FAKE_OPS.lineTo); coords.push(p.segs[i + 2], p.segs[i + 3]);
    }
    fnArray.push(FAKE_OPS.setLineWidth, FAKE_OPS.constructPath, FAKE_OPS.stroke);
    argsArray.push([p.width], [ops, coords, null], null);
  }
  return { fnArray, argsArray };
}
// The bubble table as a legend page for readLegendPage.
export function bubblePage() {
  const { paths, words } = bubbleTable();
  return { ...toOpsJoined(paths), OPS: FAKE_OPS, viewportTransform: [1, 0, 0, 1, 0, 0], textItems: toTextItems(words), page: 1 };
}
export const toTextItems = words => words.map(w => ({ str: w.str, transform: [w.h, 0, 0, w.h, w.x, w.y], width: w.w, height: w.h }));
