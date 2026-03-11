import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { SessionSourceConfig } from '../discovery/sessionSource.js';

const STORE_DIR = path.join(os.homedir(), '.pixel-agents');
const STORE_FILE = path.join(STORE_DIR, 'sources.json');

const DEFAULT_CONFIGS: SessionSourceConfig[] = [
  {
    id: 'auto_claude',
    kind: 'auto_claude',
    label: 'Claude Code (auto)',
    enabled: true,
    importMode: 'tail',
  },
  {
    id: 'auto_codex',
    kind: 'auto_codex',
    label: 'Codex (auto)',
    enabled: true,
    importMode: 'tail',
  },
];

export function load(): SessionSourceConfig[] {
  try {
    const raw = fs.readFileSync(STORE_FILE, 'utf-8');
    const configs = JSON.parse(raw) as SessionSourceConfig[];
    if (!Array.isArray(configs) || configs.length === 0) {
      return [...DEFAULT_CONFIGS];
    }
    return configs;
  } catch {
    return [...DEFAULT_CONFIGS];
  }
}

export function save(configs: SessionSourceConfig[]): void {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true });
  }
  fs.writeFileSync(STORE_FILE, JSON.stringify(configs, null, 2), 'utf-8');
}
