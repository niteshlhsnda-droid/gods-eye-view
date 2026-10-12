import test from 'node:test';
import assert from 'node:assert/strict';
import { detectEmergencySquawks, EMERGENCY_SQUAWK_CODES } from './squawk.js';

const NOW = 1_790_000_000_000;

test('all three emergency codes are detected as critical', () => {
  const aircraft = [
    { icao24: 'a1', squawk: '7500', lat: 10, lon: 20 },
    {
      icao24: 'a2',
      squawk: 7600,
      callsign: 'RDO123',
      lat: -5,
      lon: 60,
      altFt: 31000,
    },
    { icao24: 'a3', squawk: '7700' },
  ];
  const events = detectEmergencySquawks(aircraft, { now: NOW });
  assert.equal(events.length, 3);
  for (const event of events) {
    assert.equal(event.type, 'emergency-squawk');
    assert.equal(event.severity, 'critical');
    assert.equal(event.detectedAtMs, NOW);
  }
  assert.match(events[0].title, /Squawk 7500/);
  assert.match(events[1].detail, /RDO123/);
  assert.match(events[1].detail, /31,000 ft/);
});

test('routine and malformed squawks are ignored', () => {
  const aircraft = [
    { icao24: 'b1', squawk: '1200' },
    { icao24: 'b2', squawk: '2000' },
    { icao24: 'b3', squawk: null },
    { icao24: 'b4' },
    { icao24: 'b5', squawk: '770' },
    { icao24: 'b6', squawk: '77000' },
    null,
    'not-an-aircraft',
  ];
  assert.deepEqual(detectEmergencySquawks(aircraft, { now: NOW }), []);
});

test('event ids are stable per aircraft and code', () => {
  const aircraft = [{ icao24: 'ABC123', squawk: '7700' }];
  const [first] = detectEmergencySquawks(aircraft, { now: NOW });
  const [second] = detectEmergencySquawks(aircraft, { now: NOW + 60000 });
  assert.equal(first.id, second.id);
  assert.match(first.id, /^emergency-squawk-7700-ABC123$/);
});

test('the code table covers exactly the three emergency codes', () => {
  assert.deepEqual(Object.keys(EMERGENCY_SQUAWK_CODES).sort(), [
    '7500',
    '7600',
    '7700',
  ]);
});
