import { useCallback } from 'react'
import type { Alert } from '../types/domainTypes.js'
import { useAlertStore } from '../stores/alertStore.js'
import { api } from '../electronApi.js'

const SEVERITY_ICONS: Record<string, string> = {
  error: '\uD83D\uDD34',
  warning: '\uD83D\uDFE1',
  info: '\u2139\uFE0F',
}

const RULE_LABELS: Record<string, string> = {
  stale_session: 'Stale',
  failure_burst: 'Failures',
  permission_loop: 'Perm Loop',
  unreadable_file: 'Unreadable',
  parser_error: 'Parse Error',
  duplicate_worktree: 'Dup Worktree',
  child_active_parent_silent: 'Parent Silent',
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  return `${Math.floor(mins / 60)}h ago`
}

interface AlertPanelProps {
  alerts: Alert[]
}

function AlertRow({ alert }: { alert: Alert }) {
  const acknowledge = useAlertStore((s) => s.acknowledge)

  const handleDismiss = useCallback(() => {
    acknowledge(alert.id)
    api.acknowledgeAlert(alert.id)
  }, [alert.id, acknowledge])

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 6,
        padding: '4px 0',
        borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
      }}
    >
      <span style={{ fontSize: '13px', flexShrink: 0 }}>
        {SEVERITY_ICONS[alert.severity] ?? ''}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: '11px',
              padding: '1px 5px',
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: 6,
              color: 'rgba(255, 255, 255, 0.5)',
              whiteSpace: 'nowrap',
            }}
          >
            {RULE_LABELS[alert.rule] ?? alert.rule}
          </span>
          <span style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.35)' }}>
            {formatRelativeTime(alert.createdAt)}
          </span>
        </div>
        <div style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.75)', marginTop: 1 }}>
          {alert.message}
        </div>
        {alert.details && (
          <div style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.4)', marginTop: 1 }}>
            {alert.details}
          </div>
        )}
      </div>
      <button
        onClick={handleDismiss}
        style={{
          padding: '2px 6px',
          fontSize: '11px',
          background: 'rgba(255, 255, 255, 0.04)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: 0,
          color: 'rgba(255, 255, 255, 0.5)',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        Dismiss
      </button>
    </div>
  )
}

export function AlertPanel({ alerts }: AlertPanelProps) {
  const active = alerts.filter((a) => !a.acknowledgedAt)
  if (active.length === 0) return null

  return (
    <div>
      {active.map((alert) => (
        <AlertRow key={alert.id} alert={alert} />
      ))}
    </div>
  )
}
