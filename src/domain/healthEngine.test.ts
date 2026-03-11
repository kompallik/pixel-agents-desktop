import { describe, it, expect } from 'vitest';
import { computeHealth } from './healthEngine.js';
import { createInitialSessionState } from './sessionState.js';
import type { SessionViewState, ToolInfo } from './sessionState.js';
import type { Alert } from './alertEngine.js';

function makeSession(overrides?: Partial<SessionViewState>): SessionViewState {
  return {
    ...createInitialSessionState('s1', 1, 'src-1', 'claude', '/tmp/test.jsonl'),
    lastEventAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeAlert(severity: Alert['severity'], acked = false): Alert {
  return {
    id: 'alert-' + Math.random().toString(36).slice(2),
    sessionId: 's1',
    rule: 'stale_session',
    severity,
    message: 'test',
    details: 'test detail',
    createdAt: new Date().toISOString(),
    acknowledgedAt: acked ? new Date().toISOString() : undefined,
  };
}

function makeTool(status: 'completed' | 'failed', name = 'Bash'): ToolInfo {
  return {
    toolId: 'tool-' + Math.random().toString(36).slice(2),
    toolName: name,
    status,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
}

describe('computeHealth', () => {
  it('returns high score for fresh healthy session', () => {
    const session = makeSession();
    const score = computeHealth(session, []);
    expect(score).toBeGreaterThanOrEqual(90);
  });

  it('drops score with failed tools', () => {
    const session = makeSession({
      recentTools: [makeTool('failed'), makeTool('failed'), makeTool('failed')],
    });
    const score = computeHealth(session, []);
    expect(score).toBeLessThan(75);
  });

  it('drops score with active error alerts', () => {
    const session = makeSession();
    const cleanScore = computeHealth(session, []);
    const alerts = [makeAlert('error')];
    const score = computeHealth(session, alerts);
    expect(score).toBeLessThan(cleanScore);
  });

  it('acknowledged alerts do not reduce score', () => {
    const session = makeSession();
    const alerts = [makeAlert('error', true)];
    const scoreWithAcked = computeHealth(session, alerts);
    const scoreClean = computeHealth(session, []);
    expect(scoreWithAcked).toBe(scoreClean);
  });

  it('freshness degrades with old lastEventAt', () => {
    const session = makeSession({
      lastEventAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 min ago
    });
    const freshScore = computeHealth(makeSession(), []);
    const staleScore = computeHealth(session, []);
    expect(staleScore).toBeLessThan(freshScore);
  });

  it('warning alerts reduce score less than error alerts', () => {
    const session = makeSession();
    const warningScore = computeHealth(session, [makeAlert('warning')]);
    const errorScore = computeHealth(session, [makeAlert('error')]);
    expect(warningScore).toBeGreaterThan(errorScore);
  });

  it('score never goes below 0', () => {
    const session = makeSession({
      lastEventAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      recentTools: [makeTool('failed'), makeTool('failed'), makeTool('failed')],
    });
    const alerts = [makeAlert('error'), makeAlert('error'), makeAlert('error')];
    const score = computeHealth(session, alerts);
    expect(score).toBeGreaterThanOrEqual(0);
  });
});
