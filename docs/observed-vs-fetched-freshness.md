# Observed vs fetched: freshness labels must report observation time

A freshness label answers one question: **when was this data observed?**
It must never answer a different question — when did we last fetch it —
while sounding like the first.

## The conflation

Every layer has (at least) two clocks:

| Clock | What it measures | Example |
| --- | --- | --- |
| **Observed** | When the real-world event happened | A FIRMS detection's `acq_date` / `acq_time` (satellite acquisition, UTC) |
| **Fetched** | When our system last retrieved a copy | The `/api/firms` proxy's `fetchedAt` (`entry.at`: the proxy's cache time) |

A refetch resets the fetched clock to "just now" while the observations
stay exactly as old as they were. A label built on the fetched clock
therefore says "updated just now" about hours-old detections — and a user
reading it reasonably concludes the fires were seen minutes ago. That is
the failure this rule forbids.

The FIRMS layer was the concrete instance: `ingestion.js` stamped
`_lastUpdate` from the payload's `fetchedAt`, and `queries.js` rendered
`CONTINUOUS · updated Xm ago` from it. The label now headlines the
newest detection's acquisition time instead.

## The rule

1. **Headline age = observation age.** The first age in any freshness
   label is computed from the data's own observation timestamp
   (`observedAt`), never from a fetch/cache/receive timestamp.
2. **Fetch time is a labelled suffix, not a substitute.** When a refetch
   is materially newer than the newest observation (≥ 5 minutes, see
   `OBSERVED_FETCHED_DISCLOSURE_GAP_MS`), the label discloses both:
   `observed 5h ago · fetched <1m ago`. Below that gap the two clocks
   agree closely enough that the suffix would be noise.
3. **Unknown observation age must say so.** When a record carries no
   observation timestamp, the label reads
   `fetched 10m ago · observation age unknown`. Fetch time is never
   silently presented as observation time.
4. **No timestamps at all reads `age unknown`.** A missing age is a fact
   about the data, not a licence to imply freshness by omission.

## What this does not cover

- **Cache age is still cache age.** A label that already says what it
  means — FIRMS's `STALE · cached Xh`, which names the proxy cache —
  is honest and unchanged. The rule targets labels that present a
  fetch as an observation ("updated", "observed", "as of") without
  saying which clock they used.
- **"Live" wording.** Whether a layer may call itself live is a
  separate question, covered by the live-label audits. A layer can
  follow this rule and still have no business calling itself live.

## Implementation

- `src/data/observedFreshness.js` — `observedFreshnessLabel()` (the label
  logic) and `newestObservedAt()` (newest observation across records).
  Pure functions, clock-injectable, covered by
  `src/data/observedFreshness.test.mjs`.
- `src/layers/firms/queries.js` — the first consumer: `getStats()` labels
  the fresh branch from the newest detection `acqMs`, with
  `_lastUpdate` (proxy fetch time) as the suffix input. Covered by
  `src/layers/firms/queries.test.mjs`.
- New layers adopt the same shape: carry the data's own observation
  timestamp into the label, and use `observedFreshnessLabel()` rather
  than inventing a new age format. (Transit already keeps the
  distinction per vehicle via `timestampSource: 'vehicle' | 'header' |
  'fetch'` in `src/data/transitProxy.js`; this doc is the shared label
  form of that ladder.)

## Checklist for future labels

- [ ] Does the headline age come from an observation timestamp?
- [ ] If the label uses a fetch/cache time, is it labelled as such?
- [ ] If the observation time is missing, does the label say
      "observation age unknown"?
- [ ] Does a refetch of unchanged data leave the label unchanged?
