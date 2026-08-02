import Hypercore from 'hypercore'
import RAM from 'random-access-memory'
import b4a from 'b4a'
import IDBStorage from './idb-storage.js'
import { encrypt, decrypt } from './crypto.js'

// Local append-only check-in log (persisted in IndexedDB) plus replication of
// contact cores (kept in RAM, re-replicated on reconnect).

const MAX_ENTRIES = 200 // rotate to a fresh core beyond this (Hypercore is append-only)

// --- Local core --------------------------------------------------------------

// Open (or create) the local core for this identity. Storage is IndexedDB via
// the IDBStorage RAS adapter; the keypair signs every appended block.
// `generation` namespaces the storage so rotating to a fresh core (after
// MAX_ENTRIES) opens a brand-new, empty log instead of the old one.
export async function openLocalCore (keyPair, generation = 0) {
  const name = 'beacon-local-' + b4a.toString(keyPair.publicKey, 'hex').slice(0, 16) + '-g' + generation
  const core = new Hypercore((filename) => new IDBStorage(name + '/' + filename), {
    keyPair,
    createIfMissing: true
  })
  await core.ready()
  return core
}

// Append a check-in. Never appends null/invalid locations.
// Returns { entry, length, shouldRotate }.
export async function appendCheckin (core, { lat, lng, timestamp }) {
  if (typeof lat !== 'number' || typeof lng !== 'number' || !isFinite(lat) || !isFinite(lng)) {
    throw new Error('Invalid coordinates — refusing to append')
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new Error('Coordinates out of range')
  }
  const entry = { lat, lng, timestamp: timestamp || Date.now() }
  const payload = b4a.from(JSON.stringify(entry))
  await core.append(encrypt(payload))
  return { entry, length: core.length, shouldRotate: core.length > MAX_ENTRIES }
}

// Read + decode the latest entry from any core (local or replicated).
export async function readLatest (core) {
  if (!core.length) return null
  const block = await core.get(core.length - 1)
  const plain = decrypt(block)
  try {
    return JSON.parse(b4a.toString(plain))
  } catch {
    return null
  }
}

// --- Contact core replication ------------------------------------------------

// Open a RAM core for a contact's core key and replicate it over a live
// Hyperswarm connection. Returns the core; the caller polls core.length and
// readLatest(). RAM storage means contact history is not cached across restarts.
export async function replicateContactCore (coreKeyHex, conn) {
  const key = b4a.from(coreKeyHex, 'hex')
  const core = new Hypercore(RAM, key)
  await core.ready()
  if (conn) core.replicate(conn)
  return core
}

export { MAX_ENTRIES }
