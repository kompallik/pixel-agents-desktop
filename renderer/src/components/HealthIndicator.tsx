interface HealthIndicatorProps {
  score: number
}

function getHealthColor(score: number): string {
  if (score > 80) return '#4ec98b'
  if (score >= 50) return '#cca700'
  return '#e05050'
}

export function HealthIndicator({ score }: HealthIndicatorProps) {
  const clamped = Math.max(0, Math.min(100, score))
  const color = getHealthColor(clamped)

  return (
    <div
      style={{
        width: 48,
        height: 6,
        background: 'rgba(255, 255, 255, 0.08)',
        borderRadius: 3,
        overflow: 'hidden',
        flexShrink: 0,
      }}
      title={`Health: ${Math.round(clamped)}`}
    >
      <div
        style={{
          width: `${clamped}%`,
          height: '100%',
          background: color,
          borderRadius: 3,
          transition: 'width 0.3s ease',
        }}
      />
    </div>
  )
}
