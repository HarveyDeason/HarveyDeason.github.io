import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../assets/js/pid-symbol-check.js';
import { LIBRARY, LOOKUPS, SHEET, place, label, octagon, BUBBLE_LIBRARY, BUBBLE_SHEET, LOOKUPS_B, BUBBLES } from './fixtures/symbol-check-sheet.js';

const VT = SHEET.viewportTransform;
const near = (a, b, tol) => Math.abs(a - b) <= tol;

test('tagPlaces: a tag in one text item, as a box in page points', () => {
  const [r] = C.tagPlaces(SHEET.textItems, [{ tag: '21-W-1001', fc: 'W' }], VT);
  assert.equal(r.tag, '21-W-1001'); assert.equal(r.places.length, 1); assert.equal(r.places[0].items, 1);
  const b = r.places[0].box;
  assert.ok(near(b[0], 100, 0.5) && near(b[1], 80, 0.5) && near(b[2], 100 + 9 * 4.4, 0.5) && near(b[3], 88, 0.5), JSON.stringify(b));
});
test('tagPlaces: a tag split over two text items with a blank one between', () => {
  const [r] = C.tagPlaces(SHEET.textItems, [{ tag: '21-W-1002', fc: 'W' }], VT);
  assert.equal(r.places.length, 1); assert.equal(r.places[0].items, 2);
  assert.ok(near(r.places[0].box[1], 76, 0.5) && near(r.places[0].box[3], 94, 0.5));
});
test('tagPlaces: every tag on the invented sheet is found once, in the order given', () => {
  const r = C.tagPlaces(SHEET.textItems, SHEET.tags, VT);
  assert.deepEqual(r.map(x => x.tag), SHEET.tags.map(t => t.tag));
  assert.deepEqual(r.map(x => x.places.length), SHEET.tags.map(() => 1));
});
test('tagPlaces: written twice gives two places; absent gives none; a longer tag is not a match', () => {
  const items = [...label('21-W-1001', 10, 10), ...label('21-W-1001', 300, 300), ...label('21-W-10019', 50, 50), ...label('21–W–2000', 90, 90)];
  const r = C.tagPlaces(items, [{ tag: '21-W-1001', fc: 'W' }, { tag: '21-W-9999', fc: 'W' }, { tag: '21-W-2000', fc: 'W' }], VT);
  assert.deepEqual(r.map(x => x.places.length), [2, 0, 1]);   // the last was written with en dashes
});
test('tagPlaces: rubbish in gives empty out, never a throw', () => {
  for (const bad of [null, 5, 'x', {}, [null, 5, { str: 7 }, { str: '21-W-1001' }]]) {
    assert.deepEqual(C.tagPlaces(bad, [{ tag: '21-W-1001', fc: 'W' }], VT).map(x => x.places), [[]]);
  }
  assert.deepEqual(C.tagPlaces(SHEET.textItems, null, VT), []);
  assert.deepEqual(C.tagPlaces(SHEET.textItems, [null, {}, { tag: 5 }], null), []);
});

const px = (b, x, y) => b.data[y * b.w + x];
const ink = b => b.data.reduce((n, v) => n + v, 0);
const FRAME = { x0: 0, y0: 0, w: 8, h: 8 };
const P = (segs, extra = {}) => ({ segs, width: 0.25, stroked: true, filled: false, grey: 0, ...extra });
const SQUARE = [2, 2, 6, 2, 6, 2, 6, 6, 6, 6, 2, 6, 2, 6, 2, 2];

test('rasterise: a hairline is one pixel thick; a 1 pt line is several', () => {
  const thin = C.rasterise([P([2, 2, 6, 2])], FRAME);
  assert.deepEqual([thin.w, thin.h, thin.pxPerPt], [32, 32, 4]);
  assert.deepEqual([px(thin, 16, 8), px(thin, 16, 6), px(thin, 16, 10), px(thin, 4, 8)], [1, 0, 0, 0]);
  const thick = C.rasterise([P([2, 2, 6, 2], { width: 1 })], FRAME);
  assert.deepEqual([px(thick, 16, 7), px(thick, 16, 9), px(thick, 16, 12)], [1, 1, 0]);
  assert.ok(ink(thick) > 2 * ink(thin));
});
test('rasterise: a fill is solid, and even-odd leaves a hole', () => {
  assert.equal(px(C.rasterise([P(SQUARE, { filled: true })], FRAME), 16, 16), 1);
  assert.equal(px(C.rasterise([P(SQUARE)], FRAME), 16, 16), 0);
  const holed = C.rasterise([P([...SQUARE, 3, 3, 5, 3, 5, 3, 5, 5, 5, 5, 3, 5, 3, 5, 3, 3], { filled: true })], FRAME);
  assert.deepEqual([px(holed, 16, 16), px(holed, 10, 16)], [0, 1]);
});
test('rasterise: a white fill hides what is under it; pale grey is not ink', () => {
  const hidden = C.rasterise([P([0, 4, 8, 4]), P(SQUARE, { filled: true, stroked: false, grey: 255 })], FRAME);
  assert.deepEqual([px(hidden, 16, 16), px(hidden, 2, 16)], [0, 1]);
  assert.equal(ink(C.rasterise([P([0, 4, 8, 4], { grey: 200 })], FRAME)), 0);
});
test('rasterise: transform, scale and fillLoops are applied', () => {
  const sq = P(SQUARE);
  assert.equal(px(C.rasterise([sq], FRAME, { fillLoops: new Set([sq]) }), 16, 16), 1);
  const moved = C.rasterise([P([0, 0, 2, 0])], FRAME, { transform: (x, y) => [x + 2, y + 4] });
  assert.deepEqual([px(moved, 12, 16), px(moved, 4, 0)], [1, 0]);
});
test('dilate: one pixel becomes a square of side 2r + 1', () => {
  const b = C.rasterise([], FRAME); b.data[16 * 32 + 16] = 1;
  const d = C.dilate(b, 2);
  assert.equal(ink(d), 25); assert.equal(ink(b), 1);
  assert.deepEqual([px(d, 14, 14), px(d, 18, 18), px(d, 13, 16)], [1, 1, 0]);
});
test('rasterise and dilate: rubbish in gives an empty bitmap, never a throw', () => {
  for (const bad of [null, 5, [null, {}, { segs: 'x' }, { segs: [0, 0, NaN, 1], stroked: true, grey: 0 }]]) assert.equal(ink(C.rasterise(bad, FRAME)), 0);
  for (const frame of [null, {}, { x0: 0, y0: 0, w: -1, h: 5 }, { x0: 0, y0: 0, w: 1e9, h: 1e9 }]) assert.equal(C.rasterise([P(SQUARE)], frame).data.length, 0);
  assert.equal(C.dilate(null, 2).data.length, 0);
});

const byName = n => LIBRARY.symbols.find(s => s.name === n);
const prep = n => C.prepareSymbols(LIBRARY).find(p => p.symbol.name === n);
const boxOf = (pl, s) => { const a = C.placePoint(pl, 0, 0), b = C.placePoint(pl, s.w, s.h); return [Math.min(a[0], b[0]), Math.min(a[1], b[1])]; };

test('prepareSymbols: which symbols can be checked, and why not', () => {
  const all = C.prepareSymbols(LIBRARY);
  assert.equal(all.length, LIBRARY.symbols.length);
  assert.deepEqual(all.map(p => p.why), ['', '', '', '', '', 'simple', 'stretch', 'no-linework', 'manual']);
  const w = prep('WIDGET');
  assert.equal(w.checkable, true); assert.equal(w.keys.length, 2); assert.equal(w.loops.length, 2);
  assert.ok(near(w.keys[0][4], Math.hypot(12, 6), 0.01));
  assert.equal(byName('WIDGET').flags.simple, false);   // the library is not written to
  assert.deepEqual(C.prepareSymbols({ ...LIBRARY, symbols: [{ ...byName('WIDGET'), flags: { simple: true } }] })[0].why, 'simple');
});
test('proposePlacements: the true place is among the proposals, at full size', () => {
  const segs = C.drawingSegments(place(byName('WIDGET'), { x: 100, y: 100 }));
  const ps = C.proposePlacements(prep('WIDGET'), segs, [110, 90]);
  assert.ok(ps.length > 0 && ps.length < 200, String(ps.length));
  assert.ok(ps.some(p => near(p.k, 1, 0.01) && near(boxOf(p, byName('WIDGET'))[0], 100, 0.3) && near(boxOf(p, byName('WIDGET'))[1], 100, 0.3)));
});
test('proposePlacements: turned and drawn at 120%', () => {
  const segs = C.drawingSegments(place(byName('WIDGET, BARRED'), { x: 200, y: 200, o: 5, k: 1.2 }));
  const ps = C.proposePlacements(prep('WIDGET, BARRED'), segs, [210, 210]);
  assert.ok(ps.some(p => near(p.k, 1.2, 0.01) && near(p.cx, 200 + 1.2 * 12 / 2, 0.5) && near(p.cy, 200 + 1.2 * 24 / 2, 0.5)));   // turned: 12 wide, 24 tall
});
test('proposePlacements: nothing outside 75% to 135%, nothing beyond the radius', () => {
  const w = byName('WIDGET');
  assert.deepEqual(C.proposePlacements(prep('WIDGET'), C.drawingSegments(place(w, { x: 100, y: 100, k: 1.6 })), [110, 100]), []);
  assert.deepEqual(C.proposePlacements(prep('WIDGET'), C.drawingSegments(place(w, { x: 100, y: 100, k: 0.6 })), [110, 100]), []);
  assert.deepEqual(C.proposePlacements(prep('WIDGET'), C.drawingSegments(place(w, { x: 100, y: 100 })), [300, 300]), []);
  assert.ok(C.proposePlacements(prep('WIDGET'), C.drawingSegments(place(w, { x: 100, y: 100 })), [300, 300], { radius: 400 }).length > 0);
});
test('proposals: rubbish in gives nothing, never a throw', () => {
  assert.deepEqual(C.prepareSymbols(null), []);
  assert.deepEqual(C.drawingSegments([null, { segs: 'x' }, { segs: [0, 0, NaN, 9], grey: 0 }]), []);
  assert.deepEqual(C.proposePlacements(null, null, null), []);
  assert.deepEqual(C.proposePlacements(prep('BROKEN'), [[0, 0, 10, 0, 10]], [0, 0]), []);
});

const scoreAt = (name, drawn, at, opts) => {
  const p = prep(name), win = C.drawingWindow(drawn, at, opts);
  return C.proposePlacements(p, C.drawingSegments(drawn), at, opts).map(pl => C.scorePlacement(p, pl, win, opts)).filter(Boolean).sort((a, b) => b.score - a.score)[0] || null;
};

test('scorePlacement: the right symbol in the right place scores 0.95 or more', () => {
  const best = scoreAt('WIDGET', place(byName('WIDGET'), { x: 100, y: 100 }), [110, 100]);
  assert.ok(best.score >= 0.95, String(best.score));
  assert.equal(best.filled, false);
  assert.ok(near(best.box[0], 100, 0.5) && near(best.box[1], 100, 0.5) && near(best.box[2], 124, 0.5) && near(best.box[3], 112, 0.5));
});
test('scorePlacement: 3 pt out of place scores under 0.6', () => {
  const drawn = place(byName('WIDGET'), { x: 100, y: 100 }), p = prep('WIDGET');
  const pl = C.proposePlacements(p, C.drawingSegments(drawn), [110, 100]).find(q => near(q.k, 1, 0.01) && near(boxOf(q, p.symbol)[0], 100, 0.3) && near(boxOf(q, p.symbol)[1], 100, 0.3));
  const s = C.scorePlacement(p, { ...pl, tx: pl.tx + 3, ty: pl.ty + 3 }, C.drawingWindow(drawn, [110, 100]));
  assert.ok(s === null || s.score < 0.6);
});
test('scorePlacement: ink the symbol does not explain lowers the score, and so does ink it lacks', () => {
  const barred = place(byName('WIDGET, BARRED'), { x: 100, y: 100 });
  const plainOnBarred = scoreAt('WIDGET', barred, [110, 110]);
  assert.ok(plainOnBarred.forward >= 0.95 && plainOnBarred.score < 0.9, JSON.stringify(plainOnBarred));
  const barredOnPlain = scoreAt('WIDGET, BARRED', place(byName('WIDGET'), { x: 100, y: 100 }), [110, 100]);
  assert.ok(barredOnPlain === null || barredOnPlain.score < 0.9);
});
test('scorePlacement: a filled-in symbol matches through its filled loops, and not without them', () => {
  const drawn = place(byName('WIDGET'), { x: 100, y: 100, fill: true });
  const withTwin = scoreAt('WIDGET', drawn, [110, 100]);
  assert.ok(withTwin.score >= 0.9 && withTwin.filled === true, JSON.stringify(withTwin));
  const without = scoreAt('WIDGET', drawn, [110, 100], { twin: false });
  assert.ok(without.score < 0.9 && without.filled === false, JSON.stringify(without));
});
test('scorePlacement: rubbish in gives null, never a throw', () => {
  assert.equal(C.scorePlacement(null, null, null), null);
  assert.equal(C.scorePlacement(prep('WIDGET'), { o: 99, k: NaN, tx: 0, ty: 0 }, C.drawingWindow([], [0, 0])), null);
  assert.equal(C.drawingWindow(null, null).ink.data.length, 0);
});

const run = (over = {}) => C.checkSheet({ ...SHEET, library: LIBRARY, lookups: LOOKUPS, ...over });
const verdictOf = (r, tag) => r.verdicts.find(v => v.tag === tag);

test('expectedFamily: checked, or why not', () => {
  const prepared = C.prepareSymbols(LIBRARY);
  const f = fc => C.expectedFamily(fc, LIBRARY, LOOKUPS, prepared);
  assert.deepEqual([f('W').mode, f('W').symbols.map(p => p.symbol.name)], ['check', ['WIDGET', 'WIDGET, BARRED']]);
  assert.deepEqual([f('ZI').mode, f('ZI').why], ['skip', 'The library has no tag bubbles. Import the legend again to add them.']);
  assert.deepEqual([f('X').mode, f('X').why], ['skip', 'No symbol in the library carries the tag identifier X.']);
  assert.deepEqual([f('D').mode, f('D').why], ['skip', 'Every symbol in this family is drawn to suit, too simple to judge, or has no linework.']);
  assert.equal(f('T').mode, 'skip');
  const skipG = C.expectedFamily('G', { ...LIBRARY, families: { G: { mode: 'skip', why: 'drawn to suit' } } }, LOOKUPS, prepared);
  assert.deepEqual([skipG.mode, skipG.why], ['skip', 'Family marked as not checked: drawn to suit.']);
  assert.equal(C.expectedFamily('constructor', LIBRARY, LOOKUPS, prepared).mode, 'skip');
  assert.equal(C.expectedFamily(null, null, null, null).mode, 'skip');
});
test('checkSheet: every verdict, on the invented sheet', () => {
  const r = run();
  assert.equal(r.ok, true);
  assert.deepEqual(r.verdicts.map(v => [v.tag, v.verdict]), [
    ['21-W-1001', 'ok'], ['21-W-1002', 'ok'], ['21-W-1003', 'off-size'], ['21-P-6001', 'ok'],
    ['21-G-2001', 'wrong-family'], ['21-W-1004', 'exception'], ['21-G-2002', 'look'], ['21-X-7001', 'not-checked'],
    ['21-D-3001', 'not-checked'], ['21-T-4001', 'not-checked'], ['21-ZI-5001', 'not-checked']]);
  assert.deepEqual(r.counts, { ok: 3, 'off-size': 1, 'wrong-family': 1, exception: 1, look: 1, 'not-checked': 4 });
  assert.deepEqual([r.checked, r.recognised], [7, 4]);
  assert.equal(verdictOf(r, '21-W-1001').symbol, 'WIDGET');
  assert.equal(verdictOf(r, '21-W-1002').filled, true);
  assert.ok(near(verdictOf(r, '21-W-1003').sizePct, 120, 2));
  const wrong = verdictOf(r, '21-G-2001');
  assert.deepEqual([wrong.symbol, wrong.tagId], ['WIDGET, BARRED', 'W']);
  assert.deepEqual(verdictOf(r, '21-W-1004').exceptions, ['Folding widget']);
  assert.deepEqual(verdictOf(r, '21-G-2002').exceptions, []);     // a pending exception does not count
  assert.ok(near(verdictOf(r, '21-W-1001').box[0], 100, 0.5) && verdictOf(r, '21-X-7001').box === null);
  assert.doesNotThrow(() => structuredClone(r));
});
test('checkSheet: symbols that differ only by mirroring are reported as one of', () => {
  assert.deepEqual(verdictOf(run(), '21-P-6001').oneOf.slice().sort(), ['PENNANT, LEFT', 'PENNANT, RIGHT']);
  assert.deepEqual(verdictOf(run(), '21-W-1001').oneOf, []);
});
test('checkSheet: relabelled, a right symbol becomes the wrong family', () => {
  const tags = SHEET.tags.map(t => (t.tag === '21-W-1001' ? { tag: t.tag, fc: 'G' } : t));
  const r = run({ tags });
  assert.deepEqual([verdictOf(r, '21-W-1001').verdict, verdictOf(r, '21-W-1001').tagId], ['wrong-family', 'W']);
  assert.equal(verdictOf(r, '21-W-1003').verdict, 'off-size');   // nothing else moved
});
test('checkSheet: one symbol answers one tag, the nearer', () => {
  const sheet = { viewportTransform: VT, paths: place(byName('WIDGET'), { x: 100, y: 100 }),
    textItems: [...label('21-W-0001', 100, 86), ...label('21-W-0002', 100, 130)], tags: [{ tag: '21-W-0002', fc: 'W' }, { tag: '21-W-0001', fc: 'W' }] };
  const r = C.checkSheet({ ...sheet, library: LIBRARY, lookups: LOOKUPS });
  assert.deepEqual(r.verdicts.map(v => v.verdict), ['exception', 'ok']);
  // and the symbol that answered the other tag is not offered to this one as its "closest"
  assert.equal(r.verdicts[0].closest, null);
});
test('checkSheet: a tag written twice is checked at both places and gets one verdict', () => {
  const sheet = { viewportTransform: VT, paths: place(byName('WIDGET'), { x: 300, y: 300 }),
    textItems: [...label('21-W-0001', 20, 20), ...label('21-W-0001', 300, 286)], tags: [{ tag: '21-W-0001', fc: 'W' }] };
  const r = C.checkSheet({ ...sheet, library: LIBRARY, lookups: LOOKUPS });
  assert.deepEqual([r.verdicts.length, r.verdicts[0].verdict], [1, 'ok']);
  assert.ok(near(r.verdicts[0].tagBox[0], 300, 0.5));   // the place the symbol was found beside
});
test('checkSheet: a tag that is not on the page is Not checked, and says so', () => {
  const r = run({ tags: [{ tag: '21-W-9999', fc: 'W' }] });
  assert.deepEqual([r.verdicts[0].verdict, r.verdicts[0].why, r.verdicts[0].tagBox], ['not-checked', 'Tag position not found on this page.', null]);
});
test('checkSheet: progress is reported once per tag', () => {
  const seen = [];
  run({ onProgress: (done, total, stage) => { if (stage === 'tags') seen.push([done, total]); } });
  assert.equal(seen.length, SHEET.tags.length);
  assert.deepEqual(seen[seen.length - 1], [SHEET.tags.length, SHEET.tags.length]);
  assert.equal(run({ onProgress: () => { throw new Error('boom'); } }).ok, true);
});
test('checkSheet: no library or rubbish gives ok false, never a throw', () => {
  assert.deepEqual(run({ library: null }), { ok: false, why: 'no-library' });
  assert.deepEqual(run({ library: { version: 1, symbols: [] } }), { ok: false, why: 'no-library' });
  assert.equal(C.checkSheet(null).ok, false);
  assert.equal(run({ paths: 'x', textItems: 7 }).ok, true);   // every tag then reads Not checked
});
test('checkSheet: a letter inside the symbol is read from the text layer or not judged', () => {
  const lettered = { ...LIBRARY, symbols: LIBRARY.symbols.map(s => (s.name === 'GADGET' ? { ...s, letters: [{ text: 'Q', x: 8, y: 6, size: 6 }] } : s)) };
  const base = { viewportTransform: VT, paths: place(byName('GADGET'), { x: 100, y: 100 }), tags: [{ tag: '21-G-0001', fc: 'G' }], library: lettered, lookups: LOOKUPS };
  const tagItems = label('21-G-0001', 100, 80);
  assert.equal(C.checkSheet({ ...base, textItems: tagItems }).verdicts[0].letters, 'not judged');
  const q = { str: 'Q', transform: [6, 0, 0, 6, 108, 106], width: 4, height: 6 };
  assert.equal(C.checkSheet({ ...base, textItems: [...tagItems, q] }).verdicts[0].letters, 'read');
  assert.equal(verdictOf(run(), '21-W-1001').letters, '');
});

// ── Found by review ───────────────────────────────────────────────────────

test('prepareSymbols: a symbol with absurd geometry is set aside at once, not walked point by point', () => {
  const stroke = segs => ({ segs, width: 1, stroked: true, filled: false, grey: 0 });
  const huge = { ...byName('WIDGET'), id: 'h1', name: 'HUGE', paths: [...byName('WIDGET').paths, stroke([0, 0, 1e9, 0]), stroke([0, 0, 1e308, -1e308])] };
  const many = { ...byName('WIDGET'), id: 'h2', name: 'MANY', paths: [stroke(Array.from({ length: 4 * 6000 }, (_, i) => i % 7))] };
  const t0 = Date.now();
  const all = C.prepareSymbols({ ...LIBRARY, symbols: [huge, many] });
  assert.ok(Date.now() - t0 < 500, String(Date.now() - t0));
  assert.deepEqual(all.map(p => [p.checkable, p.why, p.points.length]), [[false, 'size', 0], [false, 'size', 0]]);
  const r = run({ library: { ...LIBRARY, symbols: [...LIBRARY.symbols, huge, many] } });
  assert.equal(verdictOf(r, '21-W-1001').verdict, 'ok');
});

test('checkSheet: a wrong-family symbol also answers one tag only', () => {
  const sheet = { viewportTransform: VT, paths: place(byName('WIDGET'), { x: 100, y: 100 }),
    textItems: [...label('21-G-0001', 100, 86), ...label('21-G-0002', 100, 130)], tags: [{ tag: '21-G-0002', fc: 'G' }, { tag: '21-G-0001', fc: 'G' }] };
  const r = C.checkSheet({ ...sheet, library: LIBRARY, lookups: LOOKUPS });
  assert.deepEqual(r.verdicts.map(v => v.verdict), ['look', 'wrong-family']);
});

test('checkSheet: a tag with nothing recognised names the closest symbol of its family and how close it came', () => {
  // The barred widget is on the sheet but not in this library, so the plain widget is a near miss.
  const noBarred = { ...LIBRARY, symbols: LIBRARY.symbols.filter(s => s.name !== 'WIDGET, BARRED') };
  const tags = SHEET.tags.map(t => (t.tag === '21-G-2001' ? { tag: t.tag, fc: 'W' } : t));
  const r = run({ library: noBarred, tags });
  const v = verdictOf(r, '21-G-2001');
  assert.equal(v.verdict, 'exception');
  assert.equal(v.closest.symbol, 'WIDGET');
  assert.ok(v.closest.score > 0.6 && v.closest.score < 0.9, String(v.closest.score));
  assert.equal(v.box, null);                                   // a near miss draws no box round a symbol
  assert.equal(verdictOf(r, '21-G-2002').closest, null);       // nothing of its family comes near an octagon
  assert.equal(verdictOf(r, '21-W-1001').closest, null);       // recognised: no "closest" to report
  assert.equal(verdictOf(r, '21-ZI-5001').closest, null);
  assert.doesNotThrow(() => structuredClone(r));
});

test('expectedFamily: a family made mostly of symbols too large to judge is drawn to suit, and not checked', () => {
  const big = n => ({ ...byName('WIDGET'), id: 'k' + n, name: 'HOPPER ' + n, group: 'HOPPERS', tagId: 'K', w: 300, h: 200,
    paths: [{ segs: [0, 0, 300, 0, 300, 0, 300, 200, 300, 200, 0, 200, 0, 200, 0, 0], width: 0.7, stroked: true, filled: false, grey: 0 }] });
  const small = { ...byName('WIDGET'), id: 'k0', name: 'HOPPER, SMALL', group: 'HOPPERS', tagId: 'K' };
  const lib = extra => ({ ...LIBRARY, symbols: [...LIBRARY.symbols, small, ...extra] });
  const mostlyBig = C.expectedFamily('K', lib([big(1), big(2)]), LOOKUPS);
  assert.deepEqual([mostlyBig.mode, mostlyBig.why], ['skip', 'Drawn to suit: most symbols in this family are too large or too varied to judge.']);
  assert.equal(C.expectedFamily('K', lib([big(1)]), LOOKUPS).mode, 'check');                       // half can be checked: checked
  const forced = C.expectedFamily('K', { ...lib([big(1), big(2)]), families: { K: { mode: 'check' } } }, LOOKUPS);
  assert.deepEqual([forced.mode, forced.symbols.map(p => p.symbol.name)], ['check', ['HOPPER, SMALL']]);   // the library can overrule it
  assert.equal(C.expectedFamily('W', LIBRARY, LOOKUPS).mode, 'check');   // BROKEN has no linework, but most widgets can be checked
  // on a sheet: the tag reads Not checked with that reason, not Needs a look
  const sheet = { viewportTransform: VT, paths: octagon(100, 100), textItems: label('21-K-0001', 100, 80), tags: [{ tag: '21-K-0001', fc: 'K' }] };
  const v = C.checkSheet({ ...sheet, library: lib([big(1), big(2)]), lookups: LOOKUPS }).verdicts[0];
  assert.deepEqual([v.verdict, v.why], ['not-checked', 'Drawn to suit: most symbols in this family are too large or too varied to judge.']);
});

test('checkSheet: past its time limit it stops, says so, and marks the tags it did not reach', () => {
  const r = run({ options: { timeLimitMs: 0.0001 } });
  assert.deepEqual([r.ok, r.timedOut], [true, true]);
  const v = verdictOf(r, '21-W-1001');
  assert.deepEqual([v.verdict, v.why], ['not-checked', 'The check reached its time limit before this tag.']);
  assert.equal(verdictOf(r, '21-ZI-5001').why, 'The library has no tag bubbles. Import the legend again to add them.');   // its own reason is kept
  assert.equal(run().timedOut, false);
});

// ── Tag bubbles ───────────────────────────────────────────────────────────
const runB = (over = {}) => C.checkSheet({ ...BUBBLE_SHEET, library: BUBBLE_LIBRARY, lookups: LOOKUPS_B, ...over });

test('checkSheet: each bubble kind round a tag is identified as itself, with no one-of', () => {
  const r = runB();
  assert.equal(r.ok, true);
  const want = { '21-ZI-8001': 'RING', '21-ZI-8002': 'RING, ONE BAR', '21-ZI-8003': 'RING, TWO BARS',
    '21-ZI-8004': 'RING, BROKEN BAR', '21-ZI-8005': 'BOXED RING', '21-ZI-8006': 'HEXAGON' };
  for (const [tag, name] of Object.entries(want)) {
    const v = verdictOf(r, tag);
    assert.deepEqual([v.verdict, v.symbol, v.bubble, v.oneOf, v.tagId], ['ok', name, true, [], ''], tag);
    assert.equal(v.sizePct, 100, tag);
  }
  assert.doesNotThrow(() => structuredClone(r));
});
test('checkSheet: an off-size bubble reads OK, off size', () => {
  const v = verdictOf(runB(), '21-ZI-8007');
  assert.deepEqual([v.verdict, v.symbol], ['off-size', 'RING']);
  assert.ok(near(v.sizePct, 125, 2));
});
test('checkSheet: an equipment code drawn in a bubble reads OK', () => {
  const v = verdictOf(runB(), '21-X-8008');
  assert.deepEqual([v.verdict, v.symbol, v.bubble], ['ok', 'RING', true]);
});
test('checkSheet: an instrument tag with no bubble needs a look; one in a non-standard outline names the closest bubble', () => {
  const r = runB();
  const none = verdictOf(r, '21-ZP-8009');
  assert.deepEqual([none.verdict, none.bubble, none.closest], ['look', true, null]);
  const odd = verdictOf(r, '21-ZI-8011');
  assert.deepEqual([odd.verdict, odd.bubble], ['look', true]);
  assert.ok(odd.closest && odd.closest.score < 0.9 && odd.closest.score >= 0.3, JSON.stringify(odd.closest));
});
test('checkSheet: a bubble is not claimed by a neighbouring tag', () => {
  const r = runB();
  assert.notEqual(verdictOf(r, '21-W-8010').verdict, 'ok');
  assert.equal(verdictOf(r, '21-W-8010').bubble, false);
});
test('checkSheet: a tag written twice, once in a bubble, reads OK once', () => {
  assert.equal(verdictOf(runB(), '21-ZI-8012').verdict, 'ok');
});
test('checkSheet: checked counts every tag given a verdict other than Not checked', () => {
  const r = runB();
  assert.equal(r.checked, r.verdicts.filter(v => v.verdict !== 'not-checked').length);
});
test('findOutline: tag text 1 pt wider than the ring on each side is still inside; the sheet frame is never an outline', () => {
  const paths = BUBBLE_SHEET.paths;   // includes the frame
  assert.deepEqual(C.findOutline(paths, [99, 114, 141, 126], { maxOutline: 62 }).map(Math.round), [100, 100, 140, 140]);
  assert.equal(C.findOutline(paths, [40, 40, 60, 50], { maxOutline: 62 }), null);   // inside only the frame
  assert.equal(C.findOutline(paths, [94, 114, 146, 126], { maxOutline: 62 }), null); // 6 pt over each side: not inside
  for (const bad of [[null, null, null], [paths, 'x', {}], ['x', [0, 0, 1, 1], null]]) assert.equal(C.findOutline(...bad), null);
});
test('checkSheet: a bubble with no stored ring is matched on its whole box', () => {
  const noRing = s => { const { ring, ...rest } = s; return rest; };
  const lib = { ...BUBBLE_LIBRARY, symbols: BUBBLE_LIBRARY.symbols.map(s => (s.name === 'RING' ? noRing(s) : s)) };
  const v = verdictOf(runB({ library: lib }), '21-ZI-8001');
  assert.deepEqual([v.verdict, v.symbol], ['ok', 'RING']);
});
test('checkSheet: with an old library, instrument tags say to re-import the legend', () => {
  const v = verdictOf(C.checkSheet({ ...BUBBLE_SHEET, library: LIBRARY, lookups: LOOKUPS_B }), '21-ZI-8001');
  assert.deepEqual([v.verdict, v.why], ['not-checked', 'The library has no tag bubbles. Import the legend again to add them.']);
});
test('expectedFamily: an instrument code with no family expects a bubble when the library has them', () => {
  assert.equal(C.expectedFamily('ZI', BUBBLE_LIBRARY, LOOKUPS_B, C.prepareSymbols(BUBBLE_LIBRARY)).mode, 'bubble');
});
test('prepareSymbols: a bubble is checkable however plain, and carries its ring', () => {
  const p = C.prepareSymbols(BUBBLE_LIBRARY).find(x => x.symbol.name === 'RING');
  assert.deepEqual([p.checkable, p.bubble, p.ring], [true, true, [0, 0, 40, 40]]);
});
test('checkSheet: any tag written inside a recognised bubble is answered by it, whatever its code (spec: the drawing decides)', () => {
  const ring = BUBBLES.find(s => s.name === 'RING');
  const r = C.checkSheet({ viewportTransform: [1, 0, 0, 1, 0, 0], library: BUBBLE_LIBRARY, lookups: LOOKUPS_B,
    paths: place(ring, { x: 100, y: 100 }), textItems: label('21-W-9001', 109, 111, { split: true }), tags: [{ tag: '21-W-9001', fc: 'W' }] });
  assert.deepEqual([r.verdicts[0].verdict, r.verdicts[0].bubble, r.verdicts[0].symbol], ['ok', true, 'RING']);
});

// ── One symbol per patch of ink ───────────────────────────────────────────
import { SIGNAL, SWEEP_LIBRARY } from './fixtures/symbol-check-sheet.js';

const SWEPT = C.prepareSymbols(SWEEP_LIBRARY);
const sprep = name => SWEPT.find(p => p.symbol.name === name);
// A hit for a library symbol whose placed box has its top-left at (x, y).
function hit(name, x, y, { o = 0, k = 1, score = 0.95, tag = null } = {}) {
  const p = sprep(name), [a, b, c, d] = C.ORIENTATIONS[o];
  const cs = [[0, 0], [p.w, 0], [0, p.h], [p.w, p.h]].map(([u, v]) => [k * (a * u + c * v), k * (b * u + d * v)]);
  const tx = x - Math.min(...cs.map(q => q[0])), ty = y - Math.min(...cs.map(q => q[1]));
  const placement = { o, k, tx, ty, cx: tx + k * (a * p.w / 2 + c * p.h / 2), cy: ty + k * (b * p.w / 2 + d * p.h / 2) };
  const bw = Math.max(...cs.map(q => q[0])) - Math.min(...cs.map(q => q[0])), bh = Math.max(...cs.map(q => q[1])) - Math.min(...cs.map(q => q[1]));
  return { p, placement, score, k, box: [x, y, x + bw, y + bh], filled: false, bubble: false, ring: null, tag };
}
const names = spot => spot.matches.map(m => m.p.symbol.name);

test('sharedInk: a hit on itself is nearly all shared; 40 pt away, nothing', () => {
  assert.ok(C.sharedInk(hit('WIDGET', 100, 100), hit('WIDGET', 100, 100)) >= 0.95);
  assert.equal(C.sharedInk(hit('WIDGET', 100, 100), hit('WIDGET', 140, 100)), 0);
});
test('sharedInk: mirror twins placed on the same spot share their ink both ways', () => {
  const left = hit('PENNANT, LEFT', 100, 100, { o: 4 }), right = hit('PENNANT, RIGHT', 100, 100);
  assert.ok(C.sharedInk(left, right) >= 0.5, String(C.sharedInk(left, right)));
  assert.ok(C.sharedInk(right, left) >= 0.5, String(C.sharedInk(right, left)));
});
test('sharedInk: a pennant on SIGNAL lies on it, but most of SIGNAL is not the pennant', () => {
  const part = hit('PENNANT, LEFT', 100, 100), whole = hit('SIGNAL', 100, 100);
  assert.ok(C.sharedInk(part, whole) >= 0.95);
  assert.ok(C.sharedInk(whole, part) < 0.5, String(C.sharedInk(whole, part)));
});
test('sharedInk: rubbish in gives 0, never a throw', () => {
  for (const [a, b] of [[null, null], [{}, hit('WIDGET', 0, 0)], [hit('WIDGET', 0, 0), { p: {}, placement: {} }], [5, 'x']]) assert.equal(C.sharedInk(a, b), 0);
});

test('mergeHits: the same symbol found twice, 1 pt apart, is one spot', () => {
  const spots = C.mergeHits([hit('WIDGET', 100, 100, { score: 0.97 }), hit('WIDGET', 101, 100, { score: 0.95 })]);
  assert.equal(spots.length, 1);
  assert.equal(spots[0].matches[0].score, 0.97);
});
test('mergeHits: two members drawn alike at one place; at equal score the one with more linework wins', () => {
  const [s] = C.mergeHits([hit('WIDGET', 100, 100, { score: 0.95 }), hit('WIDGET, BARRED', 100, 100, { score: 0.95 })]);
  assert.deepEqual(names(s), ['WIDGET, BARRED', 'WIDGET']);
});
test('mergeHits: an alternative further below than oneOf is dropped, not listed', () => {
  const spots = C.mergeHits([hit('WIDGET', 100, 100, { score: 0.91 }), hit('WIDGET, BARRED', 100, 100, { score: 0.99 })]);
  assert.equal(spots.length, 1); assert.deepEqual(names(spots[0]), ['WIDGET, BARRED']);
});
test('mergeHits: mirror twins are alternatives', () => {
  const spots = C.mergeHits([hit('PENNANT, LEFT', 100, 100, { o: 4, score: 0.96 }), hit('PENNANT, RIGHT', 100, 100, { score: 0.97 })]);
  assert.equal(spots.length, 1); assert.deepEqual(names(spots[0]), ['PENNANT, RIGHT', 'PENNANT, LEFT']);
});
test('mergeHits: a pennant found inside SIGNAL is a part, whichever scored higher', () => {
  for (const [ps, ss] of [[0.99, 0.92], [0.92, 0.99]]) {
    const spots = C.mergeHits([hit('PENNANT, LEFT', 100, 100, { score: ps }), hit('SIGNAL', 100, 100, { score: ss })]);
    assert.equal(spots.length, 1); assert.equal(spots[0].matches.length, 1); assert.deepEqual(names(spots[0]), ['SIGNAL']);
  }
});
test('mergeHits: a tagged hit wins its ink whatever its score; two tagged hits are never merged', () => {
  const [s] = C.mergeHits([hit('WIDGET', 100, 100, { score: 0.99 }), hit('WIDGET', 100.5, 100, { score: 0.91, tag: '21-W-1001' })]);
  assert.equal(s.tag, '21-W-1001'); assert.equal(s.matches[0].tag, '21-W-1001');
  const two = C.mergeHits([hit('WIDGET', 100, 100, { tag: '21-W-1001' }), hit('WIDGET', 100.5, 100, { tag: '21-W-1002' })]);
  assert.deepEqual(two.map(x => x.tag).sort(), ['21-W-1001', '21-W-1002']);
});
test('mergeHits: a spot carries its winner\'s box and centre; symbols apart stay apart', () => {
  const spots = C.mergeHits([hit('WIDGET', 100, 100), hit('GADGET', 200, 100)]);
  assert.equal(spots.length, 2);
  const w = spots.find(s => s.matches[0].p.symbol.name === 'WIDGET');
  assert.deepEqual(w.box, [100, 100, 124, 112]); assert.equal(w.cx, 112); assert.equal(w.cy, 106);
  assert.equal(w.bubble, false); assert.equal(w.ring, null); assert.equal(w.tag, null);
});
test('mergeHits: rubbish in gives [], never a throw', () => {
  for (const bad of [null, 5, 'x', [null, 5, {}, { p: null, placement: null, score: 'x' }]]) assert.deepEqual(C.mergeHits(bad), []);
});
test('the new defaults: shared-ink share 0.5, sweep grid 80 pt', () => {
  assert.equal(C.CHECK_DEFAULTS.shareInk, 0.5); assert.equal(C.CHECK_DEFAULTS.sweepStep, 80);
});
test('matchBubble and the tag-led check keep each match\'s placement', () => {
  const lib = C.prepareSymbols(BUBBLE_LIBRARY), bubbles = lib.filter(p => p.bubble);
  const paths = place(BUBBLES[0], { x: 100, y: 100 });
  const win = C.drawingWindow(paths, [120, 120]);
  const m = C.matchBubble(bubbles, [100, 100, 140, 140], win);
  assert.equal(m.best.p.symbol.name, 'RING');
  assert.ok(m.best.placement && near(m.best.placement.tx, 100, 0.5) && near(m.best.placement.ty, 100, 0.5) && m.best.placement.o === 0);
});

// ── The sweep ─────────────────────────────────────────────────────────────
import { SWEEP_SHEET, sweepFrameWith, fixtureLine } from './fixtures/symbol-check-sheet.js';

const nearBox = (a, b, tol) => !!a && a.length === 4 && a.every((v, i) => near(v, b[i], tol));
const spotNames = spots => spots.map(s => s.matches[0].p.symbol.name).sort();

test('titleBlockBox: a full-height line in the right of the page cuts off the title block', () => {
  assert.ok(nearBox(C.titleBlockBox(SWEEP_SHEET.paths, [600, 400]), [500, 0, 600, 400], 0.5));
});
test('titleBlockBox: a full-width line along the bottom cuts it off there instead', () => {
  const paths = sweepFrameWith([fixtureLine([10, 330, 590, 330])]);
  assert.ok(nearBox(C.titleBlockBox(paths, [600, 400]), [0, 330, 600, 400], 0.5));
});
test('titleBlockBox: a line drawn in pieces still counts', () => {
  const paths = sweepFrameWith([fixtureLine([500, 10, 500, 200]), fixtureLine([500, 200, 500, 390])]);
  assert.ok(nearBox(C.titleBlockBox(paths, [600, 400]), [500, 0, 600, 400], 0.5));
});
test('titleBlockBox: a frame alone, or rubbish, gives null', () => {
  assert.equal(C.titleBlockBox(sweepFrameWith([]), [600, 400]), null);
  for (const [p, s] of [[null, [600, 400]], [SWEEP_SHEET.paths, null], [SWEEP_SHEET.paths, [0, 0]], ['x', 'y'], [[{ segs: [NaN, 1, 2, 3] }], [600, 400]]]) {
    assert.equal(C.titleBlockBox(p, s), null);
  }
});

test('sweepSymbols: every invented symbol found once and named; nothing in the title block', () => {
  const r = C.sweepSymbols({ paths: SWEEP_SHEET.paths, library: SWEEP_LIBRARY, pageSize: SWEEP_SHEET.pageSize });
  assert.deepEqual(spotNames(r.spots), ['GADGET', 'RING', 'SIGNAL', 'WIDGET', 'WIDGET']);
  assert.ok(!r.spots.some(s => s.matches.some(m => m.p.symbol.name === 'PENNANT, LEFT')));
  assert.ok(nearBox(r.skipped, [500, 0, 600, 400], 0.5));
  assert.equal(r.rows, 5); assert.equal(r.timedOut, false);
  const ring = r.spots.find(s => s.matches[0].p.symbol.name === 'RING');
  assert.equal(ring.bubble, true); assert.ok(nearBox(ring.ring, [60, 200, 100, 240], 0.5));
  assert.ok(r.spots.every(s => s.tag === null));
});
test('sweepSymbols: progress is reported after each grid row', () => {
  const seen = [];
  C.sweepSymbols({ paths: SWEEP_SHEET.paths, library: SWEEP_LIBRARY, pageSize: SWEEP_SHEET.pageSize, onProgress: (d, t, s) => seen.push([d, t, s]) });
  assert.deepEqual(seen, [1, 2, 3, 4, 5].map(d => [d, 5, 'sweep']));
});
test('sweepSymbols: a deadline already passed stops at once, no throw', () => {
  const r = C.sweepSymbols({ paths: SWEEP_SHEET.paths, library: SWEEP_LIBRARY, pageSize: SWEEP_SHEET.pageSize, deadline: -1 });
  assert.equal(r.timedOut, true); assert.deepEqual(r.spots, []);
});
test('sweepSymbols: a hostile or empty library, no paths or no page size: an empty list, never a throw', () => {
  const nanLib = { symbols: [{ name: 'X', w: 10, h: 10, paths: [{ segs: [NaN, 0, 1, 1, 0, 0, NaN, 5] }] }] };
  const huge = { symbols: [{ name: 'Y', w: 10, h: 10, tagId: 'Y', paths: [{ segs: Array.from({ length: 20000 }, (_, i) => i % 7) }] }] };
  for (const library of [{ symbols: [] }, null, nanLib, huge]) {
    const r = C.sweepSymbols({ paths: SWEEP_SHEET.paths, library, pageSize: [600, 400] });
    assert.deepEqual(r.spots, []); assert.equal(r.timedOut, false);
  }
  assert.deepEqual(C.sweepSymbols({ paths: null, library: SWEEP_LIBRARY, pageSize: [600, 400] }).spots, []);
  const noSize = C.sweepSymbols({ paths: SWEEP_SHEET.paths, library: SWEEP_LIBRARY, pageSize: [0, 0] });
  assert.ok(Array.isArray(noSize.spots)); assert.equal(noSize.timedOut, false);
  assert.deepEqual(C.sweepSymbols(null).spots, []);
  assert.deepEqual(C.sweepSymbols('x').spots, []);
});
test('mergeHits: one symbol found in two orientations on the same ink is one match, not its own alternative', () => {
  const [s] = C.mergeHits([hit('WIDGET', 100, 100, { o: 0 }), hit('WIDGET', 100, 100, { o: 2 }), hit('WIDGET', 100, 100, { o: 4 })]);
  assert.deepEqual(names(s), ['WIDGET']);
});

// ── checkSheet returns every symbol ───────────────────────────────────────
test('checkSheet: the sweep changes no tag verdict (goal 5 by construction)', () => {
  assert.deepEqual(run().verdicts, run({ options: { sweep: false } }).verdicts);
  assert.deepEqual(runB().verdicts, runB({ options: { sweep: false } }).verdicts);
});
test('checkSheet: each OK tag has exactly one symbol carrying its tag and name; no untagged symbol is invented', () => {
  const r = run();
  assert.ok(Array.isArray(r.symbols));
  for (const v of r.verdicts.filter(x => x.verdict === 'ok' || x.verdict === 'off-size')) {
    const mine = r.symbols.filter(s => s.tag === v.tag);
    assert.equal(mine.length, 1, v.tag); assert.equal(mine[0].name, v.symbol, v.tag);
  }
  assert.deepEqual(r.symbols.filter(s => s.tag === null).map(s => s.name), []);
  assert.doesNotThrow(() => structuredClone(r));
});
test('checkSheet: a symbol has its name, identifier, box, size, score, one-of, bubble and tag', () => {
  const s = run().symbols.find(x => x.tag === '21-W-1003');
  assert.deepEqual(Object.keys(s).sort(), ['box', 'bubble', 'name', 'oneOf', 'score', 'sizePct', 'tag', 'tagId']);
  assert.deepEqual([s.name, s.tagId, s.bubble], ['WIDGET', 'W', false]);
  assert.ok(near(s.sizePct, 120, 2) && s.score >= 0.9 && near(s.box[0], 300, 0.5));
  const p = run().symbols.find(x => x.tag === '21-P-6001');
  assert.deepEqual(p.oneOf.slice().sort(), ['PENNANT, LEFT', 'PENNANT, RIGHT']);
  const b = runB().symbols.find(x => x.tag === '21-ZI-8001');
  assert.deepEqual([b.name, b.bubble], ['RING', true]);
});
test('checkSheet: a sheet with no tags is still swept, and says what it skipped', () => {
  const r = C.checkSheet({ ...SWEEP_SHEET, library: SWEEP_LIBRARY, lookups: LOOKUPS_B });
  assert.equal(r.ok, true); assert.deepEqual(r.verdicts, []);
  assert.deepEqual([r.checked, r.recognised], [0, 0]);
  assert.ok(Object.values(r.counts).every(n => n === 0));
  assert.deepEqual(r.symbols.map(s => s.name), ['GADGET', 'RING', 'SIGNAL', 'WIDGET', 'WIDGET']);
  assert.ok(r.symbols.every(s => s.tag === null));
  assert.ok(nearBox(r.skipped, [500, 0, 600, 400], 0.5));
  // ordered by name, then top, then left
  const widgets = r.symbols.filter(s => s.name === 'WIDGET');
  assert.ok(widgets[0].box[0] < widgets[1].box[0]);
});
test('checkSheet: with the sweep off, no symbols are listed', () => {
  const r = C.checkSheet({ ...SWEEP_SHEET, library: SWEEP_LIBRARY, lookups: LOOKUPS_B, options: { sweep: false } });
  assert.equal(r.ok, true); assert.deepEqual(r.symbols, []); assert.equal(r.skipped, null);
});

// A long widget, too long for the window round its tag (it runs off the
// window's edge), but whole in the window round a sweep centre: today's
// tag-led look cannot score it; the sweep can, and the leftover tag takes it.
const LONG = { id: 's20', name: 'LONG WIDGET', legendName: 'LONG WIDGET', group: 'WIDGETS', tagId: 'W', sheet: '1', w: 118, h: 20,
  paths: [fixtureLine([0, 0, 118, 0, 118, 0, 118, 20, 118, 20, 0, 20, 0, 20, 0, 0]), fixtureLine([0, 0, 118, 20])],
  letters: [], flags: { simple: false, stretch: false, manual: false, unmatched: false }, aliases: [], notes: [] };
const LONG_LIB = { ...LIBRARY, exceptions: [], symbols: [...LIBRARY.symbols, LONG] };
const LONG_SHEET = { pageSize: [400, 300], viewportTransform: VT,
  paths: place(LONG, { x: 200 - 1.3 * 59, y: 187, k: 1.3 }),            // centred on (200, 200), 153 x 26 pt
  textItems: label('21-W-1009', 145 - 19.8, 176), tags: [{ tag: '21-W-1009', fc: 'W' }] };   // tag centred 58.5 pt away
test('checkSheet: a tag left without a symbol pairs with a swept symbol of its own family within reach', () => {
  const before = C.checkSheet({ ...LONG_SHEET, library: LONG_LIB, lookups: LOOKUPS, options: { sweep: false } });
  assert.equal(before.verdicts[0].verdict, 'look');
  const r = C.checkSheet({ ...LONG_SHEET, library: LONG_LIB, lookups: LOOKUPS });
  const v = r.verdicts[0];
  assert.deepEqual([v.verdict, v.symbol, v.sizePct], ['off-size', 'LONG WIDGET', 130]);
  assert.ok(v.tagBox && v.box);
  const s = r.symbols.filter(x => x.name === 'LONG WIDGET');
  assert.equal(s.length, 1); assert.equal(s[0].tag, '21-W-1009');
});
test('checkSheet: a leftover tag does not take a symbol of another family', () => {
  const r = C.checkSheet({ ...LONG_SHEET, tags: [{ tag: '21-W-1009', fc: 'G' }], library: LONG_LIB, lookups: LOOKUPS });
  assert.equal(r.verdicts[0].verdict, 'look');
  assert.equal(r.symbols.find(x => x.name === 'LONG WIDGET').tag, null);
});
test('checkSheet: the time limit reached during the sweep; what was found stands, no throw', () => {
  const r = run({ options: { timeLimitMs: 1 } });
  assert.equal(r.ok, true); assert.equal(r.timedOut, true);
  assert.equal(r.verdicts.length, SHEET.tags.length); assert.ok(Array.isArray(r.symbols));
});
test('checkSheet: progress says which stage, tags first, then the sweep', () => {
  const stages = [];
  run({ pageSize: [500, 400], onProgress: (d, t, s) => stages.push(s) });
  assert.ok(stages.includes('tags') && stages.includes('sweep'));
  assert.equal(stages.lastIndexOf('tags') < stages.indexOf('sweep'), true);
});

// ── Final review fixes ────────────────────────────────────────────────────
const GSQ = { viewportTransform: VT, pageSize: [400, 300],
  paths: [line4([100, 100, 120, 100, 120, 100, 120, 120, 120, 120, 100, 120, 100, 120, 100, 100])],   // a GADGET with its diagonal missing
  textItems: label('21-G-3001', 100, 86), tags: [{ tag: '21-G-3001', fc: 'G' }] };
function line4(segs) { return { segs, width: 0.7, stroked: true, filled: false, grey: 0 }; }
test('checkSheet: the sweep running out of time does not take the closest near miss from a tag', () => {
  const plain = C.checkSheet({ ...GSQ, library: LIBRARY, lookups: LOOKUPS, options: { sweep: false } }).verdicts[0];
  assert.equal(plain.verdict, 'look'); assert.ok(plain.closest && plain.closest.symbol === 'GADGET', JSON.stringify(plain.closest));
  let burnt = false;
  const r = C.checkSheet({ ...GSQ, library: LIBRARY, lookups: LOOKUPS, options: { timeLimitMs: 1500 },
    onProgress: (d, t, stage) => { if (stage === 'sweep' && !burnt) { burnt = true; const end = Date.now() + 1700; while (Date.now() < end) { /* the sweep overruns */ } } } });
  assert.equal(burnt, true); assert.equal(r.sweepTimedOut, true);
  assert.deepEqual(r.verdicts, C.checkSheet({ ...GSQ, library: LIBRARY, lookups: LOOKUPS, options: { sweep: false } }).verdicts);
});
test('checkSheet: says which part ran out of time, the tags or the sweep', () => {
  const r = C.checkSheet({ ...SWEEP_SHEET, library: SWEEP_LIBRARY, lookups: LOOKUPS_B, options: { timeLimitMs: 1 } });
  assert.deepEqual([r.timedOut, r.sweepTimedOut, r.tagsTimedOut], [true, true, false]);
  const ok = C.checkSheet({ ...SWEEP_SHEET, library: SWEEP_LIBRARY, lookups: LOOKUPS_B });
  assert.deepEqual([ok.timedOut, ok.sweepTimedOut, ok.tagsTimedOut], [false, false, false]);
});
