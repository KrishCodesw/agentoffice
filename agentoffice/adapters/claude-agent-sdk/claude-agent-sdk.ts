/**
 * Claude Agent SDK Adapter - Wraps Anthropic's Claude Agent SDK
 *
 * This adapter integrates the @anthropic-ai/claude-agent-sdk with AgentOffice
 * using the SDK's hooks system for bidirectional communication:
 * - SDK hooks (PreToolUse, PostToolUse, Notification) → AgentOffice events
 * - AgentOffice commands → SDK query control (interrupt, setPermissionMode, etc.)
 *
 * Design:
 * - Implements AgentAdapter interface from core/
 * - Uses canUseTool callback to bridge approval queue
 * - Uses hooks for real-time event streaming
 * - Manages SDK query lifecycle (startup, query, interrupt, close)
 */

import {
  AgentAdapter,
  Capability,
  SessionHandle,
  AgentEvent,
  Command,
  CommandResult,
  AdapterConfig,
} from '@agentoffice/core'
import {
  query,
  startup,
  type HookCallback,
  type CanUseTool,
  type HookInput,
  type HookJSONOutput,
  type PreToolUseHookInput,
  type PostToolUseHookInput,
  type NotificationHookInput,
  type PermissionRequestHookInput,
  type StopHookInput,
  type SDKMessage,
  type SDKAssistantMessage,
  type SDKUserMessage,
  type SDKResultMessage,
  type Options,
} from '@anthropic-ai/claude-agent-sdk'

export type ClaudeAgentSDKConfig = {
  agentId: string
  name?: string
  workingDir?: string
  /** Tools to auto-approve (bypass permission prompt) */
  allowedTools?: string[]
  /** Model to use */
  model?: string
  /** Maximum turns per query */
  maxTurns?: number
  /** System prompt preset */
  systemPrompt?: 'claude_code' | 'custom'
  /** Custom system prompt (when systemPrompt === 'custom') */
  customSystemPrompt?: string
  /** MCP servers to connect */
  mcpServers?: Record<string, any>
  /** Additional directories to allow access */
  additionalDirectories?: string[]
}

/**
 * Internal state for a running SDK query
 */
interface SDKQueryState {
  abortController: AbortController
  queryPromise: Promise<void> | null
  currentPrompt: string | null
  isProcessing: boolean
  pendingApproval: {
    approvalId: string
    toolName: string
    toolInput: any
    resolve: (decision: 'allow' | 'deny') => void
  } | null
}

/**
 * Claude Agent SDK Adapter
 */
export class ClaudeAgentSDKAdapter implements AgentAdapter {
  readonly id = 'claude-agent-sdk'
  readonly capabilities: ReadonlySet<Capability>

  private config: ClaudeAgentSDKConfig
  private session: SessionHandle | null = null
  private sdkState: SDKQueryState | null = null
  private eventQueue: AgentEvent[] = []
  private eventResolve: ((value: AgentEvent) => void) | null = null
  private isShuttingDown = false

  constructor(config: ClaudeAgentSDKConfig) {
    const caps: Capability[] = [
      'message',
      'pause',
      'approvals',
      'usage',
      'handoff',
      'takeover',
    ]
    this.capabilities = new Set<Capability>(caps) as ReadonlySet<Capability>
    this.config = config
  }

  /** Connect the agent and start the SDK session */
  async connect(config: AdapterConfig): Promise<SessionHandle> {
    this.session = {
      id: this.config.agentId,
      label: this.config.name || 'Claude Agent SDK',
      capabilities: this.capabilities,
      state: 'working',
    }

    // Pre-warm the SDK process
    await this.warmup()

    // Start the event processing loop
    this.startEventLoop()

    return this.session
  }

  /** Pre-warm the Claude Code process */
  private async warmup(): Promise<void> {
    const options = this.buildSDKOptions()
    await startup({
      options,
      initializeTimeoutMs: 60000,
    })
    console.log(`[claude-agent-sdk] Pre-warmed for ${this.config.agentId}`)
  }

  /** Build SDK options from adapter config */
  private buildSDKOptions(): Options {
    return {
      cwd: this.config.workingDir || process.cwd(),
      model: this.config.model,
      maxTurns: this.config.maxTurns,
      allowedTools: this.config.allowedTools,
      additionalDirectories: this.config.additionalDirectories,
      mcpServers: this.config.mcpServers,
      systemPrompt: this.config.systemPrompt === 'custom'
        ? { type: 'custom', prompt: this.config.customSystemPrompt || '' }
        : { type: 'preset', preset: 'claude_code' },
      // Permission handling via canUseTool callback
      canUseTool: this.handleCanUseTool.bind(this),
      // Hooks for event streaming
      hooks: {
        PreToolUse: [{ hooks: [this.handlePreToolUse.bind(this)] }],
        PostToolUse: [{ hooks: [this.handlePostToolUse.bind(this)] }],
        Notification: [{ hooks: [this.handleNotification.bind(this)] }],
        PermissionRequest: [{ hooks: [this.handlePermissionRequest.bind(this)] }],
        Stop: [{ hooks: [this.handleStop.bind(this)] }],
      },
      includeHookEvents: true,
    }
  }

  /** Start the background event processing loop */
  private startEventLoop(): void {
    this.sdkState = {
      abortController: new AbortController(),
      queryPromise: null,
      currentPrompt: null,
      isProcessing: false,
      pendingApproval: null,
    }

    // Process initial "ready" event
    this.enqueueEvent({ type: 'status', state: 'working' })
  }

  /** Ordered stream of events from the agent to the office */
  async *events(session: SessionHandle): AsyncIterable<AgentEvent> {
    while (!this.isShuttingDown) {
      // Wait for next event
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

  /** Enqueue an event for the stream */
  private enqueueEvent(event: AgentEvent): void {
    if (this.eventResolve) {
      this.eventResolve(event)
      this.eventResolve = null
    } else {
      this.eventQueue.push(event)
    }
  }

  /** Handle canUseTool callback - bridge to AgentOffice approval queue */
  private handleCanUseTool: CanUseTool = async (toolName, toolInput, _options) => {
    // Auto-approve allowed tools
    if (this.config.allowedTools?.includes(toolName)) {
      return { behavior: 'allow', updatedInput: toolInput }
    }

    // Check if we have a pending approval from the office
    if (this.sdkState?.pendingApproval) {
      console.warn('[claude-agent-sdk] Nested approval request')
    }

    // Create approval ID
    const approvalId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

    // Determine risk level based on tool
    const risk = this.assessRisk(toolName, toolInput)

    // Emit needs_approval event
    this.enqueueEvent({
      type: 'needs_approval',
      approvalId,
      action: `${toolName}: ${this.summarizeToolInput(toolName, toolInput)}`,
      risk,
    })

    // Wait for operator decision
    const decision = await new Promise<'allow' | 'deny'>((resolve) => {
      if (!this.sdkState) {
        resolve('deny')
        return
      }
      this.sdkState.pendingApproval = {
        approvalId,
        toolName,
        toolInput,
        resolve,
      }
    })

    if (this.sdkState) {
      this.sdkState.pendingApproval = null
    }

    // Return proper PermissionResult format
    if (decision === 'allow') {
      return { behavior: 'allow', updatedInput: toolInput }
    } else {
      return { behavior: 'deny', message: 'Operator denied the action', interrupt: false }
    }
  }

  /** Assess risk level for a tool call */
  private assessRisk(toolName: string, toolInput: any): 'low' | 'medium' | 'high' {
    const highRiskTools = ['Bash', 'Write', 'Edit', 'NotebookEdit']
    const mediumRiskTools = ['Read', 'Glob', 'Grep', 'WebFetch']

    if (highRiskTools.includes(toolName)) {
      // Check for dangerous patterns
      if (toolName === 'Bash') {
        const cmd = toolInput?.command || ''
        if (cmd.includes('rm -rf') || cmd.includes('sudo') || cmd.includes('> /dev/')) {
          return 'high'
        }
      }
      return 'high'
    }
    if (mediumRiskTools.includes(toolName)) {
      return 'medium'
    }
    return 'low'
  }

  /** Summarize tool input for approval display */
  private summarizeToolInput(toolName: string, toolInput: any): string {
    switch (toolName) {
      case 'Bash':
        return `Run command: ${toolInput?.command?.substring(0, 80) || 'unknown'}`
      case 'Write':
        return `Write file: ${toolInput?.file_path || 'unknown'}`
      case 'Edit':
        return `Edit file: ${toolInput?.file_path || 'unknown'}`
      case 'Read':
        return `Read file: ${toolInput?.file_path || 'unknown'}`
      case 'Glob':
        return `Glob pattern: ${toolInput?.pattern || 'unknown'}`
      case 'Grep':
        return `Grep pattern: ${toolInput?.pattern || 'unknown'}`
      case 'WebFetch':
        return `Fetch URL: ${toolInput?.url || 'unknown'}`
      default:
        return `${toolName} call`
    }
  }

  /** Handle PreToolUse hook - tool call starting */
  private handlePreToolUse: HookCallback = async (input, _toolUseId, _options) => {
    const preInput = input as PreToolUseHookInput
    // The canUseTool callback handles permission, this just logs
    this.enqueueEvent({
      type: 'tool_call',
      tool: preInput.tool_name,
      summary: this.summarizeToolInput(preInput.tool_name, preInput.tool_input),
    })
    return {}
  }

  /** Handle PostToolUse hook - tool call completed */
  private handlePostToolUse: HookCallback = async (input, _toolUseId, _options) => {
    const postInput = input as PostToolUseHookInput
    // Summarize tool output
    const output = (postInput as any).tool_output
    const summary = typeof output === 'string'
      ? output.substring(0, 200)
      : JSON.stringify(output).substring(0, 200)

    this.enqueueEvent({
      type: 'output',
      text: `[${postInput.tool_name}] ${summary}`,
    })

    // Emit usage if available
    const usage = (postInput as any).usage
    const costUsd = (postInput as any).cost_usd
    if (costUsd !== undefined || usage !== undefined) {
      this.enqueueEvent({
        type: 'usage',
        inputTokens: usage?.input_tokens || 0,
        outputTokens: usage?.output_tokens || 0,
        costUsd: costUsd || 0,
      })
    }
    return {}
  }

  /** Handle Notification hook - agent status updates */
  private handleNotification: HookCallback = async (input, _toolUseId, _options) => {
    const notifInput = input as NotificationHookInput
    if (notifInput.message?.includes('idle') || notifInput.message?.includes('waiting')) {
      this.enqueueEvent({ type: 'status', state: 'idle' })
    } else if (notifInput.message?.includes('working') || notifInput.message?.includes('processing')) {
      this.enqueueEvent({ type: 'status', state: 'working' })
    }
    return {}
  }

  /** Handle PermissionRequest hook - explicit permission request */
  private handlePermissionRequest: HookCallback = async (input, _toolUseId, _options) => {
    // This fires when auto mode denies or when permission is explicitly requested
    // The canUseTool callback already handles this, but we can add extra context
    return {}
  }

  /** Handle Stop hook - agent finished */
  private handleStop: HookCallback = async (_input, _toolUseId, _options) => {
    this.enqueueEvent({ type: 'status', state: 'idle' })
    return {}
  }

  /** Send a command to the agent */
  async command(session: SessionHandle, cmd: Command): Promise<CommandResult> {
    if (!this.session || !this.sdkState) {
      return 'rejected'
    }

    switch (cmd.type) {
      case 'send':
        // Inject message into the SDK query
        await this.sendMessage(cmd.text)
        return 'accepted'

      case 'pause':
        // Interrupt current query
        this.sdkState.abortController.abort()
        this.session.state = 'paused'
        return 'accepted'

      case 'resume':
        // Resume by creating new abort controller
        this.sdkState.abortController = new AbortController()
        this.session.state = 'working'
        return 'accepted'

      case 'stop':
        this.isShuttingDown = true
        this.sdkState.abortController.abort()
        this.session.state = 'offline'
        this.enqueueEvent({ type: 'status', state: 'offline' })
        return 'accepted'

      case 'approve':
        // Resolve pending approval
        if (this.sdkState.pendingApproval) {
          this.sdkState.pendingApproval.resolve('allow')
        }
        return 'accepted'

      case 'deny':
        if (this.sdkState.pendingApproval) {
          this.sdkState.pendingApproval.resolve('deny')
        }
        return 'accepted'

      case 'takeover':
        if (cmd.on) {
          // Human takes over - interrupt and inject a message
          this.sdkState.abortController.abort()
          this.session.state = 'working'
        }
        return 'accepted'

      default:
        return 'unsupported'
    }
  }

  /** Send a message to the agent (injects into query stream) */
  private async sendMessage(text: string): Promise<void> {
    if (!this.sdkState || this.isShuttingDown) return

    // If currently processing, abort and restart with new message
    if (this.sdkState.isProcessing) {
      this.sdkState.abortController.abort()
      // Wait a bit for abort to take effect
      await new Promise(r => setTimeout(r, 100))
    }

    // Create new abort controller for this query
    this.sdkState.abortController = new AbortController()
    this.sdkState.isProcessing = true
    this.sdkState.currentPrompt = text

    const options = this.buildSDKOptions()
    options.abortController = this.sdkState.abortController

    try {
      const q = query({
        prompt: text,
        options,
      })

      this.sdkState.queryPromise = this.processQueryStream(q)
      await this.sdkState.queryPromise
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // Expected when paused/interrupted
      } else {
        console.error('[claude-agent-sdk] Query error:', error)
        this.enqueueEvent({ type: 'status', state: 'error' })
        this.enqueueEvent({
          type: 'output',
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        })
      }
    } finally {
      this.sdkState.isProcessing = false
      this.sdkState.currentPrompt = null
      if (!this.isShuttingDown) {
        this.enqueueEvent({ type: 'status', state: 'idle' })
      }
    }
  }

  /** Process the async generator from query() */
  private async processQueryStream(q: any): Promise<void> {
    for await (const message of q) {
      if (this.sdkState?.abortController.signal.aborted) {
        break
      }

      // Convert SDK messages to AgentEvents
      this.handleSDKMessage(message)
    }
  }

  /** Convert SDK message to AgentEvent */
  private handleSDKMessage(message: SDKMessage): void {
    // Handle assistant message (has message.content with blocks)
    if (message.type === 'assistant') {
      const asstMsg = message as SDKAssistantMessage
      const betaMsg = asstMsg.message as any
      if (betaMsg?.content) {
        for (const block of betaMsg.content) {
          if (block.type === 'text') {
            this.enqueueEvent({ type: 'output', text: block.text })
          } else if (block.type === 'tool_use') {
            this.enqueueEvent({
              type: 'tool_call',
              tool: block.name,
              summary: this.summarizeToolInput(block.name, block.input),
            })
          }
        }
      }
      return
    }

    // Handle user message (tool results)
    if (message.type === 'user') {
      const userMsg = message as SDKUserMessage
      const msgParam = userMsg.message as any
      if (msgParam?.content) {
        const content = Array.isArray(msgParam.content) ? msgParam.content : [msgParam.content]
        for (const block of content) {
          if (block.type === 'tool_result') {
            this.enqueueEvent({
              type: 'output',
              text: `[Tool result] ${typeof block.content === 'string' ? block.content.substring(0, 200) : JSON.stringify(block.content).substring(0, 200)}`,
            })
          }
        }
      }
      return
    }

    // Handle result message
    if (message.type === 'result') {
      const resultMsg = message as SDKResultMessage
      const usage = (resultMsg as any).usage
      const costUsd = (resultMsg as any).cost_usd
      if (costUsd !== undefined || usage !== undefined) {
        this.enqueueEvent({
          type: 'usage',
          inputTokens: usage?.input_tokens || 0,
          outputTokens: usage?.output_tokens || 0,
          costUsd: costUsd || 0,
        })
      }
      if (resultMsg.subtype === 'success') {
        this.enqueueEvent({ type: 'status', state: 'idle' })
      } else {
        // All other subtypes are error types
        this.enqueueEvent({ type: 'status', state: 'error' })
      }
      return
    }

    // Ignore system and other message types
  }

  /** Gracefully close the session */
  async close(session: SessionHandle): Promise<void> {
    this.isShuttingDown = true
    if (this.sdkState) {
      this.sdkState.abortController.abort()
      if (this.sdkState.queryPromise) {
        try {
          await this.sdkState.queryPromise
        } catch {
          // Ignore abort errors
        }
      }
    }
    this.session = null
  }
}