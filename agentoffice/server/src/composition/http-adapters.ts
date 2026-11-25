/**
 * HTTP agent composition - registers the http-agent adapter factory.
 *
 * This is a composition module. It imports the vendor adapter lazily via dynamic import,
 * but app.ts does not import any vendor adapter directly.
 */

import { AdapterRegistry } from '../adapters/adapter-registry'

/** Register http-agent adapter factory with the given registry. */
export function registerHttpAdapters(registry: AdapterRegistry): void {
  registry.register('http-agent', async (config) => {
    const { HttpAgentAdapter } = await import('../../../adapters/http-agent/http-agent')
    return new HttpAgentAdapter({
      agentId: config.agentId,
      name: config.name,
      bindUrl: (config.options?.bindUrl as string) || 'localhost:3000',
      shouldNeedApproval: config.options?.shouldNeedApproval === true,
    })
  })
}
