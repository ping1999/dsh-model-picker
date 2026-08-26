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
  const { useState, useEffect, useRef, useMemo, useSyncExternalStore, Fragment } = React
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
      selectFailedMsg: '选择失败：', providers: '提供商',
    },
    en: {
      triggerFallback: 'Select model', search: 'Search model or provider', loading: 'Loading…', retry: 'Retry',
      noModels: 'No models available', providerEmpty: 'No models for this provider', noMatch: 'No matching models',
      effort: 'Reasoning', providerDefault: 'Provider default', selectFailed: 'Selection failed, retry',
      selectFailedMsg: 'Selection failed: ', providers: 'Providers',
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
.dsh-mp-providers{flex:0 0 150px;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:2px;padding:2px}
.dsh-mp-provider{display:flex;align-items:center;gap:6px;width:100%;min-height:30px;padding:0 8px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;text-align:left;cursor:pointer}
.dsh-mp-provider:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-mp-providerActive{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);color:var(--dsw-alias-brand-primary);font-weight:600}
.dsh-mp-providerName{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-mp-providerCount{flex:0 0 auto;padding:0 6px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.dsh-mp-list{flex:1;min-width:0;min-height:0;overflow-y:auto;border-left:1px solid var(--dsw-alias-border-l1);padding:2px 0 2px 2px}
.dsh-mp-status,.dsh-mp-empty{padding:10px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.dsh-mp-error,.dsh-mp-warning{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin:4px 2px;padding:7px 8px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.dsh-mp-warning{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-state-warn-label)}
.dsh-mp-retry{flex:0 0 auto;padding:0;border:none;background:transparent;color:inherit;font:inherit;font-weight:600;cursor:pointer}
.dsh-mp-option{display:flex;align-items:center;gap:8px;width:100%;min-height:38px;padding:6px 8px;border:none;border-radius:10px;outline:none;background:transparent;color:inherit;text-align:left;cursor:pointer}
.dsh-mp-option:hover:not(:disabled),.dsh-mp-option:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-mp-option:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}
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
  const EMPTY_CATALOG = { groups: [], failures: [], status: 'idle', error: null }

  function readStorage() {
    try {
      const raw = globalThis.localStorage === undefined ? null : globalThis.localStorage.getItem(CATALOG_KEY)
      if (typeof raw !== 'string') return null
      const parsed = JSON.parse(raw)
      if (parsed === null || parsed.v !== 1 || !Array.isArray(parsed.groups)) return null
      return {
        at: typeof parsed.at === 'number' ? parsed.at : 0,
        groups: parsed.groups,
        failures: Array.isArray(parsed.failures) ? parsed.failures : [],
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
          const groups = Array.isArray(value.groups) ? value.groups : []
          const failures = Array.isArray(value.failures) ? value.failures : []
          snapshot = { groups, failures, status: 'ready', error: null }
          loadedAt = Date.now()
          writeStorage(groups, failures)
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

    const EMPTY_STATE = { current: null, routable: null, groups: [], failures: [], status: 'idle', error: null }

    const state = useSyncExternalStore(
      (fn) => directory === null ? (() => {}) : directory.subscribe(fn),
      () => directory === null ? EMPTY_STATE : directory.getSnapshot(),
    )
    const catalogState = useSyncExternalStore(
      (fn) => catalog === null ? (() => {}) : catalog.subscribe(fn),
      () => catalog === null ? EMPTY_CATALOG : catalog.getSnapshot(),
    )
    const [pane, setPane] = useState(null) // null | 'models' | 'effort'
    const [query, setQuery] = useState('')
    const [activeProvider, setActiveProvider] = useState(null)
    const [notice, setNotice] = useState(null)
    const lastActionRef = useRef('load')
    const rootRef = useRef(null)
    const triggerRef = useRef(null)
    const searchRef = useRef(null)

    const q = query.trim().toLowerCase()
    const current = state.current

    // The global catalog drives the list once it holds data (or a terminal
    // status); until then the per-session directory snapshot fills in — its
    // mount-time load returns the same groups, so neither path flashes empty.
    const catalogLive = catalog !== null
      && (catalogState.groups.length > 0 || catalogState.status === 'ready' || catalogState.status === 'error')
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

    const reasoning = currentChoice === null ? undefined : currentChoice.model.reasoning
    const effectiveEffort = current === null ? undefined : (current.reasoningEffort ?? reasoning?.defaultEffort)
    const effortLabel = reasoning === undefined ? undefined
      : effectiveEffort === undefined ? t('providerDefault')
        : (reasoning.efforts.find((level) => level.id === effectiveEffort)?.name ?? String(effectiveEffort))
    const effortChoices = useMemo(() => {
      if (reasoning === undefined) return []
      const rows = []
      if (reasoning.defaultEffort === undefined) {
        rows.push({ key: 'provider-default', effort: undefined, label: t('providerDefault') })
      }
      for (const level of reasoning.efforts) {
        rows.push({ key: level.id, effort: level.id, label: level.name, description: level.description })
      }
      return rows
    }, [reasoning])

    const searching = q !== ''
    const results = useMemo(() => {
      if (!searching) return []
      const out = []
      for (const group of groups) {
        const providerMatch = group.name.toLowerCase().includes(q)
        for (const model of group.models) {
          const modelMatch = model.name.toLowerCase().includes(q)
            || (model.description !== undefined && model.description.toLowerCase().includes(q))
          if (providerMatch || modelMatch) out.push({ group, model })
        }
      }
      return out
    }, [searching, q, groups])

    const activeTab = (activeProvider !== null && groups.some((g) => g.id === activeProvider))
      ? activeProvider
      : (current !== null && groups.some((g) => g.id === current.provider))
        ? current.provider
        : (groups.length > 0 ? groups[0].id : null)
    const activeGroup = groups.find((g) => g.id === activeTab) ?? null

    const busy = state.status === 'selecting'
    const modelLabel = currentChoice === null ? t('triggerFallback') : currentChoice.model.name

    const reload = () => {
      lastActionRef.current = 'load'
      if (catalog !== null) void catalog.load()
      else load()
    }

    useEffect(() => {
      if (!available) return
      lastActionRef.current = 'load'
      load()
    }, [available, load])

    useEffect(() => {
      if (pane === 'models') searchRef.current?.focus()
    }, [pane])

    const close = (restoreFocus) => {
      setPane(null)
      setNotice(null)
      setActiveProvider(null)
      if (restoreFocus && triggerRef.current !== null) triggerRef.current.focus()
    }

    const show = () => {
      setNotice(null)
      setQuery('')
      lastActionRef.current = 'load'
      setPane('models')
      // Instant open: revalidate only when there is nothing cached to show,
      // the last load failed, or the cache escaped every push event for
      // longer than the TTL. A background refresh never covers the list.
      if (catalog !== null) {
        if (catalogState.groups.length === 0 || catalogState.status === 'error'
          || Date.now() - catalog.loadedAt() > CATALOG_TTL) reload()
      } else {
        const loadedAt = LOADED_AT.get(directory) ?? 0
        if (groups.length === 0 || state.status === 'error' || Date.now() - loadedAt > RELOAD_TTL) reload()
      }
    }

    const showEffort = () => {
      setNotice(null)
      setPane('effort')
    }

    const settle = (accepted) => {
      if (accepted) {
        close(true)
        return
      }
      const message = directory === null ? null : directory.getSnapshot().error
      setNotice(message === null ? t('selectFailed') : t('selectFailedMsg') + message)
    }

    const choose = (group, model) => {
      if (current !== null && current.provider === group.id && current.model === model.id) {
        close(true)
        return
      }
      lastActionRef.current = 'select'
      const selection = {
        provider: group.id,
        model: model.id,
        ...(model.reasoning !== undefined && model.reasoning.defaultEffort !== undefined
          ? { reasoningEffort: model.reasoning.defaultEffort }
          : {}),
      }
      void select(selection).then(settle)
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
      void select(selection).then(settle)
    }

    const onRootKeyDown = (event) => {
      if (event.key === 'Escape' && pane !== null) {
        event.preventDefault()
        close(true)
      }
    }

    const onBlur = (event) => {
      const related = event.relatedTarget
      if (related !== null && rootRef.current !== null && rootRef.current.contains(related)) return
      close()
    }

    const renderOption = (group, model) => {
      const selected = current !== null && current.provider === group.id && current.model === model.id
      const detail = searching
        ? (group.name + (model.description !== undefined ? ' · ' + model.description : ''))
        : (model.description ?? '')
      return h('button', {
        key: group.id + '/' + model.id,
        type: 'button',
        role: 'menuitemradio',
        'aria-checked': selected,
        className: 'dsh-mp-option' + (selected ? ' dsh-mp-selected' : ''),
        disabled: busy,
        onClick: () => { choose(group, model) },
      },
        h('span', { className: 'dsh-mp-optionCopy' },
          h('span', { className: 'dsh-mp-modelName' }, model.name),
          detail !== '' && h('span', { className: 'dsh-mp-description' }, detail),
        ),
        h('span', { className: 'dsh-mp-check' }, selected ? '✓' : ''),
      )
    }

    const renderEffortOption = (level) => {
      const selected = effectiveEffort === level.effort
      return h('button', {
        key: level.key,
        type: 'button',
        role: 'menuitemradio',
        'aria-checked': selected,
        className: 'dsh-mp-option' + (selected ? ' dsh-mp-selected' : ''),
        disabled: busy,
        title: level.description,
        onClick: () => { chooseEffort(level.effort) },
      },
        h('span', { className: 'dsh-mp-optionCopy' },
          h('span', { className: 'dsh-mp-modelName' }, level.label),
        ),
        h('span', { className: 'dsh-mp-check' }, selected ? '✓' : ''),
      )
    }

    if (!available || directory === null) return null

    const effortAvailable = reasoning !== undefined && effortChoices.length > 0

    return h('div', { ref: rootRef, className: 'dsh-mp-root', onKeyDown: onRootKeyDown, onBlur: onBlur },
      h('button', {
        ref: triggerRef,
        type: 'button',
        className: 'dsh-mp-trigger',
        title: modelLabel,
        'aria-label': modelLabel,
        'aria-haspopup': 'menu',
        'aria-expanded': pane === 'models',
        disabled: locked,
        onClick: () => { if (pane === 'models') { close() } else { show() } },
      },
        h('span', { className: 'dsh-mp-triggerLabel' }, modelLabel),
        h('span', { className: 'dsh-mp-chevron' + (pane === 'models' ? ' dsh-mp-chevronOpen' : '') }, '▾'),
      ),
      effortAvailable && h('button', {
        type: 'button',
        className: 'dsh-mp-effortTrigger',
        title: t('effort'),
        'aria-label': effortLabel === undefined ? t('effort') : t('effort') + ' ' + effortLabel,
        'aria-haspopup': 'menu',
        'aria-expanded': pane === 'effort',
        disabled: locked,
        onClick: () => { if (pane === 'effort') { close() } else { showEffort() } },
      },
        h('span', { className: 'dsh-mp-effortTriggerLabel' }, effortLabel),
        h('span', { className: 'dsh-mp-chevron' + (pane === 'effort' ? ' dsh-mp-chevronOpen' : '') }, '▾'),
      ),
      pane === 'models' && h('div', {
        className: 'dsh-mp-menu',
        role: 'menu',
        tabIndex: -1,
        onMouseDown: (event) => { event.preventDefault() },
        'aria-busy': listStatus === 'loading' || busy,
      },
        h('input', {
          ref: searchRef,
          type: 'text',
          className: 'dsh-mp-search',
          placeholder: t('search'),
          value: query,
          onChange: (event) => { setQuery(event.target.value) },
        }),
        h('div', { className: 'dsh-mp-body' },
          h('div', { className: 'dsh-mp-providers', role: 'tablist', 'aria-label': t('providers') },
            groups.map((group) => {
              const active = !searching && group.id === activeTab
              return h('button', {
                key: group.id,
                type: 'button',
                role: 'tab',
                'aria-selected': active,
                className: 'dsh-mp-provider' + (active ? ' dsh-mp-providerActive' : ''),
                onClick: () => { setQuery(''); setActiveProvider(group.id) },
              },
                h('span', { className: 'dsh-mp-providerName' }, group.name),
                h('span', { className: 'dsh-mp-providerCount' }, String(group.models.length)),
              )
            }),
          ),
          h('div', { className: 'dsh-mp-list' },
            listStatus === 'loading' && groups.length === 0
              ? h('div', { className: 'dsh-mp-status' }, t('loading'))
              : h(Fragment, null,
                  listError !== null && lastActionRef.current === 'load'
                    && h('div', { className: 'dsh-mp-error' },
                        h('span', null, String(listError)),
                        h('button', { type: 'button', className: 'dsh-mp-retry', onClick: reload }, t('retry')),
                      ),
                  notice !== null
                    && h('div', { className: 'dsh-mp-error' },
                        h('span', null, notice),
                      ),
                  !searching && failures.map((failure) =>
                    h('div', { className: 'dsh-mp-warning', key: failure.id },
                      h('span', null, failure.name + ' 加载失败：' + failure.message),
                      h('button', { type: 'button', className: 'dsh-mp-retry', onClick: reload }, t('retry')),
                    ),
                  ),
                  searching
                    ? (results.length === 0
                        ? h('div', { className: 'dsh-mp-empty' }, t('noMatch'))
                        : results.map((row) => renderOption(row.group, row.model)))
                    : activeGroup === null
                      ? (listStatus === 'ready' && groups.length === 0
                          ? h('div', { className: 'dsh-mp-empty' }, t('noModels'))
                          : null)
                      : activeGroup.models.length === 0
                        ? h('div', { className: 'dsh-mp-empty' }, t('providerEmpty'))
                        : activeGroup.models.map((model) => renderOption(activeGroup, model)),
                ),
          ),
        ),
      ),
      pane === 'effort' && effortAvailable && h('div', {
        className: 'dsh-mp-menu dsh-mp-menuEffort',
        role: 'menu',
        tabIndex: -1,
        onMouseDown: (event) => { event.preventDefault() },
        'aria-busy': busy,
      },
        notice !== null
          && h('div', { className: 'dsh-mp-error' },
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
    // back to the per-session directory path (catalog stays null).
    let catalog = null
    try {
      const connection = ctx.get('connection')
      const api = connection === undefined ? undefined : connection.api
      if (api !== undefined && api.llm !== undefined && typeof api.llm.models === 'function') {
        catalog = createCatalog(api)
        const refresh = () => { void catalog.load() }
        const remote = ctx.get('remote')
        if (remote !== undefined && typeof remote.$on === 'function') {
          remote.$on('llm/adapters-updated', refresh)
          remote.$on('settings/document-updated', refresh)
        }
        if (typeof ctx.on === 'function') ctx.on('connection/reset', refresh)
        void catalog.load()
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
              directory.load().catch(() => { /* surfaced on the store */ })
            },
            select: (selection) => available
              ? directory.select(selection).then(() => true, () => false)
              : Promise.resolve(false),
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
