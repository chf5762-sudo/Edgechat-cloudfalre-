import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { api, type DrawingContent } from '@/client/lib/api-client'
import { DrawingCanvas } from '@/client/components/excalidraw/DrawingCanvas'

export function SharedDrawingPage() {
  const { shareId } = useParams<{ shareId: string }>()
  const [content, setContent] = useState<DrawingContent | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!shareId) return

    api.shares
      .getContent(shareId)
      .then((data) => {
        setContent(data)
        setLoading(false)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load shared drawing')
        setLoading(false)
      })
  }, [shareId])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-sm text-zinc-500">Loading shared drawing...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-sm text-red-500">{error}</div>
      </div>
    )
  }

  // Render Excalidraw in view-only mode (no drawingId = no auto-save)
  return <DrawingCanvas drawingId={null} initialData={content} viewMode />
}
