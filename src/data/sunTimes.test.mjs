import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sunTimes } from './sunTimes.js';

const LONDON = { latitude: 51.5074, longitude: -0.1278 };

/** Minutes from UTC midnight of a Date. */
function utcMinutes(date) {
  return (
    date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60
  );
}

test('London 2026-10-17 matches the published almanac within 8 minutes', () => {
  // External anchor: weather.com London forecast for Sat 2026-10-17 lists
  // sunrise 7:27 AM BST (= 06:27 UTC) and sunset 6:03 PM BST (= 17:03 UTC).
  const t = sunTimes({ ...LONDON, date: new Date('2026-10-17T12:00:00Z') });
  assert.equal(t.utcDate, '2026-10-17');
  assert.equal(t.polar, null);
  assert.ok(
    Math.abs(utcMinutes(t.sunrise) - (6 * 60 + 27)) < 8,
    `sunrise ${t.sunrise}`,
  );
  assert.ok(
    Math.abs(utcMinutes(t.sunset) - (17 * 60 + 3)) < 8,
    `sunset ${t.sunset}`,
  );
});

test('sunrise and sunset are symmetric about solar noon', () => {
  const t = sunTimes({ ...LONDON, date: new Date('2026-10-17T12:00:00Z') });
  const mid = (t.sunrise.getTime() + t.sunset.getTime()) / 2;
  assert.ok(Math.abs(mid - t.solarNoon.getTime()) < 3 * 60 * 1000);
  assert.ok(Math.abs(t.dayLengthMs - (t.sunset - t.sunrise)) < 1000);
});

test('equinox day length at the equator is ~12h', () => {
  const t = sunTimes({
    latitude: 0,
    longitude: 0,
    date: new Date('2026-03-20T12:00:00Z'),
  });
  // 90.833° zenith stretches the geometric 12h by ~7 min each side.
  assert.ok(Math.abs(t.dayLengthMs - 12 * 3600 * 1000) < 20 * 60 * 1000);
});

test('polar day: Longyearbyen in June has no sunrise or sunset', () => {
  const t = sunTimes({
    latitude: 78.2232,
    longitude: 15.6267,
    date: new Date('2026-06-21T12:00:00Z'),
  });
  assert.equal(t.sunrise, null);
  assert.equal(t.sunset, null);
  assert.equal(t.dayLengthMs, null);
  assert.equal(t.polar, 'day');
  assert.equal(t.goldenHourMorning, null);
  assert.equal(t.goldenHourEvening, null);
});

test('polar night: McMurdo in June has no sunrise or sunset', () => {
  const t = sunTimes({
    latitude: -77.8419,
    longitude: 166.6683,
    date: new Date('2026-06-21T12:00:00Z'),
  });
  assert.equal(t.sunrise, null);
  assert.equal(t.sunset, null);
  assert.equal(t.polar, 'night');
});

test('twilight bands nest in the right order', () => {
  const t = sunTimes({ ...LONDON, date: new Date('2026-10-17T12:00:00Z') });
  const order = [
    t.astronomicalDawn,
    t.nauticalDawn,
    t.civilDawn,
    t.sunrise,
    t.solarNoon,
    t.sunset,
    t.civilDusk,
    t.nauticalDusk,
    t.astronomicalDusk,
  ];
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i] > order[i - 1], `order[${i}] out of sequence`);
  }
});

test('golden hour starts at sunrise and ends at sunset, 10–120 min long', () => {
  const t = sunTimes({ ...LONDON, date: new Date('2026-10-17T12:00:00Z') });
  assert.equal(t.goldenHourMorning.start.getTime(), t.sunrise.getTime());
  assert.equal(t.goldenHourEvening.end.getTime(), t.sunset.getTime());
  for (const g of [t.goldenHourMorning, t.goldenHourEvening]) {
    const mins = (g.end - g.start) / 60000;
    assert.ok(mins > 10 && mins < 120, `golden hour ${mins} min`);
  }
});

test('invalid inputs throw', () => {
  assert.throws(
    () => sunTimes({ latitude: 91, longitude: 0, date: new Date() }),
    RangeError,
  );
  assert.throws(
    () => sunTimes({ latitude: 0, longitude: 181, date: new Date() }),
    RangeError,
  );
  assert.throws(
    () => sunTimes({ latitude: 0, longitude: 0, date: new Date('nope') }),
    TypeError,
  );
});
