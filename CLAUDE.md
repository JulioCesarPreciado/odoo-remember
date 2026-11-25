# odoo-remember — Contexto para Claude

Herramienta para macOS que recuerda registrar asistencia en Odoo 18 y muestra tareas
sin entrar a Odoo. Tres piezas:

- `server/` — API local (Node 22 + TypeScript + Hono) en `127.0.0.1:8787`. Única pieza
  que habla con Odoo (JSON-RPC); concentra la lógica de asistencia, comida, ubicación
  y tareas. Tipos compartidos con la interfaz en `server/types.ts`.
- `web/` — panel en React 19 + Tailwind 4 (Vite), servido por la API.
- `macos/main.swift` — app de barra de menú (AppKit, CoreLocation, UserNotifications);
  no habla con Odoo, solo con la API local.

Estándares: `../pgm-standards/shared/` (commits en inglés `<emoji> <type>: …`,
ramas `main`/`staging`/`develop` con `feature/*` y `hotfix/*`, README y notas de
release). Releases con `./release.sh <versión>` desde `main`.

Reglas propias:

- Repositorio **público**: nunca subir `.env`, `data/` (ubicación y estado local),
  hosts, bases de datos, correos ni coordenadas reales. La configuración va en `.env`
  y se documenta en `.env.example` y en el README.
- La API solo escucha en `127.0.0.1` y valida `Host`/`Origin`/`Content-Type`: no
  relajar esas verificaciones.
- Verificar con `pnpm typecheck` y `pnpm build`; la app Swift se compila en `./install.sh`.
