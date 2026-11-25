/**
 * Registry - Agents, sessions, presence, reconnects.
 *
 * Responsibilities:
 * - Track which adapter handles which agentId
 * - Manage active WebSocket sessions (SessionHandle)
 * - Mark agents offline within seconds of a dropped session
 * - Broadcast presence changes to the event bus
 *
 * Layering: depends on core only (AgentAdapter, SessionHandle, Capability)
 */

import type {
  AgentAdapter,
  SessionHandle,
  Capability,
  CommandResult,
} from '@agentoffice/core'

export interface RegistryEvents {
  /** Fired when a new agent connects, with its session handle */
  agentConnect: (agentId: string, handle: SessionHandle) => void
  /** Fired when an agent disconnects */
  agentDisconnect: (agentId: string) => void
  /** Fired when an agent's presence state changes */
  agentStateChange: (agentId: string, state: SessionHandle['state']) => void
  /** Fired when the kill switch is activated or deactivated */
  killSwitchChange: (active: boolean, triggeredBy: string) => void
}

export type AgentState = {
  id: string
  capabilities: ReadonlySet<Capability>
  state: SessionHandle['state']
  label?: string
}

export class Registry {
  private adapts: Map<string, AgentAdapter> = new Map() // agentId -> adapter
  private sessions: Map<string, SessionHandle> = new Map() // agentId -> session handle
  private events: RegistryEvents
  private offlineTimeouts: Map<string, NodeJS.Timeout> = new Map()
  private killSwitchActive = false
  private killSwitchTriggeredBy = ''

  constructor(app: any) {
    this.events = {
      agentConnect: () => {},
      agentDisconnect: () => {},
      agentStateChange: () => {},
      killSwitchChange: () => {},
    }
  }

  /** Register an adapter for a given agentId. Called by the server when an adapter connects. */
  registerAdapter(agentId: string, adapter: AgentAdapter): void {
    this.adapts.set(agentId, adapter)
  }

  /** Associate a session handle with an agentId. Called after adapter.connect() resolves. */
  setSession(agentId: string, handle: SessionHandle): void {
    this.sessions.set(agentId, handle)

    // Clear any existing offline timeout
    this.clearOfflineTimeout(agentId)

    // Mark agent as online via the bus
    this.events.agentConnect(agentId, handle)
  }

  /** Clear the offline timeout for an agent. */
  clearOfflineTimeout(agentId: string): void {
    const existing = this.offlineTimeouts.get(agentId)
    if (existing) {
      clearTimeout(existing)
      this.offlineTimeouts.delete(agentId)
    }
  }

  /** Schedule marking this agent offline after a timeout if no reconnect. */
  scheduleOffline(agentId: string, ms: number = 5000): void {
    this.clearOfflineTimeout(agentId)
    const timeout = setTimeout(() => {
      this.offlineTimeouts.delete(agentId)
      this.sessions.delete(agentId)
      this.events.agentDisconnect(agentId)
      // Publish "offline" event to the bus
      // (the bus fan-out will handle marking the UI)
    }, ms)
    this.offlineTimeouts.set(agentId, timeout)
  }

  /** Get the session handle for an agent. */
  getSession(agentId: string): SessionHandle | undefined {
    return this.sessions.get(agentId)
  }

  /** Get the adapter for an agent. */
  getAdapter(agentId: string): AgentAdapter | undefined {
    return this.adapts.get(agentId)
  }

  /** List all known agents (for the Control Room UI). */
  listAgents(): AgentState[] {
    return Array.from(this.sessions.values()).map((handle): AgentState => ({
      id: handle.id,
      capabilities: handle.capabilities,
      state: handle.state,
      label: handle.label,
    }))
  }

  /** Check if the kill switch is currently active. */
  isKillSwitchActive(): boolean {
    return this.killSwitchActive
  }

  /** Get who triggered the kill switch. */
  getKillSwitchTriggeredBy(): string {
    return this.killSwitchTriggeredBy
  }

  /**
   * Activate the kill switch - stop all adapters and mark every agent offline.
   * Returns the list of agent IDs that were stopped.
   */
  async activateKillSwitch(triggeredBy: string = 'operator'): Promise<string[]> {
    if (this.killSwitchActive) {
      console.log(`[registry] Kill switch already active (triggered by ${this.killSwitchTriggeredBy})`)
      return []
    }
    this.killSwitchActive = true
    this.killSwitchTriggeredBy = triggeredBy
    const stopped: string[] = []

    for (const [agentId, adapter] of this.adapts) {
      const handle = this.sessions.get(agentId)
      if (!handle) continue

      try {
        await adapter.close(handle)
        stopped.push(agentId)
      } catch (err) {
        console.error(`[registry] Kill switch: failed to stop ${agentId}:`, err)
      }

      handle.state = 'offline'
      this.sessions.delete(agentId)
      this.events.agentDisconnect(agentId)
    }

    this.events.killSwitchChange(true, triggeredBy)
    return stopped
  }

  /** Deactivate the kill switch, allowing new agents to connect. */
  deactivateKillSwitch(triggeredBy: string = 'operator'): void {
    this.killSwitchActive = false
    this.killSwitchTriggeredBy = ''
    this.events.killSwitchChange(false, triggeredBy)
  }

  /** Set the events handler (called from app.ts) */
  onConnect(fn: (...args: any[]) => void): void {
    this.events.agentConnect = fn
  }

  /** Set the disconnect handler */
  onDisconnect(fn: (...args: any[]) => void): void {
    this.events.agentDisconnect = fn
  }

  /** Set the state change handler */
  onStateChange(fn: (...args: any[]) => void): void {
    this.events.agentStateChange = fn
  }
}