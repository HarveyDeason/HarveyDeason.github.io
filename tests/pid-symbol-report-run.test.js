import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../assets/js/pid-symbol-report-run.js';

// Invented sheets and fake effects: no PDF, no worker.
const SHEETS = [{ drawing: 'INV-0001', rev: 'C01', family: 'Invented' }, { drawing: 'INV-0002', rev: 'C01', family: 'Invented' },
  { drawing: 'INV-0003', rev: 'P02', family: '' }];
const RESULT = { ok: true, verdicts: [{ tag: '21-W-1001', fc: 'W', verdict: 'ok' }] };
const VT = [1, 0, 0, -1, 0, 400];

function fakeDeps(over = {}) {
  const calls = { loadPdf: 0, precheck: 0, check: 0 };
  const deps = {
    loadPdf: async () => { calls.loadPdf++; return new Uint8Array([1, 2, 3]); },
    precheck: async () => { calls.precheck++; return { status: 'readable', tags: [{ tag: '21-W-1001', fc: 'W' }] }; },
    check: async (bytes, tags, onTags) => { calls.check++; onTags(2, 5); return { result: RESULT, viewportTransform: VT, pages: 1, pageSize: [500, 400] }; },
    ...over,
  };
  return { deps, calls };
}
const clock = () => { let t = 1000; return () => (t += 250); };

test('runReport: three good sheets are checked in the order given', async () => {
  const { deps, calls } = fakeDeps({ now: clock() });
  const seen = [];
  const out = await R.runReport({ sheets: SHEETS, deps, signal: { stopped: false }, onProgress: p => seen.push(p) });
  assert.equal(out.stopped, false);
  assert.deepEqual(out.outcomes.map(o => o.drawing), ['INV-0001', 'INV-0002', 'INV-0003']);
  for (const [i, o] of out.outcomes.entries()) {
    assert.equal(o.status, 'checked');
    assert.equal(o.reason, '');
    assert.equal(o.precheck, 'readable');
    assert.equal(o.result, RESULT);
    assert.deepEqual(o.viewportTransform, VT);
    assert.equal(o.pages, 1);
    assert.deepEqual(o.pageSize, [500, 400]);
    assert.equal(o.rev, SHEETS[i].rev);
    assert.equal(o.family, SHEETS[i].family);
    assert.equal(typeof o.ms, 'number');
    assert.ok(o.ms > 0);
  }
  assert.equal(calls.check, 3);
  const first = seen.findIndex(p => p.sheet === 1 && p.of === 3 && p.done === null && p.drawing === 'INV-0001');
  const tagsSeen = seen.findIndex(p => p.sheet === 1 && p.of === 3 && p.done === 2 && p.total === 5);
  assert.ok(first >= 0 && tagsSeen > first, JSON.stringify(seen));
  assert.equal(typeof out.ms, 'number');
  assert.ok(out.ms > 0);
});

test('runReport: each reason a sheet is not checked, and the run goes on to the next sheet', async () => {
  const cases = [
    [{ loadPdf: async () => null }, R.REASONS.noPdf, ''],
    [{ loadPdf: async () => { throw new Error('gone'); } }, R.REASONS.noPdf, ''],
    [{ precheck: async () => null }, R.REASONS.precheckFailed, ''],
    [{ precheck: async () => { throw new Error('bad'); } }, R.REASONS.precheckFailed, ''],
    [{ precheck: async () => ({ status: 'none', tags: [] }) }, R.notReadable('none'), 'none'],
    [{ check: async () => ({ result: { ok: false, why: 'failed' } }) }, R.REASONS.failed, 'readable'],
    [{ check: async () => ({ result: null }) }, R.REASONS.failed, 'readable'],
    [{ check: async () => { throw new Error('worker'); } }, R.REASONS.failed, 'readable'],
  ];
  assert.equal(R.notReadable('none'), 'Pre-check status is No readable text: this sheet cannot be checked.');
  for (const [over, reason, precheck] of cases) {
    // only the first sheet misbehaves; the second must still be checked
    let n = 0;
    const good = fakeDeps().deps;
    const bad = { ...good };
    for (const k of Object.keys(over)) bad[k] = (...a) => (n++ === 0 ? over[k](...a) : good[k](...a));
    const out = await R.runReport({ sheets: SHEETS.slice(0, 2), deps: bad, signal: { stopped: false } });
    assert.equal(out.outcomes.length, 2);
    assert.equal(out.outcomes[0].status, 'not-checked', reason);
    assert.equal(out.outcomes[0].reason, reason);
    assert.equal(out.outcomes[0].precheck, precheck, reason);
    assert.equal(out.outcomes[0].result, null);
    assert.equal(out.outcomes[1].status, 'checked', reason);
  }
});

test('runReport: a sheet that hit the time limit is still checked', async () => {
  const timed = { ok: true, timedOut: true, verdicts: [] };
  const { deps } = fakeDeps({ check: async () => ({ result: timed, viewportTransform: VT, pages: 2, pageSize: [500, 400] }) });
  const out = await R.runReport({ sheets: SHEETS.slice(0, 1), deps, signal: { stopped: false } });
  assert.equal(out.outcomes[0].status, 'checked');
  assert.equal(out.outcomes[0].result, timed);
  assert.equal(out.outcomes[0].pages, 2);
});

test('runReport: Stop during sheet 2 of 3 lists sheets 2 and 3 as stopped', async () => {
  const signal = { stopped: false };
  let n = 0;
  const { deps } = fakeDeps({
    check: async () => {
      n++;
      if (n === 2) { signal.stopped = true; return { stopped: true }; }
      return { result: RESULT, viewportTransform: VT, pages: 1, pageSize: [500, 400] };
    },
  });
  const out = await R.runReport({ sheets: SHEETS, deps, signal });
  assert.equal(out.stopped, true);
  assert.equal(n, 2);
  assert.deepEqual(out.outcomes.map(o => o.status), ['checked', 'not-checked', 'not-checked']);
  assert.equal(out.outcomes[1].reason, R.REASONS.stopped);
  assert.equal(out.outcomes[2].reason, R.REASONS.stopped);
  assert.equal(out.outcomes[2].drawing, 'INV-0003');
});

test('runReport: Stop before the first sheet calls nothing', async () => {
  const { deps, calls } = fakeDeps();
  const out = await R.runReport({ sheets: SHEETS, deps, signal: { stopped: true } });
  assert.equal(out.stopped, true);
  assert.deepEqual(out.outcomes.map(o => o.reason), [R.REASONS.stopped, R.REASONS.stopped, R.REASONS.stopped]);
  assert.deepEqual(calls, { loadPdf: 0, precheck: 0, check: 0 });
});

test('runReport: hostile input gives an empty or degraded run, never a throw', async () => {
  for (const bad of [null, undefined, 'x', { sheets: 'x' }, { sheets: null }]) {
    const out = await R.runReport(bad);
    assert.deepEqual(out.outcomes, []);
    assert.equal(out.stopped, false);
    assert.equal(typeof out.ms, 'number');
  }
  const { deps } = fakeDeps();
  delete deps.check;
  const out = await R.runReport({ sheets: [...SHEETS, null, 'x', { drawing: 5 }], deps, signal: { stopped: false }, onProgress: () => { throw new Error('ui'); } });
  assert.deepEqual(out.outcomes.slice(0, 3).map(o => o.reason), [R.REASONS.failed, R.REASONS.failed, R.REASONS.failed]);
  for (const o of out.outcomes) assert.equal(typeof o.drawing, 'string');
  const none = await R.runReport({ sheets: SHEETS, deps: null });
  assert.deepEqual(none.outcomes.map(o => o.reason), [R.REASONS.noPdf, R.REASONS.noPdf, R.REASONS.noPdf]);
});

test('the panel strings: blockers, count, reach, progress and finish', () => {
  assert.equal(R.exportBlocker({ ticked: 3, hasLibrary: true, running: true }), 'A report is running.');
  assert.equal(R.exportBlocker({ ticked: 0, hasLibrary: true, running: false }), 'Tick one or more sheets first.');
  assert.equal(R.exportBlocker({ ticked: 2, hasLibrary: false, running: false }), 'Load the symbol library first, on the Symbols tab.');
  assert.equal(R.exportBlocker({ ticked: 2, hasLibrary: true, running: false }), '');
  assert.equal(R.exportBlocker(null), 'Tick one or more sheets first.');
  assert.equal(R.tickCountText(0), '');
  assert.equal(R.tickCountText(1), '1 sheet ticked');
  assert.equal(R.tickCountText(12), '12 sheets ticked');
  assert.equal(R.tickCountText('x'), '');

  const reach = R.reachHtml({ names: ['INV-1', '<img src=x>', 'INV-3'], missing: ['INV-3'], connected: false, checkedBy: '"><b>', dropped: 1 });
  for (const part of ['2 of 3 ticked sheets can be checked.', '1 has no PDF in this session: connect the folder or re-import them.',
    '1 ticked sheet is no longer in the register and was left out.', 'INV-3 (no PDF)', 'data-act="sr-run"', 'data-act="sr-cancel"',
    'id="sr-by"', 'Checked by (optional)', 'Nothing is saved to the folder.']) assert.ok(reach.includes(part), part);
  assert.ok(!reach.includes('<img') && !reach.includes('<b>'));
  const reach2 = R.reachHtml({ names: ['A', 'B', 'C'], missing: ['A', 'B'], connected: true, checkedBy: '', dropped: 2 });
  assert.ok(reach2.includes('1 of 3 ticked sheets can be checked. 2 have no PDF in this session or in the folder: re-import them.'));
  assert.ok(reach2.includes('2 ticked sheets are no longer in the register and were left out.'));
  assert.ok(!R.reachHtml({ names: ['A'], missing: [], connected: false, checkedBy: '', dropped: 0 }).includes('no PDF'));
  // Every tick gone from the register: say so, and offer no Run that would make an empty report.
  const gone = R.reachHtml({ names: [], missing: [], connected: false, checkedBy: '', dropped: 2 });
  assert.ok(gone.includes('2 ticked sheets are no longer in the register and were left out.'));
  assert.ok(gone.includes('No ticked sheets are left to check.'));
  assert.ok(!gone.includes('data-act="sr-run"') && !gone.includes('id="sr-by"'));
  assert.ok(gone.includes('data-act="sr-cancel"'));
  assert.ok(R.reachHtml(null).includes('No ticked sheets are left to check.') && !R.reachHtml(null).includes('sr-run'));

  assert.ok(R.progressHtml({ sheet: 4, of: 28, drawing: 'INV-4', done: 31, total: 71 }).includes('Checking sheet 4 of 28: INV-4, tag 31 of 71…'));
  const reading = R.progressHtml({ sheet: 1, of: 2, drawing: '<i>x', done: null, total: null });
  assert.ok(reading.includes('Checking sheet 1 of 2: &lt;i&gt;x, reading the drawing…'));
  assert.ok(reading.includes('data-act="sr-stop"'));
  // The changing words sit in their own span, so the tool can update them without rebuilding Stop.
  const p = { sheet: 4, of: 28, drawing: '<i>x', done: 31, total: 71 };
  assert.equal(R.progressText(p), 'Checking sheet 4 of 28: <i>x, tag 31 of 71…');
  assert.ok(R.progressHtml(p).includes('<span class="sr-progress">Checking sheet 4 of 28: &lt;i&gt;x, tag 31 of 71…</span>'));
  assert.equal(R.progressText(null), 'Checking sheet 0 of 0: , reading the drawing…');

  const stopped = R.finishedHtml({ checked: 2, notChecked: 1, seconds: 252, stopped: 2, of: 3 });
  assert.ok(stopped.startsWith('Stopped by user after 2 of 3 sheets. 2 checked, 1 not checked, 4 min 12 s.')
    || stopped.replace(/<[^>]+>/g, '').startsWith('Stopped by user after 2 of 3 sheets. 2 checked, 1 not checked, 4 min 12 s.'), stopped);
  const done = R.finishedHtml({ checked: 3, notChecked: 0, seconds: 42, stopped: false, of: 3 });
  assert.ok(done.includes('42 s.') && !done.includes('Stopped'));
  for (const html of [stopped, done]) {
    for (const act of ['sr-pdf', 'sr-xlsx', 'sr-close']) assert.ok(html.includes('data-act="' + act + '"'), act);
    assert.ok(html.includes('Nothing has been saved to the folder.'));
  }
  assert.ok(R.finishedHtml({ checked: 0, notChecked: 3, seconds: 0, stopped: 0, of: 3 }).includes('Stopped by user after 0 of 3 sheets.'));
});

// ── Symbols first: comment sheets, sheets with no tags, the sweep's progress ──
test('runReport: a Readable from comments sheet is checked, and the check is told its status', async () => {
  const seen = [];
  const { deps } = fakeDeps({
    precheck: async () => ({ status: 'comments', tags: [{ tag: '21-W-1001', fc: 'W' }] }),
    check: async (bytes, tags, onTags, status) => { seen.push(status); return { result: RESULT, viewportTransform: VT, pages: 1, pageSize: [500, 400] }; },
  });
  const out = await R.runReport({ sheets: SHEETS.slice(0, 1), deps, signal: { stopped: false } });
  assert.deepEqual(seen, ['comments']);
  assert.equal(out.outcomes[0].status, 'checked'); assert.equal(out.outcomes[0].precheck, 'comments');
  const plain = fakeDeps({ check: async (b, t, o, status) => { seen.push(status); return { result: RESULT, viewportTransform: VT, pages: 1, pageSize: [500, 400] }; } });
  await R.runReport({ sheets: SHEETS.slice(0, 1), deps: plain.deps, signal: { stopped: false } });
  assert.deepEqual(seen, ['comments', 'readable']);
});
test('runReport: a sheet with no tags is still checked, for its symbols', async () => {
  const none = { ok: true, verdicts: [], symbols: [{ name: 'WIDGET', tag: null }] };
  const { deps } = fakeDeps({ precheck: async () => ({ status: 'readable', tags: [] }),
    check: async () => ({ result: none, viewportTransform: VT, pages: 1, pageSize: [500, 400] }) });
  const out = await R.runReport({ sheets: SHEETS.slice(0, 1), deps, signal: { stopped: false } });
  assert.equal(out.outcomes[0].status, 'checked'); assert.equal(out.outcomes[0].result, none);
});
test('runReport: progress carries the stage; a printed sheet says it cannot be checked yet', async () => {
  const seen = [];
  const { deps } = fakeDeps({ check: async (b, t, onTags) => { onTags(2, 5, 'tags'); onTags(3, 9, 'sweep'); return { result: RESULT, viewportTransform: VT, pages: 1, pageSize: [500, 400] }; } });
  await R.runReport({ sheets: SHEETS.slice(0, 1), deps, signal: { stopped: false }, onProgress: p => seen.push(p) });
  assert.ok(seen.some(p => p.done === 2 && p.total === 5 && p.stage === 'tags'));
  assert.ok(seen.some(p => p.done === 3 && p.total === 9 && p.stage === 'sweep'));
  assert.equal(R.progressText({ sheet: 2, of: 3, drawing: 'INV-2', done: 3, total: 9, stage: 'sweep' }),
    'Checking sheet 2 of 3: INV-2, looking for symbols, row 3 of 9…');
  assert.equal(R.progressText({ sheet: 2, of: 3, drawing: 'INV-2', done: 3, total: 9, stage: 'tags' }), 'Checking sheet 2 of 3: INV-2, tag 3 of 9…');
  const printed = fakeDeps({ precheck: async () => ({ status: 'none', tags: [] }) });
  const out = await R.runReport({ sheets: SHEETS.slice(0, 1), deps: printed.deps, signal: { stopped: false } });
  assert.equal(out.outcomes[0].reason, 'Pre-check status is No readable text: this sheet cannot be checked.');
});
test('runReport: a printed sheet is checked with its status; scanned is not checked yet; none cannot be checked', async () => {
  const seen = [];
  const printed = fakeDeps({ precheck: async () => ({ status: 'printed', tags: [] }),
    check: async (b, t, o, status) => { seen.push(status); return { result: { ok: true, verdicts: [], symbols: [] }, viewportTransform: VT, pages: 1, pageSize: [500, 400] }; } });
  const out = await R.runReport({ sheets: SHEETS.slice(0, 1), deps: printed.deps, signal: { stopped: false } });
  assert.deepEqual(seen, ['printed']);
  assert.equal(out.outcomes[0].status, 'checked'); assert.equal(out.outcomes[0].precheck, 'printed');
  assert.deepEqual(out.outcomes[0].result.verdicts, []);
  const scanned = fakeDeps({ precheck: async () => ({ status: 'scanned', tags: [] }) });
  const o2 = await R.runReport({ sheets: SHEETS.slice(0, 1), deps: scanned.deps, signal: { stopped: false } });
  assert.equal(o2.outcomes[0].status, 'not-checked'); assert.equal(o2.outcomes[0].reason, 'Scanned image: not checked yet.');
  assert.equal(o2.outcomes[0].precheck, 'scanned'); assert.equal(scanned.calls.check, 0);
  assert.equal(R.notReadable('none'), 'Pre-check status is No readable text: this sheet cannot be checked.');
  assert.equal(R.REASONS.noTags, undefined);
});
