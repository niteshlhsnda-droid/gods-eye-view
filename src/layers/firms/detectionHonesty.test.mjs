import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createModel } from './model.js';
import { UNKNOWN_DETECTION_STOP } from './policy.js';
import { accentForSeverity } from '../../data/firmsLabels.js';

// F-02 (Hacker Audit): a detection with unreported FRP or confidence
// used to fall through to the yellow heat stop (and "low" confidence),
// presenting missing inputs as a measured weak fire. Unknown must
// render as the neutral unknown stop instead.

const model = createModel({
  layerState: { glowSpriteCache: new Map() },
  services: { anchors: { fireAnchorHeight: () => 0 } },
  components: {},
  config: {},
  feed: {},
});

test('measured detections keep their heat stops', () => {
  assert.equal(
    model.detectionColorStop({ frp: 150, confidence: 1 }).name,
    'red',
  );
  assert.equal(model.detectionColorStop({ frp: 30, confidence: 0.5 }).name, 'orange');
  // A measured zero is a real value: it still owns the yellow stop.
  assert.equal(model.detectionColorStop({ frp: 0, confidence: 0 }).name, 'yellow');
});

test('unreported FRP or confidence gets the unknown stop, never yellow', () => {
  for (const fire of [
    { frp: null, confidence: 0.9 },
    { frp: 10, confidence: undefined },
    { frp: NaN, confidence: 0.5 },
    { frp: 10, confidence: NaN },
    {},
    null,
    undefined,
  ]) {
    const stop = model.detectionColorStop(fire);
    assert.equal(stop.name, 'unknown');
    assert.ok(stop.color.equals(UNKNOWN_DETECTION_STOP.color));
    assert.ok(!stop.color.equals(Cesium.Color.YELLOW));
  }
  assert.equal(
    UNKNOWN_DETECTION_STOP.color.toCssColorString(),
    'rgb(145,164,180)',
  );
});

test('heatColor renders non-finite heat as the unknown neutral', () => {
  assert.ok(model.heatColor(0.9, 1).equals(Cesium.Color.RED.withAlpha(1)));
  assert.ok(model.heatColor(0.5, 1).equals(Cesium.Color.ORANGE.withAlpha(1)));
  assert.ok(model.heatColor(0, 1).equals(Cesium.Color.YELLOW.withAlpha(1)));
  assert.equal(
    model.heatColor(NaN, 0.5).toCssColorString(),
    'rgba(145,164,180,0.5)',
  );
  assert.equal(
    model.heatColor(undefined, 0.5).toCssColorString(),
    'rgba(145,164,180,0.5)',
  );
});

test('confidenceBucket calls unreported confidence unknown, not low', () => {
  assert.equal(model.confidenceBucket(null), 'unknown');
  assert.equal(model.confidenceBucket(undefined), 'unknown');
  assert.equal(model.confidenceBucket(NaN), 'unknown');
  assert.equal(model.confidenceBucket(0.9), 'high');
  assert.equal(model.confidenceBucket(0.5), 'nominal');
  assert.equal(model.confidenceBucket(0), 'low');
});

test('the unknown stop has a matching card accent', () => {
  assert.equal(accentForSeverity('unknown'), '145, 164, 180');
});
