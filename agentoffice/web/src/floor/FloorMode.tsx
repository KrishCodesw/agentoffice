import React, { useState, useCallback } from 'react'
import { FloorRenderer } from './FloorRenderer'

interface FloorModeProps {
  agents: Array<{
    id: string
    name: string
    capabilities: string[]
    state: 'working' | 'idle' | 'paused' | 'error' | 'offline'
  }>
  onCommand: (cmd: { type: string; text?: string }) => void
}

export default function FloorMode({ agents, onCommand }: FloorModeProps) {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)

  const handleSendMessage = useCallback(() => {
    if (selectedAgentId) {
      onCommand({ type: 'send', text: 'Hello from operator!' })
    }
  }, [onCommand, selectedAgentId])

  return (
    <div style={{ width: '100%', height: '100%', minHeight: '500px', position: 'relative' }}>
      <FloorRenderer
        agents={agents}
        onAgentSelect={setSelectedAgentId}
        onSendCommand={onCommand}
        selectedAgentId={selectedAgentId}
      />

      {/* Agent panel on the side */}
      <div style={{
        position: 'absolute',
        right: 16,
        top: 16,
        bottom: 16,
        width: 280,
        background: 'rgba(255,255,255,0.95)',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        padding: 16,
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>Agents</h3>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {agents.map(agent => (
            <div
              key={agent.id}
              style={{
                padding: '10px 12px',
                marginBottom: 8,
                background: '#f8f9fa',
                borderRadius: 6,
                border: '1px solid #e9ecef',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              onClick={() => setSelectedAgentId(agent.id)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: agent.state === 'error' ? '#f44336' :
                    agent.state === 'working' ? '#9c27b0' :
                    agent.state === 'paused' ? '#ff9800' : '#4caf50',
                }} />
                <span style={{ fontWeight: 500 }}>{agent.name}</span>
              </div>
              <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                {agent.state} · {agent.capabilities.join(', ')}
              </div>
            </div>
          ))}
        </div>
        {selectedAgentId && (
          <div style={{ borderTop: '1px solid #e9ecef', paddingTop: 12 }}>
            <strong>Selected: {selectedAgentId}</strong>
            <div style={{ marginTop: 8 }}>
              <button
                onClick={handleSendMessage}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: '#0066ff',
                  color: 'white',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                💬 Send "Hello from operator!"
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}