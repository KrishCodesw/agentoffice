import React, { useState, useEffect } from 'react'

interface ControlModeProps {
  agents: Array<{
    id: string
    name: string
    capabilities: string[]
    state: 'working' | 'idle' | 'paused' | 'error' | 'offline'
  }>
  approvals: Array<{
    id: string
    action: string
    risk: string
    requestedBy: string
    status: string
    expiresAt: string
    createdAt: string
    context: any
  }>
  budgets: Record<string, { used: number; limit: number; remaining: number; withinBudget: boolean }>
  onApproval: (approvalId: string, decide: 'approve' | 'deny') => void
  onKillSwitch: (activate: boolean) => void
  onBulkAction: (action: 'pause' | 'resume' | 'stop', agentIds: string[]) => void
}

export default function ControlMode({
  agents,
  approvals,
  budgets,
  onApproval,
  onKillSwitch,
  onBulkAction,
}: ControlModeProps) {
  const [killSwitchActive, setKillSwitchActive] = useState<boolean>(false)

  const pendingApprovals = approvals.filter((a) => a.status === 'pending')

  const handleBulkAction = (action: 'pause' | 'resume' | 'stop', agentIds: string[]) => {
    const targetAgents = action === 'stop'
      ? agents.filter((a) => a.state !== 'offline').map((a) => a.id)
      : agents.map((a) => a.id)
    onBulkAction(action, targetAgents)
  }

  const budgetFor = (agentId: string) => budgets[agentId] || { used: 0, limit: 0, remaining: 0, withinBudget: true }

  return (
    <div style={{ padding: '1rem', height: '400px', border: '1px solid #ddd', borderRadius: '8px', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '1px solid #e0e0e0' }}>
        <h2 style={{ margin: 0 }}>Control Room</h2>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={() => handleBulkAction('pause', [])}
            style={{
              padding: '0.5rem 1rem',
              background: '#ff9800',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.875rem',
            }}
            title="Pause all agents"
          >
            ⏸️ Pause All
          </button>
          <button
            onClick={() => handleBulkAction('resume', [])}
            style={{
              padding: '0.5rem 1rem',
              background: '#4caf50',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.875rem',
            }}
            title="Resume all agents"
          >
            ▶️ Resume All
          </button>
          <button
            onClick={() => handleBulkAction('stop', [])}
            style={{
              padding: '0.5rem 1rem',
              background: '#f44336',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.875rem',
            }}
            title="Stop all agents"
          >
            ⏹️ Stop All
          </button>
          <button
            onClick={() => {
              onKillSwitch(!killSwitchActive)
              setKillSwitchActive(!killSwitchActive)
            }}
            style={{
              padding: '0.5rem 1rem',
              background: killSwitchActive ? '#9c27b0' : '#d32f2f',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.875rem',
            }}
            title={killSwitchActive ? 'Deactivate kill switch' : 'Stop all agents immediately'}
          >
            {killSwitchActive ? '🔓 DEACTIVATE' : '🛑 KILL SWITCH'}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {/* Agents table */}
        <div>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Agents ({agents.length})</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e0e0e0' }}>
                <th style={{ padding: '0.5rem', color: '#666' }}>Agent</th>
                <th style={{ padding: '0.5rem', color: '#666' }}>State</th>
                <th style={{ padding: '0.5rem', color: '#666' }}>Budget</th>
                <th style={{ padding: '0.5rem', color: '#666' }}></th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => {
                const b = budgetFor(a.id)
                const overBudget = !b.withinBudget && b.limit > 0
                return (
                  <tr key={a.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '0.5rem', fontWeight: 500 }}>{a.name}</td>
                    <td style={{ padding: '0.5rem' }}>
                      <span style={{
                        padding: '0.125rem 0.5rem',
                        borderRadius: '3px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        background: a.state === 'working' ? '#e8f5e9' : a.state === 'paused' ? '#fff3e0' : a.state === 'error' || a.state === 'offline' ? '#ffebee' : '#e3f2fd',
                        color: a.state === 'working' ? '#2e7d32' : a.state === 'paused' ? '#ef6c00' : a.state === 'error' || a.state === 'offline' ? '#c62828' : '#1565c0',
                      }}>
                        {a.state}
                      </span>
                    </td>
                    <td style={{ padding: '0.5rem' }}>
                      {b.limit > 0 ? (
                        <span style={{ color: overBudget ? '#c62828' : '#666' }}>
                          ${b.used.toFixed(4)} / ${b.limit.toFixed(2)}
                        </span>
                      ) : (
                        <span style={{ color: '#999' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '0.5rem', textAlign: 'right' }}>
                      <button
                        onClick={() => onBulkAction('stop', [a.id])}
                        style={{
                          padding: '0.25rem 0.5rem',
                          background: '#f44336',
                          color: 'white',
                          border: 'none',
                          borderRadius: '3px',
                          cursor: 'pointer',
                          fontSize: '0.75rem',
                        }}
                        disabled={a.state === 'offline'}
                      >
                        Stop
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Approvals queue */}
        <div>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Approvals Queue ({pendingApprovals.length})</h3>
          {pendingApprovals.length === 0 ? (
            <p style={{ color: '#999', textAlign: 'center', marginTop: '2rem' }}>
              No pending approvals
            </p>
          ) : (
            <ul style={{ listStyle: 'none', padding: '0', margin: 0 }}>
              {pendingApprovals.map((a) => (
                <li key={a.id} style={{ padding: '0.75rem', border: '1px solid #ddd', marginBottom: '0.5rem', borderRadius: '4px', background: '#fafafa' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <strong style={{ fontSize: '0.875rem' }}>{a.action}</strong>
                    <span style={{
                      padding: '0.125rem 0.5rem',
                      borderRadius: '3px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      background: a.risk === 'high' ? '#ffebee' : a.risk === 'medium' ? '#fff3e0' : '#e8f5e9',
                      color: a.risk === 'high' ? '#c62828' : a.risk === 'medium' ? '#ef6c00' : '#2e7d32',
                    }}>
                      {a.risk.toUpperCase()}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: '0.5rem' }}>
                    Requested by {a.requestedBy} • {new Date(a.createdAt).toLocaleTimeString()}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      onClick={() => onApproval(a.id, 'approve')}
                      style={{
                        flex: 1,
                        padding: '0.375rem 0.75rem',
                        background: '#4caf50',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontWeight: 500,
                      }}
                    >
                      ✓ Approve
                    </button>
                    <button
                      onClick={() => onApproval(a.id, 'deny')}
                      style={{
                        flex: 1,
                        padding: '0.375rem 0.75rem',
                        background: '#f44336',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontWeight: 500,
                      }}
                    >
                      ✗ Deny
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
