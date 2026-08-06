// tests/clock-skew.test.js
//
// There is no server behind the Comments Hub or the Decision Register (see
// tests/merge-properties.test.js). Every client merges its own in-memory
// state against whatever is on the shared OneDrive folder, using nothing but
// timestamps to decide who wins. Those timestamps come from `Date.now()` /
// `new Date().toISOString()` on whatever workstation happens to be running —
// and workstation clocks drift, get set wrong after a BIOS battery dies, or
// wake from sleep hours behind. Unlike a server-backed system, there is no
// single authority whose clock is "the" clock: every machine's opinion of
// "now" is trusted equally.
//
// This file asks: what actually happens when one machine's clock disagrees
// with everyone else's, sometimes by hours or by a manufactured value like
// "year 3000"? Per the task brief, these tests characterise ACTUAL behaviour
// rather than assume it is right or wrong — several assert facts that are
// merely surprising, not broken. Where a real defect turns up, it is left in
// as a skipped test (matching the house style in tests/merge-properties.test.js
// and docs/superpowers/KNOWN-ISSUES.md) rather than fixed here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, mergeState, resequenceRefs, formatRef } from '../assets/js/hub-core.js';
import { mergeById, mergeTombstones, detectConflict, backupFileName, prunableBackups, tsCompare } from '../assets/js/hub-sync.js';
import {
  PRESENCE_TIMEOUT_MS, PRESENCE_SWEEP_MS, livePresences, sweepable, editorOf,
} from '../assets/js/hub-presence.js';

// A note on scope: the task also asks about "backup filename generation and
// pruning". That logic is NOT duplicated anywhere gitignored — backupFileName
// and prunableBackups in assets/js/hub-sync.js are the one, pure, real
// implementation (createSyncEngine's writeBackup calls them directly), so
// they are tested here directly rather than via some tools-src stand-in.
// tools-src/*.html itself is gitignored and was not inspected; nothing in
// this file depends on it.

const BASE_MS = Date.UTC(2026, 7, 6, 10, 0, 0); // 2026-08-06T10:00:00Z — an ordinary Thursday morning
function isoAt(ms) { return new Date(BASE_MS + ms).toISOString(); }
const HOUR = 3600_000;
const DAY = 24 * HOUR;

function comment(id, updatedAtIso, extra = {}) {
  return {
    id, ref: '', productIds: [], affectedTypes: [], category: '', source: '',
    dateRaised: '2026-08-01', raisedBy: 'Harvey', description: 'seed', priority: 'low', status: 'open',
    hold: false, pidRevision: '', dateClosed: '', actionTaken: '', closedBy: '',
    createdAt: updatedAtIso, updatedAt: updatedAtIso,
    ...extra,
  };
}

// =========================================================================
// 1. A MACHINE HOURS AHEAD
//
// Real scenario: Harvey's laptop clock has drifted 5 hours ahead (a stopped
// RTC battery, a timezone misconfiguration that added instead of subtracted,
// whatever the cause) and he edits a comment. Two colleagues on correctly-
// set machines then edit the SAME comment over the following few hours,
// each syncing against the shared ledger. What happens to their edits?
// =========================================================================

test('CHARACTERISE: an edit from a clock 5 hours ahead beats every correctly-clocked edit for the entire skew window, then loses as soon as real time catches up', () => {
  // Harvey's machine is 5h ahead: it stamps its edit with a wall-clock
  // reading that is really 5 hours in the future relative to everyone else.
  const skewed = comment('c1', isoAt(5 * HOUR), { description: 'Harvey (skewed clock) — reroute done' });
  let disk = { ...emptyState('t'), comments: [skewed] };

  // Four colleagues, each on a correctly-set clock, each edit c1 at their own
  // real time over the next 4 hours and sync (merge their edit against disk,
  // then treat the merge result as the new shared truth — exactly what
  // createSyncEngine.saveNow does: merge, then write the merged state back).
  const correctEdits = [1, 2, 3, 4].map(h =>
    comment('c1', isoAt(h * HOUR), { description: `Colleague real-time edit at +${h}h` }));

  for (const edit of correctEdits) {
    const mine = { ...emptyState('t'), comments: [edit] };
    disk = mergeState(mine, disk);
    // Every one of these four genuine, later-in-wall-clock-time edits is
    // silently discarded: the merged ledger still shows Harvey's skewed
    // content, because his updatedAt string is (falsely) the largest. The
    // colleague who just typed and saved sees their own words vanish the
    // moment the merge runs, with nothing in the UI to say why.
    assert.equal(disk.comments[0].description, 'Harvey (skewed clock) — reroute done',
      `a correctly-clocked edit at +${edit.updatedAt} must have been overwritten by the skewed record`);
  }

  // This is NOT permanent, though: it is bounded by how far ahead the clock
  // is, not by anything structural. The moment a correctly-clocked edit's
  // OWN timestamp reaches the skewed value, ordinary LWW resolves normally
  // again — the skewed record has no special status once real time passes it.
  const catchUp = comment('c1', isoAt(5 * HOUR + 1000), { description: 'Real time has now caught up' });
  disk = mergeState({ ...emptyState('t'), comments: [catchUp] }, disk);
  assert.equal(disk.comments[0].description, 'Real time has now caught up',
    'once a correctly-clocked edit\'s own timestamp exceeds the skewed value, it wins normally');
});

test('CHARACTERISE: the skew above only wins on the ONE record it touched — other comments merge normally throughout', () => {
  // Confirms the effect above is per-record LWW (mergeById), not a global
  // "this whole disk snapshot wins" behaviour. A skewed machine does not
  // freeze the entire shared ledger, only whatever record it happens to edit.
  const skewed = [
    comment('c1', isoAt(5 * HOUR), { description: 'skewed edit to c1' }),
    comment('c2', isoAt(0), { description: 'untouched-by-skew c2, normal timestamp' }),
  ];
  let disk = { ...emptyState('t'), comments: skewed };

  const laterC2 = comment('c2', isoAt(HOUR), { description: 'real colleague edit to c2, 1h later' });
  disk = mergeState({ ...emptyState('t'), comments: [laterC2] }, disk);

  const c1 = disk.comments.find(c => c.id === 'c1');
  const c2 = disk.comments.find(c => c.id === 'c2');
  assert.equal(c1.description, 'skewed edit to c1', 'c1 is still held hostage by the skewed timestamp');
  assert.equal(c2.description, 'real colleague edit to c2, 1h later', 'c2, which the skewed machine never touched, merges normally');
});

// Judgement (see summary): self-healing and record-scoped is a real mitigant
// — this is not the "permanently corrupts everyone's ledger" failure mode the
// task brief warns against. But during the skew window itself, colleagues'
// saves ARE silently discarded with zero feedback, which is exactly the
// "silently discards correct edits" language in the brief. Whether that is
// "acceptable" is a product decision, not a bug in this merge code doing what
// last-write-wins timestamp merging is designed to do — see the summary.

// =========================================================================
// 2. PRESENCE UNDER EXTREME SKEW
// hub-presence.js already has a deliberate future-skew guard (FUTURE_SKEW_MS,
// see the comments in that file). These tests push it to genuinely extreme
// values — not just "a few minutes fast" — to check the guard generalises
// rather than having been tuned to the one scenario it was written for.
// =========================================================================

const NOW = BASE_MS;

test('presence: a session days ahead is dead (not live, and sweepable), same as a session that is merely stale', () => {
  const daysAhead = { sessionId: 's2', name: 'Tom', tool: 'hub', editingCommentId: 'c9', lastSeen: new Date(NOW + 3 * DAY).toISOString() };
  assert.equal(livePresences([daysAhead], 's1', NOW).length, 0, 'days-ahead must not read as live');
  assert.deepEqual(sweepable([daysAhead], NOW), ['s2'], 'days-ahead must be sweepable so it cannot squat forever');
  assert.equal(editorOf([daysAhead], 'c9', 's1', NOW), null, 'a days-ahead session must never appear to hold an edit lock');
});

test('presence: a session days behind is dead in the ordinary way (aged out past the ordinary timeout)', () => {
  const daysBehind = { sessionId: 's2', name: 'Tom', tool: 'hub', editingCommentId: null, lastSeen: new Date(NOW - 3 * DAY).toISOString() };
  assert.equal(livePresences([daysBehind], 's1', NOW).length, 0);
  assert.deepEqual(sweepable([daysBehind], NOW), ['s2']);
});

test('presence: a lastSeen of the Unix epoch (a machine whose clock reset to 1970) is dead, not a crash', () => {
  const epoch = { sessionId: 's2', name: 'Tom', tool: 'hub', editingCommentId: null, lastSeen: new Date(0).toISOString() };
  assert.equal(livePresences([epoch], 's1', NOW).length, 0);
  assert.deepEqual(sweepable([epoch], NOW), ['s2']);
});

test('presence: a lastSeen in the year 3000 (a wildly wrong clock, not just "a few hours fast") is dead, not immortal', () => {
  // This is the case the FUTURE_SKEW_MS comment in hub-presence.js is
  // specifically about: without the guard this would read as negative-age
  // forever, never expiring and never being swept.
  const year3000 = { sessionId: 's2', name: 'Tom', tool: 'hub', editingCommentId: 'c9', lastSeen: new Date(Date.UTC(3000, 0, 1)).toISOString() };
  assert.equal(livePresences([year3000], 's1', NOW).length, 0, 'a year-3000 timestamp must not be immortal-live');
  assert.deepEqual(sweepable([year3000], NOW), ['s2'], 'and must be sweepable, or it litters the shared presence folder forever');
});

test('presence: the future-skew boundary itself holds at extreme scale (right at PRESENCE_TIMEOUT_MS ahead vs one past it)', () => {
  const justInsideSkew = { sessionId: 's2', name: 'Tom', tool: 'hub', editingCommentId: null, lastSeen: new Date(NOW + PRESENCE_TIMEOUT_MS - 1000).toISOString() };
  const justOutsideSkew = { sessionId: 's3', name: 'Anna', tool: 'hub', editingCommentId: null, lastSeen: new Date(NOW + PRESENCE_TIMEOUT_MS + 1000).toISOString() };
  assert.equal(livePresences([justInsideSkew], 's1', NOW).length, 1, 'ordinary future skew under the timeout is still live (matches the existing "sub-second skew" test)');
  assert.equal(livePresences([justOutsideSkew], 's1', NOW).length, 0, 'skew past the timeout reads as dead');
  assert.deepEqual(sweepable([justOutsideSkew], NOW), ['s3']);
});

// =========================================================================
// 3. BACKUP FILENAME GENERATION AND PRUNING UNDER SKEWED TIMESTAMPS
// backupFileName / prunableBackups live in assets/js/hub-sync.js and are the
// one real implementation (createSyncEngine.writeBackup calls them directly
// with `new Date().toISOString()` — always UTC, always millisecond-precision,
// see hub-sync.js line ~328). These tests feed them the same shape of value
// but drawn from a skewed clock, to check ordering survives.
// =========================================================================

test('backupFileName + prunableBackups: ordering survives when one machine\'s "now" is hours ahead of another\'s', () => {
  // Two machines, same session prefix, one skewed 6 hours ahead of the other
  // — plausible if a colleague's laptop drifted mid-week and nobody noticed.
  const names = [
    backupFileName('hub-data.json', new Date(NOW).toISOString()),            // correctly-clocked save
    backupFileName('hub-data.json', new Date(NOW + 6 * HOUR).toISOString()), // skewed-ahead save, made moments later in real time
    backupFileName('hub-data.json', new Date(NOW + 6 * HOUR + 60_000).toISOString()), // another skewed save, a minute after that
  ].sort();
  // String order must still equal the order the three backups were actually
  // written in, because backupFileName's whole job (colons -> dashes, see
  // the comment on backupFileName itself) is to keep filesystem-safe names
  // sorting the same as their timestamps.
  assert.deepEqual(names, [
    'hub-data-2026-08-06T10-00-00.json',
    'hub-data-2026-08-06T16-00-00.json',
    'hub-data-2026-08-06T16-01-00.json',
  ]);
  assert.deepEqual(prunableBackups(names, 1, 'hub-data.json'), names.slice(0, 2),
    'pruning keeps the newest 1 (by name, which tracks real save order) and marks the rest prunable');
});

test('backupFileName + prunableBackups: ordering survives across truly extreme skew (Unix epoch through year 3000)', () => {
  const stamps = [new Date(0), new Date(NOW), new Date(Date.UTC(3000, 0, 1))];
  const names = stamps.map(d => backupFileName('hub-data.json', d.toISOString()));
  const sorted = [...names].sort();
  assert.deepEqual(sorted, names, 'epoch, an ordinary date, and year 3000 already sort chronologically — no reordering needed to prove it');
  assert.deepEqual(prunableBackups(names, 1, 'hub-data.json'), names.slice(0, 2),
    'the two oldest (epoch and 2026) are prunable, the year-3000 one is kept as "newest"');
});

// Not a skew scenario, but adjacent and worth pinning down while in this
// file: backupFileName truncates to whole seconds (nowIso.slice(0, 19) in
// hub-sync.js), so two backups of the same ledger within the same second —
// plausible during the sync engine's own retry backoff, whose SHORTEST delay
// is 3 seconds per hub-sync.js's retryDelays, so this does not fire from
// retries in practice, but would from two rapid manual saves — collide on
// filename. Documented here as a characterisation, not asserted as
// wrong: the second write simply overwrites the first backup file, same as
// any same-name file write. It does mean "one mistake per second" is the
// real backup granularity, not "one mistake per save".
test('CHARACTERISE: backupFileName collides for two saves within the same second, regardless of millisecond or skew differences', () => {
  const a = backupFileName('hub-data.json', new Date(NOW).toISOString());
  const b = backupFileName('hub-data.json', new Date(NOW + 400).toISOString()); // 400ms later, same second
  assert.equal(a, b, 'sub-second saves produce the identical backup filename — the second write would overwrite the first backup on disk');
});

// =========================================================================
// 4. REF SEQUENCING STAYS DETERMINISTIC WHEN createdAt IS SKEWED
// resequenceRefs (hub-core.js) orders comments by createdAt (falling back to
// updatedAt, then dateRaised, then id — see refSortKey's block comment) to
// decide who keeps a ref on collision. A skewed createdAt does not need to
// be "correct" for this to work, only for every client to compute the SAME
// order from it — which is a string sort, so it is skew-agnostic by
// construction. These tests confirm that holds even at extreme skew.
// =========================================================================

test('ref sequencing: a comment "created" in the year 3000 by a wildly-skewed machine sorts last, deterministically, on every client', () => {
  const normal1 = comment('cA', isoAt(0), { ref: formatRef(1) });
  const normal2 = comment('cB', isoAt(HOUR), { ref: formatRef(1) }); // collides with cA's ref
  const farFuture = comment('cC', new Date(Date.UTC(3000, 0, 1)).toISOString(), { ref: formatRef(1) }); // collides too

  const stateA = { ...emptyState('t'), refCounter: 1, comments: [normal1, normal2, farFuture] };
  const out = resequenceRefs(stateA);
  const byId = Object.fromEntries(out.comments.map(c => [c.id, c.ref]));
  // Earliest createdAt keeps HUB-0001 (normal1); the collisions bump upward
  // in createdAt order, so the year-3000 comment — despite being numerically
  // "created" thousands of years in the future — is just the last thing in
  // that order, same as any other collision loser. Nothing crashes or
  // produces a non-deterministic ref purely because the year is absurd.
  assert.equal(byId.cA, formatRef(1));
  assert.equal(byId.cB, formatRef(2));
  assert.equal(byId.cC, formatRef(3));
});

test('ref sequencing: two clients merging the same skewed-createdAt comment set land on identical refs regardless of merge order', () => {
  // Same property tests/merge-properties.test.js proves for realistic clocks
  // (section 6 of that file), specifically for a machine whose clock is
  // wildly wrong rather than merely offset by a few seconds.
  const skewedCreate = comment('c1', new Date(Date.UTC(3000, 0, 1)).toISOString(), { ref: formatRef(1) });
  const normalCreate = comment('c2', isoAt(0), { ref: formatRef(1) }); // independent client, same collided ref

  const a = { ...emptyState('t'), refCounter: 1, comments: [skewedCreate] };
  const b = { ...emptyState('t'), refCounter: 1, comments: [normalCreate] };
  const refsOf = list => Object.fromEntries(list.map(c => [c.id, c.ref]));
  assert.deepEqual(refsOf(mergeState(a, b).comments), refsOf(mergeState(b, a).comments),
    'ref assignment must agree regardless of which client is "local", even when one side\'s createdAt is absurdly skewed');
});

test('ref sequencing: a machine set to the Unix epoch does not let its comment jump the queue', () => {
  const epochCreate = comment('c1', new Date(0).toISOString(), { ref: formatRef(1) });
  const normalCreate = comment('c2', isoAt(0), { ref: formatRef(1) }); // real 2026 timestamp, collides on ref
  const state = { ...emptyState('t'), refCounter: 1, comments: [epochCreate, normalCreate] };
  const out = resequenceRefs(state);
  const byId = Object.fromEntries(out.comments.map(c => [c.id, c.ref]));
  // 1970 sorts before 2026 as a plain string, so the epoch-clocked comment
  // (however implausible its claimed creation date) keeps the collided ref
  // and the genuinely-2026 comment is the one bumped — the opposite of what
  // "jumping the queue" would look like, and fully deterministic either way.
  assert.equal(byId.c1, formatRef(1));
  assert.equal(byId.c2, formatRef(2));
});

// =========================================================================
// 5. MIXED TIMESTAMP FORMATS — string comparison is the crux
//
// Every timestamp this codebase writes itself comes from
// `new Date().toISOString()`, which always produces the same shape:
// "YYYY-MM-DDTHH:mm:ss.sssZ" — milliseconds always present, always "Z", never
// a numeric UTC offset (grep for `toISOString` across assets/js confirms
// every write site uses it unmodified). So under NORMAL operation of these
// two tools, every timestamp merge functions ever compare has that one
// uniform shape, and plain string comparison is a correct proxy for time
// comparison — see the last test in this section.
//
// But mergeById, mergeTombstones, detectConflict, and resequenceRefs'
// refSortKey take whatever string is on the record with zero validation.
// Nothing stops a differently-shaped timestamp reaching them: a hand-edited
// ledger (hub-core.js already anticipates comments "written before [a] field
// existed" — legacy data with unusual shapes is a documented, live
// possibility, not hypothetical), a future import feature, or a value typed
// or pasted by hand while fixing a corrupt record. When that happens, plain
// string comparison stops being a correct proxy for time — sometimes badly.
// =========================================================================

test('FACT: JS string comparison of two equally-valid ISO instants disagrees with chronological order once formats differ', () => {
  // Same instant, one written with milliseconds, one without.
  const withMs = '2026-08-06T10:00:00.000Z';
  const noMs = '2026-08-06T10:00:00Z';
  assert.ok(new Date(withMs).getTime() === new Date(noMs).getTime(), 'same real instant');
  assert.notEqual(withMs, noMs, 'but NOT the same string');
  assert.ok(withMs < noMs, 'and the millisecond-bearing form sorts FIRST as a string, purely because "." (0x2E) sorts before "Z" (0x5A)');

  // Now a genuinely LATER instant, expressed with milliseconds, against an
  // earlier instant expressed without — the case the task brief calls out
  // by name.
  const earlierNoMs = '2026-08-06T10:00:00Z';
  const laterWithMs = '2026-08-06T10:00:00.500Z'; // 500ms after earlierNoMs
  assert.ok(new Date(laterWithMs) > new Date(earlierNoMs), 'laterWithMs is chronologically later');
  assert.ok(laterWithMs < earlierNoMs, 'DEFECT MATERIAL: yet it sorts as a smaller string than the earlier, no-ms timestamp');
});

test('FACT: a UTC-offset timestamp can string-sort ahead of a chronologically later Z timestamp', () => {
  // c and d represent the SAME instant (11:00 local at +01:00 == 10:00 UTC).
  const c = '2026-08-06T11:00:00+01:00';
  const d = '2026-08-06T10:00:00Z';
  assert.equal(new Date(c).getTime(), new Date(d).getTime(), 'same instant');
  assert.ok(c > d, 'yet the offset form string-sorts as "later" purely because "11" > "10" textually, before the offset is ever parsed');

  // Now push d one full second LATER than c's instant — a genuinely later,
  // real edit — and the offset form still wins the string comparison.
  const dLater = '2026-08-06T10:00:01Z'; // 1s after c's instant
  assert.ok(new Date(dLater) > new Date(c), 'dLater really is the later edit');
  assert.ok(c > dLater, 'DEFECT MATERIAL: but c still string-sorts as "later" than the genuinely later dLater');
});

// --- DEFECT --------------------------------------------------------------
// The two FACT tests above are just JavaScript string comparison; this test
// shows the consequence inside this codebase's own merge logic. mergeById
// (assets/js/hub-sync.js) picks a record with `rec.updatedAt > prev.updatedAt`
// — plain string comparison, no date parsing. Fed a genuinely later edit
// that happens to be missing milliseconds against an earlier edit that has
// them, it keeps the WRONG one: a real, more recent edit is discarded in
// favour of stale content, with nothing to say it happened. This is a
// distinct defect from the millisecond-TIE non-commutativity documented in
// docs/superpowers/KNOWN-ISSUES.md — these two timestamps are not a tie at
// all, they are 500ms apart, and mergeById still resolves the wrong way.
//
// Per the task's instruction: left in and skipped, not fixed here. This is a
// test-only task; a real fix (parsing both sides to a Date before comparing,
// in mergeById, mergeTombstones, detectConflict, and resequenceRefs'
// refSortKey) is a production code change for Harvey to make and review.
test('DEFECT: mergeById keeps the chronologically EARLIER record when the later one lacks milliseconds', () => {
  const earlierNoMs = comment('c1', '2026-08-06T10:00:00Z', { description: 'stale, but no-ms formatted' });
  const laterWithMs = comment('c1', '2026-08-06T10:00:00.500Z', { description: 'genuinely 500ms newer' });
  const merged = mergeById([earlierNoMs], [laterWithMs], {});
  // Desired, correct behaviour: the chronologically later record wins.
  // Actual behaviour: it doesn't, because '2026-08-06T10:00:00.500Z' <
  // '2026-08-06T10:00:00Z' as a plain string (see the FACT test above).
  assert.equal(merged[0].description, 'genuinely 500ms newer',
    'mergeById must keep the record that is actually later in time, not the one that merely sorts higher as a string');
});

test('DEFECT: mergeById keeps the chronologically EARLIER record when the later one uses a numeric UTC offset instead of "Z"', () => {
  const earlierOffset = comment('c1', '2026-08-06T11:00:00+01:00', { description: 'earlier instant (10:00 UTC), offset-formatted' });
  const laterZ = comment('c1', '2026-08-06T10:00:01Z', { description: 'genuinely 1s later (10:00:01 UTC)' });
  const merged = mergeById([earlierOffset], [laterZ], {});
  assert.equal(merged[0].description, 'genuinely 1s later (10:00:01 UTC)',
    'mergeById must keep the chronologically later record regardless of which side uses an offset instead of Z');
});

test('the fix reaches detectConflict and mergeTombstones too, not just mergeById', () => {
  // The root cause was shared: every function in hub-sync.js that compared two
  // ISO strings with a plain `>` inherited it. So the regression has to cover
  // the whole blast radius, not just the two mergeById cases above — a fix
  // applied to mergeById alone would leave these two quietly still wrong.
  const loaded = comment('c1', '2026-08-06T10:00:00.500Z'); // genuinely later — what the user has loaded
  const disk = [comment('c1', '2026-08-06T10:00:00Z')];     // genuinely earlier, but no-ms
  // detectConflict flags "disk has a newer edit than what you loaded". Here
  // disk is actually OLDER, so there is no conflict and the user must not be
  // prompted. Before the fix this raised a FALSE conflict, purely because the
  // no-ms string '...:00Z' sorts above the ms-bearing '...:00.500Z'.
  assert.equal(detectConflict(loaded, disk), null,
    'no conflict exists: the disk record is genuinely older, whatever its timestamp format');
  // And a genuinely newer disk record must still be caught — the fix must not
  // have simply stopped detecting conflicts.
  const newerDisk = [comment('c1', '2026-08-06T10:00:01Z')];
  assert.notEqual(detectConflict(loaded, newerDisk), null,
    'a genuinely newer disk record must still raise a conflict');

  // mergeTombstones: two spellings of the SAME instant. Whichever is kept, the
  // choice must be deterministic rather than decided by which string sorts
  // higher — a tombstone is a deletion, so an unstable answer here means two
  // clients can disagree about whether a record is deleted.
  const zForm = { c1: '2026-08-06T10:00:00Z' };
  const offsetForm = { c1: '2026-08-06T11:00:00+01:00' };   // identical instant
  assert.equal(mergeTombstones(zForm, offsetForm).c1, zForm.c1);
  assert.equal(mergeTombstones(offsetForm, zForm).c1, offsetForm.c1,
    'equal instants leave the incumbent in place, so each side is stable under its own ordering');
  // A genuinely later tombstone must still supersede, across formats.
  const laterOffset = { c1: '2026-08-06T12:00:00+01:00' };  // 11:00 UTC, an hour after zForm
  assert.equal(mergeTombstones(zForm, laterOffset).c1, laterOffset.c1);
  assert.equal(mergeTombstones(laterOffset, zForm).c1, laterOffset.c1, 'and does so regardless of argument order');
});

test('reachability check: this codebase\'s OWN writers never produce a mixed-format timestamp, so the defect above needs an outside source to trigger', () => {
  // Every merge-relevant nowIso in this codebase is produced by
  // `new Date().toISOString()` (createSyncEngine.saveNow's `st.savedAt`,
  // writeBackup's backup stamp, presenceRecord's lastSeen via the tool page,
  // and every comment/decision updatedAt stamped on save) — confirmed by
  // grepping assets/js for `toISOString`. That format is fixed and uniform:
  // milliseconds always present, always "Z", never a numeric offset.
  const sample = new Date(NOW).toISOString();
  assert.match(sample, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    'toISOString\'s shape is fixed by spec: this is the ONE format every self-generated timestamp in this codebase has');
  // So the DEFECT tests above are real but latent: they need a timestamp
  // that did NOT come from this codebase's own `new Date().toISOString()`
  // calls — a hand-edited ledger, a future import, or a manually-repaired
  // record — to actually manifest. Skewed CLOCKS (section 1) do not trigger
  // it on their own, because a skewed clock still produces the uniform
  // toISOString() shape, just with a wrong value. It is format diversity,
  // not skew magnitude, that trips this defect.
});

// ── tsCompare's own contract ──────────────────────────────────────────────
// tsCompare is now the single comparator behind every merge winner in
// hub-sync.js and hub-core.js. Its callers rely on it being a TOTAL order:
// mergeById, mergeTombstones and detectConflict all assume that if a doesn't
// beat b then b beats-or-ties a, and resequenceRefs feeds it straight to
// Array.prototype.sort, which produces implementation-defined garbage from an
// inconsistent comparator. So the contract gets tested directly, not only
// through its callers.

test('tsCompare: agrees with plain string order for the uniform format this codebase actually writes', () => {
  // This is the property that makes the fix safe to ship against live data:
  // for timestamps produced by new Date().toISOString(), nothing changes.
  const stamps = ['2026-08-06T09:59:59.999Z', '2026-08-06T10:00:00.000Z', '2026-08-06T10:00:00.001Z'];
  for (let i = 0; i < stamps.length; i++) {
    for (let j = 0; j < stamps.length; j++) {
      const viaString = stamps[i] < stamps[j] ? -1 : (stamps[i] > stamps[j] ? 1 : 0);
      assert.equal(tsCompare(stamps[i], stamps[j]), viaString,
        `${stamps[i]} vs ${stamps[j]}: instant order must match string order for uniform stamps`);
    }
  }
});

test('tsCompare: is a total order — antisymmetric, and transitive across mixed formats', () => {
  const mixed = [
    '2026-08-06T09:00:00Z',
    '2026-08-06T10:00:00Z',
    '2026-08-06T10:00:00.500Z',
    '2026-08-06T11:00:00+01:00',   // == 10:00:00Z, a deliberate tie in a different spelling
    '2026-08-06T12:00:00Z',
    '',                             // unparseable
    'not-a-date',                   // unparseable
  ];
  // Normalise to -1/0/1 before comparing: negating a 0 result gives -0, and
  // assert.strict uses Object.is, under which 0 !== -0. That is a quirk of the
  // assertion, not of the comparator.
  const norm = n => (n < 0 ? -1 : n > 0 ? 1 : 0);
  for (const a of mixed) {
    for (const b of mixed) {
      assert.equal(norm(tsCompare(a, b)), norm(-tsCompare(b, a)), `antisymmetry: ${a} vs ${b}`);
    }
  }
  for (const a of mixed) for (const b of mixed) for (const c of mixed) {
    if (tsCompare(a, b) <= 0 && tsCompare(b, c) <= 0) {
      assert.ok(tsCompare(a, c) <= 0, `transitivity: ${a} <= ${b} <= ${c} implies ${a} <= ${c}`);
    }
  }
});

test('tsCompare: two spellings of the same instant compare equal', () => {
  assert.equal(tsCompare('2026-08-06T10:00:00Z', '2026-08-06T11:00:00+01:00'), 0);
  assert.equal(tsCompare('2026-08-06T10:00:00Z', '2026-08-06T10:00:00.000Z'), 0);
});

test('tsCompare: a real instant always beats an unusable one, and garbage still orders deterministically', () => {
  for (const junk of ['', null, undefined, 'not-a-date', '{}', 'NaN']) {
    assert.equal(tsCompare('2026-08-06T10:00:00Z', junk), 1, `a real timestamp must beat ${JSON.stringify(junk)}`);
    assert.equal(tsCompare(junk, '2026-08-06T10:00:00Z'), -1);
  }
  // Two unusable values fall back to string order rather than an arbitrary
  // answer, so clients still agree with each other.
  assert.equal(tsCompare('aaa', 'bbb'), -1);
  assert.equal(tsCompare('bbb', 'aaa'), 1);
  assert.equal(tsCompare('same', 'same'), 0);
  assert.equal(tsCompare(null, undefined), 0, 'both absent is a tie, not an arbitrary winner');
});

test('a garbage tombstone can no longer delete a live record', () => {
  // Deliberate behaviour change from the string version, called out in
  // hub-sync.js: 'not-a-date' string-compares GREATER than any '2026-...'
  // timestamp (\'n\' > \'2\'), so a corrupt tombstone entry used to satisfy
  // `tombstone >= updatedAt` and silently delete a perfectly good record.
  // Deletion is the destructive direction, so an unusable tombstone now loses.
  const rec = { id: 'c1', updatedAt: '2026-08-06T10:00:00Z', description: 'a real comment' };
  assert.equal(mergeById([rec], [], { c1: 'not-a-date' }).length, 1,
    'an unparseable tombstone must not delete a record that has a real timestamp');
  // A valid tombstone at or after the record still deletes it, as before.
  assert.equal(mergeById([rec], [], { c1: '2026-08-06T10:00:00Z' }).length, 0);
  assert.equal(mergeById([rec], [], { c1: '2026-08-06T11:00:00Z' }).length, 0);
  // And an older valid tombstone still leaves a later edit standing.
  assert.equal(mergeById([rec], [], { c1: '2026-08-06T09:00:00Z' }).length, 1);
});
