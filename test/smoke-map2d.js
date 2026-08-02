// Smoke check for the 2D fallback renderer (not part of the brittle suite).
// Stubs just enough DOM/canvas to exercise the non-drawing logic.
import { readFileSync } from 'node:fs'

// --- minimal DOM stubs ---------------------------------------------------------
const noopCtx = new Proxy({}, {
  get: (t, k) => (k === 'canvas' ? {} : () => {}),
  set: () => true
})
function fakeCanvas () {
  return {
    style: {},
    clientWidth: 800,
    clientHeight: 600,
    width: 0,
    height: 0,
    getContext: (kind) => (kind === '2d' ? noopCtx : null), // no webgl -> forces fallback
    addEventListener: () => {},
    appendChild: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0 })
  }
}
globalThis.document = {
  createElement: (tag) => fakeCanvas(),
  createTextNode: () => ({}),
  // float-tooltip (globe.gl dep) injects a <style> tag at module load.
  head: { appendChild: () => {} },
  getElementsByTagName: () => [{ appendChild: () => {} }]
}
globalThis.window = {
  addEventListener: () => {},
  devicePixelRatio: 1,
  // three-globe's frame-ticker needs these at module load (imported via globe.gl).
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {}
}
globalThis.requestAnimationFrame = () => 0
globalThis.cancelAnimationFrame = () => {}
globalThis.fetch = async (url) => ({
  ok: true,
  json: async () => JSON.parse(readFileSync('src/assets/ne_110m_admin_0_countries.geojson', 'utf8'))
})

// --- imports -------------------------------------------------------------------
const { createGlobeRenderer } = await import('../src/globe-renderer.js')
const { create2DRenderer } = await import('../src/map2d.js')
console.log('imports: ok (globe-renderer.js, map2d.js)')

// --- factory picks the 2D fallback when webgl is unavailable --------------------
const container = { style: {}, appendChild: () => {}, clientWidth: 800, clientHeight: 600 }
let clicked = null
const r = createGlobeRenderer(container, { onPinClick: (d) => { clicked = d } })
assert(r.webgl === false, 'fallback reports webgl: false')
assert(r.globe === null, 'fallback reports globe: null')

// --- pin lifecycle ---------------------------------------------------------------
r.setSelf({ lat: 52.37, lng: 4.9 })
assert(r.hasPin('self'), 'self pin present')

const contact = { id: 'c1', nickname: 'Alice', lastSeenTs: Date.now(), intervalMs: 86400000 }
r.upsertContactPin(contact, { lat: 48.85, lng: 2.35 }, 'active')
assert(r.hasPin('c1'), 'contact pin present')
r.upsertContactPin(contact, { lat: 48.85, lng: 2.35 }, 'stale') // recolor path
r.removeContactPin('c1')
assert(!r.hasPin('c1'), 'contact pin removed')
r.removeContactPin('c1') // idempotent
r.resize()

// direct 2D renderer import also constructible
const r2 = create2DRenderer(container, {})
r2.setSelf({ lat: 0, lng: 0 })
assert(r2.hasPin('self'), 'direct 2D renderer works')

// --- GeoJSON asset ----------------------------------------------------------------
const geo = JSON.parse(readFileSync('src/assets/ne_110m_admin_0_countries.geojson', 'utf8'))
assert(geo.type === 'FeatureCollection', 'geojson is a FeatureCollection')
assert(geo.features.length === 177, 'geojson has 177 features, got ' + geo.features.length)
console.log('geojson: FeatureCollection with 177 features')

await new Promise((res) => setTimeout(res, 20)) // let the fetch stub resolve
console.log('SMOKE OK')

function assert (cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exit(1) }
}
