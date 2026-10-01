/**
 * Simulation event model — the canonical event vocabulary.
 *
 * Every observable change in the engine is recorded as a SimulationEvent.
 * Events are append-only, serializable, and replayable: the recorded log
 * is the single source for the timeline, animation and inspector.
 *
 * Types use the canonical SCREAMING_CASE protocol vocabulary so the
 * timeline reads like a packet trace (PACKET_SENT, ARP_REQUEST, …).
 */

import type { Ipv4Address } from './ipv4';
import type { MacAddress } from './mac';
import type { TcpStateName } from './tcp';

export type { TcpStateName } from './tcp';

export type SimulationEvent =
  // Topology lifecycle
  | { readonly type: 'NODE_CREATED'; readonly ts: number; readonly nodeId: string; readonly kind: string; readonly name: string }
  | { readonly type: 'LINK_CREATED'; readonly ts: number; readonly linkId: string; readonly a: string; readonly b: string }

  // Packet lifecycle
  | { readonly type: 'PACKET_CREATED'; readonly ts: number; readonly packetId: string; readonly serial: number; readonly protocol: string }
  | { readonly type: 'PACKET_SENT'; readonly ts: number; readonly nodeId: string; readonly interfaceId: string; readonly packetId: string; readonly protocol: string; readonly summary: string }
  | { readonly type: 'PACKET_RECEIVED'; readonly ts: number; readonly nodeId: string; readonly interfaceId: string; readonly packetId: string; readonly protocol: string }
  | { readonly type: 'PACKET_DROPPED'; readonly ts: number; readonly nodeId: string; readonly packetId: string; readonly reason: string }
  | { readonly type: 'PACKET_FORWARDED'; readonly ts: number; readonly nodeId: string; readonly packetId: string; readonly via: string; readonly reason: string }

  // Routing / ARP
  | { readonly type: 'ROUTE_LOOKUP'; readonly ts: number; readonly nodeId: string; readonly packetId: string; readonly destination: string; readonly matched: string; readonly via: string; readonly prefixLength?: number; readonly allMatches?: readonly { readonly destination: string; readonly prefix: number; readonly origin: string; readonly interfaceId: string; readonly nextHop?: string }[]; readonly interfaceId?: string; readonly nextHops?: readonly string[] }
  | { readonly type: 'ARP_REQUEST'; readonly ts: number; readonly nodeId: string; readonly packetId: string; readonly senderIp: string; readonly targetIp: string }
  | { readonly type: 'ARP_REPLY'; readonly ts: number; readonly nodeId: string; readonly packetId: string; readonly senderIp: string; readonly senderMac: string }
  | { readonly type: 'ARP_LEARN'; readonly ts: number; readonly nodeId: string; readonly ip: Ipv4Address; readonly mac: MacAddress }
  | { readonly type: 'ARP_WRITE'; readonly ts: number; readonly nodeId: string; readonly ip: Ipv4Address; readonly mac: MacAddress }

  // DNS
  | { readonly type: 'DNS_QUERY'; readonly ts: number; readonly nodeId: string; readonly packetId: string; readonly name: string; readonly recordType: string }
  | { readonly type: 'DNS_RESPONSE'; readonly ts: number; readonly nodeId: string; readonly packetId: string; readonly name: string; readonly address: string; readonly ttl: number }
  | { readonly type: 'DNS_CACHE_LOOKUP'; readonly ts: number; readonly nodeId: string; readonly name: string; readonly recordType: string; readonly hit: boolean; readonly expired: boolean; readonly value?: string }
  | { readonly type: 'DNS_CACHE_WRITE'; readonly ts: number; readonly nodeId: string; readonly name: string; readonly recordType: string; readonly value: string; readonly ttl: number; readonly expiresAtMs: number; readonly authoritative: boolean }
  | { readonly type: 'DNS_RECURSE'; readonly ts: number; readonly nodeId: string; readonly packetId: string; readonly name: string; readonly recordType: string; readonly serverIp: string; readonly reason: string }
  | { readonly type: 'DNS_NXDOMAIN'; readonly ts: number; readonly nodeId: string; readonly packetId: string; readonly name: string; readonly recordType: string; readonly reason: string }

  // TCP
  | { readonly type: 'TCP_STATE_CHANGE'; readonly ts: number; readonly nodeId: string; readonly connectionId: string; readonly from: TcpStateName; readonly to: TcpStateName; readonly trigger: string; readonly role: 'client' | 'server'; readonly seq?: number; readonly ack?: number; readonly window?: number; readonly flags?: string }

  // HTTP
  | { readonly type: 'HTTP_REQUEST'; readonly ts: number; readonly nodeId: string; readonly packetId: string; readonly method: string; readonly path: string; readonly host: string }
  | { readonly type: 'HTTP_RESPONSE'; readonly ts: number; readonly nodeId: string; readonly packetId: string; readonly status: number; readonly reason: string; readonly contentType: string }

  // Teaching annotations
  | { readonly type: 'NOTE'; readonly ts: number; readonly nodeId: string; readonly message: string };

export interface EventLog {
  readonly events: readonly SimulationEvent[];
}

/** One-line human text for the timeline. */
export function describeEvent(event: SimulationEvent): string {
  switch (event.type) {
    case 'NODE_CREATED':
      return `${event.kind} “${event.name}” added to the network`;
    case 'LINK_CREATED':
      return `Link established between ${event.a} and ${event.b}`;
    case 'PACKET_CREATED':
      return `Packet #${event.serial} created (${event.protocol})`;
    case 'PACKET_SENT':
      return `${event.nodeId} sent ${event.protocol} — ${event.summary}`;
    case 'PACKET_RECEIVED':
      return `${event.nodeId} received ${event.protocol}`;
    case 'PACKET_DROPPED':
      return `${event.nodeId} dropped packet: ${event.reason}`;
    case 'PACKET_FORWARDED':
      return `${event.nodeId} forwarded toward ${event.via} (${event.reason})`;
    case 'ROUTE_LOOKUP':
      return `${event.nodeId} route lookup ${event.destination} → ${event.matched} via ${event.via}`;
    case 'ARP_REQUEST':
      return `${event.nodeId} broadcasts: who has ${event.targetIp}?`;
    case 'ARP_REPLY':
      return `${event.nodeId} replies: ${event.senderIp} is at ${event.senderMac}`;
    case 'ARP_LEARN':
      return `${event.nodeId} learned ${event.ip} is at ${event.mac}`;
    case 'ARP_WRITE':
      return `${event.nodeId} cached ${event.ip} ⇔ ${event.mac}`;
    case 'DNS_QUERY':
      return `${event.nodeId} queries ${event.recordType} ${event.name}`;
    case 'DNS_RESPONSE':
      return `${event.nodeId} answered: ${event.name} is ${event.address} (ttl ${event.ttl})`;
    case 'DNS_CACHE_LOOKUP':
      return event.hit
        ? `${event.nodeId} cache HIT for ${event.name}/${event.recordType} → ${event.value ?? 'value'}${event.expired ? ' (expired — refetching)' : ''}`
        : `${event.nodeId} cache MISS for ${event.name}/${event.recordType} — asking the resolver`;
    case 'DNS_CACHE_WRITE':
      return `${event.nodeId} cached ${event.name}/${event.recordType} → ${event.value} (ttl ${event.ttl}, valid ${event.expiresAtMs - event.ts} ms)`;
    case 'DNS_RECURSE':
      return `${event.nodeId} recursing to ${event.serverIp} for ${event.name}/${event.recordType} (${event.reason})`;
    case 'DNS_NXDOMAIN':
      return `${event.nodeId}: ${event.name}/${event.recordType} does not exist (${event.reason})`;
    case 'TCP_STATE_CHANGE':
      return `${event.nodeId} ${event.connectionId}: ${event.from} → ${event.to} (${event.trigger})`;
    case 'HTTP_REQUEST':
      return `${event.nodeId} ${event.method} ${event.path} (Host: ${event.host})`;
    case 'HTTP_RESPONSE':
      return `${event.nodeId} responded ${event.status} ${event.reason} (${event.contentType})`;
    case 'NOTE':
      return event.message;
  }
}

/**
 * Structured, inspectable fields for the event inspector.
 * Order is presentation-stable; every event is inspectable through this.
 */
export function eventFields(event: SimulationEvent): readonly { name: string; value: string }[] {
  const fields: { name: string; value: string }[] = [
    { name: 'Event', value: event.type },
    { name: 'Time', value: `${event.ts} ms` }
  ];
  switch (event.type) {
    case 'NODE_CREATED':
      fields.push({ name: 'Node id', value: event.nodeId }, { name: 'Kind', value: event.kind }, { name: 'Name', value: event.name });
      break;
    case 'LINK_CREATED':
      fields.push({ name: 'Link id', value: event.linkId }, { name: 'Endpoint A', value: event.a }, { name: 'Endpoint B', value: event.b });
      break;
    case 'PACKET_CREATED':
      fields.push({ name: 'Packet', value: `#${event.serial} (${event.packetId})` }, { name: 'Protocol', value: event.protocol });
      break;
    case 'PACKET_SENT':
      fields.push({ name: 'Node', value: event.nodeId }, { name: 'Interface', value: event.interfaceId }, { name: 'Packet', value: event.packetId }, { name: 'Protocol', value: event.protocol }, { name: 'Summary', value: event.summary });
      break;
    case 'PACKET_RECEIVED':
      fields.push({ name: 'Node', value: event.nodeId }, { name: 'Interface', value: event.interfaceId }, { name: 'Packet', value: event.packetId }, { name: 'Protocol', value: event.protocol });
      break;
    case 'PACKET_DROPPED':
      fields.push({ name: 'Node', value: event.nodeId }, { name: 'Packet', value: event.packetId }, { name: 'Reason', value: event.reason });
      break;
    case 'PACKET_FORWARDED':
      fields.push({ name: 'Node', value: event.nodeId }, { name: 'Packet', value: event.packetId }, { name: 'Via', value: event.via }, { name: 'Reason', value: event.reason });
      break;
    case 'ROUTE_LOOKUP': {
      fields.push({ name: 'Node', value: event.nodeId }, { name: 'Packet', value: event.packetId }, { name: 'Destination', value: event.destination }, { name: 'Matched', value: event.matched }, { name: 'Via', value: event.via });
      if (event.prefixLength !== undefined) fields.push({ name: 'Prefix length', value: `/${event.prefixLength}` });
      if (event.interfaceId !== undefined) fields.push({ name: 'Interface', value: event.interfaceId });
      if (event.nextHops !== undefined) {
        for (const hop of event.nextHops) fields.push({ name: 'Next hop', value: hop });
      }
      if (event.allMatches !== undefined) {
        for (const [i, m] of event.allMatches.entries()) {
          fields.push({
            name: `Matching route ${i + 1}`,
            value: `${m.destination}/${m.prefix} (${m.origin}) via ${m.nextHop ?? 'on-link'} out ${m.interfaceId}`
          });
        }
      }
      break;
    }
    case 'ARP_REQUEST':
      fields.push({ name: 'Node', value: event.nodeId }, { name: 'Packet', value: event.packetId }, { name: 'Sender IP', value: event.senderIp }, { name: 'Target IP', value: event.targetIp });
      break;
    case 'ARP_REPLY':
      fields.push({ name: 'Node', value: event.nodeId }, { name: 'Packet', value: event.packetId }, { name: 'Sender IP', value: event.senderIp }, { name: 'Sender MAC', value: event.senderMac });
      break;
    case 'ARP_LEARN':
    case 'ARP_WRITE':
      fields.push({ name: 'Node', value: event.nodeId }, { name: 'IP', value: event.ip }, { name: 'MAC', value: event.mac });
      break;
    case 'DNS_QUERY':
      fields.push({ name: 'Node', value: event.nodeId }, { name: 'Packet', value: event.packetId }, { name: 'Query name', value: event.name }, { name: 'Record type', value: event.recordType });
      break;
    case 'DNS_RESPONSE':
      fields.push({ name: 'Node', value: event.nodeId }, { name: 'Packet', value: event.packetId }, { name: 'Answer', value: event.name }, { name: 'Address', value: event.address }, { name: 'TTL', value: String(event.ttl) });
      break;
    case 'DNS_CACHE_LOOKUP':
      fields.push({ name: 'Node', value: event.nodeId }, { name: 'Query name', value: event.name }, { name: 'Record type', value: event.recordType }, { name: 'Result', value: event.hit ? 'hit' : 'miss' });
      if (event.value !== undefined) fields.push({ name: 'Value', value: event.value });
      if (event.expired) fields.push({ name: 'Expired', value: 'yes — entry past its TTL' });
      break;
    case 'DNS_CACHE_WRITE':
      fields.push({ name: 'Node', value: event.nodeId }, { name: 'Cached', value: `${event.name}/${event.recordType}` }, { name: 'Value', value: event.value }, { name: 'TTL', value: String(event.ttl) }, { name: 'Valid until', value: `${event.expiresAtMs} ms` }, { name: 'Source', value: event.authoritative ? 'authoritative zone' : 'learned from the wire' });
      break;
    case 'DNS_RECURSE':
      fields.push({ name: 'Node', value: event.nodeId }, { name: 'Packet', value: event.packetId }, { name: 'Query name', value: event.name }, { name: 'Record type', value: event.recordType }, { name: 'Server', value: event.serverIp }, { name: 'Reason', value: event.reason });
      break;
    case 'DNS_NXDOMAIN':
      fields.push({ name: 'Node', value: event.nodeId }, { name: 'Packet', value: event.packetId }, { name: 'Query name', value: event.name }, { name: 'Record type', value: event.recordType }, { name: 'Reason', value: event.reason });
      break;
    case 'TCP_STATE_CHANGE':
      fields.push({ name: 'Node', value: event.nodeId }, { name: 'Connection', value: event.connectionId }, { name: 'From', value: event.from }, { name: 'To', value: event.to }, { name: 'Trigger', value: event.trigger });
      break;
    case 'HTTP_REQUEST':
      fields.push({ name: 'Node', value: event.nodeId }, { name: 'Packet', value: event.packetId }, { name: 'Method', value: event.method }, { name: 'Path', value: event.path }, { name: 'Host header', value: event.host });
      break;
    case 'HTTP_RESPONSE':
      fields.push({ name: 'Node', value: event.nodeId }, { name: 'Packet', value: event.packetId }, { name: 'Status', value: `${event.status} ${event.reason}` }, { name: 'Content-Type', value: event.contentType });
      break;
    case 'NOTE':
      fields.push({ name: 'Node', value: event.nodeId }, { name: 'Message', value: event.message });
      break;
  }
  return fields;
}

/** CSS class fragment for timeline coloring. */
export function eventKind(event: SimulationEvent): string {
  switch (event.type) {
    case 'PACKET_DROPPED':
      return 'drop';
    case 'PACKET_SENT':
    case 'PACKET_CREATED':
      return 'tx';
    case 'PACKET_RECEIVED':
      return 'rx';
    case 'PACKET_FORWARDED':
    case 'ROUTE_LOOKUP':
      return 'forward';
    case 'ARP_REQUEST':
    case 'ARP_REPLY':
    case 'ARP_LEARN':
    case 'ARP_WRITE':
    case 'DNS_QUERY':
    case 'DNS_RESPONSE':
    case 'DNS_CACHE_LOOKUP':
    case 'DNS_CACHE_WRITE':
    case 'DNS_RECURSE':
    case 'DNS_NXDOMAIN':
    case 'TCP_STATE_CHANGE':
    case 'HTTP_REQUEST':
    case 'HTTP_RESPONSE':
      return 'proto';
    default:
      return 'info';
  }
}
