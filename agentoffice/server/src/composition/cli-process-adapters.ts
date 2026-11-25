/**
 * CLI Process adapter composition - registers the cli-process adapter factory.
 *
 * Lazy import via dynamic import - app.ts never imports this directly.
 */

import type { Capability } from '@agentoffice/core'
import { AdapterRegistry } from '../adapters/adapter-registry'

/** Register cli-process adapter factory with the given registry. */
export function registerCliProcessAdapters(registry: AdapterRegistry): void {
  registry.register('cli-process', async (config) => {
    const { CliProcessAdapter } = await import('../../../adapters/cli-process/cli-process')
    return new CliProcessAdapter({
      command: (config.options?.command as string) || '',
      args: (config.options?.args as string[]) || [],
      cwd: (config.options?.cwd as string) || process.cwd(),
      env: (config.options?.env as Record<string, string>) || undefined,
      usePty: (config.options?.usePty as boolean) || false,
      capabilities: (config.options?.capabilities as Capability[]) || undefined,
      shouldNeedApproval: config.options?.shouldNeedApproval === true,
    })
  })
}
