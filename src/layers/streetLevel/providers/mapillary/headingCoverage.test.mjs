import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_SECTORS,
  SECTOR_NAMES,
  coverageGaps,
  headingCoverage,
  normalizeSectors,
  sectorCentres,
  sectorName,
  sectorOf,
} from './headingCoverage.js';

const shot = (compassAngle) => ({ compass_angle: compassAngle });

test('normalizeSectors keeps 8 and 12, rejects the rest', () => {
  assert.equal(normalizeSectors(undefined), DEFAULT_SECTORS);
  assert.equal(normalizeSectors(8), 8);
  assert.equal(normalizeSectors(12), 12);
  assert.equal(normalizeSectors(4), 4);
  assert.equal(normalizeSectors(7), null);
  assert.equal(normalizeSectors(9), 9);
  assert.equal(normalizeSectors(0), null);
  assert.equal(normalizeSectors(-8), null);
  assert.equal(normalizeSectors(3.5), null);
  assert.equal(normalizeSectors('8'), null);
  assert.equal(normalizeSectors(null), null);
  assert.equal(normalizeSectors(37), null);
});

test('sectorOf uses the eight-wind convention: north sits in sector 0', () => {
  assert.equal(sectorOf(0, 8), 0);
  assert.equal(sectorOf(22, 8), 0);
  assert.equal(sectorOf(23, 8), 1);
  assert.equal(sectorOf(45, 8), 1);
  assert.equal(sectorOf(90, 8), 2);
  assert.equal(sectorOf(180, 8), 4);
  assert.equal(sectorOf(270, 8), 6);
  assert.equal(sectorOf(337, 8), 7);
  // The 0°/360° wrap: 350° and 10° are both north-sector.
  assert.equal(sectorOf(350, 8), 0);
  assert.equal(sectorOf(10, 8), 0);
  assert.equal(sectorOf(-10, 8), 0);
  assert.equal(sectorOf(370, 8), 0);
  assert.equal(sectorOf(360, 8), 0);
  assert.equal(sectorOf(Number.NaN, 8), null);
  assert.equal(sectorOf('90', 8), null);
  assert.equal(sectorOf(90, 7), null);
});

test('sectorName names the eight winds and falls back to bearings', () => {
  assert.equal(SECTOR_NAMES.length, 8);
  assert.deepEqual(SECTOR_NAMES.slice(0, 3), ['N', 'NE', 'E']);
  assert.equal(sectorName(0, 8), 'N');
  assert.equal(sectorName(7, 8), 'NW');
  assert.equal(sectorName(1, 12), '030°');
  assert.equal(sectorName(0, 4), '000°');
  assert.equal(sectorName(8, 8), null);
  assert.equal(sectorName(-1, 8), null);
  assert.equal(sectorName(0, 7), null);
});

test('sectorCentres lays sectors clockwise from north', () => {
  assert.deepEqual(sectorCentres(8), [0, 45, 90, 135, 180, 225, 270, 315]);
  assert.deepEqual(sectorCentres(4), [0, 90, 180, 270]);
  assert.equal(sectorCentres(7), null);
});

test('all sectors covered means no gaps', () => {
  const photos = [0, 45, 90, 135, 180, 225, 270, 315].map(shot);
  const coverage = headingCoverage(photos);
  assert.equal(coverage.length, 8);
  for (const [index, sector] of coverage.entries()) {
    assert.equal(sector.index, index);
    assert.equal(sector.covered, true);
    assert.equal(sector.count, 1);
    assert.equal(sector.centerBearing, index * 45);
    assert.equal(sector.width, 45);
  }
  assert.deepEqual(coverageGaps(photos), []);
});

test('photos all facing north leave 7 of 8 sectors gapped', () => {
  const photos = [shot(0), shot(5), shot(355)];
  const coverage = headingCoverage(photos);
  const north = coverage[0];
  assert.equal(north.covered, true);
  assert.equal(north.count, 3);
  const gaps = coverageGaps(photos);
  assert.equal(gaps.length, 7);
  assert.deepEqual(
    gaps.map((gap) => gap.index),
    [1, 2, 3, 4, 5, 6, 7],
  );
  for (const gap of gaps) {
    assert.equal(gap.width, 45);
    assert.equal(gap.centerBearing, gap.index * 45);
    assert.equal(typeof gap.name, 'string');
  }
  assert.equal(gaps[0].name, 'NE');
  assert.equal(gaps[3].name, 'S');
});

test('350° and 10° count in the same sector', () => {
  const coverage = headingCoverage([shot(350), shot(10)]);
  assert.equal(coverage[0].covered, true);
  assert.equal(coverage[0].count, 2);
  assert.equal(coverage[7].covered, false);
  assert.equal(coverageGaps([shot(350), shot(10)]).length, 7);
});

test('a pano covers every sector on its own', () => {
  const photos = [{ is_pano: true }];
  assert.equal(coverageGaps(photos).length, 0);
  const coverage = headingCoverage(photos);
  for (const sector of coverage) {
    assert.equal(sector.covered, true);
    assert.equal(sector.count, 1);
  }
});

test('photos without a usable heading are skipped', () => {
  const photos = [{}, { compass_angle: 'bad' }, null, shot(90)];
  const coverage = headingCoverage(photos);
  assert.equal(coverage[2].covered, true);
  assert.equal(coverage[2].count, 1);
  assert.equal(coverageGaps(photos).length, 7);
});

test('empty photos leave every sector gapped', () => {
  assert.equal(coverageGaps([]).length, 8);
  const coverage = headingCoverage([]);
  assert.equal(
    coverage.every((sector) => !sector.covered),
    true,
  );
});

test('12 sectors work the same way, with 30° widths', () => {
  const photos = [shot(0), shot(30)];
  const coverage = headingCoverage(photos, { sectors: 12 });
  assert.equal(coverage.length, 12);
  assert.equal(coverage[0].covered, true);
  assert.equal(coverage[1].covered, true);
  assert.equal(coverage[0].width, 30);
  assert.equal(coverageGaps(photos, { sectors: 12 }).length, 10);
});

test('computed compass wins, matching the house headingOf rule', () => {
  const photos = [
    { computed_compass_angle: 90, compass_angle: 0 },
    { compass_angle: 270 },
  ];
  const coverage = headingCoverage(photos);
  assert.equal(coverage[2].covered, true); // 90 → east sector
  assert.equal(coverage[6].covered, true); // 270 → west sector
  assert.equal(coverage[0].covered, false);
});

test('invalid input returns null, never throws', () => {
  for (const photos of [null, undefined, {}, 'north', 8]) {
    assert.equal(headingCoverage(photos), null);
    assert.equal(coverageGaps(photos), null);
  }
  const photos = [shot(0)];
  assert.equal(headingCoverage(photos, { sectors: 7 }), null);
  assert.equal(coverageGaps(photos, { sectors: 7 }), null);
  assert.equal(headingCoverage(photos, { sectors: 0 }), null);
  assert.equal(headingCoverage(photos, { sectors: '8' }), null);
  assert.equal(headingCoverage(photos, null), null);
  assert.equal(headingCoverage(photos, [8]), null);
  assert.equal(coverageGaps(photos, null), null);
});
