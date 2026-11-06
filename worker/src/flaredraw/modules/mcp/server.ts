import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { nanoid } from 'nanoid'
import { eq, desc, and } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { z } from 'zod'
import { drawings, shares, notes } from '../../db/schema'
import { generatePng } from '../export/png'

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
| 1 | Virgil | Handwriting | Legacy — use 5 instead |
| 2 | Helvetica | Sans-serif | Professional/formal diagrams |
| 3 | Cascadia | Monospace | Code, technical labels |
| 5 | Excalifont | Handwriting | **Default** — casual diagrams |

**Always use fontFamily: 5** unless specifically asked for a professional style (use 2) or code (use 3).

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
  "fontFamily": 5,
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
      drawingId: z.string().describe('Drawing ID'),
    },
    async ({ drawingId }) => {
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
      const drawingElements = elements || []

      const content = JSON.stringify({
        type: 'excalidraw',
        version: 2,
        source: 'flaredraw',
        elements: drawingElements,
        appState: { viewBackgroundColor: '#ffffff', ...appState },
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
      drawingId: z.string().describe('Drawing ID to update'),
      title: z.string().optional().describe('New title'),
      elements: z.array(z.record(z.unknown())).optional().describe('New Excalidraw elements array'),
      appState: z.record(z.unknown()).optional().describe('New appState'),
    },
    async ({ drawingId, title, elements, appState }) => {
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
      drawingId: z.string().describe('Drawing ID to delete'),
    },
    async ({ drawingId }) => {
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
      drawingId: z.string().describe('Drawing ID to share'),
    },
    async ({ drawingId }) => {
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
      const drawingElements = elements || []
      const drawingTitle = title?.trim() || 'Untitled'

      const drawingR2Key = `drawings/${ctx.userId}/${drawingId}.excalidraw`
      const shareR2Key = `shares/${shareId}.excalidraw`

      const content = JSON.stringify({
        type: 'excalidraw',
        version: 2,
        source: 'flaredraw',
        elements: drawingElements,
        appState: { viewBackgroundColor: '#ffffff', ...appState },
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
