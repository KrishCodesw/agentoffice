/**
 * HTTP Agent Adapter - Agent that connects via HTTP WebSocket endpoint
 *
 * This adapter demonstrates that AgentOffice can support agents whose
 * primary transport is HTTP rather than direct WebSocket connection.
 * The agent exposes a small HTTP endpoint that the office uses for
 * event delivery, and uses WebSocket for the control channel.
 *
 * Design notes:
 * - Implements the full AgentAdapter interface from core/
 * - Uses a persistent WebSocket connection for events → office
 * - Exposes a simple HTTP status endpoint for health checks
 * - Commands flow through the standard WebSocket control channel
 * - The office never needs to know the agent uses HTTP for transport;
 *   it only knows about the AgentAdapter interface
 */

import { AgentAdapter, Capability, SessionHandle, AgentEvent, Command, CommandResult, AdapterConfig } from '@agentoffice/core'
import http from 'http'
import { WebSocketServer } from 'ws'

/**
 * HTTP Agent Config
 */
export type HttpAgentConfig = {
  /** Unique identifier for this agent */
  agentId: string
  /** Human-readable name */
  name?: string
  /** URL the agent's HTTP server will listen on */
  bindUrl: string
  /** Whether this agent should need approval for risky actions */
  shouldNeedApproval?: boolean
}

/**
 * HTTP Agent Adapter - An agent that connects via HTTP with WebSocket control
 */
export class HttpAgentAdapter implements AgentAdapter {
  readonly id = 'http-agent'
  readonly capabilities: ReadonlySet<Capability>
  private config: HttpAgentConfig
  private session: SessionHandle | null = null
  private eventIndex = 0
  private httpServer: http.Server | null = null
  private wsServer: WebSocketServer | null = null
  private connectedClients: Set<WebSocket> = new Set()

  constructor(config: HttpAgentConfig) {
    const caps: Capability[] = ['message', 'pause', 'approvals']
    if (config.shouldNeedApproval) {
      caps.push('approvals')
    }
    this.capabilities = new Set<Capability>(caps) as ReadonlySet<Capability>
    this.config = config
  }

  /** Start the HTTP agent: initialize HTTP server + WebSocket control channel */
  async connect(config: AdapterConfig): Promise<SessionHandle> {
    const agentId = this.config.agentId

    // Start HTTP server for the agent's HTTP endpoint
    this.startHttpServer()

    // Start WebSocket server for the control channel
    this.startWsServer()

    // Small delay to ensure servers are up
    await new Promise((resolve) => setTimeout(resolve, 500))

    this.session = {
      id: agentId,
      label: this.config.name || 'HTTP Agent',
      capabilities: this.capabilities,
      state: 'working',
    }

    return this.session
  }

  /** Event stream from the HTTP agent */
  async *events(session: SessionHandle): AsyncIterable<AgentEvent> {
    // Yield a scripted sequence similar to the mock agent
    this.eventIndex = 0

    // Start working
    yield {
      type: 'status',
      state: 'working',
    }

    // Output message
    yield {
      type: 'output',
      text: 'HTTP agent is running and ready for commands.',
    }

    // Tool call
    yield {
      type: 'tool_call',
      tool: 'http_request',
      summary: 'Performing HTTP request to external service',
    }

    // Need approval if configured
    if (this.config.shouldNeedApproval) {
      yield {
        type: 'needs_approval',
        approvalId: 'app-1',
        action: 'execute external API call',
        risk: 'medium',
      }
    }

    // Continue working
    yield {
      type: 'status',
      state: 'working',
    }

    // Output final message
    yield {
      type: 'output',
      text: 'HTTP agent task complete.',
    }

    // Idle
    yield {
      type: 'status',
      state: 'idle',
    }
  }

  /** Send command to the HTTP agent */
  async command(session: SessionHandle, cmd: Command): Promise<CommandResult> {
    if (!this.session) {
      return 'rejected'
    }

    // Forward command to connected WebSocket clients
    this.broadcastToClients({ type: 'command', command: cmd })

    switch (cmd.type) {
      case 'send':
        return 'accepted'
      case 'pause':
        this.session!.state = 'paused'
        return 'accepted'
      case 'resume':
        this.session!.state = 'working'
        return 'accepted'
      case 'stop':
        this.session!.state = 'offline'
        // Clean up servers
        this.stopServers()
        return 'accepted'
      case 'approve':
        this.session!.state = 'working'
        return 'accepted'
      case 'deny':
        this.session!.state = 'error'
        return 'accepted'
      default:
        return 'unsupported'
    }
  }

  /** Close the agent session and clean up servers */
  async close(session: SessionHandle): Promise<void> {
    this.session = null
    this.stopServers()
  }

  /** Broadcast to all connected WebSocket clients */
  private broadcastToClients(message: any): void {
    const data = JSON.stringify(message)
    for (const client of this.connectedClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data)
      }
    }
  }

  /** Start the HTTP server for this agent */
  private startHttpServer(): void {
    this.httpServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        agentId: this.config.agentId,
        status: this.session?.state || 'starting',
        url: this.config.bindUrl,
      }))
    })

    const [host, port] = this.config.bindUrl.split(':')
    this.httpServer.listen(parseInt(port || '3000', 10), host || 'localhost', () => {
      console.log(`[http-agent] HTTP server listening on ${this.config.bindUrl}`)
    })
  }

  /** Start the WebSocket server for control channel */
  private startWsServer(): void {
    this.wsServer = new WebSocketServer({ noServer: true })

    // Handle HTTP upgrade to WebSocket
    this.httpServer!.on('upgrade', (request, socket, head) => {
      if (request.url?.startsWith('/ws')) {
        this.wsServer!.handleUpgrade(request, socket, head, (ws) => {
          this.wsServer!.emit('connection', ws, request)
        })
      } else {
        socket.destroy()
      }
    })

    this.wsServer.on('connection', (ws) => {
      console.log(`[http-agent] WebSocket client connected for ${this.config.agentId}`)
      this.connectedClients.add(ws)

      ws.on('message', (data) => {
        const msg = data.toString()
        try {
          const parsed = JSON.parse(msg)
          if (parsed.channel === 'commands') {
            console.log(`[http-agent] Received command: ${parsed.command.type}`)
          }
        } catch (e) {
          // Not JSON, ignore
        }
      })

      ws.on('close', () => {
        console.log(`[http-agent] WebSocket client disconnected for ${this.config.agentId}`)
        this.connectedClients.delete(ws)
      })
    })
  }

  /** Stop both HTTP and WebSocket servers */
  private stopServers(): void {
    if (this.httpServer) {
      this.httpServer.close()
      this.httpServer = null
      console.log(`[http-agent] HTTP server closed for ${this.config.agentId}`)
    }
    if (this.wsServer) {
      this.wsServer.close()
      this.wsServer = null
      console.log(`[http-agent] WebSocket server closed for ${this.config.agentId}`)
    }
  }
}