/**
 * Claude Code adapter composition - registers the claude-code adapter factory.
 *
 * Lazy import via dynamic import - app.ts never imports this directly.
 */

import { AdapterRegistry } from '../adapters/adapter-registry'

/** Register claude-code adapter factory with the given registry. */
export function registerClaudeCodeAdapters(registry: AdapterRegistry): void {
  registry.register('claude-code', async (config) => {
    const { ClaudeCodeAdapter } = await import('../../../adapters/claude-code/claude-code')
    return new ClaudeCodeAdapter({
      cwd: (config.options?.cwd as string) || process.cwd(),
      model: (config.options?.model as string) || undefined,
      maxTurns: (config.options?.maxTurns as number) || undefined,
      systemPrompt: (config.options?.systemPrompt as string) || undefined,
      additionalDirectories: (config.options?.additionalDirectories as string[]) || undefined,
      permissionMode: (config.options?.permissionMode as 'default' | 'acceptEdits' | 'blockAll') || 'default',
      shouldNeedApproval: config.options?.shouldNeedApproval === true,
    })
  })
}
