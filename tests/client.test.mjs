// Client smoke: load lib/client.js through a fake __ModuleLoader__ + react stub,
// verify the module shape (id must equal the package.json name), that apply()
// registers the composer model seat with priority -1, and that the component
// renders without runtime errors (closed trigger and open menu passes).
//
// Harness notes:
// - setup() installs the browser globals (window/document/navigator/
//   localStorage); every block calls it first, then overrides what it needs.
// - loadClient(stateQueue, setCalls) re-evaluates the bundle and runs the
//   factory with a position-based React stub: useState reads stateQueue
//   (pane, query, activeProvider, notice, optimistic, highlight) and its
//   setters record [hookIndex, value] pairs into setCalls. There is no
//   re-render, so multi-step interactions re-render with an updated queue.
//   useEffect runs its callback once, synchronously (cleanups are dropped),
//   so mount effects observe the same first-frame values the assertions do.
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

// extra overrides individual ctx.get(name) answers (connection, sessions,
// modelDirectories, ...) so a block can swap one service without rebuilding
// the whole context.
function makeCtx(reg, store, extra) {
  const directoryStore = store === undefined ? dirStore : store
  const overrides = extra === undefined ? {} : extra
  return {
    get(name) {
      if (Object.prototype.hasOwnProperty.call(overrides, name)) return overrides[name]
      if (name === 'slots') {
        return {
          inject(key, cb) { if (key === 'conversation.input.model') reg.value = cb() },
          register(opts, Component) { return { opts, Component } },
        }
      }
      if (name === 'connection') {
        // Never resolves: the catalog stays empty/loading so the per-session
        // directory snapshot drives the list in these tests.
        return { api: { llm: { models: () => new Promise(() => {}) } } }
      }
      if (name === 'remote') return { $on: () => {} }
      if (name === 'modelDirectories') {
        return { directoryFor: () => ({ store: directoryStore, load: () => {}, select: () => Promise.resolve() }) }
      }
      if (name === 'sessions') return { subagentAddress: () => undefined }
      return undefined
    },
    effect(fn) { return fn() },
    on() {},
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

// Same DFS, but collects every match (findByClass stops at the first).
function findAllByClass(node, cls, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) findAllByClass(child, cls, out)
    return out
  }
  if (node.tag !== 'el') return out
  const props = node.args[1]
  if (props !== null && typeof props === 'object'
    && String(props.className ?? '').split(' ').includes(cls)) out.push(node)
  for (const child of node.args.slice(2)) findAllByClass(child, cls, out)
  return out
}

// Concatenate every text child under a fake element node (boolean/expression
// children contribute nothing, matching React's render).
function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node.tag === 'el') return node.args.slice(2).map(textOf).join('')
  return ''
}

// Hook order in ModelPicker: 0 pane, 1 query, 2 activeProvider, 3 notice,
// 4 optimistic, 5 highlight. A queue shorter than the hook count throws so a
// positional drift fails loudly instead of shifting every later state.
function makeReact(stateQueue, setCalls) {
  let hookIndex = 0
  return {
    createElement: (...a) => ({ tag: 'el', args: a }),
    useState: (init) => {
      const index = hookIndex++
      if (stateQueue !== null && index >= stateQueue.length) {
        throw new Error('state queue exhausted: hook #' + index + ' but queue has ' + stateQueue.length)
      }
      const value = stateQueue === null ? init : stateQueue[index]
      return [value, (v) => { if (setCalls) setCalls.push([index, v]) }]
    },
    useEffect: (fn) => { fn() },
    useRef: (v) => ({ current: v }),
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
    useSyncExternalStore: (_sub, get) => get(),
    // Mimics React 18 useId; the client sanitizes it into the id base.
    useId: () => ':r0:',
    Fragment: 'fragment',
  }
}

// setCalls assertions: exact value match (JSON) or just "hook N was set".
function calledWith(calls, index, value) {
  return calls.some(([i, v]) => i === index && JSON.stringify(v) === JSON.stringify(value))
}
function calledIndex(calls, index) {
  return calls.some(([i]) => i === index)
}

const src = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

let loaded = null

// Install the browser globals every block depends on; blocks override
// localStorage / navigator afterwards when they need non-defaults.
function setup() {
  globalThis.window = { __ModuleLoader__: { load: (handoff) => { loaded = handoff } } }
  globalThis.document = {
    head: { appendChild: () => {} },
    getElementById: () => null,
    createElement: () => ({ remove: () => {} }),
  }
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true })
}

// Evaluate the bundle (captures the handoff into `loaded`) and run the
// factory with the React stub configured for this render.
function loadClient(stateQueue, setCalls) {
  const require = (spec) => {
    if (spec === 'react') return makeReact(stateQueue, setCalls)
    throw new Error('unexpected require: ' + spec)
  }
  new Function('require', src + '\n;return typeof module !== "undefined" ? module.exports : undefined')(require)
  if (!loaded) { console.error('FAIL: __ModuleLoader__.load never called'); process.exit(1) }
  return loaded.factory(require)
}

// --- Module shape + registration ---
{
  setup()
  const reg = { value: null }
  const ctx = makeCtx(reg)
  const mod = loadClient(null)

  if (loaded.id !== pkg.name) { console.error('FAIL: bundle id ' + loaded.id + ' != package name ' + pkg.name); process.exit(1) }

  if (!mod || !Array.isArray(mod.inject) || typeof mod.apply !== 'function') {
    console.error('FAIL: bad module shape'); process.exit(1)
  }
  if (mod.inject.join(',') !== 'slots,connection,remote') { console.error('FAIL: inject=' + mod.inject); process.exit(1) }

  mod.apply(ctx)
  if (!reg.value) { console.error('FAIL: seat not registered'); process.exit(1) }
  if (reg.value.opts.name !== 'conversation.input.model' || reg.value.opts.priority !== -1) {
    console.error('FAIL: bad seat opts ' + JSON.stringify(reg.value.opts)); process.exit(1)
  }
  if (reg.value.opts.registrant !== 'dsh-model-picker') {
    console.error('FAIL: seat registrant should be the plugin name, got ' + JSON.stringify(reg.value.opts.registrant))
    process.exit(1)
  }
  if (typeof reg.value.opts.inject !== 'function' || typeof reg.value.Component !== 'function') {
    console.error('FAIL: inject factory / Component not functions'); process.exit(1)
  }

  const face = reg.value.opts.inject('sess-1')
  if (face.available !== true || face.directory !== dirStore) {
    console.error('FAIL: inject face ' + JSON.stringify(face)); process.exit(1)
  }
  console.log('PASS client module shape + apply registers seat (priority=-1, registrant) + inject face')
}

// --- Closed-trigger render smoke ---
{
  setup()
  const reg = { value: null }
  const ctx = makeCtx(reg)
  const mod = loadClient(null)
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

// --- Open-menu render: provider column + model list + effort absent ---
{
  setup()
  const reg = { value: null }
  const ctx = makeCtx(reg)
  const setCalls = []
  const stateQueue = ['models', '', null, null, null, -1] // pane, query, activeProvider, notice, optimistic, highlight
  const mod = loadClient(stateQueue, setCalls)
  mod.apply(ctx)
  const face = reg.value.opts.inject('sess-1')
  try {
    const tree = reg.value.Component({ locked: false, ...face })
    if (!tree || tree.tag !== 'el') throw new Error('unexpected tree ' + JSON.stringify(tree))
    if (findByClass(tree, 'dsh-mp-effortTrigger')) {
      console.error('FAIL: effort trigger should stay hidden when the model has no reasoning'); process.exit(1)
    }
    // Right column: a listbox with the active provider's options. Ids are
    // namespaced by the useId base (':r0:' sanitized to 'r0' by the stub).
    const list = findByClass(tree, 'dsh-mp-list')
    if (!list || list.args[1].role !== 'listbox' || list.args[1].id !== 'dsh-mp-r0-listbox') {
      console.error('FAIL: right column must be the instance-scoped listbox'); process.exit(1)
    }
    const options = findAllByClass(list, 'dsh-mp-option')
    if (options.length !== 1) {
      console.error('FAIL: active provider p1 has exactly one model, got ' + options.length + ' options'); process.exit(1)
    }
    if (options[0].args[1].role !== 'option' || options[0].args[1]['aria-selected'] !== true) {
      console.error('FAIL: the current model option must carry role=option aria-selected'); process.exit(1)
    }
    // The search input is the combobox controlling that listbox.
    const search = findByClass(tree, 'dsh-mp-search')
    if (!search || search.args[1].role !== 'combobox' || search.args[1]['aria-expanded'] !== true
      || search.args[1]['aria-controls'] !== 'dsh-mp-r0-listbox'
      || search.args[1]['aria-activedescendant'] !== undefined) {
      console.error('FAIL: search input must be a combobox wired to the listbox'); process.exit(1)
    }
    // Left column: a group of provider tabs with counts and one active tab.
    const providerCol = findByClass(tree, 'dsh-mp-providers')
    if (!providerCol || providerCol.args[1].role !== 'group') {
      console.error('FAIL: provider column must be a role=group container'); process.exit(1)
    }
    const tabs = findAllByClass(providerCol, 'dsh-mp-provider')
    if (tabs.length !== 2) {
      console.error('FAIL: expected 2 provider tabs, got ' + tabs.length); process.exit(1)
    }
    const activeTabs = tabs.filter((n) => n.args[1].className.split(' ').includes('dsh-mp-providerActive'))
    if (activeTabs.length !== 1 || activeTabs[0].args[1]['aria-current'] !== 'true'
      || textOf(findByClass(activeTabs[0], 'dsh-mp-providerName')) !== 'DeepSeek') {
      console.error('FAIL: exactly the current provider tab must be active (class + aria-current)'); process.exit(1)
    }
    const inactiveTabs = tabs.filter((n) => !n.args[1].className.split(' ').includes('dsh-mp-providerActive'))
    if (inactiveTabs.length !== 1 || inactiveTabs[0].args[1]['aria-current'] !== undefined) {
      console.error('FAIL: the other provider tab must stay inactive without aria-current'); process.exit(1)
    }
    const counts = findAllByClass(providerCol, 'dsh-mp-providerCount')
    if (counts.length !== 2 || counts.some((c) => textOf(c) !== '1')) {
      console.error('FAIL: each provider tab must show its model count badge'); process.exit(1)
    }
    // The selected option's check mark is decorative and aria-hidden.
    const selected = findByClass(list, 'dsh-mp-selected')
    const check = findByClass(selected, 'dsh-mp-check')
    if (!check || check.args[1]['aria-hidden'] !== true || textOf(check) !== '✓') {
      console.error('FAIL: selected option must render an aria-hidden ✓ check'); process.exit(1)
    }
    // Clicking the inactive provider tab targets that group id (and clears the query).
    inactiveTabs[0].args[1].onClick()
    if (!calledWith(setCalls, 1, '') || !calledWith(setCalls, 2, 'p2')) {
      console.error('FAIL: provider tab click must clear the query and activate its group id, got '
        + JSON.stringify(setCalls)); process.exit(1)
    }
    console.log('PASS open-menu renders provider column (active tab, counts, click wiring) + model list, effort trigger hidden')
  } catch (e) {
    console.error('FAIL open-menu render: ' + String((e && e.stack) || e)); process.exit(1)
  }
}

// --- Fallback path: no modelDirectories -> available false, renders null ---
{
  setup()
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
  const mod = loadClient(null)
  mod.apply(ctx)
  const face = reg.value.opts.inject('sess-1')
  if (face.available !== false) { console.error('FAIL: fallback face should be unavailable'); process.exit(1) }
  const tree = reg.value.Component({ locked: false, ...face })
  if (tree !== null) { console.error('FAIL: unavailable seat should render null'); process.exit(1) }
  console.log('PASS fallback path (no modelDirectories) renders null')
}

// --- Refresh with cached groups: list stays, and NO loading hint ---
// Regression guard for the instant-open change: with status 'loading' and
// previously loaded groups the right pane must keep rendering the cached list
// WITHOUT any "loading" row — revalidation is invisible; the full-pane
// loading status is reserved for the first load (empty groups).
{
  setup()
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
  const stateQueue = ['models', '', null, null, null, -1] // pane, query, activeProvider, notice, optimistic, highlight
  const mod = loadClient(stateQueue)
  mod.apply(ctx)
  const face = reg.value.opts.inject('sess-1')
  const tree = reg.value.Component({ locked: false, ...face })
  const list = findByClass(tree, 'dsh-mp-list')
  if (!list) { console.error('FAIL: dsh-mp-list not rendered'); process.exit(1) }
  if (findByClass(list, 'dsh-mp-status')) {
    console.error('FAIL: silent revalidate must not show a loading row over cached groups'); process.exit(1)
  }
  if (!findByClass(list, 'dsh-mp-option')) {
    console.error('FAIL: loading with cached groups must keep rendering the list branch'); process.exit(1)
  }
  console.log('PASS refresh with cached groups keeps the list visible with no loading row')
}

// --- First load (no cached groups) keeps the full-pane loading status ---
// With nothing cached anywhere, the first open shows the loading row. On the
// catalog path nothing loads the per-session directory, so the status comes
// from the catalog itself: drive the store into 'loading' before the render
// (the harness never re-renders) and keep the directory at 'idle' to prove
// which store supplies the row.
{
  setup()
  const firstLoadStore = {
    subscribe: () => () => {},
    getSnapshot: () => ({
      current: null, routable: null, groups: [], failures: [], status: 'idle', error: null,
    }),
  }
  const reg = { value: null }
  const ctx = makeCtx(reg, firstLoadStore)
  const stateQueue = ['models', '', null, null, null, -1] // pane, query, activeProvider, notice, optimistic, highlight
  const mod = loadClient(stateQueue)
  mod.apply(ctx)
  const face = reg.value.opts.inject('sess-1')
  void face.catalog.load() // never-resolving stub RPC: the catalog sits at 'loading'
  if (face.catalog.getSnapshot().status !== 'loading') {
    console.error('FAIL: catalog should be loading after load()'); process.exit(1)
  }
  const tree = reg.value.Component({ locked: false, ...face })
  const list = findByClass(tree, 'dsh-mp-list')
  if (!list) { console.error('FAIL: dsh-mp-list not rendered'); process.exit(1) }
  const status = findByClass(list, 'dsh-mp-status')
  if (!status || textOf(status) !== '加载中…') {
    console.error('FAIL: first load with no groups should show the full-pane loading status')
    process.exit(1)
  }
  console.log('PASS first load with empty groups shows the loading status')
}

// --- Catalog first-load failure surfaces the retry row over an idle directory ---
// Nothing loads the per-session directory on the catalog path: with no cache
// anywhere, a rejected first load must surface the catalog's own error row
// (with a retry button) instead of a silent blank panel.
{
  setup()
  const idleDir = {
    subscribe: () => () => {},
    getSnapshot: () => ({ current: null, routable: null, groups: [], failures: [], status: 'idle', error: null }),
  }
  const reg = { value: null }
  const ctx = makeCtx(reg, idleDir, {
    connection: { api: { llm: { models: () => Promise.reject(new Error('boom')) } } },
  })
  const mod = loadClient(['models', '', null, null, null, -1])
  mod.apply(ctx)
  const face = reg.value.opts.inject('sess-1')
  await face.catalog.load()
  if (face.catalog.getSnapshot().status !== 'error') {
    console.error('FAIL: catalog should record the first-load failure'); process.exit(1)
  }
  const tree = reg.value.Component({ locked: false, ...face })
  const errorRow = findByClass(tree, 'dsh-mp-error')
  if (!errorRow || errorRow.args[1].role !== 'alert' || !textOf(errorRow).includes('boom')) {
    console.error('FAIL: a failed first load must render a role=alert row carrying the error'); process.exit(1)
  }
  if (!findByClass(errorRow, 'dsh-mp-retry')) {
    console.error('FAIL: the first-load failure row must carry a retry button'); process.exit(1)
  }
  if (findByClass(tree, 'dsh-mp-empty')) {
    console.error('FAIL: the error state must not also render the no-models placeholder'); process.exit(1)
  }
  console.log('PASS catalog first-load failure surfaces the retry row over an idle directory')
}

// --- An all-failures catalog answer renders the warning rows over an idle directory ---
// A 0-groups + failures answer never hydrates catalogLive; the failure rows
// must still reach the panel when the directory has nothing to show either.
{
  setup()
  const idleDir = {
    subscribe: () => () => {},
    getSnapshot: () => ({ current: null, routable: null, groups: [], failures: [], status: 'idle', error: null }),
  }
  const reg = { value: null }
  const ctx = makeCtx(reg, idleDir, {
    connection: {
      api: {
        llm: {
          models: () => Promise.resolve({ groups: [], failures: [{ id: 'p3', name: 'Broken', message: 'HTTP 500' }] }),
        },
      },
    },
  })
  const mod = loadClient(['models', '', null, null, null, -1])
  mod.apply(ctx)
  const face = reg.value.opts.inject('sess-1')
  await face.catalog.load()
  const tree = reg.value.Component({ locked: false, ...face })
  const warning = findByClass(tree, 'dsh-mp-warning')
  if (!warning || textOf(warning) !== 'Broken 加载失败：HTTP 500重试') {
    console.error('FAIL: the all-failures answer must render the warning row, got '
      + JSON.stringify(warning && textOf(warning))); process.exit(1)
  }
  console.log('PASS all-failures catalog answer renders the warning rows over an idle directory')
}

// --- Reasoning effort gets its own trigger right of the model trigger ---
// The model whose directory entry carries `reasoning` must render a second
// pill next to the model trigger; clicking it opens the narrow effort menu
// instead of the provider/model pane.
{
  const reasoningStore = {
    subscribe: () => () => {},
    getSnapshot: () => ({
      current: { provider: 'p1', model: 'm1', reasoningEffort: 'max' },
      routable: true,
      groups: [
        {
          id: 'p1',
          name: 'DeepSeek',
          models: [{
            id: 'm1',
            name: 'deepseek-v4-pro',
            reasoning: { efforts: [{ id: 'off', name: 'Off' }, { id: 'max', name: 'Max', description: 'Max effort' }] },
          }],
        },
      ],
      failures: [],
      status: 'ready',
      error: null,
    }),
  }
  // Closed: effort trigger rendered, both menus hidden.
  {
    setup()
    const reg = { value: null }
    const ctx = makeCtx(reg, reasoningStore)
    const mod = loadClient(null)
    mod.apply(ctx)
    const face = reg.value.opts.inject('sess-1')
    const tree = reg.value.Component({ locked: false, ...face })
    if (!findByClass(tree, 'dsh-mp-effortTrigger')) {
      console.error('FAIL: effort trigger missing for a reasoning model'); process.exit(1)
    }
    if (findByClass(tree, 'dsh-mp-menuEffort') || findByClass(tree, 'dsh-mp-providers')) {
      console.error('FAIL: menus should stay hidden while closed'); process.exit(1)
    }
    console.log('PASS effort trigger renders beside the model trigger (closed)')
  }
  // Open on the effort pane: the effort option list shows, model pane does not.
  {
    setup()
    const reg = { value: null }
    const ctx = makeCtx(reg, reasoningStore)
    const stateQueue = ['effort', '', null, null, null, -1] // pane, query, activeProvider, notice, optimistic, highlight
    const mod = loadClient(stateQueue)
    mod.apply(ctx)
    const face = reg.value.opts.inject('sess-1')
    const tree = reg.value.Component({ locked: false, ...face })
    const menu = findByClass(tree, 'dsh-mp-menuEffort')
    if (!menu) { console.error('FAIL: effort menu not rendered'); process.exit(1) }
    if (!findByClass(menu, 'dsh-mp-option')) {
      console.error('FAIL: effort options missing from the effort menu'); process.exit(1)
    }
    if (findByClass(tree, 'dsh-mp-providers')) {
      console.error('FAIL: model pane should not render while the effort pane is open'); process.exit(1)
    }
    console.log('PASS effort pane renders the effort options')
  }
}

// --- Boot warmup is delayed; push events revalidate through a debounce ---
// Startup-cost regression guard: apply() must NOT fire an RPC eagerly (the
// fan-out can include a live provider fetch). The warmup lands after
// BOOT_WARMUP_DELAY (3s), persists the snapshot, and each push event triggers
// one debounced (1.2s) reload.
{
  setup()
  let calls = 0
  const writes = []
  const handlers = {}
  const reg = { value: null }
  globalThis.localStorage = {
    getItem: () => null,
    setItem: (k, v) => { writes.push([k, v]) },
    removeItem: () => {},
  }
  const ctx = {
    get(name) {
      if (name === 'slots') {
        return {
          inject(key, cb) { if (key === 'conversation.input.model') reg.value = cb() },
          register(opts, Component) { return { opts, Component } },
        }
      }
      if (name === 'connection') {
        return {
          api: {
            llm: {
              models: () => {
                calls += 1
                return Promise.resolve({ groups: [{ id: 'p1', name: 'DeepSeek', models: [] }], failures: [] })
              },
            },
          },
        }
      }
      if (name === 'remote') return { $on: (event, fn) => { handlers[event] = fn } }
      if (name === 'modelDirectories') {
        return { directoryFor: () => ({ store: dirStore, load: () => {}, select: () => Promise.resolve() }) }
      }
      if (name === 'sessions') return { subagentAddress: () => undefined }
      return undefined
    },
    effect(fn) { return fn() },
    on() {},
  }
  const mod = loadClient(null)
  mod.apply(ctx)
  if (calls !== 0) {
    console.error('FAIL: apply() must not issue an eager llm.models call on the startup path, got ' + calls)
    process.exit(1)
  }
  await new Promise((resolve) => setTimeout(resolve, 3300))
  if (calls !== 1) { console.error('FAIL: boot warmup should fire once, got ' + calls); process.exit(1) }
  if (!writes.some(([key]) => key === 'dsh-model-picker:catalog:v1')) {
    console.error('FAIL: a successful load should persist the catalog snapshot'); process.exit(1)
  }
  if (typeof handlers['llm/adapters-updated'] !== 'function' || typeof handlers['settings/document-updated'] !== 'function') {
    console.error('FAIL: push events not subscribed'); process.exit(1)
  }
  handlers['llm/adapters-updated']()
  if (calls !== 1) { console.error('FAIL: push events must be debounced, calls=' + calls); process.exit(1) }
  await new Promise((resolve) => setTimeout(resolve, 1500))
  if (calls !== 2) { console.error('FAIL: adapters-updated should revalidate, calls=' + calls); process.exit(1) }
  handlers['settings/document-updated']()
  await new Promise((resolve) => setTimeout(resolve, 1500))
  if (calls !== 3) { console.error('FAIL: document-updated should revalidate, calls=' + calls); process.exit(1) }
  console.log('PASS delayed boot warmup + localStorage persist + debounced push-event revalidation')
}

// --- Hydrated catalog paints instantly, even with an empty directory ---
// Regression guard for the disk-cache path: a localStorage-hydrated catalog
// must render the cached models on the very first frame — no loading row —
// even when the per-session directory has not loaded anything yet.
{
  setup()
  const stored = {
    v: 1,
    at: Date.now(),
    groups: [{ id: 'p9', name: 'Cached', models: [{ id: 'm9', name: 'cached-model', description: 'from disk' }] }],
    failures: [],
  }
  globalThis.localStorage = {
    getItem: (key) => (key === 'dsh-model-picker:catalog:v1' ? JSON.stringify(stored) : null),
    setItem: () => {},
    removeItem: () => {},
  }
  const emptyDir = {
    subscribe: () => () => {},
    getSnapshot: () => ({ current: null, routable: null, groups: [], failures: [], status: 'idle', error: null }),
  }
  const reg = { value: null }
  const ctx = makeCtx(reg, emptyDir)
  const stateQueue = ['models', '', null, null, null, -1] // pane, query, activeProvider, notice, optimistic, highlight
  const mod = loadClient(stateQueue)
  mod.apply(ctx)
  const face = reg.value.opts.inject('sess-1')
  const tree = reg.value.Component({ locked: false, ...face })
  if (!findByClass(tree, 'dsh-mp-option')) {
    console.error('FAIL: hydrated catalog should render the cached models immediately'); process.exit(1)
  }
  if (findByClass(tree, 'dsh-mp-status')) {
    console.error('FAIL: hydrated catalog must not show a loading row'); process.exit(1)
  }
  console.log('PASS hydrated catalog renders cached models with an empty directory')
}

// --- Empty RPC response never downgrades a hydrated catalog ---
// Regression guard for the boot race: right after a web restart the host can
// answer llm.models with { groups: [] } before adapters finish registering.
// That empty answer must NOT clear the localStorage-hydrated list (the flash
// to "暂无可用模型"), must not be persisted, and the revalidation must stay
// invisible (no loading row over the cached groups).
{
  setup()
  const stored = {
    v: 1,
    at: Date.now(),
    groups: [{ id: 'p9', name: 'Cached', models: [{ id: 'm9', name: 'cached-model', description: 'from disk' }] }],
    failures: [],
  }
  const writes = []
  const handlers = {}
  let calls = 0
  globalThis.localStorage = {
    getItem: (key) => (key === 'dsh-model-picker:catalog:v1' ? JSON.stringify(stored) : null),
    setItem: (k, v) => { writes.push([k, v]) },
    removeItem: () => {},
  }
  const emptyDir = {
    subscribe: () => () => {},
    getSnapshot: () => ({ current: null, routable: null, groups: [], failures: [], status: 'idle', error: null }),
  }
  const reg = { value: null }
  const ctx = {
    get(name) {
      if (name === 'slots') {
        return {
          inject(key, cb) { if (key === 'conversation.input.model') reg.value = cb() },
          register(opts, Component) { return { opts, Component } },
        }
      }
      if (name === 'connection') {
        return {
          api: {
            llm: {
              // The boot-race answer: success, but zero groups.
              models: () => { calls += 1; return Promise.resolve({ groups: [], failures: [] }) },
            },
          },
        }
      }
      if (name === 'remote') return { $on: (event, fn) => { handlers[event] = fn } }
      if (name === 'modelDirectories') {
        return { directoryFor: () => ({ store: emptyDir, load: () => {}, select: () => Promise.resolve() }) }
      }
      if (name === 'sessions') return { subagentAddress: () => undefined }
      return undefined
    },
    effect(fn) { return fn() },
    on() {},
  }
  const stateQueue = ['models', '', null, null, null, -1] // pane, query, activeProvider, notice, optimistic, highlight
  const mod = loadClient(stateQueue)
  mod.apply(ctx)
  // Simulate the push event storm; the debounced reload answers empty.
  handlers['llm/adapters-updated']()
  await new Promise((resolve) => setTimeout(resolve, 1600)) // past the 1.2s debounce
  if (calls !== 1) {
    console.error('FAIL: debounced revalidation should have fired exactly once, got ' + calls); process.exit(1)
  }
  if (writes.length !== 0) {
    console.error('FAIL: an empty response must never be persisted over a good cache'); process.exit(1)
  }
  const face = reg.value.opts.inject('sess-1')
  const tree = reg.value.Component({ locked: false, ...face })
  if (!findByClass(tree, 'dsh-mp-option')) {
    console.error('FAIL: empty response must not clear the hydrated model list'); process.exit(1)
  }
  if (findByClass(tree, 'dsh-mp-status')) {
    console.error('FAIL: background revalidation must stay invisible over hydrated groups'); process.exit(1)
  }
  if (findByClass(tree, 'dsh-mp-empty')) {
    console.error('FAIL: the "no models" placeholder must never replace hydrated data'); process.exit(1)
  }
  console.log('PASS empty RPC response never downgrades a hydrated catalog')
}

// --- Clicking a model fires select synchronously with the right payload ---
// Wiring guard for the optimistic switch: the click must call select
// immediately and carry exactly the selection the host expects. The stub
// never re-renders, so the optimistic label move and the menu close are
// asserted through the recorded setState calls instead.
{
  setup()
  const selections = []
  const clickDir = {
    subscribe: () => () => {},
    getSnapshot: () => ({
      current: { provider: 'p1', model: 'm1' },
      routable: true,
      groups: [
        { id: 'p1', name: 'DeepSeek', models: [{ id: 'm1', name: 'deepseek-v4-flash' }] },
        { id: 'p2', name: 'OpenAI', models: [{ id: 'm2', name: 'gpt-5' }] },
      ],
      failures: [],
      status: 'ready',
      error: null,
    }),
  }
  const reg = { value: null }
  const ctx = makeCtx(reg, clickDir, {
    modelDirectories: {
      directoryFor: () => ({
        store: clickDir,
        load: () => {},
        select: (s) => { selections.push(s); return Promise.resolve() },
      }),
    },
  })
  const setCalls = []
  const stateQueue = ['models', 'gpt', null, null, null, -1] // open menu, searching "gpt" -> only p2/m2
  const mod = loadClient(stateQueue, setCalls)
  mod.apply(ctx)
  const face = reg.value.opts.inject('sess-1')
  const tree = reg.value.Component({ locked: false, ...face })
  const options = findAllByClass(tree, 'dsh-mp-option')
  if (options.length !== 1) {
    console.error('FAIL: expected exactly one search result, got ' + options.length); process.exit(1)
  }
  options[0].args[1].onClick()
  if (selections.length !== 1 || selections[0].provider !== 'p2' || selections[0].model !== 'm2'
    || selections[0].reasoningEffort !== undefined) {
    console.error('FAIL: select not fired synchronously with the right payload: ' + JSON.stringify(selections))
    process.exit(1)
  }
  if (!calledWith(setCalls, 4, { provider: 'p2', model: 'm2' })) {
    console.error('FAIL: click must set the optimistic selection immediately: ' + JSON.stringify(setCalls))
    process.exit(1)
  }
  if (!calledWith(setCalls, 0, null)) {
    console.error('FAIL: click must close the menu immediately: ' + JSON.stringify(setCalls)); process.exit(1)
  }
  console.log('PASS clicking a search result fires select immediately with the right payload (optimistic close recorded)')
}

// --- Failed background select rolls back and reopens the menu ---
// The settle path of the optimistic switch: when the host answers false the
// optimistic override is dropped, a failure notice is set, and the models
// pane reopens.
{
  setup()
  const selections = []
  const failDir = {
    subscribe: () => () => {},
    getSnapshot: () => ({
      current: { provider: 'p1', model: 'm1' },
      routable: true,
      groups: [
        { id: 'p1', name: 'DeepSeek', models: [{ id: 'm1', name: 'deepseek-v4-flash' }] },
        { id: 'p2', name: 'OpenAI', models: [{ id: 'm2', name: 'gpt-5' }] },
      ],
      failures: [],
      status: 'ready',
      error: null,
    }),
  }
  const reg = { value: null }
  const ctx = makeCtx(reg, failDir, {
    modelDirectories: {
      directoryFor: () => ({
        store: failDir,
        load: () => {},
        select: (s) => { selections.push(s); return Promise.reject(new Error('nope')) },
      }),
    },
  })
  const setCalls = []
  const stateQueue = ['models', 'gpt', null, null, null, -1] // open menu, searching "gpt" -> only p2/m2
  const mod = loadClient(stateQueue, setCalls)
  mod.apply(ctx)
  const face = reg.value.opts.inject('sess-1')
  const tree = reg.value.Component({ locked: false, ...face })
  const options = findAllByClass(tree, 'dsh-mp-option')
  if (options.length !== 1) {
    console.error('FAIL: expected exactly one search result, got ' + options.length); process.exit(1)
  }
  options[0].args[1].onClick()
  if (selections.length !== 1) { console.error('FAIL: select should still be attempted'); process.exit(1) }
  if (!calledWith(setCalls, 4, { provider: 'p2', model: 'm2' })) {
    console.error('FAIL: optimistic selection should be set before the settle lands'); process.exit(1)
  }
  // Flush the select().then(settle) chain.
  await new Promise((resolve) => setTimeout(resolve, 0))
  if (!calledWith(setCalls, 4, null)) {
    console.error('FAIL: failed select must drop the optimistic override: ' + JSON.stringify(setCalls)); process.exit(1)
  }
  if (!calledWith(setCalls, 3, '选择失败，请重试')) {
    console.error('FAIL: failed select must surface the fallback notice: ' + JSON.stringify(setCalls)); process.exit(1)
  }
  if (!calledWith(setCalls, 0, 'models')) {
    console.error('FAIL: failed select must reopen the models pane: ' + JSON.stringify(setCalls)); process.exit(1)
  }
  console.log('PASS failed background select rolls back the optimistic label and reopens the menu')
}

// --- Clicking an effort option fires select with the reasoningEffort ---
{
  setup()
  const selections = []
  const reasoningDir = {
    subscribe: () => () => {},
    getSnapshot: () => ({
      current: { provider: 'p1', model: 'm1', reasoningEffort: 'max' },
      routable: true,
      groups: [
        {
          id: 'p1',
          name: 'DeepSeek',
          models: [{
            id: 'm1',
            name: 'deepseek-v4-pro',
            reasoning: { efforts: [{ id: 'off', name: 'Off' }, { id: 'max', name: 'Max', description: 'Max effort' }] },
          }],
        },
      ],
      failures: [],
      status: 'ready',
      error: null,
    }),
  }
  const reg = { value: null }
  const ctx = makeCtx(reg, reasoningDir, {
    modelDirectories: {
      directoryFor: () => ({
        store: reasoningDir,
        load: () => {},
        select: (s) => { selections.push(s); return Promise.resolve() },
      }),
    },
  })
  const stateQueue = ['effort', '', null, null, null, -1] // effort pane open
  const mod = loadClient(stateQueue)
  mod.apply(ctx)
  const face = reg.value.opts.inject('sess-1')
  const tree = reg.value.Component({ locked: false, ...face })
  // Effort rows: 提供方默认, Off, Max (current). Click "Off".
  const options = findAllByClass(tree, 'dsh-mp-option')
  if (options.length !== 3) {
    console.error('FAIL: expected 3 effort rows, got ' + options.length); process.exit(1)
  }
  options[1].args[1].onClick()
  if (selections.length !== 1 || selections[0].provider !== 'p1' || selections[0].model !== 'm1'
    || selections[0].reasoningEffort !== 'off') {
    console.error('FAIL: effort select payload wrong: ' + JSON.stringify(selections)); process.exit(1)
  }
  console.log('PASS clicking an effort option fires select with the reasoningEffort')
}

// --- Clicking the current model only closes the menu (no select) ---
{
  setup()
  const selections = []
  const sameDir = {
    subscribe: () => () => {},
    getSnapshot: () => ({
      current: { provider: 'p1', model: 'm1' },
      routable: true,
      groups: [{ id: 'p1', name: 'DeepSeek', models: [{ id: 'm1', name: 'deepseek-v4-flash' }] }],
      failures: [],
      status: 'ready',
      error: null,
    }),
  }
  const reg = { value: null }
  const ctx = makeCtx(reg, sameDir, {
    modelDirectories: {
      directoryFor: () => ({
        store: sameDir,
        load: () => {},
        select: (s) => { selections.push(s); return Promise.resolve() },
      }),
    },
  })
  const setCalls = []
  const stateQueue = ['models', '', null, null, null, -1] // pane, query, activeProvider, notice, optimistic, highlight
  const mod = loadClient(stateQueue, setCalls)
  mod.apply(ctx)
  const face = reg.value.opts.inject('sess-1')
  const tree = reg.value.Component({ locked: false, ...face })
  const options = findAllByClass(tree, 'dsh-mp-option')
  if (options.length !== 1) {
    console.error('FAIL: expected the single current-model option, got ' + options.length); process.exit(1)
  }
  options[0].args[1].onClick()
  if (selections.length !== 0) {
    console.error('FAIL: clicking the current model must not call select'); process.exit(1)
  }
  if (!calledWith(setCalls, 0, null)) {
    console.error('FAIL: clicking the current model should close the menu'); process.exit(1)
  }
  if (calledIndex(setCalls, 4)) {
    console.error('FAIL: a no-op click must not set an optimistic override'); process.exit(1)
  }
  console.log('PASS clicking the current model only closes the menu')
}

// --- Clicking the current effort only closes the menu (no select) ---
{
  setup()
  const selections = []
  const effortDir = {
    subscribe: () => () => {},
    getSnapshot: () => ({
      current: { provider: 'p1', model: 'm1', reasoningEffort: 'max' },
      routable: true,
      groups: [
        {
          id: 'p1',
          name: 'DeepSeek',
          models: [{
            id: 'm1',
            name: 'deepseek-v4-pro',
            reasoning: { efforts: [{ id: 'off', name: 'Off' }, { id: 'max', name: 'Max', description: 'Max effort' }] },
          }],
        },
      ],
      failures: [],
      status: 'ready',
      error: null,
    }),
  }
  const reg = { value: null }
  const ctx = makeCtx(reg, effortDir, {
    modelDirectories: {
      directoryFor: () => ({
        store: effortDir,
        load: () => {},
        select: (s) => { selections.push(s); return Promise.resolve() },
      }),
    },
  })
  const setCalls = []
  const stateQueue = ['effort', '', null, null, null, -1] // effort pane open
  const mod = loadClient(stateQueue, setCalls)
  mod.apply(ctx)
  const face = reg.value.opts.inject('sess-1')
  const tree = reg.value.Component({ locked: false, ...face })
  const options = findAllByClass(tree, 'dsh-mp-option')
  if (options.length !== 3) {
    console.error('FAIL: expected 3 effort rows, got ' + options.length); process.exit(1)
  }
  // Rows: 提供方默认, Off, Max (current). Click "Max".
  options[2].args[1].onClick()
  if (selections.length !== 0) {
    console.error('FAIL: clicking the current effort must not call select'); process.exit(1)
  }
  if (!calledWith(setCalls, 0, null)) {
    console.error('FAIL: clicking the current effort should close the menu'); process.exit(1)
  }
  console.log('PASS clicking the current effort only closes the menu')
}

// --- defaultEffort rides along on choose; the effort menu drops provider-default ---
{
  const plain = { id: 'm1', name: 'deepseek-v4-flash' }
  const reasoned = {
    id: 'm2',
    name: 'deepseek-v4-pro',
    reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'high' },
  }
  // Choosing a model that declares defaultEffort auto-fills reasoningEffort.
  {
    setup()
    const selections = []
    const storeA = {
      subscribe: () => () => {},
      getSnapshot: () => ({
        current: { provider: 'p1', model: 'm1' },
        routable: true,
        groups: [{ id: 'p1', name: 'DeepSeek', models: [plain, reasoned] }],
        failures: [],
        status: 'ready',
        error: null,
      }),
    }
    const reg = { value: null }
    const ctx = makeCtx(reg, storeA, {
      modelDirectories: {
        directoryFor: () => ({
          store: storeA,
          load: () => {},
          select: (s) => { selections.push(s); return Promise.resolve() },
        }),
      },
    })
    const mod = loadClient(['models', '', null, null, null, -1])
    mod.apply(ctx)
    const face = reg.value.opts.inject('sess-1')
    const tree = reg.value.Component({ locked: false, ...face })
    const options = findAllByClass(tree, 'dsh-mp-option')
    if (options.length !== 2) {
      console.error('FAIL: expected both provider models, got ' + options.length); process.exit(1)
    }
    options[1].args[1].onClick()
    if (selections.length !== 1 || selections[0].provider !== 'p1' || selections[0].model !== 'm2'
      || selections[0].reasoningEffort !== 'high') {
      console.error('FAIL: choose must attach the model defaultEffort: ' + JSON.stringify(selections)); process.exit(1)
    }
  }
  // With the reasoned model current and no explicit effort, the trigger shows
  // the default effort's name and the effort menu has no provider-default row.
  {
    setup()
    const storeB = {
      subscribe: () => () => {},
      getSnapshot: () => ({
        current: { provider: 'p1', model: 'm2' },
        routable: true,
        groups: [{ id: 'p1', name: 'DeepSeek', models: [plain, reasoned] }],
        failures: [],
        status: 'ready',
        error: null,
      }),
    }
    const reg = { value: null }
    const ctx = makeCtx(reg, storeB)
    const mod = loadClient(['effort', '', null, null, null, -1])
    mod.apply(ctx)
    const face = reg.value.opts.inject('sess-1')
    const tree = reg.value.Component({ locked: false, ...face })
    const trigger = findByClass(tree, 'dsh-mp-effortTrigger')
    if (!trigger) { console.error('FAIL: effort trigger missing for the reasoned model'); process.exit(1) }
    const label = findByClass(trigger, 'dsh-mp-effortTriggerLabel')
    if (!label || textOf(label) !== 'High') {
      console.error('FAIL: trigger label should be the default effort name, got ' + JSON.stringify(textOf(label)))
      process.exit(1)
    }
    const options = findAllByClass(tree, 'dsh-mp-option')
    if (options.length !== 2) {
      console.error('FAIL: defaultEffort present -> no provider-default row, got ' + options.length); process.exit(1)
    }
    if (textOf(options[0]).includes('提供方默认')) {
      console.error('FAIL: provider-default row must be absent when defaultEffort exists'); process.exit(1)
    }
    if (!options[1].args[1].className.split(' ').includes('dsh-mp-selected')) {
      console.error('FAIL: the default effort row should read as selected'); process.exit(1)
    }
  }
  console.log('PASS defaultEffort rides along on choose and drops the provider-default row')
}

// --- locked=true disables both triggers ---
{
  setup()
  const reasoningStore = {
    subscribe: () => () => {},
    getSnapshot: () => ({
      current: { provider: 'p1', model: 'm1', reasoningEffort: 'max' },
      routable: true,
      groups: [
        {
          id: 'p1',
          name: 'DeepSeek',
          models: [{
            id: 'm1',
            name: 'deepseek-v4-pro',
            reasoning: { efforts: [{ id: 'off', name: 'Off' }, { id: 'max', name: 'Max' }] },
          }],
        },
      ],
      failures: [],
      status: 'ready',
      error: null,
    }),
  }
  const reg = { value: null }
  const ctx = makeCtx(reg, reasoningStore)
  const mod = loadClient(null)
  mod.apply(ctx)
  const face = reg.value.opts.inject('sess-1')
  const tree = reg.value.Component({ locked: true, ...face })
  const trigger = findByClass(tree, 'dsh-mp-trigger')
  const effortTrigger = findByClass(tree, 'dsh-mp-effortTrigger')
  if (!trigger || trigger.args[1].disabled !== true) {
    console.error('FAIL: locked must disable the model trigger'); process.exit(1)
  }
  if (!effortTrigger || effortTrigger.args[1].disabled !== true) {
    console.error('FAIL: locked must disable the effort trigger'); process.exit(1)
  }
  console.log('PASS locked=true disables both triggers')
}

// --- Search matches provider names and descriptions; no-match placeholder ---
{
  // Provider-name hit: "openai" matches no model name but the provider name,
  // so every model of that provider is listed.
  {
    setup()
    const reg = { value: null }
    const ctx = makeCtx(reg)
    const mod = loadClient(['models', 'openai', null, null, null, -1])
    mod.apply(ctx)
    const face = reg.value.opts.inject('sess-1')
    const tree = reg.value.Component({ locked: false, ...face })
    const options = findAllByClass(tree, 'dsh-mp-option')
    if (options.length !== 1 || !textOf(options[0]).includes('gpt-5')) {
      console.error('FAIL: provider-name search should list the provider models, got ' + options.length)
      process.exit(1)
    }
    // While searching every provider tab is deactivated.
    const tabs = findAllByClass(tree, 'dsh-mp-provider')
    if (tabs.length !== 2
      || tabs.some((n) => n.args[1].className.split(' ').includes('dsh-mp-providerActive')
        || n.args[1]['aria-current'] !== undefined)) {
      console.error('FAIL: searching must deactivate all provider tabs (no active class, no aria-current)')
      process.exit(1)
    }
  }
  // Description hit: "general" only appears in the gpt-5 description.
  {
    setup()
    const reg = { value: null }
    const ctx = makeCtx(reg)
    const mod = loadClient(['models', 'general', null, null, null, -1])
    mod.apply(ctx)
    const face = reg.value.opts.inject('sess-1')
    const tree = reg.value.Component({ locked: false, ...face })
    const options = findAllByClass(tree, 'dsh-mp-option')
    if (options.length !== 1 || !textOf(options[0]).includes('gpt-5')) {
      console.error('FAIL: description search should match gpt-5, got ' + options.length); process.exit(1)
    }
  }
  // No match: the placeholder row shows instead of options.
  {
    setup()
    const reg = { value: null }
    const ctx = makeCtx(reg)
    const mod = loadClient(['models', 'zzz', null, null, null, -1])
    mod.apply(ctx)
    const face = reg.value.opts.inject('sess-1')
    const tree = reg.value.Component({ locked: false, ...face })
    const options = findAllByClass(tree, 'dsh-mp-option')
    if (options.length !== 0) {
      console.error('FAIL: a dead-end search must render no options, got ' + options.length); process.exit(1)
    }
    const empty = findByClass(tree, 'dsh-mp-empty')
    if (!empty || textOf(empty) !== '没有匹配的模型') {
      console.error('FAIL: a dead-end search must show the no-match placeholder'); process.exit(1)
    }
  }
  console.log('PASS search matches provider names and descriptions, shows the no-match placeholder, deactivates provider tabs')
}

// --- Provider failure rows render (zh + en) and hide while searching ---
{
  const failStore = {
    subscribe: () => () => {},
    getSnapshot: () => ({
      current: { provider: 'p1', model: 'm1' },
      routable: true,
      groups: [
        { id: 'p1', name: 'DeepSeek', models: [{ id: 'm1', name: 'deepseek-v4-flash', description: 'Fast' }] },
        { id: 'p2', name: 'OpenAI', models: [{ id: 'm2', name: 'gpt-5', description: 'General' }] },
      ],
      failures: [{ id: 'p3', name: 'Broken', message: 'HTTP 500' }],
      status: 'ready',
      error: null,
    }),
  }
  // zh browsing: name + loadFailed + message, plus a retry button.
  {
    setup()
    const reg = { value: null }
    const ctx = makeCtx(reg, failStore)
    const mod = loadClient(['models', '', null, null, null, -1])
    mod.apply(ctx)
    const face = reg.value.opts.inject('sess-1')
    const tree = reg.value.Component({ locked: false, ...face })
    const warning = findByClass(tree, 'dsh-mp-warning')
    if (!warning || textOf(warning) !== 'Broken 加载失败：HTTP 500重试') {
      console.error('FAIL: failure row text mismatch, got ' + JSON.stringify(warning && textOf(warning)))
      process.exit(1)
    }
    if (!findByClass(warning, 'dsh-mp-retry')) {
      console.error('FAIL: failure row must carry a retry button'); process.exit(1)
    }
  }
  // en locale: same row uses the english loadFailed copy.
  {
    setup()
    Object.defineProperty(globalThis, 'navigator', { value: { language: 'en-US' }, configurable: true })
    const reg = { value: null }
    const ctx = makeCtx(reg, failStore)
    const mod = loadClient(['models', '', null, null, null, -1])
    mod.apply(ctx)
    const face = reg.value.opts.inject('sess-1')
    const tree = reg.value.Component({ locked: false, ...face })
    const warning = findByClass(tree, 'dsh-mp-warning')
    if (!warning || textOf(warning) !== 'Broken failed to load: HTTP 500Retry') {
      console.error('FAIL: en failure row text mismatch, got ' + JSON.stringify(warning && textOf(warning)))
      process.exit(1)
    }
  }
  // Searching hides the failure rows.
  {
    setup()
    const reg = { value: null }
    const ctx = makeCtx(reg, failStore)
    const mod = loadClient(['models', 'gpt', null, null, null, -1])
    mod.apply(ctx)
    const face = reg.value.opts.inject('sess-1')
    const tree = reg.value.Component({ locked: false, ...face })
    if (findByClass(tree, 'dsh-mp-warning')) {
      console.error('FAIL: failure rows must hide while searching'); process.exit(1)
    }
    if (findAllByClass(tree, 'dsh-mp-option').length !== 1) {
      console.error('FAIL: the search hit should still render'); process.exit(1)
    }
  }
  console.log('PASS provider failure rows render (zh + en) and hide while searching')
}

// --- Catalog load failure renders the alert row over the cached list ---
// A hydrated catalog keeps painting its cached groups when a revalidation
// rejects, and the error surfaces as a role=alert row with a retry button.
{
  setup()
  const stored = {
    v: 1,
    at: Date.now(),
    groups: [{ id: 'p9', name: 'Cached', models: [{ id: 'm9', name: 'cached-model' }] }],
    failures: [],
  }
  globalThis.localStorage = {
    getItem: (key) => (key === 'dsh-model-picker:catalog:v1' ? JSON.stringify(stored) : null),
    setItem: () => {},
    removeItem: () => {},
  }
  const emptyDir = {
    subscribe: () => () => {},
    getSnapshot: () => ({ current: null, routable: null, groups: [], failures: [], status: 'idle', error: null }),
  }
  const reg = { value: null }
  const ctx = makeCtx(reg, emptyDir, {
    connection: { api: { llm: { models: () => Promise.reject(new Error('boom')) } } },
  })
  const mod = loadClient(['models', '', null, null, null, -1])
  mod.apply(ctx)
  const face = reg.value.opts.inject('sess-1')
  await face.catalog.load()
  const snapshot = face.catalog.getSnapshot()
  if (snapshot.status !== 'error' || snapshot.error !== 'boom') {
    console.error('FAIL: catalog snapshot should record the load failure: ' + JSON.stringify(snapshot)); process.exit(1)
  }
  const tree = reg.value.Component({ locked: false, ...face })
  const errorRow = findByClass(tree, 'dsh-mp-error')
  if (!errorRow || errorRow.args[1].role !== 'alert' || !textOf(errorRow).includes('boom')) {
    console.error('FAIL: load failure must render a role=alert row carrying the error'); process.exit(1)
  }
  if (!findByClass(errorRow, 'dsh-mp-retry')) {
    console.error('FAIL: load failure row must carry a retry button'); process.exit(1)
  }
  if (!findByClass(tree, 'dsh-mp-option')) {
    console.error('FAIL: cached groups must stay visible under the load failure'); process.exit(1)
  }
  console.log('PASS catalog load failure renders the alert row over the cached list')
}

// --- Dirty localStorage payloads fall back silently ---
// readStorage must reject: unparsable JSON, a version mismatch, and an empty
// group list — all without throwing, leaving the directory to drive the list.
{
  const dirtyCases = [
    ['unparsable JSON', 'not json'],
    ['version mismatch', JSON.stringify({ v: 2, at: 1, groups: [{ id: 'p9', name: 'X', models: [{ id: 'm9', name: 'y' }] }] })],
    ['empty group list', JSON.stringify({ v: 1, at: 1, groups: [] })],
  ]
  for (const [label, raw] of dirtyCases) {
    setup()
    globalThis.localStorage = { getItem: () => raw, setItem: () => {}, removeItem: () => {} }
    const reg = { value: null }
    const ctx = makeCtx(reg)
    const mod = loadClient(['models', '', null, null, null, -1])
    mod.apply(ctx)
    const face = reg.value.opts.inject('sess-1')
    if (face.catalog === null) {
      console.error('FAIL (' + label + '): the catalog store should still exist'); process.exit(1)
    }
    const snapshot = face.catalog.getSnapshot()
    if (snapshot.groups.length !== 0 || snapshot.status !== 'idle') {
      console.error('FAIL (' + label + '): a rejected cache must not hydrate the catalog'); process.exit(1)
    }
    let tree
    try {
      tree = reg.value.Component({ locked: false, ...face })
    } catch (e) {
      console.error('FAIL (' + label + '): render threw on a rejected cache: ' + String((e && e.stack) || e))
      process.exit(1)
    }
    if (findAllByClass(tree, 'dsh-mp-provider').length !== 2 || !findByClass(tree, 'dsh-mp-option')) {
      console.error('FAIL (' + label + '): the directory snapshot should drive the list'); process.exit(1)
    }
  }
  console.log('PASS dirty localStorage payloads fall back to the directory silently')
}

// --- Dirty RPC payload is cleaned before rendering ---
// cleanGroups drops groups without a string name / models array and models
// without a string name; non-string descriptions normalize to undefined.
{
  setup()
  const dirty = {
    groups: [
      { id: 'p1', name: 'Good', models: [{ id: 'm1', name: 'ok-model' }, { id: 'm2' }, 'junk', null] },
      { id: 'px' }, // no models array -> dropped
      'garbage',
      { id: 'p2', name: 42, models: [] }, // non-string name -> dropped
      { id: 'p3', name: 'AlsoGood', models: [{ id: 'm3', name: 'fine-model', description: 7 }] },
    ],
    failures: 'nope', // non-array -> []
  }
  const emptyDir = {
    subscribe: () => () => {},
    getSnapshot: () => ({ current: null, routable: null, groups: [], failures: [], status: 'idle', error: null }),
  }
  const reg = { value: null }
  const ctx = makeCtx(reg, emptyDir, {
    connection: { api: { llm: { models: () => Promise.resolve(dirty) } } },
  })
  const mod = loadClient(['models', '', null, null, null, -1])
  mod.apply(ctx)
  const face = reg.value.opts.inject('sess-1')
  await face.catalog.load()
  const snapshot = face.catalog.getSnapshot()
  if (JSON.stringify(snapshot.groups.map((g) => g.id)) !== '["p1","p3"]'
    || snapshot.groups[0].models.length !== 1 || snapshot.groups[0].models[0].id !== 'm1'
    || snapshot.groups[1].models[0].description !== undefined
    || snapshot.failures.length !== 0) {
    console.error('FAIL: catalog snapshot was not cleaned: ' + JSON.stringify(snapshot)); process.exit(1)
  }
  let tree
  try {
    tree = reg.value.Component({ locked: false, ...face })
  } catch (e) {
    console.error('FAIL: render threw on the dirty payload: ' + String((e && e.stack) || e)); process.exit(1)
  }
  if (findAllByClass(tree, 'dsh-mp-provider').length !== 2) {
    console.error('FAIL: only the two well-formed provider groups should render'); process.exit(1)
  }
  const options = findAllByClass(tree, 'dsh-mp-option')
  if (options.length !== 1 || !textOf(options[0]).includes('ok-model')) {
    console.error('FAIL: only the well-formed model of the first group should render'); process.exit(1)
  }
  if (findByClass(tree, 'dsh-mp-description')) {
    console.error('FAIL: a model without a description must not render the description row'); process.exit(1)
  }
  console.log('PASS dirty RPC payload is cleaned before rendering')
}

// --- Legacy host fallback: no llm.models RPC -> the directory drives the panel ---
{
  setup()
  const reg = { value: null }
  const ctx = makeCtx(reg, dirStore, { connection: undefined })
  const mod = loadClient(['models', '', null, null, null, -1])
  mod.apply(ctx)
  const face = reg.value.opts.inject('sess-1')
  if (face.available !== true || face.catalog !== null) {
    console.error('FAIL: legacy host should stay available with a null catalog'); process.exit(1)
  }
  const tree = reg.value.Component({ locked: false, ...face })
  if (findAllByClass(tree, 'dsh-mp-provider').length !== 2 || !findByClass(tree, 'dsh-mp-option')) {
    console.error('FAIL: legacy host should render from the directory snapshot'); process.exit(1)
  }
  console.log('PASS legacy host without llm.models falls back to the directory snapshot')
}

// --- Subagent sessions hide the picker ---
{
  setup()
  const reg = { value: null }
  const ctx = makeCtx(reg, dirStore, { sessions: { subagentAddress: () => 'sub-agent-addr' } })
  const mod = loadClient(null)
  mod.apply(ctx)
  const face = reg.value.opts.inject('sess-1')
  if (face.available !== false) {
    console.error('FAIL: a session with a subagent address must hide the picker'); process.exit(1)
  }
  const tree = reg.value.Component({ locked: false, ...face })
  if (tree !== null) { console.error('FAIL: a hidden picker should render null'); process.exit(1) }
  console.log('PASS subagent session hides the picker')
}

// --- Keyboard navigation: arrows move the highlight, Enter selects ---
// The stub never re-renders, so this runs in three passes: arrow keys record
// their updater through setState (the updater itself is clamp-tested), a
// second render with a pinned highlight verifies the aria mirror and the
// Enter selection, and a busy render verifies Enter is ignored.
{
  const kbStore = {
    subscribe: () => () => {},
    getSnapshot: () => ({
      current: { provider: 'p1', model: 'm1' },
      routable: true,
      groups: [
        {
          id: 'p1',
          name: 'DeepSeek',
          models: [
            { id: 'm1', name: 'deepseek-v4-flash' },
            { id: 'm1b', name: 'deepseek-v4-pro' },
          ],
        },
        { id: 'p2', name: 'OpenAI', models: [{ id: 'm2', name: 'gpt-5' }] },
      ],
      failures: [],
      status: 'ready',
      error: null,
    }),
  }
  const selections = []
  const kbExtra = {
    modelDirectories: {
      directoryFor: () => ({
        store: kbStore,
        load: () => {},
        select: (s) => { selections.push(s); return Promise.resolve() },
      }),
    },
  }
  // Pass 1: highlight -1, arrows record updaters, Enter is a no-op, Escape closes.
  {
    setup()
    const reg = { value: null }
    const ctx = makeCtx(reg, kbStore, kbExtra)
    const setCalls = []
    const mod = loadClient(['models', '', null, null, null, -1], setCalls)
    mod.apply(ctx)
    const face = reg.value.opts.inject('sess-1')
    const tree = reg.value.Component({ locked: false, ...face })
    const search = findByClass(tree, 'dsh-mp-search')
    if (search.args[1]['aria-activedescendant'] !== undefined) {
      console.error('FAIL: highlight -1 must not set aria-activedescendant'); process.exit(1)
    }
    const onKeyDown = tree.args[1].onKeyDown
    let prevented = false
    onKeyDown({ key: 'ArrowDown', preventDefault: () => { prevented = true } })
    if (!prevented) { console.error('FAIL: ArrowDown must preventDefault'); process.exit(1) }
    const down = setCalls.filter(([i]) => i === 5).map(([, v]) => v).pop()
    if (typeof down !== 'function' || down(-1) !== 0 || down(0) !== 1 || down(1) !== 1) {
      console.error('FAIL: ArrowDown updater must step and clamp at count-1'); process.exit(1)
    }
    onKeyDown({ key: 'ArrowUp', preventDefault: () => {} })
    const up = setCalls.filter(([i]) => i === 5).map(([, v]) => v).pop()
    if (typeof up !== 'function' || up(-1) !== -1 || up(1) !== 0) {
      console.error('FAIL: ArrowUp updater must step down and clamp at -1'); process.exit(1)
    }
    prevented = false
    onKeyDown({ key: 'Enter', preventDefault: () => { prevented = true } })
    if (prevented || selections.length !== 0) {
      console.error('FAIL: Enter with no highlight must be a no-op'); process.exit(1)
    }
    onKeyDown({ key: 'Escape', preventDefault: () => {} })
    if (!calledWith(setCalls, 0, null)) {
      console.error('FAIL: Escape must close the pane'); process.exit(1)
    }
  }
  // Pass 2: highlight pinned at 1 -> activedescendant mirrors it, Enter picks that row.
  {
    setup()
    const reg = { value: null }
    const ctx = makeCtx(reg, kbStore, kbExtra)
    const mod = loadClient(['models', '', null, null, null, 1])
    mod.apply(ctx)
    const face = reg.value.opts.inject('sess-1')
    const tree = reg.value.Component({ locked: false, ...face })
    const search = findByClass(tree, 'dsh-mp-search')
    if (search.args[1]['aria-activedescendant'] !== 'dsh-mp-r0-opt-1') {
      console.error('FAIL: aria-activedescendant must mirror the highlight, got '
        + JSON.stringify(search.args[1]['aria-activedescendant'])); process.exit(1)
    }
    const options = findAllByClass(tree, 'dsh-mp-option')
    if (!options[1].args[1].className.split(' ').includes('dsh-mp-optionActive')
      || options[0].args[1].className.split(' ').includes('dsh-mp-optionActive')) {
      console.error('FAIL: only the highlighted option may carry dsh-mp-optionActive'); process.exit(1)
    }
    let prevented = false
    tree.args[1].onKeyDown({ key: 'Enter', preventDefault: () => { prevented = true } })
    if (!prevented) { console.error('FAIL: Enter on a highlighted row must preventDefault'); process.exit(1) }
    if (selections.length !== 1 || selections[0].provider !== 'p1' || selections[0].model !== 'm1b') {
      console.error('FAIL: Enter must select the highlighted row: ' + JSON.stringify(selections)); process.exit(1)
    }
  }
  // Pass 3: busy (selecting) disables the options and ignores Enter.
  {
    setup()
    const busyStore = {
      subscribe: kbStore.subscribe,
      getSnapshot: () => ({ ...kbStore.getSnapshot(), status: 'selecting' }),
    }
    const reg = { value: null }
    const ctx = makeCtx(reg, busyStore, {
      modelDirectories: {
        directoryFor: () => ({
          store: busyStore,
          load: () => {},
          select: (s) => { selections.push(s); return Promise.resolve() },
        }),
      },
    })
    const mod = loadClient(['models', '', null, null, null, 0])
    mod.apply(ctx)
    const face = reg.value.opts.inject('sess-1')
    const tree = reg.value.Component({ locked: false, ...face })
    let prevented = false
    tree.args[1].onKeyDown({ key: 'Enter', preventDefault: () => { prevented = true } })
    if (prevented || selections.length !== 1) {
      console.error('FAIL: Enter while busy must be ignored'); process.exit(1)
    }
    const options = findAllByClass(tree, 'dsh-mp-option')
    if (options.some((n) => n.args[1].disabled !== true)) {
      console.error('FAIL: options must be disabled while busy'); process.exit(1)
    }
  }
  console.log('PASS keyboard navigation (arrows clamp the highlight, activedescendant mirrors it, Enter selects, busy ignores Enter)')
}

// --- Menu mousedown guard: only clicks outside the search input lose default ---
{
  setup()
  const reg = { value: null }
  const ctx = makeCtx(reg)
  const mod = loadClient(['models', '', null, null, null, -1])
  mod.apply(ctx)
  const face = reg.value.opts.inject('sess-1')
  const tree = reg.value.Component({ locked: false, ...face })
  const menu = findByClass(tree, 'dsh-mp-menu')
  if (!menu) { console.error('FAIL: models menu not rendered'); process.exit(1) }
  const onMouseDown = menu.args[1].onMouseDown
  let prevented = false
  const event = (target) => ({ target, preventDefault: () => { prevented = true } })
  onMouseDown(event({ closest: () => ({}) })) // click inside an <input>
  if (prevented) {
    console.error('FAIL: mousedown inside the search input must keep its default behavior'); process.exit(1)
  }
  onMouseDown(event({ closest: () => null })) // click elsewhere in the menu
  if (!prevented) {
    console.error('FAIL: mousedown outside an input must be prevented'); process.exit(1)
  }
  prevented = false
  onMouseDown(event(undefined)) // no target at all
  if (!prevented) {
    console.error('FAIL: targetless mousedown must be prevented'); process.exit(1)
  }
  console.log('PASS menu mousedown guard (input clicks keep default, others prevented)')
}

// --- Search results are capped; a hint row asks for a longer query ---
{
  setup()
  const many = []
  for (let i = 0; i < 101; i++) many.push({ id: 'm' + i, name: 'model-' + i })
  const capStore = {
    subscribe: () => () => {},
    getSnapshot: () => ({
      current: null,
      routable: true,
      groups: [{ id: 'p1', name: 'DeepSeek', models: many }],
      failures: [],
      status: 'ready',
      error: null,
    }),
  }
  const reg = { value: null }
  const ctx = makeCtx(reg, capStore)
  const mod = loadClient(['models', 'model', null, null, null, -1])
  mod.apply(ctx)
  const face = reg.value.opts.inject('sess-1')
  const tree = reg.value.Component({ locked: false, ...face })
  const options = findAllByClass(tree, 'dsh-mp-option')
  if (options.length !== 100) {
    console.error('FAIL: RESULTS_CAP should cap the rendered rows at 100, got ' + options.length); process.exit(1)
  }
  const hint = findByClass(tree, 'dsh-mp-empty')
  if (!hint || textOf(hint) !== '结果过多，继续输入以缩小范围') {
    console.error('FAIL: an over-cap search must render the keep-typing hint row'); process.exit(1)
  }
  const count = findByClass(tree, 'dsh-mp-providerCount')
  if (!count || textOf(count) !== '101') {
    console.error('FAIL: the provider badge must still show the full model count'); process.exit(1)
  }
  console.log('PASS search results cap renders 100 rows plus the keep-typing hint')
}

// --- Clearing the effort pins an optimistic override with an explicit undefined effort ---
// Regression guard for the label snap-back: the "provider default" click must
// set an optimistic selection whose reasoningEffort key is PRESENT (undefined),
// so the drop effect waits for the real store to clear the effort instead of
// dropping the override on the very next render. The RPC payload itself must
// keep omitting the key.
{
  setup()
  const selections = []
  const effortDir = {
    subscribe: () => () => {},
    getSnapshot: () => ({
      current: { provider: 'p1', model: 'm1', reasoningEffort: 'max' },
      routable: true,
      groups: [
        {
          id: 'p1',
          name: 'DeepSeek',
          models: [{
            id: 'm1',
            name: 'deepseek-v4-pro',
            reasoning: { efforts: [{ id: 'off', name: 'Off' }, { id: 'max', name: 'Max' }] },
          }],
        },
      ],
      failures: [],
      status: 'ready',
      error: null,
    }),
  }
  const reg = { value: null }
  const ctx = makeCtx(reg, effortDir, {
    modelDirectories: {
      directoryFor: () => ({
        store: effortDir,
        load: () => {},
        select: (s) => { selections.push(s); return Promise.resolve() },
      }),
    },
  })
  const setCalls = []
  const mod = loadClient(['effort', '', null, null, null, -1], setCalls)
  mod.apply(ctx)
  const face = reg.value.opts.inject('sess-1')
  const tree = reg.value.Component({ locked: false, ...face })
  // Rows: 提供方默认, Off, Max (current). Click "提供方默认".
  const options = findAllByClass(tree, 'dsh-mp-option')
  if (options.length !== 3) {
    console.error('FAIL: expected 3 effort rows, got ' + options.length); process.exit(1)
  }
  options[0].args[1].onClick()
  if (selections.length !== 1 || selections[0].provider !== 'p1' || selections[0].model !== 'm1'
    || 'reasoningEffort' in selections[0]) {
    console.error('FAIL: the RPC payload must omit reasoningEffort for provider default: '
      + JSON.stringify(selections)); process.exit(1)
  }
  const optimisticCall = setCalls.find(([i]) => i === 4)
  if (!optimisticCall || optimisticCall[1] === null || typeof optimisticCall[1] !== 'object'
    || !('reasoningEffort' in optimisticCall[1]) || optimisticCall[1].reasoningEffort !== undefined) {
    console.error('FAIL: optimistic override must carry an explicit undefined reasoningEffort: '
      + JSON.stringify(setCalls)); process.exit(1)
  }
  console.log('PASS provider-default click sets an optimistic override with an explicit undefined reasoningEffort')
}

// --- Trigger label falls back to the current model id when the list lacks it ---
// A stale/partial catalog can miss the current model; the trigger must show
// the model id rather than the "select model" placeholder.
{
  setup()
  const staleDir = {
    subscribe: () => () => {},
    getSnapshot: () => ({
      current: { provider: 'pGone', model: 'gone-model' },
      routable: true,
      groups: [{ id: 'p1', name: 'DeepSeek', models: [{ id: 'm1', name: 'deepseek-v4-flash' }] }],
      failures: [],
      status: 'ready',
      error: null,
    }),
  }
  const reg = { value: null }
  const ctx = makeCtx(reg, staleDir)
  const mod = loadClient(null)
  mod.apply(ctx)
  const face = reg.value.opts.inject('sess-1')
  const tree = reg.value.Component({ locked: false, ...face })
  const label = findByClass(tree, 'dsh-mp-triggerLabel')
  if (!label || textOf(label) !== 'gone-model') {
    console.error('FAIL: trigger should show the current model id when the list lacks it, got '
      + JSON.stringify(label && textOf(label))); process.exit(1)
  }
  console.log('PASS trigger label falls back to the current model id')
}

// --- Dirty RPC failures are cleaned before rendering ---
// cleanFailures drops non-object entries and entries without a string name,
// defaults a missing id to the name (React key), and normalizes a non-string
// message to ''.
{
  setup()
  const dirty = {
    groups: [{ id: 'p1', name: 'Good', models: [{ id: 'm1', name: 'ok-model' }] }],
    failures: ['junk', null, { name: 'Broken' }, { id: 'p3', name: 'Bad', message: 42 }],
  }
  const emptyDir = {
    subscribe: () => () => {},
    getSnapshot: () => ({ current: null, routable: null, groups: [], failures: [], status: 'idle', error: null }),
  }
  const reg = { value: null }
  const ctx = makeCtx(reg, emptyDir, {
    connection: { api: { llm: { models: () => Promise.resolve(dirty) } } },
  })
  const mod = loadClient(['models', '', null, null, null, -1])
  mod.apply(ctx)
  const face = reg.value.opts.inject('sess-1')
  await face.catalog.load()
  const snapshot = face.catalog.getSnapshot()
  if (snapshot.failures.length !== 2 || snapshot.failures[0].id !== 'Broken'
    || snapshot.failures[0].message !== '' || snapshot.failures[1].id !== 'p3'
    || snapshot.failures[1].message !== '') {
    console.error('FAIL: catalog failures were not cleaned: ' + JSON.stringify(snapshot.failures)); process.exit(1)
  }
  const tree = reg.value.Component({ locked: false, ...face })
  const warnings = findAllByClass(tree, 'dsh-mp-warning')
  if (warnings.length !== 2 || textOf(warnings[0]) !== 'Broken 加载失败：重试'
    || textOf(warnings[1]) !== 'Bad 加载失败：重试') {
    console.error('FAIL: cleaned failure rows mismatch: ' + JSON.stringify(warnings.map(textOf))); process.exit(1)
  }
  console.log('PASS dirty RPC failures are cleaned before rendering')
}

// --- Non-object reasoning blocks never crash the render (directory path) ---
// The per-session directory snapshot never passes through cleanGroups, so the
// component itself must shrug off `reasoning: null` / 'junk' / 42: no effort
// trigger, no crash, the model list intact.
{
  for (const bad of [null, 'junk', 42]) {
    setup()
    const badReasoningStore = {
      subscribe: () => () => {},
      getSnapshot: () => ({
        current: { provider: 'p1', model: 'm1' },
        routable: true,
        groups: [{ id: 'p1', name: 'DeepSeek', models: [{ id: 'm1', name: 'deepseek-v4-flash', reasoning: bad }] }],
        failures: [],
        status: 'ready',
        error: null,
      }),
    }
    const reg = { value: null }
    const ctx = makeCtx(reg, badReasoningStore)
    const mod = loadClient(['models', '', null, null, null, -1])
    mod.apply(ctx)
    const face = reg.value.opts.inject('sess-1')
    let tree
    try {
      tree = reg.value.Component({ locked: false, ...face })
    } catch (e) {
      console.error('FAIL: reasoning=' + JSON.stringify(bad) + ' crashed the render: ' + String((e && e.stack) || e))
      process.exit(1)
    }
    if (findByClass(tree, 'dsh-mp-effortTrigger')) {
      console.error('FAIL: a non-object reasoning block must hide the effort trigger'); process.exit(1)
    }
    if (!findByClass(tree, 'dsh-mp-option')) {
      console.error('FAIL: the model list must still render with a non-object reasoning block'); process.exit(1)
    }
  }
  console.log('PASS non-object reasoning blocks never crash the render (directory path)')
}

// --- Directory-path effort entries without a string id/name are dropped ---
// The per-session directory snapshot never passes through cleanReasoning, so
// the component itself must drop junk effort entries; an id-less entry would
// otherwise render a labelled row whose click silently selects provider
// default.
{
  setup()
  const junkEffortStore = {
    subscribe: () => () => {},
    getSnapshot: () => ({
      current: { provider: 'p1', model: 'm1', reasoningEffort: 'max' },
      routable: true,
      groups: [
        {
          id: 'p1',
          name: 'DeepSeek',
          models: [{
            id: 'm1',
            name: 'deepseek-v4-pro',
            reasoning: { efforts: [null, 'junk', { id: 'low' }, { id: 'max', name: 'Max' }] },
          }],
        },
      ],
      failures: [],
      status: 'ready',
      error: null,
    }),
  }
  const reg = { value: null }
  const ctx = makeCtx(reg, junkEffortStore)
  const mod = loadClient(['effort', '', null, null, null, -1])
  mod.apply(ctx)
  const face = reg.value.opts.inject('sess-1')
  const tree = reg.value.Component({ locked: false, ...face })
  // Rows: 提供方默认 + Max only — every junk entry dropped.
  const options = findAllByClass(tree, 'dsh-mp-option')
  if (options.length !== 2 || !textOf(options[0]).includes('提供方默认')
    || !textOf(options[1]).includes('Max')) {
    console.error('FAIL: junk effort entries must be dropped on the directory path, got '
      + options.length + ' rows'); process.exit(1)
  }
  console.log('PASS directory-path effort entries without a string id/name are dropped')
}

// --- Choosing a model whose reasoning block is non-object attaches no effort ---
// The click path used to dereference model.reasoning.defaultEffort directly;
// reasoning: null threw a TypeError on click.
{
  setup()
  const selections = []
  const nullReasoningStore = {
    subscribe: () => () => {},
    getSnapshot: () => ({
      current: { provider: 'p1', model: 'm1' },
      routable: true,
      groups: [{
        id: 'p1',
        name: 'DeepSeek',
        models: [
          { id: 'm1', name: 'deepseek-v4-flash' },
          { id: 'm2', name: 'deepseek-v4-pro', reasoning: null },
        ],
      }],
      failures: [],
      status: 'ready',
      error: null,
    }),
  }
  const reg = { value: null }
  const ctx = makeCtx(reg, nullReasoningStore, {
    modelDirectories: {
      directoryFor: () => ({
        store: nullReasoningStore,
        load: () => {},
        select: (s) => { selections.push(s); return Promise.resolve() },
      }),
    },
  })
  const mod = loadClient(['models', '', null, null, null, -1])
  mod.apply(ctx)
  const face = reg.value.opts.inject('sess-1')
  const tree = reg.value.Component({ locked: false, ...face })
  const options = findAllByClass(tree, 'dsh-mp-option')
  if (options.length !== 2) {
    console.error('FAIL: expected both provider models, got ' + options.length); process.exit(1)
  }
  try {
    options[1].args[1].onClick()
  } catch (e) {
    console.error('FAIL: choosing a model with reasoning:null threw: ' + String((e && e.stack) || e)); process.exit(1)
  }
  if (selections.length !== 1 || selections[0].provider !== 'p1' || selections[0].model !== 'm2'
    || 'reasoningEffort' in selections[0]) {
    console.error('FAIL: selection must omit reasoningEffort for a non-object reasoning block: '
      + JSON.stringify(selections)); process.exit(1)
  }
  console.log('PASS choosing a model with a non-object reasoning block attaches no reasoningEffort')
}

// --- A non-string defaultEffort is normalized away on both data paths ---
// cleanReasoning covers the catalog path; the never-cleaned directory path is
// guarded inside the component (menu row + trigger label) and on the click
// path (the RPC payload). defaultEffort: 42 must behave as "no default".
{
  // Catalog path: the snapshot itself is normalized.
  {
    setup()
    const dirty = {
      groups: [{
        id: 'p1',
        name: 'DeepSeek',
        models: [{ id: 'm1', name: 'm1', reasoning: { efforts: [{ id: 'low', name: 'Low' }], defaultEffort: 42 } }],
      }],
      failures: [],
    }
    const emptyDir = {
      subscribe: () => () => {},
      getSnapshot: () => ({ current: null, routable: null, groups: [], failures: [], status: 'idle', error: null }),
    }
    const reg = { value: null }
    const ctx = makeCtx(reg, emptyDir, {
      connection: { api: { llm: { models: () => Promise.resolve(dirty) } } },
    })
    const mod = loadClient(['models', '', null, null, null, -1])
    mod.apply(ctx)
    const face = reg.value.opts.inject('sess-1')
    await face.catalog.load()
    const reasoning = face.catalog.getSnapshot().groups[0].models[0].reasoning
    if (!reasoning || reasoning.defaultEffort !== undefined || reasoning.efforts.length !== 1) {
      console.error('FAIL: a non-string defaultEffort must normalize to undefined: ' + JSON.stringify(reasoning))
      process.exit(1)
    }
  }
  // Directory path: the effort menu keeps the provider-default row and the
  // trigger reads provider default, as if no defaultEffort were declared.
  {
    setup()
    const junkDefaultStore = {
      subscribe: () => () => {},
      getSnapshot: () => ({
        current: { provider: 'p1', model: 'm1' },
        routable: true,
        groups: [
          {
            id: 'p1',
            name: 'DeepSeek',
            models: [{ id: 'm1', name: 'deepseek-v4-pro', reasoning: { efforts: [{ id: 'low', name: 'Low' }], defaultEffort: 42 } }],
          },
        ],
        failures: [],
        status: 'ready',
        error: null,
      }),
    }
    const reg = { value: null }
    const ctx = makeCtx(reg, junkDefaultStore)
    const mod = loadClient(['effort', '', null, null, null, -1])
    mod.apply(ctx)
    const face = reg.value.opts.inject('sess-1')
    const tree = reg.value.Component({ locked: false, ...face })
    const label = findByClass(tree, 'dsh-mp-effortTriggerLabel')
    if (!label || textOf(label) !== '提供方默认') {
      console.error('FAIL: a junk defaultEffort must read as provider default, got '
        + JSON.stringify(label && textOf(label))); process.exit(1)
    }
    const options = findAllByClass(tree, 'dsh-mp-option')
    if (options.length !== 2 || !textOf(options[0]).includes('提供方默认')) {
      console.error('FAIL: a junk defaultEffort must keep the provider-default row, got ' + options.length)
      process.exit(1)
    }
  }
  // Click path: choosing such a model attaches no reasoningEffort.
  {
    setup()
    const selections = []
    const junkDefaultStore = {
      subscribe: () => () => {},
      getSnapshot: () => ({
        current: { provider: 'p1', model: 'm1' },
        routable: true,
        groups: [{
          id: 'p1',
          name: 'DeepSeek',
          models: [
            { id: 'm1', name: 'deepseek-v4-flash' },
            { id: 'm2', name: 'deepseek-v4-pro', reasoning: { efforts: [{ id: 'low', name: 'Low' }], defaultEffort: 42 } },
          ],
        }],
        failures: [],
        status: 'ready',
        error: null,
      }),
    }
    const reg = { value: null }
    const ctx = makeCtx(reg, junkDefaultStore, {
      modelDirectories: {
        directoryFor: () => ({
          store: junkDefaultStore,
          load: () => {},
          select: (s) => { selections.push(s); return Promise.resolve() },
        }),
      },
    })
    const mod = loadClient(['models', '', null, null, null, -1])
    mod.apply(ctx)
    const face = reg.value.opts.inject('sess-1')
    const tree = reg.value.Component({ locked: false, ...face })
    const options = findAllByClass(tree, 'dsh-mp-option')
    if (options.length !== 2) {
      console.error('FAIL: expected both provider models, got ' + options.length); process.exit(1)
    }
    options[1].args[1].onClick()
    if (selections.length !== 1 || selections[0].provider !== 'p1' || selections[0].model !== 'm2'
      || 'reasoningEffort' in selections[0]) {
      console.error('FAIL: a junk defaultEffort must not leak into the select payload: '
        + JSON.stringify(selections)); process.exit(1)
    }
  }
  console.log('PASS a non-string defaultEffort is normalized away on both data paths')
}

// --- Dirty reasoning blocks and id-less entries are cleaned on the catalog path ---
// cleanReasoning normalizes a non-object block to undefined and drops effort
// entries without a string id/name; cleanGroups drops groups/models without a
// string id (they cannot be keyed, tabbed, or selected).
{
  setup()
  const dirty = {
    groups: [
      {
        id: 'p1',
        name: 'DeepSeek',
        models: [
          { id: 'm1', name: 'deepseek-v4-flash', reasoning: null },
          { id: 'm2', name: 'deepseek-v4-pro', reasoning: { efforts: [null, 'junk', { id: 'low' }, { id: 'max', name: 'Max' }] } },
          { name: 'id-less-model' }, // no id -> dropped
        ],
      },
      { name: 'NoId', models: [{ id: 'mx', name: 'ghost' }] }, // no id -> dropped
    ],
    failures: [],
  }
  const emptyDir = {
    subscribe: () => () => {},
    getSnapshot: () => ({ current: null, routable: null, groups: [], failures: [], status: 'idle', error: null }),
  }
  const reg = { value: null }
  const ctx = makeCtx(reg, emptyDir, {
    connection: { api: { llm: { models: () => Promise.resolve(dirty) } } },
  })
  const mod = loadClient(['models', '', null, null, null, -1])
  mod.apply(ctx)
  const face = reg.value.opts.inject('sess-1')
  await face.catalog.load()
  const snapshot = face.catalog.getSnapshot()
  if (snapshot.groups.length !== 1 || snapshot.groups[0].id !== 'p1') {
    console.error('FAIL: the id-less group must be dropped: ' + JSON.stringify(snapshot.groups)); process.exit(1)
  }
  if (snapshot.groups[0].models.length !== 2) {
    console.error('FAIL: the id-less model must be dropped: ' + JSON.stringify(snapshot.groups[0].models)); process.exit(1)
  }
  const [m1, m2] = snapshot.groups[0].models
  if (m1.reasoning !== undefined) {
    console.error('FAIL: a null reasoning block must normalize to undefined, got ' + JSON.stringify(m1.reasoning))
    process.exit(1)
  }
  if (!m2.reasoning || !Array.isArray(m2.reasoning.efforts) || m2.reasoning.efforts.length !== 1
    || m2.reasoning.efforts[0].id !== 'max') {
    console.error('FAIL: dirty effort entries must be dropped: ' + JSON.stringify(m2.reasoning)); process.exit(1)
  }
  let tree
  try {
    tree = reg.value.Component({ locked: false, ...face })
  } catch (e) {
    console.error('FAIL: render threw on dirty reasoning blocks: ' + String((e && e.stack) || e)); process.exit(1)
  }
  if (findAllByClass(tree, 'dsh-mp-provider').length !== 1) {
    console.error('FAIL: only the well-formed provider group should render'); process.exit(1)
  }
  if (findAllByClass(tree, 'dsh-mp-option').length !== 2) {
    console.error('FAIL: only the two well-formed models should render'); process.exit(1)
  }
  console.log('PASS dirty reasoning blocks and id-less entries are cleaned on the catalog path')
}

// --- Failed select with an undefined directory error shows the generic notice ---
// The settle path concatenated directory.getSnapshot().error blindly; a
// snapshot without an error key rendered "选择失败：undefined".
{
  setup()
  const noErrorDir = {
    subscribe: () => () => {},
    getSnapshot: () => ({
      current: { provider: 'p1', model: 'm1' },
      routable: true,
      groups: [
        { id: 'p1', name: 'DeepSeek', models: [{ id: 'm1', name: 'deepseek-v4-flash' }] },
        { id: 'p2', name: 'OpenAI', models: [{ id: 'm2', name: 'gpt-5' }] },
      ],
      failures: [],
      status: 'ready',
      // no error key at all.
    }),
  }
  const reg = { value: null }
  const ctx = makeCtx(reg, noErrorDir, {
    modelDirectories: {
      directoryFor: () => ({
        store: noErrorDir,
        load: () => {},
        select: () => Promise.reject(new Error('nope')),
      }),
    },
  })
  const setCalls = []
  const mod = loadClient(['models', 'gpt', null, null, null, -1], setCalls)
  mod.apply(ctx)
  const face = reg.value.opts.inject('sess-1')
  const tree = reg.value.Component({ locked: false, ...face })
  const options = findAllByClass(tree, 'dsh-mp-option')
  if (options.length !== 1) {
    console.error('FAIL: expected exactly one search result, got ' + options.length); process.exit(1)
  }
  options[0].args[1].onClick()
  // Flush the select().then(settle) chain.
  await new Promise((resolve) => setTimeout(resolve, 0))
  if (!calledWith(setCalls, 3, '选择失败，请重试')) {
    console.error('FAIL: an undefined directory error must fall back to the generic notice: '
      + JSON.stringify(setCalls)); process.exit(1)
  }
  console.log('PASS failed select with an undefined directory error shows the generic notice')
}

// --- The effort trigger is wired to its listbox (aria-controls) ---
{
  setup()
  const reasoningStore = {
    subscribe: () => () => {},
    getSnapshot: () => ({
      current: { provider: 'p1', model: 'm1', reasoningEffort: 'max' },
      routable: true,
      groups: [
        {
          id: 'p1',
          name: 'DeepSeek',
          models: [{
            id: 'm1',
            name: 'deepseek-v4-pro',
            reasoning: { efforts: [{ id: 'off', name: 'Off' }, { id: 'max', name: 'Max' }] },
          }],
        },
      ],
      failures: [],
      status: 'ready',
      error: null,
    }),
  }
  const reg = { value: null }
  const ctx = makeCtx(reg, reasoningStore)
  const mod = loadClient(['effort', '', null, null, null, -1])
  mod.apply(ctx)
  const face = reg.value.opts.inject('sess-1')
  const tree = reg.value.Component({ locked: false, ...face })
  const trigger = findByClass(tree, 'dsh-mp-effortTrigger')
  if (!trigger || trigger.args[1]['aria-controls'] !== 'dsh-mp-r0-effort-listbox') {
    console.error('FAIL: effort trigger must carry aria-controls to its instance-scoped listbox'); process.exit(1)
  }
  const menu = findByClass(tree, 'dsh-mp-menuEffort')
  if (!menu || menu.args[1].id !== 'dsh-mp-r0-effort-listbox') {
    console.error('FAIL: effort menu must carry the instance-scoped listbox id'); process.exit(1)
  }
  console.log('PASS effort trigger is wired to its listbox via aria-controls')
}

// --- The model trigger is wired to its listbox (aria-controls) ---
{
  setup()
  const reg = { value: null }
  const ctx = makeCtx(reg)
  const mod = loadClient(['models', '', null, null, null, -1])
  mod.apply(ctx)
  const face = reg.value.opts.inject('sess-1')
  const tree = reg.value.Component({ locked: false, ...face })
  const trigger = findByClass(tree, 'dsh-mp-trigger')
  if (!trigger || trigger.args[1]['aria-controls'] !== 'dsh-mp-r0-listbox') {
    console.error('FAIL: model trigger must carry aria-controls to its instance-scoped listbox'); process.exit(1)
  }
  console.log('PASS model trigger is wired to its listbox via aria-controls')
}

// --- A reasoning block with an empty efforts array hides the effort trigger ---
// `reasoning: { efforts: [] }` offers nothing to pick: without the guard the
// trigger opened a menu whose only row ("provider default") is a no-op click.
{
  setup()
  const emptyEffortsStore = {
    subscribe: () => () => {},
    getSnapshot: () => ({
      current: { provider: 'p1', model: 'm1' },
      routable: true,
      groups: [
        {
          id: 'p1',
          name: 'DeepSeek',
          models: [{ id: 'm1', name: 'deepseek-v4-flash', reasoning: { efforts: [] } }],
        },
      ],
      failures: [],
      status: 'ready',
      error: null,
    }),
  }
  const reg = { value: null }
  const ctx = makeCtx(reg, emptyEffortsStore)
  const mod = loadClient(['effort', '', null, null, null, -1])
  mod.apply(ctx)
  const face = reg.value.opts.inject('sess-1')
  const tree = reg.value.Component({ locked: false, ...face })
  if (findByClass(tree, 'dsh-mp-effortTrigger')) {
    console.error('FAIL: an empty efforts array must hide the effort trigger'); process.exit(1)
  }
  if (findByClass(tree, 'dsh-mp-menuEffort')) {
    console.error('FAIL: an empty efforts array must not render the effort menu'); process.exit(1)
  }
  console.log('PASS empty efforts array hides the effort trigger (no provider-default-only no-op menu)')
}

// --- Per-session selection memory: replayed once per host generation ---
// The host restores a session's model/effort from the session log's last
// request header on restart, so a pick made after the session's last request
// silently reverts. The panel remembers the settled selection per session in
// localStorage and replays it when the host-restored snapshot diverges.
{
  const SELECTIONS_KEY = 'dsh-model-picker:selections:v1'
  const REASONED_GROUPS = [
    {
      id: 'p1',
      name: 'DeepSeek',
      models: [{
        id: 'm1',
        name: 'deepseek-v4-pro',
        reasoning: { efforts: [{ id: 'off', name: 'Off' }, { id: 'max', name: 'Max' }] },
      }],
    },
  ]
  const LOADING = { current: null, routable: null, groups: [], failures: [], status: 'loading', error: null }
  const IDLE = { current: null, routable: null, groups: [], failures: [], status: 'idle', error: null }

  // A directory store the block can drive by hand: emit() swaps the snapshot
  // and notifies the subscribers the component registered through its effect.
  function makeControllableStore(initial) {
    let snap = initial
    const listeners = new Set()
    return {
      subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn) } },
      getSnapshot: () => snap,
      emit: (next) => { snap = next; for (const fn of listeners) fn() },
    }
  }

  // Same wiring as makeCtx but with select() recorded into `selections` and
  // ctx.on handlers captured into onHandlers (connection/reset drives the
  // host-generation gate).
  function makeMemoryCtx(reg, store, selections, onHandlers) {
    return {
      get(name) {
        if (name === 'slots') {
          return {
            inject(key, cb) { if (key === 'conversation.input.model') reg.value = cb() },
            register(opts, Component) { return { opts, Component } },
          }
        }
        if (name === 'connection') return { api: { llm: { models: () => new Promise(() => {}) } } }
        if (name === 'remote') return { $on: () => {} }
        if (name === 'modelDirectories') {
          return {
            directoryFor: () => ({
              store,
              load: () => {},
              select: (s) => { selections.push(s); return Promise.resolve() },
            }),
          }
        }
        if (name === 'sessions') return { subagentAddress: () => undefined }
        return undefined
      },
      effect(fn) { return fn() },
      on(event, fn) { (onHandlers[event] = onHandlers[event] ?? []).push(fn) },
    }
  }

  const mockSelectionsStorage = (stored, writes) => {
    globalThis.localStorage = {
      getItem: (key) => (key === SELECTIONS_KEY && stored !== undefined ? JSON.stringify(stored) : null),
      setItem: (k, v) => { if (writes) writes.push([k, v]) },
      removeItem: () => {},
    }
  }

  // A) Host restart restores a stale selection: the remembered effort replays
  //    on the loading -> ready edge.
  {
    setup()
    mockSelectionsStorage({ v: 1, sessions: { 'sess-1': { provider: 'p1', model: 'm1', effort: 'max', at: Date.now() } } })
    const restored = {
      current: { provider: 'p1', model: 'm1' }, // stale: the header predates the effort pick
      routable: true, groups: REASONED_GROUPS, failures: [], status: 'ready', error: null,
    }
    const store = makeControllableStore(LOADING)
    const selections = []
    const reg = { value: null }
    const ctx = makeMemoryCtx(reg, store, selections, {})
    const mod = loadClient(null)
    mod.apply(ctx)
    const face = reg.value.opts.inject('sess-1')
    reg.value.Component({ locked: false, ...face })
    store.emit(restored)
    if (selections.length !== 1 || selections[0].provider !== 'p1' || selections[0].model !== 'm1'
      || selections[0].reasoningEffort !== 'max') {
      console.error('FAIL: the remembered selection should replay on the ready edge: ' + JSON.stringify(selections))
      process.exit(1)
    }
    console.log('PASS host-restored stale selection is replayed from the per-session memory')
  }

  // B) No record: nothing replays, and a repeated ready cycle stays quiet
  //    (the directory is marked reconciled for this host generation).
  {
    setup()
    mockSelectionsStorage(undefined)
    const restored = {
      current: { provider: 'p1', model: 'm1' },
      routable: true, groups: REASONED_GROUPS, failures: [], status: 'ready', error: null,
    }
    const store = makeControllableStore(LOADING)
    const selections = []
    const reg = { value: null }
    const ctx = makeMemoryCtx(reg, store, selections, {})
    const mod = loadClient(null)
    mod.apply(ctx)
    const face = reg.value.opts.inject('sess-1')
    reg.value.Component({ locked: false, ...face })
    store.emit(restored)
    store.emit(IDLE)
    store.emit(restored)
    if (selections.length !== 0) {
      console.error('FAIL: without a record nothing may replay, got ' + JSON.stringify(selections)); process.exit(1)
    }
    console.log('PASS no record -> no replay, repeated ready cycles stay quiet')
  }

  // C) The restored snapshot already matches the record: nothing to do.
  {
    setup()
    mockSelectionsStorage({ v: 1, sessions: { 'sess-1': { provider: 'p1', model: 'm1', effort: 'max', at: Date.now() } } })
    const restored = {
      current: { provider: 'p1', model: 'm1', reasoningEffort: 'max' },
      routable: true, groups: REASONED_GROUPS, failures: [], status: 'ready', error: null,
    }
    const store = makeControllableStore(LOADING)
    const selections = []
    const reg = { value: null }
    const ctx = makeMemoryCtx(reg, store, selections, {})
    const mod = loadClient(null)
    mod.apply(ctx)
    const face = reg.value.opts.inject('sess-1')
    reg.value.Component({ locked: false, ...face })
    store.emit(restored)
    if (selections.length !== 0) {
      console.error('FAIL: a matching restored selection must not replay: ' + JSON.stringify(selections)); process.exit(1)
    }
    console.log('PASS restored selection matching the record is left alone')
  }

  // D) The selecting -> ready edge persists the settled (resolved) selection.
  {
    setup()
    const writes = []
    mockSelectionsStorage(undefined, writes)
    const groups = [{
      id: 'p1',
      name: 'DeepSeek',
      models: [
        { id: 'm1', name: 'deepseek-v4-flash' },
        { id: 'm2', name: 'deepseek-v4-pro', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } },
      ],
    }]
    const selecting = {
      current: { provider: 'p1', model: 'm1' },
      routable: true, groups, failures: [], status: 'selecting', error: null,
    }
    const settled = {
      current: { provider: 'p1', model: 'm2', reasoningEffort: 'high' },
      routable: true, groups, failures: [], status: 'ready', error: null,
    }
    const store = makeControllableStore(selecting)
    const selections = []
    const reg = { value: null }
    const ctx = makeMemoryCtx(reg, store, selections, {})
    const mod = loadClient(null)
    mod.apply(ctx)
    const face = reg.value.opts.inject('sess-1')
    reg.value.Component({ locked: false, ...face })
    store.emit(settled)
    const write = writes.find(([key]) => key === SELECTIONS_KEY)
    if (!write) { console.error('FAIL: the settled selection must be persisted'); process.exit(1) }
    const record = JSON.parse(write[1]).sessions?.['sess-1']
    if (!record || record.provider !== 'p1' || record.model !== 'm2' || record.effort !== 'high'
      || typeof record.at !== 'number') {
      console.error('FAIL: persisted record mismatch: ' + JSON.stringify(record)); process.exit(1)
    }
    if (selections.length !== 0) {
      console.error('FAIL: the settle edge must persist, not replay: ' + JSON.stringify(selections)); process.exit(1)
    }
    console.log('PASS a settled select persists the resolved selection per session')
  }

  // E) The remembered model vanished from the catalog: skip the replay (a
  //    rejected select would latch an error status onto the panel).
  {
    setup()
    const writes = []
    mockSelectionsStorage({ v: 1, sessions: { 'sess-1': { provider: 'p9', model: 'gone', effort: null, at: Date.now() } } }, writes)
    const restored = {
      current: { provider: 'p1', model: 'm1' },
      routable: true, groups: REASONED_GROUPS, failures: [], status: 'ready', error: null,
    }
    const store = makeControllableStore(LOADING)
    const selections = []
    const reg = { value: null }
    const ctx = makeMemoryCtx(reg, store, selections, {})
    const mod = loadClient(null)
    mod.apply(ctx)
    const face = reg.value.opts.inject('sess-1')
    reg.value.Component({ locked: false, ...face })
    store.emit(restored)
    if (selections.length !== 0) {
      console.error('FAIL: a vanished model must not replay: ' + JSON.stringify(selections)); process.exit(1)
    }
    if (writes.some(([key]) => key === SELECTIONS_KEY)) {
      console.error('FAIL: a skipped replay must not touch the stored selections'); process.exit(1)
    }
    console.log('PASS a record whose model left the catalog is skipped without a write')
  }

  // F) The generation gate: one replay per host generation; connection/reset
  //    re-arms the reconcile for the post-restart restore.
  {
    setup()
    mockSelectionsStorage({ v: 1, sessions: { 'sess-1': { provider: 'p1', model: 'm1', effort: 'max', at: Date.now() } } })
    const restored = {
      current: { provider: 'p1', model: 'm1' },
      routable: true, groups: REASONED_GROUPS, failures: [], status: 'ready', error: null,
    }
    // Mount straight into the restored snapshot: the catch-up reconcile fires.
    const store = makeControllableStore(restored)
    const selections = []
    const onHandlers = {}
    const reg = { value: null }
    const ctx = makeMemoryCtx(reg, store, selections, onHandlers)
    const mod = loadClient(null)
    mod.apply(ctx)
    const face = reg.value.opts.inject('sess-1')
    reg.value.Component({ locked: false, ...face })
    if (selections.length !== 1) {
      console.error('FAIL: the mount-time catch-up should replay once, got ' + selections.length); process.exit(1)
    }
    store.emit(IDLE)
    store.emit(restored)
    if (selections.length !== 1) {
      console.error('FAIL: the same generation must not replay twice: ' + JSON.stringify(selections)); process.exit(1)
    }
    // Host restart: both the catalog refresh and the generation bump listen.
    for (const fn of onHandlers['connection/reset'] ?? []) fn()
    store.emit(IDLE)
    store.emit(restored)
    if (selections.length !== 2 || selections[1].provider !== 'p1' || selections[1].model !== 'm1'
      || selections[1].reasoningEffort !== 'max') {
      console.error('FAIL: a new host generation should re-arm the replay: ' + JSON.stringify(selections)); process.exit(1)
    }
    console.log('PASS the replay is gated per host generation and re-armed by connection/reset')
  }

  // G) An explicit provider-default record (effort null) replays WITHOUT the
  //    reasoningEffort key, clearing a stale restored effort.
  {
    setup()
    mockSelectionsStorage({ v: 1, sessions: { 'sess-1': { provider: 'p1', model: 'm1', effort: null, at: Date.now() } } })
    const restored = {
      current: { provider: 'p1', model: 'm1', reasoningEffort: 'low' },
      routable: true, groups: REASONED_GROUPS, failures: [], status: 'ready', error: null,
    }
    const store = makeControllableStore(LOADING)
    const selections = []
    const reg = { value: null }
    const ctx = makeMemoryCtx(reg, store, selections, {})
    const mod = loadClient(null)
    mod.apply(ctx)
    const face = reg.value.opts.inject('sess-1')
    reg.value.Component({ locked: false, ...face })
    store.emit(restored)
    if (selections.length !== 1 || selections[0].provider !== 'p1' || selections[0].model !== 'm1'
      || 'reasoningEffort' in selections[0]) {
      console.error('FAIL: provider-default replay must omit reasoningEffort: ' + JSON.stringify(selections)); process.exit(1)
    }
    console.log('PASS an explicit provider-default record replays without the reasoningEffort key')
  }
}
