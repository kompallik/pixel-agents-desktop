import { useState, useEffect, useRef } from 'react'
import { useSelectedSession } from '../hooks/useSessions.js'
import { StatusChip } from '../components/StatusChip.js'
import { HealthIndicator } from '../components/HealthIndicator.js'
import { AlertPanel } from '../components/AlertPanel.js'
import { ReplayControls } from '../components/ReplayControls.js'
import { useAlertStore, getAlertsBySession } from '../stores/alertStore.js'
import { api } from '../electronApi.js'
import type { ToolInfo } from '../types/domainTypes.js'

function formatDuration(startedAt: string): string {
  const start = new Date(startedAt).getTime()
  if (isNaN(start)) return '-'
  const elapsed = Math.max(0, Date.now() - start)
  const secs = Math.floor(elapsed / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ${secs % 60}s`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

function formatTime(iso: string | undefined): string {
  if (!iso) return '-'
  try {
    return new Date(iso).toLocaleTimeString()
  } catch {
    return iso
  }
}

function ToolRow({ tool, live }: { tool: ToolInfo; live?: boolean }) {
  const [, setTick] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined)

  useEffect(() => {
    if (live && tool.status === 'active') {
      intervalRef.current = setInterval(() => setTick((n) => n + 1), 1000)
      return () => clearInterval(intervalRef.current)
    }
  }, [live, tool.status])

  return (
    <div className={`tool-row${tool.status === 'completed' ? ' tool-row-completed' : ''}`}>
      <span className="tool-row-name">{tool.toolName}</span>
      <span className="tool-row-time">
        {tool.status === 'active' ? formatDuration(tool.startedAt) : (tool.status === 'failed' ? 'failed' : formatTime(tool.completedAt))}
      </span>
    </div>
  )
}

function CollapsibleSection({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen ?? true)
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="inspector-collapsible-header inspector-section-title"
      >
        <span className={`inspector-collapsible-arrow${open ? ' open' : ''}`}>&#9654;</span>
        {title}
      </button>
      {open && children}
    </div>
  )
}

export function InspectorPanel() {
  const session = useSelectedSession()
  const alerts = useAlertStore((s) => s.alerts)
  const sessionAlerts = session ? getAlertsBySession(alerts, session.sessionId) : []

  if (!session) {
    return <div className="inspector-empty">Select a session to inspect</div>
  }

  const handleOpenTranscript = () => {
    api.invoke('shell:openPath', session.filePath)
  }

  return (
    <div className="inspector-panel">
      {/* Header */}
      <div className="inspector-header">
        <StatusChip status={session.status} />
        <span className="inspector-header-title">
          {session.projectName ?? 'Session'}
        </span>
        <HealthIndicator score={session.healthScore} />
      </div>

      {/* Replay controls */}
      {session.runMode === 'replay' && (
        <ReplayControls sessionId={session.sessionId} />
      )}

      {/* Metadata */}
      <CollapsibleSection title="Metadata">
        <div className="inspector-row"><span className="inspector-label">Agent</span><span className="inspector-value">{session.agentType} #{session.agentId}</span></div>
        <div className="inspector-row"><span className="inspector-label">Source</span><span className="inspector-value">{session.sourceId}</span></div>
        <div className="inspector-row"><span className="inspector-label">Mode</span><span className="inspector-value">{session.runMode}</span></div>
        <div className="inspector-row"><span className="inspector-label">Events</span><span className="inspector-value">{session.eventCount}</span></div>
        {session.branch && <div className="inspector-row"><span className="inspector-label">Branch</span><span className="inspector-value">{session.branch}</span></div>}
        <div className="inspector-row" style={{ flexDirection: 'column', gap: 0 }}>
          <span className="inspector-label">File</span>
          <span className="inspector-value" style={{ fontSize: '10px' }}>{session.filePath}</span>
        </div>
        <button onClick={handleOpenTranscript} className="open-transcript-btn">
          Open Transcript
        </button>
      </CollapsibleSection>

      {/* Status details */}
      <CollapsibleSection title={`Status (${Math.round(session.status.confidence * 100)}%)`}>
        {session.status.reasons.length > 0 ? (
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {session.status.reasons.map((r, i) => (
              <li key={i} className="inspector-reason">{r}</li>
            ))}
          </ul>
        ) : (
          <div className="inspector-no-data">No status reasons</div>
        )}
      </CollapsibleSection>

      {/* Alerts */}
      {sessionAlerts.length > 0 && (
        <CollapsibleSection title={`Alerts (${sessionAlerts.length})`}>
          <AlertPanel alerts={sessionAlerts} />
        </CollapsibleSection>
      )}

      {/* Active tools */}
      {session.activeTools.length > 0 && (
        <CollapsibleSection title={`Active Tools (${session.activeTools.length})`}>
          {session.activeTools.map((tool) => (
            <ToolRow key={tool.toolId} tool={tool} live />
          ))}
        </CollapsibleSection>
      )}

      {/* Recent tools */}
      <CollapsibleSection title="Recent Tools" defaultOpen={session.activeTools.length === 0}>
        {session.recentTools.length === 0 ? (
          <div className="inspector-no-data">No recent tools</div>
        ) : (
          session.recentTools.slice(0, 10).map((tool) => (
            <ToolRow key={tool.toolId} tool={tool} />
          ))
        )}
      </CollapsibleSection>

      {/* Timestamps */}
      <CollapsibleSection title="Activity" defaultOpen={false}>
        <div className="inspector-row"><span className="inspector-label">Last event</span><span className="inspector-value">{formatTime(session.lastEventAt)}</span></div>
        <div className="inspector-row"><span className="inspector-label">Last write</span><span className="inspector-value">{formatTime(session.lastFileWriteAt)}</span></div>
      </CollapsibleSection>
    </div>
  )
}
