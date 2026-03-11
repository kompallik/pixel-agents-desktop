import * as fs from 'fs';
import { randomUUID } from 'crypto';
import type { SessionViewState } from './sessionState.js';
import type { AgentEvent } from './events.js';
import type { CollisionInfo } from './collisionDetector.js';

export type AlertRule =
  | 'stale_session'
  | 'failure_burst'
  | 'permission_loop'
  | 'unreadable_file'
  | 'parser_error'
  | 'duplicate_worktree'
  | 'child_active_parent_silent';

export type AlertSeverity = 'info' | 'warning' | 'error';

export interface Alert {
  id: string;
  sessionId: string;
  rule: AlertRule;
  severity: AlertSeverity;
  message: string;
  details: string;
  createdAt: string;
  acknowledgedAt?: string;
}

// Thresholds
const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 min
const FAILURE_BURST_COUNT = 3;
const FAILURE_BURST_WINDOW_MS = 60 * 1000; // 60s
const PERMISSION_LOOP_COUNT = 3;
const PARENT_SILENT_THRESHOLD_MS = 5 * 60 * 1000; // 5 min
const PARSER_ERROR_THRESHOLD = 5;

export class AlertEngine {
  private alerts = new Map<string, Alert>();
  // Track active alert keys to avoid duplicate alerts for same condition
  private activeKeys = new Map<string, string>(); // compositeKey → alertId

  evaluate(
    sessions: Map<string, SessionViewState>,
    eventHistories: Map<string, AgentEvent[]>,
    collisions: CollisionInfo[],
  ): Alert[] {
    const newAlerts: Alert[] = [];
    const now = Date.now();
    const seenKeys = new Set<string>();

    for (const [sessionId, session] of sessions) {
      const history = eventHistories.get(sessionId) ?? [];

      // stale_session: status === 'stalled' for > 10min
      if (session.status.state === 'stalled') {
        const lastEventMs = session.lastEventAt ? new Date(session.lastEventAt).getTime() : 0;
        if (lastEventMs > 0 && now - lastEventMs > STALE_THRESHOLD_MS) {
          const key = `stale_session:${sessionId}`;
          seenKeys.add(key);
          if (!this.activeKeys.has(key)) {
            const alert = this.createAlert(sessionId, 'stale_session', 'warning',
              'Session stalled',
              `No activity for ${Math.round((now - lastEventMs) / 60_000)} minutes`,
            );
            newAlerts.push(alert);
            this.activeKeys.set(key, alert.id);
          }
        }
      }

      // failure_burst: 3+ tool_failed in 60s
      const recentFailures = history.filter(
        (e) => e.type === 'tool_failed' && now - new Date(e.timestamp).getTime() < FAILURE_BURST_WINDOW_MS,
      );
      if (recentFailures.length >= FAILURE_BURST_COUNT) {
        const key = `failure_burst:${sessionId}`;
        seenKeys.add(key);
        if (!this.activeKeys.has(key)) {
          const alert = this.createAlert(sessionId, 'failure_burst', 'error',
            'Failure burst detected',
            `${recentFailures.length} tool failures in the last 60 seconds`,
          );
          newAlerts.push(alert);
          this.activeKeys.set(key, alert.id);
        }
      }

      // permission_loop: same permission_requested > 3 times without progress
      const permissionEvents = history.filter((e) => e.type === 'permission_requested');
      if (permissionEvents.length >= PERMISSION_LOOP_COUNT) {
        // Check if the last N permission events are for similar tool patterns
        const recentPerms = permissionEvents.slice(-PERMISSION_LOOP_COUNT);
        const toolIds = recentPerms.map((e) => e.toolId).filter(Boolean);
        const uniqueTools = new Set(toolIds);
        if (uniqueTools.size <= 1 && toolIds.length >= PERMISSION_LOOP_COUNT) {
          const key = `permission_loop:${sessionId}`;
          seenKeys.add(key);
          if (!this.activeKeys.has(key)) {
            const alert = this.createAlert(sessionId, 'permission_loop', 'warning',
              'Permission loop detected',
              `Permission requested ${permissionEvents.length} times for the same tool`,
            );
            newAlerts.push(alert);
            this.activeKeys.set(key, alert.id);
          }
        }
      }

      // unreadable_file: file not readable
      try {
        fs.accessSync(session.filePath, fs.constants.R_OK);
      } catch {
        const key = `unreadable_file:${sessionId}`;
        seenKeys.add(key);
        if (!this.activeKeys.has(key)) {
          const alert = this.createAlert(sessionId, 'unreadable_file', 'error',
            'Session file unreadable',
            `Cannot read: ${session.filePath}`,
          );
          newAlerts.push(alert);
          this.activeKeys.set(key, alert.id);
        }
      }

      // parser_error: > 5 session_error events
      const parseErrors = history.filter((e) => e.type === 'session_error');
      if (parseErrors.length > PARSER_ERROR_THRESHOLD) {
        const key = `parser_error:${sessionId}`;
        seenKeys.add(key);
        if (!this.activeKeys.has(key)) {
          const alert = this.createAlert(sessionId, 'parser_error', 'warning',
            'Frequent parse errors',
            `${parseErrors.length} parse/session errors detected`,
          );
          newAlerts.push(alert);
          this.activeKeys.set(key, alert.id);
        }
      }

      // child_active_parent_silent: child active + parent idle > 5min
      if (session.childSessions.length > 0) {
        const lastEventMs = session.lastEventAt ? new Date(session.lastEventAt).getTime() : 0;
        const parentSilent = lastEventMs > 0 && now - lastEventMs > PARENT_SILENT_THRESHOLD_MS;
        if (parentSilent) {
          const hasActiveChild = session.childSessions.some((childId) => {
            const child = sessions.get(childId);
            return child && child.status.state !== 'dormant' && child.status.state !== 'idle';
          });
          if (hasActiveChild) {
            const key = `child_active_parent_silent:${sessionId}`;
            seenKeys.add(key);
            if (!this.activeKeys.has(key)) {
              const alert = this.createAlert(sessionId, 'child_active_parent_silent', 'info',
                'Parent session silent while child is active',
                'Child session is running but parent has been idle for 5+ minutes',
              );
              newAlerts.push(alert);
              this.activeKeys.set(key, alert.id);
            }
          }
        }
      }
    }

    // duplicate_worktree: from collision detector
    for (const collision of collisions) {
      if (collision.type === 'same_worktree') {
        const key = `duplicate_worktree:${collision.sessionIds.sort().join(',')}`;
        seenKeys.add(key);
        if (!this.activeKeys.has(key)) {
          const alert = this.createAlert(collision.sessionIds[0], 'duplicate_worktree', 'warning',
            'Duplicate worktree detected',
            `Sessions ${collision.sessionIds.join(', ')} share worktree: ${collision.path}`,
          );
          newAlerts.push(alert);
          this.activeKeys.set(key, alert.id);
        }
      }
    }

    // Auto-resolve alerts whose conditions are no longer true
    for (const [key, alertId] of this.activeKeys) {
      if (!seenKeys.has(key)) {
        const alert = this.alerts.get(alertId);
        if (alert && !alert.acknowledgedAt) {
          alert.acknowledgedAt = new Date().toISOString();
        }
        this.activeKeys.delete(key);
      }
    }

    return newAlerts;
  }

  acknowledge(alertId: string): void {
    const alert = this.alerts.get(alertId);
    if (alert) {
      alert.acknowledgedAt = new Date().toISOString();
    }
  }

  getActiveAlerts(): Alert[] {
    return [...this.alerts.values()].filter((a) => !a.acknowledgedAt);
  }

  getAlertsBySession(sessionId: string): Alert[] {
    return [...this.alerts.values()].filter((a) => a.sessionId === sessionId && !a.acknowledgedAt);
  }

  removeAlertsForSession(sessionId: string): void {
    for (const [id, alert] of this.alerts) {
      if (alert.sessionId === sessionId) {
        this.alerts.delete(id);
      }
    }
    // Clean up active keys for this session
    for (const [key, alertId] of this.activeKeys) {
      if (key.includes(sessionId)) {
        this.activeKeys.delete(key);
      }
    }
  }

  private createAlert(
    sessionId: string,
    rule: AlertRule,
    severity: AlertSeverity,
    message: string,
    details: string,
  ): Alert {
    const alert: Alert = {
      id: randomUUID(),
      sessionId,
      rule,
      severity,
      message,
      details,
      createdAt: new Date().toISOString(),
    };
    this.alerts.set(alert.id, alert);
    return alert;
  }
}
