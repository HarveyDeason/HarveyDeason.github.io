// Editing a pack: a pack as the fields of the form (the exact inverse of the reader), what changed between two packs, and the next revision.
// Invented values only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packFromFields } from '../assets/js/pid-standard-pack.js';
import * as E from '../assets/js/pid-pack-edit.js';

const RICH = {
  pack_name: 'Northfield Water P&ID Pack', pack_id: 'NFW-PID', pack_revision: '2', pack_issuer: 'Northfield Water', pack_standard_title: 'Asset Identification Requirements',
  pack_standard_number: 'NFW-STD-014', pack_standard_revision: '4', pack_standard_date: '12/03/2021', pack_standard_status: 'In effect', pack_owner: 'A Tester', pack_notes: 'invented',
  pac_001_code: '21', pac_001_desc: 'Inlet Works', pac_002_code: '7', pac_002_desc: 'Sludge',
  fc_001_code: 'ZZ', fc_001_desc: 'Zone Gate Actuator', fc_001_cat: 'valve', fc_002_code: 'QQ', fc_002_desc: 'Quality Meter', fc_002_cat: 'instrument', fc_002_mode: 'check',
  fc_003_code: 'DD', fc_003_desc: 'Description Only', fc_003_cat: 'none', fc_004_code: 'SK', fc_004_cat: 'equipment', fc_004_mode: 'skip', fc_004_note: 'drawn to suit',
  tag_materials: 'FW, PE', legend_1_sheet: '1', legend_1_rev: 'C02', legend_1_date: '17/09/2026', legend_1_ref: 'legend issue C', legend_2_sheet: '2', legend_2_rev: 'C01',
  attachments_1: 'MY FITTING', attachments_2: 'OTHER MARK', drives_1: 'MY MOTOR', variants_1: 'TWIN PUMP',
  settings_recognise: '0.88', settings_radius: '70', settings_judgeBand: '0.5 to 1.7', settings_heavyPipe: '3',
  signoff_prepared_by: 'A Tester', signoff_prepared_date: '01/10/2026', signoff_approved_by: 'B Boss',
  changelog_1_rev: '1', changelog_1_date: '01/10/2026', changelog_1_what: 'first', changelog_1_why: 'new', changelog_1_by: 'A Tester',
  // a pack filled in on the first template also carries recorded text and families
  drawingno_layout: 'seven parts', tag_structure: 'area-code-number', frame_side: 'long rule', precheck_scanCover: '0.9', operators_1: 'VALVE ACTUATORS',
  family_1_code: 'ZZ', family_1_mode: 'skip', family_1_why: 'drawn to suit', exception_1_name: 'ODD VALVE', exception_1_status: 'approved', exception_1_note: 'ok', exception_1_ref: 'REF 1',
};
const PACK = packFromFields(RICH).pack;

test('fieldsFromPack is the exact inverse of the reader: a pack goes to fields and comes back the same', () => {
  const back = packFromFields(E.fieldsFromPack(PACK));
  assert.equal(back.ok, true, JSON.stringify(back.problems));
  assert.deepEqual(back.pack, PACK);
});

test('fieldsFromPack: a function code with a description and no category is written as none; rows are in a steady order; blanks are not written', () => {
  const f = E.fieldsFromPack(PACK);
  const row = code => Object.keys(f).filter(k => /^fc_\d+_code$/.test(k)).find(k => f[k] === code);
  const n = row('DD').match(/fc_(\d+)_/)[1];
  assert.equal(f['fc_' + n + '_cat'], 'none');
  assert.deepEqual(Object.keys(f).filter(k => /^fc_\d+_code$/.test(k)).map(k => f[k]), ['DD', 'QQ', 'SK', 'ZZ']);
  assert.deepEqual(Object.keys(f).filter(k => /^pac_\d+_code$/.test(k)).map(k => f[k]), ['7', '21']);
  assert.ok(Object.values(f).every(v => typeof v === 'string' && v !== ''), 'every value is text and non-empty');
  assert.equal(f.settings_judgeBand, '0.5 to 1.7');
  assert.deepEqual(E.fieldsFromPack(PACK), f, 'the same pack gives the same fields every time');
});

test('fieldsFromPack: hostile input gives an empty map and never throws', () => {
  for (const bad of [null, undefined, 7, 'x', [], {}, { identity: 7 }, { fc: { A: 'valve' }, fcDescriptions: 'x' }]) { assert.doesNotThrow(() => E.fieldsFromPack(bad)); assert.equal(typeof E.fieldsFromPack(bad), 'object'); }
});

test('diffPacks: what a person changed, in words, for the change log', () => {
  const b = JSON.parse(JSON.stringify(PACK));
  b.fc.ZZ = 'equipment'; b.fc.NEW = 'valve'; b.fcDescriptions.NEW = 'A New Thing'; delete b.fc.QQ; delete b.fcDescriptions.QQ; delete b.fcMode.QQ;
  b.pac['22'] = 'Screens'; b.settings.recognise = 0.9; delete b.settings.radius; b.materials = ['FW']; b.lists.attachments = ['MY FITTING'];
  b.identity.standard.revision = '5'; b.legend[0].rev = 'C03';
  const d = E.diffPacks(PACK, b);
  assert.equal(d.changed, true);
  assert.deepEqual(d.fc, { added: ['NEW'], removed: ['QQ'], changed: ['ZZ'] });
  assert.deepEqual(d.pac, { added: ['22'], removed: [], changed: [] });
  assert.deepEqual(d.settings.sort(), ['radius', 'recognise']);
  assert.ok(d.materials && d.lists.includes('attachments') && d.identity.includes('standard revision') && d.legend);
  const text = E.diffText(d);
  assert.match(text, /function codes: 1 added \(NEW\), 1 removed \(QQ\), 1 changed \(ZZ\)/);
  assert.match(text, /process areas: 1 added \(22\)/);
  assert.match(text, /settings: radius, recognise/);
  assert.match(text, /pipe materials/); assert.match(text, /attachments/); assert.match(text, /legend/); assert.match(text, /standard revision/);
});

test('diffPacks: identical packs differ in nothing; long lists of codes are summarised, not dumped; the sign-off and change log are not content', () => {
  const same = E.diffPacks(PACK, JSON.parse(JSON.stringify(PACK)));
  assert.equal(same.changed, false); assert.equal(E.diffText(same), 'No change.');
  const big = JSON.parse(JSON.stringify(PACK)); for (let i = 0; i < 40; i++) { big.fc['X' + i] = 'valve'; }
  assert.match(E.diffText(E.diffPacks(PACK, big)), /40 added \(X0, X1, X2, X3, X4 and 35 more\)/);
  const signed = JSON.parse(JSON.stringify(PACK)); signed.signoff.approved.by = 'Someone Else'; signed.changelog.push({ rev: '3', date: 'x', what: 'y', why: 'z', by: 'w' });
  assert.equal(E.diffPacks(PACK, signed).changed, false);
  for (const bad of [null, 7, {}]) assert.doesNotThrow(() => E.diffPacks(bad, bad));
});

test('nextRevision: counts on from the revision in use, whatever style it is written in', () => {
  assert.equal(E.nextRevision('2'), '3'); assert.equal(E.nextRevision('9'), '10'); assert.equal(E.nextRevision('C02'), 'C03'); assert.equal(E.nextRevision('P09'), 'P10');
  assert.equal(E.nextRevision('3b'), '3c'); assert.equal(E.nextRevision('A'), 'B'); assert.equal(E.nextRevision('Z'), 'Z.1'); assert.equal(E.nextRevision('1.4'), '1.5');
  assert.equal(E.nextRevision(''), '1'); assert.equal(E.nextRevision(null), '1'); assert.equal(E.nextRevision('rev two'), 'rev two.1');
});

test('issueRevision: the edited pack becomes the next revision with its change-log line, and the pack it came from is untouched', () => {
  const edited = JSON.parse(JSON.stringify(PACK)); edited.fc.NEW = 'valve'; edited.fcDescriptions.NEW = 'New';
  const before = JSON.stringify(PACK);
  const r = E.issueRevision(PACK, edited, { why: 'new code issued', by: 'A Tester', date: '28/11/2026' });
  assert.equal(r.ok, true);
  assert.equal(r.pack.identity.revision, '3');
  assert.equal(r.pack.changelog.at(-1).rev, '3'); assert.equal(r.pack.changelog.at(-1).why, 'new code issued'); assert.equal(r.pack.changelog.at(-1).by, 'A Tester'); assert.equal(r.pack.changelog.at(-1).date, '28/11/2026');
  assert.match(r.pack.changelog.at(-1).what, /function codes: 1 added \(NEW\)/);
  assert.equal(r.pack.changelog.length, PACK.changelog.length + 1);
  assert.equal(JSON.stringify(PACK), before, 'the original is not changed');
  // nothing changed: no new revision
  const none = E.issueRevision(PACK, JSON.parse(JSON.stringify(PACK)), { why: 'x', by: 'y', date: 'z' });
  assert.equal(none.ok, false); assert.match(none.problem, /nothing/i);
  // a reason is required
  const noWhy = E.issueRevision(PACK, edited, { why: '  ', by: 'y', date: 'z' });
  assert.equal(noWhy.ok, false); assert.match(noWhy.problem, /reason/i);
  // an edited pack the reader would refuse is not issued
  const broken = JSON.parse(JSON.stringify(edited)); broken.identity.standard.date = '';
  const bad = E.issueRevision(PACK, broken, { why: 'x', by: 'y', date: 'z' });
  assert.equal(bad.ok, false); assert.match(bad.problem, /issue date|cannot be imported/i);
});
