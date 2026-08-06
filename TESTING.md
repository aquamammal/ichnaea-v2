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

## 5e. Update check (Settings → Check for updates)

- [ ] Button exists in Settings and does nothing until tapped (no network on boot — verify with an offline/airplane test: the app boots fine and only the check reports "Couldn't check").
- [ ] With a newer GitHub Release published, tapping shows **Update available (v→v)** and a tap-to-download link opens the release/APK.
- [ ] With no newer release (or none published), tapping shows **You're up to date** (or "No releases published yet").
- [ ] Works identically on Android and desktop.

## 5f. Broadcast UX (header, frequency, connecting lines)

- [ ] Beacon tile header reads **Ichnaea Ver. X.Y.Z** (matches the app version).
- [ ] The button reads **Broadcast coordinates** (not "Check in now") and triggers an immediate broadcast.
- [ ] **Connecting lines** toggle on the tile: On → dotted lines from your pin to each contact; Off → lines hidden; persists across reload.
- [ ] **Frequency:** Settings shows **Every [number] [unit]** dropdowns (minutes/hours/days). Save → tile shows "Broadcast: every <choice>" and it persists across reload.
- [ ] The tile's minimize button still works after the pin loads and after a reconnect.

## 5g. Fingerprint verification + precision dial

- [ ] **Contacts list:** each contact shows a small gray 4-word fingerprint under their name (e.g. `falcon-fern-ember-dune`).
- [ ] **Pin overlay:** clicking a contact's pin shows a **Fingerprint:** row with the same 4-word pair.
- [ ] **Add Contact live preview:** open **Add Contact** and start typing a key → a fingerprint appears live under the key field. A different key shows a different fingerprint; empty/garbage shows "Paste or scan a key to see its fingerprint." and never shows a valid-looking pair.
- [ ] **Stability:** the fingerprint for a given pasted key is identical across restarts and across the two app instances.
- [ ] **Precision dropdown:** **Settings → Location precision** lists Off / ~5 / ~10 / ~25 / ~50 km, reflecting the saved value on open and after reload.
- [ ] **Snap effect:** set **~50 km**, save, then **Broadcast coordinates** (or check in manually) → your self pin lands on a ~50 km grid point; contacts' pins (from their replicated check-in) are likewise coarsened. Setting **Off** restores your exact position.
- [ ] **Covers manual check-ins:** with precision set, a manual "Check in here" is also snapped to the grid.
- [ ] **No side effects:** fingerprint + precision do not affect P2P connectivity, other settings, or any map style.

## 5h. Log-key rotation + at-rest encryption

- [ ] **Log-key rotation (dev):** open the hidden dev panel (double-tap version tag) → **Rotate log key** → status shows "log key rotated." A fresh core generation is opened and the new key is re-shared with contacts; existing connections keep syncing.
- [ ] **Rotation survival:** after rotating, check in again and reload — your own last pin still shows (the current key decrypts the current core; retained history decrypts recent blocks).
- [ ] **Encrypt local data:** Settings → **Encrypt local data** → choose + confirm a passphrase (min 8 chars) → status shows **On**; mismatched confirmations are rejected.
- [ ] **Reload requires unlock:** after enabling, reload the app → an **Unlock** modal appears; entering the wrong passphrase shows "Wrong passphrase"; the correct passphrase unlocks and the app loads normally.
- [ ] **Data protected at rest:** with encryption on, `data/identity.json` / `contacts.json` / `settings.json` on disk are opaque envelopes (no plaintext JSON), while a plaintext `data/atrest.json` marker records the salt.
- [ ] **Remove encryption:** Settings → **Remove local encryption** → enter the current passphrase → status returns to **Off** and the stores are plaintext again.
- [ ] **No side effects:** encryption/rotation do not affect P2P connectivity, map rendering, or other settings.

## 5i. Reliability (discovery + reconnect)

- [ ] **Connecting state visible:** with contacts added but peers not yet reachable, the peer-status line shows **Connecting to contacts…** rather than a blank/waiting message.
- [ ] **Android reconnect with backoff:** kill the main process / lose connectivity → the app shows "reconnecting…" and retries; it recovers automatically when the main process comes back without a manual reload.
- [ ] **Parallel discovery:** with several contacts, pins appear as each peer is found; a slow/unreachable contact doesn't delay the others.
- [ ] **Desktop reconnect (pending working desktop runtime):** kill the main process → renderer shows "Reconnecting…" and re-boots when the main returns; closing the app still quits it.
- [ ] **Bootstrap override:** with `ICHNAEA_BOOTSTRAP` set to known nodes, discovery still connects (and uses the given nodes).

## 5j. History timeline + NEW badges + self-name

- [ ] **History panel:** tap a contact row → a panel lists their recent check-ins (time + coords). With no history, it shows "No check-in history yet."
- [ ] **NEW badge:** a contact who checked in since the app was last opened shows a **NEW** badge in the list. Viewing their history clears it.
- [ ] **Live NEW:** while the app is open, a contact's live check-in marks them NEW.
- [ ] **Self-name at pin:** set **Settings → Your name**, check in, tap your own pin → the overlay shows your name (not just "You").

## 5k. Offline check-in queue

- [ ] **Queued status:** check in while no contact is connected (or disconnect peers) → the status line shows "N check-ins queued (offline)".
- [ ] **Sync on reconnect:** reconnect a contact → the queue line briefly shows "Synced N offline check-ins" and clears.
- [ ] **No data loss:** while offline, check-ins are still stored locally; after reconnect the contact sees them via replication.
- [ ] **Restart:** queue count persists across a restart (pending.json) and clears once a peer connects.

## 5l. Quiet-contact notifications

- [ ] **Notification on transition:** with a contact whose interval makes them go stale/offline, wait for the sweep to cross the threshold → a local notification appears: "X went quiet — last check-in …" (no coordinates).
- [ ] **No boot spam:** booting with an already-quiet contact does NOT notify.
- [ ] **Toggle:** Settings → "Notify when a contact goes quiet" off → no notifications on the next transition; on → they return.
- [ ] **Android permission:** the first launch requests notification permission (Android 13+); granting enables the alerts.
- [ ] **Local-only:** notifications carry no location; nothing is transmitted.

## 5m. City search (no-GPS fallback)

- [ ] **Search works:** tap **Broadcast coordinates** with GPS off (or denied) → the modal shows a search box. Type a city (e.g. "Tokyo") → matches appear with coordinates, most populous first.
- [ ] **Pick fills coords:** tap a match → the lat/lng fields fill; **Broadcast** sends it and the self pin moves there.
- [ ] **No matches:** gibberish input shows "No matching cities."
- [ ] **Offline fallback:** if the bundled city data can't load, a clear error shows and manual lat/lng entry still works.
- [ ] **Local-only:** search never leaves the device (bundled dataset, zero telemetry).

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

`npm test` (using `brittle`) covers the pure logic: crypto/topic derivation, base64 validation, staleness classification, contact CRUD rules, the X25519/secretbox encryption primitives (AEAD round-trip, wrong-key rejection, sealed-box log-key exchange), the key-fingerprint derivation (`test/fingerprint.test.js`), and the coordinate grid-snap (`test/precision.test.js`). The items above are the manual end-to-end complement.

### Two-instance E2E (live sync)

`node test/e2e-encryption.mjs` spawns two separate app processes (own data dirs), has them add each other, exchange log keys via the sealed-box handshake, check in, and decrypt each other's replicated cores. It passes when both peers advance `lastSeenTs` (i.e. replication delivers and decryption works). This is the fastest way to validate the full two-party path without two machines.