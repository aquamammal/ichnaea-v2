// Static file server for the browser UI-QA harness. Serves the repo root so the
// harness and all bundled assets are reachable, and rewrites `/browser-qa/assets/*`
// to `src/assets/*` so the renderer's `./assets/cities-data.txt` fetch (relative to
// `browser-qa/harness.html`) resolves to the real city dataset.
//
// Run:   node browser-qa/build.mjs
//        node browser-qa/serve.mjs
// Open:  http://localhost:8765/browser-qa/harness.html
//
// The harness is read-only: it renders the renderer against the stub pipe. Use
// the browser's devtools console to inspect the simulated pipe traffic.

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, normalize, extname } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.PORT || 8765)
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2'
}

function resolvePath (urlPath) {
  const pathname = decodeURIComponent(new URL(urlPath, 'http://x').pathname)
  let rel = pathname.replace(/^\/+/, '')
  if (!rel || rel === 'browser-qa/' || rel === 'browser-qa') rel = 'browser-qa/harness.html'
  if (rel.startsWith('browser-qa/assets/')) rel = 'src/assets/' + rel.slice('browser-qa/assets/'.length)
  const file = normalize(join(root, rel))
  if (!file.startsWith(root)) return null // prevent path traversal
  return file
}

createServer(async (req, res) => {
  const file = resolvePath(req.url || '/')
  if (!file) {
    res.writeHead(403).end('forbidden')
    return
  }
  try {
    const info = await stat(file)
    if (!info.isFile()) throw new Error('not a file')
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404).end('not found: ' + req.url)
  }
}).listen(PORT, () => {
  console.log(`browser UI-QA harness: http://localhost:${PORT}/browser-qa/harness.html`)
})
