import { useState, useEffect } from 'react'
import { api, type DrawingContent } from '@/client/lib/api-client'

export function useDrawing(drawingId: string | null) {
  const [content, setContent] = useState<DrawingContent | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!drawingId) {
      setLoading(false)
      return
    }

    let cancelled = false

    async function load() {
      try {
        const data = await api.drawings.getContent(drawingId!)
        if (!cancelled) {
          setContent(data)
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load drawing')
          setLoading(false)
        }
      }
    }

    load()
    return () => { cancelled = true }
  }, [drawingId])

  return { content, loading, error }
}
