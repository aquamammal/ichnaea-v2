// Child instance for the two-instance E2E test. Spawned by e2e-encryption.mjs
// with cwd = its own temp data dir. Boots, reports its public key, waits on
// stdin for the peer's public key, adds the peer, waits for the sealed-box
// log-key exchange, checks in, and verifies it can decrypt the peer's core.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const { createMainApp } = await import(`${PROJECT}/src/main/app.js`)
const b4a = (await import('b4a')).default
const list = await import(`${PROJECT}/src/main/contacts.js`)

const sent = []
const pipe = { write: (d) => sent.push(JSON.parse(d)), on: () => {} }
const app = await createMainApp({ pipe })
await app.handleMessage({ type: 'boot', id: 'b0' })
const pubkey = sent.find(s => s.type === 'boot').publicKeyB64
process.stdout.write('PUBKEY ' + pubkey + '\n')

const otherPubkey = await new Promise((resolve) => {
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (d) => {
    const line = d.toString().trim()
    const m = /^OTHER (.+)$/.exec(line)
    if (m) resolve(m[1])
  })
})

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const otherId = b4a.from(otherPubkey, 'base64').toString('hex')

let ok = false
let gotLogKey = false
let failure = null
try {
  await app.handleMessage({ type: 'contact:add', id: 'add1', nickname: 'Peer', publicKeyB64: otherPubkey })

  for (let i = 0; i < 90; i++) {
    const c = await list.getContact(otherId)
    if (c && c.logKeyHex) { gotLogKey = true; break }
    await sleep(1000)
  }
  if (!gotLogKey) {
    const c = await list.getContact(otherId)
    process.stderr.write(`DIAG otherId=${otherId} contact=${JSON.stringify(c)}\n`)
    throw new Error('never received peer log key')
  }

  await app.handleMessage({ type: 'checkin:manual', id: 'ck', lat: 37.7, lng: -122.4 })

  for (let i = 0; i < 90; i++) {
    const c = await list.getContact(otherId)
    if (c && c.lastSeenTs > 0) { ok = true; break }
    await sleep(1000)
  }
  if (!ok) throw new Error('could not decrypt peer core (no block delivered)')
} catch (err) {
  failure = err.message
}

if (ok) {
  const c = await list.getContact(otherId)
  process.stdout.write('RESULT ' + JSON.stringify({ ok: true, gotLogKey, lastSeenTs: c.lastSeenTs }) + '\n')
} else {
  process.stdout.write('RESULT ' + JSON.stringify({ ok: false, error: failure || 'could not decrypt peer core' }) + '\n')
}
setTimeout(() => process.exit(0), 200)
