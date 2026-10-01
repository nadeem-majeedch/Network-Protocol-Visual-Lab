/**
 * DNS protocol implementation over UDP (RFC 1034/1035 shape, simplified).
 *
 * Roles:
 *  - Authoritative servers answer strictly from their static zone — the
 *    recursive workhorse. Zone records carry record type and TTL;
 *    A/AAAA/CNAME/MX are all supported.
 *  - The resolver (service 'dns-resolver'):
 *      1. probes its own cache (ttl-aware, emits DNS_CACHE_LOOKUP),
 *      2. answers fresh hits directly with the REMAINING ttl,
 *      3. on a miss (or expired entry) recurses to the authoritative
 *         server over real routed UDP (DNS_RECURSE), chases CNAME chains,
 *      4. caches every learned record (DNS_CACHE_WRITE via ctx.dnsSet)
 *         and answers the original client.
 *  - Clients cache the answers they receive (ctx.dnsSet), so repeat
 *    queries can be served without the wire at all (runner probes first).
 *
 * Unknown names produce NXDOMAIN (DNS_NXDOMAIN). No external queries:
 * everything is fixed zone data + cache + simulated wire, deterministic.
 */

import type { Packet } from '../models/packet';
import type { Node, NetworkInterface } from '../models/topology';
import type { HandlerContext } from './stack';
import type { UdpDatagram } from '../models/udp';
import type { DnsMessage, DnsRecord, DnsRecordType } from '../models/dns';
import { buildFrame, buildUdpDatagram, buildDnsResponse, buildDnsQuery } from './builder';
import type { IpPacket } from '../models/ip';
import { ipv4 } from '../models/ipv4';

export interface DnsZoneRecord {
  readonly type: DnsRecordType;
  readonly value: string;
  readonly ttl: number;
}

/** Zone data keyed by authoritative server node id. Fixed → deterministic.
 * TTLs are in sim milliseconds (the whole lab clock is compressed), so
 * short-TTL records let the TTL-expiry lesson play out inside one run. */
const dnsZones: Readonly<Record<string, Readonly<Record<string, DnsZoneRecord>>>> = {
  'dns-server': {
    'www.example.com': { type: 'A', value: '203.0.113.10', ttl: 300 },
    'example.com': { type: 'A', value: '203.0.113.10', ttl: 300 }
  },
  'http-dns': {
    'www.example.com': { type: 'A', value: '192.168.9.80', ttl: 300 },
    'example.com': { type: 'A', value: '192.168.9.80', ttl: 300 }
  },
  'dns-auth': {
    'www.example.com': { type: 'A', value: '93.184.216.34', ttl: 600 },
    'example.com': { type: 'A', value: '93.184.216.34', ttl: 600 },
    'cdn.example.com': { type: 'CNAME', value: 'www.example.com', ttl: 400 },
    'short.example.com': { type: 'A', value: '93.184.216.99', ttl: 80 },
    'example.net': { type: 'MX', value: '10 mail.example.net', ttl: 800 },
    'v6.example.com': { type: 'AAAA', value: '2606:2800:220:1:248:1893:25c8:1946', ttl: 600 }
  },
  'dns-auth-cname': {
    'cdn.example.com': { type: 'CNAME', value: 'www.example.com', ttl: 400 }
  },
  'web-dns': {
    'example.local': { type: 'A', value: '172.30.0.20', ttl: 600 },
    'www.example.local': { type: 'A', value: '172.30.0.20', ttl: 600 }
  }
};

/** Static recursion plan: resolver node id → authoritative server. */
const resolverConfig: Readonly<Record<string, { readonly authId: string; readonly authIp: string }>> = {
  'dns-resolver': { authId: 'dns-auth', authIp: '203.0.113.53' },
  'dns-resolver-cname': { authId: 'dns-auth', authIp: '203.0.113.53' }
};

export function udpInbound(packet: Packet, ctx: HandlerContext, node: Node, datagram: UdpDatagram): void {
  if (datagram.payload.kind !== 'dns') return;
  const dns = datagram.payload;

  if (!dns.isResponse) {
    handleQuery(dns, packet, ctx, node, datagram);
    return;
  }
  handleResponse(dns, packet, ctx, node, datagram);
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

function handleQuery(
  dns: DnsMessage,
  packet: Packet,
  ctx: HandlerContext,
  node: Node,
  datagram: UdpDatagram
): void {
  if (node.kind !== 'server') {
    ctx.emit({ type: 'PACKET_DROPPED', ts: ctx.now(), nodeId: node.id, packetId: packet.id, reason: 'UDP/53 not open here' });
    return;
  }
  const question = dns.questions[0];
  if (question === undefined) return;
  ctx.emit({ type: 'DNS_QUERY', ts: ctx.now(), nodeId: node.id, packetId: packet.id, name: question.name, recordType: question.type });

  if ((node as { service?: string }).service === 'dns-resolver') {
    answerFromResolver(question.name, question.type, dns, packet, ctx, node, datagram);
    return;
  }

  // Authoritative: answer strictly from the zone.
  const record = (dnsZones[node.id] ?? {})[question.name];
  if (record === undefined || (record.type !== question.type && record.type !== 'CNAME')) {
    if (record !== undefined && record.type === 'CNAME' && question.type !== 'CNAME') {
      replyWithRecord(dns, packet, ctx, node, datagram, { name: question.name, ...record });
      ctx.emit({ type: 'DNS_RESPONSE', ts: ctx.now(), nodeId: node.id, packetId: packet.id, name: question.name, address: record.value, ttl: record.ttl });
      return;
    }
    ctx.emit({
      type: 'DNS_NXDOMAIN',
      ts: ctx.now(),
      nodeId: node.id,
      packetId: packet.id,
      name: question.name,
      recordType: question.type,
      reason: `${question.name}/${question.type} is not in this zone`
    });
    replyUdp(withRecursionOrigin(buildDnsResponse(dns.transactionId, question.name, '', 0), dns), packet, ctx, node, datagram);
    return;
  }
  replyWithRecord(dns, packet, ctx, node, datagram, { name: question.name, ...record });
  ctx.emit({ type: 'DNS_RESPONSE', ts: ctx.now(), nodeId: node.id, packetId: packet.id, name: question.name, address: record.value, ttl: record.ttl });
}

/**
 * Echo the recursion origin onto an authoritative reply so the resolver
 * can continue the chain toward the original client.
 */
function withRecursionOrigin(response: DnsMessage, query: DnsMessage): DnsMessage {
  // Stamp the ORIGINAL question so the resolver can tell an A-answer from
  // a CNAME-alias answer and keep chasing; plus the recursion origin.
  const withQuestion: DnsMessage = { ...response, questions: query.questions };
  if (query.originalClient === undefined) return withQuestion;
  return {
    ...withQuestion,
    originalClient: query.originalClient,
    ...(query.originalClientPort !== undefined ? { originalClientPort: query.originalClientPort } : {})
  };
}

function answerFromResolver(
  name: string,
  type: DnsRecordType,
  dns: DnsMessage,
  packet: Packet,
  ctx: HandlerContext,
  node: Node,
  datagram: UdpDatagram
): void {
  // 1. Cache lookup — a fresh entry short-circuits the recursion entirely.
  const cached = ctx.dnsGet(node.id, name, type);
  const expired = cached?.expired === true;
  ctx.emit({
    type: 'DNS_CACHE_LOOKUP',
    ts: ctx.now(),
    nodeId: node.id,
    name,
    recordType: type,
    hit: cached !== undefined,
    expired,
    ...(cached !== undefined ? { value: cached.record.value } : {})
  });
  if (cached !== undefined && !expired) {
    const remaining = Math.max(1, cached.record.ttl - (ctx.now() - cached.writtenAtMs));
    replyUdp(buildDnsResponse(dns.transactionId, name, cached.record.value, remaining, type), packet, ctx, node, datagram);
    ctx.emit({ type: 'DNS_RESPONSE', ts: ctx.now(), nodeId: node.id, packetId: packet.id, name, address: cached.record.value, ttl: remaining });
    return;
  }

  // 2. The resolver's own zone (usually empty; kept for completeness).
  const local = (dnsZones[node.id] ?? {})[name];
  if (local !== undefined && local.type === type) {
    replyUdp(buildDnsResponse(dns.transactionId, name, local.value, local.ttl, type), packet, ctx, node, datagram);
    ctx.emit({ type: 'DNS_RESPONSE', ts: ctx.now(), nodeId: node.id, packetId: packet.id, name, address: local.value, ttl: local.ttl });
    return;
  }

  // 3. Recurse to the authoritative server over real routed UDP.
  const config = resolverConfig[node.id];
  if (config === undefined) {
    ctx.emit({
      type: 'DNS_NXDOMAIN',
      ts: ctx.now(),
      nodeId: node.id,
      packetId: packet.id,
      name,
      recordType: type,
      reason: 'no authoritative server configured'
    });
    return;
  }
  ctx.emit({
    type: 'DNS_RECURSE',
    ts: ctx.now(),
    nodeId: node.id,
    packetId: packet.id,
    name,
    recordType: type,
    serverIp: config.authIp,
    reason: cached !== undefined ? 'cache entry expired' : 'cache miss'
  });
  sendDnsMessage(
    node,
    { ...buildDnsQuery(dns.transactionId, name, type), originalClient: ipSourceOf(packet), originalClientPort: datagram.sourcePort },
    config.authIp,
    `recursive DNS query for ${name}/${type}`,
    ctx
  );
}

/* ------------------------------------------------------------------ */
/* Responses                                                           */
/* ------------------------------------------------------------------ */

function handleResponse(
  dns: DnsMessage,
  packet: Packet,
  ctx: HandlerContext,
  node: Node,
  _datagram: UdpDatagram
): void {
  const answer = dns.answers?.[0];
  const question = dns.questions[0];
  const name = question?.name ?? answer?.name ?? '';

  // Clients learn and cache; failures are noted, not fatal.
  if (node.kind !== 'server') {
    if (answer === undefined) {
      ctx.emit({ type: 'NOTE', ts: ctx.now(), nodeId: node.id, message: `${node.name}: DNS lookup failed for ${name}` });
    } else {
      ctx.dnsSet(node.id, answer);
      ctx.emit({ type: 'NOTE', ts: ctx.now(), nodeId: node.id, message: `${node.name} learned ${answer.name} → ${answer.value} (ttl ${answer.ttl})` });
    }
    return;
  }

  // Resolver continuation (the recursed reply carries originalClient).
  if (answer !== undefined) {
    ctx.dnsSet(node.id, answer);
    if (answer.type === 'CNAME' && question !== undefined && question.type !== 'CNAME') {
      chaseCname(dns, packet, ctx, node, question.name, answer);
      return;
    }
    const response = buildDnsResponse(dns.transactionId, answer.name, answer.value, answer.ttl, answer.type);
    sendToOriginalClient(dns, response, ctx, node);
    ctx.emit({ type: 'DNS_RESPONSE', ts: ctx.now(), nodeId: node.id, packetId: packet.id, name: answer.name, address: answer.value, ttl: answer.ttl });
    return;
  }

  ctx.emit({
    type: 'DNS_NXDOMAIN',
    ts: ctx.now(),
    nodeId: node.id,
    packetId: packet.id,
    name,
    recordType: question?.type ?? 'A',
    reason: 'authoritative server reported the name does not exist'
  });
  if (dns.originalClient !== undefined) {
    sendToOriginalClient(dns, buildDnsResponse(dns.transactionId, name, '', 0), ctx, node);
  }
}

function chaseCname(
  dns: DnsMessage,
  packet: Packet,
  ctx: HandlerContext,
  node: Node,
  originalName: string,
  cname: DnsRecord
): void {
  const target = cname.value;
  // The alias mapping itself is cached under the original name.
  ctx.dnsSet(node.id, { name: originalName, type: 'CNAME', value: target, ttl: cname.ttl });

  const cachedTarget = ctx.dnsGet(node.id, target, 'A');
  ctx.emit({
    type: 'DNS_CACHE_LOOKUP',
    ts: ctx.now(),
    nodeId: node.id,
    name: target,
    recordType: 'A',
    hit: cachedTarget !== undefined,
    expired: cachedTarget?.expired === true,
    ...(cachedTarget !== undefined ? { value: cachedTarget.record.value } : {})
  });
  if (cachedTarget !== undefined && !cachedTarget.expired) {
    const remaining = Math.max(1, cachedTarget.record.ttl - (ctx.now() - cachedTarget.writtenAtMs));
    const response = buildDnsResponse(dns.transactionId, originalName, cachedTarget.record.value, remaining, 'A');
    sendToOriginalClient(dns, response, ctx, node);
    ctx.emit({ type: 'DNS_RESPONSE', ts: ctx.now(), nodeId: node.id, packetId: packet.id, name: originalName, address: cachedTarget.record.value, ttl: remaining });
    return;
  }

  const config = resolverConfig[node.id];
  if (config === undefined) return;
  ctx.emit({
    type: 'DNS_RECURSE',
    ts: ctx.now(),
    nodeId: node.id,
    packetId: packet.id,
    name: target,
    recordType: 'A',
    serverIp: config.authIp,
    reason: `CNAME ${originalName} → ${target}`
  });
  sendDnsMessage(
    node,
    {
      ...buildDnsQuery(dns.transactionId, target, 'A'),
      originalClient: dns.originalClient ?? ipSourceOf(packet),
      ...(dns.originalClientPort !== undefined ? { originalClientPort: dns.originalClientPort } : {})
    },
    config.authIp,
    `recursive DNS query for ${target}/A (CNAME chase)`,
    ctx
  );
}

/* ------------------------------------------------------------------ */
/* Transport helpers                                                   */
/* ------------------------------------------------------------------ */

function replyWithRecord(
  dns: DnsMessage,
  packet: Packet,
  ctx: HandlerContext,
  node: Node,
  datagram: UdpDatagram,
  record: DnsRecord
): void {
  replyUdp(withRecursionOrigin(buildDnsResponse(dns.transactionId, record.name, record.value, record.ttl, record.type), dns), packet, ctx, node, datagram);
}

function replyUdp(response: DnsMessage, packet: Packet, ctx: HandlerContext, node: Node, datagram: UdpDatagram): void {
  const payload = packet.frame.payload;
  if (payload.kind !== 'ip') return;
  const ip: IpPacket = payload.ip;
  if (ip.payload.kind !== 'udp') return;
  const swap = buildUdpDatagram(ip.payload.destinationPort, ip.payload.sourcePort, response);
  void datagram;
  const iface = firstIface(node);
  const frame = buildFrame({
    source: iface.mac,
    destination: ctx.arpGet(node.id, ip.source) ?? packet.frame.source,
    etherType: 0x0800,
    payload: { kind: 'ip', ip: { ...ip, source: ip.destination, destination: ip.source, payload: swap } }
  });
  ctx.transmit(frame, node.id, iface.id);
}

function sendToOriginalClient(dns: DnsMessage, response: DnsMessage, ctx: HandlerContext, node: Node): void {
  if (dns.originalClient === undefined) return;
  sendDnsMessage(node, response, dns.originalClient, `DNS response for ${response.questions[0]?.name ?? ''}`, ctx, dns.originalClientPort);
}

/** ARP-gated transmission of a DNS message toward `destinationIp`. */
function sendDnsMessage(
  node: Node,
  message: DnsMessage,
  destinationIp: string,
  description: string,
  ctx: HandlerContext,
  destinationPort = 53
): void {
  // Egress = the interface whose subnet contains the destination; the
  // default gateway handles everything else (real host behavior).
  const egress =
    node.interfaces.find((i) => i.enabled && i.ip !== undefined && i.prefix !== undefined && sameSubnet(i.ip, destinationIp, i.prefix)) ??
    firstIface(node);
  const iface = egress;
  if (iface.ip === undefined) return;
  const onLink = iface.prefix !== undefined && sameSubnet(iface.ip, destinationIp, iface.prefix);
  const gateway = (node as { gateway?: string }).gateway;
  const nextHop = onLink || gateway === undefined ? destinationIp : gateway;
  const ipPacket: IpPacket = {
    kind: 'ip',
    source: iface.ip,
    destination: ipv4(destinationIp),
    ttl: 32,
    protocol: 'udp',
    payload: buildUdpDatagram(message.isResponse ? 53 : 40000, destinationPort, message)
  };
  ctx.transmitResolved(
    {
      id: `${message.isResponse ? 'dns-reply' : 'dns-recurse'}-${node.id}-${destinationIp}-${ctx.now()}`,
      serial: 0,
      frame: buildFrame({
        source: iface.mac,
        destination: iface.mac,
        etherType: 0x0800,
        payload: { kind: 'ip', ip: ipPacket }
      }),
      hops: [],
      state: 'queued',
      bornMs: ctx.now()
    },
    node.id,
    ipv4(nextHop),
    description
  );
}

function firstIface(node: Node): NetworkInterface {
  const iface = node.interfaces[0];
  if (iface === undefined) throw new Error(`Node ${node.id} has no interfaces`);
  return iface;
}

function ipSourceOf(packet: Packet): string {
  const payload = packet.frame.payload;
  return payload.kind === 'ip' ? payload.ip.source : '';
}

function sameSubnet(a: string, b: string, prefix: number): boolean {
  const toInt = (ip: string) => {
    const p = ip.split('.').map(Number);
    return ((p[0]! << 24) | (p[1]! << 16) | (p[2]! << 8) | p[3]!) >>> 0;
  };
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return ((toInt(a) & mask) >>> 0) === ((toInt(b) & mask) >>> 0);
}
