import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { api, type Ref } from '../api';

// ---------- Etiquetas ----------

const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

let tagsPromise: Promise<Ref[]> | null = null;
/** Todas las etiquetas, pedidas una sola vez por sesión del panel. */
const loadTags = () => (tagsPromise ??= api.tags().catch((e) => { tagsPromise = null; throw e; }));
/** Olvidar la lista después de crear etiquetas nuevas. */
export const forgetTags = () => { tagsPromise = null; };

export interface PickedTag { name: string; isNew: boolean }

/**
 * Selector de etiquetas por nombre. Las existentes se autocompletan; una nueva solo se agrega
 * eligiendo explícitamente "Crear «x»", y se marca para que el usuario la vea antes de guardar.
 */
export function TagPicker({ value, onChange, disabled, id }: {
  value: PickedTag[]; onChange: (tags: PickedTag[]) => void; disabled?: boolean; id?: string;
}) {
  const [all, setAll] = useState<Ref[]>([]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => { loadTags().then(setAll).catch(() => {}); }, []);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const chosen = useMemo(() => new Set(value.map((t) => fold(t.name))), [value]);
  const f = fold(q);
  // Solo sugerir mientras se escribe: con el campo vacío la lista completa (cientos) estorba.
  const matches = useMemo(() => (f ? all.filter((t) => !chosen.has(fold(t.name)) && fold(t.name).includes(f)).slice(0, 8) : []), [all, chosen, f]);
  const exact = all.find((t) => fold(t.name) === f);
  const options: PickedTag[] = [
    ...matches.map((t) => ({ name: t.name, isNew: false })),
    ...(f && !exact && !chosen.has(f) ? [{ name: q.trim(), isNew: true }] : []),
  ];

  const add = (t: PickedTag) => {
    onChange([...value, t]);
    setQ('');
    setActive(0);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, options.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && open && options[active]) { e.preventDefault(); add(options[active]); }
    else if (e.key === 'Backspace' && !q && value.length) onChange(value.slice(0, -1));
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div ref={box} className="relative">
      <div className={`input flex min-h-[34px] flex-wrap items-center gap-1 py-1 ${disabled ? 'opacity-60' : ''}`}
        onClick={() => box.current?.querySelector('input')?.focus()}>
        {value.map((t) => (
          <span key={t.name} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${t.isNew
            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' : 'bg-brand-100 text-brand-700 dark:bg-brand-700/30 dark:text-brand-100'}`}
            title={t.isNew ? 'Etiqueta nueva: se creará en Odoo al guardar' : undefined}>
            {t.name}{t.isNew && ' (nueva)'}
            {!disabled && <button type="button" aria-label={`Quitar ${t.name}`} className="opacity-60 hover:opacity-100"
              onClick={(e) => { e.stopPropagation(); onChange(value.filter((x) => x !== t)); }}>×</button>}
          </span>
        ))}
        <input id={id} className="min-w-24 flex-1 bg-transparent text-sm outline-none" disabled={disabled} value={q}
          placeholder={value.length ? '' : 'Buscar o crear etiqueta…'}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }} onFocus={() => setOpen(true)} onKeyDown={onKey}
          role="combobox" aria-expanded={open} aria-autocomplete="list" />
      </div>
      {open && options.length > 0 && (
        <ul role="listbox" className="card absolute z-50 mt-1 max-h-56 w-full overflow-y-auto py-1 shadow-lg">
          {options.map((o, i) => (
            <li key={`${o.isNew}-${o.name}`} role="option" aria-selected={i === active}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => add(o)} onMouseEnter={() => setActive(i)}
                className={`w-full px-3 py-1.5 text-left text-sm ${i === active ? 'bg-zinc-100 dark:bg-zinc-800' : ''}`}>
                {o.isNew ? <>Crear etiqueta <b>«{o.name}»</b></> : o.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- Personas ----------

let usersPromise: Promise<Ref[]> | null = null;
const loadUsers = () => (usersPromise ??= api.users().catch((e) => { usersPromise = null; throw e; }));
let uidPromise: Promise<number> | null = null;
/** Id del usuario del token (para avisar antes de quitarse a sí mismo de una tarea). */
export const myUid = () => (uidPromise ??= api.account().then((a) => a.uid).catch((e) => { uidPromise = null; throw e; }));

/** Selector de personas (usuarios internos de Odoo). Sugiere mientras se escribe; busca por palabras sin acentos. */
export function UserPicker({ value, onChange, disabled, id, placeholder = 'Buscar persona…' }: {
  value: Ref[]; onChange: (users: Ref[]) => void; disabled?: boolean; id?: string; placeholder?: string;
}) {
  const [all, setAll] = useState<Ref[]>([]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => { loadUsers().then(setAll).catch(() => {}); }, []);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const chosen = useMemo(() => new Set(value.map((u) => u.id)), [value]);
  const words = fold(q).split(/\s+/).filter(Boolean);
  const options = words.length ? all.filter((u) => !chosen.has(u.id) && words.every((w) => fold(u.name).includes(w))).slice(0, 8) : [];

  const add = (u: Ref) => { onChange([...value, u]); setQ(''); setActive(0); };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, options.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && open && options[active]) { e.preventDefault(); add(options[active]); }
    else if (e.key === 'Backspace' && !q && value.length) onChange(value.slice(0, -1));
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div ref={box} className="relative">
      <div className={`input flex min-h-[34px] flex-wrap items-center gap-1 py-1 ${disabled ? 'opacity-60' : ''}`}
        onClick={() => box.current?.querySelector('input')?.focus()}>
        {value.map((u) => (
          <span key={u.id} className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
            {u.name}
            {!disabled && <button type="button" aria-label={`Quitar a ${u.name}`} className="opacity-60 hover:opacity-100"
              onClick={(e) => { e.stopPropagation(); onChange(value.filter((x) => x.id !== u.id)); }}>×</button>}
          </span>
        ))}
        <input id={id} className="min-w-24 flex-1 bg-transparent text-sm outline-none" disabled={disabled} value={q}
          placeholder={value.length ? '' : placeholder}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }} onFocus={() => setOpen(true)} onKeyDown={onKey}
          role="combobox" aria-expanded={open} aria-autocomplete="list" />
      </div>
      {open && options.length > 0 && (
        <ul role="listbox" className="card absolute z-50 mt-1 max-h-56 w-full overflow-y-auto py-1 shadow-lg">
          {options.map((u, i) => (
            <li key={u.id} role="option" aria-selected={i === active}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => add(u)} onMouseEnter={() => setActive(i)}
                className={`w-full px-3 py-1.5 text-left text-sm ${i === active ? 'bg-zinc-100 dark:bg-zinc-800' : ''}`}>{u.name}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Lo que espera la API: nombres + si hay que crear las nuevas. */
export const tagsPayload = (tags: PickedTag[]) => ({ tags: tags.map((t) => t.name), createMissingTags: tags.some((t) => t.isNew) || undefined });

// ---------- Fecha límite con hora opcional (sin hora, la API la toma al fin de la jornada) ----------

/** ISO de la API → { date: "YYYY-MM-DD", time: "HH:MM" | "" } en hora local ("" si es medianoche). */
export function splitDeadline(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return { date: d.toLocaleDateString('en-CA'), time: time === '00:00' ? '' : time };
}

export const joinDeadline = (date: string, time: string) => (!date ? null : time ? `${date}T${time}` : date);

export function DeadlineInput({ date, time, onChange, disabled, id }: {
  date: string; time: string; onChange: (date: string, time: string) => void; disabled?: boolean; id?: string;
}) {
  return (
    <div className="flex gap-2">
      <input id={id} type="date" className="input min-w-0 flex-1" disabled={disabled} value={date} onChange={(e) => onChange(e.target.value, e.target.value ? time : '')} />
      <input type="time" className="input w-28" disabled={disabled || !date} value={time} onChange={(e) => onChange(date, e.target.value)}
        aria-label="Hora límite (opcional)" title="Hora (opcional)" />
    </div>
  );
}
