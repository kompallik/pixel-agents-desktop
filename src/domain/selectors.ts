import * as path from 'path';
import type { AgentEvent } from './events.js';
import type { SessionViewState, SessionStatus } from './sessionState.js';

const INACTIVE_STATES: Set<SessionStatus> = new Set(['dormant', 'completed']);
const ATTENTION_STATES: Set<SessionStatus> = new Set(['stalled', 'errored', 'waiting_permission']);

export function getActiveSessionIds(sessions: Map<string, SessionViewState>): string[] {
  const result: string[] = [];
  for (const [id, session] of sessions) {
    if (!INACTIVE_STATES.has(session.status.state)) {
      result.push(id);
    }
  }
  return result;
}

export function getSessionsByProject(sessions: Map<string, SessionViewState>): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const [id, session] of sessions) {
    const key = session.projectName ?? path.dirname(session.filePath);
    let list = groups.get(key);
    if (!list) {
      list = [];
      groups.set(key, list);
    }
    list.push(id);
  }
  return groups;
}

export function getSessionsByStatus(
  sessions: Map<string, SessionViewState>,
  status: SessionStatus,
): string[] {
  const result: string[] = [];
  for (const [id, session] of sessions) {
    if (session.status.state === status) {
      result.push(id);
    }
  }
  return result;
}

export function getSessionsNeedingAttention(sessions: Map<string, SessionViewState>): string[] {
  const result: string[] = [];
  for (const [id, session] of sessions) {
    if (ATTENTION_STATES.has(session.status.state)) {
      result.push(id);
    }
  }
  return result;
}

export function getSessionEventHistory(
  history: Map<string, AgentEvent[]>,
  sessionId: string,
): AgentEvent[] {
  return history.get(sessionId) ?? [];
}
