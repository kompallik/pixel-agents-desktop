# Pixel Agents Desktop -- Baseline Documentation

> Snapshot of the codebase at commit `2a785ae` (initial working visualizer baseline).

---

## 1. Startup Sequence

```
app.whenReady()
  |-- Set macOS dock icon (darwin only)
  |-- createWindow()          -> BrowserWindow with preload.js, contextIsolation
  |-- createTray(mainWindow)  -> System tray with show/hide/always-on-top/quit
  |-- setupIPC()              -> Register all ipcMain handlers (see Section 3)
  |-- setupAutoUpdater()      -> (packaged builds only) check for updates after 5s
  |
  |   [renderer loads, calls api.send('webviewReady')]
  |
  v-- ipcMain 'webviewReady' handler fires:
        1. loadCharacterSprites()   -> send('characterSpritesLoaded', ...)
        2. loadFloorTiles()         -> send('floorTilesLoaded', ...)
        3. loadWallTiles()          -> send('wallTilesLoaded', ...)
        4. loadFurnitureAssets()    -> send('furnitureAssetsLoaded', ...)
        5. readSettings()           -> send('settingsLoaded', { soundEnabled })
        6. readLayout() / default   -> send('layoutLoaded', { layout })
        7. startDiscovery()         -> AgentDiscovery.start()
              |-- Immediate scan()
              |-- setInterval(scan, DISCOVERY_SCAN_INTERVAL_MS=2000)
```

Key points:
- Assets are sent **before** layout so sprite data is available when the renderer rebuilds from layout.
- Discovery starts **after** layout is sent so agents can be placed into seats.
- The renderer buffers `existingAgents` until `layoutLoaded` arrives, then adds them to the office.

---

## 2. Agent Discovery Rules

### Paths Scanned

| Agent Type | Base Directory | Scan Pattern |
|------------|---------------|--------------|
| Claude Code | `~/.claude/projects/` | Each immediate subdirectory is scanned for `*.jsonl` files |
| Codex | `~/.codex/sessions/` | Recursive scan through all subdirectories (date-based `YYYY/MM/DD/`) for `*.jsonl` files |

Constants (from `src/constants.ts`):
- `CLAUDE_PROJECTS_DIR` = `'.claude/projects'`
- `CODEX_SESSIONS_DIR` = `'.codex/sessions'`

### Polling & Scanning

| Constant | Value | Purpose |
|----------|-------|---------|
| `DISCOVERY_SCAN_INTERVAL_MS` | 2000 ms | How often the discovery scan runs |
| `FILE_WATCHER_POLL_INTERVAL_MS` | 2000 ms | Backup polling interval for JSONL file changes |

### Activity Detection

When a new `.jsonl` file is found:
1. `fs.statSync()` checks the file's `mtimeMs`.
2. If `Date.now() - mtimeMs > AGENT_IDLE_TIMEOUT_MS`, the file is **skipped** (too old).
3. Otherwise, a new `AgentState` is created with `fileOffset = stat.size` (only new lines are tracked).
4. `onAgentDiscovered` callback fires -> sends `agentCreated` to renderer, starts file watching.

File watching uses **dual strategy**:
- **Primary**: `fs.watch()` on the JSONL file (OS-level file system events).
- **Backup**: `setInterval` polling every `FILE_WATCHER_POLL_INTERVAL_MS` (2s).

### Dormancy Rules

| Constant | Value | Purpose |
|----------|-------|---------|
| `AGENT_IDLE_TIMEOUT_MS` | 300,000 ms (5 min) | Time since last file modification before agent is considered dormant |

On each discovery scan, every tracked agent is checked:
- If `Date.now() - stat.mtimeMs > AGENT_IDLE_TIMEOUT_MS` -> agent is removed, file watchers stopped, `agentClosed` sent.
- If the JSONL file no longer exists -> same cleanup (agent is dead).

---

## 3. IPC Message Protocol

See [IPC-PROTOCOL.md](./IPC-PROTOCOL.md) for the full catalog.

### Summary

**Renderer -> Main (ipcMain.on)**:
`webviewReady`, `saveLayout`, `setSoundEnabled`, `saveAgentSeats`, `exportLayout`, `importLayout`, `openSessionsFolder`, `installUpdate`, `openReleaseUrl`, `focusAgent`, `closeAgent`

**Main -> Renderer (webContents.send)**:
`agentCreated`, `agentClosed`, `agentToolStart`, `agentToolDone`, `agentToolsClear`, `agentStatus`, `agentToolPermission`, `agentToolPermissionClear`, `subagentToolStart`, `subagentToolDone`, `subagentClear`, `subagentToolPermission`, `characterSpritesLoaded`, `floorTilesLoaded`, `wallTilesLoaded`, `furnitureAssetsLoaded`, `settingsLoaded`, `layoutLoaded`, `updateStatus`

---

## 4. Known Limitations

1. **No manual file attachment** -- Agent discovery is automatic only. Users cannot manually point the app at a specific JSONL file or directory.

2. **No replay mode** -- The app starts reading from the end of each JSONL file (`fileOffset = stat.size`). Past transcript history is never replayed.

3. **No dashboard or inspector** -- There is no dashboard view, no agent detail inspector, and no aggregated metrics panel. The only view is the pixel-art office visualization.

4. **Heuristic boolean-based status** -- Agent status is a simple string (`'active'` | `'waiting'`), not a confidence-scored state. Permission detection uses a fixed timer (`PERMISSION_TIMER_DELAY_MS` = 7000 ms) -- if a non-exempt tool has been running for 7s without progress, it's assumed to be waiting for user permission. This is a heuristic, not a certainty.

5. **No project/worktree mapping** -- Agents are identified by their JSONL file path. There is no mapping from agent to project name, git worktree, or working directory beyond the raw `projectDir` (parent directory of the JSONL file).

6. **Stub IPC handlers** -- `focusAgent`, `closeAgent`, and `saveAgentSeats` are registered but do nothing (no terminal management in standalone mode).

7. **Text idle heuristic** -- If an assistant message contains only text (no tool_use) and no tools have been used in the current turn, a waiting timer fires after `TEXT_IDLE_DELAY_MS` (5000 ms), marking the agent as waiting. This may not accurately reflect the agent's true state.

---

## 5. File Map

### Main Process (`src/`)

| File | Purpose |
|------|---------|
| `main.ts` | Electron app entry point. Creates window, tray, sets up IPC handlers, manages discovery lifecycle. |
| `agentDiscovery.ts` | `AgentDiscovery` class. Scans Claude/Codex directories for active JSONL files, registers new agents, detects dormancy. |
| `fileWatcher.ts` | Starts/stops file watching (fs.watch + polling) for agent JSONL files. Reads new lines and dispatches to transcript parser. |
| `transcriptParser.ts` | Parses JSONL transcript lines for both Claude Code and Codex formats. Emits IPC events for tool starts/completions, status changes, subagent activity, and permission detection. |
| `timerManager.ts` | Manages waiting timers (text idle -> waiting status) and permission timers (tool stuck -> permission bubble). |
| `constants.ts` | All timing constants, display truncation limits, and discovery path constants. |
| `types.ts` | TypeScript types: `AgentState`, `AgentType`, `IpcBridge`. |
| `preload.ts` | Electron preload script. Exposes `electronAPI` with `send()`, `on()`, `once()` via `contextBridge`. |
| `assetLoader.ts` | Loads PNG assets (characters, floors, walls, furniture) from disk, converts to pixel-art sprite data (hex color arrays). |
| `tray.ts` | Creates system tray icon with show/hide, always-on-top, and quit menu items. |
| `autoUpdater.ts` | Sets up electron-updater for auto-updates. On macOS, notifies with download link only (no Squirrel.Mac install). |

### Renderer (key files)

| File | Purpose |
|------|---------|
| `renderer/src/hooks/useExtensionMessages.ts` | Central IPC message handler for the renderer. Listens to all main->renderer channels, manages React state for agents, tools, subagents, layout, and assets. |
| `renderer/src/electronApi.ts` | Thin wrapper around `window.electronAPI` exposed by preload. |
| `renderer/src/notificationSound.ts` | Plays notification sound when agent enters waiting state. |

### Configuration

| Path | Purpose |
|------|---------|
| `~/.pixel-agents/settings.json` | Persisted settings (soundEnabled, alwaysOnTop, windowBounds) |
| `~/.pixel-agents/layout.json` | Persisted office layout |
