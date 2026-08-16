import { forwardRef, useState } from 'react';
import type { Priority, Task } from '../lib/types';
import { parseDateInput } from '../lib/dates';

/**
 * Quick-add syntax, parsed out of the free-text line:
 *   #project   @tag   !0…!3 (priority)   and a trailing date word
 *
 * Everything the parser recognises is stripped from the title, so
 * `Ship invoice #Work !1 tomorrow` becomes a clean task named "Ship invoice".
 */
export function parseQuickAdd(input: string): (Partial<Task> & { title: string }) | null {
  let text = ` ${input.trim()} `;
  if (!text.trim()) return null;

  const tags: string[] = [];
  let project: string | undefined;
  let priority: Priority | undefined;
  let due: string | undefined;

  text = text.replace(/\s#([^\s#@!]+)/g, (_, name: string) => {
    project ??= name;
    return ' ';
  });

  text = text.replace(/\s@([^\s#@!]+)/g, (_, name: string) => {
    tags.push(name);
    return ' ';
  });

  text = text.replace(/\s!([0-3])\b/g, (_, n: string) => {
    priority = Number(n) as Priority;
    return ' ';
  });

  // A recognised date word at the end of the line becomes the due date.
  // Only the tail is considered, so "Call mom today about Friday" keeps its wording.
  const words = text.trim().split(/\s+/);
  for (let take = Math.min(2, words.length); take >= 1; take -= 1) {
    const candidate = words.slice(-take).join(' ');
    const parsed = parseDateInput(candidate);
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
  onAdd: (draft: Partial<Task> & { title: string }) => void;
}

export const Composer = forwardRef<HTMLInputElement, Props>(function Composer({ onAdd }, ref) {
  const [value, setValue] = useState('');

  const submit = () => {
    const draft = parseQuickAdd(value);
    if (!draft) return;
    onAdd(draft);
    setValue('');
  };

  return (
    <div className="composer">
      <div className="composer-shell">
        <input
          ref={ref}
          value={value}
          placeholder="Add a task…   #project  @tag  !1  tomorrow"
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            } else if (e.key === 'Escape') {
              setValue('');
              e.currentTarget.blur();
            }
            // Arrow keys belong to the list, not to an empty input.
            e.stopPropagation();
          }}
        />
        <span className="composer-hint">⏎</span>
      </div>
    </div>
  );
});
