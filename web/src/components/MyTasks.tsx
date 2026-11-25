import { useEffect, useMemo, useState } from 'react';
import type { Task } from '../api';
import { useTaskActions } from '../taskActions';
import { Empty, Spinner } from '../ui';
import { TaskRow } from './TaskRow';

type Sort = 'project' | 'deadline';

export function MyTasks({ tasks, loading, error, reload, onOpen, activeId }: {
  tasks: Task[] | null; loading: boolean; error: string | null; reload: () => void; onOpen: (t: Task) => void; activeId?: number;
}) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('project');

  // Precargar en una sola petición las etapas de todos los proyectos de la lista.
  const { ensureStages } = useTaskActions();
  useEffect(() => {
    if (tasks) ensureStages(tasks.flatMap((t) => (t.project ? [t.project.id] : [])));
  }, [tasks, ensureStages]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (tasks ?? []).filter((t) => !s || t.name.toLowerCase().includes(s) || t.project?.name.toLowerCase().includes(s));
  }, [tasks, q]);

  const groups = useMemo(() => {
    if (sort === 'deadline') {
      const byDate = [...filtered].sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999'));
      return [{ key: 'all', name: null as string | null, tasks: byDate }];
    }
    const m = new Map<string, { key: string; name: string; tasks: Task[] }>();
    for (const t of filtered) {
      const key = String(t.project?.id ?? 0);
      if (!m.has(key)) m.set(key, { key, name: t.project?.name ?? 'Sin proyecto', tasks: [] });
      m.get(key)!.tasks.push(t);
    }
    return [...m.values()].sort((a, b) => b.tasks.length - a.tasks.length);
  }, [filtered, sort]);

  const overdue = (tasks ?? []).filter((t) => t.deadline && t.deadline < new Date().toLocaleDateString('en-CA')).length;

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 p-3 dark:border-zinc-800">
        <input className="input max-w-xs" placeholder="Buscar tarea o proyecto…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex rounded-lg border border-zinc-200 p-0.5 text-xs dark:border-zinc-700">
          {(['project', 'deadline'] as Sort[]).map((s) => (
            <button key={s} onClick={() => setSort(s)}
              className={`rounded-md px-2.5 py-1 ${sort === s ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'text-zinc-600 dark:text-zinc-400'}`}>
              {s === 'project' ? 'Por proyecto' : 'Por fecha límite'}
            </button>
          ))}
        </div>
        {overdue > 0 && <span className="text-xs font-medium text-red-600">{overdue} vencidas</span>}
        <button className="btn-ghost ml-auto" onClick={reload} disabled={loading}>{loading && <Spinner className="size-3" />} Actualizar</button>
      </div>

      {error && <p className="p-4 text-sm text-red-600">{error}</p>}
      {!tasks && loading && <Empty><Spinner /></Empty>}
      {tasks && filtered.length === 0 && <Empty>{q ? 'Ninguna tarea coincide.' : 'No tienes tareas pendientes. 🎉'}</Empty>}

      {groups.map((g) => (
        <div key={g.key}>
          {g.name && (
            <h3 className="sticky top-0 z-10 flex items-center gap-2 border-y border-zinc-200 bg-zinc-50/95 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
              {g.name} <span className="font-normal">{g.tasks.length}</span>
            </h3>
          )}
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {g.tasks.map((t) => <TaskRow key={t.id} task={t} onOpen={onOpen} showProject={sort === 'deadline'} active={t.id === activeId} />)}
          </div>
        </div>
      ))}
    </section>
  );
}
