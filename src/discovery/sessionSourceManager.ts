import type { SessionSourceConfig, DiscoveredFile } from './sessionSource.js';
import { BaseSessionSource } from './sessionSource.js';
import type { SessionRegistry } from './sessionRegistry.js';
import { AutoScanClaudeSource } from './sessionSources/autoScanClaudeSource.js';
import { AutoScanCodexSource } from './sessionSources/autoScanCodexSource.js';

export class SessionSourceManager {
  private sources = new Map<string, BaseSessionSource>();
  private registry: SessionRegistry;

  constructor(registry: SessionRegistry) {
    this.registry = registry;
  }

  addSource(config: SessionSourceConfig): void {
    if (this.sources.has(config.id)) {
      this.removeSource(config.id);
    }

    const source = this.createSource(config);
    if (!source) return;

    source.on('session-discovered', (file: DiscoveredFile) => {
      this.registry.registerFile(file);
    });

    source.on('session-lost', (filePath: string) => {
      this.registry.removeByPath(filePath);
    });

    this.sources.set(config.id, source);

    if (config.enabled) {
      source.start();
    }
  }

  removeSource(id: string): void {
    const source = this.sources.get(id);
    if (source) {
      source.stop();
      source.removeAllListeners();
      this.sources.delete(id);
    }
  }

  enableSource(id: string): void {
    const source = this.sources.get(id);
    if (source) {
      source.start();
    }
  }

  disableSource(id: string): void {
    const source = this.sources.get(id);
    if (source) {
      source.stop();
    }
  }

  getConfigs(): SessionSourceConfig[] {
    return [...this.sources.values()].map((s) => s.config);
  }

  startAll(): void {
    for (const source of this.sources.values()) {
      if (source.config.enabled) {
        source.start();
      }
    }
  }

  stopAll(): void {
    for (const source of this.sources.values()) {
      source.stop();
    }
  }

  private createSource(config: SessionSourceConfig): BaseSessionSource | null {
    switch (config.kind) {
      case 'auto_claude':
        return new AutoScanClaudeSource(config);
      case 'auto_codex':
        return new AutoScanCodexSource(config);
      case 'manual_file':
      case 'watched_directory':
        // Will be implemented in WP-1B
        return null;
      default:
        return null;
    }
  }
}
