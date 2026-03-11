import * as fs from 'fs';
import * as path from 'path';
import type { SessionSourceConfig } from '../sessionSource.js';
import { BaseSessionSource } from '../sessionSource.js';
import { detectAgentType } from './manualPathSource.js';
import {
  DISCOVERY_SCAN_INTERVAL_MS,
  AGENT_IDLE_TIMEOUT_MS,
} from '../../constants.js';

export class WatchedDirectorySource extends BaseSessionSource {
  readonly config: SessionSourceConfig;
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private fsWatcher: fs.FSWatcher | null = null;
  private knownFiles = new Set<string>();

  constructor(config: SessionSourceConfig) {
    super();
    this.config = config;
  }

  start(): void {
    if (this.scanTimer) return;

    const dir = this.config.directory;
    if (!dir) return;

    // Initial scan
    this.scan();

    // fs.watch for immediate notification
    try {
      this.fsWatcher = fs.watch(dir, (_eventType, filename) => {
        if (filename && filename.endsWith('.jsonl')) {
          this.scan();
        }
      });
    } catch {
      // fs.watch may not work on all platforms/filesystems
    }

    // Polling fallback
    this.scanTimer = setInterval(() => this.scan(), DISCOVERY_SCAN_INTERVAL_MS);
  }

  stop(): void {
    if (this.fsWatcher) {
      this.fsWatcher.close();
      this.fsWatcher = null;
    }
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }

    // Emit lost for all tracked files
    for (const filePath of this.knownFiles) {
      this.emitLost(filePath);
    }
    this.knownFiles.clear();
  }

  private scan(): void {
    const dir = this.config.directory;
    if (!dir || !fs.existsSync(dir)) return;

    const globPattern = this.config.glob ?? '*.jsonl';
    const activeFiles = new Set<string>();

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!this.matchesGlob(entry.name, globPattern)) continue;

        const fullPath = path.join(dir, entry.name);
        this.tryRegister(fullPath, activeFiles);
      }
    } catch {
      // Can't read dir
    }

    // Emit lost for files that disappeared or went stale
    for (const filePath of this.knownFiles) {
      if (!activeFiles.has(filePath)) {
        this.knownFiles.delete(filePath);
        this.emitLost(filePath);
      }
    }
  }

  private tryRegister(fullPath: string, activeFiles: Set<string>): void {
    try {
      const stat = fs.statSync(fullPath);
      const age = Date.now() - stat.mtimeMs;
      if (age > AGENT_IDLE_TIMEOUT_MS) return;

      activeFiles.add(fullPath);

      if (this.knownFiles.has(fullPath)) return;

      const agentType = detectAgentType(fullPath);
      if (!agentType) return;

      this.knownFiles.add(fullPath);
      this.emitDiscovered({
        filePath: fullPath,
        sourceId: this.config.id,
        sourceKind: 'watched_directory',
        importMode: this.config.importMode,
        agentType,
      });
    } catch {
      // Can't stat
    }
  }

  private matchesGlob(filename: string, pattern: string): boolean {
    // Simple glob: support *.ext pattern
    if (pattern.startsWith('*')) {
      return filename.endsWith(pattern.slice(1));
    }
    return filename === pattern;
  }
}
