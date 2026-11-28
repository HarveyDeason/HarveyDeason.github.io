// The list of standards a register keeps, the stamp a drawing carries, and which standard a drawing is checked against. Invented values only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../assets/js/pid-standards.js';

const PACK = rev => ({ identity: { name: 'Northfield Water P&ID Pack', id: 'NFW-PID', revision: rev, standard: { number: 'NFW-STD-014', revision: '4', date: '12/03/2021' } }, legend: [{ sheet: '1', rev: 'C02', date: '', ref: '' }] });

test('standardId: readable, filesystem-safe, and different for different contents', () => {
  const a = S.standardId(PACK('2'), 'abc123def456'), b = S.standardId(PACK('2'), '999999999999');
  assert.match(a, /^[A-Za-z0-9._-]+$/);
  assert.ok(a.includes('NFW-PID') && a.includes('2') && a.includes('abc123'));
  assert.notEqual(a, b);
  assert.match(S.standardId({ identity: { name: 'A / B: C?', revision: '1' } }, 'ffff'), /^[A-Za-z0-9._-]+$/);
  assert.doesNotThrow(() => S.standardId(null, ''));
});

test('fingerprintJson: the same content agrees whatever its key order; any change differs', async () => {
  const a = await S.fingerprintJson({ x: 1, y: [1, 2, { z: 3 }] }), b = await S.fingerprintJson({ y: [1, 2, { z: 3 }], x: 1 }), c = await S.fingerprintJson({ x: 1, y: [1, 2, { z: 4 }] });
  assert.match(a, /^[0-9a-f]{12}$/); assert.equal(a, b); assert.notEqual(a, c);
  assert.equal(await S.fingerprintJson(null), await S.fingerprintJson(null));
});

test('the index: add keeps every earlier standard, replaces the same id, and can make the new one current', () => {
  let ix = S.emptyIndex();
  ix = S.addStandard(ix, { id: 'p-r1-aaa', name: 'P', packRevision: '1', fingerprint: 'aaa', libraryFp: 'L1', savedAt: '2026-01-01' }, { makeCurrent: true });
  ix = S.addStandard(ix, { id: 'p-r2-bbb', name: 'P', packRevision: '2', fingerprint: 'bbb', libraryFp: 'L2', savedAt: '2026-06-01' }, { makeCurrent: true });
  assert.deepEqual(ix.standards.map(s => s.id), ['p-r1-aaa', 'p-r2-bbb']);
  assert.equal(ix.current, 'p-r2-bbb');
  ix = S.addStandard(ix, { id: 'p-r1-aaa', name: 'P', packRevision: '1', fingerprint: 'aaa', libraryFp: 'L1', savedAt: '2026-07-01' });
  assert.equal(ix.standards.length, 2); assert.equal(ix.current, 'p-r2-bbb', 'adding without makeCurrent leaves current alone');
  assert.equal(S.setCurrent(ix, 'p-r1-aaa').current, 'p-r1-aaa');
  assert.equal(S.setCurrent(ix, 'nope').current, 'p-r2-bbb', 'an unknown id changes nothing');
  assert.equal(S.setCurrent(ix, null).current, null, 'back to the built-in standard');
});

test('parseIndex: round trips, drops bad entries, and unusable text is an empty index, never a throw', () => {
  const ix = S.addStandard(S.emptyIndex(), { id: 'a-1', name: 'A', packRevision: '1', fingerprint: 'f', libraryFp: null, savedAt: 'x' }, { makeCurrent: true });
  assert.deepEqual(S.parseIndex(S.serializeIndex(ix)).index, ix);
  const messy = JSON.stringify({ format: 1, current: 'ghost', standards: [{ id: 'ok-1', name: 'N' }, { name: 'no id' }, 7, null, { id: 'ok-1', name: 'dup' }] });
  const p = S.parseIndex(messy);
  assert.deepEqual(p.index.standards.map(s => s.id), ['ok-1']);
  assert.equal(p.index.current, null, 'a current id that is not in the list is dropped');
  for (const bad of ['', 'not json', '[]', 'null', '{"format":9}', undefined, 7]) { assert.equal(S.parseIndex(bad).ok, false); assert.deepEqual(S.parseIndex(bad).index, S.emptyIndex()); }
});

test('stampOf: what a drawing revision is stamped with when its tags are read', () => {
  const st = S.stampOf({ pack: PACK('2'), standardId: 'p-r2-bbb', fingerprint: 'bbb', libraryFp: 'L2', line: 'Checked against: X', at: '2026-11-28T10:00:00Z' });
  assert.deepEqual(st, { builtin: false, standardId: 'p-r2-bbb', packName: 'Northfield Water P&ID Pack', packRevision: '2', standardNumber: 'NFW-STD-014', standardRevision: '4', fingerprint: 'bbb', libraryFp: 'L2', line: 'Checked against: X', at: '2026-11-28T10:00:00Z' });
  const b = S.stampOf({ pack: null, libraryFp: 'L2', at: 'now' });
  assert.equal(b.builtin, true); assert.equal(b.standardId, null); assert.match(b.line, /built-in/i); assert.equal(b.libraryFp, 'L2');
});

test('stampStatus: current, an earlier standard, built-in, or no stamp at all', () => {
  const ix = S.addStandard(S.addStandard(S.emptyIndex(), { id: 'p-1', name: 'P', packRevision: '1', fingerprint: 'a', libraryFp: 'L1', savedAt: '1' }), { id: 'p-2', name: 'P', packRevision: '2', fingerprint: 'b', libraryFp: 'L2', savedAt: '2' }, { makeCurrent: true });
  assert.equal(S.stampStatus({ builtin: false, standardId: 'p-2' }, ix), 'current');
  assert.equal(S.stampStatus({ builtin: false, standardId: 'p-1' }, ix), 'earlier');
  assert.equal(S.stampStatus({ builtin: true, standardId: null }, ix), 'builtin');
  assert.equal(S.stampStatus(null, ix), 'none'); assert.equal(S.stampStatus(undefined, ix), 'none'); assert.equal(S.stampStatus({}, ix), 'none');
  assert.equal(S.stampStatus({ builtin: false, standardId: 'p-2' }, S.emptyIndex()), 'earlier', 'a stamp whose standard is no longer listed');
});

test('resolveStandard: the stamped pack and legend when they are available; otherwise the current ones, with a plain note', () => {
  const ix = S.addStandard(S.addStandard(S.emptyIndex(), { id: 'p-1', name: 'P', packRevision: '1', fingerprint: 'a', libraryFp: 'L1', savedAt: '1' }), { id: 'p-2', name: 'P', packRevision: '2', fingerprint: 'b', libraryFp: 'L2', savedAt: '2' }, { makeCurrent: true });
  const have = new Set(['L1', 'L2']);
  // stamped under the earlier pack and legend, both available: use them
  let r = S.resolveStandard({ stamp: { builtin: false, standardId: 'p-1', libraryFp: 'L1' }, index: ix, libraries: have, currentLibraryFp: 'L2' });
  assert.deepEqual([r.packId, r.packSource, r.libraryFp, r.librarySource, r.notes], ['p-1', 'stamped', 'L1', 'stamped', []]);
  // the legend it was read under is not kept: the current legend, and it says so
  r = S.resolveStandard({ stamp: { builtin: false, standardId: 'p-1', libraryFp: 'GONE' }, index: ix, libraries: have, currentLibraryFp: 'L2' });
  assert.equal(r.packId, 'p-1'); assert.equal(r.libraryFp, 'L2'); assert.equal(r.librarySource, 'current'); assert.equal(r.notes.length, 1); assert.match(r.notes[0], /legend/i);
  // the pack it was read under is not in the list: the current pack
  r = S.resolveStandard({ stamp: { builtin: false, standardId: 'old-x', libraryFp: 'L2' }, index: ix, libraries: have, currentLibraryFp: 'L2' });
  assert.equal(r.packId, 'p-2'); assert.equal(r.packSource, 'current'); assert.match(r.notes.join(' '), /not (kept|in)/i);
  // no stamp (read before stamping): the current ones, and it says so
  r = S.resolveStandard({ stamp: null, index: ix, libraries: have, currentLibraryFp: 'L2' });
  assert.deepEqual([r.packId, r.packSource, r.libraryFp, r.librarySource], ['p-2', 'current', 'L2', 'current']); assert.match(r.notes.join(' '), /stamp/i);
  // built-in stamp: the built-in tables
  r = S.resolveStandard({ stamp: { builtin: true, standardId: null, libraryFp: 'L1' }, index: ix, libraries: have, currentLibraryFp: 'L2' });
  assert.deepEqual([r.packId, r.packSource, r.libraryFp], [null, 'stamped', 'L1']);
  // nothing current at all: the built-in tables
  r = S.resolveStandard({ stamp: null, index: S.emptyIndex(), libraries: new Set(), currentLibraryFp: null });
  assert.equal(r.packId, null); assert.equal(r.libraryFp, null);
  // the caller can force the current standard ("check against the current one instead")
  r = S.resolveStandard({ stamp: { builtin: false, standardId: 'p-1', libraryFp: 'L1' }, index: ix, libraries: have, currentLibraryFp: 'L2', useCurrent: true });
  assert.deepEqual([r.packId, r.packSource, r.libraryFp, r.librarySource], ['p-2', 'current', 'L2', 'current']);
});

test('hostile input never throws', () => {
  for (const bad of [null, undefined, 7, 'x', [], {}, { index: 7 }, { stamp: 'x', index: null }]) {
    assert.doesNotThrow(() => S.resolveStandard(bad)); assert.doesNotThrow(() => S.stampStatus(bad, bad)); assert.doesNotThrow(() => S.addStandard(bad, bad)); assert.doesNotThrow(() => S.stampOf(bad));
  }
});
