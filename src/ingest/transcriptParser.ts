import * as path from 'path';
import { randomUUID } from 'crypto';
import type { AgentEvent, AgentEventType } from '../domain/events.js';
import {
  BASH_COMMAND_DISPLAY_MAX_LENGTH,
  TASK_DESCRIPTION_DISPLAY_MAX_LENGTH,
} from '../constants.js';

const PERMISSION_EXEMPT_TOOLS = new Set(['Task', 'AskUserQuestion']);

function formatToolStatus(toolName: string, input: Record<string, unknown>): string {
  const base = (p: unknown) => typeof p === 'string' ? path.basename(p) : '';
  switch (toolName) {
    case 'Read': return `Reading ${base(input['file_path'])}`;
    case 'Edit': return `Editing ${base(input['file_path'])}`;
    case 'Write': return `Writing ${base(input['file_path'])}`;
    case 'Bash': {
      const cmd = (input['command'] as string) || '';
      return `Running: ${cmd.length > BASH_COMMAND_DISPLAY_MAX_LENGTH ? cmd.slice(0, BASH_COMMAND_DISPLAY_MAX_LENGTH) + '\u2026' : cmd}`;
    }
    case 'Glob': return 'Searching files';
    case 'Grep': return 'Searching code';
    case 'WebFetch': return 'Fetching web content';
    case 'WebSearch': return 'Searching the web';
    case 'Task': {
      const desc = typeof input['description'] === 'string' ? input['description'] : '';
      return desc ? `Subtask: ${desc.length > TASK_DESCRIPTION_DISPLAY_MAX_LENGTH ? desc.slice(0, TASK_DESCRIPTION_DISPLAY_MAX_LENGTH) + '\u2026' : desc}` : 'Running subtask';
    }
    case 'AskUserQuestion': return 'Waiting for your answer';
    case 'EnterPlanMode': return 'Planning';
    case 'NotebookEdit': return 'Editing notebook';
    default: return `Using ${toolName}`;
  }
}

function formatCodexToolStatus(toolName: string, args: string): string {
  switch (toolName) {
    case 'exec_command': {
      try {
        const parsed = JSON.parse(args) as Record<string, unknown>;
        const cmd = (parsed['cmd'] as string) || '';
        return `Running: ${cmd.length > BASH_COMMAND_DISPLAY_MAX_LENGTH ? cmd.slice(0, BASH_COMMAND_DISPLAY_MAX_LENGTH) + '\u2026' : cmd}`;
      } catch {
        return 'Running command';
      }
    }
    case 'apply_patch': {
      const match = args.match(/Update File:\s*(\S+)/);
      if (match) return `Editing ${path.basename(match[1])}`;
      const createMatch = args.match(/Create File:\s*(\S+)/);
      if (createMatch) return `Creating ${path.basename(createMatch[1])}`;
      return 'Applying patch';
    }
    default: return `Using ${toolName}`;
  }
}

function makeEvent(
  sessionId: string,
  type: AgentEventType,
  lineNumber: number,
  extra?: Partial<AgentEvent>,
): AgentEvent {
  return {
    id: randomUUID(),
    sessionId,
    timestamp: new Date().toISOString(),
    type,
    rawLineNumber: lineNumber,
    ...extra,
  };
}

export function parseLine(
  line: string,
  sessionId: string,
  lineNumber: number,
  agentType: 'claude' | 'codex' = 'claude',
): AgentEvent[] {
  try {
    const record = JSON.parse(line) as Record<string, unknown>;

    if (agentType === 'codex') {
      return parseCodexRecord(record, sessionId, lineNumber);
    }

    return parseClaudeRecord(record, sessionId, lineNumber);
  } catch {
    return [];
  }
}

function parseClaudeRecord(
  record: Record<string, unknown>,
  sessionId: string,
  lineNumber: number,
): AgentEvent[] {
  const events: AgentEvent[] = [];

  if (record['type'] === 'assistant') {
    const msg = record['message'] as Record<string, unknown> | undefined;
    const content = msg?.['content'];
    if (!Array.isArray(content)) return events;

    const blocks = content as Array<{
      type: string; id?: string; name?: string; input?: Record<string, unknown>;
    }>;

    for (const block of blocks) {
      if (block.type === 'tool_use' && block.id) {
        const toolName = block.name ?? '';
        const status = formatToolStatus(toolName, block.input ?? {});
        events.push(makeEvent(sessionId, 'tool_started', lineNumber, {
          toolId: block.id,
          toolName,
          status,
        }));

        // Subagent spawn detection
        if (toolName === 'Task') {
          events.push(makeEvent(sessionId, 'subagent_spawned', lineNumber, {
            toolId: block.id,
            toolName,
            metadata: { parentToolId: block.id },
          }));
        }

        // Permission-eligible tool detection
        if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) {
          // The permission_requested event is handled by the ingestion controller
          // via timer logic, not emitted directly from the parser
        }
      }
    }
  } else if (record['type'] === 'user') {
    const msg = record['message'] as Record<string, unknown> | undefined;
    const content = msg?.['content'];

    if (Array.isArray(content)) {
      const blocks = content as Array<{ type: string; tool_use_id?: string }>;
      for (const block of blocks) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          events.push(makeEvent(sessionId, 'tool_completed', lineNumber, {
            toolId: block.tool_use_id,
          }));
        }
      }

      // If no tool results in user message, it's user input (new turn)
      if (!blocks.some(b => b.type === 'tool_result')) {
        events.push(makeEvent(sessionId, 'waiting_for_input', lineNumber));
      }
    } else if (typeof content === 'string' && (content as string).trim()) {
      events.push(makeEvent(sessionId, 'waiting_for_input', lineNumber));
    }
  } else if (record['type'] === 'system' && record['subtype'] === 'turn_duration') {
    events.push(makeEvent(sessionId, 'turn_completed', lineNumber));
  } else if (record['type'] === 'progress') {
    const parentToolId = record['parentToolUseID'] as string | undefined;
    const data = record['data'] as Record<string, unknown> | undefined;
    if (!data || !parentToolId) return events;

    const dataType = data['type'] as string | undefined;
    if (dataType === 'bash_progress' || dataType === 'mcp_progress') {
      // Progress updates don't generate domain events directly
      return events;
    }

    // Subagent progress records
    const msg = data['message'] as Record<string, unknown> | undefined;
    if (!msg) return events;

    const msgType = msg['type'] as string;
    const innerMsg = msg['message'] as Record<string, unknown> | undefined;
    const content = innerMsg?.['content'];
    if (!Array.isArray(content)) return events;

    if (msgType === 'assistant') {
      for (const block of content as Array<{ type: string; id?: string; name?: string; input?: Record<string, unknown> }>) {
        if (block.type === 'tool_use' && block.id) {
          const toolName = block.name ?? '';
          const status = formatToolStatus(toolName, block.input ?? {});
          events.push(makeEvent(sessionId, 'tool_started', lineNumber, {
            toolId: block.id,
            toolName,
            parentToolId,
            status,
            metadata: { isSubagentTool: true },
          }));
        }
      }
    } else if (msgType === 'user') {
      for (const block of content as Array<{ type: string; tool_use_id?: string }>) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          events.push(makeEvent(sessionId, 'tool_completed', lineNumber, {
            toolId: block.tool_use_id,
            parentToolId,
            metadata: { isSubagentTool: true },
          }));
        }
      }
    }
  }

  return events;
}

function parseCodexRecord(
  record: Record<string, unknown>,
  sessionId: string,
  lineNumber: number,
): AgentEvent[] {
  const events: AgentEvent[] = [];
  const recordType = record['type'] as string;
  const payload = record['payload'] as Record<string, unknown> | undefined;
  if (!payload) return events;

  const payloadType = payload['type'] as string;

  if (recordType === 'event_msg') {
    if (payloadType === 'task_started') {
      events.push(makeEvent(sessionId, 'turn_completed', lineNumber, {
        summary: 'Codex task started (previous turn ended)',
      }));
      events.push(makeEvent(sessionId, 'session_attached', lineNumber));
    } else if (payloadType === 'agent_reasoning') {
      events.push(makeEvent(sessionId, 'session_attached', lineNumber, {
        summary: 'Agent reasoning',
      }));
    } else if (payloadType === 'user_message') {
      events.push(makeEvent(sessionId, 'waiting_for_input', lineNumber));
    }
  } else if (recordType === 'response_item') {
    if (payloadType === 'function_call' || payloadType === 'custom_tool_call') {
      const callId = (payload['call_id'] as string) || '';
      const toolName = (payload['name'] as string) || '';
      const args = (payloadType === 'function_call'
        ? payload['arguments'] as string
        : payload['input'] as string) || '';

      if (callId) {
        const status = formatCodexToolStatus(toolName, args);
        events.push(makeEvent(sessionId, 'tool_started', lineNumber, {
          toolId: callId,
          toolName,
          status,
        }));
      }
    } else if (payloadType === 'function_call_output' || payloadType === 'custom_tool_call_output') {
      const callId = payload['call_id'] as string;
      if (callId) {
        events.push(makeEvent(sessionId, 'tool_completed', lineNumber, {
          toolId: callId,
        }));
      }
    } else if (payloadType === 'message') {
      const role = payload['role'] as string;
      if (role === 'assistant') {
        // Text-only response, no specific event needed — controller handles idle detection
      }
    }
  }

  return events;
}
