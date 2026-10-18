import test from 'node:test';
import assert from 'node:assert/strict';
import {
  contrastRatio,
  hslToRgb,
  meetsContrast,
  mixColors,
  normalizeColor,
  parseHexColor,
  relativeLuminance,
  rgbToHex,
  rgbToHsl,
  withAlpha,
} from './colorMath.js';

const closeTo = (actual, expected, epsilon = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
};

test('parseHexColor accepts 3/4/6/8-digit hex, with or without #, any case', () => {
  assert.deepEqual(parseHexColor('#ff0000'), { r: 255, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseHexColor('ff0000'), { r: 255, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseHexColor('#F00'), { r: 255, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseHexColor('  #0f0  '), { r: 0, g: 255, b: 0, a: 1 });
  // 4-digit: #rgba — last digit is the alpha nibble, doubled.
  assert.deepEqual(parseHexColor('#f008'), {
    r: 255,
    g: 0,
    b: 0,
    a: 136 / 255,
  });
  // 8-digit: RRGGBBAA (CSS convention).
  assert.deepEqual(parseHexColor('#ff000080'), {
    r: 255,
    g: 0,
    b: 0,
    a: 128 / 255,
  });
});

test('parseHexColor rejects everything that is not a hex color', () => {
  for (const bad of [
    '',
    '#',
    '#12',
    '#12345',
    '#1234567',
    '#123456789',
    '#gg0000',
    'red',
    'rgb(255, 0, 0)',
    '255, 0, 0',
    '#ff0000ff00',
    null,
    undefined,
    123456,
    {},
    [],
  ]) {
    assert.equal(parseHexColor(bad), null, `expected null for ${String(bad)}`);
  }
});

test('normalizeColor accepts color objects, rounds fractions, rejects out-of-range', () => {
  assert.deepEqual(normalizeColor({ r: 255, g: 0, b: 0 }), {
    r: 255,
    g: 0,
    b: 0,
    a: 1,
  });
  assert.deepEqual(normalizeColor({ r: 10.4, g: 20.5, b: 30.6, a: 0.5 }), {
    r: 10,
    g: 21,
    b: 31,
    a: 0.5,
  });
  assert.equal(normalizeColor({ r: 256, g: 0, b: 0 }), null);
  assert.equal(normalizeColor({ r: -1, g: 0, b: 0 }), null);
  assert.equal(normalizeColor({ r: 0, g: 0, b: 0, a: 1.5 }), null);
  assert.equal(normalizeColor({ r: 0, g: 0 }), null);
  assert.equal(normalizeColor({ r: NaN, g: 0, b: 0 }), null);
  assert.equal(normalizeColor([255, 0, 0]), null);
});

test('rgbToHex round-trips through parseHexColor, including alpha', () => {
  assert.equal(rgbToHex('#ff0000'), '#ff0000');
  assert.equal(rgbToHex({ r: 0, g: 255, b: 0 }), '#00ff00');
  assert.equal(rgbToHex({ r: 255, g: 0, b: 0, a: 0.5 }), '#ff000080');
  assert.equal(rgbToHex({ r: 255, g: 0, b: 0, a: 1 }), '#ff0000');
  assert.equal(rgbToHex('not a color'), null);
  assert.equal(rgbToHex({ r: 300, g: 0, b: 0 }), null);
});

test('rgbToHsl / hslToRgb convert primaries and achromatic colors', () => {
  assert.deepEqual(rgbToHsl('#ff0000'), { h: 0, s: 1, l: 0.5 });
  assert.deepEqual(hslToRgb({ h: 0, s: 1, l: 0.5 }), { r: 255, g: 0, b: 0 });
  // Achromatic: hue is the documented 0 stand-in.
  assert.deepEqual(rgbToHsl('#808080'), { h: 0, s: 0, l: 128 / 255 });
  assert.deepEqual(hslToRgb({ h: 123, s: 0, l: 0.5 }), {
    r: 128,
    g: 128,
    b: 128,
  });
  assert.equal(rgbToHsl('garbage'), null);
  assert.equal(hslToRgb({ h: 0, s: 2, l: 0.5 }), null);
  assert.equal(hslToRgb({ h: 0, s: 0, l: -1 }), null);
});

test('hslToRgb wraps hue mod 360', () => {
  assert.deepEqual(hslToRgb({ h: 360, s: 1, l: 0.5 }), {
    r: 255,
    g: 0,
    b: 0,
  });
  assert.deepEqual(hslToRgb({ h: -120, s: 1, l: 0.5 }), {
    r: 0,
    g: 0,
    b: 255,
  });
});

test('hsl round-trip preserves the color', () => {
  for (const hex of ['#705ca0', '#f97316', '#22d3ee', '#123456']) {
    const back = hslToRgb(rgbToHsl(hex));
    assert.deepEqual(rgbToHex(back), hex, `round-trip failed for ${hex}`);
  }
});

test('mixColors lerps in sRGB, clamps t, blends alpha', () => {
  assert.deepEqual(mixColors('#000000', '#ffffff', 0), {
    r: 0,
    g: 0,
    b: 0,
    a: 1,
  });
  assert.deepEqual(mixColors('#000000', '#ffffff', 1), {
    r: 255,
    g: 255,
    b: 255,
    a: 1,
  });
  // 127.5 rounds to 128 (Math.round).
  assert.deepEqual(mixColors('#000000', '#ffffff', 0.5), {
    r: 128,
    g: 128,
    b: 128,
    a: 1,
  });
  assert.deepEqual(mixColors('#ff0000', '#0000ff', 0.25), {
    r: 191,
    g: 0,
    b: 64,
    a: 1,
  });
  assert.deepEqual(mixColors('#000000', '#ffffff', -1), {
    r: 0,
    g: 0,
    b: 0,
    a: 1,
  });
  assert.deepEqual(mixColors('#000000', '#ffffff', 2), {
    r: 255,
    g: 255,
    b: 255,
    a: 1,
  });
  closeTo(mixColors('#00000000', '#ffffff', 0.5).a, 0.5);
  assert.equal(mixColors('#000000', '#ffffff', NaN), null);
  assert.equal(mixColors('zzzzzz', '#ffffff', 0.5), null);
  assert.equal(mixColors('#000000', '#ffffff', 'half'), null);
});

test('relativeLuminance matches WCAG reference values', () => {
  assert.equal(relativeLuminance('#000000'), 0);
  assert.equal(relativeLuminance('#ffffff'), 1);
  closeTo(relativeLuminance('#ff0000'), 0.2126, 1e-4);
  closeTo(relativeLuminance('#00ff00'), 0.7152, 1e-4);
  closeTo(relativeLuminance('#0000ff'), 0.0722, 1e-4);
  // Alpha is ignored: same opaque result for the translucent form.
  assert.equal(relativeLuminance('#ff000080'), relativeLuminance('#ff0000'));
  assert.equal(relativeLuminance('nope'), null);
});

test('contrastRatio spans 1..21 and is order-independent', () => {
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  assert.equal(contrastRatio('#ffffff', '#000000'), 21);
  assert.equal(contrastRatio('#123456', '#123456'), 1);
  closeTo(contrastRatio('#ffffff', '#767676'), 4.54, 0.01);
  assert.equal(contrastRatio('#000000', 'zzzzzz'), null);
});

test('meetsContrast applies WCAG AA / AAA thresholds', () => {
  assert.equal(meetsContrast('#000000', '#ffffff', 'AAA'), true);
  assert.equal(meetsContrast('#767676', '#ffffff', 'AA'), true);
  assert.equal(meetsContrast('#767676', '#ffffff', 'AAA'), false);
  assert.equal(meetsContrast('#767676', '#ffffff', 'AA-large'), true);
  assert.equal(meetsContrast('#000000', '#000000', 'AA'), false);
  assert.equal(meetsContrast('#000000', '#ffffff', 'A'), null);
  assert.equal(meetsContrast('zzzzzz', '#ffffff', 'AA'), null);
});

test('withAlpha formats rgba and replaces the color alpha', () => {
  assert.equal(withAlpha('#ff0000', 0.65), 'rgba(255, 0, 0, 0.65)');
  assert.equal(withAlpha('#ff000080', 1), 'rgba(255, 0, 0, 1)');
  assert.equal(withAlpha({ r: 1, g: 2, b: 3 }, 0), 'rgba(1, 2, 3, 0)');
  assert.equal(withAlpha('#ff0000', -0.1), null);
  assert.equal(withAlpha('#ff0000', 1.1), null);
  assert.equal(withAlpha('#ff0000', NaN), null);
  assert.equal(withAlpha('zzzzzz', 0.5), null);
});
