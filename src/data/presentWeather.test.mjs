import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRESENT_WEATHER_BY_CODE,
  PRESENT_WEATHER_GROUPS,
  PRESENT_WEATHER_GROUP_BY_ID,
  PRESENT_WEATHER_MAX_CODE,
  PRESENT_WEATHER_MIN_CODE,
  PRESENT_WEATHER_SCALE,
  classifyPresentWeather,
  presentWeatherGroup,
} from './presentWeather.js';

/**
 * External anchors. Every expected value below is a table entry
 * from the primary sources, not a computation:
 * - CEDA / BADC, "WMO Meteorological codes", WMO code 4677
 *   (manned station), codes 00-99 in full — the wording source
 *   for every description asserted here.
 * - Finnish Meteorological Institute, "Present weather: WMO
 *   code 4677" — the same 100 wordings; cross-checked against
 *   CEDA and found to agree on all 100.
 * - WMO Codes Registry, Code Table 4678: Significant weather
 *   phenomena — the METAR letter-code register, confirming
 *   that 4678 is NOT the numeric 00-99 table (that is 4677).
 * - CEDA's code 4680 (automatic station) table shows the
 *   conflicting reuse of the numbers (4680 code 11 = diamond
 *   dust, 4680 code 99 = tornado) — the two guard tests below
 *   pin this module to 4677, not 4680.
 * Group / timing assignments are GEV editorial (see the module
 * header); the group and timing arrays below assert the full
 * 100-code mapping explicitly.
 */

/** Expand [value, count] runs into a flat array. */
function expand(runs) {
  return runs.flatMap(([value, count]) => Array(count).fill(value));
}

test('scale table has 100 entries, codes 0-99 in order, frozen', () => {
  assert.equal(PRESENT_WEATHER_SCALE.length, 100);
  assert.deepEqual(
    PRESENT_WEATHER_SCALE.map((entry) => entry.code),
    Array.from({ length: 100 }, (_, i) => i),
  );
  assert.equal(PRESENT_WEATHER_MIN_CODE, 0);
  assert.equal(PRESENT_WEATHER_MAX_CODE, 99);
  assert.ok(Object.isFrozen(PRESENT_WEATHER_SCALE));
  assert.ok(PRESENT_WEATHER_SCALE.every((entry) => Object.isFrozen(entry)));
  assert.ok(Object.isFrozen(PRESENT_WEATHER_BY_CODE));
  assert.ok(Object.isFrozen(PRESENT_WEATHER_GROUPS));
  assert.ok(Object.isFrozen(PRESENT_WEATHER_GROUP_BY_ID));
  for (const entry of PRESENT_WEATHER_SCALE) {
    assert.equal(typeof entry.description, 'string');
    assert.ok(entry.description.length > 0);
    assert.equal(
      Object.keys(entry).sort().join(','),
      'code,description,group,timing',
    );
  }
});

test('table stores no colour code — WMO publishes none', () => {
  for (const entry of PRESENT_WEATHER_SCALE) {
    assert.ok(!('colour' in entry) && !('color' in entry));
  }
});

test('group mapping covers all 100 codes with the documented counts', () => {
  const expectedGroups = expand([
    ['sky', 4], // 00-03
    ['obscuration', 2], // 04-05
    ['dust-sand', 4], // 06-09
    ['fog', 3], // 10-12
    ['electrical', 1], // 13
    ['precipitation', 3], // 14-16
    ['thunderstorm', 1], // 17
    ['squall-funnel', 2], // 18-19
    ['precipitation', 8], // 20-27
    ['fog', 1], // 28
    ['thunderstorm', 1], // 29
    ['dust-sand', 6], // 30-35
    ['snow-drift', 4], // 36-39
    ['fog', 10], // 40-49
    ['precipitation', 41], // 50-90
    ['thunderstorm', 9], // 91-99
  ]);
  assert.equal(expectedGroups.length, 100);
  assert.deepEqual(
    PRESENT_WEATHER_SCALE.map((entry) => entry.group),
    expectedGroups,
  );
  const counts = {};
  for (const group of expectedGroups) {
    counts[group] = (counts[group] ?? 0) + 1;
  }
  assert.deepEqual(counts, {
    sky: 4,
    obscuration: 2,
    'dust-sand': 10,
    fog: 14,
    electrical: 1,
    precipitation: 52,
    thunderstorm: 11,
    'squall-funnel': 2,
    'snow-drift': 4,
  });
});

test('timing mapping covers all 100 codes', () => {
  const expectedTimings = expand([
    ['current', 14], // 00-13
    ['sight', 3], // 14-16
    ['current', 3], // 17-19
    ['preceding-hour', 10], // 20-29
    ['current', 10], // 30-39
    ['sight', 1], // 40
    ['current', 9], // 41-49
    ['current', 41], // 50-90
    ['mixed', 4], // 91-94
    ['current', 5], // 95-99
  ]);
  assert.equal(expectedTimings.length, 100);
  assert.deepEqual(
    PRESENT_WEATHER_SCALE.map((entry) => entry.timing),
    expectedTimings,
  );
});

test('group registry has 9 groups, one per id used by the table', () => {
  assert.deepEqual(
    PRESENT_WEATHER_GROUPS.map((group) => group.id),
    [
      'sky',
      'obscuration',
      'dust-sand',
      'fog',
      'electrical',
      'precipitation',
      'thunderstorm',
      'squall-funnel',
      'snow-drift',
    ],
  );
  for (const group of PRESENT_WEATHER_GROUPS) {
    assert.equal(typeof group.label, 'string');
    assert.ok(group.label.length > 0);
    assert.equal(PRESENT_WEATHER_GROUP_BY_ID[group.id], group);
  }
  const used = new Set(PRESENT_WEATHER_SCALE.map((entry) => entry.group));
  assert.deepEqual(
    [...used].sort(),
    PRESENT_WEATHER_GROUPS.map((group) => group.id).sort(),
  );
});

test('descriptions match the published WMO 4677 wording (spot-check)', () => {
  const expected = new Map([
    [0, 'Cloud development not observed or not observable'],
    [1, 'Clouds generally dissolving or becoming less developed'],
    [2, 'State of sky on the whole unchanged'],
    [3, 'Clouds generally forming or developing'],
    [
      4,
      'Visibility reduced by smoke, e.g. veldt or forest fires, industrial smoke or volcanic ashes',
    ],
    [5, 'Haze'],
    [
      6,
      'Widespread dust in suspension in the air, not raised by wind at or near the station at the time of observation',
    ],
    [
      7,
      'Dust or sand raised by wind at or near the station at the time of observation, but no well-developed dust whirl(s) or sand whirl(s), and no duststorm or sandstorm seen; or, in the case of ships, blowing spray at the station',
    ],
    [
      8,
      'Well-developed dust or sand whirl(s) seen at or near the station during the preceding hour or at the time of observation, but no duststorm or sandstorm',
    ],
    [
      9,
      'Duststorm or sandstorm within sight at the time of observation, or at the station during the preceding hour',
    ],
    [10, 'Mist'],
    [
      11,
      'Patches of shallow fog or ice fog at the station, whether on land or sea, not deeper than about 2 metres on land or 10 metres at sea',
    ],
    [13, 'Lightning visible, no thunder heard'],
    [
      14,
      'Precipitation within sight, not reaching the ground or the surface of the sea',
    ],
    [
      15,
      'Precipitation within sight, reaching the ground or the surface of the sea, but distant, i.e. more than 5 km from the station',
    ],
    [17, 'Thunderstorm, but no precipitation at the time of observation'],
    [
      19,
      'Funnel clouds at or within sight of the station during the preceding hour or at the time of observation',
    ],
    [
      20,
      'Drizzle (not freezing) or snow grains, not falling as showers, during the preceding hour but not at the time of observation',
    ],
    [
      29,
      'Thunderstorm (with or without precipitation) during the preceding hour but not at the time of observation',
    ],
    [
      30,
      'Slight or moderate duststorm or sandstorm, has decreased during the preceding hour',
    ],
    [
      35,
      'Severe duststorm or sandstorm, has begun or has increased during the preceding hour',
    ],
    [36, 'Slight or moderate drifting snow, generally low (below eye level)'],
    [
      40,
      'Fog or ice fog at a distance at the time of observation, but not at the station during the preceding hour, the fog or ice fog extending to a level above that of the observer',
    ],
    [41, 'Fog or ice fog in patches'],
    [48, 'Fog, depositing rime, sky visible'],
    [49, 'Fog, depositing rime, sky invisible'],
    [50, 'Drizzle, not freezing, intermittent, slight at time of observation'],
    [57, 'Drizzle, freezing, moderate or heavy (dense)'],
    [65, 'Rain, not freezing, continuous, heavy at time of observation'],
    [67, 'Rain, freezing, moderate or heavy'],
    [70, 'Intermittent fall of snowflakes, slight at time of observation'],
    [76, 'Diamond dust (with or without fog)'],
    [79, 'Ice pellets'],
    [82, 'Rain shower(s), violent'],
    [
      87,
      'Shower(s) of snow pellets or small hail, with or without rain or rain and snow mixed, slight',
    ],
    [
      89,
      'Shower(s) of hail, with or without rain or rain and snow mixed, not associated with thunder, slight',
    ],
    [
      91,
      'Slight rain at time of observation; thunderstorm during the preceding hour but not at time of observation',
    ],
    [
      94,
      'Moderate or heavy snow, or rain and snow mixed or hail at time of observation; thunderstorm during the preceding hour but not at time of observation',
    ],
    [
      95,
      'Thunderstorm, slight or moderate, without hail, but with rain and/or snow at time of observation',
    ],
    [96, 'Thunderstorm, slight or moderate, with hail at time of observation'],
    [98, 'Thunderstorm combined with dust/sandstorm at time of observation'],
    [99, 'Thunderstorm, heavy, with hail at time of observation'],
  ]);
  for (const [code, description] of expected) {
    assert.equal(classifyPresentWeather(code).description, description);
  }
});

test('this is the 4677 table, not the 4680 automatic-station table', () => {
  // 4680 code 11 is diamond dust; 4677 code 11 is shallow fog.
  assert.match(classifyPresentWeather(11).description, /shallow fog/);
  assert.equal(
    classifyPresentWeather(76).description,
    'Diamond dust (with or without fog)',
  );
  // 4680 code 99 is tornado; 4677 code 99 is a thunderstorm.
  assert.equal(
    classifyPresentWeather(99).description,
    'Thunderstorm, heavy, with hail at time of observation',
  );
  assert.equal(classifyPresentWeather(99).group, 'thunderstorm');
});

test('grouping edge calls: lightning vs thunderstorm, hail shower vs thunderstorm', () => {
  // 13: lightning seen, no thunder heard — not a thunderstorm.
  assert.equal(presentWeatherGroup(13), 'electrical');
  assert.equal(classifyPresentWeather(13).group, 'electrical');
  // 17: thunderstorm with no precipitation at observation.
  assert.equal(presentWeatherGroup(17), 'thunderstorm');
  // 89/90: hail showers explicitly NOT associated with thunder.
  assert.equal(presentWeatherGroup(89), 'precipitation');
  assert.equal(presentWeatherGroup(90), 'precipitation');
  // 98: thunderstorm + dust/sandstorm groups as thunderstorm.
  assert.equal(presentWeatherGroup(98), 'thunderstorm');
  // 14-16: precipitation in sight, not at the station.
  assert.equal(presentWeatherGroup(14), 'precipitation');
  assert.equal(classifyPresentWeather(14).timing, 'sight');
  assert.equal(classifyPresentWeather(16).timing, 'sight');
  // 40: fog at a distance, not at the station.
  assert.equal(classifyPresentWeather(40).group, 'fog');
  assert.equal(classifyPresentWeather(40).timing, 'sight');
});

test('timing flags separate past-hour, sight, mixed, and current codes', () => {
  for (let code = 20; code <= 29; code += 1) {
    assert.equal(
      classifyPresentWeather(code).timing,
      'preceding-hour',
      `code ${code}`,
    );
  }
  for (let code = 91; code <= 94; code += 1) {
    assert.equal(classifyPresentWeather(code).timing, 'mixed', `code ${code}`);
  }
  assert.equal(classifyPresentWeather(21).timing, 'preceding-hour');
  assert.equal(classifyPresentWeather(0).timing, 'current');
  assert.equal(classifyPresentWeather(65).timing, 'current');
  assert.equal(classifyPresentWeather(95).timing, 'current');
});

test('classify returns the frozen table entry', () => {
  assert.equal(classifyPresentWeather(0), PRESENT_WEATHER_SCALE[0]);
  assert.equal(classifyPresentWeather(65), PRESENT_WEATHER_SCALE[65]);
  assert.equal(classifyPresentWeather(99), PRESENT_WEATHER_SCALE[99]);
  assert.equal(classifyPresentWeather(65), PRESENT_WEATHER_BY_CODE[65]);
});

test('unknown / out-of-range / non-integer input returns null, never throws', () => {
  for (const bad of [
    -1,
    -100,
    100,
    101,
    1000,
    2.5,
    -0.5,
    Number.NaN,
    Infinity,
    -Infinity,
  ]) {
    assert.equal(classifyPresentWeather(bad), null, `code ${bad}`);
    assert.equal(presentWeatherGroup(bad), null, `code ${bad}`);
  }
  for (const bad of [
    '95',
    '0',
    '',
    null,
    undefined,
    true,
    false,
    {},
    [],
    95n,
  ]) {
    assert.equal(classifyPresentWeather(bad), null);
    assert.equal(presentWeatherGroup(bad), null);
  }
});

test('presentWeatherGroup returns the group id for every valid code', () => {
  for (const entry of PRESENT_WEATHER_SCALE) {
    assert.equal(presentWeatherGroup(entry.code), entry.group);
  }
  assert.equal(presentWeatherGroup(0), 'sky');
  assert.equal(presentWeatherGroup(5), 'obscuration');
  assert.equal(presentWeatherGroup(9), 'dust-sand');
  assert.equal(presentWeatherGroup(45), 'fog');
  assert.equal(presentWeatherGroup(82), 'precipitation');
  assert.equal(presentWeatherGroup(38), 'snow-drift');
  assert.equal(presentWeatherGroup(18), 'squall-funnel');
});
