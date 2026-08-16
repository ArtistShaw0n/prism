import type { Task, Vault } from '../lib/types';
import { isOverdue, relativeDue } from '../lib/dates';
import { projectColor } from '../lib/vault';

/**
 * A task card: checkbox, title, notes, project.
 *
 * Priority, tags and the user's original Banglish phrasing are all still stored
 * on the task — they are deliberately not drawn here, to keep the card to the
 * three things worth reading at a glance. The left spine carries the project's
 * colour so the card reads as coloured without adding another chip.
 */
export function TaskRow({
  task,
  vault,
  onToggle,
}: {
  task: Task;
  vault: Vault;
  onToggle: () => void;
}) {
  const done = task.status === 'done' || task.status === 'cancelled';
  const due = relativeDue(task.due);
  const late = !done && isOverdue(task.due);
  const color = projectColor(vault, task.project);

  return (
    <div
      className="task"
      data-done={done}
      style={{ '--spine': done ? 'transparent' : color } as React.CSSProperties}
    >
      <button
        className="check"
        data-done={done}
        aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
        onClick={onToggle}
      >
        {done && (
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <polyline points="1.5,6.5 4.5,9.5 10.5,2.5" />
          </svg>
        )}
      </button>

      <div className="task-main">
        <div className="task-title">{task.title}</div>

        {task.notes && !done && <div className="task-notes">{task.notes}</div>}

        {(task.project || due) && (
          <div className="task-meta">
            {task.project && (
              <span className="chip" style={{ '--chip': color } as React.CSSProperties}>
                <span className="chip-dot" />
                {task.project}
              </span>
            )}
            {due && !done && (
              <span
                className="chip"
                style={{ '--chip': late ? 'var(--pink)' : 'var(--text-2)' } as React.CSSProperties}
              >
                {due}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
