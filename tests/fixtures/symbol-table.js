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
export const toTextItems = words => words.map(w => ({ str: w.str, transform: [w.h, 0, 0, w.h, w.x, w.y], width: w.w, height: w.h }));
