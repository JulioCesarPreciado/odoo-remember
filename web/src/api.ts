import type { Account, Estimate, NewTask, ProjectBoard, ProjectSummary, Ref, Stage, Task, TaskDetail, TaskPatch, TimerInfo, Today } from '../../server/types';

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
  account: (fresh = false) => req<Account>('GET', `/api/account${fresh ? '?fresh=1' : ''}`),

  today: (fresh = false) => req<Today>('GET', `/api/attendance/today${fresh ? '?fresh=1' : ''}`),
  checkIn: () => req<Today>('POST', '/api/attendance/check-in'),
  checkOut: () => req<Today>('POST', '/api/attendance/check-out'),
  lunchStart: () => req<Today>('POST', '/api/attendance/lunch/start'),
  lunchEnd: () => req<Today>('POST', '/api/attendance/lunch/end'),

  myTasks: () => req<Task[]>('GET', '/api/tasks/mine'),
  projects: () => req<ProjectSummary[]>('GET', '/api/projects'),
  stages: (projectId: number) => req<Stage[]>('GET', `/api/projects/${projectId}/stages`),
  stagesFor: (projectIds: number[]) => req<Record<number, Stage[]>>('GET', `/api/stages?projects=${projectIds.join(',')}`),
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
  updateTask: (id: number, patch: TaskPatch) => req<TaskDetail>('PATCH', `/api/tasks/${id}`, patch),
  logTime: (id: number, input: { hours: number; description: string; date?: string }) => req<TaskDetail>('POST', `/api/tasks/${id}/timesheets`, input),
  comment: (id: number, body: string) => req<TaskDetail>('POST', `/api/tasks/${id}/comments`, { body }),
  createTask: (input: NewTask) => req<TaskDetail>('POST', '/api/tasks', input),
  tags: () => req<Ref[]>('GET', '/api/tags'),
  users: () => req<Ref[]>('GET', '/api/users'),
  estimate: (deadline: string, start?: string) =>
    req<Estimate>('GET', `/api/estimate?${new URLSearchParams({ deadline, ...(start ? { start } : {}) })}`),

  timer: () => req<TimerInfo | null>('GET', '/api/timer'),
  startTimer: (taskId: number, startedAt?: string) => req<TimerInfo>('POST', `/api/tasks/${taskId}/timer/start`, { startedAt }),
  stopTimer: (description: string) => req<{ taskId: number; hours: number }>('POST', '/api/timer/stop', { description }),
};
