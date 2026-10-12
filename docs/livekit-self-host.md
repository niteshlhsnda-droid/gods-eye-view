# LiveKit voice rooms — self-host setup (TIER 2)

Status: **config only** (2026-10-12). The war-room client ships no working
voice room and must never claim one: `src/warroom/livekit.js` reports
`enabled: false` until a real server URL is configured.

## What you need

1. A LiveKit server — self-hosted (recommended) or LiveKit Cloud.
2. The `livekit-client` npm package (Apache-2.0; **not** in `package.json`
   yet — install it only when wiring real rooms; latest verified 2026-10-12:
   `livekit-client@2.22.4`).
3. A server-side token endpoint — the LiveKit API key/secret must never
   reach the browser.

## Self-host with Docker

```bash
# 1. Generate keys
docker run --rm -v $PWD:/output livekit/livekit-server --generate-config > livekit.yaml
# (or: livekit-server --generate-config, then edit)

# 2. Run
docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp \
  -v $PWD/livekit.yaml:/etc/livekit.yaml \
  livekit/livekit-server --config /etc/livekit.yaml
```

Minimal `livekit.yaml` keys: `keys: { <api-key>: <api-secret> }`,
ports 7880 (RTC/HTTP), 7881 (turn internal), 7882/udp (ICE). Put it behind
TLS (Caddy/nginx) for production; browsers require secure contexts for mic
access.

## Token endpoint (server side)

Add `POST /api/livekit/token` to the app server. It must:

- authenticate the caller (reuse the app's session),
- mint a token with the LiveKit **server SDK** (`livekit-server-sdk`,
  `AccessToken`) using the API key/secret from env (`LIVEKIT_API_KEY`,
  `LIVEKIT_API_SECRET` — never in code),
- return `{ "token": "<jwt>" }` for `{ room, identity }` in the request body.

`requestLivekitToken()` in `src/warroom/livekit.js` is the client half.

## Client wiring (when ready)

```bash
npm install livekit-client@2.22.4   # exact pin; orchestrator installs centrally
```

```js
import { Room } from 'livekit-client';
import { livekitRoomConfig, requestLivekitToken } from './livekit.js';

const config = livekitRoomConfig();
const { ready, reason } = livekitReadiness(config);
if (!ready) { showVoiceDisabled(reason); return; }
const token = await requestLivekitToken(fetch, { ...config, room: roomId, identity: user.id });
const room = new Room();
await room.connect(config.url, token);
```

## Environment

| Variable | Purpose |
| --- | --- |
| `LIVEKIT_URL` | e.g. `wss://livekit.example.com` — enables rooms |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | token minting (server only) |

## Rule

Never fake a working room. If `livekitReadiness().ready` is false, the
voice panel shows the setup reason — not a mock call UI.
