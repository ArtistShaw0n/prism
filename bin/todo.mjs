#!/usr/bin/env node
/**
 * To-Do CLI — the bridge between Claude Code and the desktop app.
 *
 * Claude never hand-edits the vault JSON; it calls this instead, so every
 * mutation is validated, timestamped and written atomically.
 *
 *   node bin/todo.mjs add "Ship the landing page" --p 1 --due tomorrow --tag work
 *   node bin/todo.mjs list
 *   node bin/todo.mjs done k3f9a2
 *
 * Run `node bin/todo.mjs help` for the full surface.
 */

import {
  PRIORITY_LABELS, STATUSES, computeStats, ensureProject, findTask,
  loadVault, newId, nowISO, parseDate, saveVault, todayISO, vaultPath, writeAppConfig,
} from './vault.mjs';

// Piping into `head`/`less` closes stdout early. Without this, Node raises an
// unhandled EPIPE and dumps a stack trace over whatever the user was reading.
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

// ── Terminal styling ──────────────────────────────────────────────────────────

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const dim = c('2'), bold = c('1'), red = c('31'), green = c('32');
const yellow = c('33'), blue = c('34'), magenta = c('35'), cyan = c('36');

const STATUS_GLYPH = {
  inbox: dim('○'), todo: '○', doing: cyan('◐'), blocked: red('⊘'),
  done: green('●'), cancelled: dim('⊗'),
};
const PRIORITY_TINT = { 0: red, 1: yellow, 2: (s) => s, 3: dim };

// ── Argument parsing ──────────────────────────────────────────────────────────

/**
 * Split argv into positionals and flags. `--flag value` and `--flag=value` both
 * work; a flag with no value (or followed by another flag) becomes boolean true.
 */
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const [rawKey, inlineValue] = arg.slice(2).split(/=(.*)/s);
    const key = rawKey.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
    if (inlineValue !== undefined) { flags[key] = inlineValue; continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { flags[key] = true; continue; }
    flags[key] = next;
    i += 1;
  }
  return { positional, flags };
}

const csv = (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

function parsePriority(v) {
  if (v === undefined || v === true) return undefined;
  const n = Number(String(v).replace(/^p/i, ''));
  if (!Number.isInteger(n) || n < 0 || n > 3) die(`priority must be 0-3, got "${v}"`);
  return n;
}

function die(msg) {
  process.stderr.write(`${red('✗')} ${msg}\n`);
  process.exit(1);
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function relativeDue(due, day = todayISO()) {
  if (!due) return '';
  if (due === day) return yellow('today');
  const diff = Math.round((new Date(`${due}T12:00:00`) - new Date(`${day}T12:00:00`)) / 86400000);
  if (diff < 0) return red(`${-diff}d overdue`);
  if (diff === 1) return 'tomorrow';
  if (diff <= 7) return `${diff}d`;
  return due;
}

function renderTask(t, { indent = '' } = {}) {
  const tint = PRIORITY_TINT[t.priority] || ((s) => s);
  const struck = t.status === 'done' || t.status === 'cancelled';
  const title = struck ? dim(t.title) : tint(t.title);

  const bits = [];
  if (t.priority <= 1) bits.push(tint(`P${t.priority}`));
  if (t.project) bits.push(magenta(`#${t.project}`));
  for (const tag of t.tags) bits.push(blue(`@${tag}`));
  const due = relativeDue(t.due);
  if (due) bits.push(due);
  if (t.subtasks.length) {
    bits.push(dim(`${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length}`));
  }

  const suffix = bits.length ? `  ${bits.join(' ')}` : '';
  return `${indent}${STATUS_GLYPH[t.status]} ${dim(t.id)}  ${title}${suffix}`;
}

const ORDER = { doing: 0, blocked: 1, todo: 2, inbox: 3, done: 4, cancelled: 5 };

/** Display order: newest first, matching the app. */
function sortTasks(tasks) {
  return [...tasks].sort((a, b) => (b.order || 0) - (a.order || 0));
}

/**
 * Ranking order — what to do next. Used for the digest headline only; the
 * visible list stays in the order things were added.
 */
function byUrgency(tasks, day = todayISO()) {
  return [...tasks].sort((a, b) => {
    if (ORDER[a.status] !== ORDER[b.status]) return ORDER[a.status] - ORDER[b.status];
    const aLate = a.due && a.due <= day ? 0 : 1;
    const bLate = b.due && b.due <= day ? 0 : 1;
    if (aLate !== bLate) return aLate - bLate;
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.due && b.due && a.due !== b.due) return a.due < b.due ? -1 : 1;
    if (a.due !== b.due) return a.due ? -1 : 1;
    return (b.order || 0) - (a.order || 0);
  });
}

// ── Commands ──────────────────────────────────────────────────────────────────

const commands = {};

commands.add = (positional, flags) => {
  const title = positional.join(' ').trim();
  if (!title) die('add needs a title: todo add "Fix the login bug" --p 1 --due today');

  const vault = loadVault();
  const due = parseDate(flags.due);
  if (flags.due && due === undefined) die(`could not understand due date "${flags.due}"`);
  const scheduled = parseDate(flags.scheduled);

  const status = flags.status && flags.status !== true ? String(flags.status) : 'todo';
  if (!STATUSES.includes(status)) die(`status must be one of: ${STATUSES.join(', ')}`);

  const task = {
    id: newId(),
    title,
    notes: flags.notes && flags.notes !== true ? String(flags.notes) : undefined,
    status,
    priority: parsePriority(flags.p ?? flags.priority) ?? 2,
    tags: csv(flags.tag ?? flags.tags),
    project: ensureProject(vault, flags.project && flags.project !== true ? String(flags.project) : ''),
    due: due ?? undefined,
    scheduled: scheduled ?? undefined,
    estimateMin: flags.est ? Number(flags.est) || undefined : undefined,
    subtasks: csv(flags.sub).map((s) => ({ id: newId(), title: s, done: false })),
    recurrence: flags.repeat && flags.repeat !== true ? String(flags.repeat) : undefined,
    createdAt: nowISO(),
    updatedAt: nowISO(),
    order: (vault.meta.lastSeq = (vault.meta.lastSeq || 0) + 1),
    source: flags.source && flags.source !== true ? String(flags.source) : 'claude',
    // Keeps the user's original Banglish phrasing next to the normalised title.
    originalInput: flags.raw && flags.raw !== true ? String(flags.raw) : undefined,
  };

  vault.tasks.push(task);
  saveVault(vault);
  process.stdout.write(`${green('✓ added')}\n${renderTask(task)}\n`);
};

/**
 * Shared implementation for the status-transition verbs.
 *
 * `onApply` is passed positionally on purpose — an earlier `{ onApply } = {}`
 * signature silently swallowed every callback, so `done` never stamped
 * completedAt and recurrences never fired.
 */
function transition(name, next, onApply) {
  commands[name] = (positional) => {
    if (!positional.length) die(`${name} needs at least one task id`);
    const vault = loadVault();
    const touched = [];
    for (const needle of positional) {
      let task;
      try { task = findTask(vault, needle); } catch (err) { die(err.message); }
      if (!task) die(`no task matching "${needle}"`);
      task.status = next;
      task.updatedAt = nowISO();
      onApply?.(task, vault);
      touched.push(task);
    }
    saveVault(vault);
    for (const t of touched) process.stdout.write(`${green('✓')} ${renderTask(t)}\n`);
  };
}

transition('done', 'done', (t, vault) => {
  t.completedAt = nowISO();
  for (const s of t.subtasks) s.done = true;
  if (t.recurrence) spawnRecurrence(t, vault);
});
transition('start', 'doing', (t) => { t.startedAt = t.startedAt || nowISO(); });
transition('stop', 'todo');
transition('unblock', 'todo');
transition('cancel', 'cancelled', (t) => { t.completedAt = nowISO(); });
transition('reopen', 'todo', (t) => { t.completedAt = undefined; });

commands.block = (positional, flags) => {
  const [needle, ...rest] = positional;
  if (!needle) die('block needs a task id');
  const vault = loadVault();
  let task;
  try { task = findTask(vault, needle); } catch (err) { die(err.message); }
  if (!task) die(`no task matching "${needle}"`);
  task.status = 'blocked';
  const reason = rest.join(' ') || (flags.reason !== true ? flags.reason : '');
  if (reason) task.blockedReason = String(reason);
  task.updatedAt = nowISO();
  saveVault(vault);
  // renderTask already prints the status glyph — don't prefix a second one.
  process.stdout.write(`${renderTask(task)}${task.blockedReason ? dim(` — ${task.blockedReason}`) : ''}\n`);
};

/** When a recurring task is completed, queue the next occurrence. */
function spawnRecurrence(task, vault) {
  const map = { daily: 1, weekly: 7, biweekly: 14, monthly: 30, weekdays: 1 };
  const step = map[task.recurrence];
  if (!step) return;

  const from = new Date(`${task.due || todayISO()}T12:00:00`);
  from.setDate(from.getDate() + step);
  if (task.recurrence === 'weekdays') {
    while (from.getDay() === 0 || from.getDay() === 6) from.setDate(from.getDate() + 1);
  }

  vault.tasks.push({
    ...task,
    id: newId(),
    status: 'todo',
    due: todayISO(from),
    createdAt: nowISO(),
    updatedAt: nowISO(),
    startedAt: undefined,
    completedAt: undefined,
    subtasks: task.subtasks.map((s) => ({ ...s, id: newId(), done: false })),
    order: (vault.meta.lastSeq = (vault.meta.lastSeq || 0) + 1),
  });
}

commands.rm = (positional, flags) => {
  if (!positional.length) die('rm needs at least one task id');
  const vault = loadVault();
  const removed = [];
  for (const needle of positional) {
    let task;
    try { task = findTask(vault, needle); } catch (err) { die(err.message); }
    if (!task) die(`no task matching "${needle}"`);
    if (task.status !== 'done' && task.status !== 'cancelled' && !flags.force) {
      // Deleting live work is easy to do by accident and impossible to undo.
      die(`"${task.title}" is still open — use \`done\`/\`cancel\`, or pass --force to really delete`);
    }
    vault.tasks = vault.tasks.filter((t) => t.id !== task.id);
    removed.push(task);
  }
  saveVault(vault);
  for (const t of removed) process.stdout.write(`${red('✗ deleted')} ${dim(t.id)}  ${t.title}\n`);
};
commands.delete = commands.rm;

commands.edit = (positional, flags) => {
  const [needle] = positional;
  if (!needle) die('edit needs a task id');
  const vault = loadVault();
  let task;
  try { task = findTask(vault, needle); } catch (err) { die(err.message); }
  if (!task) die(`no task matching "${needle}"`);

  const rest = positional.slice(1).join(' ').trim();
  if (rest) task.title = rest;
  if (typeof flags.title === 'string') task.title = flags.title;
  if (typeof flags.notes === 'string') task.notes = flags.notes;

  const prio = parsePriority(flags.p ?? flags.priority);
  if (prio !== undefined) task.priority = prio;

  if (flags.due !== undefined) {
    const due = parseDate(flags.due);
    if (due === undefined) die(`could not understand due date "${flags.due}"`);
    task.due = due ?? undefined; // parseDate returns null for "clear"/"none"
  }
  if (flags.scheduled !== undefined) {
    const s = parseDate(flags.scheduled);
    task.scheduled = s ?? undefined;
  }
  if (typeof flags.project === 'string') task.project = ensureProject(vault, flags.project);
  if (typeof flags.tag === 'string' || typeof flags.tags === 'string') {
    task.tags = csv(flags.tag ?? flags.tags);
  }
  if (typeof flags.status === 'string') {
    if (!STATUSES.includes(flags.status)) die(`status must be one of: ${STATUSES.join(', ')}`);
    task.status = flags.status;
    if (flags.status === 'done') task.completedAt = nowISO();
  }
  if (flags.repeat !== undefined) {
    task.recurrence = flags.repeat === true || flags.repeat === 'none' ? undefined : String(flags.repeat);
  }

  task.updatedAt = nowISO();
  saveVault(vault);
  process.stdout.write(`${green('✓ updated')}\n${renderTask(task)}\n`);
};

commands.tag = (positional) => {
  const [needle, ...ops] = positional;
  if (!needle || !ops.length) die('usage: todo tag <id> +work -personal');
  const vault = loadVault();
  let task;
  try { task = findTask(vault, needle); } catch (err) { die(err.message); }
  if (!task) die(`no task matching "${needle}"`);
  for (const op of ops) {
    const name = op.replace(/^[+-]/, '');
    if (op.startsWith('-')) task.tags = task.tags.filter((t) => t !== name);
    else if (!task.tags.includes(name)) task.tags.push(name);
  }
  task.updatedAt = nowISO();
  saveVault(vault);
  process.stdout.write(`${green('✓')} ${renderTask(task)}\n`);
};

commands.sub = (positional) => {
  const [needle, action, ...rest] = positional;
  if (!needle || !action) die('usage: todo sub <id> add "Step one"  |  todo sub <id> done 1');
  const vault = loadVault();
  let task;
  try { task = findTask(vault, needle); } catch (err) { die(err.message); }
  if (!task) die(`no task matching "${needle}"`);

  if (action === 'add') {
    const title = rest.join(' ').trim();
    if (!title) die('sub add needs a title');
    task.subtasks.push({ id: newId(), title, done: false });
  } else if (action === 'done' || action === 'toggle') {
    const idx = Number(rest[0]) - 1;
    if (!task.subtasks[idx]) die(`subtask ${rest[0]} does not exist (task has ${task.subtasks.length})`);
    task.subtasks[idx].done = action === 'done' ? true : !task.subtasks[idx].done;
  } else if (action === 'rm') {
    const idx = Number(rest[0]) - 1;
    if (!task.subtasks[idx]) die(`subtask ${rest[0]} does not exist`);
    task.subtasks.splice(idx, 1);
  } else {
    die(`unknown sub action "${action}" — use add | done | toggle | rm`);
  }

  task.updatedAt = nowISO();
  saveVault(vault);
  commands.show([task.id], {});
};

commands.list = (positional, flags) => {
  const vault = loadVault();
  const day = todayISO();
  let tasks = vault.tasks;

  if (!flags.all) tasks = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
  if (typeof flags.status === 'string') tasks = tasks.filter((t) => t.status === flags.status);
  if (typeof flags.project === 'string') {
    tasks = tasks.filter((t) => t.project?.toLowerCase() === flags.project.toLowerCase());
  }
  if (typeof flags.tag === 'string') tasks = tasks.filter((t) => t.tags.includes(flags.tag));
  if (flags.p !== undefined || flags.priority !== undefined) {
    tasks = tasks.filter((t) => t.priority === parsePriority(flags.p ?? flags.priority));
  }
  if (flags.due === 'today') tasks = tasks.filter((t) => t.due && t.due <= day);
  else if (typeof flags.due === 'string') {
    const target = parseDate(flags.due);
    if (target) tasks = tasks.filter((t) => t.due === target);
  }
  if (flags.overdue) tasks = tasks.filter((t) => t.due && t.due < day);
  const query = positional.join(' ').trim().toLowerCase();
  if (query) {
    tasks = tasks.filter((t) => `${t.title} ${t.notes || ''} ${t.tags.join(' ')}`.toLowerCase().includes(query));
  }

  if (flags.json) { process.stdout.write(`${JSON.stringify(tasks, null, 2)}\n`); return; }

  if (!tasks.length) { process.stdout.write(`${dim('no matching tasks')}\n`); return; }

  const sorted = sortTasks(tasks, day);
  const groups = new Map();
  for (const t of sorted) {
    const key = flags.flat ? '' : t.status;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  process.stdout.write('\n');
  for (const [status, group] of groups) {
    if (status) process.stdout.write(`${bold(status.toUpperCase())} ${dim(`(${group.length})`)}\n`);
    for (const t of group) process.stdout.write(`${renderTask(t, { indent: status ? '  ' : '' })}\n`);
    process.stdout.write('\n');
  }

  const s = computeStats(vault, day);
  process.stdout.write(dim(`${s.open} open · ${s.doing} in progress · ${s.overdue} overdue · ${s.completedToday} done today\n\n`));
};
commands.ls = commands.list;

commands.show = (positional) => {
  const [needle] = positional;
  if (!needle) die('show needs a task id');
  const vault = loadVault();
  let task;
  try { task = findTask(vault, needle); } catch (err) { die(err.message); }
  if (!task) die(`no task matching "${needle}"`);

  const row = (k, v) => (v ? `${dim(k.padEnd(11))}${v}\n` : '');
  let out = `\n${renderTask(task)}\n\n`;
  out += row('status', task.status);
  out += row('priority', PRIORITY_LABELS[task.priority]);
  out += row('project', task.project);
  out += row('tags', task.tags.join(', '));
  out += row('due', task.due ? `${task.due}  ${relativeDue(task.due)}` : '');
  out += row('scheduled', task.scheduled);
  out += row('repeat', task.recurrence);
  out += row('estimate', task.estimateMin ? `${task.estimateMin} min` : '');
  out += row('blocked', task.blockedReason);
  out += row('notes', task.notes);
  out += row('original', task.originalInput ? dim(task.originalInput) : '');
  out += row('created', task.createdAt.slice(0, 16).replace('T', ' '));
  out += row('completed', task.completedAt?.slice(0, 16).replace('T', ' '));

  if (task.subtasks.length) {
    out += `\n${dim('subtasks')}\n`;
    task.subtasks.forEach((s, i) => {
      out += `  ${s.done ? green('●') : '○'} ${dim(`${i + 1}.`)} ${s.done ? dim(s.title) : s.title}\n`;
    });
  }
  process.stdout.write(`${out}\n`);
};

commands.stats = (_positional, flags) => {
  const vault = loadVault();
  const s = computeStats(vault);
  if (flags.json) { process.stdout.write(`${JSON.stringify(s, null, 2)}\n`); return; }
  process.stdout.write(
    `\n${bold('To-Do')} ${dim(s.date)}\n\n` +
    `  ${cyan(String(s.doing).padStart(3))}  in progress\n` +
    `  ${String(s.open).padStart(3)}  open\n` +
    `  ${yellow(String(s.dueToday).padStart(3))}  due today\n` +
    `  ${red(String(s.overdue).padStart(3))}  overdue\n` +
    `  ${red(String(s.urgent).padStart(3))}  urgent (P0)\n` +
    `  ${green(String(s.completedToday).padStart(3))}  completed today\n` +
    `  ${magenta(String(s.streak).padStart(3))}  day streak\n\n`,
  );
};

/** Bengali numerals, so digits don't sit oddly inside Bengali prose. */
const bn = (n) => String(n).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]);

/**
 * Compose a serviceable brief from the vault alone, in Shawon's register.
 *
 * This is the fallback for days Claude doesn't write one, so the app is never
 * showing a stale digest. A Claude-written brief via --write is better; this
 * just guarantees a floor.
 */
function autoDigest(vault, stats, day) {
  const open = vault.tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
  if (!open.length) {
    return stats.completedToday > 0
      ? `সব কাজ শেষ — আজকে **${bn(stats.completedToday)}টা** complete করেছেন। 🎉`
      : 'লিস্ট খালি। নতুন কাজ যোগ করতে বলুন।';
  }

  const lines = [];
  const headline = [];
  if (stats.dueToday) headline.push(`**${bn(stats.dueToday)}টা কাজ** due`);
  if (stats.overdue) headline.push(`**${bn(stats.overdue)}টা overdue**`);
  if (stats.doing) headline.push(`${bn(stats.doing)}টা চলছে`);
  lines.push(
    headline.length
      ? `আজকে ${headline.join(', ')}. মোট **${bn(stats.open)}টা** open.`
      : `আজকে কিছু due নেই, কিন্তু **${bn(stats.open)}টা** কাজ open আছে.`,
  );

  // Lead with the most pressing *actionable* item. A blocked task can't be
  // worked on, so it must never become the headline.
  const top = byUrgency(open.filter((t) => t.status !== 'blocked'), day)[0];
  if (top) {
    const why = top.due && top.due < day ? 'overdue' : top.priority <= 1 ? 'সবচেয়ে জরুরি' : 'পরের কাজ';
    lines.push(`${why} — \`${top.title}\`${top.project ? ` (**${top.project}**)` : ''}.`);
  }

  const bullets = [];
  const stale = open
    .filter((t) => t.due && t.due < day)
    .sort((a, b) => a.due.localeCompare(b.due))
    .slice(0, 2);
  for (const t of stale) {
    const days = Math.round((new Date(`${day}T12:00:00`) - new Date(`${t.due}T12:00:00`)) / 86400000);
    bullets.push(`\`${t.title}\` — ${bn(days)} দিন ধরে ঝুলে আছে`);
  }

  const blocked = open.filter((t) => t.status === 'blocked');
  for (const t of blocked.slice(0, 2)) {
    bullets.push(`\`${t.title}\` আটকে আছে${t.blockedReason ? ` — ${t.blockedReason}` : ''}`);
  }

  // Busiest project, when there is a clear one.
  const byProject = new Map();
  for (const t of open) if (t.project) byProject.set(t.project, (byProject.get(t.project) || 0) + 1);
  const busiest = [...byProject].sort((a, b) => b[1] - a[1])[0];
  if (busiest && busiest[1] >= 3) bullets.push(`**${busiest[0]}** এ ${bn(busiest[1])}টা কাজ জমেছে`);

  if (bullets.length) lines.push('', ...bullets.map((b) => `- ${b}`));
  if (stats.streak > 1) lines.push('', `🔥 ${bn(stats.streak)} দিনের streak চলছে — ধরে রাখুন।`);

  return lines.join('\n');
}

/**
 * The daily brief. Stats are always computed; Claude supplies the prose via
 * --write so the app can show a human summary above the numbers. `--auto`
 * composes one from the vault when Claude isn't in the loop.
 */
commands.digest = (positional, flags) => {
  const vault = loadVault();
  const day = typeof flags.date === 'string' ? flags.date : todayISO();
  const stats = computeStats(vault, day);

  const markdown = flags.auto
    ? autoDigest(vault, stats, day)
    : typeof flags.write === 'string'
      ? flags.write
      : positional.join(' ').trim();
  if (markdown) {
    const entry = {
      date: day,
      markdown,
      stats,
      createdAt: nowISO(),
      author: typeof flags.author === 'string' ? flags.author : flags.auto ? 'auto' : 'claude',
    };
    const existing = vault.digests.findIndex((d) => d.date === day);
    if (existing >= 0) vault.digests[existing] = entry;
    else vault.digests.push(entry);
    vault.digests.sort((a, b) => (a.date < b.date ? 1 : -1));
    vault.digests = vault.digests.slice(0, 120); // keep ~4 months of briefs
    saveVault(vault);
    process.stdout.write(`${green('✓ digest saved for')} ${day}\n`);
    return;
  }

  if (flags.json) { process.stdout.write(`${JSON.stringify(vault.digests.find((d) => d.date === day) || { date: day, stats }, null, 2)}\n`); return; }
  const found = vault.digests.find((d) => d.date === day);
  process.stdout.write(found ? `\n${found.markdown}\n\n` : dim(`no digest written for ${day}\n`));
};

commands.projects = (_positional, flags) => {
  const vault = loadVault();

  if (flags.prune) {
    // Projects are created implicitly by `add --project`, so deleting the last
    // task in one leaves an empty container behind that still shows up in the UI.
    const used = new Set(vault.tasks.map((t) => t.project).filter(Boolean));
    const empty = vault.projects.filter((p) => !used.has(p.name));
    if (!empty.length) { process.stdout.write(`${dim('no empty projects')}\n`); return; }
    vault.projects = vault.projects.filter((p) => used.has(p.name));
    saveVault(vault);
    for (const p of empty) process.stdout.write(`${red('✗ removed')} ${magenta('#' + p.name)}\n`);
    return;
  }

  if (!vault.projects.length) { process.stdout.write(`${dim('no projects yet')}\n`); return; }
  process.stdout.write('\n');
  for (const p of vault.projects) {
    const open = vault.tasks.filter((t) => t.project === p.name && t.status !== 'done' && t.status !== 'cancelled').length;
    process.stdout.write(`  ${magenta('#' + p.name.padEnd(18))} ${dim(`${open} open`)}  ${dim(p.color)}\n`);
  }
  process.stdout.write('\n');
};

commands.path = () => process.stdout.write(`${vaultPath()}\n`);

commands.init = () => {
  loadVault(); // creates the vault file if missing
  const cfg = writeAppConfig();
  process.stdout.write(`${green('✓')} vault  ${vaultPath()}\n${green('✓')} config ${cfg}\n`);
};

commands.export = (_positional, flags) => {
  const vault = loadVault();
  if (flags.md) {
    const open = sortTasks(vault.tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled'));
    let out = `# To-Do — ${todayISO()}\n\n`;
    for (const t of open) {
      out += `- [ ] ${t.title}`;
      const meta = [t.project && `#${t.project}`, t.due && `due ${t.due}`, t.priority <= 1 && `P${t.priority}`]
        .filter(Boolean).join(' · ');
      out += meta ? `  _(${meta})_\n` : '\n';
    }
    process.stdout.write(out);
    return;
  }
  process.stdout.write(`${JSON.stringify(vault, null, 2)}\n`);
};

commands.help = () => {
  process.stdout.write(`
${bold('To-Do')} ${dim('— task vault CLI')}

${bold('Capture')}
  add <title> [--p 0-3] [--due X] [--tag a,b] [--project X]
              [--notes X] [--sub "a,b"] [--repeat daily] [--raw "original text"]

${bold('Transitions')}
  start <id...>        move to in-progress      stop <id...>     back to todo
  done <id...>         complete                 reopen <id...>   un-complete
  block <id> [reason]  mark blocked             unblock <id...>
  cancel <id...>       abandon                  rm <id...> [--force]

${bold('Edit')}
  edit <id> [new title] [--title X] [--p N] [--due X|clear] [--project X]
            [--tag a,b] [--notes X] [--status X] [--repeat X|none]
  tag <id> +work -home
  sub <id> add <title> | done <n> | toggle <n> | rm <n>

${bold('Read')}
  list [query] [--all] [--status X] [--project X] [--tag X] [--p N]
       [--due today] [--overdue] [--json] [--flat]
  show <id>            stats [--json]           projects

${bold('Daily brief')}
  digest --write "<markdown>"   store today's summary (Claude writes this)
  digest --auto                 compose one from the vault, no Claude needed
  digest [--date YYYY-MM-DD] [--json]

${bold('Utility')}
  init                 create vault + app config
  path                 print vault location
  export [--md]        dump everything

${dim('Dates accept: today, tomorrow, kal, mon..sun, +3d, 2w, 2026-08-20, 20/08')}
`);
};

// ── Entry point ───────────────────────────────────────────────────────────────

const [, , rawCommand, ...rest] = process.argv;
const command = rawCommand || 'list';

if (command === '--help' || command === '-h') { commands.help(); process.exit(0); }
if (!commands[command]) die(`unknown command "${command}" — run \`todo help\``);

const { positional, flags } = parseArgs(rest);
try {
  commands[command](positional, flags);
} catch (err) {
  die(err.message);
}
