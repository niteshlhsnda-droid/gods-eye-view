import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { depthColor, UNKNOWN_DEPTH_COLOR } from './model.js';

// F-01 (Hacker Audit): an unreported depth used to render as shallow
// red via depthColor(depthKm || 0). Unknown must render as the neutral
// unknown color, exactly like labelEarthquakeDepthBand reads it.

test('measured depths keep their bands', () => {
  assert.ok(depthColor(0).equals(Cesium.Color.RED)); // reported 0 = real shallow
  assert.ok(depthColor(10).equals(Cesium.Color.RED));
  assert.ok(depthColor(69.99).equals(Cesium.Color.RED));
  assert.ok(depthColor(70).equals(Cesium.Color.ORANGE));
  assert.ok(depthColor(299.99).equals(Cesium.Color.ORANGE));
  assert.ok(depthColor(300).equals(Cesium.Color.YELLOW));
  assert.ok(depthColor(700).equals(Cesium.Color.YELLOW));
});

test('unknown depths render the neutral unknown color, never a band', () => {
  for (const bad of [null, undefined, NaN, Infinity, -Infinity, -5, '70']) {
    const color = depthColor(bad);
    assert.ok(
      color.equals(UNKNOWN_DEPTH_COLOR),
      `depthColor(${String(bad)}) should be the unknown color`,
    );
    assert.ok(!color.equals(Cesium.Color.RED));
    assert.ok(!color.equals(Cesium.Color.ORANGE));
    assert.ok(!color.equals(Cesium.Color.YELLOW));
  }
  assert.equal(UNKNOWN_DEPTH_COLOR.toCssColorString(), 'rgb(145,164,180)');
});
