import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pitch, toothRadius, gearAngles, GEAR_CONFIG } from '../assets/js/gear-train.js';

test('pitch radius = module*Z/2', () => {
  assert.equal(pitch(14, 0.85), 0.85*14/2);
});

test('a tooth sits further out than a gap', () => {
  const p = pitch(10, 0.85);
  const toothU = 0.0;   // frac(u*Z)=0 -> tooth
  const gapU   = 0.05;  // frac(0.05*10)=0.5 -> gap
  assert.ok(toothRadius(toothU, 10, 0.85) > p);
  assert.ok(toothRadius(gapU, 10, 0.85) < p);
});

test('gearAngles enforces mesh ratios and directions', () => {
  const a0 = gearAngles(0, GEAR_CONFIG);
  const a1 = gearAngles(0.1, GEAR_CONFIG);
  const [ZA,ZB,ZC] = GEAR_CONFIG.gears.map(g=>g.Z);
  const rAB = (a1[1]-a0[1])/(a1[0]-a0[0]);
  const rBC = (a1[2]-a0[2])/(a1[1]-a0[1]);
  assert.ok(Math.abs(rAB - (-(ZA/ZB))) < 1e-9, `A→B ratio ${rAB}`);
  assert.ok(Math.abs(rBC - (-(ZB/ZC))) < 1e-9, `B→C ratio ${rBC}`);
});
