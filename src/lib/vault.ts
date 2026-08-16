/**
 * Vault bridge + task mutations.
 *
 * Storage lives in Rust; this module owns every rule about what a task *means*.
 * When Vite runs outside Tauri (plain `pnpm dev` in a browser) it falls back to
 * localStorage so the UI can be iterated on without a native build.
 */

import { emptyVault, PROJECT_COLORS, type Priority, type Stats, type Status, type Task, type Vault } from './types';
import { todayISO } from './dates';

const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const DEV_KEY = 'todo.dev.vault';

// ── Transport ─────────────────────────────────────────────────────────────────

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(cmd, args);
}

export interface LoadedVault {
  vault: Vault;
  path: string;
}

export async function loadVault(): Promise<LoadedVault> {
  if (!inTauri) {
    const raw = localStorage.getItem(DEV_KEY);
    return { vault: raw ? normalise(JSON.parse(raw)) : emptyVault(), path: '(browser dev storage)' };
  }
  const res = await invoke<{ contents: string; path: string }>('read_vault');
  return { vault: normalise(JSON.parse(res.contents)), path: res.path };
}

/**
 * Persist the vault. `expectedUpdatedAt` guards against clobbering a change the
 * CLI made between our last read and this write; the caller reloads on conflict.
 */
export async function saveVault(vault: Vault, expectedUpdatedAt?: string): Promise<Vault> {
  const next: Vault = { ...vault, meta: { ...vault.meta, updatedAt: new Date().toISOString() } };
  const contents = `${JSON.stringify(next, null, 2)}\n`;

  if (!inTauri) {
    localStorage.setItem(DEV_KEY, contents);
    return next;
  }
  await invoke('write_vault', { contents, expectedUpdatedAt: expectedUpdatedAt ?? null });
  return next;
}

/** Subscribe to edits made outside the app (Claude, the CLI, file sync). */
export async function onVaultChanged(fn: (vault: Vault) => void): Promise<() => void> {
  if (!inTauri) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen<{ contents: string }>('vault-changed', (event) => {
    try {
      fn(normalise(JSON.parse(event.payload.contents)));
    } catch {
      // A torn read is possible if a writer is mid-rename; the next event wins.
    }
  });
  return unlisten;
}

export async function revealVault(): Promise<void> {
  if (inTauri) await invoke('reveal_vault');
}

export async function setTrayBadge(count: number, urgent: boolean): Promise<void> {
  if (inTauri) await invoke('set_tray_badge', { count, urgent });
}

// ── Normalisation ─────────────────────────────────────────────────────────────

/** Backfill fields so older vaults (or hand-edited ones) never crash the UI. */
function normalise(raw: Partial<Vault>): Vault {
  const base = emptyVault();
  return {
    ...base,
    ...raw,
    tasks: (raw.tasks ?? []).map((t, i) => ({
      ...t,
      tags: t.tags ?? [],
      subtasks: t.subtasks ?? [],
      priority: (typeof t.priority === 'number' ? t.priority : 2) as Priority,
      status: t.status ?? 'todo',
      order: typeof t.order === 'number' ? t.order : i,
      source: t.source ?? 'app',
    })),
    projects: raw.projects ?? [],
    digests: raw.digests ?? [],
    meta: { ...base.meta, ...(raw.meta ?? {}) },
  };
}

// ── Identity ──────────────────────────────────────────────────────────────────

export function newId(): string {
  const alphabet = '23456789abcdefghjkmnpqrstuvwxyz';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

// ── Mutations (pure: each returns a new Vault) ────────────────────────────────

export function ensureProject(vault: Vault, name?: string): Vault {
  if (!name?.trim()) return vault;
  const key = name.trim();
  if (vault.projects.some((p) => p.name.toLowerCase() === key.toLowerCase())) return vault;
  return {
    ...vault,
    projects: [
      ...vault.projects,
      {
        id: newId(),
        name: key,
        color: PROJECT_COLORS[vault.projects.length % PROJECT_COLORS.length],
        createdAt: new Date().toISOString(),
      },
    ],
  };
}

export function addTask(vault: Vault, draft: Partial<Task> & { title: string }): Vault {
  const withProject = ensureProject(vault, draft.project);
  const seq = (withProject.meta.lastSeq ?? 0) + 1;
  const now = new Date().toISOString();

  const task: Task = {
    id: newId(),
    status: 'todo',
    priority: 2,
    tags: [],
    subtasks: [],
    createdAt: now,
    updatedAt: now,
    order: seq,
    source: 'app',
    ...draft,
  };

  return {
    ...withProject,
    tasks: [...withProject.tasks, task],
    meta: { ...withProject.meta, lastSeq: seq },
  };
}

export function updateTask(vault: Vault, id: string, patch: Partial<Task>): Vault {
  const withProject = patch.project ? ensureProject(vault, patch.project) : vault;
  return {
    ...withProject,
    tasks: withProject.tasks.map((t) =>
      t.id === id ? { ...t, ...patch, updatedAt: new Date().toISOString() } : t,
    ),
  };
}

export function deleteTask(vault: Vault, id: string): Vault {
  return { ...vault, tasks: vault.tasks.filter((t) => t.id !== id) };
}

export function setStatus(vault: Vault, id: string, status: Status): Vault {
  const task = vault.tasks.find((t) => t.id === id);
  if (!task) return vault;

  const patch: Partial<Task> = { status };
  if (status === 'done' || status === 'cancelled') {
    patch.completedAt = new Date().toISOString();
    if (status === 'done') patch.subtasks = task.subtasks.map((s) => ({ ...s, done: true }));
  } else {
    patch.completedAt = undefined;
    if (status === 'doing' && !task.startedAt) patch.startedAt = new Date().toISOString();
  }

  let next = updateTask(vault, id, patch);
  if (status === 'done' && task.recurrence) next = spawnRecurrence(next, task);
  return next;
}

/** Completing a repeating task queues its next occurrence. */
function spawnRecurrence(vault: Vault, task: Task): Vault {
  const steps: Record<string, number> = { daily: 1, weekdays: 1, weekly: 7, biweekly: 14, monthly: 30 };
  const step = steps[task.recurrence ?? ''];
  if (!step) return vault;

  const from = new Date(`${task.due ?? todayISO()}T12:00:00`);
  from.setDate(from.getDate() + step);
  if (task.recurrence === 'weekdays') {
    while (from.getDay() === 0 || from.getDay() === 6) from.setDate(from.getDate() + 1);
  }

  const seq = (vault.meta.lastSeq ?? 0) + 1;
  const now = new Date().toISOString();
  return {
    ...vault,
    tasks: [
      ...vault.tasks,
      {
        ...task,
        id: newId(),
        status: 'todo',
        due: todayISO(from),
        createdAt: now,
        updatedAt: now,
        startedAt: undefined,
        completedAt: undefined,
        subtasks: task.subtasks.map((s) => ({ ...s, id: newId(), done: false })),
        order: seq,
      },
    ],
    meta: { ...vault.meta, lastSeq: seq },
  };
}

/** Space-bar / click behaviour: done ⇄ todo, with in-progress collapsing to done. */
export function toggleDone(vault: Vault, id: string): Vault {
  const task = vault.tasks.find((t) => t.id === id);
  if (!task) return vault;
  return setStatus(vault, id, task.status === 'done' ? 'todo' : 'done');
}

export function toggleSubtask(vault: Vault, taskId: string, subId: string): Vault {
  const task = vault.tasks.find((t) => t.id === taskId);
  if (!task) return vault;
  return updateTask(vault, taskId, {
    subtasks: task.subtasks.map((s) => (s.id === subId ? { ...s, done: !s.done } : s)),
  });
}

// ── Derived data ──────────────────────────────────────────────────────────────

export const isOpen = (t: Task) => t.status !== 'done' && t.status !== 'cancelled';

export function computeStats(vault: Vault, day = todayISO()): Stats {
  const open = vault.tasks.filter(isOpen);
  return {
    date: day,
    total: vault.tasks.length,
    open: open.length,
    doing: open.filter((t) => t.status === 'doing').length,
    blocked: open.filter((t) => t.status === 'blocked').length,
    overdue: open.filter((t) => t.due && t.due < day).length,
    dueToday: open.filter((t) => t.due === day).length,
    completedToday: vault.tasks.filter((t) => t.completedAt?.slice(0, 10) === day).length,
    urgent: open.filter((t) => t.priority === 0).length,
    streak: computeStreak(vault, day),
  };
}

/** Consecutive days ending today (or yesterday) with at least one completion. */
function computeStreak(vault: Vault, day: string): number {
  const done = new Set(
    vault.tasks.filter((t) => t.completedAt).map((t) => t.completedAt!.slice(0, 10)),
  );
  if (done.size === 0) return 0;

  const cursor = new Date(`${day}T12:00:00`);
  // Nothing finished yet today shouldn't read as a broken streak.
  if (!done.has(day)) cursor.setDate(cursor.getDate() - 1);

  let streak = 0;
  while (done.has(todayISO(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

const STATUS_ORDER: Record<Status, number> = {
  doing: 0, blocked: 1, todo: 2, inbox: 3, done: 4, cancelled: 5,
};

export function sortTasks(tasks: Task[], day = todayISO()): Task[] {
  return [...tasks].sort((a, b) => {
    if (STATUS_ORDER[a.status] !== STATUS_ORDER[b.status]) {
      return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    }
    // Anything due today or earlier floats above undated work.
    const aLate = a.due && a.due <= day ? 0 : 1;
    const bLate = b.due && b.due <= day ? 0 : 1;
    if (aLate !== bLate) return aLate - bLate;
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.due && b.due && a.due !== b.due) return a.due < b.due ? -1 : 1;
    if (Boolean(a.due) !== Boolean(b.due)) return a.due ? -1 : 1;
    return a.order - b.order;
  });
}

export function projectColor(vault: Vault, name?: string): string {
  if (!name) return 'var(--tint)';
  return vault.projects.find((p) => p.name === name)?.color ?? 'var(--tint)';
}
