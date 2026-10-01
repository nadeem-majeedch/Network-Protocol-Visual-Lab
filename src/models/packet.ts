/**
 * Canonical packet model.
 *
 * A `Packet` is the single unit that moves through the simulated network.
 * It carries an immutable, structurally-shared snapshot of every protocol
 * layer it contains, so the inspector and visualizer can render any layer
 * at any time without touching simulation internals.
 *
 * All fields are serializable: no functions, no class instances, no Maps.
 */

import type { EthernetFrame } from './ethernet';

export type PacketId = string;

export interface PacketHop {
  readonly linkId: string;
  readonly fromInterface: string;
  readonly toInterface: string;
  readonly startMs: number;
  readonly endMs: number;
}

export type PacketState = 'queued' | 'in-flight' | 'delivered' | 'dropped' | 'expired';

export interface Packet {
  readonly id: PacketId;
  /** Monotonic serial for readable inspector titles like #7. */
  readonly serial: number;
  readonly frame: EthernetFrame;
  readonly hops: readonly PacketHop[];
  readonly state: PacketState;
  /** Sim-ms when the packet was created. */
  readonly bornMs: number;
  /** Sim-ms when it reached its final state. */
  readonly finishedMs?: number;
  /** Human-readable reason when dropped/expired. */
  readonly dropReason?: string;
}

export interface PacketRef {
  readonly id: PacketId;
  readonly serial: number;
  /** Short protocol label of the payload: ARP, IPv4+TCP, ... */
  readonly protocol: string;
  readonly summary: string;
}

export function packetProtocolLabel(frame: EthernetFrame): string {
  switch (frame.payload.kind) {
    case 'arp':
      return 'ARP';
    case 'ip': {
      const p = frame.payload.ip.payload;
      switch (p.kind) {
        case 'tcp':
          return 'IPv4 + TCP';
        case 'udp':
          return 'IPv4 + UDP';
        case 'icmp':
          return 'IPv4 + ICMP';
        default:
          return 'IPv4';
      }
    }
  }
}

export function packetSummary(frame: EthernetFrame): string {
  switch (frame.payload.kind) {
    case 'arp': {
      const arp = frame.payload.arp;
      return arp.operation === 'request'
        ? `Who has ${arp.targetIp}?`
        : `${arp.senderIp} is at ${arp.senderMac}`;
    }
    case 'ip': {
      const ip = frame.payload.ip;
      switch (ip.payload.kind) {
        case 'tcp': {
          const seg = ip.payload;
          const flags = [seg.flags.syn && 'SYN', seg.flags.ack && 'ACK', seg.flags.fin && 'FIN'].filter(Boolean).join(',');
          const app = seg.payload;
          if (app !== undefined && app.kind === 'request') return `GET ${app.path} [${flags || 'data'}]`;
          if (app !== undefined && app.kind === 'response') return `${app.status} ${app.reason} [${flags || 'data'}]`;
          if (app !== undefined && app.kind === 'data') return `"${app.text}" [${flags || 'data'}]`;
          return `${ip.source} → ${ip.destination} [${flags || 'data'}]`;
        }
        case 'udp': {
          const udp = ip.payload;
          if (udp.payload.kind === 'dns') {
            const dns = udp.payload;
            return dns.isResponse ? `DNS answer for ${dns.questions[0]?.name ?? '?'}` : `DNS query ${dns.questions[0]?.name ?? '?'}`;
          }
          return `UDP ${udp.sourcePort} → ${udp.destinationPort}`;
        }
        case 'icmp':
          return `ICMP ${ip.payload.type}`;
        default:
          return `${ip.source} → ${ip.destination}`;
      }
    }
  }
}
