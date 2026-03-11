export type AgentEventType =
  | 'session_attached'
  | 'tool_started'
  | 'tool_completed'
  | 'tool_failed'
  | 'subagent_spawned'
  | 'subagent_completed'
  | 'permission_requested'
  | 'permission_cleared'
  | 'waiting_for_input'
  | 'turn_completed'
  | 'session_idle'
  | 'session_dormant'
  | 'session_error';

export interface AgentEvent {
  id: string;
  sessionId: string;
  timestamp: string;
  type: AgentEventType;
  toolName?: string;
  toolId?: string;
  parentToolId?: string;
  status?: string;
  rawLineNumber?: number;
  summary?: string;
  metadata?: Record<string, unknown>;
}
