import { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadCharacterSprites, loadFloorTiles, loadWallTiles, loadFurnitureAssets } from './assetLoader.js';
import { createTray } from './tray.js';
import { setupAutoUpdater, quitAndInstall, openReleaseUrl } from './autoUpdater.js';
import { SessionRegistry } from './discovery/sessionRegistry.js';
import type { SessionRecord } from './discovery/sessionRegistry.js';
import { SessionSourceManager } from './discovery/sessionSourceManager.js';
import * as sessionSourceStore from './persistence/sessionSourceStore.js';
import { validateJsonlFile, validateDirectory } from './discovery/pathValidator.js';
import { DISCOVERY_SCAN_INTERVAL_MS, PERMISSION_TIMER_DELAY_MS } from './constants.js';
import type { SessionSourceConfig } from './discovery/sessionSource.js';
import { SessionStore } from './domain/sessionStore.js';
import { createInitialSessionState } from './domain/sessionState.js';
import type { SessionViewState } from './domain/sessionState.js';
import { IngestionController } from './ingest/ingestionController.js';
import type { AgentEvent } from './domain/events.js';
import { ReplayStore } from './domain/replayStore.js';
import type { ReplayStateSnapshot } from './ingest/replayController.js';
import { detectAgentType } from './discovery/sessionSources/manualPathSource.js';
import { AlertEngine } from './domain/alertEngine.js';
import { computeHealth } from './domain/healthEngine.js';

let mainWindow: BrowserWindow | null = null;
let registry: SessionRegistry | null = null;
let sourceManager: SessionSourceManager | null = null;
let isQuitting = false;

const CONFIG_DIR = '.pixel-agents';
const SETTINGS_FILE = 'settings.json';

// Bridge between session UUIDs and numeric agent IDs (preserves existing IPC contract)
const sessionToAgentId = new Map<string, number>();
let nextAgentId = 1;

// Domain event pipeline (WP-2A/2B)
const domainStore = new SessionStore();
const ingestionControllers = new Map<string, IngestionController>();

// Replay pipeline (WP-6A) — separate from live sessions
const replayStore = new ReplayStore();

// Alert and health engine (WP-5A)
const alertEngine = new AlertEngine();
let alertEvalTimer: ReturnType<typeof setTimeout> | null = null;
const ALERT_EVAL_DEBOUNCE_MS = 500;

// Permission timer state per agent (backward compat for renderer permission detection)
const permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();
const PERMISSION_EXEMPT_TOOLS = new Set(['Task', 'AskUserQuestion']);

interface Settings {
  soundEnabled: boolean;
  alwaysOnTop: boolean;
  windowBounds?: { x: number; y: number; width: number; height: number };
}

const DEFAULT_SETTINGS: Settings = {
  soundEnabled: true,
  alwaysOnTop: false,
};

function getSettingsPath(): string {
  return path.join(os.homedir(), CONFIG_DIR, SETTINGS_FILE);
}

function readSettings(): Settings {
  try {
    const raw = fs.readFileSync(getSettingsPath(), 'utf-8');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings(settings: Settings): void {
  const dir = path.join(os.homedir(), CONFIG_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8');
}

function getAssetsRoot(): string {
  const prodPath = path.join(__dirname, '..', 'assets');
  if (fs.existsSync(prodPath)) return prodPath;

  const devPath = path.join(__dirname, '..', '..', 'renderer', 'public', 'assets');
  if (fs.existsSync(devPath)) return devPath;

  return prodPath;
}

function getLayoutPath(): string {
  return path.join(os.homedir(), CONFIG_DIR, 'layout.json');
}

function readLayout(): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(getLayoutPath(), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeLayout(layout: Record<string, unknown>): void {
  const dir = path.join(os.homedir(), CONFIG_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = getLayoutPath() + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(layout), 'utf-8');
  fs.renameSync(tmpPath, getLayoutPath());
}

function loadDefaultLayout(): Record<string, unknown> | null {
  try {
    const defaultPath = path.join(getAssetsRoot(), 'default-layout.json');
    const raw = fs.readFileSync(defaultPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function send(channel: string, data?: unknown): void {
  mainWindow?.webContents.send(channel, data ?? {});
}

function getIconPath(): string | undefined {
  const packaged = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, '..', 'build', 'icon.png');
  return fs.existsSync(packaged) ? packaged : undefined;
}

function createWindow(): BrowserWindow {
  const settings = readSettings();

  const win = new BrowserWindow({
    width: settings.windowBounds?.width ?? 900,
    height: settings.windowBounds?.height ?? 700,
    x: settings.windowBounds?.x,
    y: settings.windowBounds?.y,
    alwaysOnTop: settings.alwaysOnTop,
    icon: getIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Pixel Agents',
    backgroundColor: '#1e1e2e',
  });

  const isDev = !app.isPackaged;
  if (isDev && process.env['ELECTRON_DEV'] === '1') {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    const indexPath = path.join(__dirname, '..', 'renderer', 'index.html');
    win.loadFile(indexPath);
  }

  const saveBounds = () => {
    if (!win.isMinimized() && !win.isMaximized()) {
      const settings = readSettings();
      settings.windowBounds = win.getBounds();
      writeSettings(settings);
    }
  };
  win.on('resize', saveBounds);
  win.on('move', saveBounds);

  return win;
}

function startDiscovery(): void {
  registry = new SessionRegistry();
  sourceManager = new SessionSourceManager(registry);

  // Wire domain store state changes to renderer
  domainStore.on('state-changed', (sessions: SessionViewState[]) => {
    send('sessionStateUpdate', sessions);
    scheduleAlertEvaluation();
  });

  // When a session is registered, create ingestion controller and start watching
  registry.on('session-registered', (record: SessionRecord) => {
    const agentId = nextAgentId++;
    sessionToAgentId.set(record.sessionId, agentId);

    // 'replay' starts from beginning, 'tail'/'snapshot' start from end
    const stat = fs.statSync(record.filePath);
    const fileOffset = record.importMode === 'replay' ? 0 : stat.size;

    console.log(`[Pixel Agents] Sending agentCreated for agent ${agentId} (session ${record.sessionId})`);
    send('agentCreated', { id: agentId, agentType: record.agentType });

    // Register session in domain store
    const sessionState = createInitialSessionState(
      record.sessionId,
      agentId,
      record.sourceId,
      record.agentType,
      record.filePath,
    );
    sessionState.projectName = path.basename(path.dirname(record.filePath));
    sessionState.runMode = record.importMode === 'replay' ? 'replay' : 'live';
    domainStore.registerSession(sessionState);

    // Create ingestion controller (replaces legacy fileWatcher + transcriptParser)
    const controller = new IngestionController({
      sessionId: record.sessionId,
      filePath: record.filePath,
      agentType: record.agentType,
      mode: record.importMode === 'replay' ? 'replay' : 'live',
      store: domainStore,
      startOffset: fileOffset,
      onEvent: (event: AgentEvent) => {
        emitLegacyFromDomainEvent(agentId, event);
      },
    });
    ingestionControllers.set(record.sessionId, controller);
    controller.start();
  });

  // When a session is removed, stop controller and notify renderer
  registry.on('session-removed', (record: SessionRecord) => {
    const agentId = sessionToAgentId.get(record.sessionId);
    if (agentId === undefined) return;

    console.log(`[Pixel Agents] Agent ${agentId} session removed`);
    cancelPermissionTimer(agentId);
    sessionToAgentId.delete(record.sessionId);
    send('agentClosed', { id: agentId });

    // Clean up domain pipeline
    const controller = ingestionControllers.get(record.sessionId);
    if (controller) {
      controller.destroy();
      ingestionControllers.delete(record.sessionId);
    }
    domainStore.removeSession(record.sessionId);
    alertEngine.removeAlertsForSession(record.sessionId);
  });

  // Load source configs and register them
  const configs = sessionSourceStore.load();
  for (const config of configs) {
    sourceManager.addSource(config);
  }
}

/** Backward compatibility: emit legacy IPC messages from domain events.
 *  This bridge keeps the existing renderer working until Phase 4 migration. */
function emitLegacyFromDomainEvent(agentId: number, event: AgentEvent): void {
  switch (event.type) {
    case 'tool_started': {
      // Emit active status + tool start (matches old pipeline behavior)
      cancelPermissionTimer(agentId);
      send('agentStatus', { id: agentId, status: 'active' });

      if (!event.parentToolId) {
        send('agentToolStart', { id: agentId, toolId: event.toolId, status: event.status });
      } else {
        send('subagentToolStart', {
          id: agentId,
          parentToolId: event.parentToolId,
          toolId: event.toolId,
          status: event.status,
        });
      }

      // Start permission timer for non-exempt tools
      resetPermissionTimer(agentId, event);
      break;
    }
    case 'tool_completed': {
      if (!event.parentToolId) {
        send('agentToolDone', { id: agentId, toolId: event.toolId });
      } else {
        send('subagentToolDone', {
          id: agentId,
          parentToolId: event.parentToolId,
          toolId: event.toolId,
        });
      }
      break;
    }
    case 'subagent_spawned':
      // Subagent spawned is already covered by tool_started with parentToolId
      break;
    case 'subagent_completed':
      if (event.parentToolId) {
        send('subagentClear', { id: agentId, parentToolId: event.parentToolId });
      }
      break;
    case 'waiting_for_input':
      cancelPermissionTimer(agentId);
      send('agentStatus', { id: agentId, status: 'waiting' });
      break;
    case 'session_attached':
      cancelPermissionTimer(agentId);
      send('agentStatus', { id: agentId, status: 'active' });
      break;
    case 'permission_requested':
      send('agentToolPermission', { id: agentId });
      break;
    case 'permission_cleared':
      cancelPermissionTimer(agentId);
      send('agentToolPermissionClear', { id: agentId });
      break;
    case 'turn_completed':
      cancelPermissionTimer(agentId);
      send('agentToolsClear', { id: agentId });
      send('agentStatus', { id: agentId, status: 'waiting' });
      break;
    case 'session_dormant':
      cancelPermissionTimer(agentId);
      send('agentClosed', { id: agentId });
      break;
    default:
      break;
  }
}

/** Start/reset permission timer when a non-exempt tool is active */
function resetPermissionTimer(agentId: number, event: AgentEvent): void {
  const toolName = event.toolName ?? '';
  if (PERMISSION_EXEMPT_TOOLS.has(toolName)) return;

  cancelPermissionTimer(agentId);
  const timer = setTimeout(() => {
    permissionTimers.delete(agentId);
    console.log(`[Pixel Agents] Agent ${agentId}: possible permission wait detected`);
    send('agentToolPermission', { id: agentId });
  }, PERMISSION_TIMER_DELAY_MS);
  permissionTimers.set(agentId, timer);
}

function cancelPermissionTimer(agentId: number): void {
  const existing = permissionTimers.get(agentId);
  if (existing) {
    clearTimeout(existing);
    permissionTimers.delete(agentId);
  }
}

/** Debounced alert evaluation: runs 500ms after last state change */
function scheduleAlertEvaluation(): void {
  if (alertEvalTimer) clearTimeout(alertEvalTimer);
  alertEvalTimer = setTimeout(() => {
    alertEvalTimer = null;
    runAlertEvaluation();
  }, ALERT_EVAL_DEBOUNCE_MS);
}

function runAlertEvaluation(): void {
  const sessions = new Map<string, SessionViewState>();
  for (const s of domainStore.getAllSessions()) {
    sessions.set(s.sessionId, s);
  }

  const eventHistories = new Map<string, AgentEvent[]>();
  for (const sessionId of sessions.keys()) {
    eventHistories.set(sessionId, domainStore.getEventHistory(sessionId));
  }

  const collisions = domainStore.getCollisions();
  const newAlerts = alertEngine.evaluate(sessions, eventHistories, collisions);

  // Compute health scores and update alertIds on each session
  for (const [sessionId, session] of sessions) {
    const sessionAlerts = alertEngine.getAlertsBySession(sessionId);
    session.healthScore = computeHealth(session, sessionAlerts);
    session.alertIds = sessionAlerts.map((a) => a.id);
  }

  // Push updated sessions with health scores
  if (newAlerts.length > 0 || sessions.size > 0) {
    send('sessionStateUpdate', [...sessions.values()]);
  }

  // Always send current active alerts
  send('alertsUpdate', alertEngine.getActiveAlerts());
}

function stopDiscovery(): void {
  if (sourceManager) {
    sourceManager.stopAll();
    sourceManager = null;
  }
  // Stop all ingestion controllers
  for (const controller of ingestionControllers.values()) {
    controller.destroy();
  }
  ingestionControllers.clear();
  // Clean up permission timers
  for (const timer of permissionTimers.values()) {
    clearTimeout(timer);
  }
  permissionTimers.clear();
  if (alertEvalTimer) {
    clearTimeout(alertEvalTimer);
    alertEvalTimer = null;
  }
  replayStore.stopAll();
  replayStore.removeAllListeners();
  sessionToAgentId.clear();
  domainStore.removeAllListeners();
  registry?.removeAllListeners();
  registry = null;
}

function setupIPC(): void {
  ipcMain.on('webviewReady', async () => {
    const assetsDir = getAssetsRoot();

    // Load and send assets in correct order (sprites before layout)
    const charSprites = loadCharacterSprites(assetsDir);
    if (charSprites) {
      send('characterSpritesLoaded', { characters: charSprites.characters });
    }

    const floorTiles = loadFloorTiles(assetsDir);
    if (floorTiles) {
      send('floorTilesLoaded', { sprites: floorTiles.sprites });
    }

    const wallTiles = loadWallTiles(assetsDir);
    if (wallTiles) {
      send('wallTilesLoaded', { sprites: wallTiles.sprites });
    }

    const furniture = loadFurnitureAssets(assetsDir);
    if (furniture) {
      send('furnitureAssetsLoaded', { catalog: furniture.catalog, sprites: furniture.sprites });
    }

    // Settings and layout sent last (before discovery)
    const settings = readSettings();
    send('settingsLoaded', { soundEnabled: settings.soundEnabled });

    const saved = readLayout();
    const defaultLayout = loadDefaultLayout();
    send('layoutLoaded', { layout: saved ?? defaultLayout });

    // Start agent discovery after layout is loaded
    startDiscovery();
  });

  ipcMain.on('saveLayout', (_event, data: { layout: Record<string, unknown> }) => {
    writeLayout(data.layout);
  });

  ipcMain.on('setSoundEnabled', (_event, data: { enabled: boolean }) => {
    const settings = readSettings();
    settings.soundEnabled = data.enabled;
    writeSettings(settings);
  });

  ipcMain.on('saveAgentSeats', () => {
    // Stub — seat persistence can be added later
  });

  ipcMain.on('exportLayout', async () => {
    const layout = readLayout();
    if (!layout || !mainWindow) return;
    const result = await dialog.showSaveDialog(mainWindow, {
      filters: [{ name: 'JSON Files', extensions: ['json'] }],
      defaultPath: path.join(os.homedir(), 'pixel-agents-layout.json'),
    });
    if (result.filePath) {
      fs.writeFileSync(result.filePath, JSON.stringify(layout, null, 2), 'utf-8');
    }
  });

  ipcMain.on('importLayout', async () => {
    if (!mainWindow) return;
    const result = await dialog.showOpenDialog(mainWindow, {
      filters: [{ name: 'JSON Files', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (!result.filePaths.length) return;
    try {
      const raw = fs.readFileSync(result.filePaths[0], 'utf-8');
      const imported = JSON.parse(raw) as Record<string, unknown>;
      if (imported.version !== 1 || !Array.isArray(imported.tiles)) {
        dialog.showErrorBox('Pixel Agents', 'Invalid layout file.');
        return;
      }
      writeLayout(imported);
      send('layoutLoaded', { layout: imported });
    } catch {
      dialog.showErrorBox('Pixel Agents', 'Failed to read or parse layout file.');
    }
  });

  ipcMain.handle('selectJsonlFile', async () => {
    if (!mainWindow) return { canceled: true };
    const result = await dialog.showOpenDialog(mainWindow, {
      filters: [{ name: 'JSONL Files', extensions: ['jsonl'] }],
      properties: ['openFile'],
      title: 'Select a JSONL session file',
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    return { canceled: false, filePath: result.filePaths[0] };
  });

  ipcMain.handle('selectDirectory', async () => {
    if (!mainWindow) return { canceled: true };
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select a session directory to watch',
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    return { canceled: false, directory: result.filePaths[0] };
  });

  ipcMain.on('openSessionsFolder', () => {
    const claudeDir = path.join(os.homedir(), '.claude', 'projects');
    if (fs.existsSync(claudeDir)) {
      shell.openPath(claudeDir);
    }
  });

  ipcMain.on('installUpdate', () => {
    quitAndInstall();
  });

  ipcMain.on('openReleaseUrl', () => {
    openReleaseUrl();
  });

  ipcMain.on('requestDiagnostics', () => {
    const knownFiles = registry
      ? registry.getAllSessions().map((s) => s.filePath)
      : [];

    const domainSessions = domainStore.getAllSessions().map((s) => ({
      sessionId: s.sessionId,
      agentId: s.agentId,
      agentType: s.agentType,
      filePath: s.filePath,
      status: s.status.state,
      eventCount: s.eventCount,
      activeTools: s.activeTools.length,
      runMode: s.runMode,
    }));

    const controllerDiags: Record<string, { offset: number }> = {};
    for (const [sessionId, controller] of ingestionControllers) {
      controllerDiags[sessionId] = { offset: controller.currentOffset };
    }

    const mem = process.memoryUsage();
    send('diagnosticsDump', {
      discovery: {
        knownFiles,
        agentCount: domainSessions.length,
        scanInterval: DISCOVERY_SCAN_INTERVAL_MS,
      },
      domainStore: {
        sessionCount: domainSessions.length,
        sessions: domainSessions,
        ingestionControllers: ingestionControllers.size,
        controllers: controllerDiags,
      },
      memory: {
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        rss: mem.rss,
      },
    });
  });

  // ── Alert management IPC ──────────────────────────────────────

  ipcMain.handle('acknowledgeAlert', (_event, data: { alertId: string }) => {
    alertEngine.acknowledge(data.alertId);
    send('alertsUpdate', alertEngine.getActiveAlerts());
    return { success: true };
  });

  ipcMain.handle('getActiveAlerts', () => {
    return alertEngine.getActiveAlerts();
  });

  // ── Source management IPC ──────────────────────────────────────

  ipcMain.handle('addManualFile', (_event, data: { filePath: string; label?: string; importMode?: string }) => {
    const validation = validateJsonlFile(data.filePath);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    if (!sourceManager) {
      return { success: false, error: 'Source manager not initialized' };
    }

    // Check for duplicate path across existing sources
    const existing = sourceManager.getConfigs();
    if (existing.some((c) => c.path === data.filePath)) {
      return { success: false, error: 'This file is already added as a source' };
    }

    const importMode = (data.importMode === 'replay' || data.importMode === 'snapshot')
      ? data.importMode
      : 'tail' as const;

    const config: SessionSourceConfig = {
      id: `manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      kind: 'manual_file',
      label: data.label ?? path.basename(data.filePath),
      enabled: true,
      importMode,
      path: data.filePath,
    };

    sourceManager.addSource(config);
    sessionSourceStore.save(sourceManager.getConfigs());
    return { success: true, config };
  });

  ipcMain.handle('addWatchedDirectory', (_event, data: { directory: string; label?: string; glob?: string; importMode?: string }) => {
    const dirValidation = validateDirectory(data.directory);
    if (!dirValidation.valid) {
      return { success: false, error: dirValidation.error };
    }

    if (!sourceManager) {
      return { success: false, error: 'Source manager not initialized' };
    }

    const existing = sourceManager.getConfigs();
    if (existing.some((c) => c.directory === data.directory)) {
      return { success: false, error: 'This directory is already being watched' };
    }

    const importMode = (data.importMode === 'replay' || data.importMode === 'snapshot')
      ? data.importMode
      : 'tail' as const;

    const config: SessionSourceConfig = {
      id: `watched_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      kind: 'watched_directory',
      label: data.label ?? path.basename(data.directory),
      enabled: true,
      importMode,
      directory: data.directory,
      glob: data.glob ?? '*.jsonl',
    };

    sourceManager.addSource(config);
    sessionSourceStore.save(sourceManager.getConfigs());
    return { success: true, config };
  });

  ipcMain.handle('removeSource', (_event, data: { sourceId: string }) => {
    if (!sourceManager) {
      return { success: false, error: 'Source manager not initialized' };
    }

    // Don't allow removing auto sources
    if (data.sourceId === 'auto_claude' || data.sourceId === 'auto_codex') {
      return { success: false, error: 'Cannot remove built-in auto-scan sources' };
    }

    sourceManager.removeSource(data.sourceId);
    sessionSourceStore.save(sourceManager.getConfigs());
    return { success: true };
  });

  ipcMain.handle('getSourceConfigs', () => {
    if (!sourceManager) {
      return [];
    }
    return sourceManager.getConfigs();
  });

  ipcMain.handle('enableSource', (_event, data: { sourceId: string }) => {
    if (!sourceManager) {
      return { success: false, error: 'Source manager not initialized' };
    }
    sourceManager.enableSource(data.sourceId);
    sessionSourceStore.save(sourceManager.getConfigs());
    return { success: true };
  });

  ipcMain.handle('disableSource', (_event, data: { sourceId: string }) => {
    if (!sourceManager) {
      return { success: false, error: 'Source manager not initialized' };
    }
    sourceManager.disableSource(data.sourceId);
    sessionSourceStore.save(sourceManager.getConfigs());
    return { success: true };
  });

  // ── Replay IPC (WP-6A) ──────────────────────────────────────

  replayStore.on('replayEvent', (data: { sessionId: string; event: AgentEvent }) => {
    send('replayEvent', data);
  });
  replayStore.on('replayState', (snapshot: ReplayStateSnapshot) => {
    send('replayState', snapshot);
  });

  ipcMain.handle('startReplay', (_event, data: { filePath: string; speed?: number }) => {
    try {
      const agentType = detectAgentType(data.filePath) ?? 'claude';
      const sessionId = replayStore.startReplay(data.filePath, agentType, data.speed);
      const controller = replayStore.getController(sessionId);
      return { success: true, sessionId, snapshot: controller?.getSnapshot() };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });

  ipcMain.handle('replayControl', (_event, data: { sessionId: string; action: string; value?: unknown }) => {
    const controller = replayStore.getController(data.sessionId);
    if (!controller) {
      return { success: false, error: 'Replay session not found' };
    }

    switch (data.action) {
      case 'play':
        controller.play();
        break;
      case 'pause':
        controller.pause();
        break;
      case 'stop':
        controller.stop();
        break;
      case 'seek':
        if (typeof data.value === 'number' || typeof data.value === 'string') {
          controller.seek(data.value);
        }
        break;
      case 'speed':
        if (typeof data.value === 'number') {
          controller.setSpeed(data.value);
        }
        break;
      case 'jumpTo':
        if (typeof data.value === 'string') {
          controller.jumpTo(data.value as 'next_error' | 'prev_error' | 'next_tool' | 'prev_tool');
        }
        break;
      default:
        return { success: false, error: `Unknown action: ${data.action}` };
    }

    return { success: true, snapshot: controller.getSnapshot() };
  });

  ipcMain.handle('stopReplay', (_event, data: { sessionId: string }) => {
    replayStore.stopReplay(data.sessionId);
    return { success: true };
  });

  ipcMain.handle('getReplaySnapshots', () => {
    return replayStore.getReplaySnapshots();
  });

  // Open file path in system default application
  ipcMain.handle('shell:openPath', (_event, filePath: string) => shell.openPath(filePath));

  // Stub handlers — no terminal management in standalone mode
  ipcMain.on('focusAgent', () => {});
  ipcMain.on('closeAgent', () => {});
}

app.whenReady().then(() => {
  // Set dock icon on macOS (overrides cached/default Electron icon)
  if (process.platform === 'darwin') {
    const iconPath = getIconPath();
    if (iconPath) {
      app.dock?.setIcon(nativeImage.createFromPath(iconPath));
    }
  }

  mainWindow = createWindow();
  // Keep tray reference alive to prevent GC
  createTray(mainWindow);
  setupIPC();

  if (app.isPackaged) {
    setupAutoUpdater(mainWindow);
  }

  // macOS: hide to tray instead of quitting when closing window
  mainWindow.on('close', (event) => {
    if (process.platform === 'darwin' && !isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  stopDiscovery();
});
