/**
 * Editor state: UI concerns for the topology editor.
 *
 * All topology behavior lives in TopologyEngine; this store only mirrors
 * its snapshots and holds selection/mode. React components call actions;
 * they never mutate topology directly.
 */

import { create } from 'zustand';
import { TopologyEngine, TopologyError } from '../engine/topology-engine';
import type { Node, Topology, TopologyErrorCode } from '../models/topology';
import { validateTopology } from '../models/topology';

export type EditorError = { readonly code: string; readonly message: string };

interface EditorStore {
  engine: TopologyEngine | null;
  topology: Topology | null;
  mode: 'lab' | 'editor';
  selectedNodeId: string | null;
  pendingLinkFrom: string | null;
  errors: readonly EditorError[];
  validation: readonly { code: TopologyErrorCode; message: string; subject: string }[];

  enterEditor: () => void;
  exitEditor: () => void;
  select: (nodeId: string | null) => void;
  togglePendingLink: (nodeId: string) => void;
  refresh: () => void;

  addHost: () => void;
  addServer: (service?: 'dns' | 'web') => void;
  addSwitch: () => void;
  addRouter: () => void;
  deleteNode: (nodeId: string) => void;
  connectSelected: () => void;
  addInterface: (nodeId: string) => void;
  assignIp: (ifaceId: string, ip: string, prefix: number) => void;
  setGateway: (nodeId: string, gateway: string | null) => void;
  setDeviceState: (nodeId: string, enabled: boolean) => void;
  toggleDevice: (nodeId: string) => void;
}

function sync(engine: TopologyEngine) {
  const topology = engine.snapshot();
  return {
    topology,
    validation: validateTopology(topology),
    errors: [] as readonly EditorError[]
  };
}

export const useEditor = create<EditorStore>((set, get) => ({
  engine: null,
  topology: null,
  mode: 'lab',
  selectedNodeId: null,
  pendingLinkFrom: null,
  errors: [],
  validation: [],

  enterEditor: () => {
    const engine = new TopologyEngine();
    set({ engine, mode: 'editor', ...sync(engine), selectedNodeId: null, pendingLinkFrom: null });
  },

  exitEditor: () => set({ mode: 'lab', engine: null, topology: null, selectedNodeId: null, pendingLinkFrom: null, errors: [], validation: [] }),

  select: (nodeId) => set({ selectedNodeId: nodeId, pendingLinkFrom: null }),

  togglePendingLink: (nodeId) =>
    set((s) => ({ pendingLinkFrom: s.pendingLinkFrom === nodeId ? null : nodeId })),

  refresh: () => {
    const { engine } = get();
    if (engine !== null) set(sync(engine));
  },

  addHost: () => {
    const { engine } = get();
    if (engine === null) return;
    try {
      engine.addHost();
      set({ ...sync(engine), selectedNodeId: null, pendingLinkFrom: null });
    } catch (e) {
      set({ errors: [toError(e)] });
    }
  },

  addServer: (service) => {
    const { engine } = get();
    if (engine === null) return;
    try {
      engine.addServer(undefined, service !== undefined ? { service } : undefined);
      set({ ...sync(engine), selectedNodeId: null, pendingLinkFrom: null });
    } catch (e) {
      set({ errors: [toError(e)] });
    }
  },

  addSwitch: () => {
    const { engine } = get();
    if (engine === null) return;
    try {
      engine.addSwitch();
      set({ ...sync(engine), selectedNodeId: null, pendingLinkFrom: null });
    } catch (e) {
      set({ errors: [toError(e)] });
    }
  },

  addRouter: () => {
    const { engine } = get();
    if (engine === null) return;
    try {
      engine.addRouter();
      set({ ...sync(engine), selectedNodeId: null, pendingLinkFrom: null });
    } catch (e) {
      set({ errors: [toError(e)] });
    }
  },

  deleteNode: (nodeId) => {
    const { engine } = get();
    if (engine === null) return;
    try {
      engine.removeNode(nodeId);
      set({ ...sync(engine), selectedNodeId: null, pendingLinkFrom: null });
    } catch (e) {
      set({ errors: [toError(e)] });
    }
  },

  connectSelected: () => {
    const { engine, pendingLinkFrom, selectedNodeId } = get();
    if (engine === null || pendingLinkFrom === null || selectedNodeId === null) return;
    if (pendingLinkFrom === selectedNodeId) return;
    try {
      const from = engine.node(pendingLinkFrom);
      const to = engine.node(selectedNodeId);
      if (from === undefined || to === undefined) return;
      engine.connect(from.interfaces[0]!.id, to.interfaces[0]!.id);
      set({ ...sync(engine), pendingLinkFrom: null });
    } catch (e) {
      set({ errors: [toError(e)] });
    }
  },

  addInterface: (nodeId) => {
    const { engine } = get();
    if (engine === null) return;
    try {
      engine.addInterface(nodeId);
      set(sync(engine));
    } catch (e) {
      set({ errors: [toError(e)] });
    }
  },

  assignIp: (ifaceId, ip, prefix) => {
    const { engine } = get();
    if (engine === null) return;
    try {
      engine.assignIp(ifaceId, ip, prefix);
      set(sync(engine));
    } catch (e) {
      set({ errors: [toError(e)] });
    }
  },

  setGateway: (nodeId, gateway) => {
    const { engine } = get();
    if (engine === null) return;
    try {
      engine.setGateway(nodeId, gateway);
      set(sync(engine));
    } catch (e) {
      set({ errors: [toError(e)] });
    }
  },

  setDeviceState: (nodeId, enabled) => {
    const { engine } = get();
    if (engine === null) return;
    try {
      engine.setDeviceState(nodeId, enabled);
      set(sync(engine));
    } catch (e) {
      set({ errors: [toError(e)] });
    }
  },

  toggleDevice: (nodeId) => {
    const { engine } = get();
    if (engine === null) return;
    try {
      engine.toggleDevice(nodeId);
      set(sync(engine));
    } catch (e) {
      set({ errors: [toError(e)] });
    }
  }
}));

function toError(e: unknown): EditorError {
  if (e instanceof TopologyError) {
    return { code: e.code, message: e.message };
  }
  return { code: 'unknown', message: e instanceof Error ? e.message : String(e) };
}

export function selectedNode(topology: Topology | null, id: string | null): Node | undefined {
  if (topology === null || id === null) return undefined;
  return topology.nodes.find((n) => n.id === id);
}
