/**
 * SQLite Store - Real persistence using better-sqlite3
 *
 * Implements the StateStore interface with SQLite database.
 * Uses WAL mode for better concurrency.
 */

import Database from 'better-sqlite3'
import type { AuditEntry } from '../audit'
import path from 'path'
import { fileURLToPath } from 'url'
import type { StateStore } from './index'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export class SqliteStore implements StateStore {
  private db: Database.Database

  constructor(private usePostgres: boolean = false) {
    if (usePostgres) {
      console.warn('Postgres store requested but SQLite implemented as default. Use PostgreSQL later.')
    }

    // Database file in project root
    const dbPath = path.resolve(__dirname, '../../../agentoffice.db')
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.init()
  }

  async init(): Promise<void> {
    this.createTables()
    console.log('SQLite store initialized at agentoffice.db')
  }

  private createTables(): void {
    this.db.exec(`
      -- Audit log entries
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        action TEXT NOT NULL,
        agent_id TEXT,
        details TEXT NOT NULL, -- JSON
        result TEXT NOT NULL,
        session_id TEXT
      );

      -- Agent sessions
      CREATE TABLE IF NOT EXISTS sessions (
        agent_id TEXT PRIMARY KEY,
        handle TEXT NOT NULL, -- JSON
        updated_at TEXT NOT NULL
      );

      -- Tasks
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        assigned_to TEXT,
        progress INTEGER DEFAULT 0,
        artifacts TEXT NOT NULL, -- JSON array
        budget_usd REAL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- Operator auth tokens
      CREATE TABLE IF NOT EXISTS auth_tokens (
        token TEXT PRIMARY KEY,
        operator_info TEXT NOT NULL, -- JSON
        created_at TEXT NOT NULL,
        expires_at TEXT
      );

      -- Agents registry
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT,
        capabilities TEXT NOT NULL, -- JSON array
        state TEXT NOT NULL,
        label TEXT,
        registered_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- Approvals
      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        action_hash TEXT NOT NULL,
        risk TEXT NOT NULL,
        requested_by TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        status TEXT NOT NULL, -- 'pending' | 'approved' | 'denied' | 'expired'
        context TEXT NOT NULL, -- JSON
        created_at TEXT NOT NULL,
        decided_at TEXT,
        decided_by TEXT
      );

      -- Agents registry
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT,
        capabilities TEXT NOT NULL, -- JSON array
        state TEXT NOT NULL,
        label TEXT,
        registered_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_log(agent_id);
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to);
      CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
      CREATE INDEX IF NOT EXISTS idx_approvals_expires ON approvals(expires_at);
    `)
  }

  // Audit log operations
  audit = {
    log: async (entry: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<AuditEntry> => {
      const newEntry: AuditEntry = {
        id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        timestamp: new Date().toISOString(),
        ...entry,
      }

      this.db.prepare(`
        INSERT INTO audit_log (id, timestamp, action, agent_id, details, result, session_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        newEntry.id,
        newEntry.timestamp,
        newEntry.action,
        newEntry.agentId,
        JSON.stringify(newEntry.details),
        newEntry.result,
        newEntry.sessionId
      )

      return newEntry
    },

    getEntries: async (): Promise<AuditEntry[]> => {
      const rows = this.db.prepare('SELECT * FROM audit_log ORDER BY timestamp DESC').all() as any[]
      return rows.map(row => ({
        ...row,
        details: JSON.parse(row.details),
      }))
    },

    exportJson: async (): Promise<string> => {
      const entries = await this.audit.getEntries()
      return JSON.stringify(entries, null, 2)
    },
  }

  // Session operations
  sessions = {
    save: async (handle: { agentId: string; handle: any }): Promise<void> => {
      this.db.prepare(`
        INSERT OR REPLACE INTO sessions (agent_id, handle, updated_at)
        VALUES (?, ?, ?)
      `).run(handle.agentId, JSON.stringify(handle.handle), new Date().toISOString())
    },

    get: async (agentId: string): Promise<any | null> => {
      const row = this.db.prepare('SELECT handle FROM sessions WHERE agent_id = ?').get(agentId) as any
      return row ? JSON.parse(row.handle) : null
    },

    delete: async (agentId: string): Promise<void> => {
      this.db.prepare('DELETE FROM sessions WHERE agent_id = ?').run(agentId)
    },

    list: async (): Promise<Array<{ agentId: string; handle: any }>> => {
      const rows = this.db.prepare('SELECT agent_id, handle FROM sessions').all() as any[]
      return rows.map(row => ({ agentId: row.agent_id, handle: JSON.parse(row.handle) }))
    },
  }

  // Task operations
  tasks = {
    save: async (task: any): Promise<void> => {
      this.db.prepare(`
        INSERT OR REPLACE INTO tasks (id, description, assigned_to, progress, artifacts, budget_usd, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        task.id,
        task.description,
        task.assignedTo,
        task.progress,
        JSON.stringify(task.artifacts),
        task.budgetUsd,
        task.createdAt,
        new Date().toISOString()
      )
    },

    get: async (taskId: string): Promise<any | null> => {
      const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any
      if (!row) return null
      return {
        ...row,
        artifacts: JSON.parse(row.artifacts),
        assignedTo: row.assigned_to,
        budgetUsd: row.budget_usd,
        createdAt: row.created_at,
      }
    },

    list: async (): Promise<any[]> => {
      const rows = this.db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all() as any[]
      return rows.map(row => ({
        ...row,
        artifacts: JSON.parse(row.artifacts),
        assignedTo: row.assigned_to,
        budgetUsd: row.budget_usd,
        createdAt: row.created_at,
      }))
    },
  }

  // Auth operations
  auth = {
    saveToken: async (token: string, operatorInfo: Record<string, unknown>): Promise<void> => {
      this.db.prepare(`
        INSERT OR REPLACE INTO auth_tokens (token, operator_info, created_at, expires_at)
        VALUES (?, ?, ?, ?)
      `).run(token, JSON.stringify(operatorInfo), new Date().toISOString(), operatorInfo.expiresAt ?? null)
    },

    getToken: async (): Promise<string | null> => {
      const row = this.db.prepare('SELECT token FROM auth_tokens ORDER BY created_at DESC LIMIT 1').get() as any
      return row?.token || null
    },

    validate: async (token: string): Promise<boolean> => {
      const row = this.db.prepare('SELECT token FROM auth_tokens WHERE token = ?').get(token) as any
      return !!row
    },

    getTokenInfo: async (token: string): Promise<{ operatorId: string; permissions: string[]; expiresAt: string | null; createdAt: string } | null> => {
      const row = this.db.prepare('SELECT operator_info, created_at, expires_at FROM auth_tokens WHERE token = ?').get(token) as any
      if (!row) return null
      const info = JSON.parse(row.operator_info)
      return {
        operatorId: info.operatorId,
        permissions: info.permissions,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
      }
    },

    revokeToken: async (token: string): Promise<void> => {
      this.db.prepare('DELETE FROM auth_tokens WHERE token = ?').run(token)
    },
  }

  // Additional: Agent registry persistence
  agents = {
    save: async (agent: { id: string; name: string; capabilities: string[]; state: string; label?: string }): Promise<void> => {
      this.db.prepare(`
        INSERT OR REPLACE INTO agents (id, name, capabilities, state, label, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(agent.id, agent.name, JSON.stringify(agent.capabilities), agent.state, agent.label, new Date().toISOString())
    },

    get: async (agentId: string): Promise<any | null> => {
      const row = this.db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as any
      if (!row) return null
      return {
        ...row,
        capabilities: JSON.parse(row.capabilities),
      }
    },

    list: async (): Promise<any[]> => {
      const rows = this.db.prepare('SELECT * FROM agents').all() as any[]
      return rows.map(row => ({
        ...row,
        capabilities: JSON.parse(row.capabilities),
      }))
    },

    delete: async (agentId: string): Promise<void> => {
      this.db.prepare('DELETE FROM agents WHERE id = ?').run(agentId)
    },
  }

  // Approvals persistence
  approvals = {
    save: async (approval: any): Promise<void> => {
      this.db.prepare(`
        INSERT OR REPLACE INTO approvals (id, action, action_hash, risk, requested_by, expires_at, status, context, created_at, decided_at, decided_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        approval.id,
        approval.action,
        approval.actionHash,
        approval.risk,
        approval.requestedBy,
        approval.expiresAt,
        approval.status,
        JSON.stringify(approval.context),
        approval.createdAt,
        approval.decidedAt ?? null,
        approval.decidedBy ?? null
      )
    },

    get: async (approvalId: string): Promise<any | null> => {
      const row = this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(approvalId) as any
      if (!row) return null
      return {
        ...row,
        context: typeof row.context === 'string' ? JSON.parse(row.context) : row.context,
      }
    },

    listByStatus: async (status: string): Promise<any[]> => {
      const rows = this.db.prepare('SELECT * FROM approvals WHERE status = ?').all(status) as any[]
      return rows.map(row => ({
        ...row,
        context: typeof row.context === 'string' ? JSON.parse(row.context) : row.context,
      }))
    },

    updateStatus: async (approvalId: string, status: string, decidedAt: string, decidedBy: string): Promise<void> => {
      this.db.prepare(`
        UPDATE approvals SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?
      `).run(status, decidedAt, decidedBy, approvalId)
    },

    listPending: async (): Promise<any[]> => {
      const rows = this.db.prepare('SELECT * FROM approvals WHERE status = ?').all('pending') as any[]
      return rows.map(row => ({
        ...row,
        context: typeof row.context === 'string' ? JSON.parse(row.context) : row.context,
      }))
    },
  }

  close(): void {
    this.db.close()
  }
}