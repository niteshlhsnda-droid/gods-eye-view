/**
 * Direct GBFS fetch policy for static hosting.
 *
 * On static hosting there is no `/api/gbfs/*` proxy, so the layer fetches
 * operator feeds straight from the browser. That only works where the
 * operator's host answers cross-origin requests (the browser always sends
 * `Origin`; several CloudFront-backed feeds emit CORS headers only then).
 * Hosts below are live-verified: the eight per-system host families from the
 * 2026-10-14 research dossier, plus the registry's own upstream hosts
 * re-verified the same day with the same Origin-header method
 * (gbfs.lyft.com, gbfs.bluebikes.com, gbfs.biketownpdx.com and the three
 * publicbikesystem.net cities all emit `Access-Control-Allow-Origin: *`).
 *
 * A city whose feed host is not on the list (e.g. Columbus CoGo's
 * gbfs.cogobikeshare.com, which did not answer the CORS probe) keeps an
 * honest "needs desktop server" state instead of failing into a generic
 * error.
 *
 * Kept cesium-free on purpose: `source.js` imports this module and the
 * import-direction boundary forbids data sources from reaching
 * rendering/platform dependencies (bikeshare `policy.js` imports cesium).
 * `policy.js` re-exports the allowlist so it stays discoverable there too.
 */

/**
 * GBFS feed hosts verified to allow direct browser fetch (CORS-open).
 * Exact hostname match, lowercase.
 */
export const GBFS_DIRECT_CORS_HOSTS = new Set(
  [
    // Dossier-verified per-system host families.
    'gbfs.citibikenyc.com',
    'gbfs.capitalbikeshare.com',
    'gbfs.lyftbikes.com',
    'gbfs.divvybikes.com',
    'gbfs.nextbike.net',
    'gbfs.bcycle.com',
    'gbfs.api.ridedott.com',
    'api.cyclocity.fr',
    // Registry upstream hosts, live-verified 2026-10-14 (Origin-header probe).
    'gbfs.lyft.com',
    'gbfs.bluebikes.com',
    'gbfs.biketownpdx.com',
    'austin.publicbikesystem.net',
    'hon.publicbikesystem.net',
    'chat.publicbikesystem.net',
  ].map((host) => host.toLowerCase()),
);

/** Error code for "this city needs the desktop server" on static hosting. */
export const GBFS_NEEDS_DESKTOP_SERVER_CODE = 'GBFS_NEEDS_DESKTOP_SERVER';

/** Whether a GBFS feed host may be fetched directly from the browser. */
export function isGbfsDirectHostAllowed(host) {
  return GBFS_DIRECT_CORS_HOSTS.has(String(host || '').toLowerCase());
}

/** Honest per-city error message for hosts outside the direct-fetch list. */
export function gbfsStaticNeedsServerMessage(host) {
  return (
    `GBFS host ${host} does not allow direct browser fetch — ` +
    'this bikeshare city needs the desktop server'
  );
}
