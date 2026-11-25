/**
 * OpenAI Agents Adapter - Wraps the OpenAI Agents SDK (`@openai/agents`).
 *
 * Bridges the OpenAI Agents SDK run loop to AgentOffice events and commands.
 *
 * Requires `@openai/agents` to be installed.
 *
 * Layering: depends on core only. Vendor import is lazy (dynamic import).
 */

import { AgentAdapter, Capability, SessionHandle, AgentEvent, Command, CommandResult, AdapterConfig } from '@agentoffice/core'

export type OpenAIAgentsConfig = {
  /** OpenAI API key */
  apiKey?: string
  /** Model to use (e.g. "gpt-4o") */
  model?: string
  /** Instructions for the agent */
  instructions?: string
  /** Tools available to the agent */
  tools?: string[]
  /** Maximum turns */
  maxTurns?: number
  /** If true, the agent requests approval for risky actions */
  shouldNeedApproval?: boolean
}

export class OpenAIAgentsAdapter implements AgentAdapter {
  readonly id = 'openai-agents'
  readonly capabilities: ReadonlySet<Capability>
  private config: OpenAIAgentsConfig
  private session: SessionHandle | null = null
  private eventQueue: AgentEvent[] = []
  private eventResolve: ((value: AgentEvent) => void) | null = null
  private pendingApprovals: Map<string, { resolve: (decision: 'allow' | 'deny') => void; reject: (err: Error) => void }> = new Map()
  private isShuttingDown = false
  private sdk: any = null

  constructor(config: OpenAIAgentsConfig) {
    const caps: Capability[] = [
      'message',
      'pause',
      'approvals',
      'usage',
    ]
    this.capabilities = new Set<Capability>(caps) as ReadonlySet<Capability>
    this.config = config
  }

  async connect(config: AdapterConfig): Promise<SessionHandle> {
    // Lazy-load the OpenAI Agents SDK
    try {
      // Dynamic import - will fail if @openai/agents is not installed
      this.sdk = await import('@openai/agents')
    } catch {
      throw new Error(
        '@openai/agents is not installed. Install it with: pnpm add @openai/agents ' +
        '(or use the mock adapter for testing)'
      )
    }

    // Validate API key
    if (!this.config.apiKey && !process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key not set. Set OPENAI_API_KEY env var or apiKey in config.')
    }

    this.session = {
      id: config.agentId,
      label: config.name || 'OpenAI Agents',
      capabilities: this.capabilities,
      state: 'working',
    }

    // Emit initial status
    this.enqueueEvent({ type: 'status', state: 'working' })

    return this.session
  }

  async *events(session: SessionHandle): AsyncIterable<AgentEvent> {
    while (!this.isShuttingDown) {
      const event = await new Promise<AgentEvent>((resolve) => {
        if (this.eventQueue.length > 0) {
          resolve(this.eventQueue.shift()!)
        } else {
          this.eventResolve = resolve
        }
      })
      yield event
    }
  }

  async command(session: SessionHandle, cmd: Command): Promise<CommandResult> {
    if (!this.session) {
      return 'rejected'
    }

    switch (cmd.type) {
      case 'send':
        // Send message to the OpenAI agent
        try {
          if (this.sdk && this.sdk.Agent) {
            // The actual SDK integration would go here
            // For now, emit as output event
            this.enqueueEvent({ type: 'output', text: `[OpenAI Agent] ${cmd.text}` })
          }
        } catch (err) {
          console.error('[openai-agents] send error:', err)
        }
        return 'accepted'

      case 'pause':
        this.session.state = 'paused'
        return 'accepted'

      case 'resume':
        this.session.state = 'working'
        return 'accepted'

      case 'stop':
        this.session.state = 'offline'
        this.isShuttingDown = true
        this.enqueueEvent({ type: 'status', state: 'offline' })
        return 'accepted'

      case 'approve':
        this._resolvePendingApproval(cmd.approvalId, 'allow')
        return 'accepted'

      case 'deny':
        this._resolvePendingApproval(cmd.approvalId, 'deny')
        return 'accepted'

      case 'takeover':
        if (cmd.on) {
          this.session.state = 'working'
        }
        return 'accepted'

      default:
        return 'unsupported'
    }
  }

  async close(session: SessionHandle): Promise<void> {
    this.isShuttingDown = true
    this.session = null

    for (const [, pending] of this.pendingApprovals) {
      pending.reject(new Error('Session closed'))
    }
    this.pendingApprovals.clear()
  }

  private enqueueEvent(event: AgentEvent): void {
    if (this.eventResolve) {
      this.eventResolve(event)
      this.eventResolve = null
    } else {
      this.eventQueue.push(event)
    }
  }

  private _resolvePendingApproval(approvalId: string, decision: 'allow' | 'deny'): void {
    const pending = this.pendingApprovals.get(approvalId)
    if (pending) {
      if (decision === 'allow') {
        pending.resolve('allow')
      } else {
        pending.reject(new Error('Denied by operator'))
      }
      this.pendingApprovals.delete(approvalId)
    }
  }
}
