import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp,
  clamp01,
  clampInt,
  easeInOutCubic,
  inverseLerp,
  lerp,
  lerpClamped,
  smootherstep01,
  smoothstep,
  smoothstep01,
} from './interpMath.js';

function assertNear(actual, expected, tolerance, label) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} ± ${tolerance}, got ${actual}`,
  );
}

test('clamp keeps in-range values and clamps to the endpoints', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(0, 0, 10), 0);
  assert.equal(clamp(10, 0, 10), 10);
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(15, 0, 10), 10);
  assert.equal(clamp(-3, -10, -1), -3);
});

test('clamp follows nested Math.min/Math.max edge semantics', () => {
  assert.equal(clamp(Infinity, 0, 10), 10);
  assert.equal(clamp(-Infinity, 0, 10), 0);
  assert.ok(Number.isNaN(clamp(NaN, 0, 10)));
  // Reversed range returns min, same as Math.max(min, Math.min(max, v)).
  assert.equal(clamp(5, 10, 0), 10);
  // -0 normalizes to +0.
  assert.ok(Object.is(clamp(-0, 0, 1), 0));
  assert.equal(1 / clamp(-0, 0, 1), Infinity);
});

test('clamp01 clamps to [0, 1]', () => {
  assert.equal(clamp01(0.4), 0.4);
  assert.equal(clamp01(-2), 0);
  assert.equal(clamp01(2), 1);
  assert.equal(clamp01(Infinity), 1);
  assert.ok(Number.isNaN(clamp01(NaN)));
});

test('clampInt floors first, then clamps', () => {
  assert.equal(clampInt(2.9, 0, 10), 2);
  assert.equal(clampInt(5.0, 0, 10), 5);
  assert.equal(clampInt(-0.5, 0, 10), 0);
  assert.equal(clampInt(-3, 0, 10), 0);
  assert.equal(clampInt(10.9, 0, 10), 10);
  assert.ok(Number.isNaN(clampInt(NaN, 0, 10)));
});

test('lerp interpolates and extrapolates out of range', () => {
  assert.equal(lerp(0, 10, 0), 0);
  assert.equal(lerp(0, 10, 0.5), 5);
  assert.equal(lerp(0, 10, 1), 10);
  assert.equal(lerp(0, 10, 2), 20);
  assert.equal(lerp(0, 10, -0.5), -5);
  assert.equal(lerp(10, 0, 0.25), 7.5);
});

test('lerpClamped stays on the segment', () => {
  assert.equal(lerpClamped(0, 10, 0.25), 2.5);
  assert.equal(lerpClamped(0, 10, 2), 10);
  assert.equal(lerpClamped(0, 10, -1), 0);
  assert.equal(lerpClamped(10, 0, 2), 0);
});

test('inverseLerp inverts lerp, is unclamped, and is 0 on a degenerate range', () => {
  assert.equal(inverseLerp(0, 10, 5), 0.5);
  assert.equal(inverseLerp(0, 10, 0), 0);
  assert.equal(inverseLerp(0, 10, 10), 1);
  assert.equal(inverseLerp(0, 10, 20), 2);
  assert.equal(inverseLerp(10, 0, 5), 0.5);
  assert.equal(inverseLerp(5, 5, 5), 0);
  assert.equal(inverseLerp(5, 5, 999), 0);
  assertNear(
    lerp(2, 8, inverseLerp(2, 8, 6.5)),
    6.5,
    1e-12,
    'lerp(inverseLerp(v)) round-trip',
  );
});

test('smoothstep01 is the cubic with zero slope at both ends', () => {
  assert.equal(smoothstep01(0), 0);
  assert.equal(smoothstep01(0.5), 0.5);
  assert.equal(smoothstep01(1), 1);
  assertNear(smoothstep01(0.25), 0.15625, 1e-12, 'smoothstep01(0.25)');
  assertNear(smoothstep01(0.75), 0.84375, 1e-12, 'smoothstep01(0.75)');
  assert.equal(smoothstep01(-1), 0);
  assert.equal(smoothstep01(2), 1);
  // Point symmetry about (0.5, 0.5).
  for (const t of [0.1, 0.3, 0.7, 0.9]) {
    assertNear(
      smoothstep01(t) + smoothstep01(1 - t),
      1,
      1e-12,
      `smoothstep01 symmetry at ${t}`,
    );
  }
});

test('smoothstep maps [from, to] through smoothstep01', () => {
  assert.equal(smoothstep(2, 10, 2), 0);
  assert.equal(smoothstep(2, 10, 6), 0.5);
  assert.equal(smoothstep(2, 10, 10), 1);
  assertNear(smoothstep(2, 10, 4), 0.15625, 1e-12, 'smoothstep(2,10,4)');
  assert.equal(smoothstep(2, 10, 0), 0);
  assert.equal(smoothstep(2, 10, 99), 1);
  // Consistency: smoothstep(from, to, v) === smoothstep01(inverseLerp(...)).
  for (const v of [-5, 2, 3.5, 6, 9.9, 10, 40]) {
    assertNear(
      smoothstep(2, 10, v),
      smoothstep01(inverseLerp(2, 10, v)),
      1e-12,
      `smoothstep consistency at ${v}`,
    );
  }
});

test('smoothstep falls back to a step on a degenerate range', () => {
  assert.equal(smoothstep(5, 5, 5), 1);
  assert.equal(smoothstep(5, 5, 4.9), 0);
  assert.equal(smoothstep(10, 2, 5), 1);
  assert.equal(smoothstep(10, 2, 1), 0);
});

test('smootherstep01 is the quintic, clamped and symmetric', () => {
  assert.equal(smootherstep01(0), 0);
  assert.equal(smootherstep01(0.5), 0.5);
  assert.equal(smootherstep01(1), 1);
  assertNear(smootherstep01(0.25), 0.103515625, 1e-12, 'smootherstep01(0.25)');
  assertNear(smootherstep01(0.75), 0.896484375, 1e-12, 'smootherstep01(0.75)');
  assert.equal(smootherstep01(-1), 0);
  assert.equal(smootherstep01(2), 1);
  for (const t of [0.1, 0.3, 0.7, 0.9]) {
    assertNear(
      smootherstep01(t) + smootherstep01(1 - t),
      1,
      1e-12,
      `smootherstep01 symmetry at ${t}`,
    );
  }
});

test('easeInOutCubic matches the director formula and is symmetric', () => {
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(0.5), 0.5);
  assert.equal(easeInOutCubic(1), 1);
  assertNear(easeInOutCubic(0.25), 0.0625, 1e-12, 'easeInOutCubic(0.25)');
  assertNear(easeInOutCubic(0.75), 0.9375, 1e-12, 'easeInOutCubic(0.75)');
  assert.equal(easeInOutCubic(-1), 0);
  assert.equal(easeInOutCubic(2), 1);
  for (const t of [0.1, 0.3, 0.7, 0.9]) {
    assertNear(
      easeInOutCubic(t) + easeInOutCubic(1 - t),
      1,
      1e-12,
      `easeInOutCubic symmetry at ${t}`,
    );
  }
});

test('easing helpers are monotonic on [0, 1]', () => {
  for (const fn of [smoothstep01, smootherstep01, easeInOutCubic]) {
    let previous = -Infinity;
    for (let i = 0; i <= 20; i += 1) {
      const value = fn(i / 20);
      assert.ok(
        value >= previous,
        `${fn.name} decreases at t=${i / 20}: ${previous} -> ${value}`,
      );
      previous = value;
    }
  }
});
