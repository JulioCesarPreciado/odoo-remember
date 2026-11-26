import { config } from './config.js';

/** Jornada laboral según la configuración: días de WORK_DAYS, de REMINDER_START a CHECKOUT_REMINDER_START, menos la comida. */

export const isWorkday = (d: Date) => config.reminders.workDays.has(((d.getDay() + 6) % 7) + 1);

const at = (day: Date, minute: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minute);

/** "YYYY-MM-DD" → ese día al inicio (start) o al fin (end) de la jornada, en hora local. */
export const workdayEdge = (date: string, edge: 'start' | 'end') =>
  at(new Date(`${date}T00:00:00`), edge === 'start' ? config.reminders.checkInAt : config.reminders.checkOutAt);

/** Minutos laborables entre `a` y `b`. La comida solo se descuenta en la parte que no cabe en la holgura de su ventana. */
export function workMinutesBetween(a: Date, b: Date): number {
  const { checkInAt, checkOutAt } = config.reminders;
  const { from, to, minutes: lunch } = config.lunch;
  const slack = Math.max(0, to - from - lunch);
  let total = 0;
  const day = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  for (let i = 0; day <= b && i < 400; i++, day.setDate(day.getDate() + 1)) {
    if (!isWorkday(day)) continue;
    const s = Math.max(a.getTime(), at(day, checkInAt).getTime());
    const e = Math.min(b.getTime(), at(day, checkOutAt).getTime());
    if (e <= s) continue;
    const overlap = Math.max(0, Math.min(e, at(day, to).getTime()) - Math.max(s, at(day, from).getTime())) / 60_000;
    total += (e - s) / 60_000 - Math.min(lunch, Math.max(0, overlap - slack));
  }
  return Math.round(total);
}

/** Horas laborables entre dos momentos, redondeadas al cuarto de hora (0 si no hay tiempo laboral). */
export const estimateHours = (start: Date, deadline: Date) =>
  Math.min(1000, Math.round(workMinutesBetween(start, deadline) / 15) / 4);
