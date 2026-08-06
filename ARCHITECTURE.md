# ARCHITECTURE — Ichnaea v2

A plain-English tour of how the app works, why it's built this way, and where the data flows.

---

## The one-sentence version

Each user keeps an **append-only Hypercore log** of their own GPS check-ins; for every contact, the two peers meet in a **unique, private Hyperswarm topic** derived from both of their public keys, replicate each other's logs, and render the latest entry as a pin on a **2D map** (user-selectable projection).

---

## The moving parts

| Piece | Role | Where |
|---|---|---|
| **Identity** | An Ed25519 keypair generated on first launch. The public key *is* your address. | `src/main/identity.js`, persisted on the **filesystem** (`data/identity.json`) |
| **Contacts** | The list of people you share with: their public key + a local nickname + their interval + the peer's self-chosen name (`lastName`, from their latest check-in). | `src/main/contacts.js` (JSON file `data/contacts.json`) |
| **Pair-wise swarm** | One Hyperswarm; joins a unique topic per contact. Carries the handshake and replication streams. | `src/swarm.js` (main process) |
| **Local log** | Your own Hypercore. Each check-in appends `{lat,lng,timestamp,name}` — `name` is your self-chosen display name (Settings → Your name). | `src/main/corelog.js` (filesystem storage under `data/cores/`) |
| **Scheduler** | Fires at your chosen interval, gets a fix, appends to your log. | `src/main/scheduler.js` (main process; GPS crosses the pipe) |
| **Settings** | Broadcast interval, core-rotation generation, manual-GPS override. | `src/main/settings.js` (JSON file `data/settings.json`) |
| **Main orchestrator** | Boots the P2P stack and routes pipe messages. | `src/main/app.js`, wired by `index.js` |
| **Staleness** | Decides active / stale / offline from a contact's last timestamp vs. their interval. | `src/staleness.js` (renderer) |
| **Globe** | Renders self + contact pins, arcs, and the click overlay as a **2D canvas map** with a user-selectable projection. | `src/renderer.js` (dispatcher), `src/map-styles.js`, `src/map2d.js` — renderer |
| **Renderer client** | Renders the globe/UI, answers GPS requests, sends user actions. | `src/main.js` (renderer, thin pipe client) |

## Two processes, one pipe

The app is split across the two Pear processes, bridged by the **Pear pipe** (newline-free JSON frames via `pear-pipe`):

- The Pear **main process** (`index.js` + `src/main/*`) owns the **entire P2P stack**: identity, the local Hypercore, Hyperswarm, contact-core replication, the contacts store, and the broadcast scheduler. It persists everything on the **filesystem** under `data/`.
- The **renderer** (`src/main.js` + `src/staleness.js` + `src/renderer.js` + `src/map2d.js`) owns only the **map, the UI, and geolocation**. It is a thin client: it sends user actions to the main process as JSON pipe messages and re-renders on state pushes.

**Why the split?** Hyperswarm/Hypercore require Node builtins (`events`, `streamx`, etc.). The Pear renderer's module resolver does **not** provide these to app code, so importing Hyperswarm in the renderer crashed at load with `Cannot find package 'events'` — the module graph (and therefore the globe) never rendered. The main process has full Node/Bare builtins, so the whole P2P stack lives there. This mirrors the proven structure of the sibling v1 project.

**What crosses the pipe:**

- *Renderer → main (requests, correlated by `id`):* `boot`, `contact:add`, `contact:remove`, `interval:set`, `checkin:now`, `checkin:manual` (one-off manual coords), `manual:set` (persist the override), `dev:force200`.
- *Main → renderer (unsolicited pushes):* `peers`, `contact:update`, `contact:remove-pin`, `self`, `status`, and `gps:request`.
- *Geolocation* is browser-only, so when the main-process scheduler fires it sends `gps:request` and the renderer answers with `gps:result` (`{lat,lng}` or `{error}`). The renderer renders the globe **first**, before wiring the pipe, so a slow or absent main process never blanks the page.

---

## Data flow

### Broadcasting (you → your contacts)

1. The **scheduler** (main process) fires at your interval.
2. If the **manual-GPS override** is enabled, it uses the stored manual coords directly. Otherwise it sends `gps:request` to the renderer, which does a single `navigator.geolocation.getCurrentPosition` fix and replies `gps:result`. On failure the scheduler retries once after 60s; it never appends a null location.
3. The fix `{lat, lng, timestamp}` is appended to **your local Hypercore** (in the main process), and a `self` push tells the renderer to move your blue pin.
4. Because your contacts are already **replicating** your core (over the pair-wise swarm connection), the new block flows to them automatically. No push server, no message broker.

### Receiving (a contact → you)

1. For each contact you hold their core's **discovery key** (exchanged in the handshake).
2. You replicate their core over the shared swarm connection (main process).
3. Every ~10s the main process checks `core.length`; when it grows it reads the latest block (`core.get(core.length - 1)`), updates the contact's `lastSeenTs`, and pushes `contact:update` to the renderer.
4. The renderer's **staleness** module classifies the entry against *their* interval and the **globe** adds/updates/removes the pin.

---

## Rendering: user-selectable 2D maps

The desktop build ships **2D canvas maps by default, with the 3D WebGL globe opt-in** (`#10`). `src/renderer.js` reads the user's chosen style from `src/map-styles.js` and builds either `src/globe-renderer.js` (globe styles, via `globe.gl` + `three`) or `src/map2d.js` (map styles), falling back to the 2D Map if WebGL is unavailable or the globe fails to build. Both renderers expose the same fixed interface (`setSelf`, `upsertContactPin`, `removeContactPin`, `hasPin`, `setPinScale`, `setGrayscale`, `setColored`, `setArcs`, `centerOn`, `resize`, `globe`, `webgl`), so `src/main.js` needs no changes and the rest of the app (contacts, settings, P2P) works regardless of style. `centerOn(lat,lng)` pans the map/globe so a clicked contact is centered. The globe derives its surface from the same bundled Natural Earth data + Blue Marble texture (zero telemetry).

Three styles are available (picked in **Settings → Map style**; persisted in localStorage, applied on reload):

- **Map** — equirectangular centered on Taiwan (~121°E, ~23.5°N); the default.
- **Map — Centered on Me** — equirectangular re-centered on your current check-in (`rotate([-lng, -lat])`), so the map pivots on your location whenever you check in.
- **Map — Dymaxion** — Buckminster Fuller's Airocean ("Dymaxion") projection via `d3-geo-polygon`'s `geoAirocean`.

All projections come from `d3-geo`/`d3-geo-polygon`. The world outline is the bundled **Natural Earth 110m countries** GeoJSON (`src/assets/world.js`, public domain) drawn on a 2D canvas, with the same blue self-pin, green/gray contact pins, dotted arcs, and click hit-testing (~10 px radius). Drag-pan, pinch, and wheel-zoom are supported via `projection.invert` (the geographic point under the cursor stays fixed while zooming).

**Colored countries toggle.** A live button on the Check-In Beacon tile fills each country with its own hue in every projection. The palette lives in `src/country-colors.js` (hue hashed from the feature index — stable across sessions), the flag persists under the `coloredCountries` localStorage key, and the renderer's `setColored()` swaps the fill per frame without a rebuild or reload. On the Android build the same toggle colors the 3D globe too.

**QR code sharing and scanning.** The `QR` button next to your public key renders it as a scannable QR code using the bundled `qrcode` library (`QRCode.toCanvas` — fully local, no network), with the key text underneath for manual copy. **Add Contact** has a **Scan QR code** button that opens the camera via `getUserMedia` (back-facing `facingMode: 'environment'`), decodes frames on-device with the bundled `jsqr` library (`src/scanner.js`), and fills the public-key field automatically. Both directions are fully local — the camera stream never leaves the device and no third party is involved. The desktop (Pear/Electron) renderer grants media requests by default; Android's Capacitor WebView grants `VIDEO_CAPTURE` when the app holds the `CAMERA` permission (declared in the manifest, OS-prompted on first use).

**Performance:** the landmass + graticule are rendered once per fit as resolution-independent `Path2D` objects and then blitted through the zoom/pan affine transform each frame. Colored mode keeps a per-country `Path2D` array from the same fit. This avoids re-projecting all 177 countries every frame (especially expensive for Dymaxion, where each polygon is clipped into many pieces). If a WebView lacks `Path2D`, the renderer degrades to per-frame re-projection.

**Rendering is fully offline / zero-telemetry.** The world outline is a bundled file; all three projections are pure math over that data, and the QR code is generated locally. There are **no map-tile servers, no CDN calls, no third-party requests** for rendering — OSM-style tiles were rejected precisely because every tile fetch is a telemetry leak (a remote server learns when and where you look).

---

## Safety numbers & location precision

**Key fingerprint (`src/fingerprint.js`).** Purely renderer-local and offline: a self-contained SHA-256 of the contact's decoded `publicKeyB64` yields a 4-word pair drawn from a fixed 256-word list. Because it is a pure function of the key (no network, no state), it is unit-testable, deterministic across restarts, and identical on both peers' apps. `publicKeyB64` already reaches the renderer via `toRendererContact` (which strips only `logKeyHex`/`coreKeyHex`), so no main-process change was needed. Shown in the contacts list, on the pin overlay (non-self pins), and live in the Add Contact modal. (The 4×256-word format is inherently a 32-bit signature; SHA-256 derivation keeps the mapping opaque.)

**Location precision (`src/main/precision.js`).** Lives in the **main process** so it can snap the actual appended coordinates. `snapCoords(lat, lng, km)` places the point on a `km/111` grid (1° ≈ 111 km), scaling the longitude step by `cos(lat)` so the grid stays roughly square on the surface, then clamps the result back into `lat ∈ [-90,90]` / `lng ∈ [-180,180]` so a check-in near a pole or the anti-meridian never stores an invalid coordinate; `0` (or non-finite) passes coordinates through unchanged. `doCheckin` applies it before `appendCheckin`, which covers both **scheduled** and **manual** check-ins. The renderer sets it via the `precision:set` pipe message (validated against 0/5/10/25/50) and receives the current value in the `boot` response.

---

## Log-key rotation (forward secrecy)

Each user's local core blocks are encrypted with their symmetric **log key** (XSalsa20-Poly1305, `crypto.encrypt`/`decrypt`). The log key lives in `identity.json` alongside a windowed history `logKeyHistory` (last 3 `{coreGeneration → key}` entries, newest first).

- `rotateIdentityLogKey(identity, gen)` (`identity.js`) generates a fresh key, pushes the current one into the history (trimmed to 3), and persists it.
- `app.rotateCore(rotateLogKey)` — the normal MAX_ENTRIES core rotation passes `true`, so the log key is rotated together with the core. A fresh core generation is opened (encrypted with the new key) and the new key is re-sealed to contacts over the handshake: `swarm.refreshHello()` (new core key) + `swarm.refreshLogKey()` (new log key on live conns, via a stored per-conn peer enc-pub key).
- `readLatest` accepts an array of candidate keys, so the current key plus the retained history can decrypt a core across a rotation boundary. Old generations' blocks stay readable only while their key is retained, then drop.
- Dev-panel **Rotate log key** exercises it on demand (`dev:rotate-logkey`).

## At-rest passphrase encryption

Opt-in protection for the JSON stores `identity.json` / `contacts.json` / `settings.json` (`src/main/fsx.js`):

- **KDF:** `deriveAtRestKey(passphrase, salt)` = salted **BLAKE2b-256** `crypto_generichash` (Node 12/NodeJS-Mobile lacks `crypto.hkdf`, and libsodium exposes BLAKE2b rather than HMAC-SHA256; sound for a salted KDF). The salt is a random 16 bytes stored in the plaintext marker `data/atrest.json`.
- **Cipher:** each file is written as an envelope `{ v:1, data }` where `data` is `encrypt(JSON, key)` — XSalsa20-Poly1305 with an embedded nonce. `fsx.readJson`/`writeJson` transparently encrypt/decrypt the three store files when at-rest encryption is enabled and a key is set; `readJsonPlain`/`writeJsonPlain` are used only for the enable/disable migration.
- **Boot/unlock flow (`app.js`):** at boot, if the marker says encryption is on, the main process stays **locked** (it doesn't touch the encrypted stores). The renderer shows an unlock modal and sends `passphrase:unlock`; the main process derives the key, verifies it by reading `identity.json`, then runs `initialize()`. The passphrase crosses the pipe once and is never persisted.
- **Messages:** `passphrase:set` (enable: derive a fresh salt+key, re-encrypt all three stores, write the marker), `passphrase:unlock` (boot), `passphrase:disable` (verify passphrase, decrypt stores back to plaintext, clear the marker). A wrong passphrase fails AEAD auth and is reported as "Wrong passphrase". Forgotten passphrase = unrecoverable data (documented in the UI).

---

## Reliability: discovery tuning + reconnect

**DHT discovery (#5).** Hyperswarm's constructor accepts a `bootstrap` list; `app.js` reads `ICHNAEA_BOOTSTRAP` (comma-separated `host:port`) to point at known/faster bootstrap nodes when set, defaulting to the built-in ones otherwise. Contact-topic joins at boot are now **parallel** (`Promise.all` over `joinContact`) so slow discovery on one topic never blocks the rest. First-verified-connection latency is logged (`[dht] first verified connection in <ms>ms`) for profiling, and the renderer's peer-status line surfaces the **connecting** state (`Connecting to contacts…`) so slow discovery is visible, not silent. Bootstrap nodes can be overridden per the "sharp edges" note without touching defaults.

**Reconnect (#6).** 
- **Android:** the WebSocket client uses exponential backoff (`src/backoff.js`: 2s → 4s → … capped at 30s) instead of a fixed 2s retry, resetting on a successful connection.
- **Desktop:** on pipe close the main process (`index.js`) delays `Pear.exit()` by 30s so a transient renderer restart doesn't tear down the P2P stack; the renderer disables pear-pipe auto-exit, surfaces `Reconnecting…`, and reloads itself with backoff (1s → … → 30s) so it re-attaches to the still-alive main. Desktop GUI cannot be live-verified on this box (Pear runtime issue), so that path is covered by the shared backoff unit tests + code review pending a working desktop runtime.

---

## Check-in history & NEW badges

- **History (#8):** `corelog.readHistory(core, logKey, n)` pages the last `n` decrypted entries (oldest→newest, same key-fallback as `readLatest`). A `contact:history` pipe message returns them from the contact's replicated core (`state.contactCores`). Tapping a contact row opens a history panel in the renderer.
- **NEW badges (#8):** the renderer keeps an unread set (`unreadIds`) persisted in `localStorage` (`ichnaea-seen`) alongside a `lastOpenTs`. At boot, contacts whose `lastSeenTs > lastOpen` are badged (they checked in while the app was closed); a live `contact:update` with `lastSeenTs > bootTs` badges too. Viewing a contact's history clears the badge. Contacts are matched by `id` (their public-key hex).
- **Self-name at pin (#11):** `showPinOverlay` renders `state.selfName || 'You'` for the user's own pin.

---

## Offline check-in queue (#12)

When a check-in fires (`doCheckin`) while no contact is connected (`swarm.state().verified === 0`), the entry is recorded in `data/pending.json` (`src/main/pending.js`, capped at 100, deduped by timestamp). The entry is **also** appended to the local core at check-in time, so nothing is lost locally and replication delivers it once a peer connects — the queue is the visibility + sync signal, not the source of truth. The boot response carries `pendingCount`; a `pending` push updates the renderer's status line ("N check-ins queued (offline)", or a transient "Synced N offline check-ins" when `onPeerVerified` clears the queue).

---

## City search (no-GPS fallback)

When **Broadcast coordinates** finds no GPS fix, the "No GPS fix" modal now offers a **city search** alongside manual lat/lng entry. `src/cities.js` (renderer-safe) lazy-loads a compact GeoNames **cities5000** dataset (`src/assets/cities-data.txt`, ~68k cities, 2.4 MB) on first search and finds cities by name / ASCII name, ranking by population (dataset is pre-sorted by population desc, so a scan returns the most populous matches first). The data file is a **separate fetched asset**, not part of the JS bundle, so it only downloads when the search is actually used; it's regenerated from `cities5000.txt` by `scripts/build-cities.mjs`. A picked city fills the lat/lng fields, which then broadcast via the normal manual check-in path.

---

## Quiet-contact notifications (#9)

Local-only alerts when a contact goes stale/offline. The renderer's 30s staleness sweep tracks each contact's last status (`quietNotified` map) and, on a transition **into** `stale` or `offline` (never on first sight), calls `notifyQuiet(contact)`. The payload is just "X went quiet — last check-in …" — **no coordinates**. On Android this posts via the native `IchnaeaNotifyPlugin` (`POST_NOTIFICATIONS`, requested once at boot; a notification channel is created for API 26+). On desktop/browser it uses the Web `Notification` API when available. A Settings toggle (**Notify when a contact goes quiet**, default on, stored in `localStorage`) disables it. Background reliability depends on the process/WebView staying alive; the Android foreground `NodeService` keeps the main process up.

---

## Why pair-wise swarm topics (not group secrets)

The naive design is a single "group secret" topic that all your contacts join. We rejected it:

- **A group secret is a single point of compromise.** Anyone who learns the one topic can lurk in the swarm and see *everyone's* metadata (who's online, when they check in). Rotate it and you have to re-distribute it to the whole group.
- **It leaks the social graph.** Every member of the group swarm can enumerate the other members.
- **It over-shares.** You might want to share with Alice and Bob without Alice and Bob ever knowing the other is in your circle.

Instead, each ordered pair of users derives a **deterministic 32-byte topic**:

```
topic = blake2b( sort([Alice_pub, Bob_pub]).join('|') + '|beacon' )
```

Properties:

- **Only the two of you can compute it.** It needs both public keys; a third party can't derive or guess it.
- **Deterministic.** No exchange or storage of a per-pair secret — both sides independently arrive at the same topic.
- **Symmetric.** `sort()` means Alice and Bob compute the *same* topic regardless of who derived it.
- **Private channel.** The resulting swarm contains exactly two peers, giving a direct P2P channel per relationship.

The trade-off is `O(n)` topics and connections for `n` contacts instead of one — entirely acceptable for a personal check-in app with a handful of contacts, and a big win for privacy.

---

## Identity & the handshake

- Your keypair is generated once and the **secret key never leaves the device**.
- When two peers connect on their pair-wise topic, they run a small handshake: each sends `{ publicKey, intervalMs, coreKey, encPubKey }`.
- Each side **verifies the remote public key equals the pasted contact key**. If it doesn't match, the connection is destroyed — a basic guard against a man-in-the-middle who somehow landed in the topic.
- The handshake is also how each side learns the other's **broadcast interval** (for staleness) and **current core key** (so core rotation can be picked up).
- The handshake also carries the **end-to-end log-key exchange** (see Encryption below): each hello includes the sender's X25519 "log encryption" public key (`encPubKey`), and once a peer is verified each side sends a sealed box containing its own symmetric log key, sealed to the peer's `encPubKey`. Each side opens the other's box with its own log-encryption secret key.

## Encryption

Location payloads are **end-to-end encrypted** as of the E2E encryption change:

- Each user holds a persistent **X25519 log-encryption keypair** and a **32-byte symmetric log key** (both stored in `identity.json`, backfilled on upgrade).
- Every block a user appends to their **own** local core is encrypted with their log key (`sodium.crypto_secretbox`, nonce-prepended, in `src/crypto.js`); `src/main/corelog.js` encrypts on `appendCheckin` and decrypts in `readLatest` (which also falls back to plaintext for legacy blocks).
- The log key is shared per-contact during the handshake as a **sealed box** (`crypto_box_seal`) to the contact's X25519 public key, so only that contact can open it. The recovered key is stored in the contact record (`logKeyHex`) and used to decrypt the contact's replicated core.
- Backward compatible: old plaintext blocks still read (via the fallback), and identities created before this change are backfilled with a new log key + keypair on next launch.

> **Known limitation:** the log key is static (no rotation), so it behaves like a long-lived shared secret — see `SECURITY.md` risk #4.

**Transport note:** the Hyperswarm connection is a `@hyperswarm/secret-stream`. The app opens a single Protomux over it (stored at the stream's `userData`) and shares it between the `ichnaea-handshake` channel (hello + sealed-box log-key exchange) and Hypercore replication (`core.replicate(mux)`). Each side also serves its own local core on the connection (`serveLocalCore`), so a contact's RAM copy can pull your check-ins. This multiplexing is what makes two-way live sync work; previously the raw newline-JSON handshake and Hypercore's protocol corrupted each other on the shared stream.

---

## Storage

- **The filesystem** (under `data/` in the project cwd) holds the identity (`identity.json`), the contacts list (`contacts.json`), settings (`settings.json`: interval, core-rotation generation, manual-GPS override), and your local Hypercore blocks (`cores/`). All of this lives in the **main process**, which has no IndexedDB — so the old IndexedDB stores moved to JSON files / filesystem Hypercore storage. File access uses `bare-fs`/`bare-path` under Bare with a fallback to Node's `fs`/`path` (`src/main/fsx.js`).
- **Hypercore is pinned to v10.** v10 accepts a **directory path** for filesystem RAF storage — `new Hypercore(dir, { keyPair, createIfMissing: true })` — which is what `src/main/corelog.js` uses for the local core (verified: append + reopen + read). v11 moved to a Corestore/RocksDB model we don't want. The old browser-side `src/idb-storage.js` (RAS@3 over IndexedDB) is no longer used by the live app; it remains only because the contacts unit test exercises the IndexedDB modules.
- **Contact cores are kept in RAM** (`random-access-memory`) and re-replicated on reconnect. This avoids unbounded disk growth from peers' data; the trade-off is that a contact's history isn't cached across restarts (their *last known* pin state is re-derived on reconnect).
- **Pruning:** Hypercore is append-only, so old blocks can't be deleted in place. When your local log exceeds 200 entries the app **rotates to a fresh core** (a new `data/cores/` generation directory) and re-shares the new core key on the next handshake. Contacts keep showing your last known pin until the new core replicates.
- **Renderer-side IndexedDB** (`src/db.js`, `src/contacts.js`) is kept intact only so the existing contacts unit test stays green; the live renderer no longer uses it — it asks the main process for contacts over the pipe.

---

## Encryption status

Location payloads are **end-to-end encrypted**. Each user encrypts their own Hypercore blocks with a persistent symmetric **log key** (`sodium.crypto_secretbox`), and shares that key per-contact during the handshake as a **sealed box** (`crypto_box_seal` to the contact's X25519 public key). Privacy therefore does **not** rest solely on the pair-wise topic being private — a third party who holds the discovery key still cannot read the blocks. `src/crypto.js` implements the primitives (`generateLogKey`, `generateLogEncryptionKeyPair`, `sealLogKey`/`openLogKey`, `encrypt`/`decrypt`).

**Limitations:** the log key is static (no rotation / forward secrecy); the out-of-band pairing is unverified (no safety-number UI). See `SECURITY.md` for the honest risk list, and note the open contact-core **replication delivery** issue above.

---

## The web → native path

The scheduler lives in the main process (`src/main/scheduler.js`) and fires on a plain `setTimeout` interval; only the GPS fix crosses the pipe to the renderer. A Capacitor/native build would replace the renderer's `navigator.geolocation` answer (and optionally drive the schedule from a native background job) without touching the append/replication logic. The old renderer-side web scheduler with its commented Capacitor skeleton is retained in `src/scheduler.js` for reference but is no longer used by the live app.

## Manual GPS override

The user can enter coordinates by hand (Settings → Manual location) to override GPS or to check in where there is no GPS. A one-off **"Check in here"** sends `checkin:manual` and appends directly (no GPS request). The **"Use manual location for scheduled check-ins"** toggle sends `manual:set`; the main process persists `{enabled, lat, lng}` in `data/settings.json` and its scheduler then short-circuits the `gps:request`, using the stored coords for every scheduled fire until the toggle is turned off. When the override is on, the renderer tags the GPS status line (e.g. `manual: 51.5,-0.12`).

## Contact naming (local nickname vs self-name)

Two separate names exist per contact, on purpose:

- **Local nickname** (`nickname`) — chosen by *you* when adding the contact or renaming them (long-press / right-click → `contact:rename`). It is **never sent to the peer** and the peer's check-ins never overwrite it. This is the "renaming" feature.
- **Self-name** (`lastName`) — the name *they* chose in **Settings → Your name**, carried inside each encrypted check-in entry (`corelog.appendCheckin` writes `{lat,lng,timestamp,name}`). On receive, the main process stores it via `contacts.setContactLastName` and the UI shows it as a hint when it differs from your local nickname. It's plaintext inside the already-encrypted log entry, so it travels only between the two paired peers.

The renderer always displays the local nickname first, with the peer's self-name as a tooltip/hint when they differ.
