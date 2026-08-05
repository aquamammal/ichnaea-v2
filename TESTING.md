# TESTING — Ichnaea v2 manual QA checklist

**Prerequisites for two-party tests**: You need **two app instances** (two machines, or two Pear instances with separate data directories). Call them **A** and **B**. 
**Critical Rule**: For the pairing tests, remember that the swarm topic is derived from `sort([A_pub, B_pub])`. This means both peers must have added each other's public keys to connect.

---

## 0. First launch / identity

- [ ] App launches to a map that fills the window (100vh) with no console errors.
- [ ] A Base64 public key is shown in the top-left panel.
- [ ] Reload the app → the **same** public key is shown (identity persisted in IndexedDB, not regenerated).

## 1. Contact addition

- [ ] **Happy path:** On A, click **Add Contact**, paste B's valid Base64 public key, set a nickname → contact appears in the bottom-right list with status "never checked in".
- [ ] **Invalid key:** Paste garbage / truncated Base64 → inline error in the modal, no contact created.
- [ ] **Wrong length:** Paste valid Base64 that decodes to ≠ 32 bytes → rejected with a clear message.
- [ ] **Self-add:** Paste A's own public key into A → rejected ("cannot add yourself").
- [ ] **Duplicate:** Add B's key twice → second attempt rejected as a duplicate.
- [ ] **Persistence:** Reload the app → the contact list (nicknames + keys) survives.
- [ ] **Re-join on reload:** After reload, the app automatically re-joins all saved contact swarm topics (peer count recovers without re-adding).

## 2. Pairing / connection (Bilateral vs Unilateral)

- [ ] **Bilateral (Happy Path):** A adds B, AND B adds A. Peer count rises above 0 on both.
- [ ] **Unilateral (Negative Guard):** A adds B, but B **does not** add A. Peer count stays 0 on both. No errors, no crash, no infinite reconnect loops. (This confirms the topic derivation requires mutual consent).
- [ ] **Handshake guard:** (dev) point A at a key that is *not* the one B actually uses (while B has added A) → connection is dropped, no pin, no data exchanged.
- [ ] **Reconnect:** Kill B, wait, restart B → A re-establishes the connection without manual intervention.

## 3. Frequency settings

- [ ] Open **Settings** → the six options are present (1h / 6h / 12h / 1d / 3d / 1w), with **1 Day** selected by default.
- [ ] Change to **1 Hour**, save → setting persists across reload.
- [ ] (dev) Temporarily set a short interval to observe a real broadcast without waiting a day.

## 4. Broadcasting (GPS & Backgrounding)

- [ ] **GPS Granted:** When the timer fires, a `{lat,lng,timestamp}` entry is appended to A's local Hypercore and A's **blue** self-pin appears/updates on the map.
- [ ] **GPS Denied (First time):** Deny location permission → app shows "location unavailable", retries once after ~1 minute, and does **not** append a null/empty entry.
- [ ] **GPS Denied (Reload):** Deny GPS, close the tab, reopen it. The app **must** ask for permission again (or show a prominent "Enable Location" button). It should not remain permanently broken.
- [ ] **Tab Visibility (Backgrounding):** Switch to another browser tab for 5 minutes. Return to the app. The GPS timer should fire immediately (or resume correctly) without spamming multiple missed updates. (Prevents battery drain on mobile).
- [ ] **GPS timeout/failure:** (dev) force a geolocation error → single retry after 60s, then graceful give-up until the next scheduled fire.

## 4b. Manual location override

- [ ] **One-off check-in:** Open **Settings → Manual location**, enter a valid lat (−90..90) and lng (−180..180), click **Check in here** → your **blue** self-pin moves to those coords, no GPS permission prompt appears.
- [ ] **Range validation:** Enter lat `95` or lng `-200` → inline error in the modal, nothing appended.
- [ ] **Scheduled override ON:** Enter coords, enable **"Use manual location for scheduled check-ins"**, save → the GPS status line shows `manual: lat,lng`. (dev) set a short interval → each scheduled fire uses the manual coords (no GPS request).
- [ ] **Persistence:** With the override ON, reload the app → the toggle is still on, the coords are still filled, and the status line still shows `manual: …`.
- [ ] **Override OFF:** Disable the toggle, save → scheduled check-ins go back to requesting GPS.
- [ ] **Works with GPS denied:** Deny location permission, enable the override → scheduled check-ins still succeed using the manual coords (no "location unavailable").

## 5. Receiving & rendering contacts

- [ ] After B checks in, B's pin appears on A's map. *Allow up to 30 seconds here (network/DHT latency) rather than just 10s.*
- [ ] Pin color reflects freshness relative to **B's** interval (not A's).
- [ ] **Click a pin** → overlay shows B's nickname, the last check-in timestamp formatted to local time, and a humanized "x ago".
- [ ] **Bottom-right list** shows each contact with a humanized last check-in ("2 hours ago", or "never").
- [ ] Optional dotted **arcs** render from A's self-pin to each contact pin.

## 5b. Map styles (Settings → Map style)

- [ ] Three options are present: **Map**, **Map — Centered on Me**, **Map — Dymaxion**; **Map** is selected by default.
- [ ] **Map (equirectangular):** world drawn in equirectangular projection centered on Taiwan (~121°E). Self pin and contact pins render; drag-pan and wheel-zoom work.
- [ ] **Map — Centered on Me:** after a check-in (or **Check in now**), the projection re-centers so your self pin is in the middle.
- [ ] **Map — Dymaxion:** world drawn in Fuller's Dymaxion (Airocean) projection; pan/zoom is smooth (no per-frame re-projection stalls).
- [ ] **Persistence:** pick a style, Save → app reloads and the chosen style is active. Reload again → the choice is retained.
- [ ] **Dev panel:** double-tap the version tag → the dev panel's "Next map" button cycles through the three styles and reloads.
- [ ] Pins/click overlay/contacts/settings/P2P still function in every style.

## 5c. Colored countries toggle + QR share

- [ ] **Toggle:** the Check-In Beacon tile has a **Colored countries** button showing **Off** by default.
- [ ] Click it → shows **On** and every country fills with its own distinct color; oceans stay dark; borders remain readable. Works in **all three projections** (Map, Centered on Me, Dymaxion).
- [ ] Click again → back to the plain dark landmass (**Off**).
- [ ] **Persistence:** toggle On, reload → still On; toggle Off, reload → still Off. No reload is needed to apply it (live `setColored`).
- [ ] **QR button:** click **QR** next to the public key → a modal shows a scannable QR code of your public key plus the key text.
- [ ] **Scan QR code:** in **Add Contact**, click **Scan QR code** → the camera opens (OS permission prompt on first use), and pointing it at the other app's on-screen QR fills the public-key field automatically. Works phone-to-phone and phone-to-desktop.
- [ ] Tapping the key text in the QR modal copies it.
- [ ] QR share + scan are generated locally (work offline; no network involved).

## 5d. Rename, your name, click-to-center

- [ ] **Rename a contact:** long-press a contact (or right-click on desktop) → prompt appears → enter a new nickname → the list updates and the new name sticks after reload.
- [ ] **Your name:** set **Settings → Your name** → the peer's app shows that name (as a hint under whatever nickname *they* gave you) after your next check-in.
- [ ] **Local override:** renaming a contact locally does **not** change what you send them, and their check-ins don't overwrite your local nickname.
- [ ] **Click to center:** click a contact row (or a pin) → the map pans so they're centered; the pin overlay opens.
- [ ] All of the above work in every map style and in the Dymaxion projection.

## 6. Stale peer handling

- [ ] **Stale:** (dev) set B's interval short, let `> 2×` elapse with no check-in → B's pin turns **gray**.
- [ ] **Offline removal:** let `> 4×` B's interval elapse → B's pin is **removed** from the map (but the contact stays in the list).
- [ ] When B checks in again, B's pin returns as **green**.

## 7. Connection failure scenarios

- [ ] **Network drop:** Disable A's network → peer count falls, no crash; re-enable → connections recover.
- [ ] **Contact offline at add time:** Add B while B is offline → no error loop; A keeps trying quietly and connects when B appears.
- [ ] **Swarm drop:** (dev) force a connection `error`/`close` → peer count updates, pins go stale per the rules above rather than vanishing instantly.

## 8. Storage / housekeeping (Including Rotation Cheat)

- [ ] Local Hypercore persists across reloads (check-in history survives).
- [ ] **Rotation Test (with Debug mode):** Open the hidden **Dev Settings** (e.g., double-tap the version number) and click "Force 200 check-ins". After the rotation, the new core discovery key is shared on the next handshake. Contacts keep showing the last known pin until the new core replicates. (Without this debug button, testing rotation manually is impossible).

---

## Automated

`npm test` (using `brittle`) covers the pure logic: crypto/topic derivation, base64 validation, staleness classification, contact CRUD rules, and the X25519/secretbox encryption primitives (AEAD round-trip, wrong-key rejection, sealed-box log-key exchange). The items above are the manual end-to-end complement.

### Two-instance E2E (live sync)

`node test/e2e-encryption.mjs` spawns two separate app processes (own data dirs), has them add each other, exchange log keys via the sealed-box handshake, check in, and decrypt each other's replicated cores. It passes when both peers advance `lastSeenTs` (i.e. replication delivers and decryption works). This is the fastest way to validate the full two-party path without two machines.