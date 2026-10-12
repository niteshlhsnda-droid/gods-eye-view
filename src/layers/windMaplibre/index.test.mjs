import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultWindOptions,
  validateWindDataContract,
  windAdapterReport,
  createWindMaplibreAdapter,
} from './index.js';

function gfsPair() {
  const header = { nx: 4, ny: 3, lo1: 0, la1: 90, dx: 90, dy: 90 };
  return [
    { header, data: new Array(12).fill(3) },
    { header, data: new Array(12).fill(-1) },
  ];
}

describe('windMaplibre scaffold', () => {
  it('exposes tunable defaults matching the library API', () => {
    const opts = defaultWindOptions({ particles: 1000 });
    assert.equal(opts.particles, 1000);
    assert.equal(opts.maxAge, 15);
    assert.equal(opts.speedRange[1], 80);
    assert.equal(opts.colorRamp.length, 7);
  });

  it('validates the grib2json wind-data contract', () => {
    assert.equal(validateWindDataContract(gfsPair()).ok, true);
    const bad = gfsPair();
    bad[1].data = [1, 2];
    const result = validateWindDataContract(bad);
    assert.equal(result.ok, false);
    assert.ok(result.errors.length > 0);
    assert.equal(validateWindDataContract({}).ok, false);
  });

  it('reports the adapter as a scaffold, honestly', () => {
    const report = windAdapterReport();
    assert.equal(report.status, 'scaffold');
    assert.equal(report.shippableTonight, false);
    assert.ok(report.blockers.length >= 2);
    assert.throws(() => createWindMaplibreAdapter(), /no Cesium adapter yet/);
  });
});
