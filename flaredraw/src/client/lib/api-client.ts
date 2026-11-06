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
    list: () => fetchAPI<{ drawings: Drawing[] }>('/drawings'),
    create: () => fetchAPI<{ id: string }>('/drawings', { method: 'POST' }),
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
    delete: (id: string) =>
      fetchAPI<{ deleted: boolean }>(`/drawings/${id}`, { method: 'DELETE' }),
  },
  notes: {
    list: () => fetchAPI<{ notes: Note[] }>('/notes'),
    create: (data?: { title?: string; content?: string }) =>
      fetchAPI<{ note: Note; id: string }>('/notes', {
        method: 'POST',
        body: JSON.stringify(data || {}),
      }),
    get: (id: string) => fetchAPI<{ note: Note }>(`/notes/${id}`),
    update: (id: string, data: { title?: string; content?: string }) =>
      fetchAPI<{ saved: boolean; note: Note }>(`/notes/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchAPI<{ deleted: boolean; id: string }>(`/notes/${id}`, {
        method: 'DELETE',
      }),
    togglePin: (id: string) =>
      fetchAPI<{ pinned: boolean; note: Note }>(`/notes/${id}/pin`, {
        method: 'POST',
      }),
  },
}
