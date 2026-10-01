/**
 * Packet builders: canonical factories for frames and every protocol
 * payload. Packet ids/serials are deterministic per scenario run because
 * the engine resets counters before each run.
 */

import type { EthernetFrame, EtherType, Payload } from '../models/ethernet';
import type { ArpPacket } from '../models/arp';
import type { IpPacket, TransportPayload } from '../models/ip';
import type { TcpSegment, TcpFlags } from '../models/tcp';
import type { UdpDatagram } from '../models/udp';
import type { DnsMessage, DnsRecordType } from '../models/dns';
import type { HttpMessage } from '../models/http';
import type { Packet, PacketHop } from '../models/packet';
import type { Ipv4Address } from '../models/ipv4';
import type { MacAddress } from '../models/mac';
import { mac as makeMac } from '../models/mac';

let nextSerial = 1;
let nextId = 1;

export function resetBuilders(): void {
  nextSerial = 1;
  nextId = 1;
}

function nextPacketId(): string {
  return `pkt-${nextId++}`;
}

export function buildFrame(input: {
  source: MacAddress;
  destination: MacAddress;
  etherType: EtherType;
  payload: Payload;
}): EthernetFrame {
  return {
    kind: 'frame',
    source: input.source,
    destination: input.destination,
    etherType: input.etherType,
    payload: input.payload
  };
}

export function buildPacket(frame: EthernetFrame, bornMs: number): Packet {
  return {
    id: nextPacketId(),
    serial: nextSerial++,
    frame,
    hops: [],
    state: 'queued',
    bornMs
  };
}

export function withHops(packet: Packet, hops: readonly PacketHop[]): Packet {
  return { ...packet, hops };
}

export function buildArpRequest(targetIp: Ipv4Address, senderIp: Ipv4Address, senderMac: MacAddress): ArpPacket {
  return {
    kind: 'arp',
    operation: 'request',
    senderIp,
    senderMac,
    targetIp
  };
}

export function buildArpReplyPacket(
  myIp: Ipv4Address,
  myMac: MacAddress,
  request: ArpPacket
): ArpPacket {
  return {
    kind: 'arp',
    operation: 'reply',
    senderIp: myIp,
    senderMac: myMac,
    targetIp: request.senderIp,
    targetMac: request.senderMac
  };
}

export function buildIpPacket(input: {
  source: Ipv4Address;
  destination: Ipv4Address;
  ttl: number;
  protocol: 'icmp' | 'tcp' | 'udp';
  payload: TransportPayload;
}): IpPacket {
  return {
    kind: 'ip',
    source: input.source,
    destination: input.destination,
    ttl: input.ttl,
    protocol: input.protocol,
    payload: input.payload
  };
}

const defaultFlags: TcpFlags = { syn: false, ack: false, fin: false, rst: false, psh: false };

export function buildTcpSegment(input: {
  sourcePort: number;
  destinationPort: number;
  sequence: number;
  acknowledgment: number;
  flags: Partial<TcpFlags>;
  window: number;
  payload?: import('../models/tcp').TcpPayload;
}): TcpSegment {
  return {
    kind: 'tcp',
    sourcePort: input.sourcePort,
    destinationPort: input.destinationPort,
    sequence: input.sequence,
    acknowledgment: input.acknowledgment,
    flags: { ...defaultFlags, ...input.flags },
    window: input.window,
    ...(input.payload !== undefined ? { payload: input.payload } : {})
  };
}

export function buildUdpDatagram(
  sourcePort: number,
  destinationPort: number,
  payload: DnsMessage
): UdpDatagram {
  return { kind: 'udp', sourcePort, destinationPort, payload };
}

export function buildDnsQuery(id: number, name: string, type: DnsRecordType = 'A'): DnsMessage {
  return { kind: 'dns', transactionId: id, isResponse: false, questions: [{ name, type }] };
}

export function buildDnsResponse(
  id: number,
  name: string,
  address: string,
  ttl = 300,
  type: import('../models/dns').DnsRecordType = 'A'
): DnsMessage {
  return {
    kind: 'dns',
    transactionId: id,
    isResponse: true,
    questions: [{ name, type }],
    // An empty address means "name does not exist" — no answers section.
    ...(address !== '' ? { answers: [{ name, type, value: address, ttl }] } : {})
  };
}

export function buildHttpRequest(method: 'GET', path: string, host: string): HttpMessage {
  return {
    kind: 'request',
    method,
    path,
    version: 'HTTP/1.1',
    headers: { Host: host, Connection: 'close', 'User-Agent': 'NPVL/1.0' }
  };
}

export function buildHttpResponse(
  status: 200 | 404,
  reason: string,
  body: string,
  contentType: string
): HttpMessage {
  return {
    kind: 'response',
    status,
    reason,
    version: 'HTTP/1.1',
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(body.length),
      Connection: 'close'
    },
    body
  };
}

export function makeHop(linkId: string, from: string, to: string, startMs: number, endMs: number): PacketHop {
  return { linkId, fromInterface: from, toInterface: to, startMs, endMs };
}

export const LOOPBACK_MAC = makeMac('02:00:00:00:ff:ff');
