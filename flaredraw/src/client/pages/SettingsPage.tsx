import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

type ApiToken = {
  id: string
  name: string
  tokenPrefix: string
  lastUsedAt: string | null
  expiresAt: string | null
  createdAt: string
}

const API_BASE = '/api'

export function SettingsPage() {
  const [tokens, setTokens] = useState<ApiToken[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newTokenName, setNewTokenName] = useState('')
  const [newTokenValue, setNewTokenValue] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const navigate = useNavigate()

  const loadTokens = useCallback(async () => {
    const res = await fetch(`${API_BASE}/api-tokens`, { credentials: 'include' })
    if (res.ok) {
      const data = await res.json()
      setTokens(data.tokens)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadTokens()
  }, [loadTokens])

  async function handleCreate() {
    if (!newTokenName.trim()) return
    setCreating(true)
    try {
      const res = await fetch(`${API_BASE}/api-tokens`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTokenName.trim() }),
      })
      if (res.ok) {
        const data = await res.json()
        setNewTokenValue(data.token)
        setNewTokenName('')
        loadTokens()
      }
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this API token? Any integrations using it will stop working.')) return
    await fetch(`${API_BASE}/api-tokens/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    loadTokens()
  }

  async function handleCopy(text: string) {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function formatDate(dateStr: string | null) {
    if (!dateStr) return 'Never'
    return new Date(dateStr).toLocaleDateString('en-AU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const mcpConfigOAuth = JSON.stringify(
    {
      mcpServers: {
        flaredraw: {
          url: 'https://draw.flared.au/api/mcp/message',
        },
      },
    },
    null,
    2,
  )

  const mcpConfigToken = JSON.stringify(
    {
      mcpServers: {
        flaredraw: {
          url: 'https://draw.flared.au/api/mcp/message',
          headers: {
            Authorization: 'Bearer YOUR_TOKEN_HERE',
          },
        },
      },
    },
    null,
    2,
  )

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/')}
              className="text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Settings</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8 space-y-10">
        {/* API Tokens Section */}
        <section>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">API Tokens</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Create tokens to access FlareDraw via the API or MCP.
          </p>

          {/* New token display (shown once after creation) */}
          {newTokenValue && (
            <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950">
              <p className="text-sm font-medium text-green-800 dark:text-green-200">
                Token created! Copy it now — it won't be shown again.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 overflow-x-auto rounded bg-white px-3 py-2 text-xs font-mono text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
                  {newTokenValue}
                </code>
                <button
                  onClick={() => handleCopy(newTokenValue)}
                  className="shrink-0 rounded-md bg-green-600 px-3 py-2 text-xs font-medium text-white hover:bg-green-700"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <button
                onClick={() => setNewTokenValue(null)}
                className="mt-2 text-xs text-green-700 underline dark:text-green-300"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Create token form */}
          <div className="mt-4 flex items-center gap-2">
            <input
              type="text"
              value={newTokenName}
              onChange={(e) => setNewTokenName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="Token name (e.g. Claude AI)"
              className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
            />
            <button
              onClick={handleCreate}
              disabled={creating || !newTokenName.trim()}
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {creating ? 'Creating...' : 'Create Token'}
            </button>
          </div>

          {/* Token list */}
          {loading ? (
            <p className="mt-4 text-sm text-zinc-500">Loading tokens...</p>
          ) : tokens.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">No API tokens yet.</p>
          ) : (
            <div className="mt-4 divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {tokens.map((token) => (
                <div key={token.id} className="flex items-center justify-between px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{token.name}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      <code className="font-mono">{token.tokenPrefix}</code>
                      {' · '}
                      Created {formatDate(token.createdAt)}
                      {token.lastUsedAt && ` · Last used ${formatDate(token.lastUsedAt)}`}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDelete(token.id)}
                    className="ml-4 shrink-0 rounded p-1 text-zinc-400 transition-colors hover:text-red-500"
                    title="Delete token"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* MCP Configuration Section */}
        <section>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">MCP Configuration</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Add this to your Claude AI or Claude Code MCP settings to use FlareDraw tools.
          </p>

          <h3 className="mt-4 text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Option 1: OAuth (recommended)
          </h3>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Claude will prompt you to sign in with Google. No token needed.
          </p>
          <div className="mt-2 relative">
            <pre className="overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-100 p-4 text-xs font-mono text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
              {mcpConfigOAuth}
            </pre>
            <button
              onClick={() => handleCopy(mcpConfigOAuth)}
              className="absolute right-2 top-2 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>

          <h3 className="mt-4 text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Option 2: API Token
          </h3>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Create a token above and paste it into the config.
          </p>
          <div className="mt-2 relative">
            <pre className="overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-100 p-4 text-xs font-mono text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
              {mcpConfigToken}
            </pre>
            <button
              onClick={() => handleCopy(mcpConfigToken)}
              className="absolute right-2 top-2 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </section>

        {/* API Usage Section */}
        <section>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">API Usage</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Create diagrams programmatically and get shareable links.
          </p>
          <div className="mt-3">
            <pre className="overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-100 p-4 text-xs font-mono text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">{`# Create a diagram with a share link
curl -X POST https://draw.flared.au/api/v1/diagram \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "My Diagram",
    "elements": [
      {
        "type": "rectangle",
        "x": 0, "y": 0,
        "width": 200, "height": 100,
        "strokeColor": "#000",
        "backgroundColor": "transparent",
        "fillStyle": "hachure",
        "strokeWidth": 1,
        "roughness": 1,
        "opacity": 100
      }
    ]
  }'

# Response:
# {
#   "drawingId": "abc123",
#   "shareId": "xyz789",
#   "shareUrl": "https://draw.flared.au/s/xyz789",
#   "pngUrl": "https://draw.flared.au/api/shares/xyz789/png",
#   "editUrl": "https://draw.flared.au/draw/abc123"
# }`}</pre>
          </div>
        </section>
      </main>
    </div>
  )
}
