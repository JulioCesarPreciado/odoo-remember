import { useEffect, useState, type ReactNode } from 'react';

export type Theme = 'system' | 'light' | 'dark';

const KEY = 'theme';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

function readTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch { return 'system'; }
}

/** Aplica el tema a <html> y avisa a la app de macOS para que la barra de título coincida. */
function apply(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && media().matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  type Bridge = { webkit?: { messageHandlers?: { theme?: { postMessage: (v: string) => void } } } };
  (window as Bridge).webkit?.messageHandlers?.theme?.postMessage(theme);
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    apply(theme);
    try { theme === 'system' ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, theme); } catch { /* sin almacenamiento */ }
    if (theme !== 'system') return;
    const m = media();
    const onChange = () => apply('system');
    m.addEventListener('change', onChange);
    return () => m.removeEventListener('change', onChange);
  }, [theme]);

  return [theme, setTheme] as const;
}

const icon = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);

const OPTIONS: { id: Theme; label: string; icon: ReactNode }[] = [
  { id: 'system', label: 'Sistema', icon: icon(<><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>) },
  { id: 'light', label: 'Claro', icon: icon(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></>) },
  { id: 'dark', label: 'Oscuro', icon: icon(<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />) },
];

export function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  return (
    <div role="radiogroup" aria-label="Tema" className="flex rounded-lg border border-zinc-200 bg-white p-0.5 dark:border-zinc-700 dark:bg-zinc-900">
      {OPTIONS.map((o) => (
        <button key={o.id} role="radio" aria-checked={theme === o.id} title={o.label} onClick={() => setTheme(o.id)}
          className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition ${theme === o.id
            ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
            : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'}`}>
          {o.icon}<span className="hidden sm:inline">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
