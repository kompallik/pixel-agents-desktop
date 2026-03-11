export type SessionStatus =
  | 'starting'
  | 'reading'
  | 'editing'
  | 'executing'
  | 'waiting_input'
  | 'waiting_permission'
  | 'idle'
  | 'stalled'
  | 'completed'
  | 'errored'
  | 'dormant';

export interface StatusAssessment {
  state: SessionStatus;
  confidence: number;
  reasons: string[];
}

export interface ToolInfo {
  toolId: string;
  toolName: string;
  status: 'active' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
}

export interface SessionViewState {
  sessionId: string;
  agentId: number;
  sourceId: string;
  agentType: 'claude' | 'codex';
  filePath: string;
  projectName?: string;
  branch?: string;
  worktree?: string;
  status: StatusAssessment;
  activeTools: ToolInfo[];
  recentTools: ToolInfo[];
  childSessions: string[];
  eventCount: number;
  lastEventAt?: string;
  lastFileWriteAt?: string;
  healthScore: number;
  alertIds: string[];
  runMode: 'live' | 'replay';
}

export function createInitialSessionState(
  sessionId: string,
  agentId: number,
  sourceId: string,
  agentType: 'claude' | 'codex',
  filePath: string,
): SessionViewState {
  return {
    sessionId,
    agentId,
    sourceId,
    agentType,
    filePath,
    status: { state: 'starting', confidence: 0.6, reasons: ['Session just attached'] },
    activeTools: [],
    recentTools: [],
    childSessions: [],
    eventCount: 0,
    healthScore: 100,
    alertIds: [],
    runMode: 'live',
  };
}
