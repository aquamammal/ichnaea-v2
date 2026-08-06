import getPipe from 'pear-pipe'
import { classify, humanize, formatLocal, STATUS } from './staleness.js'
import { createRenderer } from './renderer.js'
import { MAP_STYLES, getMapStyleId, setMapStyleId, getColored, setColored, getArcs, setArcs } from './map-styles.js'
import QRCode from 'qrcode/lib/browser.js'
import { openScanner } from './scanner.js'
import { checkForUpdates } from './updates.js'
import { fingerprint } from './fingerprint.js'
import { createBackoff } from './backoff.js'
import { searchCities } from './cities.js'

// Renderer for Ichnaea v2. This is a THIN PIPE CLIENT: it owns only the globe,
// the UI, and geolocation. ALL P2P state (identity, contacts, the local
// Hypercore, the swarm, the scheduler) lives in the Pear main process and
// arrives over the pipe as JSON. This module must NOT import hyperswarm,
// hypercore, random-access-*, or any Node builtin — the renderer's module
// resolver cannot provide them, which is exactly why the P2P stack moved.

// --- element helpers ---------------------------------------------------------
const $ = (id) => document.getElementById(id)
const els = {
  peerDot: $('peer-dot'), peerStatus: $('peer-status'), gpsStatus: $('gps-status'),
  myPubkey: $('my-pubkey'), contactsList: $('contacts-list'),
  btnQr: $('btn-qr'), modalQr: $('modal-qr'), qrCanvas: $('qr-canvas'), qrKey: $('qr-key'), qrClose: $('qr-close'),
  colorToggle: $('btn-color-countries'), colorVal: $('color-countries-val'),
  arcsToggle: $('btn-arcs'), arcsVal: $('arcs-val'),
  panelTopleft: $('panel-topleft'), panelContacts: $('panel-contacts'),
  modalAdd: $('modal-add'), addNick: $('add-nickname'), addPub: $('add-pubkey'), addErr: $('add-error'), addFingerprint: $('add-fingerprint'), btnScanQr: $('btn-scan-qr'),
  modalSet: $('modal-settings'), setErr: $('set-error'), setMapStyle: $('set-mapstyle'),
  setFreqMin: $('set-freq-min'), setFreqUnit: $('set-freq-unit'), freqDisplay: $('freq-display'),
  setPrecision: $('set-precision'),
  setSelfName: $('set-selfname'),
  btnCheckUpdates: $('btn-check-updates'), updatesStatus: $('updates-status'), updatesDetail: $('updates-detail'),
  queuedRow: $('queued-row'), queuedStatus: $('queued-status'),
  modalUnlock: $('modal-unlock'), unlockPass: $('unlock-passphrase'), unlockErr: $('unlock-error'), unlockConfirm: $('unlock-confirm'),
  modalHistory: $('modal-history'), historyTitle: $('history-title'), historyList: $('history-list'), historyClose: $('history-close'),
  modalBroadcastNudge: $('modal-broadcast-nudge'), broadcastNudgeNow: $('broadcast-nudge-now'), broadcastNudgeLater: $('broadcast-nudge-later'),
  modalManualCheckin: $('modal-manual-checkin'), manualCheckinLat: $('manual-checkin-lat'), manualCheckinLng: $('manual-checkin-lng'), manualCheckinErr: $('manual-checkin-error'), manualCheckinOk: $('manual-checkin-ok'), manualCheckinCancel: $('manual-checkin-cancel'), manualCheckinClose: $('manual-checkin-close'),
  citySearch: $('city-search'), cityResults: $('city-results'),
  btnEncrypt: $('btn-encrypt'), encryptStatus: $('encrypt-status'), encryptDetail: $('encrypt-detail'),
  quietNotify: $('quiet-notify'),
  manualLat: $('manual-lat'), manualLng: $('manual-lng'), manualEnabled: $('manual-enabled'),
  pinScale: $('set-pinsize'), pinsizeVal: $('pinsize-val'),
  pinOverlay: $('pin-overlay'), pinName: $('pin-name'), pinTime: $('pin-time'), pinAgo: $('pin-ago'), pinStatus: $('pin-status'), pinCoords: $('pin-coords'), pinFingerprint: $('pin-fingerprint'),
  toast: $('toast'), devPanel: $('dev-panel'), devStatus: $('dev-status'), versionTag: $('version-tag')
}

// Broadcast frequency: user picks a number + unit (minutes / hours / days).
const FREQ_UNITS = [
  { id: 'minutes', ms: 60000, label: 'minutes' },
  { id: 'hours', ms: 3600000, label: 'hours' },
  { id: 'days', ms: 86400000, label: 'days' }
]
const DEFAULT_INTERVAL_MS = 86400000
const GPS_TIMEOUT_MS = 15000

// Split an interval (ms) into { value, unitId } for the dropdowns.
function freqSplit (ms) {
  ms = Number(ms) || DEFAULT_INTERVAL_MS
  // Pick the largest unit that divides evenly and keeps value >= 1.
  for (const u of [...FREQ_UNITS].reverse()) {
    if (ms >= u.ms && ms % u.ms === 0) return { value: ms / u.ms, unitId: u.id }
  }
  return { value: Math.round(ms / 60000), unitId: 'minutes' }
}

// Rebuild the {value,unit} interval from the dropdowns (ms).
function freqFromDropdowns () {
  const v = parseInt(els.setFreqMin.value, 10)
  const u = FREQ_UNITS.find((x) => x.id === els.setFreqUnit.value) || FREQ_UNITS[1]
  return (isFinite(v) && v > 0 ? v : 1) * u.ms
}

function formatFreq (ms) {
  const { value, unitId } = freqSplit(ms)
  const label = FREQ_UNITS.find((u) => u.id === unitId).label
  return `${value} ${label}`
}

function toast (msg, ms = 2600) {
  els.toast.textContent = msg
  els.toast.classList.add('show')
  clearTimeout(toast._t)
  toast._t = setTimeout(() => els.toast.classList.remove('show'), ms)
}

function setGpsStatus (msg) { els.gpsStatus.textContent = 'Location: ' + msg }

// Show/hide the offline-queue status line ("N check-ins queued (offline)" or a
// transient "N synced" notice after a peer connects).
function setQueued (msg) {
  if (!els.queuedRow) return
  const count = Number(msg && msg.count) || 0
  if (count > 0) {
    els.queuedRow.style.display = 'flex'
    els.queuedStatus.textContent = count + ' check-in' + (count === 1 ? '' : 's') + ' queued (offline)'
    els.queuedStatus.style.color = 'var(--accent)'
  } else if (msg && msg.synced) {
    els.queuedRow.style.display = 'flex'
    els.queuedStatus.textContent = 'Synced ' + msg.synced + ' offline check-in' + (msg.synced === 1 ? '' : 's')
    els.queuedStatus.style.color = 'var(--green)'
    setTimeout(() => { els.queuedRow.style.display = 'none' }, 4000)
  } else {
    els.queuedRow.style.display = 'none'
  }
}

// --- state -------------------------------------------------------------------
const state = {
  globe: null,
  intervalMs: DEFAULT_INTERVAL_MS,
  contacts: [], // cached list from main
  manual: { enabled: false, lat: null, lng: null },
  pinScale: 1,
  colored: getColored(),
  arcs: getArcs(),
  selfName: '',
  precisionKm: 0,
  atrest: false
}

// --- globe (rendered FIRST so a slow/absent pipe never blanks the page) -------
function initGlobe () {
  state.globe = createRenderer($('globe'), { onPinClick: showPinOverlay, colored: state.colored, showArcs: state.arcs })
}

function syncColorToggle () {
  if (!els.colorToggle || !els.colorVal) return
  els.colorVal.textContent = state.colored ? 'On' : 'Off'
}

function onColorToggle () {
  state.colored = !state.colored
  setColored(state.colored)
  syncColorToggle()
  if (state.globe && typeof state.globe.setColored === 'function') state.globe.setColored(state.colored)
  toast('Colored countries: ' + (state.colored ? 'on' : 'off'))
}

function syncArcsToggle () {
  if (!els.arcsToggle || !els.arcsVal) return
  els.arcsVal.textContent = state.arcs ? 'On' : 'Off'
}

function onArcsToggle () {
  state.arcs = !state.arcs
  setArcs(state.arcs)
  syncArcsToggle()
  if (state.globe && typeof state.globe.setArcs === 'function') state.globe.setArcs(state.arcs)
  toast('Connecting lines: ' + (state.arcs ? 'on' : 'off'))
}

function showPinOverlay (data) {
  if (data.self) {
    els.pinName.textContent = state.selfName || 'You'
    els.pinTime.textContent = '—'
    els.pinAgo.textContent = '—'
    els.pinStatus.textContent = 'self'
    els.pinCoords.textContent = (typeof data.lat === 'number' && typeof data.lng === 'number')
      ? round(data.lat) + ', ' + round(data.lng)
      : '\u2014'
    els.pinFingerprint.textContent = '—'
  } else {
    const c = data.contact
    els.pinName.textContent = c.nickname || c.lastName || 'Contact'
    els.pinTime.textContent = formatLocal(c.lastSeenTs)
    els.pinAgo.textContent = humanize(c.lastSeenTs)
    els.pinStatus.textContent = data.status
    els.pinCoords.textContent = (typeof data.lat === 'number' && typeof data.lng === 'number')
      ? round(data.lat) + ', ' + round(data.lng)
      : '\u2014'
    els.pinFingerprint.textContent = fingerprint(c.publicKeyB64) || '—'
    els.pinFingerprint.title = 'Verify this over a second channel before sharing real location.'
  }
  els.pinOverlay.style.display = 'block'
  els.pinOverlay.style.left = '50%'
  els.pinOverlay.style.top = '18%'
  els.pinOverlay.style.transform = 'translateX(-50%)'

  // Center the map on the clicked pin.
  if (state.globe && typeof state.globe.centerOn === 'function' && typeof data.lat === 'number' && typeof data.lng === 'number') {
    state.globe.centerOn(data.lat, data.lng)
  }
}
$('pin-close').addEventListener('click', () => { els.pinOverlay.style.display = 'none' })

// --- pipe client ---------------------------------------------------------------
const pipe = getPipe()
const pending = new Map() // request id -> {resolve,reject}
let reqSeq = 0

function request (type, payload = {}, timeoutMs = 8000) {
  if (!pipe) return Promise.reject(new Error('No pipe to main process'))
  const id = 'r-' + (++reqSeq) + '-' + Date.now()
  pipe.write(JSON.stringify({ id, type, ...payload }))
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    setTimeout(() => {
      if (!pending.has(id)) return
      pending.delete(id)
      reject(new Error('Request timed out: ' + type))
    }, timeoutMs)
  })
}

// Geolocation is browser-only. The main process asks for a fix via gps:request.
function getPositionOnce () {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Geolocation not available'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: false, timeout: GPS_TIMEOUT_MS, maximumAge: 60000 }
    )
  })
}

function handlePush (msg) {
  if (!msg || typeof msg !== 'object') return

  // Correlated responses to our requests carry an id we are waiting on.
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.type === 'error') p.reject(new Error(msg.message || 'error'))
    else p.resolve(msg)
    // Fall through so pushes that also carry state (e.g. contact:added) can update UI.
  }

  switch (msg.type) {
    case 'peers': {
      els.peerDot.classList.toggle('on', msg.verified > 0)
      els.peerStatus.textContent = msg.verified > 0
        ? `${msg.verified} contact${msg.verified === 1 ? '' : 's'} connected`
        : (msg.connecting > 0 ? 'Connecting to contacts\u2026' : (state.contacts.length ? 'Waiting for contacts\u2026' : 'No contacts yet'))
      break
    }
    case 'contact:update': {
      upsertContact(msg.contact)
      // A live check-in from a contact that's newer than this session's boot
      // marks the contact NEW (cleared when their history is opened).
      if (msg.contact.lastSeenTs > bootTs) markUnread(msg.contact.id)
      break
    }
    case 'contact:remove-pin': {
      state.globe.removeContactPin(msg.contactId)
      break
    }
    case 'self': {
      state.globe.setSelf({ lat: msg.lat, lng: msg.lng })
      setGpsStatus(statusSuffix('checked in ' + humanize(msg.timestamp)))
      break
    }
    case 'pending': {
      setQueued(msg)
      break
    }
    case 'gps:request': {
      getPositionOnce()
        .then(({ lat, lng }) => pipe.write(JSON.stringify({ type: 'gps:result', id: msg.id, lat, lng })))
        .catch((err) => pipe.write(JSON.stringify({ type: 'gps:result', id: msg.id, error: String((err && err.message) || err) })))
      break
    }
    case 'status': {
      setGpsStatus(statusSuffix(msg.message))
      break
    }
  }
}

// When manual override is on, tag the GPS status line so it's visible.
function statusSuffix (msg) {
  const m = state.manual
  if (m && m.enabled && typeof m.lat === 'number' && typeof m.lng === 'number') {
    return `${msg} · manual: ${round(m.lat)},${round(m.lng)}`
  }
  return msg
}
function round (n) { return Math.round(n * 10000) / 10000 }

function upsertContact (contact) {
  if (!contact) return
  const i = state.contacts.findIndex((c) => c.id === contact.id)
  if (i >= 0) state.contacts[i] = { ...state.contacts[i], ...contact }
  else state.contacts.push(contact)

  const status = classify(contact.lastSeenTs, contact.intervalMs)
  // Keep the pin at every staleness stage (green -> yellow -> red) so the last
  // known position stays visible as it ages; only never-broadcast contacts have
  // no pin.
  if (typeof contact.lat === 'number' && typeof contact.lng === 'number') {
    const pinStatus = status === STATUS.STALE ? 'stale' : status === STATUS.OFFLINE ? 'offline' : 'active'
    state.globe.upsertContactPin(contact, { lat: contact.lat, lng: contact.lng }, pinStatus)
  }
  renderContactsList()
}

// --- staleness sweep (display only; main owns the data) ------------------------
function startStalenessSweep () {
  setInterval(() => {
    for (const c of state.contacts) {
      const status = classify(c.lastSeenTs, c.intervalMs)
      const prev = quietNotified.get(c.id)
      // Notify once per transition into stale/offline (never on first sight, so
      // booting into an already-quiet contact is silent).
      if ((status === STATUS.STALE || status === STATUS.OFFLINE) &&
          prev && prev !== status && prev !== STATUS.NEVER && c.lastSeenTs) {
        notifyQuiet(c)
      }
      quietNotified.set(c.id, status)
      // Age the pin's color as a contact goes stale/offline (green -> yellow ->
      // red) instead of removing it, so the last known position stays visible.
      const hasCoords = typeof c.lat === 'number' && typeof c.lng === 'number'
      if (hasCoords && state.globe.hasPin(c.id)) {
        if (status === STATUS.OFFLINE) state.globe.upsertContactPin(c, { lat: c.lat, lng: c.lng }, 'offline')
        else if (status === STATUS.STALE) state.globe.upsertContactPin(c, { lat: c.lat, lng: c.lng }, 'stale')
        else if (status === STATUS.ACTIVE) state.globe.upsertContactPin(c, { lat: c.lat, lng: c.lng }, 'active')
      }
    }
    renderContactsList()
  }, 30000)
}

// The globe pin holds the last coords we rendered; read them back for re-tints.
function pinCoords (contactId) {
  const c = state.contacts.find((x) => x.id === contactId)
  return { lat: c.lat, lng: c.lng }
}

// --- contacts UI ---------------------------------------------------------------
// NEW-contact badge state: a contact is "new/unread" if it checked in since the
// app was last open (persisted lastOpenTs) or received a live check-in after
// this session's boot. Cleared when the row is tapped (history opened).
const UNREAD_KEY = 'ichnaea-seen'
let bootTs = Date.now()
let unreadIds = new Set()
const quietNotified = new Map() // contactId -> last staleness status seen (#9)

function loadUnread () {
  try {
    const s = JSON.parse(localStorage.getItem(UNREAD_KEY) || '{}')
    return { lastOpen: Number(s.lastOpen) || 0, unread: Array.isArray(s.unread) ? s.unread : [] }
  } catch { return { lastOpen: 0, unread: [] } }
}

function saveUnread () {
  try { localStorage.setItem(UNREAD_KEY, JSON.stringify({ lastOpen: Date.now(), unread: [...unreadIds] })) } catch { /* ignore */ }
}

// Seed the unread set from check-ins that happened while the app was closed.
function seedUnread (contacts) {
  const seen = loadUnread()
  unreadIds = new Set(seen.unread)
  const prevOpen = seen.lastOpen
  for (const c of contacts) {
    if (c.lastSeenTs > prevOpen) unreadIds.add(c.id)
  }
  saveUnread()
}

function markUnread (id) {
  if (!unreadIds.has(id)) { unreadIds.add(id); saveUnread(); renderContactsList() }
}

function markRead (id) {
  if (unreadIds.has(id)) { unreadIds.delete(id); saveUnread() }
}

// "Notify when a contact goes quiet" toggle (renderer-local preference, like the
// map style). Default on.
const QUIET_KEY = 'ichnaea-quiet-notify'
function getQuietNotify () {
  try { return localStorage.getItem(QUIET_KEY) !== '0' } catch { return true }
}
function setQuietNotify (v) {
  try { localStorage.setItem(QUIET_KEY, v ? '1' : '0') } catch { /* ignore */ }
}

// Post a local "X went quiet" notification when a contact goes stale/offline.
// Local-only, no coordinates in the payload. Android uses the IchnaeaNotify
// native plugin; other environments use the Web Notification API if available.
function notifyQuiet (c) {
  if (!getQuietNotify()) return
  const name = c.nickname || c.lastName || 'Contact'
  const title = name + ' went quiet'
  const body = 'Last check-in ' + humanize(c.lastSeenTs)
  const cap = typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.IchnaeaNotify
  if (cap) {
    cap.notify({ title, body }).catch(() => {})
    return
  }
  if (typeof Notification !== 'undefined') {
    try {
      if (Notification.permission === 'granted') new Notification(title, { body })
      else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then((p) => { if (p === 'granted') new Notification(title, { body }) }).catch(() => {})
      }
    } catch { /* ignore */ }
  }
}

// Open the check-in history timeline panel for a contact.
async function openHistory (c) {
  if (!els.modalHistory) return
  els.historyTitle.textContent = (c.nickname || c.lastName || 'Contact') + ' \u2014 recent check-ins'
  els.historyList.innerHTML = 'Loading\u2026'
  openModal(els.modalHistory)
  let entries = []
  try {
    const res = await request('contact:history', { contactId: c.id, limit: 20 }, 15000)
    entries = res.entries || []
  } catch {
    entries = []
  }
  if (!entries.length) {
    els.historyList.innerHTML = '<div class="empty">No check-in history yet.</div>'
    return
  }
  els.historyList.innerHTML = ''
  for (const e of entries) {
    const row = document.createElement('div')
    row.className = 'history-row'
    const t = document.createElement('span')
    t.className = 'history-time'
    t.textContent = (e.timestamp ? formatLocal(e.timestamp) + ' \u00b7 ' + humanize(e.timestamp) : '\u2014')
    const coords = document.createElement('span')
    coords.className = 'history-coords'
    coords.textContent = round(e.lat) + ', ' + round(e.lng)
    row.append(t, coords)
    els.historyList.appendChild(row)
  }
}

function renderContactsList () {
  const list = els.contactsList
  if (!state.contacts.length) {
    list.innerHTML = '<div class="empty">No contacts yet. Add one to begin.</div>'
    return
  }
  list.innerHTML = ''
  for (const c of state.contacts) {
    const item = document.createElement('div')
    item.className = 'contact-item'
    const status = classify(c.lastSeenTs, c.intervalMs)
    const dot = document.createElement('span')
    dot.className = 'dot on' + (status === STATUS.STALE ? '-stale' : status === STATUS.OFFLINE ? '-offline' : '')
    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = c.nickname || c.lastName || 'Unnamed'
    name.title = c.lastName && c.lastName !== c.nickname ? ('Them: ' + c.lastName) : ''
    const ago = document.createElement('span')
    ago.className = 'ago'
    ago.textContent = c.lastSeenTs ? humanize(c.lastSeenTs) : 'never'
    const rm = document.createElement('button')
    rm.className = 'rm'
    rm.textContent = '×'
    rm.title = 'Remove contact'
    rm.addEventListener('click', (e) => { e.stopPropagation(); onRemoveContact(c) })
    const top = document.createElement('div')
    top.className = 'contact-top'
    if (unreadIds.has(c.id)) {
      item.classList.add('unread')
      const badge = document.createElement('span')
      badge.className = 'new-badge'
      badge.textContent = 'NEW'
      top.append(badge)
    }
    top.append(dot, name, ago, rm)
    item.appendChild(top)
    if (typeof c.lat === 'number' && typeof c.lng === 'number') {
      const coords = document.createElement('div')
      coords.className = 'contact-coords'
      coords.textContent = round(c.lat) + ', ' + round(c.lng)
      item.appendChild(coords)
    }
    const fp = fingerprint(c.publicKeyB64)
    if (fp) {
      const fpEl = document.createElement('div')
      fpEl.className = 'contact-fingerprint'
      fpEl.textContent = fp
      fpEl.title = 'Verify this over a second channel before sharing real location.'
      item.appendChild(fpEl)
    }
    // Tap a contact row to open its check-in history (and clear any NEW badge).
    item.addEventListener('click', () => {
      markRead(c.id)
      openHistory(c)
    })
    // Long-press (touch) to rename; right-click on desktop.
    if ('ontouchstart' in window) {
      let longPress = null
      item.addEventListener('touchstart', (e) => {
        longPress = setTimeout(() => { longPress = null; onRenameContact(c) }, 550)
      }, { passive: true })
      item.addEventListener('touchend', () => { if (longPress) clearTimeout(longPress) })
      item.addEventListener('touchmove', () => { if (longPress) clearTimeout(longPress) }, { passive: true })
    } else {
      item.addEventListener('contextmenu', (e) => { e.preventDefault(); onRenameContact(c) })
    }
    list.appendChild(item)
  }
}

async function onRenameContact (c) {
  const current = c.nickname || c.lastName || ''
  const next = prompt('Rename this contact (local only):', current)
  if (next === null) return // cancelled
  const name = String(next || '').trim()
  if (!name) return
  try {
    const res = await request('contact:rename', { contactId: c.id, nickname: name })
    upsertContact(res.contact)
    toast('Contact renamed')
  } catch (err) {
    toast('Rename failed: ' + String(err.message || err))
  }
}

async function onRemoveContact (c) {
  if (!confirm(`Remove ${c.nickname}? This leaves the shared swarm.`)) return
  try {
    await request('contact:remove', { contactId: c.id })
    state.contacts = state.contacts.filter((x) => x.id !== c.id)
    state.globe.removeContactPin(c.id)
    renderContactsList()
    toast('Contact removed')
  } catch (err) {
    toast('Remove failed: ' + String(err.message || err))
  }
}

// --- UI wiring -----------------------------------------------------------------
function initUI () {
  // Frequency dropdowns: minutes 1..59, hours 1..48, days 1..30.
  for (let i = 1; i <= 59; i++) {
    const o = document.createElement('option')
    o.value = String(i)
    o.textContent = String(i)
    els.setFreqMin.appendChild(o)
  }
  for (const u of FREQ_UNITS) {
    const o = document.createElement('option')
    o.value = u.id
    o.textContent = u.label
    els.setFreqUnit.appendChild(o)
  }
  const { value: fv, unitId: fu } = freqSplit(state.intervalMs)
  els.setFreqMin.value = String(fv)
  els.setFreqUnit.value = fu

  const currentStyle = getMapStyleId()
  for (const s of MAP_STYLES) {
    const o = document.createElement('option')
    o.value = s.id
    o.textContent = s.name
    if (s.id === currentStyle) o.selected = true
    els.setMapStyle.appendChild(o)
  }

  const PRECISION_OPTIONS = [
    { km: 0, label: 'Off (exact)' },
    { km: 5, label: '~5 km' },
    { km: 10, label: '~10 km' },
    { km: 25, label: '~25 km' },
    { km: 50, label: '~50 km' }
  ]
  for (const p of PRECISION_OPTIONS) {
    const o = document.createElement('option')
    o.value = String(p.km)
    o.textContent = p.label
    if (p.km === state.precisionKm) o.selected = true
    els.setPrecision.appendChild(o)
  }

  $('btn-add-contact').addEventListener('click', () => openModal(els.modalAdd))
  $('btn-settings').addEventListener('click', () => {
    const { value: fv, unitId: fu } = freqSplit(state.intervalMs)
    els.setFreqMin.value = String(fv)
    els.setFreqUnit.value = fu
    els.pinScale.value = String(state.pinScale)
    els.pinsizeVal.textContent = state.pinScale.toFixed(1) + '×'
    if (els.setSelfName) els.setSelfName.value = state.selfName
    if (els.setPrecision) els.setPrecision.value = String(state.precisionKm)
    if (els.quietNotify) els.quietNotify.checked = getQuietNotify()
    syncEncryptUI()
    syncManualUI()
    openModal(els.modalSet)
  })
  $('add-cancel').addEventListener('click', () => closeModal(els.modalAdd))
  $('set-cancel').addEventListener('click', () => closeModal(els.modalSet))
  $('add-confirm').addEventListener('click', onAddContact)
  $('set-confirm').addEventListener('click', onSaveSettings)
  $('btn-checkin-now').addEventListener('click', onCheckinNow)
  if (els.btnCheckUpdates) {
    els.btnCheckUpdates.addEventListener('click', onCheckUpdates)
  }
  if (els.unlockConfirm) {
    els.unlockConfirm.addEventListener('click', onUnlock)
    els.unlockPass.addEventListener('keydown', (e) => { if (e.key === 'Enter') onUnlock() })
  }
  if (els.btnEncrypt) {
    els.btnEncrypt.addEventListener('click', onEncryptToggle)
  }
  if (els.quietNotify) {
    els.quietNotify.checked = getQuietNotify()
    els.quietNotify.addEventListener('change', () => setQuietNotify(els.quietNotify.checked))
  }
  if (els.historyClose) {
    els.historyClose.addEventListener('click', () => closeModal(els.modalHistory))
  }
  if (els.broadcastNudgeNow) {
    els.broadcastNudgeNow.addEventListener('click', () => { closeModal(els.modalBroadcastNudge); onCheckinNow() })
    els.broadcastNudgeLater.addEventListener('click', () => closeModal(els.modalBroadcastNudge))
  }
  if (els.manualCheckinOk) {
    els.manualCheckinOk.addEventListener('click', onManualPromptCheckin)
    els.manualCheckinCancel.addEventListener('click', () => closeModal(els.modalManualCheckin))
    els.manualCheckinClose.addEventListener('click', () => closeModal(els.modalManualCheckin))
  }
  if (els.citySearch) {
    let debounce = null
    els.citySearch.addEventListener('input', (e) => {
      clearTimeout(debounce)
      const q = e.target.value
      debounce = setTimeout(() => onCitySearch(q), 150)
    })
    // Enter on the search dismisses the keyboard without broadcasting.
    els.citySearch.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); els.citySearch.blur() }
    })
  }
  if (els.btnScanQr) {
    els.btnScanQr.addEventListener('click', onScanQr)
  }
  if (els.addPub) {
    els.addPub.addEventListener('input', updateAddFingerprint)
    updateAddFingerprint()
  }

  const toggleMin = (panel, btn) => {
    const collapsed = panel.classList.toggle('collapsed')
    btn.textContent = collapsed ? '+' : '–'
    btn.title = collapsed ? 'Expand' : 'Minimize'
  }
  $('min-beacon').addEventListener('click', () => toggleMin(els.panelTopleft, $('min-beacon')))
  $('min-contacts').addEventListener('click', () => toggleMin(els.panelContacts, $('min-contacts')))


  els.pinScale.addEventListener('input', () => {
    const v = parseFloat(els.pinScale.value)
    state.pinScale = v
    els.pinsizeVal.textContent = v.toFixed(1) + '×'
    try { window.localStorage.setItem('pinScale', String(v)) } catch {}
    if (state.globe && typeof state.globe.setPinScale === 'function') state.globe.setPinScale(v)
  })
  try {
    const ps = parseFloat(window.localStorage.getItem('pinScale'))
    if (isFinite(ps) && ps > 0) { state.pinScale = ps; els.pinScale.value = String(ps); els.pinsizeVal.textContent = ps.toFixed(1) + '×' }
  } catch {}
  if (state.globe && typeof state.globe.setPinScale === 'function') state.globe.setPinScale(state.pinScale)

  $('btn-manual-checkin').addEventListener('click', onManualCheckin)
  els.manualEnabled.addEventListener('change', onManualToggle)

  els.myPubkey.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(els.myPubkey.textContent)
      toast('Public key copied')
    } catch { toast('Copy failed — select and copy manually') }
  })

  if (els.colorToggle) {
    els.colorToggle.addEventListener('click', onColorToggle)
    syncColorToggle()
  }
  if (els.arcsToggle) {
    els.arcsToggle.addEventListener('click', onArcsToggle)
    syncArcsToggle()
  }
  if (els.btnQr) {
    els.btnQr.addEventListener('click', openQrModal)
    if (els.qrClose) els.qrClose.addEventListener('click', () => closeModal(els.modalQr))
    if (els.qrKey) {
      els.qrKey.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(els.qrKey.textContent)
          toast('Public key copied')
        } catch { toast('Copy failed — select and copy manually') }
      })
    }
  }

  els.versionTag.addEventListener('dblclick', () => { syncStyleToggleLabel(); els.devPanel.classList.toggle('open') })
  $('btn-dev-close').addEventListener('click', () => els.devPanel.classList.remove('open'))
  $('btn-force-200').addEventListener('click', onForce200)
  $('btn-rotate-logkey').addEventListener('click', onRotateLogKey)
  $('btn-toggle-globe').addEventListener('click', onCycleMapStyle)
}

function syncStyleToggleLabel () {
  const btn = $('btn-toggle-globe')
  if (!btn) return
  const cur = getMapStyleId()
  const i = MAP_STYLES.findIndex((s) => s.id === cur)
  const next = MAP_STYLES[(i + 1) % MAP_STYLES.length]
  btn.textContent = 'Next map: ' + next.name
}

function onCycleMapStyle () {
  const cur = getMapStyleId()
  const i = MAP_STYLES.findIndex((s) => s.id === cur)
  const next = MAP_STYLES[(i + 1) % MAP_STYLES.length]
  setMapStyleId(next.id)
  toast('Map: ' + next.name + '…')
  setTimeout(() => window.location.reload(), 300)
}

function openModal (m) { m.classList.add('open') }
function closeModal (m) { m.classList.remove('open'); const e = m.querySelector('.form-error'); if (e) e.textContent = '' }

// QR share of your public key — scannable by a friend's phone to add you as a
// contact. Generated locally (qrcode lib, bundled — no network).
async function openQrModal () {
  const key = els.myPubkey.textContent || ''
  if (!key || key === '…' || key === '') {
    toast('No public key yet')
    return
  }
  try {
    els.qrKey.textContent = key
    if (els.qrCanvas && els.qrCanvas.getContext) {
      const size = Math.min(els.qrCanvas.clientWidth || 260, 260)
      await QRCode.toCanvas(els.qrCanvas, key, { margin: 2, width: size, errorCorrectionLevel: 'M' })
    }
    openModal(els.modalQr)
  } catch (err) {
    toast('QR failed: ' + String(err && err.message || err))
  }
}

function syncManualUI () {
  const m = state.manual || {}
  els.manualEnabled.checked = Boolean(m.enabled)
  if (typeof m.lat === 'number') els.manualLat.value = String(m.lat)
  if (typeof m.lng === 'number') els.manualLng.value = String(m.lng)
}

function readManualInputs () {
  const lat = parseFloat(els.manualLat.value)
  const lng = parseFloat(els.manualLng.value)
  if (!isFinite(lat) || lat < -90 || lat > 90) throw new Error('Latitude must be −90..90')
  if (!isFinite(lng) || lng < -180 || lng > 180) throw new Error('Longitude must be −180..180')
  return { lat, lng }
}

// Live safety-number preview under the Add Contact key field, so the user can
// verify the fingerprint *before* saving the contact.
function updateAddFingerprint () {
  if (!els.addFingerprint) return
  const key = (els.addPub.value || '').trim()
  const fp = key ? fingerprint(key) : null
  els.addFingerprint.textContent = fp
    ? 'Fingerprint: ' + fp
    : 'Paste or scan a key to see its fingerprint.'
  els.addFingerprint.title = fp
    ? 'Verify this over a second channel before sharing real location.'
    : ''
}

async function onAddContact () {
  els.addErr.textContent = ''
  try {
    const res = await request('contact:add', { nickname: els.addNick.value, publicKeyB64: els.addPub.value })
    upsertContact(res.contact)
    closeModal(els.modalAdd)
    els.addNick.value = ''; els.addPub.value = ''
    updateAddFingerprint()
    toast(`Added ${res.contact.nickname}`)
    // Nudge: offer to broadcast right after adding a peer, so the first
    // check-in isn't left to the (default 1-day) schedule.
    if (els.modalBroadcastNudge) {
      openModal(els.modalBroadcastNudge)
    }
  } catch (err) {
    els.addErr.textContent = String(err.message || err)
  }
}

// Scan a friend's QR code with the camera and fill the public-key field.
async function onScanQr () {
  els.addErr.textContent = ''
  closeModal(els.modalAdd)
  try {
    const text = await openScanner()
    if (text) {
      // Normalize: our keys are raw base64 (no scheme prefix); strip any
      // "ichnaea:" / "beacon:" prefix a future QR variant might carry.
      els.addPub.value = text.replace(/^(ichnaea|beacon|iot):/i, '').trim()
      updateAddFingerprint()
      openModal(els.modalAdd)
      if (!els.addPub.value) {
        els.addErr.textContent = 'That QR didn\u2019t contain a public key'
      }
    } else {
      openModal(els.modalAdd) // cancelled
    }
  } catch (err) {
    openModal(els.modalAdd)
    els.addErr.textContent = 'Camera unavailable: ' + String(err && err.message || err)
  }
}

// Manual update check (Settings → Check for updates). Only makes a network
// request when tapped — no traffic on boot or in the background.
async function onCheckUpdates () {
  if (!els.btnCheckUpdates) return
  els.btnCheckUpdates.disabled = true
  els.updatesStatus.textContent = '…'
  els.updatesDetail.textContent = 'Checking GitHub…'
  const res = await checkForUpdates()
  els.btnCheckUpdates.disabled = false
  if (!res.ok) {
    els.updatesStatus.textContent = ''
    els.updatesDetail.textContent = 'Couldn’t check: ' + (res.error || 'network error')
    return
  }
  if (res.updateAvailable) {
    els.updatesStatus.textContent = '!'
    els.updatesDetail.textContent = `v${res.current} → v${res.latest} available. ` +
      `Tap to download: ${res.assetUrl || res.releaseUrl}`
    els.updatesDetail.title = res.assetUrl || res.releaseUrl
    els.updatesDetail.style.cursor = 'pointer'
    els.updatesDetail.onclick = () => { if (res.assetUrl) window.open(res.assetUrl, '_blank') }
  } else {
    els.updatesStatus.textContent = '✓'
    els.updatesDetail.textContent = `You're up to date (v${res.current}).`
    els.updatesDetail.onclick = null
    els.updatesDetail.style.cursor = 'default'
  }
}

function syncFreqDisplay () {
  if (els.freqDisplay) els.freqDisplay.textContent = 'Broadcast: every ' + formatFreq(state.intervalMs)
}

// Reflect the current at-rest-encryption state in the Settings "Local data" row.
function syncEncryptUI () {
  if (!els.btnEncrypt) return
  if (state.atrest) {
    els.btnEncrypt.textContent = 'Remove local encryption'
    if (els.encryptStatus) els.encryptStatus.textContent = 'On'
    if (els.encryptDetail) els.encryptDetail.textContent = 'Your local data is encrypted with your passphrase. A forgotten passphrase means unrecoverable data.'
  } else {
    els.btnEncrypt.textContent = 'Encrypt local data'
    if (els.encryptStatus) els.encryptStatus.textContent = 'Off'
    if (els.encryptDetail) els.encryptDetail.textContent = 'Encrypt your local records (identity, contacts, settings) with a passphrase.'
  }
}

// Toggle at-rest encryption from Settings. Enable: prompt for a passphrase
// (twice) and send passphrase:set. Disable: prompt for the passphrase and send
// passphrase:disable. The passphrase crosses the pipe once and never leaves the
// main process after that.
async function onEncryptToggle () {
  if (!els.btnEncrypt) return
  if (state.atrest) {
    const pass = prompt('Enter your current passphrase to remove local encryption:')
    if (pass === null) return
    try {
      await request('passphrase:disable', { passphrase: pass })
      state.atrest = false
      syncEncryptUI()
      toast('Local encryption removed')
    } catch (err) {
      toast('Couldn\u2019t disable: ' + String(err.message || err))
    }
    return
  }
  const pass = prompt('Choose a passphrase to encrypt your local data (min 8 characters):')
  if (pass === null) return
  if (String(pass).length < 8) { toast('Passphrase must be at least 8 characters'); return }
  const confirm = prompt('Confirm your passphrase:')
  if (confirm !== pass) { toast('Passphrases did not match'); return }
  try {
    await request('passphrase:set', { passphrase: pass })
    state.atrest = true
    syncEncryptUI()
    toast('Local data encrypted')
  } catch (err) {
    toast('Couldn\u2019t encrypt: ' + String(err.message || err))
  }
}

// Unlock encrypted local data at boot with the passphrase.
async function onUnlock () {
  const pass = els.unlockPass.value
  els.unlockErr.textContent = ''
  if (!pass) { els.unlockErr.textContent = 'Enter your passphrase'; return }
  try {
    await request('passphrase:unlock', { passphrase: pass })
    closeModal(els.modalUnlock)
    await loadState() // re-load state; the globe/UI were already initialized
  } catch (err) {
    els.unlockErr.textContent = String(err.message || err)
  }
}

async function onSaveSettings () {
  const ms = freqFromDropdowns()
  if (!ms || ms <= 0) { els.setErr.textContent = 'Pick a valid interval'; return }
  try {
    // Persist the manual override flag + coords together with the interval.
    await saveManual()
    if (els.setSelfName) {
      const name = String(els.setSelfName.value || '').trim().slice(0, 40)
      const res = await request('selfname:set', { name })
      state.selfName = res.name
    }
    const res = await request('interval:set', { intervalMs: ms })
    state.intervalMs = res.intervalMs
    syncFreqDisplay()
    if (els.setPrecision) {
      const km = Number(els.setPrecision.value) || 0
      if (km !== state.precisionKm) {
        await request('precision:set', { precisionKm: km })
        state.precisionKm = km
      }
    }
    closeModal(els.modalSet)
    toast('Settings saved')
    // Map style change needs a reload (the renderer is built once at boot).
    if (els.setMapStyle.value && els.setMapStyle.value !== getMapStyleId()) {
      setMapStyleId(els.setMapStyle.value)
      setTimeout(() => window.location.reload(), 400)
    }
  } catch (err) {
    els.setErr.textContent = String(err.message || err)
  }
}

async function onCheckinNow () {
  setGpsStatus(statusSuffix('requesting…'))
  // If a manual override is enabled, use the scheduler path (it uses the stored
  // coords and never touches GPS).
  if (state.manual && state.manual.enabled) {
    try {
      await request('checkin:now')
      return
    } catch (err) {
      setGpsStatus(statusSuffix('unavailable'))
      return
    }
  }
  // Otherwise try GPS directly so that on failure we can prompt for manual
  // coordinates instead of silently giving up.
  try {
    const { lat, lng } = await getPositionOnce()
    await request('checkin:manual', { lat, lng })
    setGpsStatus(statusSuffix('checked in'))
  } catch (err) {
    setGpsStatus(statusSuffix('no GPS — enter coordinates'))
    toast('No GPS fix — enter coordinates to broadcast')
    openModal(els.modalManualCheckin)
    els.manualCheckinErr.textContent = ''
    if (els.citySearch) { els.citySearch.value = ''; els.cityResults.innerHTML = '' }
  }
}

// Search the bundled city dataset and render matches; picking one fills the
// lat/lng inputs. Debounced so a lazy 2.4MB data fetch + scan only happens on
// real input.
async function onCitySearch (query) {
  if (!els.cityResults) return
  if (!query || !query.trim()) { els.cityResults.innerHTML = ''; return }
  els.cityResults.innerHTML = '<div class="label">Searching…</div>'
  let cities = []
  try {
    cities = await searchCities(query, 8)
  } catch (err) {
    els.cityResults.innerHTML = '<div class="label">Couldn\u2019t load city data: ' + String((err && err.message) || err) + '</div>'
    return
  }
  if (!cities.length) {
    els.cityResults.innerHTML = '<div class="label">No matching cities.</div>'
    return
  }
  els.cityResults.innerHTML = ''
  for (const c of cities) {
    const row = document.createElement('div')
    row.className = 'city-row'
    const name = document.createElement('span')
    name.className = 'city-name'
    name.textContent = c.name + (c.cc ? ' (' + c.cc + ')' : '')
    const meta = document.createElement('span')
    meta.className = 'city-meta'
    meta.textContent = round(c.lat) + ', ' + round(c.lng)
    row.append(name, meta)
    row.addEventListener('click', () => {
      els.manualCheckinLat.value = c.lat
      els.manualCheckinLng.value = c.lng
      els.cityResults.innerHTML = ''
      els.manualCheckinErr.textContent = ''
    })
    els.cityResults.appendChild(row)
  }
}

// Submit manually-entered coordinates from the no-GPS prompt.
async function onManualPromptCheckin () {
  els.manualCheckinErr.textContent = ''
  const lat = Number(els.manualCheckinLat.value)
  const lng = Number(els.manualCheckinLng.value)
  if (!isFinite(lat) || lat < -90 || lat > 90 || !isFinite(lng) || lng < -180 || lng > 180) {
    els.manualCheckinErr.textContent = 'Enter valid latitude (−90..90) and longitude (−180..180).'
    return
  }
  try {
    await request('checkin:manual', { lat, lng })
    closeModal(els.modalManualCheckin)
    toast(`Broadcast ${round(lat)},${round(lng)}`)
  } catch (err) {
    els.manualCheckinErr.textContent = String(err.message || err)
  }
}

// One-off manual check-in: append these coords directly (skips GPS). Update the
// pin immediately and synchronously from the typed coords, so it visibly moves
// right away without waiting on the main-process 'self' round-trip.
async function onManualCheckin () {
  els.setErr.textContent = ''
  try {
    const { lat, lng } = readManualInputs()
    state.manual = { ...state.manual, lat, lng }
    if (state.globe && typeof state.globe.setSelf === 'function') {
      state.globe.setSelf({ lat, lng })
    }
    await request('checkin:manual', { lat, lng })
    toast(`Checked in at ${round(lat)},${round(lng)}`)
  } catch (err) {
    els.setErr.textContent = String(err.message || err)
  }
}

async function onManualToggle () {
  try {
    await saveManual()
    toast(els.manualEnabled.checked ? 'Manual location enabled' : 'Manual location disabled')
  } catch (err) {
    els.setErr.textContent = String(err.message || err)
    els.manualEnabled.checked = Boolean(state.manual && state.manual.enabled)
  }
}

// Persist the manual override (coords + enabled flag) to the main process.
async function saveManual () {
  let lat = state.manual ? state.manual.lat : null
  let lng = state.manual ? state.manual.lng : null
  // If both inputs are filled, prefer them; otherwise keep stored coords.
  if (els.manualLat.value !== '' && els.manualLng.value !== '') {
    const c = readManualInputs()
    lat = c.lat; lng = c.lng
  }
  const enabled = els.manualEnabled.checked
  const res = await request('manual:set', { enabled, lat, lng })
  state.manual = res.manual
  setGpsStatus(statusSuffix(els.gpsStatus.textContent.replace(/^Location: /, '').split(' · manual:')[0]))
}

// Dev: force MAX_ENTRIES check-ins to exercise core rotation (done in main).
async function onForce200 () {
  els.devStatus.textContent = 'forcing…'
  try {
    await request('dev:force200', {}, 30000)
    els.devStatus.textContent = 'rotated.'
  } catch (err) {
    els.devStatus.textContent = 'error: ' + String(err.message || err)
  }
}

// Dev: rotate the log key (forward secrecy) + core on demand.
async function onRotateLogKey () {
  els.devStatus.textContent = 'rotating log key…'
  try {
    await request('dev:rotate-logkey', {}, 30000)
    els.devStatus.textContent = 'log key rotated.'
  } catch (err) {
    els.devStatus.textContent = 'error: ' + String(err.message || err)
  }
}

// --- boot ------------------------------------------------------------------------
async function boot () {
  // Globe first — renders even if the pipe/main is slow or absent. This one-time
  // setup runs once; unlocking encrypted local data re-loads state (not UI).
  initGlobe()
  initUI()
  startStalenessSweep()

  if (!pipe) {
    setGpsStatus('no pipe to main process')
    els.peerStatus.textContent = 'Main process unavailable'
    return
  }

  pipe.on('data', (data) => {
    let msg = null
    try {
      msg = JSON.parse(new TextDecoder().decode(data))
    } catch { return }
    handlePush(msg)
  })

  // Android: ask for notification permission once at boot (quiet-contact alerts).
  const cap = typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.IchnaeaNotify
  if (cap && typeof cap.requestPermissions === 'function') cap.requestPermissions().catch(() => {})

  // Reconnect (#6): if the main process drops, don't auto-exit — surface
  // "reconnecting…" and reload the renderer with backoff so it re-attaches to a
  // still-alive main (which delays its own exit for 30s to allow this).
  if (typeof pipe.autoexit !== 'undefined') pipe.autoexit = false
  const reconnect = createBackoff({ base: 1000, max: 30000 })
  let reconnecting = false
  pipe.on('close', () => {
    if (reconnecting) return
    reconnecting = true
    setGpsStatus('main process disconnected · reconnecting…')
    els.peerStatus.textContent = 'Reconnecting…'
    setTimeout(() => { try { location.reload() } catch { /* not a browser */ } }, reconnect.next())
  })

  await loadState()
}

// Ask the main process for the current state and render it. Re-run after
// unlocking encrypted local data; it does NOT re-init the globe/UI.
async function loadState () {
  const res = await request('boot')
  if (res.locked) {
    // Local data is passphrase-encrypted — prompt for the passphrase first.
    state.atrest = true
    openModal(els.modalUnlock)
    els.unlockErr.textContent = ''
    els.unlockPass.value = ''
    els.unlockPass.focus()
    return
  }
  state.atrest = Boolean(res.atrest)
  syncEncryptUI()
  setQueued({ count: Number(res.pendingCount) || 0 })
  els.myPubkey.textContent = res.publicKeyB64
  state.intervalMs = res.intervalMs || DEFAULT_INTERVAL_MS
  const { value: fv, unitId: fu } = freqSplit(state.intervalMs)
  els.setFreqMin.value = String(fv)
  els.setFreqUnit.value = fu
  syncFreqDisplay()
  state.manual = res.manual || { enabled: false, lat: null, lng: null }
  state.contacts = res.contacts || []
  seedUnread(state.contacts)
  state.selfName = res.selfName || ''
  state.precisionKm = typeof res.precisionKm === 'number' ? res.precisionKm : 0
  if (els.setPrecision) els.setPrecision.value = String(state.precisionKm)
  if (res.selfLoc) state.globe.setSelf(res.selfLoc)
  // Restore each contact's cached pin at boot (green/yellow/red by staleness),
  // so arcs show for every contact with coords even before any live update.
  for (const c of state.contacts) {
    if (typeof c.lat === 'number' && typeof c.lng === 'number') {
      const status = classify(c.lastSeenTs, c.intervalMs)
      const pinStatus = status === STATUS.STALE ? 'stale' : status === STATUS.OFFLINE ? 'offline' : 'active'
      state.globe.upsertContactPin(c, { lat: c.lat, lng: c.lng }, pinStatus)
    }
  }
  renderContactsList()
}

// --- start ---------------------------------------------------------------------
// Surface any uncaught error on-page so a blank globe is never silent.
function showFatal (msg) {
  els.peerStatus.textContent = 'Error: ' + msg
  els.peerDot.classList.remove('on')
  let box = document.getElementById('fatal-box')
  if (!box) {
    box = document.createElement('div')
    box.id = 'fatal-box'
    box.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:99;background:rgba(80,10,10,0.92);color:#ffd7d7;border:1px solid #ff6b6b;border-radius:10px;padding:10px 14px;font:12px ui-monospace,monospace;max-width:80vw;white-space:pre-wrap;'
    document.body.appendChild(box)
  }
  box.textContent = 'Boot error:\n' + msg
}
window.addEventListener('error', (e) => showFatal(String(e.message || e.error || e)))
window.addEventListener('unhandledrejection', (e) => showFatal(String((e.reason && e.reason.message) || e.reason || e)))

boot().catch((err) => {
  console.error('boot failed:', err)
  setGpsStatus('error')
  showFatal(String((err && err.message) || err))
})
