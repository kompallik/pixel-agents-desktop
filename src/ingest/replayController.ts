import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { LineBuffer } from './lineBuffer.js';
import { parseLine } from './transcriptParser.js';
import type { AgentEvent } from '../domain/events.js';
import type { SessionViewState } from '../domain/sessionState.js';
import { createInitialSessionState } from '../domain/sessionState.js';
import { sessionReducer } from '../domain/reducer.js';

export type PlaybackState = 'playing' | 'paused' | 'seeking' | 'stopped';

export type JumpTarget = 'next_error' | 'prev_error' | 'next_tool' | 'prev_tool';

export interface ReplayControllerOptions {
  filePath: string;
  agentType: 'claude' | 'codex';
  speed?: number;
}

export interface ReplayStateSnapshot {
  sessionId: string;
  playbackState: PlaybackState;
  currentIndex: number;
  totalEvents: number;
  currentTimestamp: string | null;
  speed: number;
  sessionState: SessionViewState;
}

export class ReplayController extends EventEmitter {
  readonly sessionId: string;
  private filePath: string;
  private agentType: 'claude' | 'codex';
  private events: AgentEvent[] = [];
  private timestamps: (number | null)[] = [];
  private currentIndex = 0;
  private speed: number;
  private playbackState: PlaybackState = 'stopped';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private baseSessionState: SessionViewState;

  constructor(options: ReplayControllerOptions) {
    super();
    this.sessionId = `replay_${randomUUID()}`;
    this.filePath = options.filePath;
    this.agentType = options.agentType;
    this.speed = options.speed ?? 1;
    this.baseSessionState = createInitialSessionState(
      this.sessionId, 0, 'replay', this.agentType, this.filePath,
    );
    this.baseSessionState.runMode = 'replay';
  }

  /** Load and parse the file. Must be called before play(). */
  load(): void {
    const content = fs.readFileSync(this.filePath, 'utf-8');
    const buffer = new LineBuffer();
    const rawLines = buffer.append(content + '\n').filter(l => l.trim().length > 0);

    this.events = [];
    this.timestamps = [];

    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      const parsed = parseLine(line, this.sessionId, i + 1, this.agentType);
      const ts = this.extractTimestamp(line);
      for (const event of parsed) {
        this.events.push(event);
        this.timestamps.push(ts);
      }
    }

    this.currentIndex = 0;
    this.playbackState = 'stopped';
    this.emitStateUpdate();
  }

  play(): void {
    if (this.events.length === 0) return;
    if (this.playbackState === 'playing') return;
    this.playbackState = 'playing';
    this.emitStateUpdate();
    this.scheduleNext();
  }

  pause(): void {
    if (this.playbackState !== 'playing') return;
    this.clearTimer();
    this.playbackState = 'paused';
    this.emitStateUpdate();
  }

  stop(): void {
    this.clearTimer();
    this.playbackState = 'stopped';
    this.currentIndex = 0;
    this.emitStateUpdate();
  }

  setSpeed(multiplier: number): void {
    this.speed = Math.max(0.1, multiplier);
    // If playing, reschedule with new speed
    if (this.playbackState === 'playing') {
      this.clearTimer();
      this.scheduleNext();
    }
    this.emitStateUpdate();
  }

  seek(target: number | string): void {
    this.clearTimer();
    const prevState = this.playbackState;
    this.playbackState = 'seeking';

    let targetIndex: number;
    if (typeof target === 'number') {
      targetIndex = Math.max(0, Math.min(target, this.events.length));
    } else {
      // Seek by timestamp string
      const targetMs = Date.parse(target);
      targetIndex = this.findIndexByTimestamp(targetMs);
    }

    this.currentIndex = targetIndex;
    this.playbackState = prevState === 'playing' ? 'playing' : 'paused';
    this.emitStateUpdate();
    this.emitCurrentEvent();

    if (this.playbackState === 'playing') {
      this.scheduleNext();
    }
  }

  jumpTo(target: JumpTarget): void {
    let found = -1;

    switch (target) {
      case 'next_error':
        found = this.findNext(this.currentIndex, e => e.type === 'tool_failed' || e.type === 'session_error');
        break;
      case 'prev_error':
        found = this.findPrev(this.currentIndex, e => e.type === 'tool_failed' || e.type === 'session_error');
        break;
      case 'next_tool':
        found = this.findNext(this.currentIndex, e => e.type === 'tool_started');
        break;
      case 'prev_tool':
        found = this.findPrev(this.currentIndex, e => e.type === 'tool_started');
        break;
    }

    if (found >= 0) {
      this.seek(found);
    }
  }

  /** Reconstruct SessionViewState at current index by replaying events[0..currentIndex] */
  getStateAtCurrent(): SessionViewState {
    return this.reconstructState(this.currentIndex);
  }

  getSnapshot(): ReplayStateSnapshot {
    return {
      sessionId: this.sessionId,
      playbackState: this.playbackState,
      currentIndex: this.currentIndex,
      totalEvents: this.events.length,
      currentTimestamp: this.currentIndex > 0 && this.currentIndex <= this.events.length
        ? this.events[this.currentIndex - 1].timestamp
        : null,
      speed: this.speed,
      sessionState: this.getStateAtCurrent(),
    };
  }

  getAllEvents(): AgentEvent[] {
    return this.events;
  }

  destroy(): void {
    this.clearTimer();
    this.playbackState = 'stopped';
    this.events = [];
    this.timestamps = [];
    this.removeAllListeners();
  }

  private scheduleNext(): void {
    if (this.playbackState !== 'playing') return;
    if (this.currentIndex >= this.events.length) {
      this.playbackState = 'paused';
      this.emitStateUpdate();
      return;
    }

    const delay = this.computeDelay();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.playbackState !== 'playing') return;

      this.emitCurrentEvent();
      this.currentIndex++;
      this.emitStateUpdate();
      this.scheduleNext();
    }, delay);
  }

  private emitCurrentEvent(): void {
    if (this.currentIndex >= this.events.length) return;
    const event = this.events[this.currentIndex];
    this.emit('replayEvent', event);
    this.emit('replayState', this.getSnapshot());
  }

  private emitStateUpdate(): void {
    this.emit('replayState', this.getSnapshot());
  }

  private computeDelay(): number {
    if (this.currentIndex + 1 >= this.events.length) return 0;

    const currentTs = this.timestamps[this.currentIndex];
    const nextTs = this.timestamps[this.currentIndex + 1];

    if (currentTs !== null && nextTs !== null && currentTs !== undefined && nextTs !== undefined) {
      const diff = nextTs - currentTs;
      if (diff > 0 && diff < 30000) {
        return Math.max(5, diff / this.speed);
      }
    }

    return Math.max(5, 50 / this.speed);
  }

  private reconstructState(upToIndex: number): SessionViewState {
    let state = { ...this.baseSessionState };
    const limit = Math.min(upToIndex, this.events.length);
    for (let i = 0; i < limit; i++) {
      state = sessionReducer(state, this.events[i]);
    }
    return state;
  }

  private findNext(fromIndex: number, predicate: (e: AgentEvent) => boolean): number {
    for (let i = fromIndex + 1; i < this.events.length; i++) {
      if (predicate(this.events[i])) return i;
    }
    return -1;
  }

  private findPrev(fromIndex: number, predicate: (e: AgentEvent) => boolean): number {
    for (let i = fromIndex - 1; i >= 0; i--) {
      if (predicate(this.events[i])) return i;
    }
    return -1;
  }

  private findIndexByTimestamp(targetMs: number): number {
    if (isNaN(targetMs)) return 0;
    for (let i = 0; i < this.timestamps.length; i++) {
      const ts = this.timestamps[i];
      if (ts !== null && ts >= targetMs) return i;
    }
    return this.events.length;
  }

  private extractTimestamp(line: string): number | null {
    try {
      const record = JSON.parse(line) as Record<string, unknown>;
      if (typeof record['timestamp'] === 'string') {
        const t = Date.parse(record['timestamp']);
        if (!isNaN(t)) return t;
      }
      if (typeof record['ts'] === 'number') {
        return record['ts'] as number;
      }
    } catch {
      // Not valid JSON
    }
    return null;
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
