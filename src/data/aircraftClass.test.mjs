// src/data/aircraftClass.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyAircraft, CLASS_SCALE_2D, CLASS_SCALE_3D, CLASS_MODEL_URL, CLASS_MODEL_REAL } from './aircraftClass.js';
import { setPublicBase } from './assetBase.js';

test('type-code classification (military layer path)', () => {
  assert.equal(classifyAircraft({ typeCode: 'F16' }), 'fastjet');
  assert.equal(classifyAircraft({ typeCode: 'EC35' }), 'helicopter');
  assert.equal(classifyAircraft({ typeCode: 'B744' }), 'quadjet');
  assert.equal(classifyAircraft({ typeCode: 'B77W' }), 'widebody');
  assert.equal(classifyAircraft({ typeCode: 'C17' }), 'widebody');
  assert.equal(classifyAircraft({ typeCode: 'AT76' }), 'turboprop');
  assert.equal(classifyAircraft({ typeCode: 'C172' }), 'light');
  assert.equal(classifyAircraft({ typeCode: 'b738' }), 'airliner'); // case-insensitive default-jet
});

test('bizjet + uav classes (2026-08-16 Hangar fleet)', () => {
  assert.equal(classifyAircraft({ typeCode: 'C25A' }), 'bizjet');
  assert.equal(classifyAircraft({ typeCode: 'C56X' }), 'bizjet');
  assert.equal(classifyAircraft({ typeCode: 'GLF5' }), 'bizjet');
  assert.equal(classifyAircraft({ typeCode: 'CL60' }), 'bizjet');
  // SF50 Cirrus Vision Jet is a JET — it must NOT fall back to the light/prop class.
  assert.equal(classifyAircraft({ typeCode: 'SF50' }), 'bizjet');
  assert.equal(classifyAircraft({ typeCode: 'MQ9' }), 'uav');
  assert.equal(classifyAircraft({ typeCode: 'Q4' }), 'uav');
  assert.equal(classifyAircraft({ typeCode: 'TB2' }), 'uav');
});

test('category fallback (flights layer path — OpenSky extended int)', () => {
  assert.equal(classifyAircraft({ category: 8 }), 'helicopter');
  assert.equal(classifyAircraft({ category: 6 }), 'widebody');
  assert.equal(classifyAircraft({ category: 7 }), 'fastjet');
  assert.equal(classifyAircraft({ category: 2 }), 'light');
  assert.equal(classifyAircraft({ category: 9 }), 'glider');
  assert.equal(classifyAircraft({ category: 4 }), 'airliner');
});

test('ADS-B emitter string categories', () => {
  assert.equal(classifyAircraft({ category: 'A7' }), 'helicopter');
  assert.equal(classifyAircraft({ category: 'A5' }), 'widebody');
  assert.equal(classifyAircraft({ category: 'A1' }), 'light');
  assert.equal(classifyAircraft({ category: 'B1' }), 'glider');
});

test('typeCode outranks category; unknown → airliner', () => {
  assert.equal(classifyAircraft({ typeCode: 'F18', category: 6 }), 'fastjet');
  assert.equal(classifyAircraft({}), 'airliner');
  assert.equal(classifyAircraft({ typeCode: null, category: 0 }), 'airliner');
});

test('scale/url tables cover every class', () => {
  for (const kind of ['light','glider','turboprop','airliner','widebody','quadjet','helicopter','fastjet','bizjet','uav']) {
    assert.ok(Number.isFinite(CLASS_SCALE_2D[kind]), kind);
    assert.ok(CLASS_SCALE_3D[kind] >= 0.75 && CLASS_SCALE_3D[kind] <= 1.45, kind);
    assert.ok(typeof CLASS_MODEL_URL[kind] === 'string', kind);
  }
});

test('CLASS_MODEL_REAL entries carry the fields the layers consume', () => {
  for (const [kind, spec] of Object.entries(CLASS_MODEL_REAL)) {
    assert.ok(spec.url.startsWith('/models/') && spec.url.endsWith('.glb'), kind);
    assert.ok(spec.radiusM > 0 && spec.bellyM > 0, kind);
    // every real-model class must also exist in the classifier tables
    assert.ok(Number.isFinite(CLASS_SCALE_2D[kind]), kind);
  }
});

// H-06: the 8 `/models/*.glb` URLs must resolve against the Vite deploy base —
// root-absolute constants 404'd on the `/gods-eye-view/` subpath deployment,
// killing the flights/military 3D-model paths on live. The constants are
// evaluated at module load, so each base under test gets a fresh module
// instance via a query-busted dynamic import. Fails on pre-fix code (the
// constants were literal `/models/...` strings, immune to the base).
test('H-06: CLASS_MODEL_URL resolves against the pinned deploy base', async () => {
  setPublicBase('/gods-eye-view/');
  try {
    const mod = await import('./aircraftClass.js?h06-base=1');
    for (const [kind, url] of Object.entries(mod.CLASS_MODEL_URL)) {
      assert.ok(
        url.startsWith('/gods-eye-view/models/') && url.endsWith('.glb'),
        `${kind}: expected subpath URL, got ${url}`,
      );
      assert.ok(!url.includes('//models'), `${kind}: doubled slashes in ${url}`);
    }
  } finally {
    setPublicBase(null);
  }
});

test('H-06: CLASS_MODEL_REAL urls resolve against the pinned deploy base', async () => {
  setPublicBase('/gods-eye-view/');
  try {
    const mod = await import('./aircraftClass.js?h06-base=2');
    const urls = Object.values(mod.CLASS_MODEL_REAL).map((spec) => spec.url);
    assert.equal(new Set(urls).size, 6, 'six distinct real-model assets');
    for (const url of urls) {
      assert.ok(
        url.startsWith('/gods-eye-view/models/') && url.endsWith('.glb'),
        `expected subpath URL, got ${url}`,
      );
    }
  } finally {
    setPublicBase(null);
  }
});

test('H-06: every resolved model URL has an anchor-table entry (key sync)', async () => {
  setPublicBase('/gods-eye-view/');
  try {
    const ac = await import('./aircraftClass.js?h06-sync=1');
    const anchor = await import('./modelVisualAnchor.js?h06-sync=1');
    const urls = new Set([
      ...Object.values(ac.CLASS_MODEL_URL),
      ...Object.values(ac.CLASS_MODEL_REAL).map((spec) => spec.url),
    ]);
    assert.equal(urls.size, 7, 'airplane + 6 real models');
    for (const url of urls) {
      // visualCenterForModel/trailAnchorForModel are exact-match lookups: the
      // anchor keys must ride the same resolved strings as the constants.
      assert.ok(
        url in anchor.MODEL_TRAIL_ANCHOR_NATIVE,
        `missing trail anchor key for ${url}`,
      );
      assert.deepEqual(
        anchor.trailAnchorForModel(url),
        anchor.MODEL_TRAIL_ANCHOR_NATIVE[url],
        `lookup miss for ${url}`,
      );
    }
  } finally {
    setPublicBase(null);
  }
});

test('H-06: default base keeps the root model URLs (dev unchanged)', () => {
  for (const url of Object.values(CLASS_MODEL_URL)) {
    assert.ok(url.startsWith('/models/') && url.endsWith('.glb'), url);
  }
  for (const spec of Object.values(CLASS_MODEL_REAL)) {
    assert.ok(
      spec.url.startsWith('/models/') && spec.url.endsWith('.glb'),
      spec.url,
    );
  }
});
