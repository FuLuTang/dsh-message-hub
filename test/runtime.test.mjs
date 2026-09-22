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

class FakeSessionController extends Service {
  constructor(ctx) {
    super(ctx, 'sessionController')
    this.followups = []
  }
  async resolveAgent(sessionId) {
    return { agent: { followup: (message) => this.followups.push({ sessionId, message }) } }
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
  await root.plugin(FakeSessionController)
  const plugin = Object.assign((ctx) => apply(ctx, {
    storagePath: `${rootPath}-hub-state.json`,
    maxLedgerEntries: 100,
    spools: [{
      id: 'volume', root: rootPath, enabled: true, defaultSessionId: '', ackMode: 'delete',
      pollMs: 60_000, stablePolls: 1, maxBytes: 64 * 1024,
      payloadFile: 'input/message.json', payloadFormat: 'json', statusFile: 'status.json',
    }],
    outlets: [{ id: 'reply', spoolId: 'volume', endpointId: 'device', enabled: true, allowBoundSession: true, allowedSessionIds: [] }],
  }), { inject })
  const fiber = await root.plugin(plugin)
  t.after(() => fiber.dispose())
  t.after(() => root.fiber.dispose())

  const bind = root.tools.definitions.get('message_hub_bind')
  await bind.execute({ adapterId: 'volume' }, { agent: { session: { id: 'session-A' } } })

  await writeFile(join(rootPath, 'input', 'message.json'), JSON.stringify({ text: 'wake up' }))
  await writeFile(join(rootPath, '.temp'), '')
  await rename(join(rootPath, '.temp'), join(rootPath, 'hardware-event'))
  const spool = root.messageHub.spools.get('volume')
  await spool.scan(); await spool.scan(); await spool.scan()

  assert.equal(root.sessionController.followups.length, 1)
  assert.equal(root.sessionController.followups[0].sessionId, 'session-A')
  assert.match(root.sessionController.followups[0].message.content[0].text, /wake up/)
  const send = root.tools.definitions.get('message_hub_send')
  const output = JSON.parse(await send.execute({ outletId: 'reply', text: 'done' }, { agent: { session: { id: 'session-A' } } }))
  assert.equal(output.state, 'accepted')
  root.messageHub.reportEndpoint('volume', { endpointId: 'device', state: 'offline', accepting: false })
  await assert.rejects(
    () => send.execute({ outletId: 'reply', text: 'blocked' }, { agent: { session: { id: 'session-A' } } }),
    /unavailable/,
  )
  await assert.rejects(
    () => root.messageHub.registerAdapter({ id: 'broken', async start() { throw new Error('boom') } }),
    /failed to start/,
  )
  assert.equal(root.messageHub.snapshot().adapters.some((adapter) => adapter.id === 'broken'), false)
})
