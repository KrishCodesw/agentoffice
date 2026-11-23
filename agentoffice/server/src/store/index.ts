/**
 * StateStore interface + SQLite implementation.
 *
 * Responsibilities:
 * - Persistence behind the StateStore interface
 * - SQLite by default (zero setup for npx agentoffice)
 * - Postgres later for hosted mode
 * - Same interface so the rest of the server doesn't care about the backend
 *
 * Layering: depends on core only (for the types being stored)
 */

import type { AuditEntry } from '../audit'
import { SqliteStore } from './sqlite-store'

export interface StateStore {
  /** Initialize the store (create tables, etc.). */
  init: () => Promise<void>

  /** Audit log operations */
  audit: {
    /** Write a new entry. */
    log: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => Promise<AuditEntry>
    /** Get all entries. */
    getEntries: () => Promise<AuditEntry[]>
    /** Export all entries as JSON. */
    exportJson: () => Promise<string>
  }

  /** Agent session tracking */
  sessions: {
    /** Save a session handle. */
    save: (handle: { agentId: string; handle: any }) => Promise<void>
    /** Get a session handle. */
    get: (agentId: string) => Promise<any | null>
    /** Delete a session handle. */
    delete: (agentId: string) => Promise<void>
    /** List all sessions. */
    list: () => Promise<Array<{ agentId: string; handle: any }>>
  }

  /** Task tracking */
  tasks: {
    /** Save a task. */
    save: (task: any) => Promise<void>
    /** Get a task. */
    get: (taskId: string) => Promise<any | null>
    /** List all tasks. */
    list: () => Promise<any[]>
  }

  /** Operator token storage */
  auth: {
    /** Save an operator token. */
    saveToken: (token: string, operatorInfo: Record<string, unknown>) => Promise<void>
    /** Get an operator token. */
    getToken: () => Promise<string | null>
    /** Validate a token. */
    validate: (token: string) => Promise<boolean>
    /** Get token info for authenticated socket. */
    getTokenInfo: (token: string) => Promise<{ operatorId: string; permissions: string[]; expiresAt: string | null; createdAt: string } | null>
    /** Revoke a token. */
    revokeToken: (token: string) => Promise<void>
  }

  /** Agent registry */
  agents: {
    /** Save an agent. */
    save: (agent: { id: string; name: string; capabilities: string[]; state: string; label?: string }) => Promise<void>
    /** Get an agent. */
    get: (agentId: string) => Promise<any | null>
    /** List all agents. */
    list: () => Promise<any[]>
    /** Delete an agent. */
    delete: (agentId: string) => Promise<void>
  }

  /** Approvals persistence */
  approvals: {
    /** Save an approval. */
    save: (approval: any) => Promise<void>
    /** Get an approval by ID. */
    get: (approvalId: string) => Promise<any | null>
    /** List approvals by status. */
    listByStatus: (status: string) => Promise<any[]>
    /** Update approval status. */
    updateStatus: (approvalId: string, status: string, decidedAt: string, decidedBy: string) => Promise<void>
    /** List pending approvals. */
    listPending: () => Promise<any[]>
  }
}

export { SqliteStore }