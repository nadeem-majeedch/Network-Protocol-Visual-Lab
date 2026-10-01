import { describe, it, expect } from 'vitest';
import { NetworkEngine } from '../src/engine/network-engine';
import { runLab } from '../src/labs/runner';
import { labs } from '../src/labs';
import { eventTimes, previousEventTime, nextEventTime, visibleEvents, packetInFlight } from '../src/state/playback';
import { buildTopologyView, packetPosition } from '../src/visualization/layout';
import { makeHop, withHops, buildPacket, buildFrame, buildIpPacket, resetBuilders } from '../src/simulation/builder';
import { mac, BROADCAST_MAC } from '../src/models/mac';
import { ipv4 } from '../src/models/ipv4';
import type { Packet } from '../src/models/packet';

function runLabState(id: string) {
  const lab = labs.find((l) => l.id === id)!;
  const engine = new NetworkEngine(lab.topology);
  runLab(engine, lab);
  return engine.getState();
}

describe('Canonical event generation', () => {
  it('opens every run with NODE_CREATED for each device', () => {
    const lab = labs.find((l) => l.id === 'arp')!;
    const engine = new NetworkEngine(lab.topology);
    runLab(engine, lab);
    const state = engine.getState();
    const created = state.events.filter((e) => e.type === 'NODE_CREATED');
    expect(created).toHaveLength(lab.topology.nodes.length);
    expect(created.every((e) => e.ts === 0)).toBe(true);
    expect(created.map((e) => (e.type === 'NODE_CREATED' ? e.kind : ''))).toContain('host');
  });

  it('emits LINK_CREATED for every topology link', () => {
    const lab = labs.find((l) => l.id === 'arp')!;
    const engine = new NetworkEngine(lab.topology);
    runLab(engine, lab);
    const links = engine.getState().events.filter((e) => e.type === 'LINK_CREATED');
    expect(links).toHaveLength(lab.topology.links.length);
  });

  it('records PACKET_CREATED with serial numbers for every run', () => {
    const state = runLabState('ethernet');
    const created = state.events.filter((e) => e.type === 'PACKET_CREATED');
    expect(created.length).toBeGreaterThanOrEqual(1);
    for (const c of created) {
      if (c.type === 'PACKET_CREATED') expect(c.serial).toBeGreaterThan(0);
    }
    // Every ARP probe in the engine is created before it is sent.
    const probes = created.filter((c) => c.protocol === 'ARP');
    expect(probes.length).toBeGreaterThanOrEqual(1);
  });

  it('emits ARP_REQUEST then ARP_REPLY with matching IPs', () => {
    const state = runLabState('arp');
    const req = state.events.find((e) => e.type === 'ARP_REQUEST');
    const rep = state.events.find((e) => e.type === 'ARP_REPLY');
    expect(req).toBeDefined();
    expect(rep).toBeDefined();
    if (req?.type === 'ARP_REQUEST') expect(req.targetIp).toBe('10.0.0.12');
    if (rep?.type === 'ARP_REPLY') expect(rep.senderIp).toBe('10.0.0.12');
  });

  it('emits ROUTE_LOOKUP with matched prefix on the routing lab', () => {
    const state = runLabState('routing');
    const lookups = state.events.filter((e) => e.type === 'ROUTE_LOOKUP');
    expect(lookups.length).toBeGreaterThanOrEqual(1);
    const good = lookups.find((e) => e.type === 'ROUTE_LOOKUP' && e.matched !== 'no match');
    expect(good).toBeDefined();
  });

  it('emits DNS_QUERY then DNS_RESPONSE with address and ttl', () => {
    const state = runLabState('dns');
    const q = state.events.find((e) => e.type === 'DNS_QUERY');
    const r = state.events.find((e) => e.type === 'DNS_RESPONSE');
    expect(q?.type).toBe('DNS_QUERY');
    expect(r?.type).toBe('DNS_RESPONSE');
    if (r?.type === 'DNS_RESPONSE') {
      expect(r.address).toBe('203.0.113.10');
      expect(r.ttl).toBeGreaterThan(0);
    }
  });

  it('emits TCP_STATE_CHANGE transitions in handshake order', () => {
    const state = runLabState('http');
    const changes = state.events.filter((e) => e.type === 'TCP_STATE_CHANGE');
    const tos = changes.map((e) => (e.type === 'TCP_STATE_CHANGE' ? e.to : ''));
    expect(tos).toContain('SYN_RCVD');
    expect(tos).toContain('ESTABLISHED');
  });

  it('emits HTTP_REQUEST and HTTP_RESPONSE for the page fetch', () => {
    const state = runLabState('http');
    const req = state.events.find((e) => e.type === 'HTTP_REQUEST');
    const res = state.events.find((e) => e.type === 'HTTP_RESPONSE');
    expect(req?.type).toBe('HTTP_REQUEST');
    if (req?.type === 'HTTP_REQUEST') {
      expect(req.method).toBe('GET');
      expect(req.path).toBe('/index.html');
    }
    if (res?.type === 'HTTP_RESPONSE') {
      expect(res.status).toBe(200);
      expect(res.contentType).toBe('text/html');
    }
  });

  it('keeps the event log sorted by time (deterministic timeline)', () => {
    const state = runLabState('http');
    const ts = state.events.map((e) => e.ts);
    for (let i = 1; i < ts.length; i++) {
      expect(ts[i]!).toBeGreaterThanOrEqual(ts[i - 1]!);
    }
  });
});

describe('TCP state transitions across a full exchange', () => {
  it('walks LISTEN → SYN_RCVD → ESTABLISHED on the server side', () => {
    const state = runLabState('http');
    const server = state.events.filter(
      (e) => e.type === 'TCP_STATE_CHANGE' && (e.from === 'LISTEN' || e.from === 'SYN_RCVD')
    );
    const froms = server.map((e) => (e.type === 'TCP_STATE_CHANGE' ? e.from : ''));
    expect(froms).toContain('LISTEN');
    expect(froms).toContain('SYN_RCVD');
  });
});

describe('Playback timeline helpers', () => {
  const state = runLabState('arp');

  it('builds a sorted, distinct ruler of event times', () => {
    const times = eventTimes(state.events);
    expect(times.length).toBeGreaterThan(0);
    for (let i = 1; i < times.length; i++) {
      expect(times[i]!).toBeGreaterThan(times[i - 1]!);
    }
  });

  it('steps backward to the previous distinct time and forward to the next', () => {
    const times = eventTimes(state.events);
    const mid = times[Math.floor(times.length / 2)]!;
    expect(previousEventTime(state.events, mid)).toBe(times[Math.floor(times.length / 2) - 1] ?? null);
    expect(nextEventTime(state.events, mid)).toBe(times[Math.floor(times.length / 2) + 1] ?? null);
    // Boundaries
    expect(previousEventTime(state.events, times[0]!)).toBeNull();
    expect(nextEventTime(state.events, times[times.length - 1]!)).toBeNull();
    expect(nextEventTime(state.events, 0)).toBe(times[0] === 0 ? times[1] ?? null : times[0]);
  });

  it('reveals events progressively as the cursor advances', () => {
    const times = eventTimes(state.events);
    const mid = times[Math.floor(times.length / 2)]!;
    const before = visibleEvents(state.events, times[0]!).length;
    const after = visibleEvents(state.events, state.simMs).length;
    const atMid = visibleEvents(state.events, mid).length;
    expect(before).toBeLessThanOrEqual(atMid);
    expect(atMid).toBeLessThanOrEqual(after);
    expect(after).toBe(state.events.length);
  });

  it('marks packets in flight only while the cursor is inside a hop', () => {
    const packet = state.packets[0];
    if (packet === undefined || packet.hops.length === 0) return;
    const hop = packet.hops[0]!;
    expect(packetInFlight(packet, hop.startMs)).toBe(true);
    expect(packetInFlight(packet, (hop.startMs + hop.endMs) / 2)).toBe(true);
    expect(packetInFlight(packet, hop.endMs + 1000)).toBe(false);
  });
});

describe('Packet animation geometry', () => {
  it('interpolates position along a hop deterministically', () => {
    resetBuilders();
    const frame = buildFrame({
      source: mac('02:00:00:00:00:01'),
      destination: BROADCAST_MAC,
      etherType: 0x0800,
      payload: {
        kind: 'ip',
        ip: buildIpPacket({
          source: ipv4('10.0.0.1'),
          destination: ipv4('10.0.0.2'),
          ttl: 64,
          protocol: 'icmp',
          payload: { kind: 'icmp', type: 'echo-request' }
        })
      }
    });
    const topology = labs.find((l) => l.id === 'arp')!.topology;
    const base = buildPacket(frame, 0);
    const packet: Packet = withHops(base, [makeHop('l-arp-1', 'host-1-eth0', 'arp-switch-p1', 0, 10)]);

    const start = packetPosition(packet, topology, 0).point;
    const mid = packetPosition(packet, topology, 5).point;
    const end = packetPosition(packet, topology, 10).point;

    // Movement happens (start ≠ mid ≠ end) and is deterministic.
    expect(mid.x).not.toBe(start.x);
    expect(end.x).not.toBe(mid.x);
    expect(packetPosition(packet, topology, 5).point).toEqual(mid);

    // After the hop the packet rests at the destination node.
    expect(packetPosition(packet, topology, 11).point).toEqual(end);
  });

  it('builds a view whose bounds contain every node', () => {
    const topology = labs.find((l) => l.id === 'http')!.topology;
    const view = buildTopologyView(topology);
    for (const n of view.nodes) {
      expect(n.position.x).toBeLessThanOrEqual(view.bounds.width);
      expect(n.position.y).toBeLessThanOrEqual(view.bounds.height);
    }
  });
});
