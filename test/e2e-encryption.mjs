// Two-instance E2E test runner. Spawns two separate app processes (each with
// its own cwd/data dir), has them add each other, exchange log keys, check in,
// and decrypt each other's cores. Run: node test/e2e-encryption.mjs
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const stamp = Date.now()
const dirs = [`/tmp/kilo/ichnaea-e2e-a-${stamp}`, `/tmp/kilo/ichnaea-e2e-b-${stamp}`]
for (const d of dirs) mkdirSync(d, { recursive: true })

const children = dirs.map((dir) =>
  spawn('node', [path.join(__dirname, 'e2e-child.mjs')], { cwd: dir })
)

const pubkeys = {}
const results = {}
let resolved = false

children.forEach((c, i) => {
  let buf = ''
  c.stdout.setEncoding('utf8')
  c.stdout.on('data', (d) => {
    buf += d
    let idx
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx); buf = buf.slice(idx + 1)
      const pm = /^PUBKEY (.+)$/.exec(line)
      const rm = /^RESULT (.+)$/.exec(line)
      if (pm) pubkeys[i] = pm[1]
      if (rm) results[i] = JSON.parse(rm[1])
    }
  })
  c.stderr.setEncoding('utf8')
  c.stderr.on('data', (d) => process.stdout.write(`[worker${i}] ${d}`))
})

function tryStart () {
  if (pubkeys[0] && pubkeys[1] && !resolved) {
    resolved = true
    for (const i of [0, 1]) children[i].stdin.write(`OTHER ${pubkeys[1 - i]}\n`)
    setTimeout(finish, 100000)
  }
}

setInterval(() => {
  if (Object.keys(pubkeys).length === 2) tryStart()
}, 300)

function finish () {
  for (const c of children) c.kill('SIGKILL')
  const ok = Object.keys(results).length === 2 && Object.values(results).every(r => r && r.ok)
  for (const [i, r] of Object.entries(results)) console.log(`worker ${i}:`, JSON.stringify(r))
  console.log(ok ? 'E2E SYNC: PASS' : 'E2E SYNC: FAIL')
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  process.exit(ok ? 0 : 1)
}

setTimeout(() => {
  if (!resolved) {
    for (const c of children) c.kill('SIGKILL')
    console.log('E2E SYNC: FAIL (instances never connected)')
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
    process.exit(1)
  }
}, 30000)
