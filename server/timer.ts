import { HttpError, fromOdoo, odoo, ref, toOdoo } from './odoo.js';
import { logTime, parseWhen, task } from './tasks.js';
import type { TimerInfo } from './types.js';

type RawTimer = { id: number; res_id: number; timer_start: string | false; timer_pause: string | false };

async function rawTimer(): Promise<RawTimer | null> {
  const { uid } = await odoo.me();
  const [t] = await odoo.searchRead<RawTimer>('timer.timer',
    [['user_id', '=', uid], ['res_model', '=', 'project.task'], ['timer_start', '!=', false]],
    { fields: ['res_id', 'timer_start', 'timer_pause'], limit: 1, order: 'id desc' });
  return t ?? null;
}

const elapsedMinutes = (t: RawTimer) => {
  const start = fromOdoo(t.timer_start)!.getTime();
  const end = fromOdoo(t.timer_pause)?.getTime() ?? Date.now();
  return Math.max(0, Math.round((end - start) / 60_000));
};

/** Temporizador de tareas del usuario que está corriendo (o pausado), si hay. */
export async function currentTimer(): Promise<TimerInfo | null> {
  const t = await rawTimer();
  if (!t) return null;
  const [row] = await odoo.call<{ name: string; project_id: unknown }[]>('project.task', 'read', [[t.res_id]], { fields: ['name', 'project_id'] });
  return {
    taskId: t.res_id,
    taskName: row?.name ?? `#${t.res_id}`,
    project: ref(row?.project_id),
    startedAt: fromOdoo(t.timer_start)!.toISOString(),
    paused: !!t.timer_pause,
    elapsedMinutes: elapsedMinutes(t),
    url: odoo.recordUrl('project.task', t.res_id),
  };
}

/** Valida una hora de inicio: en el pasado y dentro de las últimas 24 h. */
function validStart(startedAt: string): Date {
  const d = parseWhen(startedAt, 'startedAt');
  if (d.getTime() > Date.now() + 60_000) throw new HttpError('startedAt no puede estar en el futuro', 400);
  if (Date.now() - d.getTime() > 24 * 3600_000) throw new HttpError('startedAt no puede ser de hace más de 24 h; registra horas en su lugar', 400);
  return d;
}

/** Falla con 409 si ya hay otro temporizador: Odoo lo detendría sin preguntar. */
export async function assertCanStart(startedAt?: string) {
  if (startedAt) validStart(startedAt);
  const running = await currentTimer();
  if (running) {
    throw new HttpError(`Ya hay un temporizador en "${running.taskName}" (${running.elapsedMinutes} min). Detenlo primero.`, 409);
  }
}

/** Inicia el temporizador de la tarea; con `startedAt` ("ya empecé a las 10:35") lo retrocede a esa hora. */
export async function startTimer(taskId: number, startedAt?: string): Promise<TimerInfo> {
  await assertCanStart(startedAt);
  await task(taskId);                                            // 404 si no existe
  await odoo.call('project.task', 'action_timer_start', [[taskId]]);
  const t = await rawTimer();
  if (!t || t.res_id !== taskId) throw new HttpError('Odoo no inició el temporizador', 502);
  if (startedAt) await odoo.call('timer.timer', 'write', [[t.id], { timer_start: toOdoo(validStart(startedAt)) }]);
  return (await currentTimer())!;
}

/** Detiene el temporizador y registra el tiempo transcurrido como horas en la tarea. */
export async function stopTimer(description = ''): Promise<{ taskId: number; hours: number }> {
  const t = await rawTimer();
  if (!t) throw new HttpError('No hay ningún temporizador corriendo', 409);
  const minutes = Math.max(1, elapsedMinutes(t));
  const hours = Math.round((minutes / 60) * 100) / 100;
  const date = fromOdoo(t.timer_start)!.toLocaleDateString('en-CA');
  await logTime(t.res_id, { hours, description: description.trim() || '/', date });
  await odoo.call('timer.timer', 'unlink', [[t.id]]);
  return { taskId: t.res_id, hours };
}
