#!/usr/bin/env node
/**
 * Servidor MCP (stdio) para usar Odoo desde sesiones de Claude.
 *
 * No habla con Odoo: llama a la API local (127.0.0.1:8787), así que aplica las mismas
 * validaciones y actúa con la misma cuenta que el panel. Registro:
 *   claude mcp add --scope user odoo-remember -- node <repo>/dist/server/mcp.js
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { Account, ProjectSummary, Ref, Stage, Task, TaskDetail, TimerInfo, Today } from './types.js';

const BASE = (process.env.ODOO_REMEMBER_API ?? 'http://127.0.0.1:8787').replace(/\/$/, '');

async function api<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error(`La API local de odoo-remember no responde en ${BASE}. ¿Está instalada y corriendo (./install.sh)?`);
  }
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(`${(data as { error?: string }).error ?? `HTTP ${res.status}`} (HTTP ${res.status})`);
  return data as T;
}

const qs = (p: Record<string, string | number | boolean | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== '' && v !== false) s.set(k, v === true ? '1' : String(v));
  const out = s.toString();
  return out ? `?${out}` : '';
};

/** Versión compacta de una tarea para no gastar contexto. */
const brief = (t: Task) => ({
  id: t.id, name: t.name, project: t.project?.name ?? null, stage: t.stage?.name ?? null, state: t.state,
  deadline: t.deadline, priority: t.priority || undefined, tags: t.tags.length ? t.tags : undefined,
  assignees: t.assignees.map((a) => a.name), allocatedHours: t.allocatedHours || undefined, effectiveHours: t.effectiveHours || undefined, url: t.url,
});
const detail = (t: TaskDetail) => ({ ...brief(t), description: t.description || undefined, timesheets: t.timesheets.slice(0, 10), messages: t.messages.slice(0, 5) });

type Result = { content: { type: 'text'; text: string }[]; isError?: boolean };
const run = (fn: () => Promise<unknown>) => async (): Promise<Result> => {
  try {
    return { content: [{ type: 'text', text: JSON.stringify(await fn(), null, 1) }] };
  } catch (e) {
    return { content: [{ type: 'text', text: (e as Error).message }], isError: true };
  }
};

const READ = { readOnlyHint: true, openWorldHint: true } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const;

const when = z.string().describe('"YYYY-MM-DD" (medianoche local) o "YYYY-MM-DDTHH:MM" en hora local de la Mac');
const STATES = ['01_in_progress', '02_changes_requested', '03_approved', '04_waiting_normal', '1_done', '1_canceled'] as const;

const server = new McpServer(
  { name: 'odoo-remember', version: '1.0.0' },
  {
    instructions: [
      'Herramientas para tareas, horas y asistencia en Odoo con la cuenta del usuario (la del token en su Mac).',
      'Reglas:',
      '- Resuelve nombres antes de escribir: usa find_projects y list_stages para obtener ids. Si hay más de un proyecto o etapa',
      '  que pueda coincidir con lo que pidió el usuario, pregúntale cuál; no adivines.',
      '- Las etiquetas se pasan por nombre. Solo usa createMissingTags: true si el usuario pidió crear las que no existan.',
      '- Fechas sin zona = hora local del usuario. "Lo empecé a las 10:35" → startedAt (inicia el temporizador con esa hora).',
      '- Si ya hay un temporizador corriendo, la API lo rechaza: avisa al usuario y pregunta antes de detenerlo con stop_timer.',
      '- Después de crear o cambiar algo, resume al usuario lo que quedó (incluye la url de la tarea).',
    ].join('\n'),
  },
);

// ---------- Lectura ----------

server.registerTool('whoami', {
  title: 'Cuenta de Odoo',
  description: 'Usuario de Odoo con el que se hacen todas las acciones y si su token es válido.',
  annotations: READ,
}, run(async () => {
  const a = await api<Account>('GET', '/api/account?fresh=1');
  return { name: a.name, login: a.login, company: a.company, employee: a.employee, odoo: a.odoo };
}));

server.registerTool('attendance_today', {
  title: 'Asistencia de hoy',
  description: 'Entrada, comida y salida de hoy en Odoo, tiempo trabajado y el estado actual.',
  annotations: READ,
}, run(async () => {
  const t = await api<Today>('GET', '/api/attendance/today');
  return { status: t.status, summary: t.summary, firstCheckIn: t.firstCheckIn, lastCheckOut: t.lastCheckOut, workedMinutes: t.workedMinutes, lunch: { start: t.lunch.start, end: t.lunch.end } };
}));

server.registerTool('find_projects', {
  title: 'Buscar proyectos',
  description: 'Proyectos donde participa el usuario. `query` busca por palabras sin importar acentos ni mayúsculas (p. ej. "apidiv gdl").',
  inputSchema: { query: z.string().optional() },
  annotations: READ,
}, ({ query }) => run(async () => {
  const ps = await api<ProjectSummary[]>('GET', `/api/projects${qs({ q: query })}`);
  return ps.map((p) => ({ id: p.id, name: p.name, openTasks: p.openTasks, myOpenTasks: p.myOpenTasks, timesheets: p.allowTimesheets }));
})());

server.registerTool('list_stages', {
  title: 'Etapas de un proyecto',
  description: 'Etapas (columnas) de un proyecto, en orden. Úsalo para obtener el stageId antes de crear o mover tareas.',
  inputSchema: { projectId: z.number().int().positive() },
  annotations: READ,
}, ({ projectId }) => run(() => api<Stage[]>('GET', `/api/projects/${projectId}/stages`))());

server.registerTool('find_tags', {
  title: 'Buscar etiquetas',
  description: 'Etiquetas de tareas existentes que contienen `query` (sin importar acentos ni mayúsculas).',
  inputSchema: { query: z.string().optional() },
  annotations: READ,
}, ({ query }) => run(() => api<Ref[]>('GET', `/api/tags${qs({ q: query })}`))());

server.registerTool('my_tasks', {
  title: 'Mis tareas abiertas',
  description: 'Tareas abiertas asignadas al usuario. `query` filtra por nombre de tarea o proyecto.',
  inputSchema: { query: z.string().optional() },
  annotations: READ,
}, ({ query }) => run(async () => {
  const f = (query ?? '').toLowerCase();
  const ts = await api<Task[]>('GET', '/api/tasks/mine');
  return ts.filter((t) => !f || t.name.toLowerCase().includes(f) || t.project?.name.toLowerCase().includes(f)).map(brief);
})());

server.registerTool('project_tasks', {
  title: 'Tareas de un proyecto',
  description: 'Tareas abiertas de un proyecto agrupadas por etapa.',
  inputSchema: { projectId: z.number().int().positive(), mine: z.boolean().optional(), query: z.string().optional() },
  annotations: READ,
}, ({ projectId, mine, query }) => run(async () => {
  const b = await api<{ groups: { stage: Stage | null; count: number; tasks: Task[] }[] }>('GET', `/api/projects/${projectId}/tasks${qs({ mine, q: query })}`);
  return b.groups.filter((g) => g.count).map((g) => ({ stage: g.stage?.name ?? 'Sin etapa', count: g.count, tasks: g.tasks.map(brief) }));
})());

server.registerTool('get_task', {
  title: 'Detalle de tarea',
  description: 'Una tarea con descripción, últimas horas registradas y comentarios.',
  inputSchema: { taskId: z.number().int().positive() },
  annotations: READ,
}, ({ taskId }) => run(async () => detail(await api<TaskDetail>('GET', `/api/tasks/${taskId}`)))());

server.registerTool('current_timer', {
  title: 'Temporizador actual',
  description: 'Temporizador de Odoo que el usuario tiene corriendo en alguna tarea, o null.',
  annotations: READ,
}, run(() => api<TimerInfo | null>('GET', '/api/timer')));

// ---------- Escritura ----------

const taskFields = {
  stageId: z.number().int().positive().optional().describe('Id de etapa (de list_stages)'),
  deadline: when.optional().describe('Fecha límite: "YYYY-MM-DD" o con hora "YYYY-MM-DDTHH:MM"'),
  plannedStart: when.optional().describe('Inicio planeado'),
  allocatedHours: z.number().min(0).max(1000).optional().describe('Horas estimadas'),
  tags: z.array(z.string()).optional().describe('Nombres de etiquetas (reemplazan las actuales)'),
  createMissingTags: z.boolean().optional().describe('Crear las etiquetas que no existan; solo si el usuario lo pidió'),
  priority: z.boolean().optional().describe('Marcar con estrella'),
};

server.registerTool('create_task', {
  title: 'Crear tarea',
  description: 'Crea una tarea en un proyecto, asignada al usuario por defecto. Con `startedAt` además inicia el temporizador desde esa hora.',
  inputSchema: {
    projectId: z.number().int().positive(),
    name: z.string().min(1),
    description: z.string().optional(),
    assignToMe: z.boolean().optional().describe('Por defecto true'),
    startedAt: when.optional().describe('"Ya empecé a las…": inicia el temporizador con esa hora (máx. 24 h atrás)'),
    ...taskFields,
  },
  annotations: WRITE,
}, (input) => run(async () => detail(await api<TaskDetail>('POST', '/api/tasks', input)))());

server.registerTool('update_task', {
  title: 'Actualizar tarea',
  description: 'Cambia etapa, estado, nombre, fecha límite, horas estimadas, etiquetas o prioridad de una tarea. Solo se cambian los campos enviados.',
  inputSchema: {
    taskId: z.number().int().positive(),
    name: z.string().min(1).optional(),
    state: z.enum(STATES).optional().describe('01_in_progress, 02_changes_requested, 03_approved, 04_waiting_normal, 1_done (hecha), 1_canceled'),
    ...taskFields,
  },
  annotations: WRITE,
}, ({ taskId, ...patch }) => run(async () => detail(await api<TaskDetail>('PATCH', `/api/tasks/${taskId}`, patch)))());

server.registerTool('log_time', {
  title: 'Registrar horas',
  description: 'Registra horas trabajadas (parte de horas) en una tarea.',
  inputSchema: {
    taskId: z.number().int().positive(),
    hours: z.number().positive().max(24),
    description: z.string().describe('Qué se hizo'),
    date: z.string().optional().describe('YYYY-MM-DD; por defecto hoy'),
  },
  annotations: WRITE,
}, ({ taskId, ...input }) => run(async () => detail(await api<TaskDetail>('POST', `/api/tasks/${taskId}/timesheets`, input)))());

server.registerTool('comment_task', {
  title: 'Comentar tarea',
  description: 'Publica un comentario en el chatter de la tarea (lo ven los seguidores).',
  inputSchema: { taskId: z.number().int().positive(), body: z.string().min(1) },
  annotations: WRITE,
}, ({ taskId, body }) => run(async () => detail(await api<TaskDetail>('POST', `/api/tasks/${taskId}/comments`, { body })))());

server.registerTool('start_timer', {
  title: 'Iniciar temporizador',
  description: 'Inicia el temporizador de Odoo en una tarea. `startedAt` lo retrocede ("empecé a las 10:35"). Falla si ya hay otro corriendo.',
  inputSchema: { taskId: z.number().int().positive(), startedAt: when.optional() },
  annotations: WRITE,
}, ({ taskId, startedAt }) => run(() => api<TimerInfo>('POST', `/api/tasks/${taskId}/timer/start`, { startedAt }))());

server.registerTool('stop_timer', {
  title: 'Detener temporizador',
  description: 'Detiene el temporizador actual y registra el tiempo transcurrido como horas en su tarea.',
  inputSchema: { description: z.string().optional().describe('Qué se hizo') },
  annotations: WRITE,
}, ({ description }) => run(() => api<{ taskId: number; hours: number }>('POST', '/api/timer/stop', { description }))());

await server.connect(new StdioServerTransport());
