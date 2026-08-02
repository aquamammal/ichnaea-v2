/** @typedef {import('pear-interface')} */ /* global Pear */
import Runtime from 'pear-electron'
import Bridge from 'pear-bridge'
import { createMainApp } from './src/main/app.js'

// Ichnaea v2 main process. Owns the ENTIRE P2P stack (identity, local Hypercore
// on the filesystem, Hyperswarm, contact-core replication, broadcast scheduler)
// because the Pear renderer cannot resolve the Node builtins (events, streamx)
// that Hyperswarm/Hypercore need. The renderer (src/main.js) is a thin pipe
// client that renders the globe/UI and answers GPS requests.

const bridge = new Bridge({ mount: '/src', waypoint: 'index.html' })
await bridge.ready()

const runtime = new Runtime()
const pipe = await runtime.start({ bridge })

pipe.on('close', () => Pear.exit())

// Start the P2P stack and route pipe messages to it.
const app = await createMainApp({ pipe })

pipe.on('data', (data) => {
  let msg = null
  try {
    msg = JSON.parse(Buffer.from(data).toString())
  } catch {
    return // ignore non-JSON frames
  }
  app.handleMessage(msg).catch((err) => {
    console.error('handleMessage error:', err)
  })
})
