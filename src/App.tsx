import { useEffect, useMemo, useState } from 'react';
import { longDate } from './lib/dates';
import { addTask, isOpen, sortTasks, toggleDone } from './lib/vault';
import { useVault } from './lib/useVault';
import { TaskRow } from './components/TaskRow';
import { Composer } from './components/Composer';

/** Keep the completed list from growing without bound in the UI. */
const RECENT_DONE = 50;

export default function App() {
  const { vault, error, mutate } = useVault();
  const [showDone, setShowDone] = useState(false);
  const [update, setUpdate] = useState<{ version: string; install: () => Promise<void> } | null>(null);

  // Auto-update stays — it's invisible until there's actually a new version.
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

  const open = useMemo(
    () => (vault ? sortTasks(vault.tasks.filter(isOpen)) : []),
    [vault],
  );

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

  if (error && !vault) {
    return (
      <div className="empty" style={{ height: '100%' }}>
        <div className="empty-mark">⚠</div>
        <div className="empty-title">Could not open the vault</div>
        <div style={{ maxWidth: 300 }}>{error}</div>
      </div>
    );
  }

  if (!vault) return <div className="empty" style={{ height: '100%' }} />;

  return (
    <>
      <div className="aurora" aria-hidden="true">
        <span /><span /><span />
      </div>

      <div className="drag-strip" data-tauri-drag-region />

      <main className="sheet">
        <header className="sheet-head">
          <h1 className="sheet-title">Tasks</h1>
          <p className="sheet-date">{longDate()}</p>
        </header>

        <div className="sheet-scroll">
          {open.length === 0 ? (
            <div className="empty">
              <div className="empty-mark">✓</div>
              <div className="empty-title">All clear</div>
              <div>Add one below.</div>
            </div>
          ) : (
            <div className="list">
              {open.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
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
                <div className="list">
                  {done.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      onToggle={() => void mutate((v) => toggleDone(v, task.id))}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <Composer onAdd={(draft) => void mutate((v) => addTask(v, draft))} />
      </main>

      {update && (
        <div className="composer" style={{ padding: '0 0 12px' }}>
          <div className="composer-shell" style={{ justifyContent: 'space-between' }}>
            <span>Version {update.version} available</span>
            <button className="done-toggle" style={{ width: 'auto', margin: 0 }} onClick={() => void update.install()}>
              Update
            </button>
          </div>
        </div>
      )}
    </>
  );
}
