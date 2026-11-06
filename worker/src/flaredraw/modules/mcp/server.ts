import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { nanoid } from 'nanoid'
import { eq, desc, and } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { z } from 'zod'
import { drawings, shares, notes } from '../../db/schema.ts'
import { generatePng } from '../export/png.ts'
import {
  ensureAgentSharedFolder,
  ensureProjectFolder,
  getDescendantFolderIds,
  applyAutoTimestamp,
  AGENT_SHARED_FOLDER_NAME,
  AGENT_SHARED_TOKEN,
} from '../../../api/storage.ts'

type Env = {
  DB: D1Database
  STORAGE: R2Bucket
  BROWSER: Fetcher
}

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }
}

function error(message: string) {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }], isError: true }
}

export function createMcpServer() {
  const server = new McpServer({
    name: 'FlareDraw',
    version: '1.0.0',
  })

  return server
}

/**
 * Register all FlareDraw tools on the MCP server.
 * Each tool handler receives userId and env for scoped operations.
 */
export function registerResources(server: McpServer) {
  server.resource(
    'element-guide',
    'excalidraw://guide/elements',
    {
      description: 'IMPORTANT: Read this guide before creating any diagrams. Contains element sizing rules, font metrics, color palettes, layout patterns, and gotchas for generating well-formed Excalidraw elements.',
      mimeType: 'text/markdown',
    },
    async () => ({
      contents: [
        {
          uri: 'excalidraw://guide/elements',
          mimeType: 'text/markdown',
          text: ELEMENT_GUIDE,
        },
      ],
    }),
  )
}

const ELEMENT_GUIDE = `# Excalidraw Element Guide

Read this before creating diagrams. Following these rules prevents text clipping, overlapping elements, and broken arrows.

## Text Sizing (CRITICAL)

Text width and height must be calculated from the content. Excalidraw does NOT auto-size elements in raw JSON.

**Width formula**: \`width = longestLineCharCount × fontSize × 0.6 + 20\`
**Height formula**: \`height = lineCount × fontSize × 1.35 + 10\`

| fontSize | Approx char width | Line height |
|----------|------------------|-------------|
| 14 | 8.4px | 19px |
| 16 | 9.6px | 22px |
| 20 | 12px | 27px |
| 24 | 14.4px | 32px |
| 28 | 16.8px | 38px |
| 36 | 21.6px | 49px |

**Example**: Text "Hello World" at fontSize 20:
- Chars: 11, width = 11 × 20 × 0.6 + 20 = 152px
- Lines: 1, height = 1 × 20 × 1.35 + 10 = 37px

**Multi-line**: For "Line One\\nLine Two" at fontSize 16:
- Longest line: 8 chars, width = 8 × 16 × 0.6 + 20 = 97px
- Lines: 2, height = 2 × 16 × 1.35 + 10 = 53px

## Container Sizing

Containers (rectangles, ellipses) holding text need padding beyond the text bounds.

**Container width** = text width + 60px (30px padding each side)
**Container height** = text height + 40px (20px padding top/bottom)

For a label "Database" at fontSize 20:
- Text: 8 chars × 20 × 0.6 + 20 = 116px wide, 37px tall
- Container: 176px wide × 77px tall (minimum)
- Round up to nice numbers: 180 × 80

**Minimum container sizes**: 120×60px for labels, 200×80px for descriptions.

## Font Families

| ID | Name | Style | Use for |
|----|------|-------|---------|
| 2 | Helvetica | Sans-serif / Normal | **Default** — Standard clean normal font |
| 3 | Cascadia | Monospace | Code, technical labels |
| 1 | Virgil | Handwriting | Informal / Hand-drawn |
| 5 | Excalifont | Handwriting | Informal / Hand-drawn |

**Always use fontFamily: 2 (Normal / Sans-serif)** for standard, professional, clean diagrams.

## Color Palettes

### Semantic (recommended)
| Purpose | Background | Stroke |
|---------|-----------|--------|
| Information/Input | #a5d8ff | #1971c2 |
| Success/Database | #b2f2bb | #2f9e44 |
| Warning/Decision | #ffec99 | #f08c00 |
| Error/Danger | #ffc9c9 | #e03131 |
| External/Storage | #d0bfff | #9c36b5 |
| Neutral | #e9ecef | #868e96 |

### Component-based
| Component | Background | Stroke |
|-----------|-----------|--------|
| Frontend | #dae8fc | #6c8ebf |
| Backend/API | #e1d5e7 | #9673a6 |
| Database | #d5e8d4 | #82b366 |
| Storage | #fff2cc | #d6b656 |
| AI/ML | #f8cecc | #b85450 |
| Cache/Queue | #ffe6cc | #d79b00 |

## Layout Rules

- **Grid spacing**: Use multiples of 50px for element positions
- **Gap between elements**: 50-80px minimum (never less than 30px)
- **Direction**: Left-to-right for processes, top-to-bottom for hierarchies
- **Cognitive limit**: Maximum 9 major elements per diagram (7±2 rule)
- **Title**: Place at top, fontSize 28-36, centered above the diagram

### Standard vertical flow positions
Row 1: y=100, Row 2: y=250, Row 3: y=400, Row 4: y=550

## Arrows

- \`points\` are RELATIVE offsets from the arrow's x,y position, not absolute coordinates
- For horizontal arrow 200px long: \`points: [[0, 0], [200, 0]]\`
- For vertical arrow 150px down: \`points: [[0, 0], [0, 150]]\`
- \`endArrowhead: "arrow"\` for directional, \`null\` for association lines
- Solid stroke = primary flow, dashed = response/optional

### Arrow width/height
Set width and height to match the bounding box of the points array:
- Horizontal arrow 200px: \`width: 200, height: 0\`
- Diagonal arrow: \`width: deltaX, height: deltaY\`

## Gotchas (AVOID THESE)

1. **NEVER use diamond shapes** — arrow bindings break in raw JSON. Use styled rectangles for decisions.
2. **Text x is LEFT EDGE** not center. To center text at cx: \`x = cx - textWidth / 2\`
3. **Always set fillStyle: "solid"** for colored backgrounds. Default "hachure" looks messy with colors.
4. **Use roundness: { type: 3 }** for rounded rectangles (much cleaner than sharp corners).
5. **roughness: 1** for hand-drawn feel (default), **roughness: 0** for clean/professional.
6. **strokeWidth: 2** is the standard. Use 1 for subtle lines, 3-4 for emphasis.

## Minimal Element Template

\`\`\`json
{
  "type": "rectangle",
  "id": "unique-id",
  "x": 100, "y": 100,
  "width": 200, "height": 80,
  "backgroundColor": "#a5d8ff",
  "fillStyle": "solid",
  "strokeColor": "#1971c2",
  "strokeWidth": 2,
  "roundness": { "type": 3 }
}
\`\`\`

Text element:
\`\`\`json
{
  "type": "text",
  "id": "unique-text-id",
  "x": 120, "y": 120,
  "width": 160, "height": 27,
  "text": "My Label",
  "fontSize": 20,
  "fontFamily": 2,
  "textAlign": "center"
}
\`\`\`

## Diagram Patterns

### Architecture Diagram
- Top row: clients/frontends (blue)
- Middle row: services/APIs (purple)
- Bottom row: data stores (green)
- Arrows flow top-to-bottom

### Sequence Diagram
- Participant boxes across the top
- Vertical dashed lifelines
- Horizontal arrows between lifelines (alternating direction)
- Step labels above arrows

### Flowchart
- Start/end: rounded rectangles (green/red)
- Process: rectangles (blue)
- Decision: rectangles with orange/yellow (NOT diamonds)
- Vertical flow with arrows
`


function normalizeElementsFont(elements: any[]): any[] {
  return (elements || []).map((el: any) => {
    if (el && el.type === 'text') {
      if (!el.fontFamily || el.fontFamily === 1 || el.fontFamily === 5) {
        return { ...el, fontFamily: 2 }
      }
    }
    return el
  })
}

export function registerTools(server: McpServer) {
  // ─── read_guide ───
  server.tool(
    'read_guide',
    'IMPORTANT: Read this guide before creating any diagrams. Returns element sizing rules, font metrics, color palettes, layout patterns, and gotchas for generating well-formed Excalidraw elements.',
    {},
    async () => ({
      content: [{ type: 'text' as const, text: ELEMENT_GUIDE }],
    }),
  )

  // ─── list_drawings ───
  server.tool(
    'list_drawings',
    'List all drawings for the authenticated user',
    {
      limit: z.number().optional().describe('Max drawings to return (default 50)'),
    },
    async ({ limit }) => {
      const ctx = getContext('current')
      if (!ctx) return error('No auth context')

      const db = drizzle(ctx.env.DB)
      const results = await db
        .select({
          id: drawings.id,
          title: drawings.title,
          elementCount: drawings.elementCount,
          lastModified: drawings.lastModified,
          shareId: drawings.shareId,
          createdAt: drawings.createdAt,
        })
        .from(drawings)
        .where(eq(drawings.userId, ctx.userId))
        .orderBy(desc(drawings.lastModified))
        .limit(limit || 50)

      return text({ drawings: results })
    },
  )

  // ─── get_drawing ───
  server.tool(
    'get_drawing',
    'Get full drawing content (Excalidraw JSON) by ID',
    {
      drawingId: z.string().optional().describe('Drawing ID'),
      id: z.string().optional().describe('Alias for drawingId'),
    },
    async (args) => {
      const drawingId = args.drawingId || args.id
      if (!drawingId) return error('drawingId is required')
      const ctx = getContext('current')
      if (!ctx) return error('No auth context')

      const db = drizzle(ctx.env.DB)
      const [drawing] = await db
        .select()
        .from(drawings)
        .where(eq(drawings.id, drawingId))
        .limit(1)

      if (!drawing || drawing.userId !== ctx.userId) {
        return error('Drawing not found')
      }

      const object = await ctx.env.STORAGE.get(drawing.r2Key)
      if (!object) return error('Drawing content not found in storage')

      const content = await object.json()
      return text({ drawing: { ...drawing, content } })
    },
  )

  // ─── create_drawing ───
  server.tool(
    'create_drawing',
    'Create a new Excalidraw drawing',
    {
      title: z.string().optional().describe('Drawing title (default: "Untitled")'),
      elements: z.array(z.record(z.unknown())).optional().describe('Excalidraw elements array'),
      appState: z.record(z.unknown()).optional().describe('Excalidraw appState (viewBackgroundColor, etc.)'),
    },
    async ({ title, elements, appState }) => {
      const ctx = getContext('current')
      if (!ctx) return error('No auth context')

      const db = drizzle(ctx.env.DB)
      const id = nanoid(12)
      const r2Key = `drawings/${ctx.userId}/${id}.excalidraw`
      const drawingElements = normalizeElementsFont(elements || [])

      const content = JSON.stringify({
        type: 'excalidraw',
        version: 2,
        source: 'flaredraw',
        elements: drawingElements,
        appState: { viewBackgroundColor: '#ffffff', currentItemFontFamily: 2, ...appState },
        files: {},
      })

      await ctx.env.STORAGE.put(r2Key, content, {
        httpMetadata: { contentType: 'application/json' },
      })

      const now = new Date().toISOString()
      await db.insert(drawings).values({
        id,
        userId: ctx.userId,
        title: title?.trim() || 'Untitled',
        r2Key,
        elementCount: drawingElements.length,
        lastModified: now,
      })

      return text({
        id,
        drawingId: id,
        title: title?.trim() || 'Untitled',
        editUrl: `${ctx.origin}/draw/${id}`,
      })
    },
  )

  // ─── update_drawing ───
  server.tool(
    'update_drawing',
    'Update a drawing\'s content and/or title',
    {
      drawingId: z.string().optional().describe('Drawing ID to update'),
      id: z.string().optional().describe('Alias for drawingId'),
      title: z.string().optional().describe('New title'),
      elements: z.array(z.record(z.unknown())).optional().describe('New Excalidraw elements array'),
      appState: z.record(z.unknown()).optional().describe('New appState'),
    },
    async (args) => {
      const drawingId = args.drawingId || args.id
      if (!drawingId) return error('drawingId is required')
      const { title, elements, appState } = args
      const ctx = getContext('current')
      if (!ctx) return error('No auth context')

      const db = drizzle(ctx.env.DB)
      const [drawing] = await db
        .select()
        .from(drawings)
        .where(eq(drawings.id, drawingId))
        .limit(1)

      if (!drawing || drawing.userId !== ctx.userId) {
        return error('Drawing not found')
      }

      const now = new Date().toISOString()
      const updates: Record<string, unknown> = { lastModified: now }

      if (title !== undefined) {
        updates.title = title.trim()
      }

      if (elements !== undefined || appState !== undefined) {
        // Get current content, merge changes
        const object = await ctx.env.STORAGE.get(drawing.r2Key)
        const current = object ? await object.json<Record<string, unknown>>() : {
          type: 'excalidraw', version: 2, source: 'flaredraw',
          elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {},
        }

        if (elements !== undefined) {
          current.elements = elements
          updates.elementCount = elements.length
        }
        if (appState !== undefined) {
          current.appState = { ...(current.appState as Record<string, unknown>), ...appState }
        }

        await ctx.env.STORAGE.put(drawing.r2Key, JSON.stringify(current), {
          httpMetadata: { contentType: 'application/json' },
        })
      }

      await db.update(drawings).set(updates).where(eq(drawings.id, drawingId))

      return text({ updated: true, drawingId })
    },
  )

  // ─── delete_drawing ───
  server.tool(
    'delete_drawing',
    'Delete a drawing permanently',
    {
      drawingId: z.string().optional().describe('Drawing ID to delete'),
      id: z.string().optional().describe('Alias for drawingId'),
    },
    async (args) => {
      const drawingId = args.drawingId || args.id
      if (!drawingId) return error('drawingId is required')
      const ctx = getContext('current')
      if (!ctx) return error('No auth context')

      const db = drizzle(ctx.env.DB)
      const [drawing] = await db
        .select()
        .from(drawings)
        .where(eq(drawings.id, drawingId))
        .limit(1)

      if (!drawing || drawing.userId !== ctx.userId) {
        return error('Drawing not found')
      }

      await db.delete(shares).where(eq(shares.drawingId, drawingId))
      await ctx.env.STORAGE.delete(drawing.r2Key)
      await db.delete(drawings).where(eq(drawings.id, drawingId))

      return text({ deleted: true, drawingId })
    },
  )

  // ─── share_drawing ───
  server.tool(
    'share_drawing',
    'Create or get an existing public share link for a drawing',
    {
      drawingId: z.string().optional().describe('Drawing ID to share'),
      id: z.string().optional().describe('Alias for drawingId'),
    },
    async (args) => {
      const drawingId = args.drawingId || args.id
      if (!drawingId) return error('drawingId is required')
      const ctx = getContext('current')
      if (!ctx) return error('No auth context')

      const db = drizzle(ctx.env.DB)
      const [drawing] = await db
        .select()
        .from(drawings)
        .where(eq(drawings.id, drawingId))
        .limit(1)

      if (!drawing || drawing.userId !== ctx.userId) {
        return error('Drawing not found')
      }

      // Return existing share if one exists
      if (drawing.shareId) {
        return text({
          shareId: drawing.shareId,
          shareUrl: `${ctx.origin}/s/${drawing.shareId}`,
          pngUrl: `${ctx.origin}/api/shares/${drawing.shareId}/png`,
        })
      }

      // Create new share
      const shareId = nanoid(10)
      const shareR2Key = `shares/${shareId}.excalidraw`

      const source = await ctx.env.STORAGE.get(drawing.r2Key)
      if (!source) return error('Drawing content not found')

      const content = await source.arrayBuffer()
      await ctx.env.STORAGE.put(shareR2Key, content, {
        httpMetadata: { contentType: 'application/json' },
      })

      await db.insert(shares).values({
        id: shareId,
        drawingId: drawing.id,
        r2Key: shareR2Key,
      })

      await db.update(drawings).set({ shareId }).where(eq(drawings.id, drawingId))

      return text({
        shareId,
        shareUrl: `${ctx.origin}/s/${shareId}`,
        pngUrl: `${ctx.origin}/api/shares/${shareId}/png`,
      })
    },
  )

  // ─── create_diagram ───
  server.tool(
    'create_diagram',
    'Create a drawing and share it in one step. Returns share URL and PNG URL.',
    {
      title: z.string().optional().describe('Diagram title'),
      elements: z.array(z.record(z.unknown())).optional().describe('Excalidraw elements array'),
      appState: z.record(z.unknown()).optional().describe('Excalidraw appState'),
      generatePng: z.boolean().optional().describe('Generate PNG via Browser Rendering (slower, default false)'),
    },
    async ({ title, elements, appState, generatePng: shouldGeneratePng }) => {
      const ctx = getContext('current')
      if (!ctx) return error('No auth context')

      const db = drizzle(ctx.env.DB)
      const drawingId = nanoid(12)
      const shareId = nanoid(10)
      const drawingElements = normalizeElementsFont(elements || [])
      const drawingTitle = title?.trim() || 'Untitled'

      const drawingR2Key = `drawings/${ctx.userId}/${drawingId}.excalidraw`
      const shareR2Key = `shares/${shareId}.excalidraw`

      const content = JSON.stringify({
        type: 'excalidraw',
        version: 2,
        source: 'flaredraw',
        elements: drawingElements,
        appState: { viewBackgroundColor: '#ffffff', currentItemFontFamily: 2, ...appState },
        files: {},
      })

      // Store drawing and share snapshot
      await Promise.all([
        ctx.env.STORAGE.put(drawingR2Key, content, {
          httpMetadata: { contentType: 'application/json' },
        }),
        ctx.env.STORAGE.put(shareR2Key, content, {
          httpMetadata: { contentType: 'application/json' },
        }),
      ])

      const now = new Date().toISOString()
      await db.insert(drawings).values({
        id: drawingId,
        userId: ctx.userId,
        title: drawingTitle,
        r2Key: drawingR2Key,
        shareId,
        elementCount: drawingElements.length,
        lastModified: now,
      })

      await db.insert(shares).values({
        id: shareId,
        drawingId,
        r2Key: shareR2Key,
      })

      const shareUrl = `${ctx.origin}/s/${shareId}`
      const pngUrl = `${ctx.origin}/api/shares/${shareId}/png`

      // Optionally trigger PNG generation
      if (shouldGeneratePng) {
        try {
          const pngData = await generatePng(ctx.env.BROWSER, shareUrl)
          await ctx.env.STORAGE.put(`shares/${shareId}.png`, pngData, {
            httpMetadata: { contentType: 'image/png' },
          })
        } catch (err) {
          console.error(JSON.stringify({ event: 'mcp_png_error', shareId, error: String(err) }))
          // Non-fatal — diagram was still created
        }
      }

      return text({
        drawingId,
        shareId,
        shareUrl,
        pngUrl,
        editUrl: `${ctx.origin}/draw/${drawingId}`,
        title: drawingTitle,
      })
    },
  )

  // ─── list_notes ───
  server.tool(
    'list_notes',
    'List all notes for the authenticated user (pinned first, then by last updated)',
    {
      limit: z.number().optional().describe('Max notes to return (default 50)'),
    },
    async ({ limit }) => {
      const ctx = getContext('current')
      if (!ctx) return error('No auth context')

      const db = drizzle(ctx.env.DB)
      const userNotes = await db
        .select()
        .from(notes)
        .where(eq(notes.userId, ctx.userId))
        .orderBy(desc(notes.isPinned), desc(notes.updatedAt))
        .limit(limit || 50)

      return text({ notes: userNotes })
    },
  )

  // ─── get_note ───
  server.tool(
    'get_note',
    'Get details of a specific note by ID',
    {
      id: z.string().describe('Note ID'),
    },
    async ({ id }) => {
      const ctx = getContext('current')
      if (!ctx) return error('No auth context')

      const db = drizzle(ctx.env.DB)
      const [note] = await db
        .select()
        .from(notes)
        .where(and(eq(notes.id, id), eq(notes.userId, ctx.userId)))
        .limit(1)

      if (!note) return error('Note not found')
      return text({ note })
    },
  )

  // ─── create_note ───
  server.tool(
    'create_note',
    'Create a new note or memo',
    {
      title: z.string().optional().describe('Note title'),
      content: z.string().optional().describe('Note content (plain text or markdown)'),
    },
    async ({ title, content }) => {
      const ctx = getContext('current')
      if (!ctx) return error('No auth context')

      const db = drizzle(ctx.env.DB)
      const id = nanoid(12)
      const now = new Date().toISOString()
      const newNote = {
        id,
        userId: ctx.userId,
        title: title?.trim() || '',
        content: content || '',
        isPinned: false,
        createdAt: now,
        updatedAt: now,
      }

      await db.insert(notes).values(newNote)
      return text({ note: newNote, id })
    },
  )

  // ─── update_note ───
  server.tool(
    'update_note',
    'Update an existing note (title and/or content)',
    {
      id: z.string().describe('Note ID to update'),
      title: z.string().optional().describe('New title'),
      content: z.string().optional().describe('New content'),
    },
    async ({ id, title, content }) => {
      const ctx = getContext('current')
      if (!ctx) return error('No auth context')

      const db = drizzle(ctx.env.DB)
      const [existing] = await db
        .select()
        .from(notes)
        .where(and(eq(notes.id, id), eq(notes.userId, ctx.userId)))
        .limit(1)

      if (!existing) return error('Note not found')

      const now = new Date().toISOString()
      const updates: { title?: string; content?: string; updatedAt: string } = { updatedAt: now }
      if (title !== undefined) updates.title = title.trim()
      if (content !== undefined) updates.content = content

      await db.update(notes).set(updates).where(eq(notes.id, id))

      return text({
        updated: true,
        note: {
          ...existing,
          ...updates,
        },
      })
    },
  )

  // ─── delete_note ───
  server.tool(
    'delete_note',
    'Delete a note permanently by ID',
    {
      id: z.string().describe('Note ID to delete'),
    },
    async ({ id }) => {
      const ctx = getContext('current')
      if (!ctx) return error('No auth context')

      const db = drizzle(ctx.env.DB)
      const [existing] = await db
        .select()
        .from(notes)
        .where(and(eq(notes.id, id), eq(notes.userId, ctx.userId)))
        .limit(1)

      if (!existing) return error('Note not found')

      await db.delete(notes).where(eq(notes.id, id))
      return text({ deleted: true, id })
    },
  )

  // ─── pin_note ───
  server.tool(
    'pin_note',
    'Toggle pinned status of a note (pin to top / unpin)',
    {
      id: z.string().describe('Note ID to toggle pin'),
    },
    async ({ id }) => {
      const ctx = getContext('current')
      if (!ctx) return error('No auth context')

      const db = drizzle(ctx.env.DB)
      const [existing] = await db
        .select()
        .from(notes)
        .where(and(eq(notes.id, id), eq(notes.userId, ctx.userId)))
        .limit(1)

      if (!existing) return error('Note not found')

      const newPinState = !existing.isPinned
      const now = new Date().toISOString()

      await db.update(notes).set({ isPinned: newPinState, updatedAt: now }).where(eq(notes.id, id))
      return text({
        pinned: newPinState,
        note: {
          ...existing,
          isPinned: newPinState,
          updatedAt: now,
        },
      })
    },
  )
  // ═══════════════════════════════════════════════════════
  // Chat & BOT Interaction Tools
  // ═══════════════════════════════════════════════════════

  // ─── chat_list_channels ───
  server.tool(
    'chat_list_channels',
    'List all visible chat channels, public groups, and direct messages in EdgeChat.',
    {},
    async () => {
      const ctx = getContext('current')
      if (!ctx) return error('No auth context')
      const db = ctx.env.DB
      const { results } = await db.prepare(
        `SELECT id, name, description, kind, created_at
         FROM channels
         WHERE deleted_at IS NULL
         ORDER BY id ASC`
      ).all()
      return text({ channels: results })
    }
  )

  // ─── chat_list_users ───
  server.tool(
    'chat_list_users',
    'List registered users and bots in EdgeChat.',
    {},
    async () => {
      const ctx = getContext('current')
      if (!ctx) return error('No auth context')
      const db = ctx.env.DB
      const { results } = await db.prepare(
        `SELECT id, username, display_name, bio, is_admin, created_at
         FROM users
         WHERE deleted_at IS NULL
         ORDER BY id ASC`
      ).all()
      return text({ users: results })
    }
  )

  // ─── chat_send_message ───
  server.tool(
    'chat_send_message',
    'Send a chat message or Bot reply to an EdgeChat channel or DM.',
    {
      channelId: z.union([z.number(), z.string()]).describe('Target channel ID (e.g. 1) or channel name (e.g. "general")'),
      content: z.string().describe('Message content (plain text or markdown)'),
      replyToMessageId: z.union([z.number(), z.string()]).optional().describe('Optional message ID being replied to'),
    },
    async ({ channelId, content, replyToMessageId }) => {
      const ctx = getContext('current')
      if (!ctx) return error('No auth context')
      const db = ctx.env.DB

      let targetChannelId = 1
      const parsedNum = Number(channelId)
      if (!isNaN(parsedNum) && parsedNum > 0) {
        targetChannelId = parsedNum
      } else {
        const found = await db.prepare(
          'SELECT id FROM channels WHERE (name = ? OR id = ?) AND deleted_at IS NULL LIMIT 1'
        ).bind(channelId, channelId).first() as any
        targetChannelId = found ? found.id : 1
      }

      // Find admin or bot sender user
      const adminUser = await db.prepare(
        `SELECT id, username, display_name FROM users WHERE is_admin = 1 AND deleted_at IS NULL ORDER BY id ASC LIMIT 1`
      ).first() as any

      const senderId = adminUser ? adminUser.id : 1
      let [channel] = (await db.prepare(
        `SELECT id, kind, name FROM channels WHERE id = ? AND deleted_at IS NULL LIMIT 1`
      ).bind(targetChannelId).all()).results as any[]

      if (!channel) {
        channel = await db.prepare(
          'SELECT id, kind, name FROM channels WHERE deleted_at IS NULL ORDER BY id ASC LIMIT 1'
        ).first() as any
        if (channel) {
          targetChannelId = channel.id
        }
      }

      if (!channel) return error('No active channels found in system')

      // Try sending via ChannelRoom DO for instant WebSocket broadcasting to all clients
      try {
        const channelRoomEnv = (ctx.env as any).CHANNEL_ROOM
        if (channelRoomEnv) {
          const stub = channelRoomEnv.get(channelRoomEnv.idFromName(`${channel.kind}:${Number(channel.id)}`))
          const headers = new Headers({
            'x-cfchat-internal-auth': 'worker-verified',
            'x-cfchat-verified-user-id': String(senderId),
            'x-cfchat-verified-is-admin': '1',
            'x-cfchat-verified-at': String(Date.now()),
            'Content-Type': 'application/json',
          })
          const res = await stub.fetch('https://cfchat.internal/client-action', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              room: { kind: channel.kind, id: Number(channel.id) },
              action: {
                type: 'send',
                content: content.trim(),
                replyToMessageId: replyToMessageId || null,
                clientMessageId: `mcp-${Date.now()}-${nanoid(6)}`,
              },
            }),
          })
          if (res.ok) {
            const data = await res.json() as any
            return text({ sent: true, channelId, message: data.message })
          }
        }
      } catch (e) {
        console.warn('ChannelRoom dispatch error, fallback to direct DB insert', e)
      }

      // Direct D1 insert fallback
      const res = await db.prepare(
        `INSERT INTO messages (channel_id, sender_id, content, reply_to_message_id, created_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         RETURNING id, channel_id, sender_id, content, created_at`
      ).bind(Number(channel.id), senderId, content.trim(), replyToMessageId || null).first()

      return text({ sent: true, channelId: channel.id, message: res })
    }
  )

  // ─── chat_read_messages ───
  server.tool(
    'chat_read_messages',
    'Read recent messages from an EdgeChat channel or DM.',
    {
      channelId: z.union([z.number(), z.string()]).describe('Target channel ID (e.g. 1) or channel name (e.g. "general")'),
      limit: z.union([z.number(), z.string()]).optional().describe('Maximum number of messages to return (default 30, max 100)'),
    },
    async ({ channelId, limit = 30 }) => {
      const ctx = getContext('current')
      if (!ctx) return error('No auth context')
      const db = ctx.env.DB

      let targetChannelId = 1
      const parsedNum = Number(channelId)
      if (!isNaN(parsedNum) && parsedNum > 0) {
        targetChannelId = parsedNum
      } else {
        const found = await db.prepare(
          'SELECT id FROM channels WHERE (name = ? OR id = ?) AND deleted_at IS NULL LIMIT 1'
        ).bind(channelId, channelId).first() as any
        targetChannelId = found ? found.id : 1
      }
      const take = Math.min(Math.max(Number(limit) || 30, 1), 100)

      const chanExists = await db.prepare(
        'SELECT id FROM channels WHERE id = ? AND deleted_at IS NULL LIMIT 1'
      ).bind(targetChannelId).first() as any
      if (!chanExists) {
        const firstChan = await db.prepare(
          'SELECT id FROM channels WHERE deleted_at IS NULL ORDER BY id ASC LIMIT 1'
        ).first() as any
        if (firstChan) targetChannelId = firstChan.id
      }

      const { results } = await db.prepare(
        `SELECT m.id, m.channel_id, m.sender_id, m.content, m.attachment_key, m.attachment_name,
                m.reply_to_message_id, m.created_at,
                u.username AS sender_username, u.display_name AS sender_display_name
         FROM messages m
         LEFT JOIN users u ON u.id = m.sender_id
         WHERE m.channel_id = ? AND m.deleted_at IS NULL
         ORDER BY m.id DESC
         LIMIT ?`
      ).bind(targetChannelId, take).all()

      return text({ channelId, messages: results.reverse() })
    }
  )

  // ═══════════════════════════════════════════════════════
  // Cloud Document & Storage CRUD Tools
  // ═══════════════════════════════════════════════════════

  // ─── storage_list_files ───
  server.tool(
    'storage_list_files',
    'List uploaded files and documents in cloud storage.',
    {
      search: z.string().optional().describe('Optional search query to filter by filename'),
      limit: z.number().optional().describe('Max files to return (default 50)'),
    },
    async ({ search, limit = 50 }) => {
      const ctx = getContext('current')
      if (!ctx) return error('No auth context')
      const db = ctx.env.DB
      const take = Math.min(Math.max(Number(limit) || 50, 1), 100)

      let sql = `SELECT object_key, owner_user_id, filename, content_type, size, created_at
                 FROM uploaded_files
                 WHERE NOT EXISTS (SELECT 1 FROM pending_r2_delete WHERE pending_r2_delete.object_key = uploaded_files.object_key)`
      const params: any[] = []
      if (search && search.trim()) {
        sql += ` AND filename LIKE ?`
        params.push(`%${search.trim()}%`)
      }
      sql += ` ORDER BY created_at DESC LIMIT ?`
      params.push(take)

      const { results } = await db.prepare(sql).bind(...params).all()
      const files = results.map((r: any) => ({
        key: r.object_key,
        name: r.filename,
        type: r.content_type,
        size: Number(r.size || 0),
        url: `${ctx.origin}/files/${encodeURIComponent(r.object_key)}`,
        createdAt: r.created_at,
      }))
      return text({ files, count: files.length })
    }
  )

  // ─── storage_upload_file ───
  server.tool(
    'storage_upload_file',
    'Upload a document, attachment, image, or file to cloud storage. Accepts text content or base64 encoded data. Supports folderId, shareToken, project subfolder, and autoTimestamp.',
    {
      filename: z.string().optional().describe('File name including extension (e.g. report.pdf, doc.md, data.json)'),
      fileName: z.string().optional().describe('Alias for filename'),
      content: z.string().optional().describe('File content: plain text or Base64 encoded string'),
      contentBase64: z.string().optional().describe('Alias for content (when isBase64 is true)'),
      isBase64: z.boolean().optional().describe('Whether the content is base64 encoded (default false)'),
      contentType: z.string().optional().describe('MIME type (optional, inferred from extension if omitted)'),
      folderId: z.number().optional().describe('Folder ID to upload the file into (optional)'),
      shareToken: z.string().optional().describe('Share token (e.g. "agent-shared") to resolve folder automatically (optional)'),
      project: z.string().optional().describe('Project subfolder name inside shared folder (optional)'),
      autoTimestamp: z.boolean().optional().describe('Prefix filename with YYYYMMDD_HHmmss_ (default false)'),
    },
    async (args) => {
      let filename = args.filename || args.fileName
      if (!filename) return error('filename is required')
      const rawContent = args.content ?? args.contentBase64
      if (rawContent === undefined || rawContent === null) return error('content is required')
      const isBase64 = args.isBase64 || Boolean(args.contentBase64)
      const contentType = args.contentType
      const content = String(rawContent)
      const ctx = getContext('current')
      if (!ctx) return error('No auth context')
      const db = ctx.env.DB

      // Resolve target folder and owner
      let targetFolderId: number | null = args.folderId ?? null
      let targetOwnerId = Number(ctx.userId) || 1

      if (args.shareToken) {
        if (args.shareToken === AGENT_SHARED_TOKEN) {
          const agentFolder = await ensureAgentSharedFolder(db)
          targetFolderId = agentFolder.id
          targetOwnerId = agentFolder.ownerUserId
        } else {
          const shareRow = await db.prepare(
            `SELECT folder_id, owner_user_id FROM storage_shares WHERE token = ? LIMIT 1`
          ).bind(args.shareToken).first() as any
          if (shareRow?.folder_id) {
            targetFolderId = shareRow.folder_id
            targetOwnerId = Number(shareRow.owner_user_id) || targetOwnerId
          }
        }
      }

      if (args.project) {
        if (!targetFolderId) {
          const agentFolder = await ensureAgentSharedFolder(db)
          targetFolderId = agentFolder.id
          targetOwnerId = agentFolder.ownerUserId
        }
        targetFolderId = await ensureProjectFolder(db, targetFolderId, args.project, targetOwnerId)
      }

      if (args.autoTimestamp) {
        filename = applyAutoTimestamp(filename)
      }

      let bytes: Uint8Array
      if (isBase64) {
        const binary = atob(content)
        bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      } else {
        bytes = new TextEncoder().encode(content)
      }

      const mime = contentType || getMimeTypeFromFilename(filename)
      const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : ''
      const key = `${targetOwnerId}/${Date.now()}-${nanoid(10)}${ext}`

      // Encrypt and store to R2
      const envWithStorage = ctx.env as any
      const filesBucket = envWithStorage.FILES || envWithStorage.STORAGE
      if (!filesBucket) return error('Storage bucket not configured')

      // Encrypt using EdgeChat encryption if available, or write directly
      try {
        const { encryptAttachment } = await import('../../../encryption.js' as any)
        const encrypted = await encryptAttachment(ctx.env, bytes.buffer, key)
        await filesBucket.put(key, encrypted, {
          httpMetadata: { contentType: mime, cacheControl: 'private, no-store' },
          customMetadata: { filename, edgechatEncryption: 'v1' },
        })
      } catch {
        await filesBucket.put(key, bytes.buffer, {
          httpMetadata: { contentType: mime, cacheControl: 'private, no-store' },
          customMetadata: { filename },
        })
      }

      // Record in uploaded_files
      await db.prepare(
        `INSERT INTO uploaded_files (object_key, owner_user_id, filename, content_type, size, folder_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(object_key) DO UPDATE SET filename = excluded.filename, size = excluded.size, folder_id = excluded.folder_id`
      ).bind(key, targetOwnerId, filename, mime, bytes.byteLength, targetFolderId).run()

      const fileUrl = `${ctx.origin}/files/${encodeURIComponent(key)}`
      return text({
        uploaded: true,
        file: {
          key,
          name: filename,
          filename,
          type: mime,
          size: bytes.byteLength,
          folderId: targetFolderId,
          project: args.project || null,
          url: fileUrl,
        },
      })
    }
  )

  // ─── storage_get_file_info ───
  server.tool(
    'storage_get_file_info',
    'Get metadata and download URL for an uploaded file by its key.',
    {
      key: z.string().describe('File object_key in storage'),
    },
    async ({ key }) => {
      const ctx = getContext('current')
      if (!ctx) return error('No auth context')
      const db = ctx.env.DB

      const row = await db.prepare(
        `SELECT object_key, owner_user_id, filename, content_type, size, created_at
         FROM uploaded_files
         WHERE object_key = ? OR filename = ? LIMIT 1`
      ).bind(key, key).first() as any

      if (!row) return error('File not found')

      return text({
        file: {
          key: row.object_key,
          name: row.filename,
          type: row.content_type,
          size: Number(row.size || 0),
          url: `${ctx.origin}/files/${encodeURIComponent(row.object_key)}`,
          createdAt: row.created_at,
        },
      })
    }
  )

  // ─── storage_delete_file ───
  server.tool(
    'storage_delete_file',
    'Permanently delete a file from cloud storage by its key.',
    {
      key: z.string().describe('File object_key in storage'),
    },
    async ({ key }) => {
      const ctx = getContext('current')
      if (!ctx) return error('No auth context')
      const db = ctx.env.DB
      const envWithStorage = ctx.env as any
      const filesBucket = envWithStorage.FILES || envWithStorage.STORAGE

      if (filesBucket) {
        await filesBucket.delete(key).catch(() => {})
      }
      await db.prepare('DELETE FROM uploaded_files WHERE object_key = ?').bind(key).run()

      return text({ deleted: true, key })
    }
  )

  // ─── storage_get_latest_file ───
  server.tool(
    'storage_get_latest_file',
    'Get the latest uploaded file metadata and its decrypted text content from cloud storage or a specific folder/project.',
    {
      folderId: z.number().optional().describe('Folder ID to get latest file from (optional)'),
      shareToken: z.string().optional().describe('Share token (e.g. "agent-shared") to query (optional)'),
      folderName: z.string().optional().describe('Folder name to search in (optional)'),
      project: z.string().optional().describe('Project subfolder name inside shared folder (optional)'),
    },
    async (args) => {
      const ctx = getContext('current')
      if (!ctx) return error('No auth context')
      const db = ctx.env.DB

      let targetFolderIds: number[] = []

      if (args.shareToken) {
        if (args.shareToken === AGENT_SHARED_TOKEN) {
          const agentFolder = await ensureAgentSharedFolder(db)
          if (args.project) {
            const projFolder = await db.prepare(
              `SELECT id FROM storage_folders WHERE parent_id = ? AND name = ? AND trashed_at IS NULL AND deleted_at IS NULL LIMIT 1`
            ).bind(agentFolder.id, args.project).first() as any
            if (projFolder?.id) {
              targetFolderIds = await getDescendantFolderIds(db, projFolder.id)
            } else {
              return error(`Project "${args.project}" not found in shared folder`)
            }
          } else {
            targetFolderIds = await getDescendantFolderIds(db, agentFolder.id)
          }
        } else {
          const shareRow = await db.prepare(
            `SELECT folder_id FROM storage_shares WHERE token = ? LIMIT 1`
          ).bind(args.shareToken).first() as any
          if (shareRow?.folder_id) {
            if (args.project) {
              const projFolder = await db.prepare(
                `SELECT id FROM storage_folders WHERE parent_id = ? AND name = ? AND trashed_at IS NULL AND deleted_at IS NULL LIMIT 1`
              ).bind(shareRow.folder_id, args.project).first() as any
              if (projFolder?.id) {
                targetFolderIds = await getDescendantFolderIds(db, projFolder.id)
              }
            } else {
              targetFolderIds = await getDescendantFolderIds(db, shareRow.folder_id)
            }
          }
        }
      } else if (args.folderName) {
        const fld = await db.prepare(
          `SELECT id FROM storage_folders WHERE name = ? AND trashed_at IS NULL AND deleted_at IS NULL LIMIT 1`
        ).bind(args.folderName).first() as any
        if (fld?.id) {
          if (args.project) {
            const projFolder = await db.prepare(
              `SELECT id FROM storage_folders WHERE parent_id = ? AND name = ? AND trashed_at IS NULL AND deleted_at IS NULL LIMIT 1`
            ).bind(fld.id, args.project).first() as any
            if (projFolder?.id) targetFolderIds = await getDescendantFolderIds(db, projFolder.id)
          } else {
            targetFolderIds = await getDescendantFolderIds(db, fld.id)
          }
        }
      } else if (args.folderId) {
        if (args.project) {
          const projFolder = await db.prepare(
            `SELECT id FROM storage_folders WHERE parent_id = ? AND name = ? AND trashed_at IS NULL AND deleted_at IS NULL LIMIT 1`
          ).bind(args.folderId, args.project).first() as any
          if (projFolder?.id) targetFolderIds = await getDescendantFolderIds(db, projFolder.id)
        } else {
          targetFolderIds = await getDescendantFolderIds(db, args.folderId)
        }
      } else if (args.project) {
        const agentFolder = await ensureAgentSharedFolder(db)
        const projFolder = await db.prepare(
          `SELECT id FROM storage_folders WHERE parent_id = ? AND name = ? AND trashed_at IS NULL AND deleted_at IS NULL LIMIT 1`
        ).bind(agentFolder.id, args.project).first() as any
        if (projFolder?.id) {
          targetFolderIds = await getDescendantFolderIds(db, projFolder.id)
        } else {
          return error(`Project "${args.project}" not found`)
        }
      }

      let sql = `
        SELECT uf.object_key, uf.owner_user_id, uf.filename, uf.content_type, uf.size, uf.created_at, uf.folder_id, f.name as folder_name
        FROM uploaded_files uf
        LEFT JOIN storage_folders f ON f.id = uf.folder_id
        WHERE NOT EXISTS (SELECT 1 FROM pending_r2_delete WHERE pending_r2_delete.object_key = uf.object_key)
          AND uf.trashed_at IS NULL
      `
      const params: any[] = []
      if (targetFolderIds.length > 0) {
        const placeholders = targetFolderIds.map(() => '?').join(',')
        sql += ` AND uf.folder_id IN (${placeholders})`
        params.push(...targetFolderIds)
      }
      sql += ` ORDER BY uf.created_at DESC LIMIT 1`

      const row = await db.prepare(sql).bind(...params).first() as any
      if (!row) return error('No files found')

      // Decrypt text content from R2
      let textContent = ''
      const envWithStorage = ctx.env as any
      const filesBucket = envWithStorage.FILES || envWithStorage.STORAGE
      if (filesBucket) {
        const obj = await filesBucket.get(row.object_key)
        if (obj) {
          const buf = await obj.arrayBuffer()
          try {
            const { decryptAttachment } = await import('../../../encryption.js' as any)
            const dec = await decryptAttachment(ctx.env, buf, row.object_key)
            textContent = new TextDecoder('utf-8').decode(dec.bytes)
          } catch {
            textContent = new TextDecoder('utf-8').decode(new Uint8Array(buf))
          }
        }
      }

      return text({
        file: {
          key: row.object_key,
          name: row.filename,
          filename: row.filename,
          type: row.content_type,
          size: Number(row.size || 0),
          folderId: row.folder_id,
          folderName: row.folder_name,
          project: row.folder_name && row.folder_name !== AGENT_SHARED_FOLDER_NAME ? row.folder_name : null,
          url: `${ctx.origin}/files/${encodeURIComponent(row.object_key)}`,
          createdAt: row.created_at,
          content: textContent,
        },
      })
    }
  )

  // ─── storage_read_file ───
  server.tool(
    'storage_read_file',
    'Read and decrypt the text content of any file in cloud storage by its key.',
    {
      key: z.string().describe('File object_key in storage'),
    },
    async ({ key }) => {
      const ctx = getContext('current')
      if (!ctx) return error('No auth context')
      const db = ctx.env.DB

      const row = await db.prepare(
        `SELECT object_key, owner_user_id, filename, content_type, size, created_at, folder_id
         FROM uploaded_files
         WHERE object_key = ? LIMIT 1`
      ).bind(key).first() as any

      if (!row) return error('File not found')

      const envWithStorage = ctx.env as any
      const filesBucket = envWithStorage.FILES || envWithStorage.STORAGE
      if (!filesBucket) return error('Storage bucket not configured')

      const obj = await filesBucket.get(key)
      if (!obj) return error('File object not found in storage bucket')

      let textContent = ''
      const buf = await obj.arrayBuffer()
      try {
        const { decryptAttachment } = await import('../../../encryption.js' as any)
        const dec = await decryptAttachment(ctx.env, buf, key)
        textContent = new TextDecoder('utf-8').decode(dec.bytes)
      } catch {
        textContent = new TextDecoder('utf-8').decode(new Uint8Array(buf))
      }

      return text({
        file: {
          key: row.object_key,
          filename: row.filename,
          name: row.filename,
          size: Number(row.size || 0),
          contentType: row.content_type,
          createdAt: row.created_at,
          content: textContent,
        },
      })
    }
  )
}

function getMimeTypeFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    txt: 'text/plain',
    md: 'text/markdown',
    json: 'application/json',
    csv: 'text/csv',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    zip: 'application/zip',
    tar: 'application/x-tar',
    gz: 'application/gzip',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    mp3: 'audio/mpeg',
    mp4: 'video/mp4',
    wav: 'audio/wav',
    html: 'text/plain',
    js: 'text/javascript',
    ts: 'text/plain',
    py: 'text/plain',
  }
  return map[ext] || 'application/octet-stream'
}

// ─── Context management ───
// Store per-session context (userId, env, origin) for tool handlers

type McpContext = {
  userId: string
  env: Env
  origin: string
}

const contextMap = new Map<string, McpContext>()

export function setContext(sessionId: string, ctx: McpContext) {
  contextMap.set(sessionId, ctx)
}

export function getContext(sessionId: string): McpContext | undefined {
  return contextMap.get(sessionId)
}

export function deleteContext(sessionId: string) {
  contextMap.delete(sessionId)
}
