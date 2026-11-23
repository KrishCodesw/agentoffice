/**
 * Policy types - Approvals, permissions, budgets.
 * These are part of the core contract.
 */

export interface Approval {
  id: string
  action: string
  risk: 'low' | 'medium' | 'high'
  requestedBy: string
  expiresAt: string
  status: 'pending' | 'approved' | 'denied' | 'expired'
  context: Record<string, unknown>
}

export interface PolicyConfig {
  approvalTimeout: number
  hourlyBudgetUsd: number
  requireApprovalForShell: boolean
  requireApprovalForNetwork: boolean
}