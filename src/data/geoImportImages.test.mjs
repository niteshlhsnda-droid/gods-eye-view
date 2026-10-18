import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_IMPORT_IMAGE_PIXELS,
  createImportImageBudget,
  importImageSize,
} from './geoImportImages.js';

function png(w, h) {
  const bytes = new Uint8Array(24);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x89504e47);
  bytes.set([73, 72, 68, 82], 12);
  view.setUint32(16, w);
  view.setUint32(20, h);
  return bytes;
}

function gif(w, h, version = '9a') {
  const bytes = new Uint8Array(10);
  bytes.set(Buffer.from(`GIF8${version}`), 0);
  new DataView(bytes.buffer).setUint16(6, w, true);
  new DataView(bytes.buffer).setUint16(8, h, true);
  return bytes;
}

function bmpCore(w, h) {
  const bytes = new Uint8Array(26);
  const view = new DataView(bytes.buffer);
  bytes.set([0x42, 0x4d], 0);
  view.setUint32(14, 12, true);
  view.setUint16(18, w, true);
  view.setUint16(20, h, true);
  return bytes;
}

function bmpInfo(w, h, headerSize = 40) {
  const bytes = new Uint8Array(30);
  const view = new DataView(bytes.buffer);
  bytes.set([0x42, 0x4d], 0);
  view.setUint32(14, headerSize, true);
  view.setInt32(18, w, true);
  view.setInt32(22, h, true);
  return bytes;
}

function webpVp8x(w, h) {
  const bytes = new Uint8Array(30);
  bytes.set(Buffer.from('RIFF'), 0);
  bytes.set(Buffer.from('WEBP'), 8);
  bytes.set(Buffer.from('VP8X'), 12);
  bytes[24] = (w - 1) & 0xff;
  bytes[25] = ((w - 1) >> 8) & 0xff;
  bytes[26] = ((w - 1) >> 16) & 0xff;
  bytes[27] = (h - 1) & 0xff;
  bytes[28] = ((h - 1) >> 8) & 0xff;
  bytes[29] = ((h - 1) >> 16) & 0xff;
  return bytes;
}

function webpVp8(w, h) {
  const bytes = new Uint8Array(30);
  bytes.set(Buffer.from('RIFF'), 0);
  bytes.set(Buffer.from('WEBP'), 8);
  bytes.set(Buffer.from('VP8 '), 12);
  bytes[23] = 0x9d;
  bytes[24] = 0x01;
  bytes[25] = 0x2a;
  new DataView(bytes.buffer).setUint16(26, w, true);
  new DataView(bytes.buffer).setUint16(28, h, true);
  return bytes;
}

function webpVp8l(w, h) {
  const bytes = new Uint8Array(30);
  bytes.set(Buffer.from('RIFF'), 0);
  bytes.set(Buffer.from('WEBP'), 8);
  bytes.set(Buffer.from('VP8L'), 12);
  bytes[20] = 0x2f;
  new DataView(bytes.buffer).setUint32(21, (w - 1) | ((h - 1) << 14), true);
  return bytes;
}

function jpegWithSegments(segments) {
  const out = [0xff, 0xd8];
  for (const [marker, payload] of segments) {
    out.push(0xff, marker);
    if (payload === null) continue;
    out.push(((payload.length + 2) >> 8) & 0xff, (payload.length + 2) & 0xff);
    out.push(...payload);
  }
  return new Uint8Array(out);
}

function sofPayload(w, h) {
  return [
    8,
    (h >> 8) & 0xff,
    h & 0xff,
    (w >> 8) & 0xff,
    w & 0xff,
    1,
    1,
    0x11,
    0,
  ];
}

test('PNG header decodes dimensions and rejects short or mistyped headers', () => {
  assert.deepEqual(importImageSize(png(640, 480)), [640, 480]);
  assert.deepEqual(importImageSize(png(0, 5)), [0, 5]);
  const mistyped = png(640, 480);
  mistyped.set([74, 72, 68, 82], 12);
  assert.equal(importImageSize(mistyped), null);
  assert.equal(importImageSize(png(640, 480).subarray(0, 23)), null);
  assert.equal(importImageSize(new Uint8Array(0)), null);
  assert.equal(importImageSize(new Uint8Array([1, 2, 3, 4])), null);
});

test('PNG header is read through a subarray byteOffset, not the backing buffer start', () => {
  const backing = new Uint8Array(40);
  backing.set(png(320, 240), 5);
  assert.deepEqual(importImageSize(backing.subarray(5, 29)), [320, 240]);
});

test('GIF87a and GIF89a headers decode little-endian dimensions', () => {
  assert.deepEqual(importImageSize(gif(300, 200, '9a')), [300, 200]);
  assert.deepEqual(importImageSize(gif(17, 9, '7a')), [17, 9]);
  assert.deepEqual(importImageSize(gif(0, 0)), [0, 0]);
  const badVersion = gif(300, 200, '8a');
  assert.equal(importImageSize(badVersion), null);
  assert.equal(importImageSize(gif(300, 200).subarray(0, 9)), null);
});

test('BMP CORE header decodes dimensions; INFO header takes absolute values', () => {
  assert.deepEqual(importImageSize(bmpCore(128, 64)), [128, 64]);
  assert.deepEqual(importImageSize(bmpInfo(128, 64)), [128, 64]);
  // Negative INFO height is the bottom-up convention, not a negative size.
  assert.deepEqual(importImageSize(bmpInfo(128, -64)), [128, 64]);
  assert.deepEqual(importImageSize(bmpInfo(-128, 64)), [128, 64]);
  // Any non-12 header size takes the INFO path.
  assert.deepEqual(importImageSize(bmpInfo(50, 40, 108)), [50, 40]);
  assert.deepEqual(importImageSize(bmpInfo(0, 10)), [0, 10]);
  const short = bmpCore(128, 64).subarray(0, 25);
  assert.equal(importImageSize(short), null);
  const badMagic = bmpCore(128, 64);
  badMagic.set([0x5a, 0x5a], 0);
  assert.equal(importImageSize(badMagic), null);
});

test('WebP VP8X, lossy VP8, and lossless VP8L headers all decode', () => {
  assert.deepEqual(importImageSize(webpVp8x(800, 600)), [800, 600]);
  assert.deepEqual(importImageSize(webpVp8x(1, 1)), [1, 1]);
  assert.deepEqual(importImageSize(webpVp8(320, 240)), [320, 240]);
  assert.deepEqual(importImageSize(webpVp8l(300, 200)), [300, 200]);
  assert.deepEqual(importImageSize(webpVp8l(1, 1)), [1, 1]);
});

test('WebP rejects unknown chunks, wrong magic, wrong signatures, and truncation', () => {
  const unknown = webpVp8x(800, 600);
  unknown.set(Buffer.from('VP8Z'), 12);
  assert.equal(importImageSize(unknown), null);
  const badMagic = webpVp8(320, 240);
  badMagic[25] = 0x2b;
  assert.equal(importImageSize(badMagic), null);
  const badSignature = webpVp8l(300, 200);
  badSignature[20] = 0x2e;
  assert.equal(importImageSize(badSignature), null);
  const badRiff = webpVp8x(800, 600);
  badRiff.set(Buffer.from('RIFX'), 0);
  assert.equal(importImageSize(badRiff), null);
  assert.equal(importImageSize(webpVp8x(800, 600).subarray(0, 29)), null);
});

test('JPEG SOF0, SOF1, and progressive SOF2 markers decode dimensions', () => {
  assert.deepEqual(
    importImageSize(jpegWithSegments([[0xc0, sofPayload(32, 16)]])),
    [32, 16],
  );
  assert.deepEqual(
    importImageSize(jpegWithSegments([[0xc1, sofPayload(100, 50)]])),
    [100, 50],
  );
  assert.deepEqual(
    importImageSize(jpegWithSegments([[0xc2, sofPayload(200, 100)]])),
    [200, 100],
  );
});

test('JPEG skips non-SOF segments, restart markers, and FF padding', () => {
  const app0 = new Array(14).fill(0);
  assert.deepEqual(
    importImageSize(
      jpegWithSegments([
        [0xe0, app0],
        [0xc0, sofPayload(32, 16)],
      ]),
    ),
    [32, 16],
  );
  // DHT (0xc4) is not a SOF marker and must be skipped, not decoded.
  const dht = [0, 1, 2, 3, 4, 5, 6, 7];
  assert.deepEqual(
    importImageSize(
      jpegWithSegments([
        [0xc4, dht],
        [0xc0, sofPayload(32, 16)],
      ]),
    ),
    [32, 16],
  );
  // RST0 carries no length field.
  assert.deepEqual(
    importImageSize(
      jpegWithSegments([
        [0xd0, null],
        [0xc0, sofPayload(32, 16)],
      ]),
    ),
    [32, 16],
  );
  // Extra 0xff padding bytes before the SOF marker are skipped.
  const padded = new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xff,
    0xff,
    0xc0,
    0x00,
    0x0b,
    ...sofPayload(32, 16),
  ]);
  assert.deepEqual(importImageSize(padded), [32, 16]);
});

test('JPEG returns null when SOF is unreachable, truncated, or malformed', () => {
  assert.equal(importImageSize(new Uint8Array([0xff, 0xd8])), null);
  // EOI ends the header scan before any SOF marker.
  assert.equal(importImageSize(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])), null);
  // SOS (0xda) ends the header scan: a later SOF is scan data, not a header.
  assert.equal(
    importImageSize(
      jpegWithSegments([
        [0xda, [1, 2, 3]],
        [0xc0, sofPayload(32, 16)],
      ]),
    ),
    null,
  );
  // Segment length below 2 is malformed.
  assert.equal(
    importImageSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01])),
    null,
  );
  // Segment length overrunning the buffer is malformed.
  assert.equal(
    importImageSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x64, 1, 2])),
    null,
  );
  // A SOF segment shorter than 8 bytes carries no dimensions.
  const shortSof = new Uint8Array([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x07, 8, 0, 16, 0, 32,
  ]);
  assert.equal(importImageSize(shortSof), null);
});

test('budget allows an exact 16-megapixel fill and rejects one pixel more', () => {
  assert.equal(MAX_IMPORT_IMAGE_PIXELS, 16 * 1024 * 1024);
  const charge = createImportImageBudget();
  charge('exact', png(4096, 4096));
  assert.throws(() => charge('one-more', png(1, 1)), /limit/);
});

test('budget enforces the 8192-pixel side limit at the boundary', () => {
  const charge = createImportImageBudget();
  charge('max-side', png(8192, 1));
  assert.throws(
    () => createImportImageBudget()('over-side', png(8193, 1)),
    /limit/,
  );
  assert.throws(
    () => createImportImageBudget()('over-side-tall', png(1, 8193)),
    /limit/,
  );
});

test('budget rejects zero-dimension and unreadable images', () => {
  assert.throws(() => createImportImageBudget()('zero', png(0, 5)), /limit/);
  assert.throws(
    () => createImportImageBudget()('zero-gif', gif(0, 0)),
    /limit/,
  );
  assert.throws(
    () => createImportImageBudget()('empty', new Uint8Array(0)),
    /limit/,
  );
  assert.throws(
    () =>
      createImportImageBudget()('random', new Uint8Array([9, 9, 9, 9, 9, 9])),
    /limit/,
  );
});

test('budget charges each distinct key once, even when re-charged', () => {
  const charge = createImportImageBudget();
  charge('shared', png(4096, 2048));
  charge('shared', png(4096, 2048));
  // 4096x2048 twice would exceed the cap if double-counted; the second
  // charge is free, so a second distinct half-cap image fits exactly.
  charge('other-half', png(4096, 2048));
  assert.throws(() => charge('third', png(1, 1)), /limit/);
});

test('budget dedupe keys on the key, not the bytes: a repeat key never re-parses', () => {
  const charge = createImportImageBudget();
  charge('same', png(100, 100));
  charge('same', new Uint8Array(0));
  assert.throws(() => charge('other', new Uint8Array(0)), /limit/);
});

test('budget accumulates across formats and budgets stay independent', () => {
  const charge = createImportImageBudget();
  charge('gif-part', gif(4096, 1024));
  charge('bmp-part', bmpCore(4096, 1024));
  charge('webp-part', webpVp8x(4096, 1024));
  charge('png-part', png(4096, 1024));
  assert.throws(() => charge('overflow', gif(1, 1)), /limit/);
  // A fresh budget is unaffected by the filled one.
  const fresh = createImportImageBudget();
  fresh('png-part', png(4096, 1024));
});
