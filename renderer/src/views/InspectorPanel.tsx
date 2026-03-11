import { useState, useEffect, useRef } from 'react'
import { useSelectedSession } from '../hooks/useSessions.js'
import { StatusChip } from '../components/StatusChip.js'
import { HealthIndicator } from '../components/HealthIndicator.js'
import { api } from '../electronApi.js'
import type { ToolInfo } from '../types/domainTypes.js'

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  color: 'rgba(255, 255, 255, 0.55)',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  padding: '8px 0 4px',
}

const labelStyle: React.CSSProperties = {
  fontSize: '13px',
  color: 'rgba(255, 255, 255, 0.45)',
}

const valueStyle: React.CSSProperties = {
  fontSize: '14px',
  color: 'rgba(255, 255, 255, 0.8)',
  wordBreak: 'break-all',
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: 8,
  padding: '2px 0',
}

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
    <div style={{ ...rowStyle, opacity: tool.status === 'completed' ? 0.5 : 1 }}>
      <span style={{ fontSize: '14px', color: 'rgba(255, 255, 255, 0.8)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {tool.toolName}
      </span>
      <span style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.45)', flexShrink: 0 }}>
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
        style={{
          ...sectionTitleStyle,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          width: '100%',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ fontSize: '10px', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>▶</span>
        {title}
      </button>
      {open && children}
    </div>
  )
}

export function InspectorPanel() {
  const session = useSelectedSession()

  if (!session) {
    return (
      <div style={{ padding: 16, color: 'rgba(255, 255, 255, 0.35)', fontSize: '14px', textAlign: 'center' }}>
        Select a session to inspect
      </div>
    )
  }

  const handleOpenTranscript = () => {
    api.invoke('shell:openPath', session.filePath)
  }

  return (
    <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 2, overflow: 'auto', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 6, borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
        <StatusChip status={session.status} />
        <span style={{ flex: 1, fontSize: '16px', fontWeight: 600, color: 'rgba(255, 255, 255, 0.9)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {session.projectName ?? 'Session'}
        </span>
        <HealthIndicator score={session.healthScore} />
      </div>

      {/* Metadata */}
      <CollapsibleSection title="Metadata">
        <div style={rowStyle}><span style={labelStyle}>Agent</span><span style={valueStyle}>{session.agentType} #{session.agentId}</span></div>
        <div style={rowStyle}><span style={labelStyle}>Source</span><span style={valueStyle}>{session.sourceId}</span></div>
        <div style={rowStyle}><span style={labelStyle}>Mode</span><span style={valueStyle}>{session.runMode}</span></div>
        <div style={rowStyle}><span style={labelStyle}>Events</span><span style={valueStyle}>{session.eventCount}</span></div>
        {session.branch && <div style={rowStyle}><span style={labelStyle}>Branch</span><span style={valueStyle}>{session.branch}</span></div>}
        <div style={{ ...rowStyle, flexDirection: 'column', gap: 0 }}>
          <span style={labelStyle}>File</span>
          <span style={{ ...valueStyle, fontSize: '12px' }}>{session.filePath}</span>
        </div>
        <button
          onClick={handleOpenTranscript}
          style={{
            marginTop: 4,
            padding: '3px 8px',
            fontSize: '13px',
            background: 'rgba(255, 255, 255, 0.06)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: 0,
            color: 'rgba(255, 255, 255, 0.7)',
            cursor: 'pointer',
          }}
        >
          Open Transcript
        </button>
      </CollapsibleSection>

      {/* Status details */}
      <CollapsibleSection title={`Status (${Math.round(session.status.confidence * 100)}%)`}>
        {session.status.reasons.length > 0 ? (
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {session.status.reasons.map((r, i) => (
              <li key={i} style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.6)', padding: '1px 0' }}>{r}</li>
            ))}
          </ul>
        ) : (
          <div style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.35)' }}>No status reasons</div>
        )}
      </CollapsibleSection>

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
          <div style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.35)' }}>No recent tools</div>
        ) : (
          session.recentTools.slice(0, 10).map((tool) => (
            <ToolRow key={tool.toolId} tool={tool} />
          ))
        )}
      </CollapsibleSection>

      {/* Timestamps */}
      <CollapsibleSection title="Activity" defaultOpen={false}>
        <div style={rowStyle}><span style={labelStyle}>Last event</span><span style={valueStyle}>{formatTime(session.lastEventAt)}</span></div>
        <div style={rowStyle}><span style={labelStyle}>Last write</span><span style={valueStyle}>{formatTime(session.lastFileWriteAt)}</span></div>
      </CollapsibleSection>
    </div>
  )
}
