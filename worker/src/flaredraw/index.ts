import type { Hono } from 'hono'
import { cors } from 'hono/cors'
import { drizzle } from 'drizzle-orm/d1'
import { createAuth } from './modules/auth/index.ts'
import { authMiddleware, sessionOnlyMiddleware } from './middleware/auth.ts'
import { drawingRoutes } from './modules/drawings/routes.ts'
import { shareRoutes } from './modules/shares/routes.ts'
import { noteRoutes } from './modules/notes/routes.ts'
import { apiTokenRoutes } from './modules/api-tokens/routes.ts'
import { diagramRoutes } from './modules/api/routes.ts'
import { mcpRoutes } from './modules/mcp/routes.ts'
import { oauthRoutes, wellKnownRoutes } from './modules/mcp/oauth-routes.ts'
import {
  PASSCODE,
  createSessionCookieValue,
  setAuthCookie,
  clearAuthCookie,
  getAuthCookie,
  verifySessionCookieValue,
  DEFAULT_USER,
  ensureDefaultUser,
} from './modules/auth/passcode.ts'

export function registerFlareDrawRoutes(app: Hono<any>) {
  // .well-known OAuth discovery
  wellKnownRoutes(app as any)

  // Passcode verification endpoint (180-day session)
  app.post('/api/auth/verify-passcode', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const passcode = typeof body.passcode === 'string' ? body.passcode.trim() : ''

    if (passcode !== PASSCODE) {
      return c.json({ success: false, error: '密码错误，请输入正确的访问密码' }, 401)
    }

    const secret = c.env?.BETTER_AUTH_SECRET || 'flaredraw-auth-secret-180d'
    const token = await createSessionCookieValue(secret)
    setAuthCookie(c, token)

    try {
      const db = drizzle(c.env.DB)
      await ensureDefaultUser(db)
    } catch {
      // ignore
    }

    return c.json({
      success: true,
      user: DEFAULT_USER,
      expiresIn: 180 * 24 * 3600,
    })
  })

  // Session verification endpoint
  app.get('/api/auth/get-session', async (c) => {
    // 1. Check passcode cookie first
    const authCookie = getAuthCookie(c)
    if (authCookie) {
      const secret = c.env?.BETTER_AUTH_SECRET || 'flaredraw-auth-secret-180d'
      const check = await verifySessionCookieValue(authCookie, secret)
      if (check.valid) {
        try {
          const db = drizzle(c.env.DB)
          await ensureDefaultUser(db)
        } catch {
          // ignore
        }
        return c.json({
          user: {
            ...DEFAULT_USER,
            image: null,
            emailVerified: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          session: {
            id: 'passcode-session',
            userId: DEFAULT_USER.id,
            expiresAt: new Date(Date.now() + 180 * 24 * 3600 * 1000).toISOString(),
          },
        })
      }
    }

    // 2. Check EdgeChat session cookie
    const rawCookie = c.req.header('Cookie') || ''
    if (rawCookie.includes('edgechat_session=')) {
      try {
        const db = drizzle(c.env.DB)
        await ensureDefaultUser(db)
        return c.json({
          user: {
            ...DEFAULT_USER,
            image: null,
            emailVerified: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          session: {
            id: 'edgechat-session',
            userId: DEFAULT_USER.id,
            expiresAt: new Date(Date.now() + 180 * 24 * 3600 * 1000).toISOString(),
          },
        })
      } catch {
        // ignore
      }
    }

    // 3. Fallback better-auth session
    try {
      const auth = createAuth(c)
      const session = await auth.api.getSession({ headers: c.req.raw.headers })
      if (session?.user) {
        return c.json(session)
      }
    } catch {}

    return c.json(null)
  })

  // Sign out endpoint
  app.post('/api/auth/sign-out', (c) => {
    clearAuthCookie(c)
    return c.json({ success: true })
  })

  // Fallback auth routes for better-auth (Google OAuth, etc.)
  app.all('/api/auth/better-auth/*', async (c) => {
    const auth = createAuth(c)
    return auth.handler(c.req.raw)
  })

  // Protected routes: dual auth (session + Bearer token)
  app.use('/api/drawings/*', authMiddleware())
  app.use('/api/drawings', authMiddleware())

  // Notes routes: protected
  app.use('/api/notes/*', authMiddleware())
  app.use('/api/notes', authMiddleware())

  // Share routes: GET is public, POST/PUT/DELETE need auth
  app.use('/api/shares', async (c, next) => {
    if (c.req.method === 'GET') return next()
    return authMiddleware()(c, next)
  })
  app.use('/api/shares/*', async (c, next) => {
    if (c.req.method === 'GET') return next()
    return authMiddleware()(c, next)
  })

  // API token management: session-only
  app.use('/api/api-tokens', sessionOnlyMiddleware())
  app.use('/api/api-tokens/*', sessionOnlyMiddleware())

  // Diagram API: dual auth
  app.use('/api/v1/diagram', authMiddleware())

  // MCP routes: dual auth
  app.use('/api/mcp/message', authMiddleware())
  app.use('/api/mcp', async (c, next) => {
    if (c.req.method === 'GET') return next()
    return authMiddleware()(c, next)
  })

  // Mount routes
  app.route('/api/drawings', drawingRoutes)
  app.route('/api/notes', noteRoutes)
  app.route('/api/shares', shareRoutes)
  app.route('/api/api-tokens', apiTokenRoutes)
  app.route('/api/v1', diagramRoutes)
  app.route('/api/mcp', mcpRoutes)
  app.route('/oauth', oauthRoutes)
}
