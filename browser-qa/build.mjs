// Builds the browser UI-QA harness for the desktop renderer.
//
// 1. Bundles `src/main.js` with esbuild for the browser, aliasing `pear-pipe`
//    to the local stub (`browser-qa/stub-pipe.js`) so the renderer runs against
//    a simulated main process. All renderer dependencies (three, globe.gl,
//    d3-geo, d3-geo-polygon, qrcode, jsqr) are pulled in automatically.
// 2. Generates `browser-qa/harness.html` from the real `src/index.html` by
//    swapping the `<script src="./main.js">` for the QA bundle, so the harness
//    can never drift from the actual UI.
//
// Output: browser-qa/qa-bundle.js + browser-qa/harness.html.
// Run:    node browser-qa/build.mjs   (then)   node browser-qa/serve.mjs

import { build } from 'esbuild'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'browser-qa')

await mkdir(out, { recursive: true })

await build({
  entryPoints: [join(root, 'src/main.js')],
  outfile: join(out, 'qa-bundle.js'),
  bundle: true,
  format: 'iife',
  target: 'es2019',
  platform: 'browser',
  alias: {
    'pear-pipe': join(out, 'stub-pipe.js')
  }
})

// Generate harness.html from the real index.html (only the script src changes).
const html = await readFile(join(root, 'src/index.html'), 'utf8')
const harness = html.replace(
  '<script type="module" src="./main.js"></script>',
  '<script src="./qa-bundle.js"></script>'
)
await writeFile(join(out, 'harness.html'), harness)

console.log('browser-qa built: qa-bundle.js + harness.html')
