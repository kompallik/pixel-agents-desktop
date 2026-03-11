import type { SessionViewState } from './sessionState.js';
import type { Alert } from './alertEngine.js';

// Scoring weights (each 0-25, total 0-100)
const MAX_FRESHNESS = 25;
const MAX_ERROR_RATE = 25;
const MAX_TOOL_COMPLETION = 25;
const MAX_ALERT_BURDEN = 25;

// Freshness thresholds
const FRESHNESS_FULL_MS = 30_000;    // < 30s = full points
const FRESHNESS_ZERO_MS = 300_000;   // > 5min = 0 points

// Error rate thresholds
const ERROR_RATE_ZERO_FAILURES = 3;  // 3+ recent failures = 0 points

// Alert cost
const ERROR_ALERT_COST = 10;
const WARNING_ALERT_COST = 5;

export function computeHealth(session: SessionViewState, alerts: Alert[]): number {
  const now = Date.now();

  // 1. Freshness: 0-25 pts
  const freshness = computeFreshness(session, now);

  // 2. Error rate: 0-25 pts
  const errorRate = computeErrorRate(session);

  // 3. Tool completion ratio: 0-25 pts
  const toolCompletion = computeToolCompletion(session);

  // 4. Alert burden: 0-25 pts
  const alertBurden = computeAlertBurden(alerts);

  return Math.max(0, Math.min(100, Math.round(freshness + errorRate + toolCompletion + alertBurden)));
}

function computeFreshness(session: SessionViewState, now: number): number {
  if (!session.lastEventAt) return MAX_FRESHNESS * 0.5; // No data yet, neutral score

  const elapsed = now - new Date(session.lastEventAt).getTime();

  if (elapsed <= FRESHNESS_FULL_MS) return MAX_FRESHNESS;
  if (elapsed >= FRESHNESS_ZERO_MS) return 0;

  // Linear interpolation
  const ratio = 1 - (elapsed - FRESHNESS_FULL_MS) / (FRESHNESS_ZERO_MS - FRESHNESS_FULL_MS);
  return MAX_FRESHNESS * ratio;
}

function computeErrorRate(session: SessionViewState): number {
  const recentFailures = session.recentTools.filter((t) => t.status === 'failed').length;

  if (recentFailures === 0) return MAX_ERROR_RATE;
  if (recentFailures >= ERROR_RATE_ZERO_FAILURES) return 0;

  // Linear interpolation
  const ratio = 1 - recentFailures / ERROR_RATE_ZERO_FAILURES;
  return MAX_ERROR_RATE * ratio;
}

function computeToolCompletion(session: SessionViewState): number {
  const tools = session.recentTools;
  if (tools.length === 0) return MAX_TOOL_COMPLETION; // No tools yet, full marks

  const completed = tools.filter((t) => t.status === 'completed').length;
  const failed = tools.filter((t) => t.status === 'failed').length;
  const total = completed + failed;

  if (total === 0) return MAX_TOOL_COMPLETION;

  const ratio = completed / total;
  return MAX_TOOL_COMPLETION * ratio;
}

function computeAlertBurden(alerts: Alert[]): number {
  let cost = 0;
  for (const alert of alerts) {
    if (alert.acknowledgedAt) continue;
    if (alert.severity === 'error') cost += ERROR_ALERT_COST;
    else if (alert.severity === 'warning') cost += WARNING_ALERT_COST;
  }
  return Math.max(0, MAX_ALERT_BURDEN - cost);
}
