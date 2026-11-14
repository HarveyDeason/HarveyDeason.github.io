// tests/fixtures/symbol-ops.js
const NAMES = ['save', 'restore', 'transform', 'constructPath', 'stroke', 'closeStroke', 'fill', 'eoFill',
  'fillStroke', 'eoFillStroke', 'closeFillStroke', 'closeEOFillStroke', 'endPath', 'clip', 'setLineWidth',
  'setStrokeRGBColor', 'setFillRGBColor', 'paintFormXObjectBegin', 'paintFormXObjectEnd',
  'moveTo', 'lineTo', 'curveTo', 'curveTo2', 'curveTo3', 'closePath', 'rectangle', 'showText'];
export const FAKE_OPS = Object.fromEntries(NAMES.map((n, i) => [n, 901 + i]));
const LETTER = { M: 'moveTo', L: 'lineTo', C: 'curveTo', V: 'curveTo2', Y: 'curveTo3', Z: 'closePath', R: 'rectangle' };

// steps: ['save'], ['setLineWidth', 2], ['path', ['M', 10, 10, 'L', 60, 10]], ['stroke'] ...
// A 'path' step becomes constructPath with args [ops, coords, null], as pdf.js 3.11 emits.
export function opList(steps) {
  const fnArray = [], argsArray = [];
  for (const [name, ...args] of steps) {
    if (name === 'path') {
      const ops = [], coords = [];
      for (const t of args[0]) (typeof t === 'string' ? ops.push(FAKE_OPS[LETTER[t]]) : coords.push(t));
      fnArray.push(FAKE_OPS.constructPath); argsArray.push([ops, coords, null]);
    } else {
      fnArray.push(FAKE_OPS[name]); argsArray.push(args.length ? args : null);
    }
  }
  return { fnArray, argsArray };
}
