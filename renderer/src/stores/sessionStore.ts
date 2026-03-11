import { create } from 'zustand';
import type { SessionViewState, SessionStatus } from '../types/domainTypes.js';

interface SessionStoreState {
  sessions: Map<string, SessionViewState>;
  selectedSessionId: string | null;
  filterStatus: SessionStatus | null;
  searchQuery: string;
  // actions
  updateSession: (state: SessionViewState) => void;
  updateSessions: (states: SessionViewState[]) => void;
  removeSession: (sessionId: string) => void;
  selectSession: (sessionId: string | null) => void;
  setFilterStatus: (status: SessionStatus | null) => void;
  setSearchQuery: (query: string) => void;
}

export const useSessionStore = create<SessionStoreState>((set) => ({
  sessions: new Map(),
  selectedSessionId: null,
  filterStatus: null,
  searchQuery: '',
  updateSession: (sessionState) => set((s) => {
    const sessions = new Map(s.sessions);
    sessions.set(sessionState.sessionId, sessionState);
    return { sessions };
  }),
  updateSessions: (states) => set((s) => {
    const sessions = new Map(s.sessions);
    for (const state of states) {
      sessions.set(state.sessionId, state);
    }
    return { sessions };
  }),
  removeSession: (sessionId) => set((s) => {
    const sessions = new Map(s.sessions);
    sessions.delete(sessionId);
    return { sessions };
  }),
  selectSession: (sessionId) => set({ selectedSessionId: sessionId }),
  setFilterStatus: (status) => set({ filterStatus: status }),
  setSearchQuery: (query) => set({ searchQuery: query }),
}));
