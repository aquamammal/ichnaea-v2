// Minimal promise-wrapped IndexedDB helper.
// Stores: 'identity' (single keypair record), 'contacts' (keyed by id),
// 'settings' (key/value). No framework, no telemetry — local only.

const DB_NAME = 'beacon-db'
const DB_VERSION = 1
const STORES = ['identity', 'contacts', 'settings']

let dbPromise = null

function openDB () {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name)
        }
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx (db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode)
    const s = t.objectStore(store)
    let request
    try {
      request = fn(s)
    } catch (err) {
      reject(err)
      return
    }
    t.oncomplete = () => resolve(request ? request.result : undefined)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

export async function dbGet (store, key) {
  const db = await openDB()
  return tx(db, store, 'readonly', (s) => s.get(key))
}

export async function dbPut (store, key, value) {
  const db = await openDB()
  return tx(db, store, 'readwrite', (s) => s.put(value, key))
}

export async function dbDel (store, key) {
  const db = await openDB()
  return tx(db, store, 'readwrite', (s) => s.delete(key))
}

export async function dbGetAll (store) {
  const db = await openDB()
  return tx(db, store, 'readonly', (s) => s.getAll())
}

// Test hook: allow injecting a fake backend so unit tests don't need IndexedDB.
export function __setTestBackend (backend) {
  if (backend) {
    dbPromise = Promise.resolve(backend)
  } else {
    dbPromise = null
  }
}
