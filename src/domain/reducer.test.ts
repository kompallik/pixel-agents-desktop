import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { sessionReducer } from './reducer.js';
import { createInitialSessionState } from './sessionState.js';
import { parseLine } from '../ingest/transcriptParser.js';
import type { AgentEvent } from './events.js';

function makeEvent(type: AgentEvent['type'], extra?: Partial<AgentEvent>): AgentEvent {
  return {
    id: 'evt-' + Math.random().toString(36).slice(2),
    sessionId: 'session-1',
    timestamp: new Date().toISOString(),
    type,
    ...extra,
  };
}

function makeInitialState() {
  return createInitialSessionState('session-1', 1, 'src-1', 'claude', '/tmp/test.jsonl');
}

describe('sessionReducer', () => {
  it('increments eventCount on any event', () => {
    const state = makeInitialState();
    const next = sessionReducer(state, makeEvent('session_attached'));
    expect(next.eventCount).toBe(1);
  });

  it('updates lastEventAt from event timestamp', () => {
    const state = makeInitialState();
    const ts = '2026-03-10T10:00:00Z';
    const next = sessionReducer(state, makeEvent('session_attached', { timestamp: ts }));
    expect(next.lastEventAt).toBe(ts);
  });

  it('tool_started adds tool to activeTools', () => {
    const state = makeInitialState();
    const next = sessionReducer(state, makeEvent('tool_started', {
      toolId: 'tool-1',
      toolName: 'Write',
    }));
    expect(next.activeTools).toHaveLength(1);
    expect(next.activeTools[0].toolId).toBe('tool-1');
    expect(next.activeTools[0].toolName).toBe('Write');
    expect(next.activeTools[0].status).toBe('active');
  });

  it('tool_completed moves tool from activeTools to recentTools', () => {
    let state = makeInitialState();
    state = sessionReducer(state, makeEvent('tool_started', { toolId: 'tool-1', toolName: 'Write' }));
    state = sessionReducer(state, makeEvent('tool_completed', { toolId: 'tool-1' }));
    expect(state.activeTools).toHaveLength(0);
    expect(state.recentTools).toHaveLength(1);
    expect(state.recentTools[0].status).toBe('completed');
  });

  it('tool_failed moves tool to recentTools with failed status', () => {
    let state = makeInitialState();
    state = sessionReducer(state, makeEvent('tool_started', { toolId: 'tool-1', toolName: 'Bash' }));
    state = sessionReducer(state, makeEvent('tool_failed', { toolId: 'tool-1' }));
    expect(state.activeTools).toHaveLength(0);
    expect(state.recentTools).toHaveLength(1);
    expect(state.recentTools[0].status).toBe('failed');
  });

  it('turn_completed clears activeTools', () => {
    let state = makeInitialState();
    state = sessionReducer(state, makeEvent('tool_started', { toolId: 't1', toolName: 'Read' }));
    state = sessionReducer(state, makeEvent('tool_started', { toolId: 't2', toolName: 'Grep' }));
    expect(state.activeTools).toHaveLength(2);
    state = sessionReducer(state, makeEvent('turn_completed'));
    expect(state.activeTools).toHaveLength(0);
    expect(state.recentTools.length).toBeGreaterThanOrEqual(2);
  });

  it('subagent_spawned adds to childSessions', () => {
    const state = makeInitialState();
    const next = sessionReducer(state, makeEvent('subagent_spawned', {
      metadata: { childSessionId: 'child-1' },
    }));
    expect(next.childSessions).toContain('child-1');
  });

  it('subagent_completed removes from childSessions', () => {
    let state = makeInitialState();
    state = sessionReducer(state, makeEvent('subagent_spawned', {
      metadata: { childSessionId: 'child-1' },
    }));
    state = sessionReducer(state, makeEvent('subagent_completed', {
      metadata: { childSessionId: 'child-1' },
    }));
    expect(state.childSessions).not.toContain('child-1');
  });

  it('permission_requested sets waiting_permission status', () => {
    const state = makeInitialState();
    const next = sessionReducer(state, makeEvent('permission_requested'));
    expect(next.status.state).toBe('waiting_permission');
  });

  it('waiting_for_input sets waiting_input status', () => {
    const state = makeInitialState();
    const next = sessionReducer(state, makeEvent('waiting_for_input'));
    expect(next.status.state).toBe('waiting_input');
  });

  it('session_error sets errored status', () => {
    const state = makeInitialState();
    const next = sessionReducer(state, makeEvent('session_error', { summary: 'Parse failed' }));
    expect(next.status.state).toBe('errored');
    expect(next.status.reasons).toContain('Parse failed');
  });

  describe('golden-state: replay normal-edit-session.jsonl', () => {
    it('produces correct final state', () => {
      const fixturePath = path.resolve(__dirname, '../../fixtures/transcripts/normal-edit-session.jsonl');
      const lines = fs.readFileSync(fixturePath, 'utf-8').trim().split('\n');

      let state = makeInitialState();
      for (let i = 0; i < lines.length; i++) {
        const events = parseLine(lines[i], 'session-1', i + 1, 'claude');
        for (const evt of events) {
          state = sessionReducer(state, evt);
        }
      }

      // After replaying: 3 tool_started (Write, Edit, Write) + 3 tool_completed + 1 turn_completed = 7 events
      expect(state.eventCount).toBe(7);
      expect(state.activeTools).toHaveLength(0);
      // 3 tools completed via tool_completed, turn_completed has no remaining active tools
      expect(state.recentTools).toHaveLength(3);
      expect(state.recentTools.map(t => t.status)).toEqual(['completed', 'completed', 'completed']);
    });
  });
});
