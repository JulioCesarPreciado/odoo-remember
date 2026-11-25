import { useEffect, useState } from 'react';
import type { Task, TaskState } from '../api';
import { useTaskActions } from '../taskActions';
import { STATE_CLASS, STATE_LABEL, Spinner, Star, deadlineInfo } from '../ui';

const STATES = Object.keys(STATE_LABEL) as TaskState[];

export function TaskRow({ task, onOpen, showProject, showStage = true, active }: {
  task: Task; onOpen: (t: Task) => void; showProject?: boolean; showStage?: boolean; active?: boolean;
}) {
  const d = deadlineInfo(task.deadline);
  return (
    <div className={`flex items-start gap-3 px-4 py-2.5 transition hover:bg-zinc-50 dark:hover:bg-zinc-800/60 ${active ? 'bg-brand-50 dark:bg-brand-600/15' : ''}`}>
      <span className="mt-0.5"><Star on={task.priority} /></span>
      <button type="button" onClick={() => onOpen(task)} className="min-w-0 flex-1 text-left" title="Abrir detalle">
        <span className="line-clamp-2 text-sm font-medium hover:underline">{task.name}</span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
          {showProject && <span>{task.project?.name ?? 'Sin proyecto'}</span>}
          {!task.mine && task.assignees.length > 0 && <span>{task.assignees.map((a) => a.name.split(' ')[0]).join(', ')}</span>}
          {!task.mine && task.assignees.length === 0 && <span className="italic">Sin asignar</span>}
          {task.tags.slice(0, 3).map((t) => <span key={t} className="text-brand-600 dark:text-brand-500">#{t}</span>)}
          {d && <span className={`tabular-nums ${d.overdue ? 'font-medium text-red-600' : d.today ? 'font-medium text-amber-600' : ''}`}>{d.overdue ? 'Venció ' : 'Vence '}{d.label}</span>}
          {task.allocatedHours > 0 && <span className="tabular-nums">{task.effectiveHours.toFixed(1)} / {task.allocatedHours.toFixed(1)} h</span>}
        </span>
      </button>
      <StageAndState task={task} showStage={showStage} />
    </div>
  );
}

/** Etapa (del proyecto de la tarea) y estado, editables desde la lista. */
function StageAndState({ task, showStage }: { task: Task; showStage: boolean }) {
  const { stagesOf, ensureStages, update } = useTaskActions();
  const [saving, setSaving] = useState<'stage' | 'state' | null>(null);
  const [stageId, setStageId] = useState(task.stage?.id ?? 0);
  const [state, setState] = useState(task.state);
  useEffect(() => { setStageId(task.stage?.id ?? 0); setState(task.state); }, [task.stage?.id, task.state]);

  const projectId = task.project?.id;
  useEffect(() => { if (projectId) ensureStages([projectId]); }, [projectId, ensureStages]);
  const stages = projectId ? stagesOf(projectId) : undefined;

  const change = async (kind: 'stage' | 'state', patch: { stageId?: number; state?: TaskState }) => {
    setSaving(kind);
    if (patch.stageId !== undefined) setStageId(patch.stageId);
    if (patch.state !== undefined) setState(patch.state);
    const ok = await update(task, patch);
    if (!ok) { setStageId(task.stage?.id ?? 0); setState(task.state); }   // revertir
    setSaving(null);
  };

  const select = 'rounded-md border border-zinc-200 bg-white py-0.5 pl-1.5 pr-6 text-xs outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900';

  return (
    <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center">
      {saving && <Spinner className="size-3 text-zinc-400" />}
      {showStage && (
        <label className="flex items-center gap-1">
          <span className="sr-only">Etapa</span>
          <select className={`${select} max-w-44`} value={stageId} disabled={!projectId || !!saving}
            title={projectId ? 'Etapa' : 'La tarea no tiene proyecto'}
            onChange={(e) => change('stage', { stageId: Number(e.target.value) })}>
            {!stageId && <option value={0}>{projectId ? 'Sin etapa' : 'Sin proyecto'}</option>}
            {!stages && task.stage && <option value={task.stage.id}>{task.stage.name}</option>}
            {stages?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      )}
      <label className="flex items-center gap-1">
        <span className="sr-only">Estado</span>
        <select className={`${select} font-medium ${STATE_CLASS[state]}`} value={state} disabled={!!saving} title="Estado"
          onChange={(e) => change('state', { state: e.target.value as TaskState })}>
          {STATES.map((s) => <option key={s} value={s}>{STATE_LABEL[s]}</option>)}
        </select>
      </label>
    </div>
  );
}
