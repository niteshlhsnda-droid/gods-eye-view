import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  QUAKE_REPLAY_RING_LABEL,
  SYMBOL_SIZE_RULE,
  UNIFORM_MARKER_LABEL,
  quakeDisplayRadiusKm,
  quakeSymbolLabel,
} from './symbolSizeHonesty.js';

test('the rule states the principle without asserting any specific encoding', () => {
  assert.match(SYMBOL_SIZE_RULE, /encodes what the layer says it encodes/);
  // The rule is a prohibition on inference, not a currency/liveness claim.
  assert.doesNotMatch(SYMBOL_SIZE_RULE, /\blive\b/i);
  assert.doesNotMatch(SYMBOL_SIZE_RULE, /real-time/i);
  assert.doesNotMatch(SYMBOL_SIZE_RULE, /up-to-date|up to date/i);
});

test('uniform markers explicitly encode nothing by size', () => {
  assert.match(UNIFORM_MARKER_LABEL, /uniform/i);
  assert.match(UNIFORM_MARKER_LABEL, /size encodes nothing/);
  // Must not imply a rank ordering where none exists.
  assert.doesNotMatch(UNIFORM_MARKER_LABEL, /rank/i);
  assert.doesNotMatch(UNIFORM_MARKER_LABEL, /\bmore\b.*\bimportant\b/i);
});

test('quake display radius mirrors the layer formula (2^mag km)', () => {
  // src/layers/earthquakes/index.js: Math.pow(2, mag) * 1000 metres.
  assert.equal(quakeDisplayRadiusKm(5), 32);
  assert.equal(quakeDisplayRadiusKm(0), 1);
  assert.equal(quakeDisplayRadiusKm('7.2'), Math.pow(2, 7.2));
  // Exponential, not linear: M8 renders 64x the radius of M2.
  assert.equal(quakeDisplayRadiusKm(8) / quakeDisplayRadiusKm(2), 64);
});

test('quake display radius is null for non-finite magnitudes', () => {
  assert.equal(quakeDisplayRadiusKm(undefined), null);
  assert.equal(quakeDisplayRadiusKm(null), null);
  assert.equal(quakeDisplayRadiusKm(''), null);
  assert.equal(quakeDisplayRadiusKm('unknown'), null);
  assert.equal(quakeDisplayRadiusKm(NaN), null);
  assert.equal(quakeDisplayRadiusKm(Infinity), null);
});

test('quake label names the displayed radius and forbids the impact-zone read', () => {
  const label = quakeSymbolLabel(5);
  assert.match(label, /magnitude 5/);
  assert.match(label, /≈ 32 km/);
  assert.match(label, /display convention/);
  assert.match(label, /Not an impact zone/);
  // The impact-zone / affected-area phrases appear only as negations.
  assert.doesNotMatch(label, /is an impact zone|the impact zone/);
  assert.match(label, /not by affected area/i);
  assert.doesNotMatch(label, /is the affected area|shows the affected area/i);
});

test('quake label with half-unit magnitude formats the radius to 2 sig figs', () => {
  // 2^5.5 = 45.25… km.
  assert.match(quakeSymbolLabel(5.5), /≈ 45\.3 km/);
  // 2^8 = 256 km.
  assert.match(quakeSymbolLabel(8), /≈ 256 km/);
});

test('quake label without a magnitude keeps the prohibition, drops the number', () => {
  const label = quakeSymbolLabel();
  assert.match(label, /exponentially with magnitude/);
  assert.match(label, /2\^magnitude km/);
  assert.match(label, /Not an impact zone/);
  assert.doesNotMatch(label, /≈/);
  assert.doesNotMatch(label, /magnitude undefined/);
  assert.doesNotMatch(label, /magnitude null/);
  assert.equal(quakeSymbolLabel('pending'), quakeSymbolLabel());
});

test('replay ring is labeled cinematic, never a hazard zone', () => {
  assert.match(QUAKE_REPLAY_RING_LABEL, /cinematic/i);
  assert.match(QUAKE_REPLAY_RING_LABEL, /loosely scaled by magnitude/);
  assert.match(QUAKE_REPLAY_RING_LABEL, /not a hazard zone/i);
  assert.doesNotMatch(QUAKE_REPLAY_RING_LABEL, /\blive\b/i);
});

test('the docs file states the formula and both failure modes', () => {
  const doc = readFileSync(
    new URL('../../docs/symbol-size-honesty.md', import.meta.url),
    'utf8',
  );
  assert.match(doc, /Math\.pow\(2, mag\) \* 1000/);
  assert.match(doc, /impact zone/i);
  assert.match(doc, /linear/i);
  assert.match(doc, /SYMBOL_SIZE_RULE/);
});
