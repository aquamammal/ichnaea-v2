# SECURITY — Ichnaea v2

An honest assessment of the current security posture. This is an **MVP**; several protections are deliberately deferred and listed here so nobody mistakes the current build for hardened software.

---

## What protects you today

- **Pair-wise topics.** Each contact relationship uses a unique Hyperswarm topic derived from *both* public keys (`blake2b(sort([pubA,pubB]).join('|') + '|beacon')`). A third party cannot derive or guess it, so they can't join the swarm that carries your location log.
- **Handshake identity check.** On every connection both peers exchange public keys and each verifies the remote key matches the pasted contact key. A mismatch destroys the connection.
- **End-to-end log encryption.** Each user holds a 32-byte symmetric **log key** (persisted in `identity.json`) that encrypts every block of their own Hypercore. The log key is shared per-contact during the handshake as a **sealed box** (X25519 `crypto_box_seal`) to the contact's X25519 public key, so only that contact's secret key can open it. Location history is therefore unreadable to anyone who only holds the core's discovery key (see risk #1). `src/crypto.js` implements the primitives; `src/main/corelog.js` encrypts on append and decrypts on read.
- **Local-only secret key.** Your Ed25519 secret key is generated on-device and never transmitted or displayed.
- **No servers, no telemetry.** There is no central service to breach or to log your movements. Data flows directly between the two peers.

---

## Current risks (read these)

### 1. Location history is encrypted at rest and in transit to contacts
Your check-ins are appended to your Hypercore encrypted with your log key, and your log key is delivered to each contact only through a sealed box. If a third party obtains the core's discovery key, they still cannot read the blocks (they lack the log key). 
- **Status:** mitigated as of the E2E encryption change.
- **Remaining caveat:** the log key is a **static** per-identity secret (no rotation yet), so it behaves like a long-lived symmetric secret — a device compromise exposes the key and therefore past and future history until it is rotated. See risk #4.

### 2. MITM is only *partially* mitigated
The handshake verifies the remote public key matches the pasted key. This stops a naive attacker who lands in the topic. But the whole scheme's trust anchor is the **out-of-band key exchange**: if an attacker intercepts that first exchange (e.g. compromises the email/thread where you swapped keys) and substitutes *their* key, you'll add the attacker as a "contact" and the handshake will happily verify against the wrong key.
- **Status:** partially mitigated.
- **Recommendation:** verify public keys over a **second, independent channel** (read the key aloud, compare a short fingerprint in person or on a call) before sharing real location. A future build should surface a **safety-number / fingerprint comparison** UI.

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
- **Recommendation (future):** add an optional **precision-reduction** setting (snap to a grid / reduce decimal places) before appending.

---

## Hardening roadmap (priority order)

1. **Fix contact-core replication over the shared connection** — the newline-JSON handshake and Hypercore's noise/protomux replication currently share one Hyperswarm connection, which corrupts the replication stream (contact cores are never delivered). Route them on separate protomux channels. *Prerequisite for any live two-party flow.*
2. **Safety-number / fingerprint verification UI** for the out-of-band key exchange (removes risk #2).
3. **Log-key rotation per reconnect** (addresses #4), re-shared via the existing sealed-box handshake.
4. **Optional location precision reduction** (addresses #6).
5. **Optional at-rest encryption** of the local data files and the log key (addresses #5).
6. Document/relay-hardening guidance for metadata-sensitive users (addresses #3).

---

## Responsible note

Do not rely on this MVP in a situation where exposure of your location history or your contact graph would put you at risk. The pair-wise design plus end-to-end log encryption meaningfully reduces casual exposure, but the static log key, the unverified out-of-band pairing, and the pending replication fix mean you should treat the contents as **best-effort private, not guaranteed confidential**.
