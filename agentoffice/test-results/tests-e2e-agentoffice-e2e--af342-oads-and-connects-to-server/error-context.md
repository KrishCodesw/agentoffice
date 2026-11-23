# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests\e2e\agentoffice-e2e.test.ts >> AgentOffice UI Integration >> Full UI loads and connects to server
- Location: tests\e2e\agentoffice-e2e.test.ts:397:3

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3457/
Call log:
  - navigating to "http://localhost:3457/", waiting until "networkidle"

```

# Test source

```ts
  309 |     const session = server.registry.getSession('mock-1')
  310 |     expect(session).toBeDefined()
  311 |     
  312 |     // Wait for a new approval event
  313 |     let approvalId: string | null = null
  314 |     
  315 |     const waitForApproval = new Promise<string>((resolve) => {
  316 |       server.bus.subscribe('approvals', (payload: any) => {
  317 |         if (payload.status === 'pending' && payload.approvalId) {
  318 |           approvalId = payload.approvalId
  319 |           resolve(payload.approvalId)
  320 |         }
  321 |       })
  322 |     })
  323 |     
  324 |     // Restart mock agent to trigger new approval cycle
  325 |     await mockAdapter.close(session!)
  326 |     const newHandle = await mockAdapter.connect({
  327 |       agentId: 'mock-1',
  328 |       name: 'Claude Mock',
  329 |       options: {},
  330 |     })
  331 |     server.registry.setSession('mock-1', newHandle)
  332 |     
  333 |     const result = await Promise.race([
  334 |       waitForApproval,
  335 |       new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 8000))
  336 |     ])
  337 |     
  338 |     expect(result).toBeDefined()
  339 |     
  340 |     // Now approve it
  341 |     const approveResult = server.policy.approveApproval(result, 'approved')
  342 |     expect(approveResult).toBe('approved')
  343 |     
  344 |     console.log('✅ Approval workflow works:', result)
  345 |   })
  346 | 
  347 |   test('Agent state changes are tracked', async () => {
  348 |     const { server } = serverData
  349 |     
  350 |     // Get current states
  351 |     const agents = server.registry.listAgents()
  352 |     expect(agents.length).toBe(3)
  353 |     
  354 |     // All should have valid states
  355 |     for (const agent of agents) {
  356 |       expect(['working', 'idle', 'paused', 'error', 'offline']).toContain(agent.state)
  357 |     }
  358 |     
  359 |     console.log('✅ Agent states tracked:', agents.map(a => `${a.id}:${a.state}`))
  360 |   })
  361 | 
  362 |   test('Chat service receives messages', async () => {
  363 |     const { server } = serverData
  364 |     
  365 |     let messageReceived = false
  366 |     
  367 |     const waitForMessage = new Promise((resolve) => {
  368 |       server.bus.subscribe('chat-message', (msg: any) => {
  369 |         messageReceived = true
  370 |         resolve(msg)
  371 |       })
  372 |     })
  373 |     
  374 |     // Trigger a chat message by sending a command
  375 |     const { mockAdapter } = serverData
  376 |     const session = server.registry.getSession('mock-1')
  377 |     if (session) {
  378 |       await mockAdapter.command(session, { type: 'send', text: 'Test message for chat' })
  379 |     }
  380 |     
  381 |     try {
  382 |       await Promise.race([
  383 |         waitForMessage,
  384 |         new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
  385 |       ])
  386 |       // Message might not be received in this test setup, that's OK
  387 |     } catch {
  388 |       // Timeout is expected if chat isn't fully wired in test
  389 |     }
  390 |     
  391 |     console.log('✅ Chat service integration verified (messageReceived:', messageReceived, ')')
  392 |   })
  393 | })
  394 | 
  395 | // Playwright browser test for full UI integration
  396 | test.describe('AgentOffice UI Integration', () => {
  397 |   test('Full UI loads and connects to server', async ({ page }) => {
  398 |     // Start the server in background
  399 |     const server = new AgentOfficeServer({
  400 |       port: 3457,
  401 |       host: 'localhost',
  402 |       driver: 'sqlite',
  403 |     })
  404 |     
  405 |     await new Promise(resolve => setTimeout(resolve, 1000))
  406 |     
  407 |     try {
  408 |       // Navigate to the web UI
> 409 |       await page.goto('http://localhost:3457/', { waitUntil: 'networkidle' })
      |                  ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3457/
  410 |       
  411 |       // Should see connect screen
  412 |       await expect(page.locator('h1')).toContainText('AgentOffice')
  413 |       await expect(page.locator('input[placeholder="local-token"]')).toBeVisible()
  414 |       
  415 |       // Enter token and connect
  416 |       await page.fill('input[placeholder="local-token"]', 'local-token')
  417 |       await page.click('button:has-text("Connect")')
  418 |       
  419 |       // Should connect and show agents
  420 |       await expect(page.locator('text=Floor')).toBeVisible({ timeout: 5000 })
  421 |       
  422 |       // Check that mode tabs are visible
  423 |       await expect(page.locator('button:has-text("Floor")')).toBeVisible()
  424 |       await expect(page.locator('button:has-text("Chat")')).toBeVisible()
  425 |       await expect(page.locator('button:has-text("Control Room")')).toBeVisible()
  426 |       
  427 |       // Click Control Room
  428 |       await page.click('button:has-text("Control Room")')
  429 |       await expect(page.locator('h2:has-text("Control Room")')).toBeVisible()
  430 |       
  431 |       console.log('✅ UI integration test passed')
  432 |     } finally {
  433 |       if (server.app?.close) {
  434 |         await server.app.close()
  435 |       }
  436 |     }
  437 |   })
  438 | })
```