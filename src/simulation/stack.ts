/**
 * Protocol stack: dispatches inbound frames to protocol handlers.
 *
 * The engine attaches the receiving node/interface to the context
 * (receiverOf); this module unwraps it and routes by payload type.
 * Adding a protocol means adding a case here — nothing else changes.
 */

import type { Packet } from '../models/packet';
import type { Node, NetworkInterface } from '../models/topology';
import { arpInbound } from './arp';
import { ipInbound } from './ip';
import type { SimulationEvent } from '../models/events';
import type { RoutingTable } from '../models/routing';
import type { Ipv4Address } from '../models/ipv4';
import type { MacAddress } from '../models/mac';
import type { DnsRecord, DnsRecordType } from '../models/dns';
import type { TcpStateName } from '../models/tcp';

/** Result of a DNS cache probe: found-but-expired entries carry expired. */
export interface DnsLookupResult {
  readonly record: DnsRecord;
  readonly writtenAtMs: number;
  readonly authoritative: boolean;
  readonly expired: boolean;
}

/**
 * Structural mirror of the engine's context. Keeping the stack decoupled
 * from the engine module avoids a cyclic import while staying type-safe.
 */
export interface HandlerContext {
  now(): number;
  emit(event: SimulationEvent): void;
  transmit(frame: Packet['frame'], fromNodeId: string, fromInterfaceId: string): void;
  after(delayMs: number, handler: (ctx: HandlerContext) => void): void;
  routingTable(nodeId: string): RoutingTable;
  arpGet(nodeId: string, ip: Ipv4Address): MacAddress | undefined;
  arpSet(nodeId: string, ip: Ipv4Address, mac: MacAddress): void;
  /** Probe a node's DNS cache; the entry carries expired=true past its TTL. */
  dnsGet(nodeId: string, name: string, recordType: DnsRecordType): DnsLookupResult | undefined;
  /** Write a learned record into a node's DNS cache (emits DNS_CACHE_WRITE). */
  dnsSet(nodeId: string, record: DnsRecord): void;
  setTcpState(nodeId: string, connectionId: string, state: { localPort: number; remotePort: number; state: string; role: 'client' | 'server'; seq?: number; ack?: number; window?: number }): void;
  /** Probe an endpoint's current TCP state (state-machine guards). */
  tcpGet(nodeId: string, connectionId: string): { state: TcpStateName; seq?: number; ack?: number; window?: number } | undefined;
  /** ARP-gated egress: resolve next hop from cache or park + broadcast ARP. */
  transmitResolved(
    packet: Packet,
    fromNodeId: string,
    nextHopIp: Ipv4Address,
    description: string,
    /** Explicit egress (e.g. the route's interface); auto-selected when omitted. */
    egressInterfaceId?: string
  ): void;
  /** Receiver attachment (set by the engine at delivery time). */
  __receiver?: { node: Node; iface: NetworkInterface };
}

export type FrameHandler = (packet: Packet, ctx: HandlerContext) => void;

export const defaultStack = {
  onFrame: (packet: Packet, ctx: HandlerContext): void => {
    const receiver = ctx.__receiver;
    if (receiver === undefined) return;
    const { node, iface } = receiver;

    const payload = packet.frame.payload;
    switch (payload.kind) {
      case 'arp':
        arpInbound(packet, ctx, node, iface);
        break;
      case 'ip':
        ipInbound(packet, ctx, node);
        break;
    }
  }
};

export type ProtocolStack = typeof defaultStack;
