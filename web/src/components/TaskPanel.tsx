import { useEffect, useState, type FormEvent } from 'react';
import { api, type Ref, type Stage, type TaskDetail, type TaskState } from '../api';
import { fmtMinutes, todayAt, useTimer } from '../timer';
import { Empty, STATE_LABEL, Spinner, Star, deadlineInfo, hhmm, useAction, useLoad } from '../ui';
import { DeadlineInput, TagPicker, UserPicker, forgetTags, joinDeadline, myUid, splitDeadline, tagsPayload, type PickedTag } from './TaskFields';
import { StopTimerForm } from './TimerBar';

const STATES = Object.keys(STATE_LABEL) as TaskState[];

export function TaskPanel({ taskId, version, onClose, onChanged }: { taskId: number; version: number; onClose: () => void; onChanged: () => void }) {
  // `version` cambia cuando algo se edita desde la lista: recargar para no mostrar datos viejos.
  const { data: t, setData, error, loading } = useLoad(() => api.task(taskId), [taskId, version]);
  const [stages, setStages] = useState<Stage[]>([]);
  const { busy, run } = useAction();

  useEffect(() => {
    setStages([]);
    if (t?.project) api.stages(t.project.id).then(setStages).catch(() => {});
  }, [t?.project?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const apply = async (key: string, fn: () => Promise<TaskDetail>, ok: string) => {
    const r = await run(key, fn, ok);
    if (r) { setData(r); onChanged(); }
    return r;
  };

  return (
    <aside className="fixed inset-y-0 right-0 z-30 flex w-full max-w-xl flex-col border-l border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex items-start gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-zinc-500">{t?.project?.name ?? (t ? 'Sin proyecto' : '')}</p>
          <h2 className="flex items-start gap-2 text-lg font-semibold leading-snug">
            {t && <span className="mt-1.5"><Star on={t.priority} onClick={() => apply('prio', () => api.updateTask(t.id, { priority: !t.priority }), 'Prioridad actualizada')} /></span>}
            {t?.name ?? 'Cargando…'}
          </h2>
        </div>
        {t && <a className="btn-ghost shrink-0" href={t.url} target="_blank" rel="noreferrer">Abrir en Odoo ↗</a>}
        <button className="btn-ghost shrink-0" onClick={onClose} aria-label="Cerrar">✕</button>
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto p-4">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!t && loading && <Empty><Spinner /></Empty>}
        {t && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="tp-stage">Etapa</label>
                <select id="tp-stage" className="input" disabled={!t.project || !!busy} value={t.stage?.id ?? ''}
                  onChange={(e) => apply('stage', () => api.updateTask(t.id, { stageId: Number(e.target.value) }), 'Etapa actualizada')}>
                  {!t.stage && <option value="">Sin etapa</option>}
                  {stages.length === 0 && t.stage && <option value={t.stage.id}>{t.stage.name}</option>}
                  {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="tp-state">Estado</label>
                <select id="tp-state" className="input" disabled={!!busy} value={t.state}
                  onChange={(e) => apply('state', () => api.updateTask(t.id, { state: e.target.value as TaskState }), 'Estado actualizado')}>
                  {STATES.map((s) => <option key={s} value={s}>{STATE_LABEL[s]}</option>)}
                </select>
              </div>
              <Deadline task={t} busy={!!busy} onSave={(deadline) => apply('deadline', () => api.updateTask(t.id, { deadline }), 'Fecha límite actualizada')} />
              <Hours task={t} busy={!!busy} onSave={(allocatedHours) => apply('hours', () => api.updateTask(t.id, { allocatedHours }), 'Horas estimadas actualizadas')} />
              <div className="col-span-2">
                <label className="label" htmlFor="tp-tags">Etiquetas</label>
                <TagPicker id="tp-tags" disabled={!!busy} value={t.tags.map((name) => ({ name, isNew: false }))}
                  onChange={async (tags: PickedTag[]) => {
                    // Aquí se guarda al instante: crear etiquetas en Odoo requiere confirmarlo.
                    const created = tags.filter((x) => x.isNew).map((x) => `«${x.name}»`);
                    if (created.length && !window.confirm(`¿Crear en Odoo la etiqueta ${created.join(', ')}? La verán todos los proyectos.`)) return;
                    if (await apply('tags', () => api.updateTask(t.id, tagsPayload(tags)), 'Etiquetas actualizadas') && tags.some((x) => x.isNew)) forgetTags();
                  }} />
              </div>
              <div className="col-span-2">
                <label className="label" htmlFor="tp-users">Asignada a</label>
                <UserPicker id="tp-users" disabled={!!busy} value={t.assignees} placeholder="Nadie; buscar persona…"
                  onChange={async (users: Ref[]) => {
                    // Se guarda al instante; quitarse a uno mismo saca la tarea de "Mis tareas", así que se confirma.
                    const me = await myUid().catch(() => null);
                    if (me && t.assignees.some((u) => u.id === me) && !users.some((u) => u.id === me)
                      && !window.confirm('¿Quitarte de esta tarea? Dejará de aparecer en tus tareas.')) return;
                    await apply('users', () => api.updateTask(t.id, { userIds: users.map((u) => u.id) }), 'Asignados actualizados');
                  }} />
              </div>
            </div>

            {t.state !== '1_done' && (
              <button className="btn-primary w-full" disabled={!!busy}
                onClick={() => apply('done', () => api.updateTask(t.id, { state: '1_done' }), 'Tarea marcada como hecha ✅')}>
                {busy === 'done' && <Spinner className="size-3" />} Marcar como hecha
              </button>
            )}

            {t.project && <TimerSection taskId={t.id} />}

            {t.description && (
              <section>
                <h3 className="mb-1 text-sm font-semibold">Descripción</h3>
                <p className="max-h-60 overflow-y-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-sm text-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300">{t.description}</p>
              </section>
            )}

            <LogTime task={t} busy={!!busy} onSubmit={(input) => apply('time', () => api.logTime(t.id, input), `${input.hours} h registradas`)} />
            <Comments task={t} busy={!!busy} onSubmit={(body) => apply('comment', () => api.comment(t.id, body), 'Comentario publicado')} />
          </>
        )}
      </div>
    </aside>
  );
}

function Deadline({ task, busy, onSave }: { task: TaskDetail; busy: boolean; onSave: (v: string | null) => Promise<unknown> }) {
  const server = splitDeadline(task.deadlineAt);
  const [v, setV] = useState(server);
  useEffect(() => setV(splitDeadline(task.deadlineAt)), [task.deadlineAt]);
  const dirty = v.date !== server.date || v.time !== server.time;
  return (
    <div className="col-span-2 sm:col-span-1">
      <label className="label" htmlFor="tp-deadline">Fecha límite <span className="font-normal">(sin hora = fin de la jornada)</span></label>
      <DeadlineInput id="tp-deadline" date={v.date} time={v.time} disabled={busy} onChange={(date, time) => setV({ date, time })} />
      {dirty
        ? <div className="mt-1 flex gap-2 text-xs">
            <button className="font-medium text-brand-600 hover:underline" onClick={() => onSave(joinDeadline(v.date, v.time))}>Guardar fecha</button>
            <button className="text-zinc-500 hover:underline" onClick={() => setV(server)}>Descartar</button>
          </div>
        : deadlineInfo(task.deadline)?.overdue && <p className="mt-1 text-xs text-red-600">Vencida</p>}
    </div>
  );
}

function Hours({ task, busy, onSave }: { task: TaskDetail; busy: boolean; onSave: (v: number) => Promise<unknown> }) {
  const [v, setV] = useState(task.allocatedHours ? String(task.allocatedHours) : '');
  useEffect(() => setV(task.allocatedHours ? String(task.allocatedHours) : ''), [task.allocatedHours]);
  const save = () => { const n = Number(v || 0); if (n !== task.allocatedHours && n >= 0) onSave(n); };
  const over = task.allocatedHours > 0 && task.effectiveHours > task.allocatedHours;
  return (
    <div className="col-span-2 sm:col-span-1">
      <label className="label" htmlFor="tp-hours">Horas estimadas</label>
      <input id="tp-hours" type="number" min="0" max="1000" step="0.25" className="input" placeholder="—" disabled={busy} value={v}
        onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      <p className={`mt-1 text-xs tabular-nums ${over ? 'text-red-600' : 'text-zinc-500'}`}>
        {task.effectiveHours.toFixed(2)} h registradas{over && ' · excede lo estimado'}
      </p>
    </div>
  );
}

const nowHHMM = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/** Iniciar o detener el temporizador de Odoo para esta tarea. */
function TimerSection({ taskId }: { taskId: number }) {
  const { timer, minutes, start } = useTimer();
  const [backdate, setBackdate] = useState(false);
  const [at, setAt] = useState(nowHHMM);
  const [busy, setBusy] = useState(false);

  if (timer?.taskId === taskId) {
    return (
      <section className="rounded-lg border border-brand-500/50 bg-brand-50 p-3 dark:bg-brand-700/15">
        <p className="mb-2 text-sm">
          ⏱ Temporizador corriendo desde <b>{hhmm(timer.startedAt)}</b> · <span className="tabular-nums">{fmtMinutes(minutes)}</span>
        </p>
        <StopTimerForm />
      </section>
    );
  }
  if (timer) {
    return <p className="rounded-lg bg-zinc-50 p-3 text-xs text-zinc-500 dark:bg-zinc-800/50">Hay un temporizador corriendo en <b>{timer.taskName}</b>; detenlo para iniciar uno aquí.</p>;
  }
  const future = backdate && at > nowHHMM();
  return (
    <section className="flex flex-wrap items-center gap-3 text-sm">
      <button className="btn-ghost" disabled={busy || future} onClick={async () => {
        setBusy(true);
        await start(taskId, backdate ? todayAt(at) : undefined);
        setBusy(false);
      }}>{busy && <Spinner className="size-3" />} ⏱ Iniciar temporizador</button>
      <label className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
        <input type="checkbox" className="accent-brand-600" checked={backdate} onChange={(e) => { setBackdate(e.target.checked); setAt(nowHHMM()); }} />
        empecé a las
        <input type="time" className="input w-28" disabled={!backdate} value={at} onChange={(e) => setAt(e.target.value)} aria-label="Hora de inicio" />
      </label>
      {future && <span className="text-xs text-red-600">No puede ser futura.</span>}
    </section>
  );
}

function LogTime({ task, busy, onSubmit }: { task: TaskDetail; busy: boolean; onSubmit: (i: { hours: number; description: string; date: string }) => Promise<unknown> }) {
  const [hours, setHours] = useState('1');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(() => new Date().toLocaleDateString('en-CA'));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await onSubmit({ hours: Number(hours), description, date });
    if (r) setDescription('');
  };
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">Registrar horas</h3>
      {!task.project ? <p className="text-xs text-zinc-500">La tarea no tiene proyecto; no se pueden registrar horas.</p> : (
        <form onSubmit={submit} className="grid grid-cols-[90px_140px_1fr_auto] items-end gap-2">
          <div><label className="label" htmlFor="lt-h">Horas</label>
            <input id="lt-h" type="number" min="0.25" max="24" step="0.25" className="input" value={hours} onChange={(e) => setHours(e.target.value)} required /></div>
          <div><label className="label" htmlFor="lt-d">Fecha</label>
            <input id="lt-d" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required /></div>
          <div><label className="label" htmlFor="lt-desc">Qué hiciste</label>
            <input id="lt-desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descripción" required /></div>
          <button className="btn-primary" disabled={busy}>Guardar</button>
        </form>
      )}
      {task.timesheets.length > 0 && (
        <ul className="mt-3 divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
          {task.timesheets.map((l) => (
            <li key={l.id} className="flex gap-3 py-1.5">
              <span className="w-20 shrink-0 tabular-nums text-zinc-500">{new Date(`${l.date}T12:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}</span>
              <span className="min-w-0 flex-1 truncate">{l.name}</span>
              <span className="shrink-0 text-xs text-zinc-500">{l.employee?.split(' ')[0]}</span>
              <span className="w-14 shrink-0 text-right tabular-nums">{l.hours.toFixed(2)} h</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Comments({ task, busy, onSubmit }: { task: TaskDetail; busy: boolean; onSubmit: (body: string) => Promise<unknown> }) {
  const [body, setBody] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await onSubmit(body)) setBody('');
  };
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">Comentarios</h3>
      <form onSubmit={submit} className="space-y-2">
        <textarea className="input min-h-20" placeholder="Escribe un comentario (se publica en el chatter de Odoo)…" value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="flex justify-end"><button className="btn-primary" disabled={busy || !body.trim()}>Comentar</button></div>
      </form>
      <ul className="mt-3 space-y-3">
        {task.messages.map((m) => (
          <li key={m.id} className="rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-800/50">
            <div className="mb-1 flex justify-between text-xs text-zinc-500">
              <span className="font-medium">{m.author}</span>
              <span>{new Date(m.date).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <p className="whitespace-pre-wrap">{m.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
