# Pixel Agents Desktop — Agent-Team Implementation Plan

**Date:** 2026-03-10
**Status:** Ready for execution
**Execution model:** Parallel agent teams working on isolated branches, merged sequentially

---

## Current State Assessment

### What's Done

The desktop app is a **working standalone Electron visualizer**:

- **Project scaffolding** — Electron 35 + React 19 + Vite 7 + Canvas 2D, builds and packages
- **IPC bridge** — `preload.ts` exposes `window.electronAPI` with `send/on/once`; renderer uses `electronApi.ts` everywhere (no VS Code refs remain)
- **Agent discovery** — `agentDiscovery.ts` scans `~/.claude/projects/*.jsonl` and `~/.codex/sessions/**/*.jsonl` on 2s polling, registers active sessions, marks dormant after 5min idle
- **File watching** — `fileWatcher.ts` uses `fs.watch()` + polling fallback, incremental line reads with buffer
- **Transcript parsing** — `transcriptParser.ts` handles both Claude Code and Codex JSONL formats, emits tool start/done/clear/permission/waiting/subagent events via IPC
- **Full rendering engine** — Character FSM (idle/walk/type), pathfinding, Matrix spawn/despawn, floor/wall/furniture colorization, zoom/pan, seat assignment
- **Layout editor** — Undo/redo, furniture placement, import/export, persistence to `~/.pixel-agents/layout.json`
- **System tray** — Show/hide, always-on-top toggle, quit
- **Auto-updater** — Notification-only on macOS, auto-install on Windows/Linux
- **Settings persistence** — `~/.pixel-agents/settings.json`

### What's Not Done (from enhancement plan)

None of the 11 enhancement phases have been started:

| Phase | Description | Status |
|-------|-------------|--------|
| 0 | Baseline capture & instrumentation | Not started |
| 1 | Session source abstraction | Not started |
| 2 | Ingestion pipeline & canonical event model | Not started |
| 3 | Status engine overhaul (confidence-based) | Not started |
| 4 | Dashboard shell (sidebar + inspector) | Not started |
| 5 | Alerts and health monitoring | Not started |
| 6 | Historical replay and timeline | Not started |
| 7 | Project/repo/worktree mapping | Not started |
| 8 | Remote session workflows | Not started |
| 9 | Persistence and settings expansion | Not started |
| 10 | Test strategy and fixtures | Not started |

---

## Architecture Target

Transform the data flow from:

```
transcript files -> parser -> IPC -> animation state -> pixel office
```

To:

```
session sources -> ingestion -> canonical events -> state reducer -> derived views
                                                      |-> office visualization
                                                      |-> dashboard + inspector
                                                      |-> alerts / health
                                                      |-> replay / history
```

### Target Directory Structure

```
src/
  app/                          # Electron shell (refactored from current main.ts)
    mainWindow.ts
    ipc.ts
    tray.ts
    autoUpdater.ts
    commands.ts
  discovery/                    # Session source abstraction (new)
    sessionRegistry.ts
    sessionSourceManager.ts
    sessionSources/
      autoScanClaudeSource.ts
      autoScanCodexSource.ts
      manualPathSource.ts
      watchedDirectorySource.ts
  ingest/                       # Ingestion pipeline (refactored from current)
    fileTailer.ts
    replayReader.ts
    transcriptParser.ts
    lineBuffer.ts
    timerManager.ts
  domain/                       # Domain model (new)
    events.ts
    sessionState.ts
    reducer.ts
    selectors.ts
    statusEngine.ts
    healthEngine.ts
    alertEngine.ts
    projectMapper.ts
  persistence/                  # Storage (refactored from current)
    settingsStore.ts
    layoutStore.ts
    sessionSourceStore.ts
    historyStore.ts
  types.ts
  constants.ts

renderer/src/
  views/
    office/                     # Existing office view (moved, not rewritten)
    dashboard/                  # New dashboard shell
    inspector/                  # New session inspector
  components/
    SessionList.tsx             # New sidebar
    AlertBadge.tsx              # New
    HealthIndicator.tsx         # New
    StatusChip.tsx              # New
    ReplayControls.tsx          # New
    FilterBar.tsx               # New
    ... (existing components preserved)
  stores/
    sessionStore.ts             # Zustand store bridging domain state to renderer
    alertStore.ts
    replayStore.ts
  hooks/
    useExtensionMessages.ts     # Adapted to consume domain events
    useSessions.ts              # New
    useAlerts.ts                # New
    ... (existing hooks preserved)
  office/                       # Existing engine (UNTOUCHED)
    engine/
    editor/
    layout/
    sprites/
```

---

## Work Packages

Each work package (WP) is sized for one agent. Packages within the same phase can run in parallel on separate branches. Packages across phases have explicit dependencies.

---

### PHASE 0 — Baseline & Instrumentation

**Goal:** Capture current behavior, add diagnostics, establish branch strategy.

#### WP-0A: Baseline Documentation (Agent: research-analyst)
**Branch:** `feat/baseline-docs`
**Estimated files:** 2 new

1. Create `docs/BASELINE.md`:
   - Document current startup sequence (main.ts flow)
   - Document discovery rules (Claude at `~/.claude/projects/*.jsonl`, Codex at `~/.codex/sessions/**/*.jsonl`)
   - Document IPC message protocol (all channels, direction, payload shapes)
   - Document known limitations: no manual attach, no replay, no dashboard, heuristic status
   - Document dormancy rules (5min idle timeout)
2. Create `docs/IPC-PROTOCOL.md`:
   - Catalog every IPC channel with TypeScript payload types
   - Direction (main→renderer or renderer→main)
   - When each message is sent

**Acceptance:** Docs are accurate against current source code.

#### WP-0B: Debug Diagnostics Panel (Agent: frontend-developer)
**Branch:** `feat/debug-diagnostics`
**Estimated files:** 3 modified, 1 new

1. Enhance existing `renderer/src/components/DebugView.tsx`:
   - Show active session count, source paths, last event timestamp per session
   - Show IPC message log (last 50 messages with timestamps)
   - Add "Dump State" button that writes current OfficeState + session info to clipboard
2. Add IPC channel `diagnosticsDump` (main→renderer) that sends:
   - Discovery state: known files, agent map, scan interval
   - File watcher state: active watchers, file offsets, buffer sizes
   - Memory usage
3. Wire into `src/main.ts`: handle `requestDiagnostics` from renderer, respond with dump

**Acceptance:** Debug panel shows live session info. State dump works.

**Dependencies:** None (can start immediately)

---

### PHASE 1 — Session Source Abstraction

**Goal:** Replace hard-coded discovery with a pluggable source system.

**Dependencies:** Phase 0 complete (baseline docs inform this work)

#### WP-1A: SessionSource Interface & Registry (Agent: backend-developer)
**Branch:** `feat/session-sources-core`
**Estimated files:** 5 new, 2 modified

1. Create `src/discovery/sessionSource.ts`:
```ts
export type SessionSourceKind =
  | 'auto_claude' | 'auto_codex'
  | 'manual_file' | 'watched_directory';

export type SessionImportMode = 'tail' | 'replay' | 'snapshot';

export interface SessionSourceConfig {
  id: string;
  kind: SessionSourceKind;
  label: string;
  enabled: boolean;
  importMode: SessionImportMode;
  path?: string;
  directory?: string;
  glob?: string;
}

export interface SessionSource {
  readonly config: SessionSourceConfig;
  start(): void;
  stop(): void;
  onSessionDiscovered: (file: DiscoveredFile) => void;
  onSessionLost: (filePath: string) => void;
}

export interface DiscoveredFile {
  filePath: string;
  sourceId: string;
  sourceKind: SessionSourceKind;
  importMode: SessionImportMode;
  agentType: 'claude' | 'codex';
}
```

2. Create `src/discovery/sessionRegistry.ts`:
   - Maintains `Map<string, SessionRecord>` keyed by internal sessionId
   - Deduplicates by normalized file path
   - Assigns stable session IDs (UUID v4)
   - Emits events: `session-registered`, `session-removed`
   - Provides `getSession(id)`, `getAllSessions()`, `getActiveSessions()`

3. Create `src/discovery/sessionSourceManager.ts`:
   - Manages multiple `SessionSource` instances
   - Loads source configs from persistence
   - Provides `addSource()`, `removeSource()`, `enableSource()`, `disableSource()`
   - Starts/stops sources on config changes

4. Create `src/persistence/sessionSourceStore.ts`:
   - Read/write `~/.pixel-agents/sources.json`
   - Auto-sources (claude, codex) stored as enabled-by-default entries
   - Manual sources persisted with full config

5. Refactor `src/agentDiscovery.ts` → `src/discovery/sessionSources/autoScanClaudeSource.ts`:
   - Extract Claude-specific scanning into `SessionSource` implementation
   - Keep existing scan logic, just conform to interface
   - Remove Codex scanning from this file

6. Create `src/discovery/sessionSources/autoScanCodexSource.ts`:
   - Extract Codex-specific scanning (recursive date-based `~/.codex/sessions/YYYY/MM/DD/*.jsonl`)

7. Modify `src/main.ts`:
   - Replace direct `AgentDiscovery` usage with `SessionSourceManager` + `SessionRegistry`
   - Preserve all existing IPC behavior (agentCreated, agentClosed, etc.)
   - Bridge: `session-registered` → start file watching → send `agentCreated`

**Acceptance:**
- Existing auto-discovery behavior is preserved
- Source configs persist in `~/.pixel-agents/sources.json`
- `agentDiscovery.ts` can be deleted after migration

#### WP-1B: Manual File & Directory Sources (Agent: backend-developer)
**Branch:** `feat/session-sources-manual`
**Depends on:** WP-1A merged

1. Create `src/discovery/sessionSources/manualPathSource.ts`:
   - Validates file exists and is readable
   - Detects agent type from content (Claude vs Codex JSONL format)
   - Supports `tail` (start from end), `replay` (start from beginning), `snapshot` (read all, don't watch)
   - Emits `onSessionDiscovered` immediately on start

2. Create `src/discovery/sessionSources/watchedDirectorySource.ts`:
   - Watches a directory for new `.jsonl` files
   - Uses `fs.watch` with polling fallback
   - Applies same activity filter as auto-scan sources

3. Add IPC handlers in main process:
   - `addManualFile` — opens file dialog, user picks `.jsonl`, chooses import mode → creates manual source
   - `addWatchedDirectory` — opens folder dialog → creates watched directory source
   - `removeSource` — removes a configured source
   - `getSourceConfigs` — returns all configured sources for settings UI

4. Add path validation:
   - Check file is readable
   - Check it contains valid JSONL (first line parses)
   - Return friendly error messages

**Acceptance:**
- User can attach arbitrary JSONL file outside `~/.claude/projects`
- User can add a watched directory
- Sources persist across restart
- Duplicate paths are rejected with clear message
- Import mode selection works (tail/replay/snapshot)

#### WP-1C: Source Management UI (Agent: frontend-developer)
**Branch:** `feat/session-sources-ui`
**Depends on:** WP-1B merged

1. Add to `renderer/src/components/SettingsModal.tsx` (or create new `SourceManager.tsx`):
   - List all configured sources with kind, label, path, enabled status
   - "Add File" button → triggers `addManualFile` IPC → shows import mode picker (tail/replay/snapshot)
   - "Add Folder" button → triggers `addWatchedDirectory` IPC
   - Toggle enable/disable per source
   - Remove source button with confirmation
   - Error states shown inline (file not found, parse error)

2. Add IPC channels in renderer:
   - `sourceConfigsLoaded` — main sends all configs on request
   - `sourceError` — main sends error when source fails

3. Adapt `BottomToolbar.tsx`:
   - Add "Add Session" button (replaces removed "+Agent" button functionality)

**Acceptance:**
- UI shows all sources (auto + manual)
- Add/remove/toggle works
- Error states are visible and recoverable

---

### PHASE 2 — Canonical Event Model & Ingestion Pipeline

**Goal:** Introduce structured domain events; stop letting the renderer parse raw transcript data.

**Dependencies:** Phase 1 complete

#### WP-2A: Domain Event Types & Reducer (Agent: backend-developer)
**Branch:** `feat/event-model`
**Estimated files:** 5 new

1. Create `src/domain/events.ts`:
```ts
export type AgentEventType =
  | 'session_attached'
  | 'tool_started'
  | 'tool_completed'
  | 'tool_failed'
  | 'subagent_spawned'
  | 'subagent_completed'
  | 'permission_requested'
  | 'permission_cleared'
  | 'waiting_for_input'
  | 'turn_completed'
  | 'session_idle'
  | 'session_dormant'
  | 'session_error';

export interface AgentEvent {
  id: string;                    // UUID
  sessionId: string;
  timestamp: string;             // ISO 8601
  type: AgentEventType;
  toolName?: string;
  toolId?: string;
  parentToolId?: string;         // For subagent events
  status?: string;               // Formatted tool status
  rawLineNumber?: number;
  summary?: string;
  metadata?: Record<string, unknown>;
}
```

2. Create `src/domain/sessionState.ts`:
```ts
export interface SessionViewState {
  sessionId: string;
  agentId: number;               // Legacy numeric ID for renderer compat
  sourceId: string;
  agentType: 'claude' | 'codex';
  filePath: string;
  projectName?: string;
  status: StatusAssessment;
  activeTools: ToolInfo[];
  recentTools: ToolInfo[];       // Last 10
  childSessions: string[];
  eventCount: number;
  lastEventAt?: string;
  lastFileWriteAt?: string;
  healthScore: number;
  alertIds: string[];
}

export interface ToolInfo {
  toolId: string;
  toolName: string;
  status: string;
  startedAt: string;
}

export interface StatusAssessment {
  state: SessionStatus;
  confidence: number;            // 0.0 - 1.0
  reasons: string[];
}

export type SessionStatus =
  | 'starting' | 'reading' | 'editing' | 'executing'
  | 'waiting_input' | 'waiting_permission'
  | 'idle' | 'stalled' | 'completed' | 'errored' | 'dormant';
```

3. Create `src/domain/reducer.ts`:
   - Pure function: `(state: SessionViewState, event: AgentEvent) => SessionViewState`
   - Handles each event type → updates tools, status, counters
   - Tracks event history (last 100 per session for inspector)

4. Create `src/domain/selectors.ts`:
   - `getActiveSessionIds(state)` — sessions not dormant/completed
   - `getSessionsByProject(state)` — grouped
   - `getSessionsByStatus(state, status)` — filtered
   - `getSessionsNeedingAttention(state)` — stalled + errored + waiting_permission
   - `getSessionEventHistory(sessionId)` — recent events for inspector

5. Create `src/domain/sessionStore.ts` (main process in-memory store):
   - `Map<sessionId, SessionViewState>`
   - Applies events via reducer
   - Publishes state snapshots to renderer via IPC on change (debounced 100ms)
   - New IPC channel: `sessionStateUpdate` (replaces individual agentCreated/agentStatus/etc.)

**Acceptance:**
- All event types defined with TypeScript types
- Reducer is pure and testable
- Selectors cover all UI query patterns

#### WP-2B: Refactor Ingestion Pipeline (Agent: backend-developer)
**Branch:** `feat/ingestion-pipeline`
**Depends on:** WP-2A merged

1. Create `src/ingest/fileTailer.ts`:
   - Extracted from current `fileWatcher.ts`
   - Reads new lines from file offset, handles partial lines
   - Emits raw lines to parser
   - Tracks file offset and buffer state

2. Create `src/ingest/replayReader.ts`:
   - Reads entire JSONL file from beginning
   - Emits lines with original timestamps
   - Supports speed multiplier for playback: `1x, 2x, 5x, 10x, 20x`
   - Provides seek-to-line capability

3. Create `src/ingest/lineBuffer.ts`:
   - Extracted from current partial-line handling in `fileWatcher.ts`
   - Explicit partial-line buffering with configurable max buffer size

4. Refactor `src/ingest/transcriptParser.ts`:
   - Keep all existing parsing logic
   - Change output: instead of calling `bridge.send('agentToolStart', ...)`, emit `AgentEvent` objects
   - New signature: `parseLine(line: string, sessionId: string): AgentEvent[]`
   - Remove all IPC/bridge dependencies from parser (pure function)

5. Create `src/ingest/ingestionController.ts`:
   - Orchestrates: source → tailer/replay → parser → domain store
   - One controller per active session
   - Handles cleanup on session removal

6. Modify `src/main.ts`:
   - Replace direct fileWatcher/transcriptParser usage with ingestion controllers
   - Domain store publishes state to renderer via new `sessionStateUpdate` channel

**Backward compatibility bridge** (temporary, removed in Phase 4):
   - Domain store also emits legacy IPC messages (`agentCreated`, `agentToolStart`, etc.) so existing renderer continues to work unchanged during Phase 2

**Acceptance:**
- Parser is now a pure function (no IPC side effects)
- Live tail and replay both produce `AgentEvent[]`
- Existing renderer still works via compatibility bridge
- File watcher reliability is preserved (dual strategy)

#### WP-2C: Renderer State Bridge (Agent: frontend-developer)
**Branch:** `feat/renderer-state-bridge`
**Depends on:** WP-2B merged

1. Install zustand in renderer: `cd renderer && npm install zustand`

2. Create `renderer/src/stores/sessionStore.ts`:
```ts
import { create } from 'zustand';

interface SessionStoreState {
  sessions: Map<string, SessionViewState>;
  selectedSessionId: string | null;
  // actions
  updateSession: (state: SessionViewState) => void;
  removeSession: (sessionId: string) => void;
  selectSession: (sessionId: string | null) => void;
}
```

3. Create `renderer/src/hooks/useSessions.ts`:
   - Subscribes to `sessionStateUpdate` IPC channel
   - Updates zustand store
   - Provides selectors: `useActiveSessions()`, `useSelectedSession()`, `useSessionsByStatus()`

4. Modify `renderer/src/hooks/useExtensionMessages.ts`:
   - Add handler for `sessionStateUpdate` channel
   - Feed updates into both: (a) zustand store and (b) existing OfficeState character management
   - This keeps the office view working while new UI components use zustand

**Acceptance:**
- Zustand store receives domain state updates
- Office view continues working unchanged
- New hooks available for dashboard components

---

### PHASE 3 — Status Engine

**Goal:** Replace heuristic booleans with confidence-based status scoring.

**Dependencies:** WP-2A (event types) merged. Can overlap with WP-2B/2C.

#### WP-3A: Status Engine Implementation (Agent: backend-developer)
**Branch:** `feat/status-engine`
**Estimated files:** 2 new, 1 modified

1. Create `src/domain/statusEngine.ts`:
```ts
export interface StatusInput {
  timeSinceLastLine: number;        // ms
  timeSinceLastToolCompletion: number;
  recentToolTypes: string[];        // last 5
  recentFailureCount: number;       // failures in last 60s
  hasActiveTools: boolean;
  activeToolNames: string[];
  permissionSignalSeen: boolean;
  waitingSignalSeen: boolean;
  childSessionActive: boolean;
  fileWriteFreshness: number;       // ms since last file mtime change
  sourceState: 'online' | 'offline' | 'stale';
}

export function assessStatus(input: StatusInput): StatusAssessment {
  // Score each possible state
  // Return highest-confidence state with reasons
}
```

   Scoring rules:
   - `editing`: activeTools include Write/Edit/NotebookEdit → confidence 0.95, reason "Write tool active"
   - `executing`: activeTools include Bash → confidence 0.9, reason "Bash tool active"
   - `reading`: activeTools include Read/Grep/Glob/WebFetch → confidence 0.9
   - `waiting_permission`: permissionSignalSeen && timeSinceLastLine > 7000 → confidence 0.85
   - `waiting_input`: waitingSignalSeen && !hasActiveTools → confidence 0.8
   - `idle`: !hasActiveTools && timeSinceLastLine > 5000 && timeSinceLastLine < 300000 → confidence 0.7
   - `stalled`: timeSinceLastLine > 300000 (5min) && sourceState === 'online' → confidence 0.75
   - `dormant`: timeSinceLastLine > AGENT_IDLE_TIMEOUT_MS → confidence 0.95
   - `errored`: recentFailureCount >= 3 → confidence 0.7, reason "3+ failures in last 60s"
   - `starting`: eventCount < 3 && timeSinceLastLine < 10000 → confidence 0.6

2. Create `src/domain/statusEngine.test.ts` (if test infra exists) or `fixtures/status-scenarios.json`:
   - Test vectors for each status state
   - Edge cases: rapid tool transitions, permission then activity, stale then resume

3. Integrate into reducer (`src/domain/reducer.ts`):
   - After processing each event, re-assess status
   - Store `StatusAssessment` in `SessionViewState`

**Acceptance:**
- Every status assessment includes state + confidence (0-1) + reasons[]
- Status transitions are logged
- No hard-coded boolean flags for status in the renderer

---

### PHASE 4 — Dashboard Shell

**Goal:** Wrap the office view in a session list + inspector layout.

**Dependencies:** Phase 2 (renderer state bridge) + Phase 3 (status engine) complete

#### WP-4A: Dashboard Layout Shell (Agent: frontend-developer)
**Branch:** `feat/dashboard-shell`
**Estimated files:** 8 new, 3 modified

1. Create `renderer/src/views/DashboardLayout.tsx`:
   - Three-panel layout: left sidebar (280px) | center (flex) | right inspector (320px, collapsible)
   - Sidebar and inspector are toggleable
   - Center pane contains the existing office canvas
   - Use CSS Grid or flexbox — no new UI library

2. Create `renderer/src/components/SessionList.tsx`:
   - List of active sessions from `useActiveSessions()`
   - Each row shows: agent icon (colored dot matching palette), project name or path, status chip, health indicator
   - Click selects session → highlights in office + opens inspector
   - Sort options: by status priority (needs-attention first), by name, by last activity
   - Filter chips: Active, Waiting, Stalled, Errored, Dormant

3. Create `renderer/src/components/StatusChip.tsx`:
   - Pill-shaped badge showing session status
   - Color-coded: green (active), yellow (waiting), orange (stalled), red (errored), gray (dormant/idle)
   - Shows confidence as opacity or border style when < 0.7

4. Create `renderer/src/components/HealthIndicator.tsx`:
   - Small bar or dot showing health score (0-100)
   - Green > 80, yellow 50-80, red < 50

5. Create `renderer/src/views/InspectorPanel.tsx`:
   - Session metadata: path, source, agent type, discovered time
   - Current status + confidence + reasons (expandable)
   - Active tools list with durations
   - Recent tools (last 10) with timestamps
   - Recent events (last 20) as compact log
   - Project/worktree info (when available)
   - Source info (which source discovered this)
   - "Open Transcript" button (opens file in system editor)

6. Create `renderer/src/components/FilterBar.tsx`:
   - Top bar with filter chips, search input, sort dropdown
   - Aggregate counts: "5 active, 2 waiting, 1 stalled"

7. Create `renderer/src/components/TopMetricsBar.tsx`:
   - Horizontal bar above office: active | waiting | stalled | errored | dormant counts
   - Each is clickable to filter

8. Modify `renderer/src/App.tsx`:
   - Wrap existing office + toolbar in `DashboardLayout`
   - Office canvas remains the center pane
   - Add keyboard shortcut: `Cmd+1` office focus, `Cmd+2` toggle sidebar, `Cmd+3` toggle inspector

9. Modify `renderer/src/office/components/OfficeCanvas.tsx`:
   - When a session is selected in sidebar, highlight the corresponding character (pulse or glow)
   - When a character is clicked, select the corresponding session in sidebar + open inspector

10. Modify `renderer/src/hooks/useExtensionMessages.ts`:
    - Sync selection state between office characters and session store

**Acceptance:**
- User can see all sessions in sidebar with status, sort, and filter
- Selecting in sidebar highlights character in office and vice versa
- Inspector shows session details
- "Which agents need attention?" answerable in < 5 seconds
- Office view is preserved and central

#### WP-4B: Dashboard Styling (Agent: ui-designer)
**Branch:** `feat/dashboard-styling`
**Depends on:** WP-4A merged

1. Design and implement CSS for the dashboard:
   - Dark theme consistent with pixel art aesthetic
   - Monospace/pixel-style fonts for status text
   - Smooth transitions for panel show/hide
   - Responsive: sidebar collapses at narrow widths
   - Scrollable session list with sticky header
   - Inspector panel with collapsible sections

2. Add CSS variables for theming:
   - `--panel-bg`, `--panel-border`, `--text-primary`, `--text-secondary`
   - `--status-active`, `--status-waiting`, `--status-stalled`, `--status-errored`, `--status-dormant`

**Acceptance:**
- Dashboard looks polished and consistent with pixel art identity
- All panels are usable at window sizes from 800x600 to 2560x1440

---

### PHASE 5 — Alerts & Health

**Dependencies:** Phase 3 (status engine) + Phase 4 (dashboard shell, for UI)

#### WP-5A: Alert Engine (Agent: backend-developer)
**Branch:** `feat/alert-engine`
**Estimated files:** 3 new, 2 modified

1. Create `src/domain/alertEngine.ts`:
```ts
export type AlertRule =
  | 'stale_session'           // No updates, not yet dormant
  | 'failure_burst'           // 3+ failed tools in 60s
  | 'permission_loop'         // Repeated permission without progress
  | 'unreadable_file'         // Source configured but inaccessible
  | 'parser_error'            // Parse error count above threshold
  | 'duplicate_worktree'      // Two sessions targeting same worktree
  | 'child_active_parent_silent'; // Subagent working, parent idle

export interface Alert {
  id: string;
  sessionId: string;
  rule: AlertRule;
  severity: 'info' | 'warning' | 'error';
  message: string;
  details: string;
  createdAt: string;
  acknowledgedAt?: string;
}

export class AlertEngine {
  evaluate(sessions: Map<string, SessionViewState>): Alert[];
  acknowledge(alertId: string): void;
  getActiveAlerts(): Alert[];
  getAlertsBySession(sessionId: string): Alert[];
}
```

2. Create `src/domain/healthEngine.ts`:
   - Computes 0-100 health score per session from:
     - Freshness of transcript updates (0-25 points)
     - Recent error rate (0-25 points)
     - Tool completion ratio (0-25 points)
     - Alert burden (0-25 points)
   - Exposes `computeHealth(session: SessionViewState, alerts: Alert[]): number`

3. Integrate alert engine into main process:
   - Run alert evaluation on every domain state change (debounced 500ms)
   - Send `alertsUpdate` IPC to renderer with active alerts
   - Send `healthUpdate` IPC with per-session health scores

4. Add IPC handlers:
   - `acknowledgeAlert` (renderer→main)
   - `alertsUpdate` (main→renderer)

**Acceptance:**
- Alerts fire for each defined rule
- Health score updates reactively
- Alerts have clear rule attribution

#### WP-5B: Alert & Health UI (Agent: frontend-developer)
**Branch:** `feat/alert-ui`
**Depends on:** WP-5A + WP-4A merged

1. Create `renderer/src/stores/alertStore.ts`:
   - Zustand store for alerts
   - Subscribe to `alertsUpdate` IPC

2. Create `renderer/src/components/AlertBadge.tsx`:
   - Red/yellow dot with count, appears on session list items

3. Create `renderer/src/components/AlertPanel.tsx`:
   - Shown in inspector when session has alerts
   - Each alert: severity icon, rule name, message, timestamp, acknowledge button

4. Add alert badges to:
   - `SessionList.tsx` — per-session alert count
   - `TopMetricsBar.tsx` — total alert count
   - Office view — small icon over character sprite (reuse existing bubble system)

5. Add health score to `SessionList.tsx` and `InspectorPanel.tsx`

6. Add sort-by-health option to session list

**Acceptance:**
- Broken sessions are visually louder than healthy ones
- User can sort/filter by health or alert severity
- Acknowledge dismisses alerts

---

### PHASE 6 — Replay & Timeline

**Dependencies:** Phase 2 (ingestion pipeline with replayReader)

#### WP-6A: Replay Controller (Agent: backend-developer)
**Branch:** `feat/replay`
**Estimated files:** 3 new, 2 modified

1. Create `src/ingest/replayController.ts`:
   - Reads entire JSONL → produces `AgentEvent[]` with original timestamps
   - Playback state: `playing | paused | seeking | stopped`
   - Speed control: `1x, 2x, 5x, 10x, 20x`
   - Seek to timestamp or event index
   - Jump to next error / next tool start / next permission
   - Deterministic state reconstruction: given events[0..N], produce exact SessionViewState

2. Create `src/domain/replayStore.ts` (main process):
   - Separate from live session store
   - Tracks replay sessions distinctly (flagged `runMode: 'replay'`)
   - Prevents replay sessions from appearing in live monitoring alerts

3. Add IPC channels:
   - `startReplay` (renderer→main): path + speed
   - `replayControl` (renderer→main): play/pause/seek/speed/jumpTo
   - `replayState` (main→renderer): current position, total events, current timestamp, playback state
   - `replayEvent` (main→renderer): emitted events at playback speed

**Acceptance:**
- Replay reconstructs same final state as live tail for same file
- Play/pause/seek work
- Speed controls work
- Replay sessions clearly marked as "replay" in UI

#### WP-6B: Replay Timeline UI (Agent: frontend-developer)
**Branch:** `feat/replay-ui`
**Depends on:** WP-6A + WP-4A merged

1. Create `renderer/src/components/ReplayControls.tsx`:
   - Play/pause button
   - Timeline scrubber (range input or custom canvas)
   - Speed dropdown (1x/2x/5x/10x/20x)
   - Current timestamp display
   - Event markers on timeline: errors (red dots), tool starts (blue), permissions (yellow)
   - Jump buttons: prev error, next error, prev tool, next tool

2. Create `renderer/src/stores/replayStore.ts`:
   - Zustand store for replay state
   - Subscribe to `replayState` and `replayEvent` IPC channels

3. Integrate with office view:
   - Replay sessions get their own characters in the office
   - Replay badge shown on character (e.g., small "R" or tape icon)

4. Add "Import for Replay" option in source management UI:
   - Distinct from "tail" import
   - Shows replay controls when replay session is selected

**Acceptance:**
- Replay does not pretend session is live (clear visual distinction)
- Timeline scrubber shows event density
- Jump-to-error works

---

### PHASE 7 — Project & Worktree Mapping

**Dependencies:** Phase 2 (domain model)

#### WP-7A: Project Mapper (Agent: backend-developer)
**Branch:** `feat/project-mapping`
**Estimated files:** 2 new, 2 modified

1. Create `src/domain/projectMapper.ts`:
   - Infer project name from JSONL path:
     - `~/.claude/projects/<hash>/` → look for adjacent metadata or infer from hash
     - Parse JSONL content for project path references
   - Detect git repo root via `git rev-parse --show-toplevel` (async, cached)
   - Detect current branch via `git branch --show-current`
   - Detect worktree via `git worktree list`
   - Support optional sidecar metadata file (`<session>.meta.json`):
     ```json
     {
       "label": "API refactor agent",
       "project": "claims-platform",
       "worktree": "wt/refactor-auth",
       "branch": "feature/refactor-auth",
       "host": "gpu-box-2"
     }
     ```
   - Allow manual label override via settings

2. Create collision detection:
   - Alert when two active sessions target the same worktree
   - Alert when two active sessions target the same project directory

3. Integrate with domain store:
   - Enrich `SessionViewState` with `projectName`, `branch`, `worktree`
   - Add `getSessionsByProject()` selector

4. Add grouping to session list:
   - Group by project or worktree in sidebar
   - Show project name in inspector

**Acceptance:**
- Project names are inferred where possible
- Worktree collisions trigger alerts
- Sidecar metadata is picked up automatically
- Session list can group by project

---

### PHASE 8 — Test Infrastructure

**Dependencies:** Phase 2 (event model) + Phase 3 (status engine) + Phase 5 (alert engine)

#### WP-8A: Test Fixtures & Unit Tests (Agent: backend-developer)
**Branch:** `feat/test-infra`
**Estimated files:** 15+ new

1. Set up test runner:
   - Add vitest to main process: `npm install -D vitest`
   - Configure in `vitest.config.ts`

2. Create `fixtures/transcripts/`:
   - `normal-edit-session.jsonl` — Write/Edit tools, successful
   - `read-heavy-session.jsonl` — Read/Grep/Glob dominant
   - `waiting-for-input.jsonl` — Turn completes, agent waits
   - `permission-needed.jsonl` — Tool needs permission
   - `subagent-spawn.jsonl` — Task tool creates child
   - `bash-failure-burst.jsonl` — 5 consecutive Bash failures
   - `stalled-session.jsonl` — Activity stops mid-task
   - `malformed-line.jsonl` — Invalid JSON mixed in
   - `codex-session.jsonl` — Codex format events
   - `duplicate-worktree.jsonl` — Same project path

3. Unit tests for:
   - `src/ingest/transcriptParser.test.ts` — each fixture produces expected events
   - `src/domain/reducer.test.ts` — event sequences produce expected state
   - `src/domain/statusEngine.test.ts` — scoring scenarios
   - `src/domain/alertEngine.test.ts` — rule triggering
   - `src/domain/healthEngine.test.ts` — score computation
   - `src/discovery/sessionRegistry.test.ts` — dedup, identity
   - `src/ingest/lineBuffer.test.ts` — partial line handling

4. Golden-state tests:
   - For each fixture, assert exact final `SessionViewState` from replay
   - Verify live-tail and replay produce identical final state

**Acceptance:**
- `npm test` runs and passes
- Each new bug class gets a transcript fixture
- Status engine regressions caught by tests

---

## Dependency Graph

```
Phase 0 ─── WP-0A (docs)
         └── WP-0B (debug panel)

Phase 1 ─── WP-1A (source interface) ──> WP-1B (manual sources) ──> WP-1C (source UI)

Phase 2 ─── WP-2A (event types) ──> WP-2B (ingestion refactor) ──> WP-2C (renderer bridge)
                                 └──> WP-3A (status engine) [can overlap with 2B]

Phase 4 ─── WP-4A (dashboard shell) ──> WP-4B (styling)
             depends on: WP-2C + WP-3A

Phase 5 ─── WP-5A (alert engine) ──> WP-5B (alert UI)
             depends on: WP-3A        depends on: WP-4A + WP-5A

Phase 6 ─── WP-6A (replay controller) ──> WP-6B (replay UI)
             depends on: WP-2B             depends on: WP-4A + WP-6A

Phase 7 ─── WP-7A (project mapper)
             depends on: WP-2A

Phase 8 ─── WP-8A (tests)
             depends on: WP-2A + WP-3A + WP-5A
```

## Parallelization Strategy

### Wave 1 (start immediately)
| Agent | Work Package | Branch |
|-------|-------------|--------|
| research-analyst | WP-0A: Baseline docs | `feat/baseline-docs` |
| frontend-developer | WP-0B: Debug panel | `feat/debug-diagnostics` |

### Wave 2 (after Wave 1)
| Agent | Work Package | Branch |
|-------|-------------|--------|
| backend-developer-1 | WP-1A: Source interface + registry | `feat/session-sources-core` |
| backend-developer-2 | WP-2A: Domain event types + reducer | `feat/event-model` |

### Wave 3 (after WP-1A and WP-2A)
| Agent | Work Package | Branch |
|-------|-------------|--------|
| backend-developer-1 | WP-1B: Manual sources | `feat/session-sources-manual` |
| backend-developer-2 | WP-2B: Ingestion pipeline refactor | `feat/ingestion-pipeline` |
| backend-developer-3 | WP-3A: Status engine | `feat/status-engine` |
| backend-developer-4 | WP-7A: Project mapper | `feat/project-mapping` |

### Wave 4 (after WP-1B, WP-2B, WP-3A)
| Agent | Work Package | Branch |
|-------|-------------|--------|
| frontend-developer-1 | WP-1C: Source management UI | `feat/session-sources-ui` |
| frontend-developer-2 | WP-2C: Renderer state bridge | `feat/renderer-state-bridge` |
| backend-developer-1 | WP-6A: Replay controller | `feat/replay` |
| backend-developer-2 | WP-5A: Alert engine | `feat/alert-engine` |

### Wave 5 (after WP-2C, WP-3A, WP-4A prerequisites)
| Agent | Work Package | Branch |
|-------|-------------|--------|
| frontend-developer-1 | WP-4A: Dashboard shell | `feat/dashboard-shell` |
| backend-developer-1 | WP-8A: Test fixtures + unit tests | `feat/test-infra` |

### Wave 6 (after WP-4A)
| Agent | Work Package | Branch |
|-------|-------------|--------|
| ui-designer | WP-4B: Dashboard styling | `feat/dashboard-styling` |
| frontend-developer-1 | WP-5B: Alert UI | `feat/alert-ui` |
| frontend-developer-2 | WP-6B: Replay UI | `feat/replay-ui` |

---

## Key Engineering Rules

1. **No renderer parsing of raw transcripts.** After Phase 2, the renderer only receives domain events and derived state.
2. **Status is confidence-based.** Every status includes `state`, `confidence`, `reasons[]`. No bare booleans.
3. **Path is not identity.** Use internal `sessionId` (UUID). Path is metadata.
4. **Live and replay are separate.** Different controllers, different stores, different visual treatment.
5. **Backward compatibility during migration.** Legacy IPC messages continue until Phase 4 dashboard replaces them.
6. **Office view is preserved.** It stays central. Dashboard wraps it, does not replace it.
7. **JSON persistence.** No SQLite until proven necessary. Settings, sources, and layout stay as JSON files.
8. **Small PRs.** Each work package is one reviewable PR. No mega-diffs.

---

## File Inventory

### Files to Create (by phase)
| Phase | File | Purpose |
|-------|------|---------|
| 0 | `docs/BASELINE.md` | Current behavior documentation |
| 0 | `docs/IPC-PROTOCOL.md` | IPC channel catalog |
| 1 | `src/discovery/sessionSource.ts` | Source interface + types |
| 1 | `src/discovery/sessionRegistry.ts` | Session dedup + identity |
| 1 | `src/discovery/sessionSourceManager.ts` | Multi-source orchestrator |
| 1 | `src/discovery/sessionSources/autoScanClaudeSource.ts` | Extracted from agentDiscovery |
| 1 | `src/discovery/sessionSources/autoScanCodexSource.ts` | Extracted from agentDiscovery |
| 1 | `src/discovery/sessionSources/manualPathSource.ts` | Manual file attach |
| 1 | `src/discovery/sessionSources/watchedDirectorySource.ts` | Directory watcher |
| 1 | `src/persistence/sessionSourceStore.ts` | Source config persistence |
| 2 | `src/domain/events.ts` | Canonical event types |
| 2 | `src/domain/sessionState.ts` | Derived state types |
| 2 | `src/domain/reducer.ts` | Pure state reducer |
| 2 | `src/domain/selectors.ts` | Query helpers |
| 2 | `src/domain/sessionStore.ts` | In-memory state store |
| 2 | `src/ingest/fileTailer.ts` | Live file reading |
| 2 | `src/ingest/replayReader.ts` | Historical file reading |
| 2 | `src/ingest/lineBuffer.ts` | Partial-line handling |
| 2 | `src/ingest/ingestionController.ts` | Pipeline orchestrator |
| 3 | `src/domain/statusEngine.ts` | Confidence-based status |
| 4 | `renderer/src/views/DashboardLayout.tsx` | Three-panel layout |
| 4 | `renderer/src/views/InspectorPanel.tsx` | Session inspector |
| 4 | `renderer/src/components/SessionList.tsx` | Session sidebar |
| 4 | `renderer/src/components/StatusChip.tsx` | Status badge |
| 4 | `renderer/src/components/HealthIndicator.tsx` | Health bar |
| 4 | `renderer/src/components/FilterBar.tsx` | Filter/search/sort |
| 4 | `renderer/src/components/TopMetricsBar.tsx` | Aggregate counts |
| 4 | `renderer/src/stores/sessionStore.ts` | Zustand session state |
| 4 | `renderer/src/hooks/useSessions.ts` | Session query hooks |
| 5 | `src/domain/alertEngine.ts` | Alert rules |
| 5 | `src/domain/healthEngine.ts` | Health scoring |
| 5 | `renderer/src/stores/alertStore.ts` | Alert state |
| 5 | `renderer/src/components/AlertBadge.tsx` | Alert indicator |
| 5 | `renderer/src/components/AlertPanel.tsx` | Alert details |
| 6 | `src/ingest/replayController.ts` | Playback orchestrator |
| 6 | `src/domain/replayStore.ts` | Replay state |
| 6 | `renderer/src/stores/replayStore.ts` | Renderer replay state |
| 6 | `renderer/src/components/ReplayControls.tsx` | Playback UI |
| 7 | `src/domain/projectMapper.ts` | Project/worktree inference |
| 8 | `vitest.config.ts` | Test configuration |
| 8 | `fixtures/transcripts/*.jsonl` | Test fixtures (10 files) |
| 8 | `src/**/*.test.ts` | Unit tests (7+ files) |

### Files to Modify
| Phase | File | Change |
|-------|------|--------|
| 0 | `renderer/src/components/DebugView.tsx` | Enhanced diagnostics |
| 1 | `src/main.ts` | Use SessionSourceManager instead of AgentDiscovery |
| 2 | `src/ingest/transcriptParser.ts` | Pure function output (no IPC) |
| 2 | `renderer/src/hooks/useExtensionMessages.ts` | Consume domain state |
| 4 | `renderer/src/App.tsx` | Wrap in DashboardLayout |
| 4 | `renderer/src/office/components/OfficeCanvas.tsx` | Selection highlighting |
| 4 | `renderer/package.json` | Add zustand |

### Files to Delete (after migration)
| Phase | File | Replaced By |
|-------|------|-------------|
| 1 | `src/agentDiscovery.ts` | `src/discovery/sessionSources/autoScan*.ts` |
| 2 | `src/fileWatcher.ts` | `src/ingest/fileTailer.ts` + `lineBuffer.ts` |

---

## Optional Future Features

### Built-in Terminal (Start Claude Sessions from the App)

**Status:** Not planned for initial build. Consider after Phase 4 (dashboard shell) is stable.

**What it adds:** An embedded terminal panel (like VS Code's bottom panel) where users can launch `claude` sessions directly. The app would own the full lifecycle: spawn shell, run Claude Code, and automatically link the resulting JSONL transcript to the session registry.

**Scope estimate:** ~800-1200 lines of new code, 8-9 new files, 5 modified files, 4-5 new dependencies.

#### Dependencies (npm)
- `node-pty` — native module for pseudo-terminal spawning (main process)
- `xterm` + `@xterm/addon-fit` + `@xterm/addon-webgl` — terminal emulator widget (renderer, ~150KB)
- `@electron/rebuild` — rebuilds native modules for Electron's Node version

#### New files
| File | Purpose |
|------|---------|
| `src/terminal/terminalManager.ts` | Spawns PTY processes, manages lifecycle, pipes I/O over IPC |
| `src/terminal/claudeLauncher.ts` | Wraps `claude` CLI invocation with args, env, working directory |
| `renderer/src/components/TerminalPanel.tsx` | Renders xterm.js instance, handles input/output via IPC |
| `renderer/src/components/TerminalTabs.tsx` | Multi-terminal tab management |

#### IPC channels
- `terminal:create` (renderer->main) — spawn new terminal, optionally with `claude` command
- `terminal:input` (renderer->main) — keystrokes from xterm to PTY
- `terminal:output` (main->renderer) — PTY output to xterm
- `terminal:resize` (renderer->main) — terminal dimensions changed
- `terminal:close` (renderer->main) — kill PTY process

#### Key risks
1. **Native module packaging** — `node-pty` requires per-platform compilation. This is the #1 source of Electron packaging bugs. Budget significant time for getting `npm run dist` working on all platforms. Spike this first before writing feature code.
2. **Session linkage** — When `claude` starts from the built-in terminal, its JSONL file won't exist immediately. Need a "pending session" state and a heuristic to match the terminal to the discovered JSONL (e.g., watch for a new file appearing in `~/.claude/projects/` shortly after launch).
3. **Security surface** — Full shell access means handling shell selection (zsh/bash/fish), environment inheritance, and working directory management.
4. **Scope creep** — Once a terminal exists, users expect split panes, scrollback search, themes, link detection, etc. Start with a single terminal, add features later.

#### Recommended approach
1. Spike `node-pty` packaging first — get a hello-world building via `npm run dist` before any feature code
2. Implement as 2 work packages: WP-T1 (backend: node-pty + launcher) and WP-T2 (frontend: xterm + panel UI)
3. Start with single terminal, no tabs/splits
4. Consider a lighter alternative: spawn `claude` as a detached process and capture output via pipes instead of PTY (avoids native module, loses interactive terminal)

---

## Definition of Done

The enhanced app is complete when:

- [ ] User can attach arbitrary local JSONL files (manual + auto-discovered)
- [ ] User can choose live tail, replay, or snapshot import modes
- [ ] All sessions visible in sidebar with status, health, and alerts
- [ ] Inspector shows session metadata, events, tools, and status with confidence
- [ ] Agents needing attention are identifiable within 5 seconds
- [ ] Historical sessions can be replayed with timeline controls
- [ ] Sessions can be grouped by project or worktree
- [ ] Stale sessions, failure bursts, and worktree collisions trigger alerts
- [ ] Pixel office remains central to the UX and functional
- [ ] `npm run dist` still produces working packaged app
- [ ] Test suite passes with fixture coverage for all status states
