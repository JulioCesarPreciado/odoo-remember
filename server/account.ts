import { config } from './config.js';
import { HttpError, odoo, ref } from './odoo.js';
import type { Account } from './types.js';

const TTL = 5 * 60_000;
let cached: { at: number; value: Account } | null = null;
let avatar: { key: string; bytes: Buffer; type: string } | null = null;

/** Cuenta de Odoo que usa la API. Con `fresh` vuelve a validar el token contra Odoo. */
export async function account({ fresh = false } = {}): Promise<Account> {
  if (!fresh && cached && Date.now() - cached.at < TTL) return cached.value;

  const uid = await odoo.verify();
  const [[user], version] = await Promise.all([
    odoo.call<{ name: string; login: string; company_id: unknown; write_date: string }[]>('res.users', 'read', [[uid]],
      { fields: ['name', 'login', 'company_id', 'write_date'] }),
    odoo.serverVersion(),
  ]);
  const [emp] = await odoo.searchRead<{ name: string; job_title: string | false; department_id: unknown }>('hr.employee',
    [['user_id', '=', uid]], { fields: ['name', 'job_title', 'department_id'], limit: 1 }).catch(() => []);

  const value: Account = {
    uid,
    name: user.name,
    login: user.login,
    company: ref(user.company_id)?.name ?? null,
    employee: emp ? { name: emp.name, job: emp.job_title || null, department: ref(emp.department_id)?.name ?? null } : null,
    avatarUrl: `/api/account/avatar?v=${encodeURIComponent(user.write_date)}`,
    profileUrl: `${config.odoo.url}/odoo/action-base.action_res_users_my`,
    odoo: { host: new URL(config.odoo.url).host, db: config.odoo.db, version },
    verifiedAt: new Date().toISOString(),
  };
  cached = { at: Date.now(), value };
  return value;
}

/** Detecta el tipo de imagen por sus primeros bytes (Odoo guarda PNG, JPEG, WebP o un SVG generado). */
function imageType(b: Buffer): string | null {
  if (b.subarray(0, 4).toString('hex') === '89504e47') return 'image/png';
  if (b.subarray(0, 2).toString('hex') === 'ffd8') return 'image/jpeg';
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (/^\s*(<\?xml|<svg)/i.test(b.subarray(0, 100).toString())) return 'image/svg+xml';
  return null;
}

/** Foto de perfil del usuario en Odoo (128 px), en caché mientras no cambie el usuario. */
export async function accountAvatar(): Promise<{ bytes: Buffer; type: string }> {
  const { uid } = await odoo.me();
  const [u] = await odoo.call<{ image_128: string | false; write_date: string }[]>('res.users', 'read', [[uid]],
    { fields: ['image_128', 'write_date'] });
  if (avatar?.key === u.write_date) return avatar;
  if (!u.image_128) throw new HttpError('El usuario no tiene foto', 404);
  const bytes = Buffer.from(u.image_128, 'base64');
  const type = imageType(bytes);
  if (!type) throw new HttpError('Formato de foto no reconocido', 422);
  avatar = { key: u.write_date, bytes, type };
  return avatar;
}
