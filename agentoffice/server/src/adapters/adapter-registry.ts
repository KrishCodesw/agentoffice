/**
 * AdapterRegistry - Config-driven adapter factory for the server.
 *
 * The server never imports a specific vendor adapter. Instead, adapters are
 * registered here by ID, and the server looks them up through this registry.
 *
 * Layering: depends on core only (AgentAdapter, AdapterConfig, SessionHandle).
 * Vendor adapters are registered by composition modules (dev vs production).
 */

import type {
  AgentAdapter,
  AdapterConfig,
  SessionHandle,
} from '@agentoffice/core'

export type AdapterFactory = (config: AdapterConfig) => AgentAdapter

export class AdapterRegistry {
  private factories: Map<string, AdapterFactory> = new Map()

  /** Register an adapter factory by ID. Called by composition modules. */
  register(id: string, factory: AdapterFactory): void {
    this.factories.set(id, factory)
  }

  /** Create an adapter instance for the given ID and config. */
  create(id: string, config: AdapterConfig): AgentAdapter | undefined {
    const factory = this.factories.get(id)
    if (!factory) return undefined
    return factory(config)
  }

  /** List all registered adapter IDs. */
  list(): string[] {
    return Array.from(this.factories.keys())
  }

  /** Check if an adapter ID is registered. */
  has(id: string): boolean {
    return this.factories.has(id)
  }
}
