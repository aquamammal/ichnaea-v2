# Ichnaea v2 — Agent Contract

## What this is

A privacy-first, peer-to-peer **periodic check-in beacon** built on Pear/Holepunch. Users broadcast GPS location at a low, user-defined frequency to explicitly-added contacts only, rendered as pins on a user-selectable 2D map. Zero telemetry, no central servers, no group secrets.

## Non-negotiable constraints

- Pure P2P; no central servers, no telemetry.
- Sharing only with explicitly-added contacts (Base64 public key exchange out-of-band).
- **Pair-wise** Hyperswarm topics per contact — never a single group-secret topic.
- Local persistence only (filesystem under `data/` for the main process; secret key never leaves the device).
- JavaScript ESM only; no UI framework (vanilla JS + CSS).
- Pear runtime + Holepunch stack; 2D maps via `d3-geo` / `d3-geo-polygon`.

## Repository layout

```
├─ index.js              # Pear main process: bridge + runtime + pipe server (owns the P2P stack)
├─ src/
│  ├─ index.html         # map (100vh) + panels + modals + dev panel (renderer)
│  ├─ main.js            # renderer: thin pipe client + map/UI controller + geolocation
│  ├─ staleness.js       # active/stale/offline classification + humanizing (renderer)
│  ├─ map-styles.js      # user-selectable map-style registry + persistence (renderer)
│  ├─ renderer.js        # map-style dispatcher -> builds the 2D renderer (renderer)
│  ├─ map2d.js           # 2D canvas map: equirectangular / self-centered / Dymaxion (renderer)
│  ├─ country-colors.js  # shared per-country color palette (colored-countries mode)
│  ├─ scanner.js         # camera QR scanner (getUserMedia + jsqr, on-device)
│  ├─ updates.js         # manual GitHub Release version check (Settings → Check for updates)
│  ├─ assets/            # bundled rendering assets (Natural Earth GeoJSON + earth texture)
│  ├─ crypto.js          # keygen, base64 keys, pair-topic derivation, encrypt stubs (shared, pure)
│  ├─ swarm.js           # pair-wise Hyperswarm topics, handshake, connections (main process)
│  ├─ main/              # main-process-only modules (no browser APIs)
│  │  ├─ app.js          # P2P orchestrator: boots the stack, routes pipe messages
│  │  ├─ fsx.js          # bare-fs/bare-path with fs/path fallback + JSON helpers
│  │  ├─ identity.js     # keypair → data/identity.json
│  │  ├─ contacts.js     # contacts store → data/contacts.json
│  │  ├─ settings.js     # interval + core generation + manual-GPS override → data/settings.json
│  │  ├─ corelog.js      # local Hypercore (filesystem) + contact-core replication (RAM)
│  │  └─ scheduler.js    # broadcast timer; GPS crosses the pipe; manual-override short-circuit
│  ├─ db.js              # IndexedDB wrapper (kept for the contacts unit test only)
│  ├─ contacts.js        # IndexedDB contact CRUD (kept for the contacts unit test only)
│  ├─ idb-storage.js     # RAS@3 IndexedDB Hypercore backend (legacy; unused by the live app)
│  └─ scheduler.js       # old renderer web scheduler (legacy; unused by the live app)
├─ data/                 # runtime state (identity, contacts, settings, cores) — gitignored
├─ test/                 # brittle unit tests
├─ README.md  PROGRESS.md  TESTING.md  ARCHITECTURE.md  SECURITY.md
└─ AGENTS.md
```

**Entrypoints**
- Main process: `index.js` → `src/main/app.js` (owns identity, local Hypercore, Hyperswarm, contact replication, contacts store, scheduler; persists to `data/` on the filesystem).
- Renderer: `src/index.html` → `src/main.js` (thin pipe client: map, UI, geolocation only).

## How to run

- Install deps: `npm install`
- Dev app: `npm run dev` (= `pear run -d .`)

**Expected:** a Pear desktop window opens showing a full-viewport 2D map with a top-left control panel and a bottom-right contacts list.

## How to test

- Unit tests: `npm test` (brittle, `test/*.test.js`).
- Manual QA: follow `TESTING.md` (contact addition, frequency change, GPS denial, stale-peer removal, connection failure).

**Pass/fail:** unit tests report PASS; manual smoke passes if the window renders the map and panels without console errors.

## Environment

- Required tools: `node`, `npm`, `pear`.
- Env vars: none.

## Operational rules for agents

- Keep changes minimal and scoped; match the existing module boundaries.
- **Documentation protocol (mandatory):** after every code change, update the relevant sections of `README.md`, `PROGRESS.md`, `TESTING.md`, `ARCHITECTURE.md`, and `SECURITY.md`. Log each completed module / bug / next step in `PROGRESS.md`. Do not wait to be asked.
- Run `npm test` before considering a change done.

## Known risks / sharp edges

- `pear run -d` requires a path (use `pear run -d .`).
- **The project directory path must not contain a space.** Pear URL-encodes a space to `%20` and then fails with `ERR_INVALID_PROJECT_DIR`. This is why the folder is `ichnaea-v2` (hyphen), not `ichnaea v2`.
- **The renderer must NOT import hyperswarm, hypercore, random-access-*, or any Node builtin (`events`, `streamx`, `stream`).** The Pear renderer's module resolver does not provide Node builtins to app code — importing Hyperswarm there crashed at load with `Cannot find package 'events'` and the map never rendered. The whole P2P stack lives in the **main process** (`index.js` + `src/main/*`); the renderer (`src/main.js`) imports only `pear-pipe`, `staleness.js`, `renderer.js`, `map-styles.js`, `map2d.js`, `country-colors.js`, `scanner.js`, `updates.js`, `qrcode`, `jsqr`.
- **Geolocation is browser-only**, so GPS crosses the pipe: the main-process scheduler sends `gps:request`, the renderer answers `gps:result` (`{lat,lng}` or `{error}`). Never call `navigator.geolocation` in the main process.
- **Persistence is on the filesystem** (main process, `data/`), not IndexedDB: identity, contacts, settings, and the local Hypercore. File access uses `bare-fs`/`bare-path` with an `fs`/`path` fallback (`src/main/fsx.js`). The renderer's IndexedDB `src/db.js`/`src/contacts.js` are kept only to keep the contacts unit test green.
- **Hypercore is pinned to v10.** v10 accepts a **directory path** for filesystem RAF storage — `new Hypercore(dir, { keyPair, createIfMissing: true })` (verified: append + reopen + read). v11 uses a Corestore/RocksDB model we don't want. Contact cores use `random-access-memory`. Do not upgrade Hypercore without re-solving storage.
- Hypercore is **append-only** — "prune to 200" is done by **core rotation** (new `data/cores/` generation directory), not in-place deletion. The new core key must be re-shared on the next handshake (`swarm.refreshHello()`).
- The swarm handshake identifies contacts by the hello's `publicKey` (matched against joined contacts), **not** `info.topics` — the latter is unreliable on the inbound/server side.
- Location payloads are **plaintext** in the MVP (see `SECURITY.md`); `encrypt`/`decrypt` in `src/crypto.js` are stubs marking the X25519 upgrade point.
- **Rendering must stay zero-telemetry.** No OSM/tile servers, no CDN, no third-party requests for rendering — the world outline (`src/assets/world.js`) is bundled locally, and all three projections (equirectangular, self-centered, Dymaxion) are pure `d3-geo` math over that data. Do not add remote rendering assets.
- **The only outbound request is the manual update check.** `src/updates.js` fetches the app's GitHub `releases/latest` **only when the user taps Settings → Check for updates**. Never check on boot or in the background — an automatic check would violate zero-telemetry. Keep `APP_VERSION` in `updates.js` in sync with `package.json` on every version bump.
- **The desktop build is maps-only.** There is no 3D WebGL globe (`globe-renderer.js` was removed). `src/renderer.js` is the map-style dispatcher and always builds a 2D canvas map from `src/map2d.js`. If you ever want to add a globe back as an opt-in, re-import `globe-renderer.js` from the Android repo and restore a WebGL fallback path in `src/renderer.js`.
- `pear run` does not pipe renderer console to stdout. Keep the on-page fatal-error overlay in `src/main.js` so load errors are visible; main-process modules can be smoke-tested in plain Node with a stub pipe (see PROGRESS.md).
- **Environmental:** in some environments `pear run -d .` stops in Pear's own `pear-electron` boot bundle with `SyntaxError: Unexpected token ':'` before app code loads (the sibling v1 project fails identically). This is a Pear runtime/CLI issue, not an app bug.

## Governance

`AGENTS.md` may only be updated to add missing factual run/test info, document verified sharp edges, or correct incorrect instructions.
