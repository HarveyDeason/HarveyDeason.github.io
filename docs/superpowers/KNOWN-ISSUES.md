# Known Issues

Defects that are understood, reproducible, and deliberately not fixed yet. Each has a skipped test that will start passing when it is fixed — un-skip it then.

---

## Millisecond `updatedAt` tie makes `mergeById` non-commutative

**Found:** 2026-08-03, by the merge-convergence property tests
**Severity:** Low — needs a timing coincidence, and costs one person's edit rather than any structural data
**Tests:** `tests/merge-properties.test.js` — the two `DEFECT: ... tie on updatedAt` tests, skipped
**Code:** `mergeById` in `assets/js/hub-sync.js`

### What happens

`mergeById` keeps whichever record has the later `updatedAt`. On an **exact** tie it keeps whichever appeared first in `[...(a||[]), ...(b||[])]` — which is argument order, i.e. which side the caller happened to treat as "local" versus "disk". Nothing about the records themselves decides it.

So `merge(a, b)` and `merge(b, a)` can permanently disagree about a tied record's content, and two clients can settle on different text for the same comment.

### When it can actually bite

Two people editing **the same record** and saving within the **same millisecond**. Ordinary typing will not do this. It is most plausible where a batch operation stamps one `nowIso` across many records — a bulk intake import, or a multi-row edit.

Impact is one person's edit being silently overwritten, which is the same failure mode the save-time conflict prompt already exists to catch — and that prompt fires on `updatedAt` being *newer*, so it does not catch an exact tie.

### Why it is not fixed

A content-based tiebreak was implemented and reverted, because it made things worse.

These records are **not static once merged**: `resequenceRefs` in `hub-core.js` derives `ref` and `refIssued` from the record set and writes them back onto the records. A content tiebreak therefore has to choose between an already-resequenced copy and the same record's still-raw original at the same `updatedAt` — and can pick the raw one, silently undoing the resequencing and drifting `refCounter` upward on every re-merge. That is a worse and much harder-to-diagnose defect than the one being fixed.

Tie-breaking on `id` does not help either: a tie is by definition two copies that already share an `id`.

### What a real fix looks like

Either a tiebreak that is stable under fields other code derives and writes back (e.g. comparing only the authored fields, ignoring derived ones), or stopping `mergeById` being reused for records that carry derived fields. Both are design changes rather than a patch, which is why this is logged rather than rushed.

### Workaround

None needed day to day. If it is ever suspected, the audit trail records both edits — history is a top-level collection specifically so a record losing a merge cannot take its history with it — so the overwritten text is recoverable.
