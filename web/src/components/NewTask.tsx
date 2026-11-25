import { useState, type FormEvent } from 'react';
import { api, type ProjectSummary, type Stage, type TaskDetail } from '../api';
import { Spinner, useAction } from '../ui';

export function NewTask({ project, stages, onClose, onCreated }: {
  project: ProjectSummary; stages: Stage[]; onClose: () => void; onCreated: (t: TaskDetail) => void;
}) {
  const firstOpen = stages.find((s) => !s.fold) ?? stages[0];
  const [name, setName] = useState('');
  const [stageId, setStageId] = useState<number | undefined>(firstOpen?.id);
  const [deadline, setDeadline] = useState('');
  const [description, setDescription] = useState('');
  const [assignToMe, setAssignToMe] = useState(true);
  const [priority, setPriority] = useState(false);
  const { busy, run } = useAction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = await run('create', () => api.createTask({
      projectId: project.id, name, stageId, description: description || undefined, deadline: deadline || undefined, assignToMe, priority,
    }), 'Tarea creada');
    if (t) onCreated(t);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="card w-full max-w-lg space-y-3 p-5 shadow-xl">
        <div>
          <h2 className="text-base font-semibold">Nueva tarea</h2>
          <p className="text-xs text-zinc-500">{project.name}</p>
        </div>
        <div>
          <label className="label" htmlFor="nt-name">Nombre</label>
          <input id="nt-name" className="input" autoFocus required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="nt-stage">Etapa</label>
            <select id="nt-stage" className="input" value={stageId ?? ''} onChange={(e) => setStageId(Number(e.target.value) || undefined)}>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="nt-deadline">Fecha límite</label>
            <input id="nt-deadline" type="date" className="input" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="nt-desc">Descripción</label>
          <textarea id="nt-desc" className="input min-h-24" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-1.5"><input type="checkbox" className="accent-brand-600" checked={assignToMe} onChange={(e) => setAssignToMe(e.target.checked)} /> Asignármela</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" className="accent-brand-600" checked={priority} onChange={(e) => setPriority(e.target.checked)} /> Prioridad alta</label>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={!!busy || !name.trim()}>{busy && <Spinner className="size-3" />} Crear tarea</button>
        </div>
      </form>
    </div>
  );
}
