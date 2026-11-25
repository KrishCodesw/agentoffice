/**
 * Claude Agent SDK composition - registers the claude-agent-sdk adapter factory.
 *
 * This is a composition module. It imports the vendor adapter lazily via dynamic import,
 * but app.ts does not import any vendor adapter directly.
 */

import { AdapterRegistry } from '../adapters/adapter-registry'

/** Register claude-agent-sdk adapter factory with the given registry. */
export function registerClaudeSDKAdapters(registry: AdapterRegistry): void {
  registry.register('claude-agent-sdk', async (config) => {
    const { ClaudeAgentSDKAdapter } = await import('../../../adapters/claude-agent-sdk/claude-agent-sdk')
    return new ClaudeAgentSDKAdapter({
      agentId: config.agentId,
      name: config.name,
      workingDir: (config.options?.workingDir as string) || process.cwd(),
      model: (config.options?.model as string) || undefined,
      maxTurns: (config.options?.maxTurns as number) || undefined,
      allowedTools: (config.options?.allowedTools as string[]) || undefined,
      mcpServers: (config.options?.mcpServers as Record<string, any>) || undefined,
      systemPrompt: (config.options?.systemPrompt as 'claude_code' | 'custom') || 'claude_code',
      customSystemPrompt: (config.options?.customSystemPrompt as string) || undefined,
      additionalDirectories: (config.options?.additionalDirectories as string[]) || undefined,
    })
  })
}
