import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

async function loadClient() {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  let plugin
  runInNewContext(source, {
    window: { __ModuleLoader__: { load({ id, factory }) {
      assert.equal(id, 'dsh-message-hub')
      plugin = factory((name) => {
        assert.equal(name, 'react')
        return {}
      })
    } } },
  }, { filename: 'lib/client.js' })
  return plugin
}

test('client registers a card in Plugin configuration, not a new top tab', async () => {
  const plugin = await loadClient()
  assert.deepEqual(Array.from(plugin.inject), ['slots'])
  const installed = []
  plugin.apply({ slots: {
    inject(name, installer) { installed.push({ name, installer }) },
    register(options, Component) { return { options, Component } },
  } })
  assert.deepEqual(installed.map(({ name }) => name), ['settings.plugin.item'])
  const card = installed[0].installer()
  assert.equal(card.options.name, 'settings.plugin.item')
  assert.equal(card.options.key, 'message-hub')
  assert.equal(typeof card.Component, 'function')
})

test('bundle loads the Plugins settings owner and client slot', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings-plugins'))
  assert.equal(manifest.exports['./client'], './lib/client.js')
})
