/**
 * Claude Code Adapter - Wraps the Claude Code CLI (`claude` command).
 *
 * Spawns the `claude` CLI as a subprocess and bridges its hook events
 * to AgentOffice events, and AgentOffice commands to Claude Code control.
 *
 * Requires the `claude` CLI to be installed and on PATH.
 *
 * Layering: depends on core only. Vendor import is lazy (dynamic import).
 */

import { AgentAdapter, Capability, SessionHandle, AgentEvent, Command, CommandResult, AdapterConfig } from '@agentoffice/core'
import { spawn, ChildProcess } from 'child_process'
import readline from 'readline'

export type ClaudeCodeConfig = {
  /** Working directory for the Claude Code session */
  cwd?: string
  /** Model to use (e.g. "claude-3-5-sonnet-20241022") */
  model?: string
  /** Maximum turns per session */
  maxTurns?: number
  /** System prompt */
  systemPrompt?: string
  /** Additional directories to allow access */
  additionalDirectories?: string[]
  /** Permission mode: "default", "acceptEdits", "blockAll" */
  permissionMode?: 'default' | 'acceptEdits' | 'blockAll'
  /** If true, the agent requests approval for risky actions */
  shouldNeedApproval?: boolean
}

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly id = 'claude-code'
  readonly capabilities: ReadonlySet<Capability>
  private config: ClaudeCodeConfig
  private session: SessionHandle | null = null
  private process: ChildProcess | null = null
  private eventQueue: AgentEvent[] = []
  private eventResolve: ((value: AgentEvent) => void) | null = null
  private pendingApprovals: Map<string, { resolve: (decision: 'allow' | 'deny') => void; reject: (err: Error) => void }> = new Map()
  private isShuttingDown = false

  constructor(config: ClaudeCodeConfig) {
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
    // Check if `claude` CLI is available
    const args = [
      ...(this.config.model ? ['--model', this.config.model] : []),
      ...(this.config.maxTurns ? ['--max-turns', String(this.config.maxTurns)] : []),
      ...(this.config.permissionMode ? ['--permission-mode', this.config.permissionMode] : []),
      ...(this.config.additionalDirectories?.flatMap((d) => ['--additional-directory', d]) || []),
    ]

    this.process = spawn('claude', args, {
      cwd: this.config.cwd || process.cwd(),
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    if (!this.process.stdout) {
      throw new Error('Failed to spawn `claude` CLI. Is it installed and on PATH?')
    }

    // Parse stdout as JSON-lines events from Claude Code hooks
    const rl = readline.createInterface({ input: this.process.stdout, crlfDelay: Infinity })
    rl.on('line', (line) => {
      this._handleProcessLine(line)
    })

    if (this.process.stderr) {
      this.process.stderr.on('data', (data) => {
        console.error(`[claude-code] stderr: ${data.toString().trim()}`)
      })
    }

    this.process.on('exit', (code, signal) => {
      console.log(`[claude-code] process exited code=${code} signal=${signal}`)
      this.session = null
      this.process = null
      if (!this.isShuttingDown) {
        this.enqueueEvent({ type: 'status', state: 'offline' })
      }
    })

    this.process.on('error', (err) => {
      console.error('[claude-code] spawn error:', err)
      this.enqueueEvent({ type: 'status', state: 'error' })
    })

    // Wait for initial ready event or timeout
    await new Promise<AgentEvent>((resolve) => {
      this.eventResolve = resolve
      setTimeout(() => {
        if (this.eventResolve === resolve) {
          this.eventResolve = null
          resolve({ type: 'status', state: 'working' })
        }
      }, 30000)
    })

    this.session = {
      id: config.agentId,
      label: config.name || 'Claude Code',
      capabilities: this.capabilities,
      state: 'working',
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

    switch (cmd.type) {
      case 'send':
        // Send message to Claude Code via stdin
        if (this.process.stdin && !this.process.stdin.destroyed) {
          this.process.stdin.write(JSON.stringify({ type: 'user_message', text: cmd.text }) + '\n')
        }
        return 'accepted'

      case 'pause':
        if (this.process.stdin && !this.process.stdin.destroyed) {
          this.process.stdin.write(JSON.stringify({ type: 'interrupt' }) + '\n')
        }
        this.session.state = 'paused'
        return 'accepted'

      case 'resume':
        this.session.state = 'working'
        return 'accepted'

      case 'stop':
        this.session.state = 'offline'
        if (this.process.stdin && !this.process.stdin.destroyed) {
          this.process.stdin.write(JSON.stringify({ type: 'stop' }) + '\n')
        }
        return 'accepted'

      case 'approve':
        this._resolvePendingApproval(cmd.approvalId, 'allow')
        return 'accepted'

      case 'deny':
        this._resolvePendingApproval(cmd.approvalId, 'deny')
        return 'accepted'

      case 'takeover':
        if (cmd.on) {
          if (this.process.stdin && !this.process.stdin.destroyed) {
            this.process.stdin.write(JSON.stringify({ type: 'interrupt' }) + '\n')
          }
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

    if (this.process) {
      try {
        if (this.process.stdin && !this.process.stdin.destroyed) {
          this.process.stdin.end()
        }
        this.process.kill('SIGTERM')
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
        const event: AgentEvent = {
          type: 'needs_approval',
          approvalId: parsed.approvalId,
          action: parsed.action || 'unknown action',
          risk: parsed.risk || 'medium',
        }
        this.enqueueEvent(event)
        return
      }

      if (parsed.type === 'approval_decision' && parsed.approvalId) {
        const pending = this.pendingApprovals.get(parsed.approvalId)
        if (pending) {
          if (parsed.decision === 'allow') {
            pending.resolve('allow')
          } else {
            pending.reject(new Error('Denied by process'))
          }
          this.pendingApprovals.delete(parsed.approvalId)
        }
        return
      }

      const event: AgentEvent = {
        type: parsed.type,
        ...(parsed.state !== undefined ? { state: parsed.state } : {}),
        ...(parsed.text !== undefined ? { text: parsed.text } : {}),
        ...(parsed.tool !== undefined ? { tool: parsed.tool, summary: parsed.summary || '' } : {}),
        ...(parsed.approvalId !== undefined ? { approvalId: parsed.approvalId, action: parsed.action || '', risk: parsed.risk || 'medium' } : {}),
        ...(parsed.inputTokens !== undefined ? { inputTokens: parsed.inputTokens, outputTokens: parsed.outputTokens, costUsd: parsed.costUsd } : {}),
        ...(parsed.toAgentId !== undefined ? { toAgentId: parsed.toAgentId, task: parsed.task || '', artifacts: parsed.artifacts || [] } : {}),
      }
      this.enqueueEvent(event)
    } catch {
      this.enqueueEvent({ type: 'output', text: trimmed })
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
    if (this.process?.stdin && !this.process.stdin.destroyed) {
      this.process.stdin.write(JSON.stringify({ type: 'approval_decision', approvalId, decision }) + '\n')
    }

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
