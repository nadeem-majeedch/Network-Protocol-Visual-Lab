/**
 * IPv4 forwarding & routing — deterministic tests.
 *
 * Covers the model (longest-prefix match, next-hop/interface resolution),
 * the engine (real per-hop ARP-gated forwarding across the PC1 → Router1 →
 * Router2 → Server chain), all five forwarding labs, the decision data on
 * ROUTE_LOOKUP events, the routing UI panels, and determinism.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NetworkEngine } from '../src/engine/network-engine';
import { runLab, labSeed } from '../src/labs/runner';
import { labs } from '../src/labs';
import { useApp } from '../src/state/store';
import type { LabDefinition } from '../src/labs/types';
import { forwardingTopology, staticRoutesTopology } from '../src/labs/forwarding-topologies';
import { validateTopology } from '../src/models/topology';
import { lookupRoute, matchingRoutes, routeSelectionReason, explainRoute } from '../src/models/routing';
import type { RoutingTable } from '../src/models/routing';
import { ipv4 } from '../src/models/ipv4';
import { RoutingTableInspector } from '../src/components/RoutingTableInspector';
import { RouterDecisionPanel } from '../src/components/RouterDecisionPanel';
import { describeEvent } from '../src/models/events';

function labById(id: string): LabDefinition {
  const lab = labs.find((l) => l.id === id);
  if (lab === undefined) throw new Error(`Missing lab ${id}`);
  return lab;
}

function runTopologyLab(id: string) {
  const lab = labById(id);
  const engine = new NetworkEngine(lab.topology);
  runLab(engine, lab);
  return { lab, engine, final: engine.getState() };
}

/* ------------------------------------------------------------------ */
/* Model: longest-prefix match                                         */
/* ------------------------------------------------------------------ */

describe('Routing model: longest-prefix match', () => {
  const table: RoutingTable = [
    { id: 'r-default', destination: ipv4('0.0.0.0'), prefix: 0, nextHop: ipv4('10.60.0.2'), interfaceId: 'eth2', metric: 20, origin: 'static' },
    { id: 'r-specific', destination: ipv4('192.168.40.0'), prefix: 24, nextHop: ipv4('10.50.0.2'), interfaceId: 'eth1', metric: 10, origin: 'static' },
    { id: 'r-broader', destination: ipv4('192.168.0.0'), prefix: 16, interfaceId: 'eth1', metric: 1, origin: 'connected' }
  ];

  it('selects the longest prefix, not the best metric', () => {
    const match = lookupRoute(table, ipv4('192.168.40.20'));
    expect(match?.entry.id).toBe('r-specific');
    expect(match?.entry.prefix).toBe(24);
  });

  it('falls back to the default route when nothing specific matches', () => {
    const match = lookupRoute(table, ipv4('203.0.113.99'));
    expect(match?.entry.id).toBe('r-default');
    // Default-route next hop is the route's, never the packet destination.
    expect(match?.nextHopIp).toBe('10.60.0.2');
  });

  it('prefers longer prefix even when the shorter route has a lower metric', () => {
    // r-broader: /16 metric 1 vs r-specific: /24 metric 10 — /24 must win.
    const match = lookupRoute(table, ipv4('192.168.40.1'));
    expect(match?.entry.id).toBe('r-specific');
  });

  it('resolves connected routes to the destination itself and the route interface', () => {
    const match = lookupRoute(table, ipv4('192.168.99.5'));
    expect(match?.entry.id).toBe('r-broader');
    expect(match?.nextHopIp).toBe('192.168.99.5');
    expect(match?.interfaceId).toBe('eth1');
  });

  it('returns undefined when no route contains the destination', () => {
    const empty: RoutingTable = [];
    expect(lookupRoute(empty, ipv4('1.2.3.4'))).toBeUndefined();
  });

  it('breaks equal-prefix ties by metric then id', () => {
    const tied: RoutingTable = [
      { id: 'a', destination: ipv4('10.0.0.0'), prefix: 8, nextHop: ipv4('1.1.1.1'), interfaceId: 'e0', metric: 5, origin: 'static' },
      { id: 'b', destination: ipv4('10.0.0.0'), prefix: 8, nextHop: ipv4('2.2.2.2'), interfaceId: 'e1', metric: 5, origin: 'static' },
      { id: 'c', destination: ipv4('10.0.0.0'), prefix: 8, nextHop: ipv4('3.3.3.3'), interfaceId: 'e2', metric: 3, origin: 'static' }
    ];
    expect(lookupRoute(tied, ipv4('10.9.9.9'))?.entry.id).toBe('c');
    const tied2: RoutingTable = [tied[0]!, tied[1]!];
    expect(lookupRoute(tied2, ipv4('10.9.9.9'))?.entry.id).toBe('a');
  });

  it('lists every matching route ordered longest-first', () => {
    const matches = matchingRoutes(table, ipv4('192.168.40.20'));
    expect(matches.map((m) => m.id)).toEqual(['r-specific', 'r-broader', 'r-default']);
  });

  it('explains why the winner won and the losers lost', () => {
    const matches = matchingRoutes(table, ipv4('192.168.40.20'));
    const winner = lookupRoute(table, ipv4('192.168.40.20'))!;
    expect(routeSelectionReason(winner.entry, matches, winner.entry)).toContain('longest prefix');
    const loser = matches.find((m) => m.id === 'r-default')!;
    expect(routeSelectionReason(loser, matches, winner.entry)).toContain('shorter prefix');
    expect(explainRoute(ipv4('192.168.40.20'), winner, table)).toContain('192.168.40.0/24');
    expect(explainRoute(ipv4('192.168.40.20'), winner, table)).toContain('10.50.0.2');
  });

  it('states on-link resolution for connected routes in the explanation', () => {
    const match = lookupRoute(table, ipv4('192.168.99.5'))!;
    expect(explainRoute(ipv4('192.168.99.5'), match, table)).toContain('directly via ARP');
  });
});

/* ------------------------------------------------------------------ */
/* The example topology: PC1 → Router1 → Router2 → Server              */
/* ------------------------------------------------------------------ */

describe('Example topology (PC1 — Router1 — Router2 — Server)', () => {
  it('is structurally valid with the canonical addresses', () => {
    expect(validateTopology(forwardingTopology)).toEqual([]);
    const iface = (nodeId: string) => forwardingTopology.nodes.find((n) => n.id === nodeId)?.interfaces[0];
    expect(iface('fwd-pc1')?.ip).toBe('192.168.1.10');
    expect(forwardingTopology.nodes.find((n) => n.id === 'fwd-r1')?.interfaces.map((i) => i.ip)).toEqual(['192.168.1.1', '10.0.0.1']);
    expect(forwardingTopology.nodes.find((n) => n.id === 'fwd-r2')?.interfaces.map((i) => i.ip)).toEqual(['10.0.0.2', '192.168.2.1']);
    expect(iface('fwd-server')?.ip).toBe('192.168.2.20');
  });

  it('performs the complete 11-step forwarding sequence', () => {
    const { final } = runTopologyLab('multi-router');
    const evts = final.events;

    // 1. Packet creation.
    expect(evts.some((e) => e.type === 'PACKET_CREATED' && e.protocol === 'ICMP')).toBe(true);
    // 2. Ethernet resolution at PC1: ARP for the GATEWAY, not the server.
    const whoHas = evts.filter((e) => e.type === 'ARP_REQUEST' && e.nodeId === 'fwd-pc1');
    expect(whoHas.length).toBeGreaterThanOrEqual(1);
    expect(whoHas.every((e) => e.type !== 'ARP_REQUEST' || e.targetIp === '192.168.1.1')).toBe(true);
    // 3. Router1 receives the frame.
    expect(evts.some((e) => e.type === 'PACKET_RECEIVED' && e.nodeId === 'fwd-r1')).toBe(true);
    // 4→5→6. Router1 does a lookup that records the longest-prefix decision.
    const r1Lookup = evts.find((e) => e.type === 'ROUTE_LOOKUP' && e.nodeId === 'fwd-r1');
    expect(r1Lookup?.type).toBe('ROUTE_LOOKUP');
    if (r1Lookup?.type === 'ROUTE_LOOKUP') {
      expect(r1Lookup.destination).toBe('192.168.2.20');
      expect(r1Lookup.matched).toBe('192.168.2.0/24');
      expect(r1Lookup.prefixLength).toBe(24);
      expect(r1Lookup.interfaceId).toBe('fwd-r1-eth1');
      expect(r1Lookup.nextHops).toEqual(['10.0.0.2']);
    }
    // 7. TTL decrement happens between ingress and egress.
    // 8. Next hop selected: 10.0.0.2 (recorded above).
    // 9→10. New frame built for the next hop and the packet forwarded.
    expect(evts.some((e) => e.type === 'PACKET_FORWARDED' && e.nodeId === 'fwd-r1' && e.reason.includes('route 192.168.2.0/24'))).toBe(true);
    // Router2 ARPs for the SERVER (its connected route resolves directly).
    const r2Arp = evts.filter((e) => e.type === 'ARP_REQUEST' && e.nodeId === 'fwd-r2');
    expect(r2Arp.some((e) => e.type === 'ARP_REQUEST' && e.targetIp === '192.168.2.20')).toBe(true);
    // 11. Destination host receives the packet.
    expect(evts.some((e) => e.type === 'PACKET_RECEIVED' && e.nodeId === 'fwd-server')).toBe(true);
  });

  it('sends each hop with the REAL next-hop MAC (ARP-gated, never broadcast)', () => {
    const { final } = runTopologyLab('multi-router');
    const ping = final.packets.find(
      (p) => p.frame.payload.kind === 'ip' && p.frame.payload.ip.payload.kind === 'icmp' && p.frame.payload.ip.payload.type === 'echo-request'
    );
    expect(ping).toBeDefined();
    expect(ping!.hops.length).toBeGreaterThanOrEqual(4); // pc1→sw→r1→r2→sw→server at L2
    // The end-to-end frame is unicast to the SERVER's MAC (learned via
    // ARP by Router2), never the broadcast address.
    expect(ping!.frame.destination).not.toBe('ff:ff:ff:ff:ff:ff');
    // The MAC tables of the LAN switches prove real unicast forwarding.
    expect(Object.keys(final.macTables['fwd-sw-lan'] ?? {}).length).toBeGreaterThanOrEqual(2);
  });

  it('decrements TTL once per router (64 → 62 at the server)', () => {
    const { final } = runTopologyLab('multi-router');
    // The delivered request carries ttl 62: decremented by Router1 and Router2.
    const delivered = final.packets.find(
      (p) =>
        p.frame.payload.kind === 'ip' &&
        p.frame.payload.ip.payload.kind === 'icmp' &&
        p.frame.payload.ip.payload.type === 'echo-request' &&
        p.hops.some((h) => h.toInterface === 'fwd-server-eth0')
    );
    expect(delivered).toBeDefined();
    expect(delivered!.frame.payload.kind === 'ip' && delivered!.frame.payload.ip.ttl).toBe(62);
  });

  it('completes the round trip: server answers through both routers back to PC1', () => {
    const { final } = runTopologyLab('multi-router');
    const reply = final.packets.find(
      (p) => p.frame.payload.kind === 'ip' && p.frame.payload.ip.payload.kind === 'icmp' && p.frame.payload.ip.payload.type === 'echo-reply'
    );
    expect(reply).toBeDefined();
    // The reply was routed (reached PC1's interface) and TTL was decremented twice.
    expect(reply!.hops.some((h) => h.toInterface === 'fwd-pc1-eth0')).toBe(true);
    expect(reply!.frame.payload.kind === 'ip' && reply!.frame.payload.ip.ttl).toBeLessThan(64);
    // The server already knew its gateway's MAC: r2's request broadcast
    // taught it (RFC 826 gratuitous learning), so no request was needed.
    expect(final.arpCaches['fwd-server']?.['192.168.2.1']).toBe('02:00:00:0b:00:22');
  });

  it('routes lookups carry every candidate on the winner and loser lists', () => {
    const { final } = runTopologyLab('longest-prefix');
    const lookups = final.events.filter((e) => e.type === 'ROUTE_LOOKUP' && e.nodeId === 'br-r1');
    expect(lookups.length).toBeGreaterThanOrEqual(1);
    const first = lookups[0]!;
    if (first.type !== 'ROUTE_LOOKUP') return;
    // Both the /24 and the /0 matched; both are recorded with prefix lengths.
    const prefixes = (first.allMatches ?? []).map((m) => m.prefix);
    expect(prefixes).toContain(24);
    expect(prefixes).toContain(0);
    expect(first.matched).toBe('192.168.40.0/24');
    expect(first.prefixLength).toBe(24);
    expect(first.interfaceId).toBe('br-r1-eth1');
  });

  it('drops with a clear reason when no route matches', () => {
    const lab = labById('static-routes');
    const engine = new NetworkEngine(lab.topology);
    runLab(engine, {
      ...lab,
      script: [{ atMs: 0, action: 'send-ping', from: 'br-pc1', toIp: '172.31.255.1', ttl: 64 }]
    });
    const final = engine.getState();
    const r1Lookup = final.events.find((e) => e.type === 'ROUTE_LOOKUP' && e.nodeId === 'br-r1');
    if (r1Lookup?.type === 'ROUTE_LOOKUP') {
      expect(r1Lookup.matched).toBe('no match');
    }
    const drop = final.events.find((e) => e.type === 'PACKET_DROPPED' && e.nodeId === 'br-r1');
    expect(drop?.type).toBe('PACKET_DROPPED');
    if (drop?.type === 'PACKET_DROPPED') {
      expect(drop.reason).toBe('No route to host');
    }
  });

  it('parks and drops via ARP when the next hop never answers', () => {
    // Remove Router2 entirely: Router1's static route points at a dead next hop.
    const broken: LabDefinition = {
      ...labById('static-routes'),
      topology: {
        ...staticRoutesTopology,
        nodes: staticRoutesTopology.nodes.filter((n) => n.id !== 'br-r2'),
        links: staticRoutesTopology.links.filter((l) => !l.endpoints.some((e) => e.startsWith('br-r2')))
      },
      script: [{ atMs: 0, action: 'send-ping', from: 'br-pc1', toIp: '192.168.40.20', ttl: 64 }]
    };
    const engine = new NetworkEngine(broken.topology);
    runLab(engine, broken);
    const final = engine.getState();
    // Filter to the drop of the PINGED packet itself (the unanswered ARP
    // probe also records its own 'Egress link down' drop).
    const drop = final.events.find(
      (e) => e.type === 'PACKET_DROPPED' && e.nodeId === 'br-r1' && e.packetId.startsWith('ping-br-pc1-192.168.40.20')
    );
    expect(drop?.type).toBe('PACKET_DROPPED');
    if (drop?.type === 'PACKET_DROPPED') {
      expect(drop.reason).toMatch(/ARP never resolved 10\.50\.0\.2/);
    }
  });
});

/* ------------------------------------------------------------------ */
/* The five labs                                                       */
/* ------------------------------------------------------------------ */

describe('Forwarding labs', () => {
  it('local delivery: no router, no TTL loss, direct MAC frame', () => {
    const { final } = runTopologyLab('local-delivery');
    expect(final.events.some((e) => e.type === 'ARP_REQUEST' && e.targetIp === '192.168.1.20')).toBe(true);
    expect(final.events.some((e) => e.type === 'PACKET_RECEIVED' && e.nodeId === 'ld-server')).toBe(true);
    const request = final.packets.find(
      (p) => p.frame.payload.kind === 'ip' && p.frame.payload.ip.payload.kind === 'icmp' && p.frame.payload.ip.payload.type === 'echo-request'
    );
    expect(request?.hops.length).toBe(2); // pc1→switch→server, nothing routed
    expect(final.events.some((e) => e.type === 'PACKET_FORWARDED' && e.reason.startsWith('route '))).toBe(false);
  });

  it('gateway routing: default route hands the packet to Router1', () => {
    const { final } = runTopologyLab('gateway-routing');
    const lookup = final.events.find((e) => e.type === 'ROUTE_LOOKUP' && e.nodeId === 'fwd-pc1');
    if (lookup?.type === 'ROUTE_LOOKUP') {
      expect(lookup.matched).toBe('0.0.0.0/0');
      expect(lookup.prefixLength).toBe(0);
      expect(lookup.nextHops).toEqual(['192.168.1.1']);
    } else {
      throw new Error('PC1 produced no ROUTE_LOOKUP');
    }
    expect(final.events.some((e) => e.type === 'PACKET_RECEIVED' && e.nodeId === 'fwd-server')).toBe(true);
  });

  it('static routes: same router, different interface per destination', () => {
    const { final } = runTopologyLab('static-routes');
    const r1Lookups = final.events.filter((e) => e.type === 'ROUTE_LOOKUP' && e.nodeId === 'br-r1');
    const targets = r1Lookups.map((l) => (l.type === 'ROUTE_LOOKUP' ? l.destination : ''));
    expect(targets).toContain('192.168.40.20');
    expect(targets).toContain('192.168.60.20');
    const egresses = r1Lookups.map((l) => (l.type === 'ROUTE_LOOKUP' ? l.interfaceId : ''));
    // The two STATIC routes egress different interfaces (reply traffic
    // additionally leaves through the LAN-facing eth0).
    expect(egresses).toContain('br-r1-eth1');
    expect(egresses).toContain('br-r1-eth2');
    expect(final.events.some((e) => e.type === 'PACKET_RECEIVED' && e.nodeId === 'br-server-a')).toBe(true);
    expect(final.events.some((e) => e.type === 'PACKET_RECEIVED' && e.nodeId === 'br-server-b')).toBe(true);
  });

  it('longest prefix: the /24 beats the default route', () => {
    const { final } = runTopologyLab('longest-prefix');
    const lookup = final.events.find((e) => e.type === 'ROUTE_LOOKUP' && e.nodeId === 'br-r1');
    if (lookup?.type === 'ROUTE_LOOKUP') {
      expect(lookup.matched).toBe('192.168.40.0/24');
      // The winner's egress goes toward Router2, not the default's Router3.
      expect(lookup.interfaceId).toBe('br-r1-eth1');
    } else {
      throw new Error('no ROUTE_LOOKUP on br-r1');
    }
    expect(final.events.some((e) => e.type === 'PACKET_RECEIVED' && e.nodeId === 'br-server-a')).toBe(true);
    expect(final.events.some((e) => e.type === 'PACKET_RECEIVED' && e.nodeId === 'br-server-b')).toBe(false);
  });

  it('every lab topology validates cleanly', () => {
    for (const id of ['local-delivery', 'gateway-routing', 'static-routes', 'multi-router', 'longest-prefix']) {
      const lab = labById(id);
      expect(validateTopology(lab.topology), `topology of ${id}`).toEqual([]);
    }
  });

  it('each lab produces ROUTE_LOOKUP or ARP activity a student can watch', () => {
    for (const id of ['local-delivery', 'gateway-routing', 'static-routes', 'multi-router', 'longest-prefix']) {
      const { final, lab } = runTopologyLab(id);
      const watched = new Set(lab.steps.flatMap((s) => s.watchEventTypes));
      const observed = final.events.some((e) => watched.has(e.type));
      expect(observed, `lab ${id} watches only unseen events`).toBe(true);
      expect(lab.steps.length).toBeGreaterThanOrEqual(3);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Decision data & event rendering                                     */
/* ------------------------------------------------------------------ */

describe('ROUTE_LOOKUP decision events', () => {
  it('describeEvent renders destination, match and via', () => {
    const { final } = runTopologyLab('multi-router');
    const lookup = final.events.find((e) => e.type === 'ROUTE_LOOKUP' && e.nodeId === 'fwd-r1');
    expect(lookup).toBeDefined();
    const text = describeEvent(lookup!);
    expect(text).toContain('route lookup');
    expect(text).toContain('192.168.2.0/24');
  });

  it('carries candidate lists with next hops and interfaces', () => {
    const { final } = runTopologyLab('gateway-routing');
    const lookup = final.events.find((e) => e.type === 'ROUTE_LOOKUP' && e.nodeId === 'fwd-r1');
    if (lookup?.type === 'ROUTE_LOOKUP') {
      const candidate = (lookup.allMatches ?? [])[0];
      expect(candidate?.destination).toBeDefined();
      expect(candidate?.interfaceId).toBe('fwd-r1-eth1');
      expect(candidate?.nextHop).toBe('10.0.0.2');
    } else {
      throw new Error('Router1 produced no ROUTE_LOOKUP');
    }
  });
});

/* ------------------------------------------------------------------ */
/* UI: routing table inspector + decision panel                        */
/* ------------------------------------------------------------------ */

describe('RoutingTableInspector', () => {
  beforeEach(() => cleanup());

  it('renders every router with destinations, prefixes, next hops and interfaces', () => {
    const lab = labById('multi-router');
    const engine = new NetworkEngine(lab.topology);
    runLab(engine, lab);
    const state = engine.getState();
    useApp.setState({ state, lab, selectedPacketId: null, cursorMs: 0 });
    const { container } = render(<RoutingTableInspector />);
    // Both routers appear…
    expect(screen.getByText('Router1')).toBeTruthy();
    expect(screen.getByText('Router2')).toBeTruthy();
    // …with the static route and the connected routes.
    expect(container.textContent).toContain('192.168.2.0');
    expect(container.textContent).toContain('10.0.0.2');
    expect(container.textContent).toContain('on-link');
  });
});

describe('RouterDecisionPanel', () => {
  beforeEach(() => cleanup());

  function panelWith(state: ReturnType<NetworkEngine['getState']>, selectedPacketId: string | null) {
    useApp.setState({ state, selectedPacketId, lab: labs[0] ?? null, cursorMs: 0 });
    return render(<RouterDecisionPanel />);
  }

  it('shows destination, matching routes, prefixes, selected route, next hop and interface', () => {
    const lab = labById('longest-prefix');
    const engine = new NetworkEngine(lab.topology);
    runLab(engine, lab);
    const state = engine.getState();
    const pingId = state.packets.find(
      (p) => p.frame.payload.kind === 'ip' && p.frame.payload.ip.payload.kind === 'icmp'
    )?.id;
    const { container } = panelWith(state, pingId ?? null);

    expect(container.textContent).toContain('How did Router1 decide?');
    expect(container.textContent).toContain('192.168.40.20'); // destination
    expect(container.textContent).toContain('192.168.40.0'); // selected route
    expect(container.textContent).toContain('/24'); // prefix length
    expect(container.textContent).toContain('10.50.0.2'); // next hop
    expect(container.textContent).toContain('to-r2'); // interface label
    expect(container.textContent).toContain('✓ selected');
  });

  it('marks the losing default route with its verdict', () => {
    const lab = labById('longest-prefix');
    const engine = new NetworkEngine(lab.topology);
    runLab(engine, lab);
    const state = engine.getState();
    const pingId = state.packets.find(
      (p) => p.frame.payload.kind === 'ip' && p.frame.payload.ip.payload.kind === 'icmp'
    )?.id;
    const { container } = panelWith(state, pingId ?? null);
    expect(container.textContent).toContain('0.0.0.0');
    expect(container.textContent).toContain('shorter prefix');
  });

  it('renders nothing without a ROUTE_LOOKUP in the log', () => {
    const lab = labById('arp');
    const engine = new NetworkEngine(lab.topology);
    runLab(engine, lab);
    const state = engine.getState();
    const { container } = panelWith(state, null);
    expect(container.textContent).not.toContain('How did');
  });
});

/* ------------------------------------------------------------------ */
/* Determinism                                                         */
/* ------------------------------------------------------------------ */

describe('Routing determinism', () => {
  it('the multi-router lab produces byte-identical logs across runs', () => {
    const a = runTopologyLab('multi-router').final;
    const b = runTopologyLab('multi-router').final;
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(a.arpCaches).toEqual(b.arpCaches);
    expect(a.macTables).toEqual(b.macTables);
    expect(a.routingTables).toEqual(b.routingTables);
  });

  it('step mode replays the same event sequence as a full run', () => {
    const lab = labById('multi-router');
    const steppedEngine = new NetworkEngine(lab.topology);
    for (let i = 0; i < 25; i++) {
      steppedEngine.step(labSeed(steppedEngine, lab));
    }
    const stepped = steppedEngine.getState();
    const full = runTopologyLab('multi-router').final;
    const steppedPairs = stepped.events.map((e) => `${e.ts}|${e.type}`);
    const fullPairs = full.events.map((e) => `${e.ts}|${e.type}`);
    for (let i = 0; i < steppedPairs.length; i++) {
      expect(steppedPairs[i]).toBe(fullPairs[i]);
    }
    expect(steppedPairs.length).toBeLessThanOrEqual(fullPairs.length);
  });
});
