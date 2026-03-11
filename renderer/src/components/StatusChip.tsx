import type { StatusAssessment, SessionStatus } from '../types/domainTypes.js'

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
  const label = STATUS_LABELS[status.state] ?? status.state
  const lowConfidence = status.confidence < 0.7

  const className = [
    'status-chip',
    `status-chip-${status.state}`,
    lowConfidence ? 'status-chip-low-confidence' : '',
  ].filter(Boolean).join(' ')

  return (
    <span
      className={className}
      title={`${label} (${Math.round(status.confidence * 100)}% confidence)`}
    >
      {label}
    </span>
  )
}
