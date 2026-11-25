import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, type Stage, type Task, type TaskState } from './api';
import { STATE_LABEL, useToast } from './ui';

type Patch = { stageId?: number; state?: TaskState };

interface TaskActions {
  /** Etapas del proyecto, o undefined si aún no se cargan. */
  stagesOf: (projectId: number) => Stage[] | undefined;
  /** Pide (una sola vez) las etapas de los proyectos indicados. */
  ensureStages: (projectIds: number[]) => void;
  /** Cambia etapa y/o estado de una tarea; devuelve true si se guardó. */
  update: (task: Task, patch: Patch) => Promise<boolean>;
}

const Ctx = createContext<TaskActions | null>(null);

export function useTaskActions() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTaskActions fuera de TaskActionsProvider');
  return v;
}

export function TaskActionsProvider({ children, onChanged }: { children: ReactNode; onChanged: () => void }) {
  const [stages, setStages] = useState<Record<number, Stage[]>>({});
  const requested = useRef(new Set<number>());
  const toast = useToast();

  const ensureStages = useCallback((ids: number[]) => {
    const missing = [...new Set(ids)].filter((id) => !requested.current.has(id));
    if (!missing.length) return;
    missing.forEach((id) => requested.current.add(id));
    api.stagesFor(missing)
      .then((m) => setStages((s) => ({ ...s, ...m })))
      .catch(() => missing.forEach((id) => requested.current.delete(id)));   // reintentar la próxima vez
  }, []);

  const update = useCallback(async (task: Task, patch: Patch) => {
    try {
      await api.updateTask(task.id, patch);
      const what = patch.state
        ? `Estado → ${STATE_LABEL[patch.state]}`
        : `Etapa → ${stages[task.project?.id ?? 0]?.find((s) => s.id === patch.stageId)?.name ?? 'actualizada'}`;
      toast(`${what}: ${task.name}`);
      onChanged();
      return true;
    } catch (e) {
      toast((e as Error).message, 'error');
      return false;
    }
  }, [stages, toast, onChanged]);

  const value = useMemo<TaskActions>(() => ({ stagesOf: (id) => stages[id], ensureStages, update }), [stages, ensureStages, update]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
