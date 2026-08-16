import { useState } from 'react';
import type { Task } from '../lib/types';
import { parseDateInput } from '../lib/dates';

/**
 * Plain text in, task out.
 *
 * Only a trailing date word is parsed ("… tomorrow"), because the due date is
 * the one attribute the list actually shows. Project/tag/priority syntax is
 * deliberately *not* parsed here — none of it is visible, so silently eating
 * "#42" out of a title would be a bug, not a feature. The CLI keeps the full
 * syntax for when Claude is driving.
 */
export function parseQuickAdd(input: string): (Partial<Task> & { title: string }) | null {
  const words = input.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;

  let due: string | undefined;
  // Check the last two words, then the last one — "next week" before "week".
  for (let take = Math.min(2, words.length); take >= 1; take -= 1) {
    // Never let the date word consume the entire title.
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

  return { title, ...(due ? { due } : {}), source: 'app' as const };
}

export function Composer({ onAdd }: { onAdd: (draft: Partial<Task> & { title: string }) => void }) {
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
          value={value}
          placeholder="Add a task…"
          spellCheck={false}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            } else if (e.key === 'Escape') {
              setValue('');
              e.currentTarget.blur();
            }
          }}
        />
        <span className="composer-hint">⏎</span>
      </div>
    </div>
  );
}
