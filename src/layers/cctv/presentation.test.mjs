import test from 'node:test';
import assert from 'node:assert/strict';
import { cctvFeedModeLabel } from './presentation.js';

test('cctvFeedModeLabel: only HLS is a live stream', () => {
  assert.equal(cctvFeedModeLabel('hls'), 'LIVE STREAM');
  assert.equal(cctvFeedModeLabel('HLS'), 'LIVE STREAM');
});

test('cctvFeedModeLabel: finite video feeds are looped clips, never live', () => {
  // videoPlayback loops non-HLS video; the label must say so.
  assert.equal(cctvFeedModeLabel('mp4'), 'LOOPED CLIP');
  assert.equal(cctvFeedModeLabel('webm'), 'LOOPED CLIP');
});

test('cctvFeedModeLabel: image and unknown feeds are snapshots', () => {
  assert.equal(cctvFeedModeLabel('image'), 'SNAPSHOT');
  assert.equal(cctvFeedModeLabel(undefined), 'SNAPSHOT');
  assert.equal(cctvFeedModeLabel(''), 'SNAPSHOT');
  assert.equal(cctvFeedModeLabel('mjpeg'), 'SNAPSHOT');
});
