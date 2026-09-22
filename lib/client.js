window.__ModuleLoader__.load({ id: 'dsh-message-hub', factory: (require) => {
  var module = { exports: {} }; var exports = module.exports
  const React = require('react')
  async function api(method, body = {}) {
    const response = await fetch(`/message-hub/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const payload = await response.json(); if (!response.ok || !payload.ok) throw new Error(payload?.error?.message || `Message Hub API ${response.status}`); return payload.result
  }
  function HubButton() {
    const [summary, setSummary] = React.useState('Message Hub')
    const refresh = async () => { try { const snapshot = await api('snapshot'); const green = (snapshot.channels || []).filter((channel) => channel.light === 'green').length; setSummary(`消息渠道 · ${green}/${(snapshot.channels || []).length} 在线`) } catch { setSummary('消息渠道 · 不可用') } }
    React.useEffect(() => { void refresh(); const timer = setInterval(refresh, 5000); return () => clearInterval(timer) }, [])
    return React.createElement('button', { type: 'button', title: 'Message Hub 渠道状态', onClick: refresh }, summary)
  }
  function apply(ctx) {
    ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({ name: 'conversation.session.header.utilities', id: 'message-hub-trigger', order: -40 }, HubButton))
  }
  exports.apply = apply
  return module.exports
} })
