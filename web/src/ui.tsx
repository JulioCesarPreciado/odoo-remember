import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { TaskState } from './api';

// ---------- Formato ----------

export const hhmm = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—';

export const duration = (min: number) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;

const todayStr = () => new Date().toLocaleDateString('en-CA');

export function deadlineInfo(d: string | null) {
  if (!d) return null;
  const label = new Date(`${d}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: d.slice(0, 4) === todayStr().slice(0, 4) ? undefined : 'numeric' });
  const t = todayStr();
  return { label, overdue: d < t, today: d === t };
}

export const STATE_LABEL: Record<TaskState, string> = {
  '01_in_progress': 'En progreso',
  '02_changes_requested': 'Cambios solicitados',
  '03_approved': 'Aprobada',
  '04_waiting_normal': 'En espera',
  '1_done': 'Hecha',
  '1_canceled': 'Cancelada',
};

export const STATE_CLASS: Record<TaskState, string> = {
  '01_in_progress': 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  '02_changes_requested': 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  '03_approved': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  '04_waiting_normal': 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  '1_done': 'bg-emerald-600 text-white',
  '1_canceled': 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
};

export function StateBadge({ state }: { state: TaskState }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${STATE_CLASS[state]}`}>{STATE_LABEL[state]}</span>;
}

export function Star({ on, onClick, title }: { on: boolean; onClick?: () => void; title?: string }) {
  const cls = on ? 'text-amber-500' : 'text-zinc-300 dark:text-zinc-600';
  const icon = (
    <svg viewBox="0 0 20 20" className="size-4" fill="currentColor" aria-hidden>
      <path d="M10 1.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.5 7.7l5.9-.9z" />
    </svg>
  );
  return onClick ? (
    <button type="button" onClick={onClick} title={title ?? (on ? 'Quitar prioridad' : 'Marcar prioridad')} className={`${cls} hover:scale-110`}>{icon}</button>
  ) : <span className={cls} title={on ? 'Prioridad alta' : undefined}>{icon}</span>;
}

export function Spinner({ className = 'size-4' }: { className?: string }) {
  return <span className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} aria-label="Cargando" />;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-12 text-center text-sm text-zinc-500">{children}</div>;
}

// ---------- Carga de datos ----------

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const load = useCallback(() => {
    const n = ++seq.current;
    setLoading(true);
    fn().then(
      (d) => { if (n === seq.current) { setData(d); setError(null); } },
      (e: Error) => { if (n === seq.current) setError(e.message); },
    ).finally(() => { if (n === seq.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(load, [load]);
  return { data, setData, error, loading, reload: load };
}

// ---------- Avisos ----------

type Toast = { id: number; text: string; kind: 'ok' | 'error' };
const ToastCtx = createContext<(text: string, kind?: Toast['kind']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (
          <div key={t.id} role="status"
            className={`pointer-events-auto max-w-md rounded-lg px-4 py-2 text-sm shadow-lg ${t.kind === 'error' ? 'bg-red-600 text-white' : 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Ejecuta una acción mostrando éxito/error y bloqueando mientras corre. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(async <T,>(key: string, fn: () => Promise<T>, ok?: string | ((r: T) => string)) => {
    setBusy(key);
    try {
      const r = await fn();
      if (ok) toast(typeof ok === 'function' ? ok(r) : ok);
      return r;
    } catch (e) {
      toast((e as Error).message, 'error');
      return undefined;
    } finally {
      setBusy(null);
    }
  }, [toast]);
  return { busy, run };
}
