import { app, BrowserWindow, ipcMain, dialog, shell, Tray, nativeImage } from 'electron';
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

let mainWindow: BrowserWindow | null = null;
let registry: SessionRegistry | null = null;
let sourceManager: SessionSourceManager | null = null;
let tray: Tray | null = null;
let isQuitting = false;

const CONFIG_DIR = '.pixel-agents';
const SETTINGS_FILE = 'settings.json';

// Bridge between session UUIDs and numeric agent IDs (preserves existing IPC contract)
const sessionToAgentId = new Map<string, number>();
let nextAgentId = 1;

// Domain event pipeline (WP-2A/2B)
const domainStore = new SessionStore();
const ingestionControllers = new Map<string, IngestionController>();

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
  });

  // When a session is registered, create an AgentState and start watching
  registry.on('session-registered', (record: SessionRecord) => {
    const agentId = nextAgentId++;
    sessionToAgentId.set(record.sessionId, agentId);

    // 'replay' starts from beginning, 'tail'/'snapshot' start from end
    const stat = fs.statSync(record.filePath);
    const fileOffset = record.importMode === 'replay' ? 0 : stat.size;

    const agent: AgentState = {
      id: agentId,
      agentType: record.agentType,
      projectDir: path.dirname(record.filePath),
      jsonlFile: record.filePath,
      fileOffset,
      lineBuffer: '',
      activeToolIds: new Set(),
      activeToolStatuses: new Map(),
      activeToolNames: new Map(),
      activeSubagentToolIds: new Map(),
      activeSubagentToolNames: new Map(),
      isWaiting: false,
      permissionSent: false,
      hadToolsInTurn: false,
    };
    agents.set(agentId, agent);

    console.log(`[Pixel Agents] Sending agentCreated for agent ${agentId} (session ${record.sessionId})`);
    send('agentCreated', { id: agentId, agentType: record.agentType });

    // Legacy pipeline (kept for backward compat until Phase 4)
    startFileWatching(
      agentId, record.filePath,
      agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers,
      bridge,
    );
    readNewLines(agentId, agents, waitingTimers, permissionTimers, bridge);

    // New domain event pipeline
    const sessionState = createInitialSessionState(
      record.sessionId,
      agentId,
      record.sourceId,
      record.agentType,
      record.filePath,
    );
    sessionState.projectName = record.projectName;
    sessionState.runMode = record.importMode === 'replay' ? 'replay' : 'live';
    domainStore.registerSession(sessionState);

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

  // When a session is removed, stop watching and notify renderer
  registry.on('session-removed', (record: SessionRecord) => {
    const agentId = sessionToAgentId.get(record.sessionId);
    if (agentId === undefined) return;

    console.log(`[Pixel Agents] Agent ${agentId} session removed`);
    stopFileWatching(agentId, fileWatchers, pollingTimers, waitingTimers, permissionTimers);
    agents.delete(agentId);
    sessionToAgentId.delete(record.sessionId);
    send('agentClosed', { id: agentId });

    // Clean up domain pipeline
    const controller = ingestionControllers.get(record.sessionId);
    if (controller) {
      controller.destroy();
      ingestionControllers.delete(record.sessionId);
    }
    domainStore.removeSession(record.sessionId);
  });

  // Load source configs and register them
  const configs = sessionSourceStore.load();
  for (const config of configs) {
    sourceManager.addSource(config);
  }
}

/** Backward compatibility: emit legacy IPC messages from domain events */
function emitLegacyFromDomainEvent(agentId: number, event: AgentEvent): void {
  switch (event.type) {
    case 'tool_started':
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
      break;
    case 'tool_completed':
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
    case 'waiting_for_input':
      send('agentStatus', { id: agentId, status: 'waiting' });
      break;
    case 'session_attached':
      send('agentStatus', { id: agentId, status: 'active' });
      break;
    case 'permission_requested':
      send('agentToolPermission', { id: agentId });
      break;
    case 'permission_cleared':
      send('agentToolPermissionClear', { id: agentId });
      break;
    case 'turn_completed':
      send('agentToolsClear', { id: agentId });
      send('agentStatus', { id: agentId, status: 'waiting' });
      break;
    case 'session_dormant':
      send('agentClosed', { id: agentId });
      break;
    default:
      break;
  }
}

function stopDiscovery(): void {
  if (sourceManager) {
    sourceManager.stopAll();
    sourceManager = null;
  }
  // Stop all file watchers
  for (const agentId of agents.keys()) {
    stopFileWatching(agentId, fileWatchers, pollingTimers, waitingTimers, permissionTimers);
  }
  // Stop all ingestion controllers
  for (const controller of ingestionControllers.values()) {
    controller.destroy();
  }
  ingestionControllers.clear();
  agents.clear();
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

    const agentDiags = [...agents.values()].map((a) => ({
      id: a.id,
      agentType: a.agentType,
      jsonlFile: a.jsonlFile,
      fileOffset: a.fileOffset,
      bufferSize: a.lineBuffer.length,
    }));

    const activeWatchers = [...fileWatchers.keys()].map(String);
    const bufferSizes: Record<string, number> = {};
    for (const [id, agent] of agents) {
      bufferSizes[String(id)] = agent.lineBuffer.length;
    }

    const domainSessions = domainStore.getAllSessions().map((s) => ({
      sessionId: s.sessionId,
      agentId: s.agentId,
      status: s.status.state,
      eventCount: s.eventCount,
      activeTools: s.activeTools.length,
      runMode: s.runMode,
    }));

    const mem = process.memoryUsage();
    send('diagnosticsDump', {
      discovery: {
        knownFiles,
        agentCount: agents.size,
        scanInterval: DISCOVERY_SCAN_INTERVAL_MS,
        agents: agentDiags,
      },
      fileWatcher: {
        activeWatchers,
        bufferSizes,
      },
      domainStore: {
        sessionCount: domainSessions.length,
        sessions: domainSessions,
        ingestionControllers: ingestionControllers.size,
      },
      memory: {
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        rss: mem.rss,
      },
    });
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

  // Stub handlers — no terminal management in standalone mode
  ipcMain.on('focusAgent', () => {});
  ipcMain.on('closeAgent', () => {});
}

app.whenReady().then(() => {
  // Set dock icon on macOS (overrides cached/default Electron icon)
  if (process.platform === 'darwin') {
    const iconPath = getIconPath();
    if (iconPath) {
      app.dock.setIcon(nativeImage.createFromPath(iconPath));
    }
  }

  mainWindow = createWindow();
  tray = createTray(mainWindow);
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
