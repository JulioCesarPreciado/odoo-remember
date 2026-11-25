# odoo-remember - Odoo Asistencia

Recordatorios de asistencia en Odoo para macOS: una app de barra de menú te avisa
cuándo registrar entrada, comida y salida (con ubicación), y un panel local te deja
ver y actualizar tus tareas sin entrar a Odoo.

[![Version](https://img.shields.io/badge/version-1.2.0-blue.svg)](https://github.com/JulioCesarPreciado/odoo-remember/releases) [![License](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE) [![PGM](https://img.shields.io/badge/Powered%20by-PGM-blue.svg)](https://perspective.com.mx)

---

## 🧩 Qué incluye

- **App de barra de menú** (`macos/`, Swift): notificaciones con botón para registrar entrada, salida y hora de comida; obtiene la ubicación con Servicios de Ubicación y abre el panel en una ventana.
- **API local** (`server/`, Node + TypeScript + Hono) en `http://127.0.0.1:8787`: única pieza que habla con Odoo (JSON-RPC) y concentra la lógica.
- **Panel web** (`web/`, React + Tailwind): asistencia del día, mis tareas pendientes y tareas por proyecto.

```text
App de menú (Swift) ──┐
                      ├──► API local :8787 ──► Odoo (JSON-RPC)
Panel web (React) ────┘
```

Probado con **Odoo 18** (módulos Asistencias y Proyecto; Hojas de horas para registrar horas).

> Proyecto independiente: no está afiliado ni respaldado por Odoo S.A. "Odoo" es marca de Odoo S.A.

---

## 🛠 Requisitos

Para ejecutar este proyecto es necesario contar con las siguientes dependencias:

- macOS 13 o superior (Apple Silicon)
- Xcode Command Line Tools (`swiftc`, `codesign`, `iconutil`)
- Node.js v22 o superior
- pnpm v10 o superior
- Una cuenta de Odoo 18 con empleado asociado y una API key

---

## 🛠 Instalación para Desarrollo

1️⃣ **Clonar el repositorio**

```bash
git clone https://github.com/JulioCesarPreciado/odoo-remember.git
cd odoo-remember
```

2️⃣ **Preparar archivos de configuración**

```bash
cp .env.example .env
```

Llena `ODOO_HOST`, `ODOO_DB`, `ODOO_USER` y `ODOO_TOKEN` (en Odoo: Preferencias → Seguridad de la cuenta → Nueva clave API).

3️⃣ **Instalar dependencias**

```bash
pnpm install
```

4️⃣ **Levantar en modo desarrollo** (API con recarga en `:8787` + Vite en <http://localhost:5173>)

```bash
pnpm dev
```

5️⃣ **Instalar en tu Mac** (compila todo, instala `~/Applications/OdooRemember.app` y arranca la API y la app al iniciar sesión con dos LaunchAgents)

```bash
./install.sh
```

Después de cambiar código o `.env`, vuelve a correr `./install.sh`. Para quitarlo todo: `./uninstall.sh`.

6️⃣ **Dar permisos en macOS**

En **Configuración del Sistema**:

- **Notificaciones → Odoo Asistencia**: permitir, estilo **Alertas** (así el botón queda visible).
- **Privacidad y seguridad → Servicios de ubicación → Odoo Asistencia**: activar.

---

## 📦 Scripts disponibles

| Comando | Qué hace |
| ------- | -------- |
| `pnpm dev` | API (`tsx watch`) + interfaz (Vite) con recarga |
| `pnpm build` | Compila la API (`dist/server`) y la interfaz (`dist/web`) |
| `pnpm start` | Corre la API compilada |
| `pnpm typecheck` | Verifica tipos de la API y la interfaz |
| `./install.sh` | Compila e instala la app y los LaunchAgents |
| `./uninstall.sh` | Detiene y elimina la app y los LaunchAgents |
| `./release.sh <versión>` | Publica una release (ver abajo) |

---

## ⏰ Recordatorios (días laborales)

| Desde | Aviso | Botón | Se repite |
| ----- | ----- | ----- | --------- |
| 08:00 | Registrar entrada (si no hay entrada hoy) | Registrar entrada | cada 10 min |
| 14:00 | Hora de comida (si estás trabajando) | Salir a comer | una vez |
| salida a comer + 60 min | Regresa de comer | Registrar regreso | cada 10 min (hasta las 18:00) |
| 18:00 | Registrar salida (si sigues dentro) | Registrar salida | cada 10 min |

**Comida:** 60 min dentro de 14:00–16:00, así que se puede iniciar de 14:00 a 15:00. Odoo registra la salida a comer y el regreso como una salida y una entrada normales; la API guarda localmente (`data/state.json`) cuál fue la de comida.

---

## 📍 Ubicación

Cada entrada y salida (incluida la comida) se guarda en Odoo con la ubicación: `in_/out_latitude`, `longitude`, `city`, `country_name` y `browser = "Odoo Remember (macOS)"`.

- La app de barra de menú sigue la ubicación con Servicios de Ubicación de macOS (Wi-Fi, ±30–100 m), la convierte en ciudad/país y la envía a la API cada 5 min y justo antes de cada registro.
- Es **obligatoria** por defecto: sin una ubicación de los últimos 15 min, la API rechaza el registro (`409`). Por eso la app de barra de menú debe estar corriendo aunque registres desde el panel.
- La última ubicación se guarda solo en tu Mac (`data/location.json`, fuera del repositorio).

---

## 🖥 Panel

Ábrelo desde el icono de la barra de menú → **Abrir panel** (⌘P), o en <http://127.0.0.1:8787>.

- **Cuenta:** foto y nombre del usuario de Odoo con el que se registra todo, si el token sigue siendo válido, y servidor y base de datos a los que se conecta.
- **Tema:** Sistema, Claro u Oscuro (se recuerda la elección).
- **Asistencia de hoy:** entrada, comida, salida, tiempo trabajado y ubicación de cada registro; botones para registrar lo que falte.
- **Mis tareas pendientes:** asignadas a ti y abiertas, por proyecto o por fecha límite.
- **Tareas por proyecto:** proyectos donde tienes tareas, eres seguidor o responsable; tareas abiertas agrupadas por etapa (paginadas), filtro "solo mías", búsqueda y nueva tarea.
- **Detalle de tarea:** cambiar etapa, estado, prioridad y fecha límite; marcar como hecha; registrar horas; comentar en el chatter.

---

## 🔌 API local

Escucha solo en `127.0.0.1`, rechaza otros `Host`/`Origin` y exige `Content-Type: application/json` en las rutas que modifican, para que ninguna página web pueda registrar asistencias con tu cuenta.

| Método | Ruta | Descripción |
| ------ | ---- | ----------- |
| GET | `/api/account` | Cuenta de Odoo que usa la API y validación del token (`?fresh=1` vuelve a autenticar) |
| GET | `/api/account/avatar` | Foto de perfil del usuario en Odoo |
| GET | `/api/stages?projects=1,2` | Etapas de varios proyectos |
| GET | `/api/attendance/today` | Estado del día (`?fresh=1` sin caché) |
| GET / POST | `/api/location` | Ubicación actual `{latitude, longitude, accuracy?, city?, country?, at?}` |
| POST | `/api/attendance/check-in` · `check-out` | Entrada / salida |
| POST | `/api/attendance/lunch/start` · `lunch/end` | Salir a comer / regresar |
| GET | `/api/tasks/mine` | Mis tareas abiertas |
| GET | `/api/projects` | Proyectos donde participo (con conteos) |
| GET | `/api/projects/:id/stages` | Etapas del proyecto |
| GET | `/api/projects/:id/tasks?mine=1&q=&stage=&offset=&limit=` | Tareas abiertas agrupadas por etapa |
| POST | `/api/tasks` | Crear tarea `{projectId, name, description?, stageId?, deadline?, assignToMe?, priority?}` |
| GET | `/api/tasks/:id` | Detalle con horas y comentarios |
| PATCH | `/api/tasks/:id` | `{stageId?, state?, priority?, deadline?, name?}` |
| POST | `/api/tasks/:id/timesheets` | `{hours, description, date?}` |
| POST | `/api/tasks/:id/comments` | `{body}` |

```bash
curl -X POST -H 'Content-Type: application/json' http://127.0.0.1:8787/api/attendance/check-in
```

---

## 🚀 Release

Las releases se publican desde `main` con `release.sh`, siguiendo el flujo de ramas `develop → staging → main` y las notas de release de [pgm-standards](https://github.com/ReposPGM/pgm-standards) (`shared/BRANCHES.MD`, `shared/RELEASE-NOTES.MD`).

```bash
git checkout main
./release.sh 1.1.0
```

El script valida la rama y el working tree, verifica tipos y compila, actualiza la versión en `package.json` y en este README, crea el tag `vX.Y.Z` y publica la release en GitHub con las notas generadas de los commits `✨ feat` y `🐛 fix`.

---

## Variables de entorno

Copia `.env.example` a `.env`. El archivo `.env` contiene tu API key de Odoo y **nunca** se sube al repositorio.

| Variable | Default | Descripción |
| -------- | ------- | ----------- |
| `ODOO_HOST` | — | Dominio de tu Odoo (p. ej. `tu-empresa.odoo.com`) |
| `ODOO_DB` | — | Nombre de la base de datos |
| `ODOO_USER` | — | Usuario (correo) de Odoo |
| `ODOO_TOKEN` | — | API key de Odoo |
| `API_PORT` | `8787` | Puerto de la API local |
| `REMINDER_START` | `08:00` | Desde cuándo avisa la entrada |
| `CHECKOUT_REMINDER_START` | `18:00` | Desde cuándo avisa la salida |
| `REMINDER_INTERVAL_MIN` | `10` | Minutos entre avisos |
| `WORK_DAYS` | `1-5` | Días laborales: 1 = lunes … 7 = domingo (`1-5`, `1,2,3,4,5,6`) |
| `LUNCH_WINDOW_START` | `14:00` | Inicio de la ventana de comida |
| `LUNCH_WINDOW_END` | `16:00` | Fin de la ventana de comida |
| `LUNCH_MINUTES` | `60` | Duración de la comida |
| `REQUIRE_LOCATION` | `true` | Rechazar registros sin ubicación reciente |
| `LOCATION_MAX_AGE_MIN` | `15` | Antigüedad máxima de la ubicación (min) |

Logs: `~/Library/Logs/OdooRemember.log` y `~/Library/Logs/OdooRemember-api.log`.
