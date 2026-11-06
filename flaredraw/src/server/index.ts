import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { drizzle } from 'drizzle-orm/d1'
import { createAuth } from './modules/auth'
import { authMiddleware, sessionOnlyMiddleware } from './middleware/auth'
import { drawingRoutes } from './modules/drawings/routes'
import { shareRoutes } from './modules/shares/routes'
import { noteRoutes } from './modules/notes/routes'
import { apiTokenRoutes } from './modules/api-tokens/routes'
import { diagramRoutes } from './modules/api/routes'
import { mcpRoutes } from './modules/mcp/routes'
import { oauthRoutes, wellKnownRoutes } from './modules/mcp/oauth-routes'
import {
  PASSCODE,
  createSessionCookieValue,
  setAuthCookie,
  clearAuthCookie,
  getAuthCookie,
  verifySessionCookieValue,
  DEFAULT_USER,
  ensureDefaultUser,
} from './modules/auth/passcode'

type Bindings = {
  DB: D1Database
  STORAGE: R2Bucket
  AI: Ai
  BROWSER: Fetcher
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
}

type Variables = {
  user: { id: string; name: string; email: string } | null
  authMethod: 'session' | 'api-token' | 'mcp-oauth'
}

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// .well-known OAuth discovery (must be at root, before CORS)
wellKnownRoutes(app as any)

// CORS
app.use(
  '/api/*',
  cors({
    origin: (origin) => origin || '',
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
)
app.use(
  '/oauth/*',
  cors({
    origin: (origin) => origin || '',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
    credentials: true,
  })
)

// Health check
app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }))

// 1. Passcode verification endpoint (180-day session)
app.post('/api/auth/verify-passcode', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const passcode = typeof body.passcode === 'string' ? body.passcode.trim() : ''

  if (passcode !== PASSCODE) {
    return c.json({ success: false, error: '密码错误，请输入正确的访问密码' }, 401)
  }

  const secret = c.env?.BETTER_AUTH_SECRET || 'flaredraw-auth-secret-180d'
  const token = await createSessionCookieValue(secret)
  setAuthCookie(c, token)

  // Ensure default user exists in D1 database
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

// 2. Session verification endpoint
app.get('/api/auth/get-session', async (c) => {
  // Check passcode cookie first
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

  // Check better-auth session
  try {
    const auth = createAuth(c)
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    if (session?.user) {
      return c.json(session)
    }
  } catch {}

  // Not authenticated
  return c.json(null)
})

// 3. Sign out endpoint
app.post('/api/auth/sign-out', (c) => {
  clearAuthCookie(c)
  return c.json({ success: true })
})

// 4. Fallback auth routes for better-auth (Google OAuth, etc.)
app.all('/api/auth/*', async (c) => {
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
app.use('/api/v1/*', authMiddleware())

// MCP routes: dual auth
app.use('/api/mcp/message', authMiddleware())

// Mount routes
app.route('/api/drawings', drawingRoutes)
app.route('/api/notes', noteRoutes)
app.route('/api/shares', shareRoutes)
app.route('/api/api-tokens', apiTokenRoutes)
app.route('/api/v1', diagramRoutes)
app.route('/api/mcp', mcpRoutes)
app.route('/oauth', oauthRoutes)

export default app
