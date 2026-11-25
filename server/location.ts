import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { HttpError } from './odoo.js';
import type { GeoFix } from './types.js';

// La API no puede obtener la ubicación por sí misma: la app de barra de menú (CoreLocation)
// la envía con POST /api/location cada pocos minutos y justo antes de cada registro.

const file = path.join(config.dataDir, 'location.json');
let last: GeoFix | null = (() => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as GeoFix; } catch { return null; }
})();

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null);

export function setLocation(input: unknown): GeoFix {
  const o = (input ?? {}) as Record<string, unknown>;
  const latitude = num(o.latitude), longitude = num(o.longitude);
  if (latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new HttpError('Ubicación inválida: se requieren latitude y longitude', 400);
  }
  const at = typeof o.at === 'string' && !Number.isNaN(Date.parse(o.at)) ? new Date(o.at) : new Date();
  last = {
    latitude,
    longitude,
    accuracy: num(o.accuracy),
    city: str(o.city),
    country: str(o.country),
    at: (at > new Date() ? new Date() : at).toISOString(),
  };
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(last));
  return last;
}

export const lastLocation = () => last;

/** Ubicación lo bastante reciente para registrar asistencia, o null. */
export function freshLocation(): GeoFix | null {
  if (!last) return null;
  const age = Date.now() - Date.parse(last.at);
  return age <= config.location.maxAgeMinutes * 60_000 ? last : null;
}

/** Ubicación a usar en un registro; lanza error si es obligatoria y no hay una reciente. */
export function locationForAttendance(): GeoFix | null {
  const fix = freshLocation();
  if (!fix && config.location.required) {
    throw new HttpError(
      'No hay una ubicación reciente y es obligatoria para registrar asistencia. ' +
      'Verifica que la app "Odoo Asistencia" esté abierta y tenga permiso en Configuración del Sistema → Privacidad y seguridad → Servicios de ubicación.',
      409,
    );
  }
  return fix;
}

/** Campos de hr.attendance (Odoo 18) para la entrada ('in') o la salida ('out'). */
export function odooGeoFields(prefix: 'in' | 'out', fix: GeoFix | null): Record<string, unknown> {
  if (!fix) return {};
  return {
    [`${prefix}_latitude`]: fix.latitude,
    [`${prefix}_longitude`]: fix.longitude,
    [`${prefix}_city`]: fix.city ?? false,
    [`${prefix}_country_name`]: fix.country ?? false,
    [`${prefix}_browser`]: 'Odoo Remember (macOS)',
  };
}

export const placeLabel = (p: { city: string | null; country: string | null } | null) =>
  p ? [p.city, p.country].filter(Boolean).join(', ') || 'Ubicación registrada' : null;
