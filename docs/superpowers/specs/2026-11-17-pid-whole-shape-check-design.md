# P&ID symbol check, phase 3: is each drawn shape the standard symbol, all of it?

**Date:** 2026-11-17
**Status:** approved by the owner 2026-11-17 ("yep approved"). Plan next.
**Scope note (owner asked, 2026-11-17):** no PDF format carries symbol
identity. Plant 3D and AutoCAD PDFs carry text (tags) but symbols only as
linework. So this phase judges every sheet with linework: Plant 3D, AutoCAD
and printed sheets. Contractors' sheets are where flags are expected; on our
own Plant 3D sheets the gate asks for almost none. Scans wait for phase 6,
which gives them linework.
**Replaces:** the *Phase 3: unrecognised shapes* section and Roadmap row of
`2026-11-16-pid-every-pdf-format-design.md` (the governing spec). Everything
else there stands.
**Builds on:** phase 1 (`bf0f802`) and phase 2 (`24be2c1`, plan and Outcome in
`docs/superpowers/plans/2026-11-16-pid-symbols-first-phase2.md`).

## Intent

The tool exists, in the owner's words, **to find what is and isn't compliant
with the standard symbols**. Today it asks: *which standard symbol fits best
here?* It should ask: *is this drawn shape the standard symbol, all of it?*

The owner tried two printed contractor sheets (P1, P2) on 2026-11-17. This is
what he saw:

| Case | What the check did | Why |
|---|---|---|
| **Pumps** drawn without the legend's base | read as an actuator | the circle alone matches the actuator, and the pump's other ink is never asked about |
| **Valves with a handwheel or lever** | boxed on the body only | the legend's operator symbol is too plain to search for, so the operator is left unexplained, silently |
| **Two flowmeters** with one line drawn short (0.80 of the line on the drawing) | dropped | phase 2's "every line 85% drawn" rule rejects them, and rejected hits are thrown away |
| **Non-standard bubbles** | read as tag bubbles (fixed in phase 2 Task 9 by "a bubble needs writing"), or not marked at all | no standard bubble explains them, and nothing marks a shape no standard symbol explains |
| **A dashed line** | one dash read as a flow arrow | the dash matches the arrow, and the dashed line running on past it is never counted |

**The common cause, found in the code.** `scorePlacement` scores the drawing's
ink **inside the placed symbol's own box** only. Ink beyond the box, such as a
lever, a pump's discharge, or a dashed line running on, is never held against
the symbol. A symbol can therefore score 1.00 while the shape it sits in is
not that symbol.

### The owner's rulings (2026-11-17)

- **Flag what is not to standard; that is all.** There is no accept step, no
  approved-exception workflow, and no "modified" category. Each shape is
  either **standard** or **not to standard**. A flagged shape names the
  closest standard symbol and its score as a hint to the reader, not as a
  verdict.
- **Judged against the legend only.** The tool does not know the process, so
  it cannot say a symbol is in the wrong place. One limit follows, and the
  owner accepted it: a non-standard shape that happens to look exactly like
  another standard symbol (a bare circle where a pump was meant) reads as
  that symbol. The answer key shows how often this happens.
- **Approach A** (below).
- **Answer key: mark-ups on PDF copies.** The owner can supply more
  contractor sheets that the check has never been tuned on.
- **Hatched double-line pipe** (lagged, or trace-heated and lagged) is
  linework, not a symbol (ruled during phase 2).

## Goals

1. Every **symbol-sized shape** on a sheet with linework is judged
   **standard** or **not to standard**, whether or not the sweep names a
   symbol in it.
2. A shape is **standard** only when standard symbols explain **all** of its
   ink: one symbol, or a valve body plus a standard operator on its stem.
3. A flagged shape says **why**, in a short phrase:
   - "ink left over" (extra lines, a lever not in the legend);
   - "line drawn short (80%)";
   - "no standard symbol fits".
   It also names the closest symbol and its score where there is one above
   the near-miss floor (0.3).
4. Every change from here on is **measured against the owner's answer key**,
   not by Claude's eye.
5. No tag verdict changes. Tag-led pairing is untouched.

## Non-goals

- Judging a symbol's place in the process.
- Accepting or approving a non-standard symbol.
- Judging the member within a family. The check confirms family, as now.
- Shapes larger than any legend symbol could be drawn: tanks, vessels,
  frames, tables and note boxes. They are not judged and are not flagged.
- Scans (phase 6) and reading tags on printed sheets (phase 5).

## Anti-goals

- **A real standard symbol flagged** because of linework that is not part of
  it: a pipeline, a signal line, a leader or a lagged-pipe hatch. Flags the
  owner learns to ignore are worse than no flags.
- **A non-standard shape passed as standard** because one part of it matched.
  This is today's failure.
- **Claude judging its own work by eye.** The phase 2 gate under-counted
  false hits (P1 0 of 14 by Claude's eye, 3 of 14 by the owner's; P2 5 of 32
  against 10 of 32). Every by-eye judgement in this phase is the owner's,
  through the answer key.
- **Client data in the repository.** The answer key, marked PDFs, pictures
  and gate outputs stay in `../pid-symbol-spike/`.

## Constraints

As the governing spec, unchanged:

- Nothing writes `register.json`.
- No client data in `assets/js/`, tests or fixtures; tests use invented
  sheets.
- Zero build, pdf.js 3.11.174 vendored; no new dependency and no OCR
  library without asking.
- Pure modules with `node --test` coverage.
- `tools-src/` gitignored, changed only by anchored patch after a backup; the
  owner runs `node scripts/lock-tools.mjs`.
- Owner's terminal: PowerShell 5.1; owner steps as numbered steps naming the
  buttons.
- Commit only when the owner asks.
- The 60 s per sheet gate stands.

## Approaches considered

**A. Judge each found symbol against its whole shape (chosen by the owner).**
- Keep the sweep as the finder.
- Split the sheet's linework into shapes, cutting at pipelines, signal lines
  and leaders.
- Hold each found symbol (and an operator on its stem) against the whole
  shape it sits in: all ink explained means standard; any left over means
  flagged.
- Shapes no found symbol touches are flagged, with the closest symbol as the
  hint.
- **Pros:** keeps phases 1 and 2 and every tag verdict intact.
- **Cons:** a shape the sweep never names is described only by the weaker
  closest-symbol search.

**B. Split first, then search the library for each shape.**
- Cleaner, and the most literal reading of "split the drawing into shapes".
- **Cons:** it replaces the sweep tuned through two gates, so earlier results
  could move. It is also slower: every shape tried against every symbol.

**C. Rub out what is explained, flag the leftover blobs (pixels).**
- Simplest, and it would carry over to scans.
- **Cons:** it cannot tell a valve's lever from a separate object beside it,
  or cut cleanly at pipelines. It would flag places but could not say "this
  valve is not to standard".

## Design

### 1. Shapes (`pid-sheet-read.js`, pure)

`sheetShapes(paths, options)` gives `{ shapes, lines }`.

**Input.** The ink the sweep already uses: paths with letters removed (comment
and printed sheets), with the title block skipped (`titleBlockBox`).

**Linework is not part of a shape.** Each of these is a **line**:

- **Long straight runs.** Collinear pieces joined across gaps up to `RUN_GAP`
  (2 pt), longer than any legend line could be drawn (tuned; start at the
  longest line in the library times `maxScale`). These are pipelines and
  signal lines.
- **Dashed runs.** Three or more short collinear dashes with even gaps. The
  dashed-arrow case is one of these.
- **Lagged pipe.** Two parallel long runs with a row of short identical
  diagonals between them. Phase 2's "rows of identical shapes are not
  letters" logic finds the row.
- **Connectors.** A straight piece that runs from one shape to another, such
  as a leader to a tag bubble or the line from a pump to its motor bubble.

Where a line runs **into** a symbol, it is cut at the shape's edge.

Where a line runs **through** a symbol (a pipe drawn continuous through a
flowmeter body), the part of it that a found symbol's template explains
belongs to the shape. The rest stays line.

**Shapes.** Connected groups of the remaining pieces: pieces whose ends or
crossings lie within a join tolerance (start 0.5 pt, as `STROKE_JOIN`).

- A **closed outline holding writing** (a bubble) is a shape of its own, even
  when a connector touches it.
- A **valve stem** joins its operator to its body: both are one shape.
- **Too small** (below the smallest legend symbol at `minScale`): ignored.
  Dots and tick marks are in this group.
- **Too large** (above the largest at `maxScale`): not judged, and listed on
  the overlay only in the debug view.

Each shape: `{ id, box, pieces: [segment indexes], ink: area in px at the
window scale }`.

**Which sheets.** Every sheet the sweep runs on: Readable (text layer),
comment and printed sheets. One splitter serves all of them; the tuning set
holds one of each kind (C, M, P1, P2). Line classes are used only by the
splitter and the judge. **The sweep's ink is unchanged**, so no phase 1 or 2
hit can be lost to a line rule. (My call, after the builder review.)

**Symbol-sized** is one band for every symbol, from the smallest legend
symbol at `minScale` to the largest at `maxScale`. That is the same band the
answer-key copies box. Tanks, vessels and other large equipment fall above
it. They get no box, and the owner is asked not to box them.

### 2. Judging a shape (`pid-symbol-check.js`)

Run after the sweep, inside `checkSheet`, on the same windows and
rasteriser.

1. **Explanations.** Each sweep hit (merged, the winner) belongs to the shape
   that shares most of its template ink. A hit that shares ink with two shapes
   joins them: a symbol cut in two by the splitter is one shape.
2. **Near-misses are kept.** Today the sweep drops any placement under 0.90
   and any hit failing `LINE_MIN`. Phase 3 keeps, per shape, the best
   placement scoring at least the near-miss floor (0.3), with its forward and
   backward scores and `weakestLine`. Plain-shape rejects and Task 9 rejects
   are kept the same way. They never become listed symbols; they are only a
   flagged shape's hint.
3. **Operators.** Symbols marked **operator** in the library (see *Library*)
   are searched for only inside a shape that already holds a **body**: any
   swept hit that is not itself an operator. Penstocks and dampers carry
   operators too, so it is not limited to valves, and no second flag is
   needed.
   - An operator hit by the sweep with no body in its shape is flagged
     `left-over`. A pump circle read as an actuator therefore never passes as
     standard on its own.
   - If no symbol in the library is marked operator, the summary and report
     say "Operators not marked in the library: valves with an operator will
     be flagged".
   - The operator search works as follows. They
   are placed on the shape's leftover ink, within one operator's size of the
   body, scored as now (two-way score at least 0.90, `LINE_MIN` on every
   line). A placed operator explains its ink and the stem joining it to the
   body. Being too plain to sweep (`simple`) does not stop an operator being
   checked here.
4. **Coverage.** The shape's ink is rasterised once. Its explained share is
   the part lying within the ink tolerance (`inkTol`) of the **union** of the
   placed templates of its listed symbols (merge winners, not their "one of"
   alternatives) and operators. For "closest", each candidate's own explained
   share is measured alone.
   - **Bubbles** are judged like any shape. A bubble is standard when a legend
     bubble (`flags.bubble`, matched by `matchBubble` as now) explains its
     outline. The writing inside is letters, not ink. Bubbles are boxed in
     the answer key like other symbols.
   - **Plain symbols** (`simple`, or plain-rejected in the sweep) are tried
     here as whole-shape matches on shapes nothing else explains. Knowing the
     whole shape is what makes a plain shape safe: a box symbol is standard
     only if it explains all of a shape's ink both ways at least `plainBack`
     (0.96) and nothing runs on. Drawn-to-suit (`stretch`) and manual
     symbols cannot be matched by template. A shape that is one of them will
     read `no-fit`, and the answer key shows how often. If it is often, a
     "not judged" state is the fix, raised with the owner then.
     (My calls, after the builder review.)
5. **Verdict.**
   - **Standard:** explained share at least `SHAPE_EXPLAINED` (start 0.97,
     tuned on the answer key), every hit at least 0.90, every line at least
     `LINE_MIN`.
   - **Not to standard:** otherwise, with `why`:
     - `left-over`: a hit at least 0.90 but ink unexplained;
     - `short-line`: the best hit failed `LINE_MIN`, giving its share;
     - `no-fit`: no hit; the near-miss is the hint, or "no close symbol"
       below 0.3.
   - **Closest:** the hit or near-miss that explains the most of the shape's
     ink, not the one with the highest template score. For a pump circle with
     extra ink, a pump that explains more of the shape is named before an
     actuator that explains only the circle.
6. **Time.** It shares the existing deadline. Shapes not judged by then are
   listed "not judged: time limit", never as standard.

### 3. Result shape

`checkSheet` returns, as well as today's fields:

```js
shapes: [{
  id, box,
  standard: true | false,
  why: 'left-over' | 'short-line' | 'no-fit' | null,
  explained: 0.0..1.0,          // share of the shape's ink explained
  symbols: [indexes into symbols],   // the standard symbols it holds
  operator: { name, score } | null,
  closest: { name, tagId, score, explained } | null,
}]
```

`symbols` keeps its meaning. Each symbol gains `shape: id` and
`standard: true | false` (that of its shape). Tag verdicts are unchanged. A
tag beside a valve whose shape is flagged still reads OK when the family is
right. The flag is a separate column, because the tag check confirms family
and the shape check confirms the drawing.

### 4. Library: operators

Operators are marked in the library, not in code: legend names are client
data and stay out of the repo.

- **Flag.** `updateSymbol` accepts `operator: boolean`, saved in `flags` like
  `simple` and `stretch`, carried over on re-import like `simple`.
- **Symbols tab.** An **Operator** tick beside **Simple**, and a **Mark the
  whole group as operators** button on a legend group's heading. The owner
  ticks the operator group once.
- **Gate script.** It takes `--operators "<legend group>"`, as it takes
  `--instrument`.

### 5. Screen and report

- **Overlay:**
  - standard symbols as now;
  - flagged shapes boxed in **amber**, with a short label (`not to standard`);
  - shapes not judged (time) in grey.
- **Sheet summary:** "N standard symbols. M shapes not to standard." The
  tag lines follow as now.
- **List:** **Not to standard** first, since that is the tool's purpose. Each
  row gives the why, the closest symbol, its score, and a jump to the box.
  Then tags and untagged symbols as now.
- **Report Excel, Symbols sheet:**
  - one row per shape;
  - new columns **To standard?** (Yes / No), **Why**, **Closest**,
    **Score**;
  - a standard shape with an operator shows it, for example "BALL + MANUAL
    ACTUATING ELEMENT" (names come from the owner's library at run time,
    never from code).
- **Report PDF:** amber boxes as on screen; the summary line gains the
  not-to-standard count.

### 6. The answer key

The owner marks 5 to 10 real sheets once. Every later change is scored
against them.

**Sheets.**
- P1 and P2, plus sheet C (Plant 3D) and sheet M: the **tuning set**.
- 2 to 4 contractor sheets the check has never been run on, ideally from
  other firms, supplied by the owner: the **held-out set**.

**Making the copies (private, `../pid-symbol-spike/answer-key/`).**
- After step 1 of the build (shapes) exists, the gate script writes each
  sheet's shapes and sweep names to JSON.
- A private Python script (PyMuPDF, run `python -I`, as `outline-copy.py`)
  writes a copy of each sheet with a **rectangle comment** round every
  symbol-sized shape:
  - `STANDARD: <name>` where the sweep named it;
  - `NOT STANDARD: closest <name>` or `NOT STANDARD` otherwise.

**What the owner does (in Bluebeam or Acrobat):**
1. Open each copy. Look at every box.
2. Where a comment is wrong, change its first word (`STANDARD` or
   `NOT STANDARD`) or the name.
3. Delete any box that is not a symbol.
4. Draw a rectangle round any symbol with no box and type `STANDARD: <name>`
   or `NOT STANDARD`.
5. Save, and say which sheets are done.

A box left as it was counts as agreed. The risk of nodding a wrong guess
through is accepted, and every box is there to look at.

**Reading it back.** The gate script gains `--key "<marked pdf>"`:
- it reads the rectangle comments with pdf.js (as `sheetComments` does);
- names are matched to the library loosely (`normName`, then
  `searchSymbols`);
- a name it cannot match is listed, not guessed;
- a key shape and a tool shape are the same when their boxes overlap by at
  least half the smaller box (tuned if the owner's boxes are loose);
- matching is one to one, greatest overlap first. A tool shape spanning two
  key boxes matches one; the other key box counts as missed. Two tool shapes
  in one key box: the larger overlap matches, and the other counts as a tool
  shape the owner did not box. Splitter errors show in the counts rather
  than being hidden by them.

It prints counts only. Names and boxes are printed only with `--verbose`, as
today:

- key boxes: standard, not standard;
- **not to standard caught:** the owner's NOT STANDARD shapes the tool
  flagged;
- **false flags:** the owner's STANDARD shapes the tool flagged;
- **missed:** the owner's boxes with no tool shape;
- **not a symbol:** tool shapes the owner deleted that the tool flagged;
- **named right:** the owner's STANDARD shapes whose tool name is the same
  family.

**Rules for using it.**
- Thresholds are tuned on the tuning set only.
- The held-out set is run **once**, when tuning is finished, and its numbers
  are written up whatever they are. After that it is no longer held out. A
  later change needs new held-out sheets from the owner before the same
  claim can be made again.
- Pictures for the owner (`context.py`, private) are offered with every gate
  report. Claude does not report its own by-eye counts as the gate.

## Phase 3 gate

Measured with `--key`. Counts only in the plan's Outcome.

| Line | Tuning set | Held-out set |
|---|---|---|
| Owner's NOT STANDARD shapes flagged | at least 90% | at least 80%, reported whatever it is |
| Owner's STANDARD symbols flagged wrongly | at most 1 in 20 | at most 1 in 10, reported |
| Owner's boxes with no tool shape | at most 1 in 20 | reported |
| Tool flags on shapes the owner deleted (not a symbol) | at most 1 per 20 symbols | reported |

Also required:

- **The five trial cases.**
  - The pumps on P1 and P2 flagged, closest naming a pump or the actuator,
    why `left-over` or `no-fit`.
  - Valves with a lever or handwheel standard where the operator is a legend
    operator.
  - P2's two flowmeters flagged `short-line` with their share (or standard,
    if the owner's key says that much shortness is drafting slack).
  - Non-standard bubbles flagged.
  - The dashed-line arrow gone: its dash is line.
- **No harm.**
  - A, B, C and M: every tag verdict unchanged against the phase 2 after
    files; Wrong family 0; relabel test still at least 9 of 10.
  - Plant 3D sheets: at most 1 flag per 20 symbols that the owner's key does
    not call NOT STANDARD.
- **Deleted line.** A converted copy of a Plant 3D sheet with one line of one
  standard symbol deleted (an invented edit, private): that shape flagged,
  not standard.
- **Time.** Under 60 s a sheet on a quiet machine.

## Build order

1. **Shapes** (`sheetShapes`) with tests, and the gate script writing shapes
   to JSON.
2. **Answer-key copies** written; the owner marks them (the build waits
   here). The `--key` reader with tests on an invented marked PDF.
3. **Judging**: near-misses kept, operators, coverage, verdicts; tuned on the
   tuning set.
4. **Library operator flag** and Symbols tab tick (tool glue by patch).
5. **Screen, list and report.**
6. **Gate**, held-out set last.

## Tests (invented data, `npm test`)

**Shapes**
- An invented valve on a pipeline: one shape, pipe pieces are line.
- A valve with a lever: one shape.
- A bubble with a leader to a valve: two shapes and a connector.
- A dashed line: all line, no shape.
- Two parallel lines with a row of diagonals: line.
- A pipe drawn through a box symbol: the explained part goes with the shape.
- Shapes below and above symbol size are dropped.
- Hostile input (null, NaN, huge) never throws.

**Judging**
- A symbol drawn whole: standard.
- The same symbol with an extra stroke outside its box: `left-over`.
- One line drawn 60% short: `short-line` with its share.
- An invented shape that matches nothing: `no-fit` with no closest, or one
  with a closest above 0.3.
- A body plus an invented operator flagged `operator`: standard.
- The same operator not flagged as one: `left-over`.
- A circle with extra ink: closest is the symbol that explains more of the
  shape.
- Tag verdicts deep-equal on `SHEET` and `BUBBLE_SHEET` (goal 5).

**Key reader**
- An invented PDF with rectangle comments:
  - counts right;
  - an unknown name listed;
  - a key box with no tool shape counted missed;
  - hostile comments do not throw.

**Library, view and report**
- `operator` saved and carried over on re-import.
- The amber group listed first.
- Symbols sheet columns present.

## Owner steps after phase 3

1. In PowerShell, inside `harveydeason-site`, run
   `node scripts/lock-tools.mjs`.
2. Open the tool, connect the folder, open the **Symbols** tab and press
   **Mark the whole group as operators** on the legend's operator group.
   Check the ticks.
3. Open P2 on the **Sheets** tab and press **Check symbols**. Look over the
   amber boxes.
4. Do the same on one Plant 3D sheet: there should be almost no amber.
5. Tick both, press **Export report**, then **Run**, then **Download Excel**,
   and look at the **To standard?** column.

## Risks

- **Where a pipeline ends and a symbol starts.** This is the hardest cut.
  The answer key's false flags show it directly. Starting values are the
  library's own line lengths.
- **Legend operators drawn differently from contractors' handwheels.** If
  contractors' handwheels never match the legend operator, every valve with
  one is flagged. That is correct if they are not standard, which the
  owner's key decides.
- **Nodding through pre-filled comments.** Accepted; every box is shown.
- **Time.** Rasterising every shape adds work. The judge reuses the sweep's
  windows. If the 60 s gate fails, the builder may judge only shapes near
  found symbols or on lines, list the rest "not judged", and say so in the
  Outcome with the times.
- **Held-out set of 2 to 4 sheets is small.** Its numbers are reported as
  they are, not as a pass mark the phase can be tuned to.

## Decisions

Marked **(owner)** where the owner decided, **(my call)** where I chose.

- **(owner)** Standard or not to standard; no modified category, no accept
  step.
- **(owner)** Judged against the legend only; the look-alike limit is
  accepted.
- **(owner)** Approach A.
- **(owner)** Answer key on PDF mark-ups; the owner supplies held-out
  sheets.
- **(my call)** A valve body plus a legend operator on its stem is standard.
- **(my call)** Operators are marked in the library by the owner (a tick and
  a group button), not named in code.
- **(my call)** Bubbles and connectors are separate shapes; a stem joins an
  operator to its body.
- **(my call)** Shapes above the largest symbol size are not judged.
- **(my call)** "Closest" means the symbol that explains most of the shape.
- **(my call)** Tag verdicts are unchanged by a flag; the flag is a separate
  column.
- **(my call)** A box left untouched in the key counts as agreed.
- **(my call)** Gate thresholds as in the table; the held-out set is run once
  and reported.
- **(my call)** An operator may sit on any body, not just a valve; an
  operator alone in a shape is flagged.
- **(my call)** Bubbles are judged and boxed in the key like any symbol.
- **(my call)** Plain symbols are tried as whole-shape matches; drawn-to-suit
  shapes may read `no-fit` until the key shows otherwise.
- **(my call)** The sweep's ink is unchanged; line rules serve only the
  splitter and judge.
- **(my call)** Key matching is one to one, greatest overlap first.

## Left to the builder

- `sheetShapes`' exact rules: the long-run length, dash spacing, hatch row,
  join tolerance and through-line handling, within the rules above and tuned
  on the tuning set.
- `SHAPE_EXPLAINED` and the key's box-overlap rule, tuned on the tuning set.
- How near-misses are kept without slowing the sweep.
- Exact names, signatures and worker message fields; label wording beyond
  that quoted.
