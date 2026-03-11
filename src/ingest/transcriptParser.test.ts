import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseLine } from './transcriptParser.js';

const FIXTURES_DIR = path.resolve(__dirname, '../../fixtures/transcripts');

function parseFixture(filename: string, agentType: 'claude' | 'codex' = 'claude') {
  const content = fs.readFileSync(path.join(FIXTURES_DIR, filename), 'utf-8');
  const lines = content.trim().split('\n');
  const allEvents = lines.flatMap((line, i) => parseLine(line, 'test-session', i + 1, agentType));
  return { lines, allEvents };
}

describe('transcriptParser', () => {
  describe('normal-edit-session.jsonl', () => {
    it('produces expected tool_started and tool_completed events', () => {
      const { allEvents } = parseFixture('normal-edit-session.jsonl');
      const types = allEvents.map(e => e.type);

      expect(types.filter(t => t === 'tool_started')).toHaveLength(3);
      expect(types.filter(t => t === 'tool_completed')).toHaveLength(3);
      expect(types).toContain('turn_completed');

      const toolNames = allEvents
        .filter(e => e.type === 'tool_started')
        .map(e => e.toolName);
      expect(toolNames).toEqual(['Write', 'Edit', 'Write']);
    });
  });

  describe('bash-failure-burst.jsonl', () => {
    it('produces 5 tool_started and 5 tool_completed from user tool_result blocks', () => {
      const { allEvents } = parseFixture('bash-failure-burst.jsonl');
      // The parser treats tool_result blocks as tool_completed (not tool_failed)
      // tool_failed is a domain event type not emitted by the parser directly
      const started = allEvents.filter(e => e.type === 'tool_started');
      const completed = allEvents.filter(e => e.type === 'tool_completed');
      expect(started).toHaveLength(5);
      expect(completed).toHaveLength(5);
    });
  });

  describe('waiting-for-input.jsonl', () => {
    it('produces turn_completed event', () => {
      const { allEvents } = parseFixture('waiting-for-input.jsonl');
      expect(allEvents.some(e => e.type === 'turn_completed')).toBe(true);
    });
  });

  describe('permission-needed.jsonl', () => {
    it('produces tool_started for Bash and tool_completed for result', () => {
      const { allEvents } = parseFixture('permission-needed.jsonl');
      expect(allEvents.some(e => e.type === 'tool_started' && e.toolName === 'Bash')).toBe(true);
      expect(allEvents.some(e => e.type === 'tool_completed')).toBe(true);
    });
  });

  describe('subagent-spawn.jsonl', () => {
    it('produces tool_started and subagent_spawned for Task tool', () => {
      const { allEvents } = parseFixture('subagent-spawn.jsonl');
      expect(allEvents.some(e => e.type === 'tool_started' && e.toolName === 'Task')).toBe(true);
      expect(allEvents.some(e => e.type === 'subagent_spawned')).toBe(true);
    });
  });

  describe('malformed-line.jsonl', () => {
    it('handles bad JSON without throwing', () => {
      const { lines, allEvents } = parseFixture('malformed-line.jsonl');
      // Should parse 3 lines: valid, invalid (returns []), valid
      expect(lines).toHaveLength(3);
      // Still get events from the 2 valid lines
      expect(allEvents.length).toBeGreaterThan(0);
      expect(allEvents.some(e => e.type === 'tool_started' && e.toolName === 'Read')).toBe(true);
    });
  });

  describe('stalled-session.jsonl', () => {
    it('produces tool_started with old timestamp', () => {
      const { allEvents } = parseFixture('stalled-session.jsonl');
      expect(allEvents).toHaveLength(1);
      expect(allEvents[0].type).toBe('tool_started');
      expect(allEvents[0].toolName).toBe('Bash');
    });
  });

  describe('read-heavy-session.jsonl', () => {
    it('produces Read/Grep/Glob tool events', () => {
      const { allEvents } = parseFixture('read-heavy-session.jsonl');
      const toolNames = allEvents
        .filter(e => e.type === 'tool_started')
        .map(e => e.toolName);
      expect(toolNames).toEqual(['Read', 'Grep', 'Glob', 'Read', 'Read']);
      expect(allEvents.filter(e => e.type === 'tool_completed')).toHaveLength(5);
    });
  });

  describe('codex-session.jsonl', () => {
    it('parses Codex format events correctly', () => {
      const { allEvents } = parseFixture('codex-session.jsonl', 'codex');
      const types = allEvents.map(e => e.type);

      // task_started produces turn_completed + session_attached
      expect(types).toContain('session_attached');
      expect(types).toContain('turn_completed');

      // function_call produces tool_started
      const started = allEvents.filter(e => e.type === 'tool_started');
      expect(started).toHaveLength(2);
      expect(started.map(e => e.toolName)).toEqual(['exec_command', 'apply_patch']);

      // function_call_output produces tool_completed
      expect(allEvents.filter(e => e.type === 'tool_completed')).toHaveLength(2);

      // user_message produces waiting_for_input
      expect(types).toContain('waiting_for_input');
    });
  });
});
