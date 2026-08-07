# P&ID Tag Register — extracting the tag-extraction core

**Date:** 2026-08-07
**Status:** approved, ready for an implementation plan

## Goal

Move the P&ID Tag Register's tag-extraction logic out of the gitignored tool and
into a tracked, tested module, without changing what it produces.

## Why this first

The register holds the drawing numbers and families that the Comments Hub and
Decision Register link against. It is the foundation of the suite and it has the
least protection: ~3,656 lines in `tools-src/pid-tag-register.html`, which is
**gitignored**, so every line in it is both untested and invisible in git
history. It has already cost a morning once (see the 2026-08-03 data-loss
incident) and hardening work on 2026-08-07 found a real defect in its merge that
only became testable after extracting four predicates.

Tag extraction is the right first slice because it decides *what the data is*.
Every tag, PAC/FC classification and clash downstream comes from it, and a
regression there corrupts every drawing imported afterwards — silently.

## Scope

**In:** `extractTagsFromText` and `resolveFC`, plus the `TAG_EXACT` and
`TAG_FUZZY` regexes and the pipe-material list they depend on. Those patterns
are algorithm, not Wessex Water reference data, so they move with the code.

Call-site survey (2026-08-07) confirms this is a small, clean cut:

| Function | References outside its own definition |
|---|---|
| `extractTagsFromText` | **1** — `handlePIDFiles`, line 1370 |
| `resolveFC` | **2** — both inside `extractTagsFromText` |
| `getPACLabel` | **0 — dead code** |
| `slimTag` | 2 — `snapshotRev`, `seedRevHistoryFromTags` |

**Out, deliberately:**

- **`getPACLabel` — dead.** Nothing calls it. It should be deleted rather than
  carried into a new module, but deleting it is not this piece of work; flag it
  and remove it separately so the deletion is visible on its own.
- **`slimTag` — wrong slice.** Its only callers are state functions, so it
  belongs with the merge/state extraction, not with tag extraction. Moving it
  now would cross the boundary this slice is drawing.
- Revision detection, merge/state, families and clashes — each its own slice.
- Filling the 52 missing DS310 codes (see *Deferred* below).

## The confidentiality constraint that shapes the design

`assets/js/` is served **unencrypted at a public URL** — that is precisely why
the tools themselves are encrypted by `scripts/lock-tools.mjs`. The tag logic
depends on three Wessex Water reference tables totalling ~130 lines:

| Table | Size | Content |
|---|---|---|
| `FC_LOOKUP` | 214 codes | function code → category |
| `FC_DESCRIPTIONS` | 105 codes | function code → description |
| `PAC_LOOKUP` | 39 codes | process area code → name |

**Decision (owner, 2026-08-07): the tables do not move.** Extracting them would
publish Wessex Water's DS310 reference data at a known public URL. The functions
move; the tables are passed in.

This has a second consequence that must not be forgotten: **DS310 data cannot go
into committed test fixtures either.** Tests use fictional lookups.

## Architecture

New module `assets/js/pid-core.js` — pure, no DOM, no File System Access,
`node --test`-able, matching the existing `hub-core.js` / `pid-comments.js`
conventions.

```js
// lookups: { fc: {CODE: category}, fcDescriptions: {CODE: text}, pac: {CODE: name} }
// Any missing table degrades to {} rather than throwing.

extractTags(text, { drawingName, revision, lookups })
  -> { confirmed: Tag[], review: Tag[], likelyScanPDF: boolean }

resolveFC(fc, lookups)  -> { cat, desc }
```

`resolveFC` is exported only because it is worth testing directly; the tool has
no need to call it.

`Tag` keeps its current shape exactly: `{ tag, pac, fc, id, desc, drawing,
revision, type, isClash, isReview }`.

The tool retains its tables and calls `PidCore.extractTags(text, { drawingName,
revision, lookups: { fc: FC_LOOKUP, fcDescriptions: FC_DESCRIPTIONS, pac:
PAC_LOOKUP } })`.

### Why injection rather than a second gated file

A third location for the tables would keep them out of git while splitting the
tool across two encrypted files — more places to look, and the tables still
untracked. Injection puts the *algorithm* under test and version control, which
is where the defects live, and leaves the data exactly where it is today.

## Behaviour preservation

There are no tests today, so the real risk is not the new code — it is changing
behaviour silently during the move. The defence is characterisation, done
**before** any extraction:

1. Build a corpus exercising every branch readable in the current function:
   en/em-dash normalisation, `--` collapsing, the three re-join rules, exact
   matches, fuzzy matches, the `likelyLineNum` review path, dedup via `seen`,
   and the empty/`likelyScanPDF` case.
2. Run the corpus through the **current** function in a browser and capture the
   output as golden fixtures.
3. Extract, then assert the new module reproduces those fixtures exactly.

Golden fixtures are generated with fictional lookups so they can be committed.

## Testing

`tests/pid-core.test.js`, using fictional lookups (`{ fc: { XX: 'widget' } }`):

- **Normalisation** — en dash, em dash, figure dash, horizontal bar, `--+`,
  lower-case input.
- **Re-join rules** — the three `.replace()` passes that repair tags split
  across whitespace in extracted PDF text.
- **Exact path** — `TAG_EXACT` matches populate `confirmed`, with `pac`/`fc`/`id`
  split correctly and `resolveFC` applied.
- **Review path** — `likelyLineNum` (single-digit PAC plus a pipe-material FC)
  routes to `review`, not `confirmed`.
- **Fuzzy path** — `TAG_FUZZY` normalises separators; an all-digit middle group
  is rejected; results always land in `review`.
- **Dedup** — a tag seen by the exact pass is not re-added by the fuzzy pass.
- **`likelyScanPDF`** — true only when nothing at all was found.
- **Hostile input** — `null`, `undefined`, numbers, objects, a 100k-character
  string, and text with no tags all degrade rather than throw. This matches the
  posture already established across `hub-core.js` and `pid-comments.js`.

## DS310 conformance — local only

`scripts/check-ds310.mjs` reads the gitignored tool's tables and a local copy of
DS310 Appendix C, and reports:

- DS310 primary function codes the tool does not classify,
- tool codes absent from DS310,
- classified codes carrying no description.

It is **not** part of `npm test`: it needs both a gitignored file and a standard
we have agreed not to commit. It is a tool the owner runs when Appendix C is
reissued. It must fail with a clear message, not a stack trace, when either
input is missing.

## Deferred

**The 52 unclassified DS310 codes** (`GATE`, `LIFT`, `PLC`, `SCADA`, `UV`,
`HEAT`, `TW`, `ALM`, the `VE`/`VI`/`VIT`/`VR`/`VS`/`VT`/`VY`/`VZ` vibration
family, and others). They still extract as tags — they fall to `cat: 'other'`
with the code as its own description — so this degrades classification quality,
not data.

Filling them is data entry against Appendix C, not logic. It is deliberately out
of scope here because adding codes changes output, which would make the
characterisation comparison meaningless. Do it as a follow-up commit where the
diff is purely data.

Also unresolved: 14 tool codes absent from DS310's primary list (`ESD`, `SE`,
`SR`, `SS`, `SY`, and an `N`-family). These may be legacy or from another
revision — do not delete them without asking.

## Risks

- **Silent behaviour change during the move.** Mitigated by characterisation
  fixtures captured before any edit.
- **The tool's edits are invisible in git.** `tools-src/` is gitignored, so the
  call-site change cannot be reviewed in a diff. Mitigated by the fact that
  there is exactly **one** call site, so the tool's side of this change is a
  single delegating line, verified in a browser.
- **Regex behaviour is subtle.** `TAG_EXACT` and `TAG_FUZZY` use `lastIndex` and
  global flags; a shared regex object holding state between calls is a real
  hazard. The extracted module must not leak `lastIndex` between invocations,
  and a test must cover calling `extractTags` twice in a row.
