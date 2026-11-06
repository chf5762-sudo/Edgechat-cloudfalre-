import { useParams } from 'react-router-dom'
import { DrawingCanvas } from '@/client/components/excalidraw/DrawingCanvas'
import { useDrawing } from '@/client/hooks/useDrawing'

export function DrawingPage() {
  const { id } = useParams<{ id: string }>()
  const { content, loading, error } = useDrawing(id ?? null)

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-sm text-zinc-500">Loading drawing...</div>
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

  return <DrawingCanvas drawingId={id ?? null} initialData={content} />
}
