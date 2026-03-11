import { useState, useEffect, useRef, useCallback } from 'react'
import type { ToolActivity } from '../office/types.js'
import type { AgentType } from '../hooks/useExtensionMessages.js'
import { api } from '../electronApi.js'

interface DebugViewProps {
  agents: number[]
  selectedAgent: number | null
  agentTools: Record<number, ToolActivity[]>
  agentStatuses: Record<number, string>
  agentTypes: Record<number, AgentType>
  subagentTools: Record<number, Record<string, ToolActivity[]>>
  onSelectAgent: (id: number) => void
}

interface IpcLogEntry {
  timestamp: string
  channel: string
  summary: string
}

interface DiagnosticsData {
  discovery: {
    knownFiles: string[]
    agentCount: number
    scanInterval: number
    agents: Array<{ id: number; agentType: string; jsonlFile: string; fileOffset: number; bufferSize: number }>
  }
  fileWatcher: {
    activeWatchers: string[]
    bufferSizes: Record<string, number>
  }
  memory: {
    heapUsed: number
    heapTotal: number
    rss: number
  }
}

/** Z-index just below the floating toolbar (50) so the toolbar stays on top */
const DEBUG_Z = 40
const MAX_IPC_LOG = 50

function ToolDot({ tool }: { tool: ToolActivity }) {
  return (
    <span
      className={tool.done ? undefined : 'pixel-agents-pulse'}
      style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: tool.done
          ? 'var(--vscode-charts-green, #89d185)'
          : tool.permissionWait
            ? 'var(--vscode-charts-yellow, #cca700)'
            : 'var(--vscode-charts-blue, #3794ff)',
        display: 'inline-block',
        flexShrink: 0,
      }}
    />
  )
}

function ToolLine({ tool }: { tool: ToolActivity }) {
  return (
    <span
      style={{
        fontSize: '22px',
        opacity: tool.done ? 0.5 : 0.8,
        display: 'flex',
        alignItems: 'center',
        gap: 5,
      }}
    >
      <ToolDot tool={tool} />
      {tool.permissionWait && !tool.done ? 'Needs approval' : tool.status}
    </span>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function nowTimestamp(): string {
  return new Date().toISOString().slice(11, 23)
}

export function DebugView({
  agents,
  selectedAgent,
  agentTools,
  agentStatuses,
  agentTypes,
  subagentTools,
  onSelectAgent,
}: DebugViewProps) {
  const [ipcLog, setIpcLog] = useState<IpcLogEntry[]>([])
  const [diagnostics, setDiagnostics] = useState<DiagnosticsData | null>(null)
  const [dumpCopied, setDumpCopied] = useState(false)
  const ipcLogRef = useRef<IpcLogEntry[]>([])

  // Listen to IPC messages for the log
  useEffect(() => {
    const channels = [
      'agentCreated', 'agentClosed', 'agentToolStart', 'agentToolDone',
      'agentToolsClear', 'agentStatus', 'agentToolPermission', 'agentToolPermissionClear',
      'subagentToolStart', 'subagentToolDone', 'subagentClear',
      'diagnosticsDump',
    ]
    const cleanups = channels.map((channel) =>
      api.on(channel, (data) => {
        const entry: IpcLogEntry = {
          timestamp: nowTimestamp(),
          channel,
          summary: JSON.stringify(data).slice(0, 120),
        }
        const next = [entry, ...ipcLogRef.current].slice(0, MAX_IPC_LOG)
        ipcLogRef.current = next
        setIpcLog(next)

        if (channel === 'diagnosticsDump') {
          setDiagnostics(data as DiagnosticsData)
        }
      }),
    )
    return () => cleanups.forEach((c) => c())
  }, [])

  const handleRefreshDiagnostics = useCallback(() => {
    api.send('requestDiagnostics')
  }, [])

  const handleDumpState = useCallback(() => {
    const dump = {
      timestamp: new Date().toISOString(),
      agents,
      selectedAgent,
      agentTools,
      agentStatuses,
      agentTypes,
      subagentTools,
      diagnostics,
      ipcLog: ipcLogRef.current,
    }
    navigator.clipboard.writeText(JSON.stringify(dump, null, 2)).then(() => {
      setDumpCopied(true)
      setTimeout(() => setDumpCopied(false), 2000)
    })
  }, [agents, selectedAgent, agentTools, agentStatuses, agentTypes, subagentTools, diagnostics])

  const sectionStyle: React.CSSProperties = {
    borderTop: '1px solid rgba(255,255,255,0.1)',
    marginTop: 10,
    paddingTop: 8,
  }

  const labelStyle: React.CSSProperties = {
    fontSize: '22px',
    fontWeight: 'bold',
    opacity: 0.7,
    marginBottom: 4,
  }

  const monoStyle: React.CSSProperties = {
    fontSize: '18px',
    fontFamily: 'monospace',
    opacity: 0.7,
    lineHeight: 1.4,
  }

  const btnStyle: React.CSSProperties = {
    borderRadius: 0,
    padding: '4px 10px',
    fontSize: '20px',
    cursor: 'pointer',
  }

  const renderAgentCard = (id: number) => {
    const isSelected = selectedAgent === id
    const tools = agentTools[id] || []
    const subs = subagentTools[id] || {}
    const status = agentStatuses[id]
    const aType = agentTypes[id] || 'claude'
    const hasActiveTools = tools.some((t) => !t.done)

    // Find matching discovery info
    const discAgent = diagnostics?.discovery.agents.find((a) => a.id === id)

    return (
      <div
        key={id}
        style={{
          border: `2px solid ${isSelected ? '#5a8cff' : '#4a4a6a'}`,
          borderRadius: 0,
          padding: '6px 8px',
          background: isSelected ? 'var(--vscode-list-activeSelectionBackground, rgba(255,255,255,0.04))' : undefined,
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 0 }}>
          <button
            onClick={() => onSelectAgent(id)}
            style={{
              borderRadius: 0,
              padding: '6px 10px',
              fontSize: '26px',
              background: isSelected ? 'rgba(90, 140, 255, 0.25)' : undefined,
              color: isSelected ? '#fff' : undefined,
              fontWeight: isSelected ? 'bold' : undefined,
            }}
          >
            {aType === 'codex' ? 'Codex' : 'Claude'} #{id}
          </button>
          <button
            onClick={() => api.send('closeAgent', { id })}
            style={{
              borderRadius: 0,
              padding: '6px 8px',
              fontSize: '26px',
              opacity: 0.7,
              background: isSelected ? 'rgba(90, 140, 255, 0.25)' : undefined,
              color: isSelected ? '#fff' : undefined,
            }}
            title="Close agent"
          >
            ✕
          </button>
        </span>
        {discAgent && (
          <div style={{ ...monoStyle, paddingLeft: 4, marginTop: 2 }}>
            <div>File: {discAgent.jsonlFile}</div>
            <div>Offset: {formatBytes(discAgent.fileOffset)} | Buffer: {formatBytes(discAgent.bufferSize)}</div>
          </div>
        )}
        {(tools.length > 0 || status === 'waiting') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginTop: 4, paddingLeft: 4 }}>
            {tools.map((tool) => (
              <div key={tool.toolId}>
                <ToolLine tool={tool} />
                {subs[tool.toolId] && subs[tool.toolId].length > 0 && (
                  <div
                    style={{
                      borderLeft: '2px solid var(--vscode-widget-border, rgba(255,255,255,0.12))',
                      marginLeft: 3,
                      paddingLeft: 8,
                      marginTop: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 1,
                    }}
                  >
                    {subs[tool.toolId].map((subTool) => (
                      <ToolLine key={subTool.toolId} tool={subTool} />
                    ))}
                  </div>
                )}
              </div>
            ))}
            {status === 'waiting' && !hasActiveTools && (
              <span
                style={{
                  fontSize: '22px',
                  opacity: 0.85,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: 'var(--vscode-charts-yellow, #cca700)',
                    display: 'inline-block',
                    flexShrink: 0,
                  }}
                />
                Might be waiting for input
              </span>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        background: 'var(--vscode-editor-background)',
        zIndex: DEBUG_Z,
        overflow: 'auto',
      }}
    >
      {/* Top padding so cards don't overlap the floating toolbar */}
      <div style={{ padding: '12px 12px 12px', fontSize: '28px' }}>
        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <button style={btnStyle} onClick={handleRefreshDiagnostics}>
            Refresh Diagnostics
          </button>
          <button style={btnStyle} onClick={handleDumpState}>
            {dumpCopied ? 'Copied!' : 'Dump State'}
          </button>
        </div>

        {/* Sessions section */}
        <div style={labelStyle}>
          Sessions ({agents.length} active)
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {agents.map(renderAgentCard)}
          {agents.length === 0 && (
            <div style={{ ...monoStyle, opacity: 0.4 }}>No active sessions</div>
          )}
        </div>

        {/* Diagnostics section */}
        {diagnostics && (
          <div style={sectionStyle}>
            <div style={labelStyle}>Main Process Diagnostics</div>
            <div style={monoStyle}>
              <div>Discovery: {diagnostics.discovery.agentCount} agents, {diagnostics.discovery.knownFiles.length} files tracked, scan every {diagnostics.discovery.scanInterval}ms</div>
              <div>Watchers: {diagnostics.fileWatcher.activeWatchers.length} active</div>
              <div>Memory: heap {formatBytes(diagnostics.memory.heapUsed)}/{formatBytes(diagnostics.memory.heapTotal)}, RSS {formatBytes(diagnostics.memory.rss)}</div>
            </div>
          </div>
        )}

        {/* IPC Message Log */}
        <div style={sectionStyle}>
          <div style={labelStyle}>IPC Log (last {MAX_IPC_LOG})</div>
          <div style={{ maxHeight: 300, overflow: 'auto' }}>
            {ipcLog.length === 0 && (
              <div style={{ ...monoStyle, opacity: 0.4 }}>No messages yet</div>
            )}
            {ipcLog.map((entry, i) => (
              <div key={i} style={{ ...monoStyle, display: 'flex', gap: 6 }}>
                <span style={{ opacity: 0.5, flexShrink: 0 }}>{entry.timestamp}</span>
                <span style={{ color: '#7cacf8', flexShrink: 0 }}>{entry.channel}</span>
                <span style={{ opacity: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.summary}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
