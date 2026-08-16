import type { Task } from '../lib/types';
import { isOverdue, relativeDue } from '../lib/dates';

/**
 * One line in the list: a checkbox, the title, and a due date when there is one.
 *
 * Everything else a task carries — project, tags, notes, priority, subtasks —
 * still lives in the vault and is still set by the CLI. It is simply not drawn
 * here; the list is meant to stay readable at a glance.
 */
export function TaskRow({ task, onToggle }: { task: Task; onToggle: () => void }) {
  const done = task.status === 'done' || task.status === 'cancelled';
  const due = relativeDue(task.due);
  const late = !done && isOverdue(task.due);

  return (
    <div className="row" data-done={done}>
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

      <span className="row-title">{task.title}</span>

      {due && !done && (
        <span
          className="row-due"
          style={{ '--due-color': late ? 'var(--pink)' : undefined } as React.CSSProperties}
        >
          {due}
        </span>
      )}
    </div>
  );
}
