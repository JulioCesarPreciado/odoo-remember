// Tipos compartidos entre la API y la interfaz web.

export type AttendanceStatus = 'no_entry' | 'stale' | 'working' | 'lunch' | 'out';
export type AttendanceAction = 'check_in' | 'check_out' | 'lunch_start' | 'lunch_end' | 'open_odoo';

export interface Reminder {
  kind: 'check_in' | 'stale' | 'check_out' | 'lunch_start' | 'lunch_end';
  title: string;
  body: string;
  action: AttendanceAction;
  /** true: repetir cada `reminderIntervalMinutes`; false: una sola vez al día. */
  repeat: boolean;
}

export interface GeoFix {
  latitude: number;
  longitude: number;
  accuracy: number | null;      // metros
  city: string | null;
  country: string | null;
  at: string;                   // ISO, cuándo se obtuvo
}

export interface Place { latitude: number; longitude: number; city: string | null; country: string | null }

export interface Today {
  date: string;                 // YYYY-MM-DD local
  now: string;                  // ISO
  status: AttendanceStatus;
  summary: string;              // texto corto para el menú
  firstCheckIn: string | null;  // ISO
  lastCheckOut: string | null;  // ISO, solo si ya no estás dentro
  staleSince: string | null;    // entrada abierta de otro día
  workedMinutes: number;
  intervals: { in: string; out: string | null; inPlace: Place | null; outPlace: Place | null }[];
  location: {
    required: boolean;
    maxAgeMinutes: number;
    current: GeoFix | null;     // reciente: se usará en el próximo registro
    last: GeoFix | null;        // la última recibida, aunque sea vieja
  };
  lunch: {
    start: string | null;
    end: string | null;
    returnDueAt: string | null;
    window: { from: string; to: string; minutes: number };
    canStart: boolean;
    inWindow: boolean;          // la hora actual está dentro del horario de comida
    reason: string | null;      // por qué no se puede iniciar
    notice: string | null;      // se puede iniciar, pero fuera del horario: pedir confirmación
  };
  actions: { checkIn: boolean; checkOut: boolean; lunchStart: boolean; lunchEnd: boolean };
  reminder: Reminder | null;
  reminderIntervalMinutes: number;
  odooAttendanceUrl: string;
}

export type TaskState = '01_in_progress' | '02_changes_requested' | '03_approved' | '04_waiting_normal' | '1_done' | '1_canceled';

export interface Ref { id: number; name: string }

export interface Task {
  id: number;
  name: string;
  project: Ref | null;
  stage: Ref | null;
  state: TaskState;
  priority: boolean;
  deadline: string | null;      // YYYY-MM-DD local
  deadlineAt: string | null;    // ISO (Odoo guarda fecha y hora)
  assignees: Ref[];
  tags: string[];
  allocatedHours: number;
  effectiveHours: number;
  mine: boolean;
  url: string;
}

export interface TaskDetail extends Task {
  description: string;          // texto plano
  timesheets: { id: number; date: string; name: string; hours: number; employee: string | null }[];
  messages: { id: number; date: string; author: string | null; body: string }[];
}

export interface ProjectSummary extends Ref {
  favorite: boolean;
  openTasks: number;
  myOpenTasks: number;
  allowTimesheets: boolean;
}

export interface Stage extends Ref { fold: boolean }

export interface StageGroup {
  stage: Stage | null;          // null = sin etapa
  count: number;
  tasks: Task[];
}

export interface ProjectBoard {
  project: ProjectSummary;
  stages: Stage[];
  groups: StageGroup[];
  total: number;
}

/** Cuenta de Odoo con la que la API hace todo (la del token en `.env`). */
export interface Account {
  uid: number;
  name: string;
  login: string;
  company: string | null;
  employee: { name: string; job: string | null; department: string | null } | null;
  avatarUrl: string;            // ruta local que sirve la foto de Odoo
  profileUrl: string;           // perfil en Odoo
  odoo: { host: string; db: string; version: string | null };
  verifiedAt: string;           // ISO, última vez que Odoo aceptó el token
}

/** Temporizador de Odoo corriendo en una tarea. */
export interface TimerInfo {
  taskId: number;
  taskName: string;
  project: Ref | null;
  startedAt: string;            // ISO
  paused: boolean;
  elapsedMinutes: number;
  url: string;
}

/** Cambios a una tarea (crear y editar). */
export interface TaskPatch {
  stageId?: number;
  state?: TaskState;
  priority?: boolean;
  /** "YYYY-MM-DD" (medianoche local) o fecha-hora ISO; null la quita. */
  deadline?: string | null;
  name?: string;
  /** Reemplaza las etiquetas por estas (por nombre). */
  tags?: string[];
  createMissingTags?: boolean;
  allocatedHours?: number;
  /** Inicio planeado (fecha-hora). */
  plannedStart?: string | null;
}

/** Fechas planeadas que tendría una tarea nueva (GET /api/estimate). */
export interface Estimate {
  start: string | null;       // inicio planeado (ahora o la hora indicada)
  deadline: string | null;    // fecha límite resuelta (una fecha sola = fin de la jornada)
  hours: number;              // tiempo laboral entre ambos, en horas
}

export interface NewTask extends Omit<TaskPatch, 'state' | 'deadline' | 'plannedStart'> {
  projectId: number;
  name: string;
  description?: string;
  deadline?: string;
  /** Por defecto: ahora (o `startedAt`). */
  plannedStart?: string;
  /** Por defecto true: asignada al usuario del token. */
  assignToMe?: boolean;
  /** "Ya empecé a las…": inicia el temporizador con esa hora de inicio. */
  startedAt?: string;
}
