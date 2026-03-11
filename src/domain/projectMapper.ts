import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const execFileAsync = promisify(execFile);

export interface ProjectInfo {
  projectName?: string;
  gitRoot?: string;
  branch?: string;
  worktree?: string;
  label?: string;
  host?: string;
  inferredFrom: 'sidecar' | 'git' | 'path' | 'none';
}

export interface SidecarMetadata {
  label?: string;
  project?: string;
  worktree?: string;
  branch?: string;
  host?: string;
}

interface CacheEntry {
  info: ProjectInfo;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;
const MAX_LINES_TO_SCAN = 30;

const cache = new Map<string, CacheEntry>();

export function clearProjectCache(): void {
  cache.clear();
}

export async function inferProjectInfo(
  filePath: string,
  sessionId: string,
): Promise<ProjectInfo> {
  const now = Date.now();
  const cached = cache.get(sessionId);
  if (cached && cached.expiresAt > now) return cached.info;

  const info = await doInfer(filePath);
  cache.set(sessionId, { info, expiresAt: now + CACHE_TTL_MS });
  return info;
}

async function doInfer(filePath: string): Promise<ProjectInfo> {
  // 1. Check for sidecar metadata file
  const sidecarPath = filePath.replace(/\.jsonl$/, '.meta.json');
  const sidecarInfo = await tryReadSidecar(sidecarPath);
  if (sidecarInfo) return sidecarInfo;

  // 2. Infer working directory from JSONL content
  const inferredDir = await inferDirectoryFromContent(filePath);
  const workDir = inferredDir ?? path.dirname(filePath);

  // 3. Try git-based inference
  const gitInfo = await tryGitInference(workDir);
  if (gitInfo) return gitInfo;

  // 4. Fall back to path-based name
  if (inferredDir) {
    return { projectName: path.basename(inferredDir), inferredFrom: 'path' };
  }

  return { inferredFrom: 'none' };
}

async function tryReadSidecar(sidecarPath: string): Promise<ProjectInfo | undefined> {
  try {
    await fs.promises.access(sidecarPath, fs.constants.R_OK);
    const raw = await fs.promises.readFile(sidecarPath, 'utf-8');
    const meta = JSON.parse(raw) as SidecarMetadata;
    return {
      projectName: meta.project ?? meta.label,
      label: meta.label,
      worktree: meta.worktree,
      branch: meta.branch,
      host: meta.host,
      inferredFrom: 'sidecar',
    };
  } catch {
    return undefined;
  }
}

async function tryGitInference(workDir: string): Promise<ProjectInfo | undefined> {
  try {
    const { stdout: root } = await execFileAsync('git', ['-C', workDir, 'rev-parse', '--show-toplevel'], {
      timeout: 5000,
    });
    const gitRoot = root.trim();

    let branch: string | undefined;
    try {
      const { stdout: b } = await execFileAsync('git', ['-C', gitRoot, 'branch', '--show-current'], {
        timeout: 5000,
      });
      branch = b.trim() || undefined;
    } catch {
      // detached HEAD or not a git repo
    }

    let worktree: string | undefined;
    try {
      const { stdout: wtList } = await execFileAsync('git', ['-C', gitRoot, 'worktree', 'list', '--porcelain'], {
        timeout: 5000,
      });
      worktree = parseWorktreeForDir(wtList, workDir);
    } catch {
      // worktree command not supported or failed
    }

    return {
      projectName: path.basename(gitRoot),
      gitRoot,
      branch,
      worktree,
      inferredFrom: 'git',
    };
  } catch {
    return undefined;
  }
}

async function inferDirectoryFromContent(filePath: string): Promise<string | undefined> {
  // Read first N lines of JSONL looking for cwd or path references
  const cwdPattern = /"cwd"\s*:\s*"([^"]+)"/;
  const pathPattern = /"(?:path|directory|dir)"\s*:\s*"(\/[^"]+)"/;

  try {
    await fs.promises.access(filePath, fs.constants.R_OK);
  } catch {
    return undefined;
  }

  const dirCounts = new Map<string, number>();

  try {
    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    let lineCount = 0;
    for await (const line of rl) {
      if (++lineCount > MAX_LINES_TO_SCAN) break;

      const cwdMatch = cwdPattern.exec(line);
      if (cwdMatch?.[1]) {
        const dir = cwdMatch[1];
        dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
      }

      const pathMatch = pathPattern.exec(line);
      if (pathMatch?.[1]) {
        const dir = path.dirname(pathMatch[1]);
        dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
      }
    }

    rl.close();
    stream.destroy();
  } catch {
    return undefined;
  }

  if (dirCounts.size === 0) return undefined;

  // Return the most frequently referenced directory
  let bestDir: string | undefined;
  let bestCount = 0;
  for (const [dir, count] of dirCounts) {
    if (count > bestCount) {
      bestCount = count;
      bestDir = dir;
    }
  }

  return bestDir;
}

function parseWorktreeForDir(wtListOutput: string, dir: string): string | undefined {
  // Parse `git worktree list --porcelain` output
  // Format: "worktree /path\nHEAD <sha>\nbranch refs/heads/<name>\n\n"
  const blocks = wtListOutput.split('\n\n').filter(Boolean);

  for (const block of blocks) {
    const lines = block.split('\n');
    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        const wtPath = line.slice('worktree '.length).trim();
        // Check if dir is inside this worktree (or is the worktree itself)
        if (dir === wtPath || dir.startsWith(wtPath + path.sep)) {
          return wtPath;
        }
      }
    }
  }

  return undefined;
}
