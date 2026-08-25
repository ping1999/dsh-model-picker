// Client smoke: load lib/client.js through a fake __ModuleLoader__ + react stub,
// verify the module shape (id must equal the package.json name), that apply()
// registers the composer model seat with priority -1, and that the component
// renders without runtime errors (closed trigger and open menu passes).
// Run: node --test tests/client.test.mjs
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const dirStore = {
  subscribe: () => () => {},
  getSnapshot: () => ({
    current: { provider: 'p1', model: 'm1' },
    routable: true,
    groups: [
      { id: 'p1', name: 'DeepSeek', models: [{ id: 'm1', name: 'deepseek-v4-flash', description: 'Fast' }] },
      { id: 'p2', name: 'OpenAI', models: [{ id: 'm2', name: 'gpt-5', description: 'General' }] },
    ],
    failures: [],
    status: 'ready',
    error: null,
  }),
}

function makeCtx(reg, store) {
  const directoryStore = store === undefined ? dirStore : store
  return {
    get(name) {
      if (name === 'slots') {
        return {
          inject(key, cb) { if (key === 'conversation.input.model') reg.value = cb() },
          register(opts, Component) { return { opts, Component } },
        }
      }
      if (name === 'modelDirectories') {
        return { directoryFor: () => ({ store: directoryStore, load: () => {}, select: () => Promise.resolve() }) }
      }
      if (name === 'sessions') return { subagentAddress: () => undefined }
      return undefined
    },
    effect(fn) { return fn() },
  }
}

// Depth-first search the fake createElement tree for a node whose props carry
// the given class token.
function findByClass(node, cls) {
  if (node === null || node === undefined || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByClass(child, cls)
      if (found !== null) return found
    }
    return null
  }
  if (node.tag !== 'el') return null
  const props = node.args[1]
  if (props !== null && typeof props === 'object'
    && String(props.className ?? '').split(' ').includes(cls)) return node
  for (const child of node.args.slice(2)) {
    const found = findByClass(child, cls)
    if (found !== null) return found
  }
  return null
}

function makeReact(stateQueue) {
  let hookIndex = 0
  return {
    createElement: (...a) => ({ tag: 'el', args: a }),
    useState: (init) => [stateQueue === null ? init : stateQueue[hookIndex++], () => {}],
    useEffect: () => {},
    useRef: (v) => ({ current: v }),
    useMemo: (fn) => fn(),
    useSyncExternalStore: (_sub, get) => get(),
    Fragment: 'fragment',
  }
}

const src = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

let loaded = null

// --- Module shape + registration ---
{
  const reg = { value: null }
  const ctx = makeCtx(reg)
  globalThis.window = { __ModuleLoader__: { load: (handoff) => { loaded = handoff } } }
  globalThis.document = {
    head: { appendChild: () => {} },
    getElementById: () => null,
    createElement: () => ({ remove: () => {} }),
  }
  Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true })

  const require = (spec) => {
    if (spec === 'react') return makeReact(null)
    throw new Error('unexpected require: ' + spec)
  }
  const factory = new Function('require', src + '\n;return typeof module !== "undefined" ? module.exports : undefined')
  factory(require)

  if (!loaded) { console.error('FAIL: __ModuleLoader__.load never called'); process.exit(1) }
  if (loaded.id !== pkg.name) { console.error('FAIL: bundle id ' + loaded.id + ' != package name ' + pkg.name); process.exit(1) }

  const mod = loaded.factory(require)
  if (!mod || !Array.isArray(mod.inject) || typeof mod.apply !== 'function') {
    console.error('FAIL: bad module shape'); process.exit(1)
  }
  if (mod.inject.join(',') !== 'slots') { console.error('FAIL: inject=' + mod.inject); process.exit(1) }

  mod.apply(ctx)
  if (!reg.value) { console.error('FAIL: seat not registered'); process.exit(1) }
  if (reg.value.opts.name !== 'conversation.input.model' || reg.value.opts.priority !== -1) {
    console.error('FAIL: bad seat opts ' + JSON.stringify(reg.value.opts)); process.exit(1)
  }
  if (typeof reg.value.opts.inject !== 'function' || typeof reg.value.Component !== 'function') {
    console.error('FAIL: inject factory / Component not functions'); process.exit(1)
  }

  const face = reg.value.opts.inject('sess-1')
  if (face.available !== true || face.directory !== dirStore) {
    console.error('FAIL: inject face ' + JSON.stringify(face)); process.exit(1)
  }
  console.log('PASS client module shape + apply registers seat (priority=-1) + inject face')
}

// --- Closed-trigger render smoke ---
{
  const reg = { value: null }
  const ctx = makeCtx(reg)
  const require = (spec) => {
    if (spec === 'react') return makeReact(null)
    throw new Error('unexpected require: ' + spec)
  }
  new Function('require', src + '\n;return typeof module !== "undefined" ? module.exports : undefined')(require)
  const mod = loaded.factory(require)
  mod.apply(ctx)
  const face = reg.value.opts.inject('sess-1')
  try {
    const tree = reg.value.Component({ locked: false, ...face })
    if (!tree || tree.tag !== 'el') throw new Error('unexpected tree ' + JSON.stringify(tree))
    console.log('PASS closed-trigger render smoke')
  } catch (e) {
    console.error('FAIL closed-trigger render: ' + String((e && e.stack) || e)); process.exit(1)
  }
}

// --- Open-menu render smoke (provider column + model list + effort absent) ---
{
  const reg = { value: null }
  const ctx = makeCtx(reg)
  const stateQueue = [true, '', null, null] // open, query, activeProvider, notice
  const require = (spec) => {
    if (spec === 'react') return makeReact(stateQueue)
    throw new Error('unexpected require: ' + spec)
  }
  new Function('require', src + '\n;return typeof module !== "undefined" ? module.exports : undefined')(require)
  const mod = loaded.factory(require)
  mod.apply(ctx)
  const face = reg.value.opts.inject('sess-1')
  try {
    const tree = reg.value.Component({ locked: false, ...face })
    if (!tree || tree.tag !== 'el') throw new Error('unexpected tree ' + JSON.stringify(tree))
    console.log('PASS open-menu render smoke (left providers + right list)')
  } catch (e) {
    console.error('FAIL open-menu render: ' + String((e && e.stack) || e)); process.exit(1)
  }
}

// --- Fallback path: no modelDirectories -> available false, renders null ---
{
  const reg = { value: null }
  const ctx = {
    get(name) {
      if (name === 'slots') {
        return {
          inject(key, cb) { if (key === 'conversation.input.model') reg.value = cb() },
          register(opts, Component) { return { opts, Component } },
        }
      }
      return undefined
    },
    effect(fn) { return fn() },
  }
  const require = (spec) => {
    if (spec === 'react') return makeReact(null)
    throw new Error('unexpected require: ' + spec)
  }
  new Function('require', src + '\n;return typeof module !== "undefined" ? module.exports : undefined')(require)
  const mod = loaded.factory(require)
  mod.apply(ctx)
  const face = reg.value.opts.inject('sess-1')
  if (face.available !== false) { console.error('FAIL: fallback face should be unavailable'); process.exit(1) }
  const tree = reg.value.Component({ locked: false, ...face })
  if (tree !== null) { console.error('FAIL: unavailable seat should render null'); process.exit(1) }
  console.log('PASS fallback path (no modelDirectories) renders null')
}

// --- Refresh keeps the cached list visible (stale-while-revalidate) ---
// Regression guard for the slow-open fix: with status 'loading' and previously
// loaded groups the right pane must keep rendering the list (the platform store
// preserves groups across reloads), not collapse into the bare "loading" status
// on every open.
{
  const refreshingStore = {
    subscribe: () => () => {},
    getSnapshot: () => ({
      current: { provider: 'p1', model: 'm1' },
      routable: true,
      groups: [
        { id: 'p1', name: 'DeepSeek', models: [{ id: 'm1', name: 'deepseek-v4-flash', description: 'Fast' }] },
      ],
      failures: [],
      status: 'loading',
      error: null,
    }),
  }
  const reg = { value: null }
  const ctx = makeCtx(reg, refreshingStore)
  const stateQueue = [true, '', null, null] // open, query, activeProvider, notice
  const require = (spec) => {
    if (spec === 'react') return makeReact(stateQueue)
    throw new Error('unexpected require: ' + spec)
  }
  new Function('require', src + '\n;return typeof module !== "undefined" ? module.exports : undefined')(require)
  const mod = loaded.factory(require)
  mod.apply(ctx)
  const face = reg.value.opts.inject('sess-1')
  const tree = reg.value.Component({ locked: false, ...face })
  const list = findByClass(tree, 'dsh-mp-list')
  if (!list) { console.error('FAIL: dsh-mp-list not rendered'); process.exit(1) }
  const child = list.args[2]
  if (!child || child.tag !== 'el' || child.args[0] !== 'fragment') {
    console.error('FAIL: loading with cached groups must keep rendering the list branch')
    process.exit(1)
  }
  if (!findByClass(tree, 'dsh-mp-status')) {
    console.error('FAIL: refreshing hint missing while loading with cached groups'); process.exit(1)
  }
  if (!findByClass(tree, 'dsh-mp-option')) {
    console.error('FAIL: cached models not rendered during refresh'); process.exit(1)
  }
  console.log('PASS refresh with cached groups keeps the list visible (stale-while-revalidate)')
}

// --- First load (no cached groups) keeps the full-pane loading status ---
{
  const firstLoadStore = {
    subscribe: () => () => {},
    getSnapshot: () => ({
      current: null, routable: null, groups: [], failures: [], status: 'loading', error: null,
    }),
  }
  const reg = { value: null }
  const ctx = makeCtx(reg, firstLoadStore)
  const stateQueue = [true, '', null, null]
  const require = (spec) => {
    if (spec === 'react') return makeReact(stateQueue)
    throw new Error('unexpected require: ' + spec)
  }
  new Function('require', src + '\n;return typeof module !== "undefined" ? module.exports : undefined')(require)
  const mod = loaded.factory(require)
  mod.apply(ctx)
  const face = reg.value.opts.inject('sess-1')
  const tree = reg.value.Component({ locked: false, ...face })
  const list = findByClass(tree, 'dsh-mp-list')
  if (!list) { console.error('FAIL: dsh-mp-list not rendered'); process.exit(1) }
  const child = list.args[2]
  if (!child || child.tag !== 'el' || child.args[0] !== 'div'
    || !String((child.args[1] && child.args[1].className) ?? '').split(' ').includes('dsh-mp-status')) {
    console.error('FAIL: first load with no groups should show the full-pane loading status')
    process.exit(1)
  }
  console.log('PASS first load with empty groups shows the loading status')
}
