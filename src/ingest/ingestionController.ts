import type { AgentEvent } from '../domain/events.js';
import type { SessionStore } from '../domain/sessionStore.js';
import { FileTailer } from './fileTailer.js';
import { ReplayReader } from './replayReader.js';
import { parseLine } from './transcriptParser.js';

export type IngestionMode = 'live' | 'replay';

export interface IngestionControllerOptions {
  sessionId: string;
  filePath: string;
  agentType: 'claude' | 'codex';
  mode: IngestionMode;
  store: SessionStore;
  startOffset?: number;
  replaySpeed?: number;
  onEvent?: (event: AgentEvent) => void;
}

export class IngestionController {
  private sessionId: string;
  private filePath: string;
  private agentType: 'claude' | 'codex';
  private mode: IngestionMode;
  private store: SessionStore;
  private onEvent: ((event: AgentEvent) => void) | undefined;

  private tailer: FileTailer | null = null;
  private replayReader: ReplayReader | null = null;
  private lineNumber = 0;
  private destroyed = false;

  constructor(options: IngestionControllerOptions) {
    this.sessionId = options.sessionId;
    this.filePath = options.filePath;
    this.agentType = options.agentType;
    this.mode = options.mode;
    this.store = options.store;
    this.onEvent = options.onEvent;

    if (this.mode === 'live') {
      this.tailer = new FileTailer({
        filePath: this.filePath,
        startOffset: options.startOffset ?? 0,
        onLines: (lines) => this.processLines(lines),
        onError: (e) => console.log(`[IngestionController] ${this.sessionId} tail error: ${e}`),
      });
    } else {
      this.replayReader = new ReplayReader({
        filePath: this.filePath,
        speedMultiplier: options.replaySpeed ?? 1,
        onLines: (lines) => this.processLines(lines),
        onComplete: () => {
          this.store.applyEvent({
            id: crypto.randomUUID(),
            sessionId: this.sessionId,
            timestamp: new Date().toISOString(),
            type: 'session_idle',
            summary: 'Replay complete',
          });
        },
        onError: (e) => console.log(`[IngestionController] ${this.sessionId} replay error: ${e}`),
      });
    }
  }

  start(): void {
    if (this.destroyed) return;
    if (this.tailer) this.tailer.start();
    if (this.replayReader) this.replayReader.start();
  }

  stop(): void {
    if (this.tailer) this.tailer.stop();
    if (this.replayReader) this.replayReader.stop();
  }

  destroy(): void {
    this.stop();
    this.destroyed = true;
    this.tailer = null;
    this.replayReader = null;
  }

  // Replay controls
  pause(): void {
    this.replayReader?.pause();
  }

  resume(): void {
    this.replayReader?.resume();
  }

  seekToLine(lineNumber: number): void {
    this.replayReader?.seekToLine(lineNumber);
  }

  setReplaySpeed(multiplier: number): void {
    this.replayReader?.setSpeed(multiplier);
  }

  get replayProgress(): { current: number; total: number } | null {
    return this.replayReader?.progress ?? null;
  }

  get currentOffset(): number {
    return this.tailer?.offset ?? 0;
  }

  private processLines(lines: string[]): void {
    for (const line of lines) {
      this.lineNumber++;
      const events = parseLine(line, this.sessionId, this.lineNumber, this.agentType);
      for (const event of events) {
        this.store.applyEvent(event);
        this.onEvent?.(event);
      }
    }
  }
}
