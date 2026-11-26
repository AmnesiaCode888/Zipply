const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')

test('sidebar drag batches movements and persists the last width even before the next frame', () => {
  const file = path.resolve('src/renderer/src/hooks/useSidebarResize.ts')
  const built = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
  const original = { load: Module._load, window: global.window, document: global.document, storage: global.localStorage, raf: global.requestAnimationFrame, cancel: global.cancelAnimationFrame }
  const slots = []; let cursor = 0; let effects = []; let frame; let frameId = 0; const handlers = {}; const storage = new Map(); let widthUpdates = 0
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { if (i === 0) widthUpdates++; slots[i] = typeof value === 'function' ? value(slots[i]) : value }] },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i] },
    useCallback(fn) { cursor++; return fn },
    useEffect(fn, deps) { const i = cursor++; const previous = slots[i]; if (!previous || deps.some((value, j) => value !== previous.deps[j])) effects.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: fn() } }) }
  }
  global.document = { body: { style: {} }, addEventListener: (name, fn) => { handlers[name] = fn }, removeEventListener: name => { delete handlers[name] } }
  global.window = { addEventListener: (name, fn) => { handlers[name] = fn }, removeEventListener: name => { delete handlers[name] } }
  global.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }
  global.requestAnimationFrame = fn => { frame = fn; return ++frameId }
  global.cancelAnimationFrame = () => { frame = undefined }
  try {
    Module._load = function (id, ...args) { return id === 'react' ? react : original.load.call(this, id, ...args) }
    const mod = new Module(file, module); mod.filename = file; mod.paths = module.paths; mod._compile(built.outputFiles[0].text, file)
    Module._load = original.load
    const render = () => { cursor = 0; effects = []; const result = mod.exports.useSidebarResize(); effects.forEach(effect => effect()); return result }
    let hook = render()
    hook.startResizing({ preventDefault() {}, stopPropagation() {} })
    render()
    handlers.mousemove({ clientX: 350 }); handlers.mousemove({ clientX: 390 }); handlers.mousemove({ clientX: 400 })
    assert.equal(widthUpdates, 0, 'movement waits until the next frame')
    assert.ok(frame); const callback = frame; frame = undefined; callback()
    hook = render(); assert.equal(hook.sidebarWidth, 344); assert.equal(widthUpdates, 1)
    handlers.mousemove({ clientX: 456 }); handlers.mouseup()
    hook = render(); assert.equal(hook.sidebarWidth, 400)
    assert.equal(storage.get('zipply_sidebar_width'), '400')
    assert.equal(frame, undefined)
  } finally {
    for (const slot of slots) slot?.cleanup?.()
    Module._load = original.load; global.window = original.window; global.document = original.document; global.localStorage = original.storage; global.requestAnimationFrame = original.raf; global.cancelAnimationFrame = original.cancel
  }
})
