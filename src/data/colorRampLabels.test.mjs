import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import {
  COLOR_RAMP_IDS,
  colorRampSpec,
  colorRampCardLegend,
  colorRampRowLegend,
  labelEarthquakeDepthBand,
} from './colorRampLabels.js';
// Renderer ground truth the vocabulary must stay pinned to. These imports
// are the actual layer code — a drift in any of them fails this suite.
import { depthColor } from '../layers/earthquakes/model.js';
import { flowBucket } from './trafficFlowStyle.js';
import { DETECTION_COLOR_STOPS } from '../layers/firms/policy.js';
import {
  COLOR_GREEN,
  COLOR_YELLOW,
  COLOR_RED,
  COLOR_NEUTRAL,
  COLOR_MUTED,
} from '../layers/bikeshare/policy.js';
import { densityFillColor } from '../layers/deckgl/h3density.js';

const toHex6 = (color) =>
  `#${[color.red, color.green, color.blue]
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
const rgbaToHex8 = ([r, g, b, a]) =>
  `#${[r, g, b, a]
    .map((v) => Math.round(v).toString(16).padStart(2, '0'))
    .join('')}`;

test('COLOR_RAMP_IDS lists the five verified legend-less ramps', () => {
  assert.deepEqual(COLOR_RAMP_IDS, [
    'earthquake-depth',
    'firms-detection',
    'traffic-flow',
    'bikeshare-availability',
    'h3-density',
  ]);
});

test('every ramp id resolves to a well-formed spec', () => {
  for (const id of COLOR_RAMP_IDS) {
    const spec = colorRampSpec(id);
    assert.ok(spec, `${id} has a spec`);
    assert.equal(spec.id, id);
    assert.ok(spec.name && typeof spec.name === 'string', `${id} name`);
    assert.ok(spec.layer && typeof spec.layer === 'string', `${id} layer`);
    assert.ok(Array.isArray(spec.stops) && spec.stops.length >= 2);
    assert.ok(
      spec.unknownLabel && typeof spec.unknownLabel === 'string',
      `${id} unknownLabel`,
    );
    for (const stop of spec.stops) {
      for (const field of ['id', 'label', 'color', 'band', 'meaning']) {
        assert.ok(
          stop[field] && typeof stop[field] === 'string',
          `${id}.${stop.id} has ${field}`,
        );
      }
      assert.match(
        stop.color,
        /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i,
        `${id}.${stop.id} color is a hex swatch`,
      );
    }
  }
});

test('unknown or non-string ramp ids resolve to null everywhere', () => {
  for (const bad of [undefined, null, '', 'nope', 42, {}, []]) {
    assert.equal(colorRampSpec(bad), null);
    assert.equal(colorRampCardLegend(bad), null);
    assert.equal(colorRampRowLegend(bad), null);
  }
});

test('returned specs are copies — callers cannot mutate the canon', () => {
  const first = colorRampSpec('traffic-flow');
  first.stops[0].label = 'MUTATED';
  first.notes.push('MUTATED');
  const second = colorRampSpec('traffic-flow');
  assert.equal(second.stops[0].label, 'Free flow (≥ 0.85)');
  assert.ok(!second.notes.includes('MUTATED'));
});

test('earthquake bands match the renderer at every threshold edge', () => {
  // depthColor: < 70 -> RED, < 300 -> ORANGE, else YELLOW. The labels must
  // own the same side of each boundary — exactly 70 is intermediate,
  // exactly 300 is deep.
  const bandOf = (color) => {
    if (color.equals(Cesium.Color.RED)) return 'Shallow (< 70 km)';
    if (color.equals(Cesium.Color.ORANGE)) return 'Intermediate (70–300 km)';
    if (color.equals(Cesium.Color.YELLOW)) return 'Deep (≥ 300 km)';
    throw new Error('unexpected quake color');
  };
  for (const depth of [0, 0.1, 10, 69.99, 70, 150, 299.99, 300, 700]) {
    assert.equal(
      labelEarthquakeDepthBand(depth),
      bandOf(depthColor(depth)),
      `depth ${depth} km`,
    );
  }
});

test('earthquake depth labels refuse to default the unknown', () => {
  // The renderer calls depthColor(depthKm || 0): a missing depth would
  // paint shallow red. The label layer must never endorse that fallback.
  for (const unknown of [undefined, null, NaN, Infinity, -Infinity, '', '  ']) {
    assert.equal(labelEarthquakeDepthBand(unknown), 'Depth unknown');
  }
  assert.equal(labelEarthquakeDepthBand('banana'), 'Depth unknown');
  assert.equal(labelEarthquakeDepthBand(-5), 'Depth unknown');
  assert.equal(labelEarthquakeDepthBand('70'), 'Intermediate (70–300 km)');
  assert.equal(labelEarthquakeDepthBand(' 300 '), 'Deep (≥ 300 km)');
  assert.equal(labelEarthquakeDepthBand(0), 'Shallow (< 70 km)');
});

test('traffic flow bands match flowBucket at every threshold edge', () => {
  const specIds = colorRampSpec('traffic-flow').stops.map((s) => s.id);
  assert.deepEqual(specIds, ['free', 'slow', 'jam']);
  // flowBucket: >= 0.85 free, >= 0.55 slow, else jam; non-finite -> free.
  for (const [level, bucket] of [
    [1, 'free'],
    [0.85, 'free'],
    [0.849, 'slow'],
    [0.7, 'slow'],
    [0.55, 'slow'],
    [0.549, 'jam'],
    [0, 'jam'],
    [NaN, 'free'],
  ]) {
    assert.equal(flowBucket(level), bucket, `level ${level}`);
  }
  const labels = Object.fromEntries(
    colorRampSpec('traffic-flow').stops.map((s) => [s.id, s.label]),
  );
  assert.equal(labels.free, 'Free flow (≥ 0.85)');
  assert.equal(labels.slow, 'Slow (0.55–0.85)');
  assert.equal(labels.jam, 'Jam (< 0.55)');
});

test('firms stop colors match DETECTION_COLOR_STOPS order and values', () => {
  // detectionColorStop picks stops[0] (red) for high heat, stops[1] for
  // moderate, stops[2] for low. The vocabulary must use the same colors
  // in the same order — and say what the color means, not "severity".
  assert.deepEqual(
    DETECTION_COLOR_STOPS.map((s) => s.name),
    ['red', 'orange', 'yellow'],
  );
  const stops = colorRampSpec('firms-detection').stops;
  assert.deepEqual(
    stops.map((s) => s.color),
    DETECTION_COLOR_STOPS.map((s) => toHex6(s.color)),
  );
  for (const stop of stops) {
    assert.ok(
      /heat/i.test(stop.meaning),
      `firms stop ${stop.id} meaning says heat, not severity`,
    );
  }
  assert.ok(
    colorRampSpec('firms-detection').notes.some((n) =>
      /missing confidence/i.test(n),
    ),
    'documents the missing-input fall-through to yellow',
  );
});

test('bikeshare stop colors match the policy palette exactly', () => {
  const byId = Object.fromEntries(
    colorRampSpec('bikeshare-availability').stops.map((s) => [s.id, s.color]),
  );
  assert.equal(byId.good, toHex6(COLOR_GREEN));
  assert.equal(byId.limited, toHex6(COLOR_YELLOW));
  assert.equal(byId.low, toHex6(COLOR_RED));
  assert.equal(byId.unknown, toHex6(COLOR_NEUTRAL));
  assert.equal(byId.offline, toHex6(COLOR_MUTED));
  const unknown = colorRampSpec('bikeshare-availability').stops.find(
    (s) => s.id === 'unknown',
  );
  assert.ok(
    /unknown/i.test(unknown.meaning),
    'no-status gray means unknown, not empty',
  );
});

test('h3-density endpoint swatches equal the renderer t=0 and t=1 fills', () => {
  const stops = colorRampSpec('h3-density').stops;
  assert.equal(stops[0].color, rgbaToHex8(densityFillColor(0, 10)));
  assert.equal(stops[1].color, rgbaToHex8(densityFillColor(10, 10)));
});

test('h3-density top label stays relative unless a count is supplied', () => {
  const card = colorRampCardLegend('h3-density');
  assert.equal(card.categorical, false);
  assert.equal(card.labels[1], 'High (highest in view)');
  assert.equal(
    colorRampCardLegend('h3-density', { maxCount: 42 }).labels[1],
    'High (42 in view)',
  );
  for (const bad of [undefined, null, NaN, 0, -3, 'many']) {
    assert.equal(
      colorRampCardLegend('h3-density', { maxCount: bad }).labels[1],
      'High (highest in view)',
      `maxCount ${String(bad)} stays relative`,
    );
  }
  const row = colorRampRowLegend('h3-density', { maxCount: 7 });
  assert.equal(row[1].label, 'High (7 in view)');
  assert.ok(row[1].blurb.includes('7 entities'));
  assert.equal(
    colorRampRowLegend('h3-density')[1].label,
    'High (highest in view)',
  );
});

test('categorical card legends carry colors and labels in stop order', () => {
  const card = colorRampCardLegend('traffic-flow');
  assert.equal(card.categorical, true);
  assert.deepEqual(card.colors, ['#2ecc71', '#f0b23e', '#e05252']);
  assert.deepEqual(card.labels, [
    'Free flow (≥ 0.85)',
    'Slow (0.55–0.85)',
    'Jam (< 0.55)',
  ]);
  const quakeCard = colorRampCardLegend('earthquake-depth');
  assert.equal(quakeCard.categorical, true);
  assert.equal(quakeCard.colors.length, 3);
});

test('row legends hand the panel paintable swatches and honest blurbs', () => {
  const row = colorRampRowLegend('firms-detection');
  assert.equal(row.length, 3);
  for (const entry of row) {
    assert.match(entry.color, /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i);
    assert.ok(entry.label && entry.blurb, 'label + blurb present');
  }
  assert.ok(
    row[0].blurb.includes('NOT a fire severity claim'),
    'red stop blurb refuses the severity reading',
  );
  const bikeRow = colorRampRowLegend('bikeshare-availability');
  assert.equal(bikeRow.length, 5);
});
