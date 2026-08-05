// Smoke check for the 2D map renderer + map-style dispatcher (not part of the
// brittle suite). Stubs just enough DOM/canvas to exercise the non-drawing
// logic: style selection, pin lifecycle, the Path2D cache path, and the
// self-centered recenter.
import { readFileSync } from 'node:fs'

// --- minimal DOM stubs ---------------------------------------------------------
class FakePath2D {
  constructor (s) { this.s = s || ''; this.adds = 0 }
  addPath (p) { this.adds++; this.s += ' ' + p.s }
}
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
    getContext: (kind) => (kind === '2d' ? noopCtx : null),
    addEventListener: () => {},
    appendChild: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0 })
  }
}
globalThis.Path2D = FakePath2D
globalThis.document = {
  createElement: (tag) => fakeCanvas(),
  createTextNode: () => ({}),
  head: { appendChild: () => {} },
  getElementsByTagName: () => [{ appendChild: () => {} }]
}
const store = {}
globalThis.window = {
  addEventListener: () => {},
  devicePixelRatio: 1,
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v) }
  }
}
globalThis.requestAnimationFrame = () => 0
globalThis.cancelAnimationFrame = () => {}
globalThis.fetch = async (url) => ({
  ok: true,
  json: async () => JSON.parse(readFileSync('src/assets/ne_110m_admin_0_countries.geojson', 'utf8'))
})

// --- imports -------------------------------------------------------------------
const { createRenderer } = await import('../src/renderer.js')
const { MAP_STYLES } = await import('../src/map-styles.js')
const { create2DRenderer } = await import('../src/map2d.js')
const { countryColors } = await import('../src/country-colors.js')
console.log('imports: ok (renderer.js, map-styles.js, map2d.js, country-colors.js)')

assert(MAP_STYLES.length === 3, 'desktop ships 3 map styles, got ' + MAP_STYLES.length)
assert(MAP_STYLES.every((s) => s.kind === 'map'), 'all styles are 2D maps (no globe)')

// --- each style constructs + renders pins ---------------------------------------
const container = { style: {}, appendChild: () => {}, clientWidth: 800, clientHeight: 600 }
for (const styleId of ['map', 'map-center', 'map-dymaxion']) {
  globalThis.window.localStorage.getItem = (k) => (k === 'mapStyle' ? styleId : null)
  let clicked = null
  const r = createRenderer(container, { onPinClick: (d) => { clicked = d } })
  assert(r.webgl === false, styleId + ' reports webgl: false')
  assert(r.globe === null, styleId + ' reports globe: null')

  r.setSelf({ lat: 25, lng: 121 })
  assert(r.hasPin('self'), styleId + ' self pin present')
  const contact = { id: 'c1', nickname: 'Alice', lastSeenTs: Date.now(), intervalMs: 86400000 }
  r.upsertContactPin(contact, { lat: 48.85, lng: 2.35 }, 'active')
  assert(r.hasPin('c1'), styleId + ' contact pin present')
  r.upsertContactPin(contact, { lat: 48.85, lng: 2.35 }, 'stale')
  r.setPinScale(2)
  r.setGrayscale(false)
  // Colored-countries mode: build colored, toggle off, toggle back on.
  assert(typeof r.setColored === 'function', styleId + ' exposes setColored')
  r.setColored(true)
  r.setColored(false)
  r.setColored(true)
  r.removeContactPin('c1')
  assert(!r.hasPin('c1'), styleId + ' contact pin removed')
  r.resize()
  console.log(styleId + ': ok (colored mode toggled)')
}

// --- shared country palette ------------------------------------------------------
const fills = countryColors(Array.from({ length: 177 }))
assert(fills.length === 177, 'country palette has 177 colors, got ' + fills.length)
assert(new Set(fills).size > 50, 'country palette is not all the same color')
console.log('country-colors: 177 entries, ' + new Set(fills).size + ' unique')

// --- direct 2D renderer import also constructible --------------------------------
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
