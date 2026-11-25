import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Account as AccountInfo } from '../api';
import { hhmm, Spinner } from '../ui';

/** Iniciales para cuando no hay foto. */
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

function Avatar({ account, className }: { account: AccountInfo; className: string }) {
  const [failed, setFailed] = useState(false);
  return failed
    ? <span className={`${className} flex items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white`}>{initials(account.name)}</span>
    : <img src={account.avatarUrl} alt="" onError={() => setFailed(true)} className={`${className} rounded-full object-cover`} />;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium">{children}</dd>
    </div>
  );
}

/** Muestra con qué cuenta de Odoo se hacen las acciones y si el token sigue siendo válido. */
export function Account() {
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const check = useCallback((fresh: boolean) => {
    setChecking(true);
    api.account(fresh)
      .then((a) => { setAccount(a); setError(null); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setChecking(false));
  }, []);
  useEffect(() => check(true), [check]);

  // Cerrar al hacer clic fuera o con Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const ok = !!account && !error;
  const dot = checking ? 'bg-zinc-400' : ok ? 'bg-emerald-500' : 'bg-red-500';

  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog"
        className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white py-1 pl-1 pr-2.5 text-left transition hover:border-brand-500 dark:border-zinc-700 dark:bg-zinc-900">
        <span className="relative">
          {account
            ? <Avatar account={account} className="size-7" />
            : <span className="flex size-7 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-800">{checking ? <Spinner className="size-3" /> : '!'}</span>}
          <span className={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-white dark:ring-zinc-900 ${dot}`} />
        </span>
        <span className="hidden leading-tight sm:block">
          <span className="block max-w-40 truncate text-xs font-medium">{account?.name ?? (checking ? 'Verificando…' : 'Sin conexión')}</span>
          <span className={`block text-[11px] ${ok ? 'text-emerald-600 dark:text-emerald-400' : error ? 'text-red-600' : 'text-zinc-500'}`}>
            {checking && !account ? 'Comprobando token' : ok ? 'Token válido' : 'Token no válido'}
          </span>
        </span>
      </button>

      {open && (
        <div role="dialog" aria-label="Cuenta de Odoo"
          className="card absolute right-0 z-30 mt-2 w-80 p-4 shadow-xl shadow-zinc-900/10 dark:shadow-black/40">
          {account && (
            <div className="flex items-center gap-3">
              <Avatar account={account} className="size-12" />
              <div className="min-w-0">
                <p className="truncate font-semibold">{account.name}</p>
                <p className="truncate text-xs text-zinc-500">{account.login}</p>
              </div>
            </div>
          )}

          <p className={`mt-3 rounded-lg px-3 py-2 text-xs ${ok
            ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
            : 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300'}`}>
            {ok
              ? 'Las entradas, salidas y cambios en tareas se registran en Odoo con esta cuenta.'
              : error ?? 'No se pudo comprobar la cuenta.'}
          </p>

          {account && (
            <dl className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800">
              {account.employee?.job && <Row label="Puesto">{account.employee.job}</Row>}
              {account.employee?.department && <Row label="Departamento">{account.employee.department}</Row>}
              {!account.employee && <Row label="Empleado"><span className="text-amber-600">Sin empleado vinculado</span></Row>}
              {account.company && <Row label="Empresa">{account.company}</Row>}
              <Row label="Servidor">{account.odoo.host}</Row>
              <Row label="Base de datos"><span title={account.odoo.db}>{account.odoo.db}</span></Row>
              {account.odoo.version && <Row label="Versión">Odoo {account.odoo.version}</Row>}
              <Row label="Verificado">{hhmm(account.verifiedAt)}</Row>
            </dl>
          )}

          <div className="mt-3 flex gap-2">
            <button className="btn-ghost flex-1" onClick={() => check(true)} disabled={checking}>
              {checking && <Spinner className="size-3" />} Verificar de nuevo
            </button>
            {account && <a className="btn-ghost flex-1" href={account.profileUrl} target="_blank" rel="noreferrer">Mi perfil en Odoo</a>}
          </div>
        </div>
      )}
    </div>
  );
}
