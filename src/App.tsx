import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Task, Vault } from './lib/types';
import { STATUS_LABEL } from './lib/types';
import { longDate, todayISO } from './lib/dates';
import {
  addTask, computeStats, deleteTask, isOpen, revealVault,
  sortTasks, toggleDone, toggleSubtask, updateTask,
} from './lib/vault';
import { useVault } from './lib/useVault';
import { Sidebar, type ThemeMode, type View } from './components/Sidebar';
import { DailyBrief } from './components/DailyBrief';
import { TaskRow } from './components/TaskRow';
import { Composer } from './components/Composer';
import { DetailPanel } from './components/DetailPanel';
import { Icon } from './components/Icon';

const VIEW_TITLE: Record<View['kind'], string> = {
  today: 'Today',
  upcoming: 'Upcoming',
  all: 'All Open',
  done: 'Completed',
  project: '',
};

function selectForView(vault: Vault, view: View, query: string): Task[] {
  const today = todayISO();
  let tasks: Task[];

  switch (view.kind) {
    case 'today':
      tasks = vault.tasks.filter((t) => isOpen(t) && ((t.due && t.due <= today) || t.status === 'doing'));
      break;
    case 'upcoming':
      tasks = vault.tasks.filter((t) => isOpen(t) && t.due && t.due > today);
      break;
    case 'done':
      tasks = vault.tasks
        .filter((t) => !isOpen(t))
        .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
      break;
    case 'project':
      tasks = vault.tasks.filter((t) => isOpen(t) && t.project === view.name);
      break;
    default:
      tasks = vault.tasks.filter(isOpen);
  }

  const q = query.trim().toLowerCase();
  if (q) {
    tasks = tasks.filter((t) =>
      `${t.title} ${t.notes ?? ''} ${t.tags.join(' ')} ${t.project ?? ''} ${t.originalInput ?? ''}`
        .toLowerCase()
        .includes(q),
    );
  }

  // "Completed" is already in reverse-chronological order; re-sorting would
  // scramble it back into priority order.
  return view.kind === 'done' ? tasks : sortTasks(tasks);
}

export default function App() {
  const { vault, path, error, mutate } = useVault();
  const [view, setView] = useState<View>({ kind: 'today' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [update, setUpdate] = useState<{ version: string; install: () => Promise<void> } | null>(null);

  const [theme, setTheme] = useState<ThemeMode>(
    () => (localStorage.getItem('prism.theme') as ThemeMode) ?? 'system',
  );

  const composerRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    localStorage.setItem('prism.theme', theme);
  }, [theme]);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2200);
  }, []);

  // ── Auto-update ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    let cancelled = false;

    void (async () => {
      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const found = await check();
        if (!found || cancelled) return;
        setUpdate({
          version: found.version,
          install: async () => {
            flash('Downloading update…');
            await found.downloadAndInstall();
            const { relaunch } = await import('@tauri-apps/plugin-process');
            await relaunch();
          },
        });
      } catch {
        // Offline, or no release published yet — never block the app for this.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [flash]);

  const tasks = useMemo(
    () => (vault ? selectForView(vault, view, query) : []),
    [vault, view, query],
  );

  const stats = useMemo(() => (vault ? computeStats(vault) : null), [vault]);
  const digest = useMemo(
    () => vault?.digests.find((d) => d.date === todayISO()),
    [vault],
  );

  const selected = vault?.tasks.find((t) => t.id === selectedId) ?? null;

  // ── Keyboard ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typingInField =
        e.target instanceof HTMLElement &&
        (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');

      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        composerRef.current?.focus();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (typingInField) return;

      if (e.key === '/') {
        e.preventDefault();
        composerRef.current?.focus();
        return;
      }
      if (e.key === 'Escape') {
        setSelectedId(null);
        return;
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!tasks.length) return;
        const idx = tasks.findIndex((t) => t.id === selectedId);
        const step = e.key === 'ArrowDown' ? 1 : -1;
        const next = idx < 0 ? (step > 0 ? 0 : tasks.length - 1) : (idx + step + tasks.length) % tasks.length;
        setSelectedId(tasks[next].id);
        return;
      }

      if (!selectedId) return;

      if (e.key === ' ') {
        e.preventDefault();
        void mutate((v) => toggleDone(v, selectedId));
        return;
      }
      if (e.key === 'Backspace' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void mutate((v) => deleteTask(v, selectedId));
        setSelectedId(null);
        flash('Task deleted');
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tasks, selectedId, mutate, flash]);

  if (error && !vault) {
    return (
      <div className="empty" style={{ height: '100%' }}>
        <div className="empty-mark">⚠</div>
        <div className="empty-title">Could not open the vault</div>
        <div style={{ maxWidth: 380 }}>{error}</div>
      </div>
    );
  }

  if (!vault || !stats) {
    return <div className="empty" style={{ height: '100%' }} />;
  }

  const title = view.kind === 'project' ? view.name : VIEW_TITLE[view.kind];

  // Group by status so "In Progress" always sits above the rest.
  const groups = new Map<string, Task[]>();
  for (const t of tasks) {
    const key = view.kind === 'done' ? 'done' : t.status;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }

  return (
    <>
      <div className="aurora" aria-hidden="true">
        <span /><span /><span /><span />
      </div>

      <div className="drag-strip" data-tauri-drag-region />

      <div className="app">
        <Sidebar
          vault={vault}
          stats={stats}
          view={view}
          onSelect={(v) => {
            setView(v);
            setSelectedId(null);
          }}
          theme={theme}
          onCycleTheme={() =>
            setTheme((t) => (t === 'system' ? 'light' : t === 'light' ? 'dark' : 'system'))
          }
          onReveal={() => void revealVault()}
        />

        <div className="content">
          <div className="content-scroll">
            <header className="content-head">
              <div>
                <h1 className="content-title">{title}</h1>
                <p className="content-sub">
                  {view.kind === 'today' ? longDate() : `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`}
                </p>
              </div>

              <div className="composer-shell" style={{ maxWidth: 210, padding: '5px 10px' }}>
                <Icon name="search" size={13} />
                <input
                  ref={searchRef}
                  value={query}
                  placeholder="Search"
                  spellCheck={false}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setQuery('');
                      e.currentTarget.blur();
                    }
                    e.stopPropagation();
                  }}
                  style={{
                    flex: 1, minWidth: 0, border: 0, background: 'transparent',
                    color: 'var(--text-1)', font: 'inherit', fontSize: 12.5, outline: 'none',
                  }}
                />
              </div>
            </header>

            {view.kind === 'today' && <DailyBrief digest={digest} stats={stats} />}

            {tasks.length === 0 ? (
              <div className="empty">
                <div className="empty-mark">{query ? '⌕' : '✓'}</div>
                <div className="empty-title">
                  {query ? 'No matches' : view.kind === 'today' ? 'Nothing due today' : 'Nothing here'}
                </div>
                <div>
                  {query
                    ? 'Try a different search.'
                    : 'Add one below, or ask Claude to add it for you.'}
                </div>
              </div>
            ) : (
              [...groups].map(([status, group]) => (
                <section key={status} className="group">
                  {groups.size > 1 && (
                    <h2 className="group-head">
                      {STATUS_LABEL[status as Task['status']] ?? status}
                      <span className="group-rule" />
                      {group.length}
                    </h2>
                  )}
                  <div className="task-stack">
                    {group.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        vault={vault}
                        selected={task.id === selectedId}
                        onToggle={() => void mutate((v) => toggleDone(v, task.id))}
                        onSelect={() => setSelectedId((id) => (id === task.id ? null : task.id))}
                      />
                    ))}
                  </div>
                </section>
              ))
            )}
          </div>

          <Composer
            ref={composerRef}
            onAdd={(draft) => {
              void mutate((v) =>
                addTask(v, {
                  ...draft,
                  // A task added while viewing a project belongs to it.
                  project: draft.project ?? (view.kind === 'project' ? view.name : undefined),
                }),
              );
              flash('Added');
            }}
          />
        </div>

        {selected && (
          <DetailPanel
            task={selected}
            vault={vault}
            onPatch={(patch) => void mutate((v) => updateTask(v, selected.id, patch))}
            onToggleSub={(subId) => void mutate((v) => toggleSubtask(v, selected.id, subId))}
            onDelete={() => {
              void mutate((v) => deleteTask(v, selected.id));
              setSelectedId(null);
              flash('Task deleted');
            }}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>

      {update && (
        <div className="toast">
          Version {update.version} is available
          <button className="btn btn-primary" onClick={() => void update.install()}>
            Update
          </button>
          <button className="btn btn-ghost" onClick={() => setUpdate(null)}>
            Later
          </button>
        </div>
      )}

      {toast && !update && <div className="toast">{toast}</div>}

      {error && vault && (
        <div className="toast" style={{ color: 'var(--pink)' }} title={path}>
          {error}
        </div>
      )}
    </>
  );
}
