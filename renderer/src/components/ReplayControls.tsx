import { useMemo } from 'react'
import { useReplayStore } from '../stores/replayStore.js'
import { api } from '../electronApi.js'
import type { ReplaySpeed, JumpTarget } from '../types/domainTypes.js'

interface ReplayControlsProps {
  sessionId: string
}

const SPEEDS: ReplaySpeed[] = [1, 2, 5, 10, 20]

const containerStyle: React.CSSProperties = {
  padding: '6px 0',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexWrap: 'wrap',
}

const btnStyle: React.CSSProperties = {
  padding: '3px 6px',
  fontSize: '12px',
  background: 'rgba(255, 255, 255, 0.06)',
  border: '1px solid rgba(255, 255, 255, 0.12)',
  borderRadius: 0,
  color: 'rgba(255, 255, 255, 0.7)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const playBtnStyle: React.CSSProperties = {
  ...btnStyle,
  padding: '3px 10px',
  fontSize: '13px',
  fontWeight: 600,
  background: 'rgba(90, 140, 255, 0.2)',
  border: '1px solid rgba(90, 140, 255, 0.4)',
  color: 'rgba(200, 220, 255, 0.9)',
}

const selectStyle: React.CSSProperties = {
  padding: '2px 4px',
  fontSize: '12px',
  background: 'rgba(255, 255, 255, 0.06)',
  border: '1px solid rgba(255, 255, 255, 0.12)',
  borderRadius: 0,
  color: 'rgba(255, 255, 255, 0.7)',
  cursor: 'pointer',
}

const labelStyle: React.CSSProperties = {
  fontSize: '11px',
  color: 'rgba(255, 255, 255, 0.4)',
}

const valueStyle: React.CSSProperties = {
  fontSize: '12px',
  color: 'rgba(255, 255, 255, 0.65)',
  fontFamily: 'monospace',
}

export function ReplayControls({ sessionId }: ReplayControlsProps) {
  const status = useReplayStore((s) => s.replayStatuses.get(sessionId))
  const events = useReplayStore((s) => s.recentEvents.get(sessionId) ?? [])

  const errorPositions = useMemo(() => {
    if (!status || status.totalEvents === 0) return []
    return events
      .filter((e) => e.type === 'tool_failed' || e.type === 'session_error')
      .map((e) => {
        const idx = events.indexOf(e)
        return idx >= 0 ? (idx / status.totalEvents) * 100 : -1
      })
      .filter((p) => p >= 0)
  }, [events, status])

  const toolPositions = useMemo(() => {
    if (!status || status.totalEvents === 0) return []
    return events
      .filter((e) => e.type === 'tool_started')
      .map((e) => {
        const idx = events.indexOf(e)
        return idx >= 0 ? (idx / status.totalEvents) * 100 : -1
      })
      .filter((p) => p >= 0)
  }, [events, status])

  if (!status) {
    return (
      <div style={{ ...containerStyle, opacity: 0.5 }}>
        <span style={labelStyle}>Replay: waiting for data...</span>
      </div>
    )
  }

  const isPlaying = status.state === 'playing'
  const maxIndex = Math.max(0, status.totalEvents - 1)

  const handlePlayPause = () => {
    if (isPlaying) {
      api.replayControl(sessionId, 'pause')
    } else {
      api.replayControl(sessionId, 'play')
    }
  }

  const handleStop = () => {
    api.stopReplay(sessionId)
  }

  const handleSpeedChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const speed = parseInt(e.target.value, 10)
    api.replayControl(sessionId, 'speed', speed)
  }

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const index = parseInt(e.target.value, 10)
    api.replayControl(sessionId, 'seek', index)
  }

  const handleJump = (target: JumpTarget) => {
    api.replayControl(sessionId, 'jumpTo', target)
  }

  return (
    <div style={containerStyle}>
      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '14px', fontWeight: 600, color: 'rgba(255, 255, 255, 0.55)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Replay
        </span>
        <button onClick={handleStop} style={{ ...btnStyle, color: 'rgba(255, 100, 100, 0.8)' }} title="Stop replay">
          Stop
        </button>
      </div>

      {/* Transport controls */}
      <div style={rowStyle}>
        <button onClick={() => handleJump('prev_error')} style={btnStyle} title="Previous error">
          |&lt; err
        </button>
        <button onClick={() => handleJump('prev_tool')} style={btnStyle} title="Previous tool">
          &lt; tool
        </button>
        <button onClick={handlePlayPause} style={playBtnStyle}>
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <button onClick={() => handleJump('next_tool')} style={btnStyle} title="Next tool">
          tool &gt;
        </button>
        <button onClick={() => handleJump('next_error')} style={btnStyle} title="Next error">
          err &gt;|
        </button>
      </div>

      {/* Speed selector */}
      <div style={{ ...rowStyle, gap: 6 }}>
        <span style={labelStyle}>Speed:</span>
        <select value={status.speed} onChange={handleSpeedChange} style={selectStyle}>
          {SPEEDS.map((s) => (
            <option key={s} value={s}>{s}x</option>
          ))}
        </select>
        <span style={{ ...labelStyle, marginLeft: 'auto' }}>
          {status.state}
        </span>
      </div>

      {/* Timeline scrubber */}
      <div style={{ position: 'relative' }}>
        <input
          type="range"
          min={0}
          max={maxIndex}
          value={status.currentIndex}
          onChange={handleSeek}
          style={{ width: '100%', cursor: 'pointer', accentColor: '#4a9eff' }}
        />
        {/* Event markers */}
        <div style={{ position: 'relative', height: 6, marginTop: -2 }}>
          {errorPositions.map((pos, i) => (
            <span
              key={`err-${i}`}
              style={{
                position: 'absolute',
                left: `${pos}%`,
                top: 0,
                width: 3,
                height: 3,
                borderRadius: '50%',
                background: '#e05050',
                transform: 'translateX(-50%)',
              }}
            />
          ))}
          {toolPositions.map((pos, i) => (
            <span
              key={`tool-${i}`}
              style={{
                position: 'absolute',
                left: `${pos}%`,
                top: 0,
                width: 3,
                height: 3,
                borderRadius: '50%',
                background: '#5a8cff',
                transform: 'translateX(-50%)',
              }}
            />
          ))}
        </div>
      </div>

      {/* Info row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={valueStyle}>
          Event {status.currentIndex} / {status.totalEvents}
        </span>
        {status.currentTimestamp && (
          <span style={{ ...valueStyle, fontSize: '11px' }}>
            {status.currentTimestamp}
          </span>
        )}
      </div>
    </div>
  )
}
