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
import { Server as SocketIOServer } from 'socket.io'
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
import { MockAdapter } from './adapters/mock-adapter'
import path from 'path'
import { fileURLToPath } from 'url'

// Import core types (these are the contract; no vendor types leak in)
import type { AgentAdapter, Capability, SessionHandle, AgentEvent, Command, CommandResult } from '@agentoffice/core'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export interface ServerConfig {
  port: number
  host: string
  driver: 'sqlite' | 'postgres'
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

  constructor(config: ServerConfig) {
    this.app = Fastify()

    // Serve web UI static files from the web/dist directory
    const webDistPath = path.resolve(__dirname, '../../web/dist')
    this.app.register(FastifyStatic, {
      root: webDistPath,
      prefix: '/', // Serve from root
      decorateReply: false,
    })

    // Initialize Socket.IO on the Fastify server
    this.io = new SocketIOServer(this.app.server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
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
    this.chat = new Chat(this.bus)
    this.calls = new CallManagerImpl(this.bus, this.policy)
    this.registry = new Registry(this.app)

    // Wire services together
    this._wireServices()
    this._setupSocketIO()
    this._registerMockAdapters()

    // Start HTTP server using Fastify's listen
    this.startServer(config)
  }

  private async startServer(config: ServerConfig) {
    try {
      await this.app.listen({ port: config.port, host: config.host })
      console.log(`AgentOffice server listening on ${config.host}:${config.port}`)
    } catch (err) {
      console.error('Failed to start server:', err)
      process.exit(1)
    }
    this.httpServer = this.app.server
  }

  private _registerMockAdapters() {
    // Register mock adapters for demo/testing
    const mockAgents = [
      { id: 'mock-1', name: 'Claude', shouldNeedApproval: true },
      { id: 'mock-2', name: 'GPT-4' },
      { id: 'mock-3', name: 'CLI', shouldError: true },
    ]

    for (const agentConfig of mockAgents) {
      const adapter = new MockAdapter({
        agentId: agentConfig.id,
        name: agentConfig.name,
        shouldNeedApproval: agentConfig.shouldNeedApproval,
        shouldError: agentConfig.shouldError,
      })
      this.adapters.set(agentConfig.id, adapter)
      this.registry.registerAdapter(agentConfig.id, adapter)
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

  private _setupSocketIO() {
    this.io.on('connection', (socket) => {
      console.log('Client connected:', socket.id)

      // Authenticate operator
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '')
      if (token) {
        this.auth.validateToken(token).then(valid => {
          if (!valid) {
            socket.disconnect()
            return
          }
          console.log('Operator authenticated:', socket.id)
        })
      }

      // Handle commands from UI to agent
      socket.on('commands', async (data: { agentId: string; command: Command }) => {
        const { agentId, command } = data
        const adapter = this.adapters.get(agentId)
        const session = this.registry.getSession(agentId)

        if (!adapter || !session) {
          socket.emit('command-result', { agentId, result: 'rejected', error: 'Agent not found' })
          return
        }

        try {
          const result = await adapter.command(session, command)
          socket.emit('command-result', { agentId, command, result })

          // If it's an approval command, publish to bus
          if (command.type === 'approve' || command.type === 'deny') {
            this.bus.publish(`approval-${command.type}`, { approvalId: command.approvalId, agentId })
          }
        } catch (error) {
          console.error('Command error:', error)
          socket.emit('command-result', { agentId, result: 'rejected', error: String(error) })
        }
      })

      // Handle approvals from UI
      socket.on('approvals', async (data: { approvalId: string; decide: 'approve' | 'deny' }) => {
        const { approvalId, decide } = data
        const status = this.policy.approveApproval(approvalId, decide === 'approve' ? 'approved' : 'denied')
        this.bus.publish(`approval-${decide}`, { approvalId, status })
        this.io.emit(`approval-${decide}`, { approvalId, status })
      })

      socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id)
      })
    })
  }

  private async _startAgentEventStream(agentId: string, handle: SessionHandle) {
    const adapter = this.adapters.get(agentId)
    if (!adapter) return

    try {
      for await (const event of adapter.events(handle)) {
        // Add agentId to event
        const enrichedEvent = { ...event, agentId }

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
          // Create approval in policy engine
          const approvalId = this.policy.createApproval({
            action: event.action,
            risk: event.risk,
            requestedBy: agentId,
            context: { agentId },
          })
          this.bus.publish('approvals', { approvalId, action: event.action, risk: event.risk, status: 'pending' })
          this.io.emit('approvals', { approvalId, action: event.action, risk: event.risk, status: 'pending' })
        }
      }
    } catch (error) {
      console.error(`Event stream error for agent ${agentId}:`, error)
      this.registry.scheduleOffline(agentId, 1000)
    }
  }
}

// Main entry point (only runs when executed directly, not when imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  const config: ServerConfig = {
    port: parseInt(process.env.PORT || '3001'),
    host: process.env.HOST || '0.0.0.0',
    driver: (process.env.DRIVER as 'sqlite' | 'postgres') || 'sqlite',
  }

  new AgentOfficeServer(config)
}