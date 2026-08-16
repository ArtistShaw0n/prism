import { Fragment, type ReactNode } from 'react';
import type { Digest, Stats } from '../lib/types';
import { greeting, longDate } from '../lib/dates';

/**
 * Renders the small Markdown subset Claude writes into a digest: paragraphs,
 * bullet lists, **bold** and `code`.
 *
 * This builds React elements rather than HTML strings, so digest text can never
 * inject markup no matter what ends up in the vault.
 */
function renderInline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];
    const key = `${keyBase}-${i++}`;
    if (token.startsWith('**')) nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    cursor = match.index + token.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function Markdown({ source }: { source: string }) {
  const blocks: ReactNode[] = [];
  const lines = source.split('\n');
  let bullets: string[] = [];

  const flushBullets = () => {
    if (!bullets.length) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`}>
        {bullets.map((b, i) => (
          <li key={i}>{renderInline(b, `li-${blocks.length}-${i}`)}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\s*[-*•]\s+/.test(line)) {
      bullets.push(line.replace(/^\s*[-*•]\s+/, ''));
      continue;
    }
    flushBullets();
    if (!line.trim()) continue;
    // Headings collapse to bold paragraphs — the card is already a heading.
    const text = line.replace(/^#{1,6}\s+/, '');
    blocks.push(<p key={`p-${blocks.length}`}>{renderInline(text, `p-${blocks.length}`)}</p>);
  }
  flushBullets();

  return <Fragment>{blocks}</Fragment>;
}

interface Props {
  digest?: Digest;
  stats: Stats;
}

export function DailyBrief({ digest, stats }: Props) {
  // Only surface counts that carry information — a row of zeroes is noise.
  const tiles = [
    { n: stats.doing, label: 'in progress', color: 'var(--teal)', show: stats.doing > 0 },
    { n: stats.dueToday, label: 'due today', color: 'var(--blue)', show: stats.dueToday > 0 },
    { n: stats.overdue, label: 'overdue', color: 'var(--pink)', show: stats.overdue > 0 },
    { n: stats.urgent, label: 'urgent', color: 'var(--orange)', show: stats.urgent > 0 },
    { n: stats.completedToday, label: 'done today', color: 'var(--green)', show: stats.completedToday > 0 },
    { n: stats.open, label: 'open', color: 'var(--text-1)', show: true },
    { n: stats.streak, label: `day streak`, color: 'var(--purple)', show: stats.streak > 1 },
  ].filter((t) => t.show);

  return (
    <section className="brief">
      <div className="brief-greet">{greeting()}, Shawon</div>
      <div className="brief-date">{longDate()}</div>

      {digest ? (
        <div className="brief-body">
          <Markdown source={digest.markdown} />
        </div>
      ) : (
        <div className="brief-body" style={{ color: 'var(--text-2)' }}>
          {stats.open === 0
            ? 'Nothing on the list. Ask Claude to add something, or type below.'
            : `${stats.open} open ${stats.open === 1 ? 'task' : 'tasks'}. Ask Claude for today's brief to see a written summary here.`}
        </div>
      )}

      <div className="stat-row">
        {tiles.map((t) => (
          <div key={t.label} className="stat">
            <span className="stat-num" style={{ '--stat-color': t.color } as React.CSSProperties}>
              {t.n}
            </span>
            <span className="stat-label">{t.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
