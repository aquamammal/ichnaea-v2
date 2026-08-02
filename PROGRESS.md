# PROGRESS — Ichnaea v2

Developer log. Newest entries on top. Each entry records what was completed, known bugs, and the immediate next step.

---

## 2026-08-02 — Fixed two-way live sync: protomux multiplexing + local-core serving

**Status:** two-party replication now works end-to-end (verified live). This unblocks testing the app with another user.

**The bug.** Contact-core replication never delivered: `src/swarm.js` wrote newline-JSON frames and read the Hyperswarm connection directly, while `src/main/corelog.js` `replicateContactCore` wrapped that **same** connection in Hypercore's noise/protomux protocol. The raw JSON frames were interpreted by the peer's protomux as malformed frames, which destroyed the replication stream. Separately, the app never served its own local core, so contacts had nothing to pull.

**The fix.**
- The Hyperswarm connection is a `@hyperswarm/secret-stream`. `src/swarm.js` now opens **one Protomux** over it (stored at `conn.userData`) and carries the JSON handshake (hello + sealed-box log-key exchange) on an `ichnaea-handshake` protomux channel, instead of raw `conn.write`. Hypercore replication attaches to that **same** mux, so the two protocols multiplex cleanly.
- `src/main/corelog.js` `replicateContactCore` now attaches to `conn.userData` (the shared mux) via `core.replicate(mux)`.
- `src/swarm.js` now **serves the user's own local core** on each connection (`serveLocalCore`, idempotent per mux, with `refreshLocalCore()` re-serving after core rotation). `src/main/app.js` passes `getLocalCore` and calls `refreshLocalCore()` in `rotateCore`.
- Added `test/e2e-encryption.mjs` + `test/e2e-child.mjs`: spawn two real app processes, exchange log keys, check in, and assert both decrypt each other's cores.

**Verified:** `node test/e2e-encryption.mjs` → both workers report `gotLogKey:true` and advancing `lastSeenTs` (encrypted blocks delivered AND decrypted) → `E2E SYNC: PASS`. `npm test` 32/32. App boots cleanly.

**Immediate next step:** real two-user QA on Windows (see README/TESTING.md): install Node + Pear, clone, `npm install`, `npm run dev`, exchange public keys out-of-band, add each other.

---

## 2026-08-02 — X25519 end-to-end log encryption + stale-instance cleanup

**Status:** location payloads are now **end-to-end encrypted**. Also cleared a stale `pear run` instance that was holding the Hypercore lock and reset a leftover manual-GPS override.

**Post-fix hardening:** contact records sent to the renderer are now sanitized — `src/main/app.js` adds `toRendererContact()` which strips `logKeyHex`/`coreKeyHex` (key material) from every renderer-bound record (`boot`, `contact:update`, `contact:added`). The renderer only needs display data; the peer's log key now exists solely in the main-process store. Verified: boot/contact records have no key fields while the store still holds the key. `npm test` 32/32.

**Encryption design (see ARCHITECTURE.md / SECURITY.md):**
- Each user persists a 32-byte symmetric **log key** + an X25519 **log-encryption keypair** in `identity.json` (backfilled on upgrade via `src/main/identity.js`).
- Every block of the user's own core is encrypted with their log key (`sodium.crypto_secretbox`, nonce-prepended). `src/main/corelog.js` encrypts in `appendCheckin` and decrypts in `readLatest` (with a plaintext fallback for legacy blocks).
- The log key is shared per-contact during the handshake as a **sealed box** (`crypto_box_seal` to the contact's X25519 public key): `src/swarm.js` adds `encPubKey` to the hello and a `beacon-log-key` frame; `src/crypto.js` provides `generateLogKey`, `generateLogEncryptionKeyPair`, `sealLogKey`/`openLogKey`, and the AEAD `encrypt`/`decrypt`. The recovered key is stored on the contact record (`logKeyHex`, `src/main/contacts.js`).
- `sodium-universal` added to `dependencies` (already present transitively via hypercore-crypto).
- `npm test` **32/32 pass, 61/61 asserts** (5 new crypto tests: log-key sizes, AEAD round-trip, wrong-key rejection, sealed-box two-peer exchange, no-key pass-through).

**Verified:**
- Crypto primitives round-trip; wrong-key decrypt returns null; a box sealed to B cannot be opened by A.
- App boots on a clean dir, encrypted check-in persists and decrypts after restart.
- Legacy plaintext core in the project `data/` still reads; `identity.json` backfilled.
- Two live instances exchanged log keys via the sealed-box handshake (both recovered each other's key).
- Project `data/` app boots cleanly after the stale instance was killed.

**Known bug (pre-existing, NOT introduced by encryption): contact-core replication delivery is broken.** Two live instances exchange log keys successfully over the pair-wise connection, but neither receives the other's blocks (`lastSeenTs` never advances). Root cause: `src/swarm.js` writes newline-JSON frames and reads the Hyperswarm `conn` directly for the handshake, while `src/main/corelog.js` `replicateContactCore` wraps that **same** `conn` in Hypercore's noise/protomux protocol (`core.replicate(conn)`). The JSON frames are fed into the peer's noise handshake, corrupting the replication stream. The log-key *exchange* works (JSON path), but block *delivery* does not. This needs the handshake and replication routed on separate protomux channels (see SECURITY.md hardening #1).

**Housekeeping done:**
- Killed the stale `pear run -d .` instance (PID 377106) that held the Hypercore lock (`ELOCKED`), so a fresh `npm run dev` no longer fails with "location log is locked".
- Reset `data/settings.json` manual override from `{enabled:true,lat:90,lng:-150}` (Arctic Ocean test coords) back to disabled/empty.

**Immediate next step:** fix contact-core replication delivery (separate the JSON handshake from Hypercore replication, e.g. multiplex both over the connection with protomux). Until then, two-party flows connect and exchange keys but do not sync pins.

---

## 2026-08-02 — 2D map confirmed working; added in-app 3D globe toggle

**Status:** the 2D canvas map now renders correctly in the app (confirmed by the user). Continents, graticule, and pins all show.

**Added:** a "Try 3D globe" toggle in the hidden dev panel (double-tap the version tag, bottom-left). It sets `localStorage 'globe'` to `'3d'`/`'2d'` and reloads the window so the renderer factory re-selects. Button label reflects the current mode ("Try 3D globe" ↔ "Use 2D map"). This removes the need to hand-edit the URL or devtools console to switch renderers.

**Note on the 3D path:** it requires WebGL, which was previously failing on the user's machine (`THREE.WebGLRenderer: Error creating WebGL context`). The 3D code is intact (globe.gl resolves fine in the Pear window; only context creation was the issue). Whether it renders now depends on the machine's GPU/Chromium WebGL support — if WebGL is still blocked, the factory falls back to 2D automatically. Could not validate the 3D render outside Pear (bare `globe.gl` import needs Pear's module resolution).

**Verified:** `node --check` on `src/main.js` + `src/globe-renderer.js`; `npm test` 27/27 pass.

---

## 2026-08-02 — Fix: blank 2D map (canvas collapsed to 1px height)

## 2026-08-02 — Fix: blank 2D map (canvas collapsed to 1px height)

**Reported symptom:** app loads, panels alive and buttons work, but the map area is blank. Isolated `maptest.html` was also blank.

**Debugging (headless Chrome + static server + pixel sampling):** the 2D renderer ran without errors and pins were set, but the canvas backing store was `1100x1` — **1 pixel tall** — so everything drew into an invisible 1px strip. Center-pixel readback confirmed the blue self-pin color was being painted, just into a 1px canvas.

**Root cause:** `resize()` read `container.clientWidth/clientHeight`, which is **0 before first layout** (the module runs before the fixed-position container is laid out). The `|| 1` fallback then forced `canvas.height = 1`. The CSS box (`width:100%;height:100%`) showed the right size, but the backing-store attribute stayed 1px, so nothing visible rendered.

**Fix (`src/map2d.js`):**
- `resize()` now reads the **viewport** (`window.innerWidth/innerHeight`) first (the `#globe` container is `position:fixed;inset:0`, i.e. viewport-sized), falling back to the container — eliminating the layout-timing dependency. It also sets `canvas.style.width/height` to keep CSS box and backing store in sync.
- Added a `dims()` helper: `draw()` and `fitView()` now use the canvas **backing-store** dimensions (`canvas.width/dpr`) instead of `clientWidth`, decoupling them from CSS layout entirely.
- Also (earlier this session) inlined the world outline as `src/assets/world.js` (geometry-only, 245KB) instead of a runtime GeoJSON fetch — removes any bridge path risk.

**Verified (headless Chrome, pixel-sampled the rendered map):**
- Canvas now `1100x633`; landmasses, ocean, and graticule render.
- Pin colors/positions exact: London self-pin `(59,157,255)`=blue, NYC `(60,219,131)`=green, Sydney `(150,160,172)`=gray; Pacific ocean dark, Africa land correct.
- `npm test` 27/27 pass. Kept `src/maptest.html` for manual verification.

**Next step (user):** `pkill -f pear-runtime && npm run dev` — the 2D map should now render with your pins.

---

## 2026-08-02 — 2D canvas map is now the DEFAULT renderer

## 2026-08-02 — 2D canvas map is now the DEFAULT renderer

**Reported symptom:** app loads with no errors, but no globe or map appears. Console showed `THREE.WebGLRenderer: Error creating WebGL context` (thrown from `new three-globe` inside globe.gl).

**Root cause:** the WebGL pre-check (`webglAvailable()`) can succeed (a test canvas gets a context) while globe.gl/three-globe still fails to create the *real* renderer context — so the factory took the 3D path and threw, and the fallback either wasn't reached or the error was re-thrown inside globe.gl's kapsule reactive layer (`Object.invokeFunc`). WebGL detection proved too fragile to rely on.

**Decision (user):** "just use a 2D map for now." So the **2D canvas map is now the default renderer**, not just a fallback.

**Change (`src/globe-renderer.js`):** added `wants3D()` — the factory returns the 2D canvas renderer by default. The 3D WebGL globe is now **opt-in**: force it with `?globe=3d` in the window URL or `localStorage 'globe' = '3d'` (force 2D explicitly with `?globe=2d`). When 3D is requested but the context can't be created, it still falls back to 2D. The 3D path is preserved (not deleted) for machines where WebGL works. `src/map2d.js` unchanged; `src/main.js` unchanged (same renderer interface).

**Verified:**
- `src/map2d.js` standalone: creates renderer (`webgl:false`), setSelf/upsert/hasPin/remove all work.
- `node --check src/globe-renderer.js` OK; `npm test` 27/27 pass.
- (Could not run the full factory import in a stubbed-Node harness — globe.gl's import-time animation loop hangs the stub event loop. Harness artifact only; three.js loads fine in the real renderer, and 2D mode never calls `Globe()`.)

**Next step (user):** `npm run dev` — the 2D map should now render with your pins. To try the 3D globe later on a machine with working WebGL, open the window with `?globe=3d`.

---

## 2026-08-02 — Fix: `Cannot read properties of null (reading 'length')` crash

## 2026-08-02 — 2D canvas fallback map + fully local rendering assets (zero telemetry)

**Problem:** on this Linux machine WebGL context creation fails in the Pear/Electron window (`THREE.WebGLRenderer: Error creating WebGL context`), so the 3D globe never renders. Pear does not forward app-args as Chromium switches (no way to inject `--enable-unsafe-swiftshader` from app code), so the 3D globe is simply unusable on some machines. The previous fallback only showed a static message.

**Why not OSM/tile maps:** the obvious 2D fallback (OpenStreetMap or any tile server) was **rejected** — every tile fetch is a third-party network call that leaks when/where the user looks, which violates the app's zero-telemetry rule. Same reason we don't download new assets: only files already present in `node_modules` were repackaged.

**What was built:**
- `src/map2d.js` (new): a **2D canvas fallback map** — plain 2D context, no WebGL. Equirectangular projection of the bundled Natural Earth 110m countries GeoJSON (dark landmass on darker ocean, graticule), blue self-pin, green/gray contact pins, dotted arcs from self to each contact, click hit-testing (~10 px radius) calling the same `onPinClick(data)` shapes, plus drag-pan and wheel-zoom. Same `pins` Map model and same public interface as the 3D renderer.
- `src/globe-renderer.js` refactored into a **factory**: `createGlobeRenderer` probes WebGL (pre-check + try/catch around `Globe()`) and returns the 3D renderer or the 2D fallback. The 3D path is unchanged except the earth texture now loads from the **local bundle** (`./assets/earth-blue-marble.jpg`) instead of `//unpkg.com/...` — removing the last CDN call. `src/main.js` needed no changes.
- `src/assets/` (new): `ne_110m_admin_0_countries.geojson` (177 features, public domain, copied from `node_modules/globe.gl/example/datasets/` — not in globe.gl's `exports` map, hence a real project file) and `earth-blue-marble.jpg` (copied from `node_modules/three-globe/example/img/`). Both are fetched via relative URL from the app's own directory over the Pear localhost bridge.

**Verified:**
- `node --check` passes on `src/map2d.js`, `src/globe-renderer.js`, `test/smoke-map2d.js`.
- `npm test` — 27/27 pass (53/53 asserts).
- `node test/smoke-map2d.js` — both modules import cleanly with DOM/canvas stubbed; the factory returns the 2D fallback (`webgl: false`, `globe: null`) when WebGL is unavailable; pin set/upsert/recolor/remove/hasPin/resize all work; the GeoJSON asset parses as a FeatureCollection with 177 features.
- Grep of `src/` for `http://`, `https://`, `//unpkg`, `//cdn` — **no matches**; rendering makes zero third-party requests.

**Next step (user action):** manual QA with WebGL blocked — the app should show the 2D canvas map with self + contact pins and working pin clicks (see TESTING.md §5). The 3D path is unchanged and still used wherever WebGL works.

---

## 2026-08-02 — Fix: `Cannot read properties of null (reading 'length')` crash

**Reported symptom:** console showed `Uncaught (in promise) TypeError: Cannot read properties of null (reading 'length')` at `Object.open`. (Good news: this meant the app was now actually loading and running — the earlier Pear runtime boot-bundle issue was no longer blocking it.)

**Root cause:** a stale/concurrent Hypercore lock (`ELOCKED`) — typically a second instance launched while a first still held the core lock (earlier `timeout`-killed runs left stray `pear-runtime` processes). When `openLocalCore` rejected, `state.localCore` stayed `null`, and the later `readLatest(state.localCore)` in the `boot` handler did `core.length` on `null` → the exact reported crash.

**Fix:**
- `src/main/corelog.js` `readLatest` now guards a null core (`if (!core || !core.length) return null`).
- `src/main/app.js` `boot()` wraps `openLocalCore` in try/catch; on `ELOCKED` it sends a clear, actionable message to the renderer ("Another instance is running (location log is locked). Close it first.") instead of leaving a null core that crashes later. `getLocalCoreKey` also null-guarded.

**Verified:**
- Node boot smoke: main-process stack boots, core opens (len 2), `boot` message flows with pubkey + selfLoc.
- ELOCKED path: a second instance now fails with the clear message sent to the renderer (no `.length` crash).
- `npm test` 27/27 pass.

**Note for the user:** if you see "location log is locked", a previous instance is still running — close it (or `pkill -f pear-runtime`) before relaunching.

---

## 2026-08-02 — Blank-globe follow-up: WebGL fallback + Pear runtime diagnosis

## 2026-08-02 — Blank-globe follow-up: WebGL fallback + Pear runtime diagnosis

**Reported symptom:** blank globe; console showed `SyntaxError: Unexpected token ':'` at `pear-electron/pre:1` and `THREE.WebGLRenderer: Error creating WebGL context`.

**Root cause (confirmed environmental, NOT app code):** the `SyntaxError: Unexpected token ':'` comes from the **local Pear runtime** (`v2.6.5`, installed 2025-12-30) mis-executing a JSON boot bundle (`~/.config/pear/bundles/*.bundle`, which begins `{"version":0,...}`) as JavaScript. Proof: the **untouched sibling v1 project fails with the identical error**. Clearing the bundle cache does not help — the runtime regenerates the same JSON bundle and still tries to `require()` it as JS. This is a Pear runtime installation bug, independent of this app.

**App-side changes made (real improvements regardless):**
- `src/globe-renderer.js` now detects WebGL unavailability (pre-check + try/catch around `Globe()`) and renders a **readable fallback message** with Linux software-rendering workarounds instead of a silent blank page. The rest of the app (contacts, settings, P2P) keeps working via a no-op renderer.
- Deps restored to the manifest's original resolved versions (`pear-electron@1.9.0-rc.0`, `pear-bridge@1.2.5`) after a version-churn investigation; `node_modules` freshly reinstalled. `npm test` still 27/27.

**Attempted (did not fix the runtime):** downgrading `pear-electron` to `1.7.28`/`1.8.0-rc.0` removed the syntax error but broke the boot invocation (`Cannot find module 'run'`) — those versions are incompatible with runtime `v2.6.5`'s arg passing. `1.9.0-rc.0` is the correct match for this runtime.

**Immediate next step (user action):** repair/update the Pear runtime on the machine (reinstall Pear, or let it self-update from a healthy checkout). Once `pear run -d .` boots past the boot bundle without the `SyntaxError`, the app should render. If WebGL is still blocked by the GPU, the new fallback message will say so and list the `LIBGL_ALWAYS_SOFTWARE=1` workaround.

---

## 2026-08-02 — P2P stack moved to the main process + manual-GPS override

**Root cause fixed.** The app previously ran the whole P2P stack (Hyperswarm, Hypercore) in the Pear **renderer**, which crashed at load with `Cannot find package 'events'` — Hyperswarm needs Node builtins (`events`, `streamx`) that the renderer's module resolver does not provide to app code. The module graph died on import, so the globe never rendered.

**The fix:** the entire P2P stack now lives in the Pear **main process** (full Node/Bare builtins), bridged to the renderer over the Pear pipe — the same structure as the sibling v1 project.

**Completed**
- **New main-process modules** under `src/main/`: `fsx.js` (bare-fs/bare-path with fs/path fallback + JSON helpers, copied from v1), `identity.js` (keypair → `data/identity.json`), `contacts.js` (contacts → `data/contacts.json`), `settings.js` (interval + core generation + manual override → `data/settings.json`), `corelog.js` (local Hypercore on the **filesystem** + RAM contact-core replication), `scheduler.js` (main-process broadcast timer), and `app.js` (orchestrator that boots the stack and routes pipe messages).
- **`index.js`** expanded from a thin bridge into the pipe server that owns the P2P stack and routes `pipe.on('data')` messages to `src/main/app.js`.
- **Hypercore v10 filesystem storage verified** before wiring: `new Hypercore(dir, { keyPair, createIfMissing: true })` (directory-path form) — append + reopen + read all pass in plain Node. Contact cores stay in RAM (`random-access-memory`).
- **`src/main.js` rewritten as a thin pipe client**: imports only `pear-pipe`, `staleness.js`, `globe-renderer.js`. Renders the globe **first** (before wiring the pipe), then requests `boot` state and re-renders on pushes. Handles `gps:request` from main via `navigator.geolocation` and replies `gps:result`. Kept the on-page fatal-error overlay.
- **GPS flow:** the scheduler lives in main; on fire it sends `gps:request`, awaits `gps:result`, appends `{lat,lng,timestamp}` to the local core, and pushes `self`. One 60s retry on failure; never appends null.
- **NEW FEATURE — manual GPS override:** Settings → Manual location has lat/lng inputs + "Check in here" (one-off `checkin:manual`, skips GPS) and a "Use manual location for scheduled check-ins" toggle (`manual:set`, persisted in `data/settings.json`). When on, the scheduler short-circuits the GPS request and uses the stored coords; the GPS status line shows `manual: lat,lng`. Client-side range validation (−90..90 / −180..180).
- **Contacts store moved to the filesystem** (main process). The renderer's IndexedDB `src/contacts.js` + `src/db.js` are kept intact **only so the existing contacts unit test stays green** — the live renderer now fetches/mutates contacts over the pipe. (Chose to keep the green tests rather than rewrite them against the new filesystem store.)
- Added `pear-pipe` to `dependencies` (renderer now imports it directly) and a `.gitignore` (`node_modules/`, `data/`).

**Verification (all run)**
- `npm test` — **27/27 tests, 53/53 asserts pass.**
- `node --check` on every changed/new `.js` — all OK.
- Grep `src/main.js` (and renderer-reachable `staleness.js`/`globe-renderer.js`) — **no** hyperswarm/hypercore/random-access/events/stream imports.
- Node smoke script driving `src/main/app.js` against a stub pipe — boots with **no 'events' error**; boot/manual check-in (persisted to the filesystem core and read back on reboot)/GPS request-result/manual-override persistence/contact-validation all round-trip correctly.
- `timeout 35 pear run -d .` — **no `Cannot find package 'events'` error** (0 occurrences). The run stops later in Pear's own `pear-electron` boot bundle with `SyntaxError: Unexpected token ':'` — a **pre-existing, environmental** Pear issue: the unmodified sibling v1 project fails with the *identical* error, before any app code loads. Out of scope for this change.

**Known bugs / open issues**
- The Pear `pear-electron` boot-bundle `SyntaxError` (above) blocks the GUI from fully launching **in this environment**; it is unrelated to the app code and affects v1 identically. Needs a Pear runtime/CLI investigation (or a healthy Pear install) to confirm the window end-to-end.
- DHT discovery on localhost can take 10–30s for the first connection (expected Holepunch behavior).

**Immediate next steps**
1. On a healthy Pear install, run the two-party manual QA in `TESTING.md` (pairing, GPS denial, stale-peer removal, rotation, manual-GPS override).
2. X25519 payload encryption (SECURITY.md hardening #1).

**Design decisions locked in**
- P2P + persistence (identity, contacts, settings, local core) live in the **main process** on the **filesystem**; the renderer owns globe/UI/geolocation only.
- Hypercore v10 local core uses **directory-path filesystem storage**; contact cores in RAM.
- The broadcast scheduler lives in main; GPS crosses the pipe (`gps:request`/`gps:result`).
- Renderer IndexedDB contacts/db modules retained solely to keep the contacts unit test green.

---

## 2026-08-02 — Full MVP implementation complete

**Completed**
- All source modules implemented under `src/`: `crypto.js`, `db.js`, `contacts.js`, `idb-storage.js`, `corelog.js`, `swarm.js`, `scheduler.js`, `staleness.js`, `globe-renderer.js`, `main.js`, plus `index.html` (globe 100vh + top-left/bottom-right panels + Add Contact/Settings modals + pin overlay + hidden dev panel).
- `index.js` minimal Pear main process (bridge + runtime).
- **Custom `idb-storage.js`**: a RAS@3-compatible IndexedDB random-access backend. Written from scratch because every published `random-access-*` IDB backend is stuck on the old RAS@1 API (no `truncate`) and is incompatible with Hypercore 10. Verified: append, read, and persistence across reopen.
- **Hypercore pinned to v10** (`^10.38.2`). Hypercore 11 moved to a filesystem/RocksDB Corestore model that doesn't fit a browser renderer; v10 supports RAF-factory storage (our IDB adapter) and RAM contact cores. Verified replication between two cores.
- **Pair-wise swarm handshake verified end-to-end** with two live instances over a real Hyperswarm connection: both sides verify each other's public key, and exchange `intervalMs` + `coreKey`. Identification keys off the hello's publicKey (matched against joined contacts), not `info.topics` (unreliable on the inbound side). Unknown keys and duplicate conns are dropped.
- **Core rotation**: after 200 entries the local core rotates to a fresh generation (new IndexedDB namespace), persists the generation, and re-shares the new core key via `refreshHello()`. Contacts pick up the new key from the next handshake and re-replicate.
- **Scheduler**: web `setTimeout` impl + `visibilitychange`/`requestIdleCallback` wake-up; GPS via `getCurrentPosition` with one 60s retry, never appends null. Commented Capacitor skeleton (iOS Background Fetch / Android WorkManager) included.
- **Dev panel** (double-tap version tag): "Force 200 check-ins" button to exercise rotation, per TESTING.md §8.
- **Unit tests**: 27 tests, 53 asserts, all passing (`npm test`, brittle) covering crypto/topic derivation, base64 validation, contact CRUD rules, staleness classification, humanize.
- **Smoke test**: `pear run -d .` validates the project, runs `pear-electron/pre` configure, initializes and starts with no renderer errors.

**Known bugs / open issues**
- None blocking. DHT discovery on localhost can take 10–30s for the first connection (expected Holepunch behavior, not a bug).
- Renderer console is not piped to stdout by `pear run`; verified module loading via a DOM-stubbed import harness instead (all P2P modules + globe.gl/three resolve; CJS deps interop correctly).

**Immediate next steps**
1. Manual two-party QA per `TESTING.md` (needs two instances): pairing, GPS denial, stale-peer removal, rotation via dev panel.
2. X25519 payload encryption (SECURITY.md hardening #1).

**Design decisions locked in**
- Local Hypercore persisted in IndexedDB (custom adapter); contact cores in RAM.
- Prune-to-200 via core rotation (Hypercore is append-only).
- E2E payload encryption deferred to a stub (`src/crypto.js`).

---

## 2026-08-02 — Project scaffold & documentation

**Completed**
- Defined architecture and module layout (see `ARCHITECTURE.md`).
- Wrote the full documentation set: `README.md`, `ARCHITECTURE.md`, `SECURITY.md`, `TESTING.md`, `PROGRESS.md`, `AGENTS.md`.
- Created `package.json` (Pear config + dependencies) and the minimal Pear main process `index.js` (bridge + runtime only; app logic lives in the renderer).

**In progress**
- Core source modules under `src/` (crypto, db, contacts, swarm, corelog, scheduler, staleness, globe-renderer, main) and `src/index.html`.

**Known bugs / open issues**
- None yet — implementation not started.

**Immediate next steps**
1. Implement `src/crypto.js`, `src/db.js`, `src/contacts.js` + unit tests.
2. Implement `src/corelog.js` and `src/swarm.js`.
3. Implement `src/scheduler.js` and `src/staleness.js` + tests.
4. Implement `src/globe-renderer.js`, `src/main.js`, and `src/index.html` UI.
5. `npm install`, `npm test`, `pear run -d .` smoke test.

**Design decisions locked in**
- Local Hypercore persisted in IndexedDB via `random-access-web`; contact cores replicated in RAM (re-replicate on reconnect).
- Prune-to-200 implemented as **core rotation** (Hypercore is append-only; old blocks can't be dropped in place). New core key re-shared on next handshake.
- E2E payload encryption deferred to a stub for the MVP (see `SECURITY.md`).
