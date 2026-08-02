import { pubFromB64, pubToB64 } from './crypto.js'
import { dbGet, dbPut, dbDel, dbGetAll } from './db.js'
import b4a from 'b4a'

const STORE = 'contacts'

// A contact record:
// {
//   id,            // hex of public key (stable identifier)
//   nickname,      // local-only label
//   publicKeyB64,  // Base64 public key (as pasted)
//   intervalMs,    // learned from handshake; null until known
//   lastSeenTs,    // last check-in timestamp we replicated; 0 if never
//   created
// }

function keyId (publicKeyBuf) {
  return b4a.toString(publicKeyBuf, 'hex')
}

export async function addContact ({ nickname, publicKeyB64 }, { selfPublicKey } = {}) {
  const buf = pubFromB64(publicKeyB64) // throws on invalid
  const id = keyId(buf)

  if (selfPublicKey) {
    const selfBuf = typeof selfPublicKey === 'string' ? pubFromB64(selfPublicKey) : selfPublicKey
    if (b4a.equals(buf, selfBuf)) throw new Error('Cannot add yourself as a contact')
  }

  const existing = await dbGet(STORE, id)
  if (existing) throw new Error('Contact already exists')

  const contact = {
    id,
    nickname: String(nickname || '').trim() || 'Unnamed',
    publicKeyB64: pubToB64(buf), // normalized
    intervalMs: null,
    lastSeenTs: 0,
    created: Date.now()
  }
  await dbPut(STORE, id, contact)
  return contact
}

export async function removeContact (id) {
  await dbDel(STORE, id)
  return true
}

export async function getContact (id) {
  return dbGet(STORE, id)
}

export async function listContacts () {
  const all = await dbGetAll(STORE)
  return (all || []).sort((a, b) => a.created - b.created)
}

export async function setContactInterval (id, intervalMs) {
  const c = await dbGet(STORE, id)
  if (!c) throw new Error('Contact not found')
  c.intervalMs = intervalMs
  await dbPut(STORE, id, c)
  return c
}

export async function updateLastSeen (id, ts) {
  const c = await dbGet(STORE, id)
  if (!c) return null
  c.lastSeenTs = ts
  await dbPut(STORE, id, c)
  return c
}

export async function setContactCoreKey (id, coreKeyHex) {
  const c = await dbGet(STORE, id)
  if (!c) return null
  c.coreKeyHex = coreKeyHex
  await dbPut(STORE, id, c)
  return c
}
