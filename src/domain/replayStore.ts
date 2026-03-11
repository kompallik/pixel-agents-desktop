import { EventEmitter } from 'events';
import { ReplayController } from '../ingest/replayController.js';
import type { ReplayStateSnapshot } from '../ingest/replayController.js';
import type { AgentEvent } from './events.js';
import type { SessionViewState } from './sessionState.js';

export class ReplayStore extends EventEmitter {
  private replays = new Map<string, ReplayController>();

  startReplay(
    filePath: string,
    agentType: 'claude' | 'codex',
    speed?: number,
  ): string {
    const controller = new ReplayController({ filePath, agentType, speed });
    controller.load();

    // Forward events to listeners
    controller.on('replayEvent', (event: AgentEvent) => {
      this.emit('replayEvent', { sessionId: controller.sessionId, event });
    });
    controller.on('replayState', (snapshot: ReplayStateSnapshot) => {
      this.emit('replayState', snapshot);
    });

    this.replays.set(controller.sessionId, controller);
    return controller.sessionId;
  }

  stopReplay(sessionId: string): void {
    const controller = this.replays.get(sessionId);
    if (!controller) return;
    controller.destroy();
    this.replays.delete(sessionId);
  }

  getController(sessionId: string): ReplayController | undefined {
    return this.replays.get(sessionId);
  }

  getReplaySessions(): SessionViewState[] {
    const sessions: SessionViewState[] = [];
    for (const controller of this.replays.values()) {
      sessions.push(controller.getStateAtCurrent());
    }
    return sessions;
  }

  getReplaySnapshots(): ReplayStateSnapshot[] {
    const snapshots: ReplayStateSnapshot[] = [];
    for (const controller of this.replays.values()) {
      snapshots.push(controller.getSnapshot());
    }
    return snapshots;
  }

  stopAll(): void {
    for (const controller of this.replays.values()) {
      controller.destroy();
    }
    this.replays.clear();
  }

  get size(): number {
    return this.replays.size;
  }
}
