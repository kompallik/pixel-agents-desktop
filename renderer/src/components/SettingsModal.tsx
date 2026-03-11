import { useState, useEffect } from 'react'
import { api } from '../electronApi.js'
import { isSoundEnabled, setSoundEnabled } from '../notificationSound.js'
import { SourceManager } from './SourceManager.js'

export type SettingsTab = 'general' | 'sources'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  isDebugMode: boolean
  onToggleDebugMode: () => void
  initialTab?: SettingsTab
}

const menuItemBase: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  padding: '6px 10px',
  fontSize: '24px',
  color: 'rgba(255, 255, 255, 0.8)',
  background: 'transparent',
  border: 'none',
  borderRadius: 0,
  cursor: 'pointer',
  textAlign: 'left',
}

const tabBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: '20px',
  color: 'rgba(255, 255, 255, 0.6)',
  background: 'transparent',
  border: 'none',
  borderBottom: '2px solid transparent',
  borderRadius: 0,
  cursor: 'pointer',
}

const tabBtnActiveStyle: React.CSSProperties = {
  ...tabBtnStyle,
  color: 'rgba(255, 255, 255, 0.9)',
  borderBottom: '2px solid rgba(90, 140, 255, 0.8)',
}

export function SettingsModal({ isOpen, onClose, isDebugMode, onToggleDebugMode, initialTab }: SettingsModalProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const [soundLocal, setSoundLocal] = useState(isSoundEnabled)
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab ?? 'general')

  // Sync active tab when initialTab prop changes (e.g. opening from "Add Session" button)
  useEffect(() => {
    if (initialTab && isOpen) setActiveTab(initialTab)
  }, [initialTab, isOpen])

  if (!isOpen) return null

  return (
    <>
      {/* Dark backdrop — click to close */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(0, 0, 0, 0.5)',
          zIndex: 49,
        }}
      />
      {/* Centered modal */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 50,
          background: 'var(--pixel-bg)',
          border: '2px solid var(--pixel-border)',
          borderRadius: 0,
          padding: '4px',
          boxShadow: 'var(--pixel-shadow)',
          minWidth: 320,
          maxWidth: 500,
          maxHeight: '80vh',
          overflow: 'auto',
        }}
      >
        {/* Header with title and X button */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '4px 10px',
            borderBottom: '1px solid var(--pixel-border)',
            marginBottom: '4px',
          }}
        >
          <span style={{ fontSize: '24px', color: 'rgba(255, 255, 255, 0.9)' }}>Settings</span>
          <button
            onClick={onClose}
            onMouseEnter={() => setHovered('close')}
            onMouseLeave={() => setHovered(null)}
            style={{
              background: hovered === 'close' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
              border: 'none',
              borderRadius: 0,
              color: 'rgba(255, 255, 255, 0.6)',
              fontSize: '24px',
              cursor: 'pointer',
              padding: '0 4px',
              lineHeight: 1,
            }}
          >
            X
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(255, 255, 255, 0.1)', marginBottom: 4 }}>
          <button
            onClick={() => setActiveTab('general')}
            style={activeTab === 'general' ? tabBtnActiveStyle : tabBtnStyle}
          >
            General
          </button>
          <button
            onClick={() => setActiveTab('sources')}
            style={activeTab === 'sources' ? tabBtnActiveStyle : tabBtnStyle}
          >
            Session Sources
          </button>
        </div>

        {/* Tab content */}
        {activeTab === 'general' && (
          <>
            <button
              onClick={() => {
                api.send('openSessionsFolder')
                onClose()
              }}
              onMouseEnter={() => setHovered('sessions')}
              onMouseLeave={() => setHovered(null)}
              style={{
                ...menuItemBase,
                background: hovered === 'sessions' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
              }}
            >
              Open Sessions Folder
            </button>
            <button
              onClick={() => {
                api.send('exportLayout')
                onClose()
              }}
              onMouseEnter={() => setHovered('export')}
              onMouseLeave={() => setHovered(null)}
              style={{
                ...menuItemBase,
                background: hovered === 'export' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
              }}
            >
              Export Layout
            </button>
            <button
              onClick={() => {
                api.send('importLayout')
                onClose()
              }}
              onMouseEnter={() => setHovered('import')}
              onMouseLeave={() => setHovered(null)}
              style={{
                ...menuItemBase,
                background: hovered === 'import' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
              }}
            >
              Import Layout
            </button>
            <button
              onClick={() => {
                const newVal = !isSoundEnabled()
                setSoundEnabled(newVal)
                setSoundLocal(newVal)
                api.send('setSoundEnabled', { enabled: newVal })
              }}
              onMouseEnter={() => setHovered('sound')}
              onMouseLeave={() => setHovered(null)}
              style={{
                ...menuItemBase,
                background: hovered === 'sound' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
              }}
            >
              <span>Sound Notifications</span>
              <span
                style={{
                  width: 14,
                  height: 14,
                  border: '2px solid rgba(255, 255, 255, 0.5)',
                  borderRadius: 0,
                  background: soundLocal ? 'rgba(90, 140, 255, 0.8)' : 'transparent',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '12px',
                  lineHeight: 1,
                  color: '#fff',
                }}
              >
                {soundLocal ? 'X' : ''}
              </span>
            </button>
            <button
              onClick={onToggleDebugMode}
              onMouseEnter={() => setHovered('debug')}
              onMouseLeave={() => setHovered(null)}
              style={{
                ...menuItemBase,
                background: hovered === 'debug' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
              }}
            >
              <span>Debug View</span>
              {isDebugMode && (
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: 'rgba(90, 140, 255, 0.8)',
                    flexShrink: 0,
                  }}
                />
              )}
            </button>
          </>
        )}

        {activeTab === 'sources' && (
          <div style={{ padding: '4px 6px' }}>
            <SourceManager />
          </div>
        )}
      </div>
    </>
  )
}
