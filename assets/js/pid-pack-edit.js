// assets/js/pid-pack-edit.js
// Editing a Standard Pack. Pure: no DOM, no files, no data.
//
//   fieldsFromPack  a pack as the fields of the form: the exact inverse of packFromFields (pid-standard-pack.js), so what the editor holds, what the
//                   PDF template holds and what the reader accepts are one thing. Used to validate an edit and to write a pack back out as a filled PDF.
//   diffPacks       what changed between two packs, and diffText: the same in words, for the change log
//   nextRevision    the revision after this one, in whatever style it is written
//   issueRevision   an edited pack becomes the next revision with its change-log line; the pack it came from is untouched

import { packFromFields, APPLIED_SETTINGS, RECORDED_SETTINGS } from './pid-standard-pack.js';

const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const str = x => (typeof x === 'string' ? x : x == null ? '' : String(x));
const NAT = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const sorted = a => [...a].sort((x, y) => NAT.compare(x, y));
const clone = x => JSON.parse(JSON.stringify(x));

/** The pack as form fields (name -> text). Blank values are left out. Row numbers are in a steady order. */
export function fieldsFromPack(pack) {
  const f = {};
  try {
    const p = isObj(pack) ? pack : {};
    const put = (k, v) => { const t = str(v).trim(); if (t) f[k] = t; };
    const idn = isObj(p.identity) ? p.identity : {}, std = isObj(idn.standard) ? idn.standard : {};
    put('pack_name', idn.name); put('pack_id', idn.id); put('pack_revision', idn.revision); put('pack_issuer', idn.issuer);
    put('pack_standard_title', std.title); put('pack_standard_number', std.number); put('pack_standard_revision', std.revision); put('pack_standard_date', std.date);
    put('pack_standard_custodian', std.custodian); put('pack_standard_status', std.status);
    put('pack_supersedes', idn.supersedes); put('pack_applies', idn.applies); put('pack_owner', idn.owner); put('pack_notes', idn.notes);
    const row = n => String(n + 1).padStart(3, '0');
    const pac = isObj(p.pac) ? p.pac : {};
    sorted(Object.keys(pac)).forEach((c, k) => { put('pac_' + row(k) + '_code', c); put('pac_' + row(k) + '_desc', pac[c]); });
    const fc = isObj(p.fc) ? p.fc : {}, fd = isObj(p.fcDescriptions) ? p.fcDescriptions : {}, fm = isObj(p.fcMode) ? p.fcMode : {};
    sorted([...new Set([...Object.keys(fc), ...Object.keys(fd), ...Object.keys(fm)])]).forEach((c, k) => {
      const r = row(k), m = isObj(fm[c]) ? fm[c] : null;
      put('fc_' + r + '_code', c); put('fc_' + r + '_desc', fd[c]); put('fc_' + r + '_cat', Object.prototype.hasOwnProperty.call(fc, c) ? fc[c] : 'none');
      if (m) { put('fc_' + r + '_mode', m.mode); put('fc_' + r + '_note', m.note); }
    });
    if (Array.isArray(p.materials) && p.materials.length) put('tag_materials', p.materials.join(', '));
    (Array.isArray(p.legend) ? p.legend : []).filter(isObj).forEach((l, k) => { const n = String(k + 1); put('legend_' + n + '_sheet', l.sheet); put('legend_' + n + '_rev', l.rev); put('legend_' + n + '_date', l.date); put('legend_' + n + '_ref', l.ref); });
    const lists = isObj(p.lists) ? p.lists : {};
    for (const name of ['operators', 'attachments', 'drives', 'variants']) (Array.isArray(lists[name]) ? lists[name] : []).forEach((v, k) => put(name + '_' + (k + 1), v));
    const st = isObj(p.settings) ? p.settings : {};
    for (const key of [...Object.keys(APPLIED_SETTINGS), ...Object.keys(RECORDED_SETTINGS)]) {
      if (!Object.prototype.hasOwnProperty.call(st, key)) continue;
      put('settings_' + key, Array.isArray(st[key]) ? st[key].join(' to ') : st[key]);
    }
    const pre = isObj(p.precheck) ? p.precheck : {};
    for (const k of Object.keys(pre)) put('precheck_' + k, pre[k]);
    const fam = isObj(p.families) ? p.families : {};
    Object.keys(fam).sort().forEach((c, k) => { const n = String(k + 1), v = isObj(fam[c]) ? fam[c] : {}; put('family_' + n + '_code', c); put('family_' + n + '_mode', v.mode); put('family_' + n + '_why', v.why); });
    (Array.isArray(p.exceptions) ? p.exceptions : []).filter(isObj).forEach((e, k) => { const n = String(k + 1); put('exception_' + n + '_name', e.name); put('exception_' + n + '_status', e.status); put('exception_' + n + '_note', e.note); put('exception_' + n + '_ref', e.ref); });
    const rec = isObj(p.recorded) ? p.recorded : {};
    for (const [group, prefix] of [['drawingno', 'drawingno_'], ['revision', 'revision_'], ['tag', 'tag_'], ['frame', 'frame_']]) { const g = isObj(rec[group]) ? rec[group] : {}; for (const k of Object.keys(g)) put(prefix + k, g[k]); }
    const so = isObj(p.signoff) ? p.signoff : {};
    for (const role of ['prepared', 'checked', 'approved']) { const r = isObj(so[role]) ? so[role] : {}; put('signoff_' + role + '_by', r.by); put('signoff_' + role + '_date', r.date); }
    (Array.isArray(p.changelog) ? p.changelog : []).filter(isObj).forEach((c, k) => { const n = String(k + 1); put('changelog_' + n + '_rev', c.rev); put('changelog_' + n + '_date', c.date); put('changelog_' + n + '_what', c.what); put('changelog_' + n + '_why', c.why); put('changelog_' + n + '_by', c.by); });
  } catch { /* what was written stands */ }
  return f;
}

// ── what changed ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
function codeTable(p) {
  const fc = isObj(p.fc) ? p.fc : {}, fd = isObj(p.fcDescriptions) ? p.fcDescriptions : {}, fm = isObj(p.fcMode) ? p.fcMode : {};
  const out = {};
  for (const c of new Set([...Object.keys(fc), ...Object.keys(fd), ...Object.keys(fm)])) out[c] = { cat: Object.prototype.hasOwnProperty.call(fc, c) ? fc[c] : null, desc: fd[c] || '', mode: fm[c] || null };
  return out;
}
function tableDiff(a, b) {
  const ka = Object.keys(a), kb = Object.keys(b);
  return { added: sorted(kb.filter(k => !(k in a))), removed: sorted(ka.filter(k => !(k in b))), changed: sorted(ka.filter(k => k in b && !same(a[k], b[k]))) };
}
const IDENTITY_FIELDS = [['name', 'pack name'], ['id', 'pack id'], ['issuer', 'issuer'], ['owner', 'owner'], ['notes', 'notes'], ['supersedes', 'supersedes'], ['applies', 'applies to'], ['revision', 'revision'],
  ['standard.title', 'standard title'], ['standard.number', 'standard number'], ['standard.revision', 'standard revision'], ['standard.date', 'standard date'], ['standard.custodian', 'standard custodian'], ['standard.status', 'standard status']];
const at = (o, path) => path.split('.').reduce((x, k) => (isObj(x) ? x[k] : undefined), o);

/** { changed, fc: {added, removed, changed}, pac: {...}, settings: [names], materials, lists: [names], identity: [labels], legend, other: [names] }. Sign-off and change log are not content. */
export function diffPacks(a, b) {
  const A = isObj(a) ? a : {}, B = isObj(b) ? b : {};
  const out = { changed: false, fc: tableDiff(codeTable(A), codeTable(B)), pac: tableDiff(isObj(A.pac) ? A.pac : {}, isObj(B.pac) ? B.pac : {}), settings: [], materials: false, lists: [], identity: [], legend: false, other: [] };
  try {
    const sa = isObj(A.settings) ? A.settings : {}, sb = isObj(B.settings) ? B.settings : {};
    out.settings = sorted([...new Set([...Object.keys(sa), ...Object.keys(sb)])].filter(k => !same(sa[k], sb[k])));
    out.materials = !same(A.materials, B.materials);
    const la = isObj(A.lists) ? A.lists : {}, lb = isObj(B.lists) ? B.lists : {};
    out.lists = ['operators', 'attachments', 'drives', 'variants'].filter(k => !same(la[k], lb[k]));
    out.identity = IDENTITY_FIELDS.filter(([path]) => !same(at(A.identity, path), at(B.identity, path))).map(x => x[1]);
    out.legend = !same(A.legend, B.legend);
    out.other = ['families', 'exceptions', 'precheck', 'recorded'].filter(k => !same(A[k], B[k]));
    out.changed = ['fc', 'pac'].some(k => out[k].added.length || out[k].removed.length || out[k].changed.length) || out.settings.length > 0 || out.materials || out.lists.length > 0 || out.identity.length > 0 || out.legend || out.other.length > 0;
  } catch { /* what was compared stands */ }
  return out;
}
const some = (list, n = 5) => (list.length > n ? list.slice(0, n).join(', ') + ' and ' + (list.length - n) + ' more' : list.join(', '));
function tableText(label, d) {
  const parts = [['added', d.added], ['removed', d.removed], ['changed', d.changed]].filter(([, l]) => l.length).map(([w, l]) => l.length + ' ' + w + ' (' + some(l) + ')');
  return parts.length ? label + ': ' + parts.join(', ') : '';
}
/** The difference in words, for the change log. */
export function diffText(d) {
  if (!isObj(d) || d.changed !== true) return 'No change.';
  return [tableText('function codes', d.fc), tableText('process areas', d.pac), d.settings.length ? 'settings: ' + d.settings.join(', ') : '', d.materials ? 'pipe materials' : '',
    d.lists.length ? 'lists: ' + d.lists.join(', ') : '', d.legend ? 'legend sheets' : '', d.identity.length ? 'identity: ' + d.identity.join(', ') : '', d.other.length ? 'other: ' + d.other.join(', ') : ''].filter(Boolean).join('. ') + '.';
}

// ── the next revision ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** The revision after this one: 2 -> 3, C02 -> C03, 3b -> 3c, A -> B, 1.4 -> 1.5. Z, or a style it cannot count on, gains .1. */
export function nextRevision(rev) {
  const r = str(rev).trim();
  if (!r) return '1';
  if (/^\d+$/.test(r)) return String(Number(r) + 1).padStart(r.length, '0');
  let m = /^(\d+)([a-y])$/i.exec(r);
  if (m) return m[1] + String.fromCharCode(m[2].charCodeAt(0) + 1);
  m = /^([a-y])$/i.exec(r);
  if (m) return String.fromCharCode(r.charCodeAt(0) + 1);
  m = /^(.*?)(\d+)$/.exec(r);
  if (m && !/^[zZ]$/.test(r)) return m[1] + String(Number(m[2]) + 1).padStart(m[2].length, '0');
  return r + '.1';
}

/** { ok, pack } or { ok: false, problem }: the edited pack as the next revision, with its change-log line. The pack it came from is not changed. */
export function issueRevision(original, edited, o) {
  try {
    const x = isObj(o) ? o : {};
    const diff = diffPacks(original, edited);
    if (!diff.changed) return { ok: false, problem: 'There is nothing to issue: the pack is unchanged.' };
    if (!str(x.why).trim()) return { ok: false, problem: 'Give a reason for the change: it goes in the change log.' };
    const next = clone(edited);
    if (!isObj(next.identity)) next.identity = {};
    const was = str(isObj(original) && isObj(original.identity) ? original.identity.revision : ''), chosen = str(next.identity.revision);
    next.identity.revision = chosen && chosen !== was ? chosen : nextRevision(was);   // a revision the person typed is kept
    if (!Array.isArray(next.changelog)) next.changelog = [];
    next.changelog.push({ rev: next.identity.revision, date: str(x.date), what: diffText(diff), why: str(x.why).trim(), by: str(x.by).trim() });
    const back = packFromFields(fieldsFromPack(next));
    if (!back.ok) { const e = back.problems.find(p => p.level === 'error'); return { ok: false, problem: 'The pack cannot be imported: ' + (e ? e.message : 'it could not be read') }; }
    return { ok: true, pack: back.pack, diff };
  } catch {
    return { ok: false, problem: 'The pack could not be issued.' };
  }
}
