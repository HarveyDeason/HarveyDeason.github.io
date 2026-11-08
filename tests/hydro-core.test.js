// tests/hydro-core.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  G, STANDARD_DN, pipeArea, velocityFromFlow, flowFromVelocity,
  nearestStandardDNs, checkVelocity, flowRangeInBand, dnsFittingFlow,
} from '../assets/js/hydro-core.js';

const approx = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tol, `expected ${a} ≈ ${b} (±${tol})`);

// Made-up limits: WIMES figures are copyright and this repo is public, so tests
// never carry real WIMES values.
const BAND = { min: 0.7, max: 1.9 };
const ADVISORY_BAND = { min: 0.4, max: 1.1, maxAdvisory: true };

// ── Pipe maths ──
test('G and the standard DN list', () => {
  assert.equal(G, 9.81);
  assert.deepEqual(STANDARD_DN, [25, 32, 40, 50, 65, 80, 100, 125, 150, 200, 250, 300,
    350, 400, 450, 500, 600, 700, 800, 900, 1000, 1200]);
});

test('pipe area, velocity from flow and back', () => {
  approx(pipeArea(100), Math.PI * 0.0025);
  approx(velocityFromFlow(10, 100), 1.273240);
  approx(flowFromVelocity(1.27324, 100), 10, 1e-3);
});

test('velocityFromFlow never returns NaN or Infinity', () => {
  assert.equal(velocityFromFlow(10, 0), 0);
  assert.equal(velocityFromFlow(NaN, 100), 0);
  assert.equal(velocityFromFlow(10, -5), 0);
});

// ── Neighbouring sizes ──
test('nearestStandardDNs: strictly either side, null off the ends', () => {
  assert.deepEqual(nearestStandardDNs(200), { below: 150, above: 250 });
  assert.deepEqual(nearestStandardDNs(180), { below: 150, above: 200 });
  assert.deepEqual(nearestStandardDNs(25), { below: null, above: 32 });
  assert.deepEqual(nearestStandardDNs(1500), { below: 1200, above: null });
});

// ── WIMES velocity check ──
test('checkVelocity: pass, below, above', () => {
  assert.deepEqual(checkVelocity(1.0, BAND), { status: 'pass', advisory: false });
  assert.deepEqual(checkVelocity(0.5, BAND), { status: 'below', advisory: false });
  assert.deepEqual(checkVelocity(2.0, BAND), { status: 'above', advisory: false });
});

test('checkVelocity: note-4 maximum is advisory only', () => {
  assert.deepEqual(checkVelocity(1.3, ADVISORY_BAND), { status: 'above', advisory: true });
  assert.deepEqual(checkVelocity(0.3, ADVISORY_BAND), { status: 'below', advisory: false });
});

test('checkVelocity: no limits (sludge cake) means no check', () => {
  assert.deepEqual(checkVelocity(1, null), { status: 'none', advisory: false });
});

// ── Chart helpers ──
test('flowRangeInBand: the flows a DN carries inside the band', () => {
  const r = flowRangeInBand(200, BAND);
  approx(r.qMinLs, 21.991, 1e-3);
  approx(r.qMaxLs, 59.690, 1e-3);
  assert.equal(flowRangeInBand(200, null), null);
});

test('dnsFittingFlow: standard DNs whose velocity at Q is in the band', () => {
  assert.deepEqual(dnsFittingFlow(40, BAND), [200, 250]);
  assert.deepEqual(dnsFittingFlow(40, null), []);
});

// ── Tank level stack ──
import { calcTank, compareDiameters, validatePipe } from '../assets/js/hydro-core.js';

// Today's default tank, expressed in the new input shape. The inlet is low by
// default here so it does not control, which is the case today's tool covers.
function tank(over = {}) {
  const base = {
    tankDiameter: 5, workingVolume: 100, freeboard: 0.5,
    outlet: { orientation: 'horizontal', dn: 200, datumHeight: 0.6, bellOd: null,
      flowMode: 'velocity', flowLs: 0, velocity: 1.5 },
    inlet: { invert: 0.5, dn: 100, flowLs: 10 },
    overflow: { on: false, dn: 300, cd: 0.61 },
  };
  return {
    ...base, ...over,
    outlet: { ...base.outlet, ...over.outlet },
    inlet: { ...base.inlet, ...over.inlet },
    overflow: { ...base.overflow, ...over.overflow },
  };
}
// Today's formula: hcl + S + H_w + fb (+ DN_o when the overflow is on).
const TWL_TODAY = 0.6 + 0.2 * (1 + 2.3 * 1.5 / Math.sqrt(9.81 * 0.2)) + 100 / (Math.PI * 6.25);

test("golden: reproduces today's tool when the inlet does not control", () => {
  approx(calcTank(tank()).top, 6.885564, 1e-5);
  const on = calcTank(tank({ overflow: { on: true } }));
  approx(on.top, 7.185564, 1e-5);
  approx(on.overflow.capacityLs, 153.981, 1e-2);
  approx(on.overflow.head, 0.65);
  assert.equal(on.controlledBy, 'overflow');
});

test('inlet controls when its soffit is highest', () => {
  const r = calcTank(tank({ inlet: { invert: 6.4, dn: 300 } }));
  approx(r.twl, TWL_TODAY);
  approx(r.inletSoffit, 6.7);
  assert.equal(r.controlledBy, 'inlet');
  approx(r.top, 7.2);
  assert.equal(r.warnings.inletDrowned, false);
});

test('inlet above the overflow: overflow head is top minus overflow centreline', () => {
  const r = calcTank(tank({ inlet: { invert: 6.6, dn: 300 }, overflow: { on: true } }));
  assert.equal(r.controlledBy, 'inlet');
  approx(r.top, 7.4);
  approx(r.overflow.soffit, TWL_TODAY + 0.3);
  approx(r.overflow.head, 7.4 - (TWL_TODAY + 0.15));
});

test('top water level controls a low inlet, and the inlet is drowned', () => {
  const r = calcTank(tank({ inlet: { invert: 3.0 } }));
  assert.equal(r.controlledBy, 'twl');
  assert.equal(r.warnings.inletDrowned, true);
});

test('a tie between inlet soffit and TWL goes to the inlet', () => {
  const twl = calcTank(tank()).twl;
  const r = calcTank(tank({ inlet: { invert: twl - 0.1, dn: 100 } }));
  approx(r.inletSoffit, r.twl, 1e-12);
  assert.equal(r.controlledBy, 'inlet');
});

test('vertical outlet measures submergence from the inlet plane', () => {
  const r = calcTank(tank({ outlet: { orientation: 'vertical', datumHeight: 0 } }));
  assert.equal(r.datum, 0);
  approx(r.mwl, r.submergence);
});

test('a bell mouth sets D and V for submergence, not for the pipe velocity', () => {
  const byFlow = calcTank(tank({ outlet: { flowMode: 'flow', flowLs: 47.124, bellOd: 300 } }));
  approx(byFlow.ds, 0.3);
  approx(byFlow.vs, 0.6667, 1e-3);
  approx(byFlow.pipeVelocity, 1.5, 1e-3);
  approx(byFlow.submergence, 0.3 * (1 + 2.3 * byFlow.vs / Math.sqrt(9.81 * 0.3)));
  const byVel = calcTank(tank({ outlet: { flowMode: 'velocity', velocity: 1.5, bellOd: 300 } }));
  approx(byVel.vs, 0.6667, 1e-3);
});

test('volumes and fill / draw-down times', () => {
  const r = calcTank(tank({ inlet: { flowLs: 20 }, outlet: { flowMode: 'flow', flowLs: 47.124 } }));
  approx(r.volumes.working, 100);
  approx(r.volumes.dead, r.area * r.mwl);
  approx(r.volumes.toTwl, r.area * r.twl);
  approx(r.volumes.gross, r.area * r.top);
  approx(r.fillTimeS, 5000);
  approx(r.drawDownTimeS, 100 / 0.027124, 1e-3);
  assert.equal(r.warnings.outletCantKeepUp, false);
});

test("outlet that can't keep up: no draw-down time, warning raised", () => {
  const r = calcTank(tank({ inlet: { flowLs: 20 }, outlet: { flowMode: 'flow', flowLs: 20 } }));
  assert.equal(r.drawDownTimeS, null);
  assert.equal(r.warnings.outletCantKeepUp, true);
});

test('zero inflow: fill time is null, not Infinity', () => {
  assert.equal(calcTank(tank({ inlet: { flowLs: 0 } })).fillTimeS, null);
});

test('overflow too small for the inflow fails with the shortfall', () => {
  const r = calcTank(tank({ inlet: { flowLs: 200 }, overflow: { on: true } }));
  assert.equal(r.overflow.pass, false);
  approx(r.overflow.shortfallLs, 200 - r.overflow.capacityLs);
  approx(r.overflow.shortfallLs, 46.02, 1e-2);
});

test('invalid input returns the bad fields instead of NaN', () => {
  const r = calcTank(tank({ tankDiameter: 0 }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('tankDiameter'));
  assert.ok(calcTank(tank({ outlet: { dn: NaN } })).errors.includes('outlet.dn'));
  assert.ok(calcTank(tank({ inlet: { flowLs: -1 } })).errors.includes('inlet.flowLs'));
  assert.ok(calcTank(tank({ overflow: { on: true, dn: 0 } })).errors.includes('overflow.dn'));
  assert.equal(calcTank(tank({ overflow: { on: false, dn: 0 } })).ok, true);
});

test('compareDiameters: sorted, de-duplicated, one calcTank per diameter', () => {
  const rows = compareDiameters(tank(), [6, 4, 5, 5]);
  assert.deepEqual(rows.map(r => r.diameter), [4, 5, 6]);
  const five = rows[1];
  approx(five.top, calcTank(tank()).top);
  approx(five.hdRatio, five.top / 5);
  assert.deepEqual(compareDiameters(tank(), [0, -2]), []);
});

// ── Final-review fixes ──
test('a bell mouth smaller than the outlet bore is rejected', () => {
  const r = calcTank(tank({ outlet: { bellOd: 30 } }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('outlet.bellOd'));
  assert.equal(calcTank(tank({ outlet: { bellOd: 200 } })).ok, true);
});

test('a discharge coefficient above 1 is rejected', () => {
  const r = calcTank(tank({ overflow: { on: true, cd: 6.1 } }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('overflow.cd'));
});

test('validatePipe flags blank, zero and negative pipe inputs', () => {
  assert.deepEqual(validatePipe({ qLs: 40, dnMm: 200, vMs: 1.27 }), []);
  assert.deepEqual(validatePipe({ qLs: 40, dnMm: -100, vMs: 1.27 }), ['dnMm']);
  assert.deepEqual(validatePipe({ qLs: NaN, dnMm: 0, vMs: 1 }), ['qLs', 'dnMm']);
  assert.deepEqual(validatePipe({ qLs: 40, dnMm: 200, vMs: -1 }), ['vMs']);
});
