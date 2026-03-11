import * as fs from 'fs';
import { LineBuffer } from './lineBuffer.js';
import { FILE_WATCHER_POLL_INTERVAL_MS } from '../constants.js';

export interface FileTailerOptions {
  filePath: string;
  startOffset?: number;
  onLines: (lines: string[]) => void;
  onError?: (error: unknown) => void;
}

export class FileTailer {
  private filePath: string;
  private fileOffset: number;
  private lineBuffer: LineBuffer;
  private onLines: (lines: string[]) => void;
  private onError: (error: unknown) => void;
  private watcher: fs.FSWatcher | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(options: FileTailerOptions) {
    this.filePath = options.filePath;
    this.fileOffset = options.startOffset ?? 0;
    this.lineBuffer = new LineBuffer();
    this.onLines = options.onLines;
    this.onError = options.onError ?? (() => {});
  }

  start(): void {
    // Primary: fs.watch for immediate notification
    try {
      this.watcher = fs.watch(this.filePath, () => {
        if (!this.stopped) this.readNewData();
      });
    } catch (e) {
      console.log(`[FileTailer] fs.watch failed for ${this.filePath}: ${e}`);
    }

    // Backup: poll interval
    this.pollTimer = setInterval(() => {
      if (!this.stopped) this.readNewData();
    }, FILE_WATCHER_POLL_INTERVAL_MS);

    // Initial read to catch up
    this.readNewData();
  }

  stop(): void {
    this.stopped = true;
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  get offset(): number {
    return this.fileOffset;
  }

  get bufferPending(): number {
    return this.lineBuffer.pending;
  }

  private readNewData(): void {
    try {
      const stat = fs.statSync(this.filePath);
      if (stat.size <= this.fileOffset) return;

      const readSize = stat.size - this.fileOffset;
      const buf = Buffer.alloc(readSize);
      const fd = fs.openSync(this.filePath, 'r');
      try {
        fs.readSync(fd, buf, 0, readSize, this.fileOffset);
      } finally {
        fs.closeSync(fd);
      }
      this.fileOffset = stat.size;

      const lines = this.lineBuffer.append(buf.toString('utf-8'));
      const nonEmpty = lines.filter(l => l.trim().length > 0);
      if (nonEmpty.length > 0) {
        this.onLines(nonEmpty);
      }
    } catch (e) {
      this.onError(e);
    }
  }
}
