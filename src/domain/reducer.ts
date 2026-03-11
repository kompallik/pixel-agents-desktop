import type { AgentEvent } from './events.js';
import type { SessionViewState, ToolInfo } from './sessionState.js';
import { assessStatus, buildStatusInput } from './statusEngine.js';

const MAX_RECENT_TOOLS = 10;
const FAILURE_WINDOW_MS = 60_000;

function addToRecentTools(recentTools: ToolInfo[], tool: ToolInfo): ToolInfo[] {
  const updated = [tool, ...recentTools];
  return updated.length > MAX_RECENT_TOOLS ? updated.slice(0, MAX_RECENT_TOOLS) : updated;
}

function countRecentFailures(recentTools: ToolInfo[], now: number): number {
  const cutoff = now - FAILURE_WINDOW_MS;
  return recentTools.filter(t => {
    if (t.status !== 'failed' || !t.completedAt) return false;
    return new Date(t.completedAt).getTime() >= cutoff;
  }).length;
}

function reassess(state: SessionViewState): SessionViewState {
  const now = Date.now();
  const failures = countRecentFailures(state.recentTools, now);
  const input = buildStatusInput(state, now, undefined, failures);
  return { ...state, status: assessStatus(input) };
}

export function sessionReducer(state: SessionViewState, event: AgentEvent): SessionViewState {
  const base = {
    ...state,
    eventCount: state.eventCount + 1,
    lastEventAt: event.timestamp,
  };

  switch (event.type) {
    case 'session_attached': {
      return {
        ...base,
        status: { state: 'starting', confidence: 0.7, reasons: ['Session attached'] },
      };
    }

    case 'tool_started': {
      if (!event.toolId) return reassess(base);
      const alreadyActive = base.activeTools.some(t => t.toolId === event.toolId);
      if (alreadyActive) return reassess(base);

      const newTool: ToolInfo = {
        toolId: event.toolId,
        toolName: event.toolName ?? 'unknown',
        status: 'active',
        startedAt: event.timestamp,
      };
      return reassess({ ...base, activeTools: [...base.activeTools, newTool] });
    }

    case 'tool_completed': {
      if (!event.toolId) return reassess(base);
      const completed = base.activeTools.find(t => t.toolId === event.toolId);
      const activeTools = base.activeTools.filter(t => t.toolId !== event.toolId);
      const recentTools = completed
        ? addToRecentTools(base.recentTools, {
            ...completed,
            status: 'completed',
            completedAt: event.timestamp,
          })
        : base.recentTools;

      return reassess({ ...base, activeTools, recentTools });
    }

    case 'tool_failed': {
      if (!event.toolId) return reassess(base);
      const failed = base.activeTools.find(t => t.toolId === event.toolId);
      const activeTools = base.activeTools.filter(t => t.toolId !== event.toolId);
      const recentTools = failed
        ? addToRecentTools(base.recentTools, {
            ...failed,
            status: 'failed',
            completedAt: event.timestamp,
          })
        : base.recentTools;

      return reassess({ ...base, activeTools, recentTools });
    }

    case 'subagent_spawned': {
      const childSessionId = event.metadata?.['childSessionId'] as string | undefined;
      if (!childSessionId) return base;
      if (base.childSessions.includes(childSessionId)) return base;
      return {
        ...base,
        childSessions: [...base.childSessions, childSessionId],
      };
    }

    case 'subagent_completed': {
      const completedChildId = event.metadata?.['childSessionId'] as string | undefined;
      if (!completedChildId) return base;
      return {
        ...base,
        childSessions: base.childSessions.filter(id => id !== completedChildId),
      };
    }

    case 'permission_requested': {
      return {
        ...base,
        status: { state: 'waiting_permission', confidence: 0.9, reasons: ['Permission requested'] },
      };
    }

    case 'permission_cleared': {
      return reassess(base);
    }

    case 'waiting_for_input': {
      return {
        ...base,
        status: { state: 'waiting_input', confidence: 0.9, reasons: ['Waiting for user input'] },
      };
    }

    case 'turn_completed': {
      const staleTools = base.activeTools.map<ToolInfo>(t => ({
        ...t,
        status: 'completed',
        completedAt: event.timestamp,
      }));
      let recentTools = base.recentTools;
      for (const tool of staleTools) {
        recentTools = addToRecentTools(recentTools, tool);
      }
      return reassess({ ...base, activeTools: [], recentTools });
    }

    case 'session_idle': {
      return {
        ...base,
        status: { state: 'idle', confidence: 0.8, reasons: ['No activity'] },
      };
    }

    case 'session_dormant': {
      return {
        ...base,
        status: { state: 'dormant', confidence: 0.95, reasons: ['Idle timeout exceeded'] },
      };
    }

    case 'session_error': {
      return {
        ...base,
        status: {
          state: 'errored',
          confidence: 0.9,
          reasons: [event.summary ?? 'Session error occurred'],
        },
      };
    }

    default:
      return base;
  }
}
