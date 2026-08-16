import { useRef, useState } from 'react';
import type { Priority, Task } from '../lib/types';
import { parseDateInput } from '../lib/dates';

/**
 * Quick-add.
 *
 * The single line parses `#project`, `@tag`, `!0`–`!3` and a trailing date word
 * — everything the card displays. Notes need a second line, so the box expands
 * to a notes field rather than trying to cram prose into the same input.
 */
export function parseQuickAdd(input: string): (Partial<Task> & { title: string }) | null {
  let text = ` ${input.trim()} `;
  if (!text.trim()) return null;

  let project: string | undefined;
  let priority: Priority | undefined;
  const tags: string[] = [];

  // Require a leading letter so "Fix issue #42" keeps its number.
  text = text.replace(/\s#([a-zA-Z][^\s#@!]*)/g, (_, name: string) => {
    project ??= name;
    return ' ';
  });
  text = text.replace(/\s@([a-zA-Z][^\s#@!]*)/g, (_, name: string) => {
    tags.push(name);
    return ' ';
  });
  text = text.replace(/\s!([0-3])\b/g, (_, n: string) => {
    priority = Number(n) as Priority;
    return ' ';
  });

  const words = text.trim().split(/\s+/).filter(Boolean);
  let due: string | undefined;
  for (let take = Math.min(2, words.length); take >= 1; take -= 1) {
    // Never let the date word swallow the whole title.
    if (take >= words.length) continue;
    const parsed = parseDateInput(words.slice(-take).join(' '));
    if (parsed) {
      due = parsed;
      words.splice(-take, take);
      break;
    }
  }

  const title = words.join(' ').trim();
  if (!title) return null;

  return {
    title,
    ...(project ? { project } : {}),
    ...(tags.length ? { tags } : {}),
    ...(priority !== undefined ? { priority } : {}),
    ...(due ? { due } : {}),
    source: 'app' as const,
  };
}

interface Props {
  projects: string[];
  onAdd: (draft: Partial<Task> & { title: string }) => void;
}

export function Composer({ projects, onAdd }: Props) {
  const [value, setValue] = useState('');
  const [notes, setNotes] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    const draft = parseQuickAdd(value);
    if (!draft) return;
    onAdd({ ...draft, ...(notes.trim() ? { notes: notes.trim() } : {}) });
    setValue('');
    setNotes('');
    setOpen(false);
    inputRef.current?.focus();
  };

  const reset = () => {
    setValue('');
    setNotes('');
    setOpen(false);
  };

  const shortest = [...projects].sort((a, b) => a.length - b.length)[0];
  const hint = shortest ? `Add a task…   #${shortest}  @tag  !1  tomorrow` : 'Add a task…   @tag  !1  tomorrow';

  return (
    <div className="composer">
      <div className="composer-shell" data-open={open}>
        <div className="composer-row">
          <input
            ref={inputRef}
            value={value}
            placeholder={hint}
            spellCheck={false}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              } else if (e.key === 'Escape') {
                reset();
                e.currentTarget.blur();
              }
            }}
          />
          <button
            className="composer-expand"
            aria-expanded={open}
            aria-label={open ? 'Hide notes' : 'Add notes'}
            title={open ? 'Hide notes' : 'Add notes'}
            onClick={() => setOpen((o) => !o)}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3 4.5h10M3 8h10M3 11.5h6" />
            </svg>
          </button>
        </div>

        {open && (
          <>
            <textarea
              className="composer-notes"
              value={notes}
              rows={2}
              placeholder="Notes… (বাংলা / English দুটোই চলবে)"
              onChange={(e) => setNotes(e.target.value)}
              onKeyDown={(e) => {
                // Enter makes a new line here; ⌘/Ctrl+Enter commits.
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submit();
                }
                if (e.key === 'Escape') reset();
              }}
            />
            <div className="composer-foot">
              <span className="composer-hint">⌘⏎ to add</span>
              <button className="btn btn-primary" onClick={submit}>
                Add task
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
