# Ichnaea v2 — Periodic Check-In Beacon

A privacy-first, peer-to-peer location check-in app built on **Pear / Holepunch**. You broadcast your GPS position at a low, user-defined frequency to a small set of explicitly-approved contacts — and only to them. Contacts render as pins on a world map (2D canvas by default, optional 3D globe).

**Zero telemetry. No central servers. No group secrets.**

---

## What it does

- Generates an **Ed25519 keypair** on first launch (stored only on your device, on the filesystem under `data/`).
- Lets you add contacts by pasting their **Base64 public key** (shared out-of-band: email, QR, a website, in person).
- Derives a **unique pair-wise swarm topic** for each contact so only the two of you ever meet in that swarm.
- Broadcasts your GPS location on a **configurable schedule** (default: once per day).
- Optional **manual location override**: enter coordinates by hand to check in without GPS, or to make scheduled check-ins use a fixed location.
- Replicates each contact's **Hypercore** append-only log and renders their last check-in as a pin on the map.
- Colors pins by freshness: **green = active**, **gray = stale**, and removes pins that go silent too long.
- **2D canvas map by default:** contacts render as pins on a 2D world map drawn on a plain canvas — no WebGL required, so it works on every machine. A 3D WebGL globe is available as an opt-in (open the window with `?globe=3d`, or set `localStorage 'globe' = '3d'`); if WebGL context creation fails there, it falls back to 2D automatically. All rendering assets (Natural Earth world outline, earth texture) are **bundled locally** — no map tiles, no CDN, zero third-party requests.

---

## Requirements

- [Node.js](https://nodejs.org) and npm
- [Pear](https://pear.to) runtime (`npm i -g pear`)

## Install & run

```bash
npm install
npm run dev        # = pear run -d .
```

A Pear desktop window opens showing the globe and the control panels.

Run the unit tests:

```bash
npm test
```

---

## The "Add Contact" workflow

There is no account system and no server to look people up. Adding a contact is a manual, out-of-band exchange of public keys:

1. **You** open the app. Your Base64 public key is shown in the UI (top-left panel).
2. You send that key to your friend through any channel you already trust — email, Signal, a QR code, your personal website, read it out in person.
3. **Your friend** does the same and sends you *their* key.
4. In the app, click **Add Contact**, paste their Base64 public key, and give them a **local nickname** (only you see this).
5. The app derives a deterministic pair-wise topic from your two keys and joins it. When your friend does the same, you find each other directly, peer-to-peer.

Because the topic is derived from **both** public keys, only the two of you can ever compute it. There is no shared "group secret" to leak.

> Your **secret key never leaves your device** and is never shown. Only the public key is shared.

---

## Broadcast frequency

Open **Settings** to choose how often you check in:

- 1 Hour
- 6 Hours
- 12 Hours
- **1 Day (default)**
- 3 Days
- 1 Week

When the timer fires the app requests your GPS position once (geolocation runs in the renderer; the main process asks for a fix over the pipe), appends `{ lat, lng, timestamp }` to your local Hypercore, and makes it available to your connected contacts.

### Manual location override

Open **Settings → Manual location** to enter coordinates by hand:

- **Check in here** — append a one-off check-in at the entered lat/lng, skipping GPS entirely. Useful when there is no GPS or you want to report a specific spot.
- **Use manual location for scheduled check-ins** — when enabled, every scheduled check-in uses the stored manual coords instead of requesting a GPS fix. The setting (coords + flag) is persisted in the main process, so it survives reload. While it's on, the GPS status line shows `manual: lat,lng`.

Latitude must be −90..90 and longitude −180..180 (validated in the UI).

### Why the default is 1 day

GPS fixes and network replication cost battery and bandwidth. A daily check-in is enough for the core use case — "let the people I trust know roughly where I am, and that I'm okay" — while keeping power and data use negligible. Choose a faster interval only if you actually need it.

### Staleness

Because everyone can pick a different interval, freshness is judged **relative to each contact's own interval** (learned during the handshake):

- **Active (green)** — last check-in is within `2×` their interval.
- **Stale (gray)** — between `2×` and `4×` their interval.
- **Removed** — no update for `4×` their interval (assumed offline; pin is taken off the globe).

---

## The web limitation (important)

This is a **web MVP**. The broadcast timer only runs **while the app window is open** (or backgrounded). If you close the window, your check-ins stop.

- The timer uses `setTimeout`/`setInterval`, with a `document.visibilitychange` + `requestIdleCallback` wake-up check to catch up after the OS throttles a backgrounded tab.
- It **cannot** fire while the app is fully closed. A daily check-in therefore requires the app to be open at least once a day.

### The path to native mobile

The broadcast scheduler runs in the **main process** (`src/main/scheduler.js`) on a plain timer; only the GPS fix is fetched in the renderer (geolocation is browser-only) and returned over the pipe. A production mobile build would wrap the app in **Capacitor** and source the fix from native geolocation (and optionally drive the schedule from a native background job: iOS Background Fetch, Android WorkManager) without changing the append/replication logic in the main process.

---

## Privacy & security (MVP)

- **Pair-wise topics, not group secrets.** Each contact pair gets a unique, deterministic Hyperswarm topic derived from both public keys. Only the two of you can join it.
- **Handshake identity check.** On connect, both peers exchange public keys and each verifies the remote key matches the pasted contact key — a basic MITM guard.
- **End-to-end log encryption.** Location entries are encrypted with a per-user symmetric log key; the key is shared per-contact over the handshake as a sealed box (X25519) so only that contact can read your history — even if they hold the core's discovery key. See `SECURITY.md` for the honest risk list (static log key, unverified pairing) and `ARCHITECTURE.md` for the design.

Read `ARCHITECTURE.md` for the data flow and `SECURITY.md` for an honest threat assessment.

---

## Project layout

```
├─ index.js              # Pear main process: bridge + runtime + pipe server (owns the P2P stack)
├─ src/
│  ├─ index.html         # globe (100vh) + control panels + modals + dev panel (renderer)
│  ├─ main.js            # renderer: thin pipe client + globe/UI controller + geolocation
│  ├─ staleness.js       # active/stale/offline classification + time humanizing (renderer)
│  ├─ globe-renderer.js  # renderer factory: 2D canvas map (default) or 3D WebGL globe (opt-in)
│  ├─ map2d.js           # 2D canvas map: equirectangular projection, pins, arcs (renderer)
│  ├─ assets/            # bundled rendering assets (zero telemetry: no tiles, no CDN)
│  │  ├─ ne_110m_admin_0_countries.geojson  # Natural Earth 110m world outline (public domain)
│  │  └─ earth-blue-marble.jpg              # 3D globe surface texture (from three-globe)
│  ├─ crypto.js          # keygen, base64 keys, pair-topic derivation, X25519 log-key exchange + per-block AEAD (shared, pure)
│  ├─ swarm.js           # pair-wise Hyperswarm topics, handshake, connections (main process)
│  ├─ main/              # main-process-only modules (no browser APIs)
│  │  ├─ app.js          # P2P orchestrator: boots the stack, routes pipe messages
│  │  ├─ fsx.js          # bare-fs/bare-path with fs/path fallback + JSON helpers
│  │  ├─ identity.js     # keypair load/create, persisted to data/identity.json
│  │  ├─ contacts.js     # contacts store, persisted to data/contacts.json
│  │  ├─ settings.js     # interval + core generation + manual-GPS override (data/settings.json)
│  │  ├─ corelog.js      # local Hypercore (filesystem) + contact-core replication (RAM)
│  │  └─ scheduler.js    # broadcast timer; GPS crosses the pipe; manual-override short-circuit
│  ├─ db.js              # IndexedDB wrapper (kept for the contacts unit test only)
│  ├─ contacts.js        # IndexedDB contact CRUD (kept for the contacts unit test only)
│  ├─ idb-storage.js     # RAS@3 IndexedDB Hypercore backend (legacy; unused by the live app)
│  └─ scheduler.js       # old renderer web scheduler (legacy; unused by the live app)
├─ data/                 # runtime state (identity, contacts, settings, cores) — gitignored
└─ test/                 # brittle unit tests
```

> **Why two processes?** Hyperswarm/Hypercore need Node builtins (`events`, `streamx`)
> that the Pear renderer's module resolver does not provide to app code — importing them
> in the renderer crashed with `Cannot find package 'events'`. So the whole P2P stack lives
> in the **main process** (full Node/Bare builtins) and the renderer talks to it over the
> Pear pipe. Storage for the core, identity, and contacts is therefore the **filesystem**
> (`data/`), not IndexedDB.
>
> **Note on dependencies:** Hypercore is pinned to **v10**; v10 accepts a directory path
> for filesystem RAF storage (`new Hypercore(dir, { keyPair })`). Contact cores are kept in
> RAM. The renderer never imports hyperswarm/hypercore/random-access — only `pear-pipe`,
> `staleness.js`, and `globe-renderer.js`.

## License

Apache-2.0
