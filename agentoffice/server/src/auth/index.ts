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
  createdAt: string
}

export interface TokenInfo {
  operatorId: string
  permissions: string[]
  expiresAt: string | null
  createdAt: string
}

export class OperatorAuth {
  private store: StateStore
  private currentToken: OperatorToken | null = null
  private setupComplete = false

  constructor(store: StateStore) {
    this.store = store
  }

  /** Check if initial setup has been completed. */
  async isSetupComplete(): Promise<boolean> {
    if (this.setupComplete) return true
    const token = await this.store.auth.getToken()
    this.setupComplete = !!token
    return this.setupComplete
  }

  /** Perform initial setup with a known token (should only be called once). */
  async performInitialSetup(token: string, operatorId: string = 'local'): Promise<void> {
    if (await this.isSetupComplete()) {
      throw new Error('Initial setup already completed')
    }
    await this.store.auth.saveToken(token, {
      operatorId,
      permissions: ['control', 'read'],
      createdAt: new Date().toISOString(),
      expiresAt: null,
    })
    this.currentToken = {
      token,
      operatorId,
      permissions: new Set(['control', 'read']),
      expiresAt: null,
      createdAt: new Date().toISOString(),
    }
    this.setupComplete = true
  }

  /** Validate a token string (called from WebSocket handshake). */
  async validateToken(token: string): Promise<boolean> {
    if (!token || token.length === 0) {
      return false
    }

    // Check if setup is complete
    if (!(await this.isSetupComplete())) {
      // No token set yet - reject in production, allow in dev only if explicitly configured
      if (process.env.NODE_ENV !== 'development') {
        return false
      }
      // Development: allow but warn
      console.warn('WARNING: No operator token configured. Using development fallback.')
      await this.performInitialSetup(token, 'local-dev')
      return true
    }

    // Check if it matches the stored operator token
    const stored = await this.store.auth.getToken()
    const valid = stored === token

    if (valid) {
      const tokenInfo = await this.store.auth.getTokenInfo?.(token)
      const perms = tokenInfo?.permissions ?? ['control', 'read']
      this.currentToken = {
        token: stored,
        operatorId: tokenInfo?.operatorId ?? 'local',
        permissions: new Set(perms) as ReadonlySet<'control' | 'read' | 'admin'>,
        expiresAt: tokenInfo?.expiresAt ?? null,
        createdAt: tokenInfo?.createdAt ?? new Date().toISOString(),
      }
    }
    return valid
  }

  /** Get token info for authenticated socket. */
  async getTokenInfo(token: string): Promise<TokenInfo | null> {
    return this.store.auth.getTokenInfo?.(token) ?? null
  }

  /** Get the current operator token (if any). */
  getCurrentToken(): OperatorToken | null {
    return this.currentToken
  }

  /** Check if current operator has a specific permission. */
  hasPermission(perm: 'control' | 'read' | 'admin'): boolean {
    return this.currentToken?.permissions.has(perm) || false
  }

  /** Revoke a token. */
  async revokeToken(token: string): Promise<void> {
    await this.store.auth.revokeToken?.(token)
    if (this.currentToken?.token === token) {
      this.currentToken = null
    }
  }

  /** Rotate token - generate new token, revoke old. */
  async rotateToken(): Promise<string> {
    const newToken = `op-${Date.now()}-${Math.random().toString(36).slice(2, 16)}`
    const oldToken = this.currentToken?.token
    const operatorId = this.currentToken?.operatorId ?? 'local'
    const permissions = this.currentToken?.permissions ?? new Set(['control', 'read'])

    await this.store.auth.saveToken(newToken, {
      operatorId,
      permissions: Array.from(permissions),
      createdAt: new Date().toISOString(),
      expiresAt: null,
    })

    if (oldToken) {
      await this.revokeToken(oldToken)
    }

    this.currentToken = {
      token: newToken,
      operatorId,
      permissions,
      expiresAt: null,
      createdAt: new Date().toISOString(),
    }

    return newToken
  }
}