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

export interface Approval {
  id: string
  action: string
  risk: 'low' | 'medium' | 'high'
  requestedBy: string // agentId or 'operator'
  expiresAt: string
  status: 'pending' | 'approved' | 'denied' | 'expired'
  context: Record<string, unknown> // additional context (what tool, what folder, etc.)
}

export interface PolicyConfig {
  /** Default timeout for approvals in milliseconds (5 minutes default) */
  approvalTimeout: number
  /** Budget limit per agent per hour in USD */
  hourlyBudgetUsd: number
  /** Whether shell commands require approval */
  requireApprovalForShell: boolean
  /** Whether network operations require approval */
  requireApprovalForNetwork: boolean
}

export class PolicyEngine {
  private approvals: Map<string, Approval> = new Map()
  private config: PolicyConfig
  private budgets: Map<string, { used: number; resetAt: Date }> = new Map()

  constructor(config: PolicyConfig = {} as PolicyConfig) {
    this.config = config
  }

  /** Get default policy configuration. */
  static getDefaultConfig(): PolicyConfig {
    return {
      approvalTimeout: 5 * 60 * 1000, // 5 minutes
      hourlyBudgetUsd: 0.10, // $0.10 per hour default
      requireApprovalForShell: true,
      requireApprovalForNetwork: true,
    }
  }

  /** Create a new pending approval. Returns the approvalId. */
  createApproval(approval: Omit<Approval, 'id' | 'expiresAt' | 'status'>): string {
    const id = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const timeout = this.config.approvalTimeout ?? PolicyEngine.getDefaultConfig().approvalTimeout
    const expiresAt = new Date(Date.now() + timeout).toISOString()
    const newApproval: Approval = {
      id,
      action: approval.action,
      risk: approval.risk,
      requestedBy: approval.requestedBy,
      expiresAt,
      status: 'pending',
      context: approval.context,
    }
    this.approvals.set(id, newApproval)
    return id
  }

  /** Get a pending approval by ID. */
  getPendingApproval(approvalId: string): Approval | undefined {
    return this.approvals.get(approvalId)
  }

  /** Approve or deny an approval. Returns the new status. */
  approveApproval(approvalId: string, status: 'approved' | 'denied'): 'approved' | 'denied' | 'expired' {
    const approval = this.approvals.get(approvalId)
    if (!approval) {
      return 'expired'
    }
    approval.status = status
    return status
  }

  /** Check if an agent has exceeded its budget. */
  checkBudget(agentId: string, costUsd: number): { withinBudget: boolean; newUsed: number } {
    let record = this.budgets.get(agentId)
    if (!record) {
      record = { used: 0, resetAt: new Date(Date.now() + 3600000) } // reset in 1 hour
      this.budgets.set(agentId, record)
    }

    const now = new Date()
    if (now > record.resetAt) {
      // Reset hourly budget
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
    // Convert tokens to approximate cost
    const tokenCostUsd = costUsd ?? this._estimateCost(inputTokens, outputTokens)

    const { withinBudget, newUsed } = this.checkBudget(agentId, tokenCostUsd)

    return {
      withinBudget,
      totalCostUsd: newUsed,
      remainingBudgetUsd: (this.config.hourlyBudgetUsd ?? PolicyEngine.getDefaultConfig().hourlyBudgetUsd) - newUsed,
    }
  }

  private _estimateCost(inputTokens: number, outputTokens: number): number {
    // Rough estimate: GPT-4 pricing
    const inputCost = (inputTokens / 1000) * 0.002
    const outputCost = (outputTokens / 1000) * 0.008
    return inputCost + outputCost
  }
}