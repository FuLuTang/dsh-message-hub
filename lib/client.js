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
    const toggle = async (channel) => {
      setBusy(channel.id)
      try {
        await api('toggle', { channelId: channel.id, enabled: !channel.desiredEnabled })
        await refresh()
      } catch (reason) { setError(String(reason?.message || reason)) }
      finally { setBusy('') }
    }
    const bind = async (channel) => {
      const current = snapshot.bindings?.[channel.id] || {}
      const sessionId = window.prompt('绑定 DSH Session ID', current.sessionId || '')
      if (!sessionId) return
      const cwd = window.prompt('替代会话工作区（cwd）', current.cwd || '') || ''
      setBusy(channel.id)
      try {
        await api('bind', { channelId: channel.id, sessionId, cwd, wakeup: current.wakeup !== false, template: current.template || '' })
        await refresh()
      } catch (reason) { setError(String(reason?.message || reason)) }
      finally { setBusy('') }
    }
    const lights = { green: '#22c55e', yellow: '#eab308', black: '#52525b' }
    return React.createElement('div', { style: { padding: '0 20px 20px' } },
      React.createElement('button', { type: 'button', onClick: refresh }, '刷新渠道'),
      error && React.createElement('p', { role: 'alert', style: { color: '#f87171' } }, error),
      snapshot.channels?.length === 0 && React.createElement('p', null, '尚无已注册渠道。请先通过 Host 插件注册接入或发出渠道。'),
      ...(snapshot.channels || []).map((channel) => React.createElement('div', {
        key: channel.id, style: { borderTop: '1px solid var(--dsw-alias-border-l2, #52525b)', padding: '12px 0' },
      },
      React.createElement('span', { style: { color: lights[channel.light] || lights.black } }, '● '),
      React.createElement('b', null, channel.name),
      React.createElement('small', { style: { marginLeft: 8 } }, channel.direction),
      React.createElement('div', null, channel.detail || channel.light),
      React.createElement('button', { type: 'button', disabled: busy === channel.id, onClick: () => toggle(channel) }, channel.desiredEnabled ? '关闭' : '开启'),
      channel.direction === 'ingress' && React.createElement('div', { style: { marginTop: 8 } },
        `绑定：${snapshot.bindings?.[channel.id]?.sessionId || '未绑定'} `,
        React.createElement('button', { type: 'button', disabled: busy === channel.id, onClick: () => bind(channel) }, '绑定…'))
      ))
    )
  }
  function HubSettingsCard() {
    const [open, setOpen] = React.useState(false)
    return React.createElement('li', {
      style: { listStyle: 'none', border: '1px solid var(--dsw-alias-border-l2, #52525b)', borderRadius: 12, background: 'var(--dsw-alias-bg-layer-3, #353535)' },
    },
    React.createElement('button', {
      type: 'button', 'aria-expanded': open, 'aria-label': `${open ? '收起' : '展开'}：消息渠道`,
      onClick: () => setOpen(!open),
      style: { width: '100%', border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', textAlign: 'left', padding: '20px 24px' },
    }, React.createElement('strong', null, '消息渠道（Message Hub）'),
      React.createElement('span', { style: { display: 'block', marginTop: 8, opacity: 0.7 } }, '管理接入与发出渠道、状态和会话绑定。')),
    open && React.createElement(ChannelManager))
  }
  const inject = ['slots']
  function apply(ctx) {
    // The configurable Plugins list dispatches cards by Host settings namespace.
    ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
      name: 'settings.plugin.item', id: 'message-hub', key: 'message-hub', order: 30,
    }, HubSettingsCard))
  }
  exports.apply = apply; exports.inject = inject; return module.exports
} })
