// Writing a pack out as a filled Standard Pack PDF (assets/js/pid-pack-pdf.js), and reading it back through the same path the tool imports by.
// Invented values only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadVendoredUmd, openPdf } from '../scripts/pdfjs-node.mjs';
import { packFromFields, fieldsFromAnnotations } from '../assets/js/pid-standard-pack.js';
import { buildPackPdf } from '../assets/js/pid-pack-pdf.js';

const PDFLib = loadVendoredUmd('pdf-lib.min.js');
const readBack = async bytes => {
  const pdf = await openPdf(new Uint8Array(bytes));
  const annots = [];
  for (let n = 1; n <= pdf.numPages; n++) annots.push(await (await pdf.getPage(n)).getAnnotations());
  return packFromFields(fieldsFromAnnotations(annots));
};

// A pack the version 2 template can hold: identity, tables, materials, legend, lists, applied settings, sign-off and change log.
const V2 = {
  pack_name: 'Northfield Water P&ID Pack', pack_id: 'NFW-PID', pack_revision: '2', pack_issuer: 'Northfield Water', pack_standard_title: 'Asset Identification Requirements',
  pack_standard_number: 'NFW-STD-014', pack_standard_revision: '4', pack_standard_date: '12/03/2021', pack_standard_status: 'In effect', pack_owner: 'A Tester', pack_notes: 'invented',
  pac_001_code: '21', pac_001_desc: 'Inlet Works', pac_002_code: '7', pac_002_desc: 'Sludge',
  fc_001_code: 'ZZ', fc_001_desc: 'Zone Gate Actuator', fc_001_cat: 'valve', fc_002_code: 'QQ', fc_002_desc: 'Quality Meter', fc_002_cat: 'instrument', fc_002_mode: 'check',
  fc_003_code: 'DD', fc_003_desc: 'Description Only', fc_003_cat: 'none', fc_004_code: 'SK', fc_004_cat: 'equipment', fc_004_mode: 'skip', fc_004_note: 'drawn to suit',
  tag_materials: 'FW, PE', legend_1_sheet: '1', legend_1_rev: 'C02', legend_1_date: '17/09/2026', legend_1_ref: 'legend issue C', legend_2_sheet: '2', legend_2_rev: 'C01',
  attachments_1: 'MY FITTING', attachments_2: 'OTHER MARK', drives_1: 'MY MOTOR', variants_1: 'TWIN PUMP',
  settings_recognise: '0.88', settings_radius: '70', signoff_prepared_by: 'A Tester', signoff_prepared_date: '01/10/2026', signoff_approved_by: 'B Boss',
  changelog_1_rev: '1', changelog_1_date: '01/10/2026', changelog_1_what: 'first', changelog_1_why: 'new', changelog_1_by: 'A Tester',
};
const PACK = packFromFields(V2).pack;

test('with no pack it is the blank template: the same fields as the script made, nothing filled in', async () => {
  const r = await buildPackPdf(PDFLib, {});
  assert.ok(r.bytes instanceof Uint8Array && r.bytes.length > 1000);
  assert.deepEqual([r.pages, r.fields], [14, 875]);
  const back = await readBack(r.bytes);
  assert.equal(back.ok, false, 'an empty template is not an importable pack');
});

test('a pack written out and read back is the same pack', async () => {
  const r = await buildPackPdf(PDFLib, { pack: PACK });
  assert.deepEqual(r.dropped, []);
  const back = await readBack(r.bytes);
  assert.equal(back.ok, true, JSON.stringify(back.problems));
  assert.deepEqual(back.pack, PACK);
});

test('a big pack makes the tables as long as it needs: more function-code, process-area, legend, change-log and list rows', async () => {
  const big = JSON.parse(JSON.stringify(PACK));
  for (let i = 0; i < 150; i++) { const c = 'A' + String.fromCharCode(65 + (i % 26)) + String.fromCharCode(65 + Math.floor(i / 26)); big.fc[c] = i % 2 ? 'valve' : 'equipment'; big.fcDescriptions[c] = 'Code ' + i; }
  for (let i = 30; i < 60; i++) big.pac[String(i)] = 'Area ' + i;
  for (let i = 3; i < 13; i++) big.legend.push({ sheet: String(i), rev: 'C0' + (i % 9), date: '', ref: '' });
  for (let i = 2; i < 16; i++) big.lists.attachments.push('FITTING ' + i);
  for (let i = 2; i < 14; i++) big.changelog.push({ rev: String(i), date: '01/01/2026', what: 'change ' + i, why: 'because', by: 'A Tester' });
  const r = await buildPackPdf(PDFLib, { pack: big });
  assert.ok(r.fields > 875, 'more rows than the blank form: ' + r.fields); assert.deepEqual(r.dropped, []);
  const back = await readBack(r.bytes);
  assert.equal(back.ok, true, JSON.stringify(back.problems));
  assert.deepEqual(back.pack, big);
});

test('what an older template held and this one does not is reported as dropped, and everything else still comes back', async () => {
  const old = packFromFields({ ...V2, drawingno_layout: 'seven parts', tag_structure: 'area-code-number', operators_1: 'VALVE ACTUATORS', precheck_scanCover: '0.9', settings_judgeBand: '0.5 to 1.7',
    family_1_code: 'ZZ', family_1_mode: 'skip', family_1_why: 'drawn to suit', exception_1_name: 'ODD VALVE', exception_1_status: 'approved' }).pack;
  const r = await buildPackPdf(PDFLib, { pack: old });
  for (const n of ['drawingno_layout', 'tag_structure', 'operators_1', 'precheck_scanCover', 'settings_judgeBand', 'family_1_code', 'exception_1_name']) assert.ok(r.dropped.includes(n), n);
  const back = await readBack(r.bytes);
  assert.equal(back.ok, true);
  assert.deepEqual(back.pack.fc, old.fc); assert.deepEqual(back.pack.pac, old.pac); assert.deepEqual(back.pack.legend, old.legend); assert.deepEqual(back.pack.lists.attachments, old.lists.attachments);
  assert.deepEqual(back.pack.identity, old.identity); assert.deepEqual(back.pack.changelog, old.changelog);
});

test('hostile input: an unusable pack gives the blank template, never a throw', async () => {
  for (const bad of [null, undefined, 7, 'x', [], { identity: 7 }]) { const r = await buildPackPdf(PDFLib, { pack: bad }); assert.ok(r.bytes.length > 1000); }
});
