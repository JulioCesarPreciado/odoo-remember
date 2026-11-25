import { useEffect, useState } from 'react';
import { api, type ProjectBoard, type ProjectSummary, type StageGroup, type Task } from '../api';
import { Empty, Spinner, Star, useLoad, useToast } from '../ui';
import { NewTask } from './NewTask';
import { TaskRow } from './TaskRow';

export function Projects({ onOpen, activeId, version, onChanged }: {
  onOpen: (t: Task) => void; activeId?: number; version: number; onChanged: () => void;
}) {
  const projects = useLoad(() => api.projects(), [version]);
  const [selected, setSelected] = useState<number | null>(null);
  const current = projects.data?.find((p) => p.id === selected) ?? null;

  useEffect(() => {
    if (selected === null && projects.data?.length) setSelected(projects.data[0].id);
  }, [projects.data, selected]);

  return (
    <div className="grid gap-4 md:grid-cols-[260px_1fr]">
      <aside className="card h-fit overflow-hidden md:sticky md:top-4">
        <div className="border-b border-zinc-200 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
          Proyectos donde participo
        </div>
        {projects.loading && !projects.data && <Empty><Spinner /></Empty>}
        {projects.error && <p className="p-4 text-sm text-red-600">{projects.error}</p>}
        <nav className="max-h-[70vh] overflow-y-auto py-1">
          {projects.data?.map((p) => (
            <button key={p.id} onClick={() => setSelected(p.id)}
              className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition hover:bg-zinc-50 dark:hover:bg-zinc-800/60 ${p.id === selected ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-600/15 dark:text-brand-100' : ''}`}>
              {p.favorite && <Star on />}
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-zinc-500" title="Mías / abiertas">
                {p.myOpenTasks > 0 && <b className="text-brand-600 dark:text-brand-500">{p.myOpenTasks}</b>}
                {p.myOpenTasks > 0 && ' / '}{p.openTasks}
              </span>
            </button>
          ))}
        </nav>
      </aside>
      {current ? <Board key={current.id} project={current} onOpen={onOpen} activeId={activeId} version={version} onChanged={onChanged} /> : <div />}
    </div>
  );
}

function Board({ project, onOpen, activeId, version, onChanged }: {
  project: ProjectSummary; onOpen: (t: Task) => void; activeId?: number; version: number; onChanged: () => void;
}) {
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [creating, setCreating] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 350); return () => clearTimeout(t); }, [q]);

  const board = useLoad(() => api.board(project.id, { mine, q: debounced }), [project.id, mine, debounced, version]);

  return (
    <section className="card min-w-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 p-3 dark:border-zinc-800">
        <h2 className="mr-2 text-base font-semibold">{project.name}</h2>
        {board.data && <span className="text-xs text-zinc-500">{board.data.total} abiertas</span>}
        {board.loading && <Spinner className="size-3 text-zinc-400" />}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input className="input w-48" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="accent-brand-600" /> Solo mías
          </label>
          <button className="btn-primary" onClick={() => setCreating(true)}>+ Nueva tarea</button>
        </div>
      </div>
      {board.error && <p className="p-4 text-sm text-red-600">{board.error}</p>}
      {board.data && board.data.total === 0 && <Empty>{debounced || mine ? 'Ninguna tarea coincide.' : 'Este proyecto no tiene tareas abiertas.'}</Empty>}
      {board.data?.groups.filter((g) => g.count > 0).map((g) => (
        <StageSection key={g.stage?.id ?? 'none'} group={g} board={board.data!} filters={{ mine, q: debounced }} onOpen={onOpen} activeId={activeId} />
      ))}
      {creating && board.data && (
        <NewTask project={project} stages={board.data.stages} onClose={() => setCreating(false)}
          onCreated={(t) => { setCreating(false); onChanged(); onOpen(t); }} />
      )}
    </section>
  );
}

function StageSection({ group, board, filters, onOpen, activeId }: {
  group: StageGroup; board: ProjectBoard; filters: { mine: boolean; q: string }; onOpen: (t: Task) => void; activeId?: number;
}) {
  const [open, setOpen] = useState(!group.stage?.fold);
  const [tasks, setTasks] = useState(group.tasks);
  const [loadingMore, setLoadingMore] = useState(false);
  const toast = useToast();
  useEffect(() => setTasks(group.tasks), [group.tasks]);

  const more = async () => {
    setLoadingMore(true);
    try {
      const r = await api.board(board.project.id, { ...filters, stage: group.stage?.id ?? 'none', offset: tasks.length, limit: 60 });
      setTasks((prev) => [...prev, ...(r.groups[0]?.tasks ?? [])]);
    } catch (e) { toast((e as Error).message, 'error'); }
    setLoadingMore(false);
  };

  return (
    <div>
      <button onClick={() => setOpen(!open)}
        className="sticky top-0 z-10 flex w-full items-center gap-2 border-y border-zinc-200 bg-zinc-50/95 px-4 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
        <span className={`transition ${open ? 'rotate-90' : ''}`}>▸</span>
        {group.stage?.name ?? 'Sin etapa'} <span className="font-normal">{group.count}</span>
      </button>
      {open && (
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {tasks.map((t) => <TaskRow key={t.id} task={t} onOpen={onOpen} showStage={false} active={t.id === activeId} />)}
          {tasks.length < group.count && (
            <div className="px-4 py-2">
              <button className="text-sm text-brand-600 hover:underline dark:text-brand-500" onClick={more} disabled={loadingMore}>
                {loadingMore ? 'Cargando…' : `Ver más (${group.count - tasks.length} restantes)`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
