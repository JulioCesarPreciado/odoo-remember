import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type TimerInfo } from './api';
import { useToast } from './ui';

interface TimerCtx {
  timer: TimerInfo | null;
  /** Minutos transcurridos, actualizados cada 15 s. */
  minutes: number;
  start: (taskId: number, startedAt?: string) => Promise<boolean>;
  stop: (description: string) => Promise<boolean>;
  refresh: () => void;
}

const Ctx = createContext<TimerCtx | null>(null);

export function useTimer() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTimer fuera de TimerProvider');
  return v;
}

const elapsed = (t: TimerInfo | null) => (!t ? 0 : t.paused ? t.elapsedMinutes : Math.max(0, Math.floor((Date.now() - Date.parse(t.startedAt)) / 60_000)));

export const fmtMinutes = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`);

/** "HH:MM" de hoy → "YYYY-MM-DDTHH:MM" local (lo que entiende la API). */
export const todayAt = (hhmm: string) => `${new Date().toLocaleDateString('en-CA')}T${hhmm}`;

export function TimerProvider({ children, onChanged }: { children: ReactNode; onChanged: () => void }) {
  const [timer, setTimer] = useState<TimerInfo | null>(null);
  const [, tick] = useState(0);
  const toast = useToast();

  const refresh = useCallback(() => { api.timer().then(setTimer).catch(() => {}); }, []);

  // Consultar Odoo cada minuto (el temporizador también se puede manejar desde Odoo) y repintar cada 15 s.
  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, 60_000);
    const paint = setInterval(() => tick((n) => n + 1), 15_000);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(poll); clearInterval(paint); window.removeEventListener('focus', onFocus); };
  }, [refresh]);

  const start = useCallback(async (taskId: number, startedAt?: string) => {
    try {
      const t = await api.startTimer(taskId, startedAt);
      setTimer(t);
      toast(`Temporizador iniciado: ${t.taskName}`);
      return true;
    } catch (e) {
      toast((e as Error).message, 'error');
      refresh();
      return false;
    }
  }, [toast, refresh]);

  const stop = useCallback(async (description: string) => {
    try {
      const r = await api.stopTimer(description);
      setTimer(null);
      toast(`${r.hours.toFixed(2)} h registradas`);
      onChanged();
      return true;
    } catch (e) {
      toast((e as Error).message, 'error');
      refresh();
      return false;
    }
  }, [toast, refresh, onChanged]);

  const minutes = elapsed(timer);
  const value = useMemo<TimerCtx>(() => ({ timer, minutes, start, stop, refresh }), [timer, minutes, start, stop, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
