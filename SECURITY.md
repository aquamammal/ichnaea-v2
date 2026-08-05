# SECURITY — Ichnaea v2

An honest assessment of the current security posture. This is an **MVP**; several protections are deliberately deferred and listed here so nobody mistakes the current build for hardened software.

---

## What protects you today

- **Pair-wise topics.** Each contact relationship uses a unique Hyperswarm topic derived from *both* public keys (`blake2b(sort([pubA,pubB]).join('|') + '|beacon')`). A third party cannot derive or guess it, so they can't join the swarm that carries your location log.
- **Handshake identity check.** On every connection both peers exchange public keys and each verifies the remote key matches the pasted contact key. A mismatch destroys the connection.
- **End-to-end log encryption.** Each user holds a 32-byte symmetric **log key** (persisted in `identity.json`) that encrypts every block of their own Hypercore. The log key is shared per-contact during the handshake as a **sealed box** (X25519 `crypto_box_seal`) to the contact's X25519 public key, so only that contact's secret key can open it. Location history — including the optional self-chosen display name sent with each check-in — is therefore unreadable to anyone who only holds the core's discovery key (see risk #1). Local contact nicknames never leave the device. `src/crypto.js` implements the primitives; `src/main/corelog.js` encrypts on append and decrypts on read.
- **Local-only secret key.** Your Ed25519 secret key is generated on-device and never transmitted or displayed.
- **Safety-number fingerprint verification.** Every contact shows a short 4-word fingerprint (`src/fingerprint.js`) derived purely from their Base64 public key — in the contacts list, on the pin overlay, and live in the Add Contact modal before you save. You can read it over a second, independent channel to confirm the key you pasted is really your friend's, catching a substituted key during the out-of-band exchange (see risk #2).
- **Optional location precision reduction.** Settings → **Location precision** lets you snap your broadcast coordinates onto a ~5/10/25/50 km grid (`src/main/precision.js`), applied in `doCheckin` so both scheduled and manual check-ins are coarsened. Off shares your exact position (see risk #6).
- **No servers, no telemetry.** There is no central service to breach or to log your movements. Data flows directly between the two peers.
- **Offline rendering, zero third-party requests.** The map is drawn from the bundled Natural Earth world outline (`src/assets/world.js`) via local `d3-geo` projections — equirectangular, self-centered, or Dymaxion. The colored-countries toggle uses the same local data, and the public-key QR code is generated and scanned locally (`qrcode` for display, `jsqr` + `getUserMedia` for camera scanning — the stream never leaves the device). There are **no map-tile servers, no CDN, no third-party requests** involved, so no remote service learns when or where you look.
- **The only outbound request is the manual update check.** **Settings → Check for updates** fetches the app's GitHub `releases/latest` — but only when the user taps it. There is no traffic on boot or in the background; disabling the check is as simple as never tapping it. Everything else (P2P replication, rendering, QR, GPS) is peer-to-peer or local.

---

## Current risks (read these)

### 1. Location history is encrypted at rest and in transit to contacts
Your check-ins are appended to your Hypercore encrypted with your log key, and your log key is delivered to each contact only through a sealed box. If a third party obtains the core's discovery key, they still cannot read the blocks (they lack the log key). 
- **Status:** mitigated as of the E2E encryption change.
- **Remaining caveat:** the log key is a **static** per-identity secret (no rotation yet), so it behaves like a long-lived symmetric secret — a device compromise exposes the key and therefore past and future history until it is rotated. See risk #4.

### 2. MITM is only *partially* mitigated
The handshake verifies the remote public key matches the pasted key. This stops a naive attacker who lands in the topic. But the whole scheme's trust anchor is the **out-of-band key exchange**: if an attacker intercepts that first exchange (e.g. compromises the email/thread where you swapped keys) and substitutes *their* key, you'll add the attacker as a "contact" and the handshake will happily verify against the wrong key.
- **Status:** mitigated with UI — a **safety-number fingerprint** (`src/fingerprint.js`) is shown for every contact (contacts list, pin overlay, and live in the Add Contact modal) so you can compare it over a second, independent channel *before* sharing real location. The fingerprint is derived purely from the pasted key, so a substituted key yields a visibly different word pair.
- **Remaining caveat:** the fingerprint is only as trustworthy as the user's discipline — they must actually verify it out-of-band for it to protect them. It does not protect a user who skips verification.

### 3. Relay / DHT dependency & metadata exposure
Hyperswarm discovers peers via a **DHT** and may route through **relay/holepunch servers** when a direct connection isn't possible.
- The DHT sees that *some* peer announced/looked up a given topic. Because topics are pair-wise and content-free, an observer learns little directly, but **topic lookups + timing + IP addresses** can leak that two endpoints are communicating, and roughly when.
- A malicious or logging **relay** sees ciphertext-in-transit metadata (connection timing, sizes, IPs), though not your location payload contents (those are encrypted and gated by the log key).
- **Status:** inherent to the Holepunch transport in this MVP.
- **Recommendation:** for higher-threat users, run over Tor/VPN, and treat connection *metadata* as visible even though *contents* are not.

### 4. Static log key — no rotation / no forward secrecy
The log key is a single persistent per-identity secret. A compromised device exposes the current key (and its past history, since it never changes) until the key is rotated by hand.
- **Status:** accepted MVP limitation.
- **Recommendation:** add log-key rotation and re-share the new key over the handshake on the next reconnect (the sealed-box exchange already supports re-negotiation per connection). A Double-Ratchet-style scheme would be stronger still.

### 5. Local data at rest is unencrypted
Your secret key, contacts, and location log are stored **on the filesystem** (under `data/` in the project directory: `identity.json`, `contacts.json`, `settings.json`, and the Hypercore `cores/`). The location *blocks* are encrypted, but the log key that unlocks them lives in the same directory, so anyone with read access to your unlocked device/profile — or who can read that directory — can read your history.
- **Recommendation:** rely on full-disk encryption and OS account security. A future option could encrypt the at-rest records (including the log key) with a passphrase-derived key.

### 6. Geolocation accuracy is a privacy dial
Check-ins share whatever precision the GPS returns. For some users a coarse location is safer.
- **Status:** shipped — Settings → **Location precision** snaps coordinates onto a ~5/10/25/50 km grid (`src/main/precision.js`) before they're appended, covering both scheduled and manual check-ins. "Off" keeps your exact position.
- **Remaining caveat:** the grid is approximate and a determined observer with enough coarse samples can still narrow your location; coarse snap raises the effort, it does not anonymize.

---

## Hardening roadmap (priority order)

1. ~~Fix contact-core replication over the shared connection~~ — **DONE.** The newline-JSON handshake and Hypercore's noise/protomux replication previously shared one Hyperswarm connection and corrupted each other (contact cores were never delivered). Now the JSON handshake rides on an `ichnaea-handshake` protomux channel, and replication attaches to the **same** Protomux (see `ARCHITECTURE.md`); each side also serves its own local core so contacts can pull check-ins. Verified with a two-instance live test (both peers exchanged keys and decrypted each other's check-ins).
2. ~~Safety-number / fingerprint verification UI~~ — **DONE.** `src/fingerprint.js` derives a 4-word fingerprint from a contact's key, shown in the contacts list, pin overlay, and live in the Add Contact modal (removes risk #2).
3. **Log-key rotation per reconnect** (addresses #4), re-shared via the existing sealed-box handshake.
4. ~~Optional location precision reduction~~ — **DONE.** `src/main/precision.js` snaps check-in coordinates onto a ~5/10/25/50 km grid when the user opts in (addresses #6).
5. **Optional at-rest encryption** of the local data files and the log key (addresses #5).
6. Document/relay-hardening guidance for metadata-sensitive users (addresses #3).

---

## Responsible note

Do not rely on this MVP in a situation where exposure of your location history or your contact graph would put you at risk. The pair-wise design plus end-to-end log encryption meaningfully reduces casual exposure, but the static log key, the unverified out-of-band pairing, and the pending replication fix mean you should treat the contents as **best-effort private, not guaranteed confidential**.
