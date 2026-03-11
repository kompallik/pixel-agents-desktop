import type { SessionViewState } from './sessionState.js';

export interface CollisionInfo {
  type: 'same_worktree' | 'same_project';
  sessionIds: string[];
  path: string;
}

export function detectCollisions(sessions: Map<string, SessionViewState>): CollisionInfo[] {
  const collisions: CollisionInfo[] = [];
  const worktreeMap = new Map<string, string[]>();
  const projectMap = new Map<string, string[]>();

  for (const [id, session] of sessions) {
    if (session.status.state === 'dormant') continue;

    if (session.worktree) {
      const ids = worktreeMap.get(session.worktree) ?? [];
      ids.push(id);
      worktreeMap.set(session.worktree, ids);
    }

    if (session.projectName) {
      const ids = projectMap.get(session.projectName) ?? [];
      ids.push(id);
      projectMap.set(session.projectName, ids);
    }
  }

  for (const [wtPath, ids] of worktreeMap) {
    if (ids.length > 1) {
      collisions.push({ type: 'same_worktree', sessionIds: ids, path: wtPath });
    }
  }

  for (const [project, ids] of projectMap) {
    if (ids.length > 1) {
      collisions.push({ type: 'same_project', sessionIds: ids, path: project });
    }
  }

  return collisions;
}
