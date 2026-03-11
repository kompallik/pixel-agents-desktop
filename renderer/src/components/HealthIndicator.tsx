interface HealthIndicatorProps {
  score: number
}

function getHealthClass(score: number): string {
  if (score > 80) return 'health-good'
  if (score >= 50) return 'health-warning'
  return 'health-critical'
}

export function HealthIndicator({ score }: HealthIndicatorProps) {
  const clamped = Math.max(0, Math.min(100, score))

  return (
    <div className="health-indicator" title={`Health: ${Math.round(clamped)}`}>
      <div
        className={`health-bar ${getHealthClass(clamped)}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}
