const noop = () => {}
const mkEl = () => ({ style:{}, textContent:'', value:'', clientWidth:800, clientHeight:600, width:0, height:0,
  appendChild: noop, addEventListener: noop, remove: noop, setAttribute: noop,
  getBoundingClientRect: () => ({ left:0, top:0 }),
  getContext: () => ({ setTransform:noop, clearRect:noop, fillRect:noop, fill:noop, stroke:noop, beginPath:noop, moveTo:noop, lineTo:noop, arc:noop, setLineDash:noop, save:noop, restore:noop, translate:noop, scale:noop, closePath:noop, drawImage:noop, getImageData:()=>({data:new Uint8ClampedArray(4)}) }),
  classList:{add:noop,remove:noop,toggle:noop},
  querySelector: () => ({ textContent:'', classList:{add:noop,remove:noop} }),
  querySelectorAll: () => [] })
class FakePath2D { constructor(s){this.s=s||''} addPath(){} }
global.Path2D = FakePath2D
global.requestAnimationFrame = noop
global.cancelAnimationFrame = noop
global.window = { addEventListener: noop, devicePixelRatio: 1, innerWidth:800, innerHeight:600, localStorage: { getItem:()=>null, setItem:noop } }
global.document = { body:{ appendChild:noop }, createElement: () => mkEl(), getElementById: () => mkEl(), head:{ appendChild:noop }, querySelector: () => mkEl(), querySelectorAll: () => [] }
global.navigator = { clipboard:{ writeText: async ()=>{}, readText: async ()=>'' }, mediaDevices: undefined }
global.TextDecoder = TextDecoder

process.on('uncaughtException', (e) => { console.log('UNCAUGHT:', e && e.message); process.exit(0) })
process.on('unhandledRejection', (e) => { console.log('UNHANDLED:', e && e.message); process.exit(0) })

try {
  await import('./src/main.js')
  console.log('main.js loaded OK (no boot error in stubbed env)')
} catch (e) {
  console.log('IMPORT ERROR:', e && e.message)
}
