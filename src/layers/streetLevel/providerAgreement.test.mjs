import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGREEMENT_PANO_REACH_FACTOR,
  AGREEMENT_RADIUS_M,
  agreementPick,
} from './providerAgreement.js';

const mapillary = (metres, extra = {}) => ({
  providerId: 'mapillary',
  recordId: 'm1',
  metres,
  isPano: false,
  capturedAt: 1_700_000_000_000,
  ...extra,
});
const kartaview = (metres, extra = {}) => ({
  providerId: 'kartaview',
  recordId: 'k1',
  metres,
  isPano: false,
  capturedAt: 1_690_000_000_000,
  ...extra,
});

test('empty or unusable input returns null', () => {
  assert.equal(agreementPick([]), null);
  assert.equal(agreementPick(null), null);
  assert.equal(agreementPick(undefined), null);
  assert.equal(agreementPick([null, 42, 'nope']), null);
  assert.equal(
    agreementPick([
      { providerId: 'mapillary', recordId: 'm1', metres: Number.NaN },
      { providerId: 'kartaview', recordId: 'k1', metres: -3 },
      { providerId: 'google', metres: 5 },
    ]),
    null,
  );
});

test('a single usable pick wins even outside the agreement radius', () => {
  const only = mapillary(AGREEMENT_RADIUS_M + 50);
  assert.equal(agreementPick([only]), only);
});

test('agreement radius constant is 20 m', () => {
  assert.equal(AGREEMENT_RADIUS_M, 20);
  assert.equal(AGREEMENT_PANO_REACH_FACTOR, 2);
});

test('the nearer provider wins over registry order when both agree', () => {
  // Deliberately passed in "wrong" (registry) order: the farther Mapillary
  // pick first, the nearer KartaView pick second.
  const winner = agreementPick([mapillary(18), kartaview(6)]);
  assert.equal(winner.providerId, 'kartaview');
  assert.equal(winner.metres, 6);
});

test('picks outside the radius do not displace an agreeing pair', () => {
  const google = { providerId: 'google', recordId: 'g1', metres: 3 };
  const winner = agreementPick([mapillary(25), kartaview(30), google]);
  assert.equal(winner.providerId, 'google');
});

test('with no agreement the nearest overall pick still wins', () => {
  // A 45 m provider-listed-first shot used to beat a 30 m shot from a
  // later provider; distance decides now.
  const winner = agreementPick([mapillary(45), kartaview(30)]);
  assert.equal(winner.providerId, 'kartaview');
});

test('a pano within 2x the nearest flat distance wins the agreement', () => {
  const winner = agreementPick([
    mapillary(8),
    kartaview(15, { isPano: true, recordId: 'k-pano' }),
  ]);
  assert.equal(winner.recordId, 'k-pano');
});

test('a pano beyond 2x the nearest flat distance does not win', () => {
  const winner = agreementPick([
    mapillary(8),
    kartaview(8 * AGREEMENT_PANO_REACH_FACTOR + 0.5, {
      isPano: true,
      recordId: 'k-pano',
    }),
  ]);
  assert.equal(winner.providerId, 'mapillary');
});

test('an agreeing pano within reach wins over a nearer flat', () => {
  const pano = kartaview(4, { isPano: true, recordId: 'k-pano' });
  assert.equal(agreementPick([mapillary(3), pano]).recordId, 'k-pano');
});

test('a pano that is itself nearest wins immediately', () => {
  const pano = kartaview(3, { isPano: true, recordId: 'k-pano' });
  assert.equal(agreementPick([mapillary(5), pano]).recordId, 'k-pano');
});

test('exact distance ties go to the fresher capture', () => {
  const old = mapillary(10, { capturedAt: 1_600_000_000_000 });
  const fresh = kartaview(10, { capturedAt: 1_750_000_000_000 });
  assert.equal(agreementPick([old, fresh]).providerId, 'kartaview');
});

test('unknown capture dates sort last in a distance tie', () => {
  const undated = mapillary(10, { capturedAt: 0 });
  const dated = kartaview(10, { capturedAt: 1_700_000_000_000 });
  assert.equal(agreementPick([undated, dated]).providerId, 'kartaview');
});

test('a full tie is deterministic across provider ids', () => {
  const a = kartaview(10, { capturedAt: 0 });
  const b = mapillary(10, { capturedAt: 0 });
  assert.equal(agreementPick([a, b]).providerId, 'kartaview');
  assert.equal(agreementPick([b, a]).providerId, 'kartaview');
});

test('missing freshness fields do not break the comparison', () => {
  const winner = agreementPick([
    { providerId: 'mapillary', recordId: 'm1', metres: 12 },
    { providerId: 'kartaview', recordId: 'k1', metres: 9 },
  ]);
  assert.equal(winner.providerId, 'kartaview');
});

test('a custom agreement radius narrows the agreeing set', () => {
  const winner = agreementPick([mapillary(12), kartaview(6)], {
    agreementRadiusM: 5,
  });
  // Neither agrees at 5 m: nearest overall still wins.
  assert.equal(winner.providerId, 'kartaview');
});

test('an invalid radius option falls back to the 20 m default', () => {
  const winner = agreementPick([mapillary(18), kartaview(6)], {
    agreementRadiusM: Number.NaN,
  });
  assert.equal(winner.providerId, 'kartaview');
});

test('zero-distance picks are usable and nearest', () => {
  const winner = agreementPick([kartaview(0), mapillary(0.5)]);
  assert.equal(winner.providerId, 'kartaview');
});

test('input array is not mutated', () => {
  const picks = [mapillary(18), kartaview(6)];
  agreementPick(picks);
  assert.equal(picks[0].providerId, 'mapillary');
  assert.equal(picks[1].providerId, 'kartaview');
});
