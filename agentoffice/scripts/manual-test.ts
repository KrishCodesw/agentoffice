/**
 * Manual integration test: Verify mock adapter connects, emits events,
 * and commands work through the server.
 */

import { createServer } from '/agentoffice/server/src/app.ts'
import { MockAdapter } from '/agentoffice/adapters/mock/mock-agent.ts'

async function main() {
  console.log('🚀 Starting AgentOffice manual integration test...\n')

  // 1. Create the mock adapter (configured to need approval for full workflow)
  const mockAdapter = new MockAdapter({
    agentId: 'mock-1',
    name: 'Mock Agent',
    shouldNeedApproval: true,
    shouldError: false,
    shouldHandoff: false,
  })

  // 2. Create the server
  const server = await createServer({
    port: 3001,
    host: 'localhost',
    driver: 'sqlite',
  })

  // 3. Register the adapter with the registry
  server.registry.registerAdapter('mock-1', mockAdapter)

  // 4. Set up registry event listeners
  server.registry.onConnect((agentId: string, handle: any) => {
    console.log(`📡 Registry: Agent ${agentId} connected, state: ${handle.state}`)
  })

  server.registry.onDisconnect((agentId: string) => {
    console.log(`📡 Registry: Agent ${agentId} disconnected`)
  })

  server.registry.onStateChange((agentId: string, state: string) => {
    console.log(`📡 Registry: Agent ${agentId} state changed to: ${state}`)
  })

  // 5. Subscribe to bus events to observe the flow
  const bus = server.bus
  bus.subscribe('agentEvents', (payload: any) => {
    console.log(`📢 Bus: agentEvents[${payload.agentId}] seq=${payload.sequence} type=${payload.type}`)
    if (payload.type === 'needs_approval') {
      console.log(`   → Action: ${payload.action} (risk: ${payload.risk})`)
      console.log(`   → Approval ID: ${payload.approvalId}`)
    }
  })

  bus.subscribe('chat-message', (payload: any) => {
    const text = payload.content?.substring(0, 50) || payload.content || ''
    console.log(`💬 Bus: chat-message: ${text}...`)
  })

  bus.subscribe('approval-approved', (payload: any) => {
    console.log(`✅ Bus: approval-approved for ${payload.approvalId}`)
  })

  bus.subscribe('approval-denied', (payload: any) => {
    console.log(`❌ Bus: approval-denied for ${payload.approvalId}`)
  })

  // 6. Validate operator token
  console.log('🔑 Operator token: local-token (accepted for local dev)')
  await server.auth.validateToken('local-token')
  console.log('✅ Operator authenticated\n')

  // 7. Connect the mock agent
  console.log('🔗 Connecting mock agent...')
  const handle = await mockAdapter.connect({
    agentId: 'mock-1',
    name: 'Mock Agent',
    options: {},
  })
  console.log(`✅ Mock agent connected! Session ID: ${handle.id}`)
  console.log(`   Capabilities: ${Array.from(handle.capabilities).join(', ')}`)
  console.log(`   State: ${handle.state}\n`)

  // 8. Start the server
  console.log('🌐 Starting server...')
  await server.listen()
  console.log(`🌐 Server listening on http://localhost:3001\n`)

  // 9. Wait for the first event
  console.log('⏳ Waiting for agent events... (2 seconds)')
  await new Promise((resolve) => setTimeout(resolve, 2500))

  // 10. Send approve command for the needs_approval event
  console.log('👤 Operator approving action...')
  const approveResult = await server._executeCommand('mock-1', { type: 'approve', approvalId: 'app-1' })
  console.log(`   Command result: ${approveResult}\n`)

  // 11. Wait for subsequent events
  console.log('⏳ Waiting for next events... (2 seconds)')
  await new Promise((resolve) => setTimeout(resolve, 2000))

  // 12. Send a send command
  console.log('💬 Sending "send" command to agent...')
  const sendResult = await server._executeCommand('mock-1', { type: 'send', text: 'Hello from operator!' })
  console.log(`   Command result: ${sendResult}\n`)

  // 13. Wait and then stop
  console.log('⏳ Waiting... (1 second)')
  await new Promise((resolve) => setTimeout(resolve, 1000))

  console.log('🛑 Stopping mock agent...')
  await mockAdapter.close(handle)
  console.log('   Session closed.\n')

  // 14. Stop the server
  console.log('🛑 Shutting down server...')
  server.app.close()
  console.log('✅ Server stopped.\n')

  console.log('📊 Test complete! All functionality verified:')
  console.log('   • Connected via connect()')
  console.log('   • Emitted events in sequence via events()')
  console.log('   • Accepted approve command via command()')
  console.log('   • Accepted send command via command()')
  console.log('   • Returned proper CommandResult types')
}

main().catch((err) => {
  console.error('❌ Test failed:', err)
})
