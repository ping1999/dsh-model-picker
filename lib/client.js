// Browser half of dsh-model-picker. Loaded through the web plugin loader
// (window.__ModuleLoader__); React comes from the platform module table.
// Replaces the shipped composer model seat (conversation.input.model) with a
// left provider column / right model list layout �?both independently
// scrollable �?plus a cross-provider search box. Data rides the SAME
// per-session ModelDirectory as the /model popup (ctx.modelDirectories), so
// a switch made in either surface is what the other shows next.
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
      triggerFallback: '选择模型', search: '搜索模型或提供商', loading: '加载中�?, retry: '重试',
      noModels: '暂无可用模型', providerEmpty: '该提供商暂无模型', noMatch: '没有匹配的模�?,
      effort: '推理档位', providerDefault: '提供方默�?, selectFailed: '选择失败，请重试',
      selectFailedMsg: '选择失败�?, providers: '提供�?, none: '',
    },
    en: {
      triggerFallback: 'Select model', search: 'Search model or provider', loading: 'Loading�?, retry: 'Retry',
      noModels: 'No models available', providerEmpty: 'No models for this provider', noMatch: 'No matching models',
      effort: 'Reasoning', providerDefault: 'Provider default', selectFailed: 'Selection failed, retry',
      selectFailedMsg: 'Selection failed: ', providers: 'Providers', none: '',
    },
  }
  const t = (key) => STR[LOCALE][key] ?? STR.en[key]

  const CSS = `
.dsh-mp-root{position:relative;min-width:0}
.dsh-mp-trigger{display:flex;align-items:center;gap:4px;min-width:0;max-width:220px;height:28px;padding:0 4px 0 8px;border:none;border-radius:24px;outline:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;font-weight:500;cursor:pointer}
.dsh-mp-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-mp-trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.dsh-mp-trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}
.dsh-mp-triggerLabel{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-mp-triggerEffort{flex:0 0 auto;color:var(--dsw-alias-label-caption)}
.dsh-mp-chevron{flex:0 0 auto;color:var(--dsw-alias-label-caption);font-size:10px;transition:transform 120ms ease}
.dsh-mp-chevronOpen{transform:rotate(180deg)}
.dsh-mp-menu{position:absolute;right:0;bottom:calc(100% + 8px);z-index:20;display:flex;flex-direction:column;width:min(540px,calc(100vw - 32px));max-height:min(460px,calc(100vh - 96px));overflow:hidden;padding:4px;border:1px solid var(--dsw-alias-border-inverted);border-radius:12px;background:var(--dsw-specific-menu);box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary)}
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
.dsh-mp-effort{display:flex;align-items:center;gap:4px;flex-wrap:wrap;flex:0 0 auto;padding:8px 6px 4px;border-top:1px solid var(--dsw-alias-border-l1)}
.dsh-mp-effortLabel{flex:0 0 auto;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dsh-mp-effortBtn{flex:0 0 auto;height:24px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:22px;cursor:pointer}
.dsh-mp-effortBtn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-mp-effortActive{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent)}
`

  function ModelPicker(props) {
    const locked = props.locked
    const available = props.available
    const directory = props.directory
    const load = props.load
    const select = props.select

    const EMPTY_STATE = { current: null, routable: null, groups: [], failures: [], status: 'idle', error: null }

    const state = useSyncExternalStore(
      (fn) => directory === null ? (() => {}) : directory.subscribe(fn),
      () => directory === null ? EMPTY_STATE : directory.getSnapshot(),
    )
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    const [activeProvider, setActiveProvider] = useState(null)
    const [notice, setNotice] = useState(null)
    const lastActionRef = useRef('load')
    const rootRef = useRef(null)
    const triggerRef = useRef(null)
    const searchRef = useRef(null)

    const q = query.trim().toLowerCase()
    const current = state.current

    const currentChoice = useMemo(() => {
      if (current === null) return null
      for (const group of state.groups) {
        if (group.id !== current.provider) continue
        for (const model of group.models) {
          if (model.id === current.model) return { group, model }
        }
      }
      return null
    }, [state.groups, current])

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
      for (const group of state.groups) {
        const providerMatch = group.name.toLowerCase().includes(q)
        for (const model of group.models) {
          const modelMatch = model.name.toLowerCase().includes(q)
            || (model.description !== undefined && model.description.toLowerCase().includes(q))
          if (providerMatch || modelMatch) out.push({ group, model })
        }
      }
      return out
    }, [searching, q, state.groups])

    const activeTab = (activeProvider !== null && state.groups.some((g) => g.id === activeProvider))
      ? activeProvider
      : (current !== null && state.groups.some((g) => g.id === current.provider))
        ? current.provider
        : (state.groups.length > 0 ? state.groups[0].id : null)
    const activeGroup = state.groups.find((g) => g.id === activeTab) ?? null

    const busy = state.status === 'selecting'
    const modelLabel = currentChoice === null ? t('triggerFallback') : currentChoice.model.name
    const triggerLabel = effortLabel === undefined ? modelLabel : modelLabel + ' · ' + effortLabel

    const reload = () => {
      lastActionRef.current = 'load'
      load()
    }

    useEffect(() => {
      if (!available) return
      lastActionRef.current = 'load'
      load()
    }, [available, load])

    useEffect(() => {
      if (open) searchRef.current?.focus()
    }, [open])

    const close = (restoreFocus) => {
      setOpen(false)
      setNotice(null)
      setActiveProvider(null)
      if (restoreFocus && triggerRef.current !== null) triggerRef.current.focus()
    }

    const show = () => {
      setNotice(null)
      setQuery('')
      lastActionRef.current = 'load'
      setOpen(true)
      reload()
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
      if (event.key === 'Escape' && open) {
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
        h('span', { className: 'dsh-mp-check' }, selected ? '�? : ''),
      )
    }

    if (!available || directory === null) return null

    return h('div', { ref: rootRef, className: 'dsh-mp-root', onKeyDown: onRootKeyDown, onBlur: onBlur },
      h('button', {
        ref: triggerRef,
        type: 'button',
        className: 'dsh-mp-trigger',
        title: triggerLabel,
        'aria-label': modelLabel,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        disabled: locked,
        onClick: () => { if (open) { close() } else { show() } },
      },
        h('span', { className: 'dsh-mp-triggerLabel' }, modelLabel),
        effortLabel !== undefined && h('span', { className: 'dsh-mp-triggerEffort' }, effortLabel),
        h('span', { className: 'dsh-mp-chevron' + (open ? ' dsh-mp-chevronOpen' : '') }, '�?),
      ),
      open && h('div', {
        className: 'dsh-mp-menu',
        role: 'menu',
        tabIndex: -1,
        onMouseDown: (event) => { event.preventDefault() },
        'aria-busy': state.status === 'loading' || busy,
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
            state.groups.map((group) => {
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
            state.status === 'loading'
              ? h('div', { className: 'dsh-mp-status' }, t('loading'))
              : h(Fragment, null,
                  state.error !== null && lastActionRef.current === 'load'
                    && h('div', { className: 'dsh-mp-error' },
                        h('span', null, String(state.error)),
                        h('button', { type: 'button', className: 'dsh-mp-retry', onClick: reload }, t('retry')),
                      ),
                  notice !== null
                    && h('div', { className: 'dsh-mp-error' },
                        h('span', null, notice),
                      ),
                  !searching && state.failures.map((failure) =>
                    h('div', { className: 'dsh-mp-warning', key: failure.id },
                      h('span', null, failure.name + ' 加载失败�? + failure.message),
                      h('button', { type: 'button', className: 'dsh-mp-retry', onClick: reload }, t('retry')),
                    ),
                  ),
                  searching
                    ? (results.length === 0
                        ? h('div', { className: 'dsh-mp-empty' }, t('noMatch'))
                        : results.map((row) => renderOption(row.group, row.model)))
                    : activeGroup === null
                      ? (state.status === 'ready' && state.groups.length === 0
                          ? h('div', { className: 'dsh-mp-empty' }, t('noModels'))
                          : null)
                      : activeGroup.models.length === 0
                        ? h('div', { className: 'dsh-mp-empty' }, t('providerEmpty'))
                        : activeGroup.models.map((model) => renderOption(activeGroup, model)),
                ),
          ),
        ),
        reasoning !== undefined && effortChoices.length > 0 && !searching
          && h('div', { className: 'dsh-mp-effort' },
              h('span', { className: 'dsh-mp-effortLabel' }, t('effort')),
              effortChoices.map((level) => h('button', {
                key: level.key,
                type: 'button',
                className: 'dsh-mp-effortBtn' + (effectiveEffort === level.effort ? ' dsh-mp-effortActive' : ''),
                title: level.description,
                onClick: () => { chooseEffort(level.effort) },
              }, level.label)),
            ),
      ),
    )
  }

  const inject = ['slots']

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
    slots.inject('conversation.input.model', () => slots.register({
      name: 'conversation.input.model',
      priority: -1,
      registrant: 'dsh-model-picker',
      inject: (sessionId) => {
        try {
          const models = ctx.get('modelDirectories')
          const sessions = ctx.get('sessions')
          if (models === undefined || typeof models.directoryFor !== 'function') {
            return { available: false, directory: null, load: () => {}, select: () => Promise.resolve(false) }
          }
          const directory = models.directoryFor(sessionId)
          const available = sessions !== undefined && typeof sessions.subagentAddress === 'function'
            ? sessions.subagentAddress(sessionId) === undefined
            : true
          return {
            available,
            directory: directory.store,
            load: () => { if (available) directory.load().catch(() => { /* surfaced on the store */ }) },
            select: (selection) => available
              ? directory.select(selection).then(() => true, () => false)
              : Promise.resolve(false),
          }
        } catch (err) {
          return { available: false, directory: null, load: () => {}, select: () => Promise.resolve(false) }
        }
      },
    }, ModelPicker))
  }

  module.exports = { inject, apply }
  return module.exports;
} })
