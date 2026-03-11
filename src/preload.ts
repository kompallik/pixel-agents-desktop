import { contextBridge, ipcRenderer } from 'electron';

type MessageCallback = (...args: unknown[]) => void;

interface SourceResult {
  success: boolean;
  error?: string;
  config?: unknown;
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
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;
