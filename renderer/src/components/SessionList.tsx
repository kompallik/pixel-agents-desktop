import { useState, useMemo, useCallback } from 'react'
import { useSessionStore } from '../stores/sessionStore.js'
import { useAlertStore, getAlertsBySession } from '../stores/alertStore.js'
import { useFilteredSessions } from '../hooks/useSessions.js'
import type { SessionViewState, SessionStatus } from '../types/domainTypes.js'
import { StatusChip } from './StatusChip.js'
import { HealthIndicator } from './HealthIndicator.js'
import { AlertBadge } from './AlertBadge.js'
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
  const alertsMap = useAlertStore((s) => s.alerts)
  const alerts = useMemo(() => getAlertsBySession(alertsMap, session.sessionId), [alertsMap, session.sessionId])
  const displayName = session.projectName ?? truncatePath(session.filePath)

  return (
    <button
      onClick={() => onSelect(session.sessionId)}
      className={`session-item${isSelected ? ' selected' : ''}`}
    >
      <span
        className="session-dot"
        style={{ background: getAgentColor(session.agentId) }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="session-name" title={session.filePath}>
          {session.runMode === 'replay' && (
            <span style={{ fontSize: '10px', marginRight: 4, opacity: 0.7 }} title="Replay session">R</span>
          )}
          {displayName}
        </div>
        <div className="session-meta">
          {session.agentType} #{session.agentId}
          {session.branch ? ` \u00b7 ${session.branch}` : ''}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <AlertBadge alerts={alerts} />
          <StatusChip status={session.status} />
        </div>
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
  const alerts = useAlertStore((s) => s.alerts)
  const filtered = useFilteredSessions()

  const allSessions = useMemo(() => Array.from(sessions.values()), [sessions])

  const alertCountBySession = useMemo(() => {
    const counts = new Map<string, number>()
    for (const a of alerts.values()) {
      if (a.acknowledgedAt) continue
      counts.set(a.sessionId, (counts.get(a.sessionId) ?? 0) + 1)
    }
    return counts
  }, [alerts])

  const sorted = useMemo(() => {
    const items = [...filtered]
    switch (sortMode) {
      case 'name':
        items.sort((a, b) => (a.projectName ?? a.filePath).localeCompare(b.projectName ?? b.filePath))
        break
      case 'activity':
        items.sort((a, b) => (b.lastEventAt ?? '').localeCompare(a.lastEventAt ?? ''))
        break
      case 'alerts':
        items.sort((a, b) => {
          const aAlerts = alertCountBySession.get(a.sessionId) ?? 0
          const bAlerts = alertCountBySession.get(b.sessionId) ?? 0
          if (aAlerts !== bAlerts) return bAlerts - aAlerts
          return (b.lastEventAt ?? '').localeCompare(a.lastEventAt ?? '')
        })
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
  }, [filtered, sortMode, alertCountBySession])

  const handleSelect = useCallback((sessionId: string) => {
    selectSession(selectedSessionId === sessionId ? null : sessionId)
  }, [selectSession, selectedSessionId])

  return (
    <div className="session-list">
      <div className="session-list-header">
        <TopMetricsBar />
        <FilterBar sessions={allSessions} sortMode={sortMode} onSortChange={setSortMode} />
      </div>
      <div className="session-list-items">
        {sorted.length === 0 && (
          <div className="session-empty">No sessions found</div>
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
