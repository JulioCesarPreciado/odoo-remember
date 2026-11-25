import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { HttpError, fromOdoo, odoo, toOdoo } from './odoo.js';
import { freshLocation, lastLocation, locationForAttendance, odooGeoFields } from './location.js';
import type { GeoFix, Place, Reminder, Today } from './types.js';

// ---------- Estado local de la comida (Odoo no distingue una salida a comer de otra salida) ----------

type DayState = { lunchStart?: string; lunchEnd?: string };
const stateFile = path.join(config.dataDir, 'state.json');

function readState(): Record<string, DayState> {
  try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return {}; }
}

function saveDay(date: string, day: DayState) {
  const all = readState();
  all[date] = day;
  const keep = Object.keys(all).sort().slice(-14);            // conservar dos semanas
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(Object.fromEntries(keep.map((k) => [k, all[k]])), null, 2));
}

// ---------- Utilidades de tiempo (hora local de la Mac) ----------

const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const minuteOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtMinutes = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const isWorkday = (d: Date) => config.reminders.workDays.has(((d.getDay() + 6) % 7) + 1);
const humanDate = (d: Date) =>
  localDate(d) === localDate(new Date()) ? hhmm(d) : d.toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// ---------- Lectura de Odoo con caché corta (la app de menú consulta cada minuto) ----------

type Interval = { in: Date; out: Date | null; inPlace: Place | null; outPlace: Place | null };
type Raw = { isIn: boolean; lastCheckIn: Date | null; intervals: Interval[] };

type GeoRow = Record<`${'in' | 'out'}_${'latitude' | 'longitude' | 'city' | 'country_name'}`, number | string | false>;
const GEO_FIELDS = ['in', 'out'].flatMap((p) => ['latitude', 'longitude', 'city', 'country_name'].map((f) => `${p}_${f}`));

function place(r: GeoRow, p: 'in' | 'out'): Place | null {
  const lat = r[`${p}_latitude`], lon = r[`${p}_longitude`];
  if (typeof lat !== 'number' || typeof lon !== 'number' || (lat === 0 && lon === 0)) return null;
  return { latitude: lat, longitude: lon, city: (r[`${p}_city`] as string) || null, country: (r[`${p}_country_name`] as string) || null };
}
let cache: { at: number; date: string; raw: Raw } | null = null;
export const invalidate = () => { cache = null; };

/** Mensaje cuando el usuario no tiene permisos de asistencias en Odoo (lo normal para empleados sin rol de RH). */
export const NO_ATTENDANCE_ACCESS =
  'Tu usuario de Odoo no tiene permisos de asistencias. Pide a un administrador de Odoo que te asigne el grupo ' +
  '«Asistencias: Oficial» y que en tu ficha de empleado te ponga como tu propio responsable de asistencias; así solo podrás ver y registrar las tuyas.';

/** Traduce el AccessError de Odoo sobre asistencias a un mensaje que diga qué hacer. */
async function guarded<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof HttpError && e.status === 403) throw new HttpError(NO_ATTENDANCE_ACCESS, 403);
    throw e;
  }
}

async function employeeId(): Promise<number> {
  const { employeeId } = await odoo.me();
  if (!employeeId) throw new HttpError('Tu usuario no tiene un empleado asociado en Odoo', 404);
  return employeeId;
}

async function fetchRaw(now: Date, fresh = false): Promise<Raw> {
  const date = localDate(now);
  if (!fresh && cache && cache.date === date && Date.now() - cache.at < 20_000) return cache.raw;
  const emp = await employeeId();
  const [[e], rows] = await guarded(Promise.all([
    odoo.call<{ attendance_state: string; last_check_in: string | false }[]>('hr.employee', 'read', [[emp]], {
      fields: ['attendance_state', 'last_check_in'],
    }),
    odoo.searchRead<{ check_in: string; check_out: string | false } & GeoRow>(
      'hr.attendance',
      [['employee_id', '=', emp], ['check_in', '>=', toOdoo(startOfDay(now))]],
      { fields: ['check_in', 'check_out', ...GEO_FIELDS], order: 'check_in asc' },
    ),
  ]));
  const raw: Raw = {
    isIn: e.attendance_state === 'checked_in',
    lastCheckIn: fromOdoo(e.last_check_in),
    intervals: rows.map((r) => ({
      in: fromOdoo(r.check_in)!,
      out: fromOdoo(r.check_out),
      inPlace: place(r, 'in'),
      outPlace: r.check_out ? place(r, 'out') : null,
    })),
  };
  cache = { at: Date.now(), date, raw };
  return raw;
}

// ---------- Estado del día ----------

export async function today(opts: { fresh?: boolean } = {}): Promise<Today> {
  const now = new Date();
  const date = localDate(now);
  const raw = await fetchRaw(now, opts.fresh);
  const day = readState()[date] ?? {};

  // Si regresó de comer por otro medio (web, celular), tomamos esa entrada como fin de la comida.
  if (day.lunchStart && !day.lunchEnd && raw.isIn) {
    const back = raw.intervals.find((i) => i.in >= new Date(day.lunchStart!));
    if (back) { day.lunchEnd = back.in.toISOString(); saveDay(date, day); }
  }

  const stale = raw.isIn && raw.intervals.length === 0;
  const inLunch = !!day.lunchStart && !day.lunchEnd && !raw.isIn;
  const status: Today['status'] = stale ? 'stale'
    : raw.intervals.length === 0 ? 'no_entry'
    : raw.isIn ? 'working'
    : inLunch ? 'lunch' : 'out';

  const first = raw.intervals[0]?.in ?? null;
  const lastOut = !raw.isIn && raw.intervals.length ? raw.intervals.at(-1)!.out : null;
  const worked = raw.intervals.reduce((s, i) => s + ((i.out ?? now).getTime() - i.in.getTime()), 0);

  const { from, to, minutes: lunchMin } = config.lunch;
  const latestStart = to - lunchMin;
  const m = minuteOfDay(now);
  let reason: string | null = null;
  if (day.lunchStart) reason = 'Ya tomaste tu hora de comida hoy.';
  else if (status !== 'working') reason = 'Debes tener la entrada registrada.';
  else if (m < from || m > latestStart)
    reason = `La comida (${lunchMin} min) se toma entre ${fmtMinutes(from)} y ${fmtMinutes(to)}; puedes salir de ${fmtMinutes(from)} a ${fmtMinutes(latestStart)}.`;
  const canStart = reason === null;
  const returnDue = day.lunchStart ? new Date(new Date(day.lunchStart).getTime() + lunchMin * 60_000) : null;

  const t: Today = {
    date,
    now: now.toISOString(),
    status,
    summary: '',
    firstCheckIn: first?.toISOString() ?? null,
    lastCheckOut: status === 'out' ? lastOut?.toISOString() ?? null : null,   // durante la comida no es "salida"
    staleSince: stale && raw.lastCheckIn ? raw.lastCheckIn.toISOString() : null,
    workedMinutes: Math.round(worked / 60_000),
    intervals: raw.intervals.map((i) => ({ in: i.in.toISOString(), out: i.out?.toISOString() ?? null, inPlace: i.inPlace, outPlace: i.outPlace })),
    location: {
      required: config.location.required,
      maxAgeMinutes: config.location.maxAgeMinutes,
      current: freshLocation(),
      last: lastLocation(),
    },
    lunch: {
      start: day.lunchStart ?? null,
      end: day.lunchEnd ?? null,
      returnDueAt: returnDue?.toISOString() ?? null,
      window: { from: fmtMinutes(from), to: fmtMinutes(to), minutes: lunchMin },
      canStart,
      reason,
    },
    actions: {
      checkIn: status === 'no_entry' || status === 'out',
      checkOut: status === 'working',
      lunchStart: canStart,
      lunchEnd: status === 'lunch',
    },
    reminder: null,
    reminderIntervalMinutes: config.reminders.intervalMinutes,
    odooAttendanceUrl: `${config.odoo.url}/odoo/attendances`,
  };
  t.summary = summary(t);
  t.reminder = reminder(t, now, returnDue);
  return t;
}

function summary(t: Today): string {
  const h = (iso: string | null) => (iso ? hhmm(new Date(iso)) : '—');
  switch (t.status) {
    case 'no_entry': return 'Sin entrada registrada hoy';
    case 'stale': return `Entrada abierta desde el ${humanDate(new Date(t.staleSince!))} sin salida`;
    case 'working': return `Entrada ${h(t.firstCheckIn)}` + (t.lunch.start ? ` · Comida ${h(t.lunch.start)}–${h(t.lunch.end)}` : '');
    case 'lunch': return `Entrada ${h(t.firstCheckIn)} · En comida desde ${h(t.lunch.start)} (regreso ${h(t.lunch.returnDueAt)})`;
    case 'out': return `Entrada ${h(t.firstCheckIn)} · Salida ${h(t.lastCheckOut)}`;
  }
}

function reminder(t: Today, now: Date, returnDue: Date | null): Reminder | null {
  if (!isWorkday(now)) return null;
  const m = minuteOfDay(now);
  const { checkInAt, checkOutAt } = config.reminders;
  switch (t.status) {
    case 'no_entry':
      return m >= checkInAt
        ? { kind: 'check_in', title: 'Registrar entrada', body: 'Aún no has registrado tu entrada en Odoo.', action: 'check_in', repeat: true }
        : null;
    case 'stale':
      return m >= checkInAt
        ? { kind: 'stale', title: 'Asistencia abierta en Odoo', body: `${t.summary}. Ciérrala en Odoo para poder registrar la de hoy.`, action: 'open_odoo', repeat: true }
        : null;
    case 'lunch':
      // Hasta la hora de salida: si no regresó para entonces, asumimos que se fue.
      return returnDue && now >= returnDue && m < checkOutAt
        ? { kind: 'lunch_end', title: 'Regresa de comer', body: `Saliste a comer a las ${hhmm(new Date(t.lunch.start!))}. Registra tu regreso.`, action: 'lunch_end', repeat: true }
        : null;
    case 'working':
      if (m >= checkOutAt)
        return { kind: 'check_out', title: 'Registrar salida', body: `Entraste a las ${hhmm(new Date(t.firstCheckIn!))}. No olvides registrar tu salida.`, action: 'check_out', repeat: true };
      if (t.lunch.canStart)
        return { kind: 'lunch_start', title: 'Hora de comida', body: `Puedes salir a comer entre ${t.lunch.window.from} y ${t.lunch.window.to} (${t.lunch.window.minutes} min).`, action: 'lunch_start', repeat: false };
      return null;
    case 'out':
      return null;
  }
}

// ---------- Acciones ----------

async function createCheckIn(at: Date, fix: GeoFix | null) {
  await guarded(odoo.call('hr.attendance', 'create', [{ employee_id: await employeeId(), check_in: toOdoo(at), ...odooGeoFields('in', fix) }]));
}

async function closeOpen(at: Date, fix: GeoFix | null) {
  const [id] = await guarded(odoo.call<number[]>('hr.attendance', 'search',
    [[['employee_id', '=', await employeeId()], ['check_out', '=', false]]], { order: 'check_in desc', limit: 1 }));
  if (!id) throw new HttpError('No se encontró una entrada abierta', 409);
  await guarded(odoo.call('hr.attendance', 'write', [[id], { check_out: toOdoo(at), ...odooGeoFields('out', fix) }]));
}

export async function checkIn(): Promise<Today> {
  const t = await today({ fresh: true });
  if (t.status === 'stale') throw new HttpError(`${t.summary}. Ciérrala en Odoo y vuelve a intentarlo.`, 409);
  if (t.status === 'working') return t;
  const fix = locationForAttendance();
  const now = new Date();
  await createCheckIn(now, fix);
  if (t.status === 'lunch') saveDay(t.date, { ...readState()[t.date], lunchEnd: now.toISOString() });
  invalidate();
  return today({ fresh: true });
}

export async function checkOut(): Promise<Today> {
  const t = await today({ fresh: true });
  if (t.status !== 'working') throw new HttpError('No tienes una entrada abierta hoy.', 409);
  const fix = locationForAttendance();
  await closeOpen(new Date(), fix);
  invalidate();
  return today({ fresh: true });
}

export async function lunchStart(): Promise<Today> {
  const t = await today({ fresh: true });
  if (!t.lunch.canStart) throw new HttpError(t.lunch.reason ?? 'No puedes salir a comer ahora.', 409);
  const fix = locationForAttendance();
  const now = new Date();
  await closeOpen(now, fix);
  saveDay(t.date, { lunchStart: now.toISOString() });
  invalidate();
  return today({ fresh: true });
}

export async function lunchEnd(): Promise<Today> {
  const t = await today({ fresh: true });
  if (t.status !== 'lunch') throw new HttpError('No estás en tu hora de comida.', 409);
  return checkIn();
}
