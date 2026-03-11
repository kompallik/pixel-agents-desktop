import type { StatusAssessment, SessionStatus } from '../types/domainTypes.js'

interface StatusColors {
  background: string
  color: string
  border: string
}

const STATUS_STYLE: Record<SessionStatus, StatusColors> = {
  editing:            { background: '#1a4a1a', color: '#4dff4d', border: '#4dff4d' },
  executing:          { background: '#1a4a1a', color: '#4dff4d', border: '#4dff4d' },
  reading:            { background: '#1a4a1a', color: '#4dff4d', border: '#4dff4d' },
  waiting_input:      { background: '#4a3a00', color: '#ffcc00', border: '#ffcc00' },
  waiting_permission: { background: '#4a3a00', color: '#ffcc00', border: '#ffcc00' },
  stalled:            { background: '#4a2000', color: '#ff8c00', border: '#ff8c00' },
  errored:            { background: '#4a0000', color: '#ff4444', border: '#ff4444' },
  idle:               { background: '#2a2a2a', color: '#888',    border: '#555' },
  starting:           { background: '#2a2a2a', color: '#888',    border: '#555' },
  completed:          { background: '#2a2a2a', color: '#888',    border: '#555' },
  dormant:            { background: '#1a1a1a', color: '#555',    border: '#333' },
}

const STATUS_LABELS: Record<SessionStatus, string> = {
  editing: 'Editing',
  executing: 'Executing',
  reading: 'Reading',
  waiting_input: 'Waiting',
  waiting_permission: 'Permission',
  stalled: 'Stalled',
  errored: 'Error',
  idle: 'Idle',
  starting: 'Starting',
  completed: 'Done',
  dormant: 'Dormant',
}

interface StatusChipProps {
  status: StatusAssessment
}

export function StatusChip({ status }: StatusChipProps) {
  const style = STATUS_STYLE[status.state] ?? STATUS_STYLE.idle
  const label = STATUS_LABELS[status.state] ?? status.state
  const lowConfidence = status.confidence < 0.7

  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        fontSize: 11,
        fontWeight: 500,
        color: style.color,
        background: style.background,
        border: `1px solid ${style.border}`,
        borderRadius: 9999,
        opacity: lowConfidence ? 0.65 : 1,
        whiteSpace: 'nowrap',
        lineHeight: '16px',
      }}
      title={`${label} (${Math.round(status.confidence * 100)}% confidence)`}
    >
      {label}
    </span>
  )
}
