import test from 'brittle'
import { __setTestBackend } from '../src/db.js'
import {
  addContact,
  removeContact,
  getContact,
  listContacts,
  setContactInterval,
  updateLastSeen
} from '../src/contacts.js'
import { generateKeyPair, pubToB64 } from '../src/crypto.js'

// In-memory fake matching the minimal IndexedDB surface db.js uses:
// transaction(store, mode) -> { objectStore(store) } with get/put/delete/getAll
// returning request-like objects, and transaction oncomplete firing.
function makeFakeDB () {
  const data = { identity: new Map(), contacts: new Map(), settings: new Map() }
  return {
    transaction (store) {
      const map = data[store]
      const t = {
        objectStore () {
          return {
            get (key) { const r = { result: map.get(key) }; t._last = r; return r },
            put (value, key) { map.set(key, value); const r = { result: key }; t._last = r; return r },
            delete (key) { map.delete(key); const r = { result: undefined }; t._last = r; return r },
            getAll () { const r = { result: [...map.values()] }; t._last = r; return r }
          }
        }
      }
      // Fire completion asynchronously like real IDB.
      queueMicrotask(() => { if (t.oncomplete) t.oncomplete() })
      return t
    }
  }
}

function freshBackend () {
  __setTestBackend(makeFakeDB())
}

test('addContact happy path and retrieval', async (t) => {
  freshBackend()
  const kp = generateKeyPair()
  const c = await addContact({ nickname: 'Bob', publicKeyB64: pubToB64(kp.publicKey) })
  t.is(c.nickname, 'Bob')
  t.is(c.intervalMs, null)
  t.is(c.lastSeenTs, 0)
  const fetched = await getContact(c.id)
  t.is(fetched.id, c.id)
})

test('addContact rejects invalid base64', async (t) => {
  freshBackend()
  await t.exception(addContact({ nickname: 'X', publicKeyB64: '%%%bad%%%' }))
})

test('addContact rejects self', async (t) => {
  freshBackend()
  const kp = generateKeyPair()
  const b64 = pubToB64(kp.publicKey)
  await t.exception(addContact({ nickname: 'Me', publicKeyB64: b64 }, { selfPublicKey: kp.publicKey }))
})

test('addContact rejects duplicates', async (t) => {
  freshBackend()
  const kp = generateKeyPair()
  const b64 = pubToB64(kp.publicKey)
  await addContact({ nickname: 'Bob', publicKeyB64: b64 })
  await t.exception(addContact({ nickname: 'Bob2', publicKeyB64: b64 }))
})

test('default nickname when blank', async (t) => {
  freshBackend()
  const kp = generateKeyPair()
  const c = await addContact({ nickname: '   ', publicKeyB64: pubToB64(kp.publicKey) })
  t.is(c.nickname, 'Unnamed')
})

test('listContacts sorted by creation', async (t) => {
  freshBackend()
  const a = generateKeyPair()
  const b = generateKeyPair()
  await addContact({ nickname: 'A', publicKeyB64: pubToB64(a.publicKey) })
  await addContact({ nickname: 'B', publicKeyB64: pubToB64(b.publicKey) })
  const list = await listContacts()
  t.is(list.length, 2)
  t.is(list[0].nickname, 'A')
  t.is(list[1].nickname, 'B')
})

test('setContactInterval and updateLastSeen', async (t) => {
  freshBackend()
  const kp = generateKeyPair()
  const c = await addContact({ nickname: 'Bob', publicKeyB64: pubToB64(kp.publicKey) })
  await setContactInterval(c.id, 86400000)
  await updateLastSeen(c.id, 1234567890)
  const fetched = await getContact(c.id)
  t.is(fetched.intervalMs, 86400000)
  t.is(fetched.lastSeenTs, 1234567890)
})

test('removeContact deletes', async (t) => {
  freshBackend()
  const kp = generateKeyPair()
  const c = await addContact({ nickname: 'Bob', publicKeyB64: pubToB64(kp.publicKey) })
  await removeContact(c.id)
  const fetched = await getContact(c.id)
  t.is(fetched, undefined)
})

test('setContactInterval throws for unknown contact', async (t) => {
  freshBackend()
  await t.exception(setContactInterval('nope', 1000))
})
