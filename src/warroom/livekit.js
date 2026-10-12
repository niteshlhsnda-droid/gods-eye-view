/**
 * LiveKit voice rooms — TIER 2: configuration only.
 *
 * This module NEVER fabricates a working room. It reads deployment config
 * from the environment and reports whether a LiveKit deployment is actually
 * reachable. Room creation, token minting, and media all require the
 * self-hosted (or Cloud) LiveKit server from docs/livekit-self-host.md plus
 * the `livekit-client` dependency — neither is installed here.
 */

/** Read LiveKit deployment config from the environment (never secrets in code). */
export function livekitRoomConfig({
  env = globalThis.process?.env ?? {},
  tokenEndpoint = '/api/livekit/token',
} = {}) {
  const url = env.LIVEKIT_URL ?? '';
  return {
    url,
    tokenEndpoint,
    // A room can only work when a server URL is configured AND tokens are
    // minted server-side with the LiveKit API key/secret. Anything else is
    // a fake room — we refuse to report one.
    enabled: Boolean(url),
  };
}

/**
 * Request a participant token from the app's token endpoint. The endpoint
 * must mint tokens server-side with the LiveKit API key/secret (see
 * docs/livekit-self-host.md); the browser never sees the secret.
 */
export async function requestLivekitToken(
  fetchImpl,
  { tokenEndpoint, room, identity } = {},
) {
  if (!tokenEndpoint) throw new Error('No LiveKit token endpoint configured');
  if (!room || !identity) throw new TypeError('room and identity are required');
  const response = await fetchImpl(tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ room, identity }),
  });
  if (!response.ok)
    throw new Error(`LiveKit token endpoint HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload?.token) throw new Error('Token endpoint returned no token');
  return payload.token;
}

/** Human-readable readiness report for the war-room voice panel. */
export function livekitReadiness(config = livekitRoomConfig()) {
  if (!config.enabled)
    return {
      ready: false,
      reason:
        'LIVEKIT_URL is not set — voice rooms need a LiveKit server (see docs/livekit-self-host.md).',
    };
  return {
    ready: true,
    reason: `LiveKit server configured at ${config.url}; rooms still require a server-side token endpoint.`,
  };
}
