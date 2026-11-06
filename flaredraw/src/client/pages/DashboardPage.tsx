import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type Drawing } from '@/client/lib/api-client'
import { useThemeContext } from '@/client/components/ThemeProvider'
import { NotesWorkspace } from '@/client/components/notes/NotesWorkspace'
import { AiAgentMcpModal } from '@/client/components/AiAgentMcpModal'

const themeIcons: Record<string, string> = {
  light: '☀️',
  dark: '🌙',
  system: '💻',
}

export function DashboardPage() {
  const initialTab = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('tab') === 'notes' ? 'notes' : 'drawings'
  const [activeTab, setActiveTab] = useState<'drawings' | 'notes'>(initialTab)
  const [drawings, setDrawings] = useState<Drawing[]>([])
  const [loading, setLoading] = useState(true)
  const [isMcpModalOpen, setIsMcpModalOpen] = useState(false)
  const navigate = useNavigate()
  const { theme, cycleTheme } = useThemeContext()

  useEffect(() => {
    if (activeTab === 'drawings') {
      api.drawings.list().then((data) => {
        setDrawings(data.drawings)
        setLoading(false)
      })
    }
  }, [activeTab])

  async function handleNew() {
    const { id } = await api.drawings.create()
    navigate(`/draw/${id}`)
  }

  async function handleDelete(id: string) {
    if (!confirm('确定删除此绘图吗？')) return
    await api.drawings.delete(id)
    setDrawings((prev) => prev.filter((d) => d.id !== id))
  }

  async function handleLogout() {
    try {
      await api.auth.signOut()
    } finally {
      window.location.href = '/flaredraw/login'
    }
  }

  function formatDate(dateStr: string | null) {
    if (!dateStr) return '从未修改'
    return new Date(dateStr).toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col">
      {/* ─── Top Global Navigation ─── */}
      <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/95 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-900/95">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 sm:px-6 py-2.5">
          {/* Logo Brand */}
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 text-sm font-black shadow-xs">
                F
              </span>
              <span>FlareDraw</span>
            </h1>
          </div>

          {/* Dual Workspace Segmented Switcher */}
          <div className="flex items-center rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800/90 border border-zinc-200/60 dark:border-zinc-700/60">
            <button
              onClick={() => setActiveTab('drawings')}
              className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'drawings'
                  ? 'bg-white text-zinc-900 shadow-xs dark:bg-zinc-900 dark:text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              <span>🎨</span>
              <span>白板绘图</span>
            </button>
            <button
              onClick={() => setActiveTab('notes')}
              className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'notes'
                  ? 'bg-white text-amber-700 shadow-xs dark:bg-zinc-900 dark:text-amber-400'
                  : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              <span>📝</span>
              <span>备忘录</span>
            </button>
          </div>

          {/* Right Header Actions */}
          <div className="flex items-center gap-2.5">
            {/* 🤖 AI Agent (MCP) Entrance Button */}
            <button
              onClick={() => setIsMcpModalOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50/80 px-3 py-1.5 text-xs font-semibold text-purple-700 shadow-xs transition-all hover:bg-purple-100 hover:border-purple-300 active:scale-95 dark:border-purple-800/80 dark:bg-purple-950/50 dark:text-purple-300 dark:hover:bg-purple-900/60 cursor-pointer"
              title="配置与连接 AI Agent MCP 助手"
            >
              <span className="text-sm">🤖</span>
              <span>AI Agent (MCP) 接入</span>
            </button>

            {activeTab === 'drawings' && (
              <button
                onClick={handleNew}
                className="flex items-center gap-1.5 rounded-md bg-zinc-900 px-3.5 py-1.5 text-xs font-medium text-white transition-all hover:bg-zinc-800 active:scale-95 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 shadow-xs cursor-pointer"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                <span>新建绘图</span>
              </button>
            )}
            <button
              onClick={cycleTheme}
              className="rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 cursor-pointer"
              title={`主题: ${theme}`}
            >
              {themeIcons[theme]}
            </button>
            <button
              onClick={() => navigate('/settings')}
              className="rounded-md border border-zinc-200 bg-white p-1.5 text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 cursor-pointer"
              title="设置"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            <button
              onClick={handleLogout}
              className="rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-red-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 dark:hover:text-red-400 cursor-pointer"
            >
              退出
            </button>
          </div>
        </div>
      </header>

      {/* ─── Main Content Views ─── */}
      {activeTab === 'drawings' ? (
        <main className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-8 flex-1">
          {loading ? (
            <div className="text-center py-20 text-sm text-zinc-500">正在加载绘图...</div>
          ) : drawings.length === 0 ? (
            <div className="py-24 text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400 dark:bg-zinc-800">
                <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </div>
              <p className="text-base font-medium text-zinc-700 dark:text-zinc-300">还没有绘图作品</p>
              <p className="mt-1 text-xs text-zinc-400">
                点击上方“新建绘图”开启无边画布
              </p>
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {drawings.map((drawing) => (
                <div
                  key={drawing.id}
                  className="group cursor-pointer rounded-xl border border-zinc-200 bg-white p-4 transition-all hover:shadow-md hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 shadow-xs"
                  onClick={() => navigate(`/draw/${drawing.id}`)}
                >
                  <div className="mb-3 flex h-36 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800/80 transition-colors group-hover:bg-zinc-200/50 dark:group-hover:bg-zinc-800">
                    <span className="text-sm font-medium text-zinc-400 dark:text-zinc-500">
                      {drawing.elementCount ?? 0} 个图形元素
                    </span>
                  </div>
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold text-sm text-zinc-900 dark:text-zinc-100">
                        {drawing.title || '无标题绘图'}
                      </h3>
                      <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500 font-mono">
                        {formatDate(drawing.lastModified)}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(drawing.id)
                      }}
                      className="ml-2 rounded p-1 text-zinc-400 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100 cursor-pointer"
                      title="删除绘图"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      ) : (
        <NotesWorkspace />
      )}

      {/* AI Agent (MCP) Modal */}
      <AiAgentMcpModal isOpen={isMcpModalOpen} onClose={() => setIsMcpModalOpen(false)} />
    </div>
  )
}
