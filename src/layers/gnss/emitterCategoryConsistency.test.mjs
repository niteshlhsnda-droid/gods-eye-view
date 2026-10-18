import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMITTER_CATEGORIES_AIRLINE_COMPATIBLE,
  EMITTER_CATEGORIES_AIRLINE_INCOMPATIBLE,
  EMITTER_CATEGORY_LABELS,
  EMITTER_CONSISTENCY_INTERPRETATION,
  EMITTER_CONSISTENCY_SIGNAL,
  KNOWN_AIRLINE_DESIGNATORS,
  emitterCategoryConsistency,
} from './emitterCategoryConsistency.js';

test('heavy + airline flight ID is consistent', () => {
  const result = emitterCategoryConsistency({
    emitterCategory: 5,
    callsign: 'UAL123',
  });
  assert.equal(result.judged, true);
  assert.equal(result.consistent, true);
  assert.deepEqual(result.signals, []);
  assert.equal(result.interpretation, null);
  assert.equal(result.emitterCategory, 5);
  assert.equal(result.callsign, 'UAL123');
});

test('transport categories 2/3/4 pass with airline flight IDs', () => {
  for (const category of [2, 3, 4]) {
    const result = emitterCategoryConsistency({
      emitterCategory: category,
      callsign: 'BAW9',
    });
    assert.equal(result.judged, true, `category ${category} should judge`);
    assert.equal(result.consistent, true, `category ${category} consistent`);
    assert.deepEqual(result.signals, []);
  }
});

test('glider + airline flight ID is a mismatch', () => {
  const result = emitterCategoryConsistency({
    emitterCategory: 9,
    callsign: 'UAL123',
  });
  assert.equal(result.judged, true);
  assert.equal(result.consistent, false);
  assert.deepEqual(result.signals, [EMITTER_CONSISTENCY_SIGNAL]);
  assert.equal(result.interpretation, EMITTER_CONSISTENCY_INTERPRETATION);
  assert.ok(result.reason.includes('glider/sailplane'));
});

test('rotorcraft and light with heavy-transport callsign pattern mismatch', () => {
  const rotorcraft = emitterCategoryConsistency({
    emitterCategory: 7,
    callsign: 'DLH400',
  });
  assert.equal(rotorcraft.consistent, false);
  assert.deepEqual(rotorcraft.signals, [EMITTER_CONSISTENCY_SIGNAL]);

  const light = emitterCategoryConsistency({
    emitterCategory: 1,
    callsign: 'AFR 007',
  });
  assert.equal(light.consistent, false);
  assert.deepEqual(light.signals, [EMITTER_CONSISTENCY_SIGNAL]);
  assert.equal(light.callsign, 'AFR 007'); // spacing preserved on the record
});

test('every incompatible category mismatches an airline flight ID', () => {
  for (const category of EMITTER_CATEGORIES_AIRLINE_INCOMPATIBLE) {
    const result = emitterCategoryConsistency({
      emitterCategory: category,
      callsign: 'SIA21',
    });
    assert.equal(result.judged, true, `category ${category} judged`);
    assert.equal(result.consistent, false, `category ${category} mismatch`);
    assert.deepEqual(result.signals, [EMITTER_CONSISTENCY_SIGNAL]);
  }
});

test('every compatible category passes an airline flight ID', () => {
  for (const category of EMITTER_CATEGORIES_AIRLINE_COMPATIBLE) {
    const result = emitterCategoryConsistency({
      emitterCategory: category,
      callsign: 'UAE3',
    });
    assert.equal(result.consistent, true, `category ${category} consistent`);
  }
});

test('unknown category is unjudgeable, not a mismatch', () => {
  const result = emitterCategoryConsistency({
    emitterCategory: 0,
    callsign: 'UAL123',
  });
  assert.equal(result.judged, false);
  assert.equal(result.consistent, true);
  assert.deepEqual(result.signals, []);
  assert.ok(result.reason.includes('no aircraft type information'));
});

test('unassigned and reserved categories are unjudgeable', () => {
  for (const category of [8, 13, 16, 22, 39]) {
    const result = emitterCategoryConsistency({
      emitterCategory: category,
      callsign: 'UAL123',
    });
    assert.equal(result.judged, false, `category ${category} unjudged`);
    assert.equal(result.consistent, true);
    assert.deepEqual(result.signals, []);
  }
});

test('non-airline callsigns are unjudgeable, never a mismatch', () => {
  const ga = emitterCategoryConsistency({
    emitterCategory: 9,
    callsign: 'N123AB',
  });
  assert.equal(ga.judged, false);
  assert.equal(ga.consistent, true);

  // Unknown 3-letter prefix + digits: not a recognised airline flight ID.
  const unknown = emitterCategoryConsistency({
    emitterCategory: 7,
    callsign: 'ZZZ123',
  });
  assert.equal(unknown.judged, false);
  assert.equal(unknown.consistent, true);
  assert.ok(unknown.reason.includes('not a recognised'));
});

test('inputs are normalised: lowercase callsign, numeric-string category', () => {
  const result = emitterCategoryConsistency({
    emitterCategory: '7',
    callsign: '  ual123  ',
  });
  assert.equal(result.judged, true);
  assert.equal(result.consistent, false);
  assert.equal(result.emitterCategory, 7);
  assert.equal(result.callsign, 'UAL123');
  assert.deepEqual(result.signals, [EMITTER_CONSISTENCY_SIGNAL]);
});

test('invalid input returns null and never throws', () => {
  assert.equal(emitterCategoryConsistency(null), null);
  assert.equal(emitterCategoryConsistency(undefined), null);
  assert.equal(emitterCategoryConsistency('UAL123'), null);
  assert.equal(emitterCategoryConsistency([]), null);
  assert.equal(emitterCategoryConsistency({}), null);
  assert.equal(emitterCategoryConsistency({ emitterCategory: 5 }), null);
  assert.equal(emitterCategoryConsistency({ callsign: 'UAL123' }), null);
  assert.equal(
    emitterCategoryConsistency({ emitterCategory: 5, callsign: '' }),
    null,
  );
  assert.equal(
    emitterCategoryConsistency({ emitterCategory: 5, callsign: '   ' }),
    null,
  );
  assert.equal(
    emitterCategoryConsistency({ emitterCategory: -1, callsign: 'UAL123' }),
    null,
  );
  assert.equal(
    emitterCategoryConsistency({ emitterCategory: 40, callsign: 'UAL123' }),
    null,
  );
  assert.equal(
    emitterCategoryConsistency({
      emitterCategory: 5.5,
      callsign: 'UAL123',
    }),
    null,
  );
  assert.equal(
    emitterCategoryConsistency({
      emitterCategory: NaN,
      callsign: 'UAL123',
    }),
    null,
  );
  // Callsign alphabet violation (8-char limit is DO-260B).
  assert.equal(
    emitterCategoryConsistency({
      emitterCategory: 5,
      callsign: 'UAL123456',
    }),
    null,
  );
  assert.equal(
    emitterCategoryConsistency({ emitterCategory: 5, callsign: 'UAL-123' }),
    null,
  );
  assert.equal(
    emitterCategoryConsistency({ emitterCategory: 5, callsign: 123 }),
    null,
  );
});

test('signal and interpretation constants are stable strings', () => {
  assert.equal(
    EMITTER_CONSISTENCY_SIGNAL,
    'emitter-category-callsign-mismatch',
  );
  assert.equal(
    EMITTER_CONSISTENCY_INTERPRETATION,
    'suspected-identity-spoofing',
  );
});

test('the category tables cover the full DO-260B set honestly', () => {
  // Every defined emitting category is classified on exactly one side.
  const classified = new Set([
    ...EMITTER_CATEGORIES_AIRLINE_COMPATIBLE,
    ...EMITTER_CATEGORIES_AIRLINE_INCOMPATIBLE,
  ]);
  const defined = Object.keys(EMITTER_CATEGORY_LABELS).map(Number);
  for (const category of defined) {
    if (category === 0) continue; // no information: unjudgeable by design
    if ([8, 13, 16].includes(category)) continue; // unassigned: unjudged
    assert.ok(
      classified.has(category),
      `category ${category} must be classified`,
    );
  }
  // No overlap between the two sides.
  for (const category of EMITTER_CATEGORIES_AIRLINE_COMPATIBLE) {
    assert.ok(!EMITTER_CATEGORIES_AIRLINE_INCOMPATIBLE.includes(category));
  }
  assert.ok(KNOWN_AIRLINE_DESIGNATORS.has('UAL'));
  assert.ok(KNOWN_AIRLINE_DESIGNATORS.has('BAW'));
  assert.ok(KNOWN_AIRLINE_DESIGNATORS.size >= 40);
});
