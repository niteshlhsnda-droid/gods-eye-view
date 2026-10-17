/**
 * Wire the Cycle 2 spoof-movement signals into the GNSS feed path.
 *
 * The pure checks in `./spoofSignals.js` need a feed to run on: the cluster
 * check reads one snapshot, but teleport needs the previous fix of each
 * aircraft and stale needs each fix's own observation time. This module is
 * that feed wiring, owned by the GNSS layer: it keeps one previous fix per
 * aircraft, dates every fix in the snapshot's observation frame, and
 * returns a frozen per-snapshot summary. It never changes the cell layer's
 * primary state — spoofing stays a secondary, unvalidated interpretation,
 * surfaced through `getStats().spoofSignals` only.
 *
 * Guards (all documented, all overridable for tests):
 * - `enabled` (default true): when false, nothing is analysed and the
 *   summary reports `enabled: false`.
 * - Snapshot-size cap: the cluster check is O(n^2) haversine calls, so
 *   above `maxClusterAircraft` rows it is not judged and the summary
 *   records `clusterSkipped: 'snapshot-too-large'`. The cap guards against
 *   a global-feed misuse (50k rows would be ~2.5B distance calls), not
 *   against normal regional snapshots: a 250 nm adsb.lol snapshot rarely
 *   exceeds a few hundred aircraft, and 1000 rows is ~1M calls, ~once a
 *   minute.
 * - Teleport gap: beyond `maxTeleportGapMs` between fixes, a step is
 *   unobserved flight, not a jump — the aircraft was missing for several
 *   polls and could legitimately have flown there. Only fixes close
 *   enough in time to be successive observations are judged.
 * - GPS-lost rows are not judged for teleport or stale: their reported
 *   position is the last-good GNSS fix, whose age is unknown
 *   (`seenPosS` is null for them; see `records.js`). They still count in
 *   the cluster check, which needs no time.
 * - Stale is judged in the snapshot's observation frame (fix age at the
 *   time the snapshot was observed), not at analysis time — the same
 *   dating rule as the cell layer. Otherwise a stale replay served after
 *   an upstream failure would report every aircraft stale.
 * - Previous-fix pruning runs in the same observation frame: a replay
 *   analysed late must not evict the fixes it just stored.
 * - Previous fixes are monotonic per aircraft: an older replay arriving
 *   after a newer snapshot never overwrites the newer fix.
 */
import {
  spoofClusterCheck,
  staleCheck,
  teleportCheck,
} from './spoofSignals.js';

/** Max snapshot rows the O(n^2) cluster check runs over (see above). */
export const SPOOF_FEED_MAX_CLUSTER_AIRCRAFT = 1000;
/** Beyond this gap between fixes, a step is unobserved flight, not a jump. */
export const SPOOF_FEED_MAX_TELEPORT_GAP_MS = 5 * 60_000;
/** Previous fixes older than this are pruned (the layer polls ~60 s). */
export const SPOOF_FEED_PREV_FIX_TTL_MS = 10 * 60_000;
/** Bound on retained previous fixes, so a hex leak cannot grow memory. */
export const SPOOF_FEED_MAX_PREV_FIXES = 5000;

/**
 * @param {object} row A normalised GNSS snapshot row (see `records.js`).
 * @param {number} observedAt Epoch ms the snapshot was observed.
 * @returns {number|null} Epoch ms the row's position was fixed, or null
 *   when the row carries no datable fix (GPS-lost last-good position).
 */
function fixTimeMs(row, observedAt) {
  if (row.gpsLost) return null;
  if (Number.isFinite(row.seenPosS)) return observedAt - row.seenPosS * 1000;
  // Rows predating the `seenPosS` field carry no per-fix age; date them
  // by the snapshot, which still judges a stale snapshot stale.
  return observedAt;
}

function isFix(row) {
  return (
    row &&
    typeof row === 'object' &&
    Number.isFinite(row.lat) &&
    Number.isFinite(row.lon) &&
    row.lat >= -90 &&
    row.lat <= 90 &&
    row.lon >= -180 &&
    row.lon <= 180
  );
}

/**
 * Stateful spoof-signal analysis over successive GNSS snapshots.
 *
 * @param {{enabled?: boolean, maxClusterAircraft?: number, maxTeleportGapMs?: number, prevFixTtlMs?: number, maxPrevFixes?: number}} [options]
 */
export function createSpoofFeedTracker({
  enabled = true,
  maxClusterAircraft = SPOOF_FEED_MAX_CLUSTER_AIRCRAFT,
  maxTeleportGapMs = SPOOF_FEED_MAX_TELEPORT_GAP_MS,
  prevFixTtlMs = SPOOF_FEED_PREV_FIX_TTL_MS,
  maxPrevFixes = SPOOF_FEED_MAX_PREV_FIXES,
} = {}) {
  const prevFixes = new Map();
  let lastSummary = Object.freeze({
    enabled,
    analyzedAt: null,
    observedAt: null,
    aircraft: 0,
    teleport: Object.freeze([]),
    teleportJudged: 0,
    stale: Object.freeze([]),
    staleJudged: 0,
    clusters: Object.freeze([]),
    clusterSkipped: null,
  });

  function prune(nowMs) {
    for (const [hex, fix] of prevFixes) {
      if (nowMs - fix.atMs > prevFixTtlMs) prevFixes.delete(hex);
    }
    while (prevFixes.size > maxPrevFixes) {
      prevFixes.delete(prevFixes.keys().next().value);
    }
  }

  return {
    /**
     * Analyse one snapshot. Only call with a real snapshot: retries and
     * expirations carry no new evidence and must not advance the tracker.
     *
     * @param {{hex?: string, lat: number, lon: number, gpsLost?: boolean, seenPosS?: number}[]} rows
     * @param {{observedAt: number, nowMs: number}} times Observation-frame
     *   time of the snapshot and the wall-clock time of analysis.
     * @returns {Readonly<typeof lastSummary>} Frozen per-snapshot summary.
     */
    analyze(rows, { observedAt, nowMs } = {}) {
      if (!Array.isArray(rows))
        throw new TypeError('spoof-feed rows must be an array');
      if (!Number.isFinite(observedAt) || !Number.isFinite(nowMs))
        throw new TypeError('spoof-feed observedAt and nowMs must be finite');
      if (!enabled) {
        lastSummary = Object.freeze({
          ...lastSummary,
          analyzedAt: nowMs,
          observedAt,
          aircraft: rows.length,
        });
        return lastSummary;
      }

      const teleport = [];
      const stale = [];
      let teleportJudged = 0;
      let staleJudged = 0;

      for (const row of rows) {
        if (!isFix(row)) continue;
        const atMs = fixTimeMs(row, observedAt);
        if (atMs === null) continue;
        const fix = Object.freeze({ lat: row.lat, lon: row.lon, atMs });

        const staleResult = staleCheck(fix, observedAt);
        staleJudged += 1;
        if (staleResult.stale) {
          stale.push(
            Object.freeze({
              hex:
                typeof row.hex === 'string' && row.hex !== '' ? row.hex : null,
              ...staleResult,
            }),
          );
        }

        if (typeof row.hex !== 'string' || row.hex === '') continue;
        const prev = prevFixes.get(row.hex);
        if (prev && atMs > prev.atMs) {
          const gapMs = atMs - prev.atMs;
          if (gapMs <= maxTeleportGapMs) {
            teleportJudged += 1;
            const teleportResult = teleportCheck(prev, fix);
            if (teleportResult.teleport) {
              teleport.push(Object.freeze({ hex: row.hex, ...teleportResult }));
            }
          }
          // Refresh insertion order so the retained-fix bound evicts the
          // least-recently-updated aircraft, not the earliest-seen one.
          prevFixes.delete(row.hex);
          prevFixes.set(row.hex, fix);
        } else if (!prev) {
          prevFixes.set(row.hex, fix);
        }
        // atMs <= prev.atMs is an out-of-order replay: not judged, and the
        // newer stored fix stands (see the module doc).
      }

      prune(observedAt);

      let clusters = Object.freeze([]);
      let clusterSkipped = null;
      if (rows.length > maxClusterAircraft) {
        clusterSkipped = 'snapshot-too-large';
      } else {
        clusters = spoofClusterCheck(rows);
      }

      lastSummary = Object.freeze({
        enabled,
        analyzedAt: nowMs,
        observedAt,
        aircraft: rows.length,
        teleport: Object.freeze(teleport),
        teleportJudged,
        stale: Object.freeze(stale),
        staleJudged,
        clusters,
        clusterSkipped,
      });
      return lastSummary;
    },

    /** Forget previous fixes and reset the summary (layer teardown). */
    reset() {
      prevFixes.clear();
      lastSummary = Object.freeze({
        enabled,
        analyzedAt: null,
        observedAt: null,
        aircraft: 0,
        teleport: Object.freeze([]),
        teleportJudged: 0,
        stale: Object.freeze([]),
        staleJudged: 0,
        clusters: Object.freeze([]),
        clusterSkipped: null,
      });
    },

    /** Latest summary without analysing (initially the empty summary). */
    summary() {
      return lastSummary;
    },
  };
}
