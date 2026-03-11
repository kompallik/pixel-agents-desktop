// Renderer-side copies of main-process domain types.
// The renderer cannot import directly from src/ so we mirror the interfaces here.

// ── Session Source types (from src/discovery/sessionSource.ts) ──

export type SessionSourceKind =
  | 'auto_claude'
  | 'auto_codex'
  | 'manual_file'
  | 'watched_directory';

export type SessionImportMode = 'tail' | 'replay' | 'snapshot';

export interface SessionSourceConfig {
  id: string;
  kind: SessionSourceKind;
  label: string;
  enabled: boolean;
  importMode: SessionImportMode;
  path?: string;
  directory?: string;
  glob?: string;
}

// ── Session state types (from src/domain/sessionState.ts) ──

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
