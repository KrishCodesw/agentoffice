import React from 'react'

function CallMode({ agents, onCommand }: { agents: any[]; onCommand: (cmd: any) => void }) {
  return (
    <div style={{ padding: '1rem', height: '400px', border: '1px solid #ddd', borderRadius: '8px' }}>
      <h2>Call</h2>
      <p>Voice call mode - push to talk with browser speech APIs.</p>
      <button onClick={() => onCommand({ type: 'send', text: 'Hello via call!' })} style={{ marginBottom: '0.5rem' }}>
        Send voice message
      </button>
      <p>Agents: {agents.map((a: any) => a.name).join(', ')}</p>
    </div>
  )
}
export default CallMode
