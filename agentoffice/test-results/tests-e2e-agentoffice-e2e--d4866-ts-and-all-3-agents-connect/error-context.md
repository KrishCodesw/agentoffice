# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests\e2e\agentoffice-e2e.test.ts >> AgentOffice MVP >> Server starts and all 3 agents connect
- Location: tests\e2e\agentoffice-e2e.test.ts:152:3

# Error details

```
Error: expect(received).toBeDefined()

Received: undefined
```

# Test source

```ts
  56  |   })
  57  |   server.registry.registerAdapter('http-agent-1', httpAdapter)
  58  |   const httpHandle = await httpAdapter.connect({
  59  |     agentId: 'http-agent-1',
  60  |     name: 'HTTP Agent',
  61  |     options: {},
  62  |   })
  63  |   server.registry.setSession('http-agent-1', httpHandle)
  64  | 
  65  |   // Connect Claude Agent SDK Adapter (will use mocked behavior since no real API key)
  66  |   const claudeAdapter = new ClaudeAgentSDKAdapter({
  67  |     agentId: 'claude-sdk-1',
  68  |     name: 'Claude SDK Agent',
  69  |     workingDir: process.cwd(),
  70  |     allowedTools: ['Read', 'Glob', 'Grep'],
  71  |     maxTurns: 5,
  72  |   })
  73  |   server.registry.registerAdapter('claude-sdk-1', claudeAdapter)
  74  |   const claudeHandle = await claudeAdapter.connect({
  75  |     agentId: 'claude-sdk-1',
  76  |     name: 'Claude SDK Agent',
  77  |     options: {},
  78  |   })
  79  |   server.registry.setSession('claude-sdk-1', claudeHandle)
  80  | 
  81  |   // Start consuming event streams for all agents (like the server does)
  82  |   // This makes the mock agent's events flow through the bus
  83  |   const startEventStream = async (agentId: string, adapter: MockAdapter | HttpAgentAdapter, handle: any) => {
  84  |     try {
  85  |       for await (const event of adapter.events(handle)) {
  86  |         const enrichedEvent = { ...event, agentId }
  87  |         server.bus.publish('agentEvents', enrichedEvent)
  88  |         
  89  |         // Handle specific event types
  90  |         if (event.type === 'status') {
  91  |           handle.state = event.state
  92  |           server.bus.publish('agent-state', { agentId, state: event.state })
  93  |         }
  94  |         if (event.type === 'needs_approval') {
  95  |           const approvalId = server.policy.createApproval({
  96  |             action: event.action,
  97  |             risk: event.risk,
  98  |             requestedBy: agentId,
  99  |             context: { agentId },
  100 |           })
  101 |           server.bus.publish('approvals', { approvalId, action: event.action, risk: event.risk, status: 'pending' })
  102 |         }
  103 |       }
  104 |     } catch (error) {
  105 |       console.error(`Event stream error for agent ${agentId}:`, error)
  106 |     }
  107 |   }
  108 | 
  109 |   // Start event streams for mock and http agents (they have synchronous event generators)
  110 |   startEventStream('mock-1', mockAdapter, mockHandle)
  111 |   startEventStream('http-agent-1', httpAdapter, httpHandle)
  112 |   // Note: claude-agent-sdk has its own async query loop, not a simple event generator
  113 | 
  114 |   // Wait for all agents to connect and start event streams
  115 |   await new Promise(resolve => setTimeout(resolve, 2000))
  116 | 
  117 |   return { server, mockAdapter, httpAdapter, claudeAdapter }
  118 | }
  119 | 
  120 | // Helper: stop the server and clean up adapters
  121 | async function teardownServer(data: Awaited<ReturnType<typeof setupServerAndAgents>>): Promise<void> {
  122 |   try {
  123 |     await data.mockAdapter.close({ id: 'mock-1' } as any)
  124 |     await data.httpAdapter.close({ id: 'http-agent-1' } as any)
  125 |     await data.claudeAdapter.close({ id: 'claude-sdk-1' } as any)
  126 |   } catch (e) {
  127 |     console.warn('Error closing adapters:', e)
  128 |   }
  129 |   
  130 |   try {
  131 |     if (data.server.app?.close) {
  132 |       await data.server.app.close()
  133 |     }
  134 |   } catch (e) {
  135 |     console.warn('Error closing server:', e)
  136 |   }
  137 | }
  138 | 
  139 | test.describe('AgentOffice MVP', () => {
  140 |   let serverData: Awaited<ReturnType<typeof setupServerAndAgents>>
  141 | 
  142 |   test.beforeAll(async () => {
  143 |     serverData = await setupServerAndAgents()
  144 |   })
  145 | 
  146 |   test.afterAll(async () => {
  147 |     if (serverData) {
  148 |       await teardownServer(serverData)
  149 |     }
  150 |   })
  151 | 
  152 |   test('Server starts and all 3 agents connect', async () => {
  153 |     const { server } = serverData
  154 |     
  155 |     // Verify server is running
> 156 |     expect(server.httpServer).toBeDefined()
      |                               ^ Error: expect(received).toBeDefined()
  157 |     expect(server.httpServer.listening).toBe(true)
  158 |     
  159 |     // Verify all 3 agents are registered
  160 |     const agents = server.registry.listAgents()
  161 |     expect(agents.length).toBe(3)
  162 |     
  163 |     const agentIds = agents.map(a => a.id).sort()
  164 |     expect(agentIds).toEqual(['claude-sdk-1', 'http-agent-1', 'mock-1'])
  165 |     
  166 |     console.log('✅ Server started and 3 agents connected:', agentIds)
  167 |   })
  168 | 
  169 |   test('All agents have correct capabilities', async () => {
  170 |     const { mockAdapter, httpAdapter, claudeAdapter } = serverData
  171 |     
  172 |     // Mock agent capabilities
  173 |     const mockCaps = Array.from(mockAdapter.capabilities)
  174 |     expect(mockCaps).toContain('message')
  175 |     expect(mockCaps).toContain('pause')
  176 |     expect(mockCaps).toContain('approvals')
  177 |     
  178 |     // HTTP agent capabilities
  179 |     const httpCaps = Array.from(httpAdapter.capabilities)
  180 |     expect(httpCaps).toContain('message')
  181 |     expect(httpCaps).toContain('pause')
  182 |     expect(httpCaps).toContain('approvals')
  183 |     
  184 |     // Claude SDK agent capabilities
  185 |     const claudeCaps = Array.from(claudeAdapter.capabilities)
  186 |     expect(claudeCaps).toContain('message')
  187 |     expect(claudeCaps).toContain('pause')
  188 |     expect(claudeCaps).toContain('approvals')
  189 |     expect(claudeCaps).toContain('usage')
  190 |     expect(claudeCaps).toContain('handoff')
  191 |     expect(claudeCaps).toContain('takeover')
  192 |     
  193 |     console.log('✅ All agents have correct capabilities')
  194 |   })
  195 | 
  196 |   test('Mock agent emits approval event for risky action', async () => {
  197 |     const { server, mockAdapter } = serverData
  198 |     
  199 |     // Get the mock agent's session handle
  200 |     const handle = server.registry.getSession('mock-1')
  201 |     expect(handle).toBeDefined()
  202 |     
  203 |     // Directly consume the mock agent's event stream and publish to bus
  204 |     // This ensures the approval event is emitted and published
  205 |     let approvalEvent: any = null
  206 |     
  207 |     const waitForApproval = new Promise((resolve) => {
  208 |       server.bus.subscribe('approvals', (payload: any) => {
  209 |         if (payload.status === 'pending' && payload.approvalId) {
  210 |           approvalEvent = payload
  211 |           resolve(payload)
  212 |         }
  213 |       })
  214 |     })
  215 |     
  216 |     // Consume the mock agent's event stream directly
  217 |     // The approval event is the 4th event (after status, output, tool_call)
  218 |     const eventStream = mockAdapter.events(handle!)
  219 |     let eventCount = 0
  220 |     for await (const event of eventStream) {
  221 |       eventCount++
  222 |       const enrichedEvent = { ...event, agentId: 'mock-1' }
  223 |       server.bus.publish('agentEvents', enrichedEvent)
  224 |       
  225 |       if (event.type === 'status') {
  226 |         handle!.state = event.state
  227 |         server.bus.publish('agent-state', { agentId: 'mock-1', state: event.state })
  228 |       }
  229 |       if (event.type === 'needs_approval') {
  230 |         const approvalId = server.policy.createApproval({
  231 |           action: event.action,
  232 |           risk: event.risk,
  233 |           requestedBy: 'mock-1',
  234 |           context: { agentId: 'mock-1' },
  235 |         })
  236 |         server.bus.publish('approvals', { approvalId, action: event.action, risk: event.risk, status: 'pending' })
  237 |         // We found the approval event, we can break
  238 |         break
  239 |       }
  240 |       // Safety: don't loop forever
  241 |       if (eventCount > 10) break
  242 |     }
  243 |     
  244 |     // Wait up to 10 seconds for the approval event
  245 |     const result = await Promise.race([
  246 |       waitForApproval,
  247 |       new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout waiting for approval')), 15000))
  248 |     ])
  249 |     
  250 |     expect(result).toBeDefined()
  251 |     expect((result as any).approvalId).toBeDefined()
  252 |     expect((result as any).action).toContain('shell')
  253 |     expect((result as any).risk).toBe('high')
  254 |     
  255 |     console.log('✅ Mock agent emitted needs_approval event:', (result as any).approvalId)
  256 |   })
```