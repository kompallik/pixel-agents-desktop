import type { Alert, AlertSeverity } from '../types/domainTypes.js'

const SEVERITY_CLASS: Record<AlertSeverity, string> = {
  error: 'alert-badge-error',
  warning: 'alert-badge-warning',
  info: 'alert-badge-info',
}

function getHighestSeverity(alerts: Alert[]): AlertSeverity {
  if (alerts.some((a) => a.severity === 'error')) return 'error'
  if (alerts.some((a) => a.severity === 'warning')) return 'warning'
  return 'info'
}

interface AlertBadgeProps {
  alerts: Alert[]
}

export function AlertBadge({ alerts }: AlertBadgeProps) {
  const active = alerts.filter((a) => !a.acknowledgedAt)
  if (active.length === 0) return null

  const severity = getHighestSeverity(active)

  return (
    <span
      className={`alert-badge ${SEVERITY_CLASS[severity]}`}
      title={`${active.length} alert${active.length > 1 ? 's' : ''}`}
    >
      {active.length}
    </span>
  )
}
