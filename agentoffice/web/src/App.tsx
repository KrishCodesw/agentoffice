import { useState, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { io, Socket } from 'socket.io-client'
import FloorMode from './floor/FloorMode'
import ChatMode from './chat/ChatMode'
import CallMode from './call/CallMode'
import ControlMode from './control/ControlMode'
import ConnectMode from './connect/ConnectMode'

// Types from the core contract
type Capability = 'message' | 'pause' | 'approvals' | 'usage' | 'handoff' | 'takeover' | 'voice'

interface Agent {
  id: string
  name: string
  capabilities: Capability[]
  state: 'working' | 'idle' | 'paused' | 'error' | 'offline'
}

// Initial agent data (will be replaced by real server data)
const INITIAL_AGENTS: Agent[] = [
  { id: 'mock-1', name: 'Claude', capabilities: ['message', 'pause', 'approvals'], state: 'working' },
  { id: 'mock-2', name: 'GPT-4', capabilities: ['message', 'usage'], state: 'idle' },
  { id: 'mock-3', name: 'CLI', capabilities: ['message', 'pause'], state: 'error' },
]

export function App() {
  const [serverside, setServerside] = useState<boolean | null>(null)
  const [socket, setSocket] = useState<Socket | null>(null)
  const [agents, setAgents] = useState<Agent[]>(INITIAL_AGENTS)
  const [mode, setMode] = useState<'connect' | 'floor' | 'chat' | 'call' | 'control'>('connect')
  const [operatorToken, setOperatorToken] = useState<string>('')
  const [selectedAgentId, setSelectedAgentId] = useState<string>('mock-1')
  const [approvals, setApprovals] = useState<Array<{id: string, action: string, risk: string, requestedBy: string, status: string, expiresAt: string, createdAt: string, context: any}>>([])
  const [budgets, setBudgets] = useState<Record<string, {used: number, limit: number, remaining: number, withinBudget: boolean}>>({})
  const [auditLog, setAuditLog] = useState<Array<{id: string, timestamp: string, action: string, agentId: string | null, details: any, result: string, sessionId: string | null}>>([])

  // Connect to the server via Socket.IO
  const connectToServer = () => {
    // Use VITE_SOCKET_URL env var in dev, or same-origin in production
    const socketUrl = import.meta.env.VITE_SOCKET_URL ||
      (import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin)

    const sock = io(socketUrl, {
      extraHeaders: {
        authorization: operatorToken || '',
      },
      auth: {
        token: operatorToken,
      },
    })

    sock.on('connect', () => {
      setSocket(sock)
      setServerside(true)
      console.log('Connected to server via Socket.IO')

    // Request initial data for Control Room
    sock.emit('get-approvals')
    sock.emit('get-budgets')
    sock.emit('get-audit-log')
    })

    sock.on('agent-connect', (agentId: string, handle: any) => {
      console.log('Agent connected:', agentId, handle)
      setAgents((prev) => prev.map((a) => (a.id === agentId ? { ...a, state: handle.state } : a)))
    })

    sock.on('agent-disconnect', (agentId: string) => {
      console.log('Agent disconnected:', agentId)
      setAgents((prev) => prev.map((a) => (a.id === agentId ? { ...a, state: 'offline' } : a)))
    })

    sock.on('agent-state', (agentId: string, state: string) => {
      setAgents((prev) =>
        prev.map((a) => (a.id === agentId ? { ...a, state: state as Agent['state'] } : a)),
      )
    })

    // Listen for bus events forwarded via Socket.IO
    sock.on('agentEvents', (payload: any) => {
      console.log('📢 Socket.IO: agentEvents', payload)
      if (payload.type === 'status') {
        setAgents((prev) =>
          prev.map((a) => (a.id === payload.agentId ? { ...a, state: payload.state } : a)),
        )
      }
    })

    sock.on('chat-message', (payload: any) => {
      console.log('💬 Socket.IO: chat-message', payload.content?.substring(0, 60) + (payload.content?.length > 60 ? '...' : ''))
    })

    sock.on('approval-approved', (payload: any) => {
      console.log('✅ Socket.IO: approval-approved', payload.approvalId)
    })

    // Real-time approval event (new approval created)
    sock.on('approvals', (payload: any) => {
      if (payload.status === 'pending') {
        setApprovals((prev) => [...prev, {
          id: payload.approvalId,
          action: payload.action,
          risk: payload.risk,
          requestedBy: payload.requestedBy || payload.agentId,
          status: payload.status,
          expiresAt: payload.expiresAt,
          createdAt: new Date().toISOString(),
          context: payload.context,
        }])
      }
    })

    // Approval approved/denied - update local state
    sock.on('approval-approved', (payload: any) => {
      console.log('✅ Socket.IO: approval-approved', payload.approvalId)
      setApprovals((prev) => prev.map(a => a.id === payload.approvalId ? { ...a, status: 'approved' } : a))
    })

    sock.on('approval-denied', (payload: any) => {
      console.log('❌ Socket.IO: approval-denied', payload.approvalId)
      setApprovals((prev) => prev.map(a => a.id === payload.approvalId ? { ...a, status: 'denied' } : a))
    })

    // Budgets list query response
    sock.on('budgets-list', (payload: Record<string, any>) => {
      setBudgets(payload)
    })

    // Audit log list query response
    sock.on('audit-log-list', (payload: any[]) => {
      setAuditLog(payload)
    })

    // Budget exceeded event
    sock.on('budget-exceeded', (payload: any) => {
      console.log('⚠️ Budget exceeded for agent', payload.agentId)
      setBudgets((prev) => ({ ...prev, [payload.agentId]: { ...prev[payload.agentId], withinBudget: false } }))
      setAgents((prev) => prev.map(a => a.id === payload.agentId ? { ...a, state: 'paused' as Agent['state'] } : a))
    })

    // Usage event - update budget
    sock.on('usage', (payload: any) => {
      if (payload.budget) {
        setBudgets((prev) => ({ ...prev, [payload.agentId]: payload.budget }))
      }
    })

    // Kill switch events
    sock.on('kill-switch-activated', (payload: any) => {
      console.log('🛑 Kill switch activated', payload)
      setAgents((prev) => prev.map(a => ({ ...a, state: 'offline' as Agent['state'] })))
    })

    sock.on('kill-switch-deactivated', (payload: any) => {
      console.log('✅ Kill switch deactivated', payload)
    })

    setSocket(sock)
  }

  // Disconnect
  const disconnect = () => {
    socket?.disconnect()
    setSocket(null)
    setServerside(false)
  }

  // Send a command to the selected agent
  const sendCommand = (cmd: { type: string; text?: string }) => {
    socket?.emit('commands', { agentId: selectedAgentId, command: cmd })
  }

  // Handle approval
  const handleApproval = (approvalId: string, decide: 'approve' | 'deny') => {
    socket?.emit('approvals', { approvalId, decide })
  }

  // Bulk action - pause/resume/stop selected agents
  const handleBulkAction = (action: 'pause' | 'resume' | 'stop', agentIds: string[]) => {
    if (!socket) return
    agentIds.forEach((agentId) => {
      socket.emit('commands', { agentId, command: { type: action } })
    })
  }

  // Kill switch - stop all agents immediately via server
  const handleKillSwitch = (activate: boolean) => {
    if (!socket) return
    socket.emit('kill-switch', { activate, reason: 'Manual kill switch from Control Room' })
  }

  if (!serverside || !socket) {
    return (
      <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
        <h1>AgentOffice</h1>
        <p>Start by entering an operator token and connecting</p>
        <div>
          <label>
            Token:
            <input
              value={operatorToken}
              onChange={(e) => setOperatorToken(e.target.value)}
              placeholder="local-token"
              style={{ marginRight: '1rem' }}
            />
          </label>
          <button onClick={connectToServer} style={{ padding: '0.5rem 1rem' }}>
            Connect
          </button>
        </div>
      </div>
    )
  }

  // Find agents that support 'message' capability
  const messageCapableAgents = agents.filter(a => a.capabilities.includes('message') && a.state !== 'offline')
  const defaultAgent = messageCapableAgents[0]?.id || agents[0]?.id

  return (
    <div style={{ minHeight: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Mode switcher */}
      <div style={{ padding: '1rem', background: '#f8f9fa', borderBottom: '1px solid #e0e0e0' }}>
        <button
          onClick={() => setMode('connect')}
          style={{
            marginRight: '0.5rem',
            padding: '0.5rem 1rem',
            border: mode === 'connect' ? '2px solid #0066ff' : '1px solid #ccc',
            background: mode === 'connect' ? '#0066ff' : 'white',
            color: mode === 'connect' ? 'white' : '#333',
            borderRadius: '4px',
            cursor: 'pointer',
          }}>
          Connect
        </button>
        <button
          onClick={() => setMode('floor')}
          style={{
            marginRight: '0.5rem',
            padding: '0.5rem 1rem',
            border: mode === 'floor' ? '2px solid #0066ff' : '1px solid #ccc',
            background: mode === 'floor' ? '#0066ff' : 'white',
            color: mode === 'floor' ? 'white' : '#333',
            borderRadius: '4px',
            cursor: 'pointer',
          }}>
          Floor
        </button>
        <button
          onClick={() => setMode('chat')}
          style={{
            marginRight: '0.5rem',
            padding: '0.5rem 1rem',
            border: mode === 'chat' ? '2px solid #0066ff' : '1px solid #ccc',
            background: mode === 'chat' ? '#0066ff' : 'white',
            color: mode === 'chat' ? 'white' : '#333',
            borderRadius: '4px',
            cursor: 'pointer',
          }}>
          Chat
        </button>
        <button
          onClick={() => setMode('call')}
          style={{
            marginRight: '0.5rem',
            padding: '0.5rem 1rem',
            border: mode === 'call' ? '2px solid #0066ff' : '1px solid #ccc',
            background: mode === 'call' ? '#0066ff' : 'white',
            color: mode === 'call' ? 'white' : '#333',
            borderRadius: '4px',
            cursor: 'pointer',
          }}>
          Call
        </button>
        <button
          onClick={() => setMode('control')}
          style={{
            padding: '0.5rem 1rem',
            border: mode === 'control' ? '2px solid #0066ff' : '1px solid #ccc',
            background: mode === 'control' ? '#0066ff' : 'white',
            color: mode === 'control' ? 'white' : '#333',
            borderRadius: '4px',
            cursor: 'pointer',
          }}>
          Control Room
        </button>
      </div>

      {/* Agent selector */}
      <div style={{ padding: '0.5rem 1rem', background: '#fff', borderBottom: '1px solid #e0e0e0', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <span style={{ fontWeight: 500 }}>Active Agent:</span>
        <select
          value={selectedAgentId}
          onChange={(e) => setSelectedAgentId(e.target.value)}
          style={{ padding: '0.25rem 0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
        >
          {messageCapableAgents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.state})
            </option>
          ))}
        </select>
      </div>

      {/* Mode content */}
      {mode === 'connect' && (
        <ConnectMode
          operatorToken={operatorToken}
          onConnect={connectToServer}
          onDisconnect={disconnect}
        />
      )}

      {mode === 'floor' && <FloorMode agents={agents} onCommand={sendCommand} />}
      {mode === 'chat' && <ChatMode agents={agents} onCommand={sendCommand} />}
      {mode === 'call' && <CallMode agents={agents} onCommand={sendCommand} />}
      {mode === 'control' && (
        <ControlMode
          agents={agents}
          approvals={approvals}
          budgets={budgets}
          auditLog={auditLog}
          onApproval={handleApproval}
          onKillSwitch={handleKillSwitch}
          onBulkAction={handleBulkAction}
        />
      )}
    </div>
  )
}