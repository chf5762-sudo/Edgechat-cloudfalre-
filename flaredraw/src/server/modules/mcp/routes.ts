import { Hono } from 'hono'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createMcpServer, registerResources, registerTools, setContext, deleteContext } from './server'

type Bindings = {
  DB: D1Database
  STORAGE: R2Bucket
  BROWSER: Fetcher
}

type Variables = {
  user: { id: string; name: string; email: string }
}

const mcpRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// MCP server info (public, for discovery)
mcpRoutes.get('/', (c) => {
  return c.json({
    name: 'FlareDraw',
    version: '1.0.0',
    description: 'Create and manage Excalidraw drawings on draw.flared.au',
    instructions: 'IMPORTANT: Call the read_guide tool before creating your first diagram — it contains element sizing rules that prevent text clipping and layout issues. Use create_diagram for one-step diagram creation with shareable link. Use create_drawing + update_drawing for iterative editing. Drawings are stored as standard Excalidraw JSON.',
    transports: ['streamable-http'],
    endpoints: {
      message: '/api/mcp/message',
    },
  })
})

// Streamable HTTP transport — handles all MCP messages (POST, GET, DELETE)
mcpRoutes.all('/message', async (c) => {
  const user = c.get('user')
  const origin = new URL(c.req.url).origin

  // Create fresh server + transport per request (stateless mode for Workers)
  const server = createMcpServer()
  registerResources(server)
  registerTools(server)

  const transport = new WebStandardStreamableHTTPServerTransport({
    // Stateless mode — no session persistence across requests
    sessionIdGenerator: undefined,
    // Return JSON instead of SSE stream for simple request/response
    enableJsonResponse: true,
  })

  // Set auth context before connecting
  // Use a fixed session key since we're stateless
  const contextKey = 'current'
  setContext(contextKey, {
    userId: user.id,
    env: c.env,
    origin,
  })

  await server.connect(transport)

  try {
    // The transport handles the full Request → Response lifecycle
    const response = await transport.handleRequest(c.req.raw)
    return response
  } finally {
    deleteContext(contextKey)
    await transport.close()
    await server.close()
  }
})

export { mcpRoutes }
