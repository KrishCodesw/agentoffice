/**
 * Event Bus - Fan-out of events to the UI and services.
 *
 * Responsibilities:
 * - In-memory pub/sub for development and simple deployments
 * - Pluggable Redis adapter for hosted/clustered deployments
 * - Same interface so the rest of the server doesn't care about the backend
 *
 * Layering: depends on core only (for event payload types, which are just strings/enums)
 */

import type { AgentEvent, Command } from '@agentoffice/core'

export interface Bus {
  /** Publish a message to a channel. All subscribers receive it. */
  publish: (channel: string, payload: any) => void

  /** Subscribe to a channel. The callback receives the payload. */
  subscribe: (channel: string, callback: (payload: any) => void) => void

  /** List of all channels that have at least one subscriber. */
  listChannels: () => string[]
}

export class InMemoryBus implements Bus {
  private subscribers: Map<string, Set<(payload: any) => void>> = new Map()

  publish(channel: string, payload: any): void {
    const set = this.subscribers.get(channel)
    if (set) {
      for (const callback of set) {
        callback(payload)
      }
    }
  }

  subscribe(channel: string, callback: (payload: any) => void): void {
    if (!this.subscribers.has(channel)) {
      this.subscribers.set(channel, new Set())
    }
    this.subscribers.get(channel)!.add(callback)
  }

  listChannels(): string[] {
    return Array.from(this.subscribers.keys())
  }
}

// Factory: use in-memory for local development, Redis for hosted
export function createBus(): Bus {
  // In a real deployment, check for REDIS_URL env var
  // if (process.env.REDIS_URL) {
  //   return new RedisBus(process.env.REDIS_URL)
  // }
  return new InMemoryBus()
}