import { contextBridge, ipcRenderer } from 'electron';

type MessageCallback = (...args: unknown[]) => void;

interface SourceResult {
  success: boolean;
  error?: string;
  config?: unknown;
}

interface ReplayResult {
  success: boolean;
  error?: string;
  sessionId?: string;
  snapshot?: unknown;
}

const api = {
  send(channel: string, data?: unknown): void {
    ipcRenderer.send(channel, data);
  },
  on(channel: string, callback: MessageCallback): () => void {
    const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => {
      callback(...args);
    };
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },
  once(channel: string, callback: MessageCallback): void {
    ipcRenderer.once(channel, (_event, ...args) => callback(...args));
  },
  invoke(channel: string, data?: unknown): Promise<unknown> {
    return ipcRenderer.invoke(channel, data);
  },

  // ── Source management ──────────────────────────────────────
  addManualFile(filePath: string, importMode?: string, label?: string): Promise<SourceResult> {
    return ipcRenderer.invoke('addManualFile', { filePath, importMode, label }) as Promise<SourceResult>;
  },
  addWatchedDirectory(directory: string, glob?: string, importMode?: string, label?: string): Promise<SourceResult> {
    return ipcRenderer.invoke('addWatchedDirectory', { directory, glob, importMode, label }) as Promise<SourceResult>;
  },
  removeSource(sourceId: string): Promise<SourceResult> {
    return ipcRenderer.invoke('removeSource', { sourceId }) as Promise<SourceResult>;
  },
  getSourceConfigs(): Promise<unknown[]> {
    return ipcRenderer.invoke('getSourceConfigs') as Promise<unknown[]>;
  },
  enableSource(sourceId: string): Promise<SourceResult> {
    return ipcRenderer.invoke('enableSource', { sourceId }) as Promise<SourceResult>;
  },
  disableSource(sourceId: string): Promise<SourceResult> {
    return ipcRenderer.invoke('disableSource', { sourceId }) as Promise<SourceResult>;
  },

  // ── Alert management ──────────────────────────────────────
  acknowledgeAlert(alertId: string): Promise<SourceResult> {
    return ipcRenderer.invoke('acknowledgeAlert', { alertId }) as Promise<SourceResult>;
  },
  getActiveAlerts(): Promise<unknown[]> {
    return ipcRenderer.invoke('getActiveAlerts') as Promise<unknown[]>;
  },

  // ── Replay (WP-6A) ──────────────────────────────────────
  startReplay(filePath: string, speed?: number): Promise<ReplayResult> {
    return ipcRenderer.invoke('startReplay', { filePath, speed }) as Promise<ReplayResult>;
  },
  replayControl(sessionId: string, action: string, value?: unknown): Promise<ReplayResult> {
    return ipcRenderer.invoke('replayControl', { sessionId, action, value }) as Promise<ReplayResult>;
  },
  stopReplay(sessionId: string): Promise<SourceResult> {
    return ipcRenderer.invoke('stopReplay', { sessionId }) as Promise<SourceResult>;
  },
  getReplaySnapshots(): Promise<unknown[]> {
    return ipcRenderer.invoke('getReplaySnapshots') as Promise<unknown[]>;
  },
  onReplayEvent(callback: MessageCallback): () => void {
    return api.on('replayEvent', callback);
  },
  onReplayState(callback: MessageCallback): () => void {
    return api.on('replayState', callback);
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;
