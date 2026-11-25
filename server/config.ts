import fs from 'node:fs';
import path from 'node:path';

/** Raíz del proyecto: el LaunchAgent fija WorkingDirectory; en desarrollo se corre desde la raíz. */
export const ROOT = process.env.ODOO_REMEMBER_ROOT ?? process.cwd();

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const env = process.env;

/** "08:30" → 510 minutos desde medianoche. */
function minutes(value: string | undefined, fallback: string): number {
  const [h, m = '0'] = (value ?? fallback).split(':');
  const n = Number(h) * 60 + Number(m);
  if (!Number.isFinite(n)) throw new Error(`Hora inválida: ${value}`);
  return n;
}

function workDays(value: string | undefined): Set<number> {
  const days = new Set<number>();
  for (const part of (value ?? '1-5').split(',')) {
    const [a, b] = part.split('-').map((s) => Number(s.trim()));
    if (b !== undefined) for (let d = a; d <= b; d++) days.add(d);
    else if (Number.isFinite(a)) days.add(a);
  }
  return days;
}

function required(name: string): string {
  const v = env[name];
  if (!v) throw new Error(`Falta ${name} en .env`);
  return v;
}

const host = required('ODOO_HOST');

export const config = {
  odoo: {
    url: host.startsWith('http') ? host : `https://${host}`,
    db: required('ODOO_DB'),
    user: required('ODOO_USER'),
    token: env.ODOO_TOKEN ?? required('ODOO_PASSWORD'),
  },
  host: '127.0.0.1',
  port: Number(env.API_PORT ?? 8787),
  reminders: {
    checkInAt: minutes(env.REMINDER_START, '08:00'),
    checkOutAt: minutes(env.CHECKOUT_REMINDER_START, '18:00'),
    intervalMinutes: Number(env.REMINDER_INTERVAL_MIN ?? 10),
    workDays: workDays(env.WORK_DAYS), // 1 = lunes … 7 = domingo
  },
  lunch: {
    from: minutes(env.LUNCH_WINDOW_START, '14:00'),
    to: minutes(env.LUNCH_WINDOW_END, '16:00'),
    minutes: Number(env.LUNCH_MINUTES ?? 60),
  },
  location: {
    required: (env.REQUIRE_LOCATION ?? 'true').toLowerCase() !== 'false',
    maxAgeMinutes: Number(env.LOCATION_MAX_AGE_MIN ?? 15),
  },
  dataDir: path.join(ROOT, 'data'),
  webDir: path.join(ROOT, 'dist', 'web'),
};
