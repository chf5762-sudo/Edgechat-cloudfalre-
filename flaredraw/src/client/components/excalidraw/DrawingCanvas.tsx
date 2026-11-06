import '@excalidraw/excalidraw/index.css'
import { Excalidraw } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { useRef, useCallback, useState } from 'react'
import { useAutoSave, type SaveStatus } from '@/client/hooks/useAutoSave'
import { api, type DrawingContent } from '@/client/lib/api-client'
import { useThemeContext } from '@/client/components/ThemeProvider'

async function uploadSharePng(excalidrawAPI: ExcalidrawImperativeAPI, shareId: string) {
  const { exportToBlob } = await import('@excalidraw/excalidraw')
  const blob = await exportToBlob({
    elements: excalidrawAPI.getSceneElements(),
    appState: { ...excalidrawAPI.getAppState(), exportWithDarkMode: false },
    files: excalidrawAPI.getFiles(),
    mimeType: 'image/png',
  })
  await fetch(`/api/shares/${shareId}/png`, {
    method: 'PUT',
    body: blob,
    credentials: 'include',
  })
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  const colors: Record<SaveStatus, string> = {
    saved: 'bg-green-500',
    saving: 'bg-yellow-500',
    unsaved: 'bg-zinc-400',
    error: 'bg-red-500',
  }
  const labels: Record<SaveStatus, string> = {
    saved: 'Saved',
    saving: 'Saving...',
    unsaved: 'Unsaved',
    error: 'Save failed',
  }

  return (
    <div className="flex items-center gap-1.5 rounded-md bg-white/80 px-2 py-1 text-xs backdrop-blur dark:bg-zinc-900/80">
      <div className={`h-2 w-2 rounded-full ${colors[status]}`} />
      <span className="text-zinc-600 dark:text-zinc-400">{labels[status]}</span>
    </div>
  )
}

function ShareButton({ drawingId, excalidrawAPI }: { drawingId: string; excalidrawAPI: ExcalidrawImperativeAPI | null }) {
  const [copied, setCopied] = useState(false)
  const [sharing, setSharing] = useState(false)

  async function handleShare() {
    setSharing(true)
    try {
      const { shareId } = await api.shares.create(drawingId)
      const url = `${window.location.origin}/s/${shareId}`
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)

      // Generate and upload PNG in the background (non-blocking)
      if (excalidrawAPI) {
        uploadSharePng(excalidrawAPI, shareId).catch(() => {
          // PNG upload failure is non-critical
        })
      }
    } catch {
      // Silently fail — share button is non-critical
    } finally {
      setSharing(false)
    }
  }

  return (
    <button
      onClick={handleShare}
      disabled={sharing}
      className="rounded-md bg-zinc-900 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
    >
      {copied ? 'Link copied!' : sharing ? 'Sharing...' : 'Share'}
    </button>
  )
}

type DrawingCanvasProps = {
  drawingId: string | null
  initialData?: DrawingContent | null
  viewMode?: boolean
}

export function DrawingCanvas({ drawingId, initialData, viewMode }: DrawingCanvasProps) {
  const excalidrawAPIRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const { handleChange, saveStatus } = useAutoSave(drawingId)
  const { resolved: resolvedTheme } = useThemeContext()

  const handleExcalidrawAPI = useCallback((api: ExcalidrawImperativeAPI) => {
    excalidrawAPIRef.current = api
  }, [])

  return (
    <div style={{ width: '100%', height: '100vh' }}>
      <Excalidraw
        excalidrawAPI={handleExcalidrawAPI}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        initialData={initialData ? {
          elements: initialData.elements,
          appState: initialData.appState,
          files: initialData.files,
          scrollToContent: true,
        } as any : undefined}
        viewModeEnabled={viewMode}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onChange={viewMode ? undefined : handleChange as any}
        theme={resolvedTheme}
        renderTopRightUI={() =>
          drawingId ? (
            <div className="flex items-center gap-2">
              <ShareButton drawingId={drawingId} excalidrawAPI={excalidrawAPIRef.current} />
              <SaveIndicator status={saveStatus} />
            </div>
          ) : null
        }
      />
    </div>
  )
}
