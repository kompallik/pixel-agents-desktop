import { useState, useMemo, useCallback } from 'react'
import { useSessionStore } from '../stores/sessionStore.js'
import { useFilteredSessions } from '../hooks/useSessions.js'
import type { SessionViewState, SessionStatus } from '../types/domainTypes.js'
import { StatusChip } from './StatusChip.js'
import { HealthIndicator } from './HealthIndicator.js'
import { FilterBar } from './FilterBar.js'
import type { SortMode } from './FilterBar.js'
import { TopMetricsBar } from './TopMetricsBar.js'

const ATTENTION_STATUSES: ReadonlySet<SessionStatus> = new Set(['stalled', 'errored', 'waiting_permission'])

const PALETTE_COLORS = [
  '#5a8cff', '#4ec98b', '#e89040', '#c97ae8', '#e05050', '#cca700',
]

function getAgentColor(agentId: number): string {
  return PALETTE_COLORS[agentId % PALETTE_COLORS.length]
}

function truncatePath(filePath: string, maxLen: number = 32): string {
  if (filePath.length <= maxLen) return filePath
  const parts = filePath.split('/')
  const file = parts[parts.length - 1]
  if (file.length >= maxLen) return '...' + file.slice(-(maxLen - 3))
  return '.../' + parts.slice(-2).join('/')
}

interface SessionRowProps {
  session: SessionViewState
  isSelected: boolean
  onSelect: (sessionId: string) => void
}

function SessionRow({ session, isSelected, onSelect }: SessionRowProps) {
  const displayName = session.projectName ?? truncatePath(session.filePath)

  return (
    <button
      onClick={() => onSelect(session.sessionId)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        width: '100%',
        padding: '5px 8px',
        background: isSelected ? 'rgba(90, 140, 255, 0.15)' : 'transparent',
        border: 'none',
        borderLeft: isSelected ? '3px solid #4a9eff' : '3px solid transparent',
        borderRadius: 0,
        cursor: 'pointer',
        textAlign: 'left',
        color: 'rgba(255, 255, 255, 0.8)',
      }}
    >
      {/* Agent color dot */}
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: getAgentColor(session.agentId),
          flexShrink: 0,
        }}
      />
      {/* Name + path */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: '16px',
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={session.filePath}
        >
          {displayName}
        </div>
        <div style={{ fontSize: '12px', opacity: 0.45, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {session.agentType} #{session.agentId}
          {session.branch ? ` · ${session.branch}` : ''}
        </div>
      </div>
      {/* Status + health */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
        <StatusChip status={session.status} />
        <HealthIndicator score={session.healthScore} />
      </div>
    </button>
  )
}

export function SessionList() {
  const [sortMode, setSortMode] = useState<SortMode>('attention')
  const selectSession = useSessionStore((s) => s.selectSession)
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId)
  const sessions = useSessionStore((s) => s.sessions)
  const filtered = useFilteredSessions()

  const allSessions = useMemo(() => Array.from(sessions.values()), [sessions])

  const sorted = useMemo(() => {
    const items = [...filtered]
    switch (sortMode) {
      case 'name':
        items.sort((a, b) => (a.projectName ?? a.filePath).localeCompare(b.projectName ?? b.filePath))
        break
      case 'activity':
        items.sort((a, b) => (b.lastEventAt ?? '').localeCompare(a.lastEventAt ?? ''))
        break
      case 'attention':
      default:
        items.sort((a, b) => {
          const aAttn = ATTENTION_STATUSES.has(a.status.state) ? 0 : 1
          const bAttn = ATTENTION_STATUSES.has(b.status.state) ? 0 : 1
          if (aAttn !== bAttn) return aAttn - bAttn
          return (b.lastEventAt ?? '').localeCompare(a.lastEventAt ?? '')
        })
        break
    }
    return items
  }, [filtered, sortMode])

  const handleSelect = useCallback((sessionId: string) => {
    selectSession(selectedSessionId === sessionId ? null : sessionId)
  }, [selectSession, selectedSessionId])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopMetricsBar />
      <FilterBar sessions={allSessions} sortMode={sortMode} onSortChange={setSortMode} />
      <div style={{ flex: 1, overflow: 'auto', marginTop: 4 }}>
        {sorted.length === 0 && (
          <div style={{ padding: '12px 8px', fontSize: '14px', color: 'rgba(255, 255, 255, 0.35)', textAlign: 'center' }}>
            No sessions found
          </div>
        )}
        {sorted.map((session) => (
          <SessionRow
            key={session.sessionId}
            session={session}
            isSelected={selectedSessionId === session.sessionId}
            onSelect={handleSelect}
          />
        ))}
      </div>
    </div>
  )
}
