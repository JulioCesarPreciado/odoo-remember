import { useCallback, useState } from 'react';
import { api, type Task } from './api';
import { Attendance } from './components/Attendance';
import { MyTasks } from './components/MyTasks';
import { Projects } from './components/Projects';
import { TaskPanel } from './components/TaskPanel';
import { TaskActionsProvider } from './taskActions';
import { ThemeToggle } from './theme';
import { ToastProvider, useLoad } from './ui';

type View = 'mine' | 'projects';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function readView(): View {
  try { return localStorage.getItem('view') === 'projects' ? 'projects' : 'mine'; } catch { return 'mine'; }
}

export function App() {
  const [view, setView] = useState<View>(readView);
  const [openId, setOpenId] = useState<number | null>(null);
  const [version, setVersion] = useState(0);
  const mine = useLoad(() => api.myTasks(), [version]);

  const choose = (v: View) => {
    setView(v);
    try { localStorage.setItem('view', v); } catch { /* sin almacenamiento */ }
  };
  const changed = useCallback(() => setVersion((v) => v + 1), []);
  const open = useCallback((t: Task) => setOpenId(t.id), []);
  const close = useCallback(() => setOpenId(null), []);

  const tabs: { id: View; label: string; count?: number }[] = [
    { id: 'mine', label: 'Mis tareas pendientes', count: mine.data?.length },
    { id: 'projects', label: 'Tareas por proyecto' },
  ];

  return (
    <ToastProvider>
    <TaskActionsProvider onChanged={changed}>
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-5">
        <header className="flex items-center gap-3">
          <img src="/logo.png" alt="" className="size-9" />
          <div>
            <h1 className="text-lg font-semibold leading-tight">Odoo Asistencia</h1>
            <p className="text-xs text-zinc-500">{capitalize(new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }))}</p>
          </div>
          <div className="ml-auto"><ThemeToggle /></div>
        </header>

        <Attendance />

        <nav className="grid grid-cols-2 gap-3" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={view === t.id} onClick={() => choose(t.id)}
              className={`card flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition ${view === t.id ? 'border-brand-600 bg-brand-600 text-white dark:border-brand-500 dark:bg-brand-600' : 'hover:border-brand-500'}`}>
              {t.label}
              {t.count !== undefined && <span className={`rounded-full px-2 text-xs ${view === t.id ? 'bg-white/20' : 'bg-zinc-100 dark:bg-zinc-800'}`}>{t.count}</span>}
            </button>
          ))}
        </nav>

        {view === 'mine'
          ? <MyTasks tasks={mine.data} loading={mine.loading} error={mine.error} reload={mine.reload} onOpen={open} activeId={openId ?? undefined} />
          : <Projects onOpen={open} activeId={openId ?? undefined} version={version} onChanged={changed} />}
      </div>

      {openId !== null && <TaskPanel taskId={openId} version={version} onClose={close} onChanged={changed} />}
    </TaskActionsProvider>
    </ToastProvider>
  );
}
