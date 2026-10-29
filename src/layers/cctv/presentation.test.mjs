import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cctvFeedModeLabel,
  honestFeedModeToken,
  createPresentation,
} from './presentation.js';

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

test('honestFeedModeToken: healthy pipeline keeps the transport label', () => {
  // H-03: the wiring must not change the common healthy case.
  assert.equal(
    honestFeedModeToken({ feedType: 'hls' }, { status: 'ok' }),
    'LIVE STREAM',
  );
  assert.equal(
    honestFeedModeToken({ feedType: 'mp4' }, { status: 'ok' }),
    'LOOPED CLIP',
  );
  assert.equal(
    honestFeedModeToken({ feedType: 'image' }, null),
    'SNAPSHOT',
  );
});

test('honestFeedModeToken: a failed pipeline never reads live (Oct-15 lesson)', () => {
  // H-03 fail-old/pass-new: on the pre-fix code the summary always carried
  // cctvFeedModeLabel(feedType), so an HLS camera with a failing pipeline
  // still read "LIVE STREAM" beside the fetch-failure banner.
  for (const feedType of ['hls', 'mp4', 'image', undefined]) {
    const token = honestFeedModeToken({ feedType }, { status: 'failed' });
    assert.ok(
      token === 'STALE' || token === 'UNKNOWN',
      `failed pipeline must not claim liveness (got ${token})`,
    );
    assert.ok(
      !/LIVE|CONTINUOUS/.test(token),
      `failed pipeline must not claim liveness (got ${token})`,
    );
  }
});

test('no-selection summary names a missing Windy key instead of hiding it', () => {
  const state = {
    _records: [{ id: 'austin-1' }],
    _windyStatus: 'missing-key',
    _windyCount: 0,
    _cardIds: new Set(),
  };
  const parts = { selection: { getActiveRecord: () => null } };
  const presentation = createPresentation({ state, parts });
  const summary = presentation.buildSummaryText();
  assert.match(summary, /CAMERAS STANDING BY/);
  assert.match(summary, /WINDY WEBCAMS OFF: API KEY NOT CONFIGURED/);
  const withKey = createPresentation({
    state: { ...state, _windyStatus: 'ok', _windyCount: 3 },
    parts,
  });
  assert.doesNotMatch(
    withKey.buildSummaryText(),
    /WINDY WEBCAMS OFF/,
  );
  // uiState maps records through the full camera-state builder, so check
  // the payload fields against an empty record list.
  const ui = createPresentation({
    state: { ...state, _records: [] },
    parts,
  }).uiState();
  assert.equal(ui.windyStatus, 'missing-key');
  assert.equal(ui.windyCount, 0);
});
