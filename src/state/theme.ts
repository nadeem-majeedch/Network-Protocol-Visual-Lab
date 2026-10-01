/**
 * Theme state: light/dark with system-preference default and persistence.
 *
 * Applies the `data-theme` attribute on <html>; CSS variables do the rest.
 * No network, no dependencies — reads localStorage once at module load.
 */

import { create } from 'zustand';

export type ThemeName = 'light' | 'dark';

function detectInitialTheme(): ThemeName {
  try {
    const stored = localStorage.getItem('npvl-theme');
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // localStorage can be unavailable (file://, privacy modes) — fall through.
  }
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}

function applyTheme(theme: ThemeName): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = theme;
  }
  try {
    localStorage.setItem('npvl-theme', theme);
  } catch {
    // Persistence is best-effort; the in-memory theme still works.
  }
}

const initial = detectInitialTheme();
if (typeof document !== 'undefined') {
  document.documentElement.dataset.theme = initial;
}

interface ThemeStore {
  readonly theme: ThemeName;
  toggle: () => void;
  set: (theme: ThemeName) => void;
}

export const useTheme = create<ThemeStore>((set, get) => ({
  theme: initial,
  toggle: () => {
    const next: ThemeName = get().theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    set({ theme: next });
  },
  set: (theme) => {
    applyTheme(theme);
    set({ theme });
  }
}));
