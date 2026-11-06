const API_BASE = '/api'

async function fetchAPI<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((error as { error: string }).error || res.statusText)
  }

  return res.json()
}

export type Drawing = {
  id: string
  userId: string
  title: string | null
  project?: string | null
  r2Key: string
  thumbnailKey: string | null
  isPublic: boolean | null
  shareId: string | null
  elementCount: number | null
  lastModified: string | null
  createdAt: string
}

export type DrawingContent = {
  type: string
  version: number
  source: string
  elements: unknown[]
  appState: Record<string, unknown>
  files: Record<string, unknown>
}

export type Note = {
  id: string
  userId: string
  title: string
  content: string
  isPinned: boolean
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
  tags?: string[]
}

export const api = {
  auth: {
    verifyPasscode: (passcode: string) =>
      fetchAPI<{ success: boolean; user: unknown; expiresIn: number }>('/auth/verify-passcode', {
        method: 'POST',
        body: JSON.stringify({ passcode }),
      }),
    getSession: () => fetchAPI<{ user: unknown; session: unknown } | null>('/auth/get-session'),
    signOut: () => fetchAPI<{ success: boolean }>('/auth/sign-out', { method: 'POST' }),
  },
  shares: {
    create: (drawingId: string) =>
      fetchAPI<{ shareId: string }>('/shares', {
        method: 'POST',
        body: JSON.stringify({ drawingId }),
      }),
    getContent: (shareId: string) => fetchAPI<DrawingContent>(`/shares/${shareId}`),
    refresh: (shareId: string) =>
      fetchAPI<{ refreshed: boolean }>(`/shares/${shareId}`, { method: 'PUT' }),
    uploadPng: async (shareId: string, blob: Blob) => {
      const res = await fetch(`${API_BASE}/shares/${shareId}/png`, {
        method: 'PUT',
        body: blob,
        credentials: 'include',
      })
      if (!res.ok) throw new Error('PNG upload failed')
      return res.json() as Promise<{ uploaded: boolean }>
    },
  },
  drawings: {
    list: (params?: { project?: string }) => {
      const q = new URLSearchParams()
      if (params?.project) q.set('project', params.project)
      const qs = q.toString()
      return fetchAPI<{ drawings: Drawing[] }>(`/drawings${qs ? `?${qs}` : ''}`)
    },
    create: (data?: { title?: string; project?: string; elements?: unknown[]; appState?: Record<string, unknown> }) =>
      fetchAPI<{ id: string; r2Key?: string; project?: string }>('/drawings', {
        method: 'POST',
        body: JSON.stringify(data || {}),
      }),
    get: (id: string) => fetchAPI<{ drawing: Drawing }>(`/drawings/${id}`),
    getContent: (id: string) => fetchAPI<DrawingContent>(`/drawings/${id}/content`),
    saveContent: (id: string, content: DrawingContent) =>
      fetchAPI<{ saved: boolean }>(`/drawings/${id}/content`, {
        method: 'PUT',
        body: JSON.stringify(content),
      }),
    updateTitle: (id: string, title: string) =>
      fetchAPI<{ updated: boolean }>(`/drawings/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      }),
    update: (id: string, data: { title?: string; project?: string }) =>
      fetchAPI<{ updated: boolean }>(`/drawings/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchAPI<{ deleted: boolean; id?: string }>(`/drawings/${id}`, { method: 'DELETE' }),
    batchDelete: (ids: string[]) =>
      fetchAPI<{ deleted: number; ids: string[] }>('/drawings/batch-delete', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      }),
  },
  notes: {
    list: (params?: { tag?: string; trash?: boolean }) => {
      const q = new URLSearchParams()
      if (params?.tag) q.set('tag', params.tag)
      if (params?.trash) q.set('trash', '1')
      const qs = q.toString()
      return fetchAPI<{ notes: Note[] }>(`/notes${qs ? `?${qs}` : ''}`)
    },
    create: (data?: { title?: string; content?: string; tags?: string[] }) =>
      fetchAPI<{ note: Note; id: string }>('/notes', {
        method: 'POST',
        body: JSON.stringify(data || {}),
      }),
    get: (id: string) => fetchAPI<{ note: Note }>(`/notes/${id}`),
    update: (id: string, data: { title?: string; content?: string; tags?: string[] }) =>
      fetchAPI<{ saved: boolean; note: Note }>(`/notes/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string, permanent = false) =>
      fetchAPI<{ deleted: boolean; permanent?: boolean; id: string }>(
        `/notes/${id}${permanent ? '?permanent=1' : ''}`,
        { method: 'DELETE' }
      ),
    restore: (id: string) =>
      fetchAPI<{ restored: boolean; id: string }>(`/notes/${id}/restore`, {
        method: 'POST',
      }),
    batchDelete: (ids: string[]) =>
      fetchAPI<{ deleted: number; ids: string[] }>('/notes/batch-delete', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      }),
    purgeTrash: () =>
      fetchAPI<{ purged: number }>('/notes/trash/purge', {
        method: 'DELETE',
      }),
    togglePin: (id: string) =>
      fetchAPI<{ pinned: boolean; note: Note }>(`/notes/${id}/pin`, {
        method: 'POST',
      }),
    updateTags: (id: string, tags: string[]) =>
      fetchAPI<{ ok: boolean; tags: string[] }>(`/notes/${id}/tags`, {
        method: 'PATCH',
        body: JSON.stringify({ tags }),
      }),
    uploadImage: async (file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/notes/images', {
        method: 'POST',
        body: fd,
        credentials: 'include',
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error: string }).error || '图片上传失败')
      }
      return res.json() as Promise<{ ok: boolean; url: string }>
    },
  },
}
