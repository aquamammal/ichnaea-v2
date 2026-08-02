# ARCHITECTURE — Ichnaea v2

A plain-English tour of how the app works, why it's built this way, and where the data flows.

---

## The one-sentence version

Each user keeps an **append-only Hypercore log** of their own GPS check-ins; for every contact, the two peers meet in a **unique, private Hyperswarm topic** derived from both of their public keys, replicate each other's logs, and render the latest entry as a pin on a 3D globe.

---

## The moving parts

| Piece | Role | Where |
|---|---|---|
| **Identity** | An Ed25519 keypair generated on first launch. The public key *is* your address. | `src/main/identity.js`, persisted on the **filesystem** (`data/identity.json`) |
| **Contacts** | The list of people you share with: their public key + a local nickname + their interval. | `src/main/contacts.js` (JSON file `data/contacts.json`) |
| **Pair-wise swarm** | One Hyperswarm; joins a unique topic per contact. Carries the handshake and replication streams. | `src/swarm.js` (main process) |
| **Local log** | Your own Hypercore. Each check-in appends `{lat,lng,timestamp}`. | `src/main/corelog.js` (filesystem storage under `data/cores/`) |
| **Scheduler** | Fires at your chosen interval, gets a fix, appends to your log. | `src/main/scheduler.js` (main process; GPS crosses the pipe) |
| **Settings** | Broadcast interval, core-rotation generation, manual-GPS override. | `src/main/settings.js` (JSON file `data/settings.json`) |
| **Main orchestrator** | Boots the P2P stack and routes pipe messages. | `src/main/app.js`, wired by `index.js` |
| **Staleness** | Decides active / stale / offline from a contact's last timestamp vs. their interval. | `src/staleness.js` (renderer) |
| **Globe** | Renders self + contact pins, arcs, and the click overlay. Picks **3D (WebGL)** or **2D (canvas)** at runtime. | `src/globe-renderer.js` (factory), `src/map2d.js` (2D fallback) — renderer |
| **Renderer client** | Renders the globe/UI, answers GPS requests, sends user actions. | `src/main.js` (renderer, thin pipe client) |

## Two processes, one pipe

The app is split across the two Pear processes, bridged by the **Pear pipe** (newline-free JSON frames via `pear-pipe`):

- The Pear **main process** (`index.js` + `src/main/*`) owns the **entire P2P stack**: identity, the local Hypercore, Hyperswarm, contact-core replication, the contacts store, and the broadcast scheduler. It persists everything on the **filesystem** under `data/`.
- The **renderer** (`src/main.js` + `src/staleness.js` + `src/globe-renderer.js`) owns only the **globe, the UI, and geolocation**. It is a thin client: it sends user actions to the main process as JSON pipe messages and re-renders on state pushes.

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

## Rendering: 3D globe with a 2D canvas fallback

`src/globe-renderer.js` is a **factory**: it probes for a WebGL context (pre-check + try/catch around `Globe()`) and returns either the **3D globe** (globe.gl/three.js) or, when WebGL is unavailable, the **2D canvas map** (`src/map2d.js`). Both expose the identical interface (`setSelf`, `upsertContactPin`, `removeContactPin`, `hasPin`, `resize`, `globe`, `webgl`), so `src/main.js` needs no changes and the rest of the app (contacts, settings, P2P) keeps working either way.

The 2D fallback draws a plain **equirectangular projection** (`x = (lng+180)/360·w`, `y = (90−lat)/180·h`) of the bundled **Natural Earth 110m countries** GeoJSON (`src/assets/`, public domain) on a 2D canvas, with the same blue self-pin, green/gray contact pins, dotted arcs, and click hit-testing (~10 px radius). Drag-pan and wheel-zoom are supported.

**Rendering is fully offline / zero-telemetry.** The world outline and the 3D earth texture (`src/assets/earth-blue-marble.jpg`) are bundled files served from the app's own directory over the Pear localhost bridge. There are **no map-tile servers, no CDN calls, no third-party requests** for rendering — OSM-style tiles were rejected precisely because every tile fetch is a telemetry leak (a remote server learns when and where you look).

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
>
> **Open issue:** contact-core **replication delivery** is currently broken — the newline-JSON handshake and Hypercore's noise/protomux replication share the same Hyperswarm connection, which corrupts the replication stream. The log-key *exchange* works live, but blocks are not delivered, so a contact's pin does not update end-to-end yet. This is a pre-existing issue (not introduced by the encryption change) and is the next blocker for any live two-party flow.

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
