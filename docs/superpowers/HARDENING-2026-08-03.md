# Hardening results

**Effort:** 2026-08-03 (Tasks 1–3) and 2026-08-06 (Tasks 4–6)
**Plan:** `docs/superpowers/plans/2026-08-03-hardening.md`
**Suite at completion:** 545 tests — 543 passing, 0 failing, 2 skipped.

## Why this was done

Every hour of use up to this point had been by the person who wrote the tools.
That is a specific blind spot: the author knows which paths are destructive and
which folder to connect. Colleagues are about to start using these tools for
real work, they share one folder, and the failure modes are silent and
collective — one person's bad save is everyone's bad save.

The goal was to prove the shared-folder logic survives conditions far worse
than real use. It was **tests first**: production code changed only where a
test demonstrated a genuine defect.

---

## Read this part if you read nothing else: what is NOT verified

**None of this has been exercised in a browser.** The logic is hardened; the
tools are not proven end to end. Specifically not covered by any test here:

- **The DOM.** Escaping was audited *statically* — the tests scan `tools-src/*.html`
  for `innerHTML` interpolations and assert ledger-derived values pass through
  `escHtml`/`escAttr`. That proves the call is present. It does not prove the
  rendered page is safe.
- **The File System Access API.** Every folder read and write, permission
  prompt, locked file, and OneDrive mid-sync state is untested. The sync engine's
  *logic* is tested with injected fakes; the real API is not.
- **Real multi-window interaction.** Two actual browsers on one real shared
  folder, racing. The merge properties are proven mathematically over in-memory
  states; the wiring that feeds them real disk contents is not.
- **Anything in `tools-src/*.html` that is not pure logic.** Those files are
  gitignored and largely untestable by this suite. Roughly 3,000 lines of the
  P&ID tool — tag extraction, revision detection, its own merge — have no tests
  at all and hold the data every other tool links against.

Do not read a green suite as "the tools are proven." Read it as "the pure logic
underneath them behaves correctly, including under abuse."

---

## What broke, and was fixed

### 1. Refs diverged permanently between users *(Task 1, fixed 2026-08-03)*

The most serious finding. Ref assignment was **order-dependent across three or
more clients**: collisions were resolved against `ref` fields that earlier
merges had already shuffled, so `mergeState(mergeState(a,b),c)` and a different
pairing order produced different ref-to-comment mappings. Two people ended up
quoting **different refs for the same comment**, permanently, with no way to
notice.

No timestamp tie was needed. Three people numbering new comments from their own
local counters is completely ordinary use.

Fixed by resolving collisions against each comment's immutable `refIssued`
claim, making the result a pure function of the record set rather than of merge
order. Earlier-issued keeps the number.

This matters beyond the tool: refs are printed into Excel logs uploaded to ACC.
A ref that later means a different comment is a traceability break in an
already-distributed record.

### 2. A live XSS in the P&ID tool *(Task 3, fixed 2026-08-03)*

Tag names, descriptions and drawing numbers from the shared register reached the
DOM unescaped, and record ids were interpolated into inline event handlers
without escaping for the JavaScript string they compile to. A document URL
reached `href` and `window.open` with no scheme check.

This was days away from being handed to colleagues. It was not findable by using
the tool normally — only by looking for it.

### 3. Crash-on-bad-data, and a tab-hanging loop *(Task 2, fixed 2026-08-03)*

Malformed ledger data crashed merge, filtering and workbook building, and search
highlighting could hang the tab on a non-string phrase. On a shared folder, one
bad record failing to load breaks the tool **for everyone**, so these are
collective failures rather than individual annoyances.

Now: no pure function throws on any input, across `hub-core`, `hub-sync`,
`brain-core`, `hub-presence`, `hub-intake` and `pid-comments`. Degraded output
is acceptable; an exception is not.

### 4. Merges resolved backwards on mixed timestamp formats *(Task 5, fixed 2026-08-06)*

Every merge winner was decided by comparing ISO timestamps as **plain strings**.
That is correct only while all timestamps share one format:

```
'...T10:00:00.500Z'  sorts BEFORE  '...T10:00:00Z'    ('.' 0x2E < 'Z' 0x5A)
'...T11:00:00+01:00' sorts AFTER   '...T10:00:01Z'    (offset never parsed)
```

In both cases the genuinely **later** record compared as earlier, and
`mergeById` kept the stale one — silently. `detectConflict` inherited the same
fault and raised false conflict prompts against records that were actually
older.

Fixed by adding `tsCompare` in `hub-sync.js` and routing every timestamp
decision through it. The order is total and deterministic: parseable values
compare by instant, a parseable value always beats an unparseable one, and two
unparseable values fall back to string order so even garbage orders consistently
across clients.

**Reachability, stated honestly:** clock skew alone never triggers this. A wrong
clock still produces the uniform `toISOString()` shape, just with a wrong value,
and everything these tools write uses that one shape. It takes format
*diversity* — a hand-edited ledger, an import, a manually repaired record — to
manifest. It was fixed anyway because the failure is silent, collective and
unrecoverable by the user, which is the same profile as finding 1.

One deliberate behaviour change came with it: an unparseable tombstone no longer
outranks a real `updatedAt`, so garbage in the tombstone map can no longer
delete a live record. Deletion is the destructive direction; erring toward
keeping the record is the safe way to be wrong.

---

## What was tested and holds

**Merge convergence** *(Task 1)* — idempotency, commutativity in effect,
associativity in effect, tombstones winning regardless of order, history
unioning without loss, deterministic ref assignment, and convergence under many
rounds of three clients making seeded-random edits and syncing in random order.
All hold, apart from the one open issue below.

**Hostile input** *(Task 2)* — every exported pure function against `undefined`,
`null`, `0`, `''`, `[]`, `{}`, `NaN`, wrong-typed fields, duplicate ids,
self-referencing supersede chains, tombstones for records that never existed,
and adversarial strings (`<script>`, `{{7*7}}`, null bytes, RTL overrides,
10,000-character words, emoji, combining characters). Nothing throws, and text
round-trips through merge and Excel-model building unchanged — mangling would be
a bug just as much as executing.

**Scale** *(Task 4)* — 10,000 comments, 2,000 products, 200 families, 5,000
drawings, 50,000 tag entries, 5,000 history entries. Merge, filtering, workbook
building, comment counting, revision lookup and history lookup all complete and
produce correct results, checked against independently-computed expectations
rather than a second call into the function under test.

**Clock skew** *(Task 5)* — presence liveness under days ahead, days behind,
Unix epoch and year 3000; backup filename ordering under extreme skew; ref
sequencing deterministic with skewed `createdAt`.

---

## Found, deliberately not fixed

**`mergeById` is not commutative on an exact `updatedAt` tie.** Two tests are
skipped for it. See `KNOWN-ISSUES.md`. The obvious content-based tiebreak was
tried and **reverted**: records are not static once merged, because
`resequenceRefs` derives `ref`/`refIssued` from content and writes them back, so
a content tiebreak can prefer an unresequenced copy and silently undo an earlier
pass. Needs a design change, not a patch.

**A machine hours ahead silently discards colleagues' edits** for the duration
of the skew window, then self-heals once real time passes the skewed value. The
effect is per-record, not global. This is ordinary last-write-wins doing what it
is designed to do — not a code defect — but **nothing tells the user their save
was just overwritten**. That is a product decision, and worth making
deliberately before more people are on the folder.

**`backupFileName` truncates to whole seconds**, so two saves within the same
second produce the same filename and the second overwrites the first. Given the
P&ID register data loss on 2026-08-03, this is worth knowing: backups are
thinner than the count suggests under rapid saves.

**Three `O(n·m)` shapes** *(Task 4)*. None failed an assertion, and none are
user-visible today, but all three are genuine join shapes rather than `O(n+m)`:

| Location | Shape |
|---|---|
| `commentRow()` in `hub-core.js` | `products.find()` per comment — `O(comments × products)` |
| `buildFamilyWorkbookModel` | filters all comments once per member — `O(members × comments)` |
| `expandFamilyPatterns` | scans all drawings once per pattern — `O(families × drawings)` |

Measured doubling ratios were 2.4x, 3.3x and 3.0x against the ~2x a linear
operation shows. **`expandFamilyPatterns` is the one most likely to bite first** —
the P&ID register already holds ~4,600 tags and only grows. Each is a Map lookup
away from linear; none is worth doing speculatively today.

**`brain-core.js`'s decisions-export sort** still compares timestamps as
strings. Left alone deliberately: it orders rows in an export, primarily by a
business date, and decides no data outcome. Worth changing only if that file is
being touched anyway.

---

## Suite

```
545 tests — 543 passing, 0 failing, 2 skipped
```

The 2 skips are the `mergeById` tie issue above, and are intentional.

New files from this effort: `tests/merge-properties.test.js`,
`tests/hostile-input.test.js`, `tests/escaping-audit.test.js`,
`tests/scale.test.js`, `tests/clock-skew.test.js`.

---

## What would be worth doing next

In order of how much they reduce risk for people who are about to start using
these tools:

1. **Extract and test the P&ID core.** It holds the data every other tool links
   against, has no tests, and already cost a morning once.
2. **A browser pass.** Everything in the "not verified" section at the top needs
   a human at a keyboard, and no amount of node tests will substitute.
3. **Decide the skew-UX question** — whether a user should be told when their
   save was overwritten.
