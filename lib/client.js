// Browser half of dsh-model-picker. Loaded through the web plugin loader
// (window.__ModuleLoader__); React comes from the platform module table.
// Replaces the shipped composer model seat (conversation.input.model) with a
// left provider column / right model list layout — both independently
// scrollable — plus a cross-provider search box, and renders a separate
// reasoning-effort trigger immediately right of the model trigger.
// The model list rides a root-scope catalog store fed by the session-free
// `llm.models` RPC (the host builds it with the same buildModelCatalog as
// session.models, minus the agent-resume step), hydrated from localStorage
// and warmed at startup, so the panel paints from cache on the first frame;
// push events (llm/adapters-updated, settings/document-updated) revalidate
// it. The per-session ModelDirectory (ctx.modelDirectories, shared with the
// /model popup) still supplies current/routable and performs select.
window.__ModuleLoader__.load({ id: 'dsh-model-picker', factory: (require) => {
  var module = { exports: {} }; var exports = module.exports;

  const React = require('react')
  const { useState, useEffect, useRef, useMemo, useCallback, useSyncExternalStore, Fragment } = React
  const h = React.createElement

  let LOCALE = 'en'
  try {
    const nl = String(navigator.language || navigator.userLanguage || '')
    if (nl.toLowerCase().startsWith('zh')) LOCALE = 'zh'
  } catch (e) {}

  const STR = {
    zh: {
      triggerFallback: '选择模型', search: '搜索模型或提供商', loading: '加载中…', retry: '重试',
      noModels: '暂无可用模型', providerEmpty: '该提供商暂无模型', noMatch: '没有匹配的模型',
      effort: '推理档位', providerDefault: '提供方默认', selectFailed: '选择失败，请重试',
      selectFailedMsg: '选择失败：', providers: '提供商', keepTyping: '结果过多，继续输入以缩小范围',
      loadFailed: ' 加载失败：',
    },
    en: {
      triggerFallback: 'Select model', search: 'Search model or provider', loading: 'Loading…', retry: 'Retry',
      noModels: 'No models available', providerEmpty: 'No models for this provider', noMatch: 'No matching models',
      effort: 'Reasoning', providerDefault: 'Provider default', selectFailed: 'Selection failed, retry',
      selectFailedMsg: 'Selection failed: ', providers: 'Providers', keepTyping: 'Too many matches — keep typing to narrow down',
      loadFailed: ' failed to load: ',
    },
  }
  const t = (key) => STR[LOCALE][key] ?? STR.en[key]

  const CSS = `
.dsh-mp-root{position:relative;display:flex;align-items:center;gap:2px;min-width:0}
.dsh-mp-trigger{display:flex;align-items:center;gap:4px;min-width:0;max-width:220px;height:28px;padding:0 4px 0 8px;border:none;border-radius:24px;outline:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;font-weight:500;cursor:pointer}
.dsh-mp-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-mp-trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.dsh-mp-trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}
.dsh-mp-triggerLabel{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-mp-effortTrigger{display:flex;align-items:center;gap:2px;flex:0 0 auto;max-width:110px;height:28px;padding:0 4px 0 8px;border:none;border-radius:24px;outline:none;background:transparent;color:var(--dsw-alias-label-caption);font-size:12px;line-height:20px;font-weight:500;cursor:pointer}
.dsh-mp-effortTrigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-mp-effortTrigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.dsh-mp-effortTrigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}
.dsh-mp-effortTriggerLabel{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-mp-chevron{flex:0 0 auto;color:var(--dsw-alias-label-caption);font-size:10px;transition:transform 120ms ease}
.dsh-mp-chevronOpen{transform:rotate(180deg)}
.dsh-mp-menu{position:absolute;right:0;bottom:calc(100% + 8px);z-index:20;display:flex;flex-direction:column;width:min(540px,calc(100vw - 32px));max-height:min(460px,calc(100vh - 96px));overflow:hidden;padding:4px;border:1px solid var(--dsw-alias-border-inverted);border-radius:12px;background:var(--dsw-specific-menu);box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary)}
.dsh-mp-menuEffort{width:min(240px,calc(100vw - 32px))}
.dsh-mp-search{flex:0 0 auto;margin:2px 2px 6px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;outline:none;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.dsh-mp-search::placeholder{color:var(--dsw-alias-label-tertiary)}
.dsh-mp-search:focus{border-color:var(--dsw-alias-brand-primary)}
.dsh-mp-body{display:flex;flex:1;min-height:0;gap:4px}
.dsh-mp-providers{flex:0 0 150px;min-height:0;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:2px;padding:2px}
.dsh-mp-provider{display:flex;align-items:center;gap:6px;width:100%;min-height:30px;padding:0 8px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;text-align:left;cursor:pointer}
.dsh-mp-provider:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-mp-providerActive{background:var(--dsw-alias-interactive-bg-hover);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);color:var(--dsw-alias-brand-primary);font-weight:600}
.dsh-mp-providerName{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-mp-providerCount{flex:0 0 auto;padding:0 6px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.dsh-mp-list{flex:1;min-width:0;min-height:0;overflow-y:auto;overscroll-behavior:contain;border-left:1px solid var(--dsw-alias-border-l1);padding:2px 0 2px 2px}
.dsh-mp-status,.dsh-mp-empty{padding:10px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.dsh-mp-error,.dsh-mp-warning{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin:4px 2px;padding:7px 8px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.dsh-mp-warning{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-state-warn-label)}
.dsh-mp-retry{flex:0 0 auto;padding:0;border:none;background:transparent;color:inherit;font:inherit;font-weight:600;cursor:pointer}
.dsh-mp-option{display:flex;align-items:center;gap:8px;width:100%;min-height:38px;padding:6px 8px;border:none;border-radius:10px;outline:none;background:transparent;color:inherit;text-align:left;cursor:pointer}
.dsh-mp-option:hover:not(:disabled),.dsh-mp-option:focus-visible,.dsh-mp-optionActive{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-mp-option:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}
.dsh-mp-option.dsh-mp-selected{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-mp-selected .dsh-mp-modelName{color:var(--dsw-alias-brand-primary);font-weight:600}
.dsh-mp-optionCopy{display:flex;flex:1;flex-direction:column;min-width:0}
.dsh-mp-modelName{overflow:hidden;color:inherit;font-size:14px;line-height:20px;font-weight:500;text-overflow:ellipsis;white-space:nowrap}
.dsh-mp-description{overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;text-overflow:ellipsis;white-space:nowrap}
.dsh-mp-check{flex:0 0 18px;color:var(--dsw-alias-brand-primary);font-size:13px;text-align:center}
`

  // store -> ms timestamp of the last load() dispatch. Keyed by the
  // per-session snapshot store so the stamp survives seat remounts. Only
  // consulted on the legacy fallback path (hosts without the llm.models RPC).
  const LOADED_AT = new WeakMap()
  const RELOAD_TTL = 60_000

  // --- Global catalog store -------------------------------------------------
  // groups/failures are session-independent, so one root-scope store feeds
  // every session's panel via the session-free `llm.models` RPC (no
  // agentFor resume, no per-session duplication). The last good snapshot is
  // persisted to localStorage so the very first open after a page reload
  // paints instantly; freshness comes from push events plus the boot
  // prefetch in apply() — CATALOG_TTL is only a safety net for missed pushes.
  const CATALOG_KEY = 'dsh-model-picker:catalog:v1'
  const CATALOG_TTL = 10 * 60_000
  // Startup knobs: the warmup waits until adapters have had time to register
  // and is skipped for fresh caches; push events go through a trailing-edge
  // debounce because adapters register one by one at boot (each emits
  // llm/adapters-updated) and some adapters' listModels is a live HTTP
  // fetch — unthrottled bursts become serial network calls on the startup
  // path.
  const BOOT_WARMUP_DELAY = 3000
  const EVENT_DEBOUNCE = 1200
  const EMPTY_CATALOG = { groups: [], failures: [], status: 'idle', error: null }
  // getSnapshot must return a stable reference while the directory is absent:
  // a fresh object per call loops useSyncExternalStore into endless renders.
  // Same reasoning as EMPTY_CATALOG above.
  const EMPTY_STATE = { current: null, routable: null, groups: [], failures: [], status: 'idle', error: null }
  // Search renders at most this many result rows; a hint row under the cap
  // asks for a longer query instead of mounting hundreds of buttons.
  const RESULTS_CAP = 100

  // Node's setTimeout returns a Timeout (with unref), browsers a number;
  // unref'd timers never hold a non-browser process open.
  const unref = (timer) => {
    if (timer !== null && typeof timer === 'object' && typeof timer.unref === 'function') timer.unref()
  }

  // A reasoning block is adapter-supplied too: a non-object block (null, a
  // bare string, ...) reads as "no reasoning", and effort entries without a
  // string id/name cannot be keyed or labelled, so they are dropped.
  const cleanReasoning = (reasoning) => {
    if (reasoning === null || typeof reasoning !== 'object') return undefined
    if (!Array.isArray(reasoning.efforts)) return { ...reasoning, efforts: [] }
    return {
      ...reasoning,
      efforts: reasoning.efforts.filter(
        (level) => level !== null && typeof level === 'object'
          && typeof level.id === 'string' && typeof level.name === 'string',
      ),
    }
  }

  // Drop catalog entries the panel cannot render instead of letting one bad
  // adapter payload break the whole list; non-string descriptions normalize
  // to undefined (the renderers already treat that as "no description").
  // Entries without a string id cannot be keyed, tabbed, or selected (select
  // sends the ids), so they go too.
  const cleanGroups = (list) => {
    const out = []
    for (const group of list) {
      if (group === null || typeof group !== 'object' || typeof group.id !== 'string'
        || typeof group.name !== 'string' || !Array.isArray(group.models)) continue
      const models = []
      for (const model of group.models) {
        if (model === null || typeof model !== 'object' || typeof model.id !== 'string'
          || typeof model.name !== 'string') continue
        models.push({
          ...model,
          description: typeof model.description === 'string' ? model.description : undefined,
          reasoning: cleanReasoning(model.reasoning),
        })
      }
      out.push({ ...group, models })
    }
    return out
  }

  // Same treatment for the failure rows: an untrusted payload must not render
  // "undefined" labels or collapse the React keys. id falls back to the name.
  const cleanFailures = (list) => {
    const out = []
    for (const failure of list) {
      if (failure === null || typeof failure !== 'object' || typeof failure.name !== 'string') continue
      out.push({
        id: typeof failure.id === 'string' ? failure.id : failure.name,
        name: failure.name,
        message: typeof failure.message === 'string' ? failure.message : '',
      })
    }
    return out
  }

  function readStorage() {
    try {
      const raw = globalThis.localStorage === undefined ? null : globalThis.localStorage.getItem(CATALOG_KEY)
      if (typeof raw !== 'string') return null
      const parsed = JSON.parse(raw)
      if (parsed === null || parsed.v !== 1 || !Array.isArray(parsed.groups)) return null
      const groups = cleanGroups(parsed.groups)
      // An empty group list is never a cache worth hydrating: it either came
      // from a race (load answered before adapters registered) or means the
      // host genuinely has nothing, in which case revalidating is cheap.
      if (groups.length === 0) return null
      return {
        // NaN slips past a typeof check and would make every TTL compare
        // false, pinning a stale cache forever.
        at: Number.isFinite(parsed.at) ? parsed.at : 0,
        groups,
        failures: Array.isArray(parsed.failures) ? cleanFailures(parsed.failures) : [],
      }
    } catch (err) { return null }
  }

  function writeStorage(groups, failures) {
    try {
      if (globalThis.localStorage !== undefined) {
        globalThis.localStorage.setItem(CATALOG_KEY, JSON.stringify({ v: 1, at: Date.now(), groups, failures }))
      }
    } catch (err) { /* quota / privacy mode: the cache stays memory-only */ }
  }

  function createCatalog(api) {
    const cached = readStorage()
    let snapshot = {
      groups: cached === null ? [] : cached.groups,
      failures: cached === null ? [] : cached.failures,
      // 'loading' only exists while there is nothing to show; background
      // revalidations keep the previous status so the list never flickers.
      status: cached === null ? 'idle' : 'ready',
      error: null,
    }
    let loadedAt = cached === null ? 0 : cached.at
    let inflight = null
    const listeners = new Set()
    const emit = () => { for (const fn of listeners) fn() }
    const load = () => {
      if (inflight !== null) return inflight
      if (snapshot.groups.length === 0) {
        snapshot = { groups: snapshot.groups, failures: snapshot.failures, status: 'loading', error: null }
        emit()
      }
      let request
      try {
        request = Promise.resolve(api.llm.models({}))
      } catch (err) {
        request = Promise.reject(err)
      }
      inflight = request.then(
        (value) => {
          const groups = cleanGroups(Array.isArray(value.groups) ? value.groups : [])
          const failures = cleanFailures(Array.isArray(value.failures) ? value.failures : [])
          // Never downgrade a non-empty snapshot to an empty one: an empty
          // answer right after boot usually means the adapters had not
          // finished registering yet, not that every provider vanished.
          // loadedAt stays untouched so the next open retries sooner.
          if (groups.length === 0 && snapshot.groups.length > 0) return
          snapshot = { groups, failures, status: 'ready', error: null }
          loadedAt = Date.now()
          if (groups.length > 0) writeStorage(groups, failures)
        },
        (err) => {
          snapshot = { groups: snapshot.groups, failures: snapshot.failures, status: 'error', error: String((err && err.message) || err) }
        },
      ).then(() => { inflight = null; emit() })
      return inflight
    }
    return {
      subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn) } },
      getSnapshot: () => snapshot,
      loadedAt: () => loadedAt,
      load,
    }
  }

  function ModelPicker(props) {
    const locked = props.locked
    const available = props.available
    const directory = props.directory
    const catalog = props.catalog ?? null
    const load = props.load
    const select = props.select

    // useCallback pins each subscribe identity: a fresh closure per render
    // makes useSyncExternalStore tear down and re-register the listener on
    // every paint.
    const subscribeDirectory = useCallback(
      (fn) => directory === null ? (() => {}) : directory.subscribe(fn),
      [directory],
    )
    const subscribeCatalog = useCallback(
      (fn) => catalog === null ? (() => {}) : catalog.subscribe(fn),
      [catalog],
    )
    const state = useSyncExternalStore(
      subscribeDirectory,
      () => directory === null ? EMPTY_STATE : directory.getSnapshot(),
    )
    const catalogState = useSyncExternalStore(
      subscribeCatalog,
      () => catalog === null ? EMPTY_CATALOG : catalog.getSnapshot(),
    )
    const [pane, setPane] = useState(null) // null | 'models' | 'effort'
    const [query, setQuery] = useState('')
    const [activeProvider, setActiveProvider] = useState(null)
    const [notice, setNotice] = useState(null)
    // Optimistic select override: the directory store only reflects a model/
    // effort switch after the host round-trip (a few hundred ms). Mirror the
    // pending selection locally so the menu closes, the trigger label and the
    // check mark all move the moment the user clicks; the store snapshot
    // takes over once the push event lands (effect below), with a timeout
    // fallback so a missed push never pins the override forever.
    const [optimistic, setOptimistic] = useState(null)
    // Keyboard highlight for the combobox/listbox pattern: an index into the
    // currently visible option list (-1 = none), surfaced through
    // aria-activedescendant instead of roving tabindex.
    const [highlight, setHighlight] = useState(-1)
    const lastActionRef = useRef('load')
    const pendingRef = useRef(null)
    const rootRef = useRef(null)
    const triggerRef = useRef(null)
    const effortTriggerRef = useRef(null)
    const searchRef = useRef(null)
    const providersRef = useRef(null)
    const listRef = useRef(null)
    const lastNavRef = useRef(null)

    const q = query.trim().toLowerCase()
    const current = optimistic ?? state.current

    // The global catalog drives the list only once it holds real data; an
    // empty/errored catalog never overrides the per-session directory
    // snapshot (its mount-time load returns the same groups), so a premature
    // empty answer can never blank the panel.
    const catalogLive = catalog !== null && catalogState.groups.length > 0
    const groups = catalogLive ? catalogState.groups : state.groups
    const failures = catalogLive ? catalogState.failures : state.failures
    const listStatus = catalogLive ? catalogState.status : state.status
    const listError = catalogLive ? catalogState.error : state.error

    const currentChoice = useMemo(() => {
      if (current === null) return null
      for (const group of groups) {
        if (group.id !== current.provider) continue
        for (const model of group.models) {
          if (model.id === current.model) return { group, model }
        }
      }
      return null
    }, [groups, current])

    // Adapter payloads are untrusted — and the per-session directory path
    // never passes through cleanGroups: a non-object reasoning block (null, a
    // bare string, ...) reads as "no reasoning" and non-object effort entries
    // are dropped, so a malformed block cannot crash the trigger label or the
    // effort menu.
    const modelReasoning = currentChoice === null ? undefined : currentChoice.model.reasoning
    const reasoning = modelReasoning !== null && typeof modelReasoning === 'object' ? modelReasoning : undefined
    const efforts = reasoning !== undefined && Array.isArray(reasoning.efforts)
      ? reasoning.efforts.filter((level) => level !== null && typeof level === 'object')
      : []
    const effectiveEffort = current === null ? undefined : (current.reasoningEffort ?? reasoning?.defaultEffort)
    const effortLabel = reasoning === undefined ? undefined
      : effectiveEffort === undefined ? t('providerDefault')
        : (efforts.find((level) => level.id === effectiveEffort)?.name ?? String(effectiveEffort))
    const effortChoices = useMemo(() => {
      if (reasoning === undefined) return []
      const rows = []
      if (reasoning.defaultEffort === undefined) {
        rows.push({ key: 'provider-default', effort: undefined, label: t('providerDefault') })
      }
      for (const level of efforts) {
        rows.push({ key: level.id, effort: level.id, label: level.name, description: level.description })
      }
      return rows
    }, [reasoning, efforts])

    const searching = q !== ''
    // Lowercase index over the catalog, rebuilt only when the group list
    // changes, so a keystroke never re-lowercases every provider/model.
    const searchIndex = useMemo(() => groups.map((group) => ({
      group,
      nameLower: group.name.toLowerCase(),
      models: group.models.map((model) => ({
        model,
        nameLower: model.name.toLowerCase(),
        descLower: typeof model.description === 'string' ? model.description.toLowerCase() : undefined,
      })),
    })), [groups])
    const results = useMemo(() => {
      if (!searching) return []
      const out = []
      for (const entry of searchIndex) {
        const providerMatch = entry.nameLower.includes(q)
        for (const item of entry.models) {
          const modelMatch = item.nameLower.includes(q)
            || (item.descLower !== undefined && item.descLower.includes(q))
          if (providerMatch || modelMatch) out.push({ group: entry.group, model: item.model })
        }
      }
      return out
    }, [searching, q, searchIndex])

    const activeTab = (activeProvider !== null && groups.some((g) => g.id === activeProvider))
      ? activeProvider
      : (current !== null && groups.some((g) => g.id === current.provider))
        ? current.provider
        : (groups.length > 0 ? groups[0].id : null)
    const activeGroup = groups.find((g) => g.id === activeTab) ?? null

    // The right column is one flat option list in both modes: capped search
    // results across providers, or the active provider's models. The keyboard
    // highlight indexes into this list.
    const visibleModels = useMemo(() => {
      if (searching) return results.slice(0, RESULTS_CAP)
      return activeGroup === null ? [] : activeGroup.models.map((model) => ({ group: activeGroup, model }))
    }, [searching, results, activeGroup])

    const busy = state.status === 'selecting'
    // A current model missing from the (possibly stale) list still shows its
    // id instead of the "select model" placeholder.
    const modelLabel = currentChoice !== null ? currentChoice.model.name
      : current !== null && typeof current.model === 'string' ? current.model
        : t('triggerFallback')

    const reload = () => {
      lastActionRef.current = 'load'
      if (catalog !== null) void catalog.load()
      else load()
    }

    // Freshness gate shared by the mount effect and show(): revalidate only
    // when there is nothing cached to show, the last load failed, or the
    // cache escaped every push event for longer than the TTL. A background
    // refresh never covers the list.
    const reloadIfStale = () => {
      if (catalog !== null) {
        if (catalogState.groups.length === 0 || catalogState.status === 'error'
          || Date.now() - catalog.loadedAt() > CATALOG_TTL) reload()
      } else if (directory !== null) {
        const loadedAt = LOADED_AT.get(directory) ?? 0
        if (groups.length === 0 || state.status === 'error' || Date.now() - loadedAt > RELOAD_TTL) reload()
      }
    }

    // Mount load honors the same TTL as show(): with the catalog warmed at
    // startup (or a recent per-session load behind us) mounting is paint-only.
    useEffect(() => {
      if (!available) return
      reloadIfStale()
      // Snapshot values on purpose: keying this effect on status/groups would
      // loop the load on a permanent 'error'.
    }, [available, load, catalog])

    useEffect(() => {
      if (pane === 'models') searchRef.current?.focus()
    }, [pane])

    // Opening the models pane scrolls the active provider tab and the checked
    // model into view ('nearest' never yanks an already-visible row).
    useEffect(() => {
      if (pane !== 'models') return
      providersRef.current?.querySelector('.dsh-mp-providerActive')?.scrollIntoView({ block: 'nearest' })
      listRef.current?.querySelector('.dsh-mp-selected')?.scrollIntoView({ block: 'nearest' })
    }, [pane])

    // Switching provider tab or search state restarts the right column at the
    // top — but not on the open frame itself, where the scroll-into-view
    // above owns the position.
    useEffect(() => {
      if (pane !== 'models') { lastNavRef.current = null; return }
      const nav = String(activeTab) + '|' + q
      if (lastNavRef.current !== null && lastNavRef.current !== nav && listRef.current !== null) {
        listRef.current.scrollTop = 0
      }
      lastNavRef.current = nav
    }, [pane, activeTab, q])

    // Any change that reshapes the visible list drops the keyboard highlight.
    useEffect(() => { setHighlight(-1) }, [pane, q, activeTab])

    // Keep the highlighted option visible while arrowing through a long list.
    useEffect(() => {
      if (typeof highlight !== 'number' || highlight < 0 || pane === null) return
      const el = document.getElementById((pane === 'effort' ? 'dsh-mp-effort-opt-' : 'dsh-mp-opt-') + highlight)
      if (el !== null && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' })
    }, [highlight, pane])

    // Drop the optimistic override once the real store snapshot catches up.
    // A model switch whose selection carries no reasoningEffort key (the new
    // model declares no default) settles as soon as provider+model land — the
    // host resolves the effort on its own. chooseEffort always sets the key
    // (undefined for "provider default"), so an effort change — including a
    // clear — holds the override until the real effort matches; otherwise the
    // trigger label would snap back to the previous effort for the whole RPC
    // round-trip.
    useEffect(() => {
      if (optimistic == null) return
      const real = state.current
      if (real === null || real.provider !== optimistic.provider || real.model !== optimistic.model) return
      if ('reasoningEffort' in optimistic && real.reasoningEffort !== optimistic.reasoningEffort) return
      setOptimistic(null)
    }, [state, optimistic])

    // Safety net: a missed push must not pin the override forever.
    useEffect(() => {
      if (optimistic == null) return
      const timer = setTimeout(() => setOptimistic(null), 5000)
      return () => clearTimeout(timer)
    }, [optimistic])

    const close = (restoreFocus) => {
      setPane(null)
      setNotice(null)
      setActiveProvider(null)
      // Focus returns to the trigger that opened the pane being closed.
      if (restoreFocus) {
        const trigger = pane === 'effort' ? effortTriggerRef.current : triggerRef.current
        trigger?.focus()
      }
    }

    const show = () => {
      setNotice(null)
      setQuery('')
      lastActionRef.current = 'load'
      setPane('models')
      // Instant open: the list paints from cache; reloadIfStale decides
      // whether a background revalidation is due.
      reloadIfStale()
    }

    const showEffort = () => {
      setNotice(null)
      setPane('effort')
    }

    // Failure path of a background select: roll the label back and reopen the
    // pane so the error is visible. A stale settle (a newer click already
    // superseded this one) is ignored.
    const settle = (accepted, reopenPane, selection) => {
      if (accepted || pendingRef.current !== selection) return
      pendingRef.current = null
      setOptimistic(null)
      const message = directory === null ? null : directory.getSnapshot().error
      // The directory error is host data: a missing/empty message falls back
      // to the generic notice instead of rendering "...：undefined".
      setNotice(typeof message === 'string' && message !== ''
        ? t('selectFailedMsg') + message
        : t('selectFailed'))
      setPane(reopenPane)
    }

    const choose = (group, model) => {
      if (current !== null && current.provider === group.id && current.model === model.id) {
        close(true)
        return
      }
      lastActionRef.current = 'select'
      // model.reasoning is adapter data: optional chaining keeps a non-object
      // block (null, a string, ...) from throwing on the click path.
      const selection = {
        provider: group.id,
        model: model.id,
        ...(model.reasoning?.defaultEffort !== undefined
          ? { reasoningEffort: model.reasoning.defaultEffort }
          : {}),
      }
      // Instant switch: optimistic label + immediate close, RPC in background.
      pendingRef.current = selection
      setOptimistic(selection)
      close(true)
      void select(selection).then((ok) => settle(ok, 'models', selection))
    }

    const chooseEffort = (effort) => {
      if (current === null) return
      if (effectiveEffort === effort) {
        close(true)
        return
      }
      lastActionRef.current = 'select'
      const selection = {
        provider: current.provider,
        model: current.model,
        ...(effort === undefined ? {} : { reasoningEffort: effort }),
      }
      pendingRef.current = selection
      // The optimistic copy always carries the reasoningEffort key (undefined
      // for "provider default") so the drop effect can tell an effort clear
      // apart from a model switch without a declared default effort.
      setOptimistic({ provider: selection.provider, model: selection.model, reasoningEffort: effort })
      close(true)
      void select(selection).then((ok) => settle(ok, 'effort', selection))
    }

    // Swallowing mousedown keeps focus on the input while the pane is open,
    // but clicks inside the search box must keep their default behavior
    // (caret placement, text selection).
    const onMenuMouseDown = (event) => {
      if (!event.target?.closest?.('input')) event.preventDefault()
    }

    const onRootKeyDown = (event) => {
      if (event.key === 'Escape' && pane !== null) {
        event.preventDefault()
        close(true)
        return
      }
      // Combobox/listbox keyboard model: arrows move the highlight, Enter
      // picks the highlighted option.
      if (pane === null) return
      const count = pane === 'models' ? visibleModels.length : effortChoices.length
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (count === 0) return
        event.preventDefault()
        const delta = event.key === 'ArrowDown' ? 1 : -1
        setHighlight((prev) => {
          const next = (typeof prev === 'number' ? prev : -1) + delta
          return next < 0 ? -1 : (next >= count ? count - 1 : next)
        })
      } else if (event.key === 'Enter') {
        const index = typeof highlight === 'number' ? highlight : -1
        if (index < 0 || index >= count || busy) return
        event.preventDefault()
        if (pane === 'models') {
          const row = visibleModels[index]
          choose(row.group, row.model)
        } else {
          chooseEffort(effortChoices[index].effort)
        }
      }
    }

    const onBlur = (event) => {
      const related = event.relatedTarget
      if (related !== null && rootRef.current !== null && rootRef.current.contains(related)) return
      close()
    }

    const renderOption = (group, model, index) => {
      const selected = current !== null && current.provider === group.id && current.model === model.id
      const detail = searching
        ? (group.name + (model.description !== undefined ? ' · ' + model.description : ''))
        : (model.description ?? '')
      return h('button', {
        key: group.id + '/' + model.id,
        id: 'dsh-mp-opt-' + index,
        type: 'button',
        role: 'option',
        'aria-selected': selected,
        className: 'dsh-mp-option' + (selected ? ' dsh-mp-selected' : '') + (index === highlight ? ' dsh-mp-optionActive' : ''),
        disabled: busy,
        onClick: () => { choose(group, model) },
      },
        h('span', { className: 'dsh-mp-optionCopy' },
          h('span', { className: 'dsh-mp-modelName', title: model.name }, model.name),
          detail !== '' && h('span', { className: 'dsh-mp-description', title: detail }, detail),
        ),
        h('span', { className: 'dsh-mp-check', 'aria-hidden': true }, selected ? '✓' : ''),
      )
    }

    const renderEffortOption = (level, index) => {
      const selected = effectiveEffort === level.effort
      return h('button', {
        key: level.key,
        id: 'dsh-mp-effort-opt-' + index,
        type: 'button',
        role: 'option',
        'aria-selected': selected,
        className: 'dsh-mp-option' + (selected ? ' dsh-mp-selected' : '') + (index === highlight ? ' dsh-mp-optionActive' : ''),
        disabled: busy,
        title: level.description,
        onClick: () => { chooseEffort(level.effort) },
      },
        h('span', { className: 'dsh-mp-optionCopy' },
          h('span', { className: 'dsh-mp-modelName' }, level.label),
        ),
        h('span', { className: 'dsh-mp-check', 'aria-hidden': true }, selected ? '✓' : ''),
      )
    }

    if (!available || directory === null) return null

    const effortAvailable = reasoning !== undefined && effortChoices.length > 0
    const activeDescendant = pane === 'models' && typeof highlight === 'number'
      && highlight >= 0 && highlight < visibleModels.length
      ? 'dsh-mp-opt-' + highlight
      : undefined
    // The effort pane has no input, so focus stays on its trigger; the
    // trigger carries the activedescendant mirror the search combobox carries
    // for the models pane.
    const effortDescendant = pane === 'effort' && typeof highlight === 'number'
      && highlight >= 0 && highlight < effortChoices.length
      ? 'dsh-mp-effort-opt-' + highlight
      : undefined

    return h('div', { ref: rootRef, className: 'dsh-mp-root', onKeyDown: onRootKeyDown, onBlur: onBlur },
      h('button', {
        ref: triggerRef,
        type: 'button',
        className: 'dsh-mp-trigger',
        title: modelLabel,
        'aria-label': modelLabel,
        'aria-haspopup': 'listbox',
        'aria-expanded': pane === 'models',
        disabled: locked,
        onClick: () => { if (pane === 'models') { close() } else { show() } },
      },
        h('span', { className: 'dsh-mp-triggerLabel' }, modelLabel),
        h('span', { className: 'dsh-mp-chevron' + (pane === 'models' ? ' dsh-mp-chevronOpen' : '') }, '▾'),
      ),
      effortAvailable && h('button', {
        ref: effortTriggerRef,
        type: 'button',
        className: 'dsh-mp-effortTrigger',
        title: t('effort'),
        'aria-label': effortLabel === undefined ? t('effort') : t('effort') + ' ' + effortLabel,
        'aria-haspopup': 'listbox',
        'aria-expanded': pane === 'effort',
        'aria-controls': 'dsh-mp-effort-listbox',
        'aria-activedescendant': effortDescendant,
        disabled: locked,
        onClick: () => { if (pane === 'effort') { close() } else { showEffort() } },
      },
        h('span', { className: 'dsh-mp-effortTriggerLabel' }, effortLabel),
        h('span', { className: 'dsh-mp-chevron' + (pane === 'effort' ? ' dsh-mp-chevronOpen' : '') }, '▾'),
      ),
      pane === 'models' && h('div', {
        className: 'dsh-mp-menu',
        tabIndex: -1,
        onMouseDown: onMenuMouseDown,
        'aria-busy': listStatus === 'loading' || busy,
      },
        h('input', {
          ref: searchRef,
          type: 'text',
          className: 'dsh-mp-search',
          role: 'combobox',
          'aria-autocomplete': 'list',
          'aria-expanded': true,
          'aria-controls': 'dsh-mp-listbox',
          'aria-activedescendant': activeDescendant,
          'aria-label': t('search'),
          placeholder: t('search'),
          value: query,
          onChange: (event) => { setQuery(event.target.value) },
        }),
        h('div', { className: 'dsh-mp-body' },
          h('div', { className: 'dsh-mp-providers', ref: providersRef, role: 'group', 'aria-label': t('providers') },
            groups.map((group) => {
              const active = !searching && group.id === activeTab
              return h('button', {
                key: group.id,
                type: 'button',
                'aria-current': active ? 'true' : undefined,
                className: 'dsh-mp-provider' + (active ? ' dsh-mp-providerActive' : ''),
                onClick: () => { setQuery(''); setActiveProvider(group.id) },
              },
                h('span', { className: 'dsh-mp-providerName', title: group.name }, group.name),
                h('span', { className: 'dsh-mp-providerCount' }, String(group.models.length)),
              )
            }),
          ),
          h('div', { className: 'dsh-mp-list', ref: listRef, role: 'listbox', id: 'dsh-mp-listbox' },
            listStatus === 'loading' && groups.length === 0
              ? h('div', { className: 'dsh-mp-status' }, t('loading'))
              : h(Fragment, null,
                  listError !== null && lastActionRef.current === 'load'
                    && h('div', { className: 'dsh-mp-error', role: 'alert' },
                        h('span', null, String(listError)),
                        h('button', { type: 'button', className: 'dsh-mp-retry', onClick: reload }, t('retry')),
                      ),
                  notice !== null
                    && h('div', { className: 'dsh-mp-error', role: 'alert' },
                        h('span', null, notice),
                      ),
                  !searching && failures.map((failure) =>
                    h('div', { className: 'dsh-mp-warning', key: failure.id },
                      h('span', null, failure.name + t('loadFailed') + failure.message),
                      h('button', { type: 'button', className: 'dsh-mp-retry', onClick: reload }, t('retry')),
                    ),
                  ),
                  searching
                    ? (results.length === 0
                        ? h('div', { className: 'dsh-mp-empty' }, t('noMatch'))
                        : h(Fragment, null,
                            visibleModels.map((row, index) => renderOption(row.group, row.model, index)),
                            results.length > visibleModels.length
                              && h('div', { className: 'dsh-mp-empty' }, t('keepTyping')),
                          ))
                    : activeGroup === null
                      ? (listStatus === 'ready' && groups.length === 0
                          ? h('div', { className: 'dsh-mp-empty' }, t('noModels'))
                          : null)
                      : activeGroup.models.length === 0
                        ? h('div', { className: 'dsh-mp-empty' }, t('providerEmpty'))
                        : visibleModels.map((row, index) => renderOption(row.group, row.model, index)),
                ),
          ),
        ),
      ),
      pane === 'effort' && effortAvailable && h('div', {
        className: 'dsh-mp-menu dsh-mp-menuEffort',
        role: 'listbox',
        id: 'dsh-mp-effort-listbox',
        'aria-label': t('effort'),
        tabIndex: -1,
        onMouseDown: onMenuMouseDown,
        'aria-busy': busy,
      },
        notice !== null
          && h('div', { className: 'dsh-mp-error', role: 'alert' },
              h('span', null, notice),
            ),
        effortChoices.map(renderEffortOption),
      ),
    )
  }

  const inject = ['slots', 'connection', 'remote']

  function apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    ctx.effect(() => {
      const id = 'dsh-model-picker-style'
      if (!document.getElementById(id)) {
        const s = document.createElement('style')
        s.id = id
        s.textContent = CSS
        document.head.appendChild(s)
      }
      return () => { const el = document.getElementById(id); if (el) el.remove() }
    }, 'model-picker-style')

    // Root-scope catalog: one `llm.models` feed shared by every session's
    // panel. The boot prefetch below (dsh.client.immediately loads this
    // bundle at startup) plus push events keep it warm, so opening the panel
    // never waits on the network. Hosts predating the llm.models RPC fall
    // back to the per-session directory path (catalog stays null). Every
    // listener and timer lives inside a ctx.effect so a plugin teardown
    // (hot reload) unsubscribes and clears them instead of accumulating.
    let catalog = null
    try {
      const connection = ctx.get('connection')
      const api = connection === undefined ? undefined : connection.api
      if (api !== undefined && api.llm !== undefined && typeof api.llm.models === 'function') {
        const store = createCatalog(api)
        catalog = store
        ctx.effect(() => {
          let refreshTimer = null
          const refresh = () => {
            if (refreshTimer !== null) clearTimeout(refreshTimer)
            refreshTimer = setTimeout(() => {
              refreshTimer = null
              void store.load()
            }, EVENT_DEBOUNCE)
            unref(refreshTimer)
          }
          // Handlers close over `store`, never the mutable `catalog` binding,
          // so a mid-setup throw (the catch below nulls that binding) cannot
          // leave a registered listener dereferencing null.
          const unbind = []
          const remote = ctx.get('remote')
          if (remote !== undefined && typeof remote.$on === 'function') {
            for (const event of ['llm/adapters-updated', 'settings/document-updated']) {
              // Prefer an unsubscribe returned by $on; fall back to the
              // emitter's $off/off pair, whichever the host provides.
              const ret = remote.$on(event, refresh)
              if (typeof ret === 'function') unbind.push(ret)
              else if (typeof remote.$off === 'function') unbind.push(() => { remote.$off(event, refresh) })
              else if (typeof remote.off === 'function') unbind.push(() => { remote.off(event, refresh) })
            }
          }
          if (typeof ctx.on === 'function') {
            const ret = ctx.on('connection/reset', refresh)
            if (typeof ret === 'function') unbind.push(ret)
          }
          // Boot warmup, delayed so it neither races adapter registration nor
          // puts an RPC whose fan-out may include a live provider fetch onto
          // the startup path; caches younger than CATALOG_TTL skip it.
          const warmup = setTimeout(() => {
            if (Date.now() - store.loadedAt() > CATALOG_TTL) void store.load()
          }, BOOT_WARMUP_DELAY)
          unref(warmup)
          return () => {
            if (refreshTimer !== null) clearTimeout(refreshTimer)
            clearTimeout(warmup)
            for (const off of unbind) off()
          }
        }, 'model-picker-catalog')
      }
    } catch (err) {
      catalog = null
    }

    slots.inject('conversation.input.model', () => slots.register({
      name: 'conversation.input.model',
      priority: -1,
      registrant: 'dsh-model-picker',
      inject: (sessionId) => {
        try {
          const models = ctx.get('modelDirectories')
          const sessions = ctx.get('sessions')
          if (models === undefined || typeof models.directoryFor !== 'function') {
            return { available: false, directory: null, catalog: null, load: () => {}, select: () => Promise.resolve(false) }
          }
          const directory = models.directoryFor(sessionId)
          const available = sessions !== undefined && typeof sessions.subagentAddress === 'function'
            ? sessions.subagentAddress(sessionId) === undefined
            : true
          return {
            available,
            directory: directory.store,
            catalog,
            load: () => {
              if (!available) return
              LOADED_AT.set(directory.store, Date.now())
              // Same defensive wrapping as the catalog's RPC call: a sync
              // throw (or a non-promise return) must not break the open path.
              try {
                Promise.resolve(directory.load()).catch(() => { /* surfaced on the store */ })
              } catch (err) { /* surfaced on the store */ }
            },
            select: (selection) => {
              if (!available) return Promise.resolve(false)
              try {
                return Promise.resolve(directory.select(selection)).then(() => true, () => false)
              } catch (err) {
                return Promise.resolve(false)
              }
            },
          }
        } catch (err) {
          return { available: false, directory: null, catalog: null, load: () => {}, select: () => Promise.resolve(false) }
        }
      },
    }, ModelPicker))
  }

  module.exports = { inject, apply }
  return module.exports;
} })
