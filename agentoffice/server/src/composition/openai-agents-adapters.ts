/**
 * OpenAI Agents adapter composition - registers the openai-agents adapter factory.
 *
 * Lazy import via dynamic import - app.ts never imports this directly.
 */

import { AdapterRegistry } from '../adapters/adapter-registry'

/** Register openai-agents adapter factory with the given registry. */
export function registerOpenAIAgentsAdapters(registry: AdapterRegistry): void {
  registry.register('openai-agents', async (config) => {
    const { OpenAIAgentsAdapter } = await import('../../../adapters/openai-agents/openai-agents')
    return new OpenAIAgentsAdapter({
      apiKey: (config.options?.apiKey as string) || process.env.OPENAI_API_KEY,
      model: (config.options?.model as string) || 'gpt-4o',
      instructions: (config.options?.instructions as string) || undefined,
      tools: (config.options?.tools as string[]) || undefined,
      maxTurns: (config.options?.maxTurns as number) || undefined,
      shouldNeedApproval: config.options?.shouldNeedApproval === true,
    })
  })
}
