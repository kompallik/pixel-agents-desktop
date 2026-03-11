# IPC Protocol Reference

> Complete catalog of Electron IPC channels in Pixel Agents Desktop.

---

## Renderer -> Main (`ipcMain.on`)

These messages are sent by the renderer via `window.electronAPI.send(channel, data)`.

| Channel | Payload Type | Description | When Sent |
|---------|-------------|-------------|-----------|
| `webviewReady` | `void` | Signals that the renderer is mounted and ready to receive data | On initial mount in `useExtensionMessages` useEffect |
| `saveLayout` | `{ layout: Record<string, unknown> }` | Persists the office layout to `~/.pixel-agents/layout.json` | When the user modifies the office layout |
| `setSoundEnabled` | `{ enabled: boolean }` | Updates the sound setting in `~/.pixel-agents/settings.json` | When the user toggles sound on/off |
| `saveAgentSeats` | `{ seats: Record<number, { palette: number; hueShift: number; seatId: string \| null }> }` | Stub -- seat persistence (not yet implemented) | After agents are added to the office or layout is loaded |
| `exportLayout` | `void` | Opens a save dialog and writes current layout to a user-chosen JSON file | User triggers layout export |
| `importLayout` | `void` | Opens a file dialog, reads a layout JSON, validates it, and sends `layoutLoaded` back | User triggers layout import |
| `openSessionsFolder` | `void` | Opens `~/.claude/projects` in the OS file manager | User clicks to open sessions folder |
| `installUpdate` | `void` | Calls `autoUpdater.quitAndInstall()` | User clicks "Install Update" |
| `openReleaseUrl` | `void` | Opens the GitHub releases page in the default browser | User clicks release link (macOS update flow) |
| `focusAgent` | `void` | Stub -- no-op | Not actively used (placeholder for terminal focus) |
| `closeAgent` | `void` | Stub -- no-op | Not actively used (placeholder for terminal close) |

---

## Main -> Renderer (`webContents.send`)

These messages are sent by the main process and received via `window.electronAPI.on(channel, callback)`.

### Agent Lifecycle

| Channel | Payload Type | Description | When Sent |
|---------|-------------|-------------|-----------|
| `agentCreated` | `{ id: number; agentType: 'claude' \| 'codex' }` | A new agent JSONL file was discovered and is actively being monitored | When `AgentDiscovery` finds a new JSONL file with recent activity (mtime < 5 min) |
| `agentClosed` | `{ id: number }` | An agent has gone dormant or its file was deleted | When discovery scan detects idle timeout (5 min) or missing file |
| `existingAgents` | `{ agents: number[]; agentMeta?: Record<number, { palette?: number; hueShift?: number; seatId?: string }> }` | Batch of already-known agents (handled in renderer but not sent in current main.ts -- reserved for future use) | N/A in current codebase; renderer handles it defensively |

### Agent Status

| Channel | Payload Type | Description | When Sent |
|---------|-------------|-------------|-----------|
| `agentStatus` | `{ id: number; status: 'active' \| 'waiting' }` | Agent status change | **active**: when tool_use block detected, or user message clears activity, or Codex task_started/agent_reasoning. **waiting**: on turn_duration system record, text idle timeout (5s), or Codex user_message |

### Tool Events

| Channel | Payload Type | Description | When Sent |
|---------|-------------|-------------|-----------|
| `agentToolStart` | `{ id: number; toolId: string; status: string }` | A tool invocation has started | When a `tool_use` block is parsed from an assistant message (Claude) or `function_call`/`custom_tool_call` response_item (Codex). `status` is a human-readable description (e.g. "Reading main.ts", "Running: npm test") |
| `agentToolDone` | `{ id: number; toolId: string }` | A tool invocation has completed | When a `tool_result` block is parsed from a user message (Claude) or `function_call_output`/`custom_tool_call_output` (Codex). Sent after a `TOOL_DONE_DELAY_MS` (300ms) delay |
| `agentToolsClear` | `{ id: number }` | All active tools for an agent should be cleared | On `turn_duration` system record (Claude), `task_started` (Codex), or when user message has no tool results (clear activity) |

### Permission Detection

| Channel | Payload Type | Description | When Sent |
|---------|-------------|-------------|-----------|
| `agentToolPermission` | `{ id: number }` | Heuristic: agent likely waiting for user permission | When a non-exempt tool has been active for `PERMISSION_TIMER_DELAY_MS` (7s) without new file activity. Exempt tools: `Task`, `AskUserQuestion` |
| `agentToolPermissionClear` | `{ id: number }` | Permission wait state cleared | When new JSONL lines arrive after a permission state was sent |

### Subagent Events (Claude Code `Task` tool)

| Channel | Payload Type | Description | When Sent |
|---------|-------------|-------------|-----------|
| `subagentToolStart` | `{ id: number; parentToolId: string; toolId: string; status: string }` | A tool started inside a subtask (Task tool) | When a `progress` record with `type: 'assistant'` contains `tool_use` blocks for a parent Task tool |
| `subagentToolDone` | `{ id: number; parentToolId: string; toolId: string }` | A subtask tool completed | When a `progress` record with `type: 'user'` contains `tool_result` blocks. Sent after `TOOL_DONE_DELAY_MS` (300ms) delay |
| `subagentClear` | `{ id: number; parentToolId: string }` | A subtask (Task tool) completed entirely | When the Task tool's `tool_result` is received in the parent transcript |
| `subagentToolPermission` | `{ id: number; parentToolId: string }` | Heuristic: a subtask tool likely waiting for permission | Sent alongside `agentToolPermission` when stuck non-exempt tools are detected in subagent tool maps |

### Asset Loading

| Channel | Payload Type | Description | When Sent |
|---------|-------------|-------------|-----------|
| `characterSpritesLoaded` | `{ characters: Array<{ down: string[][][]; up: string[][][]; right: string[][][] }> }` | Pre-colored character sprite data (6 characters, 3 directions, 7 frames each, 16x32px) | During `webviewReady` handler, after loading from `assets/characters/char_*.png` |
| `floorTilesLoaded` | `{ sprites: string[][][] }` | Floor tile pixel data (7 patterns, 16x16px each) | During `webviewReady` handler, after loading from `assets/floors.png` |
| `wallTilesLoaded` | `{ sprites: string[][][] }` | Wall tile pixel data (16 bitmask pieces, 16x32px each) | During `webviewReady` handler, after loading from `assets/walls.png` |
| `furnitureAssetsLoaded` | `{ catalog: FurnitureAsset[]; sprites: Record<string, string[][]> }` | Furniture catalog metadata and sprite pixel data | During `webviewReady` handler, after loading from `assets/furniture/` |

### Settings & Layout

| Channel | Payload Type | Description | When Sent |
|---------|-------------|-------------|-----------|
| `settingsLoaded` | `{ soundEnabled: boolean }` | Current sound setting | During `webviewReady` handler |
| `layoutLoaded` | `{ layout: Record<string, unknown> \| null }` | Office layout (saved or default) | During `webviewReady` handler, and after successful layout import |

### Auto-Update

| Channel | Payload Type | Description | When Sent |
|---------|-------------|-------------|-----------|
| `updateStatus` | `{ status: 'available'; version: string; releaseUrl?: string }` | Update is available | When `electron-updater` detects a new version. `releaseUrl` present on macOS only |
| `updateStatus` | `{ status: 'downloading'; percent: number }` | Download in progress | During update download (non-macOS only) |
| `updateStatus` | `{ status: 'downloaded'; version: string }` | Update downloaded and ready to install | When download completes (non-macOS only) |

---

## Constants Reference

| Constant | Value | Used By |
|----------|-------|---------|
| `DISCOVERY_SCAN_INTERVAL_MS` | 2000 ms | AgentDiscovery scan loop |
| `AGENT_IDLE_TIMEOUT_MS` | 300,000 ms (5 min) | Dormancy detection threshold |
| `FILE_WATCHER_POLL_INTERVAL_MS` | 2000 ms | Backup JSONL file polling |
| `TOOL_DONE_DELAY_MS` | 300 ms | Delay before sending agentToolDone/subagentToolDone |
| `PERMISSION_TIMER_DELAY_MS` | 7000 ms | Time before assuming permission wait |
| `TEXT_IDLE_DELAY_MS` | 5000 ms | Time before text-only assistant message triggers waiting |
| `BASH_COMMAND_DISPLAY_MAX_LENGTH` | 30 chars | Truncation for bash command display |
| `TASK_DESCRIPTION_DISPLAY_MAX_LENGTH` | 40 chars | Truncation for task description display |

---

## Preload Bridge

The preload script (`src/preload.ts`) exposes `window.electronAPI` with:

```typescript
interface ElectronAPI {
  send(channel: string, data?: unknown): void;
  on(channel: string, callback: (...args: unknown[]) => void): () => void;  // returns cleanup fn
  once(channel: string, callback: (...args: unknown[]) => void): void;
}
```

- `contextIsolation: true`, `nodeIntegration: false`
- All IPC passes through this bridge; the renderer has no direct access to Node.js or Electron internals.
