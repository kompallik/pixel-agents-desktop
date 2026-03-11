import { useMemo } from 'react'
import { useSessionStore } from '../stores/sessionStore.js'
import type { SessionStatus, SessionViewState } from '../types/domainTypes.js'

export type SortMode = 'attention' | 'name' | 'activity' | 'alerts'

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
    <div className="filter-bar">
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search sessions..."
        className="filter-bar-search"
      />
      <div className="filter-chips">
        {FILTER_STATUSES.map((f) => (
          <button
            key={f.label}
            onClick={() => setFilterStatus(f.value)}
            className={`filter-chip${filterStatus === f.value ? ' active' : ''}`}
          >
            {f.label}
            {f.value && counts[f.value] ? ` (${counts[f.value]})` : ''}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <select
          value={sortMode}
          onChange={(e) => onSortChange(e.target.value as SortMode)}
          className="filter-sort"
        >
          <option value="attention">Attention</option>
          <option value="name">Name</option>
          <option value="activity">Activity</option>
          <option value="alerts">Alerts</option>
        </select>
      </div>
    </div>
  )
}
