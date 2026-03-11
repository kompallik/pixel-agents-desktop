import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { SessionSourceConfig } from '../sessionSource.js';
import { BaseSessionSource } from '../sessionSource.js';
import {
  CODEX_SESSIONS_DIR,
  DISCOVERY_SCAN_INTERVAL_MS,
  AGENT_IDLE_TIMEOUT_MS,
} from '../../constants.js';

export class AutoScanCodexSource extends BaseSessionSource {
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
    const codexDir = path.join(os.homedir(), CODEX_SESSIONS_DIR);
    if (!fs.existsSync(codexDir)) return;

    const activeFiles = new Set<string>();
    this.scanRecursive(codexDir, activeFiles);

    for (const filePath of this.knownFiles) {
      if (!activeFiles.has(filePath)) {
        this.knownFiles.delete(filePath);
        this.emitLost(filePath);
      }
    }
  }

  private scanRecursive(dir: string, activeFiles: Set<string>): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          this.scanRecursive(fullPath, activeFiles);
        } else if (entry.name.endsWith('.jsonl')) {
          this.tryRegister(fullPath, activeFiles);
        }
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
        sourceKind: 'auto_codex',
        importMode: this.config.importMode,
        agentType: 'codex',
      });
    } catch {
      // Can't stat
    }
  }
}
