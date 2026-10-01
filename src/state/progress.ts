/**
 * Lab progress: which labs the student has completed.
 *
 * Client-side only — persisted to localStorage when available and kept in
 * a tiny Zustand slice so React components re-render on change. No
 * backend, no accounts: progress lives and dies with the browser.
 *
 * Completion is DERIVED from the engine: whenever a simulation reaches a
 * state satisfying the lab's completion predicate, `recordCompletion`
 * marks the lab done. The store never fabricates progress.
 */

import { create } from 'zustand';
import type { NetworkState } from '../models/network-state';
import type { LabDefinition } from '../labs/types';
import { labCompletion } from '../labs/framework';

const STORAGE_KEY = 'npvl.lab-progress.v1';

export interface LabProgressState {
  /** Ids of labs whose completion criteria have been met at least once. */
  readonly completed: ReadonlySet<string>;
  /** Visited lab ids (seen at least once in the lab browser). */
  readonly visited: ReadonlySet<string>;
  /** Marks a lab complete if (and only if) the state satisfies its criteria. */
  recordCompletion: (lab: LabDefinition, state: NetworkState) => void;
  /** Marks a lab as seen (opened in the browser). */
  markVisited: (labId: string) => void;
  /** Clears all progress (the framework is client-side, so this is local). */
  clearAll: () => void;
}

function loadCompleted(): ReadonlySet<string> {
  if (typeof localStorage === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

function persist(completed: ReadonlySet<string>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...completed]));
  } catch {
    // Storage may be unavailable (private mode, quota) — progress stays in memory.
  }
}

export const useLabProgress = create<LabProgressState>((set, get) => ({
  completed: loadCompleted(),
  visited: new Set(),

  recordCompletion: (lab, state) => {
    // A lab without a completion predicate falls back to "script ran";
    // that check lives in labCompletion, so one call covers both.
    if (!labCompletion(lab).check(state)) return;
    if (get().completed.has(lab.id)) return;
    const next = new Set(get().completed);
    next.add(lab.id);
    persist(next);
    set({ completed: next });
  },

  markVisited: (labId) => {
    if (get().visited.has(labId)) return;
    const next = new Set(get().visited);
    next.add(labId);
    set({ visited: next });
  },

  clearAll: () => {
    persist(new Set());
    set({ completed: new Set(), visited: new Set() });
  }
}));

/** True when the lab's completion criteria hold for this state right now. */
export function isCompleteNow(lab: LabDefinition, state: NetworkState | null): boolean {
  if (state === null) return false;
  return labCompletion(lab).check(state);
}
