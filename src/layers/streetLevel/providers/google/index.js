import { FOLLOW_MAP_STACK_ID } from '../../policy.js';
import { metresBetween } from '../../view.js';
import { createMapsLoader } from './mapsLoader.js';
import { createGoogleViewer } from './viewer.js';
import {
  COLORS,
  GOOGLE_CREDIT_HTML,
  GOOGLE_KEY_ID,
  GOOGLE_LABEL,
  GOOGLE_NAME,
  GOOGLE_PROVIDER_ID,
  GROUND_CLICK_HINT,
  KEY_REJECTED_MESSAGE,
  NEAREST_RADIUS_M,
  NEAREST_TIMEOUT_MS,
  NO_ANSWER_MESSAGE,
  PICK_PREFIX,
  imageDateMs,
} from './policy.js';

/** `promise`, unless it times out, `signal` aborts or Google refuses the key. */
function settleWithin(promise, { ms, signal, loader }) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => finish(reject, new Error(NO_ANSWER_MESSAGE)),
      ms,
    );
    const onAbort = () => finish(reject, signal.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    const stopAuthWatch = loader.onAuthFailure(() =>
      finish(reject, new Error(KEY_REJECTED_MESSAGE)),
    );
    promise.then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
    function finish(settle, value) {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      stopAuthWatch();
      settle(value);
    }
  });
}

/**
 * Google Street View provider: Google's panorama viewer and nearest-panorama
 * lookups. It draws no coverage; a click on a street opens the panorama.
 * @returns {import('../../registry.js').StreetLevelProvider}
 */
export function createGoogleProvider({
  getApiKey,
  loader = createMapsLoader({ getApiKey }),
}) {
  if (typeof getApiKey !== 'function')
    throw new TypeError('Google Street View needs getApiKey');

  return Object.freeze({
    id: GOOGLE_PROVIDER_ID,
    name: GOOGLE_NAME,
    label: GOOGLE_LABEL,
    requiresKeyId: GOOGLE_KEY_ID,
    pickPrefix: PICK_PREFIX.root,
    colors: COLORS,
    credit: Object.freeze({ html: GOOGLE_CREDIT_HTML }),
    groundClick: true,
    // Google's terms forbid Street View beside non-Google maps.
    requiresMapStack: FOLLOW_MAP_STACK_ID,
    // Every panorama is billed to the Maps key.
    defaultOn: false,
    // All 360°, and no coverage for a date filter to thin.
    filters: [],
    marker: Object.freeze({ kind: 'view-cone', color: COLORS.coverage }),

    create(context) {
      let keyRequired = !getApiKey();
      let active = false;
      let service = null;
      async function getService() {
        const lib = await loader.importLibrary('streetView');
        service ||= new lib.StreetViewService();
        return service;
      }
      const viewer = createGoogleViewer({
        loader,
        getService,
        render: context.services?.render,
      });
      const stopAuthWatch = loader.onAuthFailure(() => {
        // Switched off: its chip says so.
        if (context.isActive?.())
          context.actions.reportError(KEY_REJECTED_MESSAGE);
        context.notify();
      });

      /**
       * The nearest Google-collected outdoor panorama's data, or null.
       * Shared by `nearestImage` and `nearestPick` so both resolve to the
       * same panorama; seeds the details cache exactly as the old
       * `nearestImage` did, so opening the winner needs no second lookup.
       */
      async function nearestPickData({ lat, lon }, { signal } = {}) {
        if (loader.authFailed()) throw new Error(KEY_REJECTED_MESSAGE);
        signal?.throwIfAborted();
        // Set once the caller has its answer (aborted, timed out, refused):
        // a lookup still waiting on Google's script then asks nothing.
        let settled = false;
        const lookup = (async () => {
          const lib = await loader.importLibrary('streetView');
          await getService();
          if (settled) return null;
          const { GOOGLE, OUTDOOR } = lib.StreetViewSource;
          try {
            const { data } = await service.getPanorama({
              location: { lat, lng: lon },
              radius: NEAREST_RADIUS_M,
              // Both: Google's own imagery, outdoors (sources intersect).
              sources: [GOOGLE, OUTDOOR],
              preference: lib.StreetViewPreference.NEAREST,
            });
            return data;
          } catch (error) {
            if (error?.code === 'ZERO_RESULTS') return null;
            throw error;
          }
        })();
        const data = await settleWithin(lookup, {
          ms: NEAREST_TIMEOUT_MS,
          signal,
          loader,
        }).finally(() => {
          settled = true;
        });
        const panoId = data?.location?.pano;
        if (!panoId) return null;
        viewer.remember(panoId, data);
        // A panorama answer always carries its position; without one the
        // pick still stands (never lose the hit) at the query point.
        const at = data?.location?.latLng;
        const metres =
          typeof at?.lat === 'function' && typeof at?.lng === 'function'
            ? metresBetween({ lat, lon }, { lat: at.lat(), lon: at.lng() })
            : 0;
        return {
          panoId,
          metres,
          capturedAt: imageDateMs(data?.imageDate) ?? 0,
        };
      }

      return {
        async status() {
          keyRequired = !getApiKey();
          context.notify();
          return { configured: !keyRequired };
        },

        init() {},

        activate() {
          active = true;
        },

        deactivate() {
          active = false;
        },

        destroy() {
          active = false;
          stopAuthWatch();
        },

        refreshCoverage() {},

        /** No filter applies to Street View (see `filters`). */
        setFilter() {},

        coverageStats() {
          const keyRejected = loader.authFailed();
          return {
            count: 0,
            zoom: null,
            kind: null,
            loading: false,
            hint:
              !active || keyRequired || keyRejected ? '' : GROUND_CLICK_HINT,
            error: keyRejected ? KEY_REJECTED_MESSAGE : null,
            keyRequired,
            keyRejected,
          };
        },

        handlePick: () => false,

        /**
         * Nearest Google-collected outdoor panorama, or null. The imagery
         * filters do not apply (see `filters`).
         */
        async nearestImage({ lat, lon }, { signal } = {}) {
          const pick = await nearestPickData({ lat, lon }, { signal });
          return pick ? pick.panoId : null;
        },

        /**
         * The provider's own nearest pick with the normalized arbitration
         * fields (see ../../providerAgreement.js), or null. Google's
         * panoramas are all 360°; it is the same pick `nearestImage` would
         * open — the core arbitrates between providers instead of taking
         * the first provider's hit.
         */
        async nearestPick({ lat, lon }, { signal } = {}) {
          const pick = await nearestPickData({ lat, lon }, { signal });
          return pick
            ? {
                providerId: GOOGLE_PROVIDER_ID,
                recordId: pick.panoId,
                metres: pick.metres,
                isPano: true,
                capturedAt: pick.capturedAt,
              }
            : null;
        },

        viewer,
      };
    },
  });
}
