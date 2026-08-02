// Broadcast scheduler. Owns the user-defined interval, fires GPS check-ins,
// and delegates persistence + notification to injected callbacks. The timing
// mechanism is hidden behind an interface so a native (Capacitor) scheduler can
// be swapped in without touching the rest of the app (see the skeleton at the
// bottom).

export const INTERVALS = [
  { label: '1 Hour', ms: 3600000 },
  { label: '6 Hours', ms: 21600000 },
  { label: '12 Hours', ms: 43200000 },
  { label: '1 Day', ms: 86400000 }, // default
  { label: '3 Days', ms: 259200000 },
  { label: '1 Week', ms: 604800000 }
]
export const DEFAULT_INTERVAL_MS = 86400000

const GPS_RETRY_MS = 60000 // retry once after 1 minute on GPS failure
const GPS_TIMEOUT_MS = 15000

// Request a single GPS fix. Never resolves to a null location — rejects instead.
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

// --- Web implementation ------------------------------------------------------
// setTimeout-based, with a visibilitychange + requestIdleCallback wake-up to
// catch a fire that was throttled while the tab was backgrounded. Works only
// while the window is open (the documented web MVP limitation).

export function createWebScheduler ({ onCheckin, onStatus } = {}) {
  let intervalMs = DEFAULT_INTERVAL_MS
  let timer = null
  let running = false
  let firing = false
  let lastFiredAt = 0

  function status (msg) { if (onStatus) onStatus(msg) }

  async function fire () {
    if (firing) return
    firing = true
    lastFiredAt = Date.now()
    try {
      const coords = await getPositionOnce()
      await onCheckin?.({ ...coords, timestamp: Date.now() })
      status('checked in')
    } catch (firstErr) {
      status('location unavailable — retrying in 1 minute')
      await sleep(GPS_RETRY_MS)
      try {
        const coords = await getPositionOnce()
        await onCheckin?.({ ...coords, timestamp: Date.now() })
        status('checked in (after retry)')
      } catch (secondErr) {
        // Give up until the next scheduled fire. Never append a null location.
        status('location unavailable — will try again next interval')
      }
    } finally {
      firing = false
    }
  }

  function scheduleNext () {
    if (!running) return
    clearTimeout(timer)
    timer = setTimeout(async () => {
      await fire()
      scheduleNext()
    }, intervalMs)
  }

  // Catch up after background throttling: if we became visible and a full
  // interval has elapsed since the last fire, fire now.
  function onVisible () {
    if (!running || document.visibilityState !== 'visible') return
    const due = Date.now() - lastFiredAt >= intervalMs
    if (due && !firing) {
      const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1))
      idle(async () => { await fire(); scheduleNext() })
    }
  }

  function start (ms) {
    if (typeof ms === 'number' && ms > 0) intervalMs = ms
    if (running) { scheduleNext(); return intervalMs }
    running = true
    document.addEventListener('visibilitychange', onVisible)
    scheduleNext()
    return intervalMs
  }

  function setIntervalMs (ms) {
    intervalMs = ms
    if (running) scheduleNext() // restart the clock on the new interval
    return intervalMs
  }

  function stop () {
    running = false
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisible)
  }

  // Fire immediately (manual "check in now"), independent of the schedule.
  async function checkinNow () { await fire(); if (running) scheduleNext() }

  return {
    start, stop, setIntervalMs, checkinNow,
    get intervalMs () { return intervalMs },
    get running () { return running }
  }
}

function sleep (ms) { return new Promise((r) => setTimeout(r, ms)) }

// --- Native (Capacitor) implementation — SKELETON, intentionally commented ---
// A production mobile build wraps this app in Capacitor and swaps the web
// scheduler for a native one so check-ins fire even when the app is killed.
// The rest of the app only calls start/stop/setIntervalMs/checkinNow, so no
// other code changes are needed.
//
// import { BackgroundFetch } from '@capacitor/background-fetch'      // iOS
// import { Geolocation } from '@capacitor/geolocation'
// // Android: schedule a periodic WorkManager job via a small native plugin.
//
// export function createCapacitorScheduler ({ onCheckin, onStatus } = {}) {
//   let intervalMs = DEFAULT_INTERVAL_MS
//
//   async function fire () {
//     const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: false })
//     await onCheckin?.({ lat: pos.coords.latitude, lng: pos.coords.longitude, timestamp: Date.now() })
//   }
//
//   async function start (ms) {
//     if (typeof ms === 'number' && ms > 0) intervalMs = ms
//     // iOS — Background Fetch (system-controlled, ~15min minimum cadence):
//     await BackgroundFetch.configure({
//       minimumFetchInterval: Math.max(15, Math.round(intervalMs / 60000)),
//       stopOnTerminate: false,
//       startOnBoot: true
//     }, fire, (err) => onStatus?.('background fetch unavailable'))
//     // Android — register a WorkManager PeriodicWorkRequest with the same
//     // interval; the worker wakes a headless task that calls fire().
//     return intervalMs
//   }
//
//   function stop () { /* BackgroundFetch.stop() + cancel the WorkManager job */ }
//   function setIntervalMs (ms) { intervalMs = ms; return start(ms) }
//   async function checkinNow () { await fire() }
//
//   return { start, stop, setIntervalMs, checkinNow, get intervalMs () { return intervalMs } }
// }
