import type { Task } from '../api';
import { StateBadge, Star, deadlineInfo } from '../ui';

export function TaskRow({ task, onOpen, showProject, showStage = true, active }: {
  task: Task; onOpen: (t: Task) => void; showProject?: boolean; showStage?: boolean; active?: boolean;
}) {
  const d = deadlineInfo(task.deadline);
  return (
    <button type="button" onClick={() => onOpen(task)}
      className={`flex w-full items-start gap-3 px-4 py-2.5 text-left transition hover:bg-zinc-50 dark:hover:bg-zinc-800/60 ${active ? 'bg-brand-50 dark:bg-brand-600/15' : ''}`}>
      <span className="mt-0.5"><Star on={task.priority} /></span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-sm font-medium">{task.name}</span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
          {showProject && <span>{task.project?.name ?? 'Sin proyecto'}</span>}
          {showStage && task.stage && <span className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">{task.stage.name}</span>}
          {!task.mine && task.assignees.length > 0 && <span>{task.assignees.map((a) => a.name.split(' ')[0]).join(', ')}</span>}
          {!task.mine && task.assignees.length === 0 && <span className="italic">Sin asignar</span>}
          {task.tags.slice(0, 3).map((t) => <span key={t} className="text-brand-600 dark:text-brand-500">#{t}</span>)}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <StateBadge state={task.state} />
        {d && <span className={`text-xs tabular-nums ${d.overdue ? 'font-medium text-red-600' : d.today ? 'font-medium text-amber-600' : 'text-zinc-500'}`}>{d.overdue ? 'Venció ' : ''}{d.label}</span>}
        {task.allocatedHours > 0 && <span className="text-xs tabular-nums text-zinc-500">{task.effectiveHours.toFixed(1)} / {task.allocatedHours.toFixed(1)} h</span>}
      </span>
    </button>
  );
}
