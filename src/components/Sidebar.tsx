import type { Stats, Vault } from '../lib/types';
import { isOpen } from '../lib/vault';
import { todayISO } from '../lib/dates';
import { Icon, type IconName } from './Icon';

export type View =
  | { kind: 'today' }
  | { kind: 'upcoming' }
  | { kind: 'all' }
  | { kind: 'done' }
  | { kind: 'project'; name: string };

export function viewKey(v: View): string {
  return v.kind === 'project' ? `project:${v.name}` : v.kind;
}

const SMART_VIEWS: { kind: View['kind']; icon: IconName; label: string; accent: string }[] = [
  { kind: 'today', icon: 'today', label: 'Today', accent: 'var(--blue)' },
  { kind: 'upcoming', icon: 'upcoming', label: 'Upcoming', accent: 'var(--indigo)' },
  { kind: 'all', icon: 'all', label: 'All Open', accent: 'var(--purple)' },
  { kind: 'done', icon: 'done', label: 'Completed', accent: 'var(--green)' },
];

export type ThemeMode = 'system' | 'light' | 'dark';

interface Props {
  vault: Vault;
  stats: Stats;
  view: View;
  onSelect: (v: View) => void;
  theme: ThemeMode;
  onCycleTheme: () => void;
  onReveal: () => void;
}

export function Sidebar({ vault, stats, view, onSelect, theme, onCycleTheme, onReveal }: Props) {
  const today = todayISO();
  const open = vault.tasks.filter(isOpen);

  const counts: Record<string, number> = {
    today: open.filter((t) => (t.due && t.due <= today) || t.status === 'doing').length,
    upcoming: open.filter((t) => t.due && t.due > today).length,
    all: open.length,
    done: vault.tasks.filter((t) => t.status === 'done').length,
  };

  const active = viewKey(view);
  const themeIcon: IconName = theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'auto';

  return (
    <nav className="sidebar">
      <div className="sidebar-brand">
        <span className="brand-dot" />
        Prism
      </div>

      {SMART_VIEWS.map((item) => {
        const alert = item.kind === 'today' && stats.overdue > 0;
        return (
          <button
            key={item.kind}
            className="nav-item"
            aria-current={active === item.kind}
            style={{ '--accent': item.accent } as React.CSSProperties}
            onClick={() => onSelect({ kind: item.kind } as View)}
          >
            <span className="nav-icon">
              <Icon name={item.icon} size={14} />
            </span>
            {item.label}
            {counts[item.kind] > 0 && (
              <span className="nav-count" data-alert={alert}>
                {counts[item.kind]}
              </span>
            )}
          </button>
        );
      })}

      {vault.projects.length > 0 && (
        <>
          <div className="sidebar-label">Projects</div>
          {vault.projects.map((p) => {
            const n = open.filter((t) => t.project === p.name).length;
            return (
              <button
                key={p.id}
                className="nav-item"
                aria-current={active === `project:${p.name}`}
                onClick={() => onSelect({ kind: 'project', name: p.name })}
              >
                <span className="project-swatch" style={{ background: p.color }} />
                {p.name}
                {n > 0 && <span className="nav-count">{n}</span>}
              </button>
            );
          })}
        </>
      )}

      <div className="sidebar-foot">
        <button
          className="btn btn-ghost btn-icon"
          title={`Appearance: ${theme}`}
          aria-label={`Appearance: ${theme}. Click to change.`}
          onClick={onCycleTheme}
        >
          <Icon name={themeIcon} size={14} />
        </button>
        <button
          className="btn btn-ghost btn-icon"
          title="Reveal vault in Finder"
          aria-label="Reveal vault in Finder"
          onClick={onReveal}
        >
          <Icon name="folder" size={14} />
        </button>
        {stats.streak > 1 && (
          <span
            className="chip"
            style={{ '--chip': 'var(--purple)', marginLeft: 'auto' } as React.CSSProperties}
          >
            🔥 {stats.streak}
          </span>
        )}
      </div>
    </nav>
  );
}
