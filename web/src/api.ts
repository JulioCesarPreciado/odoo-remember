import type { ProjectBoard, ProjectSummary, Stage, Task, TaskDetail, TaskState, Today } from '../../server/types';

export type * from '../../server/types';

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({ error: `Error HTTP ${res.status}` }));
  if (!res.ok) throw new Error(data.error ?? `Error HTTP ${res.status}`);
  return data as T;
}

export const api = {
  today: (fresh = false) => req<Today>('GET', `/api/attendance/today${fresh ? '?fresh=1' : ''}`),
  checkIn: () => req<Today>('POST', '/api/attendance/check-in'),
  checkOut: () => req<Today>('POST', '/api/attendance/check-out'),
  lunchStart: () => req<Today>('POST', '/api/attendance/lunch/start'),
  lunchEnd: () => req<Today>('POST', '/api/attendance/lunch/end'),

  myTasks: () => req<Task[]>('GET', '/api/tasks/mine'),
  projects: () => req<ProjectSummary[]>('GET', '/api/projects'),
  stages: (projectId: number) => req<Stage[]>('GET', `/api/projects/${projectId}/stages`),
  board: (projectId: number, p: { mine?: boolean; q?: string; stage?: number | 'none'; offset?: number; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (p.mine) qs.set('mine', '1');
    if (p.q) qs.set('q', p.q);
    if (p.stage !== undefined) qs.set('stage', String(p.stage));
    if (p.offset) qs.set('offset', String(p.offset));
    if (p.limit) qs.set('limit', String(p.limit));
    return req<ProjectBoard>('GET', `/api/projects/${projectId}/tasks?${qs}`);
  },
  task: (id: number) => req<TaskDetail>('GET', `/api/tasks/${id}`),
  updateTask: (id: number, patch: { stageId?: number; state?: TaskState; priority?: boolean; deadline?: string | null }) =>
    req<TaskDetail>('PATCH', `/api/tasks/${id}`, patch),
  logTime: (id: number, input: { hours: number; description: string; date?: string }) => req<TaskDetail>('POST', `/api/tasks/${id}/timesheets`, input),
  comment: (id: number, body: string) => req<TaskDetail>('POST', `/api/tasks/${id}/comments`, { body }),
  createTask: (input: { projectId: number; name: string; description?: string; stageId?: number; deadline?: string; assignToMe?: boolean; priority?: boolean }) =>
    req<TaskDetail>('POST', '/api/tasks', input),
};
