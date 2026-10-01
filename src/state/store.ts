/**
 * Application state: a thin Zustand store over the canonical engine.
 *
 * The store holds *UI* concerns (selection, playback, current lab) plus a
 * snapshot of NetworkState. All protocol knowledge stays in the engine;
 * playback moves a cursor over the recorded event timeline, never
 * re-running the simulation.
 */

import { create } from 'zustand';
import type { NetworkState } from '../models/network-state';
import type { Packet } from '../models/packet';
import type { LabDefinition } from '../labs/types';
import { labById } from '../labs';
import { runLab, labSeed } from '../labs/runner';
import { NetworkEngine } from '../engine/network-engine';
import { eventTimes, previousEventTime, nextEventTime } from './playback';

export interface AppStore {
  engine: NetworkEngine | null;
  lab: LabDefinition | null;
  state: NetworkState | null;
  selectedPacketId: string | null;
  playing: boolean;
  speed: number;
  cursorMs: number;
  expandedLayers: Readonly<Record<string, boolean>>;
  status: 'idle' | 'running' | 'done';
  selectedEventIndex: number | null;
  loadLab: (id: string) => void;
  /** Flagship entry point: open a URL like http://example.local/index.html. */
  openUrl: (url: string) => void;
  run: () => void;
  step: () => void;
  reset: () => void;
  togglePlay: () => void;
  setSpeed: (speed: number) => void;
  selectPacket: (id: string | null) => void;
  toggleLayer: (layer: string) => void;
  selectEvent: (index: number | null) => void;
  scrubTo: (ms: number) => void;
  stepForward: () => void;
  stepBackward: () => void;
  /** Called by the animation loop each frame while playing. */
  tick: (deltaMs: number) => void;
}

// Playback loop: one rAF driver, shared across store consumers.
let rafHandle: number | null = null;
let lastFrameTs: number | null = null;

function stopLoop() {
  if (rafHandle !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(rafHandle);
  }
  rafHandle = null;
  lastFrameTs = null;
}

function startLoop(get: () => AppStore, _set: (partial: Partial<AppStore>) => void) {
  stopLoop();
  if (typeof requestAnimationFrame !== 'function') return;
  const frame = (ts: number) => {
    const s = get();
    if (!s.playing) {
      stopLoop();
      return;
    }
    const delta = lastFrameTs === null ? 16 : ts - lastFrameTs;
    lastFrameTs = ts;
    s.tick((delta * s.speed) / 5); // 5× slower than real time by default
    const after = get();
    if (!after.playing) {
      stopLoop();
      return;
    }
    rafHandle = requestAnimationFrame(frame);
  };
  rafHandle = requestAnimationFrame(frame);
}

export const useApp = create<AppStore>((set, get) => ({
  engine: null,
  lab: null,
  state: null,
  selectedPacketId: null,
  playing: false,
  speed: 1,
  cursorMs: 0,
  expandedLayers: { ETHERNET: true },
  status: 'idle',
  selectedEventIndex: null,

  loadLab: (id) => {
    const lab = labById(id);
    if (lab === undefined) return;
    stopLoop();
    const engine = new NetworkEngine(lab.topology);
    engine.reindex();
    set({
      engine,
      lab,
      state: null,
      selectedPacketId: null,
      playing: false,
      cursorMs: 0,
      status: 'idle',
      selectedEventIndex: null,
      expandedLayers: { ETHERNET: true }
    });
  },

  openUrl: (url) => {
    const parsed = parseHttpUrl(url);
    if (parsed === undefined) return;
    const lab = labById('open-web-page');
    if (lab === undefined) return;
    const scripted: LabDefinition = {
      ...lab,
      script: [
        { atMs: 0, action: 'note', nodeId: 'web-browser', message: `The student pressed Enter: ${url}` },
        { atMs: 0, action: 'send-http', from: 'web-browser', serverName: parsed.host, path: parsed.path, resolveFirst: true }
      ]
    };
    stopLoop();
    const engine = new NetworkEngine(scripted.topology);
    engine.reindex();
    set({
      engine,
      lab: scripted,
      state: null,
      selectedPacketId: null,
      playing: false,
      cursorMs: 0,
      status: 'idle',
      selectedEventIndex: null,
      expandedLayers: { ETHERNET: true }
    });
  },

  run: () => {
    const { engine, lab } = get();
    if (engine === null || lab === null) return;
    runLab(engine, lab);
    const state = engine.getState();
    set({
      state,
      cursorMs: 0,
      status: 'running',
      playing: true,
      selectedPacketId: null,
      selectedEventIndex: null
    });
    startLoop(get, set);
  },

  step: () => {
    const { engine, lab } = get();
    if (engine === null || lab === null) return;
    stopLoop();
    // One engine tick, then park the cursor at the end of what exists so far.
    const state = engine.step(labSeed(engine, lab));
    const times = eventTimes(state.events);
    const cursor = times.length > 0 ? (times[times.length - 1] ?? 0) : 0;
    set({ state, cursorMs: cursor, status: 'done', playing: false });
  },

  reset: () => {
    stopLoop();
    const { lab } = get();
    if (lab !== null) get().loadLab(lab.id);
  },

  togglePlay: () => {
    const { playing, state } = get();
    if (state === null) return;
    if (playing) {
      stopLoop();
      set({ playing: false });
      return;
    }
    // Resuming at the end restarts from the beginning.
    const end = state.simMs;
    const atEnd = get().cursorMs >= end;
    set({ playing: true, status: 'running', cursorMs: atEnd ? 0 : get().cursorMs });
    startLoop(get, set);
  },

  setSpeed: (speed) => set({ speed }),

  selectPacket: (id) => set({ selectedPacketId: id, selectedEventIndex: null }),

  toggleLayer: (layer) =>
    set((s) => ({ expandedLayers: { ...s.expandedLayers, [layer]: !(s.expandedLayers[layer] ?? true) } })),

  selectEvent: (index) => set({ selectedEventIndex: index }),

  scrubTo: (ms) => {
    stopLoop();
    set({ cursorMs: Math.max(0, ms), playing: false });
  },

  stepForward: () => {
    const { state, cursorMs } = get();
    if (state === null) return;
    stopLoop();
    const next = nextEventTime(state.events, cursorMs);
    if (next !== null) set({ cursorMs: next, playing: false, status: 'done' });
  },

  stepBackward: () => {
    const { state, cursorMs } = get();
    if (state === null) return;
    stopLoop();
    const prev = previousEventTime(state.events, cursorMs);
    if (prev !== null) set({ cursorMs: prev, playing: false });
  },

  tick: (deltaMs) => {
    const { state, cursorMs } = get();
    if (state === null) return;
    const next = cursorMs + deltaMs;
    if (next >= state.simMs) {
      stopLoop();
      set({ cursorMs: state.simMs, playing: false, status: 'done' });
    } else {
      set({ cursorMs: next });
    }
  }
}));

export function selectedPacket(state: NetworkState | null, id: string | null): Packet | undefined {
  if (state === null || id === null) return undefined;
  return state.packets.find((p) => p.id === id);
}

/** Parses http://host/path into its parts; undefined when not http(s). */
export function parseHttpUrl(url: string): { host: string; path: string } | undefined {
  const match = /^https?:\/\/([^/\s]+)(\/[^^\s]*)?$/.exec(url.trim());
  if (match === null) return undefined;
  return { host: match[1] ?? '', path: match[2] ?? '/' };
}
