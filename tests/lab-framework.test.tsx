/**
 * Laboratory framework: every lab — flagship, the 18 numbered curriculum
 * labs, and the original topical catalog — must
 *
 *   1. INITIALIZE  — topology validates; a fresh engine emits the intro
 *  2. EXECUTE     — a full run produces scheduled activity on the engine
 *   3. RESET       — a fresh engine replays a byte-identical event log
 *   4. COMPLETE    — the lab's completion predicate holds on the final state
 *
 * Also covered: the framework metadata contract (objectives, prerequisites,
 * observations, hints, explanation, controls), the pure projections in
 * labs/framework.ts, and the client-side progress store + panel UI.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { NetworkEngine } from '../src/engine/network-engine';
import { runLab, labSeed } from '../src/labs/runner';
import { labs, labById } from '../src/labs';
import { numberedLabs } from '../src/labs/numbered';
import type { LabDefinition } from '../src/labs/types';
import { validateTopology } from '../src/models/topology';
import { useApp } from '../src/state/store';
import { useLabProgress } from '../src/state/progress';
import { LabProgress } from '../src/components/LabProgress';
import { LabDetail } from '../src/components/LabDetail';
import {
  allOf,
  completedWhen,
  countEvents,
  eventSeen,
  labCompletion,
  labControls,
  labExplanation,
  labExpectedObservations,
  labHints,
  labNumberBadge,
  labObjectives,
  labPrerequisites
} from '../src/labs/framework';

function mustLab(id: string): LabDefinition {
  const lab = labById(id);
  if (lab === undefined) throw new Error(`Missing lab ${id}`);
  return lab;
}

function runToState(lab: LabDefinition) {
  const engine = new NetworkEngine(lab.topology);
  runLab(engine, lab);
  return engine.getState();
}

/* ------------------------------------------------------------------ */
/* Catalog structure                                                   */
/* ------------------------------------------------------------------ */

describe('Lab catalog structure', () => {
  it('contains exactly the 18 numbered labs, in order 01–18', () => {
    expect(numberedLabs).toHaveLength(18);
    expect(numberedLabs.map((l) => l.id)).toEqual([
      'lab-01-ethernet-frames',
      'lab-02-mac-addresses',
      'lab-03-arp-request-reply',
      'lab-04-arp-cache',
      'lab-05-ipv4-addressing',
      'lab-06-default-gateway',
      'lab-07-routing-table-lookup',
      'lab-08-longest-prefix-match',
      'lab-09-multi-router-routing',
      'lab-10-dns-resolution',
      'lab-11-dns-caching',
      'lab-12-tcp-three-way-handshake',
      'lab-13-tcp-sequence-ack',
      'lab-14-tcp-termination',
      'lab-15-http-get',
      'lab-16-http-response',
      'lab-17-protocol-encapsulation',
      'lab-18-complete-web-request'
    ]);
  });

  it('numbers every numbered title Lab 01 … Lab 18', () => {
    numberedLabs.forEach((lab, i) => {
      expect(lab.title.startsWith(`Lab ${String(i + 1).padStart(2, '0')} — `), lab.id).toBe(true);
    });
  });

  it('the flagship stays first and every numbered topic from the curriculum is present', () => {
    expect(labs[0]?.id).toBe('open-web-page');
    const topics = [
      'Ethernet Frames',
      'MAC Addresses',
      'ARP Request and Reply',
      'ARP Cache',
      'IPv4 Addressing',
      'Default Gateway',
      'Routing Table Lookup',
      'Longest Prefix Matching',
      'Multi-Router Routing',
      'DNS Resolution',
      'DNS Caching',
      'TCP Three-Way Handshake',
      'TCP Sequence and ACK',
      'TCP Connection Termination',
      'HTTP GET',
      'HTTP Response',
      'Protocol Encapsulation',
      'Complete Web Request'
    ];
    expect(numberedLabs.map((l) => l.title.replace(/^Lab \d{2} — /, ''))).toEqual(topics);
  });

  it('every numbered lab reuses an existing topology — none defines a new one', () => {
    const knownTopologyIds = new Set<string>();
    for (const lab of labs) {
      knownTopologyIds.add(lab.topology.id);
    }
    // Every numbered lab's topology is shared with some pre-existing lab
    // (or another numbered lab) — no lab ships a private network.
    for (const lab of numberedLabs) {
      expect(knownTopologyIds.has(lab.topology.id), `${lab.id} topology ${lab.topology.id}`).toBe(true);
    }
    // And specifically: the numbered catalog introduces no topology that
    // only it uses.
    const usage = new Map<string, number>();
    for (const lab of labs) usage.set(lab.topology.id, (usage.get(lab.topology.id) ?? 0) + 1);
    for (const lab of numberedLabs) {
      expect(usage.get(lab.topology.id) ?? 0).toBeGreaterThan(1);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Every lab: initialize → execute → reset → complete                  */
/* ------------------------------------------------------------------ */

describe('Laboratory framework lifecycle (all labs)', () => {
  it.each(labs.map((l) => [l.id, l] as const))('%s initializes (valid topology, intro events)', (_id, lab) => {
    expect(validateTopology(lab.topology), `topology of ${lab.id}`).toEqual([]);
    // A virgin engine is empty; the first engine.step seeds and emits the
    // canonical topology intro (NODE_CREATED/LINK_CREATED) exactly like run().
    const engine = new NetworkEngine(lab.topology);
    const first = engine.step(labSeed(engine, lab));
    expect(first.events.filter((e) => e.type === 'NODE_CREATED'), `nodes of ${lab.id}`).toHaveLength(lab.topology.nodes.length);
    expect(first.events.filter((e) => e.type === 'LINK_CREATED'), `links of ${lab.id}`).toHaveLength(lab.topology.links.length);
  });

  it.each(labs.map((l) => [l.id, l] as const))('%s executes (script produces engine activity)', (_id, lab) => {
    const state = runToState(lab);
    const scheduled = countEvents(state, (e) => e.type !== 'NODE_CREATED' && e.type !== 'LINK_CREATED');
    // Legacy 'tcp' ships only a narration note — its scheduled activity is
    // the NOTE itself. Every other lab moves at least one packet.
    if (lab.id === 'tcp') {
      expect(scheduled).toBeGreaterThan(0);
      return;
    }
    expect(scheduled, `scheduled activity in ${lab.id}`).toBeGreaterThan(0);
    expect(state.simMs, `sim time of ${lab.id}`).toBeGreaterThan(0);
    expect(state.packets.length, `packets of ${lab.id}`).toBeGreaterThan(0);
  });

  it.each(labs.map((l) => [l.id, l] as const))('%s resets (fresh engine replays a byte-identical log)', (_id, lab) => {
    const first = runToState(lab);
    const second = runToState(lab);
    expect(JSON.stringify(second.events)).toBe(JSON.stringify(first.events));
    expect(second.simMs).toBe(first.simMs);
    expect(second.packets.map((p) => p.id)).toEqual(first.packets.map((p) => p.id));
  });

  it.each(labs.map((l) => [l.id, l] as const))('%s reaches its completion criteria', (_id, lab) => {
    const state = runToState(lab);
    expect(labCompletion(lab).check(state), `completion of ${lab.id}`).toBe(true);
    expect(labCompletion(lab).description.length).toBeGreaterThan(0);
  });

  it('a lab does NOT complete on an untouched engine (fresh state)', () => {
    for (const lab of labs) {
      const engine = new NetworkEngine(lab.topology);
      const fresh = engine.getState();
      expect(labCompletion(lab).check(fresh), `fresh state of ${lab.id} must not satisfy completion`).toBe(false);
    }
  });

  it('step mode converges to the same completed state as a full run', () => {
    const lab = mustLab('lab-18-complete-web-request');
    const stepped = new NetworkEngine(lab.topology);
    for (let i = 0; i < 200; i++) stepped.step(labSeed(stepped, lab));
    const full = new NetworkEngine(lab.topology);
    runLab(full, lab);
    const steppedPairs = stepped.getState().events.map((e) => `${e.ts}|${e.type}`);
    const fullPairs = full.getState().events.map((e) => `${e.ts}|${e.type}`);
    expect(steppedPairs).toEqual(fullPairs);
    expect(labCompletion(lab).check(stepped.getState())).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Framework metadata contract                                         */
/* ------------------------------------------------------------------ */

describe('Framework metadata (numbered labs)', () => {
  it.each(numberedLabs.map((l) => [l.id, l] as const))('%s carries full framework data', (_id, lab) => {
    expect(lab.objectives?.length, `objectives of ${lab.id}`).toBeGreaterThan(0);
    expect(lab.expectedObservations?.length, `observations of ${lab.id}`).toBeGreaterThan(0);
    expect(lab.hints?.length, `hints of ${lab.id}`).toBeGreaterThan(0);
    expect(lab.explanation?.length, `explanation of ${lab.id}`).toBeGreaterThan(0);
    expect(lab.completion, `completion of ${lab.id}`).toBeDefined();
    expect(lab.controls?.length, `controls of ${lab.id}`).toBeGreaterThan(0);
    expect(lab.task.length).toBeGreaterThan(0);
    expect(lab.steps.length).toBeGreaterThan(0);
  });

  it('numbered labs 02–18 declare prerequisites; every id refers to an earlier lab', () => {
    const idsInOrder = numberedLabs.map((l) => l.id);
    for (const [index, lab] of numberedLabs.entries()) {
      if (lab.prerequisites === undefined) continue;
      for (const prereq of lab.prerequisites) {
        const match = /^Lab (\d{2})/.exec(prereq);
        if (match === null) continue; // topic-level prerequisite
        const number = Number(match[1]);
        expect(number, `${lab.id} prerequisite "${prereq}"`).toBeLessThan(index + 1);
        expect(number).toBeGreaterThanOrEqual(1);
        expect(idsInOrder[number - 1]).toBeDefined();
      }
    }
    expect(numberedLabs[1]?.prerequisites?.length ?? 0).toBeGreaterThan(0);
    expect(numberedLabs[17]?.prerequisites?.length ?? 0).toBeGreaterThan(0);
  });

  it('fallbacks: legacy labs derive framework sections from existing data', () => {
    const legacy = mustLab('arp');
    expect(labObjectives(legacy)).toEqual([legacy.objective]);
    expect(labPrerequisites(legacy)).toEqual([]);
    expect(labExpectedObservations(legacy)).toEqual(legacy.steps.map((s) => s.title));
    expect(labHints(legacy)).toEqual([]);
    expect(labExplanation(legacy)).toEqual([legacy.objective]);
    expect(labControls(legacy).some((c) => c.includes('Reset'))).toBe(true);
    expect(labNumberBadge(legacy)).toBeUndefined();
    expect(labNumberBadge(mustLab('lab-07-routing-table-lookup'))).toBe('Lab 07');
  });
});

/* ------------------------------------------------------------------ */
/* Framework pure helpers                                              */
/* ------------------------------------------------------------------ */

describe('framework.ts pure helpers', () => {
  it('countEvents/eventSeen/allOf/completedWhen compose over real state', () => {
    const lab = mustLab('lab-12-tcp-three-way-handshake');
    const state = runToState(lab);
    expect(eventSeen(state, 'TCP_STATE_CHANGE')).toBe(true);
    expect(eventSeen(state, 'HTTP_RESPONSE')).toBe(false);
    expect(countEvents(state, (e) => e.type === 'TCP_STATE_CHANGE')).toBeGreaterThan(0);
    const composed = completedWhen('both established', allOf(
      (s) => s.tcpConnections.some((c) => c.client.state === 'ESTABLISHED'),
      (s) => s.tcpConnections.some((c) => c.server.state === 'ESTABLISHED')
    ));
    expect(composed.check(state)).toBe(true);
    expect(composed.description).toBe('both established');
  });

  it('allOf requires every clause', () => {
    const lab = mustLab('lab-10-dns-resolution');
    const state = runToState(lab);
    const one = allOf((s) => eventSeen(s, 'DNS_RESPONSE'));
    const both = allOf((s) => eventSeen(s, 'DNS_RESPONSE'), (s) => eventSeen(s, 'HTTP_RESPONSE'));
    expect(one(state)).toBe(true);
    expect(both(state)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Client-side progress store                                          */
/* ------------------------------------------------------------------ */

describe('Lab progress store (client-side)', () => {
  beforeEach(() => {
    useLabProgress.setState({ completed: new Set(), visited: new Set() });
  });

  afterEach(() => {
    cleanup();
    useLabProgress.getState().clearAll();
  });

  it('records completion only when the engine state satisfies the predicate', () => {
    const lab = mustLab('lab-12-tcp-three-way-handshake');
    const store = useLabProgress.getState();
    store.recordCompletion(lab, { tcpConnections: [], events: [], packets: [], arpCaches: {}, macTables: {}, dnsCaches: {}, routingTables: {}, simMs: 0, topology: lab.topology });
    expect(useLabProgress.getState().completed.has(lab.id)).toBe(false);
    store.recordCompletion(lab, runToState(lab));
    expect(useLabProgress.getState().completed.has(lab.id)).toBe(true);
  });

  it('is idempotent and clearable', () => {
    const lab = mustLab('lab-01-ethernet-frames');
    const store = useLabProgress.getState();
    store.recordCompletion(lab, runToState(lab));
    store.recordCompletion(lab, runToState(lab));
    expect(useLabProgress.getState().completed.size).toBe(1);
    useLabProgress.getState().clearAll();
    expect(useLabProgress.getState().completed.size).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* UI: LabProgress panel + LabDetail framework sections                */
/* ------------------------------------------------------------------ */

describe('LabProgress panel', () => {
  beforeEach(() => {
    cleanup();
    const lab = mustLab('open-web-page');
    useApp.setState({ lab, state: null, selectedPacketId: null, cursorMs: 0 });
  });

  afterEach(() => {
    cleanup();
    useLabProgress.getState().clearAll();
  });

  it('lists every lab with progress count and badges', () => {
    useLabProgress.setState({ completed: new Set(['lab-01-ethernet-frames']) });
    render(<LabProgress />);
    expect(screen.getByLabelText('Lab progress')).not.toBeNull();
    expect(screen.getByLabelText('Completed labs count').textContent).toBe('1/45');
    expect(screen.getAllByRole('button', { name: /Ethernet Frames/ }).length).toBeGreaterThan(0);
  });

  it('marks completed labs and can clear progress', () => {
    const lab = mustLab('lab-01-ethernet-frames');
    useLabProgress.getState().recordCompletion(lab, runToState(lab));
    const first = render(<LabProgress />);
    expect(screen.getByRole('button', { name: /Lab 01/ }).textContent).toContain('✓');
    first.unmount();
    useLabProgress.setState({ completed: new Set() });
    render(<LabProgress />);
    expect(screen.getByRole('button', { name: /Lab 01/ }).textContent).toContain('○');
  });
});

describe('LabDetail framework sections', () => {
  beforeEach(() => {
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows objectives, prerequisites, controls, observations and task for a numbered lab', () => {
    const lab = mustLab('lab-08-longest-prefix-match');
    useApp.setState({ lab, state: null });
    render(<LabDetail />);
    expect(screen.getByRole('heading', { name: /Lab 08 — Longest Prefix Matching/ })).not.toBeNull();
    expect(screen.getByText('Learning objectives')).not.toBeNull();
    expect(screen.getByText('Prerequisites')).not.toBeNull();
    expect(screen.getByText('Simulation controls')).not.toBeNull();
    expect(screen.getByText('Expected observations')).not.toBeNull();
    expect(screen.getByText('Completion criteria')).not.toBeNull();
    expect(screen.getByText('Your task')).not.toBeNull();
    // Hints and explanation start collapsed.
    expect(screen.getByRole('button', { name: 'Show hints' })).not.toBeNull();
    expect(screen.queryByText(lab.hints?.[0] ?? '')).toBeNull();
  });

  it('toggles hints and explanation open', () => {
    const lab = mustLab('lab-17-protocol-encapsulation');
    useApp.setState({ lab, state: null });
    render(<LabDetail />);
    fireEvent.click(screen.getByRole('button', { name: 'Show hints' }));
    expect(screen.getByText(lab.hints?.[0] ?? '')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show explanation' }));
    expect(screen.getByText(lab.explanation ?? '')).not.toBeNull();
  });

  it('shows the completion banner once the state satisfies the criteria', () => {
    const lab = mustLab('lab-12-tcp-three-way-handshake');
    useApp.setState({ lab, state: runToState(lab) });
    render(<LabDetail />);
    expect(screen.getByLabelText('Lab completion status').textContent).toContain('✓ Complete');
  });

  it('keeps the legacy welcome screen when no lab is loaded', () => {
    useApp.setState({ lab: null, state: null });
    render(<LabDetail />);
    expect(screen.getByText(/Welcome to Network Protocol Visual Lab/)).not.toBeNull();
  });
});
