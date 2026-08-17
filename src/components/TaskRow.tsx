import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Priority, Project, Task, Vault } from '../lib/types';
import { isOverdue, relativeDue } from '../lib/dates';
import { projectColor } from '../lib/vault';

/**
 * Tint any project name that appears inside a title, so the thing being worked
 * on is findable at a glance — "Rebuild the **OERP** GitHub repo" rather than a
 * uniform grey sentence.
 *
 * Matching is on the project names the vault already knows about, so nothing
 * needs to be marked up by hand when a task is written.
 */
function highlightProjects(title: string, projects: Project[]): ReactNode[] {
  const names = projects
    .map((p) => p.name)
    .filter((n) => n.trim().length > 1)
    // Longest first so "Udvash Unmesh" wins over a bare "Udvash".
    .sort((a, b) => b.length - a.length);
  if (!names.length) return [title];

  const colorOf = new Map(projects.map((p) => [p.name.toLowerCase(), p.color]));
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');

  const out: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(title)) !== null) {
    if (match.index > cursor) out.push(title.slice(cursor, match.index));
    out.push(
      <span
        key={key++}
        className="title-mark"
        style={{ '--mark': colorOf.get(match[0].toLowerCase()) } as React.CSSProperties}
      >
        {match[0]}
      </span>,
    );
    cursor = match.index + match[0].length;
  }

  if (cursor === 0) return [title]; // nothing matched
  if (cursor < title.length) out.push(title.slice(cursor));
  return out;
}

const PRIORITY_COLOR: Record<Priority, string> = {
  0: 'var(--pink)',
  1: 'var(--orange)',
  2: 'var(--text-3)',
  3: 'var(--text-3)',
};

const PRIORITIES: Priority[] = [0, 1, 2, 3];

interface Props {
  task: Task;
  vault: Vault;
  editing: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onClose: () => void;
  onPatch: (patch: Partial<Task>) => void;
  onDelete: () => void;
}

/**
 * A task card that expands in place for editing.
 *
 * Editing inline rather than in a side panel keeps the single-column layout —
 * the card grows into the space it already occupies instead of opening chrome
 * beside it.
 */
export function TaskRow({ task, vault, editing, onToggle, onOpen, onClose, onPatch, onDelete }: Props) {
  const done = task.status === 'done' || task.status === 'cancelled';
  const due = relativeDue(task.due);
  const late = !done && isOverdue(task.due);
  const color = projectColor(vault, task.project);

  if (editing) {
    return (
      <TaskEditor
        task={task}
        vault={vault}
        onPatch={onPatch}
        onDelete={onDelete}
        onClose={onClose}
      />
    );
  }

  return (
    // The scroll area closes the editor on click; without stopping propagation
    // here, opening a card would immediately close it again.
    <div
      className="task"
      data-done={done}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
    >
      <button
        className="check"
        data-done={done}
        aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
        onClick={(e) => {
          e.stopPropagation(); // the card body opens the editor
          onToggle();
        }}
      >
        <svg viewBox="0 0 14 14" aria-hidden="true">
          <polyline points="3,7.4 5.9,10.2 11,3.9" />
        </svg>
      </button>

      <div className="task-main">
        <div className="task-head">
          <span className="task-title">
            {done ? task.title : highlightProjects(task.title, vault.projects)}
          </span>

          {/* The right-hand column: what you need at a glance, right-aligned. */}
          <span className="task-side">
            {task.priority <= 1 && !done && (
              <span
                className="prio-dot"
                style={{ background: PRIORITY_COLOR[task.priority] }}
                title={task.priority === 0 ? 'Urgent' : 'High'}
              />
            )}
            {due && !done && (
              <span className="task-due" data-late={late}>
                {due}
              </span>
            )}
          </span>
        </div>

        {task.notes && !done && <div className="task-notes">{task.notes}</div>}

        {(task.project || task.tags.length > 0) && !done && (
          <div className="task-meta">
            {task.project && (
              <span className="chip" style={{ '--chip': color } as React.CSSProperties}>
                <span className="chip-dot" />
                {task.project}
              </span>
            )}
            {task.tags.map((t) => (
              <span key={t} className="chip chip-tag">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Editor ───────────────────────────────────────────────────────────────────

function TaskEditor({
  task,
  vault,
  onPatch,
  onDelete,
  onClose,
}: {
  task: Task;
  vault: Vault;
  onPatch: (patch: Partial<Task>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? '');
  const [project, setProject] = useState(task.project ?? '');
  const [tags, setTags] = useState(task.tags.join(', '));
  const [due, setDue] = useState(task.due ?? '');
  const [priority, setPriority] = useState<Priority>(task.priority);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const titleRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.setSelectionRange(title.length, title.length);
    // Focusing once on open — not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = () => {
    const clean = title.trim();
    // An empty title would render an unclickable, unnameable card.
    if (!clean) {
      onClose();
      return;
    }
    onPatch({
      title: clean,
      notes: notes.trim() || undefined,
      project: project.trim() || undefined,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      due: due || undefined,
      priority,
    });
    onClose();
  };

  return (
    <div className="task task-editing" onClick={(e) => e.stopPropagation()}>
      <div className="task-main">
        <textarea
          ref={titleRef}
          className="edit-title"
          value={title}
          rows={1}
          placeholder="Task title"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              save();
            }
            if (e.key === 'Escape') onClose();
          }}
        />

        <textarea
          className="edit-notes"
          value={notes}
          rows={2}
          placeholder="Notes…"
          onChange={(e) => setNotes(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
          }}
        />

        <div className="edit-grid">
          <label className="edit-field">
            <span>Project</span>
            <input
              value={project}
              list="project-list"
              placeholder="None"
              onChange={(e) => setProject(e.target.value)}
            />
            <datalist id="project-list">
              {vault.projects.map((p) => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
          </label>

          <label className="edit-field">
            <span>Due</span>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>

          <label className="edit-field edit-field-wide">
            <span>Tags</span>
            <input
              value={tags}
              placeholder="comma, separated"
              onChange={(e) => setTags(e.target.value)}
            />
          </label>

          <div className="edit-field edit-field-wide">
            <span>Priority</span>
            <div className="seg">
              {PRIORITIES.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={priority === p}
                  style={{ '--seg-fg': PRIORITY_COLOR[p] } as React.CSSProperties}
                  onClick={() => setPriority(p)}
                >
                  P{p}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="edit-actions">
          <button
            className="btn btn-danger"
            onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}
          >
            {confirmDelete ? 'Really delete?' : 'Delete'}
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
