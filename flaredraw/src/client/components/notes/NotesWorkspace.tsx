import { useState, useEffect, useRef, useCallback } from 'react'
import { api, type Note } from '@/client/lib/api-client'

export function NotesWorkspace() {
  const [notes, setNotes] = useState<Note[]>([])
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')

  // Local editor draft state to prevent lag during rapid typing
  const [draftTitle, setDraftTitle] = useState('')
  const [draftContent, setDraftContent] = useState('')
  const activeNote = notes.find((n) => n.id === activeNoteId) || null

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const contentTextareaRef = useRef<HTMLTextAreaElement>(null)

  // Fetch initial note list
  const loadNotes = useCallback(async (selectFirst = true) => {
    try {
      const res = await api.notes.list()
      setNotes(res.notes)
      if (selectFirst && res.notes.length > 0 && !activeNoteId) {
        setActiveNoteId(res.notes[0].id)
      }
    } catch (err) {
      console.error('Failed to load notes', err)
    } finally {
      setLoading(false)
    }
  }, [activeNoteId])

  useEffect(() => {
    loadNotes()
  }, [loadNotes])

  // Sync draft state when active note changes
  useEffect(() => {
    if (activeNote) {
      setDraftTitle(activeNote.title || '')
      setDraftContent(activeNote.content || '')
      setSaveStatus('idle')
    } else {
      setDraftTitle('')
      setDraftContent('')
    }
  }, [activeNoteId]) // only sync on ID switch

  // Debounced auto-save handler (600ms)
  const scheduleAutoSave = (newTitle: string, newContent: string) => {
    if (!activeNoteId) return
    setSaveStatus('saving')

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    debounceTimerRef.current = setTimeout(async () => {
      try {
        const res = await api.notes.update(activeNoteId, {
          title: newTitle,
          content: newContent,
        })
        if (res.saved && res.note) {
          setNotes((prev) =>
            prev.map((n) => (n.id === activeNoteId ? res.note : n))
          )
          setSaveStatus('saved')
          setTimeout(() => setSaveStatus('idle'), 2000)
        }
      } catch (err) {
        console.error('Auto save failed', err)
        setSaveStatus('idle')
      }
    }, 600)
  }

  const handleTitleChange = (val: string) => {
    setDraftTitle(val)
    scheduleAutoSave(val, draftContent)
  }

  const handleContentChange = (val: string) => {
    setDraftContent(val)
    scheduleAutoSave(draftTitle, val)
  }

  // Create new note
  const handleCreateNote = async () => {
    try {
      const res = await api.notes.create({ title: '', content: '' })
      if (res.note) {
        setNotes((prev) => [res.note, ...prev])
        setActiveNoteId(res.note.id)
        setDraftTitle('')
        setDraftContent('')
        setTimeout(() => titleInputRef.current?.focus(), 50)
      }
    } catch (err) {
      console.error('Failed to create note', err)
    }
  }

  // Delete note
  const handleDeleteNote = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (!confirm('确定要删除这条备忘录吗？')) return

    try {
      await api.notes.delete(id)
      const remaining = notes.filter((n) => n.id !== id)
      setNotes(remaining)
      if (activeNoteId === id) {
        setActiveNoteId(remaining.length > 0 ? remaining[0].id : null)
      }
    } catch (err) {
      console.error('Failed to delete note', err)
    }
  }

  // Toggle pin
  const handleTogglePin = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    try {
      const res = await api.notes.togglePin(id)
      if (res.note) {
        setNotes((prev) => {
          const updated = prev.map((n) => (n.id === id ? res.note : n))
          // Sort: pinned first, then updatedAt DESC
          return updated.sort((a, b) => {
            if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
            return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          })
        })
      }
    } catch (err) {
      console.error('Failed to toggle pin', err)
    }
  }

  // Format date helper for iOS note list
  const formatNoteTime = (dateStr: string) => {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    const now = new Date()
    const isToday =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear()

    if (isToday) {
      return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }
    return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
  }

  const formatDetailTime = (dateStr: string) => {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${d.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    })}`
  }

  // Filter notes based on search query
  const filteredNotes = notes.filter((n) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return (
      (n.title && n.title.toLowerCase().includes(q)) ||
      (n.content && n.content.toLowerCase().includes(q))
    )
  })

  const pinnedNotes = filteredNotes.filter((n) => n.isPinned)
  const unpinnedNotes = filteredNotes.filter((n) => !n.isPinned)

  return (
    <div className="flex h-[calc(100vh-65px)] w-full overflow-hidden bg-white dark:bg-zinc-950">
      {/* ─── Left Sidebar: iOS Notes List ─── */}
      <aside className="flex w-72 sm:w-80 flex-shrink-0 flex-col border-r border-zinc-200 bg-zinc-50/70 dark:border-zinc-800 dark:bg-zinc-900/60 backdrop-blur-md">
        {/* Search & Actions Header */}
        <div className="p-3 border-b border-zinc-200/80 dark:border-zinc-800">
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
              <span>备忘录</span>
              <span className="text-xs font-normal text-zinc-400">({notes.length})</span>
            </h2>
            <button
              onClick={handleCreateNote}
              title="新建备忘录"
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 hover:bg-amber-500/25 active:scale-95 transition-all dark:bg-amber-400/20 dark:text-amber-400 cursor-pointer"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>

          {/* iOS Style Search Box */}
          <div className="relative">
            <svg
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="搜索全部备忘录..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-md border border-zinc-200/90 bg-white/90 py-1.5 pl-8 pr-3 text-xs text-zinc-800 placeholder-zinc-400 shadow-xs focus:border-amber-500 focus:outline-none dark:border-zinc-700/80 dark:bg-zinc-800/80 dark:text-zinc-200"
            />
          </div>
        </div>

        {/* Note List Items */}
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-4">
          {loading ? (
            <div className="py-12 text-center text-xs text-zinc-400">加载备忘录中...</div>
          ) : filteredNotes.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-xs text-zinc-400">
                {searchQuery ? '没有找到匹配的备忘录' : '暂无备忘录'}
              </p>
              {!searchQuery && (
                <button
                  onClick={handleCreateNote}
                  className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-amber-600 hover:underline dark:text-amber-400"
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  新建第一条备忘录
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Pinned Notes Group */}
              {pinnedNotes.length > 0 && (
                <div className="space-y-1">
                  <div className="px-2 pb-1 text-[11px] font-semibold tracking-wider uppercase text-amber-600/80 dark:text-amber-400/80 flex items-center gap-1">
                    <span>📌</span> 置顶备忘录
                  </div>
                  {pinnedNotes.map((note) => renderNoteCard(note))}
                </div>
              )}

              {/* Normal Notes Group */}
              {unpinnedNotes.length > 0 && (
                <div className="space-y-1">
                  {pinnedNotes.length > 0 && (
                    <div className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wider uppercase text-zinc-400 dark:text-zinc-500">
                      备忘录
                    </div>
                  )}
                  {unpinnedNotes.map((note) => renderNoteCard(note))}
                </div>
              )}
            </>
          )}
        </div>
      </aside>

      {/* ─── Right Main Area: iPhone Immersive Editor ─── */}
      <main className="flex flex-1 flex-col overflow-hidden bg-white dark:bg-zinc-950">
        {activeNote ? (
          <div className="flex h-full flex-col">
            {/* Top Editor Status Bar */}
            <div className="flex h-11 items-center justify-between border-b border-zinc-100 px-6 dark:border-zinc-800/80">
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-zinc-400">
                  {formatDetailTime(activeNote.updatedAt)}
                </span>
                {saveStatus === 'saving' && (
                  <span className="flex items-center gap-1 text-[11px] text-amber-500 animate-pulse">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    正在自动保存...
                  </span>
                )}
                {saveStatus === 'saved' && (
                  <span className="flex items-center gap-1 text-[11px] text-emerald-500">
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    已保存至云端
                  </span>
                )}
              </div>

              {/* Actions: Pin & Delete */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleTogglePin(activeNote.id)}
                  title={activeNote.isPinned ? '取消置顶' : '置顶此备忘录'}
                  className={`rounded-md p-1.5 text-xs transition-colors ${
                    activeNote.isPinned
                      ? 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400'
                      : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300'
                  }`}
                >
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
                  </svg>
                </button>
                <button
                  onClick={() => handleDeleteNote(activeNote.id)}
                  title="删除备忘录"
                  className="rounded-md p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-500 transition-colors dark:hover:bg-red-950/30"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Immersive Note Body */}
            <div className="flex flex-1 flex-col overflow-y-auto px-8 py-6 max-w-3xl w-full mx-auto">
              <input
                ref={titleInputRef}
                type="text"
                placeholder="备忘录标题"
                value={draftTitle}
                onChange={(e) => handleTitleChange(e.target.value)}
                className="w-full bg-transparent text-2xl font-bold tracking-tight text-zinc-900 placeholder-zinc-300 focus:outline-none dark:text-zinc-100 dark:placeholder-zinc-700 mb-4"
              />
              <textarea
                ref={contentTextareaRef}
                placeholder="在此开始记录..."
                value={draftContent}
                onChange={(e) => handleContentChange(e.target.value)}
                className="flex-1 w-full resize-none bg-transparent text-sm leading-relaxed text-zinc-800 placeholder-zinc-300 focus:outline-none dark:text-zinc-200 dark:placeholder-zinc-700 min-h-[400px]"
              />
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-center p-6 text-zinc-400">
            <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-500 dark:bg-amber-500/20">
              <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </div>
            <p className="text-base font-medium text-zinc-600 dark:text-zinc-300">
              选择或新建备忘录
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              采用经典 iPhone 备忘录架构，多端输入实时 600ms 自动静默持久化
            </p>
            <button
              onClick={handleCreateNote}
              className="mt-4 rounded-md bg-amber-500 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-amber-600 transition-colors cursor-pointer"
            >
              新建备忘录
            </button>
          </div>
        )}
      </main>
    </div>
  )

  function renderNoteCard(note: Note) {
    const isSelected = note.id === activeNoteId
    const firstLineSnippet = note.content ? note.content.split('\n')[0] : '暂无更多文字'
    const displayTitle = note.title ? note.title : '新备忘录'

    return (
      <div
        key={note.id}
        onClick={() => setActiveNoteId(note.id)}
        className={`group relative flex flex-col rounded-lg px-3 py-2.5 transition-all cursor-pointer select-none ${
          isSelected
            ? 'bg-amber-500/15 border-l-3 border-amber-500 dark:bg-amber-500/20 shadow-xs'
            : 'hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span
            className={`truncate text-sm font-semibold ${
              isSelected
                ? 'text-amber-900 dark:text-amber-200'
                : 'text-zinc-900 dark:text-zinc-100'
            }`}
          >
            {displayTitle}
          </span>
          <div className="flex items-center gap-1">
            {note.isPinned && (
              <span className="text-[10px] text-amber-500" title="已置顶">
                📌
              </span>
            )}
            <button
              onClick={(e) => handleDeleteNote(note.id, e)}
              className="opacity-0 group-hover:opacity-100 p-0.5 text-zinc-400 hover:text-red-500 transition-opacity"
              title="删除"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span className="font-mono text-[11px] text-zinc-400 flex-shrink-0">
            {formatNoteTime(note.updatedAt)}
          </span>
          <span className="truncate text-zinc-400 dark:text-zinc-500 text-[11px]">
            {firstLineSnippet}
          </span>
        </div>
      </div>
    )
  }
}
