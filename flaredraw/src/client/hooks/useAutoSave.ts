import { useCallback, useRef, useState } from 'react'
import { getSceneVersion } from '@excalidraw/excalidraw'
import { api, type DrawingContent } from '@/client/lib/api-client'

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error'

export function useAutoSave(drawingId: string | null) {
  const sceneVersionRef = useRef(0)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')

  const handleChange = useCallback(
    (elements: readonly Record<string, unknown>[], appState: Record<string, unknown>, files: Record<string, unknown>) => {
      if (!drawingId) return

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const currentVersion = getSceneVersion(elements as any)
      if (currentVersion === sceneVersionRef.current) return
      sceneVersionRef.current = currentVersion

      setSaveStatus('unsaved')

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }

      debounceTimerRef.current = setTimeout(async () => {
        try {
          setSaveStatus('saving')

          const content: DrawingContent = {
            type: 'excalidraw',
            version: 2,
            source: 'flaredraw',
            elements: elements as unknown[],
            appState: {
              viewBackgroundColor: appState.viewBackgroundColor as string,
              gridSize: appState.gridSize as number | null,
            },
            files,
          }

          await api.drawings.saveContent(drawingId, content)
          setSaveStatus('saved')
        } catch {
          setSaveStatus('error')
        }
      }, 1500)
    },
    [drawingId],
  )

  return { handleChange, saveStatus }
}
