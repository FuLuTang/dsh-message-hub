import assert from 'node:assert/strict'
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { Context, Service } from '@deepseek-ai/cordis'
import defaultPlugin, { apply, inject } from '../index.js'

class FakeTools extends Service {
  constructor(ctx) {
    super(ctx, 'tools')
    this.definitions = new Map()
  }
  register(definition) {
    this.definitions.set(definition.name, definition)
    return () => this.definitions.delete(definition.name)
  }
}

class FakeSettings extends Service {
  constructor(ctx) {
    super(ctx, 'settings')
    this.namespaces = new Map()
  }
  register(namespace, schema, options) {
    this.namespaces.set(namespace, { schema, options })
  }
}

class FakeSessionController extends Service {
  constructor(ctx) {
    super(ctx, 'sessionController')
    this.followups = []
    this.injected = []
  }
  async resolveAgent(sessionId) {
    const wake = (mode) => (message) => this.followups.push({ sessionId, message, mode })
    return { agent: { inject: (message) => this.injected.push({ sessionId, message }), followup: wake('followup'), steer: wake('steer') } }
  }
}

/** An agent object from before steer() existed; the hub must not lose the wake. */
class LegacySessionController extends Service {
  constructor(ctx) {
    super(ctx, 'sessionController')
    this.followups = []
    this.injected = []
  }
  async resolveAgent(sessionId) {
    return { agent: { inject: (message) => this.injected.push({ sessionId, message }), followup: (message) => this.followups.push({ sessionId, message, mode: 'followup' }) } }
  }
}

test('plugin applies through a real Cordis context and routes a file trigger to the bound session', async (t) => {
  assert.equal(defaultPlugin.apply, apply)
  assert.equal(defaultPlugin.inject, inject)
  const rootPath = await mkdtemp(join(tmpdir(), 'message-hub-runtime-'))
  t.after(() => rm(rootPath, { recursive: true, force: true }))
  t.after(() => rm(`${rootPath}-hub-state.json`, { force: true }))
  t.after(() => rm(`${rootPath}-hub-state.json.lock`, { force: true }))
  const root = new Context()
  await root.plugin(FakeTools)
  await root.plugin(FakeSettings)
  await root.plugin(FakeSessionController)
  const plugin = Object.assign((ctx) => apply(ctx, {
    storagePath: `${rootPath}-hub-state.json`,
    maxLedgerEntries: 100,
    spools: [{
      id: 'volume', root: rootPath, enabled: true, defaultSessionId: '', ackMode: 'delete',
      pollMs: 60_000, stablePolls: 1, maxBytes: 64 * 1024,
      payloadFile: 'input/message.json', payloadFormat: 'json', statusFile: 'status.json',
    }],
    outlets: [],
  }), { inject })
  const fiber = await root.plugin(plugin)
  assert.equal(root.settings.namespaces.has('message-hub'), true)
  t.after(() => fiber.dispose())
  t.after(() => root.fiber.dispose())
  await root.messageHub.registerEgress({
    id: 'reply', name: 'Reply device', schema: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } },
    async invoke(args) { return { success: true, message: `sent: ${args.text}` } },
  })

  await root.messageHub.registerIngress({ id: 'custom-in', name: 'Custom input', template: 'From {{sender}}: {{text}}' })
  await root.messageHub.bindIngress('custom-in', 'session-A', { cwd: rootPath })
  await root.messageHub.emitIngress('custom-in', { eventId: 'custom-1', values: { sender: 'tester', text: 'injected hello' } })
  assert.equal(root.sessionController.injected.length, 2)
  assert.match(root.sessionController.injected[1].message.content[0].text, /injected hello/)

  const bind = root.tools.definitions.get('message_hub_bind')
  await bind.execute({ adapterId: 'volume' }, { agent: { session: { id: 'session-A' } } })

  await writeFile(join(rootPath, 'input', 'message.json'), JSON.stringify({ text: 'wake up' }))
  await writeFile(join(rootPath, '.temp'), '')
  await rename(join(rootPath, '.temp'), join(rootPath, 'hardware-event'))
  const spool = root.messageHub.spools.get('volume')
  await spool.scan(); await spool.scan(); await spool.scan()

  assert.equal(root.sessionController.followups.length, 2)
  assert.equal(root.sessionController.followups.at(-1).sessionId, 'session-A')
  assert.equal(root.sessionController.followups.at(-1).mode, 'steer')
  assert.match(root.sessionController.followups.at(-1).message.content[0].text, /wake up/)
  const send = root.tools.definitions.get('message_hub_send')
  const output = JSON.parse(await send.execute({ channelId: 'reply', arguments: { text: 'done' } }, { agent: { session: { id: 'session-A' } } }))
  assert.deepEqual(output, { success: true, message: 'sent: done' })
  await root.messageHub.setChannelEnabled('reply', false)
  await assert.rejects(
    () => send.execute({ channelId: 'reply', arguments: { text: 'blocked' } }, { agent: { session: { id: 'session-A' } } }),
    /disabled/,
  )
  await assert.rejects(
    () => root.messageHub.registerAdapter({ id: 'broken', async start() { throw new Error('boom') } }),
    /failed to start/,
  )
  assert.equal(root.messageHub.snapshot().adapters.some((adapter) => adapter.id === 'broken'), false)
})

test('a configured file spool is visible to the management panel and bindable through it', async (t) => {
  const rootPath = await mkdtemp(join(tmpdir(), 'message-hub-panel-'))
  t.after(() => rm(rootPath, { recursive: true, force: true }))
  t.after(() => rm(`${rootPath}-hub-state.json`, { force: true }))
  t.after(() => rm(`${rootPath}-hub-state.json.lock`, { force: true }))
  const root = new Context()
  await root.plugin(FakeTools)
  await root.plugin(FakeSettings)
  await root.plugin(FakeSessionController)
  const plugin = Object.assign((ctx) => apply(ctx, {
    storagePath: `${rootPath}-hub-state.json`,
    maxLedgerEntries: 100,
    spools: [{
      id: 'volume', label: 'Nextcloud 目录', root: rootPath, enabled: true, defaultSessionId: '', ackMode: 'delete',
      pollMs: 60_000, stablePolls: 1, maxBytes: 64 * 1024,
      payloadFile: 'input/message.json', payloadFormat: 'json', statusFile: 'status.json',
    }],
    outlets: [],
  }), { inject })
  const fiber = await root.plugin(plugin)
  t.after(() => fiber.dispose())
  t.after(() => root.fiber.dispose())

  // The panel renders snapshot().channels; a configured spool used to be absent,
  // which made the panel claim no channel was registered at all.
  const channel = root.messageHub.channelList().find((entry) => entry.id === 'volume')
  assert.equal(channel.name, 'Nextcloud 目录')
  assert.equal(channel.kind, 'file-spool')
  assert.equal(channel.direction, 'duplex')
  assert.equal(channel.root, rootPath)
  assert.equal(channel.light, 'green')
  assert.equal(root.messageHub.snapshot().channels.length, 1)
  assert.equal(root.messageHub.snapshot().defaultWakeupMode, 'steer')

  // Panel bind drives the spool routing path (acceptInbound → bindingFor).
  await root.messageHub.bindIngress('volume', 'session-A', { wakeupMode: 'followup' })
  await writeFile(join(rootPath, 'input', 'message.json'), JSON.stringify({ text: 'panel bound' }))
  await writeFile(join(rootPath, '.temp'), '')
  await rename(join(rootPath, '.temp'), join(rootPath, 'panel-trigger'))
  const spool = root.messageHub.spools.get('volume')
  await spool.scan(); await spool.scan(); await spool.scan()
  assert.equal(root.sessionController.followups.at(-1).sessionId, 'session-A')
  assert.equal(root.sessionController.followups.at(-1).mode, 'followup')

  // Runtime-only switch: stops polling without touching configuration.
  await root.messageHub.setChannelEnabled('volume', false)
  assert.equal(root.messageHub.channelList()[0].desiredEnabled, false)
  assert.equal(root.messageHub.channelList()[0].light, 'black')
  assert.equal(root.messageHub.snapshot().adapters.length, 0)
  await root.messageHub.setChannelEnabled('volume', true)
  assert.equal(root.messageHub.channelList()[0].light, 'green')
  assert.equal(root.messageHub.snapshot().adapters.length, 1)
})

test('a wake degrades to followup when the agent predates steer()', async (t) => {
  const rootPath = await mkdtemp(join(tmpdir(), 'message-hub-legacy-'))
  t.after(() => rm(rootPath, { recursive: true, force: true }))
  t.after(() => rm(`${rootPath}-hub-state.json`, { force: true }))
  t.after(() => rm(`${rootPath}-hub-state.json.lock`, { force: true }))
  const root = new Context()
  await root.plugin(FakeTools)
  await root.plugin(FakeSettings)
  await root.plugin(LegacySessionController)
  const plugin = Object.assign((ctx) => apply(ctx, { storagePath: `${rootPath}-hub-state.json`, spools: [], outlets: [] }), { inject })
  const fiber = await root.plugin(plugin)
  t.after(() => fiber.dispose())
  t.after(() => root.fiber.dispose())

  await root.messageHub.registerIngress({ id: 'legacy-in', name: 'Legacy input' })
  await root.messageHub.bindIngress('legacy-in', 'session-A', { cwd: rootPath })
  await root.messageHub.emitIngress('legacy-in', { eventId: 'legacy-1', values: { text: 'hello' } })
  assert.equal(root.sessionController.followups.length, 1)
  assert.equal(root.sessionController.followups[0].mode, 'followup')
})
