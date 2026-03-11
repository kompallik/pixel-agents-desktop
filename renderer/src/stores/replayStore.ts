import { create } from 'zustand';
import type { ReplayStatus, AgentEvent } from '../types/domainTypes.js';

interface ReplayStoreState {
  replayStatuses: Map<string, ReplayStatus>;
  recentEvents: Map<string, AgentEvent[]>;
  updateStatus: (status: ReplayStatus) => void;
  addEvent: (event: AgentEvent) => void;
  removeReplay: (sessionId: string) => void;
  getStatus: (sessionId: string) => ReplayStatus | undefined;
  getEvents: (sessionId: string) => AgentEvent[];
}

export const useReplayStore = create<ReplayStoreState>((set, get) => ({
  replayStatuses: new Map(),
  recentEvents: new Map(),
  updateStatus: (status) => set((s) => {
    const m = new Map(s.replayStatuses);
    m.set(status.sessionId, status);
    return { replayStatuses: m };
  }),
  addEvent: (event) => set((s) => {
    const m = new Map(s.recentEvents);
    const events = (m.get(event.sessionId) ?? []).slice(-199);
    events.push(event);
    m.set(event.sessionId, events);
    return { recentEvents: m };
  }),
  removeReplay: (sessionId) => set((s) => {
    const rs = new Map(s.replayStatuses);
    rs.delete(sessionId);
    const re = new Map(s.recentEvents);
    re.delete(sessionId);
    return { replayStatuses: rs, recentEvents: re };
  }),
  getStatus: (sessionId) => get().replayStatuses.get(sessionId),
  getEvents: (sessionId) => get().recentEvents.get(sessionId) ?? [],
}));
