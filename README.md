# Ichnaea v2 — Periodic Check-In Beacon

A privacy-first, peer-to-peer location check-in app built on **Pear / Holepunch**. You broadcast your GPS position at a low, user-defined frequency to a small set of explicitly-approved contacts — and only to them. Contacts render as pins on a **2D map** with a user-selectable projection.

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
- **User-selectable 2D maps:** pick a projection in **Settings → Map style** — **Map** (equirectangular, Taiwan-centered), **Map — Centered on Me** (re-centers on your check-in), or **Map — Dymaxion** (Fuller's Airocean projection). All rendering uses the bundled Natural Earth world outline — **no map tiles, no CDN, zero third-party requests**.
- **Colored countries toggle:** a live button on the Check-In Beacon tile (`Colored countries` On/Off) fills each country with its own hue in every map projection. Persisted, applied at boot, toggles in place — no reload needed.
- **QR code sharing:** the `QR` button next to your public key renders it as a scannable QR code (local `qrcode` lib — no network), plus the key text for manual copy. A friend scans it into Ichnaea's "Add Contact" to pair.

---

## Requirements (all operating systems)

Ichnaea runs as a **desktop app from source** via the Pear runtime. There is no double-click `.exe`/`.app` installer yet — everyone needs these two things installed:

1. **Node.js LTS** (18 or newer), which includes `npm`
2. The **Pear** runtime

> **Important:** both you **and** the person you want to pair with must each install and run Ichnaea, then swap public keys (see [The "Add Contact" workflow](#the-add-contact-workflow)). Both sides must add each other.

---

## Install & run — step by step

### Step 1: Install Node.js LTS

**Windows (PowerShell):**
1. Go to <https://nodejs.org> and download the **Windows Installer (.msi)** for the latest LTS.
2. Run it. Accept the defaults (this installs `node` and `npm`).
3. Open **PowerShell** (Start → type `powershell`) and verify:
   ```powershell
   node --version
   npm --version
   ```
   Both should print a version number.

**macOS:**
1. Go to <https://nodejs.org> and download the **macOS Installer (.pkg)** for the latest LTS.
2. Run it and follow the prompts.
3. Open **Terminal** (Spotlight → `Terminal`) and verify:
   ```bash
   node --version
   npm --version
   ```

**Linux (Ubuntu/Debian example):**
1. Open a terminal and run:
   ```bash
   sudo apt update
   curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
   sudo apt install -y nodejs
   ```
   (Or install via [nvm](https://github.com/nvm-sh/nvm#installing-and-updating) if you prefer.)
2. Verify:
   ```bash
   node --version
   npm --version
   ```

### Step 2: Install the Pear runtime

Open a terminal (PowerShell on Windows, Terminal on macOS/Linux) and run:

```bash
npm install -g pear
```

Verify:

```bash
pear --help
```

### Step 3: Get the Ichnaea code

**Option A — clone with git** (requires `git`):

```bash
git clone https://github.com/aquamammal/ichnaea-v2.git
cd ichnaea-v2
```

**Option B — download a ZIP:**
1. Go to <https://github.com/aquamammal/ichnaea-v2>
2. Click **Code → Download ZIP**
3. Unzip it and `cd` into the `ichnaea-v2` folder.

> **⚠️ Windows — folder path must NOT contain spaces.** Pear fails with `ERR_INVALID_PROJECT_DIR` if the path has spaces. Put the folder somewhere like `C:\dev\ichnaea-v2` (no spaces in any parent folder either). On macOS/Linux any normal path is fine.

### Step 4: Install dependencies

```bash
npm install
```

### Step 5: Run Ichnaea

```bash
npm run dev
```

A Pear desktop window opens showing the world map and the control panels.

### Step 6: Run the tests (optional)

```bash
npm test
```

---

## Operating-system notes

### Windows
- **Installers:** use the `.msi` from nodejs.org. In PowerShell, `npm install -g pear` and `npm run dev` work as written above.
- **No-spaces path:** critical — see Step 3.
- **Maps:** the app uses **2D canvas maps** (user-selectable projection) — no WebGL needed, so it works on every machine.
- **Firewall:** the first time you run it, Windows may ask to allow network access (needed for peer-to-peer connections). Allow it.

### macOS
- **Installers:** use the `.pkg` from nodejs.org.
- **Maps:** the app uses **2D canvas maps** (user-selectable projection) — no WebGL needed.
- **Privacy/Location:** macOS may prompt for location permission the first time GPS is used — allow it if you want real check-ins.

### Linux
- **Node:** use the NodeSource instructions above, or `nvm`.
- **Maps:** the app uses **2D canvas maps** (user-selectable projection) — no WebGL or GPU needed, so it works on every machine.
- **Location:** `navigator.geolocation` may report unavailable on some desktop Linux setups; use **Settings → Manual location** to check in without GPS (see below).

---

## Pairing two machines (the actual "use it with a friend" step)

1. Both of you run the app. Your **Base64 public key** is shown in the **top-left panel** (click it to copy).
2. Swap keys through any channel you trust (Signal, email, in person).
3. Each of you clicks **Add Contact**, pastes the *other's* key, and gives it a nickname.
4. **Both sides must add each other** — the pair-wise topic needs both keys, so a one-sided add will not connect.
5. Same LAN connects fast. Over the internet, Hyperswarm uses a DHT and may take **10–30 seconds** to find each other. When someone checks in, the pin appears on the other's map.

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
- **Removed** — no update for `4×` their interval (assumed offline; pin is taken off the map).

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
│  ├─ index.html         # map (100vh) + control panels + modals + dev panel (renderer)
│  ├─ main.js            # renderer: thin pipe client + map/UI controller + geolocation
│  ├─ staleness.js       # active/stale/offline classification + time humanizing (renderer)
│  ├─ map-styles.js      # user-selectable map-style registry + persistence (renderer)
│  ├─ renderer.js        # map-style dispatcher -> builds the 2D renderer (renderer)
│  ├─ map2d.js           # 2D canvas map: equirectangular / self-centered / Dymaxion projections
│  ├─ country-colors.js  # shared per-country color palette (colored-countries mode)
│  ├─ assets/            # bundled rendering assets (zero telemetry: no tiles, no CDN)
│  │  └─ ne_110m_admin_0_countries.geojson  # Natural Earth 110m world outline (public domain)
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
> `staleness.js`, and the map renderer modules. `d3-geo` + `d3-geo-polygon` power the map
> projections; `qrcode` generates the public-key QR code locally.

## License

Apache-2.0
