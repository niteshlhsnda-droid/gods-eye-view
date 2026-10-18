import { createCoverage, sequenceIdFromPick } from './coverage.js';
import {
  FACING_MAX_EXTRA_M,
  facesHeading,
  normalizeHeading,
} from './facing.js';
import { pickFacingImage } from './facing.js';
import { nearestPosition } from './position.js';
export { nearestPosition } from './position.js';
import { createSequences } from './sequences.js';
import { createMapillaryViewer } from './viewer.js';
import { passesImageryFilter } from '../../filter.js';
import { metresBetween } from '../../view.js';
import {
  COLORS,
  MAPILLARY_CREDIT_HTML,
  MAPILLARY_KEY_ID,
  MAPILLARY_LABEL,
  MAPILLARY_NAME,
  MAPILLARY_PROVIDER_ID,
  MAPILLARY_SOURCE_METHODS,
  NEAREST_LIMIT,
  NEAREST_QUALITY_REACH,
  NEAREST_RADIUS_M,
  PICK_PREFIX,
  freshestFirst,
  preferPano,
  isLowQuality,
} from './policy.js';

/** Per-provider mutable state, created once per `create()`. */
function createProviderState(context) {
  return {
    context,
    services: context.services,
    viewer: null,
    keyRequired: false,
    /** Coverage waits for the first status: no tile requests without a key. */
    statusKnown: false,
    /** Mapillary refused the token: request nothing until re-enabled. */
    keyRejected: false,
    status: null,
    coverage: {
      zoom: null,
      /** Current zoom's tiles by `z/x/y` key. */
      tiles: new Map(),
      /** Previous zoom's tiles, kept on screen until replacements land. */
      stale: new Map(),
      staleTimer: null,
      /** Tile key → its request's controller; any entry means LOADING. */
      pending: new Map(),
      lastError: null,
      /** While Mapillary rate-limits: no requests before this time (ms). */
      holdUntil: 0,
      holdTimer: null,
      debounceTimer: null,
      removeCameraListener: null,
      terrainReady: null,
      hint: '',
      kind: null,
    },
    sequence: {
      selectedId: null,
      images: [],
      /** Recent sequences' thinned images, by sequence id. */
      cache: new Map(),
      collection: null,
      loading: false,
      abort: null,
    },
    nearest: {
      /** Graph records dropped from a nearest lookup for a claimed-but-unusable position. */
      droppedWithoutPosition: 0,
    },
  };
}


/**
 * Composed nearest-image pick (Cycle 5 freshest-first + Cycle 8 pano
 * preference): the freshest flat and the freshest pano are picked
 * separately with `freshestFirst`, then the 2× pano-distance rule
 * (`preferPano`) decides between the two type-winners. When only one
 * capture type is present, its freshest shot wins outright.
 * @param {Array<{isPano: boolean, capturedAt: number, metres: number}>} placed
 */
function freshestPanoFirst(placed) {
  const freshestFlat = placed.some(({ isPano }) => !isPano)
    ? freshestFirst(placed.filter(({ isPano }) => !isPano))[0]
    : null;
  const freshestPano = placed.some(({ isPano }) => isPano)
    ? freshestFirst(placed.filter(({ isPano }) => isPano))[0]
    : null;
  if (!freshestPano) return freshestFlat;
  if (!freshestFlat) return freshestPano;
  return preferPano([freshestFlat, freshestPano]);
}

/**
 * Mapillary Street Level provider: tile coverage, Graph API image cones and
 * the MapillaryJS viewer. `source` is ./source.js or a stand-in.
 * @returns {import('../../registry.js').StreetLevelProvider}
 */
export function createMapillaryProvider({ source }) {
  if (
    !MAPILLARY_SOURCE_METHODS.every(
      (method) => typeof source?.[method] === 'function',
    )
  )
    throw new TypeError('A Mapillary source is required');

  return Object.freeze({
    id: MAPILLARY_PROVIDER_ID,
    name: MAPILLARY_NAME,
    label: MAPILLARY_LABEL,
    requiresKeyId: MAPILLARY_KEY_ID,
    pickPrefix: PICK_PREFIX.root,
    colors: COLORS,
    credit: Object.freeze({ html: MAPILLARY_CREDIT_HTML }),

    create(context) {
      const state = createProviderState(context);
      const parts = {};
      parts.coverage = createCoverage({ state, source, parts });
      parts.sequences = createSequences({ state, source, parts });
      const viewer = createMapillaryViewer({
        source,
        render: context.services?.render,
      });

      return {
        async status() {
          try {
            state.status = await source.getStatus();
            state.keyRequired = state.status?.configured !== true;
          } catch {
            state.status = null;
            state.keyRequired = !source.hasToken();
          }
          const first = !state.statusKnown;
          state.statusKnown = true;
          // Coverage held back until now: draw it if the layer is on.
          if (first) parts.coverage.refresh();
          context.notify();
          return { configured: !state.keyRequired };
        },

        init(cesiumViewer) {
          state.viewer = cesiumViewer;
          parts.sequences.ensureCollections(cesiumViewer);
          parts.sequences.setVisible(false);
        },

        activate(cesiumViewer) {
          state.viewer = cesiumViewer;
          parts.sequences.setVisible(true);
          parts.coverage.attach(cesiumViewer);
        },

        deactivate() {
          parts.coverage.detach();
          parts.coverage.clear();
          parts.coverage.resetErrors();
          parts.sequences.clearSelection();
          parts.sequences.setVisible(false);
        },

        destroy(cesiumViewer) {
          parts.coverage.detach();
          parts.coverage.clear();
          parts.coverage.resetErrors();
          parts.sequences.destroy(cesiumViewer);
        },

        refreshCoverage: () => parts.coverage.refresh(),

        /** The filter changed: redraw. Each draw reads it from the context. */
        setFilter() {
          parts.coverage.rebuild();
          parts.sequences.rerender();
        },

        /** Core surface mode changed: redraw lines and cones draped or cast. */
        setSurface() {
          parts.coverage.setSurface();
          parts.sequences.rerender();
        },

        coverageStats() {
          return {
            count: parts.coverage.sequenceCount(),
            zoom: state.coverage.zoom,
            kind: state.coverage.kind,
            loading: state.coverage.pending.size > 0,
            hint: state.coverage.hint,
            error: state.coverage.lastError,
            keyRequired: state.keyRequired,
            keyRejected: state.keyRejected,
          };
        },

        handlePick(pickId) {
          const sequenceId = sequenceIdFromPick(pickId);
          if (sequenceId) {
            parts.sequences.select(sequenceId);
            return true;
          }
          if (pickId.startsWith(PICK_PREFIX.image)) {
            context.actions.openImage(pickId.slice(PICK_PREFIX.image.length));
            return true;
          }
          return false;
        },

        selectSequence: (sequenceId) => parts.sequences.select(sequenceId),
        clearSequence: () => parts.sequences.clearSelection(),
        sequenceStats: () => ({
          selectedId: state.sequence.selectedId,
          images: state.sequence.images.length,
          loading: state.sequence.loading,
        }),

        /**
         * Nearest image that passes the imagery filter, or null. The core
         * aborts `signal` once a newer request overtakes the lookup.
         * Records whose claimed position is unusable are dropped, not
         * ranked: a [0, 0] no-fix placeholder would otherwise measure a
         * finite distance to Null Island and could outrank every real photo
         * near the click. Dropped records are counted in `nearestStats`.
         * Among the passing candidates with a real position, the freshest
         * flat and the freshest pano are picked separately (see
         * `freshestFirst`), then a 360° pano within twice the freshest
         * flat's distance wins (see `preferPano`): it lets the viewer look
         * around instead of staring one fixed way, while a current
         * streetscape still beats a decade-old one a few metres closer.
         * Finally a bottom-quartile-quality winner is passed over for the
         * nearest decent one within twice its distance (see
         * `isLowQuality`): a blurry shot a few metres away does not beat
         * a sharp one just past it — but quality never overrides the
         * filter, never sends the viewer across the radius, and never
         * loses the hit when every candidate is low-quality or unscored.
         * With a `heading` (degrees clockwise from north) the pick then
         * prefers a shot facing that way when one is close by (see
         * `facesHeading`); without one the winner stands, as before.
         * Position-less records stay eligible as
         * last-resort hits in API order, as before.
         */
        async nearestImage({ lat, lon }, { signal, heading } = {}) {
          const images = await source.nearestImages(
            { lat, lon, radius: NEAREST_RADIUS_M, limit: NEAREST_LIMIT },
            { signal },
          );
          // The API returns the images in the radius in no particular order.
          // Cycle 3 position guard: a claimed-but-unusable position is
          // dropped and counted, never ranked. Cycle 5 ranking + Cycle 8
          // pano preference, composed: the freshest flat and the freshest
          // pano are picked separately, then the 2× pano-distance rule
          // decides between the two winners. Position-less records stay
          // eligible as last-resort hits. Positions come from the shared
          // ./position.js module (Cycle 11: SfM-refined fix when usable,
          // else GPS).
          const ranked = [];
          for (const record of images) {
            const position = nearestPosition(record);
            if (position === null) {
              state.nearest.droppedWithoutPosition++;
              continue;
            }
            ranked.push({
              record,
              capturedAt: Number(record.captured_at) || 0,
              isPano: record.is_pano === true,
              metres: position
                ? metresBetween({ lon, lat }, position)
                : Infinity,
            });
          }
          const filter = context.getFilter();
          const passing = ranked.filter(({ record, capturedAt, isPano }) =>
            passesImageryFilter(
              {
                isPano: record.is_pano === true,
                capturedAt,
              },
              filter,
            ),
          );
          const placed = passing.filter(({ metres: d }) => Number.isFinite(d));
          // `passing` is API order, so a last-resort hit keeps it.
          let hit = placed.length ? freshestPanoFirst(placed) : passing[0];
          // Sharp-over-blurry: a bottom-quartile-quality winner is passed
          // over for the nearest decent candidate within twice its
          // distance. Unscored images stay eligible throughout — a missing
          // score is not a bad photo.
          if (hit && isLowQuality(hit.record.quality_score)) {
            const decent = placed
              .filter(({ record }) => !isLowQuality(record.quality_score))
              .sort((a, b) => a.metres - b.metres)[0];
            if (
              decent &&
              decent !== hit &&
              decent.metres <= NEAREST_QUALITY_REACH * hit.metres
            ) {
              hit = decent;
            }
          }
          // Heading-aware pick: with a heading, prefer the nearest shot
          // facing within 60° of it when one is at most 15 m farther than
          // the winner; panos face every way. Without a heading the winner
          // stands, as before.
          const target = normalizeHeading(heading);
          if (hit && target !== null) {
            const facing = placed
              .filter(({ record }) => facesHeading(record, target))
              .sort((a, b) => a.metres - b.metres)[0];
            if (
              facing &&
              facing !== hit &&
              facing.metres <= hit.metres + FACING_MAX_EXTRA_M
            ) {
              hit = facing;
            }
          }
          return hit ? String(hit.record.id) : null;
        },

        /** Nearest-lookup skips: records dropped for a claimed-but-unusable position. */
        nearestStats: () => ({
          droppedWithoutPosition: state.nearest.droppedWithoutPosition,
        }),

        viewer,
      };
    },
  });
}
