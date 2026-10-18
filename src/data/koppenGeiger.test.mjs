import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KOPPEN_TYPES,
  SUMMER_SHARE_THRESHOLD,
  WINTER_SHARE_THRESHOLD,
  koppenGeiger,
  koppenLabel,
  precipitationThreshold,
} from './koppenGeiger.js';

/**
 * External anchors: Peel, Finlayson & McMahon (2007), "Updated world
 * map of the Köppen-Geiger climate classification", Hydrol. Earth
 * Syst. Sci. 11, 1633-1644 (Table 1 criteria, B-first rule, 0°C C/D
 * boundary after Russell 1931, Cs/Cw and Ds/Dw summer-vs-winter
 * tie-break), https://hess.copernicus.org/articles/11/1633/2007/ ;
 * Kottek et al. (2006), Meteorol. Z. 15(3), 259-263. Paper PDF
 * fetched and Table 1 transcribed 2026-10-18.
 */

const fill = (value) => Array(12).fill(value);

test('table has 30 frozen types with unique codes in Table 1 order', () => {
  assert.equal(KOPPEN_TYPES.length, 30);
  assert.ok(Object.isFrozen(KOPPEN_TYPES));
  const codes = KOPPEN_TYPES.map((entry) => entry.code);
  assert.deepEqual(codes, [
    'Af',
    'Am',
    'Aw',
    'BWh',
    'BWk',
    'BSh',
    'BSk',
    'Csa',
    'Csb',
    'Csc',
    'Cfa',
    'Cfb',
    'Cfc',
    'Cwa',
    'Cwb',
    'Cwc',
    'Dsa',
    'Dsb',
    'Dsc',
    'Dsd',
    'Dfa',
    'Dfb',
    'Dfc',
    'Dfd',
    'Dwa',
    'Dwb',
    'Dwc',
    'Dwd',
    'ET',
    'EF',
  ]);
  assert.equal(new Set(codes).size, 30);
  KOPPEN_TYPES.forEach((entry) => assert.ok(Object.isFrozen(entry)));
});

test('Af rainforest: Pdry >= 60 classifies as rainforest', () => {
  const temp = fill(27);
  // Driest month exactly 60 mm -> Af (Peel: Pdry >= 60).
  const prcp = [60, ...fill(200).slice(1)];
  assert.equal(koppenGeiger(temp, prcp).code, 'Af');
});

test('Am monsoon at Pdry = 100 - MAP/25; Aw just below', () => {
  const temp = fill(27);
  // MAP = 2000 -> Am threshold is 100 - 2000/25 = 20 mm.
  const amPrcp = [20, ...Array(11).fill(180)];
  assert.equal(koppenGeiger(temp, amPrcp).code, 'Am');
  const awPrcp = [19.99, ...Array(11).fill(1980.01 / 11)];
  assert.equal(koppenGeiger(temp, awPrcp).code, 'Aw');
});

test('arid group is identified before the temperature groups', () => {
  // MAT = 15, even rain -> Pthreshold = 2*15 + 14 = 44, 10*Pth = 440.
  // Temperatures alone would read Cfb; MAP = 439 keeps it arid.
  const temp = [5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 15];
  assert.equal(koppenGeiger(temp, fill(439 / 12)).code, 'BSk');
  // MAP = 440 exactly is NOT arid (Peel: MAP < 10*Pth, strict).
  assert.equal(koppenGeiger(temp, fill(440 / 12)).code, 'Cfa');
});

test('BW/BS boundary: MAP = 5*Pth is steppe, just below is desert', () => {
  // MAT = 20, even rain -> Pthreshold = 2*20 + 14 = 54, 5*Pth = 270.
  const temp = fill(20);
  const steppe = [22.5, ...Array(11).fill(22.5)]; // MAP = 270 exactly
  assert.equal(koppenGeiger(temp, steppe).code, 'BSh');
  const desert = [22.4, ...Array(11).fill(22.5)]; // MAP = 269.9
  assert.equal(koppenGeiger(temp, desert).code, 'BWh');
});

test('B third letter: MAT >= 18 is hot, just below is cold', () => {
  assert.equal(koppenGeiger(fill(18), fill(0)).code, 'BWh');
  assert.equal(koppenGeiger(fill(17.99), fill(0)).code, 'BWk');
});

test('precipitationThreshold pins the 70% seasonal branches', () => {
  assert.equal(WINTER_SHARE_THRESHOLD, 0.7);
  assert.equal(SUMMER_SHARE_THRESHOLD, 0.7);
  // Winter share exactly 70% -> winter branch (footnote order).
  assert.equal(precipitationThreshold(15, 1000, 700, 300), 30);
  assert.equal(precipitationThreshold(15, 1000, 699.99, 300.01), 44);
  // Summer share exactly 70% -> summer branch.
  assert.equal(precipitationThreshold(15, 1000, 300, 700), 58);
  assert.equal(precipitationThreshold(15, 1000, 300, 699.99), 44);
  // MAP = 0 has no seasonal concentration -> neutral branch.
  assert.equal(precipitationThreshold(15, 0, 0, 0), 44);
  // Negative MAT lowers the threshold, per the formula.
  assert.equal(precipitationThreshold(-10, 500, 100, 100), -6);
});

test('C/D boundary follows Peel at 0°C, not Köppen -3°C', () => {
  const prcp = fill(800 / 12);
  const base = [4, 6, 8, 10, 12, 14, 16, 18, 20, 12, 10];
  // Tcold = 0.1 -> temperate.
  assert.equal(koppenGeiger([0.1, ...base], prcp).code, 'Cfb');
  // Tcold = 0 exactly -> cold (Table 1: Tcold <= 0).
  assert.equal(koppenGeiger([0, ...base], prcp).code, 'Dfb');
  // Tcold = -0.1 -> cold.
  assert.equal(koppenGeiger([-0.1, ...base], prcp).code, 'Dfb');
});

test('A/C boundary: Tcold >= 18 is tropical', () => {
  const prcp = fill(200);
  assert.equal(koppenGeiger(fill(18), prcp).code, 'Af');
  assert.equal(koppenGeiger(fill(17.99), prcp).code, 'Cfb');
});

test('Cs/Cw tie-break: w only when summer half-year is wetter', () => {
  // MAT = 8 -> Pthreshold = 2*8 + 14 = 30, 10*Pth = 300; MAP = 396
  // stays out of the arid group. Months in Jan..Dec order.
  const temp = [1, 2, 4, 6, 8, 10, 12, 14, 12, 10, 8, 9];
  // Jan..Dec. Summer = Apr-Sep (idx 3-8) with Psdry = 39 mm.
  const summerDry = [39, 39, 39, 39, 39, 39];
  // Both criteria hold (Psdry=39<40 and 39<120/3; Pwdry=2<39/10);
  // summer 234 > winter 162 -> Cw.
  const prcpCw = [2, 120, 10, ...summerDry, 10, 10, 10];
  assert.equal(koppenGeiger(temp, prcpCw).code, 'Cwb');
  // Exact tie (234 == 234) -> Cs, since Cw needs summer > winter.
  const prcpTie = [2, 120, 28, ...summerDry, 28, 28, 28];
  assert.equal(koppenGeiger(temp, prcpTie).code, 'Csb');
  // Cs only: wet winter kills the dry-winter criterion.
  const prcpCs = [150, 150, 150, 30, 30, 30, 30, 30, 30, 150, 150, 150];
  assert.equal(koppenGeiger(temp, prcpCs).code, 'Csb');
});

test('third-letter boundaries: a at Thot = 22, b at Tmon10 = 4, c below', () => {
  const prcp = fill(800 / 12);
  // Thot = 22 exactly -> hot summer.
  assert.equal(
    koppenGeiger([5, 7, 9, 11, 13, 15, 17, 19, 21, 22, 15, 13], prcp).code,
    'Cfa',
  );
  // Thot = 21.99, four months >= 10 -> warm summer.
  assert.equal(
    koppenGeiger([5, 5, 5, 5, 5, 5, 5, 5, 11, 12, 15, 21.99], prcp).code,
    'Cfb',
  );
  // Thot = 21.99, three months >= 10 -> cold summer.
  assert.equal(
    koppenGeiger([5, 5, 5, 5, 5, 5, 5, 5, 5, 11, 12, 21.99], prcp).code,
    'Cfc',
  );
});

test('D third letter d: Tcold < -38 with fewer than four warm months', () => {
  const prcp = fill(800 / 12);
  // Tcold = -38.01, Tmon10 = 3 -> Dfd.
  assert.equal(
    koppenGeiger([-38.01, -30, -20, -10, 0, 5, 8, 9, 12, 15, 20, 9], prcp).code,
    'Dfd',
  );
  // Tcold = -38 exactly is not "very cold winter" (strict <).
  assert.equal(
    koppenGeiger([-38, -30, -20, -10, 0, 5, 8, 9, 12, 15, 20, 9], prcp).code,
    'Dfc',
  );
});

test('polar: ET above freezing, EF at/below; Thot = 10 is unclassifiable', () => {
  const prcp = fill(100 / 12);
  assert.equal(
    koppenGeiger([0.1, -2, -4, -6, -8, -10, -12, -14, -16, -18, -20, -22], prcp)
      .code,
    'ET',
  );
  assert.equal(
    koppenGeiger([0, -2, -4, -6, -8, -10, -12, -14, -16, -18, -20, -22], prcp)
      .code,
    'EF',
  );
  assert.equal(
    koppenGeiger(
      [9.99, -2, -4, -6, -8, -10, -12, -14, -16, -18, -20, -22],
      prcp,
    ).code,
    'ET',
  );
  // Thot exactly 10 with enough rain to escape B: no Table 1 row
  // covers this boundary, so the classifier returns null.
  const wetEnough = fill(30); // MAP = 360 >= 10 * (2*10 + 14) = 340
  assert.strictEqual(koppenGeiger(fill(10), wetEnough), null);
});

test('southern hemisphere swaps the summer/winter half-years', () => {
  const temp = [8, 9, 10, 14, 17, 20, 19, 17, 14, 12, 10, 9];
  // Wet AMJJAS (indices 3-8), dry ONDJFM.
  const prcp = [5, 5, 5, 100, 100, 100, 100, 100, 100, 5, 5, 5];
  // Northern: summer is the wet half -> dry winter.
  assert.equal(koppenGeiger(temp, prcp).code, 'Cwb');
  // Southern: summer is the dry half -> dry summer.
  assert.equal(
    koppenGeiger(temp, prcp, { northernHemisphere: false }).code,
    'Csb',
  );
});

test('invalid input throws instead of guessing a type', () => {
  const temp = fill(15);
  const prcp = fill(100);
  assert.throws(() => koppenGeiger(fill(15).slice(0, 11), prcp), TypeError);
  assert.throws(
    () => koppenGeiger(temp, [-1, ...fill(100).slice(1)]),
    RangeError,
  );
  assert.throws(
    () => koppenGeiger([NaN, ...fill(15).slice(1)], prcp),
    TypeError,
  );
  assert.throws(() => koppenGeiger('15', prcp), TypeError);
  assert.throws(
    () => koppenGeiger(temp, prcp, { northernHemisphere: 1 }),
    TypeError,
  );
  assert.throws(() => precipitationThreshold('x', 1, 1, 1), TypeError);
  // Explicit null options fall back to northern-hemisphere defaults.
  assert.equal(koppenGeiger(temp, prcp, null).code, 'Cfb');
});

test('classifier returns the frozen table entry, never a copy', () => {
  const entry = koppenGeiger(fill(27), fill(200));
  assert.strictEqual(
    entry,
    KOPPEN_TYPES.find((type) => type.code === 'Af'),
  );
  assert.ok(Object.isFrozen(entry));
  assert.throws(() => {
    entry.code = 'XX';
  }, TypeError);
});

test('koppenLabel renders group and regime names', () => {
  const cfb = KOPPEN_TYPES.find((type) => type.code === 'Cfb');
  assert.equal(
    koppenLabel(cfb),
    'Cfb — Temperate, Without dry season, Warm Summer',
  );
  const et = KOPPEN_TYPES.find((type) => type.code === 'ET');
  assert.equal(koppenLabel(et), 'ET — Polar, Tundra');
  assert.equal(koppenLabel(null), 'Unclassified');
  assert.throws(() => koppenLabel({ code: 'Nope' }), TypeError);
});
