import { config } from './config.js';

/** Error con código HTTP para que la API responda adecuadamente. */
export class HttpError extends Error {
  constructor(message: string, public status: 400 | 403 | 404 | 409 | 422 | 502 = 400) {
    super(message);
  }
}

type Kwargs = Record<string, unknown>;

/** Fecha → "YYYY-MM-DD HH:MM:SS" en UTC (formato de Odoo). */
export const toOdoo = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
/** "YYYY-MM-DD HH:MM:SS" (UTC) o false → Date | null. */
export const fromOdoo = (s: unknown) => (typeof s === 'string' && s ? new Date(s.replace(' ', 'T') + 'Z') : null);
/** many2one [id, name] o false → {id, name} | null. */
export const ref = (v: unknown) => (Array.isArray(v) ? { id: v[0] as number, name: v[1] as string } : null);

class Odoo {
  private uid?: number;
  private ids?: Promise<{ uid: number; partnerId: number; employeeId: number | null }>;

  private async rpc<T>(service: string, method: string, args: unknown[]): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${config.odoo.url}/jsonrpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: Date.now(), params: { service, method, args } }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      throw new HttpError(`No se pudo conectar con Odoo: ${(e as Error).message}`, 502);
    }
    if (!res.ok) throw new HttpError(`Odoo respondió HTTP ${res.status}`, 502);
    const json = (await res.json()) as { result?: T; error?: { message: string; data?: { name?: string; message?: string } } };
    if (json.error) {
      const name = json.error.data?.name ?? '';
      const msg = json.error.data?.message ?? json.error.message;
      const status = name.includes('AccessError') || name.includes('AccessDenied') ? 403
        : name.includes('ValidationError') || name.includes('UserError') || name.includes('MissingError') ? 422 : 502;
      throw new HttpError(msg, status);
    }
    return json.result as T;
  }

  private async login(): Promise<number> {
    if (this.uid) return this.uid;
    const { db, user, token } = config.odoo;
    const uid = await this.rpc<number | false>('common', 'authenticate', [db, user, token, {}]);
    if (!uid) throw new HttpError('No se pudo iniciar sesión en Odoo (revisa usuario/token)', 502);
    return (this.uid = uid);
  }

  async call<T>(model: string, method: string, args: unknown[], kwargs: Kwargs = {}): Promise<T> {
    const uid = await this.login();
    const { db, token } = config.odoo;
    return this.rpc<T>('object', 'execute_kw', [db, uid, token, model, method, args, kwargs]);
  }

  searchRead<T = Record<string, unknown>>(model: string, domain: unknown[], kwargs: Kwargs = {}) {
    return this.call<T[]>(model, 'search_read', [domain], kwargs);
  }

  /** uid, partner y empleado del usuario configurado (se consultan una sola vez). */
  me() {
    this.ids ??= (async () => {
      const uid = await this.login();
      const [user] = await this.call<{ partner_id: [number, string] }[]>('res.users', 'read', [[uid]], { fields: ['partner_id'] });
      const [emp] = await this.call<number[]>('hr.employee', 'search', [[['user_id', '=', uid]]], { limit: 1 });
      return { uid, partnerId: user.partner_id[0], employeeId: emp ?? null };
    })().catch((e) => { this.ids = undefined; throw e; });
    return this.ids;
  }

  private names = new Map<string, Map<number, string>>();

  /** Nombres de registros con caché (usuarios, etiquetas…). */
  async nameMap(model: string, ids: number[]): Promise<Map<number, string>> {
    const cache = this.names.get(model) ?? new Map<number, string>();
    this.names.set(model, cache);
    const missing = [...new Set(ids)].filter((id) => !cache.has(id));
    if (missing.length) {
      const rows = await this.call<{ id: number; display_name: string }[]>(model, 'read', [missing], { fields: ['display_name'] });
      for (const r of rows) cache.set(r.id, r.display_name);
    }
    return cache;
  }

  recordUrl(model: string, id: number) {
    return `${config.odoo.url}/odoo/${model}/${id}`;
  }
}

export const odoo = new Odoo();
