import test from 'node:test';
import assert from 'node:assert/strict';
import { detectQuakeSwarms } from './quakeSwarm.js';

const HOUR = 3600_000;
const NOW = 1_790_000_000_000;

function swarmEvents(
  count,
  { lat = 35.68, lon = 139.69, mag = 4.5, spreadMin = 0, prefix = 'q' } = {},
) {
  const events = [];
  for (let i = 0; i < count; i += 1) {
    events.push({
      id: `${prefix}${i}`,
      mag: mag + (i % 3) * 0.4,
      timeMs: NOW - (count - i) * HOUR + spreadMin,
      lat: lat + i * 0.01,
      lon: lon + i * 0.01,
      place: 'Offshore Test Region',
    });
  }
  return events;
}

test('a dense cluster is reported as one swarm', () => {
  const events = detectQuakeSwarms(swarmEvents(8), { now: NOW });
  assert.equal(events.length, 1);
  const [swarm] = events;
  assert.equal(swarm.type, 'quake-swarm');
  assert.equal(swarm.severity, 'medium');
  assert.equal(swarm.ref.count, 8);
  assert.match(swarm.title, /8 events/);
  assert.match(swarm.title, /Offshore Test Region/);
  assert.ok(swarm.ref.centroidLat > 35.6 && swarm.ref.centroidLat < 35.8);
});

test('fewer events than the threshold is not a swarm', () => {
  assert.deepEqual(detectQuakeSwarms(swarmEvents(5), { now: NOW }), []);
});

test('events far apart in space or time do not cluster', () => {
  const events = detectQuakeSwarms(
    [
      ...swarmEvents(3),
      ...swarmEvents(3, { lat: -20, lon: -60, spreadMin: 0 }),
      ...swarmEvents(3, { spreadMin: 48 * HOUR }),
    ],
    { now: NOW },
  );
  assert.deepEqual(events, []);
});

test('two separate clusters are reported as two swarms', () => {
  const events = detectQuakeSwarms(
    [
      ...swarmEvents(6, { prefix: 'a' }),
      ...swarmEvents(6, { lat: -33.45, lon: -70.66, prefix: 'b' }),
    ],
    { now: NOW },
  );
  assert.equal(events.length, 2);
  const ids = new Set(events.flatMap((e) => e.ref.memberIds));
  assert.equal(ids.size, 12, 'each quake belongs to exactly one swarm');
});

test('severity follows the largest magnitude', () => {
  const high = detectQuakeSwarms(swarmEvents(6, { mag: 5.4 }), { now: NOW });
  assert.equal(high[0].severity, 'high');
  const critical = detectQuakeSwarms(swarmEvents(6, { mag: 6.2 }), {
    now: NOW,
  });
  assert.equal(critical[0].severity, 'critical');
});

test('malformed quakes are skipped, not fatal', () => {
  const events = detectQuakeSwarms(
    [...swarmEvents(6), null, { mag: 'huge' }, { lat: 1, lon: 2 }],
    { now: NOW },
  );
  assert.equal(events.length, 1);
});
