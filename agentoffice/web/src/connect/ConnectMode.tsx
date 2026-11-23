import React, { useState } from 'react'

function ConnectMode({ operatorToken, onConnect, onDisconnect }: {
  operatorToken: string
  onConnect: () => void
  onDisconnect: () => void
}) {
  return (
    <div style={{ padding: '2rem', maxWidth: '400px' }}>
      <h2>Connect to Office</h2>
      <p>Enter an operator token to connect to the AgentOffice server.</p>
      <p><small>Use "local-token" for local development without authentication.</small></p>
      <button onClick={onConnect} style={{ padding: '0.5rem 1rem', marginTop: '1rem' }}>Connect</button>
      <button onClick={onDisconnect} style={{ padding: '0.5rem 1rem', marginTop: '1rem', marginLeft: '1rem' }}>Disconnect</button>
    </div>
  )
}
export default ConnectMode
