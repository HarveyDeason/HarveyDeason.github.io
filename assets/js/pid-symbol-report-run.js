// assets/js/pid-symbol-report-run.js
// The symbol check over a set of ticked sheets, one at a time, for a report;
// and the strings the Sheets tab shows before, during and after the run.
//
// Every outside effect (reading a PDF, the pre-check, the worker, the clock)
// is passed in as `deps`, so stopping, failures and reasons are node-tested.
// Nothing here saves anything: the run returns plain data and the caller
// keeps it in memory until the panel is closed.
//
// Names and tags come from PDFs and the register: every one shown as HTML
// goes through esc(). Nothing here throws.

import { esc } from './pid-symbols-view.js';
import { STATUS_LABELS } from './pid-precheck.js';

export const REASONS = {
  noPdf: 'PDF not available in this session: connect the folder or re-import it.',
  precheckFailed: 'This sheet could not be pre-checked.',
  failed: 'The symbol check could not run on this sheet.',
  stopped: 'Stopped before this sheet was checked.',
  scanned: 'Scanned image: not checked yet.',
};

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isNum = x => typeof x === 'number' && Number.isFinite(x);
const str = x => (typeof x === 'string' ? x : '');
const obj = x => (x && typeof x === 'object' ? x : {});
const count = x => (isNum(x) && x > 0 ? Math.floor(x) : 0);
const fn = f => (typeof f === 'function' ? f : null);

/** Why a sheet whose pre-check is neither Readable nor Readable from comments was left out. */
export function notReadable(status) {
  const label = has(STATUS_LABELS, status) ? STATUS_LABELS[status] : 'unknown';
  return 'Pre-check status is ' + label + ': this sheet cannot be checked.';
}

const isTransform = t => Array.isArray(t) && t.length === 6 && t.every(isNum);
const isSize = s => Array.isArray(s) && s.length === 2 && s.every(x => isNum(x) && x > 0);

/** The most sheets a run works on at once. More than this only fills the memory with drawings. */
export const MAX_LANES = 8;

/**
 * Run the check on each sheet. `signal.stopped` is set by the caller
 * (the Stop button); the sheets in progress when it lands, and every later
 * sheet, are listed as stopped. Resolves, never rejects.
 *
 * `lanes` (a whole number, 1 to MAX_LANES; anything else means 1) is how many
 * sheets are worked on at once. Each lane takes the next sheet when it is free,
 * and the outcomes come back in the order the sheets were given, whichever
 * finished first, with the same content as a run one sheet at a time.
 */
export async function runReport(opts) {
  const o = obj(opts);
  const deps = obj(o.deps);
  const nowFn = fn(deps.now) || Date.now;
  const now = () => { try { const t = nowFn(); return isNum(t) ? t : 0; } catch { return 0; } };
  const started = now();
  if (!Array.isArray(o.sheets)) return { outcomes: [], stopped: false, ms: 0 };
  const signal = o.signal && typeof o.signal === 'object' ? o.signal : { stopped: false };
  const onProgress = fn(o.onProgress);
  const progress = p => { if (onProgress) { try { onProgress(p); } catch { /* the screen is not the run */ } } };
  const sheets = o.sheets.map(s => { const x = obj(s); return { drawing: str(x.drawing), rev: str(x.rev), family: str(x.family) }; });
  const of = sheets.length;
  const outcomes = new Array(of);
  let stopped = false, completed = 0;
  const isStopped = () => stopped || signal.stopped === true;
  const asked = o.lanes;
  const lanes = Number.isInteger(asked) && asked >= 1 ? Math.min(asked, MAX_LANES, of || 1) : 1;

  const runOne = async i => {
    const sheet = sheets[i];
    const t0 = now();
    const out = { ...sheet, status: 'not-checked', reason: '', precheck: '', pages: 0, pageSize: null, viewportTransform: null, result: null, ms: 0 };
    const finish = reason => {
      if (reason === REASONS.stopped) stopped = true;
      out.reason = reason;
      out.ms = Math.max(0, now() - t0);
      outcomes[i] = out;
      completed++;
    };
    if (isStopped()) { finish(REASONS.stopped); return; }
    progress({ sheet: i + 1, of, drawing: sheet.drawing, done: null, total: null, lanes, completed });

    let bytes = null;
    try { bytes = deps.loadPdf ? await deps.loadPdf(sheet.drawing, sheet.rev) : null; } catch { bytes = null; }
    if (isStopped()) { finish(REASONS.stopped); return; }
    if (!bytes || !(bytes instanceof ArrayBuffer || ArrayBuffer.isView(bytes))) { finish(REASONS.noPdf); return; }

    let pre = null;
    try { pre = deps.precheck ? await deps.precheck(sheet.drawing, sheet.rev, bytes) : null; } catch { pre = null; }
    if (isStopped()) { finish(REASONS.stopped); return; }
    const status = pre && typeof pre === 'object' && has(STATUS_LABELS, pre.status) ? pre.status : '';
    if (!status) { finish(REASONS.precheckFailed); return; }
    out.precheck = status;
    if (status === 'scanned') { finish(REASONS.scanned); return; }
    if (status !== 'readable' && status !== 'comments' && status !== 'printed') { finish(notReadable(status)); return; }
    const tags = (Array.isArray(pre.tags) ? pre.tags : []).filter(t => t && typeof t === 'object')
      .map(t => ({ tag: str(t.tag), fc: str(t.fc) })).filter(t => t.tag);

    let r = null;
    try {
      // The status tells the check where the words are: the text layer, or the comments.
      r = deps.check ? await deps.check(bytes, tags, (done, total, stage) => progress({ sheet: i + 1, of, drawing: sheet.drawing,
        done: count(done), total: count(total), stage: str(stage), lanes, completed }), status) : null;
    } catch { r = null; }
    if (isStopped() || (r && r.stopped === true)) { finish(REASONS.stopped); return; }
    const res = r && typeof r === 'object' ? r.result : null;
    if (res && typeof res === 'object' && res.ok === true && Array.isArray(res.verdicts)) {
      out.status = 'checked';
      out.result = res;
      out.viewportTransform = isTransform(r.viewportTransform) ? r.viewportTransform.slice() : null;
      out.pages = count(r.pages);
      out.pageSize = isSize(r.pageSize) ? r.pageSize.slice() : null;
      finish('');
      return;
    }
    finish(REASONS.failed);
  };

  let next = 0;
  const lane = async () => { for (let i = next++; i < of; i = next++) await runOne(i); };
  await Promise.all(Array.from({ length: lanes }, lane));
  return { outcomes, stopped, ms: Math.max(0, now() - started) };
}

// ---- What the Sheets tab shows ------------------------------------------------

/** Why Export report cannot be pressed just now; '' when it can. */
export function exportBlocker(state) {
  const s = obj(state);
  if (s.running) return 'A report is running.';
  if (count(s.ticked) < 1) return 'Tick one or more sheets first.';
  if (!s.hasLibrary) return 'Load the symbol library first, on the Symbols tab.';
  return '';
}

export function tickCountText(n) {
  const k = count(n);
  if (!k) return '';
  return k === 1 ? '1 sheet ticked' : k + ' sheets ticked';
}

const strList = x => (Array.isArray(x) ? x.filter(s => typeof s === 'string') : []);

/** Before the run: what can be reached, every ticked name, Checked by, Run and Cancel. */
export function reachHtml(opts) {
  const o = obj(opts);
  const names = strList(o.names);
  const missingSet = new Set(strList(o.missing).filter(m => names.includes(m)));
  const n = names.length, k = missingSet.size, dropped = count(o.dropped);
  let line = (n - k) + ' of ' + n + ' ticked sheets can be checked.';
  if (k > 0) {
    line += ' ' + k + (k === 1 ? ' has' : ' have') + (o.connected
      ? ' no PDF in this session or in the folder: re-import them.'
      : ' no PDF in this session: connect the folder or re-import them.');
  }
  const gone = dropped === 1 ? '1 ticked sheet is no longer in the register and was left out.'
    : dropped > 1 ? dropped + ' ticked sheets are no longer in the register and were left out.' : '';
  if (gone) line += ' ' + gone;
  if (!n) {
    // Nothing left to check: a Run here could only make an empty report.
    return '<div class="sr-line">' + esc((gone ? gone + ' ' : '') + 'No ticked sheets are left to check.') + '</div>'
      + '<div class="sr-actions"><button type="button" class="btn" data-act="sr-cancel">Cancel</button></div>';
  }
  return '<div class="sr-line">' + esc(line) + '</div>'
    + '<ul class="sr-names">' + names.map(nm => '<li>' + esc(nm) + (missingSet.has(nm) ? ' (no PDF)' : '') + '</li>').join('') + '</ul>'
    + '<label class="sr-by">Checked by (optional) <input type="text" id="sr-by" maxlength="80" value="' + esc(str(o.checkedBy)) + '"></label>'
    + '<div class="sr-actions"><button type="button" class="btn" data-act="sr-run">Run</button> '
    + '<button type="button" class="btn" data-act="sr-cancel">Cancel</button></div>'
    + '<div class="sr-note">Nothing is saved to the folder.</div>';
}

/** Which sheet, which tag: plain text, for the tool to set as text. */
export function progressText(p) {
  const o = obj(p);
  if (count(o.lanes) > 1) {
    return 'Checking ' + count(o.lanes) + ' sheets at a time: ' + count(o.completed) + ' of ' + count(o.of) + ' done, now ' + str(o.drawing) + ', '
      + (o.done === null || o.done === undefined ? 'reading the drawing…'
        : o.stage === 'sweep' ? 'looking for symbols, row ' + count(o.done) + ' of ' + count(o.total) + '…'
          : 'tag ' + count(o.done) + ' of ' + count(o.total) + '…');
  }
  return 'Checking sheet ' + count(o.sheet) + ' of ' + count(o.of) + ': ' + str(o.drawing) + ', '
    + (o.done === null || o.done === undefined ? 'reading the drawing…'
      : o.stage === 'sweep' ? 'looking for symbols, row ' + count(o.done) + ' of ' + count(o.total) + '…'
        : 'tag ' + count(o.done) + ' of ' + count(o.total) + '…');
}

/**
 * While the run goes: the progress line and Stop. The words sit in their own
 * span so the tool can update them as text; rebuilding the Stop button on
 * every message could swallow a click on it.
 */
export function progressHtml(p) {
  return '<div class="sr-line"><span class="sr-progress">' + esc(progressText(p)) + '</span> '
    + '<button type="button" class="btn" data-act="sr-stop">Stop</button></div>';
}

function duration(seconds) {
  const s = Math.round(isNum(seconds) && seconds > 0 ? seconds : 0);
  return s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + (s % 60) + ' s';
}

/** After the run: the summary line and the two downloads. `stopped` is false or the number of sheets reached. */
export function finishedHtml(opts) {
  const o = obj(opts);
  const prefix = isNum(o.stopped) ? 'Stopped by user after ' + count(o.stopped) + ' of ' + count(o.of) + ' sheets. ' : '';
  return esc(prefix + count(o.checked) + ' checked, ' + count(o.notChecked) + ' not checked, ' + duration(o.seconds) + '.')
    + ' Nothing has been saved to the folder.'
    + '<div class="sr-actions"><button type="button" class="btn" data-act="sr-pdf">Download PDF</button> '
    + '<button type="button" class="btn" data-act="sr-xlsx">Download Excel</button> '
    + '<button type="button" class="btn" data-act="sr-close">Close</button></div>';
}
