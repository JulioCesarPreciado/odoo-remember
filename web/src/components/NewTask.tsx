import { useEffect, useState, type FormEvent } from 'react';
import { api, type Estimate, type ProjectSummary, type Ref, type Stage, type TaskDetail } from '../api';
import { todayAt, useTimer } from '../timer';
import { Spinner, hhmm, useAction } from '../ui';
import { DeadlineInput, TagPicker, UserPicker, forgetTags, joinDeadline, tagsPayload, type PickedTag } from './TaskFields';

const nowHHMM = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export function NewTask({ project, stages, onClose, onCreated }: {
  project: ProjectSummary; stages: Stage[]; onClose: () => void; onCreated: (t: TaskDetail) => void;
}) {
  const firstOpen = stages.find((s) => !s.fold) ?? stages[0];
  const [name, setName] = useState('');
  const [stageId, setStageId] = useState<number | undefined>(firstOpen?.id);
  const [deadline, setDeadline] = useState({ date: '', time: '' });
  const [hours, setHours] = useState('');
  const [tags, setTags] = useState<PickedTag[]>([]);
  const [description, setDescription] = useState('');
  const [assignToMe, setAssignToMe] = useState(true);
  const [others, setOthers] = useState<Ref[]>([]);
  const [priority, setPriority] = useState(false);
  const [started, setStarted] = useState(false);
  const [startedAt, setStartedAt] = useState(nowHHMM);
  const { busy, run } = useAction();
  const timer = useTimer();

  const startInFuture = started && startedAt > nowHHMM();

  // El servidor resuelve la fecha límite (sin hora = fin de la jornada) y calcula el tiempo laboral disponible,
  // que se usa como horas estimadas si el campo se deja vacío.
  const deadlineValue = joinDeadline(deadline.date, deadline.time);
  const startValue = started && !startInFuture ? todayAt(startedAt) : undefined;
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  useEffect(() => {
    if (!deadlineValue) { setEstimate(null); return; }
    let live = true;
    api.estimate(deadlineValue, startValue).then((e) => live && setEstimate(e), () => live && setEstimate(null));
    return () => { live = false; };
  }, [deadlineValue, startValue]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = await run('create', () => api.createTask({
      projectId: project.id, name, stageId, assignToMe, priority,
      userIds: others.length ? others.map((u) => u.id) : undefined,
      description: description || undefined,
      deadline: deadlineValue ?? undefined,
      allocatedHours: hours ? Number(hours) : undefined,
      ...(tags.length ? tagsPayload(tags) : {}),
      startedAt: started ? todayAt(startedAt) : undefined,
    }), started ? 'Tarea creada y temporizador iniciado' : 'Tarea creada');
    if (!t) return;
    if (tags.some((x) => x.isNew)) forgetTags();
    if (started) timer.refresh();
    onCreated(t);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="card max-h-full w-full max-w-lg space-y-3 overflow-y-auto p-5 shadow-xl">
        <div>
          <h2 className="text-base font-semibold">Nueva tarea</h2>
          <p className="text-xs text-zinc-500">{project.name}</p>
        </div>
        <div>
          <label className="label" htmlFor="nt-name">Nombre</label>
          <input id="nt-name" className="input" autoFocus required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <div>
            <label className="label" htmlFor="nt-stage">Etapa</label>
            <select id="nt-stage" className="input" value={stageId ?? ''} onChange={(e) => setStageId(Number(e.target.value) || undefined)}>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="nt-hours">Horas estimadas</label>
            <input id="nt-hours" type="number" min="0" max="1000" step="0.25" className="input" placeholder={estimate?.hours ? `${estimate.hours} (auto)` : '—'}
              value={hours} onChange={(e) => setHours(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="nt-deadline">Fecha límite <span className="font-normal">(sin hora = fin de la jornada)</span></label>
          <DeadlineInput id="nt-deadline" date={deadline.date} time={deadline.time} onChange={(date, time) => setDeadline({ date, time })} />
          <p className="mt-1 text-xs text-zinc-500">
            Inicio planeado: {started ? `hoy a las ${startedAt}` : 'al crear la tarea'}
            {estimate?.deadline && !deadline.time && <> · vence a las {hhmm(estimate.deadline)}</>}
            {estimate && !estimate.start && <> · la fecha límite ya pasó, no se fijará inicio</>}
            {!hours && estimate?.hours ? <> · se estimarán <b>{estimate.hours} h</b> (tiempo laboral hasta la fecha límite)</> : null}
          </p>
        </div>
        <div>
          <label className="label" htmlFor="nt-tags">Etiquetas</label>
          <TagPicker id="nt-tags" value={tags} onChange={setTags} />
        </div>
        <div>
          <label className="label" htmlFor="nt-users">{assignToMe ? 'Asignar también a' : 'Asignar a'}</label>
          <UserPicker id="nt-users" value={others} onChange={setOthers} />
        </div>
        <div>
          <label className="label" htmlFor="nt-desc">Descripción</label>
          <textarea id="nt-desc" className="input min-h-20" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-1.5"><input type="checkbox" className="accent-brand-600" checked={assignToMe} onChange={(e) => setAssignToMe(e.target.checked)} /> Asignármela</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" className="accent-brand-600" checked={priority} onChange={(e) => setPriority(e.target.checked)} /> Prioridad alta</label>
        </div>

        <div className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-700">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" className="accent-brand-600" checked={started} disabled={!!timer.timer}
              onChange={(e) => { setStarted(e.target.checked); setStartedAt(nowHHMM()); }} />
            Ya empecé a trabajar en ella a las
            <input type="time" className="input ml-1 w-28" disabled={!started} value={startedAt} max={nowHHMM()}
              onChange={(e) => setStartedAt(e.target.value)} aria-label="Hora de inicio" />
          </label>
          <p className="mt-1 text-xs text-zinc-500">
            {timer.timer
              ? <>Ya hay un temporizador en <b>{timer.timer.taskName}</b>; detenlo primero para iniciar otro.</>
              : 'Inicia el temporizador de Odoo desde esa hora; al detenerlo se registran las horas.'}
          </p>
          {startInFuture && <p className="mt-1 text-xs text-red-600">La hora de inicio no puede ser futura.</p>}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={!!busy || !name.trim() || startInFuture}>{busy && <Spinner className="size-3" />} Crear tarea</button>
        </div>
      </form>
    </div>
  );
}
