window.__ModuleLoader__.load({ id: 'dsh-message-hub', factory: (require) => {
  var module = { exports: {} }; var exports = module.exports
  const React = require('react')
  async function api(method, body = {}) {
    const response = await fetch(`/message-hub/api/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    const payload = await response.json()
    if (!response.ok || !payload.ok) throw new Error(payload?.error?.message || `Message Hub API ${response.status}`)
    return payload.result
  }
  const DIRECTION_LABEL = { ingress: '接入', egress: '发出', duplex: '收发' }
  const WAKE_LABEL = { steer: '插话', followup: '排队' }
  function wakeModeOf(binding, fallback) {
    const explicit = binding?.wakeupMode
    if (explicit === 'steer' || explicit === 'followup') return { mode: explicit, inherited: false }
    return { mode: fallback === 'followup' ? 'followup' : 'steer', inherited: true }
  }
  function ChannelManager() {
    const [snapshot, setSnapshot] = React.useState({ channels: [], bindings: {} })
    const [error, setError] = React.useState('')
    const [busy, setBusy] = React.useState('')
    const refresh = async () => {
      try { setSnapshot(await api('snapshot')); setError('') }
      catch (reason) { setError(String(reason?.message || reason)) }
    }
    React.useEffect(() => {
      void refresh()
      const timer = setInterval(() => { void refresh() }, 5000)
      return () => clearInterval(timer)
    }, [])
    const run = async (channelId, work) => {
      setBusy(channelId)
      try { await work(); await refresh() }
      catch (reason) { setError(String(reason?.message || reason)) }
      finally { setBusy('') }
    }
    const send = (channelId, body, current) => ({
      channelId,
      sessionId: body.sessionId ?? current.sessionId ?? '',
      cwd: body.cwd ?? current.cwd ?? '',
      template: body.template ?? current.template ?? '',
      wakeup: body.wakeup ?? current.wakeup !== false,
      wakeupMode: body.wakeupMode ?? current.wakeupMode ?? '',
    })
    const toggle = (channel) => run(channel.id, () => api('toggle', { channelId: channel.id, enabled: !channel.desiredEnabled }))
    const bind = async (channel) => {
      const current = snapshot.bindings?.[channel.id] || {}
      const sessionId = window.prompt('绑定 DSH Session ID', current.sessionId || '')
      if (!sessionId) return
      const cwd = window.prompt('替代会话工作区（cwd，留空则跟随会话自身）', current.cwd || '') || ''
      const explicit = current.wakeupMode === 'steer' || current.wakeupMode === 'followup' ? current.wakeupMode : ''
      await run(channel.id, () => api('bind', send(channel.id, { sessionId, cwd, wakeupMode: explicit }, current)))
    }
    const setWakeMode = (channel, wakeupMode) => run(channel.id, () => api('bind', send(channel.id, { wakeupMode }, snapshot.bindings?.[channel.id] || {})))
    const lights = { green: '#22c55e', yellow: '#eab308', black: '#52525b' }
    const minor = { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 }
    const channels = snapshot.channels || []
    return React.createElement('div', { style: { padding: '12px 0 16px' } },
      React.createElement('button', { type: 'button', onClick: refresh }, '刷新渠道'),
      error && React.createElement('p', { role: 'alert', style: { color: '#f87171' } }, error),
      channels.length === 0 && React.createElement('p', null, '尚无已注册渠道。请先通过 Host 插件注册接入或发出渠道；若要使用文件目录，请在插件配置的 spools 中添加一项（file-spool 会同时作为接入与发出渠道出现在这里）。'),
      ...channels.map((channel) => {
        const binding = snapshot.bindings?.[channel.id] || {}
        const wake = wakeModeOf(binding, snapshot.defaultWakeupMode)
        const canBind = channel.direction !== 'egress'
        return React.createElement('div', {
          key: channel.id, style: { borderTop: '1px solid var(--dsw-alias-border-l2, #52525b)', padding: '12px 0' },
        },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
          React.createElement('span', { style: { color: lights[channel.light] || lights.black } }, '● '),
          React.createElement('b', null, channel.name),
          React.createElement('small', { style: minor }, DIRECTION_LABEL[channel.direction] || channel.direction),
          channel.kind === 'file-spool' && React.createElement('small', { style: minor }, '文件目录'),
          !channel.desiredEnabled && React.createElement('small', { style: minor }, '（已停用）')),
        React.createElement('div', null, channel.detail || channel.light),
        channel.kind === 'file-spool' && channel.root && React.createElement('div', { style: minor }, `根目录：${channel.root}`),
        React.createElement('div', { style: { marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          React.createElement('button', { type: 'button', disabled: busy === channel.id, onClick: () => toggle(channel) }, channel.desiredEnabled ? '关闭' : '开启'),
          channel.kind === 'file-spool' && React.createElement('small', { style: minor }, '运行时开关，重启后按配置恢复'),
          canBind && React.createElement('button', { type: 'button', disabled: busy === channel.id, onClick: () => bind(channel) }, '绑定…')),
        canBind && React.createElement('div', { style: { marginTop: 8 } },
          React.createElement('div', null, `绑定：${binding.sessionId || '未绑定'}`),
          binding.sessionId && React.createElement('div', { style: { marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
            React.createElement('small', { style: minor }, `唤醒：${WAKE_LABEL[wake.mode]}${wake.inherited ? '（跟随全局）' : ''}`),
            ...Object.keys(WAKE_LABEL).map((mode) => React.createElement('button', {
              key: mode, type: 'button', disabled: busy === channel.id || (!wake.inherited && wake.mode === mode),
              onClick: () => setWakeMode(channel, mode),
            }, WAKE_LABEL[mode])),
            !wake.inherited && React.createElement('button', {
              type: 'button', disabled: busy === channel.id, onClick: () => setWakeMode(channel, ''),
            }, '恢复默认'))))
      })
    )
  }
  function ChevronDown({ open }) {
    // Match the 14px outline disclosure glyph used by the native PluginCard.
    return React.createElement('svg', {
      width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': true,
      style: { flex: 'none', color: 'var(--dsw-alias-label-tertiary)', transition: 'transform .16s', transform: open ? 'rotate(180deg)' : 'none' },
    }, React.createElement('path', {
      d: 'M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z',
      fill: 'currentColor',
    }))
  }
  function HubSettingsCard() {
    const [open, setOpen] = React.useState(false)
    return React.createElement('li', {
      className: 'dsh-message-hub-card', 'data-open': open,
      style: { listStyle: 'none', border: '.5px solid var(--dsw-alias-border-l4)', borderRadius: 16,
        background: open ? 'var(--dsw-alias-bg-layer-2)' : 'var(--dsw-alias-bg-layer-3)',
        transition: 'border-color .16s, background .16s' },
    },
    React.createElement('button', {
      type: 'button', 'aria-expanded': open, 'aria-label': `${open ? '收起' : '展开'}：消息渠道`,
      onClick: () => setOpen(!open),
      style: { appearance: 'none', width: '100%', display: 'flex', alignItems: 'center', gap: 12,
        padding: '14px 16px', border: 0, borderRadius: 12, background: 'transparent',
        color: 'inherit', cursor: 'pointer', textAlign: 'left', font: 'inherit' },
    }, React.createElement('span', { style: { display: 'flex', flex: 1, minWidth: 0, flexDirection: 'column', gap: 4 } },
      React.createElement('span', { style: { color: 'var(--dsw-alias-label-primary)', fontSize: 15, fontWeight: 600, lineHeight: 1.4 } }, '消息渠道（Message Hub）'),
      React.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 13, lineHeight: 1.5 } }, '管理接入与发出渠道、状态和会话绑定。')),
    React.createElement(ChevronDown, { open })),
    open && React.createElement('div', { style: { borderTop: '.5px solid var(--dsw-alias-border-l2)', margin: '0 16px' } },
      React.createElement(ChannelManager)))
  }
  const inject = ['slots']
  function apply(ctx) {
    // Match native PluginCard hover and keyboard focus, without depending on
    // its private, generated CSS-module class names.
    if (typeof document !== 'undefined') ctx.effect(() => {
      const style = document.createElement('style')
      style.textContent = '.dsh-message-hub-card:hover,.dsh-message-hub-card[data-open="true"]{border-color:var(--dsw-alias-label-dimmed)!important}.dsh-message-hub-card>button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}'
      document.head.appendChild(style)
      return () => style.remove()
    }, 'message-hub card chrome')
    // The configurable Plugins list dispatches cards by Host settings namespace.
    ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
      name: 'settings.plugin.item', id: 'message-hub', key: 'message-hub', order: 30,
    }, HubSettingsCard))
  }
  exports.apply = apply; exports.inject = inject; return module.exports
} })
