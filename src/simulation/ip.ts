/**
 * IPv4 layer: accepts, forwards or drops inbound IP packets.
 *
 * Routing uses the node's routing table with longest-prefix match.
 * Connected routes derive from interface prefixes; routers may add
 * static routes. TTL decrements on every router hop.
 *
 * Forwarding is ARP-gated: after the route is chosen, the frame only
 * leaves once the NEXT HOP's MAC is known. On a cache miss the packet is
 * parked while the router ARPs for the neighbor (or drops it after a
 * bounded wait if nobody answers) — the same real behavior hosts get
 * from transmitResolved, so cross-subnet traffic is never faked.
 *
 * Every decision emits a rich ROUTE_LOOKUP event: destination, every
 * matching route with its prefix length, the selected route, next hop
 * and egress interface — the exact data the "How did the router
 * decide?" panel renders.
 */

import type { Packet } from '../models/packet';
import type { Node } from '../models/topology';
import type { HandlerContext } from './stack';
import { lookupRoute, matchingRoutes } from '../models/routing';
import type { Ipv4Address } from '../models/ipv4';
import type { TransportPayload } from '../models/ip';
import { tcpInbound } from './tcp';
import { udpInbound } from './dns';
import { icmpInbound } from './icmp';

export function ipInbound(packet: Packet, ctx: HandlerContext, node: Node): void {
  const payload = packet.frame.payload;
  if (payload.kind !== 'ip') return;
  const ip = payload.ip;

  const myIps = node.interfaces.map((i) => i.ip).filter((x): x is Ipv4Address => x !== undefined);
  const forMe = myIps.includes(ip.destination);

  if (forMe) {
    deliverLocal(packet, ctx, node, ip.payload);
    return;
  }

  if (node.kind !== 'router') {
    ctx.emit({ type: 'PACKET_DROPPED', ts: ctx.now(), nodeId: node.id, packetId: packet.id, reason: 'Destination IP is not mine' });
    return;
  }

  const table = ctx.routingTable(node.id);
  const match = lookupRoute(table, ip.destination);
  if (!match) {
    const candidates = matchingRoutes(table, ip.destination);
    ctx.emit({
      type: 'ROUTE_LOOKUP',
      ts: ctx.now(),
      nodeId: node.id,
      packetId: packet.id,
      destination: ip.destination,
      matched: 'no match',
      via: '—',
      allMatches: candidates.map(toLookupCandidate)
    });
    ctx.emit({ type: 'PACKET_DROPPED', ts: ctx.now(), nodeId: node.id, packetId: packet.id, reason: 'No route to host' });
    return;
  }

  const candidates = matchingRoutes(table, ip.destination);
  ctx.emit({
    type: 'ROUTE_LOOKUP',
    ts: ctx.now(),
    nodeId: node.id,
    packetId: packet.id,
    destination: ip.destination,
    matched: `${match.entry.destination}/${match.entry.prefix}`,
    via: match.entry.nextHop ?? 'on-link',
    prefixLength: match.entry.prefix,
    interfaceId: match.entry.interfaceId,
    nextHops: [match.nextHopIp],
    allMatches: candidates.map(toLookupCandidate)
  });

  const newTtl = ip.ttl - 1;
  if (newTtl <= 0) {
    ctx.emit({ type: 'PACKET_DROPPED', ts: ctx.now(), nodeId: node.id, packetId: packet.id, reason: 'TTL expired in transit' });
    return;
  }

  const outIface = node.interfaces.find((i) => i.id === match.interfaceId);
  if (outIface === undefined || !outIface.enabled) {
    ctx.emit({ type: 'PACKET_DROPPED', ts: ctx.now(), nodeId: node.id, packetId: packet.id, reason: 'Egress interface unavailable' });
    return;
  }

  ctx.emit({
    type: 'PACKET_FORWARDED',
    ts: ctx.now(),
    nodeId: node.id,
    packetId: packet.id,
    via: match.entry.nextHop ?? 'on-link',
    reason: `route ${match.entry.destination}/${match.entry.prefix}`
  });

  // The forwarded packet leaves only when the NEXT HOP's MAC is known.
  // transmitResolved parks the packet and ARPs for the neighbor on a
  // cache miss — the same unresolved-destination behavior hosts have.
  const forwarded = { ...packet, frame: { ...packet.frame, payload: { kind: 'ip' as const, ip: { ...ip, ttl: newTtl } } } };
  ctx.transmitResolved(forwarded, node.id, match.nextHopIp, `routed to ${ip.destination} via ${match.entry.nextHop ?? 'on-link'}`, match.interfaceId);
}

function toLookupCandidate(entry: {
  destination: Ipv4Address;
  prefix: number;
  origin: string;
  interfaceId: string;
  nextHop?: Ipv4Address;
}): { destination: string; prefix: number; origin: string; interfaceId: string; nextHop?: string } {
  return {
    destination: entry.destination,
    prefix: entry.prefix,
    origin: entry.origin,
    interfaceId: entry.interfaceId,
    ...(entry.nextHop !== undefined ? { nextHop: entry.nextHop } : {})
  };
}

function deliverLocal(packet: Packet, ctx: HandlerContext, node: Node, payload: TransportPayload): void {
  switch (payload.kind) {
    case 'tcp':
      tcpInbound(packet, ctx, node, payload);
      break;
    case 'udp':
      udpInbound(packet, ctx, node, payload);
      break;
    case 'icmp':
      icmpInbound(packet, ctx, node, payload);
      break;
  }
}
