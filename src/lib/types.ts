/**
 * The vault schema. This is the contract shared by three implementations:
 * the Rust shell (storage), this app (UI logic) and bin/vault.mjs (the CLI
 * Claude drives). Any change here must land in all three.
 */

export const STATUSES = ['inbox', 'todo', 'doing', 'blocked', 'done', 'cancelled'] as const;
export type Status = (typeof STATUSES)[number];

/** 0 = urgent … 3 = low. Lower sorts first. */
export type Priority = 0 | 1 | 2 | 3;

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

export interface Task {
  id: string;
  title: string;
  notes?: string;
  status: Status;
  priority: Priority;
  tags: string[];
  project?: string;
  /** Calendar dates, `YYYY-MM-DD`, in the user's local timezone. */
  due?: string;
  scheduled?: string;
  estimateMin?: number;
  subtasks: Subtask[];
  recurrence?: 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly';
  blockedReason?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  order: number;
  source: 'claude' | 'app' | 'cli';
  /** The user's original Banglish phrasing, preserved next to the clean title. */
  originalInput?: string;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  createdAt?: string;
}

export interface Stats {
  date: string;
  total: number;
  open: number;
  doing: number;
  blocked: number;
  overdue: number;
  dueToday: number;
  completedToday: number;
  urgent: number;
  streak: number;
}

export interface Digest {
  date: string;
  markdown: string;
  stats: Stats;
  createdAt: string;
  author: string;
}

export interface Vault {
  version: number;
  tasks: Task[];
  projects: Project[];
  digests: Digest[];
  meta: {
    createdAt: string;
    updatedAt: string;
    lastSeq: number;
  };
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  0: 'Urgent',
  1: 'High',
  2: 'Normal',
  3: 'Low',
};

export const STATUS_LABEL: Record<Status, string> = {
  inbox: 'Inbox',
  todo: 'To Do',
  doing: 'In Progress',
  blocked: 'Blocked',
  done: 'Done',
  cancelled: 'Cancelled',
};

export const PROJECT_COLORS = [
  '#0A84FF', '#BF5AF2', '#FF375F', '#FF9F0A',
  '#30D158', '#64D2FF', '#FF6482', '#5E5CE6',
];

export function emptyVault(): Vault {
  const now = new Date().toISOString();
  return {
    version: 1,
    tasks: [],
    projects: [],
    digests: [],
    meta: { createdAt: now, updatedAt: now, lastSeq: 0 },
  };
}
