import { useState } from 'react';
import type { Task } from '../lib/types';
import { parseDateInput } from '../lib/dates';

/**
 * Plain text in, task out.
 *
 * Parses only what the card actually shows: `#project` and a trailing date
 * word. Priority and tag syntax are deliberately left unparsed — neither is
 * drawn on the card, so quietly eating "!1" or "@x" out of a title would be a
 * bug rather than a feature. The CLI keeps the full syntax for Claude.
 */
export function parseQuickAdd(input: string): (Partial<Task> & { title: string }) | null {
  let text = ` ${input.trim()} `;
  if (!text.trim()) return null;

  let project: string | undefined;
  // Require a letter to start, so "Fix issue #42" keeps its number.
  text = text.replace(/\s#([a-zA-Z][^\s#]*)/g, (_, name: string) => {
    project ??= name;
    return ' ';
  });

  const words = text.trim().split(/\s+/).filter(Boolean);
  let due: string | undefined;
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

  return {
    title,
    ...(project ? { project } : {}),
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

  const submit = () => {
    const draft = parseQuickAdd(value);
    if (!draft) return;
    onAdd(draft);
    setValue('');
  };

  // Hint with a project the user actually has. Prefer the shortest name so the
  // placeholder stays readable in a narrow window.
  const shortest = [...projects].sort((a, b) => a.length - b.length)[0];
  const hint = shortest ? `Add a task…   #${shortest}   tomorrow` : 'Add a task…';

  return (
    <div className="composer">
      <div className="composer-shell">
        <input
          value={value}
          placeholder={hint}
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
          }}
        />
        <span className="composer-hint">⏎</span>
      </div>
    </div>
  );
}
