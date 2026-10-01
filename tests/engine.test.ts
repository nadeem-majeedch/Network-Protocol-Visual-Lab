import { describe, it, expect } from 'vitest';
import { NetworkEngine } from '../src/engine/network-engine';
import { arpTopology } from '../src/labs/topologies';
import { validateTopology } from '../src/models/topology';
import { buildFrame, buildArpRequest, resetBuilders } from '../src/simulation/builder';
import { mac } from '../src/models/mac';
import { ipv4 } from '../src/models/ipv4';

function arpRequestScript(engine: NetworkEngine) {
  return (ctx: Parameters<Parameters<NetworkEngine['run']>[0]>[0]) => {
    const host1 = engine.topologyRef.nodes.find((n) => n.id === 'host-1')!;
    const iface = host1.interfaces[0]!;
    ctx.after(0, (c) => {
      c.emit({ type: 'NOTE', ts: c.now(), nodeId: 'host-1', message: 'ARP cache miss — sending request for 10.0.0.12' });
      c.transmit(
        buildFrame({
          source: iface.mac,
          destination: mac('ff:ff:ff:ff:ff:ff'),
          etherType: 0x0806,
          payload: { kind: 'arp', arp: buildArpRequest(ipv4('10.0.0.12'), iface.ip!, iface.mac) }
        }),
        'host-1',
        iface.id
      );
    });
  };
}

describe('NetworkEngine', () => {
  it('validates the lab topology as structurally sound', () => {
    expect(validateTopology(arpTopology)).toEqual([]);
  });

  it('produces an ARP reply and learns the sender MAC', () => {
    resetBuilders();
    const engine = new NetworkEngine(arpTopology);
    const state = engine.run(arpRequestScript(engine));

    const types = state.events.map((e) => e.type);
    expect(types).toContain('NOTE');
    expect(types).toContain('PACKET_CREATED');
    expect(types).toContain('PACKET_SENT');
    expect(types).toContain('PACKET_RECEIVED');

    // The target learned the requester's binding.
    const host2Cache = state.arpCaches['host-2'];
    expect(host2Cache?.['10.0.0.11']).toBe('02:00:00:00:01:01');

    // A reply frame exists and is unicast back, with canonical events.
    const replies = state.packets.filter((p) => p.frame.payload.kind === 'arp' && p.frame.payload.arp.operation === 'reply');
    expect(replies.length).toBe(1);
    expect(replies[0]!.frame.destination).toBe('02:00:00:00:01:01');
  });

  it('is deterministic across identical runs', () => {
    resetBuilders();
    const a = new NetworkEngine(arpTopology).run(arpRequestScript(new NetworkEngine(arpTopology)));
    resetBuilders();
    const b = new NetworkEngine(arpTopology).run(arpRequestScript(new NetworkEngine(arpTopology)));
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(JSON.stringify(a.packets.map((p) => p.frame))).toBe(JSON.stringify(b.packets.map((p) => p.frame)));
  });

  it('serializes state to plain JSON and back', () => {
    resetBuilders();
    const engine = new NetworkEngine(arpTopology);
    const state = engine.run(arpRequestScript(engine));
    const roundTrip = JSON.parse(JSON.stringify(state)) as typeof state;
    expect(roundTrip).toEqual(state);
  });

  it('resets cleanly between runs', () => {
    resetBuilders();
    const engine = new NetworkEngine(arpTopology);
    const first = engine.run(arpRequestScript(engine));
    const second = engine.run(arpRequestScript(engine));
    expect(second.packets.length).toBe(first.packets.length);
    expect(second.events.length).toBe(first.events.length);
    expect(second.simMs).toBe(first.simMs);
  });
});
