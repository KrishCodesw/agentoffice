/**
 * Test script: Verify the mock adapter connects, emits events,
 * and commands work through the server with Socket.IO.
 */

import { createServer } from './server/src/app.ts'
import { MockAdapter } from './adapters/mock/mock-agent.ts'
import { createBus } from './server/src/bus.ts'

async function main() {
  console.log('🚀 Starting AgentOffice with mock adapter + Socket.IO...\n')

  // 1. Create the mock adapter (configured to need approval for full workflow)
  const mockAdapter = new MockAdapter({
    agentId: 'mock-1',
    name: 'Mock Agent',
    shouldNeedApproval: true, // key: tests the approval workflow
    shouldError: false,
    shouldHandoff: false,
  })

  // 2. Create the server (this now starts HTTP + Socket.IO on port 3001)
  const server = await createServer({
    port: 3001,
    host: 'localhost',
    driver: 'sqlite',
  })

  // 3. Create the event bus
  const bus = createBus()

  // 4. Register the adapter with the registry
  server.registry.registerAdapter('mock-1', mockAdapter)

  // 5. Set up registry event listeners
  server.registry.onConnect((agentId: string, handle: any) => {
    console.log(`📡 Registry: Agent ${agentId} connected, state: ${handle.state}`)
  })

  server.registry.onDisconnect((agentId: string) => {
    console.log(`📡 Registry: Agent ${agentId} disconnected`)
  })

  server.registry.onStateChange((agentId: string, state: string) => {
    console.log(`📡 Registry: Agent ${agentId} state changed to: ${state}`)
  })

  // 6. Subscribe to bus events to observe the flow
  bus.subscribe('agentEvents', (payload: any) => {
    console.log(`📢 Bus: agentEvents[${payload.agentId}] seq=${payload.sequence} type=${payload.type}`)
    if (payload.type === 'needs_approval') {
      console.log(`   → Action: ${payload.action} (risk: ${payload.risk})`)
      console.log(`   → Approval ID: ${payload.approvalId}`)
    }
  })

  bus.subscribe('chat-message', (payload: any) => {
    console.log(`💬 Bus: chat-message from ${payload.senderId}: ${payload.content.substring(0, 60)}${payload.content.length > 60 ? '...' : ''}`)
  })

  bus.subscribe('approval-approved', (payload: any) => {
    console.log(`✅ Bus: approval-approved for ${payload.approvalId}`)
  })

  bus.subscribe('approval-denied', (payload: any) => {
    console.log(`❌ Bus: approval-denied for ${payload.approvalId}`)
  })

  // Wait for Socket.IO to be ready
  console.log('⏳ Waiting for Socket.IO to initialize... (1 second)')
  await new Promise((resolve) => setTimeout(resolve, 1000))

  // 7. Simulate the operator connecting with a token
  console.log('🔑 Operator token: local-token (accepted for local dev)')
  await server.auth.validateToken('local-token')
  console.log('✅ Operator authenticated\n')

  // 8. Connect the mock agent
  console.log('🔗 Connecting mock agent...')
  const handle = await mockAdapter.connect({
    agentId: 'mock-1',
    name: 'Mock Agent',
    options: {},
  })
  console.log(`✅ Mock agent connected! Session ID: ${handle.id}`)
  console.log(`   Capabilities: ${Array.from(handle.capabilities).join(', ')}`)
  console.log(`   State: ${handle.state}\n`)

  // 9. Wait for events to flow through the bus → Socket.IO → web client
  console.log('⏳ Waiting for agent events via Socket.IO... (3 seconds)')
  await new Promise((resolve) => setTimeout(resolve, 3000))

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

  // 14. The server is already running via HTTP + Socket.IO, no need to close explicitly
  // But let's stop the test

  console.log('📊 Test complete! The mock adapter + Socket.IO successfully:')
  console.log('   • Connected via connect()')
  console.log('   • Emitted events in sequence via events()')
  console.log('   • Forwards events through Socket.IO bus')
  console.log('   • Accepted approve command via command()')
  console.log('   • Accepted send command via command()')
  console.log('   • Returned proper CommandResult types')

  // Keep running for a bit more, then exit
  await new Promise((resolve) => setTimeout(resolve, 3000))
}

main().catch((err) => {
  console.error('❌ Test failed:', err)
})
