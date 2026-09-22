import { access } from 'node:fs/promises'
import { resolve } from 'node:path'

// The checked-in client bundle is deliberately plain JavaScript, matching the
// external DSH ModuleLoader contract. Validate its presence before packaging.
await access(resolve('lib/client.js'))
