import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { FileSpoolAdapter } from '../index.js'

function hubStub() {
  const inbound = []
  const statuses = []
  const deliveries = []
  return {
    inbound,
    statuses,
    deliveries,
    logger: { warn() {}, info() {} },
    async acceptInbound(adapterId, event) {
      inbound.push({ adapterId, event })
      return { accepted: true, key: `${adapterId}:${event.messageId}` }
    },
    reportEndpoint(adapterId, status) {
      statuses.push({ adapterId, ...status })
    },
    deliveryUpdate(adapterId, update) {
      deliveries.push({ adapterId, ...update })
    },
  }
}

function config(root) {
  return {
    id: 'volume',
    root,
    enabled: true,
    defaultSessionId: '',
    ackMode: 'delete',
    pollMs: 60_000,
    stablePolls: 1,
    maxBytes: 64 * 1024,
    payloadFile: 'input/message.json',
    payloadFormat: 'json',
    statusFile: 'status.json',
  }
}

function adapterApi(hub) {
  return {
    emitInbound: (event) => hub.acceptInbound('volume', event),
    reportEndpoint: (status) => hub.reportEndpoint('volume', status),
    replaceEndpoints: (statuses) => {
      hub.statuses.length = 0
      for (const status of statuses) hub.reportEndpoint('volume', status)
    },
    deliveryUpdate: (update) => hub.deliveryUpdate('volume', update),
  }
}

test('file spool routes a stable trigger and archives it only after acceptance', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'message-hub-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const hub = hubStub()
  const spool = new FileSpoolAdapter(hub, config(root))
  await spool.start(adapterApi(hub))
  t.after(() => spool.stop())

  await writeFile(join(root, 'input', 'message.json'), JSON.stringify({ text: 'hello from the volume' }))
  await writeFile(join(root, '.new-message.tmp'), '')
  await rename(join(root, '.new-message.tmp'), join(root, 'wake-any-name'))

  await spool.scan()
  await spool.scan()
  await spool.scan()

  assert.equal(hub.inbound.length, 1)
  assert.equal(hub.inbound[0].event.text, 'hello from the volume')
  assert.equal(hub.inbound[0].event.nativeId, 'wake-any-name')
  const processed = await readdir(join(root, '.message-hub', 'processed'))
  assert.equal(processed.length, 1)
  assert.match(processed[0], /wake-any-name$/)
})

test('file spool atomically publishes outbound delivery and accepts status/acks', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'message-hub-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const hub = hubStub()
  const spool = new FileSpoolAdapter(hub, config(root))
  await spool.start(adapterApi(hub))
  t.after(() => spool.stop())

  await writeFile(join(root, 'status.json'), JSON.stringify({
    endpoints: { display: { state: 'available', accepting: true, detail: 'USB display ready' } },
  }))
  await spool.refreshStatus()
  assert.equal(hub.statuses.at(-1).endpointId, 'display')
  assert.equal(hub.statuses.at(-1).state, 'available')

  const result = await spool.send({ deliveryId: 'mh-test', endpointId: 'display', payload: [{ kind: 'text', text: 'ping' }] })
  assert.equal(result.state, 'accepted')
  const outbound = JSON.parse(await readFile(join(root, 'output', 'mh-test.json'), 'utf8'))
  assert.equal(outbound.payload[0].text, 'ping')

  await writeFile(join(root, 'output', 'ack', 'mh-test.ack.json'), JSON.stringify({ deliveryId: 'mh-test', state: 'sent', externalId: 'device-1' }))
  await spool.scanOutputAcks()
  assert.deepEqual(hub.deliveries.at(-1), { adapterId: 'volume', deliveryId: 'mh-test', state: 'sent', externalId: 'device-1', error: '', retryable: false })
})

test('file spool rejects input paths which escape input/', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'message-hub-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const spool = new FileSpoolAdapter(hubStub(), config(root))
  await spool.start({ emitInbound: async () => ({ accepted: true, key: 'ok' }), reportEndpoint() {}, replaceEndpoints() {}, deliveryUpdate() {} })
  t.after(() => spool.stop())
  await assert.rejects(() => spool.readInput('../status.json'), /escapes/)
})
