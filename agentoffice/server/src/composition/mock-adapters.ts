/**
 * Mock adapter composition - registers mock adapters with the AdapterRegistry.
 *
 * This is a DEV-ONLY composition module. Production builds should not import
 * this file; instead they register production adapters through their own
 * composition module.
 *
 * Layering: this module imports vendor adapters, but app.ts does not.
 */

import { AdapterRegistry } from '../adapters/adapter-registry'
import { MockAdapter } from '../adapters/mock-adapter'

/** Register mock adapters with the given registry. */
export function registerMockAdapters(registry: AdapterRegistry): void {
  registry.register('mock', (config) => {
    return new MockAdapter({
      agentId: config.agentId,
      name: config.name,
      shouldNeedApproval: config.options?.shouldNeedApproval === true,
      shouldError: config.options?.shouldError === true,
      shouldHandoff: config.options?.shouldHandoff === true,
    })
  })
}
