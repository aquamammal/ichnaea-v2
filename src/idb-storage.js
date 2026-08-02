import RAS from 'random-access-storage'
import b4a from 'b4a'

// A minimal random-access-storage (RAS@3) backend over IndexedDB.
// Data is stored in fixed-size pages so reads/writes of arbitrary offset/length
// map onto whole-page get/put. No telemetry, fully local, no abandoned deps.
//
// Usage (Hypercore 10 style):
//   const core = new Hypercore((filename) => new IDBStorage('beacon/' + filename), key, opts)

const PAGE_SIZE = 4096
const opened = new Map() // name -> Promise<IDBDatabase>

function openDB (name) {
  if (opened.has(name)) return opened.get(name)
  const p = new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('pages')) db.createObjectStore('pages')
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  opened.set(name, p)
  return p
}

function idbReq (request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export default class IDBStorage extends RAS {
  constructor (name, opts = {}) {
    super()
    this.name = name
    this.pageSize = opts.pageSize || PAGE_SIZE
    this.db = null
    this.length = 0
  }

  async _open (req) {
    try {
      this.db = await openDB(this.name)
      const len = await idbReq(this.db.transaction('meta', 'readonly').objectStore('meta').get('length'))
      this.length = typeof len === 'number' ? len : 0
      req.callback(null)
    } catch (err) {
      req.callback(err)
    }
  }

  _pages (offset, size) {
    const first = Math.floor(offset / this.pageSize)
    const last = Math.floor((offset + Math.max(size, 1) - 1) / this.pageSize)
    const list = []
    for (let i = first; i <= last; i++) list.push(i)
    return list
  }

  async _read (req) {
    try {
      const { offset, size } = req
      const out = b4a.alloc(size)
      const store = this.db.transaction('pages', 'readonly').objectStore('pages')
      const pages = this._pages(offset, size)
      const bufs = await Promise.all(pages.map((p) => idbReq(store.get(p))))
      for (let i = 0; i < pages.length; i++) {
        const pageIndex = pages[i]
        const pageBuf = bufs[i] ? b4a.from(bufs[i]) : null
        const pageStart = pageIndex * this.pageSize
        const readStart = Math.max(offset, pageStart)
        const readEnd = Math.min(offset + size, pageStart + this.pageSize)
        const srcOff = readStart - pageStart
        const dstOff = readStart - offset
        const len = readEnd - readStart
        if (len <= 0) continue
        if (pageBuf) b4a.copy(pageBuf, out, dstOff, srcOff, srcOff + len)
        // missing page -> leave zeros (sparse)
      }
      req.callback(null, out)
    } catch (err) {
      req.callback(err)
    }
  }

  async _write (req) {
    try {
      const { offset, data } = req
      const buf = b4a.from(data)
      const size = buf.length
      const store = this.db.transaction('pages', 'readwrite').objectStore('pages')
      const pages = this._pages(offset, size)
      for (const pageIndex of pages) {
        const pageStart = pageIndex * this.pageSize
        const writeStart = Math.max(offset, pageStart)
        const writeEnd = Math.min(offset + size, pageStart + this.pageSize)
        const dstOff = writeStart - pageStart
        const srcOff = writeStart - offset
        const len = writeEnd - writeStart
        if (len <= 0) continue
        let pageBuf
        if (dstOff === 0 && len === this.pageSize) {
          pageBuf = b4a.from(buf.subarray(srcOff, srcOff + len))
        } else {
          const existing = await idbReq(store.get(pageIndex))
          pageBuf = existing ? b4a.from(existing) : b4a.alloc(this.pageSize)
          if (pageBuf.length < this.pageSize) {
            const grown = b4a.alloc(this.pageSize)
            b4a.copy(pageBuf, grown, 0)
            pageBuf = grown
          }
          b4a.copy(buf, pageBuf, dstOff, srcOff, srcOff + len)
        }
        await idbReq(store.put(pageBuf, pageIndex))
      }
      const end = offset + size
      if (end > this.length) {
        this.length = end
        await idbReq(this.db.transaction('meta', 'readwrite').objectStore('meta').put(end, 'length'))
      }
      req.callback(null)
    } catch (err) {
      req.callback(err)
    }
  }

  async _stat (req) {
    try {
      req.callback(null, { size: this.length })
    } catch (err) {
      req.callback(err)
    }
  }

  async _truncate (req) {
    try {
      const newLen = req.offset || 0
      const store = this.db.transaction('pages', 'readwrite').objectStore('pages')
      const firstKeep = Math.ceil(newLen / this.pageSize)
      // Delete all pages at/after firstKeep, and zero the tail of the boundary page.
      const range = IDBKeyRange.lowerBound(firstKeep)
      const keys = await idbReq(store.getAllKeys(range))
      for (const k of keys) await idbReq(store.delete(k))
      if (newLen % this.pageSize !== 0 && newLen > 0) {
        const boundary = Math.floor(newLen / this.pageSize)
        const existing = await idbReq(store.get(boundary))
        if (existing) {
          const buf = b4a.from(existing)
          buf.fill(0, newLen - boundary * this.pageSize)
          await idbReq(store.put(buf, boundary))
        }
      }
      this.length = newLen
      await idbReq(this.db.transaction('meta', 'readwrite').objectStore('meta').put(newLen, 'length'))
      req.callback(null)
    } catch (err) {
      req.callback(err)
    }
  }

  async _del (req) {
    try {
      const offset = req.offset || 0
      const size = req.size === Infinity ? this.length - offset : req.size
      const store = this.db.transaction('pages', 'readwrite').objectStore('pages')
      const first = Math.floor(offset / this.pageSize)
      const last = Math.floor((offset + Math.max(size, 1) - 1) / this.pageSize)
      for (let i = first; i <= last; i++) await idbReq(store.delete(i))
      req.callback(null)
    } catch (err) {
      req.callback(err)
    }
  }

  async _close (req) {
    try {
      if (this.db) { this.db.close(); this.db = null }
      opened.delete(this.name)
      req.callback(null)
    } catch (err) {
      req.callback(err)
    }
  }

  async _unlink (req) {
    try {
      if (this.db) { this.db.close(); this.db = null }
      opened.delete(this.name)
      await new Promise((resolve, reject) => {
        const r = indexedDB.deleteDatabase(this.name)
        r.onsuccess = () => resolve()
        r.onerror = () => reject(r.error)
        r.onblocked = () => resolve()
      })
      req.callback(null)
    } catch (err) {
      req.callback(err)
    }
  }
}
