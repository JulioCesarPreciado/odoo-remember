import fs from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { config } from './config.js';
import { HttpError } from './odoo.js';
import * as attendance from './attendance.js';
import * as location from './location.js';
import * as tasks from './tasks.js';

const app = new Hono();

// --- Seguridad: la API registra asistencias con tu cuenta, así que solo acepta peticiones locales. ---
const allowedHosts = new Set([`127.0.0.1:${config.port}`, `localhost:${config.port}`, '127.0.0.1:5173', 'localhost:5173']);
app.use('*', async (c, next) => {
  if (!allowedHosts.has(c.req.header('host') ?? '')) return c.json({ error: 'Host no permitido' }, 403);   // DNS rebinding
  if (c.req.method !== 'GET') {
    const origin = c.req.header('origin');
    if (origin && !allowedHosts.has(origin.replace(/^https?:\/\//, ''))) return c.json({ error: 'Origen no permitido' }, 403);
    if (!c.req.header('content-type')?.includes('application/json')) return c.json({ error: 'Se requiere JSON' }, 415);
  }
  await next();
});

app.onError((err, c) => {
  const status = err instanceof HttpError ? err.status : 500;
  if (status >= 500) console.error(err);
  return c.json({ error: err.message }, status);
});

const id = (c: Context, name = 'id') => {
  const n = Number(c.req.param(name));
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(`${name} inválido`, 400);
  return n;
};
const body = async <T>(c: Context): Promise<T> => {
  try { return (await c.req.json()) as T; } catch { throw new HttpError('JSON inválido', 400); }
};

// --- Asistencia ---
app.get('/api/health', (c) => c.json({ ok: true }));
app.get('/api/attendance/today', async (c) => c.json(await attendance.today({ fresh: c.req.query('fresh') === '1' })));
app.get('/api/location', (c) => c.json({ current: location.freshLocation(), last: location.lastLocation() }));
app.post('/api/location', async (c) => c.json(location.setLocation(await body(c))));
app.post('/api/attendance/check-in', async (c) => c.json(await attendance.checkIn()));
app.post('/api/attendance/check-out', async (c) => c.json(await attendance.checkOut()));
app.post('/api/attendance/lunch/start', async (c) => c.json(await attendance.lunchStart()));
app.post('/api/attendance/lunch/end', async (c) => c.json(await attendance.lunchEnd()));

// --- Tareas y proyectos ---
app.get('/api/tasks/mine', async (c) => c.json(await tasks.myTasks()));
app.get('/api/projects', async (c) => c.json(await tasks.projects()));
app.get('/api/projects/:id/stages', async (c) => c.json(await tasks.stages(id(c))));
app.get('/api/stages', async (c) => {
  const ids = (c.req.query('projects') ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return c.json(await tasks.stagesFor(ids));
});
app.get('/api/projects/:id/tasks', async (c) => {
  const q = c.req.query();
  return c.json(await tasks.board(id(c), {
    mine: q.mine === '1',
    q: q.q?.trim() || undefined,
    stageId: q.stage === undefined ? undefined : q.stage === 'none' ? null : Number(q.stage),
    limit: q.limit ? Number(q.limit) : undefined,
    offset: q.offset ? Number(q.offset) : undefined,
  }));
});
app.post('/api/tasks', async (c) => c.json(await tasks.createTask(await body(c)), 201));
app.get('/api/tasks/:id', async (c) => c.json(await tasks.task(id(c))));
app.patch('/api/tasks/:id', async (c) => c.json(await tasks.updateTask(id(c), await body(c))));
app.post('/api/tasks/:id/timesheets', async (c) => c.json(await tasks.logTime(id(c), await body(c))));
app.post('/api/tasks/:id/comments', async (c) => {
  const { body: text } = await body<{ body: string }>(c);
  return c.json(await tasks.comment(id(c), text ?? ''));
});
app.all('/api/*', (c) => c.json({ error: 'Ruta no encontrada' }, 404));

// --- Interfaz web (build de Vite) ---
const webRoot = path.relative(process.cwd(), config.webDir);
app.use('/*', serveStatic({ root: webRoot }));
app.get('*', (c) => {
  const index = path.join(config.webDir, 'index.html');
  return fs.existsSync(index) ? c.html(fs.readFileSync(index, 'utf8')) : c.text('Interfaz no compilada: corre `pnpm build`', 404);
});

serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`Odoo Remember API en http://${info.address}:${info.port}`);
});
