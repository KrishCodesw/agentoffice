/**
 * Mock Agent Adapter - Scripted agent for tests and demos
 *
 * This adapter simulates a complete agent workflow for development and testing:
 * - Starts in "working" state
 * - Produces output messages
 * - Invokes tool calls
 * - Requests approval for risky actions
 * - Supports handoff to another agent
 * - Handles pause/resume/stop commands
 *
 * Design notes:
 * - Implements the full AgentAdapter interface from core/
 * - Events are yielded in a deterministic sequence (the "scripted day")
 * - Commands are idempotent and return proper CommandResult
 * - Capability flags honestly represent what this agent can do
 * - Can be configured to need approval or not (for testing different paths)
 */

import { AgentAdapter, Capability, SessionHandle, AgentEvent, Command, CommandResult, AdapterConfig } from '@agentoffice/core'

/**
 * Configuration for the mock agent.
 * Vendor-specific options are kept in this small config object;
 * the adapter itself is the only code that knows about "mock" agents.
 */
export type MockConfig = {
  /** Unique identifier for this agent within the office */
  agentId: string
  /** Human-readable name shown in the UI */
  name?: string
  /** If true, the agent will emit a needs_approval event */
  shouldNeedApproval?: boolean
  /** If true, the agent will eventually emit an error state */
  shouldError?: boolean
  /** If true, the agent will emit a handoff event */
  shouldHandoff?: boolean
}

/**
 * MockAdapter - A thin adapter that simulates an agent
 * for development, demos, and Playwright end-to-end tests.
 *
 * The event sequence simulates a complete agent workflow:
 *   1. status: working (agent starts)
 *   2. output: text (agent begins work)
 *   3. tool_call: tool invocation
 *   4. needs_approval: risky action requires operator approval
 *   5. (if approved) status: working (continuing)
 *   6. (if handoff) handoff: task transfer
 *   7. status: idle/error (agent finishes)
 */
export class MockAdapter implements AgentAdapter {
  readonly id = 'mock'
  readonly capabilities: ReadonlySet<Capability>

  private config: MockConfig
  private session: SessionHandle | null = null

  constructor(config: MockConfig) {
    const caps: Capability[] = [
      'message',
      'pause',
      'approvals',
      ...(config.shouldError ? (['usage'] as Capability[]) : []),
      ...(config.shouldHandoff ? (['handoff'] as Capability[]) : []),
    ]
    this.capabilities = new Set<Capability>(caps) as ReadonlySet<Capability>
    this.config = config
  }

  /** Connect the mock agent and return a session handle.
   *  In "Managed" mode, AgentOffice would start this adapter in a sandbox.
   *  For demos/tests, we just create the session here.
   */
  async connect(config: AdapterConfig): Promise<SessionHandle> {
    this.session = {
      id: this.config.agentId,
      label: this.config.name || 'Mock Agent',
      capabilities: this.capabilities,
      state: 'working',
    }

    // Reset event index so the event stream always starts from the beginning
    this.eventIndex = 0

    return this.session
  }

  /** Ordered stream of events from the mock agent to the office.
   *
   * The sequence is deterministic (the "scripted day"):
   *   Index 0: status → working
   *   Index 1: output → "Hello! I'm the mock agent. How can I help?"
   *   Index 2: tool_call → "file_read" with summary
   *   Index 3: needs_approval → risky action (if configured)
   *   Index 4: status → working (if approved) or error (if denied)
   *   Index 5: (optional) handoff → to another agent
   *   Final: status → idle or error
   *
   * The mock agent honestly reports its capabilities via the capability set.
   * If 'pause' is in the set, the UI can send pause/resume commands.
   * If 'approvals' is in the set, the UI can see needs_approval events
   * and send approve/deny commands.
   */
  async *events(session: SessionHandle): AsyncIterable<AgentEvent> {
    // --- 1. Agent starts working ---
    yield {
      type: 'status',
      state: 'working',
    }

    // --- 2. Agent produces output ---
    yield {
      type: 'output',
      text: 'Hello! I\'m the mock agent. How can I help you today?',
    }

    // --- 3. Agent invokes a tool ---
    yield {
      type: 'tool_call',
      tool: 'file_read',
      summary: 'Reading configuration file /etc/settings.conf',
    }

    // --- 4. Agent needs approval for a risky action ---
    // This is the key event that tests the approval workflow.
    // The approvalId 'app-1' maps to a pending approval in the operator's queue.
    if (this.config.shouldNeedApproval) {
      yield {
        type: 'needs_approval',
        approvalId: 'app-1',
        action: 'run shell command: rm -rf /important/data',
        risk: 'high',
      }
    }

    // --- 5. Continue or error based on configuration ---
    if (this.config.shouldError) {
      yield {
        type: 'status',
        state: 'error',
      }
      yield {
        type: 'output',
        text: 'Error: Something went wrong in the mock agent.',
      }
    } else {
      // Back to working state
      yield {
        type: 'status',
        state: 'working',
      }
      yield {
        type: 'output',
        text: 'Continuing with the task after approval.',
      }
    }

    // --- 6. Optional: handoff to another agent ---
    if (this.config.shouldHandoff) {
      yield {
        type: 'handoff',
        toAgentId: 'mock-2',
        task: 'Finish the remaining analysis',
        artifacts: ['analysis_report.json', 'summary.txt'],
      }
    }

    // --- 7. Agent finishes ---
    yield {
      type: 'status',
      state: 'idle',
    }
    yield {
      type: 'output',
      text: 'Mock agent is now idle. All tasks complete.',
    }
  }

  /** Send a command to the mock agent.
   *  Idempotent: same command twice produces the same result.
   *  'unsupported' is a normal outcome if the agent doesn't support that verb.
   */
  async command(session: SessionHandle, cmd: Command): Promise<CommandResult> {
    // If we don't have a session, we can't command
    if (!this.session) {
      return 'rejected'
    }

    switch (cmd.type) {
      case 'send':
        // Echo the message back as an agent output event
        // (In a real system, the agent would process this message.)
        // For now, just accept it.
        return 'accepted'

      case 'pause':
        this.session.state = 'paused'
        return 'accepted'

      case 'resume':
        this.session.state = 'working'
        return 'accepted'

      case 'stop':
        this.session.state = 'offline'
        return 'accepted'

      case 'approve':
        // Operator approved the needs_approval event.
        // The mock agent continues its workflow.
        this.session.state = 'working'
        return 'accepted'

      case 'deny':
        // Operator denied the needs_approval event.
        // The mock agent goes into error state.
        this.session.state = 'error'
        return 'accepted'

      case 'takeover':
        // Human takes operational control
        this.session.state = 'working'
        return 'accepted'

      default:
        // This agent doesn't support this command type.
        // 'unsupported' is a normal outcome, not an error.
        return 'unsupported'
    }
  }

  /** Gracefully close the session. The mock agent should clean up. */
  async close(session: SessionHandle): Promise<void> {
    this.session = null
  }
}