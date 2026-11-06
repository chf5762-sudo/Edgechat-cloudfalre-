import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { drawings, shares } from '../../db/schema'
import { generatePng } from '../export/png'

type Bindings = {
  DB: D1Database
  STORAGE: R2Bucket
  BROWSER: Fetcher
}

type Variables = {
  user: { id: string; name: string; email: string }
}

const shareRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// Create a share link (authenticated — user must own the drawing)
shareRoutes.post('/', async (c) => {
  const user = c.get('user')
  const db = drizzle(c.env.DB)
  const { drawingId } = await c.req.json<{ drawingId: string }>()

  // Verify ownership
  const [drawing] = await db
    .select()
    .from(drawings)
    .where(eq(drawings.id, drawingId))
    .limit(1)

  if (!drawing || drawing.userId !== user.id) {
    return c.json({ error: 'Not found' }, 404)
  }

  // If drawing already has a share, return existing
  if (drawing.shareId) {
    return c.json({ shareId: drawing.shareId })
  }

  // Copy current content to a share snapshot in R2
  const shareId = nanoid(10)
  const shareR2Key = `shares/${shareId}.excalidraw`

  const source = await c.env.STORAGE.get(drawing.r2Key)
  if (!source) {
    return c.json({ error: 'Drawing content not found' }, 404)
  }

  const content = await source.arrayBuffer()
  await c.env.STORAGE.put(shareR2Key, content, {
    httpMetadata: { contentType: 'application/json' },
  })

  // Create share record
  await db.insert(shares).values({
    id: shareId,
    drawingId: drawing.id,
    r2Key: shareR2Key,
  })

  // Update drawing with share_id
  await db
    .update(drawings)
    .set({ shareId })
    .where(eq(drawings.id, drawingId))

  return c.json({ shareId }, 201)
})

// Get shared drawing (public — no auth required)
shareRoutes.get('/:shareId', async (c) => {
  const shareId = c.req.param('shareId')
  const db = drizzle(c.env.DB)

  const [share] = await db
    .select()
    .from(shares)
    .where(eq(shares.id, shareId))
    .limit(1)

  if (!share) {
    return c.json({ error: 'Share not found' }, 404)
  }

  // Check expiry
  if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
    return c.json({ error: 'Share link expired' }, 410)
  }

  // Get content from R2
  const object = await c.env.STORAGE.get(share.r2Key)
  if (!object) {
    return c.json({ error: 'Content not found' }, 404)
  }

  // Increment view count
  await db
    .update(shares)
    .set({ viewCount: (share.viewCount ?? 0) + 1 })
    .where(eq(shares.id, shareId))

  const content = await object.text()
  return c.json(JSON.parse(content))
})

// Refresh share snapshot (re-copies current drawing content)
shareRoutes.put('/:shareId', async (c) => {
  const user = c.get('user')
  const shareId = c.req.param('shareId')
  const db = drizzle(c.env.DB)

  const [share] = await db
    .select()
    .from(shares)
    .where(eq(shares.id, shareId))
    .limit(1)

  if (!share || !share.drawingId) {
    return c.json({ error: 'Share not found' }, 404)
  }

  // Verify ownership of the drawing
  const [drawing] = await db
    .select()
    .from(drawings)
    .where(eq(drawings.id, share.drawingId))
    .limit(1)

  if (!drawing || drawing.userId !== user.id) {
    return c.json({ error: 'Not found' }, 404)
  }

  // Re-copy current content
  const source = await c.env.STORAGE.get(drawing.r2Key)
  if (!source) {
    return c.json({ error: 'Drawing content not found' }, 404)
  }

  const content = await source.arrayBuffer()
  await c.env.STORAGE.put(share.r2Key, content, {
    httpMetadata: { contentType: 'application/json' },
  })

  return c.json({ refreshed: true })
})

// Get PNG for a shared drawing (public — no auth required)
shareRoutes.get('/:shareId/png', async (c) => {
  const shareId = c.req.param('shareId')

  // Check if PNG exists in R2
  const pngKey = `shares/${shareId}.png`
  const object = await c.env.STORAGE.get(pngKey)

  if (!object) {
    return c.json(
      { error: 'PNG not yet generated. Use POST to trigger generation, or share from the web UI.' },
      404,
    )
  }

  return new Response(object.body, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
    },
  })
})

// Upload PNG from client (PUT with image/png body — auth required)
shareRoutes.put('/:shareId/png', async (c) => {
  const user = c.get('user')
  const shareId = c.req.param('shareId')
  const db = drizzle(c.env.DB)

  // Verify share exists and user owns the drawing
  const [share] = await db
    .select()
    .from(shares)
    .where(eq(shares.id, shareId))
    .limit(1)

  if (!share?.drawingId) {
    return c.json({ error: 'Share not found' }, 404)
  }

  const [drawing] = await db
    .select()
    .from(drawings)
    .where(eq(drawings.id, share.drawingId))
    .limit(1)

  if (!drawing || drawing.userId !== user.id) {
    return c.json({ error: 'Not found' }, 404)
  }

  const body = await c.req.arrayBuffer()
  const pngKey = `shares/${shareId}.png`
  await c.env.STORAGE.put(pngKey, body, {
    httpMetadata: { contentType: 'image/png' },
  })

  return c.json({ uploaded: true })
})

// Trigger server-side PNG generation via Browser Rendering (auth required)
shareRoutes.post('/:shareId/png', async (c) => {
  const user = c.get('user')
  const shareId = c.req.param('shareId')
  const db = drizzle(c.env.DB)

  // Verify share exists and user owns the drawing
  const [share] = await db
    .select()
    .from(shares)
    .where(eq(shares.id, shareId))
    .limit(1)

  if (!share?.drawingId) {
    return c.json({ error: 'Share not found' }, 404)
  }

  const [drawing] = await db
    .select()
    .from(drawings)
    .where(eq(drawings.id, share.drawingId))
    .limit(1)

  if (!drawing || drawing.userId !== user.id) {
    return c.json({ error: 'Not found' }, 404)
  }

  try {
    const origin = new URL(c.req.url).origin
    const shareUrl = `${origin}/s/${shareId}`
    const pngData = await generatePng(c.env.BROWSER, shareUrl)

    const pngKey = `shares/${shareId}.png`
    await c.env.STORAGE.put(pngKey, pngData, {
      httpMetadata: { contentType: 'image/png' },
    })

    return c.json({ generated: true, pngUrl: `${origin}/api/shares/${shareId}/png` })
  } catch (err) {
    console.error(JSON.stringify({ event: 'png_generation_error', shareId, error: String(err) }))
    return c.json({ error: 'PNG generation failed' }, 500)
  }
})

export { shareRoutes }
