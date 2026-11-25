import { useState, type FormEvent } from 'react';
import { fmtMinutes, useTimer } from '../timer';
import { Spinner, hhmm } from '../ui';

/** Formulario para detener el temporizador: pide qué se hizo y registra el tiempo como horas. */
export function StopTimerForm({ onDone, autoFocus }: { onDone?: () => void; autoFocus?: boolean }) {
  const { stop, minutes } = useTimer();
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await stop(description);
    setBusy(false);
    if (ok) { setDescription(''); onDone?.(); }
  };
  return (
    <form onSubmit={submit} className="flex min-w-0 flex-1 gap-2">
      <input className="input min-w-0 flex-1" autoFocus={autoFocus} required placeholder="¿Qué hiciste?" value={description}
        onChange={(e) => setDescription(e.target.value)} aria-label="Descripción de las horas" />
      <button className="btn-primary shrink-0" disabled={busy || !description.trim()}>
        {busy && <Spinner className="size-3" />} Registrar {(Math.max(1, minutes) / 60).toFixed(2)} h
      </button>
    </form>
  );
}

/** Barra visible mientras hay un temporizador corriendo en alguna tarea. */
export function TimerBar({ onOpen }: { onOpen: (taskId: number) => void }) {
  const { timer, minutes } = useTimer();
  const [stopping, setStopping] = useState(false);
  if (!timer) return null;

  return (
    <section className="card flex flex-wrap items-center gap-3 border-brand-500/60 bg-brand-50 px-4 py-2.5 dark:border-brand-500/40 dark:bg-brand-700/15">
      <span className="relative flex size-2.5 shrink-0">
        {!timer.paused && <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-500 opacity-60" />}
        <span className={`relative inline-flex size-2.5 rounded-full ${timer.paused ? 'bg-zinc-400' : 'bg-brand-600'}`} />
      </span>
      <div className="min-w-0 flex-1">
        <button className="block max-w-full truncate text-left text-sm font-medium hover:underline" onClick={() => onOpen(timer.taskId)}>
          {timer.taskName}
        </button>
        <p className="truncate text-xs text-zinc-500">
          {timer.project?.name} · desde {hhmm(timer.startedAt)}{timer.paused && ' · en pausa'}
        </p>
      </div>
      <span className="text-lg font-semibold tabular-nums">{fmtMinutes(minutes)}</span>
      {stopping
        ? <div className="flex w-full gap-2 sm:w-auto sm:min-w-96"><StopTimerForm autoFocus onDone={() => setStopping(false)} />
            <button className="btn-ghost" onClick={() => setStopping(false)}>Cancelar</button></div>
        : <button className="btn-ghost" onClick={() => setStopping(true)}>Detener y registrar</button>}
    </section>
  );
}
