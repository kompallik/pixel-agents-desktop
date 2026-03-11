import type { SessionStatus, StatusAssessment, SessionViewState } from './sessionState.js';
import { AGENT_IDLE_TIMEOUT_MS } from '../constants.js';

export interface StatusInput {
  timeSinceLastLine: number;
  timeSinceLastToolCompletion: number;
  recentToolTypes: string[];
  recentFailureCount: number;
  hasActiveTools: boolean;
  activeToolNames: string[];
  permissionSignalSeen: boolean;
  waitingSignalSeen: boolean;
  childSessionActive: boolean;
  fileWriteFreshness: number;
  sourceState: 'online' | 'offline' | 'stale';
  eventCount: number;
}

interface ScoredState {
  state: SessionStatus;
  confidence: number;
  reasons: string[];
}

const EDITING_TOOLS = ['Write', 'Edit', 'NotebookEdit', 'MultiEdit'];
const READING_TOOLS = ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'LS'];

export function assessStatus(input: StatusInput): StatusAssessment {
  const candidates: ScoredState[] = [];

  // dormant: no activity beyond idle timeout
  if (input.timeSinceLastLine > AGENT_IDLE_TIMEOUT_MS) {
    candidates.push({ state: 'dormant', confidence: 0.95, reasons: ['No activity for 5+ minutes'] });
  }

  // editing: Write/Edit/NotebookEdit tools active
  const editingTool = input.activeToolNames.find(t => EDITING_TOOLS.includes(t));
  if (editingTool) {
    candidates.push({ state: 'editing', confidence: 0.95, reasons: [`${editingTool} tool active`] });
  }

  // executing: Bash active
  if (input.activeToolNames.includes('Bash')) {
    candidates.push({ state: 'executing', confidence: 0.9, reasons: ['Bash tool active'] });
  }

  // reading: Read/Grep/Glob/WebFetch active
  const readingTool = input.activeToolNames.find(t => READING_TOOLS.includes(t));
  if (readingTool) {
    candidates.push({ state: 'reading', confidence: 0.9, reasons: [`${readingTool} tool active`] });
  }

  // waiting_permission
  if (input.permissionSignalSeen && input.timeSinceLastLine > 7_000) {
    candidates.push({ state: 'waiting_permission', confidence: 0.85, reasons: ['Permission requested, no response yet'] });
  }

  // waiting_input
  if (input.waitingSignalSeen && !input.hasActiveTools) {
    candidates.push({ state: 'waiting_input', confidence: 0.8, reasons: ['Agent waiting for user input'] });
  }

  // stalled: long silence but source is online (lower priority than dormant)
  if (input.timeSinceLastLine > 300_000 && input.sourceState === 'online') {
    candidates.push({ state: 'stalled', confidence: 0.75, reasons: ['No transcript updates for 5+ minutes but file is accessible'] });
  }

  // errored: failure burst
  if (input.recentFailureCount >= 3) {
    candidates.push({ state: 'errored', confidence: 0.7, reasons: [`${input.recentFailureCount} tool failures in last 60s`] });
  }

  // idle: quiet but recent
  if (!input.hasActiveTools && input.timeSinceLastLine > 5_000 && input.timeSinceLastLine < 300_000) {
    candidates.push({ state: 'idle', confidence: 0.7, reasons: ['No active tools, recent activity'] });
  }

  // starting: very early in session
  if (input.eventCount < 3 && input.timeSinceLastLine < 10_000) {
    candidates.push({ state: 'starting', confidence: 0.6, reasons: ['Session just started'] });
  }

  if (candidates.length === 0) {
    return { state: 'idle', confidence: 0.5, reasons: ['No matching signals'] };
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  return { state: candidates[0].state, confidence: candidates[0].confidence, reasons: candidates[0].reasons };
}

export function buildStatusInput(
  session: SessionViewState,
  now: number,
  fileWriteTime?: number,
  recentFailures?: number,
): StatusInput {
  const lastEventMs = session.lastEventAt ? new Date(session.lastEventAt).getTime() : 0;
  const timeSinceLastLine = lastEventMs > 0 ? now - lastEventMs : Infinity;

  const lastToolCompletion = session.recentTools.find(t => t.completedAt);
  const lastToolCompletionMs = lastToolCompletion?.completedAt
    ? new Date(lastToolCompletion.completedAt).getTime()
    : 0;

  return {
    timeSinceLastLine,
    timeSinceLastToolCompletion: lastToolCompletionMs > 0 ? now - lastToolCompletionMs : Infinity,
    recentToolTypes: session.recentTools.slice(0, 5).map(t => t.toolName),
    recentFailureCount: recentFailures ?? 0,
    hasActiveTools: session.activeTools.length > 0,
    activeToolNames: session.activeTools.map(t => t.toolName),
    permissionSignalSeen: session.status.state === 'waiting_permission',
    waitingSignalSeen: session.status.state === 'waiting_input',
    childSessionActive: session.childSessions.length > 0,
    fileWriteFreshness: fileWriteTime ? now - fileWriteTime : Infinity,
    sourceState: 'online',
    eventCount: session.eventCount,
  };
}
