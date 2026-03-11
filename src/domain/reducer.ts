import type { AgentEvent } from './events.js';
import type { SessionViewState, ToolInfo, StatusAssessment } from './sessionState.js';

const MAX_RECENT_TOOLS = 10;

const TOOL_NAME_TO_STATUS: Record<string, StatusAssessment['state']> = {
  Read: 'reading',
  Grep: 'reading',
  Glob: 'reading',
  Edit: 'editing',
  Write: 'editing',
  NotebookEdit: 'editing',
  Bash: 'executing',
  WebFetch: 'executing',
  WebSearch: 'executing',
};

function inferStatusFromTools(activeTools: ToolInfo[]): StatusAssessment {
  if (activeTools.length === 0) {
    return { state: 'idle', confidence: 0.5, reasons: ['No active tools'] };
  }
  for (const tool of activeTools) {
    const mapped = TOOL_NAME_TO_STATUS[tool.toolName];
    if (mapped) {
      return { state: mapped, confidence: 0.8, reasons: [`Active tool: ${tool.toolName}`] };
    }
  }
  return { state: 'executing', confidence: 0.6, reasons: [`Active tool: ${activeTools[0].toolName}`] };
}

function addToRecentTools(recentTools: ToolInfo[], tool: ToolInfo): ToolInfo[] {
  const updated = [tool, ...recentTools];
  return updated.length > MAX_RECENT_TOOLS ? updated.slice(0, MAX_RECENT_TOOLS) : updated;
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
      if (!event.toolId) return base;
      const alreadyActive = base.activeTools.some(t => t.toolId === event.toolId);
      if (alreadyActive) return base;

      const newTool: ToolInfo = {
        toolId: event.toolId,
        toolName: event.toolName ?? 'unknown',
        status: 'active',
        startedAt: event.timestamp,
      };
      const activeTools = [...base.activeTools, newTool];
      return {
        ...base,
        activeTools,
        status: inferStatusFromTools(activeTools),
      };
    }

    case 'tool_completed': {
      if (!event.toolId) return base;
      const completed = base.activeTools.find(t => t.toolId === event.toolId);
      const activeTools = base.activeTools.filter(t => t.toolId !== event.toolId);
      const recentTools = completed
        ? addToRecentTools(base.recentTools, {
            ...completed,
            status: 'completed',
            completedAt: event.timestamp,
          })
        : base.recentTools;

      return {
        ...base,
        activeTools,
        recentTools,
        status: activeTools.length > 0
          ? inferStatusFromTools(activeTools)
          : { state: 'idle', confidence: 0.5, reasons: ['Tool completed, no remaining tools'] },
      };
    }

    case 'tool_failed': {
      if (!event.toolId) return base;
      const failed = base.activeTools.find(t => t.toolId === event.toolId);
      const activeTools = base.activeTools.filter(t => t.toolId !== event.toolId);
      const recentTools = failed
        ? addToRecentTools(base.recentTools, {
            ...failed,
            status: 'failed',
            completedAt: event.timestamp,
          })
        : base.recentTools;

      return {
        ...base,
        activeTools,
        recentTools,
        status: activeTools.length > 0
          ? inferStatusFromTools(activeTools)
          : { state: 'idle', confidence: 0.5, reasons: ['Tool failed, no remaining tools'] },
      };
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
      return {
        ...base,
        status: base.activeTools.length > 0
          ? inferStatusFromTools(base.activeTools)
          : { state: 'idle', confidence: 0.5, reasons: ['Permission cleared'] },
      };
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
      return {
        ...base,
        activeTools: [],
        recentTools,
        status: { state: 'idle', confidence: 0.7, reasons: ['Turn completed'] },
      };
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
