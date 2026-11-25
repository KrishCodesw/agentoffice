/**
 * AgentOffice Adapter Conformance Suite v1
 *
 * Every adapter must pass this suite before being approved for production use.
 *
 * Tests:
 *  1. Start - connect() returns a valid SessionHandle
 *  2. Ordered events - events() yields events in order with proper types
 *  3. Idempotent stop - stop command is idempotent
 *  4. Reconnect - close() then connect() works
 *  5. Approval round trip - needs_approval → approve/deny → state change
 *
 * Usage:
 *   npx vitest run sdk/conformance.test.ts
 */

import { describe, test, expect } from 'vitest'
import type { AgentAdapter, SessionHandle, AgentEvent, Command, CommandResult } from '@agentoffice/core'
import { MockAdapter } from '../adapters/mock/mock-agent'

/**
 * Runs the conformance suite against a given adapter factory.
 * The factory should return a new adapter instance each time it's called.
 */
export async function runConformanceSuite(
  adapterFactory: () => AgentAdapter,
  agentId: string = 'conformance-test',
): Promise<void> {
  describe(`Adapter conformance: ${agentId}`, () => {
    test('1. Start - connect() returns a valid SessionHandle', async () => {
      const adapter = adapterFactory()
      const handle = await adapter.connect({
        agentId,
        name: 'Conformance Test Agent',
      })

      // Session handle must have required fields
      expect(handle.id).toBe(agentId)
      expect(handle.label).toBeDefined()
      expect(handle.capabilities).toBeInstanceOf(Set)
      expect(['working', 'idle', 'paused', 'error', 'offline']).toContain(handle.state)

      // Adapter must expose id and capabilities
      expect(adapter.id).toBeDefined()
      expect(adapter.capabilities).toBeInstanceOf(Set)

      await adapter.close(handle)
    })

    test('2. Ordered events - events() yields events in order', async () => {
      const adapter = adapterFactory()
      const handle = await adapter.connect({
        agentId,
        name: 'Conformance Test Agent',
      })

      const events: AgentEvent[] = []
      const eventIterator = adapter.events(handle)

      // Collect up to 5 events
      let count = 0
      for await (const event of eventIterator) {
        events.push(event)
        count++
        if (count >= 5) break
      }

      // Should have received at least one event
      expect(events.length).toBeGreaterThan(0)

      // Each event must have a valid type
      for (const event of events) {
        expect([
          'status', 'output', 'tool_call', 'needs_approval', 'usage', 'handoff',
        ]).toContain(event.type)

        // Status events must have a valid state
        if (event.type === 'status') {
          expect([
            'working', 'idle', 'paused', 'error', 'offline',
          ]).toContain(event.state)
        }

        // Needs approval events must have required fields
        if (event.type === 'needs_approval') {
          expect(event.approvalId).toBeDefined()
          expect(event.action).toBeDefined()
          expect(['low', 'medium', 'high']).toContain(event.risk)
        }

        // Usage events must have numeric fields
        if (event.type === 'usage') {
          expect(typeof event.inputTokens).toBe('number')
          expect(typeof event.outputTokens).toBe('number')
          expect(typeof event.costUsd).toBe('number')
        }
      }

      await adapter.close(handle)
    })

    test('3. Idempotent stop - stop command is idempotent', async () => {
      const adapter = adapterFactory()
      const handle = await adapter.connect({
        agentId,
        name: 'Conformance Test Agent',
      })

      // First stop
      const result1 = await adapter.command(handle, { type: 'stop' })
      expect(result1).toBe('accepted')
      expect(handle.state).toBe('offline')

      // Second stop - should still be accepted (idempotent)
      const result2 = await adapter.command(handle, { type: 'stop' })
      expect(result2).toBe('accepted')
      expect(handle.state).toBe('offline')

      await adapter.close(handle)
    })

    test('4. Reconnect - close() then connect() works', async () => {
      const adapter = adapterFactory()

      // First connection
      const handle1 = await adapter.connect({
        agentId,
        name: 'Conformance Test Agent',
      })
      expect(handle1.state).toBe('working')

      await adapter.close(handle1)

      // Second connection - should work
      const handle2 = await adapter.connect({
        agentId,
        name: 'Conformance Test Agent',
      })
      expect(handle2.id).toBe(agentId)
      expect(handle2.state).toBe('working')

      await adapter.close(handle2)
    })

    test('5. Approval round trip - needs_approval → approve/deny → state change', async () => {
      const adapter = adapterFactory()
      const handle = await adapter.connect({
        agentId,
        name: 'Conformance Test Agent',
        options: { shouldNeedApproval: true },
      })

      // Collect events until we find a needs_approval event
      let approvalEvent: AgentEvent | null = null
      const eventIterator = adapter.events(handle)

      for await (const event of eventIterator) {
        if (event.type === 'needs_approval') {
          approvalEvent = event
          break
        }
      }

      // If the adapter supports approvals, test the round trip
      if (approvalEvent && approvalEvent.type === 'needs_approval') {
        const { approvalId } = approvalEvent

        // Approve
        const approveResult = await adapter.command(handle, { type: 'approve', approvalId })
        expect(approveResult).toBe('accepted')

        // Verify state changed back to working
        expect(handle.state).toBe('working')

        // Reconnect to test deny path
        await adapter.close(handle)
        const handle2 = await adapter.connect({
          agentId,
          name: 'Conformance Test Agent',
          options: { shouldNeedApproval: true },
        })

        // Collect events until needs_approval again
        let approvalEvent2: AgentEvent | null = null
        const eventIterator2 = adapter.events(handle2)

        for await (const event of eventIterator2) {
          if (event.type === 'needs_approval') {
            approvalEvent2 = event
            break
          }
        }

        if (approvalEvent2 && approvalEvent2.type === 'needs_approval') {
          // Deny
          const denyResult = await adapter.command(handle2, { type: 'deny', approvalId: approvalEvent2.approvalId })
          expect(denyResult).toBe('accepted')
          expect(handle2.state).toBe('error')
        }

        await adapter.close(handle2)
      } else {
        // Adapter doesn't emit needs_approval - that's OK, just verify connect works
        expect(handle.state).toBe('working')
        await adapter.close(handle)
      }
    })
  })
}

/**
 * Default export - run conformance suite with the mock adapter.
 * This is the canonical test that every adapter should pass.
 */
describe('MockAdapter conformance', () => {
  runConformanceSuite(() => new MockAdapter({
    agentId: 'mock-conformance',
    name: 'Mock Conformance Agent',
    shouldNeedApproval: true,
    shouldError: false,
    shouldHandoff: false,
  }), 'mock-conformance')
})
