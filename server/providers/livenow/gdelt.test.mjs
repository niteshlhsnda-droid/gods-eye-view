/**
 * Tests for server/providers/livenow/gdelt.js
 * GDELT 2.0 DOC API wrapper (timelinevol + artlist, direct HTTPS).
 * Safety: counts + links only, never article text.
 * Run: node --test server/providers/livenow/
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  attentionFromPeak,
  fetchArticleList,
  fetchTimelineVolume,
  parseTimelinePayload,
} from './gdelt.js';

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(payload),
  };
}

describe('parseTimelinePayload', () => {
  it('parses the canonical DOC timelinevol shape', () => {
    const payload = [
      {
        series: [],
        date: '20261006',
        data: [
          { date: '2026-10-06T00:00:00Z', value: 12 },
          { date: '2026-10-07T00:00:00Z', value: 240 },
        ],
      },
    ];
    const series = parseTimelinePayload(payload);
    assert.equal(series.length, 2);
    assert.equal(series[1].volume, 240);
    assert.equal(series[1].date, '2026-10-07T00:00:00Z');
  });
  it('tolerates volume/volume/count key variants and skips junk rows', () => {
    const payload = [
      {
        data: [
          { date: '2026-10-06T00:00:00Z', volume: 5 },
          { date: 'junk', value: 'nope' },
          { date: '2026-10-08T00:00:00Z', count: 30 },
        ],
      },
    ];
    const series = parseTimelinePayload(payload);
    assert.deepEqual(
      series.map((s) => s.volume),
      [5, 30],
    );
  });
  it('returns [] for empty or malformed payloads', () => {
    assert.deepEqual(parseTimelinePayload(null), []);
    assert.deepEqual(parseTimelinePayload({}), []);
    assert.deepEqual(parseTimelinePayload([]), []);
  });
});

describe('attentionFromPeak', () => {
  it('maps 0 -> 0 and saturates at 100', () => {
    assert.equal(attentionFromPeak(0), 0);
    assert.equal(attentionFromPeak(1000), 100);
    assert.equal(attentionFromPeak(50_000), 100);
  });
  it('is monotonically increasing (log-ish scale)', () => {
    const a = attentionFromPeak(10);
    const b = attentionFromPeak(100);
    const c = attentionFromPeak(500);
    assert.ok(a > 0 && a < b && b < c && c <= 100);
  });
});

describe('fetchTimelineVolume', () => {
  it('requests timelinevol and returns peak + attention', async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(String(url));
      return jsonResponse([
        { data: [{ date: '2026-10-12T00:00:00Z', value: 180 }] },
      ]);
    };
    const result = await fetchTimelineVolume('cyclone remal', { fetchImpl });
    const decoded = decodeURIComponent(calls[0]).replace(/\+/g, ' ');
    assert.ok(calls[0].includes('mode=timelinevol'), 'timelinevol mode');
    assert.ok(
      decoded.includes('query="cyclone remal"'),
      'query is URL-encoded in request',
    );
    assert.equal(result.peak, 180);
    assert.ok(result.attention > 0 && result.attention <= 100);
    assert.equal(result.series.length, 1);
  });
  it('returns a zeroed result on upstream failure (never throws)', async () => {
    const result = await fetchTimelineVolume('x', {
      fetchImpl: async () => ({ ok: false, status: 500, headers: { get: () => null }, text: async () => '' }),
    });
    assert.equal(result.peak, 0);
    assert.equal(result.attention, 0);
    assert.deepEqual(result.series, []);
  });
  it('returns a zeroed result on network throw', async () => {
    const result = await fetchTimelineVolume('x', {
      fetchImpl: async () => {
        throw new Error('boom');
      },
    });
    assert.equal(result.attention, 0);
  });
});

describe('fetchArticleList', () => {
  it('normalizes artlist payloads via the shared regional model', async () => {
    const fetchImpl = async () =>
      jsonResponse({
        articles: [
          {
            url: 'https://example.com/a',
            title: 'Cyclone Remal makes landfall',
            seendate: '20261013T020000Z',
            domain: 'example.com',
            sourcecountry: 'India',
          },
          { url: 'not a url', title: 'junk' },
        ],
      });
    const result = await fetchArticleList('cyclone remal', { fetchImpl });
    assert.equal(result.articles.length, 1);
    assert.equal(result.articles[0].title, 'Cyclone Remal makes landfall');
    assert.equal(result.articles[0].domain, 'example.com');
    assert.ok(!('text' in result.articles[0]), 'no article text stored');
  });
  it('returns an empty list on failure (never throws)', async () => {
    const result = await fetchArticleList('x', {
      fetchImpl: async () => {
        throw new Error('down');
      },
    });
    assert.deepEqual(result.articles, []);
  });
});
