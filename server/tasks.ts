import { HttpError, fromOdoo, odoo, ref, toOdoo } from './odoo.js';
import { assertCanStart, startTimer } from './timer.js';
import type { NewTask, ProjectBoard, ProjectSummary, Ref, Stage, StageGroup, Task, TaskDetail, TaskPatch, TaskState } from './types.js';

export const TASK_STATES: TaskState[] = ['01_in_progress', '02_changes_requested', '03_approved', '04_waiting_normal', '1_done', '1_canceled'];
const OPEN: unknown[] = ['state', 'not in', ['1_done', '1_canceled']];
const FIELDS = ['name', 'project_id', 'stage_id', 'state', 'priority', 'date_deadline', 'user_ids', 'tag_ids', 'allocated_hours', 'effective_hours'];

type RawTask = {
  id: number; name: string; project_id: unknown; stage_id: unknown; state: TaskState; priority: string;
  date_deadline: string | false; user_ids: number[]; tag_ids: number[]; allocated_hours: number; effective_hours: number;
};

// ---------- Fechas y textos ----------

/** Minúsculas y sin acentos, para comparar nombres ("Documentación" = "documentacion"). */
export const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

/**
 * Fecha u hora que manda el cliente → formato UTC de Odoo.
 * "YYYY-MM-DD" = medianoche local (como lo guarda la interfaz de Odoo); una fecha-hora sin zona se toma como hora local.
 */
export function parseWhen(value: string, field: string): Date {
  const v = value.trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00`) : new Date(v);
  if (Number.isNaN(d.getTime())) throw new HttpError(`${field}: fecha inválida "${value}" (usa YYYY-MM-DD o YYYY-MM-DDTHH:MM)`, 400);
  return d;
}

const localDate = (d: Date) => d.toLocaleDateString('en-CA');

async function normalize(rows: RawTask[]): Promise<Task[]> {
  const { uid } = await odoo.me();
  const [users, tags] = await Promise.all([
    odoo.nameMap('res.users', rows.flatMap((r) => r.user_ids)),
    odoo.nameMap('project.tags', rows.flatMap((r) => r.tag_ids)),
  ]);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    project: ref(r.project_id),
    stage: ref(r.stage_id),
    state: r.state,
    priority: r.priority === '1',
    deadline: r.date_deadline ? localDate(fromOdoo(r.date_deadline)!) : null,
    deadlineAt: fromOdoo(r.date_deadline)?.toISOString() ?? null,
    assignees: r.user_ids.map((id) => ({ id, name: users.get(id) ?? `#${id}` })),
    tags: r.tag_ids.map((id) => tags.get(id) ?? ''),
    allocatedHours: r.allocated_hours,
    effectiveHours: r.effective_hours,
    mine: r.user_ids.includes(uid),
    url: odoo.recordUrl('project.task', r.id),
  }));
}

/** HTML de Odoo → texto plano legible. */
function htmlToText(html: unknown): string {
  if (typeof html !== 'string') return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------- Mis tareas ----------

export async function myTasks(): Promise<Task[]> {
  const { uid } = await odoo.me();
  const rows = await odoo.searchRead<RawTask>('project.task', [['user_ids', 'in', [uid]], OPEN], {
    fields: FIELDS, order: 'priority desc, date_deadline asc, id desc', limit: 500,
  });
  return normalize(rows);
}

// ---------- Proyectos donde participo ----------

let projectsCache: { at: number; ids: number[] } | null = null;

async function myProjectIds(): Promise<number[]> {
  if (projectsCache && Date.now() - projectsCache.at < 5 * 60_000) return projectsCache.ids;
  const { uid, partnerId } = await odoo.me();
  const [withTasks, followed] = await Promise.all([
    odoo.call<{ project_id: [number, string] | false }[]>('project.task', 'read_group',
      [[['user_ids', 'in', [uid]], ['project_id', '!=', false]], ['project_id'], ['project_id']], { lazy: false }),
    odoo.call<number[]>('project.project', 'search', [['|', ['user_id', '=', uid], ['message_partner_ids', 'in', [partnerId]]]]),
  ]);
  const ids = [...new Set([...withTasks.flatMap((g) => (g.project_id ? [g.project_id[0]] : [])), ...followed])];
  projectsCache = { at: Date.now(), ids };
  return ids;
}

async function countBy(domain: unknown[], field: string): Promise<Map<number | false, number>> {
  const groups = await odoo.call<Record<string, unknown>[]>('project.task', 'read_group', [domain, [field], [field]], { lazy: false });
  return new Map(groups.map((g) => [Array.isArray(g[field]) ? (g[field] as [number])[0] : false, g.__count as number]));
}

/** Proyectos donde participo; `q` filtra por palabras sin importar acentos ni mayúsculas ("apidiv gdl"). */
export async function projects(q?: string): Promise<ProjectSummary[]> {
  const all = await allProjects();
  const words = fold(q ?? '').split(/\s+/).filter(Boolean);
  return words.length ? all.filter((p) => words.every((w) => fold(p.name).includes(w))) : all;
}

async function allProjects(): Promise<ProjectSummary[]> {
  const ids = await myProjectIds();
  if (!ids.length) return [];
  const { uid } = await odoo.me();
  const [rows, open, mine] = await Promise.all([
    odoo.call<{ id: number; name: string; is_favorite: boolean; allow_timesheets: boolean }[]>('project.project', 'read', [ids],
      { fields: ['name', 'is_favorite', 'allow_timesheets'] }),
    countBy([['project_id', 'in', ids], OPEN], 'project_id'),
    countBy([['project_id', 'in', ids], ['user_ids', 'in', [uid]], OPEN], 'project_id'),
  ]);
  return rows
    .map((p) => ({
      id: p.id, name: p.name, favorite: p.is_favorite, allowTimesheets: p.allow_timesheets,
      openTasks: open.get(p.id) ?? 0, myOpenTasks: mine.get(p.id) ?? 0,
    }))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.myOpenTasks - a.myOpenTasks || a.name.localeCompare(b.name));
}

export async function stages(projectId: number): Promise<Stage[]> {
  const rows = await odoo.searchRead<{ id: number; name: string; fold: boolean }>('project.task.type',
    [['project_ids', 'in', [projectId]]], { fields: ['name', 'fold'], order: 'sequence, id' });
  return rows.map((s) => ({ id: s.id, name: s.name, fold: s.fold }));
}

/** Etapas de varios proyectos en una sola consulta: { [projectId]: Stage[] }. */
export async function stagesFor(projectIds: number[]): Promise<Record<number, Stage[]>> {
  const ids = [...new Set(projectIds)].slice(0, 100);
  const out: Record<number, Stage[]> = Object.fromEntries(ids.map((id) => [id, []]));
  if (!ids.length) return out;
  const rows = await odoo.searchRead<{ id: number; name: string; fold: boolean; project_ids: number[] }>('project.task.type',
    [['project_ids', 'in', ids]], { fields: ['name', 'fold', 'project_ids'], order: 'sequence, id' });
  for (const s of rows) {
    for (const pid of s.project_ids) out[pid]?.push({ id: s.id, name: s.name, fold: s.fold });
  }
  return out;
}

/** Tareas abiertas de un proyecto agrupadas por etapa; `limit` tareas por etapa (paginadas con `offset`). */
export async function board(projectId: number, opts: { mine?: boolean; q?: string; stageId?: number | null; limit?: number; offset?: number }): Promise<ProjectBoard> {
  const { uid } = await odoo.me();
  const all = await projects();
  const project = all.find((p) => p.id === projectId);
  if (!project) throw new HttpError('Proyecto no encontrado o no participas en él', 404);

  const domain: unknown[] = [['project_id', '=', projectId], OPEN];
  if (opts.mine) domain.push(['user_ids', 'in', [uid]]);
  if (opts.q) domain.push(['name', 'ilike', opts.q]);

  const [stageList, counts] = await Promise.all([stages(projectId), countBy(domain, 'stage_id')]);
  const keys: (number | false)[] = stageList.map((s) => s.id);
  if (counts.has(false)) keys.push(false);
  const wanted = opts.stageId === undefined ? keys : keys.filter((k) => k === (opts.stageId ?? false));

  const limit = Math.min(opts.limit ?? 40, 200);
  const groups: StageGroup[] = await Promise.all(
    wanted.map(async (key) => {
      const count = counts.get(key) ?? 0;
      const rows = count
        ? await odoo.searchRead<RawTask>('project.task', [...domain, ['stage_id', '=', key]], {
            fields: FIELDS, order: 'priority desc, date_deadline asc, id desc', limit, offset: opts.offset ?? 0,
          })
        : [];
      return { stage: stageList.find((s) => s.id === key) ?? null, count, tasks: await normalize(rows) };
    }),
  );
  return { project, stages: stageList, groups, total: [...counts.values()].reduce((a, b) => a + b, 0) };
}

// ---------- Etiquetas ----------

let tagsCache: { at: number; tags: Ref[] } | null = null;

async function allTags(): Promise<Ref[]> {
  if (tagsCache && Date.now() - tagsCache.at < 5 * 60_000) return tagsCache.tags;
  const rows = await odoo.searchRead<{ id: number; name: string }>('project.tags', [], { fields: ['name'], order: 'name' });
  tagsCache = { at: Date.now(), tags: rows.map((t) => ({ id: t.id, name: t.name })) };
  return tagsCache.tags;
}

export async function findTags(q?: string): Promise<Ref[]> {
  const tags = await allTags();
  const f = fold(q ?? '');
  return f ? tags.filter((t) => fold(t.name).includes(f)).slice(0, 50) : tags;
}

/**
 * Nombres de etiqueta → ids. Coincide sin importar acentos ni mayúsculas.
 * Las que no existen solo se crean con `create: true`; si no, error 422 con la lista, para que alguien lo confirme.
 */
async function resolveTags(names: string[], create = false): Promise<number[]> {
  const tags = await allTags();
  const wanted = [...new Map(names.map((n) => n.trim()).filter(Boolean).map((n) => [fold(n), n])).values()];
  const ids: number[] = [];
  const missing: string[] = [];
  for (const name of wanted) {
    const hit = tags.find((t) => fold(t.name) === fold(name));
    if (hit) ids.push(hit.id);
    else missing.push(name);
  }
  if (missing.length && !create) {
    throw new HttpError(`No existen las etiquetas: ${missing.join(', ')}. Para crearlas envía createMissingTags: true.`, 422);
  }
  for (const name of missing) {
    const [id] = await odoo.call<[number, string]>('project.tags', 'name_create', [name.charAt(0).toUpperCase() + name.slice(1)]);
    ids.push(id);
  }
  if (missing.length) tagsCache = null;
  return ids;
}

async function assertStage(projectId: number, stageId: number) {
  const list = await stages(projectId);
  if (!list.some((s) => s.id === stageId)) {
    throw new HttpError(`La etapa ${stageId} no pertenece al proyecto. Etapas: ${list.map((s) => `${s.id} ${s.name}`).join(', ')}`, 422);
  }
}

// ---------- Detalle y acciones ----------

export async function task(id: number): Promise<TaskDetail> {
  const [row] = await odoo.call<(RawTask & { description: string | false })[]>('project.task', 'read', [[id]], {
    fields: [...FIELDS, 'description'],
  });
  if (!row) throw new HttpError('Tarea no encontrada', 404);
  const [[base], lines, messages] = await Promise.all([
    normalize([row]),
    odoo.searchRead<{ id: number; date: string; name: string; unit_amount: number; employee_id: unknown }>('account.analytic.line',
      [['task_id', '=', id]], { fields: ['date', 'name', 'unit_amount', 'employee_id'], order: 'date desc, id desc', limit: 20 }),
    odoo.searchRead<{ id: number; date: string; author_id: unknown; body: string }>('mail.message',
      [['model', '=', 'project.task'], ['res_id', '=', id], ['message_type', '=', 'comment']],
      { fields: ['date', 'author_id', 'body'], order: 'date desc, id desc', limit: 15 }),
  ]);
  return {
    ...base,
    description: htmlToText(row.description),
    timesheets: lines.map((l) => ({ id: l.id, date: l.date, name: l.name, hours: l.unit_amount, employee: ref(l.employee_id)?.name ?? null })),
    messages: messages.map((m) => ({ id: m.id, date: fromOdoo(m.date)!.toISOString(), author: ref(m.author_id)?.name ?? null, body: htmlToText(m.body) })),
  };
}

/** Valores de Odoo comunes a crear y editar. */
async function taskVals(projectId: number, p: TaskPatch): Promise<Record<string, unknown>> {
  const vals: Record<string, unknown> = {};
  if (p.stageId !== undefined) {
    await assertStage(projectId, p.stageId);
    vals.stage_id = p.stageId;
  }
  if (p.state !== undefined) {
    if (!TASK_STATES.includes(p.state)) throw new HttpError(`Estado inválido: ${p.state}`, 400);
    vals.state = p.state;
  }
  if (p.priority !== undefined) vals.priority = p.priority ? '1' : '0';
  if (p.deadline !== undefined) vals.date_deadline = p.deadline ? toOdoo(parseWhen(p.deadline, 'deadline')) : false;
  if (p.plannedStart !== undefined) vals.planned_date_begin = p.plannedStart ? toOdoo(parseWhen(p.plannedStart, 'plannedStart')) : false;
  if (p.name !== undefined) {
    if (!p.name.trim()) throw new HttpError('La tarea necesita un nombre', 400);
    vals.name = p.name.trim();
  }
  if (p.allocatedHours !== undefined) {
    if (!(p.allocatedHours >= 0 && p.allocatedHours <= 1000)) throw new HttpError('allocatedHours debe estar entre 0 y 1000', 400);
    vals.allocated_hours = p.allocatedHours;
  }
  if (p.tags !== undefined && !(Array.isArray(p.tags) && p.tags.every((t) => typeof t === 'string'))) {
    throw new HttpError('tags debe ser una lista de nombres', 400);
  }
  if (p.tags !== undefined) vals.tag_ids = [[6, 0, await resolveTags(p.tags, p.createMissingTags)]];
  return vals;
}

async function projectOf(id: number): Promise<number> {
  const [row] = await odoo.call<{ project_id: unknown }[]>('project.task', 'read', [[id]], { fields: ['project_id'] });
  if (!row) throw new HttpError('Tarea no encontrada', 404);
  const project = ref(row.project_id);
  if (!project) throw new HttpError('La tarea no tiene proyecto', 422);
  return project.id;
}

export async function updateTask(id: number, patch: TaskPatch) {
  const vals = await taskVals(await projectOf(id), patch);
  if (!Object.keys(vals).length) throw new HttpError('Nada que actualizar', 400);
  await odoo.call('project.task', 'write', [[id], vals]);
  return task(id);
}

export async function logTime(id: number, input: { hours: number; description: string; date?: string }) {
  if (!(input.hours > 0 && input.hours <= 24)) throw new HttpError('Las horas deben estar entre 0 y 24', 400);
  const [row] = await odoo.call<{ project_id: unknown }[]>('project.task', 'read', [[id]], { fields: ['project_id'] });
  const project = ref(row?.project_id);
  if (!project) throw new HttpError('La tarea no tiene proyecto; no se pueden registrar horas', 422);
  const { employeeId } = await odoo.me();
  await odoo.call('account.analytic.line', 'create', [{
    task_id: id,
    project_id: project.id,
    name: input.description || '/',
    unit_amount: input.hours,
    date: input.date ?? new Date().toLocaleDateString('en-CA'),
    ...(employeeId ? { employee_id: employeeId } : {}),
  }]);
  return task(id);
}

export async function comment(id: number, body: string) {
  if (!body.trim()) throw new HttpError('El comentario está vacío', 400);
  await odoo.call('project.task', 'message_post', [[id]], { body, message_type: 'comment', subtype_xmlid: 'mail.mt_comment' });
  return task(id);
}

export async function createTask(input: NewTask) {
  if (!input.name?.trim()) throw new HttpError('La tarea necesita un nombre', 400);
  if (!(await projects()).some((p) => p.id === input.projectId)) throw new HttpError('Proyecto no encontrado o no participas en él', 404);
  const { uid } = await odoo.me();
  const { projectId, description, assignToMe, startedAt, ...rest } = input;
  if (startedAt) await assertCanStart(startedAt);               // validar antes de crear nada (tarea o etiquetas)
  const vals: Record<string, unknown> = { project_id: projectId, ...(await taskVals(projectId, rest)) };
  if (description) vals.description = description.split('\n').map((l) => `<p>${escapeHtml(l)}</p>`).join('');
  vals.user_ids = assignToMe === false ? [[6, 0, []]] : [[6, 0, [uid]]];
  const id = await odoo.call<number>('project.task', 'create', [vals]);
  projectsCache = null;
  if (startedAt) await startTimer(id, startedAt);
  return task(id);
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
