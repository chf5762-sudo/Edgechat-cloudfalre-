import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { eq, desc, and, or, isNull, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { drawings, shares } from '../../db/schema'

type Bindings = {
  DB: D1Database
  STORAGE: R2Bucket
}

type Variables = {
  user: { id: string; name: string; email: string }
}

const drawingRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

let schemaChecked = false
async function ensureProjectColumn(db: D1Database) {
  if (schemaChecked) return
  schemaChecked = true
  try {
    await db.prepare(`ALTER TABLE drawings ADD COLUMN project text DEFAULT 'default'`).run()
  } catch {
    // Column already exists or table created with column
  }
}

// List user's drawings (optional ?project=... filter)
drawingRoutes.get('/', async (c) => {
  const user = c.get('user')
  await ensureProjectColumn(c.env.DB)
  const db = drizzle(c.env.DB)
  const project = c.req.query('project')

  let condition
  if (project) {
    if (project === 'default') {
      condition = and(
        eq(drawings.userId, user.id),
        or(eq(drawings.project, 'default'), isNull(drawings.project))
      )
    } else {
      condition = and(
        eq(drawings.userId, user.id),
        eq(drawings.project, project)
      )
    }
  } else {
    condition = eq(drawings.userId, user.id)
  }

  const results = await db
    .select()
    .from(drawings)
    .where(condition)
    .orderBy(desc(drawings.lastModified))

  const drawingsWithFallback = results.map((d) => ({
    ...d,
    project: d.project || 'default',
  }))

  return c.json({ drawings: drawingsWithFallback })
})

// Batch delete drawings
drawingRoutes.post('/batch-delete', async (c) => {
  const user = c.get('user')
  const db = drizzle(c.env.DB)

  let body: { ids?: string[] } = {}
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : []
  if (ids.length === 0) {
    return c.json({ error: 'No IDs provided' }, 400)
  }

  // Verify ownership: only find drawings owned by current user
  const userDrawings = await db
    .select()
    .from(drawings)
    .where(and(eq(drawings.userId, user.id), inArray(drawings.id, ids)))

  if (userDrawings.length === 0) {
    return c.json({ deleted: 0, ids: [] })
  }

  const validIds = userDrawings.map((d) => d.id)

  // 1. Cascade delete shares in D1 and any related share objects in R2
  for (const d of userDrawings) {
    const drawingShares = await db.select().from(shares).where(eq(shares.drawingId, d.id))
    for (const s of drawingShares) {
      if (s.r2Key) await c.env.STORAGE.delete(s.r2Key).catch(() => {})
      await c.env.STORAGE.delete(`shares/${s.id}.png`).catch(() => {})
    }
  }
  await db.delete(shares).where(inArray(shares.drawingId, validIds))

  // 2. Delete drawing files from R2
  await Promise.all(
    userDrawings.map((d) => c.env.STORAGE.delete(d.r2Key).catch(() => {}))
  )

  // 3. Delete drawings from D1
  await db.delete(drawings).where(and(eq(drawings.userId, user.id), inArray(drawings.id, validIds)))

  return c.json({ deleted: validIds.length, ids: validIds })
})

// Create new drawing — optionally accepts content, title, project
drawingRoutes.post('/', async (c) => {
  const user = c.get('user')
  await ensureProjectColumn(c.env.DB)
  const db = drizzle(c.env.DB)
  const id = nanoid(12)
  const r2Key = `drawings/${user.id}/${id}.excalidraw`

  // Parse optional body (may be empty for UI-created drawings)
  let body: {
    title?: string
    project?: string
    elements?: unknown[]
    appState?: Record<string, unknown>
    files?: Record<string, unknown>
  } = {}
  try {
    body = await c.req.json()
  } catch {
    // Empty body is fine — creates empty drawing
  }

  const elements = Array.isArray(body.elements) ? body.elements : []
  const title = body.title?.trim() || 'Untitled'
  const project = body.project?.trim() || 'default'

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
    project,
    r2Key,
    elementCount: elements.length,
    lastModified: now,
  })

  return c.json({ id, r2Key, project }, 201)
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

  return c.json({
    drawing: {
      ...drawing,
      project: drawing.project || 'default',
    },
  })
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

// Update drawing metadata (title, project, etc.)
drawingRoutes.patch('/:id', async (c) => {
  const user = c.get('user')
  await ensureProjectColumn(c.env.DB)
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

  const body = await c.req.json().catch(() => ({}))
  const updates: Record<string, unknown> = {
    lastModified: new Date().toISOString(),
  }

  if (typeof body.title === 'string') {
    updates.title = body.title.trim()
  }
  if (typeof body.project === 'string') {
    updates.project = body.project.trim() || 'default'
  }

  await db
    .update(drawings)
    .set(updates)
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

  // Delete from R2 and D1 (cascade delete shares first to satisfy FK)
  const drawingShares = await db.select().from(shares).where(eq(shares.drawingId, id))
  for (const s of drawingShares) {
    if (s.r2Key) await c.env.STORAGE.delete(s.r2Key).catch(() => {})
    await c.env.STORAGE.delete(`shares/${s.id}.png`).catch(() => {})
  }
  await db.delete(shares).where(eq(shares.drawingId, id))
  await c.env.STORAGE.delete(drawing.r2Key).catch(() => {})
  await db.delete(drawings).where(eq(drawings.id, id))

  return c.json({ deleted: true, id })
})

export { drawingRoutes }
