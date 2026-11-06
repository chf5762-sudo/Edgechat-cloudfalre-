import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { drizzle } from 'drizzle-orm/d1'
import { drawings, shares } from '../../db/schema'

type Bindings = {
  DB: D1Database
  STORAGE: R2Bucket
  BROWSER: Fetcher
}

type Variables = {
  user: { id: string; name: string; email: string }
}

const diagramRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

/**
 * POST /api/v1/diagram
 * One-step: create drawing + share in a single call.
 * Returns drawingId, shareId, shareUrl, pngUrl.
 */
diagramRoutes.post('/diagram', async (c) => {
  const user = c.get('user')
  const db = drizzle(c.env.DB)
  const body = await c.req.json<{
    title?: string
    elements?: unknown[]
    appState?: Record<string, unknown>
    files?: Record<string, unknown>
  }>()

  const drawingId = nanoid(12)
  const shareId = nanoid(10)
  const title = body.title?.trim() || 'Untitled'
  const elements = Array.isArray(body.elements) ? body.elements : []

  const drawingR2Key = `drawings/${user.id}/${drawingId}.excalidraw`
  const shareR2Key = `shares/${shareId}.excalidraw`

  const content = JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: 'flaredraw',
    elements,
    appState: { viewBackgroundColor: '#ffffff', ...body.appState },
    files: body.files || {},
  })

  // Store drawing and share snapshot in R2
  await Promise.all([
    c.env.STORAGE.put(drawingR2Key, content, {
      httpMetadata: { contentType: 'application/json' },
    }),
    c.env.STORAGE.put(shareR2Key, content, {
      httpMetadata: { contentType: 'application/json' },
    }),
  ])

  const now = new Date().toISOString()

  // Create drawing + share records in D1
  await db.insert(drawings).values({
    id: drawingId,
    userId: user.id,
    title,
    r2Key: drawingR2Key,
    shareId,
    elementCount: elements.length,
    lastModified: now,
  })

  await db.insert(shares).values({
    id: shareId,
    drawingId,
    r2Key: shareR2Key,
  })

  const origin = new URL(c.req.url).origin
  const shareUrl = `${origin}/s/${shareId}`
  const pngUrl = `${origin}/api/shares/${shareId}/png`

  return c.json({
    drawingId,
    shareId,
    shareUrl,
    pngUrl,
    editUrl: `${origin}/draw/${drawingId}`,
  }, 201)
})

export { diagramRoutes }
