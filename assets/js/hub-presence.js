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

export function presenceRecord({ name, sessionId, tool, editingCommentId, viewingCommentId, nowIso }) {
  return {
    name: name || 'Someone',
    sessionId,
    tool: tool || 'hub',
    editingCommentId: editingCommentId || null,
    viewingCommentId: viewingCommentId || null,
    lastSeen: nowIso,
  };
}

// The tool id stays 'brain' though the tool is now called the Decision Register:
// it is written into presence files that live on a shared drive, so changing it
// would make running sessions invisible to each other mid-flight. Same reason
// brain-data.json keeps its name — renaming it would orphan everyone's data.
//
// The presence/ folder is shared by the Comments Hub and Decision Register, so a
// caller asking "who is editing record X" must narrow to its own tool first —
// otherwise a decision id could be read as a comment id.
export function ofTool(records, tool) {
  return (records || []).filter(r => r && (r.tool || 'hub') === tool);
}

// The fallback must yield NaN for a missing lastSeen, not a real date: `||`
// binds tighter than the ternary would suggest, so `rec.lastSeen || 0` falls
// back to the NUMBER 0, and Date.parse(0) reads as Date.parse("0"), which is
// 1 January 2000 — not NaN. That happened to make the "missing lastSeen" test
// pass, but for the wrong reason (a 26-year-old record ages out normally,
// never exercising the Number.isNaN guard below). Fall back to '' instead,
// which Date.parse genuinely cannot parse.
function ageMs(rec, nowMs) { return nowMs - Date.parse((rec && rec.lastSeen) || ''); }

// A clock-skewed-ahead lastSeen (a laptop waking from sleep before NTP
// resync, most commonly) makes ageMs NEGATIVE. Negative is < the live
// timeout (so it reads as live forever) and is not >= the sweep threshold
// (so it can never be swept either) — an immortal presence record that shows
// "Also here" and can hold an editing lock nobody can ever clear. Treat a
// timestamp more than a full timeout ahead of "now" as dead, the same as one
// that is too old, while leaving ordinary sub-second clock skew unaffected.
const FUTURE_SKEW_MS = PRESENCE_TIMEOUT_MS;

export function livePresences(records, sessionId, nowMs) {
  return (records || [])
    .filter(r => r && r.sessionId && r.sessionId !== sessionId)
    .filter(r => { const a = ageMs(r, nowMs); return a < PRESENCE_TIMEOUT_MS && a > -FUTURE_SKEW_MS; })
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export function editorOf(records, commentId, sessionId, nowMs) {
  if (!commentId) return null;
  const hit = livePresences(records, sessionId, nowMs)
    .find(r => r.editingCommentId === commentId);
  return hit ? hit.name : null;
}

// Names of other live sessions merely reading this comment. Reuses
// livePresences so a stale or clock-skewed record can never appear as a
// viewer, for the same reasons it can never appear as an editor.
//
// A record editing this comment is deliberately excluded even if it also
// carries a matching viewingCommentId: a person is not both viewing and
// editing at once, and showing them under both labels reads as two people
// in the room instead of one. Editing is the more specific, more visible
// state, so it wins and the record is left out of the viewer list.
export function viewersOf(records, commentId, sessionId, nowMs) {
  if (!commentId) return [];
  return livePresences(records, sessionId, nowMs)
    .filter(r => r.viewingCommentId === commentId && r.editingCommentId !== commentId)
    .map(r => r.name);
}

export function sweepable(records, nowMs) {
  return (records || [])
    .filter(r => r && r.sessionId)
    // A missing or unparseable lastSeen makes ageMs NaN, and NaN >= anything
    // is false — so without this check a corrupt/half-written file would
    // never age past the sweep threshold and would litter the shared folder
    // forever. Treat an unparseable heartbeat as dead, not immortal.
    // A far-future lastSeen (clock skew) is dead too, same reasoning as
    // livePresences above: negative age is neither NaN nor >= the sweep
    // threshold, so without this it would never be swept.
    .filter(r => { const a = ageMs(r, nowMs); return Number.isNaN(a) || a >= PRESENCE_SWEEP_MS || a <= -FUTURE_SKEW_MS; })
    .map(r => r.sessionId);
}
