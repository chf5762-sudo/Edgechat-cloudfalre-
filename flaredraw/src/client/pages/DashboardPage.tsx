import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api, type Drawing } from '@/client/lib/api-client'
import { useThemeContext } from '@/client/components/ThemeProvider'
import { NotesWorkspace } from '@/client/components/notes/NotesWorkspace'

const themeIcons: Record<string, string> = {
  light: '☀️',
  dark: '🌙',
  system: '💻',
}

export function DashboardPage() {
  const initialTab =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('tab') === 'notes'
      ? 'notes'
      : 'drawings'
  const [activeTab, setActiveTab] = useState<'drawings' | 'notes'>(initialTab)
  const [drawings, setDrawings] = useState<Drawing[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedProject, setSelectedProject] = useState<string>('ALL')
  const [batchMode, setBatchMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)

  const navigate = useNavigate()
  const { theme, cycleTheme } = useThemeContext()

  useEffect(() => {
    if (activeTab === 'drawings') {
      loadDrawings()
    }
  }, [activeTab])

  async function loadDrawings() {
    setLoading(true)
    try {
      const data = await api.drawings.list()
      setDrawings(data.drawings || [])
    } catch (err: any) {
      toast.error(err?.message ? `加载绘图失败: ${err.message}` : '加载绘图失败')
    } finally {
      setLoading(false)
    }
  }

  // ─── Project Capsules Calculation ───
  const projectList = useMemo(() => {
    const counts: Record<string, number> = {
      ALL: drawings.length,
      EdgeChat: 0,
      default: 0,
    }

    for (const d of drawings) {
      const raw = d.project?.trim() || 'default'
      if (raw.toLowerCase() === 'edgechat') {
        counts.EdgeChat = (counts.EdgeChat || 0) + 1
      } else if (raw === 'default') {
        counts.default = (counts.default || 0) + 1
      } else {
        counts[raw] = (counts[raw] || 0) + 1
      }
    }

    const customProjects = Object.keys(counts).filter(
      (k) => k !== 'ALL' && k !== 'EdgeChat' && k !== 'default'
    )

    return [
      { key: 'ALL', label: '全部', count: counts.ALL || 0 },
      { key: 'EdgeChat', label: 'EdgeChat', count: counts.EdgeChat || 0 },
      { key: 'default', label: '默认项目', count: counts.default || 0 },
      ...customProjects.map((p) => ({
        key: p,
        label: p,
        count: counts[p] || 0,
      })),
    ]
  }, [drawings])

  // Filter drawings according to active capsule
  const filteredDrawings = useMemo(() => {
    if (selectedProject === 'ALL') return drawings
    if (selectedProject === 'EdgeChat') {
      return drawings.filter((d) => (d.project || '').toLowerCase() === 'edgechat')
    }
    if (selectedProject === 'default') {
      return drawings.filter((d) => !d.project || d.project === 'default')
    }
    return drawings.filter((d) => d.project === selectedProject)
  }, [drawings, selectedProject])

  async function handleNew() {
    try {
      const createPayload =
        selectedProject !== 'ALL' && selectedProject !== 'default'
          ? { project: selectedProject }
          : undefined
      const { id } = await api.drawings.create(createPayload)
      navigate(`/draw/${id}`)
    } catch (err: any) {
      toast.error(err?.message ? `创建失败: ${err.message}` : '创建绘图失败')
    }
  }

  // Single drawing deletion with friendly confirmation and toast
  async function handleDelete(e: React.MouseEvent, id: string, title?: string | null) {
    e.stopPropagation()
    const name = title ? `“${title}”` : '此绘图'
    if (!confirm(`确定删除${name}吗？此操作无法撤销。`)) return

    try {
      setDeleting(true)
      await api.drawings.delete(id)
      setDrawings((prev) => prev.filter((d) => d.id !== id))
      setSelectedIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      toast.success('绘图已成功删除')
    } catch (err: any) {
      toast.error(err?.message ? `删除失败: ${err.message}` : '删除失败，请稍后重试')
    } finally {
      setDeleting(false)
    }
  }

  // Toggle selection of a single card
  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Check if all currently visible drawings are selected
  const allVisibleSelected =
    filteredDrawings.length > 0 &&
    filteredDrawings.every((d) => selectedIds.has(d.id))

  function handleToggleSelectAll() {
    if (allVisibleSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        for (const d of filteredDrawings) next.delete(d.id)
        return next
      })
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        for (const d of filteredDrawings) next.add(d.id)
        return next
      })
    }
  }

  // Batch delete drawings with confirmation and feedback
  async function handleBatchDelete() {
    const count = selectedIds.size
    if (count === 0) return
    if (!confirm(`确定批量删除选中的 ${count} 个绘图吗？此操作无法撤销。`)) return

    try {
      setDeleting(true)
      const idsToDelete = Array.from(selectedIds)
      const res = await api.drawings.batchDelete(idsToDelete)
      const deletedSet = new Set(res.ids || idsToDelete)

      setDrawings((prev) => prev.filter((d) => !deletedSet.has(d.id)))
      setSelectedIds(new Set())
      setBatchMode(false)
      toast.success(`成功批量删除 ${res.deleted} 个绘图`)
    } catch (err: any) {
      toast.error(err?.message ? `批量删除失败: ${err.message}` : '批量删除失败')
    } finally {
      setDeleting(false)
    }
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
          <div className="flex items-center gap-2">
            {activeTab === 'drawings' && (
              <>
                <button
                  onClick={() => {
                    const nextMode = !batchMode
                    setBatchMode(nextMode)
                    if (!nextMode) setSelectedIds(new Set())
                  }}
                  className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-all shadow-xs cursor-pointer ${
                    batchMode
                      ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950/40 dark:text-blue-300 font-semibold'
                      : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700'
                  }`}
                  title={batchMode ? '退出批量选择' : '进入批量管理模式'}
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                  <span>{batchMode ? '完成管理' : '批量管理'}</span>
                </button>

                <button
                  onClick={handleNew}
                  className="flex items-center gap-1.5 rounded-md bg-zinc-900 px-3.5 py-1.5 text-xs font-medium text-white transition-all hover:bg-zinc-800 active:scale-95 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 shadow-xs cursor-pointer"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  <span>新建绘图</span>
                </button>
              </>
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
        <main className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-6 flex-1 pb-24">
          {/* Project Filtering Capsule Bar */}
          <div className="mb-6 flex items-center gap-2 overflow-x-auto pb-1.5 scrollbar-none">
            {projectList.map((item) => {
              const isSelected = selectedProject === item.key
              return (
                <button
                  key={item.key}
                  onClick={() => setSelectedProject(item.key)}
                  className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium transition-all cursor-pointer whitespace-nowrap shadow-2xs ${
                    isSelected
                      ? 'bg-zinc-900 text-white shadow-xs dark:bg-zinc-100 dark:text-zinc-900'
                      : 'bg-white text-zinc-600 hover:bg-zinc-100 border border-zinc-200/80 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:border-zinc-800'
                  }`}
                >
                  <span>{item.label}</span>
                  <span
                    className={`rounded-full px-1.5 py-0.2 text-[10px] font-semibold ${
                      isSelected
                        ? 'bg-white/25 text-white dark:bg-zinc-900/25 dark:text-zinc-900'
                        : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                    }`}
                  >
                    {item.count}
                  </span>
                </button>
              )
            })}
          </div>

          {loading ? (
            <div className="text-center py-20 text-sm text-zinc-500 flex flex-col items-center gap-2">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-400 border-t-zinc-800 dark:border-zinc-600 dark:border-t-white" />
              <span>正在加载绘图...</span>
            </div>
          ) : filteredDrawings.length === 0 ? (
            <div className="py-24 text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400 dark:bg-zinc-800">
                <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </div>
              <p className="text-base font-medium text-zinc-700 dark:text-zinc-300">
                {selectedProject === 'ALL' ? '还没有绘图作品' : `“${selectedProject}”分类下暂无绘图`}
              </p>
              <p className="mt-1 text-xs text-zinc-400">
                点击上方“新建绘图”开启无边画布
              </p>
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {filteredDrawings.map((drawing) => {
                const isSelected = selectedIds.has(drawing.id)
                const projName = drawing.project?.trim() || 'default'

                return (
                  <div
                    key={drawing.id}
                    className={`group relative cursor-pointer rounded-xl border p-4 transition-all shadow-xs ${
                      isSelected
                        ? 'border-blue-500 ring-2 ring-blue-500/30 bg-blue-50/20 dark:bg-blue-950/15'
                        : 'border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700'
                    }`}
                    onClick={() => {
                      if (batchMode) {
                        toggleSelect(drawing.id)
                      } else {
                        navigate(`/draw/${drawing.id}`)
                      }
                    }}
                  >
                    {/* Batch Selection Checkbox */}
                    {batchMode && (
                      <div className="absolute top-3 left-3 z-10">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleSelect(drawing.id)
                          }}
                          className={`flex h-6 w-6 items-center justify-center rounded-full border transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-blue-600 border-blue-600 text-white shadow-xs'
                              : 'bg-white/90 border-zinc-300 hover:border-zinc-400 dark:bg-zinc-800/90 dark:border-zinc-600'
                          }`}
                        >
                          {isSelected && (
                            <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          )}
                        </button>
                      </div>
                    )}

                    {/* Canvas Thumbnail Preview Box */}
                    <div className="mb-3 flex h-36 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800/80 transition-colors group-hover:bg-zinc-200/50 dark:group-hover:bg-zinc-800 relative overflow-hidden">
                      <span className="text-sm font-medium text-zinc-400 dark:text-zinc-500">
                        {drawing.elementCount ?? 0} 个图形元素
                      </span>
                      {/* Project Tag in Card Preview */}
                      <span className="absolute bottom-2 right-2 rounded-md bg-white/80 dark:bg-zinc-900/80 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:text-zinc-400 border border-zinc-200/60 dark:border-zinc-700/60 backdrop-blur-xs">
                        {projName === 'default' ? '默认项目' : projName}
                      </span>
                    </div>

                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate font-semibold text-sm text-zinc-900 dark:text-zinc-100">
                          {drawing.title || '无标题绘图'}
                        </h3>
                        <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500 font-mono">
                          {formatDate(drawing.lastModified)}
                        </p>
                      </div>

                      {/* Single Delete Action (visible in normal mode) */}
                      {!batchMode && (
                        <button
                          onClick={(e) => handleDelete(e, drawing.id, drawing.title)}
                          disabled={deleting}
                          className="ml-2 rounded p-1 text-zinc-400 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100 cursor-pointer"
                          title="删除绘图"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* ─── Floating Batch Actions Bar ─── */}
          {batchMode && (
            <aside aria-label="批量操作栏" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-2xl border border-zinc-200/90 bg-white/95 px-4 py-2.5 shadow-2xl backdrop-blur-md dark:border-zinc-700/90 dark:bg-zinc-900/95 max-w-[95vw]">
              <div className="flex items-center gap-2 pl-1 pr-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300 border-r border-zinc-200 dark:border-zinc-700">
                <span>已选择</span>
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[11px] font-bold text-white">
                  {selectedIds.size}
                </span>
                <span>个绘图</span>
              </div>

              <button
                type="button"
                onClick={handleToggleSelectAll}
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white transition-colors cursor-pointer"
              >
                {allVisibleSelected ? '取消全选' : '全选'}
              </button>

              <button
                type="button"
                onClick={handleBatchDelete}
                disabled={selectedIds.size === 0 || deleting}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-1.5 text-xs font-medium text-white shadow-xs hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                <span>{deleting ? '删除中...' : '批量删除'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setBatchMode(false)
                  setSelectedIds(new Set())
                }}
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer"
              >
                退出管理
              </button>
            </aside>
          )}
        </main>
      ) : (
        <NotesWorkspace />
      )}
    </div>
  )
}
