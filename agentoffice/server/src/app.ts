/**
 * AgentOffice Server - Composition Root
 *
 * This is the "glue" that wires together all server services. It follows the
 * pattern from the project plan: the server depends on core only, loads adapters
 * through a registry, and never imports a specific vendor.
 *
 * Layering rule: server depends on core only. All types come from core/src/.
 */

import Fastify, { FastifyInstance } from 'fastify'
import { Server as HttpServer } from 'http'
import { Server as SocketIOServer, Socket } from 'socket.io'
import FastifyStatic from '@fastify/static'
import { Registry } from './registry'
import { InMemoryBus } from './bus'
import { TaskQueue } from './tasks'
import { PolicyEngine } from './policy'
import { Chat } from './chat'
import { CallManagerImpl } from './calls'
import { AuditLog } from './audit'
import { SqliteStore } from './store'
import { OperatorAuth } from './auth'
import { AdapterRegistry } from './adapters/adapter-registry'
import { registerMockAdapters } from './composition/mock-adapters'
import { registerHttpAdapters } from './composition/http-adapters'
import { registerClaudeSDKAdapters } from './composition/claude-sdk-adapters'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

// Import core types (these are the contract; no vendor types leak in)
import type { AgentAdapter, Capability, SessionHandle, AgentEvent, Command, CommandResult } from '@agentoffice/core'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

console.log('[BOOT] Starting AgentOffice server load...')

export interface ServerConfig {
  port: number
  host: string
  driver: 'sqlite' | 'postgres'
  allowedOrigins?: string[]
  requireAuth?: boolean
}

/** Agent configuration from AGENTOFFICE_AGENTS environment variable. */
export interface AgentConfig {
  id: string
  name: string
  adapter: 'mock' | 'http-agent' | 'claude-agent-sdk'
  config: Record<string, unknown>
}

interface AuthenticatedSocket extends Socket {
  operatorId?: string
  authenticated?: boolean
}

export class AgentOfficeServer {
  public app: FastifyInstance
  public io: SocketIOServer
  public registry: Registry
  public bus: InMemoryBus
  public tasks: TaskQueue
  public policy: PolicyEngine
  public chat: Chat
  public calls: CallManagerImpl
  public audit: AuditLog
  public store: SqliteStore
  public auth: OperatorAuth
  public httpServer!: HttpServer

  private adapters: Map<string, AgentAdapter> = new Map()
  private adapterRegistry: AdapterRegistry
  private pendingCommands: Map<string, { resolve: (v: CommandResult) => void; reject: (e: Error) => void; timeout: NodeJS.Timeout }> = new Map()
  private config: ServerConfig

  constructor(config: ServerConfig) {
    this.config = config
    this.adapterRegistry = new AdapterRegistry()
    registerMockAdapters(this.adapterRegistry)
    registerHttpAdapters(this.adapterRegistry)
    registerClaudeSDKAdapters(this.adapterRegistry)
    // Default to localhost only for security
    const safeHost = config.host === '0.0.0.0' ? '127.0.0.1' : config.host
    const allowedOrigins = config.allowedOrigins ?? [`http://${safeHost}:${config.port}`, `http://${safeHost}:5173`, `http://${safeHost}:5174`, `http://${safeHost}:5175`]

    this.app = Fastify()

    // Serve web UI static files from the web/dist directory
    const webDistPath = path.resolve(__dirname, '../../web/dist')
    this.app.register(FastifyStatic, {
      root: webDistPath,
      prefix: '/',
      decorateReply: false,
    })

    // Initialize Socket.IO on the Fastify server with secure defaults
    this.io = new SocketIOServer(this.app.server, {
      cors: {
        origin: allowedOrigins,
        methods: ['GET', 'POST'],
        credentials: true,
      },
    })

    // Initialize store first (needed by other services)
    this.store = new SqliteStore(config.driver === 'postgres')

    // Initialize services
    this.audit = new AuditLog()
    this.auth = new OperatorAuth(this.store)
    this.bus = new InMemoryBus()
    this.tasks = new TaskQueue(this.bus)
    this.policy = new PolicyEngine()
    this.policy.setStore(this.store) // Pass store for persistent approvals
    this.chat = new Chat(this.bus)
    this.calls = new CallManagerImpl(this.bus, this.policy)
    this.registry = new Registry(this.app)

    // Setup Socket.IO authentication middleware FIRST - before any handlers
    this._setupSocketIOAuth(config.requireAuth ?? true)

    // Wire services together
    this._wireServices()
    this._setupSocketIOHandlers()
  }

  /** Initialize the server - must be called after construction */
  async init(): Promise<void> {
    await this._registerAdapters()
    this.startServer({ port: this.config.port, host: this.config.host })
  }

  private async startServer(config: { port: number; host: string }) {
    try {
      await this.app.listen({ port: config.port, host: config.host })
      console.log(`AgentOffice server listening on ${config.host}:${config.port}`)
    } catch (err) {
      console.error('Failed to start server:', err)
      process.exit(1)
    }
    this.httpServer = this.app.server
  }

  /**
   * Socket.IO Authentication Middleware - runs BEFORE any event handlers
   * This prevents the authentication race condition
   */
  private _setupSocketIOAuth(requireAuth: boolean) {
    this.io.use(async (socket, next) => {
      // Skip auth for health check endpoint
      if (socket.handshake.query.health === 'true') {
        return next()
      }

      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '')

      if (!token) {
        if (requireAuth) {
          console.log(`Socket ${socket.id} rejected: no token provided`)
          return next(new Error('Authentication required'))
        }
        // Development mode: allow anonymous but mark as unauthenticated
        ;(socket as AuthenticatedSocket).authenticated = false
        return next()
      }

      try {
        const valid = await this.auth.validateToken(token)
        if (!valid) {
          if (requireAuth) {
            console.log(`Socket ${socket.id} rejected: invalid token`)
            return next(new Error('Invalid token'))
          }
          // Auth disabled: allow anonymous even if a token was sent but is invalid
          console.log(`Socket ${socket.id} connected anonymously (auth disabled, invalid token)`)
          ;(socket as AuthenticatedSocket).authenticated = false
          return next()
        }

        // Get operator info from stored token
        const operatorInfo = await this.store.auth.getTokenInfo?.(token)
        ;(socket as AuthenticatedSocket).operatorId = operatorInfo?.operatorId ?? 'unknown'
        ;(socket as AuthenticatedSocket).authenticated = true
        console.log(`Socket ${socket.id} authenticated as ${(socket as AuthenticatedSocket).operatorId}`)
        next()
      } catch (err) {
        console.error(`Socket ${socket.id} auth error:`, err)
        next(new Error('Authentication failed'))
      }
    })
  }

  private async _registerAdapters() {
    // Register adapters through the config-driven adapter registry.
    // The server never imports a specific vendor adapter directly.
    // Agent configs come from the AGENTOFFICE_AGENTS environment variable.
    const agentConfigs = this._loadAgentConfigs()

    for (const agentConfig of agentConfigs) {
      const adapter = await this.adapterRegistry.create(agentConfig.adapter, {
        agentId: agentConfig.id,
        name: agentConfig.name,
        options: agentConfig.config,
      })
      if (!adapter) {
        console.error(`No adapter registered for id '${agentConfig.adapter}'`)
        continue
      }
      const handle = await adapter.connect({
        agentId: agentConfig.id,
        name: agentConfig.name,
        options: agentConfig.config,
      })
      this.adapters.set(agentConfig.id, adapter)
      this.registry.registerAdapter(agentConfig.id, adapter)
      this.registry.setSession(agentConfig.id, handle)
    }
  }

  /** Load agent configurations from AGENTOFFICE_AGENTS env var. Falls back to default mocks. */
  private _loadAgentConfigs(): AgentConfig[] {
    const raw = process.env.AGENTOFFICE_AGENTS
    if (!raw) {
      console.log('[BOOT] No AGENTOFFICE_AGENTS set - using default mock agents')
      return [
        { id: 'mock-1', name: 'Claude Mock', adapter: 'mock', config: { shouldNeedApproval: true, shouldError: false, shouldHandoff: false } },
        { id: 'mock-2', name: 'GPT-4', adapter: 'mock', config: { shouldNeedApproval: false, shouldError: false, shouldHandoff: false } },
        { id: 'mock-3', name: 'CLI', adapter: 'mock', config: { shouldNeedApproval: false, shouldError: true, shouldHandoff: false } },
      ]
    }
    try {
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) {
        throw new Error('AGENTOFFICE_AGENTS must be a JSON array')
      }

      // Validate each entry has required fields
      const validConfigs: AgentConfig[] = []
      for (const entry of parsed) {
        if (
          typeof entry?.id === 'string' &&
          typeof entry?.name === 'string' &&
          typeof entry?.adapter === 'string' &&
          entry?.config &&
          typeof entry.config === 'object'
        ) {
          validConfigs.push(entry as AgentConfig)
        } else {
          console.error('[BOOT] Skipping invalid agent config entry:', entry)
        }
      }

      if (validConfigs.length === 0 && parsed.length > 0) {
        console.error('[BOOT] No valid agent configs found in AGENTOFFICE_AGENTS')
      }

      console.log(`[BOOT] Loaded ${validConfigs.length} agent(s) from AGENTOFFICE_AGENTS`)
      return validConfigs
    } catch (err) {
      console.error('[BOOT] Failed to parse AGENTOFFICE_AGENTS, falling back to default mocks:', err)
      return [
        { id: 'mock-1', name: 'Claude Mock', adapter: 'mock', config: { shouldNeedApproval: true, shouldError: false, shouldHandoff: false } },
        { id: 'mock-2', name: 'GPT-4', adapter: 'mock', config: { shouldNeedApproval: false, shouldError: false, shouldHandoff: false } },
        { id: 'mock-3', name: 'CLI', adapter: 'mock', config: { shouldNeedApproval: false, shouldError: true, shouldHandoff: false } },
      ]
    }
  }

  private _wireServices() {
    // Wire registry events to bus
    this.registry.onConnect((agentId: string, handle: SessionHandle) => {
      this.bus.publish('agent-connect', { agentId, handle })
      this.io.emit('agent-connect', agentId, handle)

      // Start the agent's event stream
      this._startAgentEventStream(agentId, handle)
    })

    this.registry.onDisconnect((agentId: string) => {
      this.bus.publish('agent-disconnect', { agentId })
      this.io.emit('agent-disconnect', agentId)
    })

    this.registry.onStateChange((agentId: string, state: SessionHandle['state']) => {
      this.bus.publish('agent-state', { agentId, state })
      this.io.emit('agent-state', agentId, state)
    })

    // Wire chat to bus
    this.bus.subscribe('chat-message', (message: any) => {
      this.io.emit('chat-message', message)
    })

    // Wire approvals to bus
    this.bus.subscribe('approval-approved', (payload: any) => {
      this.io.emit('approval-approved', payload)
    })

    this.bus.subscribe('approval-denied', (payload: any) => {
      this.io.emit('approval-denied', payload)
    })
  }

  /**
   * Socket.IO Event Handlers - only registered after authentication middleware
   */
  private _setupSocketIOHandlers() {
    this.io.on('connection', (socket) => {
      const authSocket = socket as AuthenticatedSocket
      console.log(`Client connected: ${socket.id} (authenticated: ${authSocket.authenticated})`)

      // Only allow control commands if authenticated
      const requireAuth = (handler: (socket: AuthenticatedSocket, ...args: any[]) => void) => {
        return (...args: any[]) => {
          if (!authSocket.authenticated) {
            socket.emit('error', { code: 'UNAUTHENTICATED', message: 'Authentication required' })
            return
          }
          handler(authSocket, ...args)
        }
      }

      // Handle commands from UI to agent
      socket.on('commands', requireAuth(async (authSocket, data: { agentId: string; command: Command; commandId?: string }) => {
        const { agentId, command, commandId } = data
        const adapter = this.registry.getAdapter(agentId)
        const session = this.registry.getSession(agentId)

        if (!adapter || !session) {
          socket.emit('command-result', { agentId, commandId, result: 'rejected', error: 'Agent not found' })
          return
        }

        // Idempotency: check if commandId was already processed
        if (commandId && this.pendingCommands.has(commandId)) {
          const pending = this.pendingCommands.get(commandId)!
          clearTimeout(pending.timeout)
          // Return cached result
          const result = await adapter.command(session, command)
          pending.resolve(result)
          this.pendingCommands.delete(commandId)
          socket.emit('command-result', { agentId, commandId, result })
          return
        }

        try {
          const result = await adapter.command(session, command)
          socket.emit('command-result', { agentId, commandId, result })

          // Audit log
          this.audit.log({
            action: 'command',
            agentId,
            details: { commandType: command.type, commandId },
            result,
            sessionId: session.id,
          })

          // If it's an approval command, publish to bus
          if (command.type === 'approve' || command.type === 'deny') {
            this.bus.publish(`approval-${command.type}`, { approvalId: command.approvalId, agentId })
          }
        } catch (error) {
          console.error('Command error:', error)
          this.audit.log({
            action: 'command',
            agentId,
            details: { commandType: command.type, commandId, error: String(error) },
            result: 'rejected',
            sessionId: session?.id ?? null,
          })
          socket.emit('command-result', { agentId, commandId, result: 'rejected', error: String(error) })
        }
      }))

      // Handle approvals from UI
      socket.on('approvals', requireAuth(async (authSocket, data: { approvalId: string; decide: 'approve' | 'deny' }) => {
        const { approvalId, decide } = data
        const decision = decide === 'approve' ? 'approve' : 'deny'
        const result = await this.policy.approveApproval(approvalId, decision, authSocket.operatorId ?? 'unknown')
        this.bus.publish(`approval-${decide}`, { approvalId, status: result.status })
        this.io.emit(`approval-${decide}`, { approvalId, status: result.status })

        // Audit log
        this.audit.log({
          action: `approval-${decision}`,
          agentId: null,
          details: { approvalId, decision, decidedBy: authSocket.operatorId },
          result: result.status as any,
          sessionId: null,
        })
      }))

      // Handle kill switch - stop all agents immediately (operator only)
      socket.on('kill-switch', requireAuth(async (authSocket, data: { activate: boolean; reason?: string }) => {
        const { activate, reason } = data
        const operatorId = authSocket.operatorId ?? 'unknown'

        if (activate) {
          if (this.registry.isKillSwitchActive()) {
            socket.emit('kill-switch-already-active', { triggeredBy: this.registry.getKillSwitchTriggeredBy() })
            return
          }
          const stopped = await this.registry.activateKillSwitch(operatorId)
          this.io.emit('kill-switch-activated', { triggeredBy: operatorId, reason, stopped: stopped.length })
          this.bus.publish('kill-switch-activated', { triggeredBy: operatorId, reason, stopped })

          // Audit log
          this.audit.log({
            action: 'kill-switch',
            agentId: undefined,
            details: { activate: true, reason, stopped },
            result: 'accepted',
            sessionId: null,
          })
        } else {
          if (!this.registry.isKillSwitchActive()) {
            socket.emit('kill-switch-not-active', {})
            return
          }
          this.registry.deactivateKillSwitch(operatorId)
          this.io.emit('kill-switch-deactivated', { triggeredBy: operatorId, reason })
          this.bus.publish('kill-switch-deactivated', { triggeredBy: operatorId, reason })

          // Audit log
          this.audit.log({
            action: 'kill-switch',
            agentId: undefined,
            details: { activate: false, reason },
            result: 'accepted',
            sessionId: null,
          })
        }
      }))

      // Query pending approvals (for Control Room)
      socket.on('get-approvals', requireAuth(async (authSocket) => {
        const approvals = this.policy.getPendingApprovals().map(a => ({
          id: a.id,
          action: a.action,
          risk: a.risk,
          requestedBy: a.requestedBy,
          status: a.status,
          expiresAt: a.expiresAt,
          createdAt: a.createdAt,
          context: a.context,
        }))
        socket.emit('approvals-list', approvals)
      }))

      // Query budget status for all agents (for Control Room)
      socket.on('get-budgets', requireAuth(async (authSocket) => {
        const budgets = this.policy.getAllBudgets()
        const budgetsObj: Record<string, { used: number; limit: number; remaining: number; withinBudget: boolean }> = {}
        for (const [agentId, status] of budgets) {
          budgetsObj[agentId] = status
        }
        socket.emit('budgets-list', budgetsObj)
      }))

      // Query audit log entries (for Control Room)
      socket.on('get-audit-log', requireAuth(async (authSocket) => {
        const entries = this.audit.getEntries().slice(-100).map(e => ({
          id: e.id,
          timestamp: e.timestamp,
          action: e.action,
          agentId: e.agentId,
          details: e.details,
          result: e.result,
          sessionId: e.sessionId,
        }))
        socket.emit('audit-log-list', entries)
      }))

      socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`)
      })
    })
  }

  private async _startAgentEventStream(agentId: string, handle: SessionHandle) {
    const adapter = this.registry.getAdapter(agentId)
    if (!adapter) return

    try {
      for await (const event of adapter.events(handle)) {
        // Add agentId to event
        const enrichedEvent = { ...event, agentId, eventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2,9)}` }

        // Publish to bus
        this.bus.publish('agentEvents', enrichedEvent)
        this.io.emit('agentEvents', enrichedEvent)

        // Handle specific event types
        if (event.type === 'status') {
          handle.state = event.state
          this.bus.publish('agent-state', { agentId, state: event.state })
          this.io.emit('agent-state', agentId, event.state)
        }

        if (event.type === 'needs_approval') {
          // Create approval in policy engine - SERVER owns the approval ID
          const approvalId = this.policy.createApproval({
            action: event.action,
            risk: event.risk,
            requestedBy: agentId,
            context: { agentId, originalRequestId: enrichedEvent.eventId },
          })
          this.bus.publish('approvals', { approvalId, action: event.action, risk: event.risk, status: 'pending', expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() })
          this.io.emit('approvals', { approvalId, action: event.action, risk: event.risk, status: 'pending', expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() })
        }

        if (event.type === 'usage') {
          // Track budget and auto-pause if exceeded
          const budgetResult = this.policy.recordUsage(agentId, event.inputTokens, event.outputTokens, event.costUsd)
          if (!budgetResult.withinBudget) {
            handle.state = 'paused'
            this.bus.publish('agent-state', { agentId, state: 'paused' })
            this.io.emit('agent-state', agentId, 'paused')
            this.io.emit('budget-exceeded', { agentId, used: budgetResult.totalCostUsd, limit: budgetResult.totalCostUsd + budgetResult.remainingBudgetUsd })
            console.log(`[budget] Agent ${agentId} exceeded budget, paused automatically`)
          }
          this.io.emit('usage', { agentId, ...event, budget: budgetResult })
        }
      }
    } catch (error) {
      console.error(`Event stream error for agent ${agentId}:`, error)
      this.registry.scheduleOffline(agentId, 1000)
    }
  }
}

// Main entry point - Standard ES module pattern
const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url

if (isMain) {
  console.log('[BOOT] Starting AgentOffice server load...')

  const config: ServerConfig = {
    port: parseInt(process.env.PORT || '3001'),
    host: process.env.HOST || '127.0.0.1', // Default to localhost
    driver: (process.env.DRIVER as 'sqlite' | 'postgres') || 'sqlite',
    allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',') ?? undefined,
    requireAuth: process.env.REQUIRE_AUTH !== 'false',
  }

  console.log('[AgentOffice] Config:', config)
  console.log('[AgentOffice] import.meta.url:', import.meta.url)
  console.log('[AgentOffice] process.argv:', process.argv)

  const server = new AgentOfficeServer(config)
  console.log('[AgentOffice] Server instance created, calling init...')
  await server.init()
  console.log('[AgentOffice] Server init complete')
}