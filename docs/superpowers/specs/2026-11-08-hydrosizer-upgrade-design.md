# HydroSizer upgrade: inlet-aware tank sizing, WIMES checks, pipe charts

Date: 2026-11-08
Tool: `tools-src/hydrosizer.html` (plaintext, git-ignored) → locked to `tools/hydrosizer.html`

## Why

Harvey sizes water-industry tanks with HydroSizer. He wants the tank tab to be
the best tank sizing calculator available: correct to the standards he works to,
explained well enough that a reviewer can follow every number back to its
source, and professional enough to put in front of a client.

The concrete trigger: the freeboard has to sit above the **inlet**, and the tool
has no inlet. On his last tank he entered the outlet as a stand-in for the inlet,
which only worked because both were at the same level.

The pipe tab gets a chart, because when he has a pipe size and needs to know what
flow it can carry within velocity limits, he currently nudges numbers over and
over.

## Goals

1. Tank tab models an inlet; freeboard sits above the highest of the inlet soffit
   and the overflow pipe.
2. Outlet orientation sets the submergence datum per ANSI/HI 9.8.
3. Velocities are checked against WIMES 8.08 Table 2 for a chosen liquid, on both tabs.
4. Every equation shows its worked numbers, its source (document + clause) and its
   assumptions.
5. Overflow capacity is checked against the design inflow.
6. A volume summary, and a comparison of several tank diameters.
7. Pipe tab: a flow–velocity chart against the WIMES band, with neighbouring DNs.
8. A clear step up in polish, in the site's existing visual language.

## Non-goals (discussed and dropped)

- Working volume from pump starts per hour (HI Appendix B). Harvey is normally
  *given* a working volume and knows the flow, not the pump data.
- HI Table 9.8.3 inlet bell velocity check. WIMES already covers velocity.
- Anti-vortex devices (HI Appendix A) and an NPSH submergence override. Overkill.
- Rectangular tanks, mAOD levels, retention-time sizing. Not needed.
- A guided/step-by-step mode, or a drawing-led "calc sheet" layout.

## Anti-goals

- **Wireframe or generic look.** Harvey rejected rough mockups outright ("they
  look ugly"). The layout direction is a *refined version of today's* three
  columns (inputs · drawing · results, equations below), in the site's real
  styling. Any mockup shown to him must be in real styling.
- **Invented standards data.** Every limit or coefficient comes from a document
  named in this spec. Nothing is filled in from memory.
- **Clutter.** Options should be there when needed and stay out of the way otherwise.

## Conventions

- All levels are heights in **m above the tank floor**. Pipe sizes are **DN in mm,
  treated as the internal bore**. Flows are in **l/s**. Volumes are in **m³**.
- g = 9.81 m/s².
- Standard DN list (internal bore, mm): 25, 32, 40, 50, 65, 80, 100, 125, 150, 200,
  250, 300, 350, 400, 450, 500, 600, 700, 800, 900, 1000, 1200.

## Tank tab

### Inputs

Inputs are grouped into cards in the left column, in this order.

**Tank**
- Internal diameter (m)
- Working volume (m³)

**Liquid** (shared with the pipe tab: changing it on one tab changes it on both)
- Liquid type, from the WIMES Table 2 rows (below)

**Outlet**
- Orientation:
  - *Horizontal*: through the wall (HI Fig 9.8.18 examples 2 and 3)
  - *Vertical, downward*: floor outlet or downturned suction (HI Fig 9.8.18 example 4)
- DN (mm)
- Datum height (m):
  - for a horizontal outlet, the centreline height above the floor
  - for a vertical outlet, the height of the inlet plane above the floor (0 = flush floor outlet)
  - the label changes with the orientation
- Bell mouth fitted? (optional) If yes, the bell outside diameter (mm)
- Flow, entered one of two ways (a two-way switch; default *from flow*):
  - *From flow*: outlet design flow (l/s); velocity is calculated
  - *Velocity*: velocity entered directly (m/s), as today

**Inlet** (always present: every tank has an inlet, so there is no switch)
- Invert height above the floor (m)
- DN (mm). This is already sized on the pipe tab, so there is no velocity check here.
- Design inflow (l/s). Used for the overflow check and the fill time.

**Overflow** (a toggle, off by default, as today: not every tank has one)
- DN (mm)
- Discharge coefficient Cd (default 0.61, as today)

**Freeboard**
- Freeboard (m)

### Calculation

```
A_tank   = π·Dt²/4
A_pipe   = π·(DN/1000)²/4                    (outlet pipe)
V_pipe   = Q_out / A_pipe                    (or the entered velocity)

D_s      = bell OD if a bell is fitted, else DN/1000      (HI 9.8.7: "diameter of inlet opening")
V_s      = Q_out / (π·D_s²/4)                (if the velocity was entered directly: V_s = V_pipe·(DN/1000)²/D_s²)
Fr       = V_s / √(g·D_s)
S        = D_s·(1 + 2.3·Fr)                  HI 9.8.7-1

datum    = outlet centreline (horizontal) | outlet inlet plane (vertical)
MWL      = datum + S                         minimum water level
H_w      = V_working / A_tank
TWL      = MWL + H_w                         top water level

overflow (if on): invert = TWL, soffit = TWL + DN_o/1000, centreline = TWL + DN_o/2000
inlet:            soffit = invert + DN_in/1000

controlling level = max( TWL, overflow soffit (if the overflow is on), inlet soffit )
Top of tank       = controlling level + freeboard
Overall height    = Top of tank
```

The current tool is unchanged in the case it covers: with a horizontal outlet and
the inlet soffit at or below the old stack's top (TWL, or the overflow soffit when
the overflow is on), the overall height is the same as today. A test must pin this.

**Overflow capacity.** Orifice equation, as today, with the head generalised:
`Q_o = Cd·A_o·√(2g·H_o)`, where `H_o = Top of tank − overflow centreline`. When
the overflow is the controlling level, this equals today's `freeboard + DN_o/2`.
- Check: `Q_o ≥ design inflow` → pass. Otherwise fail, with the shortfall in l/s.

**Checks and warnings** (shown as chips next to the result they concern)
- **Outlet velocity** (`V_pipe`) against the WIMES range for the chosen liquid:
  - within the range → pass
  - below the minimum → warn, and note clause 6.10.1(2): washout facilities are
    needed if the minimum can't be reached for a significant part of each day
    (typically more than 4 hours)
  - above the maximum → warn, and note that clause 6.10.1(3) allows short lengths
    or low-utilisation systems to exceed it
- **Inlet drowned:** TWL above the inlet invert → warn.
- **Outlet can't keep up:** outlet flow ≤ design inflow → warn (the tank won't
  draw down while inflow continues).
- **Overflow capacity:** pass or fail, as above.

**Volume summary** (results column)
- Dead volume, floor to MWL: `A·MWL`
- Working volume, MWL to TWL (equal to the input; shown as a cross-check)
- Volume to TWL
- Gross volume to the top of the tank
- Fill time: `V_working / Q_in`
- Draw-down time with inflow running: `V_working / (Q_out − Q_in)`, shown only when `Q_out > Q_in`

**Headline result:** overall tank height, with "controlled by: inlet | overflow |
top water level" under it.

### Drawing (centre column)

Keep the elevation drawing, upgraded:
- Every level labelled with its height: top of tank, inlet soffit and invert,
  overflow, TWL, MWL, outlet datum.
- The freeboard band visibly starts at the controlling level.
- The inlet pipe enters one wall. A horizontal outlet leaves the other wall; a
  vertical outlet is drawn through the floor (with a bell, if fitted).
- The submergence dimension is drawn from the correct datum.
- Warnings (such as a drowned inlet) are visible on the drawing as well as in the chips.

### Diameter comparison

A section below the main three columns.
- Candidate tank diameters entered as removable chips, plus an "add" field. The
  current diameter is always included and highlighted.
- Table, one row per diameter: diameter, area, working depth, TWL, controlling
  level, overall height, H:D ratio, gross volume.
- Clicking a row makes that diameter the current design.
- A small chart beside the table: overall height against diameter, with the
  candidates marked. It shows where widening stops buying much height.

### Equations and sources

Replaces today's equations modal with a section (or a drawer) below the comparison.
One card per equation. Each card has:
- the equation
- the worked numbers for the current design
- the source, with document and clause
- a "what it assumes and when it doesn't apply" note, in plain English

| Card | Source |
|---|---|
| Velocity and area, continuity `Q = V·A` | Standard hydraulics |
| Froude number and submergence `S = D(1 + 2.3·Fr)` | ANSI/HI 9.8-1998 §9.8.7.2, eq. 9.8.7-1. Assumes reasonably uniform approach flow; skewed approach flows need vortex suppression (§9.8.7.1). |
| Submergence datum by outlet orientation | ANSI/HI 9.8-1998 §9.8.7.2 definition of S, Fig 9.8.18 |
| Working depth `H_w = V/A` | Geometry |
| Level stack and controlling level | This tool's method: freeboard above the highest of inlet soffit, overflow soffit and TWL |
| Overflow capacity (orifice equation, Cd 0.61 sharp-edged default) | Standard hydraulics. Assumes the overflow runs as a free-discharging orifice at full head. |
| Velocity limits | WIMES 8.08 Issue 1 (June 2021), §6.10.1, Table 2 |

A **reference drawer** holds the full WIMES Table 2, with the selected liquid's row highlighted.

## WIMES 8.08 Table 2 data

The values are transcribed from WIMES 8.08 Issue 1 (June 2021), clause 6.10.1,
Table 2, page 28, into the `WIMES` constant inside the encrypted tool
(`tools-src/hydrosizer.html`). They are deliberately **not** repeated here: WIMES
is copyright Arcadis and this repository is public. The rows are: raw sewage;
raw water; partially treated and treated water; wastewater (post screening and
grit removal); grit laden waste water; FOG/scum laden waste water; sludges below
1.5 % DS; sludges between 1.5 and 12 % DS; sludge cake; and hydraulic oil
(suction, delivery and return).

Special cases:
- **Sludge cake:** the standard gives no figures, so the tool shows "refer to the
  pump manufacturer's recommendations and Section 7.3.3" and runs no pass/fail check.
- **Hydraulic oil:** a sub-picker for suction, delivery or return.
- **Note 4:** the maximum for thicker sludge is guidance only. A breach is
  shown as a soft advisory, not a fail.
- The table notes are paraphrased in the tool, not copied. Note 1, for example: the
  minimum avoids solids settling, and the maximum limits friction losses.

Default liquid: raw sewage. (Builder's call: remember the last choice per browser.)

## Pipe tab

The existing Q / D / V lock-and-solve stays as it is. Additions:

- The **Liquid** picker, shared with the tank tab, and a WIMES chip on the
  velocity result.
- **Flow–velocity chart** below the three columns:
  - x axis: flow (l/s); y axis: velocity (m/s)
  - The WIMES band for the chosen liquid is shaded.
  - A bold curve for the current diameter, with a dot at the current design point.
  - Faint curves for the next standard DN below and above. If the current D is
    not a standard DN, use the two standard DNs either side of it.
  - Readout for the current diameter: "DN200 stays within WIMES from X to Y l/s".
  - Hovering anywhere on the chart shows flow, velocity, and the margin to the min
    and max for each curve.
  - **When solving for diameter:** flow is fixed. Show the standard DNs around the
    solved D, a vertical marker at the design flow, and a readout listing which
    standard DNs put that flow inside the band. Clicking one adopts it.
  - When solving for flow or velocity: as above, with the current D.
  - Axis range is the builder's call. It should comfortably show where the
    current curve crosses the band's upper limit.
- Liquids with no limits (sludge cake) show the chart with no band and a note.

## Look and feel

- A refined version of today's layout and components. Same tokens (`site.css`):
  stone neutrals, racing green primary in light mode, gilt in dark mode; Geist;
  the existing card, chip and lock-button idioms. Light and dark modes both work.
- More professional: tighter hierarchy, consistent number formatting (levels to
  2 dp in m, S to 3 dp, flows to 1 dp in l/s), clear status chips (pass, warn,
  fail, advisory), a drawing that reads like an engineer's elevation.
- Works at phone width (it already collapses to one column below 820 px).
- Use the `frontend-design` skill for the visual pass.
- **Sign-off checkpoint:** show Harvey a screenshot of the restyled tank tab, in
  real styling with real numbers, before building out the remaining features.

## Export

The existing "Export PDF" stays. It must include the new results, checks, volume
summary and the equations-with-sources section, so the PDF works as a calc record.
How it's laid out is the builder's call.

## Constraints

- **Source of truth is `tools-src/hydrosizer.html`.** It is git-ignored and lives
  only in Harvey's OneDrive checkout. The public `tools/hydrosizer.html` is an
  encrypted loader produced by `node scripts/lock-tools.mjs`, which prompts for
  the workshop code. **Harvey runs that step himself.** Claude never handles the
  workshop code.
- After a UI change, `assets/img/previews/hydrosizer.webp` (the clear preview on
  the lock screen and cabinet card) should be regenerated.
- Static site, no build step, no new external dependencies. Vendored libraries
  live in `assets/vendor/`. Charts are drawn on canvas or as inline SVG, like the
  existing drawings.
- Tests: `npm test` (`node --test`).
- (My call) The pure maths moves to `assets/js/hydro-core.js` with
  `tests/hydro-core.test.js`, following the `pid-core.js` precedent. This makes
  the formulas public, unencrypted, which is acceptable because they are textbook
  and standards equations. The WIMES Table 2 data does **not** go there: WIMES is
  copyright Arcadis, and `pid-core.js` already sets the rule that licensed
  reference data stays inside the encrypted tool and is passed in as an argument.
- The older `HarveyDeason/HydroSizer` GitHub repo is a stale copy and is not touched.

## Tests the core must cover

- Today's results are reproduced: horizontal outlet, inlet soffit not above the old stack's top, overflow on and off.
- The inlet controls (inlet soffit above TWL), the overflow controls, and TWL
  controls (inlet soffit below TWL, which also raises the drowned-inlet warning).
- A vertical outlet uses the inlet-plane datum. A bell OD changes D_s and S.
- A velocity entered directly with a bell gives the correct V_s.
- Overflow head uses the top of tank minus the overflow centreline, including when
  the inlet controls.
- WIMES checks: pass, below the minimum, above the maximum, sludge cake (no check),
  hydraulic oil sub-types, note 4 advisory.
- Volume summary and fill/draw-down times, including Q_out ≤ Q_in.
- Pipe chart readout: the flow range within the band for a given DN; the standard
  DNs that fit a given flow.

## Settled calls (Claude's, for Harvey to check)

- **Adopting a standard DN from the pipe chart while solving for diameter** pins
  that DN and switches the lock to solve for velocity, so it isn't recalculated away.
- **Tank-tab DN fields:** a number field that suggests the standard DN list but
  accepts any bore.

## Left to the builder

- Exact component design, spacing and chart styling, within the look above.
- Where the equations section sits (inline section or drawer).
- Chart axis ranges and tick choices.
- Persisting inputs across reloads (nice to have).
- PDF layout.
