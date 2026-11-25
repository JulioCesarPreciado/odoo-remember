import { useEffect, useState, type FormEvent } from 'react';
import { api, type Stage, type TaskDetail, type TaskState } from '../api';
import { Empty, STATE_LABEL, Spinner, Star, deadlineInfo, useAction, useLoad } from '../ui';

const STATES = Object.keys(STATE_LABEL) as TaskState[];

export function TaskPanel({ taskId, onClose, onChanged }: { taskId: number; onClose: () => void; onChanged: () => void }) {
  const { data: t, setData, error, loading } = useLoad(() => api.task(taskId), [taskId]);
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
          <h2 className="text-lg font-semibold leading-snug">{t?.name ?? 'Cargando…'}</h2>
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
              <div>
                <label className="label" htmlFor="tp-deadline">Fecha límite</label>
                <input id="tp-deadline" type="date" className="input" disabled={!!busy} value={t.deadline ?? ''}
                  onChange={(e) => apply('deadline', () => api.updateTask(t.id, { deadline: e.target.value || null }), 'Fecha actualizada')} />
                {deadlineInfo(t.deadline)?.overdue && <p className="mt-1 text-xs text-red-600">Vencida</p>}
              </div>
              <div>
                <span className="label">Prioridad · Horas</span>
                <div className="flex h-[34px] items-center gap-3 text-sm">
                  <Star on={t.priority} onClick={() => apply('prio', () => api.updateTask(t.id, { priority: !t.priority }), 'Prioridad actualizada')} />
                  <span className="tabular-nums text-zinc-600 dark:text-zinc-400">
                    {t.effectiveHours.toFixed(2)} h{t.allocatedHours > 0 && ` de ${t.allocatedHours.toFixed(2)} h`}
                  </span>
                </div>
              </div>
            </div>

            {t.state !== '1_done' && (
              <button className="btn-primary w-full" disabled={!!busy}
                onClick={() => apply('done', () => api.updateTask(t.id, { state: '1_done' }), 'Tarea marcada como hecha ✅')}>
                {busy === 'done' && <Spinner className="size-3" />} Marcar como hecha
              </button>
            )}

            <div className="text-xs text-zinc-500">Asignada a: {t.assignees.map((a) => a.name).join(', ') || 'nadie'}</div>

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
