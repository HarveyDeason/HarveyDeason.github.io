import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRESENCE_TIMEOUT_MS, presenceRecord, livePresences, editorOf, sweepable, presenceFileName, ofTool,
} from '../assets/js/hub-presence.js';

const NOW = Date.parse('2026-07-30T14:00:00.000Z');
const at = msAgo => new Date(NOW - msAgo).toISOString();
const rec = (sessionId, name, msAgo, editingCommentId = null, tool = 'hub') =>
  ({ sessionId, name, tool, editingCommentId, lastSeen: at(msAgo) });

test('presenceRecord carries identity, tool and edit target', () => {
  const r = presenceRecord({ name: 'Harvey', sessionId: 's1', tool: 'hub', editingCommentId: 'c9', nowIso: at(0) });
  assert.deepEqual(r, { name: 'Harvey', sessionId: 's1', tool: 'hub', editingCommentId: 'c9', lastSeen: at(0) });
});

test('ofTool separates hub and brain sessions', () => {
  const records = [rec('s2', 'Sarah', 0, 'c9', 'hub'), rec('s3', 'Tom', 0, 'd4', 'brain')];
  assert.deepEqual(ofTool(records, 'hub').map(r => r.name), ['Sarah']);
  assert.deepEqual(ofTool(records, 'brain').map(r => r.name), ['Tom']);
});

test('a brain session never holds a hub lock', () => {
  const records = [rec('s3', 'Tom', 0, 'x1', 'brain')];
  assert.equal(editorOf(ofTool(records, 'hub'), 'x1', 's1', NOW), null);
  assert.equal(livePresences(records, 's1', NOW).length, 1, 'but they still show as present');
});

test('livePresences drops own session and stale sessions', () => {
  const records = [rec('s1', 'Me', 0), rec('s2', 'Sarah', 10000), rec('s3', 'Ghost', 120000)];
  const live = livePresences(records, 's1', NOW);
  assert.deepEqual(live.map(r => r.name), ['Sarah']);
});

test('livePresences keeps a session right at the timeout boundary', () => {
  const records = [rec('s2', 'Sarah', PRESENCE_TIMEOUT_MS - 1)];
  assert.equal(livePresences(records, 's1', NOW).length, 1);
  const stale = [rec('s2', 'Sarah', PRESENCE_TIMEOUT_MS + 1)];
  assert.equal(livePresences(stale, 's1', NOW).length, 0);
});

test('livePresences sorts by name', () => {
  const records = [rec('s2', 'Tom', 0), rec('s3', 'Anna', 0)];
  assert.deepEqual(livePresences(records, 's1', NOW).map(r => r.name), ['Anna', 'Tom']);
});

test('editorOf finds another live editor but never yourself', () => {
  const records = [rec('s1', 'Me', 0, 'c9'), rec('s2', 'Sarah', 0, 'c9')];
  assert.equal(editorOf(records, 'c9', 's1', NOW), 'Sarah');
  assert.equal(editorOf(records, 'c9', 's2', NOW), 'Me');
  assert.equal(editorOf(records, 'c1', 's1', NOW), null);
});

test('editorOf ignores a stale editor so a crashed tab cannot hold a lock', () => {
  const records = [rec('s2', 'Sarah', 120000, 'c9')];
  assert.equal(editorOf(records, 'c9', 's1', NOW), null);
});

test('sweepable returns only long-dead sessions', () => {
  const records = [rec('s2', 'Sarah', 120000), rec('s3', 'Ghost', 700000)];
  assert.deepEqual(sweepable(records, NOW), ['s3']);
});

test('presenceFileName is derived from sessionId', () => {
  assert.equal(presenceFileName('s1'), 's1.json');
});
