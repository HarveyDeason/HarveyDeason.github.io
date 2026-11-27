// assets/js/pid-standard-pack.js
// Reads a filled-in Standard Pack (the fields of the template PDF, scripts/make-standard-pack-template.mjs) into the tables, settings and
// stamp the checks use. Pure: no DOM, no files. Never throws.
//
// A PACK HOLDS A COMPANY'S STANDARD (its function-code and process-area tables), which is confidential reference data. None of it is here:
// this module is only the logic, and the pack arrives at run time from the user's own file, as the lookup tables always have.
//
// What is applied today: the tag tables (function code -> category and description, process area -> description), the pipe material codes,
// the check settings the check reads from its options, and your attachment, drive and variant lists (added to the defaults). Everything else
// in a pack (the tag, drawing-number and revision rules, the frame rules, the settings the check keeps as fixed numbers) is read, kept with
// the pack and stamped, and reported as "not applied yet": it is recorded, not acted on.

export const CATEGORIES = Object.freeze(['instrument', 'valve', 'equipment', 'electrical', 'other']);
// A code that has a description but no category: kept in the descriptions only.
export const NO_CATEGORY = 'none';
export const MODES = Object.freeze(['auto', 'check', 'skip']);
// Settings the check reads from its options, with the range a sane value lies in.
export const APPLIED_SETTINGS = Object.freeze({ recognise: [0, 1], shapeExplained: [0, 1], minScale: [0.1, 5], maxScale: [0.1, 5], radius: [1, 1000], inkTol: [0.05, 5],
  plainBack: [0, 1], shareInk: [0, 1], minSize: [0.5, 100], maxSize: [1, 1000], sweepStep: [10, 300], inkGrey: [1, 255], timeLimitMs: [1000, 3600000] });
// Settings the check keeps as fixed numbers today (recorded in the pack, not applied).
export const RECORDED_SETTINGS = Object.freeze({ sizeTol: [0, 1], judgeBand: 'pair', amberAlike: [0, 1], amberExplained: [0, 1], greenSwitch: [0, 1], scaleSymbolsMin: [0, 1000],
  letterRoom: [0, 50], heavyPipe: [1, 50], heavyMin: [0, 50], paleMin: [0, 255], paleStep: [0, 255], driveShare: [0, 1] });
const PRECHECK = Object.freeze({ printedMinPaths: [1, 1e6], scanCover: [0, 1], sizeTolerance: [0, 50] });
const RECORDED_TEXT = Object.freeze({ drawingno: 'drawingno_', revision: 'revision_', tag: 'tag_', frame: 'frame_' });
const REQUIRED = Object.freeze([['pack_name', 'the pack name'], ['pack_revision', 'the pack revision'], ['pack_standard_date', 'the standard\'s issue date']]);

const isObj = x => !!x && typeof x === 'object';
const own = (o, k) => isObj(o) && Object.prototype.hasOwnProperty.call(o, k);
// One value of a field as trimmed text: a text field's string, a dropdown's list (its first entry), anything else ''. Never throws.
function val(fields, name) {
  try {
    if (!own(fields, name)) return '';
    let v = fields[name];
    if (Array.isArray(v)) v = v.length ? v[0] : '';
    if (typeof v === 'number' && Number.isFinite(v)) v = String(v);
    return typeof v === 'string' ? v.trim() : '';
  } catch {
    return '';
  }
}
const keysOf = fields => { try { return isObj(fields) && !Array.isArray(fields) ? Object.keys(fields) : []; } catch { return []; } };
const rowIds = (keys, re) => [...new Set(keys.map(k => { const m = re.exec(k); return m ? m[1] : null; }).filter(Boolean))].sort((a, b) => Number(a) - Number(b) || (a < b ? -1 : 1));
const uniqUpper = a => [...new Set(a.map(x => x.toUpperCase()))];
// Legend entry names are matched in capitals, so a list is kept in capitals with repeats dropped.
const list = (fields, keys, prefix) => uniqUpper(rowIds(keys, new RegExp('^' + prefix + '_(\\d+)$')).map(n => val(fields, prefix + '_' + n)).filter(Boolean));

/**
 * A filled pack from its form fields (field name -> text, or a list for a dropdown). Returns
 * { ok, pack, problems: [{ level: 'error'|'warning', field, message }], counts, notApplied: [setting names], recorded: [item names] }.
 * ok is false when there is any error; the pack is still returned so the problems can be shown with what was read.
 */
export function packFromFields(fields) {
  const problems = [];
  const add = (level, field, message) => problems.push({ level, field, message });
  const empty = { ok: false, pack: null, problems, counts: {}, notApplied: [], recorded: [] };
  try {
    const keys = keysOf(fields);
    if (!keys.length) { add('error', '', 'No fields were read from the file: it is not a filled-in Standard Pack.'); return empty; }
    for (const [f, what] of REQUIRED) if (!val(fields, f)) add('error', f, 'Fill in ' + what + '.');
    const v = n => val(fields, n);
    const identity = { name: v('pack_name'), id: v('pack_id'), revision: v('pack_revision'), issuer: v('pack_issuer'),
      standard: { title: v('pack_standard_title'), number: v('pack_standard_number'), revision: v('pack_standard_revision'), date: v('pack_standard_date'),
        custodian: v('pack_standard_custodian'), status: v('pack_standard_status') },
      supersedes: v('pack_supersedes'), applies: v('pack_applies'), owner: v('pack_owner'), notes: v('pack_notes') };
    if (identity.id && /\s/.test(identity.id)) add('warning', 'pack_id', 'The pack id has spaces; it is used as it is.');

    const pac = {};
    for (const n of rowIds(keys, /^pac_(\d+)_(?:code|desc|note)$/)) {
      const code = v('pac_' + n + '_code'), desc = v('pac_' + n + '_desc');
      if (!code) { if (desc) add('warning', 'pac_' + n + '_desc', 'A process-area description with no code is ignored.'); continue; }
      if (!/^\d{1,2}$/.test(code)) add('warning', 'pac_' + n + '_code', 'Process-area code "' + code + '" is not 1-2 digits.');
      if (own(pac, code)) add('error', 'pac_' + n + '_code', 'Process-area code ' + code + ' appears more than once.');
      pac[code] = desc;
    }
    const fc = {}, fcDescriptions = {}, fcMode = {};
    const seenFc = new Set();
    for (const n of rowIds(keys, /^fc_(\d+)_(?:code|desc|cat|mode|note)$/)) {
      const code = v('fc_' + n + '_code').toUpperCase(), desc = v('fc_' + n + '_desc'), cat = v('fc_' + n + '_cat'), mode = v('fc_' + n + '_mode'), nt = v('fc_' + n + '_note');
      if (!code) { if (desc) add('warning', 'fc_' + n + '_desc', 'A function-code description with no code is ignored.'); continue; }
      if (!/^[A-Z]{1,8}$/.test(code)) add('warning', 'fc_' + n + '_code', 'Function code "' + code + '" is not 1-8 capital letters.');
      if (seenFc.has(code)) add('error', 'fc_' + n + '_code', 'Function code ' + code + ' appears more than once.');
      seenFc.add(code);
      let c = cat.toLowerCase();
      if (c && c !== NO_CATEGORY && !CATEGORIES.includes(c)) { add('warning', 'fc_' + n + '_cat', 'Category "' + cat + '" is not one of ' + CATEGORIES.concat(NO_CATEGORY).join(', ') + '; read as other.'); c = 'other'; }
      // "none": the code has a description but no category, so it stays out of the category table (the tool then reads it as other).
      if (c !== NO_CATEGORY) fc[code] = c || 'other';
      else if (!desc) add('warning', 'fc_' + n + '_desc', 'Function code ' + code + ' has no category and no description, so it adds nothing.');
      if (desc) fcDescriptions[code] = desc;
      const m = mode.toLowerCase();
      if (m && !MODES.includes(m)) add('warning', 'fc_' + n + '_mode', 'Check mode "' + mode + '" is not one of ' + MODES.join(', ') + '; read as auto.');
      if (m === 'skip' && !nt) add('error', 'fc_' + n + '_note', 'Function code ' + code + ' is skipped: give the reason in the note.');
      if (m === 'check' || m === 'skip') fcMode[code] = { mode: m, note: nt };
    }
    const mats = v('tag_materials');
    const materials = mats ? uniqUpper(mats.split(/[,\s;]+/).filter(Boolean)) : null;

    const families = {};
    for (const n of rowIds(keys, /^family_(\d+)_(?:code|mode|why)$/)) {
      const code = v('family_' + n + '_code').toUpperCase(), mode = v('family_' + n + '_mode').toLowerCase(), why = v('family_' + n + '_why');
      if (!code) continue;
      if (mode !== 'check' && mode !== 'skip') { if (mode) add('warning', 'family_' + n + '_mode', 'Family mode "' + mode + '" is not check or skip; ignored.'); continue; }
      if (mode === 'skip' && !why) add('error', 'family_' + n + '_why', 'Family ' + code + ' is skipped: give the reason.');
      families[code] = { mode, why };
    }
    const exceptions = [];
    for (const n of rowIds(keys, /^exception_(\d+)_(?:name|status|note|ref)$/)) {
      const name = v('exception_' + n + '_name'); if (!name) continue;
      exceptions.push({ name, status: v('exception_' + n + '_status') === 'approved' ? 'approved' : 'pending', note: v('exception_' + n + '_note'), ref: v('exception_' + n + '_ref') });
    }
    const legend = [];
    for (const n of rowIds(keys, /^legend_(\d+)_(?:sheet|rev|date|ref)$/)) {
      const sheet = v('legend_' + n + '_sheet'); if (!sheet) continue;
      legend.push({ sheet, rev: v('legend_' + n + '_rev'), date: v('legend_' + n + '_date'), ref: v('legend_' + n + '_ref') });
    }
    const lists = { operators: list(fields, keys, 'operators'), attachments: list(fields, keys, 'attachments'), drives: list(fields, keys, 'drives'), variants: list(fields, keys, 'variants') };

    const settings = {}, notApplied = [];
    const numberIn = (name, raw, range, label) => {
      const x = Number(raw);
      if (!Number.isFinite(x) || x < range[0] || x > range[1]) { add('error', name, label + ' must be a number from ' + range[0] + ' to ' + range[1] + ' (it is "' + raw + '").'); return null; }
      return x;
    };
    for (const [key, range] of Object.entries({ ...APPLIED_SETTINGS, ...RECORDED_SETTINGS })) {
      const name = 'settings_' + key, raw = v(name);
      if (!raw) continue;
      if (range === 'pair') {
        const m = /^\s*(\d*\.?\d+)\s*(?:to|-|,|;)\s*(\d*\.?\d+)\s*$/.exec(raw);
        if (!m || Number(m[1]) >= Number(m[2])) { add('error', name, 'Give two numbers, the smaller first (for example 0.6 to 1.6); it is "' + raw + '".'); continue; }
        settings[key] = [Number(m[1]), Number(m[2])];
      } else {
        const x = numberIn(name, raw, range, key);
        if (x === null) continue;
        settings[key] = x;
      }
      if (own(RECORDED_SETTINGS, key)) notApplied.push(key);
    }
    if (own(settings, 'minScale') && own(settings, 'maxScale') && settings.minScale >= settings.maxScale) add('error', 'settings_minScale', 'The smallest scale must be less than the largest.');
    const precheck = {};
    for (const [key, range] of Object.entries(PRECHECK)) {
      const raw = v('precheck_' + key); if (!raw) continue;
      const x = numberIn('precheck_' + key, raw, range, key);
      if (x !== null) { precheck[key] = x; notApplied.push('precheck_' + key); }
    }
    if (lists.operators.length) notApplied.push('operators');
    const recorded = {}, recordedNames = [];
    for (const [group, prefix] of Object.entries(RECORDED_TEXT)) {
      recorded[group] = {};
      for (const k of keys) if (k.startsWith(prefix) && v(k) && !(group === 'tag' && k === 'tag_materials')) { recorded[group][k.slice(prefix.length)] = v(k); recordedNames.push(k); }
    }
    const changelog = rowIds(keys, /^changelog_(\d+)_/).map(n => ({ rev: v('changelog_' + n + '_rev'), date: v('changelog_' + n + '_date'), what: v('changelog_' + n + '_what'),
      why: v('changelog_' + n + '_why'), by: v('changelog_' + n + '_by') })).filter(r => r.what || r.rev);
    const signoff = {};
    for (const role of ['prepared', 'checked', 'approved']) signoff[role] = { by: v('signoff_' + role + '_by'), date: v('signoff_' + role + '_date') };

    const pack = { format: 1, identity, pac, fc, fcDescriptions, fcMode, materials, lists, families, exceptions, legend, settings, precheck, recorded, signoff, changelog };
    const counts = { functionCodes: new Set([...Object.keys(fc), ...Object.keys(fcDescriptions)]).size, processAreas: Object.keys(pac).length, legendSheets: legend.length, settings: Object.keys(settings).length,
      lists: Object.values(lists).reduce((m, a) => m + a.length, 0), recordedFields: recordedNames.length };
    return { ok: !problems.some(p => p.level === 'error'), pack, problems, counts, notApplied, recorded: recordedNames };
  } catch {
    add('error', '', 'The file could not be read as a Standard Pack.');
    return empty;
  }
}

/**
 * What the tool uses from a pack: { lookups: { fc, fcDescriptions, pac }, materials: [..]|null, check: options for the check }.
 * `defaults` ({ attachments, drives, variants }) are the check's own lists: yours are added to them, and a list you left blank is not passed.
 */
export function packOptions(pack, defaults) {
  try {
    const p = isObj(pack) ? pack : {}, d = isObj(defaults) ? defaults : {};
    const check = {};
    for (const key of Object.keys(APPLIED_SETTINGS)) if (own(p.settings, key)) check[key] = p.settings[key];
    for (const key of ['attachments', 'drives', 'variants']) {
      const yours = isObj(p.lists) && Array.isArray(p.lists[key]) ? p.lists[key] : [];
      if (yours.length) check[key] = [...new Set([...(Array.isArray(d[key]) ? d[key] : []), ...yours])];
    }
    return { lookups: { fc: { ...(isObj(p.fc) ? p.fc : {}) }, fcDescriptions: { ...(isObj(p.fcDescriptions) ? p.fcDescriptions : {}) }, pac: { ...(isObj(p.pac) ? p.pac : {}) } },
      materials: Array.isArray(p.materials) ? p.materials.slice() : null, check };
  } catch {
    return { lookups: { fc: {}, fcDescriptions: {}, pac: {} }, materials: null, check: {} };
  }
}

const canon = x => (Array.isArray(x) ? x.map(canon) : isObj(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canon(x[k])])) : x);
/** A short code (12 hex digits of a SHA-256) worked out from what the pack says: its identity, tables, settings and lists, not its sign-off or change log. */
export async function fingerprint(pack) {
  try {
    const { signoff, changelog, ...content } = isObj(pack) ? pack : {};
    const bytes = new TextEncoder().encode(JSON.stringify(canon(content)));
    const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
  } catch {
    return '';
  }
}

/** The stamp a drawing and a report carry: { line, packId, packRevision, standard, legend, fingerprint }. */
export function packStamp(pack, fingerprintCode) {
  try {
    const id = isObj(pack) && isObj(pack.identity) ? pack.identity : {}, std = isObj(id.standard) ? id.standard : {};
    const legend = Array.isArray(pack && pack.legend) ? pack.legend : [];
    const std1 = [std.number && std.revision ? std.number + ' rev ' + std.revision : std.number || '', std.date || ''].filter(Boolean).join(', ');
    const legendText = legend.length ? legend.map(l => l.sheet + (l.rev ? ' rev ' + l.rev : '')).join('; ') : 'not recorded';
    const fp = typeof fingerprintCode === 'string' ? fingerprintCode : '';
    const line = 'Checked against: ' + [id.name, id.revision].filter(Boolean).join(' ') + (std1 ? ' (' + std1 + ')' : '') + '  |  Legend: ' + legendText + (fp ? '  |  Pack fingerprint ' + fp : '');
    return { line, packId: id.id || '', packRevision: id.revision || '', standard: { number: std.number || '', revision: std.revision || '', date: std.date || '' }, legend: legend.map(l => ({ ...l })), fingerprint: fp };
  } catch {
    return { line: '', packId: '', packRevision: '', standard: {}, legend: [], fingerprint: '' };
  }
}

/** Comma-separated text as rows of cells: quoted commas, quoted line breaks, doubled quotes, CRLF and a byte order mark are all handled. */
export function parseCsv(text) {
  try {
    const s = typeof text === 'string' ? text.replace(/^﻿/, '') : '';
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
      if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(x => x !== '')) rows.push(row); row = []; }
      else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); if (row.some(x => x !== '')) rows.push(row); }
    return rows;
  } catch {
    return [];
  }
}

/** Process-area and function-code bulk files merged into a pack by their header names. Returns { pack, problems }. */
export function mergeBulk(pack, files) {
  const problems = [];
  const add = (level, field, message) => problems.push({ level, field, message });
  try {
    const out = { ...(isObj(pack) ? pack : {}), pac: { ...(pack && pack.pac) }, fc: { ...(pack && pack.fc) }, fcDescriptions: { ...(pack && pack.fcDescriptions) }, fcMode: { ...(pack && pack.fcMode) } };
    const f = isObj(files) ? files : {};
    const table = (csv, need, label) => {
      const rows = parseCsv(csv); if (!rows.length) return [];
      const head = rows[0].map(h => h.trim().toLowerCase());
      if (!need.every(n => head.includes(n))) { add('error', label, label + ' needs a header row with ' + need.join(', ') + '.'); return []; }
      return rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
    };
    for (const r of table(f.pacCsv, ['code', 'description'], 'Process-area file')) { if (r.code) out.pac[r.code] = r.description; }
    for (const r of table(f.fcCsv, ['code', 'description', 'category'], 'Function-code file')) {
      const code = (r.code || '').toUpperCase(); if (!code) continue;
      let c = (r.category || '').toLowerCase();
      if (c && !CATEGORIES.includes(c)) { add('warning', code, 'Category "' + r.category + '" for ' + code + ' is not one of ' + CATEGORIES.join(', ') + '; read as other.'); c = 'other'; }
      out.fc[code] = c || 'other';
      if (r.description) out.fcDescriptions[code] = r.description;
      const m = (r.check || '').toLowerCase();
      if (m === 'skip' && !r.note) add('error', code, 'Function code ' + code + ' is skipped (check = skip): give the reason in the note.');
      if (m === 'check' || m === 'skip') out.fcMode[code] = { mode: m, note: r.note || '' };
    }
    return { pack: out, problems };
  } catch {
    return { pack: isObj(pack) ? pack : null, problems: [{ level: 'error', field: '', message: 'The bulk files could not be read.' }] };
  }
}

/** The form fields out of pdf.js annotations (one list per page): { fieldName: text }; a list value is its first entry, an empty one is dropped. */
export function fieldsFromAnnotations(pages) {
  const out = {};
  try {
    for (const annots of Array.isArray(pages) ? pages : []) {
      for (const a of Array.isArray(annots) ? annots : []) {
        if (!isObj(a) || typeof a.fieldName !== 'string' || !a.fieldName) continue;
        let v = a.fieldValue;
        if (Array.isArray(v)) v = v.length ? v[0] : '';
        if (typeof v === 'string' && v !== '') out[a.fieldName] = v;
      }
    }
  } catch { /* what was read stands */ }
  return out;
}
