import * as fs from 'fs';
import type { SessionSourceConfig } from '../sessionSource.js';
import { BaseSessionSource } from '../sessionSource.js';

export { validateJsonlFile } from '../pathValidator.js';

export function detectAgentType(filePath: string): 'claude' | 'codex' | null {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(4096);
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    if (bytesRead === 0) return null;

    const firstLine = buf.toString('utf-8', 0, bytesRead).split('\n')[0]?.trim();
    if (!firstLine) return null;

    const parsed = JSON.parse(firstLine) as Record<string, unknown>;
    if (parsed.type === 'task_started' || parsed.type === 'task_completed' || parsed.session_id) {
      return 'codex';
    }
    return 'claude';
  } catch {
    return null;
  }
}

export class ManualPathSource extends BaseSessionSource {
  readonly config: SessionSourceConfig;
  private started = false;
  private fsWatcher: fs.FSWatcher | null = null;

  constructor(config: SessionSourceConfig) {
    super();
    this.config = config;
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    const filePath = this.config.path;
    if (!filePath) {
      this.emit('error', new Error('ManualPathSource: no path configured'));
      return;
    }

    try {
      fs.accessSync(filePath, fs.constants.R_OK);
    } catch {
      this.emit('error', new Error(`File not found or unreadable: ${filePath}`));
      return;
    }

    const agentType = detectAgentType(filePath);
    if (!agentType) {
      this.emit('error', new Error(`Cannot detect agent type for: ${filePath}`));
      return;
    }

    this.emitDiscovered({
      filePath,
      sourceId: this.config.id,
      sourceKind: 'manual_file',
      importMode: this.config.importMode,
      agentType,
    });

    // For tail/replay: watch file for deletion/rename so we can emit lost
    if (this.config.importMode !== 'snapshot') {
      try {
        this.fsWatcher = fs.watch(filePath, (eventType) => {
          if (eventType === 'rename') {
            // File was deleted or renamed — check if it still exists
            try {
              fs.accessSync(filePath, fs.constants.R_OK);
            } catch {
              this.emitLost(filePath);
              this.closeWatcher();
            }
          }
        });
      } catch {
        // fs.watch not available — content watching is handled at the main level
      }
    }
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.closeWatcher();

    const filePath = this.config.path;
    if (filePath) {
      this.emitLost(filePath);
    }
  }

  private closeWatcher(): void {
    if (this.fsWatcher) {
      this.fsWatcher.close();
      this.fsWatcher = null;
    }
  }
}
