import { describe, it, expect } from 'vitest';
import { NetworkEngine } from '../src/engine/network-engine';
import { runLab, labSeed } from '../src/labs/runner';
import { labs } from '../src/labs';
import { gatewayTopology } from '../src/labs/gateway-topology';
import type { LabDefinition } from '../src/labs/types';
import { validateTopology } from '../src/models/topology';
import { eventTimes, visibleEvents, packetInFlight } from '../src/state/playback';

function labById(id: string): LabDefinition {
  const lab = labs.find((l) => l.id === id);
  if (lab === undefined) throw new Error(`Missing lab ${id}`);
  return lab;
}

function runGatewayLab() {
  const lab = labById('gateway-arp');
  const engine = new NetworkEngine(lab.topology);
  runLab(engine, lab);
  return { lab, engine, final: engine.getState() };
}

describe('Gateway lab topology (PC1 — Switch — Router)', () => {
  it('is structurally valid with the canonical addresses', () => {
    expect(validateTopology(gatewayTopology)).toEqual([]);
    const pc1 = gatewayTopology.nodes.find((n) => n.id === 'pc1');
    const router = gatewayTopology.nodes.find((n) => n.id === 'gateway-router');
    expect(pc1?.interfaces[0]?.ip).toBe('192.168.1.10');
    expect(pc1?.interfaces[0]?.mac).toBe('02:00:00:0a:00:01');
    expect(pc1?.kind === 'host' && pc1.gateway).toBe('192.168.1.1');
    expect(router?.interfaces[0]?.ip).toBe('192.168.1.1');
    expect(router?.interfaces[0]?.mac).toBe('02:00:00:0a:00:21');
  });
});

describe('Complete ARP scenario: discover the default gateway', () => {
  const { final } = runGatewayLab();

  it('starts from an empty ARP cache (the reason ARP is needed)', () => {
    // The run opens with NODE_CREATED/LINK_CREATED and the cache-miss note;
    // no ARP_WRITE may precede the first ARP_REQUEST.
    const firstWrite = final.events.find((e) => e.type === 'ARP_WRITE');
    const firstRequest = final.events.find((e) => e.type === 'ARP_REQUEST');
    expect(firstRequest).toBeDefined();
    expect((firstWrite?.ts ?? Number.POSITIVE_INFINITY) >= (firstRequest?.ts ?? 0)).toBe(true);
  });

  it('generates an ARP request for 192.168.1.1', () => {
    const request = final.events.find((e) => e.type === 'ARP_REQUEST');
    expect(request?.type).toBe('ARP_REQUEST');
    if (request?.type === 'ARP_REQUEST') {
      expect(request.nodeId).toBe('pc1');
      expect(request.senderIp).toBe('192.168.1.10');
      expect(request.targetIp).toBe('192.168.1.1');
    }
  });

  it('broadcasts the request as an Ethernet frame to ff:ff:ff:ff:ff:ff', () => {
    const arpPackets = final.packets.filter(
      (p) => p.frame.payload.kind === 'arp' && p.frame.payload.arp.operation === 'request' && p.frame.payload.arp.targetIp === '192.168.1.1'
    );
    expect(arpPackets.length).toBeGreaterThanOrEqual(1);
    const request = arpPackets[0]!;
    // Ethernet frame shape: source MAC, broadcast destination, ARP EtherType.
    expect(request.frame.source).toBe('02:00:00:0a:00:01');
    expect(request.frame.destination).toBe('ff:ff:ff:ff:ff:ff');
    expect(request.frame.etherType).toBe(0x0806);
    expect(request.frame.payload.kind).toBe('arp');
  });

  it('shows the request traversing the switch (flood + MAC learning)', () => {
    const switchEvents = final.events.filter((e) => 'nodeId' in e && e.nodeId === 'gateway-switch');
    // Switch received the broadcast frame...
    expect(switchEvents.some((e) => e.type === 'PACKET_RECEIVED')).toBe(true);
    // ...flooded it (unknown unicast destination at that point)...
    expect(
      switchEvents.some((e) => e.type === 'PACKET_FORWARDED' && e.reason.includes('flooded'))
    ).toBe(true);
    // ...and learned PC1's MAC on port p1.
    expect(
      switchEvents.some((e) => e.type === 'NOTE' && e.message.includes('02:00:00:0a:00:01') && e.message.includes('p1'))
    ).toBe(true);
    // MAC table in canonical state reflects it.
    expect(final.macTables['gateway-switch']?.['02:00:00:0a:00:01']).toBe('gateway-switch-p1');
  });

  it('delivers the request to the router, which learns the sender', () => {
    expect(
      final.events.some((e) => e.type === 'PACKET_RECEIVED' && e.nodeId === 'gateway-router')
    ).toBe(true);
    const learned = final.events.find(
      (e) => e.type === 'ARP_LEARN' && e.nodeId === 'gateway-router' && e.ip === '192.168.1.10'
    );
    expect(learned).toBeDefined();
    // The router cached PC1's binding even though it was only the requester.
    expect(final.arpCaches['gateway-router']?.['192.168.1.10']).toBe('02:00:00:0a:00:01');
  });

  it('generates a unicast ARP reply from the router', () => {
    const reply = final.events.find((e) => e.type === 'ARP_REPLY');
    expect(reply?.type).toBe('ARP_REPLY');
    if (reply?.type === 'ARP_REPLY') {
      expect(reply.nodeId).toBe('gateway-router');
      expect(reply.senderIp).toBe('192.168.1.1');
      expect(reply.senderMac).toBe('02:00:00:0a:00:21');
    }
    // The reply frame is unicast to PC1's MAC, not broadcast.
    const replyPacket = final.packets.find(
      (p) => p.frame.payload.kind === 'arp' && p.frame.payload.arp.operation === 'reply'
    );
    expect(replyPacket).toBeDefined();
    expect(replyPacket!.frame.destination).toBe('02:00:00:0a:00:01');
    expect(replyPacket!.frame.source).toBe('02:00:00:0a:00:21');
  });

  it('delivers the reply to PC1, which writes the cache', () => {
    expect(
      final.events.some((e) => e.type === 'PACKET_RECEIVED' && e.nodeId === 'pc1')
    ).toBe(true);
    const write = final.events.find(
      (e) => e.type === 'ARP_WRITE' && e.nodeId === 'pc1' && e.ip === '192.168.1.1'
    );
    expect(write).toBeDefined();
    expect(final.arpCaches['pc1']?.['192.168.1.1']).toBe('02:00:00:0a:00:21');
  });

  it('releases the held packet using the learned MAC (not broadcast)', () => {
    // The held echo request goes out only AFTER the ARP_WRITE...
    const write = final.events.find((e) => e.type === 'ARP_WRITE' && e.nodeId === 'pc1');
    const released = final.events.find(
      (e) => e.type === 'PACKET_SENT' && 'summary' in e && e.summary.includes('echo request to 192.168.1.1')
    );
    expect(released).toBeDefined();
    // Released in the same tick as the cache write — the flush is immediate.
    expect((released?.ts ?? 0) >= (write?.ts ?? 0)).toBe(true);
    // ...and the frame that carried it is unicast to the router's MAC.
    const echo = final.packets.find(
      (p) => p.frame.payload.kind === 'ip' && p.frame.payload.ip.payload.kind === 'icmp'
    );
    expect(echo).toBeDefined();
    expect(echo!.frame.destination).toBe('02:00:00:0a:00:21');
    expect(echo!.frame.etherType).toBe(0x0800);
  });

  it('sends subsequent traffic without any new ARP request', () => {
    // Two pings are scripted; only one ARP request for 192.168.1.1 exists.
    const requests = final.events.filter(
      (e) => e.type === 'ARP_REQUEST' && e.targetIp === '192.168.1.1'
    );
    expect(requests).toHaveLength(1);
    // And a note explains the cache answered the second one.
    expect(
      final.events.some(
        (e) => e.type === 'NOTE' && e.message.includes('Second ping needed no ARP')
      )
    ).toBe(true);
  });

  it('the router echoes back and PC1 completes the round trip', () => {
    const echoReply = final.packets.find(
      (p) => p.frame.payload.kind === 'ip' && p.frame.payload.ip.payload.kind === 'icmp' && p.frame.payload.ip.payload.type === 'echo-reply'
    );
    expect(echoReply).toBeDefined();
  });
});

describe('Step-by-step visualization from canonical events', () => {
  it('exposes narrated steps bound to the canonical events a student must observe', () => {
    const lab = labById('gateway-arp');
    const final = runGatewayLab().final;
    const eventTypes: Set<string> = new Set(final.events.map((e) => e.type));
    for (const step of lab.steps) {
      const observed = step.watchEventTypes.some((t) => eventTypes.has(t));
      expect(observed, `Step "${step.title}" bound to missing events`).toBe(true);
    }
    expect(lab.steps).toHaveLength(8);
  });

  it('animates packets from event timestamps, not faked positions', () => {
    const { final } = runGatewayLab();
    const times = eventTimes(final.events);
    expect(times[0]).toBe(0);
    // The ARP request's first hop starts at its PACKET_SENT time.
    const request = final.packets.find(
      (p) => p.frame.payload.kind === 'arp' && p.frame.payload.arp.operation === 'request'
    );
    if (request === undefined || request.hops.length === 0) return;
    const firstHop = request.hops[0]!;
    const sentAt = final.events.find(
      (e) => e.type === 'PACKET_SENT' && e.packetId === request.id
    );
    expect(firstHop.startMs).toBe(sentAt?.ts);
    // Mid-hop, the packet is in flight and interpolated; outside, it is not.
    expect(packetInFlight(request, (firstHop.startMs + firstHop.endMs) / 2)).toBe(true);
    expect(packetInFlight(request, firstHop.endMs + 500)).toBe(false);
    // Timeline reveal: before the reply there is no ARP_WRITE for pc1.
    const write = final.events.find((e) => e.type === 'ARP_WRITE' && e.nodeId === 'pc1');
    if (write !== undefined) {
      const before = visibleEvents(final.events, write.ts - 1);
      expect(before.some((e) => e.type === 'ARP_WRITE' && e.nodeId === 'pc1')).toBe(false);
      const after = visibleEvents(final.events, write.ts);
      expect(after.some((e) => e.type === 'ARP_WRITE' && e.nodeId === 'pc1')).toBe(true);
    }
  });
});

describe('Unresolved destination behavior', () => {
  it('holds the packet, broadcasts once, then drops when nobody answers', () => {
    // Use the runner's own ARP-gated sender via a hand-built script:
    const lab: LabDefinition = {
      ...labById('gateway-arp'),
      script: [{ atMs: 0, action: 'send-ping', from: 'pc1', toIp: '192.168.1.99', ttl: 64 }]
    };
    const engine2 = new NetworkEngine(lab.topology);
    runLab(engine2, lab);
    const final = engine2.getState();

    // Exactly one ARP request ORIGINATED for the ghost address (observers
    // re-emit the seen request, but the sender probes only once — no retry storm)...
    const requests = final.events.filter(
      (e) => e.type === 'ARP_REQUEST' && e.targetIp === '192.168.1.99' && e.nodeId === 'pc1'
    );
    expect(requests).toHaveLength(1);
    // ...no reply ever came (no ARP_WRITE for the ghost IP)...
    expect(
      final.events.some((e) => e.type === 'ARP_WRITE' && e.ip === '192.168.1.99')
    ).toBe(false);
    // ...and the held packet was dropped with an explicit reason.
    const drop = final.events.find((e) => e.type === 'PACKET_DROPPED');
    expect(drop?.type).toBe('PACKET_DROPPED');
    if (drop?.type === 'PACKET_DROPPED') {
      expect(drop.reason).toMatch(/ARP never resolved 192\.168\.1\.99/);
      expect(drop.ts).toBeGreaterThanOrEqual(200);
    }
  });
});

describe('Determinism of the ARP lab', () => {
  it('produces byte-identical event logs across runs', () => {
    const a = runGatewayLab().final;
    const b = runGatewayLab().final;
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(JSON.stringify(a.packets.map((p) => p.frame))).toBe(JSON.stringify(b.packets.map((p) => p.frame)));
    expect(a.arpCaches).toEqual(b.arpCaches);
    expect(a.macTables).toEqual(b.macTables);
  });

  it('step mode advances through the same event sequence', () => {
    const lab = labById('gateway-arp');
    const engine = new NetworkEngine(lab.topology);
    // Step 12 times, collecting events as they appear.
    for (let i = 0; i < 12; i++) {
      engine.step(labSeed(engine, lab));
    }
    const stepped = engine.getState();
    const full = runGatewayLab().final;
    // Every stepped event matches the full run's prefix event-for-event.
    const steppedPairs = stepped.events.map((e) => `${e.ts}|${e.type}`);
    const fullPairs = full.events.map((e) => `${e.ts}|${e.type}`);
    for (let i = 0; i < steppedPairs.length; i++) {
      expect(steppedPairs[i]).toBe(fullPairs[i]);
    }
    expect(steppedPairs.length).toBeLessThanOrEqual(fullPairs.length);
  });
});

describe('Ethernet frame invariants on every ARP packet', () => {
  it('all frames carry coherent MAC/EtherType/payload triples', () => {
    const { final } = runGatewayLab();
    for (const packet of final.packets) {
      const frame = packet.frame;
      expect(frame.source).toMatch(/^02:00:00:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}$/);
      if (frame.payload.kind === 'arp') {
        expect(frame.etherType).toBe(0x0806);
        const arp = frame.payload.arp;
        if (arp.operation === 'request') {
          expect(arp.targetMac).toBeUndefined(); // the whole point of ARP
          expect(frame.destination).toBe('ff:ff:ff:ff:ff:ff');
        } else {
          expect(arp.targetMac).toBeDefined();
          expect(frame.destination).not.toBe('ff:ff:ff:ff:ff:ff');
        }
      } else {
        expect(frame.etherType).toBe(0x0800);
      }
    }
  });
});
