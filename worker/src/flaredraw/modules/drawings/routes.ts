import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { eq, desc } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { drawings } from '../../db/schema'

type Bindings = {
  DB: D1Database
  STORAGE: R2Bucket
}

type Variables = {
  user: { id: string; name: string; email: string }
}

const drawingRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// List user's drawings
drawingRoutes.get('/', async (c) => {
  const user = c.get('user')
  const db = drizzle(c.env.DB)

  const results = await db
    .select()
    .from(drawings)
    .where(eq(drawings.userId, user.id))
    .orderBy(desc(drawings.lastModified))

  return c.json({ drawings: results })
})

// Create new drawing — optionally accepts content and title
drawingRoutes.post('/', async (c) => {
  const user = c.get('user')
  const db = drizzle(c.env.DB)
  const id = nanoid(12)
  const r2Key = `drawings/${user.id}/${id}.excalidraw`

  // Parse optional body (may be empty for UI-created drawings)
  let body: { title?: string; elements?: unknown[]; appState?: Record<string, unknown>; files?: Record<string, unknown> } = {}
  try {
    body = await c.req.json()
  } catch {
    // Empty body is fine — creates empty drawing
  }

  const elements = Array.isArray(body.elements) ? body.elements : []
  const title = body.title?.trim() || 'Untitled'

  const drawingContent = JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: 'flaredraw',
    elements,
    appState: { viewBackgroundColor: '#ffffff', ...body.appState },
    files: body.files || {},
  })

  await c.env.STORAGE.put(r2Key, drawingContent, {
    httpMetadata: { contentType: 'application/json' },
  })

  const now = new Date().toISOString()
  await db.insert(drawings).values({
    id,
    userId: user.id,
    title,
    r2Key,
    elementCount: elements.length,
    lastModified: now,
  })

  return c.json({ id, r2Key }, 201)
})

// Get drawing metadata
drawingRoutes.get('/:id', async (c) => {
  const user = c.get('user')
  const db = drizzle(c.env.DB)
  const id = c.req.param('id')

  const [drawing] = await db
    .select()
    .from(drawings)
    .where(eq(drawings.id, id))
    .limit(1)

  if (!drawing || drawing.userId !== user.id) {
    return c.json({ error: 'Not found' }, 404)
  }

  return c.json({ drawing })
})

// Get drawing content from R2
drawingRoutes.get('/:id/content', async (c) => {
  const user = c.get('user')
  const db = drizzle(c.env.DB)
  const id = c.req.param('id')

  const [drawing] = await db
    .select()
    .from(drawings)
    .where(eq(drawings.id, id))
    .limit(1)

  if (!drawing || drawing.userId !== user.id) {
    return c.json({ error: 'Not found' }, 404)
  }

  const object = await c.env.STORAGE.get(drawing.r2Key)
  if (!object) {
    return c.json({ error: 'Drawing content not found' }, 404)
  }

  const content = await object.text()
  return c.json(JSON.parse(content))
})

// Save drawing content to R2
drawingRoutes.put('/:id/content', async (c) => {
  const user = c.get('user')
  const db = drizzle(c.env.DB)
  const id = c.req.param('id')

  const [drawing] = await db
    .select()
    .from(drawings)
    .where(eq(drawings.id, id))
    .limit(1)

  if (!drawing || drawing.userId !== user.id) {
    return c.json({ error: 'Not found' }, 404)
  }

  const body = await c.req.json()
  const elementCount = Array.isArray(body.elements) ? body.elements.length : 0
  const now = new Date().toISOString()

  // Save content to R2
  await c.env.STORAGE.put(drawing.r2Key, JSON.stringify(body), {
    httpMetadata: { contentType: 'application/json' },
  })

  // Update metadata in D1
  await db
    .update(drawings)
    .set({ elementCount, lastModified: now })
    .where(eq(drawings.id, id))

  return c.json({ saved: true, elementCount, lastModified: now })
})

// Update drawing metadata (title, etc.)
drawingRoutes.patch('/:id', async (c) => {
  const user = c.get('user')
  const db = drizzle(c.env.DB)
  const id = c.req.param('id')

  const [drawing] = await db
    .select()
    .from(drawings)
    .where(eq(drawings.id, id))
    .limit(1)

  if (!drawing || drawing.userId !== user.id) {
    return c.json({ error: 'Not found' }, 404)
  }

  const { title } = await c.req.json()
  await db
    .update(drawings)
    .set({ title, lastModified: new Date().toISOString() })
    .where(eq(drawings.id, id))

  return c.json({ updated: true })
})

// Delete drawing
drawingRoutes.delete('/:id', async (c) => {
  const user = c.get('user')
  const db = drizzle(c.env.DB)
  const id = c.req.param('id')

  const [drawing] = await db
    .select()
    .from(drawings)
    .where(eq(drawings.id, id))
    .limit(1)

  if (!drawing || drawing.userId !== user.id) {
    return c.json({ error: 'Not found' }, 404)
  }

  // Delete from R2 and D1
  await c.env.STORAGE.delete(drawing.r2Key)
  await db.delete(drawings).where(eq(drawings.id, id))

  return c.json({ deleted: true })
})

export { drawingRoutes }
