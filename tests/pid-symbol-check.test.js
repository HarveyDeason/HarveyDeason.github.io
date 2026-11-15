import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../assets/js/pid-symbol-check.js';
import { LIBRARY, LOOKUPS, SHEET, place, label, octagon } from './fixtures/symbol-check-sheet.js';

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
  assert.deepEqual([f('ZI').mode, f('ZI').why], ['skip', 'Instrument bubbles are not checked yet.']);
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
  run({ onProgress: (done, total) => seen.push([done, total]) });
  assert.equal(seen.length, SHEET.tags.length);
  assert.deepEqual(seen[seen.length - 1], [SHEET.tags.length, SHEET.tags.length]);
  assert.equal(run({ onProgress: () => { throw new Error('boom'); } }).ok, true);
});
test('checkSheet: no library, no tags, or rubbish gives ok false, never a throw', () => {
  assert.deepEqual(run({ library: null }), { ok: false, why: 'no-library' });
  assert.deepEqual(run({ library: { version: 1, symbols: [] } }), { ok: false, why: 'no-library' });
  assert.deepEqual(run({ tags: [] }), { ok: false, why: 'no-tags' });
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
  assert.equal(verdictOf(r, '21-ZI-5001').why, 'Instrument bubbles are not checked yet.');   // its own reason is kept
  assert.equal(run().timedOut, false);
});
