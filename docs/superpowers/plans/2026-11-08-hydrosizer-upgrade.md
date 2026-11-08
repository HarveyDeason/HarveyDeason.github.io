# HydroSizer Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make HydroSizer's tank tab inlet-aware, standards-checked (WIMES 8.08, ANSI/HI 9.8) and fully explained, and give the pipe tab a flow–velocity chart.

**Architecture:** The pure maths moves into a new public, node-tested ES module, `assets/js/hydro-core.js`, following the `pid-core.js` pattern. The tool, `tools-src/hydrosizer.html`, keeps all DOM, drawing and the WIMES table. It imports the core with a deferred `<script type="module">` that sets `window.HydroCore`. The tool's existing classic script calls `window.HydroCore` from its `load` handler. Licensed data (WIMES Table 2) never enters `assets/js/`; it is passed into the core as an argument.

**Tech Stack:** Static HTML, CSS and vanilla JS. Canvas or inline SVG drawings. `node --test`. Vendored html2canvas and jsPDF. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-08-hydrosizer-upgrade-design.md`

## Global Constraints

- All levels in m above the tank floor; DN in mm, treated as internal bore; flows in l/s; volumes in m³; g = 9.81 m/s².
- Standard DN list: 25, 32, 40, 50, 65, 80, 100, 125, 150, 200, 250, 300, 350, 400, 450, 500, 600, 700, 800, 900, 1000, 1200.
- Number formatting: levels to 2 dp (m), S to 3 dp, flows to 1 dp (l/s).
- The inlet is always present, with no switch. The overflow is a toggle, off by default.
- Look: refined version of today's three-column layout, using `site.css` tokens only. Racing green primary in light mode, gilt in dark mode. Geist font. Both modes must work, and phone width (one column below 820 px) must work.
- No invented standards data. WIMES values come only from the spec's table.
- WIMES Table 2 data lives only in `tools-src/hydrosizer.html`, never in `assets/js/`. Its notes are paraphrased, not copied.
- `tools-src/` is git-ignored: edits to `tools-src/hydrosizer.html` are **not** committed. Only `assets/js/hydro-core.js`, tests, docs and the preview image are committed.
- Never run `scripts/lock-tools.mjs`, and never ask for or handle the workshop code. Harvey runs the lock step himself.
- Use the `frontend-design` skill for the visual work (Tasks 3–6).
- Preview: `preview_start {name:"site"}` serves the repo root on port 5050. Open the working tool at `http://localhost:5050/tools-src/hydrosizer.html`.

## Review Focus

1. **Blank, zero or negative inputs** (a cleared field, tank diameter 0, DN 0). The page shows "—" and marks the field, never `NaN`/`Infinity`, and the drawing doesn't break. `calcTank` returns `{ok:false, errors:[...]}`. *Test in Task 2.*
2. **Zero inflow.** Fill time is `null` (shown as "—"), not `Infinity`. The overflow check passes trivially. *Test in Task 2.*
3. **Inlet soffit exactly equal to the overflow soffit or TWL.** `controlledBy` follows a fixed tie order: inlet, then overflow, then TWL. *Test in Task 2.*
4. **A stale or unknown liquid key in localStorage** falls back to raw sewage. Storage that throws (private mode) is swallowed. *Wrap the read and write in try/catch in Task 3, and verify it in the browser.*
5. **DN outside the standard list** (an odd bore like 180, below 25 or above 1200). `nearestStandardDNs` returns `null` for a missing side, and the chart and readouts cope. *Test in Task 1.*

---

### Task 0: Safety copy of the untracked source

- [ ] **Step 1:** Copy `tools-src/hydrosizer.html` to `tools-src/hydrosizer.pre-upgrade.html` (also git-ignored). This is the only rollback, because `tools-src/` has no git history.

  **Delete this copy before Harvey runs the lock step.** `lock-tools` encrypts every `.html` in `tools-src/` and would publish it as an extra tool. Task 7 checks for it.

---

### Task 1: Pipe maths and velocity checks in `hydro-core.js`

**Files:**
- Create: `assets/js/hydro-core.js`
- Test: `tests/hydro-core.test.js`

**Interfaces:**
- Produces (all named exports, pure, none throw):
  - `G = 9.81`
  - `STANDARD_DN: number[]` (the list in Global Constraints)
  - `pipeArea(dnMm: number) -> number` (m²)
  - `velocityFromFlow(qLs: number, dnMm: number) -> number` (m/s; 0 if DN ≤ 0)
  - `flowFromVelocity(vMs: number, dnMm: number) -> number` (l/s)
  - `nearestStandardDNs(dMm: number) -> {below: number|null, above: number|null}`: the nearest standard DNs strictly below and strictly above `dMm`
  - `checkVelocity(v: number, limits: {min:number, max:number, maxAdvisory?:boolean} | null) -> {status: 'pass'|'below'|'above'|'none', advisory: boolean}`. `limits === null` gives `'none'`. `advisory` is true only when the status is `'above'` and `limits.maxAdvisory` is set.
  - `flowRangeInBand(dnMm: number, limits) -> {qMinLs: number, qMaxLs: number} | null` (null when `limits` is null)
  - `dnsFittingFlow(qLs: number, limits, dns: number[] = STANDARD_DN) -> number[]`: the DNs whose velocity at `qLs` is within [min, max], ascending

- [ ] **Step 1: Write failing tests** in `tests/hydro-core.test.js`, in the `pid-core.test.js` style (`node:test` and `node:assert/strict`, `approx(a, b, tol = 1e-6)` helper). They cover the cases below. The limits here are inline test fixtures, not imported.
  - `velocityFromFlow(10, 100)` ≈ 1.273240; `flowFromVelocity(1.27324, 100)` ≈ 10 (tol 1e-3)
  - `nearestStandardDNs(200)` → `{below:150, above:250}`; `(180)` → `{below:150, above:200}`; `(25)` → `{below:null, above:32}`; `(1500)` → `{below:1200, above:null}`
  - `checkVelocity(1.0, BAND)` → pass; `0.5` → below; `2.0` → above with `advisory:false`; `1.3, ADVISORY_BAND` → above with `advisory:true`; `(1, null)` → none
  - `flowRangeInBand(200, BAND)` gives `qMinLs ≈ 0.7·π·0.01·1000 ≈ 21.991` and `qMaxLs ≈ 59.690`
  - `dnsFittingFlow(40, BAND)` deep-equals `[200, 250]`. (At 40 l/s: DN150 ≈ 2.26 is above the band; DN200 ≈ 1.27 and DN250 ≈ 0.81 are in it; DN300 ≈ 0.57 is below it.)
  - `velocityFromFlow(10, 0)` === 0; `velocityFromFlow(NaN, 100)` === 0

- [ ] **Step 2:** Run `node --test tests/hydro-core.test.js`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement the exports in `assets/js/hydro-core.js`. Use a header comment in the `pid-core.js` voice saying: pure, served publicly, and WIMES data must not live here. Coerce non-finite inputs to 0.
- [ ] **Step 4:** Run `npm test`. Expected: all pass, including the existing suites.
- [ ] **Step 5: Commit**
  ```bash
  git add assets/js/hydro-core.js tests/hydro-core.test.js
  git commit -m "feat(hydro): pure pipe maths and velocity checks in hydro-core"
  ```

---

### Task 2: Tank maths in `hydro-core.js`

**Files:**
- Modify: `assets/js/hydro-core.js`
- Test: `tests/hydro-core.test.js`

**Interfaces:**
- Consumes: `pipeArea`, `velocityFromFlow`, `flowFromVelocity`, `G` from Task 1.
- Produces:
  - `calcTank(input) -> TankResult | {ok:false, errors:string[]}`
  - `compareDiameters(input, diameters: number[]) -> Row[]`

```
input = {
  tankDiameter, workingVolume, freeboard,                 // m, m³, m
  outlet:   { orientation: 'horizontal'|'vertical', dn, datumHeight, bellOd: number|null,  // mm, m, mm
              flowMode: 'flow'|'velocity', flowLs, velocity },
  inlet:    { invert, dn, flowLs },                       // m, mm, l/s
  overflow: { on: boolean, dn, cd },                      // mm
}
TankResult = {
  ok: true,
  area, pipeVelocity, outletFlowLs,       // pipeVelocity = V in the DN pipe; outletFlowLs from flow or V·A
  ds, vs, froude, submergence,            // ds in m: bellOd/1000 if set, else dn/1000; vs = outletFlow / (π·ds²/4)
  datum, mwl, workingDepth, twl,
  inletSoffit,
  overflow: null | { invert, soffit, centre, head, capacityLs, pass, shortfallLs },
  controllingLevel, controlledBy: 'inlet'|'overflow'|'twl', top,
  warnings: { inletDrowned: boolean, outletCantKeepUp: boolean },
  volumes: { dead, working, toTwl, gross },
  fillTimeS: number|null, drawDownTimeS: number|null,
}
Row = { diameter, area, workingDepth, twl, controlledBy, top, hdRatio, grossVolume }  // hdRatio = top / diameter
```

Formulas are exactly the spec's "Calculation" block. Further rules:
- **Overflow:** `head = top − centre`; `capacityLs = cd·A_o·√(2·G·head)·1000`; `pass = capacityLs ≥ inlet.flowLs`; `shortfallLs = max(0, inlet.flowLs − capacityLs)`.
- **controlledBy tie order:** inlet if `inletSoffit ≥` every other candidate, else overflow if the overflow soffit ≥ TWL, else twl.
- **Warnings:** `inletDrowned = twl > inlet.invert`; `outletCantKeepUp = outletFlowLs ≤ inlet.flowLs`.
- **Volumes:** `dead = area·mwl`, `working = area·workingDepth`, `toTwl = area·twl`, `gross = area·top`.
- **Times:**
  - `fillTimeS = workingVolume / (inlet.flowLs/1000)`, or null when inflow ≤ 0
  - `drawDownTimeS = workingVolume / ((outletFlowLs − inlet.flowLs)/1000)`, or null when that difference ≤ 0
- **Validation:** `errors` lists the field paths that are not finite or are out of range:
  - must be > 0: `tankDiameter`, `outlet.dn`, `inlet.dn`, and `overflow.dn` when the overflow is on
  - must be ≥ 0: `workingVolume`, `freeboard`, `outlet.datumHeight`, `inlet.invert`, `outlet.flowLs`/`outlet.velocity` (whichever the mode uses), `inlet.flowLs`
  - must be > 0 when set: `outlet.bellOd`
- **compareDiameters:** de-duplicates and sorts the diameters ascending, runs `calcTank` with each, and skips invalid ones.

- [ ] **Step 1: Write failing tests:**
  - **`golden: today's tool`:** for horizontal, with no bell, velocity mode `velocity:1.5`, dn 200, datum 0.6, D 5, V 100, fb 0.5, and the inlet low (invert 0.5, dn 100, flow 10):
    - overflow off: `top` ≈ 6.885564 (tol 1e-5)
    - overflow on (dn 300, cd 0.61): `top` ≈ 7.185564 and `overflow.capacityLs` ≈ 153.981 (tol 1e-2)

    These are today's tool outputs, recomputed from its formula `hcl + S + H_w + fb (+ DN_o)`.
  - **`inlet controls`:** same as above with the overflow off, inlet invert 6.4 and dn 300 (TWL ≈ 6.385564). `inletSoffit` = 6.7, `controlledBy` = 'inlet', `top` = 7.2, `warnings.inletDrowned` = false. Overflow on with inlet invert 6.6: inlet soffit 6.9 > overflow soffit ≈ 6.6856, so `controlledBy` = 'inlet' and `overflow.head` ≈ `7.4 − (6.385564 + 0.15)`.
  - **`twl controls`:** inlet invert 3.0 → `controlledBy` = 'twl' and `inletDrowned` = true.
  - **`tie goes to inlet`:** set the inlet invert so its soffit equals TWL exactly (`invert = twl − dn/1000`, computed from a first run). `controlledBy` = 'inlet'.
  - **`vertical outlet uses inlet-plane datum`:** orientation 'vertical', datumHeight 0. `mwl` equals `submergence`, and `datum` = 0.
  - **`bell changes D and V`:** flow mode with flowLs 47.124 (≈ 1.5 m/s in DN200) and bellOd 300. `ds` = 0.3, `vs` ≈ 0.6667 (tol 1e-3), `submergence` = 0.3·(1 + 2.3·vs/√(9.81·0.3)), `pipeVelocity` ≈ 1.5. In velocity mode with velocity 1.5 and the same bell, `vs` gives the same result.
  - **`volumes and times`:** `volumes.working` ≈ 100. With inlet flowLs 20 and outlet flowLs 47.124: `fillTimeS` = 5000, `drawDownTimeS` = 100/0.027124. Outlet flowLs 20 gives `drawDownTimeS` null and `outletCantKeepUp` true. Inlet flowLs 0 gives `fillTimeS` null.
  - **`overflow check`:** inflow 200 with an overflow capacity of ≈ 153.98: `pass` false, `shortfallLs` ≈ 46.02.
  - **`invalid input`:** tankDiameter 0 → `{ok:false}` with errors containing 'tankDiameter'; `outlet.dn` NaN → errors containing 'outlet.dn'.
  - **`compareDiameters`:** `[6, 4, 5, 5]` → 3 rows with diameters `[4, 5, 6]`; the row for 5 has the same `top` as `calcTank` at D 5; `hdRatio` = top/diameter.
- [ ] **Step 2:** Run `node --test tests/hydro-core.test.js`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement `calcTank` and `compareDiameters`.
- [ ] **Step 4:** Run `npm test`. Expected: all pass.
- [ ] **Step 5: Commit**
  ```bash
  git add assets/js/hydro-core.js tests/hydro-core.test.js
  git commit -m "feat(hydro): inlet-aware tank level stack, overflow check, volumes"
  ```

---

### Task 3: Tank tab rebuilt on the core, then the sign-off checkpoint

**Files:**
- Modify: `tools-src/hydrosizer.html` (tank panel markup ~lines 210–310, `calcTank`/`drawTank` ~483–600, `toggleOverflow`, `load` handler, `<style>`)

**Interfaces:**
- Consumes: `window.HydroCore.calcTank`, `checkVelocity`, `STANDARD_DN`.
- Produces, in the tool's script, for Tasks 4–6:
  - `const WIMES` (below)
  - `getLiquid() -> {key, sub?}`
  - `setLiquid(key, sub?)`: updates every picker, persists, and recalculates both tabs
  - `limitsFor(liquid) -> {min, max, maxAdvisory?} | null`
  - `readTankInput() -> input`, in the `calcTank` input shape
  - `lastTank`: the latest `TankResult`
  - `statusChip(el, check, labels)`: renders a pass/warn/fail/advisory chip

**WIMES data:** a `const WIMES` in the tool's script. Its keys and values are copied exactly from the spec's "WIMES 8.08 Table 2 data" table:
- raw sewage, raw water, treated, post-screening, grit, fog, sludge-thin, sludge-thick (`maxAdvisory:true`), and sludge cake (`limits:null`, with the "refer to pump manufacturer's recommendations and Section 7.3.3" text)
- hydraulic oil with `subs: {suction:{min:1.0, max:1.4}, delivery:{min:3.0, max:5.0}, return:{min:3.0, max:4.0}}`
- each entry carries the paraphrased note text from the spec

Default: raw sewage. Persist to localStorage key `hs-liquid`, with try/catch on both the read and the write, and a fallback to raw sewage on an unknown key.

- [ ] **Step 1:** Add `<script type="module">import * as HydroCore from '/assets/js/hydro-core.js'; window.HydroCore = HydroCore;</script>` before `</body>`, as `pid-tag-register.html` does at line ~3647. In the `load` handler, if `window.HydroCore` is missing, show an inline error card (the `pid-tag-register` alert pattern, but inline) instead of computing.
- [ ] **Step 2:** Replace the tank input cards with:
  - **Tank:** diameter, working volume
  - **Liquid:** picker, plus the hydraulic-oil sub-picker when that liquid is chosen
  - **Outlet:**
    - orientation segmented control (Horizontal / Vertical)
    - DN, with a `<datalist>` of `STANDARD_DN`
    - datum height, labelled "Centreline height" or "Inlet plane height" by orientation
    - bell toggle with bell OD
    - flow-mode two-way switch (default "From flow"), with flow (l/s) or velocity (m/s)
  - **Inlet:** invert, DN with the datalist, design inflow
  - **Overflow:** keep the existing toggle-pill; DN with the datalist, Cd
  - **Freeboard**

  Defaults are today's tank plus a sensible inlet: D 5, V 100, fb 0.5, horizontal, DN 200, centreline 0.6, velocity mode 1.5 m/s, inlet invert 6.4, DN 300, inflow 40 l/s, overflow off, DN 300, Cd 0.61. The inlet sits just above TWL ≈ 6.39, so it isn't drowned and it controls the height. All inputs trigger one `recalcTank()`.
- [ ] **Step 3:** Rewrite `calcTank`, renamed `recalcTank`, to read the inputs via `readTankInput()`, call `HydroCore.calcTank`, and render:
  - **Validation errors:** if `ok:false`, mark the bad inputs (`aria-invalid`) and show "—" in the results.
  - **Hero:** overall height (2 dp) with "Controlled by: Inlet / Overflow / Top water level".
  - **Small metrics:** submergence (3 dp), working depth, TWL, MWL.
  - **Chips:**
    - outlet velocity: WIMES, with tooltip text covering the paraphrased note and the below-minimum clause 6.10.1(2) or above-maximum clause 6.10.1(3)
    - inlet drowned
    - outlet can't keep up
    - overflow pass/fail with the shortfall
  - **Overflow card:** keeps the capacity readout.
- [ ] **Step 4:** Rewrite `drawTank(result)` as an engineer's elevation:
  - Every level labelled with its height: top, inlet soffit and invert, overflow, TWL, MWL, datum.
  - The freeboard band starts at `controllingLevel`.
  - The inlet pipe enters the left wall. A horizontal outlet leaves the right wall; a vertical one goes through the floor, with a bell flare when one is fitted.
  - The submergence dimension is drawn from the datum.
  - A drowned inlet is tinted with the destructive token.
  - All colours come from `getColors()`/tokens, and the drawing redraws on mode change (the existing MutationObserver).
- [ ] **Step 5: Verify in the browser.** `preview_start {name:"site"}`, open `/tools-src/hydrosizer.html` and the tank tab.
  - With the defaults, the overall height is 7.20 m and "Controlled by: Inlet", with no warnings.
  - Set the inlet invert to 5.5. The height becomes 6.89 m (matching today's 6.886), "Controlled by: Top water level", and the drowned-inlet chip appears.
  - Check light and dark modes, and 375 px width.
  - No console errors.
  - Clear the tank diameter field: "—" appears and there is no `NaN` anywhere.
- [ ] **Step 6: Sign-off checkpoint.** Take a screenshot of the tank tab at 1280 px in light mode, with the inlet controlling, and send it to Harvey. **Stop until Harvey approves the look.** Apply his feedback before Task 4.

  (No commit: `tools-src` is untracked.)

---

### Task 4: Volume summary and diameter comparison

**Files:**
- Modify: `tools-src/hydrosizer.html`

**Interfaces:**
- Consumes: `lastTank`, `readTankInput()`, `HydroCore.compareDiameters`.

- [ ] **Step 1: Volume summary card** in the results column:
  - dead, working, to TWL and gross volumes (m³, 1 dp)
  - fill time and draw-down time, formatted as `h:mm`, or "—" when null
- [ ] **Step 2: Comparison section** below the three columns:
  - Chip list of candidate diameters (default: current D ± 1 m in 0.5 m steps, at least 1 m), with an add input (Enter adds) and × to remove. The current D is always present and highlighted.
  - Table with the columns from the `Row` type, formatted to 2 dp.
  - Clicking a row sets the tank diameter input and recalculates.
  - A small canvas or SVG chart beside the table: overall height (y) against diameter (x), points per candidate, the current one emphasised. Use the `dataviz` skill.
  - Stacks under the table below 820 px.
- [ ] **Step 3: Verify in the browser.**
  - Add 7 and remove 4.5.
  - Click the 6 row: the diameter input becomes 6 and the hero updates.
  - The chart redraws in both modes.
  - Set inflow to 0: fill time shows "—".

---

### Task 5: Equations and sources, WIMES reference, PDF export

**Files:**
- Modify: `tools-src/hydrosizer.html` (replace the `#equations-modal`, `updateEquations` and `exportReport`)

**Interfaces:**
- Consumes: `lastTank`, `readTankInput()`, `WIMES`, `getLiquid()`.

- [ ] **Step 1:** Replace the modal with an inline **"Workings & sources"** section below the comparison. Keep the "Review workings" button, which now scrolls to it. Include the seven cards from the spec's "Equations and sources" table. Each card has:
  - a title
  - the equation
  - a worked-numbers line from `lastTank`
  - a source line (document + clause, verbatim from the spec)
  - an "Assumes / not valid when" line in plain English

  The datum card's text and worked numbers switch with the orientation. The overflow card is hidden when the overflow is off. The level-stack card lists every candidate level and marks the controlling one.
- [ ] **Step 2:** Add a **WIMES reference drawer**, a `<details>` element inside the section. It holds the full table from `WIMES` with the selected row highlighted, the paraphrased notes, and the citation "WIMES 8.08 Issue 1 (June 2021), §6.10.1, Table 2".
- [ ] **Step 3:** Rework `exportReport()` so the PDF contains:
  - page 1: the three columns (inputs, drawing, results with chips) and the volume summary
  - following pages: the comparison table and the Workings & sources section, with the drawer forced open while capturing and restored afterwards
  - a header line on each page: tool name, date, liquid

  Keep html2canvas and jsPDF, and the existing filename pattern.
- [ ] **Step 4: Verify in the browser.**
  - Worked numbers match the results panel. For example, with the defaults the submergence card shows 0.693 m.
  - Toggling orientation changes the datum card.
  - Export a PDF and check every section is present and legible in light mode.

---

### Task 6: Pipe tab liquid check and flow–velocity chart

**Files:**
- Modify: `tools-src/hydrosizer.html` (pipe panel markup ~lines 155–215, `calcPipe`, `setLock`)

**Interfaces:**
- Consumes: `getLiquid()`, `setLiquid()`, `limitsFor()`, `statusChip()` from Task 3; `velocityFromFlow`, `flowRangeInBand`, `dnsFittingFlow`, `nearestStandardDNs`, `checkVelocity` and `STANDARD_DN` from Task 1.

- [ ] **Step 1:** Add the shared Liquid picker to the pipe panel's input card, and a WIMES chip under the velocity. Changing the liquid on either tab updates both.
- [ ] **Step 2:** Add a full-width chart card under the pipe three-column grid, as an SVG or canvas `drawFlowChart()` called from `calcPipe()`. Use the `dataviz` skill.
  - **Axes:** x is flow (l/s), from 0 to max(2·Q, 1.2·`flowRangeInBand(D).qMaxLs`); y is velocity (m/s), from 0 to max(1.25·band max, 1.25·V).
  - **Marks:**
    - the band shaded between min and max (no band, and a note, for sludge cake)
    - a bold curve `v = velocityFromFlow(q, D)` for the current D
    - faint curves for `nearestStandardDNs(D)` below and above, labelled DNxxx
    - a dot at (Q, V)
  - **Readout under the chart:** "DN{D} stays within WIMES from {qMin} to {qMax} l/s" (1 dp).
  - **Hover:** a crosshair with a tooltip showing flow, and for each curve the velocity and its margin to the min and max.
- [ ] **Step 3:** When `locked === 'diameter'`:
  - Draw curves for the standard DNs around the solved D (its `nearestStandardDNs` and one further step each side, where they exist), plus a vertical marker at Q.
  - Readout: "At {Q} l/s, these sizes are within WIMES: DN…", from `dnsFittingFlow`.
  - Each listed DN is a button. Clicking one calls `setLock('velocity')`, then sets the D input to that DN and recalculates.
- [ ] **Step 4: Verify in the browser.**
  - Raw sewage, Q 40, D 200, solving velocity: the readout says flow range from `flowRangeInBand(200, raw-sewage limits)`, the dot sits inside the band, and the faint curves are labelled DN150 and DN250.
  - Lock diameter: the readout lists DN200 and DN250. Click DN250: the lock moves to velocity and D = 250.
  - D 180: the faint curves are DN150 and DN200.
  - Sludge cake: there is no band, and the note appears.
  - Check both modes, 375 px width, and no console errors.

---

### Task 7: Final verification and handover

**Files:**
- Modify: `assets/img/previews/hydrosizer.webp`

- [ ] **Step 1:** Run `npm test`. Expected: all suites pass.
- [ ] **Step 2:** Make a fresh preview image:
  1. Screenshot the tank tab (light mode, inlet controlling, 1280×800).
  2. Convert it to `assets/img/previews/hydrosizer.webp`: width 1280, quality around 80, ≤ 120 KB. Use the converter the earlier plans used (`cwebp`, or `npx sharp-cli`).
  3. Look at the resulting webp to check it.
- [ ] **Step 3:** Delete `tools-src/hydrosizer.pre-upgrade.html` once Harvey confirms he doesn't need it. Until then, tell him it **must** be gone before he runs the lock step.
- [ ] **Step 4: Commit**
  ```bash
  git add assets/img/previews/hydrosizer.webp docs/superpowers/specs/2026-11-08-hydrosizer-upgrade-design.md docs/superpowers/plans/2026-11-08-hydrosizer-upgrade.md
  git commit -m "docs(hydro): upgrade spec, plan and refreshed preview"
  ```
- [ ] **Step 5: Hand over to Harvey.** Give him the steps to publish:
  1. Run `node scripts/lock-tools.mjs` and enter the workshop code.
  2. Commit the regenerated `tools/*.html` and `tools/vault-manifest.json`.
  3. Push.

  Nothing is pushed by Claude.
