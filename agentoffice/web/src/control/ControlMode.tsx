import React, { useState, useEffect } from 'react'

interface ControlModeProps {
  agents: Array<{
    id: string
    name: string
    capabilities: string[]
    state: 'working' | 'idle' | 'paused' | 'error' | 'offline'
  }>
  onApproval: (approvalId: string, decide: 'approve' | 'deny') => void
  onKillSwitch: () => void
}

export default function ControlMode({ agents, onApproval, onKillSwitch }: ControlModeProps) {
  const [approvals, setApprovals] = useState<Array<{id: string, action: string, risk: string}>>([])

  useEffect(() => {
    setApprovals([
      { id: 'app-1', action: 'run shell command', risk: 'high' },
      { id: 'app-2', action: 'write to /etc', risk: 'medium' },
    ])
  }, [agents])

  return (
    <div style={{ padding: '1rem', height: '400px', border: '1px solid #ddd', borderRadius: '8px', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '1px solid #e0e0e0' }}>
        <h2 style={{ margin: 0 }}>Control Room</h2>
        <button
          onClick={onKillSwitch}
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
          title="Stop all agents immediately"
        >
          🛑 KILL SWITCH
        </button>
      </div>

      <p style={{ margin: '0 0 1rem', color: '#666' }}>
        Agents online: {agents.filter((a: any) => a.state !== 'offline').length} / {agents.length}
      </p>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {approvals.length === 0 ? (
          <p style={{ color: '#999', textAlign: 'center', marginTop: '2rem' }}>
            No pending approvals
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: '0', margin: 0 }}>
            {approvals.map((a: any) => (
              <li key={a.id} style={{ padding: '0.75rem', border: '1px solid #ddd', marginBottom: '0.5rem', borderRadius: '4px', background: '#fafafa' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <strong>{a.action}</strong>
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
  )
}