/**
 * AgentAdapter - The single integration boundary between AgentOffice and any agent vendor.
 *
 * This is the contract that every vendor adapter must implement. The Office never
 * imports a specific vendor type; it only knows about AgentAdapter.
 *
 * Design notes:
 * - Capability flags are honest: if an adapter doesn't expose a capability, the UI
 *   disables that control. Never promise what you cannot deliver.
 * - connect() modes (Managed, Attached, Observed) are chosen by the config, not forced
 *   by the adapter interface.
 * - Commands are idempotent: sending the same command twice produces the same result.
 * - Events carry a sequence number per session so the UI can render an ordered feed.
 */

import { AgentEvent } from './events'

// Capability flags are the honest way the UI knows what an agent can do.
// If a vendor's agent cannot be stopped, its adapter simply omits 'pause' from the set.
export type Capability =
  | 'message'
  | 'pause'
  | 'approvals'
  | 'usage'
  | 'handoff'
  | 'takeover'
  | 'voice'

// The configuration an adapter receives when connecting. Vendor-specific fields
// go in a vendor-specific config object; this interface is the common base.
export interface AdapterConfig {
  /** Unique identifier for this agent within the office */
  agentId: string
  /** Name shown in the UI */
  name?: string
  /** Room the agent should join */
  room?: string
  /** Vendor-specific options */
  options?: Record<string, unknown>
}

// The return value from connect(). The UI never needs to inspect this directly;
// it just passes the handle to events() and command().
export interface SessionHandle {
  readonly id: string
  /** Human-readable label */
  label?: string
  /** Visible in the UI */
  capabilities: ReadonlySet<Capability>
  /** Current presence state */
  state: 'working' | 'idle' | 'paused' | 'error' | 'offline'
}

// The result of sending a command to an agent. Every command returns this so the
// UI knows: was it accepted, rejected because the agent doesn't support it, or
// rejected because the operator denied approval?
export type CommandResult = 'accepted' | 'rejected' | 'unsupported'

// The main adapter that the server creates a session with. One instance per agent.
export interface AgentAdapter {
  /** Unique identifier for this adapter / vendor */
  readonly id: string
  /** Which control verbs this agent supports - the UI gates on these */
  readonly capabilities: ReadonlySet<Capability>

  /** Connect the agent and return a session handle.
   *  Mode is determined by the config and adapter implementation:
   *   - Managed: Office starts the agent in a sandbox
   *   - Attached: Agent already runs and reports in
   *   - Observed: Only watch logs/telemetry
   */
  connect(config: AdapterConfig): Promise<SessionHandle>

  /** Ordered stream of events from the agent to the office.
   *  Events are delivered in order per session and each has a sequence number.
   */
  events(session: SessionHandle): AsyncIterable<AgentEvent>

  /** Send a command to the agent. Idempotent: same command twice = same result.
   *  Returns CommandResult: 'accepted' | 'rejected' | 'unsupported'
   *  'unsupported' is a normal outcome, not an error - the agent just doesn't do that.
   */
  command(session: SessionHandle, cmd: import('./commands').Command): Promise<CommandResult>

  /** Gracefully close the session. The agent should clean up.
   *  After close(), events() will not deliver new events.
   */
  close(session: SessionHandle): Promise<void>
}