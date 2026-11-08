// assets/js/hydro-core.js
// Pure hydraulic maths for HydroSizer: pipe velocity, WIMES-style velocity
// checks, and the tank level stack. No DOM — everything here is node-testable.
//
// THE WIMES TABLE IS NOT HERE, AND MUST NOT BE. assets/js/ is served publicly
// (that is why the tools themselves are encrypted), and WIMES 8.08 is
// copyright Arcadis. The velocity limits stay inside the tool and arrive as
// the `limits` argument. Keep it that way.

export const G = 9.81;

// Standard DN sizes, treated as internal bore (mm).
export const STANDARD_DN = [25, 32, 40, 50, 65, 80, 100, 125, 150, 200, 250, 300,
  350, 400, 450, 500, 600, 700, 800, 900, 1000, 1200];

// Non-finite input degrades to 0 so no exported function returns NaN.
function num(x) { const n = Number(x); return Number.isFinite(n) ? n : 0; }

/** Bore area in m² for a DN in mm. */
export function pipeArea(dnMm) {
  const d = num(dnMm) / 1000;
  return d > 0 ? Math.PI * d * d / 4 : 0;
}

/** Mean velocity (m/s) of qLs l/s through a DN mm bore; 0 when the bore is not positive. */
export function velocityFromFlow(qLs, dnMm) {
  const a = pipeArea(dnMm);
  return a > 0 ? num(qLs) / 1000 / a : 0;
}

/** Flow (l/s) at vMs m/s through a DN mm bore. */
export function flowFromVelocity(vMs, dnMm) {
  return num(vMs) * pipeArea(dnMm) * 1000;
}

/** The nearest standard DNs strictly below and strictly above dMm (null off either end). */
export function nearestStandardDNs(dMm) {
  const d = num(dMm);
  let below = null, above = null;
  for (const dn of STANDARD_DN) {
    if (dn < d) below = dn;
    else if (dn > d && above === null) above = dn;
  }
  return { below, above };
}

/**
 * Velocity against a {min, max, maxAdvisory?} band. A null band (no figures
 * in the standard) gives 'none'. `advisory` marks a breach of a maximum the
 * standard gives for guidance only.
 */
export function checkVelocity(v, limits) {
  if (!limits) return { status: 'none', advisory: false };
  const x = num(v);
  if (x < limits.min) return { status: 'below', advisory: false };
  if (x > limits.max) return { status: 'above', advisory: !!limits.maxAdvisory };
  return { status: 'pass', advisory: false };
}

/** The flow range (l/s) that keeps a DN inside the band; null when there is no band. */
export function flowRangeInBand(dnMm, limits) {
  if (!limits) return null;
  return { qMinLs: flowFromVelocity(limits.min, dnMm), qMaxLs: flowFromVelocity(limits.max, dnMm) };
}

/** DNs (ascending) whose velocity at qLs sits inside the band. */
export function dnsFittingFlow(qLs, limits, dns = STANDARD_DN) {
  if (!limits) return [];
  return [...dns].sort((a, b) => a - b)
    .filter(dn => checkVelocity(velocityFromFlow(qLs, dn), limits).status === 'pass');
}

/** The pipe-tab inputs that are blank, non-finite or out of range (D must be positive). */
export function validatePipe({ qLs, dnMm, vMs }) {
  const errors = [];
  if (!(Number.isFinite(qLs) && qLs >= 0)) errors.push('qLs');
  if (!(Number.isFinite(dnMm) && dnMm > 0)) errors.push('dnMm');
  if (!(Number.isFinite(vMs) && vMs >= 0)) errors.push('vMs');
  return errors;
}

// ── Tank level stack ──
// All levels are heights in m above the tank floor. Spec:
// docs/superpowers/specs/2026-11-08-hydrosizer-upgrade-design.md, "Calculation".

// Levels closer than this are the same level (floating-point noise, not design).
const LEVEL_EPS = 1e-9;

function validate(input) {
  const i = input || {}, o = i.outlet || {}, n = i.inlet || {}, f = i.overflow || {};
  const errors = [];
  const pos = (v, k) => { if (!(Number.isFinite(v) && v > 0)) errors.push(k); };
  const nonNeg = (v, k) => { if (!(Number.isFinite(v) && v >= 0)) errors.push(k); };
  pos(i.tankDiameter, 'tankDiameter');
  nonNeg(i.workingVolume, 'workingVolume');
  nonNeg(i.freeboard, 'freeboard');
  pos(o.dn, 'outlet.dn');
  nonNeg(o.datumHeight, 'outlet.datumHeight');
  if (o.flowMode === 'flow') nonNeg(o.flowLs, 'outlet.flowLs');
  else nonNeg(o.velocity, 'outlet.velocity');
  // A bell mouth flares out from the pipe, so it can't be smaller than the bore.
  if (o.bellOd != null && !(Number.isFinite(o.bellOd) && o.bellOd >= o.dn)) errors.push('outlet.bellOd');
  nonNeg(n.invert, 'inlet.invert');
  pos(n.dn, 'inlet.dn');
  nonNeg(n.flowLs, 'inlet.flowLs');
  if (f.on) {
    pos(f.dn, 'overflow.dn');
    // A discharge coefficient is a fraction of the ideal flow.
    if (!(Number.isFinite(f.cd) && f.cd > 0 && f.cd <= 1)) errors.push('overflow.cd');
  }
  return errors;
}

/**
 * Size a cylindrical tank from its outlet, working volume, inlet and optional
 * overflow. Returns {ok:false, errors} for unusable input, otherwise the full
 * level stack, checks, volumes and times (see the TankResult shape in the plan).
 */
export function calcTank(input) {
  const errors = validate(input);
  if (errors.length) return { ok: false, errors };
  const { tankDiameter, workingVolume, freeboard, outlet, inlet, overflow } = input;

  const area = Math.PI * tankDiameter * tankDiameter / 4;
  const outletFlowLs = outlet.flowMode === 'flow'
    ? outlet.flowLs : flowFromVelocity(outlet.velocity, outlet.dn);
  const pipeVelocity = velocityFromFlow(outletFlowLs, outlet.dn);

  // HI 9.8.7: D is the diameter of the inlet opening — the bell if one is fitted.
  const ds = outlet.bellOd != null ? outlet.bellOd / 1000 : outlet.dn / 1000;
  const vs = outletFlowLs / 1000 / (Math.PI * ds * ds / 4);
  const froude = vs / Math.sqrt(G * ds);
  const submergence = ds * (1 + 2.3 * froude);

  // Horizontal outlet: datum is the centreline. Vertical: the inlet plane.
  const datum = outlet.datumHeight;
  const mwl = datum + submergence;
  const workingDepth = workingVolume / area;
  const twl = mwl + workingDepth;
  const inletSoffit = inlet.invert + inlet.dn / 1000;

  let ov = null;
  if (overflow.on) {
    ov = { invert: twl, soffit: twl + overflow.dn / 1000, centre: twl + overflow.dn / 2000 };
  }

  // Tie order: inlet, then overflow, then top water level.
  const ovSoffit = ov ? ov.soffit : -Infinity;
  const highest = Math.max(twl, ovSoffit, inletSoffit);
  const controlledBy = inletSoffit >= highest - LEVEL_EPS ? 'inlet'
    : ovSoffit >= highest - LEVEL_EPS ? 'overflow' : 'twl';
  const controllingLevel = highest;
  const top = controllingLevel + freeboard;

  if (ov) {
    ov.head = top - ov.centre;
    ov.capacityLs = overflow.cd * pipeArea(overflow.dn) * Math.sqrt(2 * G * ov.head) * 1000;
    ov.pass = ov.capacityLs >= inlet.flowLs;
    ov.shortfallLs = Math.max(0, inlet.flowLs - ov.capacityLs);
  }

  const net = outletFlowLs - inlet.flowLs;
  return {
    ok: true,
    area, pipeVelocity, outletFlowLs,
    ds, vs, froude, submergence,
    datum, mwl, workingDepth, twl,
    inletSoffit,
    overflow: ov,
    controllingLevel, controlledBy, top,
    warnings: {
      inletDrowned: twl > inlet.invert + LEVEL_EPS,
      outletCantKeepUp: outletFlowLs <= inlet.flowLs,
    },
    volumes: { dead: area * mwl, working: area * workingDepth, toTwl: area * twl, gross: area * top },
    fillTimeS: inlet.flowLs > 0 ? workingVolume / (inlet.flowLs / 1000) : null,
    drawDownTimeS: net > 0 ? workingVolume / (net / 1000) : null,
  };
}

/** One row per valid candidate tank diameter (ascending, de-duplicated). */
export function compareDiameters(input, diameters) {
  const ds = [...new Set((diameters || []).map(Number))].sort((a, b) => a - b);
  const rows = [];
  for (const d of ds) {
    const r = calcTank({ ...input, tankDiameter: d });
    if (!r.ok) continue;
    rows.push({ diameter: d, area: r.area, workingDepth: r.workingDepth, twl: r.twl,
      controlledBy: r.controlledBy, top: r.top, hdRatio: r.top / d, grossVolume: r.volumes.gross });
  }
  return rows;
}
