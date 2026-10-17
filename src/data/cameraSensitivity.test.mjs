import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cameraSensitivityClaims,
  claimCameraSensitivity,
  releaseCameraSensitivity,
} from './cameraSensitivity.js';

function camera(value = 0.5) {
  return { percentageChanged: value };
}

test('claim on a missing camera returns null without throwing', () => {
  assert.equal(claimCameraSensitivity(null, 'traffic', 0.05), null);
  assert.equal(claimCameraSensitivity(undefined, 'traffic', 0.05), null);
});

test('claim with an empty owner is rejected and leaves the camera alone', () => {
  const cam = camera();
  assert.equal(claimCameraSensitivity(cam, '', 0.05), null);
  assert.equal(cam.percentageChanged, 0.5);
  assert.deepEqual(cameraSensitivityClaims(cam), []);
});

test('claim with a non-finite value is rejected and records no claim', () => {
  const cam = camera();
  for (const value of [Number.NaN, Infinity, -Infinity, undefined]) {
    assert.equal(claimCameraSensitivity(cam, 'traffic', value), null);
  }
  assert.equal(cam.percentageChanged, 0.5);
  assert.deepEqual(cameraSensitivityClaims(cam), []);
});

test('claim returns the value now in force and release restores the base', () => {
  const cam = camera(0.5);
  assert.equal(claimCameraSensitivity(cam, 'traffic', 0.05), 0.05);
  assert.equal(cam.percentageChanged, 0.05);
  assert.equal(releaseCameraSensitivity(cam, 'traffic'), 0.5);
  assert.equal(cam.percentageChanged, 0.5);
});

test('a non-finite starting value falls back to the 0.5 default base', () => {
  // NOTE: build the cameras literally — camera(undefined) would hit the
  // helper's default parameter and test 0.5 instead of undefined.
  for (const start of [Number.NaN, undefined, Infinity, -Infinity]) {
    const cam = { percentageChanged: start };
    assert.equal(claimCameraSensitivity(cam, 'traffic', 0.1), 0.1);
    assert.equal(releaseCameraSensitivity(cam, 'traffic'), 0.5);
    assert.equal(cam.percentageChanged, 0.5);
  }
});

test('a coarser claim never loosens a finer one already held', () => {
  const cam = camera();
  claimCameraSensitivity(cam, 'traffic', 0.05);
  assert.equal(claimCameraSensitivity(cam, 'bikeshare', 0.2), 0.05);
  assert.equal(cam.percentageChanged, 0.05);
});

test('a finer claim tightens past a coarser one already held', () => {
  const cam = camera();
  claimCameraSensitivity(cam, 'bikeshare', 0.2);
  assert.equal(claimCameraSensitivity(cam, 'traffic', 0.05), 0.05);
  assert.equal(cam.percentageChanged, 0.05);
});

test('releasing the finer claim restores the coarser survivor', () => {
  const cam = camera();
  claimCameraSensitivity(cam, 'traffic', 0.05);
  claimCameraSensitivity(cam, 'bikeshare', 0.2);
  assert.equal(releaseCameraSensitivity(cam, 'traffic'), 0.2);
  assert.equal(cam.percentageChanged, 0.2);
  assert.deepEqual(cameraSensitivityClaims(cam), ['bikeshare']);
});

test('re-claiming under the same owner replaces the old claim', () => {
  const cam = camera();
  claimCameraSensitivity(cam, 'traffic', 0.05);
  assert.equal(claimCameraSensitivity(cam, 'traffic', 0.3), 0.3);
  assert.deepEqual(cameraSensitivityClaims(cam), ['traffic']);
  assert.equal(claimCameraSensitivity(cam, 'traffic', 0.01), 0.01);
  assert.deepEqual(cameraSensitivityClaims(cam), ['traffic']);
  assert.equal(releaseCameraSensitivity(cam, 'traffic'), 0.5);
});

test('releasing an unknown owner is a no-op returning the current value', () => {
  const cam = camera();
  claimCameraSensitivity(cam, 'traffic', 0.05);
  assert.equal(releaseCameraSensitivity(cam, 'bikeshare'), 0.05);
  assert.equal(cam.percentageChanged, 0.05);
  assert.deepEqual(cameraSensitivityClaims(cam), ['traffic']);
});

test('release on a never-claimed camera returns null', () => {
  const cam = camera();
  assert.equal(releaseCameraSensitivity(cam, 'traffic'), null);
  assert.equal(cam.percentageChanged, 0.5);
});

test('release with a missing camera or empty owner returns null', () => {
  const cam = camera();
  claimCameraSensitivity(cam, 'traffic', 0.05);
  assert.equal(releaseCameraSensitivity(null, 'traffic'), null);
  assert.equal(releaseCameraSensitivity(cam, ''), null);
  assert.equal(cam.percentageChanged, 0.05);
  assert.deepEqual(cameraSensitivityClaims(cam), ['traffic']);
});

test('a second release after the last claim returns null', () => {
  const cam = camera();
  claimCameraSensitivity(cam, 'traffic', 0.05);
  assert.equal(releaseCameraSensitivity(cam, 'traffic'), 0.5);
  assert.equal(releaseCameraSensitivity(cam, 'traffic'), null);
  assert.deepEqual(cameraSensitivityClaims(cam), []);
});

test('claims list empties once the last claim is released', () => {
  const cam = camera();
  claimCameraSensitivity(cam, 'traffic', 0.05);
  claimCameraSensitivity(cam, 'bikeshare', 0.2);
  assert.deepEqual(cameraSensitivityClaims(cam), ['traffic', 'bikeshare']);
  releaseCameraSensitivity(cam, 'traffic');
  assert.deepEqual(cameraSensitivityClaims(cam), ['bikeshare']);
  releaseCameraSensitivity(cam, 'bikeshare');
  assert.deepEqual(cameraSensitivityClaims(cam), []);
});

test('claims on a missing camera report an empty list', () => {
  assert.deepEqual(cameraSensitivityClaims(null), []);
  assert.deepEqual(cameraSensitivityClaims(undefined), []);
});

test('the base is captured once: release restores the original, not a drifted value', () => {
  const cam = camera(0.5);
  claimCameraSensitivity(cam, 'traffic', 0.05);
  cam.percentageChanged = 0.9;
  assert.equal(releaseCameraSensitivity(cam, 'traffic'), 0.5);
  assert.equal(cam.percentageChanged, 0.5);
});

test('two cameras keep independent ledgers', () => {
  const first = camera(0.5);
  const second = camera(0.4);
  claimCameraSensitivity(first, 'traffic', 0.05);
  assert.equal(first.percentageChanged, 0.05);
  assert.equal(second.percentageChanged, 0.4);
  assert.deepEqual(cameraSensitivityClaims(second), []);
  assert.equal(releaseCameraSensitivity(first, 'traffic'), 0.5);
  assert.equal(second.percentageChanged, 0.4);
});

test('a claim coarser than the base still records, but leaves the value at the base', () => {
  const cam = camera(0.5);
  assert.equal(claimCameraSensitivity(cam, 'traffic', 0.9), 0.5);
  assert.equal(cam.percentageChanged, 0.5);
  assert.deepEqual(cameraSensitivityClaims(cam), ['traffic']);
  assert.equal(releaseCameraSensitivity(cam, 'traffic'), 0.5);
  assert.deepEqual(cameraSensitivityClaims(cam), []);
});

test('a negative claim is accepted as the finest value (only finiteness is checked)', () => {
  const cam = camera(0.5);
  assert.equal(claimCameraSensitivity(cam, 'traffic', -0.1), -0.1);
  assert.equal(cam.percentageChanged, -0.1);
  assert.equal(releaseCameraSensitivity(cam, 'traffic'), 0.5);
});

test('falsy non-string owners are rejected and record no claim', () => {
  const cam = camera();
  for (const owner of [0, false, null, undefined]) {
    assert.equal(claimCameraSensitivity(cam, owner, 0.05), null);
  }
  assert.equal(cam.percentageChanged, 0.5);
  assert.deepEqual(cameraSensitivityClaims(cam), []);
});

test('the claims list is a copy: mutating it does not touch the ledger', () => {
  const cam = camera();
  claimCameraSensitivity(cam, 'traffic', 0.05);
  const listed = cameraSensitivityClaims(cam);
  listed.push('forged');
  listed.length = 0;
  assert.deepEqual(cameraSensitivityClaims(cam), ['traffic']);
  assert.equal(releaseCameraSensitivity(cam, 'traffic'), 0.5);
});

test('after the last release the ledger is gone, so a new claim re-captures the base', () => {
  const cam = camera(0.5);
  claimCameraSensitivity(cam, 'traffic', 0.05);
  assert.equal(releaseCameraSensitivity(cam, 'traffic'), 0.5);
  cam.percentageChanged = 0.7;
  assert.equal(claimCameraSensitivity(cam, 'traffic', 0.1), 0.1);
  assert.equal(releaseCameraSensitivity(cam, 'traffic'), 0.7);
  assert.equal(cam.percentageChanged, 0.7);
});

test('a claim equal to the base leaves the value at the base', () => {
  const cam = camera(0.5);
  assert.equal(claimCameraSensitivity(cam, 'traffic', 0.5), 0.5);
  assert.equal(releaseCameraSensitivity(cam, 'traffic'), 0.5);
});

test('a zero claim is the finest possible value and restores on release', () => {
  const cam = camera(0.5);
  assert.equal(claimCameraSensitivity(cam, 'traffic', 0), 0);
  assert.equal(cam.percentageChanged, 0);
  assert.equal(releaseCameraSensitivity(cam, 'traffic'), 0.5);
});

test('three claims: releasing the finest leaves the middle survivor, then the coarsest', () => {
  const cam = camera();
  claimCameraSensitivity(cam, 'traffic', 0.05);
  claimCameraSensitivity(cam, 'bikeshare', 0.2);
  claimCameraSensitivity(cam, 'transit', 0.1);
  assert.equal(cam.percentageChanged, 0.05);
  assert.equal(releaseCameraSensitivity(cam, 'traffic'), 0.1);
  assert.equal(cam.percentageChanged, 0.1);
  assert.equal(releaseCameraSensitivity(cam, 'transit'), 0.2);
  assert.equal(cam.percentageChanged, 0.2);
  assert.deepEqual(cameraSensitivityClaims(cam), ['bikeshare']);
  assert.equal(releaseCameraSensitivity(cam, 'bikeshare'), 0.5);
});

test('two owners claiming the same value: releasing one leaves the value unchanged', () => {
  const cam = camera();
  claimCameraSensitivity(cam, 'traffic', 0.05);
  claimCameraSensitivity(cam, 'bikeshare', 0.05);
  assert.equal(releaseCameraSensitivity(cam, 'traffic'), 0.05);
  assert.equal(cam.percentageChanged, 0.05);
  assert.deepEqual(cameraSensitivityClaims(cam), ['bikeshare']);
  assert.equal(releaseCameraSensitivity(cam, 'bikeshare'), 0.5);
});

test('owner names are case-sensitive: "traffic" and "Traffic" are distinct claims', () => {
  const cam = camera();
  claimCameraSensitivity(cam, 'traffic', 0.05);
  claimCameraSensitivity(cam, 'Traffic', 0.2);
  assert.deepEqual(cameraSensitivityClaims(cam), ['traffic', 'Traffic']);
  assert.equal(releaseCameraSensitivity(cam, 'traffic'), 0.2);
  assert.deepEqual(cameraSensitivityClaims(cam), ['Traffic']);
});

test('a new claim recomputes from the ledger, overwriting outside drift', () => {
  const cam = camera(0.5);
  claimCameraSensitivity(cam, 'traffic', 0.05);
  cam.percentageChanged = 0.9;
  assert.equal(claimCameraSensitivity(cam, 'bikeshare', 0.2), 0.05);
  assert.equal(cam.percentageChanged, 0.05);
  assert.equal(releaseCameraSensitivity(cam, 'traffic'), 0.2);
  assert.equal(releaseCameraSensitivity(cam, 'bikeshare'), 0.5);
});
