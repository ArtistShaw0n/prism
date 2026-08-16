/**
 * Prism vault — the single source of truth for all task data.
 *
 * The vault is one JSON file. Every write is atomic (temp file + rename) so the
 * Tauri app, which watches the file, never observes a half-written document.
 *
 * Path resolution order:
 *   1. $PRISM_DATA_DIR
 *   2. dataDir in ~/Library/Application Support/com.shawon.prism/config.json
 *   3. <repo>/data
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_SUPPORT = join(homedir(), 'Library', 'Application Support', 'com.shawon.prism');

export const SCHEMA_VERSION = 1;

export const STATUSES = ['inbox', 'todo', 'doing', 'blocked', 'done', 'cancelled'];
export const PRIORITY_LABELS = { 0: 'P0 · Urgent', 1: 'P1 · High', 2: 'P2 · Normal', 3: 'P3 · Low' };

/** Palette used when auto-assigning a colour to a brand new project. */
const PROJECT_COLORS = [
  '#0A84FF', '#BF5AF2', '#FF375F', '#FF9F0A',
  '#30D158', '#64D2FF', '#FF6482', '#5E5CE6',
];

// ── Path resolution ───────────────────────────────────────────────────────────

export function resolveDataDir() {
  if (process.env.PRISM_DATA_DIR) return resolve(process.env.PRISM_DATA_DIR);

  const cfgPath = join(APP_SUPPORT, 'config.json');
  if (existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
      if (cfg.dataDir) return resolve(cfg.dataDir);
    } catch {
      // Corrupt config should never block the CLI — fall through to the default.
    }
  }
  return join(REPO_ROOT, 'data');
}

export function vaultPath() {
  return join(resolveDataDir(), 'tasks.json');
}

/**
 * Write the app-support config so the Tauri app and the CLI agree on where the
 * vault lives even when the app is launched from /Applications.
 */
export function writeAppConfig(dataDir = resolveDataDir()) {
  mkdirSync(APP_SUPPORT, { recursive: true });
  const target = join(APP_SUPPORT, 'config.json');
  atomicWrite(target, JSON.stringify({ dataDir, updatedAt: nowISO() }, null, 2));
  return target;
}

// ── Low-level IO ──────────────────────────────────────────────────────────────

function atomicWrite(file, contents) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, contents, 'utf8');
  renameSync(tmp, file); // rename is atomic on APFS
}

export function emptyVault() {
  return {
    version: SCHEMA_VERSION,
    tasks: [],
    projects: [],
    digests: [],
    meta: { createdAt: nowISO(), updatedAt: nowISO(), lastSeq: 0 },
  };
}

export function loadVault() {
  const file = vaultPath();
  if (!existsSync(file)) {
    const fresh = emptyVault();
    saveVault(fresh);
    return fresh;
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    // Never destroy data on a parse failure — quarantine it and start clean.
    const backup = `${file}.corrupt-${Date.now()}`;
    renameSync(file, backup);
    process.stderr.write(`! vault was unreadable, moved to ${backup}\n`);
    const fresh = emptyVault();
    saveVault(fresh);
    return fresh;
  }
  return migrate(raw);
}

export function saveVault(vault) {
  vault.meta = vault.meta || {};
  vault.meta.updatedAt = nowISO();
  vault.version = SCHEMA_VERSION;
  atomicWrite(vaultPath(), `${JSON.stringify(vault, null, 2)}\n`);
  return vault;
}

function migrate(v) {
  const out = { ...emptyVault(), ...v };
  out.tasks = Array.isArray(v.tasks) ? v.tasks : [];
  out.projects = Array.isArray(v.projects) ? v.projects : [];
  out.digests = Array.isArray(v.digests) ? v.digests : [];
  out.meta = { ...emptyVault().meta, ...(v.meta || {}) };
  // Backfill fields added after a task was first written.
  for (const t of out.tasks) {
    t.tags = t.tags || [];
    t.subtasks = t.subtasks || [];
    t.priority = typeof t.priority === 'number' ? t.priority : 2;
    t.status = STATUSES.includes(t.status) ? t.status : 'todo';
    t.order = typeof t.order === 'number' ? t.order : 0;
  }
  return out;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function nowISO() {
  return new Date().toISOString();
}

/** Local (not UTC) calendar date, so "today" means today in Dhaka, not in London. */
export function todayISO(d = new Date()) {
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

export function newId() {
  // Short, lowercase, unambiguous — easy to type back at Claude.
  const alphabet = '23456789abcdefghjkmnpqrstuvwxyz';
  let id = '';
  for (const byte of randomBytes(6)) id += alphabet[byte % alphabet.length];
  return id;
}

/**
 * Parse the loose date shorthands a human actually types.
 * Accepts: today, tomorrow, tmr, yesterday, mon..sun, +3d, 3d, 2w, 2026-08-20, 20/08.
 */
export function parseDate(input) {
  if (!input) return undefined;
  const s = String(input).trim().toLowerCase();
  if (!s || s === 'none' || s === 'clear') return null; // null = explicit removal

  const base = new Date();
  base.setHours(12, 0, 0, 0); // midday avoids DST edge cases when adding days

  const shift = (days) => {
    const d = new Date(base);
    d.setDate(d.getDate() + days);
    return todayISO(d);
  };

  if (s === 'today' || s === 'aj' || s === 'aaj') return todayISO(base);
  if (s === 'tomorrow' || s === 'tmr' || s === 'tom' || s === 'kal') return shift(1);
  if (s === 'yesterday') return shift(-1);
  if (s === 'nextweek' || s === 'next-week') return shift(7);

  // Signed offsets: "+3d", "3d", "2w", "-1d" (backdating a missed task).
  const rel = s.match(/^([+-]?)(\d+)\s*([dwm])$/);
  if (rel) {
    const n = Number(rel[2]) * (rel[1] === '-' ? -1 : 1);
    if (rel[3] === 'd') return shift(n);
    if (rel[3] === 'w') return shift(n * 7);
    const d = new Date(base);
    d.setMonth(d.getMonth() + n);
    return todayISO(d);
  }

  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const dayIdx = days.indexOf(s.slice(0, 3));
  if (dayIdx >= 0) {
    let delta = (dayIdx - base.getDay() + 7) % 7;
    if (delta === 0) delta = 7; // "friday" on a Friday means next Friday
    return shift(delta);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const dm = s.match(/^(\d{1,2})[/-](\d{1,2})$/); // DD/MM
  if (dm) {
    const d = new Date(base);
    d.setMonth(Number(dm[2]) - 1, Number(dm[1]));
    if (d < base) d.setFullYear(d.getFullYear() + 1);
    return todayISO(d);
  }

  return undefined; // unrecognised — caller decides whether to warn
}

export function ensureProject(vault, name) {
  if (!name) return undefined;
  const key = name.trim();
  if (!key) return undefined;
  const found = vault.projects.find((p) => p.name.toLowerCase() === key.toLowerCase());
  if (found) return found.name;
  vault.projects.push({
    id: newId(),
    name: key,
    color: PROJECT_COLORS[vault.projects.length % PROJECT_COLORS.length],
    createdAt: nowISO(),
  });
  return key;
}

/** Resolve a user-supplied id: exact match, unique prefix, or unique title substring. */
export function findTask(vault, needle) {
  if (!needle) return null;
  const q = String(needle).trim().toLowerCase();
  const exact = vault.tasks.find((t) => t.id === q);
  if (exact) return exact;

  const byPrefix = vault.tasks.filter((t) => t.id.startsWith(q));
  if (byPrefix.length === 1) return byPrefix[0];
  if (byPrefix.length > 1) throw new Error(`ambiguous id "${needle}" → ${byPrefix.map((t) => t.id).join(', ')}`);

  // Prefer open tasks — "done invoice" should hit the live one, not last
  // month's. But fall back to the whole vault so `reopen <title>` can reach a
  // completed task at all.
  const open = vault.tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
  for (const pool of [open, vault.tasks]) {
    const matches = pool.filter((t) => t.title.toLowerCase().includes(q));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new Error(
        `"${needle}" matches ${matches.length} tasks → ${matches.map((t) => `${t.id} (${t.title})`).join(' | ')}`,
      );
    }
  }
  return null;
}

export function computeStats(vault, day = todayISO()) {
  const open = vault.tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
  const overdue = open.filter((t) => t.due && t.due < day);
  const dueToday = open.filter((t) => t.due === day);
  const doing = open.filter((t) => t.status === 'doing');
  const completedToday = vault.tasks.filter((t) => t.completedAt?.slice(0, 10) === day);

  return {
    date: day,
    total: vault.tasks.length,
    open: open.length,
    doing: doing.length,
    blocked: open.filter((t) => t.status === 'blocked').length,
    overdue: overdue.length,
    dueToday: dueToday.length,
    completedToday: completedToday.length,
    urgent: open.filter((t) => t.priority === 0).length,
    streak: computeStreak(vault, day),
  };
}

/** Consecutive days (ending today or yesterday) with at least one completion. */
function computeStreak(vault, day) {
  const done = new Set(
    vault.tasks.filter((t) => t.completedAt).map((t) => t.completedAt.slice(0, 10)),
  );
  if (done.size === 0) return 0;

  const cursor = new Date(`${day}T12:00:00`);
  // A streak survives "today, nothing done yet" — start counting from yesterday.
  if (!done.has(day)) cursor.setDate(cursor.getDate() - 1);

  let streak = 0;
  while (done.has(todayISO(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
