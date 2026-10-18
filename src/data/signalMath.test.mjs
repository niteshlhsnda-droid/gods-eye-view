import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addPowerDbm,
  amplitudeRatioToDb,
  dbToAmplitudeRatio,
  dbToPowerRatio,
  dbmToDbw,
  dbmToMw,
  dbmToWatts,
  dbwToDbm,
  dbwToMw,
  freeSpacePathLossDb,
  freeSpacePathLossDbMhzKm,
  linkBudgetDbm,
  linkMarginDb,
  mwToDbm,
  mwToDbw,
  powerRatioToDb,
  snrDb,
  sumPowerDbm,
  thermalNoiseDbm,
  wattsToDbm,
} from './signalMath.js';

function assertNear(actual, expected, tolerance, label) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} ± ${tolerance}, got ${actual}`,
  );
}

test('dbmToMw / mwToDbm: canonical reference points', () => {
  assert.equal(dbmToMw(0), 1);
  assert.equal(dbmToMw(30), 1000);
  assert.equal(dbmToMw(20), 100);
  assertNear(dbmToMw(-30), 0.001, 1e-15, 'dbmToMw(-30)');
  assert.equal(mwToDbm(1), 0);
  assert.equal(mwToDbm(1000), 30);
  assert.equal(mwToDbm(100), 20);
  assertNear(mwToDbm(0.001), -30, 1e-12, 'mwToDbm(0.001)');
});

test('mwToDbm / dbmToMw: zero and infinity are exact limits, negatives are NaN', () => {
  assert.equal(mwToDbm(0), -Infinity);
  assert.equal(mwToDbm(Infinity), Infinity);
  assert.ok(Number.isNaN(mwToDbm(-1)));
  assert.ok(Number.isNaN(mwToDbm(NaN)));
  assert.ok(Number.isNaN(mwToDbm('1')));
  assert.equal(dbmToMw(-Infinity), 0);
  assert.equal(dbmToMw(Infinity), Infinity);
  assert.ok(Number.isNaN(dbmToMw(NaN)));
});

test('powerRatioToDb / dbToPowerRatio: 10*log10 family, 3 dB ≈ doubling', () => {
  assert.equal(powerRatioToDb(1), 0);
  assert.equal(powerRatioToDb(10), 10);
  assert.equal(powerRatioToDb(0.1), -10);
  assertNear(powerRatioToDb(2), 3.0102999566398121, 1e-12, '3 dB doubling');
  assert.equal(dbToPowerRatio(0), 1);
  assert.equal(dbToPowerRatio(10), 10);
  assert.equal(dbToPowerRatio(-10), 0.1);
  assertNear(dbToPowerRatio(3), 1.9952623149688797, 1e-12, 'dbToPowerRatio(3)');
  assert.equal(powerRatioToDb(0), -Infinity);
  assert.ok(Number.isNaN(powerRatioToDb(-2)));
  assert.ok(Number.isNaN(powerRatioToDb(NaN)));
  assert.ok(Number.isNaN(dbToPowerRatio(NaN)));
});

test('amplitudeRatioToDb / dbToAmplitudeRatio: 20*log10 family, 6 dB ≈ doubling', () => {
  assert.equal(amplitudeRatioToDb(1), 0);
  assert.equal(amplitudeRatioToDb(10), 20);
  assert.equal(amplitudeRatioToDb(0.1), -20);
  assertNear(amplitudeRatioToDb(2), 6.020599913279624, 1e-12, '6 dB doubling');
  assert.equal(dbToAmplitudeRatio(0), 1);
  assert.equal(dbToAmplitudeRatio(20), 10);
  assert.equal(dbToAmplitudeRatio(-20), 0.1);
  assert.equal(amplitudeRatioToDb(0), -Infinity);
  assert.ok(Number.isNaN(amplitudeRatioToDb(-1)));
});

test('power vs amplitude families are NOT interchangeable', () => {
  // Same ratio, different dB: 10*log10 vs 20*log10.
  assert.notEqual(powerRatioToDb(2), amplitudeRatioToDb(2));
  assert.equal(powerRatioToDb(100), amplitudeRatioToDb(10));
});

test('dBW conversions differ from dBm by exactly 30 dB', () => {
  assert.equal(dbmToDbw(30), 0);
  assert.equal(dbmToDbw(0), -30);
  assert.equal(dbwToDbm(0), 30);
  assert.equal(dbwToDbm(-30), 0);
  assert.equal(dbwToMw(0), 1000);
  assert.equal(dbwToMw(-Infinity), 0);
  assert.equal(dbwToMw(Infinity), Infinity);
  assert.equal(mwToDbw(1000), 0);
  assert.equal(mwToDbw(1), -30);
  assert.equal(mwToDbw(0), -Infinity);
  assert.ok(Number.isNaN(mwToDbw(-5)));
  assert.equal(dbmToDbw(-Infinity), -Infinity);
  assert.equal(dbmToDbw(Infinity), Infinity);
  assert.equal(dbwToDbm(-Infinity), -Infinity);
  assert.ok(Number.isNaN(dbmToDbw(NaN)));
});

test('watts conversions: 1 W = 30 dBm', () => {
  assert.equal(wattsToDbm(1), 30);
  assert.equal(dbmToWatts(30), 1);
  assert.equal(wattsToDbm(0), -Infinity);
  assert.equal(dbmToWatts(-Infinity), 0);
  assert.equal(dbmToWatts(Infinity), Infinity);
  assert.ok(Number.isNaN(wattsToDbm(-1)));
  assert.ok(Number.isNaN(dbmToWatts(NaN)));
  assertNear(wattsToDbm(0.001), 0, 1e-12, '1 mW = 0 dBm');
});

test('addPowerDbm / sumPowerDbm: powers add in the linear domain', () => {
  // Two equal 0 dBm signals sum to 3.0103 dBm, not 0 dBm and not 0 + 0.
  assertNear(addPowerDbm(0, 0), 3.0102999566398121, 1e-12, '0+0 dBm');
  assertNear(addPowerDbm(30, 30), 33.0102999566398121, 1e-9, '30+30 dBm');
  assertNear(sumPowerDbm([10, 10, 10]), 14.771212547196624, 1e-9, 'three 10s');
  assert.equal(sumPowerDbm([20]), 20);
  assert.equal(sumPowerDbm([]), -Infinity);
  // A -Infinity entry is "no signal" and contributes nothing.
  assert.equal(sumPowerDbm([0, -Infinity]), 0);
  assert.equal(sumPowerDbm([-Infinity, -Infinity]), -Infinity);
  assert.equal(sumPowerDbm([0, Infinity]), Infinity);
  assert.ok(Number.isNaN(sumPowerDbm([0, NaN])));
  assert.ok(Number.isNaN(sumPowerDbm([0, 'x'])));
  assert.ok(Number.isNaN(sumPowerDbm('not an array')));
  assert.ok(Number.isNaN(addPowerDbm(0, NaN)));
});

test('freeSpacePathLossDb: 2.4 GHz at 1 km ≈ 100.05 dB', () => {
  assertNear(
    freeSpacePathLossDb(2.4e9, 1000),
    100.05,
    0.01,
    'FSPL 2.4 GHz / 1 km',
  );
  // Doubling the distance adds exactly 6.02 dB; doubling frequency too.
  assertNear(
    freeSpacePathLossDb(2.4e9, 2000) - freeSpacePathLossDb(2.4e9, 1000),
    6.020599913279624,
    1e-9,
    'distance doubling',
  );
  assertNear(
    freeSpacePathLossDb(4.8e9, 1000) - freeSpacePathLossDb(2.4e9, 1000),
    6.020599913279624,
    1e-9,
    'frequency doubling',
  );
  assert.equal(freeSpacePathLossDb(2.4e9, 0), -Infinity);
  assert.ok(Number.isNaN(freeSpacePathLossDb(0, 1000)));
  assert.ok(Number.isNaN(freeSpacePathLossDb(-1, 1000)));
  assert.ok(Number.isNaN(freeSpacePathLossDb(2.4e9, -1)));
  assert.ok(Number.isNaN(freeSpacePathLossDb(NaN, 1000)));
});

test('freeSpacePathLossDbMhzKm: 32.44 engineering form agrees to ~0.01 dB', () => {
  assertNear(
    freeSpacePathLossDbMhzKm(2400, 1),
    100.04,
    0.01,
    'FSPL MHz/km 2400 MHz / 1 km',
  );
  assertNear(
    freeSpacePathLossDbMhzKm(2400, 1) - freeSpacePathLossDb(2.4e9, 1000),
    0,
    0.02,
    'two FSPL forms agree',
  );
  assert.equal(freeSpacePathLossDbMhzKm(2400, 0), -Infinity);
  assert.ok(Number.isNaN(freeSpacePathLossDbMhzKm(0, 1)));
  assert.ok(Number.isNaN(freeSpacePathLossDbMhzKm(2400, -1)));
});

test('thermalNoiseDbm: -174 dBm/Hz at 290 K, +10 dB per 10x bandwidth', () => {
  assertNear(thermalNoiseDbm(1), -173.98, 0.01, '1 Hz at 290 K');
  assertNear(thermalNoiseDbm(1e6), -113.98, 0.01, '1 MHz at 290 K');
  assertNear(
    thermalNoiseDbm(1e7) - thermalNoiseDbm(1e6),
    10,
    1e-9,
    '10x bandwidth = +10 dB',
  );
  // Warmer than 290 K raises the floor: 580 K is +3.01 dB (doubled kT).
  assertNear(
    thermalNoiseDbm(1, 580) - thermalNoiseDbm(1, 290),
    3.0102999566398121,
    1e-9,
    'doubled temperature',
  );
  assert.ok(Number.isNaN(thermalNoiseDbm(0)));
  assert.ok(Number.isNaN(thermalNoiseDbm(-100)));
  assert.ok(Number.isNaN(thermalNoiseDbm(1e6, 0)));
  assert.ok(Number.isNaN(thermalNoiseDbm(1e6, -1)));
  assert.ok(Number.isNaN(thermalNoiseDbm(NaN)));
});

test('linkBudgetDbm: additive budget, miscLoss defaults to 0', () => {
  assert.equal(
    linkBudgetDbm({
      txPowerDbm: 20,
      txGainDbi: 2,
      rxGainDbi: 2,
      pathLossDb: 100,
    }),
    -76,
  );
  assert.equal(
    linkBudgetDbm({
      txPowerDbm: 20,
      txGainDbi: 2,
      rxGainDbi: 2,
      pathLossDb: 100,
      miscLossDb: 3,
    }),
    -79,
  );
  assert.ok(
    Number.isNaN(linkBudgetDbm({ txPowerDbm: 20, txGainDbi: 2, rxGainDbi: 2 })),
    'missing pathLossDb is NaN',
  );
  assert.ok(Number.isNaN(linkBudgetDbm(null)));
  assert.ok(Number.isNaN(linkBudgetDbm('x')));
  assert.ok(
    Number.isNaN(
      linkBudgetDbm({
        txPowerDbm: NaN,
        txGainDbi: 2,
        rxGainDbi: 2,
        pathLossDb: 100,
      }),
    ),
  );
});

test('linkMarginDb / snrDb: plain differences', () => {
  assert.equal(linkMarginDb(-76, -90), 14);
  assert.equal(linkMarginDb(-95, -90), -5);
  assert.equal(snrDb(-76, -100), 24);
  assert.equal(snrDb(-100, -76), -24);
  assert.ok(Number.isNaN(linkMarginDb(-76, NaN)));
  assert.ok(Number.isNaN(snrDb(NaN, -100)));
});
