import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { eq, desc, and, isNull, isNotNull, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { notes } from '../../db/schema.ts'

type Bindings = {
  DB: D1Database
  FILES: R2Bucket
  STORAGE: R2Bucket
}

type Variables = {
  user: { id: string; name: string; email: string }
}

const noteRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ─── helpers ───────────────────────────────────────────────────────────────

function nowIso() { return new Date().toISOString() }

function nanoidShort(len = 12) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  for (const b of arr) s += chars[b % chars.length];
  return s;
}

// ─── 1. List all notes (active, non-trashed) ──────────────────────────────
noteRoutes.get('/', async (c) => {
  const user = c.get('user')
  const tag = c.req.query('tag') || ''
  const trash = c.req.query('trash') === '1'

  // Use raw D1 to support new columns (deleted_at, tags) until schema is updated
  let query = `SELECT id, user_id, title, content, is_pinned, created_at, updated_at, deleted_at, tags
               FROM notes WHERE user_id = ?`
  const params: any[] = [user.id]

  if (trash) {
    query += ` AND deleted_at IS NOT NULL`
  } else {
    query += ` AND deleted_at IS NULL`
  }

  if (tag) {
    query += ` AND tags LIKE ?`
    params.push(`%${tag}%`)
  }

  query += ` ORDER BY is_pinned DESC, updated_at DESC LIMIT 500`

  const { results } = await c.env.DB.prepare(query).bind(...params).all()
  const noteList = (results || []).map((r: any) => ({
    id: r.id,
    userId: r.user_id,
    title: r.title,
    content: r.content,
    isPinned: Boolean(r.is_pinned),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? null,
    tags: (() => { try { return JSON.parse(r.tags || '[]') } catch { return [] } })(),
  }))

  return c.json({ notes: noteList })
})

// ─── 2. Create a new note ─────────────────────────────────────────────────
noteRoutes.post('/', async (c) => {
  const user = c.get('user')
  const id = nanoidShort(12)

  let body: { title?: string; content?: string; tags?: string[] } = {}
  try { body = await c.req.json() } catch { }

  const title = body.title !== undefined ? body.title : ''
  const content = body.content !== undefined ? body.content : ''
  const tags = Array.isArray(body.tags) ? JSON.stringify(body.tags) : '[]'
  const n = nowIso()

  await c.env.DB.prepare(
    `INSERT INTO notes (id, user_id, title, content, is_pinned, created_at, updated_at, deleted_at, tags)
     VALUES (?, ?, ?, ?, 0, ?, ?, NULL, ?)`
  ).bind(id, user.id, title, content, n, n, tags).run()

  return c.json({
    note: { id, userId: user.id, title, content, isPinned: false, createdAt: n, updatedAt: n, deletedAt: null, tags: JSON.parse(tags) },
    id,
  }, 201)
})

// ─── 3. Get single note ───────────────────────────────────────────────────
noteRoutes.get('/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')

  const note = await c.env.DB.prepare(
    `SELECT id, user_id, title, content, is_pinned, created_at, updated_at, deleted_at, tags
     FROM notes WHERE id = ? AND user_id = ? LIMIT 1`
  ).bind(id, user.id).first() as any

  if (!note) return c.json({ error: 'Note not found' }, 404)

  return c.json({
    note: {
      id: note.id, userId: note.user_id, title: note.title, content: note.content,
      isPinned: Boolean(note.is_pinned), createdAt: note.created_at, updatedAt: note.updated_at,
      deletedAt: note.deleted_at ?? null,
      tags: (() => { try { return JSON.parse(note.tags || '[]') } catch { return [] } })(),
    }
  })
})

// ─── 4. Update / Auto-save note ──────────────────────────────────────────
noteRoutes.put('/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')

  const existing = await c.env.DB.prepare(
    `SELECT id, title, content, tags FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1`
  ).bind(id, user.id).first() as any

  if (!existing) return c.json({ error: 'Note not found' }, 404)

  const body = await c.req.json().catch(() => ({}))
  const title = body.title !== undefined ? body.title : existing.title
  const content = body.content !== undefined ? body.content : existing.content
  const tags = body.tags !== undefined ? JSON.stringify(Array.isArray(body.tags) ? body.tags : []) : (existing.tags || '[]')
  const n = nowIso()

  await c.env.DB.prepare(
    `UPDATE notes SET title = ?, content = ?, tags = ?, updated_at = ? WHERE id = ?`
  ).bind(title, content, tags, n, id).run()

  return c.json({
    saved: true,
    note: {
      id, title, content, updatedAt: n,
      tags: (() => { try { return JSON.parse(tags) } catch { return [] } })(),
    },
  })
})

// ─── 5. Soft delete note (move to trash) ─────────────────────────────────
noteRoutes.delete('/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const permanent = c.req.query('permanent') === '1'

  const existing = await c.env.DB.prepare(
    `SELECT id, deleted_at FROM notes WHERE id = ? AND user_id = ? LIMIT 1`
  ).bind(id, user.id).first() as any

  if (!existing) return c.json({ error: 'Note not found' }, 404)

  if (permanent || existing.deleted_at) {
    await c.env.DB.prepare('DELETE FROM notes WHERE id = ?').bind(id).run()
    return c.json({ deleted: true, permanent: true, id })
  }

  const n = nowIso()
  await c.env.DB.prepare(
    `UPDATE notes SET deleted_at = ?, updated_at = ? WHERE id = ?`
  ).bind(n, n, id).run()
  return c.json({ deleted: true, permanent: false, id })
})

// ─── 6. Restore note from trash ──────────────────────────────────────────
noteRoutes.post('/:id/restore', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')

  const existing = await c.env.DB.prepare(
    `SELECT id FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL LIMIT 1`
  ).bind(id, user.id).first() as any
  if (!existing) return c.json({ error: 'Note not found in trash' }, 404)

  const n = nowIso()
  await c.env.DB.prepare(
    `UPDATE notes SET deleted_at = NULL, updated_at = ? WHERE id = ?`
  ).bind(n, id).run()
  return c.json({ restored: true, id })
})

// ─── 7. Batch delete notes ───────────────────────────────────────────────
noteRoutes.post('/batch-delete', async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const ids: string[] = Array.isArray(body.ids) ? body.ids : []
  if (!ids.length) return c.json({ error: 'No IDs provided' }, 400)

  const n = nowIso()
  for (const id of ids) {
    await c.env.DB.prepare(
      `UPDATE notes SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL`
    ).bind(n, n, id, user.id).run()
  }
  return c.json({ deleted: ids.length, ids })
})

// ─── 8. Purge entire trash ────────────────────────────────────────────────
noteRoutes.delete('/trash/purge', async (c) => {
  const user = c.get('user')
  const { results } = await c.env.DB.prepare(
    `SELECT id FROM notes WHERE user_id = ? AND deleted_at IS NOT NULL`
  ).bind(user.id).all()
  const count = (results || []).length
  await c.env.DB.prepare(
    `DELETE FROM notes WHERE user_id = ? AND deleted_at IS NOT NULL`
  ).bind(user.id).run()
  return c.json({ purged: count })
})

// ─── 9. Toggle pin note ───────────────────────────────────────────────────
noteRoutes.post('/:id/pin', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')

  const existing = await c.env.DB.prepare(
    `SELECT id, is_pinned FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1`
  ).bind(id, user.id).first() as any
  if (!existing) return c.json({ error: 'Note not found' }, 404)

  const newPinState = !existing.is_pinned
  const n = nowIso()
  await c.env.DB.prepare(
    `UPDATE notes SET is_pinned = ?, updated_at = ? WHERE id = ?`
  ).bind(newPinState ? 1 : 0, n, id).run()

  return c.json({ pinned: newPinState, note: { id, isPinned: newPinState, updatedAt: n } })
})

// ─── 10. Update note tags ────────────────────────────────────────────────
noteRoutes.patch('/:id/tags', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const tags = Array.isArray(body.tags) ? body.tags : []
  const n = nowIso()

  const existing = await c.env.DB.prepare(
    `SELECT id FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1`
  ).bind(id, user.id).first() as any
  if (!existing) return c.json({ error: 'Note not found' }, 404)

  await c.env.DB.prepare(
    `UPDATE notes SET tags = ?, updated_at = ? WHERE id = ?`
  ).bind(JSON.stringify(tags), n, id).run()
  return c.json({ ok: true, tags })
})

export { noteRoutes }
