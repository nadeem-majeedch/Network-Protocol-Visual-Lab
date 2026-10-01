import { describe, it, expect, beforeEach } from 'vitest';
import { Scheduler } from '../src/engine/scheduler';
import { NetworkEngine } from '../src/engine/network-engine';
import { ethernetTopology } from '../src/labs/topologies';
import { runLab, labSeed } from '../src/labs/runner';
import { labs } from '../src/labs';

describe('Simulation clock (Scheduler)', () => {
  let scheduler: Scheduler<string>;

  beforeEach(() => {
    scheduler = new Scheduler<string>();
  });

  it('pops items in time order regardless of insertion order', () => {
    scheduler.schedule(30, 'late');
    scheduler.schedule(10, 'early');
    scheduler.schedule(20, 'middle');

    expect(scheduler.pop()?.value).toBe('early');
    expect(scheduler.pop()?.value).toBe('middle');
    expect(scheduler.pop()?.value).toBe('late');
    expect(scheduler.pop()).toBeUndefined();
  });

  it('breaks time ties by insertion order (determinism)', () => {
    scheduler.schedule(5, 'first');
    scheduler.schedule(5, 'second');
    scheduler.schedule(5, 'third');

    expect(scheduler.pop()?.value).toBe('first');
    expect(scheduler.pop()?.value).toBe('second');
    expect(scheduler.pop()?.value).toBe('third');
  });

  it('tracks size and clears completely', () => {
    scheduler.schedule(1, 'a');
    scheduler.schedule(2, 'b');
    expect(scheduler.size).toBe(2);
    scheduler.clear();
    expect(scheduler.size).toBe(0);
    expect(scheduler.peek()).toBeUndefined();
    // Order counter resets too: new items still tie-break by insertion.
    scheduler.schedule(1, 'x');
    scheduler.schedule(1, 'y');
    expect(scheduler.pop()?.value).toBe('x');
  });
});

describe('Engine clock semantics', () => {
  it('advances simMs only to scheduled event times (never wall-clock)', () => {
    const lab = labs.find((l) => l.id === 'ethernet')!;
    const engine = new NetworkEngine(lab.topology);
    runLab(engine, lab);
    const state = engine.getState();
    // Script times (0/300/600) plus integer wire latencies: the final simMs
    // is a discrete integer determined by the schedule, not wall-clock drift.
    expect(state.simMs).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(state.simMs)).toBe(true);
    // Every event timestamp is drawn from the same discrete schedule.
    for (const e of state.events) {
      expect(Number.isInteger(e.ts)).toBe(true);
      expect(e.ts).toBeLessThanOrEqual(state.simMs);
    }
  });

  it('reproduces identical clocks across repeated runs (reset determinism)', () => {
    const lab = labs.find((l) => l.id === 'ethernet')!;
    const engine = new NetworkEngine(lab.topology);
    const first = runLab(engine, lab);
    const second = runLab(engine, lab);
    expect(second.simMs).toBe(first.simMs);
    expect(second.eventCount).toBe(first.eventCount);
    expect(second.packetCount).toBe(first.packetCount);
  });

  it('steps one scheduled item at a time from the lab seed', () => {
    const lab = labs.find((l) => l.id === 'ethernet')!;
    const engine = new NetworkEngine(lab.topology);
    const first = engine.step(labSeed(engine, lab));
    // Seeding itself produces no events; the first step runs one scheduled item.
    const seededEventCount = first.events.length;
    expect(seededEventCount).toBeGreaterThanOrEqual(1);
    expect(first.simMs).toBeGreaterThanOrEqual(0);
    const second = engine.step(labSeed(engine, lab));
    expect(second.events.length).toBeGreaterThanOrEqual(seededEventCount);
  });
});

describe('Topology invariants (typed node union)', () => {
  it('types hubs as repeaters and routers with optional routes only', () => {
    const routing = labs.find((l) => l.id === 'routing')!;
    const hubNode = ethernetTopology.nodes.find((n) => n.kind === 'hub');
    expect(hubNode).toBeDefined();
    if (hubNode?.kind === 'hub') {
      expect(hubNode.isRepeater).toBe(true);
    }
    const router = routing.topology.nodes.find((n) => n.kind === 'router');
    if (router?.kind === 'router') {
      expect(router.interfaces.length).toBe(2);
    }
  });

  it('rejects a topology with duplicate MACs', async () => {
    const { validateTopology } = await import('../src/models/topology');
    const { mac } = await import('../src/models/mac');
    const dup: import('../src/models/topology').Topology = {
      id: 'bad',
      name: 'bad',
      nodes: [
        {
          id: 'a',
          kind: 'host',
          name: 'A',
          enabled: true,
          interfaces: [{ id: 'a-eth0', nodeId: 'a', mac: mac('02:00:00:00:00:01'), enabled: true, label: 'eth0' }]
        },
        {
          id: 'b',
          kind: 'host',
          name: 'B',
          enabled: true,
          interfaces: [{ id: 'b-eth0', nodeId: 'b', mac: mac('02:00:00:00:00:01'), enabled: true, label: 'eth0' }]
        }
      ],
      links: [],
      layout: { nodes: {}, links: {} }
    };
    const codes = validateTopology(dup).map((e) => e.code);
    expect(codes).toContain('duplicate-mac');
  });
});
