import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectRevision, detectDrawingDate, parseUKDate } from '../assets/js/pid-revision.js';

// Invented title-block text only. PDF text arrives in whatever order the
// drawing software wrote it, so rows are often jumbled.

// ── Results pinned as they were before the FOR PRELIMINARY fix ───────────
test('detectRevision: a status or NTS label names the revision', () => {
  assert.equal(detectRevision('SCALE NTS P03 SHEET 1 OF 1'), 'P03');
  assert.equal(detectRevision('STATUS C01 DRAWN AB'), 'C01');
  assert.equal(detectRevision('REV: P04 CHECKED CD'), 'P04');
});

test('detectRevision: the highest row of a revision table wins', () => {
  assert.equal(detectRevision('P01 FOR INFORMATION P02 FOR APPROVAL P03 FOR COMMENT'), 'P03');
  assert.equal(detectRevision('P10 FOR INFORMATION P09 FOR INFORMATION'), 'P10');
});

test('detectRevision: a C (construction) revision outranks any P revision', () => {
  assert.equal(detectRevision('P05 ISSUED C01 FOR CONSTRUCTION'), 'C01');
});

test('detectRevision: a bare description word after the token counts as a row', () => {
  assert.equal(detectRevision('P01 FIRST ISSUE P02 PRELIMINARY'), 'P02');
  assert.equal(detectRevision('P01 REVISED P02 UPDATED'), 'P02');
});

test('detectRevision: falls back to a letter revision, or null when there is nothing', () => {
  assert.equal(detectRevision('REV B CHECKED'), 'B');
  assert.equal(detectRevision('GENERAL ARRANGEMENT OF TANK'), null);
});

test('detectDrawingDate: takes the date of the identified revision row', () => {
  const t = 'P02 FOR INFORMATION 14/11/26 P01 FOR INFORMATION 02/10/26';
  assert.equal(detectDrawingDate(t, 'P02'), '2026-11-14');
  assert.equal(detectDrawingDate(t, 'P01'), '2026-10-02');
});

test('detectDrawingDate: with no revision it takes the latest date on the sheet', () => {
  assert.equal(detectDrawingDate('ISSUED 03/03/26 PRINTED 12 JAN 2027', null), '2027-01-12');
  assert.equal(detectDrawingDate('NO DATES HERE', 'P01'), '');
});

test('parseUKDate: day-first dates and month names, empty for rubbish', () => {
  assert.equal(parseUKDate('03/03/26'), '2026-03-03');
  assert.equal(parseUKDate('3 Mar 2026'), '2026-03-03');
  assert.equal(parseUKDate('12-JAN-27'), '2027-01-12');
  assert.equal(parseUKDate(''), '');
  assert.equal(parseUKDate('not a date'), '');
});

// ── The 2026-11-24 bug: rows written "<rev> FOR PRELIMINARY" ─────────────
test('detectRevision: P02 FOR PRELIMINARY is the latest row, not P01 FOR INFORMATION', () => {
  assert.equal(detectRevision('NOTES P02 P01 FOR INFORMATION DRAWN AB P02 FOR PRELIMINARY CHECKED CD'), 'P02');
  assert.equal(detectRevision('P01 FOR PRELIMINARY'), 'P01');
});

test('detectRevision: any "FOR <purpose>" description counts, not a fixed list', () => {
  assert.equal(detectRevision('P02 FOR INFORMATION P03 FOR COSTING'), 'P03');
  assert.equal(detectRevision('P01 FOR INFORMATION P02 FOR PLANNING SUBMISSION'), 'P02');
});

test('detectDrawingDate: a FOR PRELIMINARY row is the revision row, ahead of a later stray date', () => {
  // P02 appears in the row (20/11/26) and in a note with a later date; the row decides.
  const t = 'P02 FOR PRELIMINARY 20/11/26 P01 FOR INFORMATION 05/10/26 SEE P02 FIELD SURVEY REPORT DATED 30/11/26';
  assert.equal(detectDrawingDate(t, 'P02'), '2026-11-20');
});
