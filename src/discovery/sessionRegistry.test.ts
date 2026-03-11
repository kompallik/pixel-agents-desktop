import { describe, it, expect } from 'vitest';
import { SessionRegistry } from './sessionRegistry.js';
import type { DiscoveredFile } from './sessionSource.js';

function makeFile(filePath: string, overrides?: Partial<DiscoveredFile>): DiscoveredFile {
  return {
    filePath,
    sourceId: 'src-1',
    sourceKind: 'auto_claude',
    importMode: 'tail',
    agentType: 'claude',
    ...overrides,
  };
}

describe('SessionRegistry', () => {
  it('registers a file and returns a session ID', () => {
    const reg = new SessionRegistry();
    const id = reg.registerFile(makeFile('/tmp/test/session.jsonl'));
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
  });

  it('deduplicates by normalized path', () => {
    const reg = new SessionRegistry();
    const id1 = reg.registerFile(makeFile('/tmp/test/session.jsonl'));
    const id2 = reg.registerFile(makeFile('/tmp/test/session.jsonl'));
    expect(id1).toBeTruthy();
    expect(id2).toBeNull();
  });

  it('generates stable unique IDs for different paths', () => {
    const reg = new SessionRegistry();
    const id1 = reg.registerFile(makeFile('/tmp/a.jsonl'));
    const id2 = reg.registerFile(makeFile('/tmp/b.jsonl'));
    expect(id1).not.toBe(id2);
  });

  it('getActiveSessions returns all registered sessions', () => {
    const reg = new SessionRegistry();
    reg.registerFile(makeFile('/tmp/s1.jsonl'));
    reg.registerFile(makeFile('/tmp/s2.jsonl'));
    const sessions = reg.getActiveSessions();
    expect(sessions).toHaveLength(2);
  });

  it('removeByPath removes session from registry', () => {
    const reg = new SessionRegistry();
    reg.registerFile(makeFile('/tmp/remove-me.jsonl'));
    expect(reg.getAllSessions()).toHaveLength(1);
    reg.removeByPath('/tmp/remove-me.jsonl');
    expect(reg.getAllSessions()).toHaveLength(0);
  });

  it('emits session-registered event', () => {
    const reg = new SessionRegistry();
    const events: unknown[] = [];
    reg.on('session-registered', (r) => events.push(r));
    reg.registerFile(makeFile('/tmp/event-test.jsonl'));
    expect(events).toHaveLength(1);
  });
});
