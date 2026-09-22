import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('client bundle declares the slots service it consumes', async () => {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.match(source, /const inject = \['slots'\]/)
  assert.match(source, /exports\.inject = inject/)
  assert.match(source, /ctx\.slots\.inject/)
})
