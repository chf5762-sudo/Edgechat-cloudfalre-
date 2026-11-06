import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { api, type Note } from '@/client/lib/api-client'

export function NotesWorkspace() {
  const [notes, setNotes] = useState<Note[]>([])
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')

  // View: 'notes' | 'trash'
  const [activeTab, setActiveTab] = useState<'notes' | 'trash'>('notes')

  // Tag filter
  const [activeTag, setActiveTag] = useState<string>('all')

  // Batch selection
  const [batchMode, setBatchMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Local editor draft state
  const [draftTitle, setDraftTitle] = useState('')
  const [draftContent, setDraftContent] = useState('')
  const [draftTags, setDraftTags] = useState<string[]>([])
  const [newTagInput, setNewTagInput] = useState('')
  const [isUploadingImage, setIsUploadingImage] = useState(false)

  const activeNote = notes.find((n) => n.id === activeNoteId) || null

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const contentTextareaRef = useRef<HTMLTextAreaElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

  // Fetch note list
  const loadNotes = useCallback(async (selectFirst = true) => {
    setLoading(true)
    try {
      const isTrash = activeTab === 'trash'
      const tagParam = activeTag !== 'all' ? activeTag : undefined
      const res = await api.notes.list({ trash: isTrash, tag: tagParam })
      setNotes(res.notes)
      setSelectedIds(new Set())

      if (selectFirst) {
        if (res.notes.length > 0) {
          // If current active is not in list, pick the first
          if (!activeNoteId || !res.notes.find((n) => n.id === activeNoteId)) {
            setActiveNoteId(res.notes[0].id)
          }
        } else {
          setActiveNoteId(null)
        }
      }
    } catch (err) {
      console.error('Failed to load notes', err)
    } finally {
      setLoading(false)
    }
  }, [activeTab, activeTag, activeNoteId])

  useEffect(() => {
    loadNotes(true)
  }, [activeTab, activeTag])

  // Sync draft state when active note changes
  useEffect(() => {
    if (activeNote) {
      setDraftTitle(activeNote.title || '')
      setDraftContent(activeNote.content || '')
      setDraftTags(activeNote.tags || [])
      setSaveStatus('idle')
    } else {
      setDraftTitle('')
      setDraftContent('')
      setDraftTags([])
    }
  }, [activeNoteId])

  // Extract all distinct tags from notes for aggregation
  const allTags = useMemo(() => {
    const set = new Set<string>()
    notes.forEach((n) => {
      ;(n.tags || []).forEach((t) => {
        if (t && t.trim()) set.add(t.trim())
      })
    })
    return Array.from(set).sort()
  }, [notes])

  // Debounced auto-save handler (600ms)
  const scheduleAutoSave = (newTitle: string, newContent: string, newTags: string[]) => {
    if (!activeNoteId || activeTab === 'trash') return
    setSaveStatus('saving')

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    debounceTimerRef.current = setTimeout(async () => {
      try {
        const res = await api.notes.update(activeNoteId, {
          title: newTitle,
          content: newContent,
          tags: newTags,
        })
        if (res.saved && res.note) {
          setNotes((prev) =>
            prev.map((n) => (n.id === activeNoteId ? { ...n, ...res.note } : n))
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
    scheduleAutoSave(val, draftContent, draftTags)
  }

  const handleContentChange = (val: string) => {
    setDraftContent(val)
    scheduleAutoSave(draftTitle, val, draftTags)
  }

  // Tag management
  const handleAddTag = (tagToAdd?: string) => {
    const tag = (tagToAdd || newTagInput).trim()
    if (!tag) return
    if (!draftTags.includes(tag)) {
      const updated = [...draftTags, tag]
      setDraftTags(updated)
      scheduleAutoSave(draftTitle, draftContent, updated)
    }
    setNewTagInput('')
  }

  const handleRemoveTag = (tagToRemove: string) => {
    const updated = draftTags.filter((t) => t !== tagToRemove)
    setDraftTags(updated)
    scheduleAutoSave(draftTitle, draftContent, updated)
  }

  // Create new note
  const handleCreateNote = async () => {
    try {
      const initialTags = activeTag !== 'all' ? [activeTag] : []
      const res = await api.notes.create({ title: '', content: '', tags: initialTags })
      if (res.note) {
        setNotes((prev) => [res.note, ...prev])
        setActiveNoteId(res.note.id)
        setDraftTitle('')
        setDraftContent('')
        setDraftTags(initialTags)
        setTimeout(() => titleInputRef.current?.focus(), 50)
      }
    } catch (err) {
      console.error('Failed to create note', err)
    }
  }

  // Delete note (soft delete in active view, permanent delete in trash view)
  const handleDeleteNote = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    const isTrash = activeTab === 'trash'
    if (isTrash) {
      if (!confirm('确定要永久删除这条备忘录吗？此操作无法撤销！')) return
    } else {
      if (!confirm('确定将这条备忘录移入回收站吗？')) return
    }

    try {
      await api.notes.delete(id, isTrash)
      const remaining = notes.filter((n) => n.id !== id)
      setNotes(remaining)
      if (activeNoteId === id) {
        setActiveNoteId(remaining.length > 0 ? remaining[0].id : null)
      }
    } catch (err) {
      console.error('Failed to delete note', err)
    }
  }

  // Restore note from trash
  const handleRestoreNote = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    try {
      await api.notes.restore(id)
      const remaining = notes.filter((n) => n.id !== id)
      setNotes(remaining)
      if (activeNoteId === id) {
        setActiveNoteId(remaining.length > 0 ? remaining[0].id : null)
      }
    } catch (err) {
      console.error('Failed to restore note', err)
    }
  }

  // Purge entire trash
  const handlePurgeTrash = async () => {
    if (!confirm('确定清空回收站吗？所有被删除的备忘录将永久丢失！')) return
    try {
      await api.notes.purgeTrash()
      setNotes([])
      setActiveNoteId(null)
    } catch (err) {
      console.error('Failed to purge trash', err)
    }
  }

  // Toggle pin
  const handleTogglePin = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (activeTab === 'trash') return
    try {
      const res = await api.notes.togglePin(id)
      if (res.note) {
        setNotes((prev) => {
          const updated = prev.map((n) => (n.id === id ? { ...n, isPinned: res.note.isPinned } : n))
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

  // Batch toggle selection
  const toggleSelect = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredNotes.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredNotes.map((n) => n.id)))
    }
  }

  // Batch delete
  const handleBatchDelete = async () => {
    const ids = Array.from(selectedIds)
    if (!ids.length) return
    const isTrash = activeTab === 'trash'

    if (isTrash) {
      if (!confirm(`确定永久删除选中的 ${ids.length} 条备忘录吗？此操作无法撤销！`)) return
      for (const id of ids) {
        await api.notes.delete(id, true).catch(() => {})
      }
    } else {
      if (!confirm(`确定将选中的 ${ids.length} 条备忘录移入回收站吗？`)) return
      await api.notes.batchDelete(ids)
    }

    const remaining = notes.filter((n) => !selectedIds.has(n.id))
    setNotes(remaining)
    setSelectedIds(new Set())
    if (activeNoteId && selectedIds.has(activeNoteId)) {
      setActiveNoteId(remaining.length > 0 ? remaining[0].id : null)
    }
  }

  // Batch restore (in trash)
  const handleBatchRestore = async () => {
    const ids = Array.from(selectedIds)
    if (!ids.length) return
    for (const id of ids) {
      await api.notes.restore(id).catch(() => {})
    }
    const remaining = notes.filter((n) => !selectedIds.has(n.id))
    setNotes(remaining)
    setSelectedIds(new Set())
    if (activeNoteId && selectedIds.has(activeNoteId)) {
      setActiveNoteId(remaining.length > 0 ? remaining[0].id : null)
    }
  }

  // Image Upload helper
  const insertImageMarkdown = async (file: File) => {
    if (!file.type.startsWith('image/')) return
    setIsUploadingImage(true)

    // Insert placeholder at cursor
    const textarea = contentTextareaRef.current
    const placeholder = `\n![上传图片中...](${file.name})\n`
    let startPos = draftContent.length
    let endPos = draftContent.length

    if (textarea) {
      startPos = textarea.selectionStart
      endPos = textarea.selectionEnd
    }

    const newContentWithPlaceholder =
      draftContent.substring(0, startPos) + placeholder + draftContent.substring(endPos)
    setDraftContent(newContentWithPlaceholder)

    try {
      const res = await api.notes.uploadImage(file)
      const markdownImage = `\n![${file.name || 'image'}](${res.url})\n`
      const finalContent = newContentWithPlaceholder.replace(placeholder, markdownImage)
      setDraftContent(finalContent)
      scheduleAutoSave(draftTitle, finalContent, draftTags)
    } catch (err: any) {
      alert(`图片上传失败: ${err.message || '未知错误'}`)
      const rolledBack = newContentWithPlaceholder.replace(placeholder, '')
      setDraftContent(rolledBack)
    } finally {
      setIsUploadingImage(false)
    }
  }

  // Handle image paste in textarea
  const handleTextareaPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items
    if (!items) return

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) {
          await insertImageMarkdown(file)
        }
        break
      }
    }
  }

  // Handle image file input change
  const handleImageFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      await insertImageMarkdown(file)
      e.target.value = ''
    }
  }

  // Format date helper
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
      (n.content && n.content.toLowerCase().includes(q)) ||
      (n.tags && n.tags.some((t) => t.toLowerCase().includes(q)))
    )
  })

  const pinnedNotes = filteredNotes.filter((n) => n.isPinned)
  const unpinnedNotes = filteredNotes.filter((n) => !n.isPinned)

  return (
    <div className="flex h-[calc(100vh-65px)] w-full overflow-hidden bg-white dark:bg-zinc-950">
      {/* Hidden file input for image upload */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageFileSelect}
      />

      {/* ─── Left Sidebar ─── */}
      <aside className="flex w-72 sm:w-84 flex-shrink-0 flex-col border-r border-zinc-200 bg-zinc-50/70 dark:border-zinc-800 dark:bg-zinc-900/60 backdrop-blur-md">
        {/* Navigation Tabs (备忘录 / 回收站) */}
        <div className="flex items-center border-b border-zinc-200/80 px-3 pt-3 pb-2 gap-2 dark:border-zinc-800">
          <button
            onClick={() => {
              setActiveTab('notes')
              setBatchMode(false)
            }}
            className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'notes'
                ? 'bg-amber-500 text-white shadow-xs'
                : 'text-zinc-600 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800'
            }`}
          >
            <span>📝</span>
            <span>全部备忘录</span>
          </button>
          <button
            onClick={() => {
              setActiveTab('trash')
              setBatchMode(false)
            }}
            className={`py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'trash'
                ? 'bg-red-500 text-white shadow-xs'
                : 'text-zinc-600 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800'
            }`}
          >
            <span>🗑️</span>
            <span>回收站</span>
          </button>
        </div>

        {/* Search & Actions Header */}
        <div className="p-3 border-b border-zinc-200/80 dark:border-zinc-800">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-zinc-500">
                {activeTab === 'trash' ? '回收站' : '备忘录'} ({notes.length})
              </span>
              <button
                onClick={() => setBatchMode(!batchMode)}
                className={`text-[11px] px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                  batchMode
                    ? 'bg-amber-50 border-amber-300 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                    : 'border-zinc-200 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400'
                }`}
              >
                {batchMode ? '完成' : '批量操作'}
              </button>
            </div>

            {activeTab === 'notes' ? (
              <button
                onClick={handleCreateNote}
                title="新建备忘录"
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 hover:bg-amber-500/25 active:scale-95 transition-all dark:bg-amber-400/20 dark:text-amber-400 cursor-pointer"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </button>
            ) : (
              notes.length > 0 && (
                <button
                  onClick={handlePurgeTrash}
                  title="清空回收站"
                  className="text-[11px] text-red-500 hover:underline cursor-pointer"
                >
                  清空
                </button>
              )
            )}
          </div>

          {/* Search Box */}
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
              placeholder="搜索标题、内容或标签..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-md border border-zinc-200/90 bg-white/90 py-1.5 pl-8 pr-3 text-xs text-zinc-800 placeholder-zinc-400 shadow-xs focus:border-amber-500 focus:outline-none dark:border-zinc-700/80 dark:bg-zinc-800/80 dark:text-zinc-200"
            />
          </div>
        </div>

        {/* Category / Tag Pills Bar */}
        {allTags.length > 0 && activeTab === 'notes' && (
          <div className="flex items-center gap-1.5 px-3 py-2 overflow-x-auto border-b border-zinc-200/60 dark:border-zinc-800/60 scrollbar-none">
            <button
              onClick={() => setActiveTag('all')}
              className={`flex-shrink-0 px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-colors cursor-pointer ${
                activeTag === 'all'
                  ? 'bg-amber-500 text-white'
                  : 'bg-zinc-200/70 text-zinc-600 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-400'
              }`}
            >
              全部
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setActiveTag(activeTag === tag ? 'all' : tag)}
                className={`flex-shrink-0 px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-colors cursor-pointer ${
                  activeTag === tag
                    ? 'bg-amber-500 text-white'
                    : 'bg-zinc-200/70 text-zinc-600 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-400'
                }`}
              >
                #{tag}
              </button>
            ))}
          </div>
        )}

        {/* Batch Action Toolbar */}
        {batchMode && (
          <div className="flex items-center justify-between px-3 py-1.5 bg-amber-50/80 border-b border-amber-200/60 dark:bg-amber-950/30 dark:border-amber-900/50">
            <label className="flex items-center gap-1.5 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedIds.size > 0 && selectedIds.size === filteredNotes.length}
                onChange={toggleSelectAll}
                className="rounded text-amber-500 focus:ring-amber-400"
              />
              <span>全选 ({selectedIds.size})</span>
            </label>
            <div className="flex items-center gap-1.5">
              {activeTab === 'trash' && selectedIds.size > 0 && (
                <button
                  onClick={handleBatchRestore}
                  className="px-2 py-0.5 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700 cursor-pointer"
                >
                  还原
                </button>
              )}
              {selectedIds.size > 0 && (
                <button
                  onClick={handleBatchDelete}
                  className="px-2 py-0.5 text-xs bg-red-600 text-white rounded hover:bg-red-700 cursor-pointer"
                >
                  {activeTab === 'trash' ? '彻底删除' : '批量删除'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Note List Items */}
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
          {loading ? (
            <div className="py-12 text-center text-xs text-zinc-400">加载备忘录中...</div>
          ) : filteredNotes.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-xs text-zinc-400">
                {activeTab === 'trash'
                  ? '回收站为空'
                  : searchQuery
                  ? '没有找到匹配的备忘录'
                  : '暂无备忘录'}
              </p>
              {!searchQuery && activeTab === 'notes' && (
                <button
                  onClick={handleCreateNote}
                  className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-amber-600 hover:underline dark:text-amber-400 cursor-pointer"
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
              {pinnedNotes.length > 0 && activeTab === 'notes' && (
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
                  {pinnedNotes.length > 0 && activeTab === 'notes' && (
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
                {isUploadingImage && (
                  <span className="flex items-center gap-1 text-[11px] text-blue-500 animate-pulse">
                    📷 正在上传图片...
                  </span>
                )}
              </div>

              {/* Editor Actions Toolbar */}
              <div className="flex items-center gap-1.5">
                {activeTab === 'notes' ? (
                  <>
                    {/* Insert Image Button */}
                    <button
                      onClick={() => imageInputRef.current?.click()}
                      title="插入图片 (亦支持直接截图粘贴)"
                      disabled={isUploadingImage}
                      className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-zinc-100 text-zinc-700 hover:bg-zinc-200 transition-colors dark:bg-zinc-800 dark:text-zinc-300 cursor-pointer"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <span>插入图片</span>
                    </button>

                    {/* Pin button */}
                    <button
                      onClick={() => handleTogglePin(activeNote.id)}
                      title={activeNote.isPinned ? '取消置顶' : '置顶此备忘录'}
                      className={`rounded-md p-1.5 text-xs transition-colors cursor-pointer ${
                        activeNote.isPinned
                          ? 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400'
                          : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300'
                      }`}
                    >
                      <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
                      </svg>
                    </button>

                    {/* Delete button (Soft delete) */}
                    <button
                      onClick={() => handleDeleteNote(activeNote.id)}
                      title="移入回收站"
                      className="rounded-md p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-500 transition-colors dark:hover:bg-red-950/30 cursor-pointer"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </>
                ) : (
                  <>
                    {/* Trash View Actions: Restore & Permanent Delete */}
                    <button
                      onClick={() => handleRestoreNote(activeNote.id)}
                      title="还原备忘录"
                      className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors dark:bg-emerald-950/40 dark:text-emerald-400 cursor-pointer"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      <span>还原</span>
                    </button>
                    <button
                      onClick={() => handleDeleteNote(activeNote.id)}
                      title="永久删除"
                      className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-red-50 text-red-600 hover:bg-red-100 transition-colors dark:bg-red-950/40 dark:text-red-400 cursor-pointer"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      <span>彻底删除</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Immersive Note Body */}
            <div className="flex flex-1 flex-col overflow-y-auto px-8 py-6 max-w-3xl w-full mx-auto">
              <input
                ref={titleInputRef}
                type="text"
                placeholder="备忘录标题"
                value={draftTitle}
                disabled={activeTab === 'trash'}
                onChange={(e) => handleTitleChange(e.target.value)}
                className="w-full bg-transparent text-2xl font-bold tracking-tight text-zinc-900 placeholder-zinc-300 focus:outline-none dark:text-zinc-100 dark:placeholder-zinc-700 mb-2"
              />

              {/* Tag Chips for current note */}
              <div className="flex flex-wrap items-center gap-1.5 mb-4">
                {draftTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-amber-500/10 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
                  >
                    #{tag}
                    {activeTab === 'notes' && (
                      <button
                        onClick={() => handleRemoveTag(tag)}
                        className="text-amber-600 hover:text-amber-900 dark:text-amber-400 cursor-pointer"
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
                {activeTab === 'notes' && (
                  <div className="inline-flex items-center">
                    <input
                      type="text"
                      placeholder="+ 标签 (回车添加)"
                      value={newTagInput}
                      onChange={(e) => setNewTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ',') {
                          e.preventDefault()
                          handleAddTag()
                        }
                      }}
                      className="text-xs text-zinc-600 placeholder-zinc-400 bg-transparent border-b border-transparent focus:border-amber-400 focus:outline-none px-1 py-0.5 w-24"
                    />
                  </div>
                )}
              </div>

              {/* Textarea with paste support for images */}
              <textarea
                ref={contentTextareaRef}
                placeholder="在此开始记录... 支持直接粘贴剪贴板截图或点击上方按钮插入图片"
                value={draftContent}
                disabled={activeTab === 'trash'}
                onPaste={handleTextareaPaste}
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
              {activeTab === 'trash' ? '回收站中未选中备忘录' : '选择或新建备忘录'}
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              支持粘贴/插入图片、分类聚合、批量删除与回收站恢复
            </p>
            {activeTab === 'notes' && (
              <button
                onClick={handleCreateNote}
                className="mt-4 rounded-md bg-amber-500 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-amber-600 transition-colors cursor-pointer"
              >
                新建备忘录
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  )

  function renderNoteCard(note: Note) {
    const isSelected = note.id === activeNoteId
    const firstLineSnippet = note.content ? note.content.split('\n')[0] : '暂无更多文字'
    const displayTitle = note.title ? note.title : '新备忘录'
    const isChecked = selectedIds.has(note.id)

    return (
      <div
        key={note.id}
        onClick={() => {
          if (batchMode) {
            toggleSelect(note.id)
          } else {
            setActiveNoteId(note.id)
          }
        }}
        className={`group relative flex flex-col rounded-lg px-3 py-2.5 transition-all cursor-pointer select-none ${
          isSelected && !batchMode
            ? 'bg-amber-500/15 border-l-3 border-amber-500 dark:bg-amber-500/20 shadow-xs'
            : isChecked
            ? 'bg-amber-50 dark:bg-amber-950/40 border-l-3 border-amber-400'
            : 'hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 truncate">
            {batchMode && (
              <input
                type="checkbox"
                checked={isChecked}
                onChange={(e) => toggleSelect(note.id, e as any)}
                onClick={(e) => e.stopPropagation()}
                className="rounded text-amber-500 focus:ring-amber-400 cursor-pointer"
              />
            )}
            <span
              className={`truncate text-sm font-semibold ${
                isSelected && !batchMode
                  ? 'text-amber-900 dark:text-amber-200'
                  : 'text-zinc-900 dark:text-zinc-100'
              }`}
            >
              {displayTitle}
            </span>
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            {note.isPinned && activeTab === 'notes' && (
              <span className="text-[10px] text-amber-500" title="已置顶">
                📌
              </span>
            )}
            {!batchMode && (
              <button
                onClick={(e) => (activeTab === 'trash' ? handleRestoreNote(note.id, e) : handleDeleteNote(note.id, e))}
                className="opacity-0 group-hover:opacity-100 p-0.5 text-zinc-400 hover:text-red-500 transition-opacity"
                title={activeTab === 'trash' ? '还原' : '删除'}
              >
                {activeTab === 'trash' ? (
                  <svg className="h-3.5 w-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                ) : (
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Tags preview */}
        {note.tags && note.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {note.tags.map((t) => (
              <span key={t} className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-200/60 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                #{t}
              </span>
            ))}
          </div>
        )}

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
