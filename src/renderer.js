// Renderer dispatcher. Reads the user's chosen map style (src/map-styles.js),
// then builds the matching 2D canvas map (src/map2d.js). The desktop build is
// maps-only — no 3D WebGL globe — so this always returns a 2D renderer.
//
// The renderer exposes the same public interface as the 3D renderer does on
// Android:
//   { setSelf, upsertContactPin, removeContactPin, hasPin, setPinScale,
//     setGrayscale, setColored, centerOn, resize, globe, webgl }
// so callers (src/main.js) never need to know which one they got.
//
// Zero telemetry: every style derives its surface from the bundled Natural
// Earth data — no CDN, no tile servers.

import { create2DRenderer } from './map2d.js'
import { getMapStyle } from './map-styles.js'

export function createRenderer (container, opts = {}) {
  const style = getMapStyle(opts.styleId)
  return create2DRenderer(container, { ...opts, style: style.id })
}
