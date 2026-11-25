import { useEffect } from 'react';
import { api, type Place, type Today } from '../api';
import { Spinner, duration, hhmm, useAction, useLoad } from '../ui';

const STATUS: Record<Today['status'], { label: string; cls: string }> = {
  no_entry: { label: 'Sin entrada', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  stale: { label: 'Entrada abierta de otro día', cls: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' },
  working: { label: 'Trabajando', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  lunch: { label: 'En comida', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300' },
  out: { label: 'Fuera', cls: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
};

function Slot({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {hint && <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">{hint}</div>}
    </div>
  );
}

const placeText = (p: Place | null) => (p ? `📍 ${[p.city, p.country].filter(Boolean).join(', ') || 'Con ubicación'}` : '⚠️ Sin ubicación');

function PlaceLink({ place }: { place: Place | null }) {
  if (!place) return <span className="text-amber-600">sin ubicación</span>;
  return (
    <a className="text-brand-600 hover:underline dark:text-brand-500" target="_blank" rel="noreferrer"
      href={`https://www.openstreetmap.org/?mlat=${place.latitude}&mlon=${place.longitude}#map=17/${place.latitude}/${place.longitude}`}>
      {[place.city, place.country].filter(Boolean).join(', ') || `${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}`}
    </a>
  );
}

function LocationStatus({ t }: { t: Today }) {
  const cur = t.location.current;
  if (cur) {
    const ago = Math.max(0, Math.round((Date.now() - Date.parse(cur.at)) / 60_000));
    return (
      <p className="mt-4 text-xs text-zinc-500">
        Ubicación para el próximo registro: <PlaceLink place={cur} />
        {cur.accuracy !== null && ` (±${Math.round(cur.accuracy)} m)`} · hace {ago} min
      </p>
    );
  }
  return (
    <p className={`mt-4 rounded-lg p-3 text-sm ${t.location.required ? 'bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200' : 'text-zinc-500'}`}>
      {t.location.required ? '⚠️ La ubicación es obligatoria y no hay una reciente, así que no se puede registrar. ' : 'Sin ubicación reciente. '}
      Revisa que la app <b>Odoo Asistencia</b> de la barra de menú esté corriendo y tenga permiso en
      Configuración del Sistema → Privacidad y seguridad → Servicios de ubicación.
      {t.location.last && <> Última recibida: hace {Math.round((Date.now() - Date.parse(t.location.last.at)) / 60_000)} min.</>}
    </p>
  );
}

export function Attendance() {
  const { data: t, setData, error, loading, reload } = useLoad(() => api.today(true), []);
  const { busy, run } = useAction();

  useEffect(() => {
    const iv = setInterval(() => api.today().then(setData).catch(() => {}), 60_000);
    return () => clearInterval(iv);
  }, [setData]);

  const act = (key: string, fn: () => Promise<Today>, ok: (r: Today) => string) =>
    run(key, fn, ok).then((r) => r && setData(r));

  if (!t) {
    return (
      <section className="card flex items-center gap-3 p-5 text-sm text-zinc-500">
        {error ? <><span className="text-red-600">{error}</span><button className="btn-ghost" onClick={reload}>Reintentar</button></> : <><Spinner /> Consultando asistencia…</>}
      </section>
    );
  }

  const s = STATUS[t.status];
  const noLoc = t.location.required && !t.location.current;
  const lunchValue = t.lunch.start ? `${hhmm(t.lunch.start)}–${t.lunch.end ? hhmm(t.lunch.end) : '…'}` : '—';
  const lunchHint = t.status === 'lunch' ? `Regreso a las ${hhmm(t.lunch.returnDueAt)}` : !t.lunch.start ? `${t.lunch.window.from}–${t.lunch.window.to}, ${t.lunch.window.minutes} min` : undefined;

  return (
    <section className="card p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">Asistencia de hoy</h2>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>
        {loading && <Spinner className="size-3 text-zinc-400" />}
        <button className="ml-auto text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200" onClick={reload}>Actualizar</button>
      </div>

      {t.status === 'stale' && (
        <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-300">
          {t.summary}. Ciérrala en Odoo para poder registrar la entrada de hoy.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Slot label="Entrada" value={hhmm(t.firstCheckIn)} hint={t.intervals[0] ? placeText(t.intervals[0].inPlace) : undefined} />
        <Slot label="Comida" value={lunchValue} hint={lunchHint} />
        <Slot label="Salida" value={hhmm(t.lastCheckOut)} hint={t.lastCheckOut ? placeText(t.intervals.at(-1)?.outPlace ?? null) : undefined} />
        <Slot label="Trabajado" value={duration(t.workedMinutes)} />
      </div>

      {t.intervals.length > 0 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">Registros de hoy ({t.intervals.length})</summary>
          <ul className="mt-2 space-y-1">
            {t.intervals.map((i) => (
              <li key={i.in} className="flex flex-wrap gap-x-4 tabular-nums">
                <span>Entrada {hhmm(i.in)} · <PlaceLink place={i.inPlace} /></span>
                {i.out && <span>Salida {hhmm(i.out)} · <PlaceLink place={i.outPlace} /></span>}
              </li>
            ))}
          </ul>
        </details>
      )}

      <LocationStatus t={t} />

      <div className="mt-5 flex flex-wrap gap-2">
        {t.actions.checkIn && (
          <button className="btn-primary" disabled={!!busy || noLoc} onClick={() => act('in', api.checkIn, (r) => `Entrada registrada a las ${hhmm(r.intervals.at(-1)?.in)}`)}>
            {busy === 'in' && <Spinner className="size-3" />} Registrar entrada
          </button>
        )}
        {t.actions.lunchEnd && (
          <button className="btn-primary" disabled={!!busy || noLoc} onClick={() => act('lunchEnd', api.lunchEnd, (r) => `Regreso registrado a las ${hhmm(r.lunch.end)}`)}>
            {busy === 'lunchEnd' && <Spinner className="size-3" />} Regresar de comer
          </button>
        )}
        {t.status === 'working' && (
          <button className="btn-ghost" disabled={!!busy || noLoc || !t.actions.lunchStart} title={t.lunch.reason ?? undefined}
            onClick={() => act('lunch', api.lunchStart, (r) => `Buen provecho. Regreso a las ${hhmm(r.lunch.returnDueAt)}`)}>
            {busy === 'lunch' && <Spinner className="size-3" />} Salir a comer
          </button>
        )}
        {t.actions.checkOut && (
          <button className="btn-ghost" disabled={!!busy || noLoc}
            onClick={() => confirm('¿Registrar tu salida del día?') && act('out', api.checkOut, (r) => `Salida registrada a las ${hhmm(r.lastCheckOut)}`)}>
            {busy === 'out' && <Spinner className="size-3" />} Registrar salida
          </button>
        )}
        {t.status === 'working' && !t.actions.lunchStart && t.lunch.reason && !t.lunch.start && (
          <span className="self-center text-xs text-zinc-500">{t.lunch.reason}</span>
        )}
      </div>
    </section>
  );
}
