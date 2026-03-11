import { EventEmitter } from 'events';
import * as path from 'path';
import * as crypto from 'crypto';
import type { DiscoveredFile, SessionSourceKind, SessionImportMode } from './sessionSource.js';

export interface SessionRecord {
  sessionId: string;
  filePath: string;
  normalizedPath: string;
  sourceId: string;
  sourceKind: SessionSourceKind;
  agentType: 'claude' | 'codex';
  importMode: SessionImportMode;
  registeredAt: Date;
}

export class SessionRegistry extends EventEmitter {
  private sessions = new Map<string, SessionRecord>();
  private pathIndex = new Map<string, string>(); // normalizedPath → sessionId

  registerFile(file: DiscoveredFile): string | null {
    const normalizedPath = path.resolve(path.normalize(file.filePath));

    if (this.pathIndex.has(normalizedPath)) {
      return null; // duplicate
    }

    const sessionId = crypto.randomUUID();
    const record: SessionRecord = {
      sessionId,
      filePath: file.filePath,
      normalizedPath,
      sourceId: file.sourceId,
      sourceKind: file.sourceKind,
      agentType: file.agentType,
      importMode: file.importMode,
      registeredAt: new Date(),
    };

    this.sessions.set(sessionId, record);
    this.pathIndex.set(normalizedPath, sessionId);
    this.emit('session-registered', record);
    return sessionId;
  }

  removeByPath(filePath: string): void {
    const normalizedPath = path.resolve(path.normalize(filePath));
    const sessionId = this.pathIndex.get(normalizedPath);
    if (!sessionId) return;

    const record = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    this.pathIndex.delete(normalizedPath);
    if (record) {
      this.emit('session-removed', record);
    }
  }

  getSession(id: string): SessionRecord | undefined {
    return this.sessions.get(id);
  }

  getAllSessions(): SessionRecord[] {
    return [...this.sessions.values()];
  }

  getActiveSessions(): SessionRecord[] {
    return [...this.sessions.values()];
  }
}
