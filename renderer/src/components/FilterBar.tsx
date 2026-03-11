import { useMemo } from 'react'
import { useSessionStore } from '../stores/sessionStore.js'
import type { SessionStatus, SessionViewState } from '../types/domainTypes.js'

export type SortMode = 'attention' | 'name' | 'activity'

interface FilterBarProps {
  sessions: SessionViewState[]
  sortMode: SortMode
  onSortChange: (mode: SortMode) => void
}

const FILTER_STATUSES: { value: SessionStatus | null; label: string }[] = [
  { value: null, label: 'All' },
  { value: 'executing', label: 'Active' },
  { value: 'waiting_input', label: 'Waiting' },
  { value: 'stalled', label: 'Stalled' },
  { value: 'errored', label: 'Errored' },
  { value: 'dormant', label: 'Dormant' },
]

const chipBase: React.CSSProperties = {
  padding: '2px 8px',
  fontSize: '14px',
  border: '1px solid rgba(255, 255, 255, 0.12)',
  borderRadius: 10,
  background: 'transparent',
  color: 'rgba(255, 255, 255, 0.6)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const chipActive: React.CSSProperties = {
  ...chipBase,
  background: 'rgba(90, 140, 255, 0.2)',
  borderColor: 'rgba(90, 140, 255, 0.5)',
  color: 'rgba(255, 255, 255, 0.9)',
}

export function FilterBar({ sessions, sortMode, onSortChange }: FilterBarProps) {
  const filterStatus = useSessionStore((s) => s.filterStatus)
  const searchQuery = useSessionStore((s) => s.searchQuery)
  const setFilterStatus = useSessionStore((s) => s.setFilterStatus)
  const setSearchQuery = useSessionStore((s) => s.setSearchQuery)

  const counts = useMemo(() => {
    const c: Partial<Record<SessionStatus, number>> = {}
    for (const s of sessions) {
      c[s.status.state] = (c[s.status.state] ?? 0) + 1
    }
    return c
  }, [sessions])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 8px' }}>
      {/* Search */}
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search sessions..."
        style={{
          width: '100%',
          padding: '4px 8px',
          fontSize: '16px',
          background: 'rgba(255, 255, 255, 0.04)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: 0,
          color: 'rgba(255, 255, 255, 0.8)',
          outline: 'none',
          boxSizing: 'border-box',
        }}
      />
      {/* Filter chips + sort */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        {FILTER_STATUSES.map((f) => (
          <button
            key={f.label}
            onClick={() => setFilterStatus(f.value)}
            style={filterStatus === f.value ? chipActive : chipBase}
          >
            {f.label}
            {f.value && counts[f.value] ? ` (${counts[f.value]})` : ''}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <select
          value={sortMode}
          onChange={(e) => onSortChange(e.target.value as SortMode)}
          style={{
            fontSize: '14px',
            padding: '2px 4px',
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: 0,
            color: 'rgba(255, 255, 255, 0.7)',
          }}
        >
          <option value="attention">By Attention</option>
          <option value="name">By Name</option>
          <option value="activity">By Activity</option>
        </select>
      </div>
    </div>
  )
}
