import { useMemo } from 'react'
import { useSessionStore } from '../stores/sessionStore.js'
import type { SessionStatus } from '../types/domainTypes.js'

const METRIC_STATUSES: { status: SessionStatus; label: string; color: string }[] = [
  { status: 'executing', label: 'Active', color: '#4ec98b' },
  { status: 'waiting_input', label: 'Waiting', color: '#cca700' },
  { status: 'stalled', label: 'Stalled', color: '#e89040' },
  { status: 'errored', label: 'Errored', color: '#e05050' },
  { status: 'dormant', label: 'Dormant', color: '#555' },
]

export function TopMetricsBar() {
  const sessions = useSessionStore((s) => s.sessions)
  const setFilterStatus = useSessionStore((s) => s.setFilterStatus)

  const counts = useMemo(() => {
    const c: Partial<Record<SessionStatus, number>> = {}
    for (const s of sessions.values()) {
      c[s.status.state] = (c[s.status.state] ?? 0) + 1
    }
    return c
  }, [sessions])

  // Merge related statuses for display
  const displayCounts = useMemo(() => {
    return METRIC_STATUSES.map((m) => {
      let count = counts[m.status] ?? 0
      // Include reading/editing in "Active" count
      if (m.status === 'executing') {
        count += (counts['reading'] ?? 0) + (counts['editing'] ?? 0)
      }
      // Include waiting_permission in "Waiting" count
      if (m.status === 'waiting_input') {
        count += (counts['waiting_permission'] ?? 0)
      }
      return { ...m, count }
    })
  }, [counts])

  return (
    <div
      style={{
        display: 'flex',
        gap: 2,
        padding: '6px 8px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
      }}
    >
      {displayCounts.map((m) => (
        <button
          key={m.status}
          onClick={() => setFilterStatus(m.count > 0 ? m.status : null)}
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 1,
            padding: '3px 4px',
            background: 'transparent',
            border: 'none',
            borderRadius: 0,
            cursor: m.count > 0 ? 'pointer' : 'default',
            opacity: m.count > 0 ? 1 : 0.35,
          }}
        >
          <span style={{ fontSize: '18px', fontWeight: 'bold', color: m.color }}>{m.count}</span>
          <span style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.5)' }}>{m.label}</span>
        </button>
      ))}
    </div>
  )
}
