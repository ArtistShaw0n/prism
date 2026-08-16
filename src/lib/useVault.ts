import { useCallback, useEffect, useRef, useState } from 'react';
import type { Vault } from './types';
import { computeStats, loadVault, onVaultChanged, saveVault, setTrayBadge } from './vault';

interface UseVault {
  vault: Vault | null;
  path: string;
  error: string | null;
  /** Apply a pure mutation, render optimistically, then persist. */
  mutate: (fn: (v: Vault) => Vault) => Promise<void>;
  reload: () => Promise<void>;
}

export function useVault(): UseVault {
  const [vault, setVault] = useState<Vault | null>(null);
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);

  // The authoritative copy. State alone would go stale inside the async gap
  // between two rapid mutations.
  const ref = useRef<Vault | null>(null);

  const commit = useCallback((next: Vault) => {
    ref.current = next;
    setVault(next);
  }, []);

  const reload = useCallback(async () => {
    try {
      const { vault: fresh, path: p } = await loadVault();
      commit(fresh);
      setPath(p);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, [commit]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Pick up edits made by Claude, the CLI, or file sync.
  useEffect(() => {
    let dispose: (() => void) | undefined;
    void onVaultChanged((fresh) => commit(fresh)).then((fn) => {
      dispose = fn;
    });
    return () => dispose?.();
  }, [commit]);

  // Keep the menu bar count in step with whatever is on screen.
  useEffect(() => {
    if (!vault) return;
    const stats = computeStats(vault);
    void setTrayBadge(stats.open, stats.overdue > 0 || stats.urgent > 0);
  }, [vault]);

  const mutate = useCallback(
    async (fn: (v: Vault) => Vault) => {
      const current = ref.current;
      if (!current) return;

      const next = fn(current);
      commit(next); // optimistic — the UI must not wait on disk

      try {
        commit(await saveVault(next, current.meta.updatedAt));
        setError(null);
      } catch (err) {
        if (!String(err).includes('conflict')) {
          setError(String(err));
          return;
        }
        // Someone wrote between our read and our save. Re-apply the same
        // mutation on top of their version rather than overwriting it.
        try {
          const { vault: fresh } = await loadVault();
          const merged = fn(fresh);
          commit(await saveVault(merged, fresh.meta.updatedAt));
          setError(null);
        } catch (retryErr) {
          setError(String(retryErr));
          await reload();
        }
      }
    },
    [commit, reload],
  );

  return { vault, path, error, mutate, reload };
}
