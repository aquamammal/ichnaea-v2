import test from 'brittle'
import { versionParts, isNewerVersion } from '../src/updates.js'

test('versionParts parses v-prefixed dot numbers', (t) => {
  t.alike(versionParts('v0.2.1'), [0, 2, 1])
  t.alike(versionParts('1.2.3'), [1, 2, 3])
  t.alike(versionParts('0.2.10'), [0, 2, 10])
})

test('versionParts rejects garbage', (t) => {
  t.is(versionParts('garbage'), null)
  t.is(versionParts('v'), null)
  t.is(versionParts(''), null)
})

test('isNewerVersion compares numerically', (t) => {
  t.ok(isNewerVersion('v0.2.2', '0.2.1'))
  t.ok(isNewerVersion('v1.0.0', '0.2.1'))
  t.ok(isNewerVersion('0.2.10', '0.2.9'))
})

test('isNewerVersion treats equal/older as not newer', (t) => {
  t.not(isNewerVersion('v0.2.1', '0.2.1'))
  t.not(isNewerVersion('0.2.0', '0.2.1'))
  t.not(isNewerVersion('garbage', '0.2.1'))
  t.not(isNewerVersion('0.2.1', 'garbage'))
})
