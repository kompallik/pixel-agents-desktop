import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'path';
import { AlertEngine } from './alertEngine.js';
import { createInitialSessionState } from './sessionState.js';
import type { SessionViewState } from './sessionState.js';
import type { AgentEvent } from './events.js';
import type { CollisionInfo } from './collisionDetector.js';

// Use a file that actually exists so unreadable_file rule doesn't fire
const READABLE_FILE = path.resolve(__dirname, '../../package.json');

function makeSession(id: string, overrides?: Partial<SessionViewState>): SessionViewState {
  return {
    ...createInitialSessionState(id, 1, 'src-1', 'claude', READABLE_FILE),
    ...overrides,
  };
}

describe('AlertEngine', () => {
  let engine: AlertEngine;

  beforeEach(() => {
    engine = new AlertEngine();
  });

  it('stale_session fires when status === stalled and lastEventAt > 10min ago', () => {
    const tenMinAgo = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    const sessions = new Map<string, SessionViewState>();
    sessions.set('s1', makeSession('s1', {
      status: { state: 'stalled', confidence: 0.8, reasons: ['stalled'] },
      lastEventAt: tenMinAgo,
    }));

    const alerts = engine.evaluate(sessions, new Map(), []);
    expect(alerts.some(a => a.rule === 'stale_session')).toBe(true);
  });

  it('stale_session does not fire if lastEventAt is recent', () => {
    const justNow = new Date().toISOString();
    const sessions = new Map<string, SessionViewState>();
    sessions.set('s1', makeSession('s1', {
      status: { state: 'stalled', confidence: 0.8, reasons: ['stalled'] },
      lastEventAt: justNow,
    }));

    const alerts = engine.evaluate(sessions, new Map(), []);
    expect(alerts.some(a => a.rule === 'stale_session')).toBe(false);
  });

  it('duplicate_worktree fires for collision', () => {
    const sessions = new Map<string, SessionViewState>();
    sessions.set('s1', makeSession('s1', { worktree: '/app' }));
    sessions.set('s2', makeSession('s2', { worktree: '/app' }));

    const collisions: CollisionInfo[] = [
      { type: 'same_worktree', sessionIds: ['s1', 's2'], path: '/app' },
    ];

    const alerts = engine.evaluate(sessions, new Map(), collisions);
    expect(alerts.some(a => a.rule === 'duplicate_worktree')).toBe(true);
  });

  it('acknowledge removes alert from getActiveAlerts', () => {
    const tenMinAgo = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    const sessions = new Map<string, SessionViewState>();
    sessions.set('s1', makeSession('s1', {
      status: { state: 'stalled', confidence: 0.8, reasons: ['stalled'] },
      lastEventAt: tenMinAgo,
    }));

    const alerts = engine.evaluate(sessions, new Map(), []);
    expect(alerts).toHaveLength(1);
    expect(engine.getActiveAlerts()).toHaveLength(1);

    engine.acknowledge(alerts[0].id);
    expect(engine.getActiveAlerts()).toHaveLength(0);
  });

  it('failure_burst fires with 3+ tool_failed events in window', () => {
    const sessions = new Map<string, SessionViewState>();
    sessions.set('s1', makeSession('s1'));

    const now = Date.now();
    const events: AgentEvent[] = [
      { id: 'e1', sessionId: 's1', timestamp: new Date(now - 5000).toISOString(), type: 'tool_failed', toolId: 't1' },
      { id: 'e2', sessionId: 's1', timestamp: new Date(now - 4000).toISOString(), type: 'tool_failed', toolId: 't2' },
      { id: 'e3', sessionId: 's1', timestamp: new Date(now - 3000).toISOString(), type: 'tool_failed', toolId: 't3' },
    ];
    const histories = new Map<string, AgentEvent[]>();
    histories.set('s1', events);

    const alerts = engine.evaluate(sessions, histories, []);
    expect(alerts.some(a => a.rule === 'failure_burst')).toBe(true);
  });

  it('does not duplicate alerts for same condition', () => {
    const tenMinAgo = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    const sessions = new Map<string, SessionViewState>();
    sessions.set('s1', makeSession('s1', {
      status: { state: 'stalled', confidence: 0.8, reasons: ['stalled'] },
      lastEventAt: tenMinAgo,
    }));

    engine.evaluate(sessions, new Map(), []);
    const alerts2 = engine.evaluate(sessions, new Map(), []);
    expect(alerts2).toHaveLength(0);
    expect(engine.getActiveAlerts()).toHaveLength(1);
  });
});
