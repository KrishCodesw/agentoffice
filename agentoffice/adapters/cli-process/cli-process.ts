/**
 * CLI Process Adapter - Spawns any CLI command as an agent.
 *
 * This adapter wraps any command-line program as an AgentOffice agent.
 * It spawns the process, parses stdout/stderr as AgentEvents, and sends
 * commands via stdin.
 *
 * Event format from the process (one JSON per line):
 *   { "type": "status", "state": "working" }
 *   { "type": "output", "text": "..." }
 *   { "type": "tool_call", "tool": "...", "summary": "..." }
 *   { "type": "needs_approval", "approvalId": "...", "action": "...", "risk": "high" }
 *   { "type": "usage", "inputTokens": 0, "outputTokens": 0, "costUsd": 0 }
 *   { "type": "handoff", "toAgentId": "...", "task": "...", "artifacts": [] }
 *
 * Commands are sent to stdin as JSON:
 *   { "type": "send", "text": "..." }
 *   { "type": "pause" }
 *   { "type": "resume" }
 *   { "type": "stop" }
 *
 * Layering: depends on core only.
 */

import { AgentAdapter, Capability, SessionHandle, AgentEvent, Command, CommandResult, AdapterConfig } from '@agentoffice/core'
import { spawn, ChildProcess } from 'child_process'
import readline from 'readline'

export type CliProcessConfig = {
  /** Command to spawn (e.g. "node my-agent.js" or "python agent.py") */
  command: string
  /** Arguments to pass to the command */
  args?: string[]
  /** Working directory for the process */
  cwd?: string
  /** Environment variables */
  env?: Record<string, string>
  /** If true, use a pseudo-terminal (requires `pty` module) */
  usePty?: boolean
  /** Capabilities the process claims */
  capabilities?: Capability[]
  /** If true, the process requests approval for risky actions */
  shouldNeedApproval?: boolean
}

export class CliProcessAdapter implements AgentAdapter {
  readonly id = 'cli-process'
  readonly capabilities: ReadonlySet<Capability>
  private config: CliProcessConfig
  private session: SessionHandle | null = null
  private process: ChildProcess | null = null
  private eventQueue: AgentEvent[] = []
  private eventResolve: ((value: AgentEvent) => void) | null = null
  private pendingApprovals: Map<string, { resolve: (decision: 'allow' | 'deny') => void; reject: (err: Error) => void }> = new Map()
  private isShuttingDown = false
  private stdoutLines: string[] = []

  constructor(config: CliProcessConfig) {
    const caps: Capability[] = [
      'message',
      'pause',
      ...(config.capabilities || []),
    ]
    if (config.shouldNeedApproval) {
      caps.push('approvals')
    }
    this.capabilities = new Set<Capability>(caps) as ReadonlySet<Capability>
    this.config = config
  }

  async connect(config: AdapterConfig): Promise<SessionHandle> {
    // Spawn the CLI process
    const cmd = this.config.command
    const args = this.config.args || []
    const [exe, ...exeArgs] = cmd.split(/\s+/)
    const allArgs = [...exeArgs, ...args]

    this.process = spawn(exe, allArgs, {
      cwd: this.config.cwd,
      env: { ...process.env, ...this.config.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    if (!this.process.stdout) {
      throw new Error(`Failed to spawn process: ${cmd}`)
    }

    // Set up stdout line parsing
    const rl = readline.createInterface({ input: this.process.stdout, crlfDelay: Infinity })
    rl.on('line', (line) => {
      this._handleProcessLine(line)
    })

    // Set up stderr logging
    if (this.process.stderr) {
      this.process.stderr.on('data', (data) => {
        console.error(`[cli-process:${this.config.command}] stderr: ${data.toString().trim()}`)
      })
    }

    // Handle process exit
    this.process.on('exit', (code, signal) => {
      console.log(`[cli-process:${this.config.command}] process exited code=${code} signal=${signal}`)
      this.session = null
      this.process = null
      if (!this.isShuttingDown) {
        this.enqueueEvent({ type: 'status', state: 'offline' })
      }
    })

    this.process.on('error', (err) => {
      console.error(`[cli-process:${this.config.command}] spawn error:`, err)
      this.enqueueEvent({ type: 'status', state: 'error' })
    })

    // Wait for the process to signal readiness (first status event)
    const readyEvent = await new Promise<AgentEvent>((resolve) => {
      this.eventResolve = resolve
      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.eventResolve === resolve) {
          this.eventResolve = null
          resolve({ type: 'status', state: 'working' as const })
        }
      }, 30000)
    })

    this.session = {
      id: config.agentId,
      label: config.name || `CLI: ${cmd}`,
      capabilities: this.capabilities,
      state: (readyEvent.type === 'status' ? readyEvent.state : 'working'),
    }

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
    if (!this.process || !this.session) {
      return 'rejected'
    }

    // Build command payload for stdin
    const payload: Record<string, unknown> = { type: cmd.type }
    if ((cmd as { text?: string }).text !== undefined) {
      payload.text = (cmd as { text?: string }).text
    }
    if ((cmd as { approvalId?: string }).approvalId !== undefined) {
      payload.approvalId = (cmd as { approvalId?: string }).approvalId
    }
    if ((cmd as { reason?: string }).reason !== undefined) {
      payload.reason = (cmd as { reason?: string }).reason
    }
    if ((cmd as { on?: boolean }).on !== undefined) {
      payload.on = (cmd as { on?: boolean }).on
    }
    const commandJson = JSON.stringify(payload)

    if (this.process.stdin && !this.process.stdin.destroyed) {
      this.process.stdin.write(commandJson + '\n')
    }

    switch (cmd.type) {
      case 'send':
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
        this._resolvePendingApproval(cmd.approvalId, 'allow')
        return 'accepted'
      case 'deny':
        this._resolvePendingApproval(cmd.approvalId, 'deny')
        return 'accepted'
      case 'takeover':
        this.session.state = 'working'
        return 'accepted'
      default:
        return 'unsupported'
    }
  }

  async close(session: SessionHandle): Promise<void> {
    this.isShuttingDown = true
    this.session = null

    // Resolve any pending approvals as denied
    for (const [, pending] of this.pendingApprovals) {
      pending.reject(new Error('Session closed'))
    }
    this.pendingApprovals.clear()

    if (this.process) {
      try {
        if (this.process.stdin && !this.process.stdin.destroyed) {
          this.process.stdin.end()
        }
        this.process.kill('SIGTERM')
        // Give it a moment to exit
        await new Promise((resolve) => setTimeout(resolve, 500))
        if (!this.process.killed) {
          this.process.kill('SIGKILL')
        }
      } catch {
        // Ignore cleanup errors
      }
      this.process = null
    }
  }

  private _handleProcessLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return

    try {
      const parsed = JSON.parse(trimmed)

      if (parsed.type === 'needs_approval' && parsed.approvalId) {
        // Create a pending approval that the office can resolve
        const event: AgentEvent = {
          type: 'needs_approval',
          approvalId: String(parsed.approvalId),
          action: String(parsed.action || 'unknown action'),
          risk: (parsed.risk as 'low' | 'medium' | 'high') || 'medium',
        }
        this.enqueueEvent(event)
        return
      }

      if (parsed.type === 'approval_decision' && parsed.approvalId) {
        // Process is responding to an approval we sent via command
        const pending = this.pendingApprovals.get(String(parsed.approvalId))
        if (pending) {
          if (parsed.decision === 'allow') {
            pending.resolve('allow')
          } else {
            pending.reject(new Error('Denied by process'))
          }
          this.pendingApprovals.delete(String(parsed.approvalId))
        }
        return
      }

      // Regular event - build with proper typing
      const event: AgentEvent = this._buildEvent(parsed)
      this.enqueueEvent(event)
    } catch {
      // Not JSON - treat as raw output
      this.enqueueEvent({ type: 'output', text: trimmed })
    }
  }

  private _buildEvent(parsed: any): AgentEvent {
    const type = parsed.type

    switch (type) {
      case 'status':
        return { type: 'status', state: (parsed.state as 'working' | 'idle' | 'paused' | 'error' | 'offline') }
      case 'output':
        return { type: 'output', text: String(parsed.text || '') }
      case 'tool_call':
        return { type: 'tool_call', tool: String(parsed.tool || ''), summary: String(parsed.summary || '') }
      case 'needs_approval':
        return {
          type: 'needs_approval',
          approvalId: String(parsed.approvalId || ''),
          action: String(parsed.action || ''),
          risk: (parsed.risk as 'low' | 'medium' | 'high') || 'medium',
        }
      case 'usage':
        return {
          type: 'usage',
          inputTokens: Number(parsed.inputTokens || 0),
          outputTokens: Number(parsed.outputTokens || 0),
          costUsd: Number(parsed.costUsd || 0),
        }
      case 'handoff':
        return {
          type: 'handoff',
          toAgentId: String(parsed.toAgentId || ''),
          task: String(parsed.task || ''),
          artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts : [],
        }
      default:
        return { type: 'output', text: String(parsed.text || JSON.stringify(parsed)) }
    }
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
    // Send approval decision to the process via stdin
    if (this.process?.stdin && !this.process.stdin.destroyed) {
      this.process.stdin.write(JSON.stringify({ type: 'approval_decision', approvalId, decision }) + '\n')
    }

    // Also resolve any pending promise waiting on this approval
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
