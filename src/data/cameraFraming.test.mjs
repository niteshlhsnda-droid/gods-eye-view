// Camera framing pins: rangeForBoundingSphere is pure viewport math with no
// scene, tiles, or network, so these tests pin its edge cases exactly — the
// FOV fallback, the aspect-ratio clamp, which FOV limits, and the linear
// radius scaling. Any change to the 57% occupancy or the 1.05 breathing-room
// factor must update these numbers deliberately.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rangeForBoundingSphere } from './cameraFraming.js';

const DEG = Math.PI / 180;

function viewer(fov, aspectRatio) {
  return { camera: { frustum: { fov, aspectRatio } } };
}

function closeTo(actual, expected) {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `expected ${actual} to be within 1e-9 of ${expected}`,
  );
}

test('landscape 16:9 at 60° vertical FOV frames a radius-100 sphere', () => {
  closeTo(
    rangeForBoundingSphere(viewer(60 * DEG, 16 / 9), 100),
    357.0938779129893,
  );
});

test('a missing camera or frustum falls back to 60° FOV and aspect 1', () => {
  closeTo(rangeForBoundingSphere({}, 100), 357.0938779129893);
  closeTo(rangeForBoundingSphere({ camera: {} }, 100), 357.0938779129893);
  closeTo(rangeForBoundingSphere({ camera: { frustum: {} } }, 100), 357.0938779129893);
});

test('portrait aspect narrows the limiting FOV so the camera pulls back', () => {
  closeTo(
    rangeForBoundingSphere(viewer(60 * DEG, 0.5), 100),
    658.2838001518343,
  );
  assert.ok(
    rangeForBoundingSphere(viewer(60 * DEG, 0.5), 100) >
      rangeForBoundingSphere(viewer(60 * DEG, 16 / 9), 100),
  );
});

test('aspect ratio below 0.5 clamps to 0.5', () => {
  closeTo(
    rangeForBoundingSphere(viewer(60 * DEG, 0.1), 100),
    rangeForBoundingSphere(viewer(60 * DEG, 0.5), 100),
  );
  closeTo(
    rangeForBoundingSphere(viewer(60 * DEG, -2), 100),
    rangeForBoundingSphere(viewer(60 * DEG, 0.5), 100),
  );
});

test('a missing or zero aspect ratio falls back to 1', () => {
  closeTo(
    rangeForBoundingSphere(viewer(60 * DEG, 0), 100),
    rangeForBoundingSphere(viewer(60 * DEG, 1), 100),
  );
  closeTo(
    rangeForBoundingSphere(viewer(60 * DEG, undefined), 100),
    rangeForBoundingSphere(viewer(60 * DEG, 1), 100),
  );
});

test('aspect ratio at or above 1 never changes the range at fixed vertical FOV', () => {
  // Horizontal FOV already exceeds vertical FOV, so vertical FOV limits.
  const atOne = rangeForBoundingSphere(viewer(60 * DEG, 1), 100);
  closeTo(rangeForBoundingSphere(viewer(60 * DEG, 16 / 9), 100), atOne);
  closeTo(rangeForBoundingSphere(viewer(60 * DEG, 3), 100), atOne);
});

test('degenerate vertical FOV falls back to 60°', () => {
  const fallback = rangeForBoundingSphere(viewer(60 * DEG, 1), 100);
  closeTo(rangeForBoundingSphere(viewer(Number.NaN, 1), 100), fallback);
  closeTo(rangeForBoundingSphere(viewer(0, 1), 100), fallback);
  closeTo(rangeForBoundingSphere(viewer(undefined, 1), 100), fallback);
});

test('a numeric-string FOV coerces like a number', () => {
  closeTo(
    rangeForBoundingSphere(viewer(String(60 * DEG), 1), 100),
    rangeForBoundingSphere(viewer(60 * DEG, 1), 100),
  );
});

test('range scales linearly with radius and vanishes at zero radius', () => {
  const frustum = viewer(60 * DEG, 16 / 9);
  closeTo(
    rangeForBoundingSphere(frustum, 200),
    2 * rangeForBoundingSphere(frustum, 100),
  );
  assert.equal(rangeForBoundingSphere(frustum, 0), 0);
});

test('a wider vertical FOV pulls the camera closer, a narrower one pushes it out', () => {
  closeTo(
    rangeForBoundingSphere(viewer(120 * DEG, 16 / 9), 100),
    186.8050259753861,
  );
  closeTo(
    rangeForBoundingSphere(viewer(30 * DEG, 16 / 9), 100),
    706.2506293049472,
  );
});

test('a 1° telephoto FOV yields a finite but very large range', () => {
  const range = rangeForBoundingSphere(viewer(1 * DEG, 1), 100);
  assert.ok(Number.isFinite(range));
  closeTo(range, 21109.05844810437);
});

test('a negative radius passes its sign through to the range', () => {
  closeTo(
    rangeForBoundingSphere(viewer(60 * DEG, 16 / 9), -50),
    -178.54693895649464,
  );
});

test('the 57% occupancy and 1.05 breathing-room factor are pinned structurally', () => {
  const expected =
    (100 / Math.sin(((60 * DEG * 0.57) / 2))) * 1.05;
  closeTo(rangeForBoundingSphere(viewer(60 * DEG, 16 / 9), 100), expected);
});
