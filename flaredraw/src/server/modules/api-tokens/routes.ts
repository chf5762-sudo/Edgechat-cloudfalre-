import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { apiTokens } from '../../db/schema'
import { generateToken } from '../../middleware/auth'

type Bindings = {
  DB: D1Database
}

type Variables = {
  user: { id: string; name: string; email: string }
}

const apiTokenRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// List tokens (name, prefix, dates — never the hash)
apiTokenRoutes.get('/', async (c) => {
  const user = c.get('user')
  const db = drizzle(c.env.DB)

  const tokens = await db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      tokenPrefix: apiTokens.tokenPrefix,
      lastUsedAt: apiTokens.lastUsedAt,
      expiresAt: apiTokens.expiresAt,
      createdAt: apiTokens.createdAt,
    })
    .from(apiTokens)
    .where(eq(apiTokens.userId, user.id))

  return c.json({ tokens })
})

// Create a new token — returns the raw token ONCE
apiTokenRoutes.post('/', async (c) => {
  const user = c.get('user')
  const db = drizzle(c.env.DB)
  const body = await c.req.json<{ name: string }>()

  if (!body.name?.trim()) {
    return c.json({ error: 'Token name is required' }, 400)
  }

  const { raw, hash, prefix } = await generateToken()
  const id = crypto.randomUUID()

  await db.insert(apiTokens).values({
    id,
    userId: user.id,
    name: body.name.trim(),
    token: hash,
    tokenPrefix: prefix,
  })

  return c.json({
    id,
    name: body.name.trim(),
    token: raw,
    prefix,
  }, 201)
})

// Delete/revoke a token
apiTokenRoutes.delete('/:id', async (c) => {
  const user = c.get('user')
  const db = drizzle(c.env.DB)
  const id = c.req.param('id')

  // Verify ownership
  const [token] = await db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.id, id))
    .limit(1)

  if (!token || token.userId !== user.id) {
    return c.json({ error: 'Token not found' }, 404)
  }

  await db.delete(apiTokens).where(eq(apiTokens.id, id))

  return c.json({ deleted: true })
})

export { apiTokenRoutes }
