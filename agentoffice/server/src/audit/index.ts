/**
 * Audit Log - Append-only log of commands, approvals, tool calls.
 *
 * Responsibilities:
 * - Never edited: once written, entries are permanent
 * - Exportable: can be exported for compliance/analysis
 * - Includes: who initiated, what action, when, result, context
 * - Used for: security investigation, compliance, debugging, billing
 *
 * Layering: depends on core only (for the types of actions being logged)
 */

import type { Command, Approval, AgentEvent } from '@agentoffice/core'

export interface AuditEntry {
  id: string
  timestamp: string
  action: string // 'command', 'approval', 'tool_call', 'handoff', 'approval-approved', etc.
  agentId: string | null // which agent was involved, or 'operator' / 'system'
  details: Record<string, unknown> // action-specific details
  result: 'accepted' | 'rejected' | 'unsupported' | 'approved' | 'denied' | 'expired'
  sessionId: string | null // which session
}

export class AuditLog {
  private entries: AuditEntry[] = []
  private counter: number = 0

  /** Write a new audit entry (never edits existing ones). */
  log(entry: Omit<AuditEntry, 'id' | 'timestamp'>): AuditEntry {
    const newEntry: AuditEntry = {
      id: `audit-${Date.now()}-${this.counter++}`,
      timestamp: new Date().toISOString(),
      ...entry,
    }
    this.entries.push(newEntry)
    // In a real system, also write to a file or database for persistence
    // console.log('[AUDIT]', JSON.stringify(entry))
    return newEntry
  }

  /** Get all audit entries. */
  getEntries(): AuditEntry[] {
    return this.entries
  }

  /** Get entries for a specific agent. */
  getEntriesByAgent(agentId: string): AuditEntry[] {
    return this.entries.filter((e) => e.agentId === agentId || e.agentId === null)
  }

  /** Get entries of a specific action type. */
  getEntriesByAction(action: string): AuditEntry[] {
    return this.entries.filter((e) => e.action === action)
  }

  /** Export all entries as JSON (for compliance download). */
  exportJson(): string {
    return JSON.stringify(this.entries, null, 2)
  }

  /** Clear all entries (not allowed in production, but useful for testing). */
  clear(): void {
    this.entries = []
    this.counter = 0
  }
}