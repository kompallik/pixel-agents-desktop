import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { SessionSourceConfig } from '../sessionSource.js';
import { BaseSessionSource } from '../sessionSource.js';
import {
  CLAUDE_PROJECTS_DIR,
  DISCOVERY_SCAN_INTERVAL_MS,
  AGENT_IDLE_TIMEOUT_MS,
} from '../../constants.js';

export class AutoScanClaudeSource extends BaseSessionSource {
  readonly config: SessionSourceConfig;
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private knownFiles = new Set<string>();

  constructor(config: SessionSourceConfig) {
    super();
    this.config = config;
  }

  start(): void {
    if (this.scanTimer) return;
    this.scan();
    this.scanTimer = setInterval(() => this.scan(), DISCOVERY_SCAN_INTERVAL_MS);
  }

  stop(): void {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    this.knownFiles.clear();
  }

  private scan(): void {
    const claudeDir = path.join(os.homedir(), CLAUDE_PROJECTS_DIR);
    if (!fs.existsSync(claudeDir)) return;

    const activeFiles = new Set<string>();

    try {
      const projectDirs = fs.readdirSync(claudeDir, { withFileTypes: true });
      for (const dir of projectDirs) {
        if (!dir.isDirectory()) continue;
        this.scanDirForJsonl(path.join(claudeDir, dir.name), activeFiles);
      }
    } catch {
      // Directory may not be readable
    }

    // Emit lost for files that disappeared or went stale
    for (const filePath of this.knownFiles) {
      if (!activeFiles.has(filePath)) {
        this.knownFiles.delete(filePath);
        this.emitLost(filePath);
      }
    }
  }

  private scanDirForJsonl(projectPath: string, activeFiles: Set<string>): void {
    try {
      const files = fs.readdirSync(projectPath);
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;
        const fullPath = path.join(projectPath, file);
        this.tryRegister(fullPath, activeFiles);
      }
    } catch {
      // Can't read dir
    }
  }

  private tryRegister(fullPath: string, activeFiles: Set<string>): void {
    try {
      const stat = fs.statSync(fullPath);
      const age = Date.now() - stat.mtimeMs;
      if (age > AGENT_IDLE_TIMEOUT_MS) return;

      activeFiles.add(fullPath);

      if (this.knownFiles.has(fullPath)) return;

      this.knownFiles.add(fullPath);
      this.emitDiscovered({
        filePath: fullPath,
        sourceId: this.config.id,
        sourceKind: 'auto_claude',
        importMode: this.config.importMode,
        agentType: 'claude',
      });
    } catch {
      // Can't stat
    }
  }
}
