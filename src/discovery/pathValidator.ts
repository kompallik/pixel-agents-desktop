import * as fs from 'fs';

export interface ValidationResult {
  valid: boolean;
  error?: string;
  agentType?: 'claude' | 'codex';
}

export function validateJsonlFile(filePath: string): ValidationResult {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
  } catch {
    return { valid: false, error: `File is not readable: ${filePath}` };
  }

  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return { valid: false, error: `Path is not a file: ${filePath}` };
    }
  } catch {
    return { valid: false, error: `Cannot stat file: ${filePath}` };
  }

  if (!filePath.endsWith('.jsonl')) {
    return { valid: false, error: 'File must have a .jsonl extension' };
  }

  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(4096);
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);

    if (bytesRead === 0) {
      return { valid: false, error: 'File is empty' };
    }

    const firstLine = buf.toString('utf-8', 0, bytesRead).split('\n')[0]?.trim();
    if (!firstLine) {
      return { valid: false, error: 'File has no content on first line' };
    }

    const parsed = JSON.parse(firstLine) as Record<string, unknown>;
    const agentType = detectAgentTypeFromParsed(parsed);
    return { valid: true, agentType: agentType ?? undefined };
  } catch {
    return { valid: false, error: 'First line is not valid JSON' };
  }
}

export function validateDirectory(dirPath: string): ValidationResult {
  try {
    fs.accessSync(dirPath, fs.constants.R_OK);
  } catch {
    return { valid: false, error: `Directory is not readable: ${dirPath}` };
  }

  try {
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) {
      return { valid: false, error: `Path is not a directory: ${dirPath}` };
    }
  } catch {
    return { valid: false, error: `Cannot stat path: ${dirPath}` };
  }

  return { valid: true };
}

function detectAgentTypeFromParsed(parsed: Record<string, unknown>): 'claude' | 'codex' | null {
  if (parsed.type === 'task_started' || parsed.type === 'task_completed' || parsed.session_id) {
    return 'codex';
  }
  return 'claude';
}
