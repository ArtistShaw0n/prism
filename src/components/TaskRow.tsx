import type { Priority, Status, Task, Vault } from '../lib/types';
import { PRIORITY_LABEL } from '../lib/types';
import { isOverdue, relativeDue } from '../lib/dates';
import { projectColor } from '../lib/vault';

const PRIORITY_VAR: Record<Priority, string> = {
  0: 'var(--p0)', 1: 'var(--p1)', 2: 'var(--p2)', 3: 'var(--p3)',
};

const CHECK_FILL: Partial<Record<Status, string>> = {
  done: 'var(--green)',
  cancelled: 'var(--text-3)',
};

interface Props {
  task: Task;
  vault: Vault;
  selected: boolean;
  onToggle: () => void;
  onSelect: () => void;
}

export function TaskRow({ task, vault, selected, onToggle, onSelect }: Props) {
  const done = task.status === 'done' || task.status === 'cancelled';
  const late = isOverdue(task.due) && !done;
  const dueText = relativeDue(task.due);
  const subDone = task.subtasks.filter((s) => s.done).length;

  return (
    <div
      className="task"
      data-done={done}
      data-selected={selected}
      style={{ '--spine': done ? 'transparent' : PRIORITY_VAR[task.priority] } as React.CSSProperties}
      onClick={onSelect}
    >
      <button
        className="check"
        data-state={task.status}
        style={{ '--check-fill': CHECK_FILL[task.status] } as React.CSSProperties}
        aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
        onClick={(e) => {
          e.stopPropagation(); // the card itself only selects
          onToggle();
        }}
      >
        {done && (
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <polyline points="1.5,6.5 4.5,9.5 10.5,2.5" />
          </svg>
        )}
      </button>

      <div className="task-main">
        <div className="task-title">{task.title}</div>

        {task.notes && <div className="task-notes">{task.notes}</div>}

        {task.originalInput && (
          <div className="task-original">“{task.originalInput}”</div>
        )}

        <div className="task-meta">
          {task.status === 'doing' && (
            <span className="chip" style={{ '--chip': 'var(--teal)' } as React.CSSProperties}>
              <span className="chip-dot" /> In progress
            </span>
          )}
          {task.status === 'blocked' && (
            <span className="chip" style={{ '--chip': 'var(--orange)' } as React.CSSProperties}>
              Blocked{task.blockedReason ? ` · ${task.blockedReason}` : ''}
            </span>
          )}
          {task.priority <= 1 && !done && (
            <span className="chip" style={{ '--chip': PRIORITY_VAR[task.priority] } as React.CSSProperties}>
              {PRIORITY_LABEL[task.priority]}
            </span>
          )}
          {task.project && (
            <span
              className="chip"
              style={{ '--chip': projectColor(vault, task.project) } as React.CSSProperties}
            >
              <span className="chip-dot" /> {task.project}
            </span>
          )}
          {dueText && (
            <span
              className="chip"
              style={{ '--chip': late ? 'var(--pink)' : 'var(--text-2)' } as React.CSSProperties}
            >
              {dueText}
            </span>
          )}
          {task.recurrence && (
            <span className="chip" style={{ '--chip': 'var(--indigo)' } as React.CSSProperties}>
              ↻ {task.recurrence}
            </span>
          )}
          {task.subtasks.length > 0 && (
            <span className="chip">
              {subDone}/{task.subtasks.length}
            </span>
          )}
          {task.tags.map((tag) => (
            <span key={tag} className="chip" style={{ '--chip': 'var(--text-2)' } as React.CSSProperties}>
              #{tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
