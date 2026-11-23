/**
 * Operator Auth - Token-based auth for local use, OAuth later.
 *
 * Responsibilities:
 * - Operator token for local use (npx agentoffice)
 * - OAuth for hosted mode (future)
 * - Token validation on WebSocket connections
 * - Token never logged (audit-safe)
 *
 * Layering: depends on core only
 */

import type { StateStore } from '../store'

export interface OperatorToken {
  token: string
  operatorId: string
  permissions: ReadonlySet<'control' | 'read' | 'admin'>
  expiresAt: string | null
}

export class OperatorAuth {
  private store: StateStore
  private currentToken: OperatorToken | null = null

  constructor(store: StateStore) {
    this.store = store
  }

  /** Validate a token string (called from WebSocket handshake). */
  async validateToken(token: string): Promise<boolean> {
    if (!token || token.length === 0) {
      return false
    }

    // Check if it matches the stored operator token
    const stored = await this.store.auth.getToken()
    if (!stored) {
      // No token set yet - accept any non-empty token for local dev
      // In production, this would be more strict
      this.currentToken = { token, operatorId: 'local', permissions: new Set(['control', 'read']), expiresAt: null }
      await this.store.auth.saveToken(token, { operatorId: 'local' })
      return true
    }

    const valid = stored === token
    if (valid) {
      this.currentToken = { token: stored, operatorId: 'local', permissions: new Set(['control', 'read']), expiresAt: null }
    }
    return valid
  }

  /** Get the current operator token (if any). */
  getCurrentToken(): OperatorToken | null {
    return this.currentToken
  }

  /** Check if current operator has a specific permission. */
  hasPermission(perm: 'control' | 'read' | 'admin'): boolean {
    return this.currentToken?.permissions.has(perm) || false
  }
}