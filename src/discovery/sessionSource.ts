import { EventEmitter } from 'events';

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

export interface DiscoveredFile {
  filePath: string;
  sourceId: string;
  sourceKind: SessionSourceKind;
  importMode: SessionImportMode;
  agentType: 'claude' | 'codex';
}

export abstract class BaseSessionSource extends EventEmitter {
  abstract readonly config: SessionSourceConfig;
  abstract start(): void;
  abstract stop(): void;

  protected emitDiscovered(file: DiscoveredFile): void {
    this.emit('session-discovered', file);
  }

  protected emitLost(filePath: string): void {
    this.emit('session-lost', filePath);
  }
}
