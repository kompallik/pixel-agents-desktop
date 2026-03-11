import { useMemo } from 'react'
import { useSessionStore } from '../stores/sessionStore.js'
import { useAlertStore, getAlertCount } from '../stores/alertStore.js'
import type { SessionStatus } from '../types/domainTypes.js'

const METRIC_STATUSES: { status: SessionStatus; label: string; color: string }[] = [
  { status: 'executing', label: 'Active', color: 'var(--status-executing-fg)' },
  { status: 'waiting_input', label: 'Waiting', color: 'var(--status-waiting-fg)' },
  { status: 'stalled', label: 'Stalled', color: 'var(--status-stalled-fg)' },
  { status: 'errored', label: 'Errored', color: 'var(--status-errored-fg)' },
  { status: 'dormant', label: 'Dormant', color: 'var(--status-dormant-fg)' },
]

export function TopMetricsBar() {
  const sessions = useSessionStore((s) => s.sessions)
  const setFilterStatus = useSessionStore((s) => s.setFilterStatus)
  const alerts = useAlertStore((s) => s.alerts)
  const alertCount = useMemo(() => getAlertCount(alerts), [alerts])

  const counts = useMemo(() => {
    const c: Partial<Record<SessionStatus, number>> = {}
    for (const s of sessions.values()) {
      c[s.status.state] = (c[s.status.state] ?? 0) + 1
    }
    return c
  }, [sessions])

  const displayCounts = useMemo(() => {
    return METRIC_STATUSES.map((m) => {
      let count = counts[m.status] ?? 0
      if (m.status === 'executing') {
        count += (counts['reading'] ?? 0) + (counts['editing'] ?? 0)
      }
      if (m.status === 'waiting_input') {
        count += (counts['waiting_permission'] ?? 0)
      }
      return { ...m, count }
    })
  }, [counts])

  return (
    <div className="top-metrics-bar">
      {displayCounts.map((m) => (
        <button
          key={m.status}
          onClick={() => setFilterStatus(m.count > 0 ? m.status : null)}
          className={`metric-item${m.count === 0 ? ' disabled' : ''}`}
        >
          <span className="metric-count" style={{ color: m.color }}>{m.count}</span>
          <span className="metric-label">{m.label}</span>
        </button>
      ))}
      <div className={`metric-item${alertCount === 0 ? ' disabled' : ''}`}>
        <span className="metric-count" style={{ color: 'var(--status-errored-fg)' }}>{alertCount}</span>
        <span className="metric-label">Alerts</span>
      </div>
    </div>
  )
}
