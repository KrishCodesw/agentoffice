import React, { useState } from 'react'

function ChatMode({ agents, onCommand }: { agents: any[]; onCommand: (cmd: any) => void }) {
  const [messages, setMessages] = useState<Array<{sender: string, text: string, timestamp: string}>>([])
  const [input, setInput] = useState('')

  const sendMessage = () => {
    if (!input.trim()) return
    setMessages((prev) => [
      ...prev,
      { sender: 'operator', text: input, timestamp: new Date().toISOString() },
    ])
    setInput('')
    onCommand({ type: 'send', text: input })
  }

  return (
    <div style={{ padding: '1rem', height: '400px', border: '1px solid #ddd', borderRadius: '8px', overflow: 'auto' }}>
      <h2>Chat</h2>
      <ul style={{ listStyle: 'none', padding: '0', margin: '0', height: '300px', overflow: 'auto' }}>
        {messages.map((m, i) => (
          <li key={i} style={{ padding: '0.25rem 0', borderBottom: '1px solid #eee' }}>
            <strong>{m.sender}:</strong> {m.text}
          </li>
        ))}
      </ul>
      <div style={{ display: 'flex', marginTop: '0.5rem' }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          style={{ flex: '1', padding: '0.5rem' }}
        />
        <button onClick={sendMessage} style={{ padding: '0.5rem 1rem' }}>Send</button>
      </div>
    </div>
  )
}
export default ChatMode
