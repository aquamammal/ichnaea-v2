# Ichnaea v2 — Periodic Check-In Beacon

A privacy-first, peer-to-peer location check-in app built on **Pear / Holepunch**. You broadcast your GPS position at a low, user-defined frequency to a small set of explicitly-approved contacts — and only to them. Contacts render as pins on a **2D map** with a user-selectable projection.

**Zero telemetry. No central servers. No group secrets.**

---

## What it does

- Generates an **Ed25519 keypair** on first launch (stored only on your device, on the filesystem under `data/`).
- Lets you add contacts by pasting their **Base64 public key** (shared out-of-band: email, QR, a website, in person).
- Derives a **unique pair-wise swarm topic** for each contact so only the two of you ever meet in that swarm.
- Broadcasts your GPS location on a **configurable schedule** (default: once per day).
- Optional **manual location / city search**: tap **Broadcast coordinates** and choose **Manual** to enter coordinates by hand or search a city — useful when GPS is unavailable. No settings needed.
- Replicates each contact's **Hypercore** append-only log and renders their last check-in as a pin on the map.
- Colors pins by freshness: **green = active**, **gray = stale**, and removes pins that go silent too long.
- **User-selectable 2D maps:** pick a projection in **Settings → Map style** — **Map** (equirectangular, Taiwan-centered), **Map — Centered on Me** (re-centers on your check-in), or **Map — Dymaxion** (Fuller's Airocean projection). All rendering uses the bundled Natural Earth world outline — **no map tiles, no CDN, zero third-party requests**.
- **Colored countries toggle:** a live button on the Check-In Beacon tile (`Colored countries` On/Off) fills each country with its own hue in every map projection. Persisted, applied at boot, toggles in place — no reload needed.
- **QR code sharing:** the `QR` button next to your public key renders it as a scannable QR code (local `qrcode` lib — no network), plus the key text for manual copy.
- **QR code scanning:** **Add Contact** has a **Scan QR code** button that opens the camera and decodes a friend's on-screen QR on-device (local `jsqr` lib — zero telemetry), filling the public-key field automatically. Requires **camera permission** (your OS prompts on first use).
- **Safety-number fingerprint verification:** every contact shows a short **4-word fingerprint** (`src/fingerprint.js`) — in the contacts list, on the pin overlay, and **live in the Add Contact modal** as you type/scan a key. It's derived purely from the contact's public key, so you can compare it with your friend over a second, independent channel *before* sharing real location to confirm you added the right person.
- **Location precision dial:** **Settings → Location precision** snaps your broadcast coordinates onto a **~5 / 10 / 25 / 50 km grid** (Off = exact position). Applied to both scheduled and manual check-ins, so you can share only an approximate area.
- **Log-key rotation (forward secrecy):** your symmetric log key is rotated on every log rotation and re-shared with contacts over the handshake; a short windowed history is kept then dropped, so a device compromise exposes at most recent history.
- **Encrypt local data:** **Settings → Encrypt local data** protects `identity.json`, `contacts.json`, and `settings.json` with a passphrase. On launch the app asks you to unlock. A forgotten passphrase means unrecoverable data.
- **Reliability:** contact discovery runs in parallel at startup; the peer-status line shows **Connecting to contacts…** while discovery is in progress; and both platforms auto-reconnect with exponential backoff (capped at 30s) if the connection drops. Optionally point the DHT at known bootstrap nodes via the `ICHNAEA_BOOTSTRAP` env var.
- **Check-in history & NEW badges:** tap a contact in the list to open their **recent check-in history** (times + coordinates). Contacts that checked in since you last opened the app get a **NEW** badge, cleared when you view their history.
- **Your name at your pin:** tapping your own pin shows your self-chosen name (Settings → Your name) instead of just "You".
- **City search (no-GPS fallback):** when **Broadcast coordinates** finds no GPS fix, the prompt now has a **city search** — type a city name and it fills in the coordinates (bundled GeoNames cities5000 dataset, ~68k cities, searched locally — zero telemetry). Manual lat/lng entry still works too.
- **Offline check-in queue:** if a check-in fires while no contact is connected, a status line shows **"N check-ins queued (offline)"**; once a contact connects, the check-ins sync via replication and the line briefly shows **"Synced N offline check-ins"**.
- **Quiet-contact notifications:** when a contact goes stale/offline, a **local-only** notification says "X went quiet — last check-in …" (no coordinates, nothing sent). Toggle it in **Settings → Notify when a contact goes quiet** (default on).
- **Rename contacts:** long-press a contact (or right-click on desktop) to rename them — local-only, never sent to the peer.
- **3D globe (opt-in):** Settings → Map style adds **Globe — Wireframe / Full Color / Colored Countries**. The 3D WebGL globe renders from the same bundled Earth data (zero telemetry) and falls back to the 2D Map if WebGL is unavailable.
- **Name yourself:** set **Settings → Your name** — it's sent with every check-in, so contacts see who you are. They can still rename you locally.
- **Click to center:** tap a contact in the list (or a pin on the map) to center the map on them.
- **Update check:** **Settings → Check for updates** fetches the latest **GitHub Release** for this repo and reports if a newer build exists. Manual and opt-in — no network on boot or in the background (preserves zero-telemetry).
- **Connecting-lines toggle:** a "Connecting lines" On/Off button on the Check-In Beacon tile shows/hides the dotted arcs from your pin to each contact.
- **Your broadcast frequency on the tile:** the beacon header reads **Ichnaea Ver. X.Y.Z**, and the tile shows your current frequency ("Broadcast: every 6 hours"). **Settings → Broadcast frequency** is a free choice of **minutes / hours / days**, not a fixed list.
- **"Broadcast coordinates"** button replaces the old "Check in now" label.

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

## Releasing (desktop)

The desktop update checker (`src/updates.js`, `REPO = aquamammal/ichnaea-v2`) reads the latest **GitHub Release tag** of this repo, so a release must exist for **Settings → Check for updates** to report "up to date". There is no single desktop artifact — the checker only needs the tag.

1. Bump `version` in `package.json` and `APP_VERSION` in `src/updates.js` to match.
2. Commit + push to `main`.
3. Publish a release tag (the token in `~/.git-credentials` authorizes as `aquamammal`):
   ```
   POST https://api.github.com/repos/aquamammal/ichnaea-v2/releases
   { "tag_name": "v0.2.6", "target_commitish": "main", "name": "...", "body": "..." }
   ```
   (or `gh release create v0.2.6 --title "..."`). Attach any distributable if desired; the tag alone satisfies the checker.

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
- **Location:** `navigator.geolocation` may report unavailable on some desktop Linux setups; tap **Broadcast coordinates → Manual** to check in without GPS (city search or typed coordinates).

---

## Pairing two machines (the actual "use it with a friend" step)

1. Both of you run the app. Your **Base64 public key** is shown in the **top-left panel** (click it to copy, or use the **QR** button to display it as a scannable code).
2. Swap keys through any channel you trust (Signal, email, in person — or have the friend scan your on-screen QR with Ichnaea's **Add Contact → Scan QR code**).
3. Each of you clicks **Add Contact**, pastes the *other's* key (or scans it), and gives it a nickname.
4. **Both sides must add each other** — the pair-wise topic needs both keys, so a one-sided add will not connect.
5. Same LAN connects fast. Over the internet, Hyperswarm uses a DHT and may take **10–30 seconds** to find each other. When someone checks in, the pin appears on the other's map.

---

## The "Add Contact" workflow

There is no account system and no server to look people up. Adding a contact is a manual, out-of-band exchange of public keys:

1. **You** open the app. Your Base64 public key is shown in the UI (top-left panel).
2. You send that key to your friend through any channel you already trust — email, Signal, in person, or the built-in **QR** button.
3. **Your friend** does the same and sends you *their* key.
4. In the app, click **Add Contact**, paste their Base64 public key (or click **Scan QR code** and point the camera at their on-screen QR), and give them a **local nickname** (only you see this).
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

### Broadcasting without GPS (Manual / city search)

Tap **Broadcast coordinates** and choose:

- **Use GPS** — get a normal GPS fix and broadcast. If there's no GPS, it says "No GPS available — use manual."
- **Manual** — enter coordinates by hand **or search a city** (bundled GeoNames cities5000 dataset, ~68k cities, searched locally — zero telemetry) to fill them in. Then **Broadcast**.

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
│  ├─ scanner.js         # camera QR scanner (getUserMedia + jsqr, on-device)
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
> projections; `qrcode` generates and `jsqr` decodes the public-key QR code — both fully
> local (no telemetry).

## License

Apache-2.0
