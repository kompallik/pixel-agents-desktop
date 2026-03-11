import { useMemo } from 'react';
import { useSessionStore } from '../stores/sessionStore.js';
import type { SessionViewState, SessionStatus } from '../types/domainTypes.js';

const INACTIVE_STATUSES: ReadonlySet<SessionStatus> = new Set(['dormant', 'completed']);
const ATTENTION_STATUSES: ReadonlySet<SessionStatus> = new Set(['stalled', 'errored', 'waiting_permission']);

function sessionsArray(sessions: Map<string, SessionViewState>): SessionViewState[] {
  return Array.from(sessions.values());
}

/** Returns all sessions not in dormant/completed state */
export function useActiveSessions(): SessionViewState[] {
  const sessions = useSessionStore((s) => s.sessions);
  return useMemo(
    () => sessionsArray(sessions).filter((s) => !INACTIVE_STATUSES.has(s.status.state)),
    [sessions],
  );
}

/** Returns the currently selected session */
export function useSelectedSession(): SessionViewState | null {
  const sessions = useSessionStore((s) => s.sessions);
  const selectedId = useSessionStore((s) => s.selectedSessionId);
  if (!selectedId) return null;
  return sessions.get(selectedId) ?? null;
}

/** Returns sessions matching a specific status */
export function useSessionsByStatus(status: SessionStatus): SessionViewState[] {
  const sessions = useSessionStore((s) => s.sessions);
  return useMemo(
    () => sessionsArray(sessions).filter((s) => s.status.state === status),
    [sessions, status],
  );
}

/** Returns sessions needing attention: stalled + errored + waiting_permission */
export function useSessionsNeedingAttention(): SessionViewState[] {
  const sessions = useSessionStore((s) => s.sessions);
  return useMemo(
    () => sessionsArray(sessions).filter((s) => ATTENTION_STATUSES.has(s.status.state)),
    [sessions],
  );
}

/** Returns filtered + sorted sessions based on store filter/search state */
export function useFilteredSessions(): SessionViewState[] {
  const sessions = useSessionStore((s) => s.sessions);
  const filterStatus = useSessionStore((s) => s.filterStatus);
  const searchQuery = useSessionStore((s) => s.searchQuery);

  return useMemo(() => {
    let result = sessionsArray(sessions);

    if (filterStatus) {
      result = result.filter((s) => s.status.state === filterStatus);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((s) =>
        s.sessionId.toLowerCase().includes(q) ||
        s.filePath.toLowerCase().includes(q) ||
        (s.projectName?.toLowerCase().includes(q) ?? false) ||
        (s.branch?.toLowerCase().includes(q) ?? false),
      );
    }

    // Sort: attention-needing first, then by lastEventAt descending
    result.sort((a, b) => {
      const aAttn = ATTENTION_STATUSES.has(a.status.state) ? 0 : 1;
      const bAttn = ATTENTION_STATUSES.has(b.status.state) ? 0 : 1;
      if (aAttn !== bAttn) return aAttn - bAttn;
      const aTime = a.lastEventAt ?? '';
      const bTime = b.lastEventAt ?? '';
      return bTime.localeCompare(aTime);
    });

    return result;
  }, [sessions, filterStatus, searchQuery]);
}
