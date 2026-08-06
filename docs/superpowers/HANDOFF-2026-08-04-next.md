# Handoff — pick up here

**Updated:** 2026-08-06
**Suite:** 545 tests — 543 passing, 0 failing, 2 skipped (the skips are the logged
`mergeById` tie issue, not a problem)
**`main` has the hardening work merged and is `ahead 6`, NOT pushed.**

Read this, then the plan named under whichever item you pick up.

---

## Read this first: two things about the working tree

**1. `main` is ahead 6 and unpushed.** The hardening merge is local only. Nothing
is live yet.

**2. `tools-src/` is gitignored, so it does NOT follow branch switches.** Right
now `tools-src/comments-hub.html` contains the *photo* work (Task 3 of the
embedded-photos plan) even though `main` does not have the matching
`assets/js/` changes — those live on the `embedded-photos` branch.

**Do not run `lock-tools.mjs` from `main` as things stand.** You would publish a
tool that calls `collectPhotoImages` and passes an images map to a renderer that
does not accept one. It degrades quietly rather than breaking, but it is not
what you want shipped. Switch to `embedded-photos` first, or merge it into
`main`, before publishing.

---

## Immediate: finish embedded photos

**Branch:** `embedded-photos` (4 commits, not merged, branched off the *old* main)
**Plan:** `docs/superpowers/plans/2026-08-04-embedded-photos.md`
**Done:** Tasks 1, 2 and 3. **Next:** Task 4 (verification and publish).

Per-product *and family* comment logs carry their photos inside the workbook, so
someone reading the log in ACC sees them without the shared folder.

**Already decided — do not re-open:**
- **Thumbnails only** (320px, ~25 KB each). Full-size images stay in `Photos/`.
- **Family workbooks embed photos too** *(decided 2026-08-06, revised from the
  original per-product-only scope)*. A family member has no individual
  workbook — its comments live on a sheet inside the family file — so under the
  old scope any product in a family would have shown no photos anywhere. Each
  row carries its own comment's photos.
- **The Master Log and the filtered export stay text-only**, so the Master Log
  stays light as it accumulates every comment across every product for years.
- **Embed every photo on a comment**, with a 2500-image failsafe cap purely to
  stop a pathological case exhausting browser memory mid-export.

**The rule that matters:** a missing or unreadable thumbnail must never fail an
export — fall back to the filename text and carry on.

**Task 4 is verification and it needs a human.** None of the photo work has been
run in a browser or opened in real Excel:

1. Regenerate against the real shared folder — a product with photos, a family,
   and one where you have deliberately deleted a thumbnail.
2. Open the logs in Excel: images visible, rows readable, sort and filter still
   work with images present.
3. Check file size against expectation (~25 KB per photo).
4. Confirm the Master Log is unchanged and still light, and that the Decision
   Register's exports are unaffected (shared renderer).
5. Then publish — **you run this**, it prompts for the workshop code:
   `node scripts/lock-tools.mjs`, then commit `tools/` and push.
   **`assets/js/` and `tools/` must ship in the same push.**

---

## Done since the last handoff

**Embedded photos Task 3** — the tool reads the thumbnails its rows declare from
`Photos/<ref>/thumbs/`, strictly `create: false`, one cache per regeneration
pass with misses cached too. Every failure logs and falls back to filename text.

**Hardening Tasks 4, 5 and 6 — complete and merged to `main`.**
Report: `docs/superpowers/HARDENING-2026-08-03.md`. It leads with what is *not*
verified; read that section before treating any of it as proof.

- **Task 4 (scale)** found no correctness defects at 10,000 comments / 50,000
  tags. It did flag three `O(n·m)` shapes — `commentRow`, `buildFamilyWorkbookModel`
  and `expandFamilyPatterns`. None bite today; `expandFamilyPatterns` is the one
  most likely to bite first as the P&ID register grows past 4,600 tags.
- **Task 5 (clock skew)** found a real defect and **it is fixed**: every merge
  compared ISO timestamps as plain strings, so `'...10:00:00.500Z'` sorted
  *before* `'...10:00:00Z'` and an offset timestamp was never parsed at all. The
  genuinely later record lost, silently. `tsCompare` in `hub-sync.js` now
  decides every timestamp comparison. Clock skew alone never triggered it —
  it needs format diversity (a hand-edited ledger, an import) — but the failure
  profile was silent and collective, so it was fixed rather than logged.

---

## Known issues, deliberately open

`docs/superpowers/KNOWN-ISSUES.md` — `mergeById` is not commutative when two
edits tie on the exact same `updatedAt` millisecond. Two tests are skipped for
it. The obvious content-based tiebreak was tried and **reverted** because it
interacted badly with derived `ref` fields. Needs a design change, not a patch.

Also logged in the hardening report, not fixed:
- A machine hours ahead silently discards colleagues' edits for the skew window,
  then self-heals. Ordinary last-write-wins — but nothing tells the user their
  save was overwritten. **A product decision worth making deliberately.**
- `backupFileName` truncates to whole seconds, so two saves in the same second
  collide and the second overwrites the first.

---

## Backlog, roughly in value order

1. **Product link integrity** — plan written:
   `docs/superpowers/plans/2026-08-03-product-link-integrity.md`. Records
   remember the product *name* alongside the id, plus a bulk repair screen.
2. **Delete-time warning** — "3 decisions and 12 comments reference this family"
   before deletion. Needs to read `brain-data.json` too.
3. **Product dossier** — one pack per standard product. Build it as a
   **per-product state assembler**, not a report generator: the long-term
   lifecycle view is the same assembly plus a document→phase mapping.
4. **Extract and test the P&ID core.** ~3,000 lines of untested HTML holding the
   data every other tool links against. It already cost a morning once.

---

## Things to know before touching anything

- **Publishing needs Harvey.** `tools-src/` is gitignored; the published tools
  are the encrypted `tools/*.html` from `node scripts/lock-tools.mjs`, which
  prompts for the workshop code. **`assets/js/` and `tools/` must ship in the
  same push.**
- **The P&ID register lost data on 2026-08-03.** Six safeguards protect it (see
  `docs/superpowers/plans/2026-08-03-pid-register-safety.md`). Do not touch
  `clearAll`, `saveToFolder`, `readRegisterJSON`, the backups or the
  destructive-save guard without strong reason.
- **A failed read must never authorise a write.** That bug class caused the data
  loss. Check for it before adding any new read-then-write path.
- **Harvey is demoing these tools to colleagues who will start using them.**
  Polish and robustness beat architecture right now.
