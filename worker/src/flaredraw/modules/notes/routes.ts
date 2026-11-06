import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { eq, desc, and } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { notes } from '../../db/schema'

type Bindings = {
  DB: D1Database
  STORAGE: R2Bucket
}

type Variables = {
  user: { id: string; name: string; email: string }
}

const noteRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// 1. List all notes for the authenticated user (pinned first, then updated_at DESC)
noteRoutes.get('/', async (c) => {
  const user = c.get('user')
  const db = drizzle(c.env.DB)

  const userNotes = await db
    .select()
    .from(notes)
    .where(eq(notes.userId, user.id))
    .orderBy(desc(notes.isPinned), desc(notes.updatedAt))

  return c.json({ notes: userNotes })
})

// 2. Create a new note
noteRoutes.post('/', async (c) => {
  const user = c.get('user')
  const db = drizzle(c.env.DB)
  const id = nanoid(12)

  let body: { title?: string; content?: string } = {}
  try {
    body = await c.req.json()
  } catch {
    // Empty body is acceptable
  }

  const title = body.title !== undefined ? body.title : ''
  const content = body.content !== undefined ? body.content : ''
  const now = new Date().toISOString()

  const newNote = {
    id,
    userId: user.id,
    title,
    content,
    isPinned: false,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(notes).values(newNote)

  return c.json({ note: newNote, id }, 201)
})

// 3. Get single note details
noteRoutes.get('/:id', async (c) => {
  const user = c.get('user')
  const db = drizzle(c.env.DB)
  const id = c.req.param('id')

  const [note] = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, id), eq(notes.userId, user.id)))
    .limit(1)

  if (!note) {
    return c.json({ error: 'Note not found' }, 404)
  }

  return c.json({ note })
})

// 4. Update / Auto-save note
noteRoutes.put('/:id', async (c) => {
  const user = c.get('user')
  const db = drizzle(c.env.DB)
  const id = c.req.param('id')

  const [existing] = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, id), eq(notes.userId, user.id)))
    .limit(1)

  if (!existing) {
    return c.json({ error: 'Note not found' }, 404)
  }

  const body = await c.req.json().catch(() => ({}))
  const title = body.title !== undefined ? body.title : existing.title
  const content = body.content !== undefined ? body.content : existing.content
  const now = new Date().toISOString()

  await db
    .update(notes)
    .set({
      title,
      content,
      updatedAt: now,
    })
    .where(eq(notes.id, id))

  return c.json({
    saved: true,
    note: {
      ...existing,
      title,
      content,
      updatedAt: now,
    },
  })
})

// 5. Delete note
noteRoutes.delete('/:id', async (c) => {
  const user = c.get('user')
  const db = drizzle(c.env.DB)
  const id = c.req.param('id')

  const [existing] = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, id), eq(notes.userId, user.id)))
    .limit(1)

  if (!existing) {
    return c.json({ error: 'Note not found' }, 404)
  }

  await db.delete(notes).where(eq(notes.id, id))

  return c.json({ deleted: true, id })
})

// 6. Toggle pin note
noteRoutes.post('/:id/pin', async (c) => {
  const user = c.get('user')
  const db = drizzle(c.env.DB)
  const id = c.req.param('id')

  const [existing] = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, id), eq(notes.userId, user.id)))
    .limit(1)

  if (!existing) {
    return c.json({ error: 'Note not found' }, 404)
  }

  const newPinState = !existing.isPinned
  const now = new Date().toISOString()

  await db
    .update(notes)
    .set({
      isPinned: newPinState,
      updatedAt: now,
    })
    .where(eq(notes.id, id))

  return c.json({
    pinned: newPinState,
    note: {
      ...existing,
      isPinned: newPinState,
      updatedAt: now,
    },
  })
})

export { noteRoutes }
