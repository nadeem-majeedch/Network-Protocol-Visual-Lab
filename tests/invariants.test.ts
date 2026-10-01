import { describe, it, expect } from 'vitest';
import { mac, BROADCAST_MAC } from '../src/models/mac';
import { ipv4 } from '../src/models/ipv4';
import { buildFrame, buildArpRequest, buildIpPacket, buildTcpSegment, buildUdpDatagram, buildDnsQuery, buildPacket, resetBuilders, makeHop, withHops } from '../src/simulation/builder';
import { packetProtocolLabel, packetSummary } from '../src/models/packet';
import { describeEvent, eventFields, eventKind } from '../src/models/events';
import type { Packet } from '../src/models/packet';
import { NetworkEngine } from '../src/engine/network-engine';
import { arpTopology } from '../src/labs/topologies';
import { labs } from '../src/labs';
import { runLab } from '../src/labs/runner';
import type { LabDefinition } from '../src/labs/types';

describe('Ethernet frame invariants', () => {
  it('carries MACs and an EtherType that matches the payload', () => {
    const arpFrame = buildFrame({
      source: mac('02:00:00:00:00:01'),
      destination: BROADCAST_MAC,
      etherType: 0x0806,
      payload: { kind: 'arp', arp: buildArpRequest(ipv4('10.0.0.2'), ipv4('10.0.0.1'), mac('02:00:00:00:00:01')) }
    });
    expect(arpFrame.etherType).toBe(0x0806);
    expect(arpFrame.payload.kind).toBe('arp');

    const ipFrame = buildFrame({
      source: mac('02:00:00:00:00:01'),
      destination: mac('02:00:00:00:00:02'),
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
    expect(ipFrame.etherType).toBe(0x0800);
    expect(ipFrame.payload.kind).toBe('ip');
  });
});

describe('TCP segment invariants', () => {
  it('normalizes flags so every segment carries a complete flag set', () => {
    const seg = buildTcpSegment({
      sourcePort: 49152,
      destinationPort: 80,
      sequence: 100,
      acknowledgment: 0,
      flags: { syn: true },
      window: 65535
    });
    expect(seg.flags).toEqual({ syn: true, ack: false, fin: false, rst: false, psh: false });
    expect(seg.payload).toBeUndefined();
  });
});

describe('DNS message invariants', () => {
  it('queries carry questions and no answers', () => {
    const q = buildDnsQuery(0x1234, 'www.example.com');
    expect(q.isResponse).toBe(false);
    expect(q.questions).toHaveLength(1);
    expect(q.answers).toBeUndefined();
    expect(q.transactionId).toBe(0x1234);
  });
});

describe('UDP datagram invariants', () => {
  it('binds DNS payloads to ports', () => {
    const d = buildUdpDatagram(40000, 53, buildDnsQuery(1, 'example.com'));
    expect(d.kind).toBe('udp');
    expect(d.destinationPort).toBe(53);
    expect(d.payload.kind).toBe('dns');
  });
});

describe('Packet identity invariants', () => {
  it('assigns increasing serials deterministically within a run', () => {
    resetBuilders();
    const frame = buildFrame({
      source: mac('02:00:00:00:00:01'),
      destination: mac('02:00:00:00:00:02'),
      etherType: 0x0800,
      payload: {
        kind: 'ip',
        ip: buildIpPacket({
          source: ipv4('10.0.0.1'),
          destination: ipv4('10.0.0.2'),
          ttl: 1,
          protocol: 'icmp',
          payload: { kind: 'icmp', type: 'echo-request' }
        })
      }
    });
    const a = buildPacket(frame, 0);
    const b = buildPacket(frame, 0);
    expect(b.serial).toBe(a.serial + 1);
    expect(b.id).not.toBe(a.id);
    expect(a.state).toBe('queued');
    expect(a.hops).toHaveLength(0);

    resetBuilders();
    const a2 = buildPacket(frame, 0);
    expect(a2.serial).toBe(a.serial); // reset restores the sequence
  });

  it('accumulates hops immutably', () => {
    resetBuilders();
    const frame = buildFrame({
      source: mac('02:00:00:00:00:01'),
      destination: mac('02:00:00:00:00:02'),
      etherType: 0x0800,
      payload: {
        kind: 'ip',
        ip: buildIpPacket({
          source: ipv4('10.0.0.1'),
          destination: ipv4('10.0.0.2'),
          ttl: 1,
          protocol: 'icmp',
          payload: { kind: 'icmp', type: 'echo-request' }
        })
      }
    });
    const packet: Packet = buildPacket(frame, 0);
    const hop = makeHop('link-1', 'a-eth0', 'b-eth0', 0, 4);
    const hopped = withHops(packet, [...packet.hops, hop]);
    expect(packet.hops).toHaveLength(0);   // original untouched
    expect(hopped.hops).toHaveLength(1);
    expect(hopped.hops[0]!.endMs).toBe(4);
  });
});

describe('Packet labeling is derived, not stored', () => {
  it('labels and summarizes every payload kind', () => {
    resetBuilders();
    const arpPacket = buildPacket(
      buildFrame({
        source: mac('02:00:00:00:00:01'),
        destination: BROADCAST_MAC,
        etherType: 0x0806,
        payload: { kind: 'arp', arp: buildArpRequest(ipv4('10.0.0.12'), ipv4('10.0.0.11'), mac('02:00:00:00:00:01')) }
      }),
      0
    );
    expect(packetProtocolLabel(arpPacket.frame)).toBe('ARP');
    expect(packetSummary(arpPacket.frame)).toContain('Who has 10.0.0.12');
  });
});

describe('Event descriptions', () => {
  it('renders every canonical event kind without throwing', () => {
    const events: import('../src/models/events').SimulationEvent[] = [
      { type: 'NODE_CREATED', ts: 0, nodeId: 'h1', kind: 'host', name: 'PC1' },
      { type: 'LINK_CREATED', ts: 0, linkId: 'l1', a: 'h1', b: 'h2' },
      { type: 'PACKET_CREATED', ts: 0, packetId: 'p1', serial: 1, protocol: 'ARP' },
      { type: 'PACKET_SENT', ts: 0, nodeId: 'h1', interfaceId: 'eth0', packetId: 'p1', protocol: 'ARP', summary: 'request' },
      { type: 'PACKET_RECEIVED', ts: 4, nodeId: 'h2', interfaceId: 'eth0', packetId: 'p1', protocol: 'ARP' },
      { type: 'PACKET_FORWARDED', ts: 4, nodeId: 'r1', packetId: 'p1', via: 'on-link', reason: 'route 10.0.0.0/24' },
      { type: 'PACKET_DROPPED', ts: 5, nodeId: 'r1', packetId: 'p1', reason: 'TTL expired in transit' },
      { type: 'ROUTE_LOOKUP', ts: 5, nodeId: 'r1', packetId: 'p1', destination: '10.1.1.1', matched: '10.0.0.0/8', via: '10.0.0.1' },
      { type: 'ARP_REQUEST', ts: 6, nodeId: 'h1', packetId: 'p1', senderIp: '10.0.0.1', targetIp: '10.0.0.2' },
      { type: 'ARP_REPLY', ts: 6, nodeId: 'h2', packetId: 'p1', senderIp: '10.0.0.2', senderMac: '02:00:00:00:00:02' },
      { type: 'ARP_WRITE', ts: 6, nodeId: 'h1', ip: ipv4('10.0.0.2'), mac: mac('02:00:00:00:00:02') },
      { type: 'DNS_QUERY', ts: 7, nodeId: 'h1', packetId: 'p1', name: 'www.example.com', recordType: 'A' },
      { type: 'DNS_RESPONSE', ts: 8, nodeId: 'srv', packetId: 'p1', name: 'www.example.com', address: '203.0.113.10', ttl: 300 },
      { type: 'TCP_STATE_CHANGE', ts: 9, nodeId: 'c', connectionId: 'k', from: 'CLOSED', to: 'SYN_SENT', trigger: 'open', role: 'client' },
      { type: 'HTTP_REQUEST', ts: 10, nodeId: 'srv', packetId: 'p1', method: 'GET', path: '/index.html', host: 'www.example.com' },
      { type: 'HTTP_RESPONSE', ts: 11, nodeId: 'srv', packetId: 'p1', status: 200, reason: 'OK', contentType: 'text/html' },
      { type: 'NOTE', ts: 12, nodeId: 'h1', message: 'hello' }
    ];
    for (const e of events) {
      expect(typeof describeEvent(e)).toBe('string');
      expect(describeEvent(e).length).toBeGreaterThan(0);
      // Every event is inspectable: fields include at least the type and time.
      const fields = eventFields(e);
      expect(fields[0]!.name).toBe('Event');
      expect(fields[0]!.value).toBe(e.type);
      expect(fields[1]!.value).toBe(`${e.ts} ms`);
    }
    expect(describeEvent(events[6]!)).toContain('TTL expired');
    expect(eventKind(events[6]!)).toBe('drop');
  });
});

describe('Everything serializes', () => {
  it('a fully-formed packet survives JSON round-trip unchanged', () => {
    resetBuilders();
    const frame = buildFrame({
      source: mac('02:00:00:00:00:01'),
      destination: mac('02:00:00:00:00:02'),
      etherType: 0x0800,
      payload: {
        kind: 'ip',
        ip: buildIpPacket({
          source: ipv4('10.0.0.1'),
          destination: ipv4('10.0.0.2'),
          ttl: 64,
          protocol: 'tcp',
          payload: buildTcpSegment({
            sourcePort: 49152,
            destinationPort: 80,
            sequence: 1,
            acknowledgment: 2,
            flags: { ack: true },
            window: 65535
          })
        })
      }
    });
    const packet = withHops(buildPacket(frame, 0), [makeHop('l', 'a', 'b', 0, 4)]);
    const roundTrip = JSON.parse(JSON.stringify(packet)) as Packet;
    expect(roundTrip).toEqual(packet);
  });
});

describe('Packet lifecycle states (canonical Packet.state)', () => {
  function mustLab(id: string): LabDefinition {
    const lab = labs.find((l) => l.id === id);
    if (lab === undefined) throw new Error(`Missing lab ${id}`);
    return lab;
  }

  it('marks a delivered packet delivered, finished, with no drop reason', () => {
    resetBuilders();
    const engine = new NetworkEngine(arpTopology);
    const state = engine.run((ctx) => {
      const host1 = engine.topologyRef.nodes.find((n) => n.id === 'host-1');
      const iface = host1?.interfaces[0];
      if (iface === undefined || iface.ip === undefined) throw new Error('topology missing host-1');
      const senderIp = iface.ip;
      ctx.after(0, (c) => {
        c.transmit(
          buildFrame({
            source: iface.mac,
            destination: mac('ff:ff:ff:ff:ff:ff'),
            etherType: 0x0806,
            payload: { kind: 'arp', arp: buildArpRequest(ipv4('10.0.0.12'), senderIp, iface.mac) }
          }),
          'host-1',
          iface.id
        );
      });
    });
    const delivered = state.packets.filter((p) => p.state === 'delivered');
    expect(delivered.length).toBeGreaterThan(0);
    for (const p of delivered) {
      expect(p.finishedMs).not.toBeUndefined();
      expect(p.dropReason).toBeUndefined();
    }
  });

  it('marks a TTL-expired packet dropped with the reason', () => {
    const lab = mustLab('ttl');
    const engine = new NetworkEngine(lab.topology);
    runLab(engine, lab);
    const state = engine.getState();
    const expired = state.packets.find((p) => p.state === 'dropped');
    expect(expired).toBeDefined();
    expect(expired?.dropReason).toContain('TTL');
  });
});
