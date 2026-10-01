import { describe, it, expect, beforeEach } from 'vitest';
import { TopologyEngine, TopologyError } from '../src/engine/topology-engine';
import { validateTopology } from '../src/models/topology';
import { buildFrame, buildIpPacket } from '../src/simulation/builder';
import type { Topology } from '../src/models/topology';
import { mac } from '../src/models/mac';

/** The required example chain: PC1 — Switch1 — Router1 — Switch2 — Server. */
export function buildChainTopology(): Topology {
  const engine = new TopologyEngine();
  const pc1 = engine.addHost('PC1', { ip: '192.168.1.10', prefix: 24, gateway: '192.168.1.1' });
  const switch1 = engine.addSwitch('Switch1');
  const router1 = engine.addRouter('Router1');
  const switch2 = engine.addSwitch('Switch2');
  const server = engine.addServer('WebServer', { ip: '10.20.0.80', prefix: 16, gateway: '10.20.0.1' });

  engine.assignIp(router1.interfaces[0]!.id, '192.168.1.1', 24);
  engine.assignIp(router1.interfaces[1]!.id, '10.20.0.1', 16);

  engine.connect(pc1.interfaces[0]!.id, switch1.interfaces[0]!.id);
  engine.connect(switch1.interfaces[1]!.id, router1.interfaces[0]!.id);
  engine.connect(router1.interfaces[1]!.id, switch2.interfaces[0]!.id);
  engine.connect(switch2.interfaces[1]!.id, server.interfaces[0]!.id);

  engine.addSubnet('lan', 'LAN', '192.168.1.0', 24, '#7ee787');
  engine.addSubnet('wan', 'Server net', '10.20.0.0', 16, '#79c0ff');

  return engine.snapshot();
}

describe('Node creation', () => {
  let engine: TopologyEngine;
  beforeEach(() => {
    engine = new TopologyEngine();
  });

  it('creates hosts, switches, routers and servers with deterministic ids', () => {
    const pc1 = engine.addHost('PC1');
    const pc2 = engine.addHost('PC2');
    const sw1 = engine.addSwitch('Switch1');
    const sw2 = engine.addSwitch('Switch2');
    const r1 = engine.addRouter('Router1');
    const web = engine.addServer('Web', { service: 'web' });

    expect(pc1.id).toBe('host-1');
    expect(pc2.id).toBe('host-2');
    expect(sw1.id).toBe('switch-1');
    expect(sw2.id).toBe('switch-2');
    expect(r1.id).toBe('router-1');
    expect(web.id).toBe('server-1');
    expect(web.service).toBe('web');
  });

  it('numbers ids per kind regardless of interleaved device types', () => {
    engine.addHost();
    engine.addSwitch();
    expect(engine.addHost().id).toBe('host-2');
    expect(engine.addRouter().id).toBe('router-1');
    expect(engine.addSwitch().id).toBe('switch-2');
  });

  it('auto-assigns unique, valid MAC addresses to every interface', () => {
    const a = engine.addHost('A');
    const b = engine.addHost('B');
    const r = engine.addRouter('R');
    const macs = [
      a.interfaces[0]!.mac,
      b.interfaces[0]!.mac,
      r.interfaces[0]!.mac,
      r.interfaces[1]!.mac
    ];
    expect(new Set(macs).size).toBe(macs.length);
    for (const value of macs) {
      expect(value).toMatch(/^02:00:00:[0-9a-f]{2}:[0-9a-f]{2}:01$/);
    }
  });

  it('names devices deterministically when no name is given', () => {
    expect(engine.addHost().name).toBe('PC1');
    expect(engine.addHost().name).toBe('PC2');
    expect(engine.addSwitch().name).toBe('Switch1');
    expect(engine.addRouter().name).toBe('Router1');
  });
});

describe('Link creation and deletion', () => {
  let engine: TopologyEngine;
  beforeEach(() => {
    engine = new TopologyEngine();
  });

  it('connects two devices through their interfaces', () => {
    const pc = engine.addHost('PC');
    const sw = engine.addSwitch('SW');
    const link = engine.connect(pc.interfaces[0]!.id, sw.interfaces[0]!.id);
    expect(engine.allLinks()).toHaveLength(1);
    expect(link.endpoints).toEqual([pc.interfaces[0]!.id, sw.interfaces[0]!.id]);
  });

  it('rejects duplicate links between the same pair (either direction)', () => {
    const pc = engine.addHost('PC');
    const sw = engine.addSwitch('SW');
    engine.connect(pc.interfaces[0]!.id, sw.interfaces[0]!.id);
    expect(() => engine.connect(pc.interfaces[0]!.id, sw.interfaces[0]!.id)).toThrow(TopologyError);
    expect(() => engine.connect(sw.interfaces[0]!.id, pc.interfaces[0]!.id)).toThrow(TopologyError);
  });

  it('rejects self-loops and same-node links', () => {
    const pc = engine.addHost('PC');
    const sw = engine.addSwitch('SW');
    const first = engine.node(pc.id)!.interfaces[0]!.id;
    expect(() => engine.connect(first, first)).toThrow(TopologyError);
    expect(() => engine.connect(first, first)).toThrow(/same interface/);
    engine.addInterface(pc.id);
    const second = engine.node(pc.id)!.interfaces[1]!.id;
    expect(() => engine.connect(first, second)).toThrow(/same node/);
    void sw;
  });

  it('deletes links by id', () => {
    const pc = engine.addHost('PC');
    const sw = engine.addSwitch('SW');
    const link = engine.connect(pc.interfaces[0]!.id, sw.interfaces[0]!.id);
    const removed = engine.disconnect(link.id);
    expect(removed.id).toBe(link.id);
    expect(engine.allLinks()).toHaveLength(0);
    expect(() => engine.disconnect(link.id)).toThrow(TopologyError);
  });
});

describe('Node and interface deletion', () => {
  let engine: TopologyEngine;
  beforeEach(() => {
    engine = new TopologyEngine();
  });

  it('deleting a node cascades to its links', () => {
    const pc = engine.addHost('PC');
    const sw = engine.addSwitch('SW');
    engine.connect(pc.interfaces[0]!.id, sw.interfaces[0]!.id);
    const removed = engine.removeNode(pc.id);
    expect(removed).toHaveLength(1);
    expect(engine.allNodes()).toHaveLength(1);
    expect(engine.allLinks()).toHaveLength(0);
  });

  it('deleting an interface removes attached links', () => {
    const pc = engine.addHost('PC');
    const sw = engine.addSwitch('SW');
    engine.connect(pc.interfaces[0]!.id, sw.interfaces[0]!.id);
    engine.addInterface(sw.id);
    const secondLink = engine.connect(pc.interfaces[0]!.id, sw.interfaces[1]!.id);
    const removed = engine.removeInterface(sw.interfaces[1]!.id);
    expect(removed.map((l) => l.id)).toContain(secondLink.id);
    expect(engine.allLinks()).toHaveLength(1);
  });

  it('rejects operations on unknown nodes/interfaces', () => {
    expect(() => engine.removeNode('nope')).toThrow(TopologyError);
    expect(() => engine.removeInterface('nope')).toThrow(TopologyError);
    expect(() => engine.setDeviceState('nope', true)).toThrow(TopologyError);
  });
});

describe('Interface assignment and MAC management', () => {
  it('adds ports with unique labels and MACs', () => {
    const engine = new TopologyEngine();
    const sw = engine.addSwitch('SW');
    engine.addInterface(sw.id);
    engine.addInterface(sw.id, 'uplink');
    const node = engine.node(sw.id)!;
    expect(node.interfaces).toHaveLength(4);
    const macs = node.interfaces.map((i) => i.mac);
    expect(new Set(macs).size).toBe(macs.length);
    expect(node.interfaces.map((i) => i.label)).toContain('uplink');
  });

  it('assigns and clears IPv4 addresses with prefix', () => {
    const engine = new TopologyEngine();
    const pc = engine.addHost('PC');
    const ifaceId = pc.interfaces[0]!.id;
    engine.assignIp(ifaceId, '192.168.1.10', 24);
    expect(engine.findIface(ifaceId)!.ip).toBe('192.168.1.10');
    expect(engine.findIface(ifaceId)!.prefix).toBe(24);
    engine.clearIp(ifaceId);
    expect(engine.findIface(ifaceId)!.ip).toBeUndefined();
    expect(engine.findIface(ifaceId)!.prefix).toBeUndefined();
  });

  it('rejects invalid IPv4 addresses and prefixes deterministically', () => {
    const engine = new TopologyEngine();
    const pc = engine.addHost('PC');
    const ifaceId = pc.interfaces[0]!.id;
    expect(() => engine.assignIp(ifaceId, '999.1.1.1', 24)).toThrow(/Invalid IPv4/);
    expect(() => engine.assignIp(ifaceId, 'abc', 24)).toThrow(/Invalid IPv4/);
    expect(() => engine.assignIp(ifaceId, '192.168.1.10', 33)).toThrow(/Invalid prefix/);
    expect(() => engine.assignIp(ifaceId, '192.168.1.10', 1.5)).toThrow(/Invalid prefix/);
  });

  it('rejects duplicate IP addresses across the whole simulated network', () => {
    const engine = new TopologyEngine();
    const pc1 = engine.addHost('PC1');
    const pc2 = engine.addHost('PC2');
    const router = engine.addRouter('R');
    engine.assignIp(pc1.interfaces[0]!.id, '10.0.0.5', 24);
    expect(() => engine.assignIp(pc2.interfaces[0]!.id, '10.0.0.5', 24)).toThrow(/already assigned/);
    // Re-assigning the same address to the same interface is allowed.
    expect(() => engine.assignIp(pc1.interfaces[0]!.id, '10.0.0.5', 24)).not.toThrow();
    void router;
  });
});

describe('Subnet configuration', () => {
  it('adds subnets and reports membership', async () => {
    const engine = new TopologyEngine();
    engine.addSubnet('lan', 'LAN', '192.168.1.0', 24, '#7ee787');
    const subnets = engine.allSubnets();
    expect(subnets).toHaveLength(1);
    expect(subnets[0]!.network).toBe('192.168.1.0');

    const { subnetContains } = await import('../src/models/subnet');
    expect(subnetContains(subnets[0]!, '192.168.1.55' as never)).toBe(true);
    expect(subnetContains(subnets[0]!, '192.168.2.55' as never)).toBe(false);
  });

  it('rejects invalid network addresses and prefixes', () => {
    const engine = new TopologyEngine();
    expect(() => engine.addSubnet('s', 'Bad', '192.168.1.999', 24, '#fff')).toThrow(/Invalid network/);
    expect(() => engine.addSubnet('s', 'Bad', '192.168.1.0', 40, '#fff')).toThrow(/Invalid prefix/);
  });

  it('rejects duplicate subnet ids', () => {
    const engine = new TopologyEngine();
    engine.addSubnet('lan', 'LAN', '192.168.1.0', 24, '#7ee787');
    expect(() => engine.addSubnet('lan', 'LAN2', '10.0.0.0', 8, '#fff')).toThrow(/already exists/);
  });
});

describe('Default gateway', () => {
  it('sets and clears gateways on hosts and servers', () => {
    const engine = new TopologyEngine();
    const pc = engine.addHost('PC');
    engine.setGateway(pc.id, '192.168.1.1');
    expect((engine.node(pc.id) as { gateway?: string }).gateway).toBe('192.168.1.1');
    engine.setGateway(pc.id, null);
    expect((engine.node(pc.id) as { gateway?: string }).gateway).toBeUndefined();
  });

  it('rejects gateways on switches and routers', () => {
    const engine = new TopologyEngine();
    const sw = engine.addSwitch('SW');
    const r = engine.addRouter('R');
    expect(() => engine.setGateway(sw.id, '10.0.0.1')).toThrow(/hosts and servers/);
    expect(() => engine.setGateway(r.id, '10.0.0.1')).toThrow(/hosts and servers/);
  });

  it('rejects malformed gateway addresses', () => {
    const engine = new TopologyEngine();
    const pc = engine.addHost('PC');
    expect(() => engine.setGateway(pc.id, 'not-an-ip')).toThrow(/Invalid gateway/);
  });
});

describe('Device state', () => {
  it('toggles device enabled state', () => {
    const engine = new TopologyEngine();
    const pc = engine.addHost('PC');
    expect(engine.node(pc.id)!.enabled).toBe(true);
    expect(engine.toggleDevice(pc.id)).toBe(false);
    expect(engine.node(pc.id)!.enabled).toBe(false);
    engine.setDeviceState(pc.id, true);
    expect(engine.node(pc.id)!.enabled).toBe(true);
  });

  it('link state can be toggled independently', () => {
    const engine = new TopologyEngine();
    const pc = engine.addHost('PC');
    const sw = engine.addSwitch('SW');
    const link = engine.connect(pc.interfaces[0]!.id, sw.interfaces[0]!.id);
    engine.setLinkState(link.id, false);
    expect(engine.allLinks()[0]!.enabled).toBe(false);
  });
});

describe('Deterministic validation rules (validateTopology)', () => {
  it('accepts the canonical PC1–Switch1–Router1–Switch2–Server chain', () => {
    const topology = buildChainTopology();
    expect(topology.nodes.map((n) => n.name)).toEqual(['PC1', 'Switch1', 'Router1', 'Switch2', 'WebServer']);
    const codes = validateTopology(topology).map((e) => e.code);
    expect(codes).toEqual([]);
  });

  it('rejects duplicate MAC addresses', () => {
    const engine = new TopologyEngine();
    const pc1 = engine.addHost('A');
    const pc2 = engine.addHost('B');
    const dup: Topology = {
      ...engine.snapshot(),
      nodes: engine.allNodes().map((n) =>
        n.id === pc2.id
          ? { ...n, interfaces: [{ ...pc2.interfaces[0]!, mac: pc1.interfaces[0]!.mac }] }
          : n
      )
    };
    const codes = validateTopology(dup).map((e) => e.code);
    expect(codes).toContain('duplicate-mac');
  });

  it('rejects invalid IPv4 addresses on interfaces', () => {
    const engine = new TopologyEngine();
    const pc = engine.addHost('A');
    const bad: Topology = {
      ...engine.snapshot(),
      nodes: engine.allNodes().map((n) =>
        n.id === pc.id
          ? { ...n, interfaces: [{ ...pc.interfaces[0]!, ip: '300.1.1.1' as never, prefix: 24 }] }
          : n
      )
    };
    const codes = validateTopology(bad).map((e) => e.code);
    expect(codes).toContain('bad-prefix');
  });

  it('rejects duplicate IP addresses within the simulated network', () => {
    const engine = new TopologyEngine();
    const a = engine.addHost('A', { ip: '10.0.0.1', prefix: 24 });
    const b = engine.addHost('B', { ip: '10.0.0.1', prefix: 24 });
    void a;
    void b;
    // Engine-level guard rejects at assignment time...
    const engine2 = new TopologyEngine();
    const h1 = engine2.addHost('A');
    const h2 = engine2.addHost('B');
    engine2.assignIp(h1.interfaces[0]!.id, '10.0.0.1', 24);
    expect(() => engine2.assignIp(h2.interfaces[0]!.id, '10.0.0.1', 24)).toThrow(TopologyError);
    // ...and the structural validator would catch a hand-built topology too.
    const dup: Topology = {
      ...engine.snapshot(),
      nodes: [
        {
          id: 'h1',
          kind: 'host',
          name: 'H1',
          enabled: true,
          interfaces: [{ id: 'i1', nodeId: 'h1', mac: mac('02:00:00:00:00:01'), ip: '10.0.0.1' as never, prefix: 24, enabled: true, label: 'eth0' }]
        },
        {
          id: 'h2',
          kind: 'host',
          name: 'H2',
          enabled: true,
          interfaces: [{ id: 'i2', nodeId: 'h2', mac: mac('02:00:00:00:00:02'), ip: '10.0.0.1' as never, prefix: 24, enabled: true, label: 'eth0' }]
        }
      ],
      links: [],
      layout: { nodes: {}, links: {} }
    };
    expect(validateTopology(dup).map((e) => e.code)).toContain('duplicate-ip');
  });

  it('rejects links connecting unknown interfaces', () => {
    const engine = new TopologyEngine();
    engine.addHost('A');
    const bad: Topology = {
      ...engine.snapshot(),
      links: [{ id: 'l1', endpoints: ['ghost-a', 'ghost-b'], latencyMs: 4, enabled: true }]
    };
    const codes = validateTopology(bad).map((e) => e.code);
    expect(codes).toContain('bad-endpoint');
  });

  it('rejects invalid subnets (non-base network address, bad prefix)', () => {
    const engine = new TopologyEngine();
    engine.addHost('A');
    const invalidNetwork: Topology = {
      ...engine.snapshot(),
      subnets: [{ id: 's1', name: 'S', network: '192.168.1.55' as never, prefix: 24, color: '#fff' }]
    };
    expect(validateTopology(invalidNetwork).map((e) => e.code)).toContain('bad-subnet');

    const invalidPrefix: Topology = {
      ...engine.snapshot(),
      subnets: [{ id: 's2', name: 'S', network: '192.168.1.0' as never, prefix: 55, color: '#fff' }]
    };
    expect(validateTopology(invalidPrefix).map((e) => e.code)).toContain('bad-subnet');
  });

  it('rejects router interfaces outside any configured network', () => {
    const engine = new TopologyEngine();
    const r = engine.addRouter('R');
    engine.assignIp(r.interfaces[0]!.id, '172.30.9.1', 24);
    const topology: Topology = {
      ...engine.snapshot(),
      subnets: [{ id: 'lan', name: 'LAN', network: '192.168.1.0' as never, prefix: 24, color: '#fff' }]
    };
    const codes = validateTopology(topology).map((e) => e.code);
    expect(codes).toContain('ip-outside-subnet');
  });

  it('rejects unreachable gateways (not a router interface on the same subnet)', () => {
    const engine = new TopologyEngine();
    const pc = engine.addHost('PC', { ip: '192.168.1.10', prefix: 24 });
    const bad: Topology = {
      ...engine.snapshot(),
      nodes: engine.allNodes().map((n) => (n.id === pc.id ? { ...n, gateway: '10.99.99.99' as never } : n)),
      subnets: [{ id: 'lan', name: 'LAN', network: '192.168.1.0' as never, prefix: 24, color: '#fff' }]
    };
    const codes = validateTopology(bad).map((e) => e.code);
    expect(codes).toContain('gateway-not-reachable');
  });

  it('accepts gateways that are router interfaces on the same subnet', () => {
    const topology = buildChainTopology();
    const codes = validateTopology(topology).map((e) => e.code);
    expect(codes).not.toContain('gateway-not-reachable');
  });
});

describe('Engine round-trip and determinism', () => {
  it('snapshot → load → snapshot is identical', () => {
    const first = buildChainTopology();
    const second = new TopologyEngine(first).snapshot();
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('two engines built by the same operation sequence are identical', () => {
    expect(JSON.stringify(buildChainTopology())).toBe(JSON.stringify(buildChainTopology()));
  });

  it('simulation still runs on an edited topology (integration)', async () => {
    const { NetworkEngine } = await import('../src/engine/network-engine');
    const topology = buildChainTopology();
    const engine = new NetworkEngine(topology);
    // A minimal ICMP ping from PC1 to the server, scheduled by hand —
    // the same path any lab script takes through the one engine.
    const state = engine.run((ctx) => {
      const pc1 = topology.nodes.find((n) => n.name === 'PC1')!;
      const iface = pc1.interfaces[0]!;
      ctx.after(0, (c) => {
        const ip = buildIpPacket({
          source: iface.ip!,
          destination: '10.20.0.80' as never,
          ttl: 64,
          protocol: 'icmp',
          payload: { kind: 'icmp', type: 'echo-request' }
        });
        c.transmit(
          buildFrame({
            source: iface.mac,
            destination: 'ff:ff:ff:ff:ff:ff' as never,
            etherType: 0x0800,
            payload: { kind: 'ip', ip }
          }),
          pc1.id,
          iface.id
        );
      });
    });
    expect(state.events.some((e) => e.type === 'PACKET_SENT')).toBe(true);
  });
});
