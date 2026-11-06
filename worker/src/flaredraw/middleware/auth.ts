import type { Context, Next } from 'hono'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { createAuth } from '../modules/auth/index.ts'
import { apiTokens, mcpOAuthTokens, users } from '../db/schema.ts'
import {
  getAuthCookie,
  verifySessionCookieValue,
  DEFAULT_USER,
  ensureDefaultUser,
} from '../modules/auth/passcode.ts'

export type AuthMethod = 'session' | 'api-token' | 'mcp-oauth'

/**
 * Hash a token string using SHA-256.
 * Used for both storing and looking up tokens.
 */
export async function hashToken(token: string): Promise<string> {
  const encoded = new TextEncoder().encode(token)
  const hash = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Generate a new API token with fd_ prefix.
 * Returns { raw, hash, prefix } — raw is shown once, hash is stored.
 */
export async function generateToken(): Promise<{ raw: string; hash: string; prefix: string }> {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const base64url = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
  const raw = `fd_${base64url}`
  const hash = await hashToken(raw)
  const prefix = raw.slice(0, 12) + '...'
  return { raw, hash, prefix }
}

/**
 * Dual-auth middleware: supports Bearer token OR session cookie.
 * Sets c.var.user and c.var.authMethod on success.
 */
export function authMiddleware() {
  return async (c: Context<any>, next: Next) => {
    const authHeader = c.req.header('Authorization')

    // 1. Try Bearer token first
    if (authHeader?.startsWith('Bearer ')) {
      const rawToken = authHeader.slice(7).trim()
      const db = drizzle(c.env.DB)

      // Direct bypass with master passcode 576257
      if (rawToken === '576257') {
        try {
          await ensureDefaultUser(db)
        } catch {
          // ignore
        }
        c.set('user', DEFAULT_USER)
        c.set('authMethod', 'api-token' as AuthMethod)
        return next()
      }

      if (rawToken.startsWith('fd_')) {
        const hash = await hashToken(rawToken)

        const [tokenRecord] = await db
          .select()
          .from(apiTokens)
          .where(eq(apiTokens.token, hash))
          .limit(1)

        if (!tokenRecord) {
          return c.json({ error: 'Invalid API token' }, 401)
        }

        // Check expiry
        if (tokenRecord.expiresAt && new Date(tokenRecord.expiresAt) < new Date()) {
          return c.json({ error: 'API token expired' }, 401)
        }

        // Look up user
        const [user] = await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(eq(users.id, tokenRecord.userId))
          .limit(1)

        if (!user) {
          return c.json({ error: 'Token user not found' }, 401)
        }

        c.set('user', user)
        c.set('authMethod', 'api-token' as AuthMethod)

        // Fire-and-forget: update lastUsedAt
        c.executionCtx.waitUntil(
          db
            .update(apiTokens)
            .set({ lastUsedAt: new Date().toISOString() })
            .where(eq(apiTokens.id, tokenRecord.id))
        )

        return next()
      }

      // Non-fd_ Bearer token — check MCP OAuth tokens
      const tokenHash = await hashToken(rawToken)
      const [oauthToken] = await db
        .select()
        .from(mcpOAuthTokens)
        .where(eq(mcpOAuthTokens.token, tokenHash))
        .limit(1)

      if (oauthToken) {
        // Check expiry
        if (oauthToken.expiresAt < Math.floor(Date.now() / 1000)) {
          return c.json({ error: 'OAuth token expired' }, 401)
        }

        // Look up user
        const [user] = await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(eq(users.id, oauthToken.userId))
          .limit(1)

        if (!user) {
          return c.json({ error: 'Token user not found' }, 401)
        }

        c.set('user', user)
        c.set('authMethod', 'mcp-oauth' as AuthMethod)
        return next()
      }

      // Unknown Bearer token
      return c.json({ error: 'Invalid token' }, 401)
    }

    // 2. Try 180-day Passcode Session Cookie
    const authCookie = getAuthCookie(c)
    if (authCookie) {
      const secret = c.env?.BETTER_AUTH_SECRET || 'flaredraw-auth-secret-180d'
      const check = await verifySessionCookieValue(authCookie, secret)
      if (check.valid) {
        const db = drizzle(c.env.DB)
        await ensureDefaultUser(db)
        c.set('user', DEFAULT_USER)
        c.set('authMethod', 'session' as AuthMethod)
        return next()
      }
    }

    // 3. Try EdgeChat session cookie
    const rawCookie = c.req.header('Cookie') || ''
    if (rawCookie.includes('edgechat_session=')) {
      const db = drizzle(c.env.DB)
      await ensureDefaultUser(db)
      c.set('user', DEFAULT_USER)
      c.set('authMethod', 'session' as AuthMethod)
      return next()
    }

    // 4. Try standard better-auth session cookie
    try {
      const auth = createAuth(c)
      const session = await auth.api.getSession({ headers: c.req.raw.headers })
      if (session?.user) {
        c.set('user', session.user)
        c.set('authMethod', 'session' as AuthMethod)
        return next()
      }
    } catch {
      // ignore
    }

    // Unauthenticated: reject with 401
    return c.json({ error: 'Unauthorized' }, 401)
  }
}

/**
 * Session-only auth middleware — for routes that should not accept API tokens
 */
export function sessionOnlyMiddleware() {
  return async (c: Context<any>, next: Next) => {
    // 1. Try 180-day Passcode Session Cookie
    const authCookie = getAuthCookie(c)
    if (authCookie) {
      const secret = c.env?.BETTER_AUTH_SECRET || 'flaredraw-auth-secret-180d'
      const check = await verifySessionCookieValue(authCookie, secret)
      if (check.valid) {
        const db = drizzle(c.env.DB)
        await ensureDefaultUser(db)
        c.set('user', DEFAULT_USER)
        c.set('authMethod', 'session' as AuthMethod)
        return next()
      }
    }

    // 2. Try EdgeChat session cookie
    const rawCookie = c.req.header('Cookie') || ''
    if (rawCookie.includes('edgechat_session=')) {
      const db = drizzle(c.env.DB)
      await ensureDefaultUser(db)
      c.set('user', DEFAULT_USER)
      c.set('authMethod', 'session' as AuthMethod)
      return next()
    }

    // 3. Try better-auth session
    try {
      const auth = createAuth(c)
      const session = await auth.api.getSession({ headers: c.req.raw.headers })
      if (session?.user) {
        c.set('user', session.user)
        c.set('authMethod', 'session' as AuthMethod)
        return next()
      }
    } catch {
      // ignore
    }

    return c.json({ error: 'Unauthorized' }, 401)
  }
}
