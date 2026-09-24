window.__ModuleLoader__.load({ id: 'dsh-message-hub', factory: (require) => {
  var module = { exports: {} }; var exports = module.exports
  const React = require('react')
  async function api(method, body = {}) {
    const response = await fetch(`/message-hub/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const payload = await response.json(); if (!response.ok || !payload.ok) throw new Error(payload?.error?.message || `Message Hub API ${response.status}`); return payload.result
  }
  function HubPanel({ embedded = false } = {}) {
    const [open, setOpen] = React.useState(false); const [snapshot, setSnapshot] = React.useState({ channels: [], bindings: {} }); const [error, setError] = React.useState(''); const [busy, setBusy] = React.useState('')
    const refresh = async () => { try { setSnapshot(await api('snapshot')); setError('') } catch (e) { setError(e.message) } }
    React.useEffect(() => { void refresh(); const timer = setInterval(refresh, 5000); return () => clearInterval(timer) }, [])
    const toggle = async (channel) => { setBusy(channel.id); try { await api('toggle', { channelId: channel.id, enabled: !channel.desiredEnabled }); await refresh() } catch (e) { setError(e.message) } finally { setBusy('') } }
    const bind = async (channel) => { const current = snapshot.bindings?.[channel.id] || {}; const sessionId = window.prompt('绑定 DSH Session ID', current.sessionId || ''); if (!sessionId) return; const cwd = window.prompt('替代会话工作区（cwd）', current.cwd || '') || ''; setBusy(channel.id); try { await api('bind', { channelId: channel.id, sessionId, cwd, wakeup: current.wakeup !== false, template: current.template || '' }); await refresh() } catch (e) { setError(e.message) } finally { setBusy('') } }
    const dot = { green: '#22c55e', yellow: '#eab308', black: '#52525b' }
    return React.createElement('div', { style: { position: 'relative' } },
      !embedded && React.createElement('button', { type: 'button', title: 'Message Hub 渠道', onClick: () => setOpen(!open) }, `消息渠道 · ${(snapshot.channels || []).filter((c) => c.light === 'green').length}/${(snapshot.channels || []).length}`),
      (embedded || open) && React.createElement('div', { style: embedded
        ? { maxWidth: 760, padding: 16, border: '1px solid var(--dsw-alias-border-l2, #52525b)', borderRadius: 8 }
        : { position: 'absolute', right: 0, top: '100%', zIndex: 50, width: 360, maxHeight: 480, overflow: 'auto', padding: 12, background: 'var(--dsh-color-bg, #18181b)', color: 'var(--dsh-color-fg, #fafafa)', border: '1px solid #52525b', borderRadius: 8 } },
        React.createElement('strong', null, 'Message Hub · 接入与发出渠道'), React.createElement('button', { type: 'button', style: { float: 'right' }, onClick: refresh }, '刷新'),
        error && React.createElement('p', { role: 'alert', style: { color: '#f87171' } }, error),
        snapshot.channels?.length === 0 && React.createElement('p', null, '尚无已注册渠道。请先通过 Host 插件注册接入或发出渠道。'),
        ...(snapshot.channels || []).map((channel) => React.createElement('div', { key: channel.id, style: { borderTop: '1px solid #3f3f46', padding: '8px 0' } },
          React.createElement('span', { style: { color: dot[channel.light] || dot.black } }, '● '), React.createElement('b', null, channel.name), React.createElement('small', { style: { marginLeft: 6 } }, channel.direction),
          React.createElement('div', null, channel.detail || channel.light),
          React.createElement('button', { disabled: busy === channel.id, onClick: () => toggle(channel) }, channel.desiredEnabled ? '关闭' : '开启'),
          channel.direction === 'ingress' && React.createElement('div', { style: { marginTop: 6 } }, `绑定：${snapshot.bindings?.[channel.id]?.sessionId || '未绑定'} `, React.createElement('button', { disabled: busy === channel.id, onClick: () => bind(channel) }, '绑定…'))
        ))
      )
    )
  }
  const inject = ['slots']
  function HubSettingsTab() { return React.createElement(HubPanel, { embedded: true }) }
  function apply(ctx) {
    ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({ name: 'conversation.session.header.utilities', id: 'message-hub-trigger', order: -40 }, HubPanel))
    // The Plugins section owns this tab slot. Merely declaring a client bundle
    // does not register a settings panel; this is the missing integration.
    ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({ name: 'settings.plugins.tab', id: 'message-hub', order: 30, label: '消息渠道' }, HubSettingsTab))
  }
  exports.apply = apply; exports.inject = inject; return module.exports
} })
