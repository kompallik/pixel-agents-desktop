import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import type { AgentEvent, AgentEventType } from './events.js';
import type { SessionViewState } from './sessionState.js';
import { sessionReducer } from './reducer.js';
import { inferProjectInfo } from './projectMapper.js';
import { detectCollisions, type CollisionInfo } from './collisionDetector.js';

const MAX_EVENT_HISTORY = 100;
const PUBLISH_DEBOUNCE_MS = 100;

export class SessionStore extends EventEmitter {
  private sessions = new Map<string, SessionViewState>();
  private eventHistory = new Map<string, AgentEvent[]>();
  private publishTimer: NodeJS.Timeout | null = null;

  registerSession(state: SessionViewState): void {
    this.sessions.set(state.sessionId, state);
    this.eventHistory.set(state.sessionId, []);
    this.schedulePublish();

    // Async project mapping enrichment
    inferProjectInfo(state.filePath, state.sessionId).then((info) => {
      const current = this.sessions.get(state.sessionId);
      if (!current) return;
      this.sessions.set(state.sessionId, {
        ...current,
        projectName: info.projectName,
        branch: info.branch,
        worktree: info.worktree,
      });
      this.schedulePublish();
    }).catch(() => {
      // Project inference is best-effort; ignore failures
    });
  }

  applyEvent(event: AgentEvent): void {
    const current = this.sessions.get(event.sessionId);
    if (!current) return;

    const next = sessionReducer(current, event);
    this.sessions.set(event.sessionId, next);

    let history = this.eventHistory.get(event.sessionId);
    if (!history) {
      history = [];
      this.eventHistory.set(event.sessionId, history);
    }
    history.push(event);
    if (history.length > MAX_EVENT_HISTORY) {
      history.splice(0, history.length - MAX_EVENT_HISTORY);
    }

    this.schedulePublish();
  }

  removeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.eventHistory.delete(sessionId);
    this.schedulePublish();
  }

  getSession(sessionId: string): SessionViewState | undefined {
    return this.sessions.get(sessionId);
  }

  getAllSessions(): SessionViewState[] {
    return Array.from(this.sessions.values());
  }

  getEventHistory(sessionId: string): AgentEvent[] {
    return this.eventHistory.get(sessionId) ?? [];
  }

  getSessionsByProject(): Map<string, SessionViewState[]> {
    const grouped = new Map<string, SessionViewState[]>();
    for (const session of this.sessions.values()) {
      const key = session.projectName ?? '(unknown)';
      const list = grouped.get(key) ?? [];
      list.push(session);
      grouped.set(key, list);
    }
    return grouped;
  }

  getCollisions(): CollisionInfo[] {
    return detectCollisions(this.sessions);
  }

  private schedulePublish(): void {
    if (this.publishTimer) {
      clearTimeout(this.publishTimer);
    }
    this.publishTimer = setTimeout(() => {
      this.publishTimer = null;
      this.emit('state-changed', this.getAllSessions());
    }, PUBLISH_DEBOUNCE_MS);
  }
}

const LEGACY_CHANNEL_MAP: Record<string, AgentEventType> = {
  agentToolStart: 'tool_started',
  agentToolDone: 'tool_completed',
  agentStatus: 'session_idle',
  agentClosed: 'session_dormant',
  agentCreated: 'session_attached',
  subagentToolStart: 'subagent_spawned',
  subagentClear: 'subagent_completed',
};

export function createAgentEventFromLegacy(
  sessionId: string,
  channel: string,
  payload: Record<string, unknown>,
): AgentEvent | null {
  const eventType = LEGACY_CHANNEL_MAP[channel];
  if (!eventType) return null;

  const event: AgentEvent = {
    id: randomUUID(),
    sessionId,
    timestamp: new Date().toISOString(),
    type: eventType,
  };

  switch (channel) {
    case 'agentToolStart':
      event.toolId = payload['toolId'] as string | undefined;
      event.status = payload['status'] as string | undefined;
      break;

    case 'agentToolDone':
      event.toolId = payload['toolId'] as string | undefined;
      event.type = 'tool_completed';
      break;

    case 'agentStatus': {
      const status = payload['status'] as string | undefined;
      if (status === 'waiting') event.type = 'waiting_for_input';
      else if (status === 'active') event.type = 'session_attached';
      else if (status === 'permission') event.type = 'permission_requested';
      else event.type = 'session_idle';
      break;
    }

    case 'subagentToolStart':
      event.type = 'subagent_spawned';
      event.toolId = payload['toolId'] as string | undefined;
      event.parentToolId = payload['parentToolId'] as string | undefined;
      break;

    case 'subagentClear':
      event.type = 'subagent_completed';
      event.parentToolId = payload['parentToolId'] as string | undefined;
      break;

    default:
      break;
  }

  return event;
}
