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

// ── Alert types (from src/domain/alertEngine.ts) ──

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

// ── Replay types (from src/ingest/replayController.ts) ──

export type PlaybackState = 'playing' | 'paused' | 'seeking' | 'stopped';
export type ReplaySpeed = 1 | 2 | 5 | 10 | 20;
export type JumpTarget = 'next_error' | 'prev_error' | 'next_tool' | 'prev_tool';

export interface ReplayStatus {
  sessionId: string;
  state: PlaybackState;
  currentIndex: number;
  totalEvents: number;
  currentTimestamp: string | null;
  speed: number;
}

export interface AgentEvent {
  id: string;
  sessionId: string;
  timestamp: string;
  type: string;
  toolName?: string;
}

// ── Session view types ──

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
