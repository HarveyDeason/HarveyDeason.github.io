// The Standard Pack template (scripts/make-standard-pack-template.mjs): every fillable field is one the tool reads or stamps, nothing the tool
// ignores is asked for, and a filled template reads back through the same path the tool uses. Invented values only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadVendoredUmd, openPdf } from '../scripts/pdfjs-node.mjs';
import { packFromFields, fieldsFromAnnotations, APPLIED_SETTINGS } from '../assets/js/pid-standard-pack.js';

const SCRIPT = path.resolve(import.meta.dirname, '../scripts/make-standard-pack-template.mjs');
const PDFLib = loadVendoredUmd('pdf-lib.min.js');
let tmp = null, bytes = null, fieldNames = null;

async function made() {
  if (bytes) return bytes;
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'pack-template-'));
  const out = path.join(tmp, 'template.pdf');
  execFileSync(process.execPath, [SCRIPT, out, '--fc-pages', '1', '--pac-rows', '6'], { stdio: 'pipe' });
  bytes = await fs.readFile(out);
  const doc = await PDFLib.PDFDocument.load(bytes);
  fieldNames = doc.getForm().getFields().map(f => f.getName());
  return bytes;
}

// What the tool reads (applies) or stamps. Anything else in the template would be a question the tool never uses.
const SETTINGS = Object.keys(APPLIED_SETTINGS).join('|');
const ALLOWED = new RegExp('^(' + [
  'pack_(name|id|revision|issuer|standard_title|standard_number|standard_revision|standard_date|standard_status|owner|notes)',
  'pac_\\d{3}_(code|desc|note)', 'fc_\\d{3}_(code|desc|cat|mode|note)', 'tag_materials',
  'legend_\\d+_(sheet|rev|date|ref)', '(attachments|drives|variants)_\\d+',
  '(settings_(' + SETTINGS + '))(_why)?',
  'signoff_(prepared|checked|approved)_(by|date)', 'changelog_\\d+_(rev|date|what|why|by)',
].join('|') + ')$');

test('every field in the template is one the tool reads or stamps, with no duplicates', async () => {
  await made();
  const stray = fieldNames.filter(n => !ALLOWED.test(n));
  assert.deepEqual(stray, [], 'fields the tool does not read: ' + stray.slice(0, 8).join(', '));
  assert.equal(new Set(fieldNames).size, fieldNames.length);
});

test('the sections the tool no longer asks about are gone', async () => {
  await made();
  for (const gone of ['drawingno_', 'revision_', 'frame_', 'precheck_', 'operators_', 'family_', 'exception_', 'tag_structure', 'tag_pac', 'legend_layout', 'settings_sizeTol', 'settings_judgeBand', 'settings_heavyPipe', 'settings_driveShare']) {
    assert.equal(fieldNames.some(n => n.startsWith(gone)), false, gone);
  }
});

test('the fields a pack needs are all there: identity, tables, legend, materials, lists, every applied setting', async () => {
  await made();
  const have = new Set(fieldNames);
  for (const n of ['pack_name', 'pack_id', 'pack_revision', 'pack_issuer', 'pack_standard_number', 'pack_standard_revision', 'pack_standard_date', 'pack_standard_status', 'pack_owner',
    'pac_001_code', 'pac_001_desc', 'fc_001_code', 'fc_001_desc', 'fc_001_cat', 'fc_001_mode', 'fc_001_note', 'tag_materials', 'legend_1_sheet', 'legend_1_rev',
    'attachments_1', 'drives_1', 'variants_1', 'signoff_approved_by', 'changelog_1_what']) assert.ok(have.has(n), n);
  for (const k of Object.keys(APPLIED_SETTINGS)) { assert.ok(have.has('settings_' + k), 'settings_' + k); assert.ok(have.has('settings_' + k + '_why'), 'settings_' + k + '_why'); }
});

test('a filled template reads back through the tool\'s own path and is accepted', async () => {
  const src = await made();
  const doc = await PDFLib.PDFDocument.load(src);
  const form = doc.getForm();
  const T = (n, v) => form.getTextField(n).setText(v);
  T('pack_name', 'Northfield Water P&ID Pack'); T('pack_revision', '2'); T('pack_standard_date', '12/03/2021'); T('pack_standard_number', 'NFW-STD-014');
  T('fc_001_code', 'ZZ'); T('fc_001_desc', 'Zone Gate Actuator'); form.getDropdown('fc_001_cat').select('valve'); T('pac_001_code', '21'); T('pac_001_desc', 'Inlet Works');
  T('tag_materials', 'FW, PE'); T('legend_1_sheet', '1'); T('legend_1_rev', 'C02'); T('attachments_1', 'MY FITTING'); T('settings_recognise', '0.88');
  const filled = await doc.save();
  const pdf = await openPdf(new Uint8Array(filled));
  const annots = [];
  for (let n = 1; n <= pdf.numPages; n++) annots.push(await (await pdf.getPage(n)).getAnnotations());
  const r = packFromFields(fieldsFromAnnotations(annots));
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.deepEqual(r.pack.fc, { ZZ: 'valve' });
  assert.deepEqual(r.pack.pac, { 21: 'Inlet Works' });
  assert.deepEqual(r.pack.materials, ['FW', 'PE']);
  assert.equal(r.pack.settings.recognise, 0.88);
  assert.deepEqual(r.pack.legend, [{ sheet: '1', rev: 'C02', date: '', ref: '' }]);
  assert.equal(r.notApplied.length, 0, 'nothing in the template is recorded-but-unused: ' + r.notApplied.join(','));
});

test('the template carries its worked example: a fictional drawing with numbered pointers, on the second page', async () => {
  const src = await made();
  const pdf = await openPdf(new Uint8Array(src));
  const text = async n => (await (await pdf.getPage(n)).getTextContent()).items.map(i => i.str).join(' ');
  const p2 = await text(2);
  assert.match(p2, /example/i);
  for (const k of ['1', '2', '3', '4', '5', '6', '7', '8']) assert.ok(new RegExp('(^|\\s)' + k + '(\\s|$)').test(p2), 'pointer ' + k);
  assert.match(p2, /Northfield|fictional/i);
});

test.after(async () => { if (tmp) await fs.rm(tmp, { recursive: true, force: true }); });
