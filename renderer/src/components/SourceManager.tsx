import { useState, useEffect, useCallback } from 'react'
import { api } from '../electronApi.js'
import type { SessionSourceConfig, SessionImportMode } from '../electronApi.js'

const KIND_ICONS: Record<string, string> = {
  auto_claude: 'A',
  auto_codex: 'A',
  manual_file: 'F',
  watched_directory: 'D',
}

const KIND_LABELS: Record<string, string> = {
  auto_claude: 'Auto (Claude)',
  auto_codex: 'Auto (Codex)',
  manual_file: 'Manual File',
  watched_directory: 'Watched Dir',
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 6px',
  fontSize: '20px',
  color: 'rgba(255, 255, 255, 0.8)',
}

const smallBtnStyle: React.CSSProperties = {
  padding: '2px 8px',
  fontSize: '18px',
  color: 'rgba(255, 255, 255, 0.7)',
  background: 'rgba(255, 255, 255, 0.06)',
  border: '1px solid rgba(255, 255, 255, 0.15)',
  borderRadius: 0,
  cursor: 'pointer',
  flexShrink: 0,
}

const addBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: '20px',
  color: 'var(--pixel-text, rgba(255, 255, 255, 0.8))',
  background: 'var(--pixel-btn-bg, rgba(255, 255, 255, 0.06))',
  border: '2px solid transparent',
  borderRadius: 0,
  cursor: 'pointer',
}

const IMPORT_MODES: { value: SessionImportMode; label: string; desc: string }[] = [
  { value: 'tail', label: 'Tail', desc: 'Watch for new lines (live)' },
  { value: 'replay', label: 'Replay', desc: 'Read from start' },
  { value: 'snapshot', label: 'Snapshot', desc: 'One-time read from end' },
]

export function SourceManager() {
  const [configs, setConfigs] = useState<SessionSourceConfig[]>([])
  const [error, setError] = useState<string | null>(null)
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)
  const [showImportPicker, setShowImportPicker] = useState<'file' | 'dir' | null>(null)
  const [pendingPath, setPendingPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const loadConfigs = useCallback(async () => {
    try {
      const result = await api.getSourceConfigs()
      setConfigs(result)
    } catch {
      setError('Failed to load source configs')
    }
  }, [])

  useEffect(() => {
    loadConfigs()
  }, [loadConfigs])

  // Listen for source errors from main process
  useEffect(() => {
    const cleanup = api.on('sourceError', (data) => {
      const msg = (data as { error?: string })?.error
      if (msg) setError(msg)
    })
    return cleanup
  }, [])

  const handleAddFile = useCallback(async () => {
    setError(null)
    try {
      const result = await api.invoke('selectJsonlFile') as { canceled: boolean; filePath?: string }
      if (result.canceled || !result.filePath) return
      setPendingPath(result.filePath)
      setShowImportPicker('file')
    } catch {
      setError('Failed to open file picker')
    }
  }, [])

  const handleAddDir = useCallback(async () => {
    setError(null)
    try {
      const result = await api.invoke('selectDirectory') as { canceled: boolean; directory?: string }
      if (result.canceled || !result.directory) return
      setPendingPath(result.directory)
      setShowImportPicker('dir')
    } catch {
      setError('Failed to open directory picker')
    }
  }, [])

  const handleImportModeSelect = useCallback(async (mode: SessionImportMode) => {
    if (!pendingPath) return
    setLoading(true)
    setError(null)
    try {
      let result
      if (showImportPicker === 'file') {
        result = await api.addManualFile(pendingPath, mode)
      } else {
        result = await api.addWatchedDirectory(pendingPath, undefined, mode)
      }
      if (!result.success) {
        setError(result.error ?? 'Unknown error')
      }
      await loadConfigs()
    } catch {
      setError('Failed to add source')
    } finally {
      setLoading(false)
      setShowImportPicker(null)
      setPendingPath(null)
    }
  }, [pendingPath, showImportPicker, loadConfigs])

  const handleToggle = useCallback(async (sourceId: string, currentlyEnabled: boolean) => {
    setError(null)
    try {
      const result = currentlyEnabled
        ? await api.disableSource(sourceId)
        : await api.enableSource(sourceId)
      if (!result.success) {
        setError(result.error ?? 'Unknown error')
      }
      await loadConfigs()
    } catch {
      setError('Toggle failed')
    }
  }, [loadConfigs])

  const handleRemove = useCallback(async (sourceId: string) => {
    setError(null)
    try {
      const result = await api.removeSource(sourceId)
      if (!result.success) {
        setError(result.error ?? 'Unknown error')
      }
      setConfirmRemoveId(null)
      await loadConfigs()
    } catch {
      setError('Remove failed')
    }
  }, [loadConfigs])

  const isAutoSource = (config: SessionSourceConfig) =>
    config.kind === 'auto_claude' || config.kind === 'auto_codex'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {/* Error banner */}
      {error && (
        <div
          style={{
            padding: '4px 8px',
            fontSize: '18px',
            color: '#ff6b6b',
            background: 'rgba(255, 80, 80, 0.1)',
            border: '1px solid rgba(255, 80, 80, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            style={{ ...smallBtnStyle, color: '#ff6b6b', border: 'none', background: 'transparent' }}
          >
            X
          </button>
        </div>
      )}

      {/* Source list */}
      {configs.length === 0 && (
        <div style={{ ...rowStyle, opacity: 0.4 }}>No sources configured</div>
      )}
      {configs.map((config) => (
        <div key={config.id} style={{ ...rowStyle, opacity: config.enabled ? 1 : 0.45 }}>
          {/* Kind icon */}
          <span
            style={{
              width: 20,
              height: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '16px',
              fontWeight: 'bold',
              background: 'rgba(90, 140, 255, 0.2)',
              border: '1px solid rgba(90, 140, 255, 0.4)',
              flexShrink: 0,
            }}
            title={KIND_LABELS[config.kind] ?? config.kind}
          >
            {KIND_ICONS[config.kind] ?? '?'}
          </span>

          {/* Label and path */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '20px', fontWeight: 500 }}>{config.label}</div>
            <div
              style={{
                fontSize: '16px',
                opacity: 0.5,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={config.path ?? config.directory ?? ''}
            >
              {config.path ?? config.directory ?? '-'}
            </div>
          </div>

          {/* Import mode badge */}
          <span
            style={{
              fontSize: '14px',
              padding: '1px 5px',
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              opacity: 0.6,
              flexShrink: 0,
            }}
          >
            {config.importMode}
          </span>

          {/* Toggle enable/disable */}
          <button
            onClick={() => handleToggle(config.id, config.enabled)}
            style={{
              ...smallBtnStyle,
              background: config.enabled ? 'rgba(90, 140, 255, 0.2)' : 'transparent',
            }}
            title={config.enabled ? 'Disable source' : 'Enable source'}
          >
            {config.enabled ? 'On' : 'Off'}
          </button>

          {/* Remove button (not for auto sources) */}
          {!isAutoSource(config) && (
            confirmRemoveId === config.id ? (
              <span style={{ display: 'flex', gap: 3 }}>
                <button
                  onClick={() => handleRemove(config.id)}
                  style={{ ...smallBtnStyle, color: '#ff6b6b', borderColor: 'rgba(255, 80, 80, 0.4)' }}
                >
                  Confirm
                </button>
                <button
                  onClick={() => setConfirmRemoveId(null)}
                  style={smallBtnStyle}
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmRemoveId(config.id)}
                style={smallBtnStyle}
                title="Remove source"
              >
                Remove
              </button>
            )
          )}
        </div>
      ))}

      {/* Import mode picker modal */}
      {showImportPicker && (
        <div
          style={{
            padding: '6px 8px',
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
          }}
        >
          <div style={{ fontSize: '18px', marginBottom: 4, opacity: 0.7 }}>
            Import mode for: <strong style={{ opacity: 1 }}>{pendingPath}</strong>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {IMPORT_MODES.map((m) => (
              <button
                key={m.value}
                onClick={() => handleImportModeSelect(m.value)}
                disabled={loading}
                style={{
                  ...smallBtnStyle,
                  padding: '4px 10px',
                  fontSize: '18px',
                  opacity: loading ? 0.4 : 1,
                }}
                title={m.desc}
              >
                {m.label}
              </button>
            ))}
            <button
              onClick={() => { setShowImportPicker(null); setPendingPath(null) }}
              style={{ ...smallBtnStyle, fontSize: '18px' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Add buttons */}
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        <button onClick={handleAddFile} style={addBtnStyle}>
          + Add File
        </button>
        <button onClick={handleAddDir} style={addBtnStyle}>
          + Add Folder
        </button>
      </div>
    </div>
  )
}
