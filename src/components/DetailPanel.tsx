import { useEffect, useState } from 'react';
import type { Priority, Status, Task, Vault } from '../lib/types';
import { relativeDue } from '../lib/dates';
import { projectColor } from '../lib/vault';
import { Icon } from './Icon';

const STATUS_CHOICES: { value: Status; label: string; color: string }[] = [
  { value: 'todo', label: 'To Do', color: 'var(--text-1)' },
  { value: 'doing', label: 'Doing', color: 'var(--teal)' },
  { value: 'blocked', label: 'Blocked', color: 'var(--orange)' },
  { value: 'done', label: 'Done', color: 'var(--green)' },
];

const PRIORITY_CHOICES: { value: Priority; label: string; color: string }[] = [
  { value: 0, label: 'P0', color: 'var(--p0)' },
  { value: 1, label: 'P1', color: 'var(--p1)' },
  { value: 2, label: 'P2', color: 'var(--p2)' },
  { value: 3, label: 'P3', color: 'var(--p3)' },
];

interface Props {
  task: Task;
  vault: Vault;
  onPatch: (patch: Partial<Task>) => void;
  onToggleSub: (subId: string) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function DetailPanel({ task, vault, onPatch, onToggleSub, onDelete, onClose }: Props) {
  // Local mirror so typing stays responsive; committed on blur.
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? '');

  useEffect(() => {
    setTitle(task.title);
    setNotes(task.notes ?? '');
  }, [task.id, task.title, task.notes]);

  const commitTitle = () => {
    const next = title.trim();
    if (next && next !== task.title) onPatch({ title: next });
    else if (!next) setTitle(task.title); // never allow an empty title
  };

  return (
    <aside className="detail">
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
        <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close details">
          <Icon name="close" size={13} />
        </button>
      </div>

      <textarea
        className="detail-title"
        value={title}
        rows={Math.max(1, Math.ceil(title.length / 26))}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commitTitle}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          }
          e.stopPropagation();
        }}
      />

      {task.originalInput && (
        <div className="task-original" style={{ marginBottom: 10 }}>
          “{task.originalInput}”
        </div>
      )}

      <div style={{ display: 'grid', gap: 8, margin: '12px 0' }}>
        <div className="seg">
          {STATUS_CHOICES.map((s) => (
            <button
              key={s.value}
              aria-pressed={task.status === s.value}
              style={{ '--seg-fg': s.color } as React.CSSProperties}
              onClick={() => onPatch({ status: s.value })}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="seg">
          {PRIORITY_CHOICES.map((p) => (
            <button
              key={p.value}
              aria-pressed={task.priority === p.value}
              style={{ '--seg-fg': p.color } as React.CSSProperties}
              onClick={() => onPatch({ priority: p.value })}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="detail-row">
        <span className="detail-key">Due</span>
        <div className="detail-val" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="date"
            value={task.due ?? ''}
            onChange={(e) => onPatch({ due: e.target.value || undefined })}
            style={{
              border: 0, background: 'transparent', color: 'var(--text-1)',
              font: 'inherit', outline: 'none', flex: 1,
            }}
          />
          {task.due && <span style={{ color: 'var(--text-3)' }}>{relativeDue(task.due)}</span>}
        </div>
      </div>

      <div className="detail-row">
        <span className="detail-key">Project</span>
        <div className="detail-val">
          {task.project ? (
            <span
              className="chip"
              style={{ '--chip': projectColor(vault, task.project) } as React.CSSProperties}
            >
              <span className="chip-dot" /> {task.project}
            </span>
          ) : (
            <span style={{ color: 'var(--text-3)' }}>None</span>
          )}
        </div>
      </div>

      {task.tags.length > 0 && (
        <div className="detail-row">
          <span className="detail-key">Tags</span>
          <div className="detail-val" style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {task.tags.map((t) => (
              <span key={t} className="chip">#{t}</span>
            ))}
          </div>
        </div>
      )}

      {task.recurrence && (
        <div className="detail-row">
          <span className="detail-key">Repeats</span>
          <div className="detail-val">{task.recurrence}</div>
        </div>
      )}

      {task.blockedReason && (
        <div className="detail-row">
          <span className="detail-key">Blocked by</span>
          <div className="detail-val">{task.blockedReason}</div>
        </div>
      )}

      <div className="detail-row" style={{ alignItems: 'flex-start' }}>
        <span className="detail-key" style={{ paddingTop: 2 }}>Notes</span>
        <textarea
          className="detail-val"
          value={notes}
          rows={3}
          placeholder="—"
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => onPatch({ notes: notes.trim() || undefined })}
          onKeyDown={(e) => e.stopPropagation()}
          style={{
            border: 0, background: 'transparent', color: 'var(--text-1)',
            font: 'inherit', fontSize: 12, outline: 'none', resize: 'vertical',
            WebkitUserSelect: 'text', userSelect: 'text',
          }}
        />
      </div>

      {task.subtasks.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="sidebar-label" style={{ padding: '0 0 4px' }}>Subtasks</div>
          {task.subtasks.map((s) => (
            <label key={s.id} className="subtask" data-done={s.done}>
              <input
                type="checkbox"
                checked={s.done}
                onChange={() => onToggleSub(s.id)}
                style={{ accentColor: 'var(--green)' }}
              />
              {s.title}
            </label>
          ))}
        </div>
      )}

      <div style={{ marginTop: 18, display: 'flex', gap: 6 }}>
        <button className="btn btn-ghost btn-danger" onClick={onDelete}>
          Delete task
        </button>
      </div>

      <div style={{ marginTop: 14, fontSize: 10.5, color: 'var(--text-3)', lineHeight: 1.7 }}>
        <div>id · <code>{task.id}</code></div>
        <div>added {new Date(task.createdAt).toLocaleString()}</div>
        {task.completedAt && <div>done {new Date(task.completedAt).toLocaleString()}</div>}
        <div>via {task.source}</div>
      </div>
    </aside>
  );
}
