/**
 * Policy Engine - Approvals, permission tiers, budgets.
 *
 * Responsibilities:
 * - Default-deny: risky actions need approval (shell, writes outside working folder, network)
 * - Budget tracking per agent (input/output tokens, cost in USD)
 * - Approval queue: pending approvals waiting for operator decision
 * - Approval expiration: approvals expire after a timeout
 * - Permission tiers: what each capability level allows
 *
 * Layering: depends on core only (AgentEvent, Command, Capability types)
 */

import type { AgentEvent, Command, Capability, SessionHandle } from '@agentoffice/core'
import { SqliteStore } from '../store'

export interface Approval {
  id: string
  action: string
  actionHash: string // Hash of action + context to prevent tampering
  risk: 'low' | 'medium' | 'high'
  requestedBy: string // agentId or 'operator'
  expiresAt: string
  status: 'pending' | 'approved' | 'denied' | 'expired'
  context: Record<string, unknown> // additional context (what tool, what folder, etc.)
  createdAt: string
  decidedAt: string | null
  decidedBy: string | null
}

export interface ApprovalConfig {
  /** Default timeout for approvals in milliseconds (5 minutes default) */
  approvalTimeout: number
  /** Budget limit per agent per hour in USD */
  hourlyBudgetUsd: number
  /** Whether shell commands require approval */
  requireApprovalForShell: boolean
  /** Whether network operations require approval */
  requireApprovalForNetwork: boolean
}

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired'
export type ApprovalDecision = 'approve' | 'deny'

export interface ApprovalResult {
  approvalId: string
  status: ApprovalStatus
  previousStatus: ApprovalStatus
  decidedAt: string
  decidedBy: string
}

export class PolicyEngine {
  private approvals: Map<string, Approval> = new Map()
  private config: ApprovalConfig
  private budgets: Map<string, { used: number; resetAt: Date }> = new Map()
  private store: SqliteStore | null = null

  constructor(config: ApprovalConfig = {} as ApprovalConfig) {
    this.config = config
  }

  /** Set the store for persistent approval storage. */
  setStore(store: SqliteStore): void {
    this.store = store
    this.loadApprovalsFromStore()
  }

  /** Get default policy configuration. */
  static getDefaultConfig(): ApprovalConfig {
    return {
      approvalTimeout: 5 * 60 * 1000, // 5 minutes
      hourlyBudgetUsd: 0.10, // $0.10 per hour default
      requireApprovalForShell: true,
      requireApprovalForNetwork: true,
    }
  }

  /** Load approvals from persistent storage on startup. */
  private async loadApprovalsFromStore(): Promise<void> {
    if (!this.store) return
    try {
      const rows = await this.store.approvals.listPending()
      for (const row of rows) {
        const approval: Approval = {
          ...row,
          context: JSON.parse(row.context),
        }
        // Check if already expired
        if (new Date(approval.expiresAt) < new Date()) {
          approval.status = 'expired'
          this.updateApprovalInStore(approval)
        } else {
          this.approvals.set(approval.id, approval)
        }
      }
    } catch (err) {
      console.warn('Could not load approvals from store:', err)
    }
  }

  /** Compute hash of action + context to bind approval to exact operation. */
  private computeActionHash(action: string, context: Record<string, unknown>): string {
    const str = JSON.stringify({ action, context }, Object.keys({ action, context }).sort())
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i)
      hash |= 0
    }
    return Math.abs(hash).toString(36)
  }

  /** Create a new pending approval. Returns the approvalId.
   * Server owns the approval ID - agent provides request, server generates ID. */
  createApproval(approval: Omit<Approval, 'id' | 'expiresAt' | 'status' | 'createdAt' | 'actionHash' | 'decidedAt' | 'decidedBy'>): string {
    const id = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const timeout = this.config.approvalTimeout ?? PolicyEngine.getDefaultConfig().approvalTimeout
    const expiresAt = new Date(Date.now() + timeout).toISOString()
    const createdAt = new Date().toISOString()
    const actionHash = this.computeActionHash(approval.action, approval.context)

    const newApproval: Approval = {
      id,
      action: approval.action,
      actionHash,
      risk: approval.risk,
      requestedBy: approval.requestedBy,
      expiresAt,
      status: 'pending',
      context: approval.context,
      createdAt,
      decidedAt: null,
      decidedBy: null,
    }

    this.approvals.set(id, newApproval)
    this.saveApprovalToStore(newApproval)
    return id
  }

  /** Save approval to persistent storage. */
  private saveApprovalToStore(approval: Approval): void {
    if (!this.store) return
    try {
      this.store.approvals.save({
        id: approval.id,
        action: approval.action,
        actionHash: approval.actionHash,
        risk: approval.risk,
        requestedBy: approval.requestedBy,
        expiresAt: approval.expiresAt,
        status: approval.status,
        context: approval.context,
        createdAt: approval.createdAt,
        decidedAt: approval.decidedAt,
        decidedBy: approval.decidedBy,
      })
    } catch (err) {
      console.warn('Could not save approval to store:', err)
    }
  }

  /** Update approval in persistent storage. */
  private updateApprovalInStore(approval: Approval): void {
    if (!this.store) return
    try {
      this.store.approvals.updateStatus(approval.id, approval.status, approval.decidedAt ?? '', approval.decidedBy ?? '')
    } catch (err) {
      console.warn('Could not update approval in store:', err)
    }
  }

  /** Get a pending approval by ID. */
  async getPendingApproval(approvalId: string): Promise<Approval | undefined> {
    // Check memory first
    const cached = this.approvals.get(approvalId)
    if (cached) return cached

    // Check store
    if (this.store) {
      try {
        const row = await this.store.approvals.get(approvalId)
        if (row) {
          const approval: Approval = {
            ...row,
            context: JSON.parse(row.context),
          }
          this.approvals.set(approval.id, approval)
          return approval
        }
      } catch (err) {
        console.warn('Could not load approval from store:', err)
      }
    }
    return undefined
  }

  /** Approve or deny an approval with strict state machine. */
  async approveApproval(approvalId: string, decision: ApprovalDecision, decidedBy: string): Promise<ApprovalResult> {
    const approval = await this.getPendingApproval(approvalId)
    if (!approval) {
      throw new Error(`Approval not found: ${approvalId}`)
    }

    // Check expiry BEFORE allowing decision
    if (new Date(approval.expiresAt) < new Date()) {
      approval.status = 'expired'
      approval.decidedAt = new Date().toISOString()
      approval.decidedBy = 'system'
      this.approvals.set(approval.id, approval)
      this.updateApprovalInStore(approval)
      throw new Error(`Approval expired: ${approvalId}`)
    }

    // Strict state machine: only pending can be decided
    if (approval.status !== 'pending') {
      throw new Error(`Invalid state transition: cannot ${decision} approval with status ${approval.status}`)
    }

    const newStatus = decision === 'approve' ? 'approved' : 'denied'
    const previousStatus = approval.status
    const decidedAt = new Date().toISOString()

    approval.status = newStatus
    approval.decidedAt = decidedAt
    approval.decidedBy = decidedBy

    this.approvals.set(approval.id, approval)
    this.updateApprovalInStore(approval)

    return {
      approvalId: approval.id,
      status: newStatus,
      previousStatus,
      decidedAt,
      decidedBy,
    }
  }

  /** Check if an approval is still valid (not expired, not decided). */
  async isApprovalValid(approvalId: string): Promise<boolean> {
    const approval = await this.getPendingApproval(approvalId)
    if (!approval) return false
    if (approval.status !== 'pending') return false
    if (new Date(approval.expiresAt) < new Date()) return false
    return true
  }

  /** Clean up expired approvals. */
  cleanupExpiredApprovals(): number {
    let count = 0
    for (const [id, approval] of this.approvals) {
      if (approval.status === 'pending' && new Date(approval.expiresAt) < new Date()) {
        approval.status = 'expired'
        approval.decidedAt = new Date().toISOString()
        approval.decidedBy = 'system'
        this.approvals.set(id, approval)
        this.updateApprovalInStore(approval)
        count++
      }
    }
    return count
  }

  /** Check if an agent has exceeded its budget. */
  checkBudget(agentId: string, costUsd: number): { withinBudget: boolean; newUsed: number } {
    if (!Number.isFinite(costUsd) || costUsd < 0) {
      throw new Error('Invalid cost value: must be finite non-negative number')
    }

    let record = this.budgets.get(agentId)
    if (!record) {
      record = { used: 0, resetAt: new Date(Date.now() + 3600000) }
      this.budgets.set(agentId, record)
    }

    const now = new Date()
    if (now > record.resetAt) {
      record.used = 0
      record.resetAt = new Date(Date.now() + 3600000)
    }

    const newUsed = record.used + costUsd
    const withinBudget = newUsed <= (this.config.hourlyBudgetUsd ?? PolicyEngine.getDefaultConfig().hourlyBudgetUsd)

    record.used = newUsed
    return { withinBudget, newUsed }
  }

  /** Record usage tokens for an agent and check budget. */
  recordUsage(agentId: string, inputTokens: number, outputTokens: number, costUsd: number): {
    withinBudget: boolean
    totalCostUsd: number
    remainingBudgetUsd: number
  } {
    if (!Number.isFinite(costUsd) || costUsd < 0) {
      throw new Error('Invalid cost value: must be finite non-negative number')
    }

    const tokenCostUsd = costUsd ?? this._estimateCost(inputTokens, outputTokens)

    const { withinBudget, newUsed } = this.checkBudget(agentId, tokenCostUsd)

    return {
      withinBudget,
      totalCostUsd: newUsed,
      remainingBudgetUsd: (this.config.hourlyBudgetUsd ?? PolicyEngine.getDefaultConfig().hourlyBudgetUsd) - newUsed,
    }
  }

  private _estimateCost(inputTokens: number, outputTokens: number): number {
    const inputCost = (inputTokens / 1000) * 0.002
    const outputCost = (outputTokens / 1000) * 0.008
    return inputCost + outputCost
  }

  /** Get all pending approvals. */
  getPendingApprovals(): Approval[] {
    return Array.from(this.approvals.values()).filter(a => a.status === 'pending')
  }

  /** Get approval by ID (any status). */
  async getApproval(approvalId: string): Promise<Approval | undefined> {
    return this.getPendingApproval(approvalId)
  }
}