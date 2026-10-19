import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveCityStream,
  CITY_DRIVE_RADIO_MIRRORS,
} from './cityDriveRadio.js';

const ok = (json) => ({ ok: true, json: async () => json });

function stations(...entries) {
  return entries.map(([name, url, urlResolved]) => ({
    name,
    url,
    url_resolved: urlResolved ?? url,
  }));
}

test('picks the first non-m3u8 stream and prefers direct audio hints', async () => {
  const fetchImpl = async () =>
    ok(
      stations(
        ['City HLS', 'https://x.test/a.m3u8'],
        ['City MP3', 'https://x.test/stream.mp3'],
        ['City OGG', 'https://x.test/live.ogg'],
      ),
    );
  const result = await resolveCityStream('Delhi', fetchImpl);
  assert.deepEqual(result, {
    stationName: 'City MP3',
    streamUrl: 'https://x.test/stream.mp3',
  });
});

test('skips m3u8 and pls playlists, falls back to extensionless http streams', async () => {
  const fetchImpl = async () =>
    ok(
      stations(
        ['A', 'https://x.test/a.m3u8'],
        ['B', 'https://x.test/b.pls'],
        ['C', 'https://x.test:8000/stream'],
      ),
    );
  const result = await resolveCityStream('Paris', fetchImpl);
  assert.equal(result.stationName, 'C');
  assert.equal(result.streamUrl, 'https://x.test:8000/stream');
});

test('returns null when no playable stream exists', async () => {
  const fetchImpl = async () => ok(stations(['A', 'https://x.test/a.m3u8']));
  assert.equal(await resolveCityStream('Nowhere', fetchImpl), null);
});

test('returns null on empty station list', async () => {
  const fetchImpl = async () => ok([]);
  assert.equal(await resolveCityStream('Nowhere', fetchImpl), null);
});

test('falls through to the next mirror when one fails', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    if (url.startsWith(CITY_DRIVE_RADIO_MIRRORS[0])) {
      throw new Error('mirror down');
    }
    if (url.startsWith(CITY_DRIVE_RADIO_MIRRORS[1])) {
      return { ok: false };
    }
    return ok(stations(['Good', 'https://y.test/live.mp3']));
  };
  const result = await resolveCityStream('Tokyo', fetchImpl);
  assert.deepEqual(result, {
    stationName: 'Good',
    streamUrl: 'https://y.test/live.mp3',
  });
  assert.ok(
    seen[0].startsWith(CITY_DRIVE_RADIO_MIRRORS[0]),
    'tried the first mirror first',
  );
});

test('queries byname with hidebroken and encodes the city name', async () => {
  let requested = '';
  const fetchImpl = async (url) => {
    requested = url;
    return ok([]);
  };
  await resolveCityStream('Rio de Janeiro', fetchImpl);
  assert.match(
    requested,
    /\/json\/stations\/byname\/Rio%20de%20Janeiro\?limit=15&hidebroken=true$/,
  );
});

test('returns null without a city name or fetch implementation', async () => {
  assert.equal(await resolveCityStream('', async () => ok([])), null);
  assert.equal(await resolveCityStream(null, async () => ok([])), null);
});

test('returns null when every mirror fails', async () => {
  const fetchImpl = async () => {
    throw new Error('network down');
  };
  assert.equal(await resolveCityStream('Delhi', fetchImpl), null);
});
