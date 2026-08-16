import { useEffect, useMemo, useState } from 'react';
import { longDate, todayISO } from './lib/dates';
import { addTask, computeStats, isOpen, sortTasks, toggleDone } from './lib/vault';
import { useVault } from './lib/useVault';
import { DailyBrief } from './components/DailyBrief';
import { TaskRow } from './components/TaskRow';
import { Composer } from './components/Composer';

/** Keep the completed list from growing without bound in the UI. */
const RECENT_DONE = 50;

export default function App() {
  const { vault, error, mutate } = useVault();
  const [showDone, setShowDone] = useState(false);
  const [update, setUpdate] = useState<{ version: string; install: () => Promise<void> } | null>(null);

  // Auto-update stays — invisible until there is actually a new version.
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
            await found.downloadAndInstall();
            const { relaunch } = await import('@tauri-apps/plugin-process');
            await relaunch();
          },
        });
      } catch {
        // Offline or no release yet — never block the app for this.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const open = useMemo(() => (vault ? sortTasks(vault.tasks.filter(isOpen)) : []), [vault]);

  const done = useMemo(
    () =>
      vault
        ? vault.tasks
            .filter((t) => !isOpen(t))
            .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
            .slice(0, RECENT_DONE)
        : [],
    [vault],
  );

  const stats = useMemo(() => (vault ? computeStats(vault) : null), [vault]);
  const digest = useMemo(() => vault?.digests.find((d) => d.date === todayISO()), [vault]);

  if (error && !vault) {
    return (
      <div className="empty" style={{ height: '100%' }}>
        <div className="empty-mark">⚠</div>
        <div className="empty-title">Could not open the vault</div>
        <div style={{ maxWidth: 320 }}>{error}</div>
      </div>
    );
  }

  if (!vault || !stats) return <div className="empty" style={{ height: '100%' }} />;

  return (
    <>
      <div className="aurora" aria-hidden="true">
        <span /><span /><span /><span />
      </div>

      <div className="drag-strip" data-tauri-drag-region />

      <main className="sheet">
        <header className="sheet-head">
          <h1 className="sheet-title">Tasks</h1>
          <p className="sheet-date">{longDate()}</p>
        </header>

        <div className="sheet-scroll">
          <DailyBrief digest={digest} stats={stats} />

          {open.length === 0 ? (
            <div className="empty">
              <div className="empty-mark">✓</div>
              <div className="empty-title">All clear</div>
              <div>Add one below.</div>
            </div>
          ) : (
            <div className="task-stack">
              {open.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  vault={vault}
                  onToggle={() => void mutate((v) => toggleDone(v, task.id))}
                />
              ))}
            </div>
          )}

          {done.length > 0 && (
            <>
              <button
                className="done-toggle"
                aria-expanded={showDone}
                onClick={() => setShowDone((s) => !s)}
              >
                <span className="done-caret">▶</span>
                Completed
                <span className="done-count">{done.length}</span>
              </button>

              {showDone && (
                <div className="task-stack">
                  {done.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      vault={vault}
                      onToggle={() => void mutate((v) => toggleDone(v, task.id))}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <Composer
          projects={vault.projects.map((p) => p.name)}
          onAdd={(draft) => void mutate((v) => addTask(v, draft))}
        />
      </main>

      {update && (
        <div className="toast">
          Version {update.version} available
          <button className="btn-update" onClick={() => void update.install()}>
            Update
          </button>
        </div>
      )}
    </>
  );
}
