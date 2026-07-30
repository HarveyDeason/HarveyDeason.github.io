// assets/js/hub-presence.js
// Pure presence logic for the Comments Hub: who else is in the hub, and who is
// editing which comment. No DOM, no File System Access — the tool page owns the
// file I/O and passes parsed records in.
//
// The soft record lock is deliberately just `editingCommentId` on the presence
// record rather than a separate lock file: it then expires with the heartbeat,
// so a crashed tab can never hold a lock, and there is no second expiry
// mechanism to keep correct.

export const PRESENCE_HEARTBEAT_MS = 20000;
export const PRESENCE_TIMEOUT_MS = 90000;
export const PRESENCE_SWEEP_MS = 600000;

export function presenceFileName(sessionId) { return String(sessionId) + '.json'; }

export function presenceRecord({ name, sessionId, tool, editingCommentId, nowIso }) {
  return {
    name: name || 'Someone',
    sessionId,
    tool: tool || 'hub',
    editingCommentId: editingCommentId || null,
    lastSeen: nowIso,
  };
}

// The presence/ folder is shared by the Comments Hub and Product Brain, so a
// caller asking "who is editing record X" must narrow to its own tool first —
// otherwise a decision id could be read as a comment id.
export function ofTool(records, tool) {
  return (records || []).filter(r => r && (r.tool || 'hub') === tool);
}

function ageMs(rec, nowMs) { return nowMs - Date.parse(rec && rec.lastSeen || 0); }

export function livePresences(records, sessionId, nowMs) {
  return (records || [])
    .filter(r => r && r.sessionId && r.sessionId !== sessionId)
    .filter(r => ageMs(r, nowMs) < PRESENCE_TIMEOUT_MS)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export function editorOf(records, commentId, sessionId, nowMs) {
  if (!commentId) return null;
  const hit = livePresences(records, sessionId, nowMs)
    .find(r => r.editingCommentId === commentId);
  return hit ? hit.name : null;
}

export function sweepable(records, nowMs) {
  return (records || [])
    .filter(r => r && r.sessionId && ageMs(r, nowMs) >= PRESENCE_SWEEP_MS)
    .map(r => r.sessionId);
}
