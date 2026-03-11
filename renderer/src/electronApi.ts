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

export interface SourceResult {
  success: boolean;
  error?: string;
  config?: SessionSourceConfig;
}

export type PlaybackState = 'playing' | 'paused' | 'seeking' | 'stopped';
export type JumpTarget = 'next_error' | 'prev_error' | 'next_tool' | 'prev_tool';
export type ReplayAction = 'play' | 'pause' | 'stop' | 'seek' | 'speed' | 'jumpTo';

export interface ReplayStateSnapshot {
  sessionId: string;
  playbackState: PlaybackState;
  currentIndex: number;
  totalEvents: number;
  currentTimestamp: string | null;
  speed: number;
  sessionState: unknown;
}

export interface ReplayResult {
  success: boolean;
  error?: string;
  sessionId?: string;
  snapshot?: ReplayStateSnapshot;
}

interface ElectronAPI {
  send(channel: string, data?: unknown): void;
  on(channel: string, callback: (...args: unknown[]) => void): () => void;
  once(channel: string, callback: (...args: unknown[]) => void): void;
  invoke(channel: string, data?: unknown): Promise<unknown>;
  addManualFile(filePath: string, importMode?: string, label?: string): Promise<SourceResult>;
  addWatchedDirectory(directory: string, glob?: string, importMode?: string, label?: string): Promise<SourceResult>;
  removeSource(sourceId: string): Promise<SourceResult>;
  getSourceConfigs(): Promise<SessionSourceConfig[]>;
  enableSource(sourceId: string): Promise<SourceResult>;
  disableSource(sourceId: string): Promise<SourceResult>;
  acknowledgeAlert(alertId: string): Promise<SourceResult>;
  getActiveAlerts(): Promise<unknown[]>;
  startReplay(filePath: string, speed?: number): Promise<ReplayResult>;
  replayControl(sessionId: string, action: ReplayAction, value?: number | string): Promise<ReplayResult>;
  stopReplay(sessionId: string): Promise<SourceResult>;
  getReplaySnapshots(): Promise<ReplayStateSnapshot[]>;
  onReplayEvent(callback: (...args: unknown[]) => void): () => void;
  onReplayState(callback: (...args: unknown[]) => void): () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export const api = window.electronAPI;

/** Typed listener for sessionStateUpdate IPC channel */
export function onSessionStateUpdate(callback: (sessions: import('./types/domainTypes.js').SessionViewState[]) => void): () => void {
  return api.on('sessionStateUpdate', (...args: unknown[]) => {
    callback(args[0] as import('./types/domainTypes.js').SessionViewState[]);
  });
}
