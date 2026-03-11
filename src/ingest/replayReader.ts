import * as fs from 'fs';
import { LineBuffer } from './lineBuffer.js';

export interface ReplayReaderOptions {
  filePath: string;
  onLines: (lines: string[]) => void;
  onComplete: () => void;
  onError?: (error: unknown) => void;
  speedMultiplier?: number;
}

export class ReplayReader {
  private filePath: string;
  private onLines: (lines: string[]) => void;
  private onComplete: () => void;
  private onError: (error: unknown) => void;
  private speedMultiplier: number;
  private lines: string[] = [];
  private currentIndex = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private paused = false;

  constructor(options: ReplayReaderOptions) {
    this.filePath = options.filePath;
    this.onLines = options.onLines;
    this.onComplete = options.onComplete;
    this.onError = options.onError ?? (() => {});
    this.speedMultiplier = options.speedMultiplier ?? 1;
  }

  start(): void {
    try {
      const content = fs.readFileSync(this.filePath, 'utf-8');
      const buffer = new LineBuffer();
      const allLines = buffer.append(content + '\n');
      this.lines = allLines.filter(l => l.trim().length > 0);

      if (this.lines.length === 0) {
        this.onComplete();
        return;
      }

      this.currentIndex = 0;
      this.emitNext();
    } catch (e) {
      this.onError(e);
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  pause(): void {
    this.paused = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    if (!this.stopped && this.currentIndex < this.lines.length) {
      this.emitNext();
    }
  }

  seekToLine(lineNumber: number): void {
    this.currentIndex = Math.max(0, Math.min(lineNumber, this.lines.length));
  }

  setSpeed(multiplier: number): void {
    this.speedMultiplier = multiplier;
  }

  get progress(): { current: number; total: number } {
    return { current: this.currentIndex, total: this.lines.length };
  }

  private emitNext(): void {
    if (this.stopped || this.paused) return;

    if (this.currentIndex >= this.lines.length) {
      this.onComplete();
      return;
    }

    const line = this.lines[this.currentIndex];
    this.currentIndex++;
    this.onLines([line]);

    // Compute delay from timestamps if available
    const delay = this.computeDelay();
    this.timer = setTimeout(() => this.emitNext(), delay);
  }

  private computeDelay(): number {
    if (this.currentIndex >= this.lines.length) return 0;

    const prevLine = this.lines[this.currentIndex - 1];
    const nextLine = this.lines[this.currentIndex];

    const prevTs = this.extractTimestamp(prevLine);
    const nextTs = this.extractTimestamp(nextLine);

    if (prevTs && nextTs) {
      const diff = nextTs - prevTs;
      if (diff > 0 && diff < 30000) {
        return Math.max(10, diff / this.speedMultiplier);
      }
    }

    // Default: small fixed delay scaled by speed
    return Math.max(10, 50 / this.speedMultiplier);
  }

  private extractTimestamp(line: string): number | null {
    try {
      const record = JSON.parse(line) as Record<string, unknown>;
      // Claude Code format: timestamp field
      if (typeof record['timestamp'] === 'string') {
        const t = Date.parse(record['timestamp']);
        if (!isNaN(t)) return t;
      }
      // Codex format: ts field
      if (typeof record['ts'] === 'number') {
        return record['ts'] as number;
      }
    } catch {
      // Not valid JSON
    }
    return null;
  }
}
