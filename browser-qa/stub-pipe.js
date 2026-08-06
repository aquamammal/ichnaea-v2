// Stub Pear main-process pipe for the desktop renderer, so the UI can be
// visually QA'd in a plain browser.
//
// WHY: the global Pear runtime's Electron bundle loader crashes on this box
// (`SyntaxError: Unexpected token ':'` — Electron's `default_app` runs the JSON
// `.bundle` as a JS app-path because pear-electron@1.9.0-rc.0 passes it as the
// first positional arg). That blocks `pear run -d .` from opening a window, so
// renderer/globe/panel changes can't be seen live here. This module lets you
// load the renderer standalone in Chrome/Firefox against a simulated main
// process instead.
//
// It implements exactly the pear-pipe surface `src/main.js` uses:
//   - pipe.write(string)   renderer -> main (JSON requests, correlated by `id`)
//   - pipe.on('data', cb)  main -> renderer JSON pushes (cb receives bytes)
//   - pipe.on('close', cb)
//   - pipe.autoexit = false
//
// The stub answers the renderer's requests with realistic fixture state (see
// `bootState()` below) and then replays a scripted timeline of live pushes
// (peer status, a fresh contact check-in, a self check-in, GPS requests) so the
// 2D map, 3D globe, contacts panel, NEW badge, offline-queue line, and
// active/stale/offline pin colors all render and update.

const ENCODE = new TextEncoder()
const DECODE = new TextDecoder()

// 32-byte public keys (base64) so `fingerprint()` produces real 4-word pairs.
const KEYS = [
  'quqvs/9tZVkbZwYACDgFyX4nq/q3wFbFG4VgQdoDzBQ=',
  'QnoUbaf/qpGOpRrIDxAsDUzugRHS7bf6bkLxyjf8tHo=',
  'jOTxIMfJxtQfCDeZAobxopW1dJMi5BxieLxBhNjdYQc=',
  'U/zXxrtGZ8GCCYsNDCu7djuBBueJjB4lpc/f252E7ok='
]

const HOUR = 3600000
const DAY = 86400000
const now = () => Date.now()

// Self location (simulated fixed fix; the map centers around this).
const SELF_LOC = { lat: 40.7128, lng: -74.006 }

// Contact fixtures at every staleness stage + a never-broadcast contact, so
// pins age green -> yellow -> red and the "no pin" case is visible.
function bootContacts () {
  const t = now()
  return [
    {
      id: 'alex',
      nickname: 'Alex',
      publicKeyB64: KEYS[0],
      intervalMs: HOUR,
      lastSeenTs: t - HOUR, // 1x interval -> active (green)
      lat: 40.713, lng: -73.98
    },
    {
      id: 'blair',
      nickname: 'Blair',
      publicKeyB64: KEYS[1],
      intervalMs: HOUR,
      lastSeenTs: t - 6 * HOUR, // 6x interval -> offline (red)
      lat: 40.7, lng: -74.06
    },
    {
      id: 'casey',
      nickname: 'Casey',
      publicKeyB64: KEYS[2],
      intervalMs: DAY,
      lastSeenTs: t - 5 * DAY, // 5x interval -> offline (red)
      lat: 51.5074, lng: -0.1278 // London
    },
    {
      id: 'drew',
      nickname: 'Drew',
      publicKeyB64: KEYS[3],
      intervalMs: DAY,
      lastSeenTs: 0, // never broadcast -> no pin, "never" label
      lat: null,
      lng: null
    }
  ]
}

function bootState () {
  return {
    locked: false,
    atrest: false,
    pendingCount: 2,
    publicKeyB64: 'EeWg2/83sJHAEmzdyuF0YKIcqFEd1e2XsxY6aHdgj2k=',
    intervalMs: DAY,
    selfName: 'QA Self',
    precisionKm: 0,
    selfLoc: { lat: SELF_LOC.lat, lng: SELF_LOC.lng, timestamp: now() },
    contacts: bootContacts()
  }
}

export default function getPipe () {
  const handlers = new Map()
  let ready = null
  const readyPromise = new Promise((resolve) => { ready = resolve })
  let closed = false

  const pipe = {
    autoexit: false,

    on (event, cb) {
      if (event === 'close') { handlers.set('close', cb); return }
      handlers.set('data', cb)
      if (cb && event === 'data') ready() // the renderer has attached
    },

    write (str) {
      let msg = null
      try { msg = JSON.parse(str) } catch { return }
      if (!msg || typeof msg !== 'object') return
      handleRequest(msg).then((res) => {
        if (closed) return
        const cb = handlers.get('data')
        if (cb) cb(ENCODE.encode(JSON.stringify(res)))
      })
    }
  }

  // Renderer request -> simulated main response. `boot` and `gps:request` carry
  // real state; everything else gets a benign acknowledgement so the renderer's
  // request promises resolve instead of timing out.
  async function handleRequest (msg) {
    switch (msg.type) {
      case 'boot':
        return { id: msg.id, type: 'boot', ...bootState() }
      case 'gps:request':
        return { id: msg.id, type: 'gps:result', lat: SELF_LOC.lat, lng: SELF_LOC.lng }
      case 'contact:history':
        return { id: msg.id, type: 'contact:history', entries: [] }
      default:
        return { id: msg.id, type: msg.type, ok: true }
    }
  }

  // Replay a scripted timeline of live main-process pushes once the renderer is
  // listening, so the UI updates the same way it would under a real peer.
  readyPromise.then(() => {
    if (closed) return
    const emit = (obj, delay) => setTimeout(() => {
      if (closed) return
      const cb = handlers.get('data')
      if (cb) cb(ENCODE.encode(JSON.stringify(obj)))
    }, delay)

    emit({ type: 'peers', verified: 1, connections: 1, connecting: 0, peers: 1 }, 300)
    emit({ type: 'status', message: 'connected to peer (simulated)' }, 500)
    // A live check-in from Alex (newer than boot) -> NEW badge + pin refresh.
    emit({
      type: 'contact:update',
      contact: {
        id: 'alex',
        nickname: 'Alex',
        publicKeyB64: KEYS[0],
        intervalMs: HOUR,
        lastSeenTs: now(),
        lat: 40.72,
        lng: -73.99
      }
    }, 1200)
    // A fresh self check-in (re-centers nothing; just updates the self pin).
    emit({ type: 'self', lat: SELF_LOC.lat + 0.001, lng: SELF_LOC.lng, timestamp: now() }, 1800)
    // Offline-queue sync notice.
    emit({ type: 'pending', synced: 2 }, 2400)
  })

  return pipe
}
