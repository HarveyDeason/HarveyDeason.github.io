// Standard Pack import: a filled-in pack (the fields of the template PDF) read into the tables, settings and stamp the checks use.
// Invented values only: a pack holds a company's standard, and none of that is in this repository.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../assets/js/pid-standard-pack.js';

const BASE = { pack_name: 'Northfield Water P&ID Pack', pack_id: 'NFW-PID', pack_revision: '2', pack_issuer: 'Northfield Water',
  pack_standard_title: 'Asset Identification Requirements', pack_standard_number: 'NFW-STD-014', pack_standard_revision: '4', pack_standard_date: '12/03/2021',
  pack_standard_status: ['In effect'] };
const with_ = extra => ({ ...BASE, ...extra });

test('a pack with its identity filled in is ok, and the identity is read', () => {
  const r = P.packFromFields(BASE);
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.equal(r.pack.identity.name, 'Northfield Water P&ID Pack');
  assert.equal(r.pack.identity.revision, '2');
  assert.equal(r.pack.identity.standard.number, 'NFW-STD-014');
  assert.equal(r.pack.identity.standard.status, 'In effect');   // a dropdown arrives as a list
});

test('a pack with no name, revision or issue date cannot be imported, and says which', () => {
  const r = P.packFromFields({ pack_standard_number: 'X' });
  assert.equal(r.ok, false);
  assert.deepEqual(r.problems.filter(p => p.level === 'error').map(p => p.field).sort(), ['pack_name', 'pack_revision', 'pack_standard_date']);
});

test('function codes: code uppercased, category and description kept, a dropdown list read, blanks skipped', () => {
  const r = P.packFromFields(with_({ fc_001_code: 'zz', fc_001_desc: 'Zone Gate Actuator, Type 2', fc_001_cat: ['valve'], fc_002_code: 'QQ', fc_002_cat: [], fc_003_code: '', fc_003_desc: 'orphan' }));
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.deepEqual(r.pack.fc, { ZZ: 'valve', QQ: 'other' });
  assert.deepEqual(r.pack.fcDescriptions, { ZZ: 'Zone Gate Actuator, Type 2' });
  assert.equal(r.counts.functionCodes, 2);
  assert.ok(r.problems.some(p => p.level === 'warning' && p.field === 'fc_003_desc'), 'a description with no code is a warning');
});

test('a repeated function code is an error; an unknown category is a warning and read as other', () => {
  const dup = P.packFromFields(with_({ fc_001_code: 'ZZ', fc_002_code: 'zz' }));
  assert.equal(dup.ok, false);
  assert.ok(dup.problems.some(p => p.level === 'error' && /more than once/.test(p.message)));
  const cat = P.packFromFields(with_({ fc_001_code: 'ZZ', fc_001_cat: ['gadget'] }));
  assert.equal(cat.ok, true);
  assert.equal(cat.pack.fc.ZZ, 'other');
  assert.ok(cat.problems.some(p => p.level === 'warning' && p.field === 'fc_001_cat'));
});

test('process areas, pipe material codes and a skipped family with and without its reason', () => {
  const r = P.packFromFields(with_({ pac_001_code: '21', pac_001_desc: 'Inlet Works', tag_materials: 'fw, ss ,PE', family_1_code: 'ZZ', family_1_mode: ['skip'], family_1_why: 'drawn to suit' }));
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.deepEqual(r.pack.pac, { 21: 'Inlet Works' });
  assert.deepEqual(r.pack.materials, ['FW', 'SS', 'PE']);
  assert.deepEqual(r.pack.families, { ZZ: { mode: 'skip', why: 'drawn to suit' } });
  const bad = P.packFromFields(with_({ family_1_code: 'ZZ', family_1_mode: ['skip'] }));
  assert.equal(bad.ok, false);
  assert.ok(bad.problems.some(p => p.field === 'family_1_why' && p.level === 'error'));
});

test('settings: numbers in range are read; a bad one is an error; blanks keep the default; the rest are recorded as not yet applied', () => {
  const r = P.packFromFields(with_({ settings_recognise: '0.88', settings_radius: '70', settings_shapeExplained: '', settings_heavyPipe: '3', settings_judgeBand: '0.5 to 1.7' }));
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.deepEqual(r.pack.settings, { recognise: 0.88, radius: 70, heavyPipe: 3, judgeBand: [0.5, 1.7] });
  assert.deepEqual(r.notApplied.sort(), ['heavyPipe', 'judgeBand']);
  const bad = P.packFromFields(with_({ settings_recognise: '9', settings_radius: 'wide' }));
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.problems.filter(p => p.level === 'error').map(p => p.field).sort(), ['settings_radius', 'settings_recognise']);
});

test('legend sheets, operators, attachments, drives and variants are read; blank lists mean the default', () => {
  const r = P.packFromFields(with_({ legend_1_sheet: '1', legend_1_rev: 'C02', legend_2_sheet: '', operators_1: 'VALVE ACTUATORS', attachments_1: 'MY FITTING', attachments_2: 'my fitting', drives_1: '', variants_1: 'TWIN PUMP' }));
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.deepEqual(r.pack.legend, [{ sheet: '1', rev: 'C02', date: '', ref: '' }]);
  assert.deepEqual(r.pack.lists, { operators: ['VALVE ACTUATORS'], attachments: ['MY FITTING'], drives: [], variants: ['TWIN PUMP'] });
});

test('packOptions: the tables the tag reader takes, the settings the check takes, and your lists added to the defaults', () => {
  const r = P.packFromFields(with_({ fc_001_code: 'ZZ', fc_001_desc: 'Gate', fc_001_cat: ['valve'], pac_001_code: '21', pac_001_desc: 'Inlet', settings_recognise: '0.88', settings_heavyPipe: '3', attachments_1: 'MY FITTING', tag_materials: 'FW' }));
  const o = P.packOptions(r.pack, { attachments: ['A', 'B'], drives: ['D'], variants: ['V'] });
  assert.deepEqual(o.lookups, { fc: { ZZ: 'valve' }, fcDescriptions: { ZZ: 'Gate' }, pac: { 21: 'Inlet' } });
  assert.deepEqual(o.materials, ['FW']);
  assert.equal(o.check.recognise, 0.88);
  assert.equal('heavyPipe' in o.check, false, 'a setting the check does not read yet is not passed');
  assert.deepEqual(o.check.attachments, ['A', 'B', 'MY FITTING']);
  assert.equal('drives' in o.check, false, 'no list of yours: the default stands');
});

test('fingerprint: the same pack twice agrees; a table or setting changes it; the change log and sign-off do not', async () => {
  const a = P.packFromFields(with_({ fc_001_code: 'ZZ', fc_001_cat: ['valve'], settings_recognise: '0.88' })).pack;
  const same = P.packFromFields(with_({ settings_recognise: '0.88', fc_001_cat: ['valve'], fc_001_code: 'ZZ' })).pack;
  const changed = P.packFromFields(with_({ fc_001_code: 'ZZ', fc_001_cat: ['equipment'], settings_recognise: '0.88' })).pack;
  const logged = P.packFromFields(with_({ fc_001_code: 'ZZ', fc_001_cat: ['valve'], settings_recognise: '0.88', changelog_1_what: 'x', signoff_approved_by: 'A N Other' })).pack;
  const f = await P.fingerprint(a);
  assert.match(f, /^[0-9a-f]{12}$/);
  assert.equal(await P.fingerprint(same), f);
  assert.notEqual(await P.fingerprint(changed), f);
  assert.equal(await P.fingerprint(logged), f);
});

test('the stamp line names the pack, the standard, the legend and the fingerprint', () => {
  const pack = P.packFromFields(with_({ legend_1_sheet: '1', legend_1_rev: 'C02', legend_2_sheet: '2', legend_2_rev: 'C01' })).pack;
  const s = P.packStamp(pack, 'abc123def456');
  assert.equal(s.line, 'Checked against: Northfield Water P&ID Pack 2 (NFW-STD-014 rev 4, 12/03/2021)  |  Legend: 1 rev C02; 2 rev C01  |  Pack fingerprint abc123def456');
  assert.deepEqual([s.packId, s.packRevision, s.fingerprint], ['NFW-PID', '2', 'abc123def456']);
  assert.equal(P.packStamp(P.packFromFields(BASE).pack, 'f').line.includes('Legend:'), true);
  assert.match(P.packStamp(P.packFromFields(BASE).pack, 'f').line, /Legend: not recorded/);
});

test('parseCsv reads quoted commas, quoted line breaks, doubled quotes, CRLF and a byte order mark', () => {
  const rows = P.parseCsv('﻿code,description,category\r\nSC,"Side Channel, Rotary Vane",equipment\r\nQQ,"two\nlines",other\r\nXX,"say ""hi""",valve\r\n');
  assert.deepEqual(rows, [['code', 'description', 'category'], ['SC', 'Side Channel, Rotary Vane', 'equipment'], ['QQ', 'two\nlines', 'other'], ['XX', 'say "hi"', 'valve']]);
  assert.deepEqual(P.parseCsv(''), []);
});

test('bulk files: process areas and function codes are merged into the pack by their header names', () => {
  const base = P.packFromFields(with_({ fc_001_code: 'ZZ', fc_001_cat: ['valve'] })).pack;
  const r = P.mergeBulk(base, { pacCsv: 'code,description,note\n21,Inlet Works,\n22,"Screens, Grit",x\n', fcCsv: 'code,description,category,check,note\nsc,"Side Channel, Rotary Vane",equipment,auto,\nZZ,Gate,valve,skip,\n' });
  assert.deepEqual(r.pack.pac, { 21: 'Inlet Works', 22: 'Screens, Grit' });
  assert.equal(r.pack.fc.SC, 'equipment');
  assert.equal(r.pack.fcDescriptions.SC, 'Side Channel, Rotary Vane');
  assert.ok(r.problems.some(p => p.level === 'error' && /skip/.test(p.message)), 'skip with no note is an error, as on the form');
  assert.equal(P.mergeBulk(base, { fcCsv: 'name,thing\nx,y\n' }).problems.some(p => p.level === 'error'), true);
});

test('fieldsFromAnnotations: form fields only, a list value as its first entry', () => {
  const f = P.fieldsFromAnnotations([[{ fieldName: 'pack_name', fieldValue: 'N' }, { subtype: 'Link', url: 'x' }, { fieldName: 'fc_001_cat', fieldValue: ['valve'] }, { fieldName: 'fc_002_cat', fieldValue: [] }], [{ fieldName: 'pack_id', fieldValue: 'ID' }]]);
  assert.deepEqual(f, { pack_name: 'N', fc_001_cat: 'valve', pack_id: 'ID' });
});

test('hostile input never throws', () => {
  for (const bad of [null, undefined, 7, 'x', [], [1, 2], { fc_001_code: { toString() { throw new Error('no'); } } }, { settings_recognise: {} }, Object.create(null)]) {
    assert.doesNotThrow(() => P.packFromFields(bad));
    assert.equal(P.packFromFields(bad).ok, false);
  }
  assert.doesNotThrow(() => P.packOptions(null)); assert.doesNotThrow(() => P.packStamp(null, '')); assert.doesNotThrow(() => P.fieldsFromAnnotations('x')); assert.doesNotThrow(() => P.parseCsv(null));
});

test('a code with a description but no category stays out of the category table: a pack made from a lookup gives that lookup back exactly', () => {
  const FC = { ZZ: 'valve', QQ: 'instrument', XX: 'other' };
  const FD = { ZZ: 'Zone Gate', QQ: 'Quality Meter', DD: 'Description Only', XX: 'Odd One' };
  const PAC = { 21: 'Inlet Works', 7: 'Sludge' };
  const fields = { ...BASE, tag_materials: 'FW, PE' };
  [...new Set([...Object.keys(FC), ...Object.keys(FD)])].sort().forEach((c, k) => {
    const p = String(k + 1).padStart(3, '0');
    fields['fc_' + p + '_code'] = c; if (FD[c]) fields['fc_' + p + '_desc'] = FD[c]; fields['fc_' + p + '_cat'] = [c in FC ? FC[c] : 'none'];
  });
  Object.keys(PAC).forEach((c, k) => { const p = String(k + 1).padStart(3, '0'); fields['pac_' + p + '_code'] = c; fields['pac_' + p + '_desc'] = PAC[c]; });
  const r = P.packFromFields(fields);
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  const o = P.packOptions(r.pack, {});
  assert.deepEqual(o.lookups, { fc: FC, fcDescriptions: FD, pac: PAC });
  assert.equal('DD' in o.lookups.fc, false);
  assert.equal(r.counts.functionCodes, 4);
});

test('an operators list is recorded but not applied yet, and the import says so', () => {
  const r = P.packFromFields(with_({ operators_1: 'VALVE ACTUATORS' }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.notApplied, ['operators']);
  assert.deepEqual(P.packFromFields(BASE).notApplied, []);
  assert.equal('operators' in P.packOptions(r.pack, {}).check, false);
});
